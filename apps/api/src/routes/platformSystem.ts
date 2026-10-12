/**
 * Platform console — announcements and system status (SaaS owner).
 * Mounted by routes/platform.ts after requirePlatformAdmin.
 *
 *   GET    /announcements            POST /announcements         PUT /announcements/:id      DELETE /announcements/:id
 *   GET    /system                   system status (mail, backups, database, switches)
 *   PUT    /system/signup            { enabled: boolean | null }  open/close self-service sign-up (null = follow ALLOW_SIGNUP)
 *   POST   /system/test-email        { to? }
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { platformPrisma as db } from '../lib/platformPrisma';
import { enforcementMode } from '../lib/entitlements';
import { getLastLifecycleResult } from '../lib/subscriptionLifecycle';
import { mailEnabled, sendMail } from '../lib/mail/mailer';
import { setSetting, signupState } from '../lib/platformSettings';
import { rateLimit } from '../middleware/rateLimit';

const router = Router();

async function audit(req: Request, action: string, detail?: string): Promise<void> {
  await db.platformAuditLog.create({
    data: { adminId: req.platformAdmin?.adminId ?? null, action, tenantId: null, detail: detail ?? null },
  });
}

// ── announcements ─────────────────────────────────────────────────────────────

const announcementBody = z
  .object({
    title: z.string().trim().min(2, 'العنوان قصير جدًا').max(120),
    body: z.string().trim().min(2, 'نص الإعلان قصير جدًا').max(1000),
    level: z.enum(['INFO', 'WARNING', 'CRITICAL']),
    isActive: z.boolean().default(true),
    startsAt: z.string().datetime().nullable().optional(),
    endsAt: z.string().datetime().nullable().optional(),
  })
  .refine((v) => !v.startsAt || !v.endsAt || new Date(v.endsAt) > new Date(v.startsAt), {
    message: 'تاريخ الانتهاء يجب أن يكون بعد تاريخ البدء',
  });

const toData = (b: z.infer<typeof announcementBody>) => ({
  title: b.title,
  body: b.body,
  level: b.level,
  isActive: b.isActive,
  startsAt: b.startsAt ? new Date(b.startsAt) : null,
  endsAt: b.endsAt ? new Date(b.endsAt) : null,
});

router.get('/announcements', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await db.announcement.findMany({ orderBy: { id: 'desc' }, take: 100 }));
  } catch (err) {
    next(err);
  }
});

router.post('/announcements', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const created = await db.announcement.create({ data: toData(announcementBody.parse(req.body)) });
    await audit(req, 'ANNOUNCEMENT_CREATE', created.title);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.put('/announcements/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!(await db.announcement.findUnique({ where: { id } }))) {
      res.status(404).json({ error: 'الإعلان غير موجود' });
      return;
    }
    const updated = await db.announcement.update({ where: { id }, data: toData(announcementBody.parse(req.body)) });
    await audit(req, 'ANNOUNCEMENT_UPDATE', updated.title);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/announcements/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const found = await db.announcement.findUnique({ where: { id } });
    if (!found) {
      res.status(404).json({ error: 'الإعلان غير موجود' });
      return;
    }
    await db.announcement.delete({ where: { id } });
    await audit(req, 'ANNOUNCEMENT_DELETE', found.title);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── system status ─────────────────────────────────────────────────────────────

function backupsInfo() {
  const dir = process.env.BACKUPS_DIR || '/backups';
  try {
    const files = fs
      .readdirSync(dir)
      .filter((n) => /^alfannan-\d{8}-\d{6}\.dump$/.test(n))
      .map((n) => ({ name: n, stat: fs.statSync(path.join(dir, n)) }))
      .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);
    const last = files.at(-1);
    return {
      available: true,
      count: files.length,
      latest: last ? { name: last.name, at: last.stat.mtime.toISOString(), bytes: last.stat.size } : null,
    };
  } catch {
    // the API container does not see the backups folder (not mounted)
    return { available: false, count: 0, latest: null };
  }
}

router.get('/system', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [signup, dbSize, tenants, users] = await Promise.all([
      signupState(),
      db.$queryRaw<Array<{ size: bigint }>>`SELECT pg_database_size(current_database()) AS size`,
      db.tenant.count(),
      db.user.count(),
    ]);
    res.json({
      runtime: { node: process.version, uptimeSeconds: Math.round(process.uptime()), env: process.env.NODE_ENV ?? 'development' },
      signup: { ...signup, envValue: process.env.ALLOW_SIGNUP === 'true' },
      subscriptions: { enforcement: enforcementMode() },
      payments: { enabled: process.env.PAYMENTS_ENABLED === 'true', provider: process.env.PAYMENTS_PROVIDER ?? 'moyasar' },
      mail: {
        enabled: mailEnabled(),
        driver: process.env.MAIL_DRIVER || (process.env.SMTP_HOST ? 'smtp' : 'off'),
        host: process.env.SMTP_HOST || null,
        from: process.env.MAIL_FROM || process.env.SMTP_USER || null,
      },
      database: { sizeBytes: Number(dbSize[0]?.size ?? 0), tenants, users },
      backups: backupsInfo(),
      lifecycle: getLastLifecycleResult(),
    });
  } catch (err) {
    next(err);
  }
});

router.put('/system/signup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { enabled } = z.object({ enabled: z.boolean().nullable() }).parse(req.body);
    await setSetting('signup.enabled', enabled === null ? null : String(enabled));
    await audit(req, 'SIGNUP_SETTING', enabled === null ? 'يتبع إعداد الخادم' : enabled ? 'مفتوح' : 'مغلق');
    res.json(await signupState());
  } catch (err) {
    next(err);
  }
});

router.post(
  '/system/test-email',
  rateLimit({ name: 'platform-test-email', windowMs: 10 * 60 * 1000, max: 10 }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z.object({ to: z.string().email().optional() }).parse(req.body ?? {});
      const to = body.to ?? req.platformAdmin!.email;
      if (!mailEnabled()) {
        res.status(503).json({ error: 'خدمة البريد غير مفعّلة (SMTP_HOST فارغ)' });
        return;
      }
      const sent = await sendMail({
        to,
        subject: 'رسالة اختبار — الفنان السعودي',
        text: 'هذه رسالة اختبار من لوحة إدارة المنصة. إذا وصلتك فإعدادات البريد سليمة.',
        html: '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.8">هذه رسالة اختبار من لوحة إدارة المنصة.<br>إذا وصلتك فإعدادات البريد سليمة ✅</div>',
      });
      if (!sent) {
        res.status(502).json({ error: 'تعذّر الإرسال — راجع إعدادات SMTP وسجل الخادم' });
        return;
      }
      await audit(req, 'TEST_EMAIL', to);
      res.json({ sent: true, to });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
