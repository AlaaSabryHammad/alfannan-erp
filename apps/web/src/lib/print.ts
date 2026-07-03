import QRCode from 'qrcode';
import { formatMoney, formatDate } from './utils';
import { buildZatcaQrPayload } from './zatcaQr';

const COMPANY = 'الفنان للتوريدات العمومية';
const SYSTEM = 'نظام الفنان للتوريدات والمخازن';
const PRIMARY = '#0e9384';

function esc(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Opens a print window with the given body HTML + RTL print CSS and triggers print. */
function printDocument(bodyHtml: string, opts: { title: string; pageCss: string }): void {
  const w = window.open('', '_blank', 'width=900,height=760');
  if (!w) {
    alert('تعذّر فتح نافذة الطباعة — الرجاء السماح بالنوافذ المنبثقة لهذا الموقع.');
    return;
  }
  w.document.write(
    `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">` +
      `<title>${esc(opts.title)}</title>` +
      `<link rel="preconnect" href="https://fonts.googleapis.com">` +
      `<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap" rel="stylesheet">` +
      `<style>${opts.pageCss}</style></head><body>${bodyHtml}</body></html>`
  );
  w.document.close();
  w.focus();
  // Give fonts/layout a moment, then print.
  setTimeout(() => {
    w.print();
  }, 450);
}

// ---------------- ZATCA QR (Saudi e-invoice Phase 1) ----------------

/**
 * Renders the ZATCA QR as a data-URL <img> block, or '' when no seller VAT
 * number is configured (e.g. purchase invoices, or before Settings are filled in).
 */
async function zatcaQrBlock(params: { sellerVatNumber?: string | null; date: string; total: number; tax: number; qrPayload?: string | null }): Promise<string> {
  // Prefer the server-generated payload (Phase-2, cryptographically stamped)
  // once the invoice has been submitted; otherwise fall back to the client-side
  // Phase-1 QR built from the mandatory fields.
  let payload = params.qrPayload ?? '';
  if (!payload) {
    if (!params.sellerVatNumber) return '';
    payload = buildZatcaQrPayload({
      sellerName: COMPANY,
      vatNumber: params.sellerVatNumber,
      timestamp: new Date(params.date).toISOString(),
      invoiceTotal: params.total,
      vatTotal: params.tax,
    });
  }
  const dataUrl = await QRCode.toDataURL(payload, { margin: 1, width: 110 });
  return `<div class="zatca-qr"><img src="${dataUrl}" width="110" height="110" alt="ZATCA QR" /><p>فاتورة ضريبية متوافقة مع منظومة (فاتورة)</p></div>`;
}

const ZATCA_QR_CSS = `
  .zatca-qr { text-align: center; margin-top: 14px; }
  .zatca-qr p { font-size: 10px; color: #64748b; margin: 4px 0 0; }
`;

// ---------------- A4 invoice (sales / purchase) ----------------

export interface PrintLineItem {
  name: string;
  sku?: string | null;
  unit?: string | null;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface InvoiceDoc {
  /** e.g. "فاتورة مبيعات" or "فاتورة مشتريات" */
  docTitle: string;
  refNo: string;
  date: string;
  /** "العميل" or "المورد" */
  partyLabel: string;
  partyName: string;
  partyExtra?: string | null;
  paymentText?: string | null;
  statusText?: string | null;
  /** purchase only */
  receiveText?: string | null;
  warehouse?: string | null;
  items: PrintLineItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  /** Company's ZATCA VAT registration number — when present, a compliant QR is printed. */
  sellerVatNumber?: string | null;
  /** Server-generated Phase-2 (stamped) QR payload — preferred over the client Phase-1 QR when set. */
  zatcaQrPayload?: string | null;
}

const A4_CSS = `
  * { box-sizing: border-box; }
  @page { size: A4; margin: 14mm; }
  body { font-family: 'Tajawal', Arial, sans-serif; color: #0f172a; margin: 0; }
  .doc { max-width: 800px; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid ${PRIMARY}; padding-bottom: 14px; margin-bottom: 18px; }
  .brand .logo { width: 54px; height: 54px; border-radius: 12px; background: ${PRIMARY}; color: #fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:22px; margin-bottom:8px; }
  .brand h1 { font-size: 20px; margin: 0 0 2px; color: ${PRIMARY}; }
  .brand p { font-size: 12px; color: #64748b; margin: 0; }
  .doc-meta { text-align: left; }
  .doc-meta h2 { font-size: 22px; margin: 0 0 6px; }
  .doc-meta .row { font-size: 12px; color: #475569; margin: 2px 0; }
  .doc-meta .row b { color: #0f172a; }
  .party { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 16px; margin-bottom: 16px; font-size: 13px; }
  .party .lbl { color: #64748b; font-size: 11px; }
  .party .nm { font-weight: 700; font-size: 15px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  thead th { background: ${PRIMARY}; color: #fff; padding: 9px 10px; text-align: right; font-weight: 600; }
  tbody td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  .sku { color: #94a3b8; font-size: 10.5px; }
  .num { font-family: 'Courier New', monospace; }
  .totals { margin-top: 16px; margin-right: auto; width: 280px; font-size: 13px; }
  .totals .t { display:flex; justify-content: space-between; padding: 4px 0; }
  .totals .grand { border-top: 2px solid ${PRIMARY}; margin-top: 6px; padding-top: 8px; font-weight: 700; font-size: 16px; color: ${PRIMARY}; }
  .foot { margin-top: 30px; border-top: 1px solid #e5e7eb; padding-top: 12px; text-align: center; color: #64748b; font-size: 11.5px; }
  .badge { display:inline-block; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  ${ZATCA_QR_CSS}
`;

export async function printInvoice(doc: InvoiceDoc): Promise<void> {
  const rows = doc.items
    .map(
      (it, i) =>
        `<tr><td>${i + 1}</td><td>${esc(it.name)}${
          it.sku ? `<div class="sku">${esc(it.sku)}</div>` : ''
        }</td><td>${esc(it.unit ?? '—')}</td><td class="num">${esc(
          it.qty
        )}</td><td class="num">${esc(formatMoney(it.unitPrice))}</td><td class="num">${esc(
          formatMoney(it.lineTotal)
        )}</td></tr>`
    )
    .join('');

  const metaRows =
    `<div class="row">رقم الفاتورة: <b>${esc(doc.refNo)}</b></div>` +
    `<div class="row">التاريخ: <b>${esc(formatDate(doc.date))}</b></div>` +
    (doc.warehouse ? `<div class="row">المستودع: <b>${esc(doc.warehouse)}</b></div>` : '') +
    (doc.paymentText ? `<div class="row">طريقة الدفع: <b>${esc(doc.paymentText)}</b></div>` : '') +
    (doc.receiveText ? `<div class="row">حالة الاستلام: <b>${esc(doc.receiveText)}</b></div>` : '') +
    (doc.statusText ? `<div class="row">حالة السداد: <b>${esc(doc.statusText)}</b></div>` : '');

  const body = `
    <div class="doc">
      <div class="head">
        <div class="brand">
          <div class="logo">ف</div>
          <h1>${esc(COMPANY)}</h1>
          <p>${esc(SYSTEM)}</p>
        </div>
        <div class="doc-meta">
          <h2>${esc(doc.docTitle)}</h2>
          ${metaRows}
        </div>
      </div>

      <div class="party">
        <span class="lbl">${esc(doc.partyLabel)}</span>
        <div class="nm">${esc(doc.partyName)}</div>
        ${doc.partyExtra ? `<div>${esc(doc.partyExtra)}</div>` : ''}
      </div>

      <table>
        <thead><tr>
          <th>#</th><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="totals">
        <div class="t"><span>المجموع الفرعي</span><span class="num">${esc(formatMoney(doc.subtotal))}</span></div>
        ${doc.discount > 0 ? `<div class="t"><span>الخصم</span><span class="num">− ${esc(formatMoney(doc.discount))}</span></div>` : ''}
        ${doc.tax > 0 ? `<div class="t"><span>الضريبة</span><span class="num">${esc(formatMoney(doc.tax))}</span></div>` : ''}
        <div class="t grand"><span>الإجمالي الكلي</span><span class="num">${esc(formatMoney(doc.total))}</span></div>
      </div>

      ${await zatcaQrBlock({ sellerVatNumber: doc.sellerVatNumber, date: doc.date, total: doc.total, tax: doc.tax, qrPayload: doc.zatcaQrPayload })}

      <div class="foot">
        شكراً لتعاملكم مع ${esc(COMPANY)} · تمت الطباعة بتاريخ ${esc(formatDate(new Date().toISOString()))}
      </div>
    </div>`;

  printDocument(body, { title: `${doc.docTitle} ${doc.refNo}`, pageCss: A4_CSS });
}

// ---------------- Account statement (كشف حساب) ----------------

export interface StatementLine {
  date: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface StatementDoc {
  /** "كشف حساب عميل" or "كشف حساب مورد" */
  docTitle: string;
  partyLabel: string;
  partyName: string;
  openingBalance: number;
  lines: StatementLine[];
  closingBalance: number;
}

export function printStatement(doc: StatementDoc): void {
  const rows = doc.lines
    .map(
      (l) =>
        `<tr><td>${esc(formatDate(l.date))}</td><td>${esc(l.description)}</td>` +
        `<td class="num">${l.debit > 0 ? esc(formatMoney(l.debit)) : '—'}</td>` +
        `<td class="num">${l.credit > 0 ? esc(formatMoney(l.credit)) : '—'}</td>` +
        `<td class="num">${esc(formatMoney(l.balance))}</td></tr>`
    )
    .join('');

  const body = `
    <div class="doc">
      <div class="head">
        <div class="brand">
          <div class="logo">ف</div>
          <h1>${esc(COMPANY)}</h1>
          <p>${esc(SYSTEM)}</p>
        </div>
        <div class="doc-meta">
          <h2>${esc(doc.docTitle)}</h2>
          <div class="row">تاريخ الطباعة: <b>${esc(formatDate(new Date().toISOString()))}</b></div>
        </div>
      </div>

      <div class="party">
        <span class="lbl">${esc(doc.partyLabel)}</span>
        <div class="nm">${esc(doc.partyName)}</div>
      </div>

      <table>
        <thead><tr>
          <th>التاريخ</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد الجاري</th>
        </tr></thead>
        <tbody>
          <tr><td colspan="4">الرصيد الافتتاحي</td><td class="num">${esc(formatMoney(doc.openingBalance))}</td></tr>
          ${rows}
        </tbody>
      </table>

      <div class="totals">
        <div class="t grand"><span>الرصيد الختامي</span><span class="num">${esc(formatMoney(doc.closingBalance))}</span></div>
      </div>

      <div class="foot">
        ${esc(COMPANY)} · تمت الطباعة بتاريخ ${esc(formatDate(new Date().toISOString()))}
      </div>
    </div>`;

  printDocument(body, { title: doc.docTitle, pageCss: A4_CSS });
}

// ---------------- POS thermal receipt ----------------

export interface ReceiptDoc {
  refNo?: string | null;
  cashier?: string | null;
  customer?: string | null;
  paymentText?: string | null;
  items: { name: string; qty: number; unitPrice: number; lineTotal: number }[];
  subtotal: number;
  discount: number;
  tax?: number;
  total: number;
  /** Company's ZATCA VAT registration number — when present, a compliant QR is printed. */
  sellerVatNumber?: string | null;
  /** Server-generated Phase-2 (stamped) QR payload — preferred over the client Phase-1 QR when set. */
  zatcaQrPayload?: string | null;
}

const RECEIPT_CSS = `
  @page { size: 80mm auto; margin: 4mm; }
  body { font-family: 'Tajawal', Arial, sans-serif; color: #000; margin: 0; width: 72mm; font-size: 12px; }
  .r { width: 100%; }
  .c { text-align: center; }
  h1 { font-size: 15px; margin: 0; }
  .sub { font-size: 10.5px; color: #333; margin: 2px 0 6px; }
  .meta { font-size: 10.5px; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 5px 0; margin: 6px 0; }
  .meta div { display:flex; justify-content: space-between; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  td { padding: 3px 0; vertical-align: top; }
  .qx { color:#555; font-size: 10px; }
  .ln { text-align: left; font-family: 'Courier New', monospace; white-space: nowrap; }
  .tot { border-top: 1px dashed #000; margin-top: 6px; padding-top: 6px; }
  .tot .g { display:flex; justify-content: space-between; font-weight: 700; font-size: 14px; }
  .tot .s { display:flex; justify-content: space-between; font-size: 11px; }
  .foot { text-align:center; margin-top: 10px; font-size: 10.5px; border-top: 1px dashed #000; padding-top: 6px; }
  ${ZATCA_QR_CSS}
`;

export async function printReceipt(doc: ReceiptDoc): Promise<void> {
  const rows = doc.items
    .map(
      (it) =>
        `<tr><td>${esc(it.name)}<div class="qx">${esc(it.qty)} × ${esc(
          formatMoney(it.unitPrice)
        )}</div></td><td class="ln">${esc(formatMoney(it.lineTotal))}</td></tr>`
    )
    .join('');

  const now = new Date();
  const body = `
    <div class="r">
      <div class="c">
        <h1>${esc(COMPANY)}</h1>
        <div class="sub">${esc(SYSTEM)}</div>
      </div>
      <div class="meta">
        ${doc.refNo ? `<div><span>رقم الإيصال</span><span>${esc(doc.refNo)}</span></div>` : ''}
        <div><span>التاريخ</span><span>${esc(now.toLocaleString('en-GB'))}</span></div>
        ${doc.cashier ? `<div><span>الكاشير</span><span>${esc(doc.cashier)}</span></div>` : ''}
        ${doc.customer ? `<div><span>العميل</span><span>${esc(doc.customer)}</span></div>` : ''}
      </div>
      <table><tbody>${rows}</tbody></table>
      <div class="tot">
        ${doc.discount > 0 ? `<div class="s"><span>المجموع الفرعي</span><span>${esc(formatMoney(doc.subtotal))}</span></div><div class="s"><span>الخصم</span><span>− ${esc(formatMoney(doc.discount))}</span></div>` : ''}
        <div class="g"><span>الإجمالي</span><span>${esc(formatMoney(doc.total))}</span></div>
        ${doc.paymentText ? `<div class="s"><span>طريقة الدفع</span><span>${esc(doc.paymentText)}</span></div>` : ''}
      </div>
      ${await zatcaQrBlock({ sellerVatNumber: doc.sellerVatNumber, date: now.toISOString(), total: doc.total, tax: doc.tax ?? 0, qrPayload: doc.zatcaQrPayload })}
      <div class="foot">شكراً لتعاملكم مع ${esc(COMPANY)}</div>
    </div>`;

  printDocument(body, { title: `إيصال ${doc.refNo ?? ''}`.trim(), pageCss: RECEIPT_CSS });
}
