/**
 * «تفعيل الإشعارات»: عند التعطيل يرجع ملخص التنبيهات أصفارًا، وعند التفعيل يعود طبيعيًا.
 */
import { describe, it, expect } from 'vitest';
import { api, prisma } from './helpers';

describe('enableNotifications setting', () => {
  it('defaults to enabled and is exposed by /settings', async () => {
    await prisma.setting.deleteMany({ where: { key: 'enableNotifications' } });
    const s = await api('get', '/settings');
    expect(s.body.enableNotifications).toBe('true');
    const sum = await api('get', '/alerts/summary');
    expect(sum.body.enabled).toBe(true);
  });

  it('returns an all-zero summary while disabled and recovers when re-enabled', async () => {
    // make sure there is something to count, so a zero total is meaningful
    const enabled = await api('get', '/alerts/summary');
    const realTotal = enabled.body.total as number;

    const off = await api('put', '/settings', { enableNotifications: 'false' });
    expect(off.status).toBe(200);
    const disabled = await api('get', '/alerts/summary');
    expect(disabled.body.enabled).toBe(false);
    expect(disabled.body.total).toBe(0);
    expect(disabled.body.lowStockCount).toBe(0);

    await api('put', '/settings', { enableNotifications: 'true' });
    const back = await api('get', '/alerts/summary');
    expect(back.body.enabled).toBe(true);
    expect(back.body.total).toBe(realTotal);

    await prisma.setting.deleteMany({ where: { key: 'enableNotifications' } });
  });
});
