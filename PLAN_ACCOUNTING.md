# نظام الفنان — Double-Entry Accounting Plan (Opus 4.8 planning)

Goal: make the chart of accounts a REAL ledger. Every financial transaction (sales, purchases, expenses) auto-creates a balanced **journal entry** (قيد يومية) that updates account balances. Add journal, account statements (كشف حساب), and financial statements (ميزان المراجعة / الميزانية العمومية / قائمة الدخل).

Stack unchanged (Express+Prisma+PostgreSQL / React RTL). Brand الفنان. Money = Decimal (serialized as numbers). Execution by Sonnet 4.6 agents, sequential, verify between.

## Existing chart-of-accounts codes (from Phase-2 seed — use these in the posting map)
- ASSET: `1000` النقدية (cash), `1100` البنك (bank), `1200` المخزون (inventory), `1300` ضريبة الشراء (input VAT), `3000` العملاء/المدينون (accounts receivable)
- LIABILITY: `2000` الموردون/الدائنون (accounts payable), `2100` ضريبة المبيعات المستحقة (output VAT)
- REVENUE: `4000` إيرادات المبيعات (sales revenue)
- EXPENSE: `5000` تكلفة البضاعة COGS, `6000` مصروفات عمومية وإدارية
- EQUITY: `7000`(+children) رأس المال, `8000`(+children) جاري الشركاء

Account normal balance: ASSET & EXPENSE = debit-normal; LIABILITY, EQUITY, REVENUE = credit-normal.
Account balance = openingBalance + Σ(debit−credit) for debit-normal; openingBalance + Σ(credit−debit) for credit-normal.

## New data model (Prisma — add migration `accounting`)
- **JournalEntry**(id, entryNo unique `JE-YYYYMMDD-NNNN`, date, description, sourceType enum [SALES_INVOICE|PURCHASE_INVOICE|EXPENSE|MANUAL|OPENING], sourceId Int?, totalDebit Decimal, totalCredit Decimal, createdById Int?, createdAt) + relation to lines.
- **JournalLine**(id, entryId, accountId, debit Decimal(12,2) default 0, credit Decimal(12,2) default 0, description String?) ; index on accountId.
- Add `journalLines JournalLine[]` relation back-ref on Account.

## Posting service (`apps/api/src/lib/ledger.ts`)
- `postJournalEntry(tx, { date, description, sourceType, sourceId, createdById, lines: [{accountCode|accountId, debit, credit, description}] })`:
  - resolve account codes → ids; assert Σdebit === Σcredit (throw "القيد غير متوازن" otherwise); create entry + lines; increment each Account.currentBalance by the signed effect (debit-normal: +debit−credit; credit-normal: +credit−debit). All inside the passed Prisma `tx`.
- `reverseJournalEntryBySource(tx, sourceType, sourceId)`: find the entry, create a reversing entry (swap debit/credit) and unwind balances — used when a source invoice is deleted. (Or hard-delete the entry + reverse balance deltas.)
- Central account-code constants map.

## Posting rules (wire into existing creation handlers, inside their existing $transaction)
**Sales invoice** (POST /sales-invoices): one balanced entry —
- Dr (CASH→1000 | CARD→1100 | CREDIT/unpaid→3000 AR) = total
- Cr 4000 revenue = subtotal − discount
- Cr 2100 output VAT = tax
- Dr 5000 COGS = cost (Σ product.costPrice × qty)
- Cr 1200 inventory = cost
**Purchase invoice** (POST /purchase-invoices, RECEIVED): 
- Dr 1200 inventory = subtotal
- Dr 1300 input VAT = tax
- Cr (paid→1000/1100 | unpaid→2000 AP) = total
**Expense** (if a create endpoint exists / add one): Dr (expense.accountId or 6000) = amount; Cr 1000 cash = amount.
On invoice DELETE → reverse the linked entry.

## New endpoints (JWT + RBAC `accounts.view`/`reports.view`)
- `GET /api/journal` (paginated list: entryNo, date, description, sourceType, totalDebit) + `GET /api/journal/:id` (lines with account name/code).
- `POST /api/journal` (manual entry, `accounts.create`): balanced lines, sourceType MANUAL.
- `GET /api/accounts/:id/ledger` — account statement: opening + chronological lines (debit/credit/running balance) + closing.
- `GET /api/reports/trial-balance` — every account with totalDebit/totalCredit/balance; include grand totals (must be equal).
- `GET /api/reports/balance-sheet` — grouped ASSET vs (LIABILITY+EQUITY) with totals (should balance); net profit folded into equity.
- `GET /api/reports/income-statement` — REVENUE − (COGS + EXPENSE) = net profit (replace/upgrade the existing approximate `/reports/pnl` to derive from ledger; keep response keys backward-compatible where used by the dashboard).
- `POST /api/accounts/recompute` (`accounts.edit`) — rebuild every Account.currentBalance from openingBalance + ledger (drift repair).

## Seed update (reseed required)
After seeding sales/purchase/expense transactions, POST a journal entry for each (via the same ledger service) so balances are real from the start. Optionally an OPENING entry for seeded openingBalances. Verify trial balance is balanced after seed.

## Frontend (apps/web)
1. **دفتر اليومية** `/journal` (new sidebar item under «الحسابات والشركاء»): table of entries (entryNo, date, description, مصدر sourceType badge, مدين/دائن totals) + detail modal showing balanced lines (account, debit, credit). Optional «قيد يدوي جديد» form (balanced-line editor) gated by accounts.create.
2. **كشف حساب** — add a «كشف» action on each row in the Chart of Accounts page (`/accounts`) → modal/page showing `/accounts/:id/ledger` (date, description, debit, credit, running balance).
3. **القوائم المالية** in the Reports center (`/reports`) — three new report sections: «ميزان المراجعة» (trial balance table + balanced check), «الميزانية العمومية» (balance sheet), «قائمة الدخل» (income statement). Use the new endpoints. Print-friendly.

## Execution agents (Sonnet 4.6, sequential)
- **N — Backend ledger:** models + migration + ledger service + posting hooks (sales/purchase/expense) + reversal-on-delete + journal/ledger/statement endpoints + seed posting + recompute. Verify: migrate/seed/build/boot; trial balance balanced; a new sale posts a balanced JE and moves cash+revenue+inventory+COGS; deleting it reverses.
- **O — Frontend:** /journal page + sidebar item + account «كشف حساب» + the 3 financial-statement report sections. Verify build + live render against seeded ledger.

## Conventions
RTL Arabic, reuse UI primitives, money via formatMoney, keep both apps building clean, don't break existing pages. Debit = «مدين», Credit = «دائن», Journal entry = «قيد يومية», Trial balance = «ميزان المراجعة», Balance sheet = «الميزانية العمومية», Income statement = «قائمة الدخل», Account statement = «كشف حساب».
