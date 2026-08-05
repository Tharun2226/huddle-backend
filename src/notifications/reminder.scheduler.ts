import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';

/**
 * Periodic FCM reminders:
 * - Meetings: ~30 minutes before start (attendees)
 * - Tasks: once on due day + once if overdue and never reminded
 */
@Injectable()
export class ReminderScheduler {
  private readonly logger = new Logger(ReminderScheduler.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    // Vercel serverless has no persistent process — use /api/internal/cron/reminders.
    if (process.env.VERCEL) return;
    await this.runReminders();
  }

  /** Exposed for manual test triggers (POST /notifications/run-reminders). */
  async runReminders() {
    if (this.running) return { ok: false, reason: 'already_running' as const };
    this.running = true;
    try {
      await Promise.all([this.sendMeetingReminders(), this.sendTaskDueReminders()]);
      return { ok: true as const };
    } catch (err) {
      this.logger.warn(
        `Reminder tick failed: ${err instanceof Error ? err.message : err}`,
      );
      return { ok: false, reason: 'error' as const };
    } finally {
      this.running = false;
    }
  }

  /** Meetings starting in ~lead±2 minutes that have not been reminded yet. */
  private async sendMeetingReminders() {
    const leadMin = Number(process.env.REMINDER_MEETING_LEAD_MINUTES || 30);
    const lead = Number.isFinite(leadMin) && leadMin > 0 ? leadMin : 30;
    const now = Date.now();
    const windowStart = new Date(now + (lead - 2) * 60 * 1000);
    const windowEnd = new Date(now + (lead + 2) * 60 * 1000);

    const meetings = await this.prisma.meeting.findMany({
      where: {
        reminderSentAt: null,
        start: { gte: windowStart, lte: windowEnd },
      },
      include: { attendees: true },
      take: 100,
    });

    for (const meeting of meetings) {
      const claimed = await this.prisma.meeting.updateMany({
        where: { id: meeting.id, reminderSentAt: null },
        data: { reminderSentAt: new Date() },
      });
      if (claimed.count === 0) continue;

      const recipientIds = meeting.attendees.map((a) => a.userId);
      if (recipientIds.length === 0) continue;

      const startsIn = Math.max(
        1,
        Math.round((meeting.start.getTime() - Date.now()) / 60000),
      );
      const when = meeting.start.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });

      await this.notifications.notifyUsers(recipientIds, {
        organizationId: meeting.organizationId,
        title: lead === 30 ? 'Meeting in 30 minutes' : `Meeting in ${lead} minutes`,
        body: `${meeting.title} starts at ${when} (~${startsIn} min).`,
        type: NotificationType.REMINDER,
        referenceId: meeting.id,
        data: { referenceKind: 'meeting' },
      });

      this.logger.log(
        `Meeting reminder sent for ${meeting.id} to ${recipientIds.length} user(s)`,
      );
    }
  }

  /**
   * Incomplete tasks due today (once) or overdue with no prior due reminder (once).
   */
  private async sendTaskDueReminders() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);

    const doneStatuses = await this.prisma.orgTaskStatus.findMany({
      where: { isDone: true },
      select: { id: true },
    });
    const doneIds = doneStatuses.map((s) => s.id);

    const dueToday = await this.prisma.task.findMany({
      where: {
        dueReminderSentAt: null,
        dueDate: { gte: startOfToday, lt: endOfToday },
        ...(doneIds.length ? { statusId: { notIn: doneIds } } : {}),
      },
      include: { assignees: true },
      take: 200,
    });

    const overdue = await this.prisma.task.findMany({
      where: {
        dueReminderSentAt: null,
        dueDate: { lt: startOfToday, not: null },
        ...(doneIds.length ? { statusId: { notIn: doneIds } } : {}),
      },
      include: { assignees: true },
      take: 200,
    });

    for (const task of dueToday) {
      await this.dispatchTaskReminder(task, false);
    }
    for (const task of overdue) {
      await this.dispatchTaskReminder(task, true);
    }
  }

  private async dispatchTaskReminder(
    task: {
      id: string;
      title: string;
      organizationId: string;
      assigneeId: string;
      assignees: { userId: string }[];
    },
    overdue: boolean,
  ) {
    const claimed = await this.prisma.task.updateMany({
      where: { id: task.id, dueReminderSentAt: null },
      data: { dueReminderSentAt: new Date() },
    });
    if (claimed.count === 0) return;

    const recipientIds = [
      task.assigneeId,
      ...task.assignees.map((a) => a.userId),
    ];

    await this.notifications.notifyUsers(recipientIds, {
      organizationId: task.organizationId,
      title: overdue ? 'Task overdue' : 'Task due today',
      body: overdue
        ? `${task.title} is past its due date.`
        : `${task.title} is due today.`,
      type: NotificationType.REMINDER,
      referenceId: task.id,
      data: { referenceKind: 'task' },
    });

    this.logger.log(
      `Task ${overdue ? 'overdue' : 'due'} reminder sent for ${task.id}`,
    );
  }
}
