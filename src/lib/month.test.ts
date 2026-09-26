import { describe, expect, it } from 'vitest'
import { calendarCells, monthDayRangeLabel, monthShortLabel, monthsOfYear, yearLabel, yearOfMonth, yearRange } from './month'

describe('Monthly tab helpers', () => {
  it('reads the year out of a month key', () => {
    expect(yearOfMonth('2026-07')).toBe('2026')
  })

  it('formats a year as Buddhist Era, full four digits', () => {
    expect(yearLabel('2026')).toBe('2569')
  })

  it('spans a calendar year for querying transactions.date', () => {
    expect(yearRange('2026')).toEqual({ start: '2026-01-01', end: '2026-12-31' })
  })

  it('lists all 12 months of a year, newest first', () => {
    expect(monthsOfYear('2026')).toEqual([
      '2026-12',
      '2026-11',
      '2026-10',
      '2026-09',
      '2026-08',
      '2026-07',
      '2026-06',
      '2026-05',
      '2026-04',
      '2026-03',
      '2026-02',
      '2026-01',
    ])
  })

  it('gives a 3-letter month label for the Monthly row', () => {
    expect(monthShortLabel('2026-12')).toBe('Dec')
  })

  it('gives a DD/MM ~ DD/MM span for the Monthly row', () => {
    expect(monthDayRangeLabel('2026-12')).toBe('01/12 ~ 31/12')
    expect(monthDayRangeLabel('2026-02')).toBe('01/02 ~ 28/02')
  })
})

describe('Calendar tab grid', () => {
  it('is always a multiple of 7 cells long', () => {
    for (const month of ['2026-01', '2026-02', '2026-07', '2026-12']) {
      expect(calendarCells(month).length % 7).toBe(0)
    }
  })

  it('places every real day of the month, in order, with no gaps between them', () => {
    const cells = calendarCells('2026-07')
    const days = cells.filter((c): c is string => c != null)
    expect(days).toEqual(Array.from({ length: 31 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`))
  })

  it('pads the first day of the month into its correct Sun-first weekday column', () => {
    // 1 Jul 2026 is a Wednesday: 3 blank leading cells (Sun, Mon, Tue).
    const cells = calendarCells('2026-07')
    expect(cells.slice(0, 3)).toEqual([null, null, null])
    expect(cells[3]).toBe('2026-07-01')
  })

  it('handles a leap-year February (29 days)', () => {
    const cells = calendarCells('2028-02')
    const days = cells.filter((c): c is string => c != null)
    expect(days).toHaveLength(29)
    expect(days[days.length - 1]).toBe('2028-02-29')
  })
})
