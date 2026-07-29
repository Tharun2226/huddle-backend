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
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { getScopedUserIds } from '../common/team-scope';
import { CreateExpenseDto, DecisionDto } from './dto/expense.dto';

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser) {
    const scopedIds = await getScopedUserIds(this.prisma, user);
    const expenses = await this.prisma.expense.findMany({
      where: {
        organizationId: user.organizationId,
        ...(user.isAdmin ? {} : { submitterId: { in: scopedIds } }),
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
    const expenses = await this.prisma.expense.findMany({
      where: {
        organizationId: user.organizationId,
        status: ExpenseStatus.SUBMITTED,
        ...(user.isAdmin ? {} : { submitterId: { in: scopedIds.filter((id) => id !== user.id) } }),
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
      await this.prisma.activityEvent.create({
        data: {
          organizationId: user.organizationId,
          actorId: user.id,
          type: ActivityType.EXPENSE_SUBMITTED,
          subject: expense.merchant,
          amount: expense.amount,
          targetId: expense.id,
        },
      });
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
    await this.prisma.activityEvent.create({
      data: {
        organizationId: user.organizationId,
        actorId: user.id,
        type: ActivityType.EXPENSE_SUBMITTED,
        subject: updated.merchant,
        amount: updated.amount,
        targetId: updated.id,
      },
    });
    return this.map(updated);
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
    });
    await this.prisma.activityEvent.create({
      data: {
        organizationId: user.organizationId,
        actorId: user.id,
        type: ActivityType.EXPENSE_REIMBURSED,
        subject: updated.merchant,
        amount: updated.amount,
        targetId: updated.id,
      },
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
    await this.prisma.activityEvent.create({
      data: {
        organizationId: user.organizationId,
        actorId: user.id,
        type: activity,
        subject: updated.merchant,
        amount: updated.amount,
        targetId: updated.id,
      },
    });
    return this.map(updated);
  }

  private async findScoped(user: AuthUser, id: string, ownOnly = false) {
    const expense = await this.prisma.expense.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!expense) throw new NotFoundException('Expense not found');
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
