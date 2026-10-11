/**
 * The platform owner changes their own password from the console.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { app } from './helpers';
import { platformPrisma } from '../src/lib/platformPrisma';
import { _resetRateLimits } from '../src/middleware/rateLimit';
import { _resetThrottle } from '../src/lib/loginThrottle';

const stamp = Date.now();
const email = `pwd-owner-${stamp}@platform.test`;
const original = 'Original-pass-12345';
const changed = 'Changed-pass-67890';

let token: string;
const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
const login = (password: string) => request(app).post('/api/platform/auth/login').send({ email, password });

beforeAll(async () => {
  _resetThrottle();
  _resetRateLimits();
  await platformPrisma.platformAdmin.create({
    data: { name: 'مالك', email, passwordHash: await bcrypt.hash(original, 4) },
  });
  token = (await login(original)).body.token;
});

describe('platform owner password change', () => {
  it('requires a session', async () => {
    const res = await request(app).post('/api/platform/me/password').send({ currentPassword: original, newPassword: changed });
    expect(res.status).toBe(401);
  });

  it('rejects a wrong current password, a weak new one and an unchanged one', async () => {
    const wrong = await request(app).post('/api/platform/me/password').set(auth())
      .send({ currentPassword: 'not-my-password', newPassword: changed });
    expect(wrong.status).toBe(400);

    const short = await request(app).post('/api/platform/me/password').set(auth())
      .send({ currentPassword: original, newPassword: 'Short1' });
    expect(short.status).toBe(400);

    const lettersOnly = await request(app).post('/api/platform/me/password').set(auth())
      .send({ currentPassword: original, newPassword: 'onlylettershere' });
    expect(lettersOnly.status).toBe(400);

    const same = await request(app).post('/api/platform/me/password').set(auth())
      .send({ currentPassword: original, newPassword: original });
    expect(same.status).toBe(400);

    // nothing changed
    expect((await login(original)).status).toBe(200);
  });

  it('changes the password, ends the other sessions and keeps the current one', async () => {
    const otherSession = (await login(original)).body.token as string;
    await new Promise((r) => setTimeout(r, 1100)); // tokens are second-granular

    const res = await request(app).post('/api/platform/me/password').set(auth())
      .send({ currentPassword: original, newPassword: changed });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();

    // the tokens that existed before are dead …
    expect((await request(app).get('/api/platform/me').set(auth(token))).status).toBe(401);
    expect((await request(app).get('/api/platform/me').set(auth(otherSession))).status).toBe(401);
    // … the fresh one works
    expect((await request(app).get('/api/platform/me').set(auth(res.body.token))).status).toBe(200);

    // the old password no longer logs in, the new one does
    expect((await login(original)).status).toBe(401);
    expect((await login(changed)).status).toBe(200);
  });

  it('is recorded in the platform audit log', async () => {
    const admin = await platformPrisma.platformAdmin.findUniqueOrThrow({ where: { email } });
    const entry = await platformPrisma.platformAuditLog.findFirst({
      where: { adminId: admin.id, action: 'PLATFORM_PASSWORD_CHANGE' },
    });
    expect(entry).not.toBeNull();
  });
});
