import { describe, expect, it } from 'vitest'
import { parseCardx } from './cardx'
import { parseStatement } from './detect'
import { parseKbank } from './kbank'
import { parseKtc } from './ktc'
import { parseUob } from './uob'

// Every line below is invented.
const ASOF = '2026-09-27'

describe('parseCardx', () => {
  const lines = [
    '23/09/26 1,000.00 100.00 13/10/26',
    'PREVIOUS BALANCE 7,000.00',
    '24/08 24/08 Cash Adv Fee 936.25',
    '28/12 27/12 DEMO CAFE BANGKOK THA 120.00',
    '01/09 01/09 Payment received from Easy App -8,000.00',
    '23/09 23/09 DEMO SHOP BANGKOK 003/006 588.00',
    '23/09 23/09 IPP Interest 003/006 26.13',
    '24/08 25/08 DEMO LINE WITH NO AMOUNT',
    'TOTAL BALANCE 30,913.53',
  ]

  it('reads the year from the closing date: a month after the closing month is last year', () => {
    const r = parseCardx(lines, ASOF)!
    const cafe = r.lines.find((l) => l.text.startsWith('DEMO CAFE'))!
    expect(cafe).toMatchObject({ date: '2025-12-27', postedDate: '2025-12-28', amount: 120, direction: 'debit' })
    expect(r.lines.find((l) => l.text === 'Cash Adv Fee')).toMatchObject({ date: '2026-08-24', amount: 936.25 })
  })

  it('reads credits, installment markers and interest', () => {
    const r = parseCardx(lines, ASOF)!
    expect(r.lines.find((l) => l.text.startsWith('Payment received'))).toMatchObject({ direction: 'credit', amount: 8000 })
    expect(r.lines.find((l) => l.text.startsWith('DEMO SHOP'))!.installment).toEqual({ k: 3, total: 6 })
    expect(r.lines.find((l) => l.text.startsWith('IPP Interest'))).toMatchObject({ isInterest: true, installment: { k: 3, total: 6 } })
  })

  it('reports a transaction-looking line it cannot read, and ignores boilerplate', () => {
    const r = parseCardx(lines, ASOF)!
    expect(r.unreadable).toHaveLength(1)
    expect(r.unreadable[0]).toMatchObject({ line: 8, reason: expect.stringContaining('no amount') })
  })

  it('is not this layout when nothing reads', () => {
    expect(parseCardx(['hello', 'world'], ASOF)).toBeNull()
  })
})

describe('parseKtc', () => {
  const lines = [
    '03/08/26 04/08/26 Payment-KBANK Mobile - 21,918.36',
    '20/07/26 21/07/26 DEMO TOLL BANGKOK 62.00',
    '02/01/26 02/01/26 02/06 DEMO TRAVEL FD Internet 1,420.11',
    '02/01/26 02/01/26 02/06 DEMO TRAVEL FD I INT00.74% 63.05',
    '26/01/26 26/01/26 TRANSFER TO FLEXI DEMO JEANS - 2,980.00',
    '01/02/26 02/02/26 DEMO LINE WITH NO AMOUNT',
  ]
  it('reads purchase and posting dates, credits, markers and interest', () => {
    const r = parseKtc(lines, ASOF)!
    expect(r.lines[0]).toMatchObject({ date: '2026-08-03', postedDate: '2026-08-04', amount: 21918.36, direction: 'credit' })
    expect(r.lines[1]).toMatchObject({ direction: 'debit', installment: null })
    expect(r.lines[2].installment).toEqual({ k: 2, total: 6 })
    expect(r.lines[3]).toMatchObject({ isInterest: true, installment: { k: 2, total: 6 } })
    expect(r.unreadable).toHaveLength(1)
  })
})

describe('parseUob', () => {
  it('infers the year from today, so December in January is last year', () => {
    const lines = ['02 JAN 30 DEC DEMO GYM BANGKOK 690.00', '03 JAN 02 JAN PAYMENT THANK YOU - UOBT TMRW APP 14,000.00 CR', '04 JAN 03 JAN DEMO A 1.00']
    const r = parseUob(lines, '2026-01-05')!
    expect(r.lines[0]).toMatchObject({ date: '2025-12-30', postedDate: '2026-01-02', amount: 690, direction: 'debit' })
    expect(r.lines[1]).toMatchObject({ direction: 'credit', amount: 14000 })
  })
  it('does not read a month that is not one', () => {
    const r = parseUob(['02 XYZ 30 DEC DEMO 1.00'], ASOF)
    expect(r).toBeNull()
  })
})

describe('parseKbank', () => {
  const lines = [
    '01-04-26 ยอดยกมา 1,000.00',
    '01-04-26 09:10 ชำระเงิน 60.00 940.00 DEMO QR เพื่อชำระ Ref X0000 CAFE DEMO',
    '01-04-26 12:44 รับโอนเงิน 500.00 1,440.00 K PLUS จาก X1111 DEMO PERSON',
    '02-04-26 ยอดยกมา 1,440.00 02-04-26 10:00 โอนเงิน 40.00 1,400.00 K PLUS โอนไป X2222 DEMO PERSON',
    '03-04-26 11:00 โอนเงิน 10.00 5,000.00 K PLUS โอนไป X3333 DEMO PERSON',
    '04-04-26 11:00 โอนเงิน 10.00',
  ]
  it('takes the direction from the balance and reads a row sharing a line with the carried balance', () => {
    const r = parseKbank(lines, ASOF)!
    expect(r.lines.map((l) => [l.direction, l.amount])).toEqual([['debit', 60], ['credit', 500], ['debit', 40]])
    expect(r.lines[0].text).toContain('ชำระเงิน')
    expect(r.periodStart).toBe('2026-04-01')
  })
  it('refuses a row whose balance does not follow, and one without amount and balance', () => {
    const r = parseKbank(lines, ASOF)!
    expect(r.unreadable.map((u) => u.line)).toEqual([5, 6])
    expect(r.unreadable[0].reason).toContain('balance')
  })
  it('refuses a row whose type word and balance disagree', () => {
    const r = parseKbank(['01-04-26 ยอดยกมา 100.00', '01-04-26 09:00 รับโอนเงิน 10.00 90.00 K PLUS จาก X1 A'], ASOF)
    expect(r).toBeNull()
  })
})

describe('parseStatement', () => {
  it('picks the layout that reads the most lines', () => {
    const uob = ['02 SEP 02 SEP A 1.00', '03 SEP 03 SEP B 2.00', '04 SEP 04 SEP C 3.00']
    expect(parseStatement(uob, ASOF)?.layout).toBe('uob')
    const ktc = ['03/08/26 04/08/26 A 1.00', '03/08/26 04/08/26 B 2.00', '03/08/26 04/08/26 C 3.00']
    expect(parseStatement(ktc, ASOF)?.layout).toBe('ktc')
  })
  it('says not supported rather than guessing', () => {
    expect(parseStatement(['02 SEP 02 SEP A 1.00', 'something else'], ASOF)).toBeNull()
    expect(parseStatement(['totally', 'unknown'], ASOF)).toBeNull()
  })
})
