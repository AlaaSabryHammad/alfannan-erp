import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { platformPrisma } from '../lib/platformPrisma';

export interface PlatformPayload {
  scope: 'platform';
  adminId: number;
  email: string;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      platformAdmin?: PlatformPayload;
    }
  }
}

// A different signing key than tenant sessions: a tenant token can never be a platform token.
const platformSecret = () => `${process.env.JWT_SECRET}:platform`;

export function signPlatformToken(payload: Omit<PlatformPayload, 'scope'>): string {
  return jwt.sign({ ...payload, scope: 'platform' }, platformSecret(), { expiresIn: '8h' });
}

export async function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'غير مصرح — سجّل دخول مدير المنصة' });
    return;
  }
  try {
    const decoded = jwt.verify(header.split(' ')[1], platformSecret()) as PlatformPayload;
    if (decoded.scope !== 'platform') throw new Error('wrong scope');
    // still an active platform admin? (revoking an admin takes effect immediately)
    const admin = await platformPrisma.platformAdmin.findUnique({
      where: { id: decoded.adminId },
      select: { isActive: true },
    });
    if (!admin?.isActive) throw new Error('inactive');
    req.platformAdmin = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'الجلسة منتهية — سجّل دخول مدير المنصة مجدداً' });
  }
}
