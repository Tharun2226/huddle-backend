/** Shared Prisma interactive-transaction options for serverless latency. */
export const PRISMA_TX = {
  maxWait: 15_000,
  timeout: 60_000,
} as const;
