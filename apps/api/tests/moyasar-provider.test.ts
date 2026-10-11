/**
 * The Moyasar adapter against a stubbed fetch: the requests we send and how we read the answers.
 * (The gateway itself is exercised with the sandbox keys, see docs/PAYMENTS.md.)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MoyasarProvider } from '../src/lib/payments/moyasar';

const KEY = 'sk_test_abc123';

function stubFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('MoyasarProvider', () => {
  it('creates an invoice with Basic auth, minor units and our urls/metadata', async () => {
    const calls = stubFetch(201, { id: 'inv-uuid-1', status: 'initiated', url: 'https://checkout.moyasar.com/invoices/inv-uuid-1' });
    const provider = new MoyasarProvider(KEY);

    const out = await provider.createCheckout({
      orderId: 7,
      amountMinor: 39900,
      currency: 'SAR',
      description: 'اشتراك احترافي — شهر',
      successUrl: 'https://app.test/subscription?payment=return&order=7',
      backUrl: 'https://app.test/subscription?payment=cancelled&order=7',
      callbackUrl: 'https://app.test/api/webhooks/moyasar?order=7&sig=abc',
      metadata: { orderId: '7', tenantId: '3' },
    });

    expect(out).toEqual({ providerInvoiceId: 'inv-uuid-1', checkoutUrl: 'https://checkout.moyasar.com/invoices/inv-uuid-1' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.moyasar.com/v1/invoices');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from(`${KEY}:`).toString('base64')}`);
    const sent = JSON.parse(calls[0].init.body as string);
    expect(sent).toMatchObject({
      amount: 39900,
      currency: 'SAR',
      callback_url: 'https://app.test/api/webhooks/moyasar?order=7&sig=abc',
      success_url: 'https://app.test/subscription?payment=return&order=7',
      back_url: 'https://app.test/subscription?payment=cancelled&order=7',
      metadata: { orderId: '7', tenantId: '3' },
    });
  });

  it('reads a paid invoice (status, amount and the settling payment)', async () => {
    stubFetch(200, {
      id: 'inv-1', status: 'paid', amount: 39900, currency: 'SAR',
      payments: [{ id: 'pay-failed', status: 'failed' }, { id: 'pay-ok', status: 'paid' }],
    });
    const inv = await new MoyasarProvider(KEY).fetchInvoice('inv-1');
    expect(inv).toMatchObject({
      providerInvoiceId: 'inv-1', status: 'paid', amountMinor: 39900, currency: 'SAR', providerPaymentId: 'pay-ok',
    });
  });

  it('maps the other statuses conservatively', async () => {
    const statuses: Array<[string, string]> = [
      ['initiated', 'pending'], ['on_hold', 'pending'], ['refunded', 'pending'],
      ['failed', 'failed'], ['expired', 'expired'], ['canceled', 'canceled'], ['voided', 'canceled'],
    ];
    for (const [moyasar, ours] of statuses) {
      stubFetch(200, { id: 'x', status: moyasar, amount: 100, currency: 'SAR', payments: [] });
      const inv = await new MoyasarProvider(KEY).fetchInvoice('x');
      expect(inv.status).toBe(ours);
    }
  });

  it('turns an API error into an exception that never contains the key', async () => {
    stubFetch(401, '{"type":"authentication_error","message":"Invalid authorization credentials"}');
    const err = await new MoyasarProvider(KEY).fetchInvoice('x').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('401');
    expect((err as Error).message).not.toContain(KEY);
  });

  it('refuses a response without a checkout url', async () => {
    stubFetch(201, { id: 'inv-2', status: 'initiated' });
    await expect(
      new MoyasarProvider(KEY).createCheckout({
        orderId: 1, amountMinor: 100, currency: 'SAR', description: 'x',
        successUrl: 'https://a', backUrl: 'https://a', callbackUrl: 'https://a', metadata: {},
      }),
    ).rejects.toThrow(/checkout url/);
  });
});
