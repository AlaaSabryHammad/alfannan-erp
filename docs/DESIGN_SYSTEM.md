# نظام الفنان — Design System (extracted from screenshots)

RTL Arabic ERP. Match these tokens & layout in the React frontend (apps/web).

## Colors
| Token | Value | Usage |
|---|---|---|
| `primary` | `#0e9384` | main teal — buttons, active, links, KPI accents |
| `primary-600` | `#0c7d70` | hover |
| `primary-50` | `#e6f5f3` | tinted backgrounds, active nav pill |
| `sidebar-from` | `#0b1f1d` | sidebar gradient top |
| `sidebar-to` | `#103a35` | sidebar gradient bottom (very dark teal/near-black) |
| `accent` | `#f97316` | orange — "شاشة البيع السريع" button, active POS item, "توزيع الأرباح" |
| `bg` | `#f1f5f9` | app background |
| `card` | `#ffffff` | cards/panels |
| `border` | `#e5e7eb` | hairlines |
| `text` | `#0f172a` | primary text |
| `muted` | `#64748b` | secondary text |
| `success` | `#16a34a` / bg `#dcfce7` | نشط / مدفوعة / مسددة badges |
| `danger` | `#dc2626` / bg `#fee2e2` | غير مسددة / negative balances |
| `warning` | `#d97706` / bg `#fef3c7` | low-stock / تنبيهات |

KPI card icons each sit in a soft tinted circle (teal/red/blue/purple/amber/green) matching the metric.

## Typography
- Font: **Tajawal** (or Cairo) via Google Fonts. Weights 400/500/700.
- Numbers: Western digits, thousands separator, 2 decimals, suffix `ج.م` (e.g. `421,863.70 ج.م`).
- Headings bold; page has title + gray subtitle line under it.

## Layout
- `dir="rtl"`. Sidebar is on the **right**; main content on the left.
- **Sidebar** (~260px, dark gradient, scrollable): brand block at top ("الفنان للتوريدات العمومية" + "لوحة التحكم الإدارية" + version chip `v2.5.0` + live clock). Nav grouped with gray section labels:
  - الرئيسية والتحليلات: لوحة التحكم
  - المخزون والأصناف: المنتجات (الأصناف/الأقسام/العلامات التجارية/وحدات القياس) · المخزون (المستودعات/رصيد المخزون/تحويل المخزون) · ملصقات الباركود والـQR
  - المبيعات والمشتريات: شاشة POS السريعة (orange highlight) · المبيعات (العملاء/فواتير البيع) · المشتريات (الموردون/فواتير الشراء)
  - الحسابات والشركاء: نظام الشركاء (حقوق الملكية) · الحسابات العامة
  - الإدارة والتقارير: تقارير النظام · سجل التنبيهات · الإعدادات · المستخدمون والصلاحيات (المستخدمون/الأدوار والصلاحيات)
  - Active item = filled pill (teal, or orange for POS). Collapsible groups with chevrons.
- **Topbar** (white, sticky): right→left = user chip (avatar + name + role beneath, e.g. "المدير العام"), notifications bell, orange "شاشة البيع السريع" button; center quick filters (الفترة / تصفية سريعة / من تاريخ / إلى تاريخ); left = teal "كافة الفروع والمستودعات" branch selector + hamburger.
- Footer: "© 2026 نظام التوريدات العمومية · ElbanaNET Solutions · جميع الحقوق محفوظة" → change ElbanaNET refs to الفنان branding where the brand text appears.

## Components
- **Cards:** white, `rounded-2xl`, `border`, soft shadow, padding 20-24px.
- **KPI card:** label (top, gray) + big value + small colored sub-label, with tinted icon circle on the side.
- **Buttons:** primary = teal filled rounded-lg; accent = orange; "إضافة …" primary buttons sit top-right of list pages.
- **Tables:** toolbar row with "بحث سريع" input + "عرض [N] سجلات" select + export buttons (نسخ / Excel / PDF / طباعة). Header row light gray, sortable carets. Row actions = small icon buttons (edit ✎ / delete 🗑 / view 👁). Pagination footer "عرض 1 إلى N من أصل M سجل" + الأول/السابق/[1][2]/التالي/الأخير.
- **Badges:** pill, colored bg + text per status table above.
- **Charts (Recharts):** line/area for monthly sales vs purchases; donut for partner capital shares (center label = total). Smooth curves, teal+blue series.
- **Modals/Drawers:** for create/edit forms (React Hook Form + Zod).

## Login page
Split card centered on light bg. Right half = teal gradient panel: brand "نظام الفنان للتوريدات والمخازن" + tagline "إدارة أعمالك باحترافية" + 3 feature bullets (إدارة الفروع والمستودعات / ملصقات الباركود و QR مخصصة / تقارير وتحليلات متطورة) + "إصدار 2.1 © 2026 حلول الفنان". Left half = form: "أهلاً بك مجدداً!", email, password, "تذكرني على هذا الجهاز", teal "دخول النظام" button, then "تجربة سريعة للنظام بأدوار مختلفة:" with 5 role quick-login chips (المدير العام/admin@store.com, مدير النظام/manager@store.com, المحاسب المالي/accountant@store.com, أمين المخزن/storekeeper@store.com, كاشير/cashier@store.com). Clicking a chip fills creds (password 123456).
