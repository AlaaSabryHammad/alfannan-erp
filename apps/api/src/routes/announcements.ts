/**
 * Announcements from the platform owner, shown to every signed-in user as a banner.
 *
 *   GET /api/announcements   the ones active right now (published/edited from the platform console)
 */
import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const ORDER: Record<string, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const rows = await prisma.announcement.findMany({
      where: {
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: { id: 'desc' },
      take: 10,
      select: { id: true, title: true, body: true, level: true },
    });
    rows.sort((a, b) => (ORDER[a.level] ?? 9) - (ORDER[b.level] ?? 9));
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;
