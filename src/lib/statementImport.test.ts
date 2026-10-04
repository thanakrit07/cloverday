import { describe, expect, it } from 'vitest'
import { applyCounterparties, buildStatementRows, NEEDS_PLAN, normalizeStatementText, type CounterpartyRule, type StatementContext } from './statementImport'

const ctx = (existing: StatementContext['existing'] = []): StatementContext => ({
  accounts: [{ id: 'acc-kbank', name: 'กสิกร' }],
  cards: [{ id: 'card-ktc', name: 'KTC' }],
  categories: [
    { id: 'cat-food', name: 'Food', kind: 'expense', archived: false, system: false },
    { id: 'cat-food-old', name: 'Food', kind: 'expense', archived: true, system: false },
    { id: 'cat-other', name: 'Other', kind: 'expense', archived: false, system: false },
    { id: 'cat-refund', name: 'Refund', kind: 'income', archived: false, system: false },
  ],
  existing,
})

const row = (o: Record<string, string> = {}) => ({
  Date: '05/09/2026',
  Kind: 'expense',
  Amount: '120.00',
  Category: 'Food',
  'Account or card': 'KTC',
  'To account or card': '',
  Note: 'CAFE AMAZON',
  Details: '',
  Owner: '',
  ...o,
})

describe('buildStatementRows', () => {
  it('gives the same line the same key, and a second identical line its own', () => {
    const a = buildStatementRows([row(), row()], ctx())
    const b = buildStatementRows([row()], ctx())
    expect(a[0].sourceKey).toBe(b[0].sourceKey)
    expect(a[1].sourceKey).not.toBe(a[0].sourceKey)
    expect(a.map((r) => r.status)).toEqual(['new', 'new'])
  })

  it('marks a line already in the database as imported, whatever file it came from', () => {
    const [first] = buildStatementRows([row()], ctx())
    const existing = [{ id: 't1', date: '2026-09-05', amount: 120, source: 'import' as const, source_key: first.sourceKey, from_account_id: null, from_card_id: 'card-ktc' }]
    expect(buildStatementRows([row()], ctx(existing))[0].status).toBe('imported')
  })

  it('suggests a hand-entered row on the same card, same amount, within three days — once', () => {
    const manual = { id: 'm1', date: '2026-09-03', amount: 120, source: 'manual' as const, source_key: null, from_account_id: null, from_card_id: 'card-ktc' }
    const rows = buildStatementRows([row(), row()], ctx([manual]))
    expect(rows[0]).toMatchObject({ status: 'match', matchId: 'm1' })
    expect(rows[1].status).toBe('new')
    const far = { ...manual, date: '2026-09-01' }
    expect(buildStatementRows([row()], ctx([far]))[0].status).toBe('new')
  })

  it('sends "Other" to review, and refuses what it can’t import', () => {
    const rows = buildStatementRows(
      [row({ Category: 'Other' }), row({ Amount: '-74.45' }), row({ Details: NEEDS_PLAN }), row({ 'Account or card': 'SCB' })],
      ctx(),
    )
    expect(rows.map((r) => r.status)).toEqual(['review', 'error', 'error', 'error'])
    expect(rows[2].issue).toContain('create the plan')
  })

  it('ignores archived categories of the same name and reads the posting date', () => {
    const [r] = buildStatementRows([row({ 'Posted date': '06/09/2026' })], ctx())
    expect(r).toMatchObject({ categoryId: 'cat-food', date: '2026-09-05', postedDate: '2026-09-06' })
  })

  it('keys a transfer by both ends and needs no category', () => {
    const [r] = buildStatementRows([row({ Kind: 'transfer', Category: '', 'Account or card': 'กสิกร', 'To account or card': 'KTC' })], ctx())
    expect(r).toMatchObject({ status: 'new', fromAccountId: 'acc-kbank', toCardId: 'card-ktc', categoryId: null })
    expect(r.sourceKey).toContain('acc-kbank>card-ktc')
  })
})

describe('the file a line came from', () => {
  it('is read from the File column and empty for a CSV without one', () => {
    expect(buildStatementRows([row({ File: 'demo.pdf' })], ctx())[0].file).toBe('demo.pdf')
    expect(buildStatementRows([row()], ctx())[0].file).toBe('')
  })
})

describe('normalizeStatementText', () => {
  it('collapses whitespace, trims and lower-cases, the same as v_category_hints', () => {
    expect(normalizeStatementText('  DEMO  Cafe\tBANGKOK \n')).toBe('demo cafe bangkok')
    expect(normalizeStatementText('ร้าน   ทดสอบ')).toBe('ร้าน ทดสอบ')
  })
})

describe('line keys stay put when the app learns something', () => {
  it('keys a line by the statement it came from, so reclassifying it does not change the key', () => {
    const asExpense = buildStatementRows([row({ Statement: 'KTC' })], ctx())[0]
    const asRefunded = buildStatementRows([row({ Statement: 'KTC', Kind: 'income', Category: 'Refund' })], ctx())[0]
    expect(asExpense.sourceKey.split(':').slice(0, 3)).toEqual(asRefunded.sourceKey.split(':').slice(0, 3))
    // ...and a card payment recorded from a bank's side or the card's is one line of that card's statement
    const viaBank = buildStatementRows([row({ Statement: 'KTC', 'Account or card': 'กสิกร' })], ctx())[0]
    const viaCard = buildStatementRows([row({ Statement: 'KTC', 'Account or card': 'KTC' })], ctx())[0]
    expect(viaBank.sourceKey).toBe(viaCard.sourceKey)
  })

  it('keys a transfer by its two ends and day, so both statements describing it make one', () => {
    const fromBank = buildStatementRows([row({ Kind: 'transfer', Category: '', Statement: 'กสิกร', 'Account or card': 'กสิกร', 'To account or card': 'KTC', Note: 'โอนเงิน K PLUS ชำระ' })], ctx())[0]
    const fromCard = buildStatementRows([row({ Kind: 'transfer', Category: '', Statement: 'KTC', 'Account or card': 'กสิกร', 'To account or card': 'KTC', Note: 'Payment-KBANK Mobile' })], ctx())[0]
    expect(fromBank.sourceKey).toBe(fromCard.sourceKey)
  })
})

describe('applyCounterparties', () => {
  const memory = new Map<string, CounterpartyRule>([
    ['demo person a', { role: 'own_account', target: 'KTC' }],
    ['demo person b', { role: 'member', memberName: 'Demo Partner' }],
    ['demo shop', { role: 'merchant', category: 'Food' }],
  ])
  const rec = (over: Record<string, string>) => ({ Kind: 'expense', Category: 'Other', 'Account or card': 'กสิกร', 'To account or card': '', Owner: '', Counterparty: '', ...over })

  it('turns money sent to or received from the household\'s own account into a transfer', () => {
    const [out, inn] = applyCounterparties([rec({ Counterparty: 'DEMO  Person A' }), rec({ Kind: 'income', Counterparty: 'demo person a' })], memory)
    expect(out).toMatchObject({ Kind: 'transfer', Category: '', 'Account or card': 'กสิกร', 'To account or card': 'KTC' })
    expect(inn).toMatchObject({ Kind: 'transfer', 'Account or card': 'KTC', 'To account or card': 'กสิกร' })
  })

  it('sets who bears a family member\'s expense, and a merchant\'s category', () => {
    const [member, merchant, unknown] = applyCounterparties([rec({ Counterparty: 'Demo Person B' }), rec({ Counterparty: 'Demo Shop' }), rec({ Counterparty: 'Nobody Known' })], memory)
    expect(member.Owner).toBe('Demo Partner')
    expect(merchant.Category).toBe('Food')
    expect(unknown).toEqual(rec({ Counterparty: 'Nobody Known' }))
  })

  it('keeps the same rows in the same order, and leaves transfers alone', () => {
    const input = [rec({ Kind: 'transfer', Counterparty: 'demo person a' }), rec({ Counterparty: '' })]
    expect(applyCounterparties(input, memory)).toEqual(input)
  })
})
