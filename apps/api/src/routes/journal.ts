/**
 * Journal routes — دفتر اليومية
 *
 * GET  /api/journal            — paginated list
 * GET  /api/journal/:id        — entry + lines with account details
 * POST /api/journal            — create manual balanced entry (accounts.create)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { JournalSource } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';
import { postJournalEntry, previewYearClose, closeFiscalYear, assertNoControlAccounts, CONTROL_ACCOUNT_ERROR } from '../lib/ledger';
import { parseDateRange } from '../lib/dateRange';

const router = Router();
router.use(requireAuth);

// GET /api/journal
router.get('/', requirePermission('journal.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const sourceType = req.query.sourceType as JournalSource | undefined;

    const where: Record<string, unknown> = {};
    const dateRange = parseDateRange(
      req.query.from as string | undefined,
      req.query.to   as string | undefined,
    );
    if (dateRange) where.date = dateRange;
    if (sourceType) where.sourceType = sourceType;

    const [data, total] = await Promise.all([
      prisma.journalEntry.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          entryNo: true,
          date: true,
          description: true,
          sourceType: true,
          sourceId: true,
          totalDebit: true,
          totalCredit: true,
          createdAt: true,
        },
      }),
      prisma.journalEntry.count({ where }),
    ]);

    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// GET /api/journal/close-year/preview — preview what the closing entry would look like
// (registered before /:id so "close-year" is never parsed as an entry id)
router.get('/close-year/preview', requirePermission('journal.view'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const preview = await previewYearClose(prisma);
    res.json(preview);
  } catch (err) {
    next(err);
  }
});

// POST /api/journal/close-year — commit the year-end closing entry
const closeYearSchema = z.object({
  date: z.string(),
});

router.post('/close-year', requirePermission('journal.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = closeYearSchema.parse(req.body);
    const userId = req.user!.userId;

    const created = await prisma.$transaction(async (tx) => {
      return closeFiscalYear(tx, { date: new Date(body.date), createdById: userId });
    });

    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        lines: { include: { account: { select: { id: true, code: true, nameAr: true } } } },
      },
    });

    res.status(201).json(entry);
  } catch (err: any) {
    if (err?.message?.includes('لا توجد أرصدة لإقفالها')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// GET /api/journal/:id
router.get('/:id', requirePermission('journal.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: {
        lines: {
          include: {
            account: { select: { id: true, code: true, nameAr: true, type: true } },
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

// POST /api/journal — manual balanced entry
const manualLineSchema = z.object({
  accountId: z.number().int().positive().optional(),
  accountCode: z.string().optional(),
  costCenterId: z.number().int().positive().optional().nullable(),
  debit:  z.number().nonnegative().default(0),
  credit: z.number().nonnegative().default(0),
  description: z.string().optional().nullable(),
});

const manualEntrySchema = z.object({
  date:        z.string().optional(),
  description: z.string().min(1),
  lines:       z.array(manualLineSchema).min(2),
});

router.post('/', requirePermission('journal.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body   = manualEntrySchema.parse(req.body);
    const userId = req.user!.userId;
    const date   = body.date ? new Date(body.date) : new Date();

    const created = await prisma.$transaction(async (tx) => {
      await assertNoControlAccounts(tx, body.lines.map((l) => l.accountId).filter((x): x is number => x != null));
      return postJournalEntry(tx, {
        date,
        description: body.description,
        sourceType:  JournalSource.MANUAL,
        sourceId:    null,
        createdById: userId,
        lines: body.lines,
      });
    });

    // Re-fetch by the exact id we just created — never ambiguous, unlike findFirst+orderBy.
    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        lines: {
          include: { account: { select: { id: true, code: true, nameAr: true } } },
        },
      },
    });

    res.status(201).json(entry);
  } catch (err: any) {
    if (err?.message?.includes('القيد غير متوازن') || err?.message === CONTROL_ACCOUNT_ERROR) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

export default router;
