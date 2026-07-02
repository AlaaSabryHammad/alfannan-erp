# نظام الفنان — Extra Features Plan (Opus 4.8 planning)

Adds to the completed Phase 1+2 system. Stack unchanged. Arabic RTL, brand "الفنان". Execution by Sonnet 4.6 agents (sequential, verify between). Reuse existing primitives.

DONE already (by Opus, this session): sidebar moved to the RIGHT (AppShell `flex-row` in RTL).

## Features to add
1. **Real Excel export** (.xlsx) — currently the `DataTable` toolbar has 4 stub buttons (نسخ / Excel / PDF / طباعة).
2. **Real PDF export** — Arabic-safe.
3. **Copy + Print** — make those two stubs work too.
4. **Product image upload** — backend storage + product form UI + thumbnails in list & POS.
5. **Invoice / receipt printing** — printable A4 sales invoice + purchase invoice + POS receipt.

## Agent L — DataTable exports (central, frontend)
Install `xlsx` (SheetJS) + `html2canvas`. Wire the 4 toolbar buttons in `apps/web/src/components/ui/DataTable.tsx` to operate on the rendered DOM `<table>` (use a ref) so EVERY list page gets working exports with no per-page changes:
- **نسخ**: copy table (headers + visible rows) as TSV to clipboard; toast "تم النسخ".
- **Excel**: build a worksheet from the rendered table cell text (RTL, Arabic) → download `<title>.xlsx`. Use `xlsx` `utils.table_to_book` on the table ref (handles Arabic text). Filename from a new optional `exportTitle` prop (default page title).
- **PDF**: Arabic-safe via `html2canvas` capturing the table element → place into a jsPDF A4 (or just `html2canvas` → image → new tab print). Preserves Arabic shaping. (Avoid jsPDF text APIs which mangle Arabic unless an Arabic font is embedded.)
- **طباعة**: open a print window containing the table HTML + minimal RTL print CSS (company header "الفنان للتوريدات العمومية") and `window.print()`.
Add optional `exportTitle?: string` to `DataTableProps`; pass a sensible title from each page (optional — default "تقرير"). Note: exports the currently-loaded page (server-paginated) — acceptable. Keep TS strict (add @types or module shims as needed). Verify build + that Excel/PDF/print/copy actually fire on at least the Products and Customers pages.

## Agent K — Product image upload (full-stack)
Backend (`apps/api`): add `multer`; `POST /api/uploads/image` (auth + products.create/edit) saving to `apps/api/uploads/` with a unique filename, returning `{ url: "/uploads/<file>" }`; serve `/uploads` statically from `src/index.ts`; ensure `uploads/` is git-ignored. Frontend: in the Product create/edit form (`apps/web/src/pages/products/ProductsPage.tsx`) add an image file input that uploads on select and stores the returned url in `imageUrl`; show the chosen image preview. Render product thumbnails (imageUrl, with a fallback placeholder) in the Products table and in the POS product cards (`/pos`). Prefix relative `/uploads/..` urls with the API origin (derive from `VITE_API_URL`). Verify: upload a small image to a product, it persists and shows as a thumbnail in the list + POS.

## Agent M — Invoice / receipt printing (frontend)
Create a reusable printable document component + print CSS:
- **Sales invoice print**: a "طباعة الفاتورة" button in the Sales Invoices detail modal (`apps/web/src/pages/sales/...`) opening an A4 RTL invoice layout (company header الفنان + logo placeholder, invoice refNo/date, customer, line items table product/qty/price/total, subtotal/discount/tax/total, paid status, footer) and `window.print()` (print-only CSS so only the document prints).
- **Purchase invoice print**: same for the Purchase Invoices detail modal (supplier instead of customer).
- **POS receipt**: after confirming a sale in `/pos`, offer "طباعة الإيصال" — a narrow thermal-style receipt (company, datetime, cashier, items, total, payment method, "شكراً لتعاملكم مع الفنان").
Reuse `formatMoney`/`formatDate`. Verify: open a seeded invoice → print preview shows the formatted Arabic A4 invoice; POS sale → receipt prints.

## Conventions
RTL Arabic, reuse UI primitives, teal/orange palette, keep both apps building with 0 TS errors, don't break existing pages. Each agent verifies (`npm run build` + live) and reports.
