/**
 * الإعدادات: بيانات الشركة (الهاتف والعنوان) تُحفظ وتُرجَع مع القيم الافتراضية.
 */
import { describe, it, expect } from 'vitest';
import { api, prisma } from './helpers';

describe('company settings', () => {
  it('exposes companyPhone and companyAddress, defaulting to empty strings', async () => {
    await prisma.setting.deleteMany({ where: { key: { in: ['companyPhone', 'companyAddress'] } } });
    const res = await api('get', '/settings');
    expect(res.status).toBe(200);
    expect(res.body.companyPhone).toBe('');
    expect(res.body.companyAddress).toBe('');
  });

  it('saves and returns the phone and address', async () => {
    const put = await api('put', '/settings', { companyPhone: '0112223334', companyAddress: 'الرياض - اختبار' });
    expect(put.status).toBe(200);
    expect(put.body.companyPhone).toBe('0112223334');

    const get = await api('get', '/settings');
    expect(get.body.companyPhone).toBe('0112223334');
    expect(get.body.companyAddress).toBe('الرياض - اختبار');

    await prisma.setting.deleteMany({ where: { key: { in: ['companyPhone', 'companyAddress'] } } });
  });
});
