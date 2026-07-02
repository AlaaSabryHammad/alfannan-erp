/**
 * Format a number as Saudi Riyal currency string
 * e.g. 421863.7 → "421,863.70 ر.س"
 */
export function formatMoney(amount: number | string | null | undefined): string {
  // Coerce defensively: API Decimal fields may arrive as strings.
  const n = Number(amount);
  const formatted = (Number.isFinite(n) ? n : 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${formatted} ر.س`;
}

/**
 * Format a date string to Arabic locale
 */
export function formatDate(dateStr: string | Date): string {
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  return d.toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Concatenate class names (simple version, no clsx dep)
 */
export function cn(...classes: (string | undefined | null | boolean)[]): string {
  return classes.filter(Boolean).join(' ');
}

/**
 * Extract the real error message from an Axios-style error response.
 * Falls back to a caller-supplied Arabic string if nothing is found.
 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { error?: string; message?: string } }; message?: string };
  return e?.response?.data?.error ?? e?.response?.data?.message ?? e?.message ?? fallback;
}

/**
 * Resolve a product imageUrl to an absolute URL.
 * Relative paths like "/uploads/foo.jpg" get the API origin prepended
 * (derived from VITE_API_URL by stripping the trailing "/api" segment).
 */
export function resolveImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  // Derive API origin from VITE_API_URL (e.g. "http://localhost:4000/api" → "http://localhost:4000")
  const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000/api';
  const origin = apiBase.replace(/\/api\/?$/, '');
  return `${origin}${url}`;
}
