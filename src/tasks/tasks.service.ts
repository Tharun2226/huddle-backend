import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityType } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { recordActivity } from '../common/activity.util';
import { PRISMA_TX } from '../common/prisma-tx';
import { getScopedUserIds } from '../common/team-scope';
import {
  AddCommentDto,
  CreateTaskDto,
  ImportTasksDto,
  UpdateTaskDto,
  UpsertChecklistItemDto,
} from './dto/task.dto';

const taskListInclude = {
  checklist: { orderBy: { sortOrder: 'asc' as const } },
  status: true,
  priority: true,
  assignee: { select: { id: true, name: true } },
  assignees: {
    include: { user: { select: { id: true, name: true } } },
  },
};

/** Detail / mutations — includes comments. List endpoints omit them. */
const taskInclude = {
  ...taskListInclude,
  comments: {
    orderBy: { createdAt: 'asc' as const },
    include: { author: { select: { id: true, name: true } } },
  },
};

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser) {
    const scopedIds = await getScopedUserIds(this.prisma, user);
    const where = user.isAdmin
      ? { organizationId: user.organizationId }
      : {
          organizationId: user.organizationId,
          OR: [
            { assigneeId: { in: scopedIds } },
            { assignees: { some: { userId: { in: scopedIds } } } },
          ],
        };

    const tasks = await this.prisma.task.findMany({
      where,
      include: taskListInclude,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    });
    return tasks.map((t) => this.mapTask(t));
  }

  async get(user: AuthUser, id: string) {
    const task = await this.findScoped(user, id);
    return this.mapTask(task);
  }

  async buildImportTemplate(user: AuthUser): Promise<{
    buffer: Buffer;
    fileName: string;
  }> {
    const [priorities, statuses] = await Promise.all([
      this.prisma.orgTaskPriority.findMany({
        where: { organizationId: user.organizationId, isActive: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.orgTaskStatus.findMany({
        where: { organizationId: user.organizationId, isActive: true },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);

    const priorityNames =
      priorities.length > 0
        ? priorities.map((p) => p.name)
        : ['Urgent', 'High', 'Normal', 'Low'];
    const statusNames =
      statuses.length > 0
        ? statuses.map((s) => s.name)
        : ['To Do', 'In Progress', 'In Review', 'Done'];

    const defaultPriority =
      priorities.find((p) => p.isDefault)?.name ??
      priorityNames.find((n) => n.toLowerCase() === 'normal') ??
      priorityNames[0];
    const defaultStatus =
      statuses.find((s) => s.isDefault)?.name ??
      statusNames.find((n) => n.toLowerCase() === 'to do') ??
      statusNames[0];

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Huddle';
    workbook.created = new Date();

    const tasks = workbook.addWorksheet('Tasks');
    tasks.columns = [
      { header: 'Title', key: 'title', width: 40 },
      { header: 'Description', key: 'description', width: 36 },
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Time', key: 'time', width: 12 },
      { header: 'Assignees', key: 'assignees', width: 28 },
      { header: 'Priority', key: 'priority', width: 14 },
      { header: 'Status', key: 'status', width: 16 },
    ];
    tasks.getRow(1).font = { bold: true };

    // Only the first data row is prefilled.
    tasks.getCell('C2').value = todayStr;
    tasks.getCell('D2').value = '9:00 AM';
    tasks.getCell('F2').value = defaultPriority;
    tasks.getCell('G2').value = defaultStatus;

    // Native Excel list dropdown — opens when the cell is selected.
    const priorityList = `"${priorityNames.join(',')}"`;
    const statusList = `"${statusNames.join(',')}"`;
    for (let r = 2; r <= 200; r++) {
      tasks.getCell(`F${r}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [priorityList],
        showErrorMessage: true,
        showInputMessage: false,
        errorTitle: 'Invalid priority',
        error: 'Pick a priority from the dropdown.',
      };
      tasks.getCell(`G${r}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [statusList],
        showErrorMessage: true,
        showInputMessage: false,
        errorTitle: 'Invalid status',
        error: 'Pick a status from the dropdown.',
      };
    }

    const raw = Buffer.from(await workbook.xlsx.writeBuffer());
    const buffer = await this.sanitizeXlsxStyles(raw);
    return {
      buffer,
      fileName: 'tasks import sheet.xlsx',
    };
  }

  /** Dart `excel` package crashes on custom numFmtId < 164 (common after Sheets/Excel). */
  private async sanitizeXlsxStyles(buffer: Buffer): Promise<Buffer> {
    // exceljs depends on jszip
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const JSZip = require('jszip') as typeof import('jszip');
    const zip = await JSZip.loadAsync(buffer);
    const stylesFile = zip.file('xl/styles.xml');
    if (!stylesFile) return buffer;
    let styles = await stylesFile.async('string');
    styles = styles.replace(/<numFmts\b[^>]*>[\s\S]*?<\/numFmts>/gi, '');
    zip.file('xl/styles.xml', styles);
    return Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
  }

  async importMany(user: AuthUser, dto: ImportTasksDto) {
    const [orgUsers, statuses, priorities] = await Promise.all([
      this.prisma.user.findMany({
        where: { organizationId: user.organizationId },
        select: { id: true, name: true },
      }),
      this.prisma.orgTaskStatus.findMany({
        where: { organizationId: user.organizationId, isActive: true },
      }),
      this.prisma.orgTaskPriority.findMany({
        where: { organizationId: user.organizationId, isActive: true },
      }),
    ]);

    const usersByName = new Map<string, string[]>();
    for (const u of orgUsers) {
      const key = u.name.trim().toLowerCase();
      if (!key) continue;
      const list = usersByName.get(key) ?? [];
      list.push(u.id);
      usersByName.set(key, list);
    }

    const statusByKey = new Map<string, string>();
    for (const s of statuses) {
      statusByKey.set(s.name.trim().toLowerCase(), s.id);
      statusByKey.set(s.slug.trim().toLowerCase(), s.id);
    }
    const priorityByKey = new Map<string, string>();
    for (const p of priorities) {
      priorityByKey.set(p.name.trim().toLowerCase(), p.id);
      priorityByKey.set(p.slug.trim().toLowerCase(), p.id);
    }

    const created: Awaited<ReturnType<TasksService['create']>>[] = [];
    const failed: { row: number; title: string; error: string }[] = [];

    for (let i = 0; i < dto.rows.length; i++) {
      const row = dto.rows[i];
      const rowNum = i + 1;
      try {
        const title = row.title.trim();
        if (!title) {
          throw new BadRequestException('Title is required');
        }

        const dueDate = new Date(row.dueDate);
        if (Number.isNaN(dueDate.getTime())) {
          throw new BadRequestException('Invalid due date');
        }
        const { assigneeIds, externalAssignees } = this.resolveImportAssignees(
          user,
          row.assignees,
          usersByName,
        );

        let statusId: string | undefined;
        if (row.status?.trim()) {
          const statusKey = this.stripImportLabel(row.status);
          statusId = statusByKey.get(statusKey);
          if (!statusId) {
            throw new BadRequestException(
              `Unknown status "${statusKey}"`,
            );
          }
        }

        let priorityId: string | undefined;
        if (row.priority?.trim()) {
          const priorityKey = this.stripImportLabel(row.priority);
          priorityId = priorityByKey.get(priorityKey);
          if (!priorityId) {
            throw new BadRequestException(
              `Unknown priority "${priorityKey}"`,
            );
          }
        }

        const task = await this.create(user, {
          title,
          description: row.description?.trim() || undefined,
          dueDate: dueDate.toISOString(),
          assigneeIds,
          externalAssignees,
          statusId,
          priorityId,
          tags: [],
        });
        created.push(task);
      } catch (err) {
        failed.push({
          row: rowNum,
          title: row.title?.trim() || '',
          error: this.importErrorMessage(err),
        });
      }
    }

    return {
      createdCount: created.length,
      failedCount: failed.length,
      created,
      failed,
    };
  }

  async create(user: AuthUser, dto: CreateTaskDto) {
    const externalAssignees = this.normalizeExternalAssignees(
      dto.externalAssignees,
    );
    const assigneeIds = this.resolveAssigneeIdsOptional(
      dto.assigneeIds,
      dto.assigneeId,
    );

    if (assigneeIds.length === 0 && externalAssignees.length === 0) {
      throw new BadRequestException(
        'Select at least one assignee or add other people',
      );
    }
    if (!dto.dueDate) {
      throw new BadRequestException('Due date is required');
    }

    if (assigneeIds.length > 0) {
      await this.assertCanAssign(user, assigneeIds);
    }

    let statusId = dto.statusId;
    if (!statusId) {
      const defaultStatus = await this.prisma.orgTaskStatus.findFirst({
        where: {
          organizationId: user.organizationId,
          isDefault: true,
          isActive: true,
        },
      });
      if (!defaultStatus) {
        throw new NotFoundException('No default task status configured');
      }
      statusId = defaultStatus.id;
    }

    let priorityId = dto.priorityId;
    if (!priorityId) {
      const defaultPriority = await this.prisma.orgTaskPriority.findFirst({
        where: {
          organizationId: user.organizationId,
          isDefault: true,
          isActive: true,
        },
      });
      if (!defaultPriority) {
        throw new NotFoundException('No default task priority configured');
      }
      priorityId = defaultPriority.id;
    }

    const checklistLabels = (dto.checklist ?? [])
      .map((label) => label.trim())
      .filter((label) => label.length > 0);

    const tags = [
      ...new Set((dto.tags ?? []).map((t) => t.trim()).filter(Boolean)),
    ];

    const primaryId = assigneeIds.length > 0 ? assigneeIds[0] : user.id;
    const task = await this.prisma.task.create({
      data: {
        organizationId: user.organizationId,
        title: dto.title,
        description: dto.description ?? '',
        assigneeId: primaryId,
        statusId,
        priorityId,
        dueDate: new Date(dto.dueDate),
        tags,
        externalAssignees,
        assignees:
          assigneeIds.length > 0
            ? {
                create: assigneeIds.map((userId) => ({ userId })),
              }
            : undefined,
        checklist:
          checklistLabels.length > 0
            ? {
                create: checklistLabels.map((label, index) => ({
                  label,
                  sortOrder: index,
                })),
              }
            : undefined,
      },
      include: taskInclude,
    });

    await recordActivity(this.prisma, {
      organizationId: user.organizationId,
      actorId: user.id,
      type: ActivityType.TASK_CREATED,
      subject: task.title,
      targetId: task.id,
    });

    return this.mapTask(task);
  }

  async update(user: AuthUser, id: string, dto: UpdateTaskDto) {
    const existing = await this.findScoped(user, id);
    const canAssign = user.isAdmin || user.permissions.includes('task.assign');
    const existingAssigneeIds = this.assigneeIdsOf(existing);

    if (
      !canAssign &&
      !existingAssigneeIds.includes(user.id) &&
      existing.assigneeId !== user.id
    ) {
      throw new ForbiddenException('Not allowed to update this task');
    }

    let nextAssigneeIds: string[] | undefined;
    const externalAssignees =
      dto.externalAssignees === undefined
        ? undefined
        : this.normalizeExternalAssignees(dto.externalAssignees);

    if (dto.assigneeIds !== undefined || dto.assigneeId !== undefined) {
      nextAssigneeIds = this.resolveAssigneeIdsOptional(
        dto.assigneeIds,
        dto.assigneeId,
      );
      const ext =
        externalAssignees ??
        this.mapExternalAssignees(existing.externalAssignees);
      if (nextAssigneeIds.length === 0 && ext.length === 0) {
        throw new BadRequestException(
          'Select at least one assignee or add other people',
        );
      }
      if (nextAssigneeIds.length > 0) {
        await this.assertCanAssign(user, nextAssigneeIds);
      }
    }

    if (dto.dueDate === null) {
      throw new BadRequestException('Due date is required');
    }

    const prevStatusId = existing.statusId;
    const tags =
      dto.tags === undefined
        ? undefined
        : [...new Set(dto.tags.map((t) => t.trim()).filter(Boolean))];

    const task = await this.prisma.$transaction(async (tx) => {
      if (nextAssigneeIds !== undefined) {
        await tx.taskAssignee.deleteMany({ where: { taskId: id } });
        if (nextAssigneeIds.length > 0) {
          await tx.taskAssignee.createMany({
            data: nextAssigneeIds.map((userId) => ({ taskId: id, userId })),
          });
        }
      }

      const primaryAssignee =
        nextAssigneeIds !== undefined
          ? nextAssigneeIds.length > 0
            ? nextAssigneeIds[0]
            : user.id
          : undefined;

      return tx.task.update({
        where: { id },
        data: {
          title: dto.title,
          description: dto.description,
          assigneeId: primaryAssignee,
          statusId: dto.statusId,
          priorityId: dto.priorityId,
          dueDate:
            dto.dueDate === undefined
              ? undefined
              : dto.dueDate
                ? new Date(dto.dueDate)
                : undefined,
          tags,
          ...(externalAssignees !== undefined ? { externalAssignees } : {}),
        },
        include: taskInclude,
      });
    }, { ...PRISMA_TX });

    if (dto.statusId && dto.statusId !== prevStatusId) {
      const newStatus = await this.prisma.orgTaskStatus.findUnique({
        where: { id: dto.statusId },
      });
      const type = newStatus?.isDone
        ? ActivityType.TASK_COMPLETED
        : ActivityType.TASK_MOVED;
      await recordActivity(this.prisma, {
        organizationId: user.organizationId,
        actorId: user.id,
        type,
        subject: task.title,
        targetId: task.id,
      });
    }

    return this.mapTask(task);
  }

  async remove(user: AuthUser, id: string) {
    const existing = await this.findScoped(user, id);
    const canManage =
      user.isAdmin ||
      user.permissions.includes('task.assign') ||
      existing.assigneeId === user.id ||
      this.assigneeIdsOf(existing).includes(user.id);
    if (!canManage) {
      throw new ForbiddenException('Not allowed to delete this task');
    }
    await this.prisma.task.delete({ where: { id } });
    return { ok: true };
  }

  async addComment(user: AuthUser, id: string, dto: AddCommentDto) {
    await this.findScoped(user, id);
    await this.prisma.taskComment.create({
      data: {
        taskId: id,
        authorId: user.id,
        body: dto.body.trim(),
      },
    });
    const task = await this.findScoped(user, id);
    await recordActivity(this.prisma, {
      organizationId: user.organizationId,
      actorId: user.id,
      type: ActivityType.TASK_COMMENTED,
      subject: task.title,
      targetId: task.id,
    });
    return this.mapTask(task);
  }

  async addChecklistItem(
    user: AuthUser,
    id: string,
    dto: UpsertChecklistItemDto,
  ) {
    await this.findScoped(user, id);
    const max = await this.prisma.taskChecklistItem.aggregate({
      where: { taskId: id },
      _max: { sortOrder: true },
    });
    await this.prisma.taskChecklistItem.create({
      data: {
        taskId: id,
        label: dto.label.trim(),
        done: dto.done ?? false,
        sortOrder: (max._max.sortOrder ?? -1) + 1,
      },
    });
    return this.mapTask(await this.findScoped(user, id));
  }

  async toggleChecklist(user: AuthUser, id: string, itemId: string) {
    await this.findScoped(user, id);
    const item = await this.prisma.taskChecklistItem.findFirst({
      where: { id: itemId, taskId: id },
    });
    if (!item) throw new NotFoundException('Checklist item not found');
    await this.prisma.taskChecklistItem.update({
      where: { id: itemId },
      data: { done: !item.done },
    });
    return this.mapTask(await this.findScoped(user, id));
  }

  private stripImportLabel(raw: string): string {
    return raw
      .trim()
      .replace(/\s*[▼▾]\s*$/u, '')
      .trim()
      .toLowerCase();
  }

  private importErrorMessage(err: unknown): string {
    if (err instanceof HttpException) {
      const res = err.getResponse();
      if (typeof res === 'string') return res;
      if (res && typeof res === 'object' && 'message' in res) {
        const msg = (res as { message?: string | string[] }).message;
        if (Array.isArray(msg)) return msg.join(', ');
        if (typeof msg === 'string' && msg.trim()) return msg;
      }
      return err.message;
    }
    if (err instanceof Error) return err.message;
    return 'Failed to import row';
  }

  private resolveImportAssignees(
    user: AuthUser,
    assigneesRaw: string | undefined,
    usersByName: Map<string, string[]>,
  ): { assigneeIds: string[]; externalAssignees: string[] } {
    const names = this.splitImportNames(assigneesRaw);
    if (names.length === 0) {
      return { assigneeIds: [user.id], externalAssignees: [] };
    }

    const assigneeIds: string[] = [];
    const externalAssignees: string[] = [];
    const seenIds = new Set<string>();
    const seenExt = new Set<string>();

    for (const name of names) {
      const matches = usersByName.get(name.toLowerCase()) ?? [];
      if (matches.length > 0) {
        const id = matches[0];
        if (!seenIds.has(id)) {
          seenIds.add(id);
          assigneeIds.push(id);
        }
      } else {
        const key = name.toLowerCase();
        if (!seenExt.has(key)) {
          seenExt.add(key);
          externalAssignees.push(name);
        }
      }
    }

    return { assigneeIds, externalAssignees };
  }

  private splitImportNames(raw?: string): string[] {
    if (!raw?.trim()) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of raw.split(/[\n,;]+/)) {
      const name = part.trim().replace(/\s+/g, ' ');
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    return out;
  }

  private resolveAssigneeIdsOptional(
    assigneeIds: string[] | undefined,
    assigneeId: string | undefined,
  ): string[] {
    const raw =
      assigneeIds !== undefined
        ? assigneeIds
        : assigneeId
          ? [assigneeId]
          : [];
    return [...new Set(raw.map((id) => id.trim()).filter(Boolean))];
  }

  private async assertCanAssign(user: AuthUser, assigneeIds: string[]) {
    const canAssign = user.isAdmin || user.permissions.includes('task.assign');
    const scopedIds = await getScopedUserIds(this.prisma, user);
    for (const id of assigneeIds) {
      if (!canAssign && id !== user.id) {
        throw new ForbiddenException('You can only assign tasks to yourself');
      }
      if (canAssign && !user.isAdmin && !scopedIds.includes(id)) {
        throw new ForbiddenException('You can only assign tasks to your team');
      }
      await this.ensureUserInOrg(user.organizationId, id);
    }
  }

  private assigneeIdsOf(task: {
    assigneeId: string;
    assignees?: { userId: string }[];
  }): string[] {
    const fromJoin = task.assignees?.map((a) => a.userId) ?? [];
    if (fromJoin.length > 0) return [...new Set(fromJoin)];
    return [task.assigneeId];
  }

  private async findScoped(user: AuthUser, id: string) {
    const task = await this.prisma.task.findFirst({
      where: { id, organizationId: user.organizationId },
      include: taskInclude,
    });
    if (!task) throw new NotFoundException('Task not found');
    const scopedIds = await getScopedUserIds(this.prisma, user);
    const assigneeIds = this.assigneeIdsOf(task);
    const visible =
      user.isAdmin ||
      scopedIds.includes(task.assigneeId) ||
      assigneeIds.some((aid) => scopedIds.includes(aid));
    if (!visible) {
      throw new ForbiddenException('Not allowed to access this task');
    }
    return task;
  }

  private normalizeExternalAssignees(raw?: string[]): string[] {
    if (!raw?.length) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of raw) {
      const name = entry.trim().replace(/\s+/g, ' ');
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    return out;
  }

  private mapExternalAssignees(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const names: string[] = [];
    for (const item of raw) {
      if (typeof item === 'string') {
        const n = item.trim();
        if (n) names.push(n);
      } else if (item && typeof item === 'object' && 'name' in item) {
        const n = String((item as { name?: unknown }).name ?? '').trim();
        if (n) names.push(n);
      }
    }
    return this.normalizeExternalAssignees(names);
  }

  private async ensureUserInOrg(organizationId: string, userId: string) {
    const u = await this.prisma.user.findFirst({
      where: { id: userId, organizationId },
    });
    if (!u) throw new NotFoundException('Assignee not found in organization');
  }

  private mapTask(task: any) {
    const status = task.status ?? {};
    const priority = task.priority ?? {};
    const fromJoin: { id: string; name: string }[] = (
      task.assignees ?? []
    ).map((a: any) => ({
      id: a.userId ?? a.user?.id,
      name: a.user?.name ?? '',
    }));
    const externalAssignees = this.mapExternalAssignees(task.externalAssignees);
    const assigneeIds =
      fromJoin.length > 0
        ? [...new Set(fromJoin.map((a) => a.id).filter(Boolean))]
        : externalAssignees.length > 0
          ? []
          : [task.assigneeId];
    const assigneeNames =
      fromJoin.length > 0
        ? assigneeIds.map(
            (id) => fromJoin.find((a) => a.id === id)?.name ?? '',
          )
        : externalAssignees.length > 0
          ? []
          : [task.assignee?.name ?? ''];

    const statusSlug = status.slug ?? 'todo';
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      statusId: task.statusId,
      statusName: status.name ?? statusSlug,
      statusSlug,
      statusColor: status.color ?? '#94A3B8',
      priorityId: task.priorityId,
      priorityName: priority.name ?? priority.slug ?? 'normal',
      prioritySlug: priority.slug ?? 'normal',
      priorityColor: priority.color ?? '#94A3B8',
      status:
        statusSlug === 'in_progress'
          ? 'inProgress'
          : statusSlug === 'in_review'
            ? 'inReview'
            : statusSlug,
      priority: priority.slug ?? 'normal',
      dueDate: task.dueDate?.toISOString() ?? null,
      assigneeId: task.assigneeId,
      assigneeName: task.assignee?.name ?? null,
      assigneeIds,
      assigneeNames,
      externalAssignees: this.mapExternalAssignees(task.externalAssignees),
      tags: task.tags ?? [],
      createdAt: task.createdAt.toISOString(),
      checklist: (task.checklist ?? []).map((c: any) => ({
        id: c.id,
        label: c.label,
        done: c.done,
      })),
      comments: (task.comments ?? []).map((c: any) => ({
        id: c.id,
        authorId: c.authorId,
        authorName: c.author?.name ?? null,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }
}
