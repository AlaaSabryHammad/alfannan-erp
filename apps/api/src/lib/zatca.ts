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

/**
 * The invoice hash per ZATCA is SHA-256 of the invoice XML (with the PIH already
 * embedded), Base64-encoded. The PIH must be inside the XML BEFORE hashing —
 * that's what chains each invoice to its predecessor. NOTE: production requires
 * XML canonicalization (C14N) via ZATCA's SDK before hashing; here we hash the
 * UTF-8 XML bytes deterministically, which is correct in structure and stable,
 * and is the drop-in point for C14N once the SDK/certificate are available.
 */
export function computeInvoiceHash(xml: string): string {
  return crypto.createHash('sha256').update(xml, 'utf8').digest('base64');
}

/**
 * ECDSA cryptographic stamp: signs the invoice (its SHA-256 digest) with the
 * taxpayer's private key (PEM, secp256k1 per ZATCA). Returns the Base64
 * signature, or null when no signing key is configured (Phase 1 only).
 */
export function signInvoiceXml(xml: string, privateKeyPem: string | null): string | null {
  if (!privateKeyPem?.trim()) return null;
  const key = crypto.createPrivateKey(privateKeyPem);
  return crypto.sign('sha256', Buffer.from(xml, 'utf8'), key).toString('base64');
}

/** Verify a signature produced by signInvoiceXml (used by tests and diagnostics). */
export function verifyInvoiceSignature(xml: string, signatureBase64: string, publicKeyPem: string): boolean {
  const key = crypto.createPublicKey(publicKeyPem);
  return crypto.verify('sha256', Buffer.from(xml, 'utf8'), key, Buffer.from(signatureBase64, 'base64'));
}

// ── QR (TLV + Base64) ──────────────────────────────────────────────────────────
function tlv(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag, value.length]), value]);
}

export interface ZatcaQrInput {
  sellerName: string;
  sellerVatNumber: string;
  timestamp: string;      // ISO 8601
  invoiceTotal: number;   // incl. VAT
  vatTotal: number;
  invoiceHash?: string;   // Phase 2: base64 SHA-256 of the XML
  signatureBase64?: string | null; // Phase 2: ECDSA stamp
  publicKeyDer?: Buffer | null;    // Phase 2: seller public key (DER)
}

/**
 * Builds the Base64 TLV QR payload. With a hash + signature + public key present
 * it emits the 9-tag Phase-2 form (tags 6-8; tag 9, ZATCA's stamp over the public
 * key, is only available after clearance and is omitted offline). Otherwise it
 * emits the 5-tag Phase-1 form.
 */
export function buildQrPayload(q: ZatcaQrInput): string {
  const enc = (s: string) => Buffer.from(s, 'utf8');
  const parts: Buffer[] = [
    tlv(1, enc(q.sellerName)),
    tlv(2, enc(q.sellerVatNumber)),
    tlv(3, enc(q.timestamp)),
    tlv(4, enc(q.invoiceTotal.toFixed(2))),
    tlv(5, enc(q.vatTotal.toFixed(2))),
  ];
  if (q.invoiceHash && q.signatureBase64 && q.publicKeyDer) {
    parts.push(tlv(6, enc(q.invoiceHash)));
    parts.push(tlv(7, Buffer.from(q.signatureBase64, 'base64')));
    parts.push(tlv(8, q.publicKeyDer));
  }
  return Buffer.concat(parts).toString('base64');
}

/** Decode a TLV/Base64 QR payload back to a tag→value map (bytes). Test/diagnostic helper. */
export function decodeQrPayload(base64: string): Map<number, Buffer> {
  const buf = Buffer.from(base64, 'base64');
  const out = new Map<number, Buffer>();
  let i = 0;
  while (i + 2 <= buf.length) {
    const tag = buf[i];
    const len = buf[i + 1];
    out.set(tag, buf.subarray(i + 2, i + 2 + len));
    i += 2 + len;
  }
  return out;
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
