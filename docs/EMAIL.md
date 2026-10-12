# البريد الإلكتروني (تأكيد البريد)

النظام يرسل رسالة تأكيد بريد إلكتروني عند تسجيل شركة جديدة، ويمكن إعادة إرسالها من شريط التنبيه داخل النظام.
التأكيد «ناعم»: لا يمنع الدخول ولا أي عملية، لكن الشريط يبقى ظاهرًا لمدير الشركة حتى يُفتح الرابط.

## الإعداد على Hostinger

1. من hPanel ← **Emails** ← أنشئ صندوقًا مثل `no-reply@handaza.cloud` (أو أي نطاق تملكه).
2. أضف في `/opt/alfannan/.env.docker`:

   ```env
   SMTP_HOST=smtp.hostinger.com
   SMTP_PORT=465
   SMTP_USER=no-reply@handaza.cloud
   SMTP_PASS=كلمة-سر-الصندوق
   MAIL_FROM="الفنان السعودي <no-reply@handaza.cloud>"
   ```

   المنفذ 465 = SSL مباشر (الافتراضي). لو استخدمت 587 أضف `SMTP_SECURE=false`.
3. أعد تشغيل الـ API: `./dc up -d api`.

بدون `SMTP_HOST` لا يُرسل شيء (يظهر تحذير في سجل الـ API، وزر «إعادة إرسال» يردّ برسالة أن الخدمة غير مفعّلة).

## كي لا تذهب الرسائل إلى Spam

- فعّل **SPF** و**DKIM** لنطاق المرسل (Hostinger يضيفهما تلقائيًا إذا كان النطاق على DNS الخاص به؛ وإلا أضف سجلاتهما من hPanel ← Emails ← DNS).
- أضف سجل **DMARC** (مثال: `v=DMARC1; p=none; rua=mailto:no-reply@handaza.cloud`).
- استخدم عنوان `MAIL_FROM` من نفس نطاق الصندوق.

## كيف يعمل

- الرابط: `PUBLIC_BASE_URL/verify-email?token=…` — توكن موقّع، صالح 48 ساعة، مربوط بالبريد الذي صدر له (لو تغيّر البريد يبطل).
- `POST /api/auth/verify-email` (عام) يؤكد العنوان؛ `POST /api/auth/resend-verification` (يتطلب دخولًا) يعيد الإرسال مرة كل دقيقة.
- `GET /api/auth/me` يعيد `emailVerified`.
- القالب في `apps/api/src/lib/mail/templates.ts` (RTL، جداول وأنماط inline لتعمل في Gmail/Outlook/الجوال).
