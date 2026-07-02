# نظام الفنان — Phase 2 Plan (Opus 4.8 planning)

Extends the Phase-1 MVP (see PLAN.md). Same stack (Express+Prisma+PostgreSQL / React+Vite+Tailwind RTL). Brand "الفنان". Execution by Sonnet 4.6 agents. Money fields are Decimal (serialized as numbers via the global `Prisma.Decimal.prototype.toJSON` override — keep using it). Reuse existing UI primitives (`ui/index.ts`), `apiClient`, `formatMoney`, `usePermission`, `DataTable`, `Modal`, `Card`, `PageHeader`, `Badge`.

## New data models (Prisma — EXTEND schema.prisma, add a migration, extend seed.ts)
- **Supplier**(id, nameAr, company, phone, openingBalance, currentBalance, status) — mirrors Customer.
- **PurchaseInvoice**(id, refNo unique `PO-YYYYMMDD-NNNN`, supplierId, warehouseId, date, subtotal, discount, tax, total, paymentStatus[PAID|UNPAID|PARTIAL], receiveStatus[RECEIVED|PENDING], notes) + **PurchaseInvoiceItem**(id, invoiceId, productId, qty, unitCost, lineTotal). Creating a RECEIVED purchase → StockMovement IN + increment StockBalance + increment supplier balance (atomic tx).
- **Account** (chart of accounts, tree): (id, code unique, nameAr, type[ASSET|LIABILITY|EQUITY|REVENUE|EXPENSE], parentId nullable, openingBalance, currentBalance, isActive). Seed to match screenshot: Assets(1000 نقدية, 1100 البنك, 1200 المخزون, 1300 ضريبة الشراء ورسم المدخلات, 3000 العملاء/المدينون), Liabilities(2000 الموردون/الدائنون, 2100 ضريبة المبيعات المستحقة), Equity(7000 رأس المال + 7000-1/7000-2 شركاء, 8000 جاري الشركاء + 8000-1/8000-2), Revenue(4000 إيرادات المبيعات), Expense(5000 تكلفة البضاعة COGS, 6000 مصروفات عمومية وإدارية).
- **Partner**(id, nameAr, email, phone, capitalRequired, capitalPaid, profitSharePct, currentBalance, status) — seed 2 partners 60/40 (المهندس أحمد البنا 60%, الأستاذ خالد الفنان 40%) to match the partners dashboard. (Rename any "الفارس" → "الفنان".)
- **StockTransfer**(id, transferNo unique, fromWarehouseId, toWarehouseId, date, status[DONE|PENDING], notes) + **StockTransferItem**(id, transferId, productId, qty). Executing a transfer → OUT from source + IN to dest (atomic).
- (Optional) **Expense**(id, accountId, amount, date, description) feeding dashboard expenses — only if low-cost.

## New permissions (seed) — groups: suppliers, purchases, accounts, partners, transfers, settings + add `.delete` where relevant. ADMIN gets all (allCodes); assign others sensibly (ACCOUNTANT → accounts/partners/purchases; STOREKEEPER → transfers/suppliers).

## New API endpoints (JWT + RBAC, paginated lists)
`/api/suppliers` (CRUD), `/api/purchase-invoices` (list/create[stock IN]/get/delete), `/api/accounts` (tree + CRUD), `/api/partners` (CRUD + summary), `/api/stock-transfers` (list/create[move stock]/get), `/api/reports/*` (sales-log, purchases-log, pnl, balances, top-products — read aggregations), `/api/users` (CRUD, assign role), `/api/roles` (list + update permissions), `/api/permissions` (list grouped). Extend `/api/dashboard` to include real purchases/expenses now that data exists (backward compatible).

## Frontend pages (replace UnderConstruction in App.tsx)
1. **الموردون** `/suppliers` — like customers page (KPIs + table + CRUD).
2. **فواتير الشراء** `/purchase-invoices` — list (refNo, supplier, warehouse, date, receiveStatus + paymentStatus badges, total) + KPIs + create form (supplier, warehouse, line items, totals) that adds stock + detail modal. Matches screenshot.
3. **الحسابات العامة** `/accounts` — chart of accounts grouped by 5 types (each group a section/table like screenshot: code, name, balance, status, actions) + "إضافة حساب مالي جديد" + KPI summary cards (الأصول/الخصوم/حقوق الملكية/الإيرادات/المصروفات totals).
4. **نظام الشركاء** `/partners` — dashboard (KPIs: إجمالي رأس المال المقرر, المدفوع فعلياً, نسبة السداد, صافي الحسابات الجارية) + partners detail table (capital required/paid, profit %, running balance, status, contact) + "تسجيل شريك جديد"/"توزيع الأرباح" actions. Matches screenshot.
5. **تحويل المخزون** `/stock-transfer` — list + "تحويل مخزني جديد" form (from/to warehouse, items) that moves stock.
6. **ملصقات الباركود والـQR** `/barcode-labels` — client-side designer (jsbarcode + qrcode, both installed): select mode (single item / department / all), label dimensions (width/height mm, count, per-row, font size), toggles (show company name الفنان / product name / price / code text), live preview grid + print button. Matches screenshot.
7. **تقارير النظام** `/reports` — reports center: summary KPIs + tabs/sections (الملخص العام, سجل فواتير المبيعات, سجل فواتير المشتريات, الأرباح والخسائر P&L, أرصدة العملاء/الموردين, المنتجات الأكثر مبيعاً, تنبيهات نواقص المخزون) with charts + a "طباعة التقرير" action. Matches screenshot.
8. **المستخدمون** `/users` — table of users (name, email, role, status) + CRUD + assign role.
9. **الأدوار والصلاحيات** `/roles` — role cards (code, nameAr, description, enabled-permission count) + edit-permissions modal (grouped checkboxes). Matches screenshot (5 roles).
10. **الإعدادات** `/settings` — company info (name الفنان, currency ج.م, tax %, logo), basic preferences.
11. **سجل التنبيهات** `/alerts` — list of system alerts (low stock, unpaid invoices, etc.) derived from data.

## Execution agents (Sonnet 4.6, sequential, verify between)
- **F — Backend Phase 2:** all new models + migration + seed extension + all endpoints + dashboard enrichment. Verify migrate/seed/build/boot + sample endpoints.
- **G — Purchases UI:** /suppliers + /purchase-invoices.
- **H — Accounting UI:** /accounts + /partners.
- **I — Inventory+Labels UI:** /stock-transfer + /barcode-labels.
- **J — Admin UI:** /reports + /users + /roles + /settings + /alerts.

Each agent: reuse primitives, RTL Arabic, match screenshots, verify `npm run build` + live render, leave project building cleanly. App.tsx route edits are per-agent (sequential to avoid conflicts).
