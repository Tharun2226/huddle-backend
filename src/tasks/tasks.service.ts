import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { recordActivity } from '../common/activity.util';
import { PRISMA_TX } from '../common/prisma-tx';
import { getScopedUserIds } from '../common/team-scope';
import {
  AddCommentDto,
  CreateTaskDto,
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

  async create(user: AuthUser, dto: CreateTaskDto) {
    const assigneeIds = this.resolveAssigneeIds(dto.assigneeIds, dto.assigneeId);
    await this.assertCanAssign(user, assigneeIds);

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

    const primaryId = assigneeIds[0];
    const task = await this.prisma.task.create({
      data: {
        organizationId: user.organizationId,
        title: dto.title,
        description: dto.description ?? '',
        assigneeId: primaryId,
        statusId,
        priorityId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        tags,
        assignees: {
          create: assigneeIds.map((userId) => ({ userId })),
        },
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
    if (dto.assigneeIds?.length || dto.assigneeId) {
      nextAssigneeIds = this.resolveAssigneeIds(dto.assigneeIds, dto.assigneeId);
      await this.assertCanAssign(user, nextAssigneeIds);
    }

    const prevStatusId = existing.statusId;
    const tags =
      dto.tags === undefined
        ? undefined
        : [...new Set(dto.tags.map((t) => t.trim()).filter(Boolean))];

    const task = await this.prisma.$transaction(async (tx) => {
      if (nextAssigneeIds) {
        await tx.taskAssignee.deleteMany({ where: { taskId: id } });
        await tx.taskAssignee.createMany({
          data: nextAssigneeIds.map((userId) => ({ taskId: id, userId })),
        });
      }

      return tx.task.update({
        where: { id },
        data: {
          title: dto.title,
          description: dto.description,
          assigneeId: nextAssigneeIds?.[0],
          statusId: dto.statusId,
          priorityId: dto.priorityId,
          dueDate:
            dto.dueDate === null
              ? null
              : dto.dueDate
                ? new Date(dto.dueDate)
                : undefined,
          tags,
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

  private resolveAssigneeIds(
    assigneeIds: string[] | undefined,
    assigneeId: string | undefined,
  ): string[] {
    const raw =
      assigneeIds && assigneeIds.length > 0
        ? assigneeIds
        : assigneeId
          ? [assigneeId]
          : [];
    const ids = [...new Set(raw.map((id) => id.trim()).filter(Boolean))];
    if (ids.length === 0) {
      throw new BadRequestException('Select at least one assignee');
    }
    return ids;
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
    const assigneeIds =
      fromJoin.length > 0
        ? [...new Set(fromJoin.map((a) => a.id).filter(Boolean))]
        : [task.assigneeId];
    const assigneeNames =
      fromJoin.length > 0
        ? assigneeIds.map(
            (id) => fromJoin.find((a) => a.id === id)?.name ?? '',
          )
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
