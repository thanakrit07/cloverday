// Kept (a savings account statement): one row is
//   dd/mm/yyyy hh:mm · type · detail · amount · balance · channel
// with the amount in whichever of the withdrawal or deposit columns it belongs
// to, so the text never says which: the running balance does. A row's detail
// carries on over the next lines (the name of whoever it went to, a reference),
// and every page ends with a four-line footer whose last line is "Page n / m".
// The year may be Buddhist (2569) or Gregorian; 2400 and over is Buddhist.
import { isoDate, money, periodOf } from './dates'
import type { Parser, StatementLine, Unreadable } from './types'

const ROW = /^(\d{2})\/(\d{2})\/(\d{4}) \d{2}:\d{2} (.+?) ([\d,]+\.\d{2}) ([\d,]+\.\d{2})(?: (\S.*))?$/
const STARTS_LIKE_ROW = /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2} /
const PERIOD = /^(\d{2})\/(\d{2})\/(\d{4}) - (\d{2})\/(\d{2})\/(\d{4})$/
const PREVIOUS = /^Previous balance ([\d,]+\.\d{2})$/i
const ENDING = /^\S+ balance [\d,]+\.\d{2}$/i
const PAGE_END = /\bPage \d+ \/ \d+\s*$/
const FOOTER_LINES = 4
const COLUMN_HEADS = (l: string) => /Withdrawal/i.test(l) && /Deposit/i.test(l) && /Balance/i.test(l)

const gregorian = (year: number) => (year >= 2400 ? year - 543 : year)
const cents = (n: number) => Math.round(n * 100)

export const parseKept: Parser = (rawLines) => {
  const lines: StatementLine[] = []
  const unreadable: Unreadable[] = []
  const periodDates: string[] = []

  // The footer's lines would otherwise read as more detail of the last row on the page.
  const footer = new Set<number>()
  rawLines.forEach((l, i) => {
    if (PAGE_END.test(l.trim())) for (let k = Math.max(0, i - FOOTER_LINES + 1); k <= i; k++) footer.add(k)
  })

  let balance: number | null = null
  let current: { line: number; date: string; amount: number; direction: 'debit' | 'credit'; parts: string[] } | null = null
  const finish = () => {
    if (current) {
      lines.push({
        line: current.line,
        date: current.date,
        postedDate: null,
        amount: current.amount,
        direction: current.direction,
        text: current.parts.join(' ').replace(/\s+/g, ' ').trim(),
        installment: null,
        isInterest: false,
      })
    }
    current = null
  }

  rawLines.forEach((raw, i) => {
    const text = raw.trim()
    if (footer.has(i)) return finish()
    const period = PERIOD.exec(text)
    if (period) {
      for (const [d, m, y] of [[period[1], period[2], period[3]], [period[4], period[5], period[6]]]) {
        const iso = isoDate(gregorian(Number(y)), Number(m), Number(d))
        if (iso) periodDates.push(iso)
      }
      return finish()
    }
    const previous = PREVIOUS.exec(text)
    if (previous) {
      finish()
      balance = money(previous[1])
      return
    }
    if (COLUMN_HEADS(text) || ENDING.test(text)) return finish()

    const m = ROW.exec(text)
    if (!m) {
      if (STARTS_LIKE_ROW.test(text)) {
        finish()
        unreadable.push({ line: i + 1, text, reason: 'Looks like a transaction but has no amount and balance' })
      } else if (current) current.parts.push(text)
      return
    }
    finish()
    const date = isoDate(gregorian(Number(m[3])), Number(m[2]), Number(m[1]))
    const amount = money(m[5])
    const after = money(m[6])
    if (!date || amount === null || after === null) {
      unreadable.push({ line: i + 1, text, reason: 'Date or amount is not valid' })
      return
    }
    const before = balance
    balance = after
    if (before === null) {
      unreadable.push({ line: i + 1, text, reason: 'There is no previous balance to tell which way the money moved' })
      return
    }
    const down = cents(before) - cents(amount) === cents(after)
    const up = cents(before) + cents(amount) === cents(after)
    if (!down && !up) {
      unreadable.push({ line: i + 1, text, reason: 'The balance does not follow from the previous one' })
      return
    }
    current = { line: i + 1, date, amount, direction: down ? 'debit' : 'credit', parts: [m[4], ...(m[7] ? [m[7]] : [])] }
  })
  finish()

  if (lines.length === 0) return null
  return { layout: 'kept', lines, unreadable, ...periodOf([...periodDates, ...lines.map((l) => l.date)]) }
}
