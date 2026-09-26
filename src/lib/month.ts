import { addMonths, endOfMonth, format, getDay, getDaysInMonth, parse, startOfMonth } from 'date-fns'

const MONTH_KEY = 'yyyy-MM'

// ADR-0005: years are displayed as Buddhist Era, in full ("2569", never "69" —
// that reads as 1969 once the month name is in English). This is a display
// conversion only — every stored or exchanged date stays Gregorian.
export function toBuddhistYear(ceYear: number): number {
  return ceYear + 543
}

export function currentMonthKey(): string {
  return format(new Date(), MONTH_KEY)
}

export function shiftMonth(monthKey: string, delta: number): string {
  return format(addMonths(parse(monthKey, MONTH_KEY, new Date()), delta), MONTH_KEY)
}

export function monthLabel(monthKey: string): string {
  const date = parse(monthKey, MONTH_KEY, new Date())
  return `${format(date, 'MMMM')} ${toBuddhistYear(date.getFullYear())}`
}

// "20 Jul" — for compact date and billing-cycle range labels.
export function dayMonthLabel(date: string): string {
  return format(parse(date, 'yyyy-MM-dd', new Date()), 'd MMM')
}

// "20 Jul 2569" — for dates that can't assume the current year, like a
// review row generated ahead of schedule.
export function fullDateLabel(date: string): string {
  const parsed = parse(date, 'yyyy-MM-dd', new Date())
  return `${format(parsed, 'd MMM')} ${toBuddhistYear(parsed.getFullYear())}`
}

// "20" and "Mon" — the two halves of a day-group header in the ledger.
export function dayOfMonthLabel(date: string): string {
  return format(parse(date, 'yyyy-MM-dd', new Date()), 'd')
}

export function weekdayLabel(date: string): string {
  return format(parse(date, 'yyyy-MM-dd', new Date()), 'EEE')
}

// Records' Monthly tab: a year-at-a-time rollup, one row per calendar
// month. Deliberately reuses `month` (e.g. "2026-07") as the source of
// truth for which year is showing — stepping by 12 months keeps the
// month-of-year fixed, so switching back to Daily lands on the same month
// you were on before opening Monthly, with no separate year state to keep
// in sync.
export function yearOfMonth(monthKey: string): string {
  return monthKey.slice(0, 4)
}

export function yearLabel(year: string): string {
  return String(toBuddhistYear(Number(year)))
}

export function yearRange(year: string): { start: string; end: string } {
  return { start: `${year}-01-01`, end: `${year}-12-31` }
}

// Newest month first, matching the ledger's own newest-first ordering
// elsewhere in Records.
export function monthsOfYear(year: string): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(12 - i).padStart(2, '0')}`)
}

// "Dec" — the row label in the Monthly list (monthLabel's "December 2569"
// is too wide once every month of the year is on screen at once).
export function monthShortLabel(monthKey: string): string {
  return format(parse(monthKey, MONTH_KEY, new Date()), 'MMM')
}

// "01/12 ~ 31/12" — the date span under a Monthly row's short label.
export function monthDayRangeLabel(monthKey: string): string {
  const { start, end } = monthRange(monthKey)
  const fmt = (d: string) => format(parse(d, 'yyyy-MM-dd', new Date()), 'dd/MM')
  return `${fmt(start)} ~ ${fmt(end)}`
}

// Records' Calendar tab (2026-09): the month's days laid out as a
// Sun-first grid, `null` for the leading/trailing blanks so every real day
// lands in its correct weekday column. Always a multiple of 7 long.
export function calendarCells(monthKey: string): (string | null)[] {
  const date = parse(monthKey, MONTH_KEY, new Date())
  const leadingBlanks = getDay(startOfMonth(date))
  const daysInMonth = getDaysInMonth(date)
  const cells: (string | null)[] = Array(leadingBlanks).fill(null)
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(format(new Date(date.getFullYear(), date.getMonth(), day), 'yyyy-MM-dd'))
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

// Inclusive [start, end] plain-date range for the month, for querying
// transactions.date (DESIGN.md §4.3 — dates are always Asia/Bangkok).
export function monthRange(monthKey: string): { start: string; end: string } {
  const date = parse(monthKey, MONTH_KEY, new Date())
  return {
    start: format(startOfMonth(date), 'yyyy-MM-dd'),
    end: format(endOfMonth(date), 'yyyy-MM-dd'),
  }
}

// Wide enough to hold every real row (anchor dates in the past) and every
// installment period already posted ahead (ADR-0001 — years, not months).
// A shared literal, not just a shared shape: every screen that fetches "the
// whole ledger" keys `useTransactions` on this exact object, so they all
// share one cached request instead of each firing its own.
export const ALL_TIME = { start: '2000-01-01', end: '2100-01-01' }
