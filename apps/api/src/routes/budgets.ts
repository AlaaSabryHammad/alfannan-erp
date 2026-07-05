import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

// GET /api/budgets/grid?year=2026
// One row per REVENUE/EXPENSE account with its 12 monthly budget amounts
// (account-level only — costCenterId is always null from this endpoint).
router.get('/grid', requirePermission('budgets.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const year = parseInt(req.query.year as string) || new Date().getFullYear();

    const accounts = await prisma.account.findMany({
      where: { type: { in: ['REVENUE', 'EXPENSE'] } },
      orderBy: { code: 'asc' },
    });

    const budgetRows = await prisma.budget.findMany({
      where: { year, costCenterId: null, accountId: { in: accounts.map((a) => a.id) } },
    });

    const byAccount = new Map<number, number[]>();
    for (const row of budgetRows) {
      const months = byAccount.get(row.accountId) ?? Array(12).fill(0);
      months[row.month - 1] = Number(row.amount);
      byAccount.set(row.accountId, months);
    }

    const rows = accounts.map((a) => ({
      accountId: a.id,
      code: a.code,
      nameAr: a.nameAr,
      type: a.type,
      months: byAccount.get(a.id) ?? Array(12).fill(0),
      total: (byAccount.get(a.id) ?? Array(12).fill(0)).reduce((s, v) => s + v, 0),
    }));

    res.json({ year, rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/budgets/grid — upsert the 12 monthly amounts for one account/year
const gridSaveSchema = z.object({
  accountId: z.number().int().positive(),
  year: z.number().int().min(2000).max(2100),
  months: z.array(z.number().nonnegative()).length(12),
});

router.post('/grid', requirePermission('budgets.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = gridSaveSchema.parse(req.body);

    // Prisma's composite-unique lookup type doesn't accept `null` for a nullable
    // field, so upsert-by-compound-key isn't usable here — find-then-write instead.
    await prisma.$transaction(async (tx) => {
      for (const [idx, amount] of body.months.entries()) {
        const month = idx + 1;
        const existing = await tx.budget.findFirst({
          where: { accountId: body.accountId, costCenterId: null, year: body.year, month },
        });
        if (existing) {
          await tx.budget.update({ where: { id: existing.id }, data: { amount } });
        } else {
          await tx.budget.create({ data: { accountId: body.accountId, year: body.year, month, amount } });
        }
      }
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
