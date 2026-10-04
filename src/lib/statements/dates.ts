import { addDays } from '../finance/billingCycle'

export function isoDate(y: number, m: number, d: number): string | null {
  const t = new Date(Date.UTC(y, m - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** "1,234.56" -> 1234.56, through integer cents so nothing drifts. Null if it isn't money. */
export function money(s: string): number | null {
  const m = /^(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/.exec(s.trim())
  if (!m) return null
  return (Number(m[1].replace(/,/g, '')) * 100 + Number(m[2])) / 100
}

/**
 * A day and month with no year: the latest year that doesn't put it in the
 * future. A week of slack, since a statement can be read the day after it
 * closes. ponytail: gives the wrong year for a statement read more than a
 * year after it was issued; bank statements carry no year on card lines, so
 * the closing date is used instead wherever a layout prints one.
 */
export function inferYear(month: number, day: number, asOf: string): number {
  const asOfYear = Number(asOf.slice(0, 4))
  const thisYear = isoDate(asOfYear, month, day)
  return thisYear !== null && thisYear <= addDays(asOf, 7) ? asOfYear : asOfYear - 1
}

export function periodOf(dates: string[]): { periodStart: string | null; periodEnd: string | null } {
  if (dates.length === 0) return { periodStart: null, periodEnd: null }
  const sorted = [...dates].sort()
  return { periodStart: sorted[0], periodEnd: sorted[sorted.length - 1] }
}
