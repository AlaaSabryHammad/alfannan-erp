import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

// GET /api/permissions — list all permissions grouped by group
router.get('/', requirePermission('roles.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const permissions = await prisma.permission.findMany({ orderBy: [{ group: 'asc' }, { code: 'asc' }] });

    // Group by group field
    const grouped: Record<string, typeof permissions> = {};
    for (const p of permissions) {
      if (!grouped[p.group]) grouped[p.group] = [];
      grouped[p.group].push(p);
    }

    const result = Object.entries(grouped).map(([group, perms]) => ({ group, permissions: perms }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
