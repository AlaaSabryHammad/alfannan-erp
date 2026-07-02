# نظام الفنان للتوريدات والمخازن — ERP

Arabic RTL ERP system for Al-Fannan Supplies & Warehouses.

## Stack
- **Backend:** Node 22 + Express + TypeScript + Prisma + PostgreSQL 18
- **Frontend:** (Phase B — Vite + React 18 + TailwindCSS RTL)
- **Auth:** JWT + bcrypt + RBAC

## Prerequisites
- Node v22, npm v11
- PostgreSQL 18 running locally (`alfannan` database already created)

## Quick Start

### 1. Install dependencies
```bash
cd D:\projects\Alfannan
npm install          # installs all workspaces
```

### 2. Configure environment
```bash
cd apps/api
cp .env.example .env
# Edit .env with your DATABASE_URL and JWT_SECRET
```

Default `.env` (pre-configured):
```
DATABASE_URL="postgresql://postgres:1359@localhost:5432/alfannan?schema=public"
JWT_SECRET="alfannan-erp-super-secret-jwt-key-2026-xK9mP3qR7wL2nV8"
PORT=4000
```

### 3. Run migrations
```bash
cd apps/api
npm run prisma:migrate    # creates all tables (runs: prisma migrate dev)
```

### 4. Seed demo data
```bash
npm run seed
```
Creates: 5 roles, 5 users, 8 products, 3 warehouses, 3 customers, 5 invoices, stock movements.

### 5. Start the API
```bash
# Development (hot reload)
npm run dev

# Production
npm run build
npm run start
```

API runs at: `http://localhost:4000`

## Quick-Login Users (password: `123456`)
| Email | Role |
|---|---|
| admin@store.com | المدير العام (ADMIN) |
| manager@store.com | مدير النظام (MANAGER) |
| accountant@store.com | المحاسب المالي (ACCOUNTANT) |
| storekeeper@store.com | أمين المخزن (STOREKEEPER) |
| cashier@store.com | كاشير (CASHIER) |

## API Reference

**Base URL:** `http://localhost:4000/api`
**Auth Header:** `Authorization: Bearer <JWT_TOKEN>`

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/auth/login` | `{email, password}` → `{token, user}` |
| GET | `/auth/me` | Returns current user + permissions |

### Endpoints (all JWT-protected, lists support `?page&pageSize&search`)
| Method | Path | Permission |
|---|---|---|
| GET/POST/PUT/DELETE | `/products` | `products.*` |
| GET | `/departments` | `departments.view` (returns tree) |
| GET | `/departments/flat` | `departments.view` (flat list) |
| POST/PUT | `/departments` | `departments.create/edit` |
| GET/POST/PUT | `/brands` | `brands.*` |
| GET/POST | `/units` | `units.*` |
| GET/POST/PUT | `/warehouses` | `warehouses.*` |
| GET | `/stock/balances` | `stock.view` (`?warehouseId`) |
| GET | `/stock/movements` | `stock.view` (`?productId&warehouseId`) |
| POST | `/stock/adjust` | `stock.adjust` |
| GET/POST/PUT | `/customers` | `customers.*` |
| GET/POST | `/sales-invoices` | `sales.*` |
| GET | `/dashboard` | `dashboard.view` |

### Treasury & Vouchers (الخزينة والسندات)
Double-entry posted automatically. Every voucher creates a balanced `JournalEntry` (sourceType `VOUCHER`) and adjusts party balances (Customer/Supplier); deletion reverses it. Trial balance stays balanced.
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/vouchers` | `treasury.view` | `?type&from&to&search&page&pageSize`; types: RECEIPT/PAYMENT/DISCOUNT/DEPOSIT |
| GET | `/vouchers/:id` | `treasury.view` | detail + lines + linked journal entry |
| POST | `/vouchers` | `treasury.create` | posts balanced JE; `{type, date, treasuryAccountId, partyType, partyId, amount | lines[]}` |
| DELETE | `/vouchers/:id` | `treasury.delete` | reverses JE + party balance |
| GET | `/promissory-notes` | `treasury.view` | `?type&status&from&to&search` |
| POST | `/promissory-notes` | `treasury.create` | create note (RECEIVABLE/PAYABLE) |
| POST | `/promissory-notes/:id/settle` | `treasury.create` | creates a RECEIPT/PAYMENT voucher |
| DELETE | `/promissory-notes/:id` | `treasury.delete` | reverses settle voucher if settled |
| GET | `/treasury/accounts` | `treasury.view` | cash (1000) + bank (1100) accounts |
| GET | `/treasury/cash-movement` | `treasury.view` | `?accountId&from&to` → opening + lines + closing |

Frontend pages: `/vouchers` (unified, tabbed), `/promissory-notes`, `/cash-movement` (sidebar group «الخزينة والسندات»).

### Fixed Assets (الأصول الثابتة والإهلاك)
Straight-line depreciation posted to the ledger. Purchase posts Dr 1400/Cr 1000; monthly depreciation posts Dr 6100/Cr 1450.
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/fixed-assets` | `assets.view` | list + KPIs (`totalCost`, `totalBookValue`, `totalAccumulatedDepreciation`) |
| GET | `/fixed-assets/:id` | `assets.view` | detail |
| POST | `/fixed-assets` | `assets.create` | create + posts purchase JE; `{nameAr, category, purchaseCost, salvageValue, usefulLifeMonths}` |
| POST | `/fixed-assets/:id/depreciate` | `assets.create` | posts one month of depreciation JE; returns `depreciationAmount`, `newBookValue` |
| DELETE | `/fixed-assets/:id` | `assets.delete` | reverses ALL linked JEs (purchase + depreciation) |

Frontend page: `/assets` (sidebar group «الأصول الثابتة»).

### Human Resources & Payroll (الموارد البشرية والرواتب)
Payroll run posts one balanced JE per month: Dr 6200 Salaries / Cr 1000 Cash (or 2200 Payable) + Cr deductions. Duplicate month/year is rejected.
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET/POST | `/employees` | `hr.view` / `hr.create` | employee CRUD |
| GET/PUT/DELETE | `/employees/:id` | `hr.*` | |
| GET | `/payroll/runs` | `hr.view` | list payroll runs |
| GET | `/payroll/runs/:id` | `hr.view` | run detail with per-employee items |
| POST | `/payroll/run` | `hr.create` | `{month, year, payVia}` → creates items for all active employees + posts JE |
| DELETE | `/payroll/runs/:id` | `hr.delete` | reverses the posted JE |

Frontend pages: `/employees`, `/payroll` (sidebar group «الموارد البشرية»).

### Tax Reports (التقارير الضريبية)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/reports/vat` | `reports.view` | `?from&to` → output/input VAT, net payable/refundable, taxable invoices |

Frontend: «التقرير الضريبي (VAT)» tab in Reports center.

### Dashboard Response Shape
```json
{
  "kpis": {
    "netSales": 6753,
    "purchases": 0,
    "expenses": 0,
    "netProfit": 1688.25,
    "cashLiquidity": 5300,
    "inventoryValuation": 108395,
    "totalItemQty": 599,
    "lowStockCount": 10,
    "totalReceivables": 1453
  },
  "chartSeries": [{ "month": 1, "monthName": "يناير", "sales": 0, "purchases": 0 }, ...],
  "recentMovements": [...],
  "recentInvoices": [...],
  "lowStockList": [...]
}
```

### Create Sale Invoice
```json
POST /api/sales-invoices
{
  "customerId": 1,
  "warehouseId": 1,
  "discount": 0,
  "tax": 0,
  "paidStatus": "PAID",
  "paymentMethod": "CASH",
  "items": [
    { "productId": 1, "qty": 2, "unitPrice": 480 }
  ]
}
```
Creating an invoice automatically writes `StockMovement OUT` rows and decrements `StockBalance` in a transaction.

## Project Structure

```
Alfannan/
  apps/
    api/
      prisma/
        schema.prisma      # Full Phase-1 data model
        seed.ts            # Demo data seed
        migrations/        # Auto-generated SQL migrations
      src/
        index.ts           # Express app entry point
        lib/
          prisma.ts        # PrismaClient singleton
          paginate.ts      # Pagination helpers
        middleware/
          auth.ts          # requireAuth + requirePermission
          errorHandler.ts  # Centralized error handler
        routes/
          auth.ts          # /api/auth
          products.ts      # /api/products
          departments.ts   # /api/departments
          brands.ts        # /api/brands
          units.ts         # /api/units
          warehouses.ts    # /api/warehouses
          stock.ts         # /api/stock
          customers.ts     # /api/customers
          salesInvoices.ts # /api/sales-invoices
          dashboard.ts     # /api/dashboard
      .env                 # Real env (git-ignored)
      .env.example         # Template (committed)
      package.json
      tsconfig.json
    web/                   # Phase B — React frontend (Vite + TS + Tailwind RTL)
      src/
        components/
          ui/              # Reusable primitives (Button, Badge, Card, Input, Modal, DataTable, PageHeader)
          ProtectedRoute.tsx
        contexts/
          AuthContext.tsx  # Auth state, useAuth(), usePermission()
        layouts/
          AppShell.tsx     # Persistent shell (sidebar + topbar + footer)
          Sidebar.tsx      # RTL sidebar with collapsible nav groups
          Topbar.tsx       # Sticky topbar with user chip + POS button + branch selector
        lib/
          api.ts           # Axios client (auto-auth + 401 logout)
          utils.ts         # formatMoney(), formatDate(), cn()
        pages/
          auth/LoginPage.tsx
          DashboardPage.tsx
          UnderConstruction.tsx  # Placeholder for future pages
        types/index.ts
        App.tsx            # Router + QueryClient + AuthProvider
        main.tsx
      .env / .env.example
      tailwind.config.js   # Design tokens (primary, accent, sidebar, status)
      vite.config.ts
  PLAN.md
  README.md
  package.json             # npm workspaces root
  .gitignore
```

---

## Frontend (apps/web)

Arabic RTL React SPA — Vite 6 + React 18 + TypeScript (strict) + TailwindCSS.

### Run the frontend

```bash
# From repo root
npm install

# Start dev server (port 5173)
npm run dev --workspace=apps/web

# Production build
npm run build --workspace=apps/web
```

Or from `apps/web` directly:
```bash
cd apps/web
npm run dev      # http://localhost:5173
npm run build    # tsc + vite build
```

### Environment

Copy `.env.example` to `.env` in `apps/web` (already pre-configured for local dev):
```
VITE_API_URL=http://localhost:4000/api
```

### Quick-login (same users as backend)

On the `/login` page use the colored chips or type credentials manually. All use password `123456`.

### How to add a feature page (for subsequent agents)

1. Create `src/pages/YourPage.tsx` — import `PageHeader`, `DataTable`, `Card` etc. from `src/components/ui/`.
2. Add a `<Route path="your-route" element={<YourPage />} />` inside the protected `<Route path="/">` block in `src/App.tsx`.
3. The sidebar nav item already links to the route — remove the `UnderConstruction` route and replace it with your component.
4. Gate by permission: `const can = usePermission('module.action')` from `src/contexts/AuthContext.tsx`.
5. Use `apiClient` from `src/lib/api.ts` for all API calls — token is attached automatically.

### Reusable UI primitives (`src/components/ui/`)

| Component | Props / Notes |
|---|---|
| `Button` | `variant`: primary/accent/ghost/danger/outline · `size`: sm/md/lg · `loading` · `icon` |
| `Badge` | `variant`: success/danger/warning/info/default |
| `Card` | `padding`: none/sm/md/lg · `CardHeader` subcomponent with title/subtitle/action |
| `Input` | Forwarded ref · `label` · `error` · `icon` |
| `Select` | Same as Input |
| `PageHeader` | `title` · `subtitle` · `actions` slot |
| `Modal` | `open` · `onClose` · `title` · `size`: sm/md/lg/xl · `footer` slot |
| `DataTable<T>` | `columns` (key/header/sortable/render) · `data` · `pagination` · `onPageChange` · `onSearch` · `loading` |
| `formatMoney(n)` | `421863.70 ج.م` — in `src/lib/utils.ts` |
