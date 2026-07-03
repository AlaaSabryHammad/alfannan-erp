/**
 * حجز المخزون — Stock reservations
 *
 * A PENDING sales order reserves its quantities: they still sit in the
 * warehouse, but selling them to anyone else must be blocked. Reservations
 * are derived (never stored) from PENDING SalesOrder items, so they can't
 * drift: fulfilling or cancelling the order releases them automatically.
 */
import { Prisma } from '@prisma/client';

/**
 * Total quantity of a product reserved by PENDING sales orders on a warehouse.
 * `excludeOrderId` omits one order — used when THAT order is being fulfilled,
 * since it is entitled to consume its own reservation.
 */
export async function getReservedQty(
  tx: Prisma.TransactionClient,
  productId: number,
  warehouseId: number,
  excludeOrderId?: number,
): Promise<number> {
  const agg = await tx.salesOrderItem.aggregate({
    where: {
      productId,
      salesOrder: {
        warehouseId,
        status: 'PENDING',
        ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
      },
    },
    _sum: { qty: true },
  });
  return Number(agg._sum.qty ?? 0);
}
