/**
 * Inventory costing — متوسط التكلفة المتحرك (Moving / Weighted Average)
 *
 * Product.costPrice is the company-wide average unit cost. Every purchase
 * receipt re-averages it against the quantity already on hand:
 *
 *   newAvg = (onHandQty × currentAvg + receivedQty × unitNetCost)
 *            ÷ (onHandQty + receivedQty)
 *
 * Sales COGS and the sale-return COGS reversal both read costPrice, so this
 * keeps the P&L honest as purchase prices drift. Removals (sales, purchase
 * returns, invoice deletes) never change the average — only receipts do.
 */
import { Prisma } from '@prisma/client';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Re-average a product's costPrice for a received quantity.
 * Must be called BEFORE the stock balance is incremented for this receipt —
 * it reads the current on-hand quantity across all warehouses.
 *
 * `unitNetCost` is the effective unit cost after the invoice-level discount
 * has been prorated onto the line.
 */
export async function applyMovingAverageCost(
  tx: Prisma.TransactionClient,
  productId: number,
  receivedQty: number,
  unitNetCost: number,
): Promise<void> {
  if (receivedQty <= 0) return;

  const [product, onHandAgg] = await Promise.all([
    tx.product.findUniqueOrThrow({ where: { id: productId }, select: { costPrice: true } }),
    tx.stockBalance.aggregate({ where: { productId }, _sum: { quantity: true } }),
  ]);

  // Negative balances would poison the average — treat them as empty stock.
  const onHand = Math.max(0, Number(onHandAgg._sum.quantity ?? 0));
  const currentAvg = Number(product.costPrice);

  const newAvg = onHand > 0
    ? (onHand * currentAvg + receivedQty * unitNetCost) / (onHand + receivedQty)
    : unitNetCost;

  if (round2(newAvg) !== round2(currentAvg)) {
    await tx.product.update({
      where: { id: productId },
      data: { costPrice: new Prisma.Decimal(round2(newAvg)) },
    });
  }
}
