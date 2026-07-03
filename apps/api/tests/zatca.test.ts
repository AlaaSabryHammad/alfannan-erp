/**
 * الفوترة الإلكترونية (ZATCA) — سلامة التجزئة والختم الرقمي ورمز QR.
 * وحدات خالصة لا تلمس قاعدة البيانات ولا بوابة الهيئة.
 */
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  buildInvoiceXml, computeInvoiceHash, signInvoiceXml, verifyInvoiceSignature,
  buildQrPayload, decodeQrPayload, ZATCA_GENESIS_HASH,
} from '../src/lib/zatca';

function sampleXml(pih: string): string {
  return buildInvoiceXml({
    refNo: 'INV-20260704-0001', uuid: 'u-1', date: new Date('2026-07-04T09:00:00Z'),
    subtotal: 200, discount: 0, tax: 30, total: 230,
    previousInvoiceHash: pih, sellerName: 'الفنان', sellerVatNumber: '300000000000003',
    buyerName: 'عميل', buyerVatNumber: null, isSimplified: true,
    lines: [{ nameAr: 'صنف', qty: 2, unitPrice: 100, lineTotal: 200, taxRate: 15 }],
  });
}

describe('ZATCA hashing', () => {
  it('hash is deterministic SHA-256(xml) in base64 and chains via the embedded PIH', () => {
    const xml = sampleXml(ZATCA_GENESIS_HASH);
    const h1 = computeInvoiceHash(xml);
    const h2 = computeInvoiceHash(xml);
    expect(h1).toBe(h2);
    // matches a plain SHA-256 base64 of the same bytes
    expect(h1).toBe(crypto.createHash('sha256').update(xml, 'utf8').digest('base64'));

    // a different PIH changes the XML → changes the hash (real chaining)
    const other = computeInvoiceHash(sampleXml('some-other-previous-hash'));
    expect(other).not.toBe(h1);
  });
});

describe('ZATCA ECDSA stamp', () => {
  it('signs with a secp256k1 key and the signature verifies; no key → null', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
    const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;

    const xml = sampleXml(ZATCA_GENESIS_HASH);
    const sig = signInvoiceXml(xml, privPem);
    expect(sig).toBeTruthy();
    expect(verifyInvoiceSignature(xml, sig!, pubPem)).toBe(true);

    // tampering with the XML breaks verification
    expect(verifyInvoiceSignature(xml + ' ', sig!, pubPem)).toBe(false);

    // no configured key → Phase 1 (no stamp)
    expect(signInvoiceXml(xml, null)).toBeNull();
    expect(signInvoiceXml(xml, '   ')).toBeNull();
  });
});

describe('ZATCA QR (TLV)', () => {
  it('emits 5 Phase-1 tags without a signature and round-trips the mandatory fields', () => {
    const payload = buildQrPayload({
      sellerName: 'الفنان', sellerVatNumber: '300000000000003',
      timestamp: '2026-07-04T09:00:00.000Z', invoiceTotal: 230, vatTotal: 30,
    });
    const tags = decodeQrPayload(payload);
    expect([...tags.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(tags.get(1)!.toString('utf8')).toBe('الفنان');
    expect(tags.get(2)!.toString('utf8')).toBe('300000000000003');
    expect(tags.get(4)!.toString('utf8')).toBe('230.00');
    expect(tags.get(5)!.toString('utf8')).toBe('30.00');
  });

  it('emits 8 tags (Phase-2) when hash + signature + public key are present', () => {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
    const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const xml = sampleXml(ZATCA_GENESIS_HASH);
    const hash = computeInvoiceHash(xml);
    const sig = signInvoiceXml(xml, privPem)!;
    const pubDer = crypto.createPublicKey(privPem).export({ type: 'spki', format: 'der' });

    const payload = buildQrPayload({
      sellerName: 'الفنان', sellerVatNumber: '300000000000003',
      timestamp: '2026-07-04T09:00:00.000Z', invoiceTotal: 230, vatTotal: 30,
      invoiceHash: hash, signatureBase64: sig, publicKeyDer: pubDer,
    });
    const tags = decodeQrPayload(payload);
    expect([...tags.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(tags.get(6)!.toString('utf8')).toBe(hash);
    expect(tags.get(7)!.toString('base64')).toBe(sig);
  });
});
