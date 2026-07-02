import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { JournalSource } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';
import { postJournalEntry, reverseJournalEntryBySource, ACCT } from '../lib/ledger';
import { parseDateRange } from '../lib/dateRange';

const router = Router();
router.use(requireAuth);

const createExpenseSchema = z.object({
  accountId: z.number().int().positive().optional().nullable(),
  costCenterId: z.number().int().positive().optional().nullable(),
  amount: z.number().positive(),
  date: z.string().optional(),
  description: z.string().optional().nullable(),
});

// GET /api/expenses
router.get('/', requirePermission('accounts.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, skip } = getPagination(req);

    const where: Record<string, unknown> = {};
    const dateRange = parseDateRange(
      req.query.from as string | undefined,
      req.query.to   as string | undefined,
    );
    if (dateRange) where.date = dateRange;

    const [data, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { date: 'desc' },
        include: { account: { select: { id: true, code: true, nameAr: true } } },
      }),
      prisma.expense.count({ where }),
    ]);

    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// GET /api/expenses/:id
router.get('/:id', requirePermission('accounts.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const expense = await prisma.expense.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: { account: true },
    });
    res.json(expense);
  } catch (err) {
    next(err);
  }
});

// POST /api/expenses
router.post('/', requirePermission('accounts.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createExpenseSchema.parse(req.body);
    const userId = req.user!.userId;

    const expense = await prisma.$transaction(async (tx) => {
      const expDate = body.date ? new Date(body.date) : new Date();

      const exp = await tx.expense.create({
        data: {
          accountId: body.accountId ?? null,
          amount: body.amount,
          date: expDate,
          description: body.description ?? null,
        },
      });

      // Post ledger entry: Dr expense account (or 6000 general), Cr 1000 cash
      const debitAccountCode = body.accountId ? undefined : ACCT.GEN_EXPENSE;
      const lineDescription = body.description ?? 'مصروف';

      await postJournalEntry(tx, {
        date: expDate,
        description: lineDescription,
        sourceType: JournalSource.EXPENSE,
        sourceId: exp.id,
        createdById: userId,
        lines: [
          // Dr: expense account (by id if provided, else code 6000)
          {
            accountId: body.accountId ?? undefined,
            accountCode: debitAccountCode,
            costCenterId: body.costCenterId ?? null,
            debit: body.amount,
            credit: 0,
            description: lineDescription,
          },
          // Cr: 1000 cash
          { accountCode: ACCT.CASH, debit: 0, credit: body.amount, description: lineDescription },
        ],
      });

      return exp;
    });

    const full = await prisma.expense.findUniqueOrThrow({
      where: { id: expense.id },
      include: { account: true },
    });

    res.status(201).json(full);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/expenses/:id
router.delete('/:id', requirePermission('accounts.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.$transaction(async (tx) => {
      await reverseJournalEntryBySource(tx, JournalSource.EXPENSE, id);
      await tx.expense.delete({ where: { id } });
    });
    res.json({ success: true });
  } catch (err: any) {
    if (err?.code === 'P2003' || err?.code === 'P2014') {
      res.status(400).json({ error: 'لا يمكن الحذف لارتباطه بسجلات أخرى' });
      return;
    }
    next(err);
  }
});

export default router;
