# نظام الفنان للتوريدات والمخازن — Master Plan (Al-Fannan ERP)

> Planning model: **Opus 4.8**. Execution model: **Sonnet 4.6** (subagents).
> Brand: replace any "الفارس" with **"الفنان"**. System name: **نظام الفنان للتوريدات والمخازن**.
> UI: Arabic, **RTL**, currency **ج.م**. Reference screenshots: `C:\Users\alaah\Downloads\New folder`.

## 1. Tech Stack
- **Frontend:** Vite + React 18 + TypeScript, TailwindCSS (RTL via `dir="rtl"`), React Router v6, TanStack Query, React Hook Form + Zod, Recharts (charts), Axios, `jsbarcode` + `qrcode` (labels), Tajawal/Cairo font.
- **Backend:** Node + Express + TypeScript, Prisma ORM, JWT auth, bcrypt, Zod validation, RBAC middleware.
- **Database:** PostgreSQL (via Prisma migrations + seed).
- **Monorepo layout:**
  ```
  Alfannan/
    apps/
      web/      # React frontend
      api/      # Express backend
    packages/
      shared/   # shared TS types / enums (optional)
    docs/
    PLAN.md
    README.md
  ```

## 2. Design System (from screenshots)
- Primary teal `#0e9384` (buttons, active states); sidebar = dark gradient `#0b1f1d → #103a35`.
- Accent orange `#f97316` ("شاشة البيع السريع", active POS item).
- Backgrounds: app `#f1f5f9`, cards `#ffffff` rounded-2xl, soft shadow, 1px `#e5e7eb` borders.
- Status badges: success green (`نشط/مدفوعة/مسددة`), danger red (`غير مسددة`), warning amber.
- Topbar: branch selector "كافة الفروع والمستودعات", quick filters, "شاشة البيع السريع" orange button, notifications, user chip (role under name).
- Sidebar groups: الرئيسية والتحليلات · المخزون والأصناف · المبيعات والمشتريات · الحسابات والشركاء · الإدارة والتقارير.
- Tables: search box, "عرض N سجلات", export buttons (طباعة/PDF/Excel/نسخ), pagination (الأول/السابق/التالي/الأخير).
- Document a full token set in `docs/DESIGN_SYSTEM.md` and Tailwind theme.

## 3. RBAC — 5 roles (seed)
| code | الاسم | quick-login email |
|---|---|---|
| ADMIN | المدير العام | admin@store.com |
| MANAGER | مدير النظام | manager@store.com |
| ACCOUNTANT | المحاسب المالي | accountant@store.com |
| STOREKEEPER | أمين المخزن | storekeeper@store.com |
| CASHIER | كاشير | cashier@store.com |
Default password for all seed users: `123456`. Permissions are grouped by module; gate routes (frontend) and endpoints (backend) by permission code.

## 4. Data Model — Phase 1 (Prisma)
- **User**(id, name, email unique, passwordHash, roleId, isActive, createdAt)
- **Role**(id, code unique, nameAr, description) · **Permission**(id, code unique, group, nameAr) · **RolePermission**(roleId, permissionId)
- **Branch**(id, nameAr, isActive)
- **Department**(id, nameAr, descriptionAr, parentId nullable, icon) — tree
- **Brand**(id, nameAr, logoUrl, sortOrder)
- **Unit**(id, nameAr, code)
- **Product**(id, nameAr, sku unique, barcode, departmentId, brandId, unitId, costPrice, salePrice, imageUrl, isActive)
- **Warehouse**(id, nameAr, location, managerId, isActive)
- **StockBalance**(id, productId, warehouseId, quantity) — unique(productId, warehouseId)
- **StockMovement**(id, productId, warehouseId, type[IN|OUT|TRANSFER|ADJUST], quantity, balanceAfter, refType, refId, reason, createdById, createdAt)
- **Customer**(id, nameAr, company, phone, creditLimit, openingBalance, currentBalance, status)
- **SalesInvoice**(id, refNo unique, customerId, warehouseId, cashierId, date, subtotal, discount, tax, total, paidStatus[PAID|UNPAID|PARTIAL], paymentMethod[CASH|CARD|CREDIT])
- **SalesInvoiceItem**(id, invoiceId, productId, qty, unitPrice, lineTotal)

Seed realistic demo data matching screenshots (brands: Hikvision, Dahua, TP-Link, Cisco, Ubiquiti, APC; departments: مصادر الطاقة، أجهزة الشبكة، كاميرات المراقبة، إكسسوار وكابلات؛ units: حبة، لفة، متر، كرتون؛ warehouses: المستودع الرئيسي، مستودع الرياض الرئيسي، معرض جدة للبيع المباشر).

## 5. API surface — Phase 1
`/api/auth` (login, me, quick-login) · `/api/products` · `/api/departments` · `/api/brands` · `/api/units` · `/api/warehouses` · `/api/stock` (balances, movements) · `/api/customers` · `/api/sales-invoices` · `/api/dashboard` (KPIs + chart series). REST, JWT-protected, RBAC-gated, paginated list endpoints.

## 6. Frontend pages — Phase 1
1. **Login** (`/login`) — split layout, RTL, role quick-login chips.
2. **App shell** — RTL sidebar + topbar (matches screenshots).
3. **Dashboard** (`/`) — KPI cards, monthly sales/purchases line chart, partner-capital donut, recent stock movements table, recent sales invoices table, low-stock alerts.
4. **Products:** الأصناف (`/products`), الأقسام (`/departments`, card tree), العلامات التجارية (`/brands`), وحدات القياس (`/units`).
5. **Inventory:** المستودعات (`/warehouses`), رصيد المخزون (`/stock`).
6. **POS** (`/pos`) — product grid w/ category tabs + search, cart, customer selector, payment methods (نقداً/شبكة/أجل), totals, confirm.
7. **Sales:** العملاء (`/customers`), فواتير البيع (`/sales-invoices`).

## 7. Execution phases (each = one Sonnet subagent task, sequential, verified between)
- **A — Backend foundation:** monorepo + `apps/api` Express+TS+Prisma, full Phase-1 schema, migration, seed, auth+RBAC, all Phase-1 CRUD + dashboard endpoints. Verify: `npm run build`, `prisma migrate`, server boots, login works.
- **B — Frontend foundation:** `apps/web` Vite+React+TS+Tailwind RTL, design tokens, app shell (sidebar/topbar), login page, auth context, protected routing, axios API client. Verify: builds, login → dashboard shell renders.
- **C — Products & Inventory pages:** الأصناف/الأقسام/العلامات/الوحدات/المستودعات/رصيد المخزون wired to API with tables, forms, modals.
- **D — POS & Sales:** POS screen, customers, sales invoices; creating a POS sale writes invoice + stock movements.
- **E — Dashboard:** KPIs + charts wired to `/api/dashboard`.

## Phase 2 (later, not in MVP)
Purchases (suppliers, purchase invoices), accounting (chart of accounts tree, partners/equity dashboard), barcode/QR label designer, stock transfers, full reports center, settings, alerts log, users management UI.

## Conventions
- TypeScript strict. ESLint+Prettier. `.env.example` committed, real `.env` git-ignored.
- All user-facing strings Arabic. Numbers formatted with thousands separators + `ج.م`.
- Each Sonnet agent must leave the project building cleanly and update `README.md` run steps.
