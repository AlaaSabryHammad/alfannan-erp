/**
 * Subscription enforcement middleware — فرض حدود ومزايا الباقة.
 * See lib/entitlements.ts for the modes (off | log | enforce).
 */
import { Request, Response, NextFunction } from 'express';
import {
  enforcementMode, getEntitlements, usageFor,
  FEATURE_LABELS, LIMIT_LABELS, type FeatureKey, type LimitKey,
} from '../lib/entitlements';

export type PlanViolationCode = 'PLAN_LIMIT' | 'FEATURE_NOT_IN_PLAN' | 'SUBSCRIPTION_READ_ONLY';

/** Answers 402 in enforce mode; in log mode records what would have been blocked and lets it through. */
export function planViolation(
  req: Request,
  res: Response,
  next: NextFunction,
  code: PlanViolationCode,
  message: string,
): void {
  const mode = enforcementMode();
  if (mode === 'enforce') {
    res.status(402).json({ error: message, code });
    return;
  }
  if (mode === 'log') {
    console.warn(`[subscription] would block tenant=${req.user?.tenantId} ${req.method} ${req.originalUrl} → ${code}`);
  }
  next();
}

/** POST handlers that add a counted resource (users, branches, …). */
export function enforceLimit(key: LimitKey) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (enforcementMode() === 'off' || !req.user) {
        next();
        return;
      }
      const ent = await getEntitlements(req.user.tenantId);
      const limit = ent.limits[key];
      if (limit === null) {
        next();
        return;
      }
      const used = await usageFor(req.user.tenantId, key);
      if (used >= limit) {
        planViolation(
          req, res, next, 'PLAN_LIMIT',
          `وصلت الحد الأقصى لباقتك من ${LIMIT_LABELS[key]} (${limit}) — رقِّ باقتك للمتابعة`,
        );
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Whole modules that belong to some plans only (mounted with router.use). */
export function requireFeature(key: FeatureKey) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (enforcementMode() === 'off' || !req.user) {
        next();
        return;
      }
      const ent = await getEntitlements(req.user.tenantId);
      if (!ent.features[key]) {
        planViolation(
          req, res, next, 'FEATURE_NOT_IN_PLAN',
          `«${FEATURE_LABELS[key]}» غير متاحة في باقتك الحالية — رقِّ باقتك لاستخدامها`,
        );
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
