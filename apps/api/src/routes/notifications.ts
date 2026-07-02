import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { sendWhatsAppMessage, sendSms } from '../lib/notifications';

const router = Router();
router.use(requireAuth);

const sendSchema = z.object({
  to: z.string().min(4),
  message: z.string().min(1),
});

// POST /api/notifications/whatsapp — إرسال رسالة واتساب عامة
router.post('/whatsapp', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = sendSchema.parse(req.body);
    const result = await sendWhatsAppMessage(body.to, body.message);
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/sms — إرسال رسالة نصية عامة
router.post('/sms', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = sendSchema.parse(req.body);
    const result = await sendSms(body.to, body.message);
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/sales-invoices/:id/whatsapp — إرسال تفاصيل فاتورة بيع للعميل عبر واتساب
router.post('/sales-invoices/:id/whatsapp', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoice = await prisma.salesInvoice.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: { customer: true, items: { include: { product: { select: { nameAr: true } } } } },
    });
    if (!invoice.customer.phone) {
      res.status(400).json({ error: 'لا يوجد رقم جوال مسجّل لهذا العميل' });
      return;
    }
    const itemsText = invoice.items.map((i) => `- ${i.product.nameAr} × ${Number(i.qty)}`).join('\n');
    const message =
      `فاتورة ${invoice.refNo}\n` +
      `العميل: ${invoice.customer.nameAr}\n\n` +
      `${itemsText}\n\n` +
      `الإجمالي: ${Number(invoice.total).toFixed(2)}\n` +
      `شكرًا لتعاملكم معنا.`;
    const result = await sendWhatsAppMessage(invoice.customer.phone, message);
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/low-stock-alert — إرسال ملخص الأصناف المنخفضة للجوال الإداري المُعرَّف بالإعدادات
router.post('/low-stock-alert', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminPhoneSetting = await prisma.setting.findUnique({ where: { key: 'notificationAdminPhone' } });
    const adminPhone = adminPhoneSetting?.value;
    if (!adminPhone) {
      res.status(400).json({ error: 'لم يتم ضبط رقم جوال المسؤول لاستقبال التنبيهات في شاشة الإعدادات' });
      return;
    }
    const thresholdSetting = await prisma.setting.findUnique({ where: { key: 'lowStockThreshold' } });
    const threshold = parseFloat(thresholdSetting?.value ?? '10');

    const lowBalances = await prisma.stockBalance.findMany({
      where: { quantity: { lt: threshold } },
      include: { product: { select: { nameAr: true } } },
      orderBy: { quantity: 'asc' },
      take: 20,
    });

    if (lowBalances.length === 0) {
      res.json({ success: true, message: 'لا توجد أصناف منخفضة حاليًا — لم يُرسَل أي تنبيه' });
      return;
    }

    const lines = lowBalances.map((b) => `- ${b.product.nameAr}: ${Number(b.quantity)}`).join('\n');
    const message = `تنبيه نواقص المخزون:\n\n${lines}`;

    const channel = (await prisma.setting.findUnique({ where: { key: 'whatsappEnabled' } }))?.value === 'true' ? sendWhatsAppMessage : sendSms;
    const result = await channel(adminPhone, message);
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
