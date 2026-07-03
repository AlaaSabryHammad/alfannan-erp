import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma, JournalSource, VoucherType, PartyType } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';
import { parseDateRange } from '../lib/dateRange';
import { postJournalEntry, reverseJournalEntryBySource, ACCT } from '../lib/ledger';
import { runWithRetry } from '../lib/retry';
import {
  getSalesInvoiceSettlement,
  getPurchaseInvoiceSettlement,
  recomputeSalesInvoiceStatus,
  recomputePurchaseInvoiceStatus,
} from '../lib/settlement';

const router = Router();
router.use(requireAuth);

// ── Types ─────────────────────────────────────────────────────────────────────
type VoucherTypeT = keyof typeof VoucherType;

const VOUCHER_PREFIX: Record<VoucherTypeT, string> = {
  RECEIPT: 'RV',
  PAYMENT: 'PV',
  DISCOUNT: 'DV',
  DEPOSIT: 'BD',
};

// ── Zod schemas ───────────────────────────────────────────────────────────────
const voucherLineSchema = z.object({
  accountId: z.number().int().positive(),
  amount: z.number().positive(),
  description: z.string().optional().nullable(),
});

const createVoucherSchema = z.object({
  type: z.enum(['RECEIPT', 'PAYMENT', 'DISCOUNT', 'DEPOSIT']),
  date: z.string().optional(),
  treasuryAccountId: z.number().int().positive(),
  partyType: z.enum(['CUSTOMER', 'SUPPLIER', 'ACCOUNT']).optional().nullable(),
  partyId: z.number().int().positive().optional().nullable(),
  /** when set, this payment is applied against a specific invoice and updates its paidStatus */
  salesInvoiceId: z.number().int().positive().optional().nullable(),
  purchaseInvoiceId: z.number().int().positive().optional().nullable(),
  description: z.string().optional().nullable(),
  amount: z.number().positive().optional(), // simple mode total (used when no lines)
  lines: z.array(voucherLineSchema).optional(), // compound mode
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a Voucher number: {RV|PV|DV|BD}-YYYYMMDD-NNNN (count-based sequence). */
async function generateVoucherNo(
  tx: Prisma.TransactionClient,
  type: VoucherTypeT,
  date: Date,
): Promise<string> {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const prefix = `${VOUCHER_PREFIX[type]}-${y}${m}${d}-`;
  // max + 1 (not count + 1): vouchers are deletable, and a count-based sequence
  // would re-issue a number that still exists → unique-constraint failure.
  const last = await tx.voucher.findFirst({
    where: { voucherNo: { startsWith: prefix } },
    orderBy: { voucherNo: 'desc' },
    select: { voucherNo: true },
  });
  const lastSeq = last ? parseInt(last.voucherNo.slice(prefix.length), 10) || 0 : 0;
  const seq = String(lastSeq + 1).padStart(4, '0');
  return `${prefix}${seq}`;
}

/**
 * Resolve the treasury (cash/bank) account code from its id.
 * Returns the account code so it can be used in ledger lines.
 */
async function getTreasuryCode(tx: Prisma.TransactionClient, accountId: number): Promise<string> {
  const acct = await tx.account.findUniqueOrThrow({
    where: { id: accountId },
    select: { code: true, type: true },
  });
  if (acct.type !== 'ASSET') {
    throw new Error('حساب الخزينة يجب أن يكون أصلاً (نقدية/بنك)');
  }
  return acct.code;
}

/**
 * Reverse a party-balance change made when the voucher was created.
 * Reads the voucher to know partyType/partyId/type/totalAmount and applies the opposite delta.
 *
 * Must mirror the creation logic exactly: creation only decrements the balance
 * for CUSTOMER + (RECEIPT|DISCOUNT) and SUPPLIER + (PAYMENT|DISCOUNT). Any other
 * combination (e.g. a PAYMENT refund to a customer) never touched the balance,
 * so reversing it here would corrupt the balance.
 */
async function reversePartyBalance(tx: Prisma.TransactionClient, voucherId: number): Promise<void> {
  const v = await tx.voucher.findUniqueOrThrow({ where: { id: voucherId } });
  const amount = Number(v.totalAmount);
  if (amount === 0 || !v.partyType || !v.partyId) return;

  // RECEIPT against customer originally decremented AR; reverse → increment
  // PAYMENT against supplier originally decremented AP; reverse → increment
  // DISCOUNT customer originally decremented AR; reverse → increment
  // DISCOUNT supplier originally decremented AP; reverse → increment
  const inc = { increment: new Prisma.Decimal(amount) };
  if (v.partyType === 'CUSTOMER' && (v.type === 'RECEIPT' || v.type === 'DISCOUNT')) {
    await tx.customer.update({ where: { id: v.partyId }, data: { currentBalance: inc } });
  } else if (v.partyType === 'SUPPLIER' && (v.type === 'PAYMENT' || v.type === 'DISCOUNT')) {
    await tx.supplier.update({ where: { id: v.partyId }, data: { currentBalance: inc } });
  }
}

// ── GET /api/vouchers — list ──────────────────────────────────────────────────
router.get('/', requirePermission('treasury.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, skip, search } = getPagination(req);
    const typeFilter = req.query.type as VoucherType | undefined;
    const dateRange = parseDateRange(req.query.from as string | undefined, req.query.to as string | undefined);

    const where: Record<string, unknown> = {};
    if (typeFilter) where.type = typeFilter;
    if (dateRange) where.date = dateRange;
    if (req.query.branchId) where.branchId = parseInt(req.query.branchId as string);
    if (search) {
      where.OR = [
        { voucherNo: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.voucher.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        include: {
          treasuryAccount: { select: { id: true, code: true, nameAr: true } },
        },
      }),
      prisma.voucher.count({ where }),
    ]);

    // Resolve party names (customers/suppliers/accounts) in JS to avoid polymorphic joins
    const partyNames = await resolvePartyNames(data);

    const rows = data.map((v) => ({
      ...v,
      partyName: partyNames.get(`${v.partyType}:${v.partyId}`) ?? null,
    }));

    res.json(paginatedResponse(rows, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

/** Bulk-resolve party display names for a list of vouchers. */
async function resolvePartyNames(vouchers: Array<{ partyType: PartyType | null; partyId: number | null }>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const customerIds = new Set<number>();
  const supplierIds = new Set<number>();
  const accountIds = new Set<number>();

  for (const v of vouchers) {
    if (!v.partyType || !v.partyId) continue;
    if (v.partyType === 'CUSTOMER') customerIds.add(v.partyId);
    else if (v.partyType === 'SUPPLIER') supplierIds.add(v.partyId);
    else accountIds.add(v.partyId);
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

// ── GET /api/vouchers/:id — detail ────────────────────────────────────────────
router.get('/:id', requirePermission('treasury.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const v = await prisma.voucher.findUniqueOrThrow({
      where: { id },
      include: {
        treasuryAccount: { select: { id: true, code: true, nameAr: true } },
        lines: { include: { account: { select: { id: true, code: true, nameAr: true } } }, orderBy: { id: 'asc' } },
        journalEntry: {
          include: {
            lines: { include: { account: { select: { id: true, code: true, nameAr: true } } }, orderBy: { id: 'asc' } },
          },
        },
      },
    });

    let partyName: string | null = null;
    if (v.partyType && v.partyId) {
      if (v.partyType === 'CUSTOMER') {
        const c = await prisma.customer.findUnique({ where: { id: v.partyId }, select: { nameAr: true } });
        partyName = c?.nameAr ?? null;
      } else if (v.partyType === 'SUPPLIER') {
        const s = await prisma.supplier.findUnique({ where: { id: v.partyId }, select: { nameAr: true } });
        partyName = s?.nameAr ?? null;
      } else {
        const a = await prisma.account.findUnique({ where: { id: v.partyId }, select: { nameAr: true } });
        partyName = a?.nameAr ?? null;
      }
    }

    res.json({ ...v, partyName });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/vouchers — create (posts a balanced journal entry) ──────────────
router.post('/', requirePermission('treasury.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createVoucherSchema.parse(req.body);
    const userId = req.user!.userId;
    const vDate = body.date ? new Date(body.date) : new Date();
    const type = body.type as VoucherTypeT;

    const result = await runWithRetry(() => prisma.$transaction(async (tx) => {
      const treasuryCode = await getTreasuryCode(tx, body.treasuryAccountId);

      // Determine total amount and counterparty lines
      let totalAmount = 0;
      let voucherLines: Array<{ accountId: number; amount: number; description: string | null }> = [];

      if (body.lines && body.lines.length > 0) {
        voucherLines = body.lines.map((l) => ({
          accountId: l.accountId,
          amount: l.amount,
          description: l.description ?? null,
        }));
        totalAmount = voucherLines.reduce((s, l) => s + l.amount, 0);
      } else {
        // Simple mode — single counterparty derived from the party (or treasury source for DEPOSIT)
        totalAmount = body.amount ?? 0;
        if (totalAmount <= 0) {
          throw new Error('المبلغ الإجمالي للسند يجب أن يكون أكبر من صفر');
        }

        // Reject payments that would overpay the linked invoice —
        // "remaining" accounts for both prior vouchers and BALANCE returns.
        if (body.salesInvoiceId) {
          const { remaining } = await getSalesInvoiceSettlement(tx, body.salesInvoiceId);
          if (totalAmount > remaining + 0.01) {
            throw new Error(`المبلغ أكبر من المتبقي على الفاتورة (${remaining.toFixed(2)})`);
          }
        }
        if (body.purchaseInvoiceId) {
          const { remaining } = await getPurchaseInvoiceSettlement(tx, body.purchaseInvoiceId);
          if (totalAmount > remaining + 0.01) {
            throw new Error(`المبلغ أكبر من المتبقي على الفاتورة (${remaining.toFixed(2)})`);
          }
        }
        let counterAccountId: number;
        if (type === 'RECEIPT') {
          counterAccountId = (await tx.account.findUniqueOrThrow({ where: { code: ACCT.AR }, select: { id: true } })).id;
        } else if (type === 'PAYMENT') {
          counterAccountId = (await tx.account.findUniqueOrThrow({ where: { code: ACCT.AP }, select: { id: true } })).id;
        } else if (type === 'DISCOUNT') {
          if (body.partyType === 'SUPPLIER') {
            counterAccountId = (await tx.account.findUniqueOrThrow({ where: { code: ACCT.AP }, select: { id: true } })).id;
          } else {
            counterAccountId = (await tx.account.findUniqueOrThrow({ where: { code: ACCT.AR }, select: { id: true } })).id;
          }
        } else {
          // DEPOSIT: source is cash (from treasury = bank destination, source = cash)
          counterAccountId = (await tx.account.findUniqueOrThrow({ where: { code: ACCT.CASH }, select: { id: true } })).id;
        }
        voucherLines = [{ accountId: counterAccountId, amount: totalAmount, description: body.description ?? null }];
      }

      const voucherNo = await generateVoucherNo(tx, type, vDate);

      // Build ledger lines per voucher type
      const ledgerLines: Array<{ accountCode: string; debit: number; credit: number; description?: string }> = [];
      const lineDesc = body.description ?? voucherNo;

      if (type === 'RECEIPT') {
        // Dr treasury ; Cr each counterparty line
        ledgerLines.push({ accountCode: treasuryCode, debit: totalAmount, credit: 0, description: lineDesc });
        for (const l of voucherLines) {
          ledgerLines.push({ accountCode: (await tx.account.findUniqueOrThrow({ where: { id: l.accountId }, select: { code: true } })).code, debit: 0, credit: l.amount, description: l.description ?? lineDesc });
        }
      } else if (type === 'PAYMENT') {
        // Dr each counterparty line ; Cr treasury
        for (const l of voucherLines) {
          ledgerLines.push({ accountCode: (await tx.account.findUniqueOrThrow({ where: { id: l.accountId }, select: { code: true } })).code, debit: l.amount, credit: 0, description: l.description ?? lineDesc });
        }
        ledgerLines.push({ accountCode: treasuryCode, debit: 0, credit: totalAmount, description: lineDesc });
      } else if (type === 'DISCOUNT') {
        // Discount granted to customer → Dr 5100 discounts-allowed ; Cr 3000 AR (+decrement customer)
        // Discount earned from supplier → Dr 2000 AP ; Cr 4100 discounts-earned (+decrement supplier)
        if (body.partyType === 'SUPPLIER') {
          ledgerLines.push({ accountCode: ACCT.AP, debit: totalAmount, credit: 0, description: lineDesc });
          ledgerLines.push({ accountCode: ACCT.DISCOUNT_EARNED, debit: 0, credit: totalAmount, description: lineDesc });
        } else {
          ledgerLines.push({ accountCode: ACCT.DISCOUNT_ALLOWED, debit: totalAmount, credit: 0, description: lineDesc });
          ledgerLines.push({ accountCode: ACCT.AR, debit: 0, credit: totalAmount, description: lineDesc });
        }
      } else {
        // DEPOSIT: Dr bank (treasury) ; Cr cash
        ledgerLines.push({ accountCode: treasuryCode, debit: totalAmount, credit: 0, description: lineDesc });
        ledgerLines.push({ accountCode: ACCT.CASH, debit: 0, credit: totalAmount, description: lineDesc });
      }

      // The voucher belongs to its creator's branch
      const creator = await tx.user.findUnique({
        where: { id: userId },
        select: { branchId: true },
      });

      // Create voucher + lines
      const v = await tx.voucher.create({
        data: {
          voucherNo,
          type,
          date: vDate,
          branchId: creator?.branchId ?? null,
          treasuryAccountId: body.treasuryAccountId,
          partyType: body.partyType ?? null,
          partyId: body.partyId ?? null,
          salesInvoiceId: body.salesInvoiceId ?? null,
          purchaseInvoiceId: body.purchaseInvoiceId ?? null,
          description: body.description ?? null,
          totalAmount: new Prisma.Decimal(totalAmount),
          createdById: userId,
          lines: { create: voucherLines.map((l) => ({ accountId: l.accountId, amount: new Prisma.Decimal(l.amount), description: l.description })) },
        },
      });

      // Post balanced ledger entry (throws if unbalanced)
      await postJournalEntry(tx, {
        date: vDate,
        description: `${typeLabel(type)} ${voucherNo}`,
        sourceType: JournalSource.VOUCHER,
        sourceId: v.id,
        createdById: userId,
        lines: ledgerLines,
      });

      // Update party balances (inside same tx)
      if (body.partyType === 'CUSTOMER' && (type === 'RECEIPT' || type === 'DISCOUNT') && body.partyId) {
        await tx.customer.update({ where: { id: body.partyId }, data: { currentBalance: { decrement: new Prisma.Decimal(totalAmount) } } });
      } else if (body.partyType === 'SUPPLIER' && (type === 'PAYMENT' || type === 'DISCOUNT') && body.partyId) {
        await tx.supplier.update({ where: { id: body.partyId }, data: { currentBalance: { decrement: new Prisma.Decimal(totalAmount) } } });
      }

      // Keep the linked invoice's paid status in sync with what's actually been paid
      if (body.salesInvoiceId) {
        await recomputeSalesInvoiceStatus(tx, body.salesInvoiceId);
      }
      if (body.purchaseInvoiceId) {
        await recomputePurchaseInvoiceStatus(tx, body.purchaseInvoiceId);
      }

      return v;
    }));

    // Re-fetch full detail
    const full = await prisma.voucher.findUniqueOrThrow({
      where: { id: result.id },
      include: {
        treasuryAccount: { select: { id: true, code: true, nameAr: true } },
        lines: { include: { account: { select: { id: true, code: true, nameAr: true } } } },
      },
    });

    res.status(201).json(full);
  } catch (err: any) {
    if (typeof err?.message === 'string' && (
      err.message.includes('القيد غير متوازن') ||
      err.message.includes('المبلغ أكبر من المتبقي') ||
      err.message.includes('المبلغ الإجمالي للسند')
    )) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// ── DELETE /api/vouchers/:id — reverse ledger + party balance + delete ────────
router.delete('/:id', requirePermission('treasury.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.$transaction(async (tx) => {
      const voucher = await tx.voucher.findUniqueOrThrow({
        where: { id },
        select: { salesInvoiceId: true, purchaseInvoiceId: true },
      });

      await reversePartyBalance(tx, id);
      await reverseJournalEntryBySource(tx, JournalSource.VOUCHER, id);
      // Clear settledVoucherId back-references from promissory notes
      await tx.promissoryNote.updateMany({ where: { settledVoucherId: id }, data: { settledVoucherId: null, status: 'PENDING' } });
      await tx.voucher.delete({ where: { id } });

      // Re-sync the linked invoice's paid status now that this voucher is gone
      if (voucher.salesInvoiceId) {
        await recomputeSalesInvoiceStatus(tx, voucher.salesInvoiceId);
      }
      if (voucher.purchaseInvoiceId) {
        await recomputePurchaseInvoiceStatus(tx, voucher.purchaseInvoiceId);
      }
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function typeLabel(type: VoucherTypeT): string {
  switch (type) {
    case 'RECEIPT': return 'سند قبض';
    case 'PAYMENT': return 'سند صرف';
    case 'DISCOUNT': return 'سند خصم';
    case 'DEPOSIT': return 'إيداع بنكي';
  }
}

export default router;
