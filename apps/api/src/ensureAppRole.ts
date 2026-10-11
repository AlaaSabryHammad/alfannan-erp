/**
 * Gives the RLS application role (created by the 20261011200000 migration) its login password.
 * Runs on boot after `prisma migrate deploy` (see deploy/api.Dockerfile). Idempotent.
 *
 *   DIRECT_DATABASE_URL  — owner/superuser connection used to alter the role
 *   APP_DB_PASSWORD      — password for alfannan_app (must match DATABASE_URL)
 */
import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  const password = process.env.APP_DB_PASSWORD;
  const url = process.env.DIRECT_DATABASE_URL;
  if (!password || !url) {
    console.log('ensureAppRole: APP_DB_PASSWORD / DIRECT_DATABASE_URL not set — skipped');
    return;
  }
  if (!/^[A-Za-z0-9_-]{16,}$/.test(password)) {
    throw new Error('APP_DB_PASSWORD must be at least 16 characters of [A-Za-z0-9_-]');
  }
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    await db.$executeRawUnsafe(`ALTER ROLE alfannan_app WITH LOGIN PASSWORD '${password}'`);
    console.log('ensureAppRole: alfannan_app is ready');
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error('ensureAppRole failed:', err);
  process.exit(1);
});
