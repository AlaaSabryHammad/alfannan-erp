/**
 * حركات المخزون: فلاتر النوع والمصدر والتاريخ والمنتج والمستودع.
 */
import { describe, it, expect } from 'vitest';
import { api, prisma } from './helpers';

type Mv = { type: string; refType: string | null; createdAt: string; product: { id: number }; warehouse: { id: number } };

async function movements(query = '') {
  const res = await api('get', `/stock/movements?pageSize=500${query}`);
  expect(res.status).toBe(200);
  return res.body as { data: Mv[]; pagination: { total: number } };
}

describe('GET /stock/movements filters', () => {
  it('filters by movement type', async () => {
    const all = await movements();
    const out = await movements('&type=OUT');
    expect(out.data.length).toBeGreaterThan(0);
    expect(out.data.every((m) => m.type === 'OUT')).toBe(true);
    expect(out.pagination.total).toBeLessThanOrEqual(all.pagination.total);
  });

  it('ignores an unknown movement type instead of failing', async () => {
    const all = await movements();
    const bad = await movements('&type=BOGUS');
    expect(bad.pagination.total).toBe(all.pagination.total);
  });

  it('filters by source (refType)', async () => {
    const res = await movements('&refType=OPENING');
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data.every((m) => m.refType === 'OPENING')).toBe(true);
  });

  it('filters by date range', async () => {
    const past = await movements('&from=2000-01-01&to=2000-01-31');
    expect(past.pagination.total).toBe(0);

    const future = await movements('&from=2000-01-01&to=2100-01-01');
    const all = await movements();
    expect(future.pagination.total).toBe(all.pagination.total);
  });

  it('combines product and warehouse filters', async () => {
    const first = await prisma.stockMovement.findFirstOrThrow();
    const res = await movements(`&productId=${first.productId}&warehouseId=${first.warehouseId}`);
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data.every((m) => m.product.id === first.productId && m.warehouse.id === first.warehouseId)).toBe(true);
  });
});
