import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { CreateMeetingDto } from './dto/meeting.dto';

@Injectable()
export class MeetingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser) {
    const meetings = await this.prisma.meeting.findMany({
      where: {
        organizationId: user.organizationId,
        ...(user.role === UserRole.MANAGER
          ? {}
          : { attendees: { some: { userId: user.id } } }),
      },
      include: { attendees: true },
      orderBy: { start: 'asc' },
    });
    return meetings.map((m) => this.map(m));
  }

  async create(user: AuthUser, dto: CreateMeetingDto) {
    if (user.role !== UserRole.MANAGER) {
      throw new ForbiddenException('Only managers can create meetings');
    }

    for (const id of dto.attendeeIds) {
      const exists = await this.prisma.user.findFirst({
        where: { id, organizationId: user.organizationId },
      });
      if (!exists) throw new NotFoundException(`Attendee ${id} not found`);
    }

    const meeting = await this.prisma.meeting.create({
      data: {
        organizationId: user.organizationId,
        title: dto.title,
        start: new Date(dto.start),
        end: new Date(dto.end),
        location: dto.location ?? '',
        notes: dto.notes ?? '',
        attendees: {
          create: dto.attendeeIds.map((userId) => ({ userId })),
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
    attendees: { userId: string }[];
  }) {
    return {
      id: m.id,
      title: m.title,
      start: m.start.toISOString(),
      end: m.end.toISOString(),
      location: m.location,
      notes: m.notes,
      attendeeIds: m.attendees.map((a) => a.userId),
    };
  }
}
