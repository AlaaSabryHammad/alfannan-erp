import { defineConfig } from 'vitest/config';
import fs from 'fs';
import path from 'path';

// Derive the dedicated test database URL from .env's DATABASE_URL by swapping
// the database name — the suite must never touch the real dev data.
function testDatabaseUrl(): string {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  const match = envFile.match(/DATABASE_URL="([^"]+)"/);
  if (!match) throw new Error('DATABASE_URL not found in apps/api/.env');
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
      DATABASE_URL: testDatabaseUrl(),
    },
  },
});
