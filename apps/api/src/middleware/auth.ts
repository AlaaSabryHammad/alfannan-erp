import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';

export interface AuthPayload {
  userId: number;
  email: string;
  roleCode: string;
  permissions: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'غير مصرح — الرجاء تسجيل الدخول' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as AuthPayload;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'الجلسة منتهية — الرجاء تسجيل الدخول مجدداً' });
  }
}

export function requirePermission(code: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'غير مصرح' });
      return;
    }
    // ADMIN is a superuser — full access to every resource (matches the frontend's ADMIN bypass).
    if (req.user.roleCode === 'ADMIN') {
      next();
      return;
    }
    if (!req.user.permissions.includes(code)) {
      res.status(403).json({ error: 'لا تملك صلاحية للوصول إلى هذا المورد' });
      return;
    }
    next();
  };
}
