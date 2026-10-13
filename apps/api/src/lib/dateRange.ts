/**
 * parseDateRange — shared helper for ?from=YYYY-MM-DD&to=YYYY-MM-DD query params.
 *
 * - from is treated as start of that day (00:00:00 UTC).
 * - to is treated as end of that day (23:59:59.999 UTC) so the full day is included.
 * - Returns undefined when the param is absent (no filter applied).
 */
/**
 * A "to" query value that is a calendar day (YYYY-MM-DD) means the END of that day; a full timestamp is
 * taken as given. `new Date('2026-10-12')` is midnight, and with `lte` it silently dropped the whole day.
 */
export function endOfDay(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:59.999Z`) : new Date(value);
}

export function parseDateRange(from?: string, to?: string) {
  const gte = from ? new Date(`${from}T00:00:00.000Z`) : undefined;
  // Shift "to" to end of day so filtering is truly inclusive
  let lte: Date | undefined;
  if (to) {
    lte = new Date(`${to}T23:59:59.999Z`);
  }
  if (!gte && !lte) return undefined;
  return { gte, lte };
}
