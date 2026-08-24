import { describe, expect, it } from 'vitest'
import { isGeneratedPeriodNote, periodNote, periodsToRename, type PostedPeriodNote } from './installmentMaterialiser'

// D15 as amended in v4.3: a plan is still immutable in every way that involves
// money, but its *name* propagates to the periods already posted — and only to
// the ones still carrying a label this app wrote.
describe('periodsToRename', () => {
  const id = 'inst-1'
  const rows = (): PostedPeriodNote[] => [
    { id: 'txn-1', source_key: `installment:${id}:1`, note: periodNote('Notebook', 1, 3) },
    { id: 'txn-2', source_key: `installment:${id}:2`, note: periodNote('Notebook', 2, 3) },
    { id: 'txn-3', source_key: `installment:${id}:3`, note: periodNote('Notebook', 3, 3) },
  ]

  it('rewrites every period, settled or not — the ledger cannot hold two names for one debt', () => {
    expect(periodsToRename(rows(), id, { name: 'MacBook', totalPeriods: 3 })).toEqual([
      { id: 'txn-1', note: 'MacBook (งวดที่ 1/3)' },
      { id: 'txn-2', note: 'MacBook (งวดที่ 2/3)' },
      { id: 'txn-3', note: 'MacBook (งวดที่ 3/3)' },
    ])
  })

  // The bug this rewrite exists for. These plans were renamed before the
  // feature shipped, so their periods carry a name the plan no longer holds;
  // the first version compared against the *current* name, matched nothing,
  // and left them permanently unrepairable.
  it('repairs a plan whose periods drifted under a name it no longer has', () => {
    const drifted: PostedPeriodNote[] = [
      { id: 'txn-1', source_key: `installment:${id}:1`, note: 'Deejung Transfer (6 งวด x 1715.56) (งวดที่ 1/6)' },
      { id: 'txn-2', source_key: `installment:${id}:2`, note: 'Deejung Transfer (6 งวด x 1715.56) (งวดที่ 2/6)' },
    ]
    expect(periodsToRename(drifted, id, { name: 'กดเงินสด 10k', totalPeriods: 6 })).toEqual([
      { id: 'txn-1', note: 'กดเงินสด 10k (งวดที่ 1/6)' },
      { id: 'txn-2', note: 'กดเงินสด 10k (งวดที่ 2/6)' },
    ])
  })

  it('leaves a hand-written note alone, which is the whole guard', () => {
    const withEdit = rows()
    withEdit[1] = { ...withEdit[1], note: 'Notebook — the one I returned' }
    expect(periodsToRename(withEdit, id, { name: 'MacBook', totalPeriods: 3 }).map((u) => u.id)).toEqual([
      'txn-1',
      'txn-3',
    ])
  })

  it('carries a changed period count into the label', () => {
    expect(periodsToRename(rows(), id, { name: 'MacBook', totalPeriods: 5 }).map((u) => u.note)).toEqual([
      'MacBook (งวดที่ 1/5)',
      'MacBook (งวดที่ 2/5)',
      'MacBook (งวดที่ 3/5)',
    ])
  })

  it('never touches another plan sharing the same query result', () => {
    const mixed = [...rows(), { id: 'txn-x', source_key: 'installment:inst-2:1', note: periodNote('Notebook', 1, 3) }]
    expect(periodsToRename(mixed, id, { name: 'MacBook', totalPeriods: 3 }).some((u) => u.id === 'txn-x')).toBe(false)
  })

  it('skips rows that already read correctly, so a no-op save writes nothing', () => {
    expect(periodsToRename(rows(), id, { name: 'Notebook', totalPeriods: 3 })).toEqual([])
  })

  it('ignores a row with no installment source_key rather than throwing', () => {
    const odd: PostedPeriodNote[] = [{ id: 'txn-9', source_key: null, note: 'whatever' }]
    expect(periodsToRename(odd, id, { name: 'MacBook', totalPeriods: 3 })).toEqual([])
  })
})

describe('isGeneratedPeriodNote', () => {
  it('accepts a label this app wrote, whatever name it was written under', () => {
    expect(isGeneratedPeriodNote('Anything at all (งวดที่ 4/10)', 4)).toBe(true)
  })

  it('rejects a label whose period disagrees with the row it is on', () => {
    // A coincidence would fail here: the number in the text has to be the
    // number in the source_key.
    expect(isGeneratedPeriodNote(periodNote('Notebook', 4, 10), 5)).toBe(false)
  })

  it('rejects a note that only mentions a period in passing', () => {
    expect(isGeneratedPeriodNote('จ่าย (งวดที่ 1/6) ไปแล้วเมื่อวาน', 1)).toBe(false)
    expect(isGeneratedPeriodNote('Notebook', 1)).toBe(false)
    expect(isGeneratedPeriodNote(null, 1)).toBe(false)
  })
})
