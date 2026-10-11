/**
 * المستودعات: عدد الأصناف المخزنة (الرصيد > 0) يُرجَع مع كل مستودع.
 */
import { describe, it, expect } from 'vitest';
import { api, prisma } from './helpers';

describe('GET /warehouses stocked-item count', () => {
  it('returns _count.stockBalances equal to the rows with quantity > 0', async () => {
    const res = await api('get', '/warehouses?pageSize=100');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);

    for (const w of res.body.data as { id: number; _count: { stockBalances: number } }[]) {
      const expected = await prisma.stockBalance.count({ where: { warehouseId: w.id, quantity: { gt: 0 } } });
      expect(w._count.stockBalances).toBe(expected);
    }
    const total = (res.body.data as { _count: { stockBalances: number } }[])
      .reduce((s, w) => s + w._count.stockBalances, 0);
    expect(total).toBeGreaterThan(0);
  });

  it('does not count zero-quantity balances', async () => {
    const wh = await prisma.warehouse.create({ data: { nameAr: 'مستودع اختبار العدّاد' } });
    const product = await prisma.product.findFirstOrThrow();
    await prisma.stockBalance.create({ data: { productId: product.id, warehouseId: wh.id, quantity: 0 } });
    try {
      const detail = await api('get', `/warehouses/${wh.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body._count.stockBalances).toBe(0);
    } finally {
      await prisma.stockBalance.deleteMany({ where: { warehouseId: wh.id } });
      await prisma.warehouse.delete({ where: { id: wh.id } });
    }
  });
});
