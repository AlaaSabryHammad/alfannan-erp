import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { requireAuth, AuthPayload } from '../middleware/auth';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
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

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
      return;
    }

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

export default router;
