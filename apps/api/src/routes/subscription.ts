/**
 * GET /api/subscription — the company's plan, status, limits, usage and features.
 * Read-only: plans and periods are managed from the platform console.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { enforcementMode, getEntitlements, getUsage } from '../lib/entitlements';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenantId;
    const [entitlements, usage] = await Promise.all([getEntitlements(tenantId), getUsage(tenantId)]);
    res.json({ ...entitlements, usage, enforcement: enforcementMode() });
  } catch (err) {
    next(err);
  }
});

export default router;
