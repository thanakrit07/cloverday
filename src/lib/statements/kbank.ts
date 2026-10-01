// KBank account: dd-mm-yy hh:mm · type · amount · balance · channel and detail.
// Which way the money moved comes from the balance (the previous balance less
// this amount, or plus it), with the type word as the fallback for a
// statement's first row; if the two disagree the line is unreadable rather
// than guessed. A page begins with a "ยอดยกมา" (carried forward) balance, which
// restarts the running balance and sometimes shares a line with the first row.
import { isoDate, money, periodOf } from './dates'
import type { Parser, StatementLine, Unreadable } from './types'

const STARTS_LIKE_LINE = /^\d{2}-\d{2}-\d{2} \d{2}:\d{2} /
const LINE = /^(\d{2})-(\d{2})-(\d{2}) \d{2}:\d{2} (\S+) ([\d,]+\.\d{2}) ([\d,]+\.\d{2}) (.*)$/
const CARRIED = /^(\d{2})-(\d{2})-(\d{2}) ยอดยกมา ([\d,]+\.\d{2})(?: (.*))?$/

const cents = (n: number) => Math.round(n * 100)

export const parseKbank: Parser = (rawLines) => {
  const lines: StatementLine[] = []
  const unreadable: Unreadable[] = []
  let balance: number | null = null
  // The carried-forward date opens the statement's period even when the first
  // row falls days later, which matters for deciding what a card's payment line
  // duplicates.
  const carriedDates: string[] = []

  rawLines.forEach((raw, i) => {
    let text = raw.trim()
    const carried = CARRIED.exec(text)
    if (carried) {
      balance = money(carried[4])
      const opened = isoDate(2000 + Number(carried[3]), Number(carried[2]), Number(carried[1]))
      if (opened) carriedDates.push(opened)
      if (!carried[5]) return
      text = carried[5]
    }
    const m = LINE.exec(text)
    if (!m) {
      if (STARTS_LIKE_LINE.test(text)) unreadable.push({ line: i + 1, text, reason: 'Looks like a transaction but does not have amount and balance' })
      return
    }
    const date = isoDate(2000 + Number(m[3]), Number(m[2]), Number(m[1]))
    const amount = money(m[5])
    const after = money(m[6])
    if (!date || amount === null || after === null) {
      unreadable.push({ line: i + 1, text, reason: 'Date or amount is not valid' })
      return
    }
    const byType: 'debit' | 'credit' = m[4].startsWith('รับ') || m[4].startsWith('ฝาก') ? 'credit' : 'debit'
    let direction = byType
    if (balance !== null) {
      const down = cents(balance) - cents(amount) === cents(after)
      const up = cents(balance) + cents(amount) === cents(after)
      if (!down && !up) {
        unreadable.push({ line: i + 1, text, reason: 'The balance does not follow from the previous one' })
        balance = after
        return
      }
      direction = down ? 'debit' : 'credit'
      if (direction !== byType) {
        unreadable.push({ line: i + 1, text, reason: 'The type word and the balance disagree about the direction' })
        balance = after
        return
      }
    }
    balance = after
    lines.push({
      line: i + 1,
      date,
      postedDate: null,
      amount,
      direction,
      text: `${m[4]} ${m[7]}`.trim(),
      installment: null,
      isInterest: false,
    })
  })
  if (lines.length === 0) return null
  return { layout: 'kbank', lines, unreadable, ...periodOf([...carriedDates, ...lines.map((l) => l.date)]) }
}
