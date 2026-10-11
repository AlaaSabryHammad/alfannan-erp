/**
 * Legal acceptance — الموافقة على الشروط وسياسة الخصوصية
 *
 *   GET  /api/legal/status   which version this company accepted, and the current one
 *   POST /api/legal/accept   accept the current version (company admins / settings.edit)
 *
 * New companies accept at registration (stored on the Tenant). Companies created before the terms
 * existed — or after a new version is published — are asked from inside the app.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth';
import { basePrisma } from '../lib/prisma';
import { LEGAL_VERSION } from '../lib/legal';

const router = Router();
router.use(requireAuth);

router.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenant = await basePrisma.tenant.findUniqueOrThrow({
      where: { id: req.user!.tenantId },
      select: { termsVersion: true, termsAcceptedAt: true, termsAcceptedBy: true },
    });
    res.json({
      currentVersion: LEGAL_VERSION,
      acceptedVersion: tenant.termsVersion,
      acceptedAt: tenant.termsAcceptedAt,
      acceptedBy: tenant.termsAcceptedBy,
      upToDate: tenant.termsVersion === LEGAL_VERSION,
    });
  } catch (err) {
    next(err);
  }
});

// A read-only (expired) company can still accept — see READ_ONLY_EXEMPT in middleware/auth.ts.
router.post('/accept', requirePermission('settings.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updated = await basePrisma.tenant.update({
      where: { id: req.user!.tenantId },
      data: {
        termsVersion: LEGAL_VERSION,
        termsAcceptedAt: new Date(),
        termsAcceptedBy: req.user!.email,
        termsAcceptedIp: req.ip ?? null,
      },
      select: { termsVersion: true, termsAcceptedAt: true },
    });
    res.json({ acceptedVersion: updated.termsVersion, acceptedAt: updated.termsAcceptedAt, upToDate: true });
  } catch (err) {
    next(err);
  }
});

export default router;
