import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { JournalSource } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';
import { postJournalEntry } from '../lib/ledger';

const router = Router();
router.use(requireAuth);

const lineSchema = z.object({
  accountId: z.number().int().positive(),
  costCenterId: z.number().int().positive().optional().nullable(),
  debit: z.number().nonnegative().default(0),
  credit: z.number().nonnegative().default(0),
  description: z.string().optional().nullable(),
});

const templateSchema = z.object({
  description: z.string().min(1),
  dayOfMonth: z.number().int().min(1).max(28).default(1),
  startDate: z.string().optional(),
  endDate: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  lines: z.array(lineSchema).min(2),
});

function nextDueDate(startDate: Date, dayOfMonth: number, lastRunDate: Date | null): Date {
  const base = lastRunDate ?? startDate;
  const next = new Date(base.getFullYear(), base.getMonth() + (lastRunDate ? 1 : 0), dayOfMonth);
  if (!lastRunDate && next < startDate) {
    next.setMonth(next.getMonth() + 1);
  }
  return next;
}

// GET /api/recurring-entries
router.get('/', requirePermission('accounts.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, search, skip } = getPagination(req);
    const where = search ? { description: { contains: search, mode: 'insensitive' as const } } : {};

    const [data, total] = await Promise.all([
      prisma.recurringEntry.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { id: 'desc' },
        include: { lines: { include: { account: { select: { code: true, nameAr: true } } } } },
      }),
      prisma.recurringEntry.count({ where }),
    ]);

    const rows = data.map((r) => ({
      ...r,
      nextDueDate: nextDueDate(r.startDate, r.dayOfMonth, r.lastRunDate),
    }));

    res.json(paginatedResponse(rows, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// POST /api/recurring-entries
router.post('/', requirePermission('accounts.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = templateSchema.parse(req.body);
    const userId = req.user!.userId;

    const totalDebit = body.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = body.lines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.001) {
      res.status(400).json({ error: 'القيد غير متوازن' });
      return;
    }

    const created = await prisma.recurringEntry.create({
      data: {
        description: body.description,
        dayOfMonth: body.dayOfMonth,
        startDate: body.startDate ? new Date(body.startDate) : new Date(),
        endDate: body.endDate ? new Date(body.endDate) : null,
        isActive: body.isActive ?? true,
        createdById: userId,
        lines: { create: body.lines },
      },
      include: { lines: { include: { account: { select: { code: true, nameAr: true } } } } },
    });

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PUT /api/recurring-entries/:id — replaces the template's fields and lines wholesale
router.put('/:id', requirePermission('accounts.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const body = templateSchema.parse(req.body);

    const totalDebit = body.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = body.lines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.001) {
      res.status(400).json({ error: 'القيد غير متوازن' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.recurringEntryLine.deleteMany({ where: { recurringEntryId: id } });
      return tx.recurringEntry.update({
        where: { id },
        data: {
          description: body.description,
          dayOfMonth: body.dayOfMonth,
          startDate: body.startDate ? new Date(body.startDate) : undefined,
          endDate: body.endDate ? new Date(body.endDate) : null,
          isActive: body.isActive ?? true,
          lines: { create: body.lines },
        },
        include: { lines: { include: { account: { select: { code: true, nameAr: true } } } } },
      });
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/recurring-entries/:id
router.delete('/:id', requirePermission('accounts.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.recurringEntry.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ success: true });
  } catch (err: any) {
    if (err?.code === 'P2003' || err?.code === 'P2014') {
      res.status(400).json({ error: 'لا يمكن الحذف لارتباطه بسجلات أخرى' });
      return;
    }
    next(err);
  }
});

// POST /api/recurring-entries/:id/run — generate one actual journal entry from the template
const runSchema = z.object({ date: z.string().optional() });

router.post('/:id/run', requirePermission('accounts.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const body = runSchema.parse(req.body ?? {});
    const userId = req.user!.userId;
    const date = body.date ? new Date(body.date) : new Date();

    const template = await prisma.recurringEntry.findUniqueOrThrow({
      where: { id },
      include: { lines: true },
    });

    const created = await prisma.$transaction(async (tx) => {
      const entry = await postJournalEntry(tx, {
        date,
        description: template.description,
        sourceType: JournalSource.RECURRING,
        sourceId: template.id,
        createdById: userId,
        lines: template.lines.map((l) => ({
          accountId: l.accountId,
          costCenterId: l.costCenterId,
          debit: Number(l.debit),
          credit: Number(l.credit),
          description: l.description,
        })),
      });
      await tx.recurringEntry.update({ where: { id }, data: { lastRunDate: date } });
      return entry;
    });

    const full = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: created.id },
      include: { lines: { include: { account: { select: { code: true, nameAr: true } } } } },
    });

    res.status(201).json(full);
  } catch (err: any) {
    if (err?.message?.includes('القيد غير متوازن')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

export default router;
