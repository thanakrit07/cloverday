// KTC: purchase dd/mm/yy · posting dd/mm/yy · description · amount, a credit
// marked "- " before the amount. An installment line starts its description
// with "k/total"; its interest line carries "INTnn.nn%".
import { isoDate, money, periodOf } from './dates'
import type { Parser, StatementLine, Unreadable } from './types'

const STARTS_LIKE_LINE = /^\d{1,2}\/\d{1,2}\/\d{2} \d{1,2}\/\d{1,2}\/\d{2} /
const LINE = /^(\d{1,2})\/(\d{1,2})\/(\d{2}) (\d{1,2})\/(\d{1,2})\/(\d{2}) (.+?) (-\s*)?([\d,]+\.\d{2})$/
const MARKER = /^(\d{2})\/(\d{2}) /

export const parseKtc: Parser = (rawLines) => {
  const lines: StatementLine[] = []
  const unreadable: Unreadable[] = []
  rawLines.forEach((raw, i) => {
    const text = raw.trim()
    const m = LINE.exec(text)
    if (!m) {
      if (STARTS_LIKE_LINE.test(text)) unreadable.push({ line: i + 1, text, reason: 'Looks like a transaction but has no amount at the end' })
      return
    }
    const date = isoDate(2000 + Number(m[3]), Number(m[2]), Number(m[1]))
    const posted = isoDate(2000 + Number(m[6]), Number(m[5]), Number(m[4]))
    const amount = money(m[9])
    if (!date || !posted || amount === null) {
      unreadable.push({ line: i + 1, text, reason: 'Date or amount is not valid' })
      return
    }
    const desc = m[7]
    const marker = MARKER.exec(desc)
    lines.push({
      line: i + 1,
      date,
      postedDate: posted,
      amount,
      direction: m[8] ? 'credit' : 'debit',
      text: desc,
      installment: marker && Number(marker[1]) <= Number(marker[2]) ? { k: Number(marker[1]), total: Number(marker[2]) } : null,
      isInterest: /INT\d/.test(desc),
    })
  })
  if (lines.length === 0) return null
  return { layout: 'ktc', lines, unreadable, ...periodOf(lines.map((l) => l.date)) }
}
