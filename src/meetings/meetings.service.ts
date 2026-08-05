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
import { getScopedUserIds } from '../common/team-scope';
import { CreateMeetingDto, UpdateMeetingDto } from './dto/meeting.dto';

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
      include: { assignees: true },
    });
    if (!task) throw new NotFoundException('Task not found');

    const scopedIds = await getScopedUserIds(this.prisma, user);
    const relatedIds = [
      task.assigneeId,
      ...task.assignees.map((a) => a.userId),
    ];
    if (!user.isAdmin && !relatedIds.some((id) => scopedIds.includes(id))) {
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
    this.assertCanManageMeetings(user);
    const prepared = await this.prepareMeetingData(user, dto);

    const meeting = await this.prisma.meeting.create({
      data: {
        organizationId: user.organizationId,
        title: prepared.title,
        start: prepared.start,
        end: prepared.end,
        location: prepared.location,
        notes: prepared.notes,
        link: prepared.link,
        isOnline: prepared.isOnline,
        externalAttendees: prepared.externalAttendees,
        recurrence: prepared.recurrence,
        weekdays: prepared.weekdays,
        taskId: prepared.taskId,
        attendees: {
          create: prepared.attendeeIds.map((userId) => ({ userId })),
        },
      },
      include: { attendees: true },
    });

    await recordActivity(this.prisma, {
      organizationId: user.organizationId,
      actorId: user.id,
      type: ActivityType.MEETING_SCHEDULED,
      subject: meeting.title,
      targetId: meeting.id,
    });

    return this.map(meeting);
  }

  async update(user: AuthUser, id: string, dto: UpdateMeetingDto) {
    this.assertCanManageMeetings(user);
    const existing = await this.prisma.meeting.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!existing) throw new NotFoundException('Meeting not found');

    const prepared = await this.prepareMeetingData(user, dto);

    const meeting = await this.prisma.$transaction(async (tx) => {
      await tx.meetingAttendee.deleteMany({ where: { meetingId: id } });
      return tx.meeting.update({
        where: { id },
        data: {
          title: prepared.title,
          start: prepared.start,
          end: prepared.end,
          location: prepared.location,
          notes: prepared.notes,
          link: prepared.link,
          isOnline: prepared.isOnline,
          externalAttendees: prepared.externalAttendees,
          recurrence: prepared.recurrence,
          weekdays: prepared.weekdays,
          taskId: prepared.taskId,
          attendees: {
            create: prepared.attendeeIds.map((userId) => ({ userId })),
          },
        },
        include: { attendees: true },
      });
    });

    return this.map(meeting);
  }

  async remove(user: AuthUser, id: string) {
    this.assertCanManageMeetings(user);
    const existing = await this.prisma.meeting.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!existing) throw new NotFoundException('Meeting not found');

    await this.prisma.meeting.delete({ where: { id } });
    return { ok: true };
  }

  private assertCanManageMeetings(user: AuthUser) {
    if (!user.isAdmin && !user.permissions.includes('meeting.create')) {
      throw new ForbiddenException(
        'You do not have permission to manage meetings',
      );
    }
  }

  private async prepareMeetingData(user: AuthUser, dto: CreateMeetingDto) {
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
    const attendeeIds = [...new Set(dto.attendeeIds ?? [])];
    if (!attendeeIds.includes(user.id)) {
      attendeeIds.push(user.id);
    }
    for (const id of attendeeIds) {
      if (!user.isAdmin && !scopedIds.includes(id)) {
        throw new ForbiddenException(
          'You can only schedule meetings for your team',
        );
      }
      const exists = await this.prisma.user.findFirst({
        where: { id, organizationId: user.organizationId },
      });
      if (!exists) throw new NotFoundException(`Attendee ${id} not found`);
    }

    const isOnline = dto.isOnline !== false;
    const externalAttendees = (dto.externalAttendees ?? [])
      .map((g) => ({
        name: g.name.trim(),
        ...(g.email?.trim() ? { email: g.email.trim().toLowerCase() } : {}),
      }))
      .filter((g) => g.name.length > 0);

    return {
      title: dto.title.trim(),
      start,
      end,
      location: dto.location?.trim() ?? '',
      notes: dto.notes?.trim() ?? '',
      link: isOnline ? (dto.link?.trim() ?? '') : '',
      isOnline,
      externalAttendees,
      recurrence,
      weekdays: recurrence === 'weekly' ? weekdays : ([] as number[]),
      taskId: dto.taskId ?? null,
      attendeeIds,
    };
  }

  private map(m: {
    id: string;
    title: string;
    start: Date;
    end: Date;
    location: string;
    notes: string;
    link?: string;
    isOnline?: boolean;
    externalAttendees?: unknown;
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
      isOnline: m.isOnline !== false,
      externalAttendees: this.mapExternal(m.externalAttendees),
      recurrence: m.recurrence ?? 'none',
      weekdays: m.weekdays ?? [],
      taskId: m.taskId ?? null,
      attendeeIds: m.attendees.map((a) => a.userId),
    };
  }

  private mapExternal(raw: unknown): { name: string; email?: string }[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((row) => {
        if (!row || typeof row !== 'object') return null;
        const r = row as { name?: unknown; email?: unknown };
        const name = typeof r.name === 'string' ? r.name.trim() : '';
        if (!name) return null;
        const email =
          typeof r.email === 'string' && r.email.trim()
            ? r.email.trim()
            : undefined;
        return email ? { name, email } : { name };
      })
      .filter((x): x is { name: string; email?: string } => x != null);
  }
}
