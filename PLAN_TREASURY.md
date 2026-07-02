# نظام الفنان — Vouchers & Treasury Module (Opus 4.8 planning)

First module of the big expansion toward the INVENTOR-TECH feature set. Builds directly on the double-entry ledger (`apps/api/src/lib/ledger.ts`, `postJournalEntry`). Stack unchanged. Brand الفنان. Money=Decimal→number. Execution by Sonnet 4.6 agents, sequential, verify between.

## Scope (from the competitor screenshots — «إدارة المحاسبة» voucher section)
سند قبض (receipt) · سند صرف (payment) · سند خصم (discount) · سند مركب (compound / multi-line) · كمبيالة/سند أمر (promissory note) · الإيداعات البنكية (bank deposit) · حركة الصندوق اليومية (daily cash movement). All post to the ledger and keep the trial balance balanced. Receipts/payments against a customer/supplier also update that party's `currentBalance`.

## Existing account codes (post against these)
1000 نقدية (cash), 1100 البنك (bank), 2000 الموردون/AP, 3000 العملاء/AR, 6000 مصروفات. 
NEW seed accounts: `4100` الخصم المكتسب (discounts earned, REVENUE), `5100` الخصم المسموح به (discounts allowed, EXPENSE).

## Data model (Prisma — migration `treasury`)
- **Voucher**(id, voucherNo unique [RV-/PV-/DV-/BD- + YYYYMMDD-NNNN], type enum VoucherType[RECEIPT|PAYMENT|DISCOUNT|DEPOSIT], date, treasuryAccountId Int (the cash/bank account; for DEPOSIT = the destination bank, source = cash), partyType enum PartyType?[CUSTOMER|SUPPLIER|ACCOUNT], partyId Int?, description, totalAmount Decimal, journalEntryId Int? (link to posted entry), createdById Int?, createdAt) + lines.
- **VoucherLine**(id, voucherId, accountId Int, amount Decimal, description?) — the counterparty side. Simple voucher = 1 line; compound = many. (For DEPOSIT, lines may be empty; the entry is Dr bank / Cr cash.)
- **PromissoryNote**(id, noteNo unique, type enum NoteType[RECEIVABLE|PAYABLE], partyType, partyId, amount Decimal, issueDate, dueDate, status enum NoteStatus[PENDING|SETTLED|CANCELLED], description, settledVoucherId Int?, createdById, createdAt).

## Posting rules (inside a tx, via postJournalEntry; keep balanced)
- **سند قبض RECEIPT** (collect money): Dr treasury(1000/1100)=total ; Cr each line account=its amount. If party=CUSTOMER → the line account is 3000 AR and **decrement Customer.currentBalance** by total (settles their debt).
- **سند صرف PAYMENT** (pay money): Dr each line account=amount ; Cr treasury=total. If party=SUPPLIER → line account 2000 AP and **decrement Supplier.currentBalance** by total.
- **سند خصم DISCOUNT**: granted to a customer → Dr 5100 discounts-allowed=total ; Cr 3000 AR=total (+decrement Customer.currentBalance). earned from a supplier → Dr 2000 AP=total ; Cr 4100 discounts-earned=total (+decrement Supplier.currentBalance). (No treasury movement.)
- **إيداع بنكي DEPOSIT**: Dr 1100 bank=total ; Cr 1000 cash=total.
- Voucher DELETE → reverse the linked journal entry (use `reverseJournalEntryBySource` with sourceType MANUAL/VOUCHER + sourceId) and undo party balance change.
- A settled **PromissoryNote** generates a RECEIPT (receivable) or PAYMENT (payable) voucher on settle.

(Extend ledger `JournalSource` enum with `VOUCHER` if helpful; otherwise reuse MANUAL with sourceId.)

## Endpoints (JWT + RBAC; new perm group `treasury` view/create/delete — add to seed, ADMIN+MANAGER+ACCOUNTANT)
- `GET /api/vouchers?type&from&to&search&page&pageSize` · `POST /api/vouchers` · `GET /api/vouchers/:id` (lines + journal entry) · `DELETE /api/vouchers/:id` (reverse).
- `GET /api/promissory-notes` · `POST` · `GET/:id` · `POST /api/promissory-notes/:id/settle` (treasuryAccountId in body) · `DELETE/:id`.
- `GET /api/treasury/cash-movement?accountId=&date=` (or from/to) — opening balance + chronological debit/credit lines for the cash/bank account + closing. (Specialized account-ledger view.)
- `GET /api/treasury/accounts` — list cash+bank accounts (type ASSET, codes 1000/1100) for the treasury picker.
- Respect the global `from`/`to` on list endpoints.

## Seed
A few sample vouchers (a customer receipt settling part of an invoice, a supplier payment, a bank deposit) + 1 promissory note, posted via the ledger. Verify trial balance still balanced after seed.

## Frontend (apps/web) — new sidebar group «الخزينة والسندات» (under الحسابات والشركاء)
1. **السندات** unified list page `/vouchers` with type tabs (الكل/قبض/صرف/خصم/إيداع) + KPIs (إجمالي المقبوضات/المدفوعات) + DataTable (رقم السند، النوع badge، التاريخ، الطرف customer/supplier/account name، المبلغ، البيان) + view detail modal (shows lines + linked قيد) + print. «سند جديد» opens a typed create form: type, date, treasury account select, party (customer/supplier/account by type), amount, description, + «مركب» toggle to add multiple counterparty lines (must sum to total). Gated by treasury.create.
2. **الإيداعات البنكية** `/bank-deposits` — list + «إيداع جديد» (from cash → bank, amount, date) — or fold into the vouchers page as the DEPOSIT type (pick the cleaner UX; a dedicated small page is fine).
3. **الكمبيالات** `/promissory-notes` — list (noteNo، النوع receivable/payable، الطرف، المبلغ، الاستحقاق dueDate، الحالة badge) + create + «تحصيل/سداد» action (settle → choose treasury account) + overdue highlight.
4. **حركة الصندوق** `/cash-movement` — treasury account select + date/range; shows opening balance, table (الوقت/البيان/سند/وارد debit/منصرف credit/الرصيد)، closing balance. Print.

Reuse UI primitives, formatMoney/formatDate, useDateRange where lists are date-scoped. Add routes in App.tsx + sidebar items.

## Execution agents (Sonnet 4.6, sequential)
- **R — Backend treasury:** models + migration + posting (receipt/payment/discount/deposit + note settle) + party-balance updates + reversal-on-delete + endpoints + seed samples + perms. Verify: migrate/seed/build/boot; a receipt voucher posts a balanced JE, increases cash, reduces the customer's balance & AR; a payment reduces cash & supplier AP; a deposit moves cash→bank; trial balance stays balanced; delete reverses; cash-movement returns opening+lines+closing.
- **S — Frontend treasury:** the 4 pages + sidebar group + create/settle forms, wired to the API, with print where noted. Verify build + live render + a created receipt voucher shows in the list and in حركة الصندوق.

## Conventions
RTL Arabic, reuse primitives, keep both apps building clean, never unbalance the ledger. سند قبض=receipt, سند صرف=payment, سند خصم=discount, إيداع=deposit, كمبيالة=promissory note, حركة الصندوق=cash movement, الخزينة=treasury.
