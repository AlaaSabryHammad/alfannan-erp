/**
 * Platform console: support actions on a company's users (disable, force logout, confirm e-mail),
 * internal notes and the last-login bookkeeping.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { app } from './helpers';
import { platformPrisma } from '../src/lib/platformPrisma';
import { outbox } from '../src/lib/mail/mailer';
import { _resetRateLimits } from '../src/middleware/rateLimit';
import { _resetThrottle } from '../src/lib/loginThrottle';

const stamp = Date.now();
const ownerEmail = `um-owner-${stamp}@platform.test`;
const ownerPassword = 'Platform-owner-pass-1';
const adminEmail = `um-admin-${stamp}@company.test`;
const adminPassword = 'Company-admin-pass-1';
const staffEmail = `um-staff-${stamp}@company.test`;

let platformToken: string;
let tenantId: number;
let adminToken: string;
let adminId: number;
let staffId: number;

const asPlatform = () => ({ Authorization: `Bearer ${platformToken}` });
const userUrl = (id: number, action: string) => `/api/platform/tenants/${tenantId}/users/${id}/${action}`;

beforeAll(async () => {
  _resetThrottle();
  _resetRateLimits();
  process.env.ALLOW_SIGNUP = 'true';
  process.env.MAIL_DRIVER = 'memory';
  await platformPrisma.platformAdmin.create({
    data: { name: 'مالك', email: ownerEmail, passwordHash: await bcrypt.hash(ownerPassword, 4) },
  });
  platformToken = (await request(app).post('/api/platform/auth/login').send({ email: ownerEmail, password: ownerPassword })).body.token;

  const reg = await request(app).post('/api/auth/register-tenant').send({
    companyName: `شركة الدعم ${stamp}`, adminName: 'مدير', email: adminEmail, password: adminPassword, acceptTerms: true,
  });
  expect(reg.status).toBe(201);
  adminToken = reg.body.token;
  adminId = reg.body.user.id;
  tenantId = (jwt.decode(adminToken) as { tenantId: number }).tenantId;

  const role = await platformPrisma.role.findFirstOrThrow({ where: { tenantId, code: { not: 'ADMIN' } } });
  const staff = await platformPrisma.user.create({
    data: { tenantId, name: 'موظف', email: staffEmail, passwordHash: await bcrypt.hash('Staff-pass-12345', 4), roleId: role.id },
  });
  staffId = staff.id;
});

afterAll(() => {
  delete process.env.ALLOW_SIGNUP;
  delete process.env.MAIL_DRIVER;
});

describe('support actions on company users', () => {
  it('needs the platform session', async () => {
    expect((await request(app).post(userUrl(staffId, 'active')).send({ isActive: false })).status).toBe(401);
  });

  it('records the last login and shows confirmation state in the detail', async () => {
    await request(app).post('/api/auth/login').send({ email: adminEmail, password: adminPassword }).expect(200);
    const detail = await request(app).get(`/api/platform/tenants/${tenantId}`).set(asPlatform());
    expect(detail.status).toBe(200);
    const admin = detail.body.users.find((u: { id: number }) => u.id === adminId);
    expect(admin.lastLoginAt).toBeTruthy();
    expect(admin.emailVerifiedAt).toBeNull();
  });

  it('disables a user: no more login, and the open session ends', async () => {
    const loginBefore = await request(app).post('/api/auth/login').send({ email: staffEmail, password: 'Staff-pass-12345' });
    expect(loginBefore.status).toBe(200);
    const staffToken = loginBefore.body.token as string;
    await new Promise((r) => setTimeout(r, 1100));

    const res = await request(app).post(userUrl(staffId, 'active')).set(asPlatform()).send({ isActive: false });
    expect(res.status).toBe(200);

    expect((await request(app).post('/api/auth/login').send({ email: staffEmail, password: 'Staff-pass-12345' })).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set({ Authorization: `Bearer ${staffToken}` })).status).toBe(401);

    const back = await request(app).post(userUrl(staffId, 'active')).set(asPlatform()).send({ isActive: true });
    expect(back.status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: staffEmail, password: 'Staff-pass-12345' })).status).toBe(200);
  });

  it('refuses to disable the last active admin', async () => {
    const res = await request(app).post(userUrl(adminId, 'active')).set(asPlatform()).send({ isActive: false });
    expect(res.status).toBe(400);
  });

  it('forces a logout', async () => {
    const token = (await request(app).post('/api/auth/login').send({ email: staffEmail, password: 'Staff-pass-12345' })).body.token as string;
    await new Promise((r) => setTimeout(r, 1100));
    expect((await request(app).get('/api/auth/me').set({ Authorization: `Bearer ${token}` })).status).toBe(200);
    expect((await request(app).post(userUrl(staffId, 'force-logout')).set(asPlatform())).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set({ Authorization: `Bearer ${token}` })).status).toBe(401);
  });

  it('resends the confirmation e-mail, then marks the address confirmed', async () => {
    outbox.length = 0;
    const resend = await request(app).post(userUrl(adminId, 'resend-verification')).set(asPlatform());
    expect(resend.status).toBe(200);
    expect(resend.body.sent).toBe(true);
    expect(outbox.at(-1)?.to).toBe(adminEmail);

    expect((await request(app).post(userUrl(adminId, 'verify-email')).set(asPlatform())).status).toBe(200);
    const me = await request(app).get('/api/auth/me').set({ Authorization: `Bearer ${adminToken}` });
    expect(me.body.emailVerified).toBe(true);

    const again = await request(app).post(userUrl(adminId, 'resend-verification')).set(asPlatform());
    expect(again.body.alreadyVerified).toBe(true);
  });

  it('404s for a user of another company', async () => {
    const other = await platformPrisma.user.findFirstOrThrow({ where: { tenantId: { not: tenantId } } });
    expect((await request(app).post(userUrl(other.id, 'force-logout')).set(asPlatform())).status).toBe(404);
  });

  it('stores an internal note and audits every action', async () => {
    const res = await request(app).patch(`/api/platform/tenants/${tenantId}`).set(asPlatform()).send({ platformNote: 'عميل مهم — متابعة أسبوعية' });
    expect(res.status).toBe(200);
    const detail = await request(app).get(`/api/platform/tenants/${tenantId}`).set(asPlatform());
    expect(detail.body.platformNote).toBe('عميل مهم — متابعة أسبوعية');

    const log = await request(app).get('/api/platform/audit-log').set(asPlatform());
    const actions = (log.body as Array<{ action: string; tenantId: number | null }>)
      .filter((r) => r.tenantId === tenantId)
      .map((r) => r.action);
    for (const a of ['USER_DEACTIVATE', 'USER_ACTIVATE', 'USER_FORCE_LOGOUT', 'USER_VERIFICATION_RESENT', 'USER_EMAIL_VERIFIED', 'TENANT_NOTE']) {
      expect(actions).toContain(a);
    }
  });

  it('exposes the unverified-admins counter', async () => {
    const stats = await request(app).get('/api/platform/stats').set(asPlatform());
    expect(typeof stats.body.unverifiedAdmins).toBe('number');
  });
});
