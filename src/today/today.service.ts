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
      : { organizationId: user.organizationId, assigneeId: { in: scopedIds } };

    const meetingWhere = (user.isAdmin || user.permissions.includes('meeting.view_all'))
      ? { organizationId: user.organizationId }
      : {
          organizationId: user.organizationId,
          attendees: { some: { userId: { in: scopedIds } } },
        };

    const doneStatuses = await this.prisma.orgTaskStatus.findMany({
      where: { organizationId: user.organizationId, isDone: true },
    });
    const doneStatusIds = doneStatuses.map((s) => s.id);

    const [meetings, dueToday, overdue, pendingApprovals, myPending] =
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
          include: { checklist: true, comments: true, status: true, priority: true },
          orderBy: { dueDate: 'asc' },
        }),
        this.prisma.task.findMany({
          where: {
            ...taskWhere,
            dueDate: { lt: start },
            statusId: { notIn: doneStatusIds },
          },
          include: { checklist: true, comments: true, status: true, priority: true },
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
      ]);

    const nextMeeting = await this.prisma.meeting.findFirst({
      where: { ...meetingWhere, start: { gte: new Date() } },
      include: { attendees: true },
      orderBy: { start: 'asc' },
    });

    return {
      nextMeeting: nextMeeting
        ? {
            id: nextMeeting.id,
            title: nextMeeting.title,
            start: nextMeeting.start.toISOString(),
            end: nextMeeting.end.toISOString(),
            location: nextMeeting.location,
            notes: nextMeeting.notes,
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
        attendeeIds: m.attendees.map((a) => a.userId),
      })),
      dueToday: dueToday.map((t) => this.mapTask(t)),
      overdue: overdue.map((t) => this.mapTask(t)),
      pendingApprovals: pendingApprovals.map((e) => this.mapExpense(e)),
      myPendingExpenses: myPending.map((e) => this.mapExpense(e)),
    };
  }

  private mapTask(t: any) {
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
      tags: t.tags,
      createdAt: t.createdAt.toISOString(),
      checklist: t.checklist,
      comments: t.comments.map((c: any) => ({
        id: c.id,
        authorId: c.authorId,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
      })),
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
