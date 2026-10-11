/**
 * Platform console (SaaS owner): separate login, cross-company visibility, suspension, support actions.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { app } from './helpers';
import { platformPrisma } from '../src/lib/platformPrisma';
import { _resetThrottle } from '../src/lib/loginThrottle';

const stamp = Date.now();
const ownerEmail = `owner-${stamp}@platform.test`;
const ownerPassword = 'Platform-owner-pass-1';
const companyEmail = `ceo-${stamp}@company-x.test`;
const companyPassword = 'Company-x-pass-1';

let platformToken: string;
let tenantXId: number;
let tenantXToken: string;
let tenantXAdminId: number;

const asPlatform = () => ({ Authorization: `Bearer ${platformToken}` });

beforeAll(async () => {
  _resetThrottle();
  process.env.ALLOW_SIGNUP = 'true';
  await platformPrisma.platformAdmin.create({
    data: { name: 'مالك المنصة', email: ownerEmail, passwordHash: await bcrypt.hash(ownerPassword, 4) },
  });

  const reg = await request(app).post('/api/auth/register-tenant').send({
    companyName: `شركة إكس ${stamp}`,
    adminName: 'مدير إكس',
    email: companyEmail,
    password: companyPassword,
  });
  expect(reg.status).toBe(201);
  tenantXToken = reg.body.token;
  tenantXAdminId = reg.body.user.id;
  tenantXId = (jwt.decode(tenantXToken) as { tenantId: number }).tenantId;
});

afterAll(() => {
  delete process.env.ALLOW_SIGNUP;
});

describe('platform console', () => {
  it('rejects bad credentials and unauthenticated calls', async () => {
    const bad = await request(app).post('/api/platform/auth/login').send({ email: ownerEmail, password: 'nope' });
    expect(bad.status).toBe(401);
    expect((await request(app).get('/api/platform/stats')).status).toBe(401);
  });

  it('logs the platform owner in', async () => {
    const res = await request(app).post('/api/platform/auth/login').send({ email: ownerEmail, password: ownerPassword });
    expect(res.status).toBe(200);
    expect(res.body.admin.email).toBe(ownerEmail);
    platformToken = res.body.token;

    const me = await request(app).get('/api/platform/me').set(asPlatform());
    expect(me.status).toBe(200);
  });

  it('keeps tenant sessions and platform sessions apart', async () => {
    // a company admin cannot reach the platform API …
    const asTenant = await request(app).get('/api/platform/tenants').set('Authorization', `Bearer ${tenantXToken}`);
    expect(asTenant.status).toBe(401);
    // … and a platform token is not a tenant session
    const asOwner = await request(app).get('/api/products').set(asPlatform());
    expect(asOwner.status).toBe(401);
  });

  it('shows platform-wide stats', async () => {
    const res = await request(app).get('/api/platform/stats').set(asPlatform());
    expect(res.status).toBe(200);
    expect(res.body.tenants.total).toBeGreaterThanOrEqual(2);
    expect(res.body.tenants.active).toBeGreaterThanOrEqual(2);
    expect(res.body.tenants.newLast7Days).toBeGreaterThanOrEqual(1);
    expect(res.body.signupsByDay).toHaveLength(30);
    expect(res.body.users).toBeGreaterThan(5);
  });

  it('lists companies with their usage, across tenants', async () => {
    const res = await request(app).get('/api/platform/tenants').set(asPlatform());
    expect(res.status).toBe(200);
    const list = res.body as Array<{ id: number; name: string; usage: { products: number; salesInvoices: number; users: number } }>;

    const demo = list.find((t) => t.id === 1)!;
    expect(demo.usage.products).toBeGreaterThan(0);
    expect(demo.usage.salesInvoices).toBeGreaterThan(0);

    const x = list.find((t) => t.id === tenantXId)!;
    expect(x.usage.users).toBe(1);
    expect(x.usage.products).toBe(0);

    const filtered = await request(app).get(`/api/platform/tenants?search=${stamp}`).set(asPlatform());
    expect((filtered.body as unknown[]).length).toBe(1);
  });

  it('shows a company with its users', async () => {
    const res = await request(app).get(`/api/platform/tenants/${tenantXId}`).set(asPlatform());
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0].email).toBe(companyEmail);
    expect(res.body.users[0].role.code).toBe('ADMIN');
    expect(res.body.users[0].passwordHash).toBeUndefined();

    expect((await request(app).get('/api/platform/tenants/999999').set(asPlatform())).status).toBe(404);
  });

  it('suspends a company immediately and reactivates it', async () => {
    // works before
    expect((await request(app).get('/api/products').set('Authorization', `Bearer ${tenantXToken}`)).status).toBe(200);

    const off = await request(app).patch(`/api/platform/tenants/${tenantXId}`).set(asPlatform()).send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.isActive).toBe(false);

    // the already-issued token stops working right away, and a fresh login is refused
    expect((await request(app).get('/api/products').set('Authorization', `Bearer ${tenantXToken}`)).status).toBe(403);
    const login = await request(app).post('/api/auth/login').send({ email: companyEmail, password: companyPassword });
    expect(login.status).toBe(401);

    const on = await request(app).patch(`/api/platform/tenants/${tenantXId}`).set(asPlatform()).send({ isActive: true });
    expect(on.body.isActive).toBe(true);
    expect((await request(app).get('/api/products').set('Authorization', `Bearer ${tenantXToken}`)).status).toBe(200);
  });

  it('resets a user password for support, once', async () => {
    const res = await request(app)
      .post(`/api/platform/tenants/${tenantXId}/users/${tenantXAdminId}/reset-password`)
      .set(asPlatform());
    expect(res.status).toBe(200);
    expect(res.body.temporaryPassword.length).toBeGreaterThanOrEqual(10);

    const oldLogin = await request(app).post('/api/auth/login').send({ email: companyEmail, password: companyPassword });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: companyEmail, password: res.body.temporaryPassword });
    expect(newLogin.status).toBe(200);

    // a user id from another company is refused
    const wrong = await request(app).post(`/api/platform/tenants/${tenantXId}/users/1/reset-password`).set(asPlatform());
    expect(wrong.status).toBe(404);
  });

  it('records the support actions in the platform audit log', async () => {
    const res = await request(app).get('/api/platform/audit-log').set(asPlatform());
    expect(res.status).toBe(200);
    const actions = (res.body as Array<{ action: string; tenantId: number | null }>)
      .filter((r) => r.tenantId === tenantXId || r.action === 'LOGIN')
      .map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['LOGIN', 'TENANT_SUSPEND', 'TENANT_ACTIVATE', 'USER_PASSWORD_RESET']));
  });

  it('the tenant application role cannot read platform tables', async () => {
    const { basePrisma } = await import('../src/lib/prisma');
    await expect(basePrisma.$queryRawUnsafe('SELECT * FROM "PlatformAdmin"')).rejects.toThrow(/permission denied/i);
  });
});
