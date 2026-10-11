/**
 * Create (or reset the password of) a platform administrator — the SaaS owner console login.
 *
 *   node dist/createPlatformAdmin.js owner@example.com "اسم المالك"
 *   PLATFORM_ADMIN_PASSWORD=... node dist/createPlatformAdmin.js owner@example.com
 *
 * Without PLATFORM_ADMIN_PASSWORD a strong password is generated and printed once.
 */
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { platformPrisma as db } from './lib/platformPrisma';

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  const name = process.argv[3]?.trim() || 'مالك المنصة';
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error('usage: createPlatformAdmin <email> [name]');
  }
  const provided = process.env.PLATFORM_ADMIN_PASSWORD;
  if (provided && provided.length < 12) throw new Error('PLATFORM_ADMIN_PASSWORD must be at least 12 characters');
  const password = provided ?? crypto.randomBytes(15).toString('base64url');

  const passwordHash = await bcrypt.hash(password, 12);
  await db.platformAdmin.upsert({
    where: { email },
    update: { passwordHash, name, isActive: true },
    create: { email, name, passwordHash },
  });
  console.log(`platform admin ready: ${email}`);
  if (!provided) console.log(`password (shown once): ${password}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
