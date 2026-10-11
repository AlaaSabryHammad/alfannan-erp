/**
 * Payment gateway notifications — POST /api/webhooks/moyasar
 *
 * Two kinds reach this URL, and both are only a *hint* to go and ask the gateway:
 *   1. the invoice `callback_url` we registered — its query string carries an HMAC only we can produce
 *   2. a dashboard webhook — its body carries the shared `secret_token`
 * Whatever the body claims, the order is settled from the gateway's own API (see settleOrder).
 */
import { Router, Request, Response, NextFunction } from 'express';
import { platformPrisma as db } from '../lib/platformPrisma';
import { rateLimit } from '../middleware/rateLimit';
import { safeEqual, settleOrder, verifyCallbackSignature } from '../lib/paymentService';

const router = Router();

interface WebhookBody {
  id?: unknown;
  type?: unknown;
  secret_token?: unknown;
  data?: { id?: unknown; invoice_id?: unknown; metadata?: Record<string, unknown> } | null;
  metadata?: Record<string, unknown> | null;
}

router.post(
  '/moyasar',
  rateLimit({ name: 'payment-webhook', windowMs: 10 * 60 * 1000, max: 300 }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as WebhookBody;

      // 1. our own callback: ?order=<id>&sig=<hmac>
      const orderParam = Number(req.query.order);
      const sig = typeof req.query.sig === 'string' ? req.query.sig : '';
      let orderId: number | null = null;
      if (Number.isInteger(orderParam) && orderParam > 0 && sig && verifyCallbackSignature(orderParam, sig)) {
        orderId = orderParam;
      } else {
        // 2. dashboard webhook: shared secret in the body
        const secret = process.env.MOYASAR_WEBHOOK_SECRET;
        const token = typeof body.secret_token === 'string' ? body.secret_token : '';
        if (!secret || !token || !safeEqual(token, secret)) {
          res.status(401).json({ error: 'unauthorized' });
          return;
        }
        const candidates = [body.data?.invoice_id, body.data?.id, body.id].filter(
          (v): v is string => typeof v === 'string',
        );
        const fromMetadata = Number(body.data?.metadata?.orderId ?? body.metadata?.orderId);
        for (const invoiceId of candidates) {
          const found = await db.paymentOrder.findUnique({ where: { providerInvoiceId: invoiceId }, select: { id: true } });
          if (found) {
            orderId = found.id;
            break;
          }
        }
        if (orderId === null && Number.isInteger(fromMetadata) && fromMetadata > 0) orderId = fromMetadata;
      }

      if (orderId === null) {
        res.json({ ok: true, ignored: true }); // authenticated but not about one of our orders
        return;
      }

      const result = await settleOrder(orderId);
      res.json({ ok: true, status: result?.status ?? 'UNKNOWN' });
    } catch (err) {
      next(err); // a 500 makes the gateway retry
    }
  },
);

export default router;
