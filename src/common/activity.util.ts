import { Logger } from '@nestjs/common';
import { ActivityType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const logger = new Logger('Activity');

/**
 * Best-effort activity write. Never fails the parent API after a successful
 * entity create/update — otherwise clients see an error while data is saved.
 */
export async function recordActivity(
  prisma: PrismaService,
  data: {
    organizationId: string;
    actorId: string;
    type: ActivityType;
    subject: string;
    targetId?: string | null;
    amount?: Prisma.Decimal | number | null;
  },
): Promise<void> {
  try {
    await prisma.activityEvent.create({
      data: {
        organizationId: data.organizationId,
        actorId: data.actorId,
        type: data.type,
        subject: data.subject,
        targetId: data.targetId ?? undefined,
        amount: data.amount ?? undefined,
      },
    });
  } catch (err) {
    logger.warn(
      `Failed to record ${data.type} for ${data.targetId ?? 'n/a'}: ${
        err instanceof Error ? err.message : err
      }`,
    );
  }
}
