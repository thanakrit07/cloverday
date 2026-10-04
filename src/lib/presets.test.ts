import { describe, expect, it } from 'vitest'
import { suggestPresets, type HistoryRow } from './presets'

function row(over: Partial<HistoryRow>): HistoryRow {
  return { kind: 'expense', category_id: 'cat-coffee', note: 'Coffee', amount: 65, from_account_id: null, from_card_id: 'card-a', ...over }
}

describe('suggestPresets', () => {
  it('needs three of the same category and note, ignoring case and spaces', () => {
    const rows = [row({ note: 'Coffee' }), row({ note: ' coffee ' })]
    expect(suggestPresets(rows, [])).toEqual([])
    expect(suggestPresets([...rows, row({ note: 'COFFEE' })], [])).toHaveLength(1)
  })

  it('takes the newest instrument, and the amount only when it never varied', () => {
    const same = suggestPresets([row({ from_card_id: 'card-new' }), row({}), row({})], [])[0]
    expect(same).toMatchObject({ card_id: 'card-new', amount: 65, name: 'Coffee', note: 'Coffee' })

    const varied = suggestPresets([row({}), row({ amount: 80 }), row({})], [])[0]
    expect(varied.amount).toBeNull()
  })

  it('skips what is already a preset, and transfers', () => {
    const rows = [row({}), row({}), row({})]
    expect(suggestPresets(rows, [{ category_id: 'cat-coffee', note: 'coffee' }])).toEqual([])
    expect(suggestPresets(rows.map((r) => ({ ...r, kind: 'transfer' })), [])).toEqual([])
  })

  it('orders by how often, and stops at five', () => {
    const rows: HistoryRow[] = []
    for (let n = 0; n < 7; n++) for (let i = 0; i < 3 + n; i++) rows.push(row({ category_id: `cat-${n}` }))
    const out = suggestPresets(rows, [])
    expect(out.map((p) => p.category_id)).toEqual(['cat-6', 'cat-5', 'cat-4', 'cat-3', 'cat-2'])
  })
})
