import { Injectable } from '@nestjs/common';
import { ExpenseStatus, TaskStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';

@Injectable()
export class TodayService {
  constructor(private readonly prisma: PrismaService) {}

  async get(user: AuthUser) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const taskWhere =
      user.role === UserRole.MANAGER
        ? { organizationId: user.organizationId }
        : { organizationId: user.organizationId, assigneeId: user.id };

    const meetingWhere =
      user.role === UserRole.MANAGER
        ? { organizationId: user.organizationId }
        : {
            organizationId: user.organizationId,
            attendees: { some: { userId: user.id } },
          };

    const [meetings, dueToday, overdue, pendingApprovals, myPending] =
      await Promise.all([
        this.prisma.meeting.findMany({
          where: {
            ...meetingWhere,
            start: { gte: start, lt: end },
          },
          include: { attendees: true },
          orderBy: { start: 'asc' },
        }),
        this.prisma.task.findMany({
          where: {
            ...taskWhere,
            dueDate: { gte: start, lt: end },
            status: { not: TaskStatus.DONE },
          },
          include: {
            checklist: true,
            comments: true,
          },
          orderBy: { dueDate: 'asc' },
        }),
        this.prisma.task.findMany({
          where: {
            ...taskWhere,
            dueDate: { lt: start },
            status: { not: TaskStatus.DONE },
          },
          include: {
            checklist: true,
            comments: true,
          },
          orderBy: { dueDate: 'asc' },
        }),
        user.role === UserRole.MANAGER
          ? this.prisma.expense.findMany({
              where: {
                organizationId: user.organizationId,
                status: ExpenseStatus.SUBMITTED,
              },
              orderBy: { createdAt: 'asc' },
            })
          : Promise.resolve([]),
        user.role === UserRole.MEMBER
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
      where: {
        ...meetingWhere,
        start: { gte: new Date() },
      },
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

  private mapTask(t: {
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
    const statusMap: Record<TaskStatus, string> = {
      TODO: 'todo',
      IN_PROGRESS: 'inProgress',
      IN_REVIEW: 'inReview',
      DONE: 'done',
    };
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      status: statusMap[t.status],
      priority: t.priority.toLowerCase(),
      dueDate: t.dueDate?.toISOString() ?? null,
      assigneeId: t.assigneeId,
      tags: t.tags,
      createdAt: t.createdAt.toISOString(),
      checklist: t.checklist,
      comments: t.comments.map((c) => ({
        id: c.id,
        authorId: c.authorId,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }

  private mapExpense(e: {
    id: string;
    amount: { toString(): string };
    category: string;
    date: Date;
    merchant: string;
    notes: string;
    status: ExpenseStatus;
    submitterId: string;
    receiptUrl: string | null;
    createdAt: Date;
    decidedAt: Date | null;
    decidedById: string | null;
    decisionNote: string;
    reimbursedAt: Date | null;
  }) {
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
