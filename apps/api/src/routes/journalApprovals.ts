/**
 * Journal Entry Approvals — سير الاعتماد (Maker-Checker)
 *
 * Manual journal entries are staged here as PENDING requests. Account balances
 * are only touched once a *different* user than the maker approves the request
 * (segregation of duties — the core point of maker-checker, not just an extra
 * permission gate).
 *
 * GET  /api/journal-approvals            — paginated list, optional ?status=
 * GET  /api/journal-approvals/:id        — request + lines
 * POST /api/journal-approvals            — maker submits a balanced request (accounts.create)
 * POST /api/journal-approvals/:id/approve — checker approves → posts the real journal entry (accounts.edit)
 * POST /api/journal-approvals/:id/reject  — checker rejects with a reason (accounts.edit)
 * DELETE /api/journal-approvals/:id       — maker cancels their own still-PENDING request
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { JournalSource, ApprovalStatus } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';
import { postJournalEntry, assertNoControlAccounts, CONTROL_ACCOUNT_ERROR } from '../lib/ledger';

const router = Router();
router.use(requireAuth);

const lineSchema = z.object({
  accountId: z.number().int().positive(),
  costCenterId: z.number().int().positive().optional().nullable(),
  debit: z.number().nonnegative().default(0),
  credit: z.number().nonnegative().default(0),
  description: z.string().optional().nullable(),
});

const createSchema = z.object({
  date: z.string().optional(),
  description: z.string().min(1),
  lines: z.array(lineSchema).min(2),
});

// GET /api/journal-approvals
router.get('/', requirePermission('accounts.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const status = req.query.status as ApprovalStatus | undefined;

    const where = status ? { status } : {};

    const [data, total] = await Promise.all([
      prisma.journalEntryApproval.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { id: 'desc' },
        include: {
          lines: { include: { account: { select: { code: true, nameAr: true } } } },
        },
      }),
      prisma.journalEntryApproval.count({ where }),
    ]);

    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// GET /api/journal-approvals/:id
router.get('/:id', requirePermission('accounts.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const request = await prisma.journalEntryApproval.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: {
        lines: { include: { account: { select: { id: true, code: true, nameAr: true } } } },
      },
    });
    res.json(request);
  } catch (err) {
    next(err);
  }
});

// POST /api/journal-approvals — maker submits a request (no ledger effect yet)
router.post('/', requirePermission('accounts.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createSchema.parse(req.body);
    const userId = req.user!.userId;

    const totalDebit = body.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = body.lines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.001) {
      res.status(400).json({ error: 'القيد غير متوازن' });
      return;
    }
    try {
      await assertNoControlAccounts(prisma, body.lines.map((l) => l.accountId));
    } catch {
      res.status(400).json({ error: CONTROL_ACCOUNT_ERROR });
      return;
    }

    const created = await prisma.journalEntryApproval.create({
      data: {
        description: body.description,
        date: body.date ? new Date(body.date) : new Date(),
        createdById: userId,
        lines: {
          create: body.lines.map((l) => ({
            accountId: l.accountId,
            costCenterId: l.costCenterId ?? null,
            debit: l.debit,
            credit: l.credit,
            description: l.description ?? null,
          })),
        },
      },
      include: { lines: { include: { account: { select: { code: true, nameAr: true } } } } },
    });

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PUT /api/journal-approvals/:id — maker edits their own request and (re)submits it.
// Works while PENDING (fixing before review) and after REJECTED (fix + resubmit):
// a rejected entry returns to PENDING with its rejection metadata cleared. The
// entry has never touched the ledger, so editing it is safe.
router.put('/:id', requirePermission('accounts.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const body = createSchema.parse(req.body);
    const userId = req.user!.userId;

    const existing = await prisma.journalEntryApproval.findUniqueOrThrow({ where: { id } });
    if (existing.createdById !== userId) {
      res.status(403).json({ error: 'يمكنك تعديل طلباتك الخاصة فقط' });
      return;
    }
    if (existing.status === 'APPROVED') {
      res.status(400).json({ error: 'لا يمكن تعديل قيد تم اعتماده وترحيله' });
      return;
    }

    const totalDebit = body.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = body.lines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.001) {
      res.status(400).json({ error: 'القيد غير متوازن' });
      return;
    }
    try {
      await assertNoControlAccounts(prisma, body.lines.map((l) => l.accountId));
    } catch {
      res.status(400).json({ error: CONTROL_ACCOUNT_ERROR });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.journalEntryApprovalLine.deleteMany({ where: { requestId: id } });
      return tx.journalEntryApproval.update({
        where: { id },
        data: {
          description: body.description,
          date: body.date ? new Date(body.date) : new Date(),
          // resubmit: back to PENDING, clear the prior review outcome
          status: 'PENDING',
          rejectReason: null,
          reviewedById: null,
          reviewedAt: null,
          lines: {
            create: body.lines.map((l) => ({
              accountId: l.accountId,
              costCenterId: l.costCenterId ?? null,
              debit: l.debit,
              credit: l.credit,
              description: l.description ?? null,
            })),
          },
        },
        include: { lines: { include: { account: { select: { code: true, nameAr: true } } } } },
      });
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/journal-approvals/:id/approve — checker approves → posts the real entry
router.post('/:id/approve', requirePermission('accounts.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.user!.userId;

    const request = await prisma.journalEntryApproval.findUniqueOrThrow({
      where: { id },
      include: { lines: true },
    });

    if (request.status !== 'PENDING') {
      res.status(400).json({ error: 'هذا الطلب تمت مراجعته مسبقاً' });
      return;
    }
    if (request.createdById === userId) {
      res.status(403).json({ error: 'لا يمكن اعتماد قيد أنشأته أنت بنفسك — يجب اعتماده من مستخدم آخر' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const entry = await postJournalEntry(tx, {
        date: request.date,
        description: request.description,
        sourceType: JournalSource.MANUAL,
        sourceId: null,
        createdById: request.createdById,
        lines: request.lines.map((l) => ({
          accountId: l.accountId,
          costCenterId: l.costCenterId,
          debit: Number(l.debit),
          credit: Number(l.credit),
          description: l.description,
        })),
      });

      return tx.journalEntryApproval.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewedById: userId,
          reviewedAt: new Date(),
          journalEntryId: entry.id,
        },
      });
    });

    res.json(updated);
  } catch (err: any) {
    if (err?.message?.includes('القيد غير متوازن')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// POST /api/journal-approvals/:id/reject
const rejectSchema = z.object({ reason: z.string().optional() });

router.post('/:id/reject', requirePermission('accounts.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.user!.userId;
    const body = rejectSchema.parse(req.body ?? {});

    const request = await prisma.journalEntryApproval.findUniqueOrThrow({ where: { id } });

    if (request.status !== 'PENDING') {
      res.status(400).json({ error: 'هذا الطلب تمت مراجعته مسبقاً' });
      return;
    }
    if (request.createdById === userId) {
      res.status(403).json({ error: 'لا يمكن مراجعة قيد أنشأته أنت بنفسك — يجب مراجعته من مستخدم آخر' });
      return;
    }

    const updated = await prisma.journalEntryApproval.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewedById: userId,
        reviewedAt: new Date(),
        rejectReason: body.reason ?? null,
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/journal-approvals/:id — maker cancels their own still-pending request
router.delete('/:id', requirePermission('accounts.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.user!.userId;

    const request = await prisma.journalEntryApproval.findUniqueOrThrow({ where: { id } });

    // Approved requests posted a real ledger entry — they are a permanent record.
    // Pending (cancel) and rejected (discard) requests may be removed by the maker.
    if (request.status === 'APPROVED') {
      res.status(400).json({ error: 'لا يمكن حذف قيد تم اعتماده وترحيله' });
      return;
    }
    if (request.createdById !== userId) {
      res.status(403).json({ error: 'يمكنك حذف طلباتك الخاصة فقط' });
      return;
    }

    await prisma.journalEntryApproval.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
