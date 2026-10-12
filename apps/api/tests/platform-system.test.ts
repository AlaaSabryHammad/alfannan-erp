/**
 * Platform console: announcements shown to companies, the sign-up switch and the system status.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { app } from './helpers';
import { platformPrisma } from '../src/lib/platformPrisma';
import { basePrisma } from '../src/lib/prisma';
import { outbox } from '../src/lib/mail/mailer';
import { _resetSettingsCache } from '../src/lib/platformSettings';
import { _resetRateLimits } from '../src/middleware/rateLimit';
import { _resetThrottle } from '../src/lib/loginThrottle';

const stamp = Date.now();
const ownerEmail = `sys-owner-${stamp}@platform.test`;
const ownerPassword = 'Platform-owner-pass-1';
const adminEmail = `sys-admin-${stamp}@company.test`;
const adminPassword = 'Company-admin-pass-1';

let platformToken: string;
let companyToken: string;
const asPlatform = () => ({ Authorization: `Bearer ${platformToken}` });
const asCompany = () => ({ Authorization: `Bearer ${companyToken}` });

const day = 24 * 3600 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

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
    companyName: `شركة النظام ${stamp}`, adminName: 'مدير', email: adminEmail, password: adminPassword, acceptTerms: true,
  });
  expect(reg.status).toBe(201);
  companyToken = reg.body.token;
});

afterAll(async () => {
  await platformPrisma.platformSetting.deleteMany({ where: { key: 'signup.enabled' } });
  await platformPrisma.announcement.deleteMany({ where: { title: { startsWith: `[${stamp}]` } } });
  _resetSettingsCache();
  delete process.env.ALLOW_SIGNUP;
  delete process.env.MAIL_DRIVER;
});

describe('announcements', () => {
  it('are managed by the platform owner only', async () => {
    expect((await request(app).get('/api/platform/announcements')).status).toBe(401);
    expect((await request(app).get('/api/platform/announcements').set(asCompany())).status).toBe(401);
    expect((await request(app).get('/api/announcements')).status).toBe(401);
  });

  it('validates the input', async () => {
    const bad = await request(app).post('/api/platform/announcements').set(asPlatform())
      .send({ title: 'x', body: 'y', level: 'LOUD' });
    expect(bad.status).toBe(400);
    const order = await request(app).post('/api/platform/announcements').set(asPlatform())
      .send({ title: `[${stamp}] ترتيب`, body: 'نص الإعلان', level: 'INFO', startsAt: iso(day), endsAt: iso(-day) });
    expect(order.status).toBe(400);
  });

  it('shows companies only what is active right now', async () => {
    const make = (extra: object) =>
      request(app).post('/api/platform/announcements').set(asPlatform())
        .send({ body: 'نص الإعلان التجريبي', level: 'INFO', ...extra });

    const live = await make({ title: `[${stamp}] ظاهر`, level: 'WARNING' });
    expect(live.status).toBe(201);
    await make({ title: `[${stamp}] معطّل`, isActive: false });
    await make({ title: `[${stamp}] مستقبلي`, startsAt: iso(day) });
    await make({ title: `[${stamp}] منتهي`, endsAt: iso(-day) });

    const seen = await request(app).get('/api/announcements').set(asCompany());
    expect(seen.status).toBe(200);
    const titles = (seen.body as Array<{ title: string }>).map((a) => a.title).filter((t) => t.startsWith(`[${stamp}]`));
    expect(titles).toEqual([`[${stamp}] ظاهر`]);
  });

  it('can be edited and deleted', async () => {
    const created = await request(app).post('/api/platform/announcements').set(asPlatform())
      .send({ title: `[${stamp}] للتعديل`, body: 'نص الإعلان', level: 'INFO' });
    const id = created.body.id as number;
    const upd = await request(app).put(`/api/platform/announcements/${id}`).set(asPlatform())
      .send({ title: `[${stamp}] بعد التعديل`, body: 'نص جديد', level: 'CRITICAL', isActive: true });
    expect(upd.status).toBe(200);
    expect(upd.body.level).toBe('CRITICAL');
    expect((await request(app).delete(`/api/platform/announcements/${id}`).set(asPlatform())).status).toBe(200);
    expect((await request(app).delete(`/api/platform/announcements/${id}`).set(asPlatform())).status).toBe(404);
  });

  it('the company application cannot write them (database privileges)', async () => {
    await expect(
      basePrisma.$executeRawUnsafe(`INSERT INTO "Announcement" ("title","body","updatedAt") VALUES ('x','y', now())`),
    ).rejects.toThrow(/permission denied/i);
    await expect(basePrisma.$queryRawUnsafe(`SELECT * FROM "PlatformSetting"`)).rejects.toThrow(/permission denied/i);
  });
});

describe('sign-up switch', () => {
  it('overrides the environment from the console, and can be reset', async () => {
    expect((await request(app).get('/api/auth/config')).body.signupEnabled).toBe(true);

    const close = await request(app).put('/api/platform/system/signup').set(asPlatform()).send({ enabled: false });
    expect(close.body).toMatchObject({ enabled: false, source: 'console' });
    _resetSettingsCache();
    expect((await request(app).get('/api/auth/config')).body.signupEnabled).toBe(false);
    const blocked = await request(app).post('/api/auth/register-tenant').send({
      companyName: 'x شركة', adminName: 'مدير', email: `blocked-${stamp}@x.test`, password: 'Blocked-pass-123', acceptTerms: true,
    });
    expect(blocked.status).toBe(403);

    const follow = await request(app).put('/api/platform/system/signup').set(asPlatform()).send({ enabled: null });
    expect(follow.body).toMatchObject({ enabled: true, source: 'env' });
    _resetSettingsCache();
    expect((await request(app).get('/api/auth/config')).body.signupEnabled).toBe(true);
  });
});

describe('system status and test e-mail', () => {
  it('reports the state of the platform', async () => {
    const res = await request(app).get('/api/platform/system').set(asPlatform());
    expect(res.status).toBe(200);
    expect(res.body.database.sizeBytes).toBeGreaterThan(0);
    expect(res.body.database.tenants).toBeGreaterThan(0);
    expect(res.body.mail.enabled).toBe(true);
    expect(['off', 'log', 'enforce']).toContain(res.body.subscriptions.enforcement);
    expect(res.body.backups).toHaveProperty('available');
  });

  it('sends a test e-mail to the owner', async () => {
    outbox.length = 0;
    const res = await request(app).post('/api/platform/system/test-email').set(asPlatform()).send({});
    expect(res.status).toBe(200);
    expect(outbox.at(-1)?.to).toBe(ownerEmail);
  });
});
