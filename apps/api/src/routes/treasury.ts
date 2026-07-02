import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { parseDateRange } from '../lib/dateRange';

const router = Router();
router.use(requireAuth);

// ── GET /api/treasury/accounts — cash & bank accounts for the treasury picker ─
router.get('/accounts', requirePermission('treasury.view'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Cash (1000) and Bank (1100) — Asset accounts in that code family.
    const accounts = await prisma.account.findMany({
      where: {
        type: 'ASSET',
        code: { in: ['1000', '1100'] },
      },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, nameAr: true, currentBalance: true },
    });

    res.json({ data: accounts });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/treasury/cash-movement — opening + lines + closing for a treasury account
router.get('/cash-movement', requirePermission('treasury.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accountId = parseInt(req.query.accountId as string);
    if (!Number.isFinite(accountId) || accountId <= 0) {
      res.status(400).json({ error: 'accountId مطلوب' });
      return;
    }

    const dateRange = parseDateRange(req.query.from as string | undefined, req.query.to as string | undefined);

    const account = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      select: { id: true, code: true, nameAr: true, type: true, openingBalance: true },
    });

    const isDebitNorm = account.type === 'ASSET' || account.type === 'EXPENSE';

    // Opening balance = openingBalance + Σ(all lines BEFORE the range start)
    let opening = Number(account.openingBalance);
    if (dateRange) {
      const beforeAgg = await prisma.journalLine.aggregate({
        where: {
          accountId,
          entry: { date: { lt: dateRange.gte } },
        },
        _sum: { debit: true, credit: true },
      });
      const totalDebit = Number(beforeAgg._sum.debit ?? 0);
      const totalCredit = Number(beforeAgg._sum.credit ?? 0);
      opening += isDebitNorm ? totalDebit - totalCredit : totalCredit - totalDebit;
    }

    // Lines within the range
    const linesWhere: Record<string, unknown> = { accountId };
    if (dateRange) {
      linesWhere.entry = { date: { gte: dateRange.gte, lte: dateRange.lte } };
    }

    const lines = await prisma.journalLine.findMany({
      where: linesWhere,
      include: {
        entry: { select: { id: true, entryNo: true, date: true, description: true, sourceType: true } },
      },
      orderBy: [{ entry: { date: 'asc' } }, { id: 'asc' }],
    });

    let running = opening;
    const movementLines = lines.map((line) => {
      const debit = Number(line.debit);
      const credit = Number(line.credit);
      const effect = isDebitNorm ? debit - credit : credit - debit;
      running += effect;
      return {
        journalLineId: line.id,
        entryId: line.entry.id,
        entryNo: line.entry.entryNo,
        refNo: line.entry.entryNo,
        date: line.entry.date,
        description: line.description ?? line.entry.description,
        sourceType: line.entry.sourceType,
        debit,
        credit,
        balance: running,
      };
    });

    res.json({
      account: {
        id: account.id,
        code: account.code,
        nameAr: account.nameAr,
        type: account.type,
        openingBalance: Number(account.openingBalance),
      },
      opening,
      closing: running,
      lines: movementLines,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
