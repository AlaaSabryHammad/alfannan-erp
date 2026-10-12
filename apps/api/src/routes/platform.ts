/**
 * Platform console API — لوحة إدارة المنصة (SaaS owner)
 *
 * Separate from the tenant API: its own login, its own token (different signing key) and the owner
 * database connection, because it must see across companies.
 *
 *   POST  /api/platform/auth/login
 *   GET   /api/platform/me
 *   GET   /api/platform/stats
 *   GET   /api/platform/tenants?search=
 *   GET   /api/platform/tenants/:id
 *   PATCH /api/platform/tenants/:id                       { isActive?, name? }
 *   POST  /api/platform/tenants/:id/users/:userId/reset-password
 *   POST  /api/platform/tenants/:id/users/:userId/active          { isActive }
 *   POST  /api/platform/tenants/:id/users/:userId/force-logout
 *   POST  /api/platform/tenants/:id/users/:userId/verify-email    (mark confirmed)
 *   POST  /api/platform/tenants/:id/users/:userId/resend-verification
 *   GET   /api/platform/audit-log
 */
import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { z } from 'zod';
import { platformPrisma as db } from '../lib/platformPrisma';
import { requirePlatformAdmin, signPlatformToken } from '../middleware/platformAuth';
import { invalidateTenantActive } from '../middleware/auth';
import { lockRemainingSeconds, recordFailure, recordSuccess } from '../lib/loginThrottle';
import { computeEntitlements } from '../lib/entitlements';
import { rateLimit } from '../middleware/rateLimit';
import { invalidateUserSessions } from '../lib/userSession';
import billingRouter from './platformBilling';
import { sendVerificationEmail } from '../lib/emailVerification';
import { mailEnabled } from '../lib/mail/mailer';

const router = Router();

async function audit(req: Request, action: string, tenantId: number | null, detail?: string): Promise<void> {
  await db.platformAuditLog.create({
    data: { adminId: req.platformAdmin?.adminId ?? null, action, tenantId, detail: detail ?? null },
  });
}

// ── auth ──────────────────────────────────────────────────────────────────────

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

router.post('/auth/login', rateLimit({ name: 'platform-login', windowMs: 10 * 60 * 1000, max: 20 }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const key = `platform:${email.toLowerCase()}`;

    const locked = lockRemainingSeconds(key);
    if (locked > 0) {
      res.status(429).json({ error: `محاولات كثيرة — حاول بعد ${Math.ceil(locked / 60)} دقيقة` });
      return;
    }

    const admin = await db.platformAdmin.findUnique({ where: { email: email.toLowerCase() } });
    const ok = !!admin && admin.isActive && (await bcrypt.compare(password, admin.passwordHash));
    if (!ok) {
      const lock = recordFailure(key);
      res.status(lock > 0 ? 429 : 401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
      return;
    }
    recordSuccess(key);
    req.platformAdmin = { scope: 'platform', adminId: admin.id, email: admin.email, name: admin.name };
    await audit(req, 'LOGIN', null);
    res.json({
      token: signPlatformToken({ adminId: admin.id, email: admin.email, name: admin.name }),
      admin: { id: admin.id, name: admin.name, email: admin.email },
    });
  } catch (err) {
    next(err);
  }
});

router.use(requirePlatformAdmin);

router.use(billingRouter);

// Change my own password. Needs the current one; every other session of this account is ended and the
// caller continues with a fresh token.
const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(12, 'كلمة المرور الجديدة يجب ألا تقل عن 12 حرفًا')
    .max(128)
    .refine((p) => /[A-Za-z]/.test(p) && /[0-9]/.test(p), 'يجب أن تحوي حروفًا وأرقامًا'),
});

router.post(
  '/me/password',
  rateLimit({ name: 'platform-password', windowMs: 10 * 60 * 1000, max: 10 }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentPassword, newPassword } = passwordSchema.parse(req.body);
      const me = req.platformAdmin!;
      const admin = await db.platformAdmin.findUniqueOrThrow({ where: { id: me.adminId } });

      if (!(await bcrypt.compare(currentPassword, admin.passwordHash))) {
        res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
        return;
      }
      if (await bcrypt.compare(newPassword, admin.passwordHash)) {
        res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية' });
        return;
      }

      await db.platformAdmin.update({
        where: { id: admin.id },
        data: { passwordHash: await bcrypt.hash(newPassword, 12), sessionsValidAfter: new Date() },
      });
      await audit(req, 'PLATFORM_PASSWORD_CHANGE', null, admin.email);
      res.json({
        success: true,
        token: signPlatformToken({ adminId: admin.id, email: admin.email, name: admin.name }),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get('/me', (req: Request, res: Response) => {
  const a = req.platformAdmin!;
  res.json({ id: a.adminId, name: a.name, email: a.email });
});

// ── usage ─────────────────────────────────────────────────────────────────────

type CountRow = { tenantId: number; _count: { _all: number } };
const toMap = (rows: CountRow[]) => new Map(rows.map((r) => [r.tenantId, r._count._all]));

async function usageByTenant() {
  const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [users, products, customers, invoices, invoices30, entries, activity] = await Promise.all([
    db.user.groupBy({ by: ['tenantId'], _count: { _all: true } }),
    db.product.groupBy({ by: ['tenantId'], _count: { _all: true } }),
    db.customer.groupBy({ by: ['tenantId'], _count: { _all: true } }),
    db.salesInvoice.groupBy({ by: ['tenantId'], _count: { _all: true } }),
    db.salesInvoice.groupBy({
      by: ['tenantId'],
      where: { date: { gte: since30 } },
      _count: { _all: true },
      _sum: { total: true },
    }),
    db.journalEntry.groupBy({ by: ['tenantId'], _count: { _all: true } }),
    db.auditLog.groupBy({ by: ['tenantId'], _max: { createdAt: true } }),
  ]);
  const inv30 = new Map(
    invoices30.map((r) => [r.tenantId, { count: r._count._all, total: Number(r._sum.total ?? 0) }]),
  );
  const lastActivity = new Map(activity.map((r) => [r.tenantId, r._max.createdAt]));
  const maps = {
    users: toMap(users as CountRow[]),
    products: toMap(products as CountRow[]),
    customers: toMap(customers as CountRow[]),
    invoices: toMap(invoices as CountRow[]),
    entries: toMap(entries as CountRow[]),
  };
  return (tenantId: number) => ({
    users: maps.users.get(tenantId) ?? 0,
    products: maps.products.get(tenantId) ?? 0,
    customers: maps.customers.get(tenantId) ?? 0,
    salesInvoices: maps.invoices.get(tenantId) ?? 0,
    journalEntries: maps.entries.get(tenantId) ?? 0,
    invoicesLast30Days: inv30.get(tenantId)?.count ?? 0,
    salesLast30Days: inv30.get(tenantId)?.total ?? 0,
    lastActivityAt: lastActivity.get(tenantId) ?? null,
  });
}

type SubRow = Awaited<ReturnType<typeof loadSubscriptions>> extends Map<number, infer V> ? V : never;

async function loadSubscriptions() {
  const subs = await db.subscription.findMany({ include: { plan: true } });
  return new Map(subs.map((s) => [s.tenantId, { ...s, ent: computeEntitlements(s) }]));
}

function subscriptionSummary(s: SubRow | undefined) {
  if (!s) return null;
  return {
    planId: s.planId,
    planCode: s.plan.code,
    planName: s.plan.nameAr,
    priceMonthly: Number(s.plan.priceMonthly),
    status: s.ent.status,
    storedStatus: s.status,
    trialEndsAt: s.trialEndsAt,
    currentPeriodEnd: s.currentPeriodEnd,
    daysLeft: s.ent.daysLeft,
    limitOverrides: s.limitOverrides,
    featureOverrides: s.featureOverrides,
    notes: s.notes,
  };
}

router.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const now = Date.now();
    const daysAgo = (n: number) => new Date(now - n * 24 * 3600 * 1000);
    const [tenants, users] = await Promise.all([
      db.tenant.findMany({ select: { isActive: true, createdAt: true } }),
      db.user.count(),
    ]);

    const byDay = new Map<string, number>();
    for (const t of tenants) {
      if (t.createdAt >= daysAgo(30)) {
        const k = t.createdAt.toISOString().slice(0, 10);
        byDay.set(k, (byDay.get(k) ?? 0) + 1);
      }
    }
    const signupsByDay = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(now - (29 - i) * 24 * 3600 * 1000).toISOString().slice(0, 10);
      return { date: d, count: byDay.get(d) ?? 0 };
    });

    const [subs, paid30, tenantNames] = await Promise.all([
      loadSubscriptions(),
      db.subscriptionPayment.aggregate({ where: { createdAt: { gte: daysAgo(30) } }, _sum: { amount: true } }),
      db.tenant.findMany({ select: { id: true, name: true } }),
    ]);
    const nameOf = new Map(tenantNames.map((t) => [t.id, t.name]));
    let mrr = 0;
    let trialing = 0;
    let paying = 0;
    const expiringSoon: Array<{ tenantId: number; name: string; planName: string; status: string; endsAt: Date | null; daysLeft: number | null }> = [];
    for (const [tenantId, s] of subs) {
      const st = s.ent.status;
      // "paying" = an open paid subscription on a priced plan (free/custom-priced plans add no revenue)
      if ((st === 'ACTIVE' || st === 'PAST_DUE') && Number(s.plan.priceMonthly) > 0) {
        paying += 1;
        mrr += Number(s.plan.priceMonthly);
      }
      if (st === 'TRIALING') trialing += 1;
      const open = st === 'TRIALING' || st === 'ACTIVE' || st === 'PAST_DUE';
      if (open && s.ent.daysLeft !== null && s.ent.daysLeft <= 7) {
        expiringSoon.push({
          tenantId,
          name: nameOf.get(tenantId) ?? '',
          planName: s.plan.nameAr,
          status: st,
          endsAt: st === 'TRIALING' ? s.trialEndsAt : s.currentPeriodEnd,
          daysLeft: s.ent.daysLeft,
        });
      }
      if (st === 'EXPIRED') {
        expiringSoon.push({ tenantId, name: nameOf.get(tenantId) ?? '', planName: s.plan.nameAr, status: st, endsAt: s.currentPeriodEnd ?? s.trialEndsAt, daysLeft: s.ent.daysLeft });
      }
    }
    expiringSoon.sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));

    res.json({
      pendingUpgradeRequests: await db.upgradeRequest.count({ where: { status: 'PENDING' } }),
      revenue: {
        mrr,
        payingTenants: paying,
        trialingTenants: trialing,
        paidLast30Days: Number(paid30._sum.amount ?? 0),
        attention: expiringSoon,
      },
      tenants: {
        total: tenants.length,
        active: tenants.filter((t) => t.isActive).length,
        suspended: tenants.filter((t) => !t.isActive).length,
        newLast7Days: tenants.filter((t) => t.createdAt >= daysAgo(7)).length,
        newLast30Days: tenants.filter((t) => t.createdAt >= daysAgo(30)).length,
      },
      users,
      unverifiedAdmins: await db.user.count({ where: { emailVerifiedAt: null, role: { code: 'ADMIN' }, isActive: true } }),
      signupsByDay,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/tenants', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const search = String(req.query.search ?? '').trim();
    const tenants = await db.tenant.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { slug: { contains: search, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { id: 'asc' },
    });
    const [usage, subs] = await Promise.all([usageByTenant(), loadSubscriptions()]);
    res.json(tenants.map((t) => ({ ...t, usage: usage(t.id), subscription: subscriptionSummary(subs.get(t.id)) })));
  } catch (err) {
    next(err);
  }
});

router.get('/tenants/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const tenant = await db.tenant.findUnique({ where: { id } });
    if (!tenant) {
      res.status(404).json({ error: 'الشركة غير موجودة' });
      return;
    }
    const [users, usage, subs, payments] = await Promise.all([
      db.user.findMany({
        where: { tenantId: id },
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
          createdAt: true,
          emailVerifiedAt: true,
          lastLoginAt: true,
          role: { select: { code: true, nameAr: true } },
        },
        orderBy: { id: 'asc' },
      }),
      usageByTenant(),
      loadSubscriptions(),
      db.subscriptionPayment.findMany({ where: { tenantId: id }, orderBy: { id: 'desc' }, take: 50 }),
    ]);
    res.json({
      ...tenant,
      usage: usage(id),
      users,
      subscription: subscriptionSummary(subs.get(id)),
      payments: payments.map((p) => ({ ...p, amount: Number(p.amount) })),
    });
  } catch (err) {
    next(err);
  }
});

// ── actions ───────────────────────────────────────────────────────────────────

const patchSchema = z.object({
  isActive: z.boolean().optional(),
  name: z.string().trim().min(2).max(100).optional(),
  platformNote: z.string().max(2000).nullable().optional(),
});

router.patch('/tenants/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const data = patchSchema.parse(req.body);
    const before = await db.tenant.findUnique({ where: { id } });
    if (!before) {
      res.status(404).json({ error: 'الشركة غير موجودة' });
      return;
    }
    const updated = await db.tenant.update({ where: { id }, data });
    invalidateTenantActive(id);
    if (data.isActive !== undefined && data.isActive !== before.isActive) {
      await audit(req, data.isActive ? 'TENANT_ACTIVATE' : 'TENANT_SUSPEND', id, before.name);
    }
    if (data.name && data.name !== before.name) {
      await audit(req, 'TENANT_RENAME', id, `${before.name} → ${data.name}`);
    }
    if (data.platformNote !== undefined && data.platformNote !== before.platformNote) {
      await audit(req, 'TENANT_NOTE', id, before.name);
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ── support actions on one company user ───────────────────────────────────────

async function findCompanyUser(req: Request, res: Response) {
  const tenantId = Number(req.params.id);
  const userId = Number(req.params.userId);
  const user = await db.user.findFirst({
    where: { id: userId, tenantId },
    include: { role: { select: { code: true } }, tenant: { select: { name: true } } },
  });
  if (!user) {
    res.status(404).json({ error: 'المستخدم غير موجود في هذه الشركة' });
    return null;
  }
  return { user, tenantId };
}

// enable / disable one user (a disabled user cannot sign in and loses the open session at once)
router.post('/tenants/:id/users/:userId/active', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
    const found = await findCompanyUser(req, res);
    if (!found) return;
    const { user, tenantId } = found;

    if (!isActive && user.role.code === 'ADMIN') {
      const otherAdmins = await db.user.count({
        where: { tenantId, isActive: true, id: { not: user.id }, role: { code: 'ADMIN' } },
      });
      if (otherAdmins === 0) {
        res.status(400).json({ error: 'لا يمكن تعطيل آخر مدير نشط في الشركة' });
        return;
      }
    }
    await db.user.update({
      where: { id: user.id },
      data: { isActive, ...(isActive ? {} : { sessionsValidAfter: new Date() }) },
    });
    invalidateUserSessions(tenantId, user.id);
    await audit(req, isActive ? 'USER_ACTIVATE' : 'USER_DEACTIVATE', tenantId, user.email);
    res.json({ id: user.id, isActive });
  } catch (err) {
    next(err);
  }
});

// end every open session of the user (lost device, suspected leak)
router.post('/tenants/:id/users/:userId/force-logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const found = await findCompanyUser(req, res);
    if (!found) return;
    const { user, tenantId } = found;
    await db.user.update({ where: { id: user.id }, data: { sessionsValidAfter: new Date() } });
    invalidateUserSessions(tenantId, user.id);
    await audit(req, 'USER_FORCE_LOGOUT', tenantId, user.email);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// the owner confirmed the address by other means (a phone call, a mailbox that filters our mail)
router.post('/tenants/:id/users/:userId/verify-email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const found = await findCompanyUser(req, res);
    if (!found) return;
    const { user, tenantId } = found;
    if (!user.emailVerifiedAt) {
      await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
      await audit(req, 'USER_EMAIL_VERIFIED', tenantId, user.email);
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/tenants/:id/users/:userId/resend-verification', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const found = await findCompanyUser(req, res);
    if (!found) return;
    const { user, tenantId } = found;
    if (user.emailVerifiedAt) {
      res.json({ sent: false, alreadyVerified: true });
      return;
    }
    if (!mailEnabled()) {
      res.status(503).json({ error: 'خدمة البريد غير مفعّلة على الخادم' });
      return;
    }
    const sent = await sendVerificationEmail(user, user.tenant.name);
    if (!sent) {
      res.status(502).json({ error: 'تعذّر إرسال الرسالة — راجع إعدادات SMTP' });
      return;
    }
    await audit(req, 'USER_VERIFICATION_RESENT', tenantId, user.email);
    res.json({ sent: true, alreadyVerified: false });
  } catch (err) {
    next(err);
  }
});

// Support: set a fresh temporary password for one tenant user. Shown once, never stored in clear.
router.post(
  '/tenants/:id/users/:userId/reset-password',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = Number(req.params.id);
      const userId = Number(req.params.userId);
      const user = await db.user.findFirst({
        where: { id: userId, tenantId },
        select: { id: true, email: true },
      });
      if (!user) {
        res.status(404).json({ error: 'المستخدم غير موجود في هذه الشركة' });
        return;
      }
      const temporaryPassword = crypto.randomBytes(9).toString('base64url');
      await db.user.update({
        where: { id: user.id },
        data: { passwordHash: await bcrypt.hash(temporaryPassword, 10), sessionsValidAfter: new Date() },
      });
      invalidateUserSessions(tenantId, user.id);
      await audit(req, 'USER_PASSWORD_RESET', tenantId, user.email);
      res.json({ email: user.email, temporaryPassword });
    } catch (err) {
      next(err);
    }
  },
);

router.get('/audit-log', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db.platformAuditLog.findMany({
      orderBy: { id: 'desc' },
      take: 100,
      include: { admin: { select: { name: true, email: true } } },
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;
