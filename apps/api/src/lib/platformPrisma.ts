/**
 * Owner-level Prisma client for the platform console (SaaS owner).
 *
 * The tenant application runs as the RLS-restricted role `alfannan_app` and can never see across
 * companies. The platform console needs exactly that (list companies, usage counts, support), so it
 * uses the owner connection (DIRECT_DATABASE_URL) which is not subject to Row-Level Security.
 * Only src/routes/platform.ts, src/middleware/platformAuth.ts and the admin CLI may import this.
 */
import { PrismaClient } from '@prisma/client';

export const platformPrisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL,
  log: ['error'],
});
