/**
 * Stock quantity corrections (stock count, manual adjustment) must reach the ledger, otherwise the
 * inventory account drifts away from quantity × cost.
 *
 * A shortage is a loss:  Dr COGS (5000)       Cr Inventory (1200)
 * A surplus is a gain:   Dr Inventory (1200)  Cr COGS (5000)
 * Valued at the product's current moving-average cost. One entry per document, on the net value.
 */
import { JournalSource } from '@prisma/client';
import type { Tx } from './prisma';
import { ACCT, postJournalEntry } from './ledger';

export interface StockChange {
  productId: number;
  /** counted − on hand: negative = shortage, positive = surplus */
  delta: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function postStockAdjustmentEntry(
  tx: Tx,
  p: { description: string; sourceId: number; createdById?: number | null; changes: StockChange[]; date?: Date },
): Promise<number> {
  const changes = p.changes.filter((c) => c.delta !== 0);
  if (changes.length === 0) return 0;

  const ids = [...new Set(changes.map((c) => c.productId))];
  const rows = await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, costPrice: true } });
  const cost = new Map(rows.map((r) => [r.id, Number(r.costPrice)]));

  const net = round2(changes.reduce((s, c) => s + c.delta * (cost.get(c.productId) ?? 0), 0));
  if (net === 0) return 0;

  const amount = Math.abs(net);
  const gain = net > 0;
  await postJournalEntry(tx, {
    date: p.date ?? new Date(),
    description: p.description,
    sourceType: JournalSource.STOCK_ADJUSTMENT,
    sourceId: p.sourceId,
    createdById: p.createdById ?? undefined,
    lines: [
      { accountCode: gain ? ACCT.INVENTORY : ACCT.COGS, debit: amount, credit: 0, description: p.description },
      { accountCode: gain ? ACCT.COGS : ACCT.INVENTORY, debit: 0, credit: amount, description: p.description },
    ],
  });
  return net;
}
