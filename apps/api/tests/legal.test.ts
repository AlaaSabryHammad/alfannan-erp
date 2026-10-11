/**
 * Terms of Service / Privacy Policy acceptance: required at registration, recorded as evidence,
 * and requested from companies that never accepted (or accepted an older version).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { app } from './helpers';
import { platformPrisma } from '../src/lib/platformPrisma';
import { invalidateEntitlements } from '../src/lib/entitlements';
import { LEGAL_VERSION } from '../src/lib/legal';
import { _resetRateLimits } from '../src/middleware/rateLimit';
import { _resetThrottle } from '../src/lib/loginThrottle';

const stamp = Date.now();
const email = `legal-${stamp}@terms.test`;
const base = { companyName: `شركة الشروط ${stamp}`, adminName: 'مدير', email, password: 'Legal-pass-12345' };
let token: string;
let tenantId: number;

const auth = () => ({ Authorization: `Bearer ${token}` });
const register = (body: object) => request(app).post('/api/auth/register-tenant').send(body);

beforeAll(() => {
  _resetThrottle();
  _resetRateLimits();
  process.env.ALLOW_SIGNUP = 'true';
  process.env.SUBSCRIPTION_ENFORCEMENT = 'enforce';
});
afterAll(() => {
  delete process.env.ALLOW_SIGNUP;
});

describe('registration', () => {
  it('refuses a company that has not accepted the terms', async () => {
    const missing = await register(base);
    expect(missing.status).toBe(400);
    const no = await register({ ...base, acceptTerms: false });
    expect(no.status).toBe(400);
    const text = await register({ ...base, acceptTerms: 'true' });
    expect(text.status).toBe(400);
    // nothing was created
    expect(await platformPrisma.user.count({ where: { email } })).toBe(0);
  });

  it('records who accepted which version, when and from where', async () => {
    const res = await register({ ...base, acceptTerms: true });
    expect(res.status).toBe(201);
    token = res.body.token;
    tenantId = (jwt.decode(token) as { tenantId: number }).tenantId;

    const tenant = await platformPrisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant.termsVersion).toBe(LEGAL_VERSION);
    expect(tenant.termsAcceptedBy).toBe(email);
    expect(tenant.termsAcceptedAt).toBeInstanceOf(Date);
    expect(Date.now() - tenant.termsAcceptedAt!.getTime()).toBeLessThan(60_000);
    expect(tenant.termsAcceptedIp).toBeTruthy();
  });

  it('publishes the current version on the public config', async () => {
    const res = await request(app).get('/api/auth/config');
    expect(res.body.legalVersion).toBe(LEGAL_VERSION);
  });
});

describe('asking existing companies', () => {
  it('a new company is up to date', async () => {
    const res = await request(app).get('/api/legal/status').set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ currentVersion: LEGAL_VERSION, acceptedVersion: LEGAL_VERSION, upToDate: true });
  });

  it('a company that predates the terms (or an older version) is asked, then recorded on accept', async () => {
    await platformPrisma.tenant.update({
      where: { id: tenantId },
      data: { termsVersion: '2020-01-01', termsAcceptedAt: null, termsAcceptedBy: null },
    });
    const before = await request(app).get('/api/legal/status').set(auth());
    expect(before.body.upToDate).toBe(false);
    expect(before.body.acceptedVersion).toBe('2020-01-01');

    const accept = await request(app).post('/api/legal/accept').set(auth());
    expect(accept.status).toBe(200);
    expect(accept.body.upToDate).toBe(true);

    const after = await request(app).get('/api/legal/status').set(auth());
    expect(after.body).toMatchObject({ acceptedVersion: LEGAL_VERSION, acceptedBy: email, upToDate: true });
  });

  it('only a user who may edit settings can accept for the company', async () => {
    const roles = await request(app).get('/api/roles').set(auth());
    const cashier = (roles.body as Array<{ id: number; code: string }>).find((r) => r.code === 'CASHIER')!;
    const created = await request(app).post('/api/users').set(auth()).send({
      name: 'كاشير', email: `cashier-${stamp}@terms.test`, password: 'Cashier-pass-12', roleId: cashier.id,
    });
    expect(created.status).toBe(201);
    const login = await request(app).post('/api/auth/login').send({ email: `cashier-${stamp}@terms.test`, password: 'Cashier-pass-12' });
    const res = await request(app).post('/api/legal/accept').set('Authorization', `Bearer ${login.body.token}`);
    expect(res.status).toBe(403);
  });

  it('acceptance is per company', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'admin@store.com', password: '123456' });
    const other = { Authorization: `Bearer ${login.body.token}` };
    // the demo company has its own record, unaffected by what this company did
    const status = await request(app).get('/api/legal/status').set(other);
    expect(status.status).toBe(200);
    const mine = await platformPrisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(status.body.acceptedBy).not.toBe(mine.termsAcceptedBy);
  });

  it('an expired (read-only) company can still accept', async () => {
    await platformPrisma.subscription.update({
      where: { tenantId }, data: { status: 'TRIALING', trialEndsAt: new Date(Date.now() - 24 * 3600 * 1000) },
    });
    invalidateEntitlements(tenantId);
    const blocked = await request(app).post('/api/products').set(auth())
      .send({ nameAr: 'x', sku: `L-${stamp}`, costPrice: 1, salePrice: 2 });
    expect(blocked.status).toBe(402);
    const accept = await request(app).post('/api/legal/accept').set(auth());
    expect(accept.status).toBe(200);
  });

  it('the platform owner can see the acceptance evidence', async () => {
    const ownerEmail = `legal-owner-${stamp}@platform.test`;
    await platformPrisma.platformAdmin.create({
      data: { name: 'مالك', email: ownerEmail, passwordHash: await bcrypt.hash('Owner-pass-12345', 4) },
    });
    const owner = (await request(app).post('/api/platform/auth/login').send({ email: ownerEmail, password: 'Owner-pass-12345' })).body.token;
    const detail = await request(app).get(`/api/platform/tenants/${tenantId}`).set('Authorization', `Bearer ${owner}`);
    expect(detail.status).toBe(200);
    expect(detail.body.termsVersion).toBe(LEGAL_VERSION);
    expect(detail.body.termsAcceptedBy).toBe(email);
  });
});
