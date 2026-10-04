// CardX and SpeedyCash share one layout. A card line is
//   posting dd/mm · purchase dd/mm · description · [foreign amount] · baht
// with no year; the page's "dd/mm/yy total minimum dd/mm/yy" line carries the
// closing date, which is what the year is read from.
import { inferYear, isoDate, money, periodOf } from './dates'
import type { Parser, StatementLine, Unreadable } from './types'

const CLOSING = /^(\d{2})\/(\d{2})\/(\d{2}) [\d,]+\.\d{2} [\d,]+\.\d{2} \d{2}\/\d{2}\/\d{2}$/
const STARTS_LIKE_LINE = /^\d{2}\/\d{2} \d{2}\/\d{2} /
const LINE = /^(\d{2})\/(\d{2}) (\d{2})\/(\d{2}) (.+?) (-?[\d,]+\.\d{2})$/
const MARKER = /(?:^| )(\d{3})\/(\d{3})$/

export const parseCardx: Parser = (rawLines, asOf) => {
  const closing = rawLines.map((l) => CLOSING.exec(l.trim())).find(Boolean)
  const closingMonth = closing ? Number(closing[2]) : null
  const closingYear = closing ? 2000 + Number(closing[3]) : null
  const yearOf = (month: number, day: number) =>
    closingMonth !== null && closingYear !== null ? (month > closingMonth ? closingYear - 1 : closingYear) : inferYear(month, day, asOf)

  const lines: StatementLine[] = []
  const unreadable: Unreadable[] = []
  rawLines.forEach((raw, i) => {
    const text = raw.trim()
    const m = LINE.exec(text)
    if (!m) {
      if (STARTS_LIKE_LINE.test(text)) unreadable.push({ line: i + 1, text, reason: 'Looks like a transaction but has no amount at the end' })
      return
    }
    const [, pd, pm, td, tm, desc, amountText] = m
    const posted = isoDate(yearOf(Number(pm), Number(pd)), Number(pm), Number(pd))
    const date = isoDate(yearOf(Number(tm), Number(td)), Number(tm), Number(td))
    const amount = money(amountText.replace('-', ''))
    if (!posted || !date || amount === null) {
      unreadable.push({ line: i + 1, text, reason: 'Date or amount is not valid' })
      return
    }
    const marker = MARKER.exec(desc)
    lines.push({
      line: i + 1,
      date,
      postedDate: posted,
      amount,
      direction: amountText.startsWith('-') ? 'credit' : 'debit',
      text: desc,
      installment: marker ? { k: Number(marker[1]), total: Number(marker[2]) } : null,
      isInterest: /IPP Interest/i.test(desc),
    })
  })
  if (lines.length === 0) return null
  return { layout: 'cardx', lines, unreadable, ...periodOf(lines.map((l) => l.date)) }
}
