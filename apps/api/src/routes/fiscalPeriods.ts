/**
 * الفترات المحاسبية — Fiscal Periods
 *
 * Lock/unlock accounting months. A LOCKED month rejects every journal posting
 * or reversal dated inside it (enforced in lib/ledger.ts), which freezes all
 * document types at once. Months with no row are OPEN by default.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const periodSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
});

// GET /api/fiscal-periods?year=2026 — all 12 months with their status
router.get('/', requirePermission('fiscalperiods.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const year = parseInt((req.query.year as string) ?? '') || new Date().getFullYear();
    const rows = await prisma.fiscalPeriod.findMany({
      where: { year },
      include: { lockedBy: { select: { id: true, name: true } } },
    });
    const byMonth = new Map(rows.map((r) => [r.month, r]));

    // Count journal entries per month so the UI can show activity next to the lock
    const entryCounts = await prisma.$queryRaw<Array<{ month: number; count: bigint }>>`
      SELECT EXTRACT(MONTH FROM "date")::int AS month, COUNT(*) AS count
      FROM "JournalEntry"
      WHERE EXTRACT(YEAR FROM "date") = ${year}
      GROUP BY 1
    `;
    const countByMonth = new Map(entryCounts.map((r) => [r.month, Number(r.count)]));

    const months = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const row = byMonth.get(month);
      return {
        year,
        month,
        status: row?.status ?? 'OPEN',
        lockedAt: row?.lockedAt ?? null,
        lockedBy: row?.lockedBy ?? null,
        entryCount: countByMonth.get(month) ?? 0,
      };
    });

    res.json({ year, months });
  } catch (err) {
    next(err);
  }
});

// POST /api/fiscal-periods/lock — lock one month
router.post('/lock', requirePermission('fiscalperiods.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { year, month } = periodSchema.parse(req.body);
    const userId = req.user!.userId;

    const period = await prisma.fiscalPeriod.upsert({
      where: { year_month: { year, month } },
      update: { status: 'LOCKED', lockedAt: new Date(), lockedById: userId },
      create: { year, month, status: 'LOCKED', lockedAt: new Date(), lockedById: userId },
    });
    res.json(period);
  } catch (err) {
    next(err);
  }
});

// POST /api/fiscal-periods/unlock — reopen one month
router.post('/unlock', requirePermission('fiscalperiods.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { year, month } = periodSchema.parse(req.body);

    const period = await prisma.fiscalPeriod.upsert({
      where: { year_month: { year, month } },
      update: { status: 'OPEN', lockedAt: null, lockedById: null },
      create: { year, month, status: 'OPEN' },
    });
    res.json(period);
  } catch (err) {
    next(err);
  }
});

export default router;
