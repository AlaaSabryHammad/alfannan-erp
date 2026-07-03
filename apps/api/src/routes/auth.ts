import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { requireAuth, AuthPayload } from '../middleware/auth';
import { lockRemainingSeconds, recordFailure, recordSuccess } from '../lib/loginThrottle';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6, 'كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف'),
});

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
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
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

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
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
    const result = await buildToken(user.id);
    res.json(result);
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
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
