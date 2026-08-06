import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivityType,
  AuditAction,
  ExpenseStatus,
  NotificationType,
} from '@prisma/client';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { recordActivity } from '../common/activity.util';
import { getScopedUserIds } from '../common/team-scope';
import { isReceiptOcrEnabled } from '../common/serverless-env';
import { uploadsRoot } from '../common/uploads-path';
import { CreateExpenseDto, DecisionDto } from './dto/expense.dto';
import { ReceiptOcrService } from './receipt-ocr.service';
import { NotificationService } from '../notifications/notification.service';

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly receiptOcr: ReceiptOcrService,
    private readonly notifications: NotificationService,
  ) {}

  /** Save a receipt image under uploads/receipts (local disk for now). */
  saveReceiptFile(file: Express.Multer.File, user: AuthUser) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Receipt image is required');
    }
    const allowed = new Set([
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ]);
    if (file.mimetype && !allowed.has(file.mimetype.toLowerCase())) {
      throw new BadRequestException('Only image receipts are supported');
    }

    const dir = join(uploadsRoot(), 'receipts', user.organizationId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const ext = (extname(file.originalname) || '.jpg').toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'].includes(ext)
      ? ext
      : '.jpg';
    const filename = `${Date.now()}-${randomUUID()}${safeExt}`;
    writeFileSync(join(dir, filename), file.buffer);

    const receiptUrl = `/uploads/receipts/${user.organizationId}/${filename}`;
    return { receiptUrl };
  }

  /**
   * Store the receipt file, OCR it on the backend, and return extracted fields.
   * Empty/null fields mean OCR could not confidently read them — never random.
   * On serverless, OCR failures must not 500 — return soft empty fields.
   */
  async scanReceipt(file: Express.Multer.File, user: AuthUser) {
    const { receiptUrl } = this.saveReceiptFile(file, user);

    if (!isReceiptOcrEnabled()) {
      return this.manualEntryScanResponse(receiptUrl, 'OCR_SKIPPED_SERVERLESS');
    }

    try {
      const extracted = await this.receiptOcr.scan(file.buffer);
      return {
        success: true,
        receiptUrl,
        merchant: extracted.merchant,
        amount: extracted.amount,
        date: extracted.date,
        tax: extracted.tax,
        invoiceNumber: extracted.invoiceNumber,
        gstin: extracted.gstin,
        currency: extracted.currency,
        noteLines: extracted.noteLines ?? [],
        category: extracted.category,
        confidence: extracted.confidence,
        riskScore: extracted.riskScore,
        riskLevel: extracted.riskLevel,
        issues: extracted.issues,
        rawText: extracted.rawText,
      };
    } catch (err) {
      // Tesseract/sharp often fail on serverless — keep the image, let user type fields.
      return this.manualEntryScanResponse(
        receiptUrl,
        'OCR_UNAVAILABLE',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /** Fast path when OCR is skipped or failed — receipt is saved, user fills fields. */
  private manualEntryScanResponse(
    receiptUrl: string,
    code: 'OCR_SKIPPED_SERVERLESS' | 'OCR_UNAVAILABLE',
    ocrError?: string,
  ) {
    const message =
      code === 'OCR_SKIPPED_SERVERLESS'
        ? 'Receipt attached. Enter amount and merchant below (auto-scan runs on dedicated servers).'
        : 'Automatic scan is unavailable right now. Receipt attached — enter details manually.';

    return {
      success: true,
      receiptUrl,
      merchant: null,
      amount: null,
      date: null,
      tax: null,
      invoiceNumber: null,
      gstin: null,
      currency: 'INR',
      noteLines: [],
      category: null,
      confidence: { overall: 0 },
      riskScore: 0,
      riskLevel: 'Medium Risk' as const,
      issues: [{ code, message, points: 0 }],
      rawText: '',
      ocrSkipped: true,
      ...(ocrError ? { ocrError } : {}),
    };
  }

  async list(user: AuthUser) {
    const scopedIds = await getScopedUserIds(this.prisma, user);
    const expenses = await this.prisma.expense.findMany({
      where: {
        organizationId: user.organizationId,
        AND: [
          // Team / org scope for non-admins
          ...(user.isAdmin ? [] : [{ submitterId: { in: scopedIds } }]),
          // Drafts are private — only the creator ever sees them
          {
            OR: [
              { status: { not: ExpenseStatus.DRAFT } },
              { submitterId: user.id },
            ],
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    return expenses.map((e) => this.map(e));
  }

  async pendingApprovals(user: AuthUser) {
    if (!user.isAdmin && !user.permissions.includes('expense.approve')) {
      throw new ForbiddenException('Insufficient permissions');
    }
    const scopedIds = await getScopedUserIds(this.prisma, user);
    // Admins/managers may approve their own submitted expenses as well.
    const expenses = await this.prisma.expense.findMany({
      where: {
        organizationId: user.organizationId,
        status: ExpenseStatus.SUBMITTED,
        ...(user.isAdmin ? {} : { submitterId: { in: scopedIds } }),
      },
      orderBy: { createdAt: 'asc' },
    });
    return expenses.map((e) => this.map(e));
  }

  async get(user: AuthUser, id: string) {
    const expense = await this.findScoped(user, id);
    return this.map(expense);
  }

  async create(user: AuthUser, dto: CreateExpenseDto) {
    const expense = await this.prisma.expense.create({
      data: {
        organizationId: user.organizationId,
        amount: dto.amount,
        category: dto.category,
        date: new Date(dto.date),
        merchant: dto.merchant,
        notes: dto.notes ?? '',
        receiptUrl: dto.receiptUrl,
        submitterId: user.id,
        status: dto.submitNow ? ExpenseStatus.SUBMITTED : ExpenseStatus.DRAFT,
      },
    });

    if (dto.submitNow) {
      await recordActivity(this.prisma, {
        organizationId: user.organizationId,
        actorId: user.id,
        type: ActivityType.EXPENSE_SUBMITTED,
        subject: expense.merchant,
        amount: expense.amount,
        targetId: expense.id,
      });
      await this.notifyExpenseSubmitted(user, expense);
    }

    return this.map(expense);
  }

  async submit(user: AuthUser, id: string) {
    const expense = await this.findScoped(user, id, true);
    if (
      expense.status !== ExpenseStatus.DRAFT &&
      expense.status !== ExpenseStatus.REJECTED
    ) {
      throw new BadRequestException('Only draft/rejected expenses can be submitted');
    }
    const updated = await this.prisma.expense.update({
      where: { id },
      data: {
        status: ExpenseStatus.SUBMITTED,
        decidedAt: null,
        decidedById: null,
        decisionNote: '',
      },
    });
    await recordActivity(this.prisma, {
      organizationId: user.organizationId,
      actorId: user.id,
      type: ActivityType.EXPENSE_SUBMITTED,
      subject: updated.merchant,
      amount: updated.amount,
      targetId: updated.id,
    });
    await this.notifyExpenseSubmitted(user, updated);
    return this.map(updated);
  }

  /**
   * Creator may delete drafts, submitted (not yet decided), and rejected expenses.
   * Hard-deletes the DB row (and receipt file if present).
   */
  async remove(user: AuthUser, id: string) {
    const expense = await this.findScoped(user, id, true);
    const deletable: ExpenseStatus[] = [
      ExpenseStatus.DRAFT,
      ExpenseStatus.SUBMITTED,
      ExpenseStatus.REJECTED,
    ];
    if (!deletable.includes(expense.status)) {
      throw new BadRequestException(
        'Only draft, submitted, or rejected expenses can be deleted',
      );
    }

    // Remove related activity rows pointing at this expense, then the expense.
    await this.prisma.activityEvent.deleteMany({
      where: { targetId: id, organizationId: user.organizationId },
    });
    await this.prisma.expense.delete({ where: { id } });

    if (expense.receiptUrl) {
      try {
        const relative = expense.receiptUrl.replace(/^\//, '').replace(/^uploads[\\/]/, '');
        const full = join(uploadsRoot(), relative);
        if (existsSync(full)) unlinkSync(full);
      } catch {
        // File cleanup is best-effort
      }
    }

    return { ok: true, id };
  }

  async approve(user: AuthUser, id: string, dto: DecisionDto) {
    return this.decide(user, id, ExpenseStatus.APPROVED, AuditAction.EXPENSE_APPROVED, ActivityType.EXPENSE_APPROVED, dto.note ?? '');
  }

  async reject(user: AuthUser, id: string, dto: DecisionDto) {
    return this.decide(user, id, ExpenseStatus.REJECTED, AuditAction.EXPENSE_REJECTED, ActivityType.EXPENSE_REJECTED, dto.note ?? '');
  }

  async reimburse(user: AuthUser, id: string, dto: DecisionDto) {
    const expense = await this.findScoped(user, id);
    if (expense.status !== ExpenseStatus.APPROVED) {
      throw new BadRequestException('Only approved expenses can be reimbursed');
    }
    const updated = await this.prisma.expense.update({
      where: { id },
      data: {
        status: ExpenseStatus.REIMBURSED,
        reimbursedAt: new Date(),
        decisionNote: dto.note || expense.decisionNote,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        organizationId: user.organizationId,
        actorId: user.id,
        action: AuditAction.EXPENSE_REIMBURSED,
        targetType: 'expense',
        targetId: id,
        note: dto.note ?? '',
      },
    }).catch(() => undefined);
    await recordActivity(this.prisma, {
      organizationId: user.organizationId,
      actorId: user.id,
      type: ActivityType.EXPENSE_REIMBURSED,
      subject: updated.merchant,
      amount: updated.amount,
      targetId: updated.id,
    });
    await this.notifications.notifyUser({
      userId: updated.submitterId,
      organizationId: user.organizationId,
      title: 'Expense reimbursed',
      body: `${updated.merchant} (₹${Number(updated.amount).toFixed(0)}) was marked reimbursed.`,
      type: NotificationType.SYSTEM_ALERT,
      referenceId: updated.id,
      data: { referenceKind: 'expense' },
    });
    return this.map(updated);
  }

  private async decide(
    user: AuthUser,
    id: string,
    status: ExpenseStatus,
    audit: AuditAction,
    activity: ActivityType,
    note: string,
  ) {
    if (!user.isAdmin && !user.permissions.includes('expense.approve')) {
      throw new ForbiddenException('Insufficient permissions');
    }
    const expense = await this.findScoped(user, id);
    if (expense.status !== ExpenseStatus.SUBMITTED) {
      throw new BadRequestException('Only submitted expenses can be decided');
    }
    const updated = await this.prisma.expense.update({
      where: { id },
      data: {
        status,
        decidedAt: new Date(),
        decidedById: user.id,
        decisionNote: note,
      },
    });
    try {
      await this.prisma.auditLog.create({
        data: {
          organizationId: user.organizationId,
          actorId: user.id,
          action: audit,
          targetType: 'expense',
          targetId: id,
          note,
        },
      });
    } catch {
      // Audit is best-effort — decision already persisted
    }
    await recordActivity(this.prisma, {
      organizationId: user.organizationId,
      actorId: user.id,
      type: activity,
      subject: updated.merchant,
      amount: updated.amount,
      targetId: updated.id,
    });

    const approved = status === ExpenseStatus.APPROVED;
    await this.notifications.notifyUser({
      userId: updated.submitterId,
      organizationId: user.organizationId,
      title: approved ? 'Expense approved' : 'Expense rejected',
      body: approved
        ? `${updated.merchant} (₹${Number(updated.amount).toFixed(0)}) was approved.`
        : `${updated.merchant} (₹${Number(updated.amount).toFixed(0)}) was rejected${note ? `: ${note}` : '.'}`,
      type: approved
        ? NotificationType.EXPENSE_APPROVED
        : NotificationType.EXPENSE_REJECTED,
      referenceId: updated.id,
      data: { referenceKind: 'expense' },
    });

    return this.map(updated);
  }

  private async notifyExpenseSubmitted(
    actor: AuthUser,
    expense: { id: string; merchant: string; amount: unknown; submitterId: string },
  ) {
    const recipients = await this.approverUserIds(
      actor.organizationId,
      expense.submitterId,
    );
    await this.notifications.notifyUsers(recipients, {
      organizationId: actor.organizationId,
      title: 'Expense submitted',
      body: `${actor.name} submitted ${expense.merchant} (₹${Number(expense.amount).toFixed(0)}) for approval.`,
      type: NotificationType.EXPENSE_SUBMITTED,
      referenceId: expense.id,
      data: { referenceKind: 'expense' },
    });
  }

  /** Manager of submitter + org users with expense.approve / admin role. */
  private async approverUserIds(
    organizationId: string,
    submitterId: string,
  ): Promise<string[]> {
    const ids = new Set<string>();
    const submitter = await this.prisma.user.findUnique({
      where: { id: submitterId },
      select: { managerId: true },
    });
    if (submitter?.managerId) ids.add(submitter.managerId);

    const approvers = await this.prisma.user.findMany({
      where: {
        organizationId,
        id: { not: submitterId },
        roles: {
          some: {
            role: {
              OR: [
                { isAdmin: true },
                {
                  permissions: {
                    some: { permission: { code: 'expense.approve' } },
                  },
                },
              ],
            },
          },
        },
      },
      select: { id: true },
    });
    for (const row of approvers) ids.add(row.id);
    return [...ids];
  }

  private async findScoped(user: AuthUser, id: string, ownOnly = false) {
    const expense = await this.prisma.expense.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!expense) throw new NotFoundException('Expense not found');

    // Drafts are only visible/accessible to the creator
    if (
      expense.status === ExpenseStatus.DRAFT &&
      expense.submitterId !== user.id
    ) {
      throw new ForbiddenException('Draft expenses are private to the creator');
    }

    const scopedIds = await getScopedUserIds(this.prisma, user);
    if ((ownOnly || !user.isAdmin) && !scopedIds.includes(expense.submitterId)) {
      throw new ForbiddenException('Not allowed to access this expense');
    }
    if (ownOnly && expense.submitterId !== user.id) {
      throw new ForbiddenException('Not your expense');
    }
    return expense;
  }

  private map(e: any) {
    const categoryMap: Record<string, string> = {
      MEALS: 'meals',
      TRAVEL: 'travel',
      ACCOMMODATION: 'accommodation',
      SUPPLIES: 'supplies',
      SOFTWARE: 'software',
      CLIENT: 'client',
      OTHER: 'other',
    };
    const statusMap: Record<string, string> = {
      DRAFT: 'draft',
      SUBMITTED: 'submitted',
      APPROVED: 'approved',
      REIMBURSED: 'reimbursed',
      REJECTED: 'rejected',
    };
    return {
      id: e.id,
      amount: Number(e.amount),
      category: categoryMap[e.category] ?? e.category.toLowerCase(),
      date: e.date.toISOString(),
      merchant: e.merchant,
      notes: e.notes,
      status: statusMap[e.status],
      submitterId: e.submitterId,
      receiptPath: e.receiptUrl,
      createdAt: e.createdAt.toISOString(),
      decidedAt: e.decidedAt?.toISOString() ?? null,
      decidedBy: e.decidedById,
      decisionNote: e.decisionNote,
      reimbursedAt: e.reimbursedAt?.toISOString() ?? null,
    };
  }
}
