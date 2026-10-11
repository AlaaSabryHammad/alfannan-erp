import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { enterTenant } from '../lib/tenantContext';
import { basePrisma } from '../lib/prisma';
import { enforcementMode, getEntitlements } from '../lib/entitlements';

export interface AuthPayload {
  userId: number;
  tenantId: number;
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

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Self-service account endpoints that must keep working on an expired company.
const READ_ONLY_EXEMPT = /^\/api\/auth\/change-password/;

// Tenant "is active" lookups are cached briefly so the check costs ~nothing per request.
const TENANT_ACTIVE_TTL_MS = 15_000;
const tenantActiveCache = new Map<number, { active: boolean; at: number }>();

async function isTenantActive(tenantId: number): Promise<boolean> {
  const hit = tenantActiveCache.get(tenantId);
  if (hit && Date.now() - hit.at < TENANT_ACTIVE_TTL_MS) return hit.active;
  const row = await basePrisma.tenant.findUnique({ where: { id: tenantId }, select: { isActive: true } });
  const active = row?.isActive === true;
  tenantActiveCache.set(tenantId, { active, at: Date.now() });
  return active;
}

/** Called by the platform console right after it suspends/activates a company. */
export function invalidateTenantActive(tenantId: number): void {
  tenantActiveCache.delete(tenantId);
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
    // Tokens issued before multi-tenancy carry no tenant — force a fresh login.
    if (typeof decoded.tenantId !== 'number') {
      res.status(401).json({ error: 'الجلسة منتهية — الرجاء تسجيل الدخول مجدداً' });
      return;
    }
    // A suspended company is locked out immediately, not when its 24h token expires.
    if (!(await isTenantActive(decoded.tenantId))) {
      res.status(403).json({ error: 'تم إيقاف حساب الشركة — تواصل مع الدعم' });
      return;
    }
    req.user = decoded;

    // Expired / canceled companies keep read access (and can export) but cannot write.
    if (!SAFE_METHODS.has(req.method) && enforcementMode() !== 'off' && !READ_ONLY_EXEMPT.test(req.originalUrl)) {
      const ent = await getEntitlements(decoded.tenantId);
      if (ent.readOnly) {
        if (enforcementMode() === 'enforce') {
          res.status(402).json({
            error: 'انتهى اشتراك شركتك — النظام في وضع القراءة فقط. جدّد الاشتراك للمتابعة.',
            code: 'SUBSCRIPTION_READ_ONLY',
          });
          return;
        }
        console.warn(`[subscription] would block tenant=${decoded.tenantId} ${req.method} ${req.originalUrl} → SUBSCRIPTION_READ_ONLY`);
      }
    }
    // Everything downstream (routes, services, transactions) runs scoped to this tenant.
    enterTenant(decoded.tenantId, next);
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
