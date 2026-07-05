/**
 * التسوية البنكية — Bank Reconciliation
 *
 * A session matches journal lines on a bank/cash account against the real
 * bank statement. Cleared balance = account opening balance + net of every
 * reconciled line (this session's and all completed ones). A journal line
 * can be reconciled exactly once, ever (DB-unique).
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';

const router = Router();
router.use(requireAuth);

const round2 = (n: number) => Math.round(n * 100) / 100;

async function generateReconNo(tx: Prisma.TransactionClient, date: Date): Promise<string> {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const prefix = `BR-${y}${m}${d}-`;
  const last = await tx.bankReconciliation.findFirst({
    where: { reconNo: { startsWith: prefix } },
    orderBy: { reconNo: 'desc' },
    select: { reconNo: true },
  });
  const lastSeq = last ? parseInt(last.reconNo.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

/** Cleared book balance = opening + net (debit − credit) of the given reconciled line ids. */
async function computeClearedBalance(accountId: number, extraWhere: Prisma.JournalLineWhereInput): Promise<number> {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { openingBalance: true } });
  const agg = await prisma.journalLine.aggregate({
    where: { accountId, reconciliationLine: { isNot: null }, ...extraWhere },
    _sum: { debit: true, credit: true },
  });
  return round2(Number(account.openingBalance) + Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0));
}

const reconInclude = {
  account: { select: { id: true, code: true, nameAr: true } },
  lines: {
    include: {
      journalLine: {
        include: { entry: { select: { entryNo: true, date: true, description: true } } },
      },
    },
  },
};

// GET /api/bank-reconciliations
router.get('/', requirePermission('reconciliation.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const where: Record<string, unknown> = {};
    if (req.query.status) where.status = req.query.status;
    const [data, total] = await Promise.all([
      prisma.bankReconciliation.findMany({
        where, skip, take: pageSize, orderBy: { id: 'desc' },
        include: { account: { select: { id: true, code: true, nameAr: true } }, _count: { select: { lines: true } } },
      }),
      prisma.bankReconciliation.count({ where }),
    ]);
    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// GET /api/bank-reconciliations/:id — session + its matched lines
router.get('/:id', requirePermission('reconciliation.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const recon = await prisma.bankReconciliation.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: reconInclude,
    });
    res.json(recon);
  } catch (err) {
    next(err);
  }
});

// GET /api/bank-reconciliations/:id/unreconciled — candidate lines for matching
router.get('/:id/unreconciled', requirePermission('reconciliation.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const recon = await prisma.bankReconciliation.findUniqueOrThrow({ where: { id: parseInt(req.params.id) } });
    const lines = await prisma.journalLine.findMany({
      where: {
        accountId: recon.accountId,
        reconciliationLine: null, // not reconciled anywhere
        entry: { date: { lte: recon.statementDate } },
      },
      include: { entry: { select: { entryNo: true, date: true, description: true } } },
      orderBy: { entry: { date: 'asc' } },
    });
    res.json(lines.map((l) => ({
      id: l.id,
      entryNo: l.entry.entryNo,
      date: l.entry.date,
      description: l.description ?? l.entry.description,
      debit: Number(l.debit),
      credit: Number(l.credit),
    })));
  } catch (err) {
    next(err);
  }
});

// POST /api/bank-reconciliations — start a session
const createSchema = z.object({
  accountId: z.number().int().positive(),
  statementDate: z.string(),
  statementBalance: z.number(),
  notes: z.string().optional().nullable(),
});

router.post('/', requirePermission('reconciliation.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createSchema.parse(req.body);
    const userId = req.user!.userId;

    const account = await prisma.account.findUniqueOrThrow({ where: { id: body.accountId } });
    if (account.type !== 'ASSET') {
      res.status(400).json({ error: 'حساب التسوية يجب أن يكون حساب بنك/نقدية (أصل)' });
      return;
    }
    const openDraft = await prisma.bankReconciliation.findFirst({
      where: { accountId: body.accountId, status: 'DRAFT' },
    });
    if (openDraft) {
      res.status(400).json({ error: `توجد جلسة تسوية مفتوحة بالفعل لهذا الحساب (${openDraft.reconNo}) — أكملها أو احذفها أولاً` });
      return;
    }

    const created = await prisma.$transaction(async (tx) => {
      const reconNo = await generateReconNo(tx, new Date());
      return tx.bankReconciliation.create({
        data: {
          reconNo,
          accountId: body.accountId,
          statementDate: new Date(body.statementDate),
          statementBalance: new Prisma.Decimal(body.statementBalance),
          notes: body.notes ?? null,
          createdById: userId,
        },
        include: { account: { select: { id: true, code: true, nameAr: true } } },
      });
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PUT /api/bank-reconciliations/:id/lines — replace the matched set (DRAFT only)
const linesSchema = z.object({ journalLineIds: z.array(z.number().int().positive()) });

router.put('/:id/lines', requirePermission('reconciliation.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const body = linesSchema.parse(req.body);

    const result = await prisma.$transaction(async (tx) => {
      const recon = await tx.bankReconciliation.findUniqueOrThrow({ where: { id } });
      if (recon.status !== 'DRAFT') {
        throw new Error('لا يمكن تعديل تسوية مكتملة');
      }

      // every line must belong to the account, be dated within the statement,
      // and not be reconciled in another session
      if (body.journalLineIds.length) {
        const valid = await tx.journalLine.count({
          where: {
            id: { in: body.journalLineIds },
            accountId: recon.accountId,
            entry: { date: { lte: recon.statementDate } },
            OR: [{ reconciliationLine: null }, { reconciliationLine: { reconciliationId: id } }],
          },
        });
        if (valid !== body.journalLineIds.length) {
          throw new Error('بعض السطور غير صالحة للتسوية (حساب آخر، بعد تاريخ الكشف، أو مسوّاة مسبقاً)');
        }
      }

      await tx.bankReconciliationLine.deleteMany({ where: { reconciliationId: id } });
      if (body.journalLineIds.length) {
        await tx.bankReconciliationLine.createMany({
          data: body.journalLineIds.map((journalLineId) => ({ reconciliationId: id, journalLineId })),
        });
      }
      return tx.bankReconciliation.findUniqueOrThrow({ where: { id }, include: reconInclude });
    });

    // Live preview of the cleared balance including this session's picks
    const cleared = await computeClearedBalance(result.accountId, {});
    res.json({ ...result, clearedPreview: cleared, differencePreview: round2(Number(result.statementBalance) - cleared) });
  } catch (err: any) {
    if (typeof err?.message === 'string' && (err.message.includes('لا يمكن تعديل') || err.message.includes('غير صالحة'))) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// POST /api/bank-reconciliations/:id/complete
router.post('/:id/complete', requirePermission('reconciliation.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);

    const recon = await prisma.bankReconciliation.findUniqueOrThrow({ where: { id } });
    if (recon.status !== 'DRAFT') {
      res.status(400).json({ error: 'التسوية مكتملة بالفعل' });
      return;
    }

    const cleared = await computeClearedBalance(recon.accountId, {});
    const difference = round2(Number(recon.statementBalance) - cleared);

    const updated = await prisma.bankReconciliation.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        clearedBalance: new Prisma.Decimal(cleared),
        difference: new Prisma.Decimal(difference),
        completedAt: new Date(),
      },
      include: reconInclude,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/bank-reconciliations/:id — DRAFT only (frees its lines)
router.delete('/:id', requirePermission('reconciliation.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const recon = await prisma.bankReconciliation.findUniqueOrThrow({ where: { id } });
    if (recon.status !== 'DRAFT') {
      res.status(400).json({ error: 'لا يمكن حذف تسوية مكتملة — إنها سجل رقابي دائم' });
      return;
    }
    await prisma.bankReconciliation.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
