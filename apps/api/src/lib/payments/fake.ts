/**
 * In-memory provider for tests and local development (PAYMENTS_PROVIDER=fake).
 * Behaves like a gateway you control: nothing is paid until `markPaid` is called.
 */
import type {
  CheckoutRequest,
  CheckoutResult,
  PaymentProvider,
  ProviderInvoice,
  ProviderInvoiceStatus,
} from './provider';

interface Stored {
  id: string;
  amountMinor: number;
  currency: string;
  status: ProviderInvoiceStatus;
  paymentId: string | null;
  failureReason: string | null;
  request: CheckoutRequest;
}

export class FakeProvider implements PaymentProvider {
  readonly name = 'fake' as const;
  private invoices = new Map<string, Stored>();
  private counter = 0;

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const id = `fake_inv_${++this.counter}_${Date.now().toString(36)}`;
    this.invoices.set(id, {
      id, amountMinor: req.amountMinor, currency: req.currency, status: 'pending',
      paymentId: null, failureReason: null, request: req,
    });
    return { providerInvoiceId: id, checkoutUrl: `https://fake-gateway.test/checkout/${id}` };
  }

  async fetchInvoice(providerInvoiceId: string): Promise<ProviderInvoice> {
    const inv = this.invoices.get(providerInvoiceId);
    if (!inv) throw new Error(`fake provider: unknown invoice ${providerInvoiceId}`);
    return {
      providerInvoiceId: inv.id,
      status: inv.status,
      amountMinor: inv.amountMinor,
      currency: inv.currency,
      providerPaymentId: inv.paymentId,
      failureReason: inv.failureReason,
    };
  }

  // ── test controls ────────────────────────────────────────────────────────────
  markPaid(providerInvoiceId: string, opts: { amountMinor?: number; currency?: string } = {}): void {
    const inv = this.invoices.get(providerInvoiceId);
    if (!inv) throw new Error('unknown invoice');
    inv.status = 'paid';
    inv.paymentId = `fake_pay_${inv.id}`;
    if (opts.amountMinor !== undefined) inv.amountMinor = opts.amountMinor; // simulate a tampered/short payment
    if (opts.currency !== undefined) inv.currency = opts.currency;
  }

  markFailed(providerInvoiceId: string, reason = 'declined'): void {
    const inv = this.invoices.get(providerInvoiceId);
    if (!inv) throw new Error('unknown invoice');
    inv.status = 'failed';
    inv.failureReason = reason;
  }

  lastRequestFor(providerInvoiceId: string): CheckoutRequest | undefined {
    return this.invoices.get(providerInvoiceId)?.request;
  }
}
