import { defineConfig } from 'vitest/config';
import fs from 'fs';
import path from 'path';

// Derive the dedicated test database URLs from .env by swapping the database name — the suite
// must never touch the real dev data. DATABASE_URL is the Row-Level-Security application role;
// the owner connection (DIRECT_DATABASE_URL) is only used for migrations and setup.
function testDatabaseUrl(key: 'DATABASE_URL' | 'DIRECT_DATABASE_URL'): string {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  const match = envFile.match(new RegExp(`^${key}="([^"]+)"`, 'm'));
  if (!match) throw new Error(`${key} not found in apps/api/.env`);
  return match[1].replace(/\/([a-zA-Z0-9_]+)(\?|$)/, '/alfannan_test$2');
}

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: './tests/globalSetup.ts',
    // Integration tests share one database — run files sequentially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      // Fixture code that talks to prisma outside a request lands in the seeded tenant (id 1).
      TENANT_FALLBACK_ID: '1',
      // run the whole suite with plan limits really enforced
      SUBSCRIPTION_ENFORCEMENT: 'enforce',
      // online payments run against the in-memory fake gateway
      PAYMENTS_ENABLED: 'true',
      PAYMENTS_PROVIDER: 'fake',
      PUBLIC_BASE_URL: 'http://localhost:5173',
      MOYASAR_WEBHOOK_SECRET: 'whsec-test-0123456789',
      DATABASE_URL: testDatabaseUrl('DATABASE_URL'),
      DIRECT_DATABASE_URL: testDatabaseUrl('DIRECT_DATABASE_URL'),
    },
  },
});
