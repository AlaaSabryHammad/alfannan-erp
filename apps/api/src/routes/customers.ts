import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';

const router = Router();
router.use(requireAuth);

const customerSchema = z.object({
  nameAr: z.string().min(1),
  company: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  vatNumber: z.string().optional().nullable()
    .refine((v) => !v || /^\d{15}$/.test(v), 'الرقم الضريبي يجب أن يكون 15 رقمًا'),
  creditLimit: z.number().nonnegative().optional(),
  openingBalance: z.number().optional(),
  currentBalance: z.number().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

router.get('/', requirePermission('customers.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, search, skip } = getPagination(req);
    const where = search
      ? {
          OR: [
            { nameAr: { contains: search, mode: 'insensitive' as const } },
            { company: { contains: search, mode: 'insensitive' as const } },
            { phone: { contains: search } },
          ],
        }
      : {};
    const [data, total] = await Promise.all([
      prisma.customer.findMany({ where, skip, take: pageSize, orderBy: { id: 'desc' } }),
      prisma.customer.count({ where }),
    ]);
    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requirePermission('customers.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customer = await prisma.customer.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: { invoices: { orderBy: { date: 'desc' }, take: 10 } },
    });
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

// GET /api/customers/:id/statement — كشف حساب
router.get('/:id/statement', requirePermission('customers.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id } });

    const [invoices, vouchers, returns] = await Promise.all([
      prisma.salesInvoice.findMany({ where: { customerId: id }, orderBy: { date: 'asc' } }),
      prisma.voucher.findMany({ where: { partyType: 'CUSTOMER', partyId: id }, orderBy: { date: 'asc' } }),
      prisma.salesReturn.findMany({ where: { customerId: id }, orderBy: { date: 'asc' } }),
    ]);

    type Row = { date: Date; refNo: string; description: string; debit: number; credit: number; seq: number };
    const rows: Row[] = [];
    let seq = 0;

    // Invoices that have vouchers or BALANCE returns applied against them were
    // settled through those documents (each shown as its own row below) — the
    // "collected at sale" offset row is only for invoices paid at creation.
    // paidStatus alone can't tell the two apart: it is recomputed to PAID when
    // vouchers/returns settle the invoice later.
    const invoiceIds = invoices.map((i) => i.id);
    const settledViaDocs = new Set<number>();
    if (invoiceIds.length) {
      const linkedVouchers = await prisma.voucher.groupBy({
        by: ['salesInvoiceId'],
        where: { salesInvoiceId: { in: invoiceIds } },
        _sum: { totalAmount: true },
      });
      for (const v of linkedVouchers) {
        if (v.salesInvoiceId && Number(v._sum.totalAmount ?? 0) > 0) settledViaDocs.add(v.salesInvoiceId);
      }
    }
    for (const r of returns) {
      if (r.refundMethod === 'BALANCE') settledViaDocs.add(r.salesInvoiceId);
    }

    for (const inv of invoices) {
      rows.push({ date: inv.date, refNo: inv.refNo, description: `فاتورة بيع ${inv.refNo}`, debit: Number(inv.total), credit: 0, seq: seq++ });
      // Invoices settled in full at the moment of sale (cash/card, not credit) never
      // raised the receivable in the first place — show the offsetting entry so the
      // statement stays transparent about every sale without inflating the balance.
      if (inv.paymentMethod !== 'CREDIT' && inv.paidStatus === 'PAID' && !settledViaDocs.has(inv.id)) {
        rows.push({ date: inv.date, refNo: inv.refNo, description: `تحصيل عند البيع — ${inv.refNo}`, debit: 0, credit: Number(inv.total), seq: seq++ });
      }
    }

    for (const v of vouchers) {
      const amount = Number(v.totalAmount);
      if (v.type === 'RECEIPT' || v.type === 'DISCOUNT') {
        rows.push({ date: v.date, refNo: v.voucherNo, description: v.description ?? v.voucherNo, debit: 0, credit: amount, seq: seq++ });
      } else if (v.type === 'PAYMENT') {
        rows.push({ date: v.date, refNo: v.voucherNo, description: v.description ?? v.voucherNo, debit: amount, credit: 0, seq: seq++ });
      }
    }

    // Returns credit the customer. A CASH refund pays the money straight back
    // out, so it gets an offsetting debit row — same transparency treatment as
    // cash sales above — leaving the receivable unchanged.
    for (const r of returns) {
      const amount = Number(r.total);
      rows.push({ date: r.date, refNo: r.refNo, description: `مرتجع بيع ${r.refNo}`, debit: 0, credit: amount, seq: seq++ });
      if (r.refundMethod === 'CASH') {
        rows.push({ date: r.date, refNo: r.refNo, description: `ردّ نقدي — ${r.refNo}`, debit: amount, credit: 0, seq: seq++ });
      }
    }

    rows.sort((a, b) => a.date.getTime() - b.date.getTime() || a.seq - b.seq);

    let balance = Number(customer.openingBalance);
    const lines = rows.map((r) => {
      balance += r.debit - r.credit;
      return { date: r.date, refNo: r.refNo, description: r.description, debit: r.debit, credit: r.credit, balance };
    });

    res.json({
      customer: { id: customer.id, nameAr: customer.nameAr, company: customer.company },
      openingBalance: Number(customer.openingBalance),
      lines,
      closingBalance: balance,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission('customers.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = customerSchema.parse(req.body);
    // A new party's current balance starts at its opening balance unless explicitly provided.
    if (data.currentBalance === undefined) {
      data.currentBalance = data.openingBalance ?? 0;
    }
    const customer = await prisma.customer.create({ data });
    res.status(201).json(customer);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requirePermission('customers.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = customerSchema.partial().parse(req.body);
    const customer = await prisma.customer.update({ where: { id: parseInt(req.params.id) }, data });
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requirePermission('customers.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    // Vouchers and promissory notes reference the customer polymorphically
    // (partyType/partyId — no FK), so the DB won't block this delete on its own
    // and the documents would be left pointing at a customer that no longer exists.
    const [voucherRefs, noteRefs] = await Promise.all([
      prisma.voucher.count({ where: { partyType: 'CUSTOMER', partyId: id } }),
      prisma.promissoryNote.count({ where: { partyType: 'CUSTOMER', partyId: id } }),
    ]);
    if (voucherRefs > 0 || noteRefs > 0) {
      res.status(400).json({ error: 'لا يمكن الحذف لارتباطه بسندات أو كمبيالات' });
      return;
    }
    await prisma.customer.delete({ where: { id } });
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
