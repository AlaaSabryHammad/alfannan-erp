/**
 * E-mail templates — Arabic, right-to-left, table layout with inline styles so it renders the same in
 * Gmail, Outlook and phone clients. Every dynamic value is HTML-escaped.
 */

const BRAND = 'نظام الفنان';
const TEAL = '#0f766e';
const TEAL_DARK = '#115e59';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface VerificationEmailInput {
  name: string;
  companyName: string;
  url: string;
  /** how long the link is valid, in hours */
  validHours: number;
}

export function verificationEmail(input: VerificationEmailInput): { subject: string; html: string; text: string } {
  const name = escapeHtml(input.name);
  const company = escapeHtml(input.companyName);
  const url = escapeHtml(input.url);
  const subject = `أكّد بريدك الإلكتروني — ${BRAND}`;

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f1f5f9;">
    خطوة واحدة تفصلك عن تفعيل حسابك — أكّد بريدك الإلكتروني.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr>
            <td align="center" style="background:${TEAL};background-image:linear-gradient(135deg,${TEAL} 0%,${TEAL_DARK} 100%);padding:36px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="width:64px;height:64px;background:rgba(255,255,255,0.18);border-radius:32px;font-size:30px;line-height:64px;color:#ffffff;font-family:Tahoma,Arial,sans-serif;">&#9993;</td>
                </tr>
              </table>
              <div style="font-family:Tahoma,'Segoe UI',Arial,sans-serif;font-size:22px;font-weight:bold;color:#ffffff;margin-top:14px;">${BRAND}</div>
              <div style="font-family:Tahoma,'Segoe UI',Arial,sans-serif;font-size:13px;color:#ccfbf1;margin-top:4px;">للتوريدات والمخازن والمحاسبة</div>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px 8px 32px;font-family:Tahoma,'Segoe UI',Arial,sans-serif;direction:rtl;text-align:right;">
              <h1 style="margin:0 0 14px 0;font-size:21px;line-height:1.5;color:#0f172a;">أهلًا ${name} 👋</h1>
              <p style="margin:0 0 12px 0;font-size:15px;line-height:1.9;color:#334155;">
                شكرًا لتسجيل شركة <strong style="color:#0f172a;">${company}</strong> في ${BRAND}.
                لإتمام تفعيل حسابك، يرجى تأكيد بريدك الإلكتروني بالضغط على الزر أدناه.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:20px 32px 8px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" bgcolor="${TEAL}" style="border-radius:12px;">
                    <a href="${url}" target="_blank" style="display:inline-block;padding:15px 40px;font-family:Tahoma,'Segoe UI',Arial,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:12px;background:${TEAL};">تأكيد البريد الإلكتروني</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 8px 32px;font-family:Tahoma,'Segoe UI',Arial,sans-serif;direction:rtl;text-align:right;">
              <p style="margin:0 0 8px 0;font-size:13px;line-height:1.8;color:#64748b;">
                الرابط صالح لمدة ${input.validHours} ساعة. وإذا لم يعمل الزر، انسخ الرابط التالي والصقه في المتصفح:
              </p>
              <p dir="ltr" style="margin:0;font-size:12px;line-height:1.7;color:${TEAL};word-break:break-all;text-align:left;">${url}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 32px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
                <tr>
                  <td style="padding:14px 16px;font-family:Tahoma,'Segoe UI',Arial,sans-serif;font-size:12.5px;line-height:1.8;color:#64748b;direction:rtl;text-align:right;">
                    🔒 إذا لم تقم بإنشاء هذا الحساب فتجاهل هذه الرسالة، ولن يُفعَّل أي شيء. ولن نطلب منك كلمة المرور عبر البريد أبدًا.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 24px;font-family:Tahoma,'Segoe UI',Arial,sans-serif;font-size:12px;color:#94a3b8;">
              © 2026 ${BRAND} · حلول الفنان · رسالة آلية، يرجى عدم الرد عليها
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `أهلًا ${input.name}،`,
    '',
    `شكرًا لتسجيل شركة ${input.companyName} في ${BRAND}.`,
    'لإتمام تفعيل حسابك، أكّد بريدك الإلكتروني من الرابط التالي:',
    input.url,
    '',
    `الرابط صالح لمدة ${input.validHours} ساعة.`,
    'إذا لم تقم بإنشاء هذا الحساب فتجاهل هذه الرسالة.',
  ].join('\n');

  return { subject, html, text };
}
