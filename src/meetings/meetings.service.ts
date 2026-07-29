import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { getScopedUserIds } from '../common/team-scope';
import { CreateMeetingDto } from './dto/meeting.dto';

@Injectable()
export class MeetingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser) {
    const scopedIds = await getScopedUserIds(this.prisma, user);
    const meetings = await this.prisma.meeting.findMany({
      where: {
        organizationId: user.organizationId,
        ...(user.isAdmin
          ? {}
          : { attendees: { some: { userId: { in: scopedIds } } } }),
      },
      include: { attendees: true },
      orderBy: { start: 'asc' },
    });
    return meetings.map((m) => this.map(m));
  }

  async listForTask(user: AuthUser, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId: user.organizationId },
    });
    if (!task) throw new NotFoundException('Task not found');

    const scopedIds = await getScopedUserIds(this.prisma, user);
    if (!user.isAdmin && !scopedIds.includes(task.assigneeId)) {
      throw new ForbiddenException('Not allowed to access this task');
    }

    const meetings = await this.prisma.meeting.findMany({
      where: { organizationId: user.organizationId, taskId },
      include: { attendees: true },
      orderBy: { start: 'asc' },
    });
    return meetings.map((m) => this.map(m));
  }

  async create(user: AuthUser, dto: CreateMeetingDto) {
    if (!user.isAdmin && !user.permissions.includes('meeting.create')) {
      throw new ForbiddenException('You do not have permission to create meetings');
    }

    const start = new Date(dto.start);
    const end = new Date(dto.end);
    if (!(end > start)) {
      throw new BadRequestException('Meeting end must be after start');
    }

    const recurrence = dto.recurrence ?? 'none';
    const weekdays = [...new Set(dto.weekdays ?? [])].sort((a, b) => a - b);
    if (recurrence === 'weekly' && weekdays.length === 0) {
      throw new BadRequestException(
        'Select at least one weekday for weekly recurrence',
      );
    }

    if (dto.taskId) {
      const task = await this.prisma.task.findFirst({
        where: { id: dto.taskId, organizationId: user.organizationId },
      });
      if (!task) throw new NotFoundException('Related task not found');
    }

    const scopedIds = await getScopedUserIds(this.prisma, user);
    const attendeeIds = [...new Set(dto.attendeeIds)];
    if (!attendeeIds.includes(user.id)) {
      attendeeIds.push(user.id);
    }
    for (const id of attendeeIds) {
      if (!user.isAdmin && !scopedIds.includes(id)) {
        throw new ForbiddenException('You can only schedule meetings for your team');
      }
      const exists = await this.prisma.user.findFirst({
        where: { id, organizationId: user.organizationId },
      });
      if (!exists) throw new NotFoundException(`Attendee ${id} not found`);
    }

    const meeting = await this.prisma.meeting.create({
      data: {
        organizationId: user.organizationId,
        title: dto.title.trim(),
        start,
        end,
        location: dto.location?.trim() ?? '',
        notes: dto.notes?.trim() ?? '',
        link: dto.link?.trim() ?? '',
        recurrence,
        weekdays: recurrence === 'weekly' ? weekdays : [],
        taskId: dto.taskId ?? null,
        attendees: {
          create: attendeeIds.map((userId) => ({ userId })),
        },
      },
      include: { attendees: true },
    });

    await this.prisma.activityEvent.create({
      data: {
        organizationId: user.organizationId,
        actorId: user.id,
        type: ActivityType.MEETING_SCHEDULED,
        subject: meeting.title,
        targetId: meeting.id,
      },
    });

    return this.map(meeting);
  }

  private map(m: {
    id: string;
    title: string;
    start: Date;
    end: Date;
    location: string;
    notes: string;
    link?: string;
    recurrence?: string;
    weekdays?: number[];
    taskId?: string | null;
    attendees: { userId: string }[];
  }) {
    return {
      id: m.id,
      title: m.title,
      start: m.start.toISOString(),
      end: m.end.toISOString(),
      location: m.location,
      notes: m.notes,
      link: m.link ?? '',
      recurrence: m.recurrence ?? 'none',
      weekdays: m.weekdays ?? [],
      taskId: m.taskId ?? null,
      attendeeIds: m.attendees.map((a) => a.userId),
    };
  }
}
