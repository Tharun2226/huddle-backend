import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** Keep serverless instances from opening many Postgres connections. */
function datasourceUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  if (/[?&]connection_limit=/.test(raw)) return raw;
  const sep = raw.includes('?') ? '&' : '?';
  // Vercel: 1 connection per isolate. Always-on hosts can raise this via env.
  const limit = process.env.VERCEL ? '1' : process.env.PRISMA_CONNECTION_LIMIT ?? '5';
  return `${raw}${sep}connection_limit=${limit}`;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      datasources: {
        db: { url: datasourceUrl() },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
