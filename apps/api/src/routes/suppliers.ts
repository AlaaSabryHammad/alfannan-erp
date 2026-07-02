import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';

const router = Router();
router.use(requireAuth);

const supplierSchema = z.object({
  nameAr: z.string().min(1),
  company: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  openingBalance: z.number().optional(),
  currentBalance: z.number().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

// GET /api/suppliers
router.get('/', requirePermission('suppliers.view'), async (req: Request, res: Response, next: NextFunction) => {
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
      prisma.supplier.findMany({ where, skip, take: pageSize, orderBy: { id: 'desc' } }),
      prisma.supplier.count({ where }),
    ]);
    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// GET /api/suppliers/:id
router.get('/:id', requirePermission('suppliers.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supplier = await prisma.supplier.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: { purchaseInvoices: { orderBy: { date: 'desc' }, take: 10 } },
    });
    res.json(supplier);
  } catch (err) {
    next(err);
  }
});

// GET /api/suppliers/:id/statement — كشف حساب
router.get('/:id/statement', requirePermission('suppliers.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id } });

    const [invoices, vouchers] = await Promise.all([
      prisma.purchaseInvoice.findMany({ where: { supplierId: id }, orderBy: { date: 'asc' } }),
      prisma.voucher.findMany({ where: { partyType: 'SUPPLIER', partyId: id }, orderBy: { date: 'asc' } }),
    ]);

    // For a supplier, "credit" = payable increases (we owe them more), "debit" = payable decreases (we paid).
    type Row = { date: Date; refNo: string; description: string; debit: number; credit: number; seq: number };
    const rows: Row[] = [];
    let seq = 0;

    for (const inv of invoices) {
      rows.push({ date: inv.date, refNo: inv.refNo, description: `فاتورة شراء ${inv.refNo}`, debit: 0, credit: Number(inv.total), seq: seq++ });
      // Invoices settled in full at creation never raised the payable — show the
      // offsetting entry so every purchase is visible without inflating the balance.
      if (inv.paymentStatus === 'PAID') {
        rows.push({ date: inv.date, refNo: inv.refNo, description: `سداد عند الشراء — ${inv.refNo}`, debit: Number(inv.total), credit: 0, seq: seq++ });
      }
    }

    for (const v of vouchers) {
      const amount = Number(v.totalAmount);
      if (v.type === 'PAYMENT' || v.type === 'DISCOUNT') {
        rows.push({ date: v.date, refNo: v.voucherNo, description: v.description ?? v.voucherNo, debit: amount, credit: 0, seq: seq++ });
      } else if (v.type === 'RECEIPT') {
        rows.push({ date: v.date, refNo: v.voucherNo, description: v.description ?? v.voucherNo, debit: 0, credit: amount, seq: seq++ });
      }
    }

    rows.sort((a, b) => a.date.getTime() - b.date.getTime() || a.seq - b.seq);

    let balance = Number(supplier.openingBalance);
    const lines = rows.map((r) => {
      balance += r.credit - r.debit;
      return { date: r.date, refNo: r.refNo, description: r.description, debit: r.debit, credit: r.credit, balance };
    });

    res.json({
      supplier: { id: supplier.id, nameAr: supplier.nameAr, company: supplier.company },
      openingBalance: Number(supplier.openingBalance),
      lines,
      closingBalance: balance,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/suppliers
router.post('/', requirePermission('suppliers.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = supplierSchema.parse(req.body);
    // A new party's current balance starts at its opening balance unless explicitly provided.
    if (data.currentBalance === undefined) {
      data.currentBalance = data.openingBalance ?? 0;
    }
    const supplier = await prisma.supplier.create({ data });
    res.status(201).json(supplier);
  } catch (err) {
    next(err);
  }
});

// PUT /api/suppliers/:id
router.put('/:id', requirePermission('suppliers.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = supplierSchema.partial().parse(req.body);
    const supplier = await prisma.supplier.update({ where: { id: parseInt(req.params.id) }, data });
    res.json(supplier);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/suppliers/:id
router.delete('/:id', requirePermission('suppliers.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    // Vouchers and promissory notes reference the supplier polymorphically
    // (partyType/partyId — no FK), so the DB won't block this delete on its own
    // and the documents would be left pointing at a supplier that no longer exists.
    const [voucherRefs, noteRefs] = await Promise.all([
      prisma.voucher.count({ where: { partyType: 'SUPPLIER', partyId: id } }),
      prisma.promissoryNote.count({ where: { partyType: 'SUPPLIER', partyId: id } }),
    ]);
    if (voucherRefs > 0 || noteRefs > 0) {
      res.status(400).json({ error: 'لا يمكن الحذف لارتباطه بسندات أو كمبيالات' });
      return;
    }
    await prisma.supplier.delete({ where: { id } });
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
