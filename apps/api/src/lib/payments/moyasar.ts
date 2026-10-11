/**
 * Moyasar — hosted invoice checkout (https://docs.moyasar.com/api/invoices/01-create-invoice)
 *
 *   POST /v1/invoices      create an invoice → { id, status, url }
 *   GET  /v1/invoices/:id  authoritative state → { status, amount, currency, payments: [...] }
 *
 * Auth: HTTP Basic, the secret key (sk_test_… / sk_live_…) as username, empty password.
 */
import type {
  CheckoutRequest,
  CheckoutResult,
  PaymentProvider,
  ProviderInvoice,
  ProviderInvoiceStatus,
} from './provider';

const BASE_URL = 'https://api.moyasar.com/v1';

interface MoyasarPayment {
  id: string;
  status: string;
  amount?: number;
  message?: string | null;
}
interface MoyasarInvoice {
  id: string;
  status: string;
  amount: number;
  currency: string;
  url?: string;
  payments?: MoyasarPayment[];
}

function mapStatus(status: string): ProviderInvoiceStatus {
  switch (status) {
    case 'paid':
      return 'paid';
    case 'failed':
      return 'failed';
    case 'expired':
      return 'expired';
    case 'canceled':
    case 'voided':
      return 'canceled';
    default:
      return 'pending'; // initiated, on_hold, refunded (a refund is handled by hand)
  }
}

export class MoyasarProvider implements PaymentProvider {
  readonly name = 'moyasar' as const;

  constructor(private readonly secretKey: string, private readonly baseUrl: string = BASE_URL) {}

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) {
      // never log the key; the response body is Moyasar's error description
      throw new Error(`Moyasar ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    }
    return JSON.parse(text) as T;
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const invoice = await this.call<MoyasarInvoice>('POST', '/invoices', {
      amount: req.amountMinor,
      currency: req.currency,
      description: req.description,
      callback_url: req.callbackUrl,
      success_url: req.successUrl,
      back_url: req.backUrl,
      metadata: req.metadata,
    });
    if (!invoice.url) throw new Error('Moyasar did not return a checkout url');
    return { providerInvoiceId: invoice.id, checkoutUrl: invoice.url };
  }

  async fetchInvoice(providerInvoiceId: string): Promise<ProviderInvoice> {
    const invoice = await this.call<MoyasarInvoice>('GET', `/invoices/${encodeURIComponent(providerInvoiceId)}`);
    const paid = (invoice.payments ?? []).find((p) => p.status === 'paid');
    const failed = (invoice.payments ?? []).find((p) => p.status === 'failed');
    const status = mapStatus(invoice.status);
    return {
      providerInvoiceId: invoice.id,
      status,
      amountMinor: invoice.amount,
      currency: invoice.currency,
      providerPaymentId: paid?.id ?? null,
      failureReason: status === 'failed' ? failed?.message ?? 'failed' : null,
    };
  }
}
