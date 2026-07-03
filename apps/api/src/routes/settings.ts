/**
 * Settings routes — الإعدادات
 *
 * GET  /api/settings            requireAuth           → merged object (defaults + DB)
 * PUT  /api/settings            requirePermission('settings.edit') → upsert + return merged
 */

import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

/** Default values returned when a key is absent from the DB */
export const SETTING_DEFAULTS: Record<string, string> = {
  companyName:       'الفنان للتوريدات العمومية',
  currency:          'ر.س',
  taxRate:           '15',
  vatNumber:         '', // الرقم الضريبي — 15 رقمًا، يبدأ وينتهي بـ 3 (هيئة الزكاة والضريبة والجمارك)
  crNumber:          '', // رقم السجل التجاري
  logoUrl:           '',
  lowStockThreshold: '10',
  itemsPerPage:      '10',
  loyaltyEnabled:    'true',
  loyaltyEarnRate:   '0.1',  // نقطة واحدة عن كل 10 ريال من إجمالي الفاتورة
  loyaltyPointValue: '0.05', // القيمة النقدية للنقطة الواحدة عند الاستبدال (ريال)

  // واتساب / الرسائل النصية — عدّل هذه القيم بحسب مزود الخدمة الذي تتعامل معه
  whatsappEnabled:       'false',
  whatsappApiUrl:        '', // مثال: https://graph.facebook.com/v20.0/<phone-number-id>/messages
  whatsappApiToken:      '',
  whatsappSenderId:      '',
  smsEnabled:            'false',
  smsApiUrl:             '',
  smsApiKey:             '',
  smsSenderId:           '',
  notificationAdminPhone: '', // الجوال الذي يستقبل تنبيهات نواقص المخزون وغيرها

  // الفوترة الإلكترونية — هيئة الزكاة والضريبة والجمارك (ZATCA) — المرحلة الثانية
  zatcaEnabled:          'false',
  zatcaEnvironment:      'sandbox', // sandbox | simulation | production — حسب مرحلة الاعتماد مع الهيئة
  zatcaApiBaseUrl:       'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal', // بيئة المطورين الافتراضية — تُستبدل بالبيئة الفعلية بعد الاعتماد
  zatcaBinarySecurityToken: '', // CSID (Compliance/Production Certificate) المُستلم من بوابة فاتورة
  zatcaSecret:           '',
  sellerVatNumber:       '', // الرقم الضريبي للمنشأة (15 رقمًا)
  sellerName:            'الفنان للتوريدات العمومية',
  zatcaSignerPrivateKey: '', // المفتاح الخاص (PEM, secp256k1) للختم الرقمي — يُستخرج مع شهادة CSID من بوابة فاتورة
};

async function mergedSettings(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany();
  const fromDb: Record<string, string> = {};
  for (const row of rows) {
    fromDb[row.key] = row.value;
  }
  return { ...SETTING_DEFAULTS, ...fromDb };
}

// GET /api/settings
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await mergedSettings());
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings
router.put('/', requirePermission('settings.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'يجب إرسال كائن JSON يحتوي على مفاتيح الإعدادات' });
      return;
    }

    // Upsert each provided key
    for (const [key, val] of Object.entries(body)) {
      if (typeof val !== 'string') continue; // skip non-string values
      await prisma.setting.upsert({
        where:  { key },
        update: { value: val },
        create: { key, value: val },
      });
    }

    res.json(await mergedSettings());
  } catch (err) {
    next(err);
  }
});

export default router;
