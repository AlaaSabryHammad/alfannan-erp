# النسخ الاحتياطي والاستعادة

## كيف يعمل

| الطبقة | ماذا | أين |
|---|---|---|
| 1. على السيرفر | حاوية `backup` تأخذ `pg_dump` مضغوطًا كل 24 ساعة وتُبقي آخر 30 | `/opt/alfannan/backups/alfannan-YYYYMMDD-HHMMSS.dump` |
| 2. خارج السيرفر | `scripts/pull-backups.ps1` يسحب أي نسخة جديدة، يتحقق منها، ويُبقي آخر 60 | `D:\backups\alfannan` على جهازك |

الطبقة 1 وحدها تحميك من خطأ في البيانات، لكنها على نفس جهاز قاعدة البيانات؛ ضياع الجهاز يضيّعها معه. الطبقة 2 هي النسخة «خارج الموقع».

> **لا تشمل النسخة** مجلد الصور المرفوعة (volume `uploads`) — انظر «الصور المرفوعة» أدناه.

## الإعداد (مرة واحدة)

### 1) دخول SSH بمفتاح (بدون كلمة سر، ليعمل بدون تدخّل)

على جهازك (PowerShell):

```powershell
if (-not (Test-Path $env:USERPROFILE\.ssh\id_ed25519)) { ssh-keygen -t ed25519 -N '""' -f $env:USERPROFILE\.ssh\id_ed25519 }
```

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@100.64.92.110 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

تأكد (لا يجب أن يطلب كلمة سر):

```powershell
ssh -o BatchMode=yes root@100.64.92.110 "ls /opt/alfannan/backups | tail -3"
```

### 2) أول سحب يدويًا

```powershell
powershell -ExecutionPolicy Bypass -File D:\projects\Alfannan\scripts\pull-backups.ps1
```

### 3) جدولته يوميًا

```powershell
powershell -ExecutionPolicy Bypass -File D:\projects\Alfannan\scripts\register-backup-task.ps1 -At 03:45
```

يُشغَّل يوميًا 03:45 (وإن كان الجهاز مطفأً يعمل عند أول تشغيل، مع 3 محاولات إعادة).

## المتابعة

* السجل: `D:\backups\alfannan\pull-backups.log`
* رموز الخروج: `0` سليم · `1` خطأ (نسخة فشل نسخها/تحققها، أو السيرفر لا يردّ) · `2` السيرفر لم ينتج نسخة منذ أكثر من 36 ساعة
* آخر نتيجة للمهمة: `Get-ScheduledTaskInfo -TaskName Alfannan-Pull-Backups | Select LastRunTime, LastTaskResult`

كل نسخة تُفحص قبل اعتمادها: حجم معقول و`pg_restore --list` يقرأ فهرسها. النسخة التالفة لا تُحفظ ويُسجَّل خطأ.

## الاستعادة

### أ) الاطلاع على نسخة دون المساس بالإنتاج (قاعدة مؤقتة)

```bash
createdb -U postgres alfannan_restore_check
pg_restore -U postgres -d alfannan_restore_check --no-owner --exit-on-error alfannan-YYYYMMDD-HHMMSS.dump
psql -U postgres -d alfannan_restore_check -c 'select count(*) from "Tenant"'
dropdb -U postgres alfannan_restore_check
```

### ب) استعادة كاملة على السيرفر (كارثة / بيانات تالفة)

1. أوقف التطبيق (تبقى قاعدة البيانات تعمل):
   ```bash
   cd /opt/alfannan && docker compose --env-file .env.docker -p alfannan stop api web backup
   ```
2. ارفع النسخة المطلوبة للسيرفر (`scp`) ثم أعد إنشاء القاعدة واستعدها:
   ```bash
   docker compose --env-file .env.docker -p alfannan exec -T db psql -U postgres -c 'DROP DATABASE alfannan WITH (FORCE)' -c 'CREATE DATABASE alfannan'
   docker compose --env-file .env.docker -p alfannan cp ./alfannan-YYYYMMDD-HHMMSS.dump db:/tmp/restore.dump
   docker compose --env-file .env.docker -p alfannan exec -T db pg_restore -U postgres -d alfannan --no-owner --exit-on-error /tmp/restore.dump
   ```
3. شغّل التطبيق (يطبّق أي migration ناقصة ويضبط كلمة سر role التطبيق):
   ```bash
   docker compose --env-file .env.docker -p alfannan up -d
   ```
4. تحقّق (المتوقع: عدد الشركات والمستخدمين كما قبل، وميزان المراجعة متوازن):
   ```bash
   docker compose --env-file .env.docker -p alfannan exec -T db psql -U postgres -d alfannan -c 'select (select count(*) from "Tenant") tenants, (select count(*) from "User") users, (select coalesce(sum(debit)-sum(credit),0) from "JournalLine") ledger_diff'
   ```

> على سيرفر **جديد تمامًا**: شغّل `docker compose up -d db` أولًا ثم أنشئ الـ role قبل الاستعادة حتى لا تفشل أوامر `GRANT`:
> `docker compose ... exec -T db psql -U postgres -c "CREATE ROLE alfannan_app NOLOGIN NOSUPERUSER NOBYPASSRLS"`

### تدريب الاستعادة (شهريًا)

نفّذ (أ) على أحدث نسخة من `D:\backups\alfannan` وقارن:

```sql
select (select count(*) from "Tenant")       as tenants,
       (select count(*) from "User")         as users,
       (select count(*) from "SalesInvoice") as invoices,
       (select count(*) from pg_class where relrowsecurity and relforcerowsecurity and relkind = 'r') as rls_tables,
       (select coalesce(sum(debit) - sum(credit), 0) from "JournalLine") as ledger_diff;
```

`ledger_diff` يجب أن يساوي `0`، و`rls_tables` عدد جداول الشركات (63 حاليًا). جُرّب هذا الإجراء بنجاح بعد بناء السكربت: نسخة مسحوبة واستُعيدت في قاعدة مؤقتة وطابقت المصدر في كل العدّادات.

## الصور المرفوعة (غير مشمولة بالنسخة)

صور الأصناف تُحفظ في volume `uploads`، وليست جزءًا من `pg_dump`. للنسخ اليدوي على السيرفر:

```bash
docker run --rm -v alfannan_uploads:/data -v /opt/alfannan/backups:/out alpine tar czf /out/uploads-$(date +%Y%m%d).tgz -C /data .
```

والاستعادة: `docker run --rm -v alfannan_uploads:/data -v /opt/alfannan/backups:/in alpine tar xzf /in/uploads-YYYYMMDD.tgz -C /data`.

## ملاحظات أمان

* النسخة تحوي بيانات كل الشركات (فواتير، عملاء، بصمات كلمات السر) — احفظ `D:\backups\alfannan` على قرص مشفَّر (BitLocker) ولا تشاركه.
* عند ربط وجهة سحابية لاحقًا (Google Drive / S3) شفّر الملفات قبل الرفع.
