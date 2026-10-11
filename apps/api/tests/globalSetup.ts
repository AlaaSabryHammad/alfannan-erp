/**
 * Global setup — runs once before the suite.
 * Resets the dedicated alfannan_test database (drops + reapplies every migration as the owner),
 * makes sure the Row-Level-Security application role can log in, and seeds the database.
 * The tests themselves then run as that role, so RLS is really enforced.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

function readEnv(root: string, key: string): string {
  const envFile = fs.readFileSync(path.join(root, '.env'), 'utf8');
  const match = envFile.match(new RegExp(`^${key}="([^"]+)"`, 'm'));
  if (!match) throw new Error(`${key} not found in apps/api/.env (the app role and the owner connection are both required)`);
  return match[1];
}

const toTestDb = (url: string) => url.replace(/\/([a-zA-Z0-9_]+)(\?|$)/, '/alfannan_test$2');

export default async function setup() {
  const root = path.join(__dirname, '..');
  const appUrl = toTestDb(readEnv(root, 'DATABASE_URL'));
  const ownerUrl = toTestDb(readEnv(root, 'DIRECT_DATABASE_URL'));

  const appCreds = new URL(appUrl);
  const appUser = decodeURIComponent(appCreds.username);
  const appPassword = decodeURIComponent(appCreds.password);
  if (appUser !== 'alfannan_app') {
    throw new Error('DATABASE_URL in apps/api/.env must use the alfannan_app role (Row-Level Security)');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(appPassword)) throw new Error('alfannan_app password must match [A-Za-z0-9_-]+');

  // Roles are cluster-wide: create the app role before the database is (re)created.
  const maintenanceUrl = ownerUrl.replace(/\/alfannan_test(\?|$)/, '/postgres$1');
  const admin = new PrismaClient({ datasourceUrl: maintenanceUrl });
  try {
    await admin.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alfannan_app') THEN
          CREATE ROLE alfannan_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${appPassword}';
        ELSE
          ALTER ROLE alfannan_app WITH LOGIN PASSWORD '${appPassword}';
        END IF;
      END $$;`);
  } finally {
    await admin.$disconnect();
  }

  const migrateEnv = { ...process.env, DATABASE_URL: ownerUrl, DIRECT_DATABASE_URL: ownerUrl, NODE_ENV: 'test' };
  console.log('⏳ resetting alfannan_test database…');
  execSync('npx prisma migrate reset --force --skip-generate --skip-seed', {
    cwd: root, env: migrateEnv, stdio: 'inherit',
  });

  console.log('⏳ seeding alfannan_test (as the RLS application role)…');
  execSync('npx tsx prisma/seed.ts', {
    cwd: root,
    env: { ...process.env, DATABASE_URL: appUrl, DIRECT_DATABASE_URL: ownerUrl, NODE_ENV: 'test' },
    stdio: 'inherit',
  });
  console.log('✅ test database ready');
}
