import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { getScopedUserIds } from '../common/team-scope';

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser) {
    if (!user.isAdmin && !user.permissions.includes('activity.view')) {
      throw new ForbiddenException('Insufficient permissions');
    }
    const scopedIds = await getScopedUserIds(this.prisma, user);
    const events = await this.prisma.activityEvent.findMany({
      where: {
        organizationId: user.organizationId,
        ...(user.isAdmin ? {} : { actorId: { in: scopedIds } }),
      },
      orderBy: { at: 'desc' },
      take: 100,
    });
    return events.map((e) => ({
      id: e.id,
      actorId: e.actorId,
      type: this.mapType(e.type),
      subject: e.subject,
      amount: e.amount != null ? Number(e.amount) : null,
      targetId: e.targetId,
      at: e.at.toISOString(),
    }));
  }

  private mapType(type: string) {
    const map: Record<string, string> = {
      TASK_CREATED: 'taskCreated',
      TASK_COMPLETED: 'taskCompleted',
      TASK_MOVED: 'taskMoved',
      TASK_COMMENTED: 'taskCommented',
      EXPENSE_SUBMITTED: 'expenseSubmitted',
      EXPENSE_APPROVED: 'expenseApproved',
      EXPENSE_REJECTED: 'expenseRejected',
      EXPENSE_REIMBURSED: 'expenseReimbursed',
      MEETING_SCHEDULED: 'meetingScheduled',
    };
    return map[type] ?? type;
  }
}
