/**
 * ZATCA (هيئة الزكاة والضريبة والجمارك) e-invoice QR — Phase 1 "Generation" compliance.
 *
 * Builds the TLV (Tag-Length-Value) + Base64 payload required on every simplified
 * tax invoice per ZATCA's published spec: 5 tags — seller name, VAT number,
 * invoice timestamp, invoice total (incl. VAT), VAT total. This is fully offline
 * and requires no government API access.
 *
 * NOTE — scope: this covers Phase 1 (QR must be present and scannable) only.
 * Phase 2 (cryptographic stamping + real-time clearance/reporting via ZATCA's API)
 * requires a taxpayer-specific CSID certificate issued by ZATCA during onboarding,
 * which this system does not have — that integration would need to be wired in
 * once real certificates are obtained.
 */

function tlv(tag: number, value: string): Uint8Array {
  const valueBytes = new TextEncoder().encode(value);
  const out = new Uint8Array(2 + valueBytes.length);
  out[0] = tag;
  out[1] = valueBytes.length;
  out.set(valueBytes, 2);
  return out;
}

export interface ZatcaQrParams {
  sellerName: string;
  /** 15-digit VAT registration number */
  vatNumber: string;
  /** ISO 8601 timestamp of the invoice */
  timestamp: string;
  /** invoice total including VAT */
  invoiceTotal: number;
  /** total VAT amount */
  vatTotal: number;
}

/** Returns the Base64-encoded TLV payload to embed in the invoice's QR code. */
export function buildZatcaQrPayload(params: ZatcaQrParams): string {
  const parts = [
    tlv(1, params.sellerName),
    tlv(2, params.vatNumber),
    tlv(3, params.timestamp),
    tlv(4, params.invoiceTotal.toFixed(2)),
    tlv(5, params.vatTotal.toFixed(2)),
  ];

  const totalLength = parts.reduce((s, p) => s + p.length, 0);
  const buffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const p of parts) {
    buffer.set(p, offset);
    offset += p.length;
  }

  let binary = '';
  for (let i = 0; i < buffer.length; i++) binary += String.fromCharCode(buffer[i]);
  return btoa(binary);
}
