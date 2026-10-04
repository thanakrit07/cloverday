import { describe, expect, it } from 'vitest'
import { parseStatement } from './detect'
import { parseKept } from './kept'
import { stageStatements } from './stage'
import { applyCounterparties } from '../statementImport'

// Every line, name and number below is invented; the layout is what a real Kept statement looks like.
const ASOF = '2026-10-01'
const head = ['DEMO ACCOUNT HEADER', '123-4-56789-0', '01/09/2569 - 30/09/2569', 'Date Time Transaction Withdrawal (THB) Deposit (THB) Balance (THB) Channel']
const footer = (page: string) => ['DEMO BANK NAME', 'DEMO COMPANY LTD', 'DEMO ADDRESS Bangkok 10000', `Tel 00-000-0000 | www.demo.example Page ${page}`]

const page1 = [
  ...head,
  'Previous balance 1,000.00',
  '02/09/2569 09:10 โอนเงินออก Kept Saving 100.00 900.00 Mobile',
  'KBANK 123-4-56789-0',
  'นาย ทดสอบ ตัวอย่าง',
  '03/09/2569 10:00 รับเงินเข้า Kept Saving 50.00 950.00 Mobile',
  ...footer('1 / 2'),
]
const page2 = [
  ...head,
  '04/09/2569 11:00 PromptPay to 081-234-5678 นาย 200.00 750.00 Mobile',
  '05/09/2569 11:30 ดอกเบี้ย Kept Saving 5.00 755.00 System',
  'Ending balance 755.00',
  'Total withdrawal 1 200.00',
  ...footer('2 / 2'),
]

describe('parseKept', () => {
  const r = parseKept([...page1, ...page2], ASOF)!

  it('reads Buddhist-era dates and the statement period', () => {
    expect(r.lines[0].date).toBe('2026-09-02')
    expect(r.periodStart).toBe('2026-09-01')
    expect(r.periodEnd).toBe('2026-09-30')
  })

  it('takes direction from the running balance, across a page break', () => {
    expect(r.lines.map((l) => [l.direction, l.amount])).toEqual([['debit', 100], ['credit', 50], ['debit', 200], ['credit', 5]])
    expect(r.unreadable).toEqual([])
  })

  it('folds a row\'s following lines into its text, but not the footer, the summary or the next page\'s header', () => {
    expect(r.lines[0].text).toContain('KBANK 123-4-56789-0')
    expect(r.lines[0].text).toContain('นาย ทดสอบ ตัวอย่าง')
    expect(r.lines[1].text).not.toMatch(/DEMO (BANK|COMPANY|ADDRESS)|Page/)
    expect(r.lines[3].text).not.toMatch(/Ending|Total|DEMO/)
  })

  it('reads Gregorian years too', () => {
    const lines = ['Previous balance 10.00', '02/09/2026 09:10 x 1.00 9.00 Mobile', '03/09/2026 09:10 y 1.00 8.00 Mobile', '04/09/2026 09:10 z 1.00 7.00 Mobile']
    expect(parseKept(lines, ASOF)!.lines[0].date).toBe('2026-09-02')
  })

  it('refuses a row whose balance does not follow, and a first row with no previous balance', () => {
    const broken = parseKept([...head, 'Previous balance 1,000.00', '02/09/2569 09:10 a 100.00 900.00 M', '03/09/2569 09:10 b 50.00 123.00 M', '04/09/2569 09:10 c 1.00 122.00 M', '05/09/2569 09:10 d 1.00 121.00 M'], ASOF)!
    expect(broken.unreadable).toHaveLength(1)
    expect(broken.unreadable[0].reason).toContain('balance')
    const none = parseKept([...head, '02/09/2569 09:10 a 100.00 900.00 M', '03/09/2569 09:10 b 50.00 850.00 M', '04/09/2569 09:10 c 1.00 849.00 M'], ASOF)!
    expect(none.unreadable[0].reason).toContain('previous balance')
    expect(none.lines.map((l) => l.direction)).toEqual(['debit', 'debit'])
  })

  it('is picked by the detector over the other layouts', () => {
    expect(parseStatement([...page1, ...page2], ASOF)?.layout).toBe('kept')
  })
})

describe('Kept in staging', () => {
  const kept = parseKept([...page1, ...page2], ASOF)!

  it('stages debits as expenses and credits as income, with the masked account as the counterparty', () => {
    const { rows } = stageStatements([{ instrument: 'Kept กาย', result: kept }], { plans: [], hints: new Map() })
    expect(rows.map((x) => [x.kind, x.amount, x.counterparty])).toEqual([
      ['expense', 100, 'KBANK 123-4-56789-0'],
      ['income', 50, null],
      ['expense', 200, '081-234-5678'],
      ['income', 5, null],
    ])
  })

  it('turns a payment to the household\'s own account into a transfer once that account is explained', () => {
    const { rows } = stageStatements([{ instrument: 'Kept กาย', result: kept }], { plans: [], hints: new Map() })
    const records = rows.map((x) => ({ Kind: x.kind, Category: x.category, 'Account or card': x.from, 'To account or card': x.to, Owner: '', Counterparty: x.counterparty ?? '' }))
    const out = applyCounterparties(records, new Map([['kbank 123-4-56789-0', { role: 'own_account' as const, target: 'กสิกร' }]]))
    expect(out[0]).toMatchObject({ Kind: 'transfer', 'Account or card': 'Kept กาย', 'To account or card': 'กสิกร' })
    expect(out[2].Kind).toBe('expense')
  })
})
