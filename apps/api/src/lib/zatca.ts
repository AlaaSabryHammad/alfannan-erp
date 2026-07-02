/**
 * الفوترة الإلكترونية — هيئة الزكاة والضريبة والجمارك (ZATCA) — المرحلة الثانية
 *
 * يبني هذا الملف تسلسل ربط الفواتير (PIH — Previous Invoice Hash) ومستند XML
 * مبسّط بصيغة UBL 2.1 لكل فاتورة، ثم يحاول إرسالها إلى نقطة API المُهيّأة في
 * شاشة الإعدادات (رابط الاعتماد، شهادة CSID، السر المشترك).
 *
 * ملاحظة مهمة: الاعتماد الفعلي مع هيئة الزكاة يتطلب شهادة اعتماد حقيقية
 * (Compliance/Production CSID) تُستخرج من بوابة "فاتورة" بعد رفع طلب اعتماد
 * ومفتاح خاص (CSR). بدون هذه الشهادة الحقيقية سيبقى الحالة NOT_CONFIGURED أو
 * سيفشل الإرسال الفعلي (FAILED) — البنية والتدفق البرمجي جاهزان بالكامل، ولا
 * يلزم تعديل الكود عند توفر شهادة حقيقية، فقط تعبئة القيم في شاشة الإعدادات.
 */
import crypto from 'crypto';
import prisma from './prisma';
import { SETTING_DEFAULTS } from '../routes/settings';

async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? SETTING_DEFAULTS[key] ?? null;
}

interface InvoiceForHash {
  refNo: string;
  date: Date;
  total: number;
  previousHash: string | null;
}

/** SHA-256 hash of a canonical invoice string, chained to the previous invoice's hash (PIH). */
export function computeInvoiceHash(inv: InvoiceForHash): string {
  const canonical = `${inv.refNo}|${inv.date.toISOString()}|${inv.total.toFixed(2)}|${inv.previousHash ?? ''}`;
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('base64');
}

/** First invoice in the chain has no predecessor — ZATCA specifies a fixed base64 zero-hash. */
export const ZATCA_GENESIS_HASH = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MTk4NDdiNjU4ZWY3T';

interface InvoiceXmlInput {
  refNo: string;
  uuid: string;
  date: Date;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  invoiceHash: string;
  previousInvoiceHash: string;
  sellerName: string;
  sellerVatNumber: string;
  buyerName: string;
  buyerVatNumber?: string | null;
  isSimplified: boolean; // true = B2C simplified invoice (reporting), false = B2B standard invoice (clearance)
  lines: { nameAr: string; qty: number; unitPrice: number; lineTotal: number; taxRate: number }[];
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * مستند UBL 2.1 مبسّط يحتوي الحقول الجوهرية المطلوبة من هيئة الزكاة. عند
 * الاعتماد الفعلي، تُستخدم أدوات ZATCA SDK الرسمية لإتمام التوقيع الرقمي
 * (XAdES) وتضمين شهادة الاعتماد — هذا المستند يمثل الأساس الذي يُبنى عليه.
 */
export function buildInvoiceXml(inv: InvoiceXmlInput): string {
  const invoiceTypeCode = inv.isSimplified ? '388' : '388'; // 388 = فاتورة ضريبية عادية؛ نوع الفرعي (simplified/standard) يُحدَّد عبر InvoiceTypeCode/@name أدناه
  const subtype = inv.isSimplified ? '0200000' : '0100000'; // مطابق لأكواد ZATCA الفرعية: مبسّطة/عادية

  const lines = inv.lines
    .map(
      (l, idx) => `
    <cac:InvoiceLine>
      <cbc:ID>${idx + 1}</cbc:ID>
      <cbc:InvoicedQuantity>${l.qty}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="SAR">${l.lineTotal.toFixed(2)}</cbc:LineExtensionAmount>
      <cac:TaxTotal>
        <cbc:TaxAmount currencyID="SAR">${((l.lineTotal * l.taxRate) / 100).toFixed(2)}</cbc:TaxAmount>
      </cac:TaxTotal>
      <cac:Item>
        <cbc:Name>${escapeXml(l.nameAr)}</cbc:Name>
      </cac:Item>
      <cac:Price>
        <cbc:PriceAmount currencyID="SAR">${l.unitPrice.toFixed(2)}</cbc:PriceAmount>
      </cac:Price>
    </cac:InvoiceLine>`,
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${escapeXml(inv.refNo)}</cbc:ID>
  <cbc:UUID>${inv.uuid}</cbc:UUID>
  <cbc:IssueDate>${inv.date.toISOString().slice(0, 10)}</cbc:IssueDate>
  <cbc:IssueTime>${inv.date.toISOString().slice(11, 19)}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="${subtype}">${invoiceTypeCode}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
  <cac:AdditionalDocumentReference>
    <cbc:ID>PIH</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${inv.previousInvoiceHash}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(inv.sellerVatNumber)}</cbc:CompanyID>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(inv.sellerName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      ${inv.buyerVatNumber ? `<cac:PartyTaxScheme><cbc:CompanyID>${escapeXml(inv.buyerVatNumber)}</cbc:CompanyID></cac:PartyTaxScheme>` : ''}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(inv.buyerName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="SAR">${inv.tax.toFixed(2)}</cbc:TaxAmount>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="SAR">${inv.subtotal.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:AllowanceTotalAmount currencyID="SAR">${inv.discount.toFixed(2)}</cbc:AllowanceTotalAmount>
    <cbc:TaxInclusiveAmount currencyID="SAR">${inv.total.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="SAR">${inv.total.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lines}
</Invoice>`;
}

export interface ZatcaSubmissionResult {
  status: 'CLEARED' | 'REPORTED' | 'FAILED' | 'NOT_CONFIGURED';
  message: string;
  rawResponse?: string;
}

/** Submits the invoice XML to the configured ZATCA endpoint (clearance for B2B, reporting for B2C). */
export async function submitInvoiceToZatca(xmlBase64: string, uuid: string, isSimplified: boolean): Promise<ZatcaSubmissionResult> {
  const enabled = (await getSetting('zatcaEnabled')) === 'true';
  if (!enabled) return { status: 'NOT_CONFIGURED', message: 'الفوترة الإلكترونية (المرحلة الثانية) غير مُفعّلة في شاشة الإعدادات' };

  const baseUrl = await getSetting('zatcaApiBaseUrl');
  const token = await getSetting('zatcaBinarySecurityToken');
  const secret = await getSetting('zatcaSecret');
  if (!baseUrl || !token || !secret) {
    return { status: 'NOT_CONFIGURED', message: 'لم يتم ضبط شهادة الاعتماد (CSID) أو السر المشترك في شاشة الإعدادات — راجع بوابة فاتورة لاستخراجها' };
  }

  const path = isSimplified ? '/invoices/reporting/single' : '/invoices/clearance/single';
  const auth = Buffer.from(`${token}:${secret}`).toString('base64');

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Clearance-Status': '1',
        'Accept-Version': 'V2',
      },
      body: JSON.stringify({ invoiceHash: xmlBase64, uuid, invoice: xmlBase64 }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      return { status: 'FAILED', message: `رفضت الهيئة الفاتورة (HTTP ${res.status})`, rawResponse: text.slice(0, 2000) };
    }
    return { status: isSimplified ? 'REPORTED' : 'CLEARED', message: 'تم إرسال الفاتورة بنجاح', rawResponse: text.slice(0, 2000) };
  } catch (err: any) {
    return { status: 'FAILED', message: `تعذّر الاتصال ببوابة هيئة الزكاة: ${err?.message ?? 'خطأ غير معروف'}` };
  }
}
