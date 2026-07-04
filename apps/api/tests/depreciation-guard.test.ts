/**
 * الإهلاك اليدوي مرة واحدة فقط في الشهر — لا يمكن إهلاك الأصل مرتين خلال نفس الشهر.
 */
import { describe, it, expect } from 'vitest';
import { api, prisma, expectLedgerInvariants } from './helpers';

describe('manual depreciation monthly guard', () => {
  it('depreciates once, then rejects a second run in the same month', async () => {
    // asset 1200 / 12 → 100 per month
    const asset = await api('post', '/fixed-assets', {
      nameAr: 'أصل اختبار حارس الإهلاك', purchaseCost: 1200, salvageValue: 0, usefulLifeMonths: 12,
      purchaseDate: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 5).toISOString().slice(0, 10),
    });
    expect(asset.status).toBe(201);
    const id = asset.body.id as number;

    const first = await api('post', `/fixed-assets/${id}/depreciate`, {});
    expect(first.status).toBe(200);
    expect(Number(first.body.depreciationAmount)).toBeCloseTo(100, 2);

    const second = await api('post', `/fixed-assets/${id}/depreciate`, {});
    expect(second.status).toBe(400);
    expect(second.body.error).toContain('خلال هذا الشهر');

    // still only depreciated once
    const after = await prisma.fixedAsset.findUniqueOrThrow({ where: { id } });
    expect(Number(after.accumulatedDepreciation)).toBeCloseTo(100, 2);

    await expectLedgerInvariants();

    // cleanup (delete reverses all its entries)
    expect((await api('delete', `/fixed-assets/${id}`)).status).toBe(200);
    await expectLedgerInvariants();
  });
});
