import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { DeviceService } from './device.service';
import { getMessaging } from './firebase-admin';

export type NotifyUserInput = {
  userId: string;
  organizationId: string;
  title: string;
  body: string;
  type: NotificationType;
  referenceId?: string | null;
  /** Extra FCM data keys (e.g. referenceKind=meeting|task). */
  data?: Record<string, string>;
};

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

const TRANSIENT_CODES = new Set([
  'messaging/internal-error',
  'messaging/server-unavailable',
  'messaging/unknown-error',
]);

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DeviceService,
  ) {}

  /**
   * Persist notification + push FCM. Never throws to callers (best-effort).
   */
  async notifyUser(input: NotifyUserInput): Promise<void> {
    try {
      const referenceKind = input.data?.referenceKind;
      const row = await this.prisma.appNotification.create({
        data: {
          userId: input.userId,
          organizationId: input.organizationId,
          title: input.title,
          body: input.body,
          type: input.type,
          referenceId: input.referenceId ?? undefined,
          referenceKind: referenceKind || undefined,
        },
      });

      const tokens = await this.devices.tokensForUser(input.userId);
      if (tokens.length === 0) {
        this.logger.debug(`No devices for user ${input.userId}`);
        return;
      }

      await this.sendToTokens(tokens, {
        title: input.title,
        body: input.body,
        data: {
          type: input.type,
          referenceId: input.referenceId ?? '',
          notificationId: row.id,
          referenceKind: referenceKind ?? '',
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          ...(input.data ?? {}),
        },
      });
    } catch (err) {
      this.logger.warn(
        `notifyUser failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async notifyUsers(
    userIds: string[],
    base: Omit<NotifyUserInput, 'userId'>,
  ): Promise<void> {
    const unique = [...new Set(userIds.filter(Boolean))];
    await Promise.all(
      unique.map((userId) =>
        this.notifyUser({
          ...base,
          userId,
        }),
      ),
    );
  }

  async sendTopic(
    topic: string,
    payload: { title: string; body: string; data?: Record<string, string> },
  ): Promise<void> {
    const messaging = getMessaging();
    if (!messaging) return;
    try {
      await messaging.send({
        topic,
        notification: { title: payload.title, body: payload.body },
        data: payload.data,
        android: { priority: 'high' },
      });
    } catch (err) {
      this.logger.warn(
        `Topic send failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async listForUser(user: AuthUser) {
    const [items, unreadCount] = await Promise.all([
      this.prisma.appNotification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.appNotification.count({
        where: { userId: user.id, isRead: false },
      }),
    ]);

    return {
      unreadCount,
      items: items.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        type: n.type,
        referenceId: n.referenceId,
        referenceKind: n.referenceKind,
        isRead: n.isRead,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  }

  async markRead(user: AuthUser, id: string) {
    const row = await this.prisma.appNotification.findUnique({ where: { id } });
    if (!row || row.userId !== user.id) {
      throw new NotFoundException('Notification not found');
    }
    const updated = await this.prisma.appNotification.update({
      where: { id },
      data: { isRead: true },
    });
    return {
      id: updated.id,
      isRead: updated.isRead,
    };
  }

  async remove(user: AuthUser, id: string) {
    const row = await this.prisma.appNotification.findUnique({ where: { id } });
    if (!row || row.userId !== user.id) {
      throw new NotFoundException('Notification not found');
    }
    if (row.organizationId !== user.organizationId && !user.isSuperAdmin) {
      throw new ForbiddenException();
    }
    await this.prisma.appNotification.delete({ where: { id } });
    return { ok: true, id };
  }

  /** Delete every notification for the current user. */
  async clearAll(user: AuthUser) {
    const result = await this.prisma.appNotification.deleteMany({
      where: { userId: user.id },
    });
    return { ok: true, deleted: result.count };
  }

  private async sendToTokens(
    tokens: string[],
    payload: {
      title: string;
      body: string;
      data: Record<string, string>;
    },
  ): Promise<void> {
    const messaging = getMessaging();
    if (!messaging) return;

    const chunkSize = 500;
    for (let i = 0; i < tokens.length; i += chunkSize) {
      const chunk = tokens.slice(i, i + chunkSize);
      await this.sendChunkWithRetry(messaging, chunk, payload, 2);
    }
  }

  private async sendChunkWithRetry(
    messaging: NonNullable<ReturnType<typeof getMessaging>>,
    tokens: string[],
    payload: {
      title: string;
      body: string;
      data: Record<string, string>;
    },
    retriesLeft: number,
  ): Promise<void> {
    try {
      const result = await messaging.sendEachForMulticast({
        tokens,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data,
        android: {
          priority: 'high',
          notification: {
            channelId: 'huddle_default',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
      });

      const dead: string[] = [];
      const retryTokens: string[] = [];

      result.responses.forEach((res, idx) => {
        if (res.success) return;
        const code = res.error?.code ?? '';
        if (INVALID_TOKEN_CODES.has(code)) {
          dead.push(tokens[idx]);
        } else if (TRANSIENT_CODES.has(code) && retriesLeft > 0) {
          retryTokens.push(tokens[idx]);
        } else {
          this.logger.warn(
            `FCM send error for token[${idx}]: ${code} ${res.error?.message}`,
          );
        }
      });

      await Promise.all(dead.map((t) => this.devices.removeToken(t)));

      if (retryTokens.length > 0 && retriesLeft > 0) {
        await new Promise((r) => setTimeout(r, 400));
        await this.sendChunkWithRetry(
          messaging,
          retryTokens,
          payload,
          retriesLeft - 1,
        );
      }
    } catch (err) {
      if (retriesLeft > 0) {
        await new Promise((r) => setTimeout(r, 500));
        return this.sendChunkWithRetry(
          messaging,
          tokens,
          payload,
          retriesLeft - 1,
        );
      }
      this.logger.warn(
        `FCM multicast failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
