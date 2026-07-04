import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';
import { getSalesInvoiceSettlement } from '../lib/settlement';
import { createSalesInvoiceInTx, SALES_INVOICE_USER_ERRORS } from '../lib/salesInvoiceService';
import { runWithRetry } from '../lib/retry';
import { parseDateRange } from '../lib/dateRange';

const router = Router();
router.use(requireAuth);

const invoiceItemSchema = z.object({
  productId: z.number().int().positive(),
  qty: z.number().positive(),
  unitPrice: z.number().positive(),
});

const createInvoiceSchema = z.object({
  customerId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  discount: z.number().nonnegative().optional().default(0),
  tax: z.number().nonnegative().optional().default(0),
  paidStatus: z.enum(['PAID', 'UNPAID', 'PARTIAL']).optional().default('PAID'),
  paymentMethod: z.enum(['CASH', 'CARD', 'CREDIT']).optional().default('CASH'),
  couponCode: z.string().optional().nullable(),
  redeemPoints: z.number().nonnegative().optional().default(0),
  items: z.array(invoiceItemSchema).min(1),
});

// GET /api/sales-invoices
router.get('/', requirePermission('sales.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, search, skip } = getPagination(req);
    const paidStatus = req.query.paidStatus as string | undefined;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { refNo: { contains: search } },
        { customer: { nameAr: { contains: search, mode: 'insensitive' } } },
      ];
    }
    if (paidStatus) where.paidStatus = paidStatus;
    if (req.query.branchId) where.branchId = parseInt(req.query.branchId as string);

    const dateRange = parseDateRange(
      req.query.from as string | undefined,
      req.query.to   as string | undefined,
    );
    if (dateRange) where.date = dateRange;

    const [data, total] = await Promise.all([
      prisma.salesInvoice.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { date: 'desc' },
        include: {
          customer: { select: { id: true, nameAr: true, company: true } },
          cashier: { select: { id: true, name: true } },
          warehouse: { select: { id: true, nameAr: true } },
          branch: { select: { id: true, nameAr: true } },
          items: { include: { product: { select: { id: true, nameAr: true, sku: true } } } },
        },
      }),
      prisma.salesInvoice.count({ where }),
    ]);

    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// GET /api/sales-invoices/:id
router.get('/:id', requirePermission('sales.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const [invoice, settlement] = await Promise.all([
      prisma.salesInvoice.findUniqueOrThrow({
        where: { id },
        include: {
          customer: true,
          cashier: { select: { id: true, name: true } },
          warehouse: true,
          items: { include: { product: { include: { unit: true } } } },
        },
      }),
      getSalesInvoiceSettlement(prisma, id),
    ]);
    res.json({
      ...invoice,
      paidAmount: settlement.paidAmount,
      returnedAmount: settlement.returnedAmount,
      remainingAmount: settlement.remaining,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/sales-invoices
router.post('/', requirePermission('sales.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createInvoiceSchema.parse(req.body);
    const cashierId = req.user!.userId;

    const invoice = await runWithRetry(() =>
      prisma.$transaction(async (tx) => createSalesInvoiceInTx(tx, { ...body, cashierId })),
    );

    const full = await prisma.salesInvoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: {
        customer: true,
        cashier: { select: { id: true, name: true } },
        warehouse: true,
        items: { include: { product: { include: { unit: true } } } },
      },
    });

    res.status(201).json(full);
  } catch (err: any) {
    if (typeof err?.message === 'string' && SALES_INVOICE_USER_ERRORS.some((m) => err.message.includes(m))) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// DELETE /api/sales-invoices/:id — DISABLED by policy.
// A sales invoice is a permanent, sequentially-numbered legal document (and,
// once reported to ZATCA, a tax record). It must never be deleted — corrections
// and cancellations are done exclusively through a sales return / credit note
// (إشعار دائن), which keeps both documents in the audit trail. The endpoint is
// kept so any old client gets a clear explanation instead of a 404.
router.delete('/:id', requirePermission('sales.delete'), async (_req: Request, res: Response) => {
  res.status(400).json({
    error: 'لا يمكن حذف فاتورة المبيعات — الفاتورة مستند قانوني دائم. لإلغائها أو تصحيحها أنشئ «مرتجع مبيعات» (إشعار دائن).',
  });
});

export default router;
