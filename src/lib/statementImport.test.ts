import { describe, expect, it } from 'vitest'
import { buildStatementRows, NEEDS_PLAN, type StatementContext } from './statementImport'

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
