import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { computeInvoiceHash, buildInvoiceXml, submitInvoiceToZatca, ZATCA_GENESIS_HASH } from '../lib/zatca';
import { SETTING_DEFAULTS } from './settings';

const router = Router();
router.use(requireAuth);

// GET /api/zatca/status — هل الفوترة الإلكترونية (المرحلة الثانية) مُهيّأة؟
router.get('/status', requirePermission('sales.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const keys = ['zatcaEnabled', 'zatcaEnvironment', 'zatcaApiBaseUrl', 'zatcaBinarySecurityToken', 'zatcaSecret', 'sellerVatNumber'];
    const rows = await prisma.setting.findMany({ where: { key: { in: keys } } });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const enabled = map.get('zatcaEnabled') === 'true';
    const configured = Boolean(map.get('zatcaBinarySecurityToken') && map.get('zatcaSecret') && map.get('sellerVatNumber'));
    res.json({
      enabled,
      configured,
      environment: map.get('zatcaEnvironment') ?? 'sandbox',
      sellerVatNumber: map.get('sellerVatNumber') ?? '',
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/zatca/sales-invoices/:id/submit — بناء تسلسل الربط (PIH) وإرسال الفاتورة
router.post('/sales-invoices/:id/submit', requirePermission('sales.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const invoice = await prisma.salesInvoice.findUniqueOrThrow({
      where: { id },
      include: {
        customer: true,
        items: { include: { product: { select: { nameAr: true, taxRate: true } } } },
      },
    });

    if (invoice.zatcaStatus === 'CLEARED' || invoice.zatcaStatus === 'REPORTED') {
      res.status(400).json({ error: 'تم إرسال هذه الفاتورة إلى هيئة الزكاة مسبقًا' });
      return;
    }

    const settingsRows = await prisma.setting.findMany({ where: { key: { in: ['sellerVatNumber', 'sellerName'] } } });
    const settingsMap = new Map(settingsRows.map((r) => [r.key, r.value]));
    const sellerVatNumber = settingsMap.get('sellerVatNumber') ?? SETTING_DEFAULTS.sellerVatNumber;
    const sellerName = settingsMap.get('sellerName') ?? SETTING_DEFAULTS.sellerName;

    // Find the previous invoice in the chain (by id order) to link this one's PIH.
    const previous = await prisma.salesInvoice.findFirst({
      where: { id: { lt: id }, invoiceHash: { not: null } },
      orderBy: { id: 'desc' },
      select: { invoiceHash: true },
    });
    const previousInvoiceHash = previous?.invoiceHash ?? ZATCA_GENESIS_HASH;

    const invoiceHash = computeInvoiceHash({
      refNo: invoice.refNo,
      date: invoice.date,
      total: Number(invoice.total),
      previousHash: previousInvoiceHash,
    });

    const uuid = crypto.randomUUID();
    const isSimplified = !invoice.customer.vatNumber; // B2C (no buyer VAT) → simplified/reporting; B2B → standard/clearance

    const xml = buildInvoiceXml({
      refNo: invoice.refNo,
      uuid,
      date: invoice.date,
      subtotal: Number(invoice.subtotal),
      discount: Number(invoice.discount),
      tax: Number(invoice.tax),
      total: Number(invoice.total),
      invoiceHash,
      previousInvoiceHash,
      sellerName,
      sellerVatNumber,
      buyerName: invoice.customer.nameAr,
      buyerVatNumber: invoice.customer.vatNumber,
      isSimplified,
      lines: invoice.items.map((it) => ({
        nameAr: it.product.nameAr,
        qty: Number(it.qty),
        unitPrice: Number(it.unitPrice),
        lineTotal: Number(it.lineTotal),
        taxRate: Number(it.product.taxRate ?? 0),
      })),
    });
    const xmlBase64 = Buffer.from(xml, 'utf8').toString('base64');

    const result = await submitInvoiceToZatca(xmlBase64, uuid, isSimplified);

    const updated = await prisma.salesInvoice.update({
      where: { id },
      data: {
        invoiceHash,
        previousInvoiceHash,
        zatcaUuid: uuid,
        zatcaStatus: result.status,
        zatcaSubmittedAt: new Date(),
        zatcaResponse: `${result.message}${result.rawResponse ? ' — ' + result.rawResponse : ''}`.slice(0, 4000),
      },
    });

    if (result.status === 'FAILED' || result.status === 'NOT_CONFIGURED') {
      res.status(400).json({ error: result.message, invoice: updated });
      return;
    }
    res.json({ message: result.message, invoice: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
