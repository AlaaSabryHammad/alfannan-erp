/**
 * Platform console — administrators of the console itself (OWNER only).
 * Mounted by routes/platform.ts after requirePlatformAdmin.
 *
 *   GET   /admins
 *   POST  /admins                      { name, email, role }       → temporary password (shown once)
 *   PATCH /admins/:id                  { name?, role?, isActive? }
 *   POST  /admins/:id/reset-password                               → temporary password (shown once)
 *
 * Roles
 *   OWNER    everything
 *   SUPPORT  reads everything and helps users (reset password, sessions, confirm e-mail, notes);
 *            cannot touch billing, plans, suspension, announcements, switches or other admins
 */
import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { z } from 'zod';
import { platformPrisma as db } from '../lib/platformPrisma';

const router = Router();

async function audit(req: Request, action: string, detail?: string): Promise<void> {
  await db.platformAuditLog.create({
    data: { adminId: req.platformAdmin?.adminId ?? null, action, tenantId: null, detail: detail ?? null },
  });
}

router.use('/admins', (req: Request, res: Response, next: NextFunction) => {
  if (req.platformAdmin?.role !== 'OWNER') {
    res.status(403).json({ error: 'إدارة مديري المنصة للمالك فقط' });
    return;
  }
  next();
});

const roleSchema = z.enum(['OWNER', 'SUPPORT']);
const tempPassword = () => crypto.randomBytes(12).toString('base64url');

const publicFields = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
  lastLoginAt: true,
  mustChangePassword: true,
} as const;

router.get('/admins', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await db.platformAdmin.findMany({ select: publicFields, orderBy: { id: 'asc' } }));
  } catch (err) {
    next(err);
  }
});

router.post('/admins', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z
      .object({
        name: z.string().trim().min(2, 'الاسم قصير جدًا').max(80),
        email: z.string().trim().email('بريد إلكتروني غير صالح'),
        role: roleSchema,
      })
      .parse(req.body);
    const email = body.email.toLowerCase();
    if (await db.platformAdmin.findUnique({ where: { email } })) {
      res.status(409).json({ error: 'هذا البريد مسجّل كمدير منصة بالفعل' });
      return;
    }
    const password = tempPassword();
    const created = await db.platformAdmin.create({
      data: {
        name: body.name,
        email,
        role: body.role,
        passwordHash: await bcrypt.hash(password, 12),
        mustChangePassword: true,
      },
      select: publicFields,
    });
    await audit(req, 'ADMIN_CREATE', `${email} (${body.role})`);
    res.status(201).json({ admin: created, temporaryPassword: password });
  } catch (err) {
    next(err);
  }
});

router.patch('/admins/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const patch = z
      .object({ name: z.string().trim().min(2).max(80).optional(), role: roleSchema.optional(), isActive: z.boolean().optional() })
      .parse(req.body);
    const target = await db.platformAdmin.findUnique({ where: { id } });
    if (!target) {
      res.status(404).json({ error: 'المدير غير موجود' });
      return;
    }
    const self = id === req.platformAdmin!.adminId;
    const roleChanges = patch.role !== undefined && patch.role !== target.role;
    const deactivates = patch.isActive === false && target.isActive;
    if (self && (roleChanges || deactivates)) {
      res.status(400).json({ error: 'لا يمكنك تغيير دورك أو تعطيل حسابك بنفسك' });
      return;
    }
    if (roleChanges || deactivates) {
      // never leave the platform without an active owner
      const owners = await db.platformAdmin.count({ where: { role: 'OWNER', isActive: true, id: { not: id } } });
      if (target.role === 'OWNER' && target.isActive && owners === 0) {
        res.status(400).json({ error: 'يجب أن يبقى مالك نشط واحد على الأقل' });
        return;
      }
    }
    const updated = await db.platformAdmin.update({
      where: { id },
      data: {
        ...patch,
        // a changed role or a disabled account must not keep working with the old token
        ...(roleChanges || deactivates ? { sessionsValidAfter: new Date() } : {}),
      },
      select: publicFields,
    });
    if (roleChanges) await audit(req, 'ADMIN_ROLE_CHANGE', `${target.email}: ${target.role} → ${patch.role}`);
    if (patch.isActive !== undefined && patch.isActive !== target.isActive) {
      await audit(req, patch.isActive ? 'ADMIN_ACTIVATE' : 'ADMIN_DEACTIVATE', target.email);
    }
    if (patch.name && patch.name !== target.name) await audit(req, 'ADMIN_UPDATE', target.email);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post('/admins/:id/reset-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const target = await db.platformAdmin.findUnique({ where: { id } });
    if (!target) {
      res.status(404).json({ error: 'المدير غير موجود' });
      return;
    }
    if (id === req.platformAdmin!.adminId) {
      res.status(400).json({ error: 'لتغيير كلمة مرورك استخدم زر «كلمة المرور» في الرأس' });
      return;
    }
    const password = tempPassword();
    await db.platformAdmin.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true, sessionsValidAfter: new Date() },
    });
    await audit(req, 'ADMIN_RESET_PASSWORD', target.email);
    res.json({ email: target.email, temporaryPassword: password });
  } catch (err) {
    next(err);
  }
});

export default router;
