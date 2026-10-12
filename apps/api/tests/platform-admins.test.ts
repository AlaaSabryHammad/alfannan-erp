/**
 * Platform console administrators: roles (OWNER / SUPPORT), creation with a temporary password,
 * disabling, and what a SUPPORT admin may not do.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { app } from './helpers';
import { platformPrisma } from '../src/lib/platformPrisma';
import { _resetRateLimits } from '../src/middleware/rateLimit';
import { _resetThrottle } from '../src/lib/loginThrottle';

const stamp = Date.now();
const ownerEmail = `adm-owner-${stamp}@platform.test`;
const ownerPassword = 'Platform-owner-pass-1';
const supportEmail = `adm-support-${stamp}@platform.test`;
const companyEmail = `adm-co-${stamp}@company.test`;

let ownerToken: string;
let ownerId: number;
let supportId: number;
let supportToken: string;
let supportTemp: string;
let tenantId: number;
let companyUserId: number;

const as = (t: string) => ({ Authorization: `Bearer ${t}` });
const login = (email: string, password: string) => request(app).post('/api/platform/auth/login').send({ email, password });

beforeAll(async () => {
  _resetThrottle();
  _resetRateLimits();
  process.env.ALLOW_SIGNUP = 'true';
  const owner = await platformPrisma.platformAdmin.create({
    data: { name: 'مالك', email: ownerEmail, passwordHash: await bcrypt.hash(ownerPassword, 4) },
  });
  ownerId = owner.id;
  ownerToken = (await login(ownerEmail, ownerPassword)).body.token;

  const reg = await request(app).post('/api/auth/register-tenant').send({
    companyName: `شركة المديرين ${stamp}`, adminName: 'مدير', email: companyEmail, password: 'Company-pass-12345', acceptTerms: true,
  });
  expect(reg.status).toBe(201);
  companyUserId = reg.body.user.id;
  tenantId = (jwt.decode(reg.body.token) as { tenantId: number }).tenantId;
});

describe('administrators of the console', () => {
  it('an existing admin is an OWNER and the login says so', async () => {
    const res = await login(ownerEmail, ownerPassword);
    expect(res.body.admin.role).toBe('OWNER');
    expect(res.body.admin.mustChangePassword).toBe(false);
  });

  it('the owner creates a support admin with a temporary password', async () => {
    const res = await request(app).post('/api/platform/admins').set(as(ownerToken))
      .send({ name: 'موظف دعم', email: supportEmail, role: 'SUPPORT' });
    expect(res.status).toBe(201);
    expect(res.body.admin.role).toBe('SUPPORT');
    expect(res.body.admin.mustChangePassword).toBe(true);
    supportTemp = res.body.temporaryPassword;
    supportId = res.body.admin.id;
    expect(supportTemp.length).toBeGreaterThanOrEqual(12);

    const dup = await request(app).post('/api/platform/admins').set(as(ownerToken))
      .send({ name: 'مكرر', email: supportEmail, role: 'OWNER' });
    expect(dup.status).toBe(409);
  });

  it('the new admin signs in, is told to change the password, and does so', async () => {
    const first = await login(supportEmail, supportTemp);
    expect(first.status).toBe(200);
    expect(first.body.admin).toMatchObject({ role: 'SUPPORT', mustChangePassword: true });
    supportToken = first.body.token;

    const changed = await request(app).post('/api/platform/me/password').set(as(supportToken))
      .send({ currentPassword: supportTemp, newPassword: 'Support-new-pass-77' });
    expect(changed.status).toBe(200);
    supportToken = changed.body.token;
    const again = await login(supportEmail, 'Support-new-pass-77');
    expect(again.body.admin.mustChangePassword).toBe(false);
  });

  it('SUPPORT can read and help users, but not touch billing, plans, switches or admins', async () => {
    expect((await request(app).get('/api/platform/tenants').set(as(supportToken))).status).toBe(200);
    expect((await request(app).get('/api/platform/stats').set(as(supportToken))).status).toBe(200);

    const base = `/api/platform/tenants/${tenantId}`;
    expect((await request(app).post(`${base}/users/${companyUserId}/force-logout`).set(as(supportToken))).status).toBe(200);
    expect((await request(app).patch(base).set(as(supportToken)).send({ platformNote: 'ملاحظة من الدعم' })).status).toBe(200);

    const denied = [
      request(app).patch(base).set(as(supportToken)).send({ isActive: false }),
      request(app).patch(base).set(as(supportToken)).send({ name: 'اسم جديد', platformNote: 'x' }),
      request(app).post(`${base}/subscription/cancel`).set(as(supportToken)),
      request(app).post('/api/platform/plans').set(as(supportToken)).send({}),
      request(app).post('/api/platform/announcements').set(as(supportToken)).send({}),
      request(app).put('/api/platform/system/signup').set(as(supportToken)).send({ enabled: false }),
      request(app).post('/api/platform/lifecycle/run').set(as(supportToken)),
    ];
    for (const r of denied) expect((await r).status).toBe(403);

    expect((await request(app).get('/api/platform/admins').set(as(supportToken))).status).toBe(403);
    expect((await request(app).post('/api/platform/admins').set(as(supportToken))
      .send({ name: 'x y', email: 'x@y.test', role: 'OWNER' })).status).toBe(403);
  });

  it('protects the owner from locking themselves out', async () => {
    const self = await request(app).patch(`/api/platform/admins/${ownerId}`).set(as(ownerToken)).send({ isActive: false });
    expect(self.status).toBe(400);
    const demote = await request(app).patch(`/api/platform/admins/${ownerId}`).set(as(ownerToken)).send({ role: 'SUPPORT' });
    expect(demote.status).toBe(400);
  });

  it('disabling an admin ends their session at once', async () => {
    await new Promise((r) => setTimeout(r, 1100));
    const off = await request(app).patch(`/api/platform/admins/${supportId}`).set(as(ownerToken)).send({ isActive: false });
    expect(off.status).toBe(200);
    expect((await request(app).get('/api/platform/me').set(as(supportToken))).status).toBe(401);
    expect((await login(supportEmail, 'Support-new-pass-77')).status).toBe(401);
  });

  it('a promoted admin gets owner powers on the next request', async () => {
    await request(app).patch(`/api/platform/admins/${supportId}`).set(as(ownerToken)).send({ isActive: true, role: 'OWNER' });
    const token = (await login(supportEmail, 'Support-new-pass-77')).body.token;
    expect((await request(app).get('/api/platform/admins').set(as(token))).status).toBe(200);
    // and the first owner may demote them again
    const back = await request(app).patch(`/api/platform/admins/${supportId}`).set(as(ownerToken)).send({ role: 'SUPPORT' });
    expect(back.status).toBe(200);
  });

  it('reset password gives a new temporary one and flags the change', async () => {
    const res = await request(app).post(`/api/platform/admins/${supportId}/reset-password`).set(as(ownerToken));
    expect(res.status).toBe(200);
    const relog = await login(supportEmail, res.body.temporaryPassword);
    expect(relog.body.admin.mustChangePassword).toBe(true);
    const own = await request(app).post(`/api/platform/admins/${ownerId}/reset-password`).set(as(ownerToken));
    expect(own.status).toBe(400);
  });

  it('is audited', async () => {
    const log = await request(app).get('/api/platform/audit-log').set(as(ownerToken));
    const actions = (log.body as Array<{ action: string }>).map((r) => r.action);
    for (const a of ['ADMIN_CREATE', 'ADMIN_DEACTIVATE', 'ADMIN_ACTIVATE', 'ADMIN_ROLE_CHANGE', 'ADMIN_RESET_PASSWORD']) {
      expect(actions).toContain(a);
    }
  });
});
