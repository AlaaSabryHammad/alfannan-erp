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

/**
 * Un-do a receipt's effect on the moving average — used when a RECEIVED
 * purchase invoice is deleted (the receipt is being taken back out). It removes
 * this receipt's quantity and value from the current cost pool:
 *
 *   newAvg = (onHand × currentAvg − removedQty × removedUnitNetCost)
 *            ÷ (onHand − removedQty)
 *
 * Must be called BEFORE the stock is decremented (reads the on-hand that still
 * includes the receipt). Guards: if removing the receipt would empty the stock
 * or produce a nonsensical (non-positive) pool, the average is left unchanged —
 * there is nothing meaningful to average against. A removal to a supplier
 * (purchase return) or a sale does NOT use this: in moving average, removing
 * stock never changes the unit average, only the quantity.
 */
export async function reverseMovingAverageCost(
  tx: Prisma.TransactionClient,
  productId: number,
  removedQty: number,
  removedUnitNetCost: number,
): Promise<void> {
  if (removedQty <= 0) return;

  const [product, onHandAgg] = await Promise.all([
    tx.product.findUniqueOrThrow({ where: { id: productId }, select: { costPrice: true } }),
    tx.stockBalance.aggregate({ where: { productId }, _sum: { quantity: true } }),
  ]);

  const onHand = Math.max(0, Number(onHandAgg._sum.quantity ?? 0)); // still includes the receipt
  const currentAvg = Number(product.costPrice);
  const remainingQty = onHand - removedQty;
  if (remainingQty <= 0.0001) return; // nothing left to average against

  const remainingValue = onHand * currentAvg - removedQty * removedUnitNetCost;
  if (remainingValue <= 0) return; // guard against a corrupt pool

  const newAvg = round2(remainingValue / remainingQty);
  if (newAvg > 0 && newAvg !== round2(currentAvg)) {
    await tx.product.update({
      where: { id: productId },
      data: { costPrice: new Prisma.Decimal(newAvg) },
    });
  }
}
