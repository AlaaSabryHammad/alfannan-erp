/**
 * E-mail address confirmation: the message goes out at registration, the link confirms the address,
 * a forged / expired / foreign token does not.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from './helpers';
import { outbox } from '../src/lib/mail/mailer';
import { escapeHtml, verificationEmail } from '../src/lib/mail/templates';
import { _resetRateLimits } from '../src/middleware/rateLimit';
import { _resetThrottle } from '../src/lib/loginThrottle';

const stamp = Date.now();
const email = `verify-${stamp}@mail.test`;
const body = {
  companyName: `شركة التأكيد ${stamp}`,
  adminName: 'مدير <b>التأكيد</b>',
  email,
  password: 'Verify-pass-12345',
  acceptTerms: true,
};
let token: string;
let mailToken: string;

const auth = () => ({ Authorization: `Bearer ${token}` });
const waitForMail = async () => {
  for (let i = 0; i < 40 && outbox.length === 0; i++) await new Promise((r) => setTimeout(r, 25));
};

beforeAll(async () => {
  _resetThrottle();
  _resetRateLimits();
  process.env.ALLOW_SIGNUP = 'true';
  process.env.MAIL_DRIVER = 'memory';
  process.env.PUBLIC_BASE_URL = 'https://erp.example.test';
  outbox.length = 0;
  const res = await request(app).post('/api/auth/register-tenant').send(body);
  expect(res.status).toBe(201);
  token = res.body.token;
  await waitForMail();
  const link = /https:\/\/erp\.example\.test\/verify-email\?token=([^"\s<]+)/.exec(outbox[0]?.html ?? '');
  mailToken = decodeURIComponent(link?.[1] ?? '');
});
afterAll(() => {
  delete process.env.ALLOW_SIGNUP;
  delete process.env.MAIL_DRIVER;
  delete process.env.PUBLIC_BASE_URL;
});

describe('confirmation e-mail', () => {
  it('is sent at registration, in Arabic RTL, with an escaped name and the link', () => {
    expect(outbox).toHaveLength(1);
    const mail = outbox[0];
    expect(mail.to).toBe(email);
    expect(mail.html).toContain('dir="rtl"');
    expect(mail.html).toContain('تأكيد البريد الإلكتروني');
    expect(mail.html).not.toContain('<b>التأكيد</b>');
    expect(mail.html).toContain('&lt;b&gt;التأكيد&lt;/b&gt;');
    expect(mail.text).toContain('/verify-email?token=');
    expect(mailToken.length).toBeGreaterThan(20);
  });

  it('escapes html', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
    const m = verificationEmail({ name: '<x>', companyName: '"y"', url: 'https://a/b?c=1&d=2', validHours: 48 });
    expect(m.html).not.toContain('<x>');
    expect(m.html).toContain('c=1&amp;d=2');
  });
});

describe('confirming the address', () => {
  it('starts unverified', async () => {
    const me = await request(app).get('/api/auth/me').set(auth());
    expect(me.status).toBe(200);
    expect(me.body.emailVerified).toBe(false);
  });

  it('rejects garbage, a session token and a token for another purpose', async () => {
    const garbage = await request(app).post('/api/auth/verify-email').send({ token: 'not-a-token-at-all' });
    expect(garbage.status).toBe(400);
    const session = await request(app).post('/api/auth/verify-email').send({ token });
    expect(session.status).toBe(400);
    const forged = jwt.sign({ purpose: 'verify-email', userId: 1, tenantId: 1, email }, 'another-secret');
    expect((await request(app).post('/api/auth/verify-email').send({ token: forged })).status).toBe(400);
  });

  it('reports an expired link as expired', async () => {
    const expired = jwt.sign(
      { purpose: 'verify-email', userId: 1, tenantId: 1, email, iat: Math.floor(Date.now() / 1000) - 7200 },
      `${process.env.JWT_SECRET}:verify-email`,
      { expiresIn: 60 },
    );
    const res = await request(app).post('/api/auth/verify-email').send({ token: expired });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('expired');
  });

  it('confirms with the mailed link, and again harmlessly', async () => {
    const first = await request(app).post('/api/auth/verify-email').send({ token: mailToken });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ verified: true, email, alreadyVerified: false });

    const again = await request(app).post('/api/auth/verify-email').send({ token: mailToken });
    expect(again.body.alreadyVerified).toBe(true);

    const me = await request(app).get('/api/auth/me').set(auth());
    expect(me.body.emailVerified).toBe(true);
  });

  it('resend: nothing to do once verified', async () => {
    outbox.length = 0;
    const res = await request(app).post('/api/auth/resend-verification').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.alreadyVerified).toBe(true);
    expect(outbox).toHaveLength(0);
  });

  it('resend requires a session', async () => {
    expect((await request(app).post('/api/auth/resend-verification')).status).toBe(401);
  });
});
