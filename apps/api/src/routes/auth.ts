import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { requireAuth, AuthPayload } from '../middleware/auth';
import { runUnscoped, runWithTenant } from '../lib/tenantContext';
import { lockRemainingSeconds, recordFailure, recordSuccess } from '../lib/loginThrottle';
import { provisionTenant, EmailTakenError } from '../lib/tenantProvisioning';
import { rateLimit } from '../middleware/rateLimit';
import { LEGAL_VERSION } from '../lib/legal';
import { invalidateUserSessions } from '../lib/userSession';
import { confirmEmailToken, sendVerificationEmail } from '../lib/emailVerification';
import { mailEnabled } from '../lib/mail/mailer';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6, 'كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف'),
});

const registerSchema = z.object({
  companyName: z.string().trim().min(2, 'اسم الشركة قصير جدًا').max(100),
  adminName: z.string().trim().min(2, 'اسم المدير قصير جدًا').max(100),
  email: z.string().trim().email('بريد إلكتروني غير صالح'),
  password: z.string().min(8, 'كلمة المرور يجب ألا تقل عن 8 أحرف').max(128),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'يجب الموافقة على الشروط وسياسة الخصوصية' }) }),
});

// Self-service sign-ups are rate-limited per IP (in memory): 5 companies per hour.
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
const SIGNUP_MAX = 5;
const signupAttempts = new Map<string, number[]>();

function signupLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (signupAttempts.get(ip) ?? []).filter((t) => now - t < SIGNUP_WINDOW_MS);
  if (recent.length >= SIGNUP_MAX) {
    signupAttempts.set(ip, recent);
    return true;
  }
  recent.push(now);
  signupAttempts.set(ip, recent);
  return false;
}

async function buildToken(userId: number): Promise<{ token: string; user: object }> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      role: {
        include: {
          permissions: { include: { permission: true } },
        },
      },
    },
  });

  const permissions = user.role.permissions.map(rp => rp.permission.code);

  const payload: AuthPayload = {
    userId: user.id,
    tenantId: user.tenantId,
    email: user.email,
    roleCode: user.role.code,
    permissions,
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '24h' });

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      isActive: user.isActive,
      emailVerified: user.emailVerifiedAt !== null,
      role: {
        id: user.role.id,
        code: user.role.code,
        nameAr: user.role.nameAr,
      },
      permissions,
    },
  };
}

// POST /api/auth/login
router.post('/login', rateLimit({ name: 'login', windowMs: 10 * 60 * 1000, max: 30 }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    // Reject early if this account is temporarily locked from too many failures
    const locked = lockRemainingSeconds(email);
    if (locked > 0) {
      res.status(429).json({
        error: `تم إيقاف محاولات الدخول مؤقتاً بسبب تكرار المحاولات الخاطئة. حاول بعد ${Math.ceil(locked / 60)} دقيقة`,
      });
      return;
    }

    // E-mail is globally unique and identifies the tenant — the only unscoped lookup in the request path.
    const user = await runUnscoped(() => prisma.user.findUnique({ where: { email }, include: { tenant: true } }));
    if (!user || !user.isActive || !user.tenant.isActive) {
      recordFailure(email);
      res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      const lockSecs = recordFailure(email);
      res.status(lockSecs > 0 ? 429 : 401).json({
        error: lockSecs > 0
          ? `تم إيقاف محاولات الدخول مؤقتاً بسبب تكرار المحاولات الخاطئة. حاول بعد ${Math.ceil(lockSecs / 60)} دقيقة`
          : 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
      });
      return;
    }

    recordSuccess(email);
    const result = await runWithTenant(user.tenantId, () => buildToken(user.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/config — public flags the login screen needs (no secrets)
router.get('/config', (_req: Request, res: Response) => {
  res.json({ signupEnabled: process.env.ALLOW_SIGNUP === 'true', legalVersion: LEGAL_VERSION });
});

// POST /api/auth/register-tenant — create a new company with its first admin (public).
// Off unless ALLOW_SIGNUP=true, so a private deployment can never be opened up by accident.
router.post('/register-tenant', rateLimit({ name: 'register', windowMs: 60 * 60 * 1000, max: 10 }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (process.env.ALLOW_SIGNUP !== 'true') {
      res.status(403).json({ error: 'تسجيل الشركات الجديدة غير مفعّل على هذا الخادم' });
      return;
    }
    if (signupLimited(req.ip ?? 'unknown')) {
      res.status(429).json({ error: 'محاولات تسجيل كثيرة — حاول لاحقًا' });
      return;
    }

    const input = registerSchema.parse(req.body);
    const { acceptTerms: _accepted, ...company } = input;
    const { tenantId, userId } = await provisionTenant({ ...company, acceptedFromIp: req.ip ?? null });
    const result = await runWithTenant(tenantId, () => buildToken(userId));
    // the confirmation e-mail goes out in the background; a mail outage must not fail the registration
    void sendVerificationEmail(
      { id: userId, tenantId, email: input.email.trim().toLowerCase(), name: company.adminName },
      company.companyName,
    ).catch(() => undefined);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof EmailTakenError) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// POST /api/auth/verify-email — the link in the confirmation e-mail (public: the token is the proof)
router.post('/verify-email', rateLimit({ name: 'verify-email', windowMs: 10 * 60 * 1000, max: 30 }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = z.object({ token: z.string().min(10).max(2000) }).parse(req.body);
    const result = await confirmEmailToken(token);
    if (!result.ok) {
      res.status(400).json({
        error: result.reason === 'expired'
          ? 'انتهت صلاحية رابط التأكيد. اطلب رابطًا جديدًا من داخل النظام.'
          : 'رابط التأكيد غير صالح',
        reason: result.reason,
      });
      return;
    }
    res.json({ verified: true, email: result.email, alreadyVerified: result.alreadyVerified });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/resend-verification — send the confirmation link again (one a minute per user)
const resendAt = new Map<number, number>();
const RESEND_COOLDOWN_MS = 60 * 1000;

router.post('/resend-verification', requireAuth, rateLimit({ name: 'resend-verification', windowMs: 60 * 60 * 1000, max: 20 }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const me = req.user!;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: me.userId }, include: { tenant: true } });
    if (user.emailVerifiedAt) {
      res.json({ sent: false, alreadyVerified: true });
      return;
    }
    if (!mailEnabled()) {
      res.status(503).json({ error: 'خدمة البريد غير مفعّلة على هذا الخادم — تواصل مع الدعم' });
      return;
    }
    const last = resendAt.get(user.id) ?? 0;
    const wait = Math.ceil((last + RESEND_COOLDOWN_MS - Date.now()) / 1000);
    if (wait > 0) {
      res.status(429).json({ error: `انتظر ${wait} ثانية قبل إعادة الإرسال` });
      return;
    }
    resendAt.set(user.id, Date.now());
    const sent = await sendVerificationEmail(user, user.tenant.name);
    if (!sent) {
      resendAt.delete(user.id);
      res.status(502).json({ error: 'تعذّر إرسال الرسالة الآن — حاول لاحقًا' });
      return;
    }
    res.json({ sent: true, alreadyVerified: false });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await buildToken(req.user!.userId);
    res.json(result.user);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/change-password — self-service (any authenticated user)
router.post('/change-password', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const userId = req.user!.userId;

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
      return;
    }
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    // every other session of this user (a stolen token, a forgotten browser) stops working…
    await prisma.user.update({ where: { id: userId }, data: { passwordHash, sessionsValidAfter: new Date() } });
    invalidateUserSessions(req.user!.tenantId, userId);
    // …and this one continues with a fresh token
    const { token } = await buildToken(userId);
    res.json({ success: true, token });
  } catch (err) {
    next(err);
  }
});

export default router;
