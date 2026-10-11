/**
 * Security review hardening: privilege escalation, session invalidation, cross-tenant references,
 * secret redaction, safe uploads, rate limiting and error leakage.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { app } from './helpers';
import { platformPrisma } from '../src/lib/platformPrisma';
import { basePrisma } from '../src/lib/prisma';
import { invalidateUserSessions } from '../src/lib/userSession';
import { _resetRateLimits } from '../src/middleware/rateLimit';
import { _resetThrottle } from '../src/lib/loginThrottle';

const stamp = Date.now();
const password = 'Hardening-pass-1';
const emailA = `ceo-a-${stamp}@sec.test`;
const emailB = `ceo-b-${stamp}@sec.test`;

interface Company { token: string; tenantId: number; adminId: number; roles: Record<string, number> }

async function register(name: string, email: string): Promise<Company> {
  const reg = await request(app).post('/api/auth/register-tenant').send({
    companyName: `${name} ${stamp}`, adminName: 'مدير', acceptTerms: true, email, password,
  });
  expect(reg.status).toBe(201);
  const token = reg.body.token as string;
  const roles = await request(app).get('/api/roles').set('Authorization', `Bearer ${token}`);
  return {
    token,
    tenantId: (jwt.decode(token) as { tenantId: number }).tenantId,
    adminId: reg.body.user.id,
    roles: Object.fromEntries((roles.body as Array<{ code: string; id: number }>).map((r) => [r.code, r.id])),
  };
}

let A: Company;
let B: Company;
const auth = (c: Company) => ({ Authorization: `Bearer ${c.token}` });

beforeAll(async () => {
  _resetThrottle();
  _resetRateLimits();
  process.env.ALLOW_SIGNUP = 'true';
  process.env.SUBSCRIPTION_ENFORCEMENT = 'enforce';
  A = await register('شركة الأمان أ', emailA);
  B = await register('شركة الأمان ب', emailB);
});

afterAll(() => {
  delete process.env.ALLOW_SIGNUP;
  delete process.env.RATE_LIMIT_ENABLED;
});

async function createUser(c: Company, email: string, roleCode: string, pw = 'User-pass-12345') {
  const res = await request(app).post('/api/users').set(auth(c)).send({
    name: email.split('@')[0], email, password: pw, roleId: c.roles[roleCode],
  });
  expect(res.status).toBe(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: pw });
  expect(login.status).toBe(200);
  return { id: res.body.id as number, token: login.body.token as string };
}

describe('privilege escalation inside a company', () => {
  it('a non-admin cannot create an ADMIN, promote themselves, or edit/delete an admin', async () => {
    // a custom role that may manage users but is not ADMIN
    const role = await request(app).post('/api/roles').set(auth(A)).send({ code: 'HR_MANAGER', nameAr: 'مسؤول موارد' });
    expect(role.status).toBe(201);
    await request(app).put(`/api/roles/${role.body.id}/permissions`).set(auth(A))
      .send({ permissionCodes: ['users.view', 'users.create', 'users.edit', 'users.delete'] });

    const email = `hr-${stamp}@sec.test`;
    const create = await request(app).post('/api/users').set(auth(A)).send({
      name: 'موارد', email, password: 'Hr-pass-12345', roleId: role.body.id,
    });
    expect(create.status).toBe(201);
    const hr = (await request(app).post('/api/auth/login').send({ email, password: 'Hr-pass-12345' })).body.token;
    const hrAuth = { Authorization: `Bearer ${hr}` };

    const newAdmin = await request(app).post('/api/users').set(hrAuth).send({
      name: 'x', email: `evil-${stamp}@sec.test`, password: 'Evil-pass-12345', roleId: A.roles.ADMIN,
    });
    expect(newAdmin.status).toBe(403);

    const selfPromote = await request(app).put(`/api/users/${create.body.id}`).set(hrAuth).send({ roleId: A.roles.ADMIN });
    expect(selfPromote.status).toBe(403);

    const editAdmin = await request(app).put(`/api/users/${A.adminId}`).set(hrAuth).send({ password: 'Takeover-12345' });
    expect(editAdmin.status).toBe(403);

    const deleteAdmin = await request(app).delete(`/api/users/${A.adminId}`).set(hrAuth);
    expect(deleteAdmin.status).toBe(403);

    // the admin password is untouched
    const stillWorks = await request(app).post('/api/auth/login').send({ email: emailA, password });
    expect(stillWorks.status).toBe(200);
  });

  it('an ADMIN can still manage users and roles normally', async () => {
    const u = await createUser(A, `cashier-${stamp}@sec.test`, 'CASHIER');
    const res = await request(app).put(`/api/users/${u.id}`).set(auth(A)).send({ roleId: A.roles.STOREKEEPER });
    expect(res.status).toBe(200);
  });
});

describe('sessions follow the live state of the user', () => {
  it('locks a deactivated user out immediately', async () => {
    const u = await createUser(A, `leaver-${stamp}@sec.test`, 'CASHIER');
    expect((await request(app).get('/api/products').set('Authorization', `Bearer ${u.token}`)).status).toBe(200);

    await request(app).put(`/api/users/${u.id}`).set(auth(A)).send({ isActive: false });
    const after = await request(app).get('/api/products').set('Authorization', `Bearer ${u.token}`);
    expect(after.status).toBe(401);
  });

  it('applies permission changes without a new login', async () => {
    const u = await createUser(A, `perm-${stamp}@sec.test`, 'CASHIER');
    const t = { Authorization: `Bearer ${u.token}` };
    expect((await request(app).get('/api/users').set(t)).status).toBe(403);

    // grant users.view to the cashier role → effective on the next request
    const cashierRole = A.roles.CASHIER;
    const list = await request(app).get('/api/roles').set(auth(A));
    const current = (list.body as Array<{ id: number; permissions: Array<{ code: string }> }>).find((r) => r.id === cashierRole)!;
    const codes = current.permissions.map((p) => p.code);
    expect(codes.length).toBeGreaterThan(0);
    await request(app).put(`/api/roles/${cashierRole}/permissions`).set(auth(A))
      .send({ permissionCodes: [...codes, 'users.view'] });
    expect((await request(app).get('/api/users').set(t)).status).toBe(200);

    // and revoking works the same way
    await request(app).put(`/api/roles/${cashierRole}/permissions`).set(auth(A)).send({ permissionCodes: codes });
    expect((await request(app).get('/api/users').set(t)).status).toBe(403);
  });

  it('a password change ends the other sessions but keeps the current one', async () => {
    const email = `pwd-${stamp}@sec.test`;
    const u = await createUser(A, email, 'CASHIER', 'Old-pass-12345');
    const second = (await request(app).post('/api/auth/login').send({ email, password: 'Old-pass-12345' })).body.token;
    await new Promise((r) => setTimeout(r, 1100)); // tokens are second-granular

    const change = await request(app).post('/api/auth/change-password').set('Authorization', `Bearer ${u.token}`)
      .send({ currentPassword: 'Old-pass-12345', newPassword: 'New-pass-12345' });
    expect(change.status).toBe(200);
    expect(change.body.token).toBeTruthy();

    // the token that was used and any other old one are dead …
    expect((await request(app).get('/api/products').set('Authorization', `Bearer ${u.token}`)).status).toBe(401);
    expect((await request(app).get('/api/products').set('Authorization', `Bearer ${second}`)).status).toBe(401);
    // … the fresh one works
    expect((await request(app).get('/api/products').set('Authorization', `Bearer ${change.body.token}`)).status).toBe(200);
  });
});

describe('cross-company references', () => {
  it('rejects a row that points at another company\'s data (database trigger)', async () => {
    // a product that belongs to company A
    const productA = await request(app).post('/api/products').set(auth(A))
      .send({ nameAr: 'صنف أ', sku: `SEC-A-${stamp}`, costPrice: 1, salePrice: 2 });
    expect(productA.status).toBe(201);
    const brandA = await request(app).post('/api/brands').set(auth(A)).send({ nameAr: 'علامة أ' });
    expect(brandA.status).toBe(201);

    // company B tries to create its product pointing at A's brand
    const res = await request(app).post('/api/products').set(auth(B))
      .send({ nameAr: 'صنف ب', sku: `SEC-B-${stamp}`, costPrice: 1, salePrice: 2, brandId: brandA.body.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('مرجع غير صالح');

    // and nothing was created
    const list = await request(app).get('/api/products').set(auth(B));
    expect((list.body.data as Array<{ sku: string }>).some((p) => p.sku === `SEC-B-${stamp}`)).toBe(false);
  });

  it('rejects assigning another company\'s role to a user', async () => {
    const res = await request(app).post('/api/users').set(auth(B)).send({
      name: 'x', email: `cross-${stamp}@sec.test`, password: 'Cross-pass-12345', roleId: A.roles.CASHIER,
    });
    expect([400, 403]).toContain(res.status);
  });

  it('cannot rewrite another company\'s role permissions', async () => {
    const permsOf = async () => {
      const list = await request(app).get('/api/roles').set(auth(A));
      return (list.body as Array<{ id: number; permissions: unknown[] }>).find((r) => r.id === A.roles.ACCOUNTANT)!.permissions.length;
    };
    const before = await permsOf();
    expect(before).toBeGreaterThan(0);
    const res = await request(app).put(`/api/roles/${A.roles.ACCOUNTANT}/permissions`).set(auth(B))
      .send({ permissionCodes: [] });
    expect(res.status).toBe(404);
    expect(await permsOf()).toBe(before);
  });

  it('the role-permission table is hidden by RLS even for hand-written SQL', async () => {
    const rows = await basePrisma.$transaction([
      basePrisma.$executeRaw`SELECT set_config('app.tenant_id', ${String(B.tenantId)}, true)`,
      basePrisma.$queryRaw<Array<{ roleid: number }>>`SELECT DISTINCT "roleId" AS roleid FROM "RolePermission"`,
    ]);
    const visible = (rows[1] as Array<{ roleid: number }>).map((r) => r.roleid);
    expect(visible).toContain(B.roles.ADMIN);
    expect(visible).not.toContain(A.roles.ADMIN);
  });
});

describe('secrets', () => {
  it('never returns stored credentials in the settings, and keeps them when the mask is sent back', async () => {
    const put = await request(app).put('/api/settings').set(auth(A))
      .send({ whatsappApiToken: 'super-secret-token', companyName: 'اسم جديد' });
    expect(put.status).toBe(200);
    expect(put.body.whatsappApiToken).toBe('********');
    expect(JSON.stringify(put.body)).not.toContain('super-secret-token');

    const get = await request(app).get('/api/settings').set(auth(A));
    expect(get.body.whatsappApiToken).toBe('********');

    // the UI sends the mask back on save — the real value must survive
    await request(app).put('/api/settings').set(auth(A)).send({ whatsappApiToken: '********', companyName: 'اسم ثانٍ' });
    const row = await platformPrisma.setting.findFirst({ where: { tenantId: A.tenantId, key: 'whatsappApiToken' } });
    expect(row?.value).toBe('super-secret-token');
  });
});

describe('uploads', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

  it('stores an image under a random name with an extension taken from its type', async () => {
    const res = await request(app).post('/api/uploads/image').set(auth(A))
      .attach('image', png, { filename: 'logo.html', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^\/uploads\/[0-9a-f]{32}\.png$/);
    fs.unlinkSync(path.join(__dirname, '..', res.body.url.replace('/uploads/', 'uploads/')));
  });

  it('refuses a file whose bytes are not the image it claims to be', async () => {
    const res = await request(app).post('/api/uploads/image').set(auth(A))
      .attach('image', Buffer.from('<html><script>alert(1)</script></html>'), { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
  });

  it('serves uploads with no-sniff and a sandboxed CSP', async () => {
    const res = await request(app).get('/uploads/does-not-exist.png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain('sandbox');
  });
});

describe('headers, rate limits and error leakage', () => {
  it('sends security headers and hides the framework', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('limits login attempts per address', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true';
    _resetRateLimits();
    let last = 0;
    for (let i = 0; i < 31; i++) {
      const r = await request(app).post('/api/auth/login').send({ email: `nobody-${i}-${stamp}@sec.test`, password: 'x' });
      last = r.status;
    }
    expect(last).toBe(429);
    process.env.RATE_LIMIT_ENABLED = 'false';
    _resetRateLimits();
  });

  it('does not leak internal error text in production', async () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      // a malformed JSON body is a client error, not an internal one…
      const bad = await request(app).post('/api/auth/login').set('content-type', 'application/json').send('{ not json');
      expect(bad.status).toBeLessThan(500);
      // …and a forced internal failure never exposes its message
      const res = await request(app).get('/api/reports/ar-aging?asOf=not-a-date').set(auth(A));
      if (res.status >= 500) expect(res.body.message).toBeUndefined();
    } finally {
      process.env.NODE_ENV = saved;
    }
  });
});

describe('platform tokens', () => {
  it('rejects a token signed with another algorithm', async () => {
    const none = jwt.sign({ userId: 1, tenantId: 1 }, '', { algorithm: 'none' as jwt.Algorithm });
    const res = await request(app).get('/api/products').set('Authorization', `Bearer ${none}`);
    expect(res.status).toBe(401);
  });

  it('a platform reset password ends the user\'s sessions', async () => {
    const ownerEmail = `sec-owner-${stamp}@platform.test`;
    await platformPrisma.platformAdmin.create({
      data: { name: 'مالك', email: ownerEmail, passwordHash: await bcrypt.hash('Owner-pass-12345', 4) },
    });
    const owner = (await request(app).post('/api/platform/auth/login').send({ email: ownerEmail, password: 'Owner-pass-12345' })).body.token;

    const before = (await request(app).post('/api/auth/login').send({ email: emailB, password })).body.token;
    await new Promise((r) => setTimeout(r, 1100));
    const reset = await request(app)
      .post(`/api/platform/tenants/${B.tenantId}/users/${B.adminId}/reset-password`)
      .set('Authorization', `Bearer ${owner}`);
    expect(reset.status).toBe(200);
    invalidateUserSessions();
    expect((await request(app).get('/api/products').set('Authorization', `Bearer ${before}`)).status).toBe(401);
  });
});

describe('reference-integrity coverage (guard for future migrations)', () => {
  it('every table that references a tenant table has the cross-tenant trigger', async () => {
    const missing = await platformPrisma.$queryRaw<Array<{ relname: string }>>`
      SELECT DISTINCT cl.relname
      FROM pg_constraint con
      JOIN pg_class cl  ON cl.oid  = con.conrelid
      JOIN pg_class ref ON ref.oid = con.confrelid
      WHERE con.contype = 'f'
        AND con.connamespace = 'public'::regnamespace
        AND array_length(con.conkey, 1) = 1
        AND EXISTS (SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema = 'public' AND c.table_name = ref.relname AND c.column_name = 'tenantId')
        AND NOT EXISTS (SELECT 1 FROM pg_trigger tg
                        WHERE tg.tgrelid = con.conrelid AND tg.tgname = 'app_tenant_refs')`;
    // fix: call SELECT app_regenerate_tenant_ref_triggers(); at the end of the migration that added the FK
    expect(missing.map((r) => r.relname)).toEqual([]);
  });
});
