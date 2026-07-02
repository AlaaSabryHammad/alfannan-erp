# نظام الفنان — Quick Wins Plan (Opus 4.8 planning)

Three high-value, lower-effort improvements on the completed ERP. Stack unchanged (Express+Prisma+PostgreSQL / React RTL). Brand الفنان. Money = Decimal→number. Execution by Sonnet 4.6 agents, sequential, verify between.

## Feature 1 — Global date-range filter (الفترة)
The topbar (`apps/web/src/layouts/Topbar.tsx`) has visual-only controls: «الفترة / تصفية سريعة / من تاريخ / إلى تاريخ». Make them functional and global.
- **Frontend:** a `DateRangeContext` (provider near AuthProvider) holding `{ from, to, preset }` + setters. Topbar inputs/preset buttons (اليوم / هذا الأسبوع / هذا الشهر / هذا العام / مخصص) update it. Pages that show financial data read it and pass `from`/`to` to their queries (include them in queryKeys so they refetch): **Dashboard**, **Reports center** (all sections), **فواتير البيع**, **فواتير الشراء**, **دفتر اليومية**. Master-data pages (products, customers…) ignore it. Default preset = «هذا الشهر» (or all-time — pick all-time default so existing demo data shows).
- **Backend:** accept optional `?from=YYYY-MM-DD&to=YYYY-MM-DD` on: `/api/dashboard`, `/api/reports/*` (sales-log, purchases-log, pnl/income-statement, trial-balance can stay all-time or accept range, journal), `/api/sales-invoices`, `/api/purchase-invoices`, `/api/journal`. Filter the relevant `date` field within [from,to] inclusive when provided; no filter when absent (backward compatible).

## Feature 2 — Settings persisted in the database
`apps/web/src/pages/admin/SettingsPage.tsx` currently saves to localStorage. Move to DB.
- **Backend:** `Setting` key-value model (`key` unique, `value` String). `GET /api/settings` → object `{ companyName, currency, taxRate, logoUrl, lowStockThreshold, itemsPerPage, ... }` (return seeded defaults if missing). `PUT /api/settings` (perm `settings.edit`) upserts provided keys. Seed sensible defaults (companyName="الفنان للتوريدات العمومية", currency="ج.م", taxRate=14, lowStockThreshold=10).
- **Frontend:** SettingsPage loads from `GET /api/settings` and saves via `PUT`. Where trivial, use companyName from settings in the invoice/receipt print header (`apps/web/src/lib/print.ts`) and the low-stock threshold in dashboards.

## Feature 3 — Audit log (سجل التدقيق)
Record who did what.
- **Backend:** `AuditLog` model (id, userId Int?, userName String?, method, path, action String?, entity String?, statusCode Int, ip String?, createdAt). An Express middleware (registered after auth, before routes) that, for every **non-GET** `/api/*` request, after the response finishes, writes an AuditLog row (userId/userName from `req.user`, method, path, statusCode, ip). Skip auth/login noise if desired. `GET /api/audit-logs` (perm `users.view` or new `audit.view`, paginated, filter by `?from&to&userId`).
- **Frontend:** a new **«سجل التدقيق»** page (`/audit`) under «الإدارة والتقارير» in the sidebar: table (التاريخ/الوقت, المستخدم, العملية method+path mapped to Arabic action, النتيجة statusCode badge[2xx success/4xx warning/5xx danger]). Respect the global date range. Add route + sidebar item.

## Execution agents (Sonnet 4.6, sequential, verify between)
- **P — Backend:** Setting + AuditLog models + migration; settings GET/PUT + seed defaults; audit middleware + `/api/audit-logs`; add `from`/`to` filtering to dashboard/reports/sales-invoices/purchase-invoices/journal. Verify: migrate/seed/build/boot; settings round-trip; a mutation creates an audit row; a ranged dashboard/invoices call filters correctly.
- **Q — Frontend:** DateRangeContext + wire Topbar + apply range to dashboard/reports/sales-invoices/purchase-invoices/journal; SettingsPage ↔ DB; «سجل التدقيق» page + route + sidebar item. Verify build + live: changing the topbar range refetches dashboard/invoice data; settings save persists across reload; audit page lists recent actions.

## Conventions
RTL Arabic, reuse UI primitives, money via formatMoney, keep both apps building clean (0 TS errors), don't break existing pages. Date filters inclusive; absent = all-time (backward compatible).
