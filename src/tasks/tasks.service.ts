import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityType, TaskStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import {
  AddCommentDto,
  CreateTaskDto,
  UpdateTaskDto,
  UpsertChecklistItemDto,
} from './dto/task.dto';

const taskInclude = {
  checklist: { orderBy: { sortOrder: 'asc' as const } },
  comments: { orderBy: { createdAt: 'asc' as const } },
};

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser) {
    const where =
      user.role === UserRole.MANAGER
        ? { organizationId: user.organizationId }
        : { organizationId: user.organizationId, assigneeId: user.id };

    const tasks = await this.prisma.task.findMany({
      where,
      include: taskInclude,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    });
    return tasks.map((t) => this.mapTask(t));
  }

  async get(user: AuthUser, id: string) {
    const task = await this.findScoped(user, id);
    return this.mapTask(task);
  }

  async create(user: AuthUser, dto: CreateTaskDto) {
    if (
      user.role !== UserRole.MANAGER &&
      dto.assigneeId !== user.id
    ) {
      throw new ForbiddenException('Members can only assign tasks to themselves');
    }

    await this.ensureUserInOrg(user.organizationId, dto.assigneeId);

    const task = await this.prisma.task.create({
      data: {
        organizationId: user.organizationId,
        title: dto.title,
        description: dto.description ?? '',
        assigneeId: dto.assigneeId,
        status: dto.status ?? TaskStatus.TODO,
        priority: dto.priority,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        tags: dto.tags ?? [],
      },
      include: taskInclude,
    });

    await this.prisma.activityEvent.create({
      data: {
        organizationId: user.organizationId,
        actorId: user.id,
        type: ActivityType.TASK_CREATED,
        subject: task.title,
        targetId: task.id,
      },
    });

    return this.mapTask(task);
  }

  async update(user: AuthUser, id: string, dto: UpdateTaskDto) {
    const existing = await this.findScoped(user, id);

    if (
      user.role !== UserRole.MANAGER &&
      existing.assigneeId !== user.id
    ) {
      throw new ForbiddenException('Not allowed to update this task');
    }

    if (dto.assigneeId) {
      if (user.role !== UserRole.MANAGER && dto.assigneeId !== user.id) {
        throw new ForbiddenException('Members can only assign tasks to themselves');
      }
      await this.ensureUserInOrg(user.organizationId, dto.assigneeId);
    }

    const prevStatus = existing.status;
    const task = await this.prisma.task.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        assigneeId: dto.assigneeId,
        status: dto.status,
        priority: dto.priority,
        dueDate:
          dto.dueDate === null
            ? null
            : dto.dueDate
              ? new Date(dto.dueDate)
              : undefined,
        tags: dto.tags,
      },
      include: taskInclude,
    });

    if (dto.status && dto.status !== prevStatus) {
      const type =
        dto.status === TaskStatus.DONE
          ? ActivityType.TASK_COMPLETED
          : ActivityType.TASK_MOVED;
      await this.prisma.activityEvent.create({
        data: {
          organizationId: user.organizationId,
          actorId: user.id,
          type,
          subject: task.title,
          targetId: task.id,
        },
      });
    }

    return this.mapTask(task);
  }

  async addComment(user: AuthUser, id: string, dto: AddCommentDto) {
    await this.findScoped(user, id);
    const comment = await this.prisma.taskComment.create({
      data: {
        taskId: id,
        authorId: user.id,
        body: dto.body,
      },
    });
    const task = await this.prisma.task.findUniqueOrThrow({
      where: { id },
      include: taskInclude,
    });
    await this.prisma.activityEvent.create({
      data: {
        organizationId: user.organizationId,
        actorId: user.id,
        type: ActivityType.TASK_COMMENTED,
        subject: task.title,
        targetId: task.id,
      },
    });
    return {
      id: comment.id,
      authorId: comment.authorId,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
    };
  }

  async addChecklistItem(
    user: AuthUser,
    id: string,
    dto: UpsertChecklistItemDto,
  ) {
    await this.findScoped(user, id);
    const count = await this.prisma.taskChecklistItem.count({
      where: { taskId: id },
    });
    const item = await this.prisma.taskChecklistItem.create({
      data: {
        taskId: id,
        label: dto.label,
        done: dto.done ?? false,
        sortOrder: count,
      },
    });
    return { id: item.id, label: item.label, done: item.done };
  }

  async toggleChecklist(user: AuthUser, taskId: string, itemId: string) {
    await this.findScoped(user, taskId);
    const item = await this.prisma.taskChecklistItem.findFirst({
      where: { id: itemId, taskId },
    });
    if (!item) throw new NotFoundException('Checklist item not found');
    const updated = await this.prisma.taskChecklistItem.update({
      where: { id: itemId },
      data: { done: !item.done },
    });
    return { id: updated.id, label: updated.label, done: updated.done };
  }

  private async findScoped(user: AuthUser, id: string) {
    const task = await this.prisma.task.findFirst({
      where: { id, organizationId: user.organizationId },
      include: taskInclude,
    });
    if (!task) throw new NotFoundException('Task not found');
    if (
      user.role !== UserRole.MANAGER &&
      task.assigneeId !== user.id
    ) {
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

  private mapTask(task: {
    id: string;
    title: string;
    description: string;
    status: TaskStatus;
    priority: string;
    dueDate: Date | null;
    assigneeId: string;
    tags: string[];
    createdAt: Date;
    checklist: { id: string; label: string; done: boolean }[];
    comments: {
      id: string;
      authorId: string;
      body: string;
      createdAt: Date;
    }[];
  }) {
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      status: this.mapStatus(task.status),
      priority: task.priority.toLowerCase(),
      dueDate: task.dueDate?.toISOString() ?? null,
      assigneeId: task.assigneeId,
      tags: task.tags,
      createdAt: task.createdAt.toISOString(),
      checklist: task.checklist.map((c) => ({
        id: c.id,
        label: c.label,
        done: c.done,
      })),
      comments: task.comments.map((c) => ({
        id: c.id,
        authorId: c.authorId,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }

  private mapStatus(status: TaskStatus) {
    switch (status) {
      case TaskStatus.TODO:
        return 'todo';
      case TaskStatus.IN_PROGRESS:
        return 'inProgress';
      case TaskStatus.IN_REVIEW:
        return 'inReview';
      case TaskStatus.DONE:
        return 'done';
    }
  }
}
