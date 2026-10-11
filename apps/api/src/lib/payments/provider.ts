/**
 * Payment provider abstraction — طبقة بوابة الدفع
 *
 * The rest of the system only knows this interface, so switching the gateway (Moyasar → Tap …)
 * or testing without a gateway (the "fake" provider) touches one file.
 *
 * Amounts are in the smallest currency unit (halalas for SAR): 1.00 SAR = 100.
 */
import { MoyasarProvider } from './moyasar';
import { FakeProvider } from './fake';

export type ProviderInvoiceStatus = 'pending' | 'paid' | 'failed' | 'expired' | 'canceled';

export interface CheckoutRequest {
  orderId: number;
  amountMinor: number;
  currency: string;
  description: string;
  successUrl: string;
  backUrl: string;
  /** server-to-server notification for this order (carries an HMAC so only we can have created it) */
  callbackUrl: string;
  metadata: Record<string, string>;
}

export interface CheckoutResult {
  providerInvoiceId: string;
  checkoutUrl: string;
}

export interface ProviderInvoice {
  providerInvoiceId: string;
  status: ProviderInvoiceStatus;
  amountMinor: number;
  currency: string;
  /** id of the payment that settled it, when paid */
  providerPaymentId: string | null;
  failureReason: string | null;
}

export interface PaymentProvider {
  readonly name: 'moyasar' | 'fake';
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  /** Authoritative state of an invoice, fetched with our secret key. */
  fetchInvoice(providerInvoiceId: string): Promise<ProviderInvoice>;
}

export function paymentsEnabled(): boolean {
  return process.env.PAYMENTS_ENABLED === 'true';
}

let fake: FakeProvider | null = null;
export function getFakeProvider(): FakeProvider {
  fake ??= new FakeProvider();
  return fake;
}

export function getProvider(): PaymentProvider {
  const name = process.env.PAYMENTS_PROVIDER ?? 'moyasar';
  if (name === 'fake') return getFakeProvider();
  if (name === 'moyasar') {
    const key = process.env.MOYASAR_SECRET_KEY;
    if (!key) throw new Error('MOYASAR_SECRET_KEY غير مضبوط');
    return new MoyasarProvider(key);
  }
  throw new Error(`مزوّد دفع غير معروف: ${name}`);
}
