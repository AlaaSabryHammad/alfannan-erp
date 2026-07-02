import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma, JournalSource, NoteType, NoteStatus } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';
import { parseDateRange } from '../lib/dateRange';
import { postJournalEntry, reverseJournalEntryBySource, ACCT } from '../lib/ledger';

const router = Router();
router.use(requireAuth);

// ── Zod schemas ───────────────────────────────────────────────────────────────
const createNoteSchema = z.object({
  noteNo: z.string().optional(), // auto-generated if omitted
  type: z.enum(['RECEIVABLE', 'PAYABLE']),
  instrumentType: z.enum(['PROMISSORY_NOTE', 'CHEQUE']).optional().default('PROMISSORY_NOTE'),
  bankName: z.string().optional().nullable(),
  partyType: z.enum(['CUSTOMER', 'SUPPLIER', 'ACCOUNT']),
  partyId: z.number().int().positive().optional().nullable(),
  amount: z.number().positive(),
  issueDate: z.string().optional(),
  dueDate: z.string(),
  description: z.string().optional().nullable(),
});

const bounceNoteSchema = z.object({
  reason: z.string().optional().nullable(),
});

const settleNoteSchema = z.object({
  treasuryAccountId: z.number().int().positive(),
  date: z.string().optional(),
});

/** Build a Note number: PN-YYYYMMDD-NNNN for promissory notes, CHQ-YYYYMMDD-NNNN for cheques. */
async function generateNoteNo(
  tx: Prisma.TransactionClient,
  date: Date,
  instrumentType: 'PROMISSORY_NOTE' | 'CHEQUE' = 'PROMISSORY_NOTE',
): Promise<string> {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const prefix = `${instrumentType === 'CHEQUE' ? 'CHQ' : 'PN'}-${y}${m}${d}-`;
  const count = await tx.promissoryNote.count({ where: { noteNo: { startsWith: prefix } } });
  const seq = String(count + 1).padStart(4, '0');
  return `${prefix}${seq}`;
}

/** Resolve party display names for a list of notes. */
async function resolvePartyNames(notes: Array<{ partyType: string | null; partyId: number | null }>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const customerIds = new Set<number>();
  const supplierIds = new Set<number>();
  const accountIds = new Set<number>();

  for (const n of notes) {
    if (!n.partyType || !n.partyId) continue;
    if (n.partyType === 'CUSTOMER') customerIds.add(n.partyId);
    else if (n.partyType === 'SUPPLIER') supplierIds.add(n.partyId);
    else accountIds.add(n.partyId);
  }

  const [customers, suppliers, accounts] = await Promise.all([
    customerIds.size ? prisma.customer.findMany({ where: { id: { in: [...customerIds] } }, select: { id: true, nameAr: true } }) : [],
    supplierIds.size ? prisma.supplier.findMany({ where: { id: { in: [...supplierIds] } }, select: { id: true, nameAr: true } }) : [],
    accountIds.size ? prisma.account.findMany({ where: { id: { in: [...accountIds] } }, select: { id: true, nameAr: true } }) : [],
  ]);

  for (const c of customers) out.set(`CUSTOMER:${c.id}`, c.nameAr);
  for (const s of suppliers) out.set(`SUPPLIER:${s.id}`, s.nameAr);
  for (const a of accounts) out.set(`ACCOUNT:${a.id}`, a.nameAr);
  return out;
}

// ── GET /api/promissory-notes — list ──────────────────────────────────────────
router.get('/', requirePermission('treasury.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, skip, search } = getPagination(req);
    const typeFilter = req.query.type as NoteType | undefined;
    const statusFilter = req.query.status as NoteStatus | undefined;
    const instrumentTypeFilter = req.query.instrumentType as string | undefined;
    const dateRange = parseDateRange(req.query.from as string | undefined, req.query.to as string | undefined);

    const where: Record<string, unknown> = {};
    if (typeFilter) where.type = typeFilter;
    if (statusFilter) where.status = statusFilter;
    if (instrumentTypeFilter) where.instrumentType = instrumentTypeFilter;
    if (dateRange) where.dueDate = dateRange;
    if (search) {
      where.OR = [
        { noteNo: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.promissoryNote.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ dueDate: 'asc' }, { id: 'desc' }],
      }),
      prisma.promissoryNote.count({ where }),
    ]);

    const partyNames = await resolvePartyNames(data);
    const rows = data.map((n) => ({ ...n, partyName: partyNames.get(`${n.partyType}:${n.partyId}`) ?? null }));

    res.json(paginatedResponse(rows, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// ── GET /api/promissory-notes/:id ─────────────────────────────────────────────
router.get('/:id', requirePermission('treasury.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const note = await prisma.promissoryNote.findUniqueOrThrow({ where: { id } });

    let partyName: string | null = null;
    if (note.partyType && note.partyId) {
      if (note.partyType === 'CUSTOMER') {
        const c = await prisma.customer.findUnique({ where: { id: note.partyId }, select: { nameAr: true } });
        partyName = c?.nameAr ?? null;
      } else if (note.partyType === 'SUPPLIER') {
        const s = await prisma.supplier.findUnique({ where: { id: note.partyId }, select: { nameAr: true } });
        partyName = s?.nameAr ?? null;
      } else {
        const a = await prisma.account.findUnique({ where: { id: note.partyId }, select: { nameAr: true } });
        partyName = a?.nameAr ?? null;
      }
    }
    res.json({ ...note, partyName });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/promissory-notes ────────────────────────────────────────────────
router.post('/', requirePermission('treasury.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createNoteSchema.parse(req.body);
    const userId = req.user!.userId;
    const issueDate = body.issueDate ? new Date(body.issueDate) : new Date();
    const dueDate = new Date(body.dueDate);

    const note = await prisma.$transaction(async (tx) => {
      const noteNo = body.noteNo?.trim() || (await generateNoteNo(tx, issueDate, body.instrumentType));
      return tx.promissoryNote.create({
        data: {
          noteNo,
          type: body.type,
          instrumentType: body.instrumentType,
          bankName: body.bankName ?? null,
          partyType: body.partyType,
          partyId: body.partyId ?? null,
          amount: new Prisma.Decimal(body.amount),
          issueDate,
          dueDate,
          status: 'PENDING',
          description: body.description ?? null,
          createdById: userId,
        },
      });
    });

    res.status(201).json(note);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      res.status(400).json({ error: 'رقم الكمبيالة مستخدم مسبقاً' });
      return;
    }
    next(err);
  }
});

// ── POST /api/promissory-notes/:id/settle — collect (RECEIVABLE) or pay (PAYABLE)
router.post('/:id/settle', requirePermission('treasury.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const body = settleNoteSchema.parse(req.body);
    const userId = req.user!.userId;
    const settleDate = body.date ? new Date(body.date) : new Date();

    const result = await prisma.$transaction(async (tx) => {
      const note = await tx.promissoryNote.findUniqueOrThrow({ where: { id } });
      if (note.status !== 'PENDING') {
        throw new Error('الكمبيالة ليست قيد الانتظار');
      }
      const amount = Number(note.amount);

      const treasury = await tx.account.findUniqueOrThrow({
        where: { id: body.treasuryAccountId },
        select: { id: true, code: true, type: true },
      });
      if (treasury.type !== 'ASSET') {
        throw new Error('حساب الخزينة يجب أن يكون أصلاً');
      }

      const y = settleDate.getFullYear();
      const m = String(settleDate.getMonth() + 1).padStart(2, '0');
      const d = String(settleDate.getDate()).padStart(2, '0');
      const dateTag = `${y}${m}${d}`;
      const prefix = note.type === 'RECEIVABLE' ? `RV-${dateTag}-` : `PV-${dateTag}-`;
      const count = await tx.voucher.count({ where: { voucherNo: { startsWith: prefix } } });
      const voucherNo = `${prefix}${String(count + 1).padStart(4, '0')}`;

      const v = await tx.voucher.create({
        data: {
          voucherNo,
          type: note.type === 'RECEIVABLE' ? 'RECEIPT' : 'PAYMENT',
          date: settleDate,
          treasuryAccountId: treasury.id,
          partyType: note.partyType,
          partyId: note.partyId,
          description: `تسوية كمبيالة ${note.noteNo}`,
          totalAmount: new Prisma.Decimal(amount),
          createdById: userId,
          lines: {
            create: [
              {
                accountId: note.type === 'RECEIVABLE'
                  ? (await tx.account.findUniqueOrThrow({ where: { code: ACCT.AR }, select: { id: true } })).id
                  : (await tx.account.findUniqueOrThrow({ where: { code: ACCT.AP }, select: { id: true } })).id,
                amount: new Prisma.Decimal(amount),
                description: `تسوية كمبيالة ${note.noteNo}`,
              },
            ],
          },
        },
      });

      // Ledger lines
      const ledgerLines = note.type === 'RECEIVABLE'
        ? [
            { accountCode: treasury.code, debit: amount, credit: 0, description: `تحصيل كمبيالة ${note.noteNo}` },
            { accountCode: ACCT.AR, debit: 0, credit: amount, description: `تحصيل كمبيالة ${note.noteNo}` },
          ]
        : [
            { accountCode: ACCT.AP, debit: amount, credit: 0, description: `سداد كمبيالة ${note.noteNo}` },
            { accountCode: treasury.code, debit: 0, credit: amount, description: `سداد كمبيالة ${note.noteNo}` },
          ];

      await postJournalEntry(tx, {
        date: settleDate,
        description: `تسوية كمبيالة ${note.noteNo}`,
        sourceType: JournalSource.VOUCHER,
        sourceId: v.id,
        createdById: userId,
        lines: ledgerLines,
      });

      // Party balance adjustment
      if (note.partyType === 'CUSTOMER' && note.partyId && note.type === 'RECEIVABLE') {
        await tx.customer.update({ where: { id: note.partyId }, data: { currentBalance: { decrement: new Prisma.Decimal(amount) } } });
      } else if (note.partyType === 'SUPPLIER' && note.partyId && note.type === 'PAYABLE') {
        await tx.supplier.update({ where: { id: note.partyId }, data: { currentBalance: { decrement: new Prisma.Decimal(amount) } } });
      }

      // Mark note settled
      const updated = await tx.promissoryNote.update({
        where: { id },
        data: { status: 'SETTLED', settledVoucherId: v.id },
      });

      return { note: updated, voucher: v };
    });

    res.json(result);
  } catch (err: any) {
    if (typeof err?.message === 'string' && err.message.includes('القيد غير متوازن')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// ── POST /api/promissory-notes/:id/bounce — mark a cheque/note as bounced ────
// No money ever moved for a bounced instrument (it was never actually
// collected/paid), so unlike /settle this has no ledger or party-balance effect
// — it's purely a status flag so the outstanding receivable/payable stays open.
router.post('/:id/bounce', requirePermission('treasury.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const body = bounceNoteSchema.parse(req.body ?? {});

    const note = await prisma.promissoryNote.findUniqueOrThrow({ where: { id } });
    if (note.status !== 'PENDING') {
      res.status(400).json({ error: 'لا يمكن ارتجاع سند ليس قيد الانتظار' });
      return;
    }

    const updated = await prisma.promissoryNote.update({
      where: { id },
      data: {
        status: 'BOUNCED',
        description: body.reason
          ? `${note.description ?? ''}${note.description ? ' — ' : ''}سبب الارتجاع: ${body.reason}`
          : note.description,
      },
    });

    res.json(updated);
  } catch (err: any) {
    if (typeof err?.message === 'string' && err.message.includes('لا يمكن ارتجاع')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// ── DELETE /api/promissory-notes/:id ──────────────────────────────────────────
router.delete('/:id', requirePermission('treasury.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.$transaction(async (tx) => {
      const note = await tx.promissoryNote.findUniqueOrThrow({ where: { id } });

      if (note.status === 'SETTLED' && note.settledVoucherId) {
        // Reverse the settling voucher (ledger + party) then delete the voucher
        const v = await tx.voucher.findUniqueOrThrow({ where: { id: note.settledVoucherId } });
        const amt = Number(v.totalAmount);
        if (v.partyType === 'CUSTOMER' && v.partyId) {
          await tx.customer.update({ where: { id: v.partyId }, data: { currentBalance: { increment: new Prisma.Decimal(amt) } } });
        } else if (v.partyType === 'SUPPLIER' && v.partyId) {
          await tx.supplier.update({ where: { id: v.partyId }, data: { currentBalance: { increment: new Prisma.Decimal(amt) } } });
        }
        await reverseJournalEntryBySource(tx, JournalSource.VOUCHER, v.id);
        await tx.voucher.delete({ where: { id: v.id } });
      }

      await tx.promissoryNote.delete({ where: { id } });
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
