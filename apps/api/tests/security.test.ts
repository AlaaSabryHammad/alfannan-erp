/**
 * التحصين الأمني: قفل الحساب بعد تكرار الفشل، وتغيير كلمة المرور.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { app, prisma } from './helpers';
import { _resetThrottle } from '../src/lib/loginThrottle';

const login = (email: string, password: string) =>
  request(app).post('/api/auth/login').send({ email, password });

describe('login throttle', () => {
  beforeEach(() => _resetThrottle());

  it('locks an account for repeated failures, then reports 429', async () => {
    const email = 'throttle-victim@example.com'; // never a real account

    // 5 failed attempts return 401 (invalid credentials)
    for (let i = 0; i < 5; i++) {
      const res = await login(email, 'wrong');
      expect(res.status).toBe(401);
    }
    // the 6th is locked out
    const locked = await login(email, 'wrong');
    expect(locked.status).toBe(429);
    expect(locked.body.error).toContain('إيقاف محاولات الدخول');
  });

  it('a correct password before the threshold still succeeds and clears the counter', async () => {
    // a few failures for admin, then a correct login clears them
    await login('admin@store.com', 'wrong');
    await login('admin@store.com', 'wrong');
    const ok = await login('admin@store.com', '123456');
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
    // counter cleared → further wrong attempts start fresh (still 401, not locked)
    const after = await login('admin@store.com', 'wrong');
    expect(after.status).toBe(401);
  });
});

describe('change password', () => {
  beforeEach(() => _resetThrottle());

  it('changes a user password with policy checks and old password stops working', async () => {
    const role = await prisma.role.findFirstOrThrow();
    const email = `pw-test-${Date.now()}@example.com`;
    const user = await prisma.user.create({
      data: { name: 'اختبار كلمة المرور', email, passwordHash: await bcrypt.hash('oldpass1', 10), roleId: role.id },
    });

    const token = (await login(email, 'oldpass1')).body.token as string;
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

    // wrong current password rejected
    const wrong = await auth(request(app).post('/api/auth/change-password'))
      .send({ currentPassword: 'nope', newPassword: 'newpass1' });
    expect(wrong.status).toBe(400);

    // too-short new password rejected by schema
    const short = await auth(request(app).post('/api/auth/change-password'))
      .send({ currentPassword: 'oldpass1', newPassword: '123' });
    expect(short.status).toBe(400);

    // same-as-current rejected
    const same = await auth(request(app).post('/api/auth/change-password'))
      .send({ currentPassword: 'oldpass1', newPassword: 'oldpass1' });
    expect(same.status).toBe(400);

    // valid change succeeds
    const ok = await auth(request(app).post('/api/auth/change-password'))
      .send({ currentPassword: 'oldpass1', newPassword: 'newpass1' });
    expect(ok.status).toBe(200);

    // old password no longer works, new one does
    expect((await login(email, 'oldpass1')).status).toBe(401);
    expect((await login(email, 'newpass1')).status).toBe(200);

    await prisma.user.delete({ where: { id: user.id } });
  });
});
