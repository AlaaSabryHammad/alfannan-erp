/**
 * Double-Entry Ledger Service — نظام الفنان
 *
 * Provides:
 *   postJournalEntry(tx, params)           — create a balanced journal entry inside a transaction
 *   reverseJournalEntryBySource(tx, ...)   — reverse a posted entry (used on invoice delete)
 */

import { Prisma, AccountType, JournalSource } from '@prisma/client';

// ── Account-code constants ────────────────────────────────────────────────────
export const ACCT: Record<string, string> = {
  CASH:             '1000',
  BANK:             '1100',
  INVENTORY:        '1200',
  INPUT_VAT:        '1300',
  FIXED_ASSETS:     '1400',     // الأصول الثابتة (ASSET)
  ACC_DEPRECIATION: '1450',     // مجمع الإهلاك (ASSET, contra — credit-normal balance stored)
  AR:               '3000',     // Accounts Receivable / العملاء
  AP:               '2000',     // Accounts Payable / الموردون
  OUTPUT_VAT:       '2100',
  SALARIES_PAYABLE: '2200',     // المستحقات للعاملين (LIABILITY)
  REVENUE:          '4000',
  COGS:             '5000',
  GEN_EXPENSE:      '6000',
  DEPRECIATION_EXP: '6100',     // مصروف الإهلاك (EXPENSE)
  SALARIES_EXP:     '6200',     // الرواتب والأجور (EXPENSE)
  DISCOUNT_EARNED:  '4100',     // الخصم المكتسب (REVENUE)
  DISCOUNT_ALLOWED: '5100',     // الخصم المسموح به (EXPENSE)
  RETAINED_EARNINGS: '7900',    // الأرباح المرحلة (EQUITY)
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LedgerLine {
  /** account code (e.g. "1000") — resolved to id inside postJournalEntry */
  accountCode?: string;
  /** OR pass the id directly */
  accountId?: number;
  /** optional مركز تكلفة tag — purely informational, never affects account balances */
  costCenterId?: number | null;
  debit?: number | Prisma.Decimal;
  credit?: number | Prisma.Decimal;
  description?: string | null;
}

export interface PostEntryParams {
  date: Date;
  description: string;
  sourceType: JournalSource;
  sourceId?: number | null;
  createdById?: number | null;
  lines: LedgerLine[];
}

// ── Helper: debit-normal types ────────────────────────────────────────────────
function isDebitNormal(type: AccountType): boolean {
  return type === AccountType.ASSET || type === AccountType.EXPENSE;
}

// ── Entry-number generator: JE-YYYYMMDD-NNNN ─────────────────────────────────
async function generateEntryNo(
  tx: Prisma.TransactionClient,
  date: Date,
): Promise<string> {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const prefix = `JE-${y}${m}${d}-`;

  // Take max(existing seq) + 1, NOT count + 1: entries can be deleted (invoice
  // reversal), and a count-based sequence would then re-issue a number that
  // still exists → unique-constraint failure on every new entry that day.
  const last = await tx.journalEntry.findFirst({
    where: { entryNo: { startsWith: prefix } },
    orderBy: { entryNo: 'desc' },
    select: { entryNo: true },
  });
  const lastSeq = last ? parseInt(last.entryNo.slice(prefix.length), 10) || 0 : 0;
  const seq = String(lastSeq + 1).padStart(4, '0');
  return `${prefix}${seq}`;
}

// ── postJournalEntry ──────────────────────────────────────────────────────────
/**
 * Creates a balanced journal entry inside the given Prisma transaction.
 * Throws Arabic error "القيد غير متوازن" if Σdebit ≠ Σcredit.
 * Updates Account.currentBalance for each touched account.
 */
export async function postJournalEntry(
  tx: Prisma.TransactionClient,
  params: PostEntryParams,
) {
  const { date, description, sourceType, sourceId, createdById, lines } = params;

  // Resolve account codes → ids and fetch account types
  const resolvedLines: Array<{
    accountId: number;
    accountType: AccountType;
    costCenterId?: number | null;
    debit: number;
    credit: number;
    description?: string;
  }> = [];

  for (const line of lines) {
    let account: { id: number; type: AccountType } | null = null;

    if (line.accountId) {
      account = await tx.account.findUnique({
        where: { id: line.accountId },
        select: { id: true, type: true },
      });
    } else if (line.accountCode) {
      account = await tx.account.findUnique({
        where: { code: line.accountCode },
        select: { id: true, type: true },
      });
    }

    if (!account) {
      throw new Error(
        `الحساب غير موجود: ${line.accountCode ?? line.accountId}`,
      );
    }

    const debit = Number(line.debit ?? 0);
    const credit = Number(line.credit ?? 0);

    if (debit !== 0 || credit !== 0) {
      resolvedLines.push({
        accountId: account.id,
        accountType: account.type,
        costCenterId: line.costCenterId ?? null,
        debit,
        credit,
        description: line.description ?? undefined,
      });
    }
  }

  // Validate balance
  const totalDebit = resolvedLines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = resolvedLines.reduce((s, l) => s + l.credit, 0);

  const diff = Math.abs(totalDebit - totalCredit);
  if (diff > 0.001) {
    throw new Error(
      `القيد غير متوازن (مدين: ${totalDebit.toFixed(2)}, دائن: ${totalCredit.toFixed(2)})`,
    );
  }

  // Generate entry number
  const entryNo = await generateEntryNo(tx, date);

  // Create JournalEntry + lines
  const created = await tx.journalEntry.create({
    data: {
      entryNo,
      date,
      description,
      sourceType,
      sourceId: sourceId ?? null,
      totalDebit: new Prisma.Decimal(totalDebit),
      totalCredit: new Prisma.Decimal(totalCredit),
      createdById: createdById ?? null,
      lines: {
        create: resolvedLines.map(l => ({
          accountId: l.accountId,
          costCenterId: l.costCenterId ?? null,
          debit: new Prisma.Decimal(l.debit),
          credit: new Prisma.Decimal(l.credit),
          description: l.description ?? null,
        })),
      },
    },
  });

  // Update Account.currentBalance for each line
  for (const line of resolvedLines) {
    const net = isDebitNormal(line.accountType)
      ? line.debit - line.credit        // debit-normal: debit increases, credit decreases
      : line.credit - line.debit;       // credit-normal: credit increases, debit decreases

    if (net !== 0) {
      await tx.account.update({
        where: { id: line.accountId },
        data: { currentBalance: { increment: new Prisma.Decimal(net) } },
      });
    }
  }

  return created;
}

// ── reverseJournalEntryBySource ───────────────────────────────────────────────
/**
 * Finds the journal entry for the given sourceType+sourceId.
 * Manually un-winds each account balance (reverses the original net effect),
 * then hard-deletes the entry and its lines.
 * This is the correct approach when the source document is also being deleted
 * (no audit trail entry needed — the deletion is the event).
 */
export async function reverseJournalEntryBySource(
  tx: Prisma.TransactionClient,
  sourceType: JournalSource,
  sourceId: number,
): Promise<void> {
  const original = await tx.journalEntry.findFirst({
    where: { sourceType, sourceId },
    include: {
      lines: {
        include: { account: { select: { id: true, type: true } } },
      },
    },
  });

  if (!original) return; // No ledger entry to reverse (e.g. older data before ledger)

  // Unwind each account's balance by reversing the original net effect
  for (const line of original.lines) {
    const debit  = Number(line.debit);
    const credit = Number(line.credit);
    const acctType = line.account.type;

    // The original posting incremented balance by `net`.
    // To undo it, decrement by the same amount.
    const net = isDebitNormal(acctType)
      ? debit - credit
      : credit - debit;

    if (net !== 0) {
      await tx.account.update({
        where: { id: line.accountId },
        data: { currentBalance: { decrement: new Prisma.Decimal(net) } },
      });
    }
  }

  // Delete the original entry (JournalLine cascade via schema)
  await tx.journalEntry.delete({ where: { id: original.id } });
}

// ── Year-end closing ───────────────────────────────────────────────────────────

async function getOrCreateRetainedEarningsAccount(tx: Prisma.TransactionClient) {
  const existing = await tx.account.findUnique({ where: { code: ACCT.RETAINED_EARNINGS } });
  if (existing) return existing;
  return tx.account.create({
    data: {
      code: ACCT.RETAINED_EARNINGS,
      nameAr: 'الأرباح المرحلة',
      type: AccountType.EQUITY,
    },
  });
}

export interface YearCloseLine {
  accountId: number;
  code: string;
  nameAr: string;
  type: AccountType;
  balance: number;
}

export interface YearClosePreview {
  lines: YearCloseLine[];
  netIncome: number;
}

/**
 * Builds the year-end closing preview without writing anything:
 * every REVENUE/EXPENSE (incl. COGS) account with a non-zero balance,
 * plus the net income/loss that would be transferred to retained earnings.
 */
export async function previewYearClose(tx: Prisma.TransactionClient): Promise<YearClosePreview> {
  const accounts = await tx.account.findMany({
    where: { type: { in: [AccountType.REVENUE, AccountType.EXPENSE] } },
  });

  const lines: YearCloseLine[] = [];
  let netIncome = 0;

  for (const acc of accounts) {
    const balance = Number(acc.currentBalance);
    if (balance === 0) continue;
    lines.push({ accountId: acc.id, code: acc.code, nameAr: acc.nameAr, type: acc.type, balance });
    netIncome += acc.type === AccountType.REVENUE ? balance : -balance;
  }

  return { lines, netIncome };
}

/**
 * Posts the year-end closing entry: zeroes out every REVENUE/EXPENSE account
 * balance and transfers the net income (or loss) to "الأرباح المرحلة" (7900).
 * Throws "لا توجد أرصدة لإقفالها" if there is nothing to close.
 */
export async function closeFiscalYear(
  tx: Prisma.TransactionClient,
  params: { date: Date; createdById?: number | null },
) {
  const { lines: pnlLines, netIncome } = await previewYearClose(tx);

  if (pnlLines.length === 0) {
    throw new Error('لا توجد أرصدة لإقفالها');
  }

  const retained = await getOrCreateRetainedEarningsAccount(tx);

  const closingLines: LedgerLine[] = pnlLines.map((line) => {
    // Zero out `balance` regardless of sign: a REVENUE account is credit-normal
    // (net = credit-debit), an EXPENSE account is debit-normal (net = debit-credit).
    // The contra-line must apply the opposite net so the resulting balance is 0.
    if (line.type === AccountType.REVENUE) {
      return line.balance >= 0
        ? { accountId: line.accountId, debit: line.balance, credit: 0, description: `إقفال ${line.nameAr}` }
        : { accountId: line.accountId, debit: 0, credit: -line.balance, description: `إقفال ${line.nameAr}` };
    }
    // EXPENSE
    return line.balance >= 0
      ? { accountId: line.accountId, debit: 0, credit: line.balance, description: `إقفال ${line.nameAr}` }
      : { accountId: line.accountId, debit: -line.balance, credit: 0, description: `إقفال ${line.nameAr}` };
  });

  if (netIncome > 0) {
    closingLines.push({ accountId: retained.id, debit: 0, credit: netIncome, description: 'صافي ربح السنة المرحّل' });
  } else if (netIncome < 0) {
    closingLines.push({ accountId: retained.id, debit: -netIncome, credit: 0, description: 'صافي خسارة السنة المرحّلة' });
  }

  return postJournalEntry(tx, {
    date: params.date,
    description: `قيد إقفال السنة المالية`,
    sourceType: JournalSource.YEAR_CLOSE,
    sourceId: null,
    createdById: params.createdById ?? null,
    lines: closingLines,
  });
}
