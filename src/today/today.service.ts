import { Injectable } from '@nestjs/common';
import { ExpenseStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { getScopedUserIds } from '../common/team-scope';

@Injectable()
export class TodayService {
  constructor(private readonly prisma: PrismaService) {}

  async get(user: AuthUser) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const canApprove = user.isAdmin || user.permissions.includes('expense.approve');
    const scopedIds = await getScopedUserIds(this.prisma, user);

    const taskWhere = user.isAdmin
      ? { organizationId: user.organizationId }
      : {
          organizationId: user.organizationId,
          OR: [
            { assigneeId: { in: scopedIds } },
            { assignees: { some: { userId: { in: scopedIds } } } },
          ],
        };

    const meetingWhere = user.isAdmin
      ? { organizationId: user.organizationId }
      : {
          organizationId: user.organizationId,
          attendees: { some: { userId: { in: scopedIds } } },
        };

    const doneStatuses = await this.prisma.orgTaskStatus.findMany({
      where: { organizationId: user.organizationId, isDone: true },
      select: { id: true },
    });
    const doneStatusIds = doneStatuses.map((s) => s.id);

    const todayTaskInclude = {
      checklist: { select: { id: true, label: true, done: true } },
      status: true,
      priority: true,
      assignees: {
        include: { user: { select: { id: true, name: true } } },
      },
      assignee: { select: { id: true, name: true } },
    };

    const [meetings, dueToday, overdue, pendingApprovals, myPending, nextMeeting] =
      await Promise.all([
        this.prisma.meeting.findMany({
          where: { ...meetingWhere, start: { gte: start, lt: end } },
          include: { attendees: true },
          orderBy: { start: 'asc' },
        }),
        this.prisma.task.findMany({
          where: {
            ...taskWhere,
            dueDate: { gte: start, lt: end },
            statusId: { notIn: doneStatusIds },
          },
          include: todayTaskInclude,
          orderBy: { dueDate: 'asc' },
        }),
        this.prisma.task.findMany({
          where: {
            ...taskWhere,
            dueDate: { lt: start },
            statusId: { notIn: doneStatusIds },
          },
          include: todayTaskInclude,
          orderBy: { dueDate: 'asc' },
        }),
        canApprove
          ? this.prisma.expense.findMany({
              where: {
                organizationId: user.organizationId,
                status: ExpenseStatus.SUBMITTED,
                ...(user.isAdmin
                  ? {}
                  : { submitterId: { in: scopedIds } }),
              },
              orderBy: { createdAt: 'asc' },
            })
          : Promise.resolve([]),
        !canApprove
          ? this.prisma.expense.findMany({
              where: {
                organizationId: user.organizationId,
                submitterId: user.id,
                status: {
                  in: [ExpenseStatus.DRAFT, ExpenseStatus.SUBMITTED, ExpenseStatus.REJECTED],
                },
              },
              orderBy: { createdAt: 'desc' },
            })
          : Promise.resolve([]),
        this.prisma.meeting.findFirst({
          where: { ...meetingWhere, start: { gte: new Date() } },
          include: { attendees: true },
          orderBy: { start: 'asc' },
        }),
      ]);

    return {
      nextMeeting: nextMeeting
        ? {
            id: nextMeeting.id,
            title: nextMeeting.title,
            start: nextMeeting.start.toISOString(),
            end: nextMeeting.end.toISOString(),
            location: nextMeeting.location,
            notes: nextMeeting.notes,
            link: nextMeeting.link ?? '',
            isOnline: nextMeeting.isOnline !== false,
            externalAttendees: nextMeeting.externalAttendees ?? [],
            attendeeIds: nextMeeting.attendees.map((a) => a.userId),
          }
        : null,
      meetingsToday: meetings.map((m) => ({
        id: m.id,
        title: m.title,
        start: m.start.toISOString(),
        end: m.end.toISOString(),
        location: m.location,
        notes: m.notes,
        link: m.link ?? '',
        isOnline: m.isOnline !== false,
        externalAttendees: m.externalAttendees ?? [],
        attendeeIds: m.attendees.map((a) => a.userId),
      })),
      dueToday: dueToday.map((t) => this.mapTask(t)),
      overdue: overdue.map((t) => this.mapTask(t)),
      pendingApprovals: pendingApprovals.map((e) => this.mapExpense(e)),
      myPendingExpenses: myPending.map((e) => this.mapExpense(e)),
    };
  }

  private mapTask(t: any) {
    const fromJoin: { id: string; name: string }[] = (t.assignees ?? []).map(
      (a: any) => ({
        id: a.userId ?? a.user?.id,
        name: a.user?.name ?? '',
      }),
    );
    const assigneeIds =
      fromJoin.length > 0
        ? [...new Set(fromJoin.map((a) => a.id).filter(Boolean))]
        : [t.assigneeId];
    const assigneeNames =
      fromJoin.length > 0
        ? assigneeIds.map((id) => fromJoin.find((a) => a.id === id)?.name ?? '')
        : [t.assignee?.name ?? ''];

    return {
      id: t.id,
      title: t.title,
      description: t.description,
      statusId: t.statusId,
      statusName: t.status.name,
      statusSlug: t.status.slug,
      statusColor: t.status.color,
      priorityId: t.priorityId,
      priorityName: t.priority.name,
      prioritySlug: t.priority.slug,
      priorityColor: t.priority.color,
      status: t.status.slug === 'in_progress' ? 'inProgress' : t.status.slug === 'in_review' ? 'inReview' : t.status.slug,
      priority: t.priority.slug,
      dueDate: t.dueDate?.toISOString() ?? null,
      assigneeId: t.assigneeId,
      assigneeName: t.assignee?.name ?? null,
      assigneeIds,
      assigneeNames,
      tags: t.tags,
      createdAt: t.createdAt.toISOString(),
      checklist: (t.checklist ?? []).map((c: any) => ({
        id: c.id,
        label: c.label,
        done: c.done,
      })),
      comments: [],
    };
  }

  private mapExpense(e: any) {
    return {
      id: e.id,
      amount: Number(e.amount),
      category: e.category.toLowerCase(),
      date: e.date.toISOString(),
      merchant: e.merchant,
      notes: e.notes,
      status: e.status.toLowerCase(),
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
