/**
 * Global setup — runs once before the suite.
 * Resets the dedicated alfannan_test database (drops + reapplies every
 * migration) and seeds it, so each run starts from a known-good state.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export default function setup() {
  const root = path.join(__dirname, '..');
  const envFile = fs.readFileSync(path.join(root, '.env'), 'utf8');
  const match = envFile.match(/DATABASE_URL="([^"]+)"/);
  if (!match) throw new Error('DATABASE_URL not found in apps/api/.env');
  const testUrl = match[1].replace(/\/([a-zA-Z0-9_]+)(\?|$)/, '/alfannan_test$2');

  const env = { ...process.env, DATABASE_URL: testUrl, NODE_ENV: 'test' };

  console.log('⏳ resetting alfannan_test database…');
  execSync('npx prisma migrate reset --force --skip-generate --skip-seed', {
    cwd: root, env, stdio: 'inherit',
  });
  console.log('⏳ seeding alfannan_test…');
  execSync('npx tsx prisma/seed.ts', { cwd: root, env, stdio: 'inherit' });
  console.log('✅ test database ready');
}
