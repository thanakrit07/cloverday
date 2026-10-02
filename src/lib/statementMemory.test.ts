import { describe, expect, it } from 'vitest'
import { compressMonths, coverageOf, describeCoverage, hintMap, rulesFromRows, safeFileName, type CounterpartyRow } from './statementMemory'

describe('coverage', () => {
  const file = (s: string, e: string) => ({ period_start: s, period_end: e })

  it('lists the months between the first and last statement that none covers', () => {
    const c = coverageOf([file('2025-12-02', '2026-06-30'), file('2026-09-01', '2026-09-23')])!
    expect(c).toMatchObject({ first: '2025-12', last: '2026-09', missing: ['2026-07', '2026-08'] })
    expect(describeCoverage(c)).toBe('Dec 2025 – Sep 2026 · missing Jul 2026 – Aug 2026')
  })

  it('has no gaps when files overlap or abut, and nothing to say with no dates', () => {
    expect(coverageOf([file('2026-01-01', '2026-02-10'), file('2026-02-01', '2026-03-31')])!.missing).toEqual([])
    expect(describeCoverage(coverageOf([file('2026-03-05', '2026-03-28')])!)).toBe('Mar 2026')
    expect(coverageOf([{ period_start: null, period_end: null }])).toBeNull()
  })

  it('names single missing months and runs separately, across a year end', () => {
    expect(compressMonths(['2025-11', '2025-12', '2026-01', '2026-04'])).toEqual(['Nov 2025 – Jan 2026', 'Apr 2026'])
  })
})

describe('rulesFromRows', () => {
  const names = {
    accounts: [{ id: 'a1', name: 'กสิกร' }],
    cards: [{ id: 'c1', name: 'KTC' }],
    members: [{ id: 'm1', display_name: 'Demo Partner' }],
    categories: [{ id: 'k1', name: 'Food' }],
  }
  const row = (over: Partial<CounterpartyRow>): CounterpartyRow => ({ id: 'x', name_key: 'demo', role: 'merchant', account_id: null, card_id: null, member_id: null, category_id: null, ...over })

  it('reads each role into the rule applyCounterparties takes', () => {
    const rules = rulesFromRows(
      [
        row({ name_key: 'a', role: 'own_account', card_id: 'c1' }),
        row({ name_key: 'b', role: 'member', member_id: 'm1' }),
        row({ name_key: 'c', role: 'merchant', category_id: 'k1' }),
        row({ name_key: 'd', role: 'own_account', account_id: 'gone' }),
      ],
      names,
    )
    expect(rules.get('a')).toEqual({ role: 'own_account', target: 'KTC' })
    expect(rules.get('b')).toEqual({ role: 'member', memberName: 'Demo Partner' })
    expect(rules.get('c')).toEqual({ role: 'merchant', category: 'Food' })
    expect(rules.has('d')).toBe(false) // its account no longer exists
  })
})

describe('hintMap', () => {
  it('suggests the category a description was most often given, and drops one that no longer exists', () => {
    const names: Record<string, string> = { k1: 'Food', k2: 'Other' }
    const map = hintMap(
      [
        { text_key: 'demo cafe', category_id: 'k2', uses: 1 },
        { text_key: 'demo cafe', category_id: 'k1', uses: 5 },
        { text_key: 'demo gone', category_id: 'k9', uses: 3 },
      ],
      (id) => names[id],
    )
    expect(map.get('demo cafe')).toBe('Food')
    expect(map.has('demo gone')).toBe(false)
  })
})

describe('safeFileName', () => {
  it('never keeps a card number from a file name', () => {
    expect(safeFileName('DEMO_202601_1234567890123456.pdf')).not.toMatch(/\d{12}/)
    expect(safeFileName('CardX_statement_April.pdf')).toBe('CardX_statement_April.pdf')
  })
})
