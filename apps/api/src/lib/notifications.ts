/**
 * إشعارات واتساب والرسائل النصية القصيرة (SMS)
 *
 * مزود عام (generic) يعمل مع أي واجهة HTTP تقبل Bearer token — بما في ذلك
 * واتساب Cloud API الرسمي من Meta. عدّل رابط الـ API والمفاتيح من شاشة
 * الإعدادات دون الحاجة لتعديل الكود. إن لم تُضبط الإعدادات، تُعاد رسالة خطأ
 * واضحة بدلاً من محاولة إرسال فعلية.
 */
import prisma from './prisma';
import { SETTING_DEFAULTS } from '../routes/settings';

async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? SETTING_DEFAULTS[key] ?? null;
}

export interface SendResult {
  success: boolean;
  error?: string;
}

export async function sendWhatsAppMessage(to: string, message: string): Promise<SendResult> {
  if (!to?.trim()) return { success: false, error: 'رقم الجوال مطلوب' };

  const enabled = (await getSetting('whatsappEnabled')) === 'true';
  if (!enabled) return { success: false, error: 'خدمة واتساب غير مُفعّلة — فعّلها من شاشة الإعدادات' };

  const apiUrl = await getSetting('whatsappApiUrl');
  const apiToken = await getSetting('whatsappApiToken');
  const senderId = await getSetting('whatsappSenderId');
  if (!apiUrl || !apiToken) {
    return { success: false, error: 'لم يتم ضبط رابط API أو مفتاح الاعتماد لواتساب في شاشة الإعدادات' };
  }

  try {
    // Payload shape matches WhatsApp Cloud API (Meta) — most third-party WhatsApp
    // Business API providers accept an equivalent shape. Adjust here if your
    // provider expects a different JSON structure.
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace(/[^\d+]/g, ''),
        type: 'text',
        text: { body: message },
        ...(senderId ? { from: senderId } : {}),
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { success: false, error: `فشل إرسال رسالة واتساب (HTTP ${res.status}): ${body.slice(0, 300)}` };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: `تعذّر الاتصال بمزود واتساب: ${err?.message ?? 'خطأ غير معروف'}` };
  }
}

export async function sendSms(to: string, message: string): Promise<SendResult> {
  if (!to?.trim()) return { success: false, error: 'رقم الجوال مطلوب' };

  const enabled = (await getSetting('smsEnabled')) === 'true';
  if (!enabled) return { success: false, error: 'خدمة الرسائل النصية غير مُفعّلة — فعّلها من شاشة الإعدادات' };

  const apiUrl = await getSetting('smsApiUrl');
  const apiKey = await getSetting('smsApiKey');
  const senderId = await getSetting('smsSenderId');
  if (!apiUrl || !apiKey) {
    return { success: false, error: 'لم يتم ضبط رابط API أو مفتاح مزود الرسائل النصية في شاشة الإعدادات' };
  }

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: to.replace(/[^\d+]/g, ''),
        message,
        ...(senderId ? { sender: senderId } : {}),
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { success: false, error: `فشل إرسال الرسالة النصية (HTTP ${res.status}): ${body.slice(0, 300)}` };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: `تعذّر الاتصال بمزود الرسائل النصية: ${err?.message ?? 'خطأ غير معروف'}` };
  }
}
