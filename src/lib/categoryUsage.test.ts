import { describe, expect, it } from 'vitest'
import { toMaps, type CategoryUsageData } from './categoryUsage'

// Regression: this query's data used to be built as Maps inside the queryFn.
// React Query persists query data to localStorage as JSON, and a Map
// stringifies to `{}` — so after any reload the rehydrated value had no
// entries and no `.get`, and the transaction sheet crashed with
// "lastInstrument.get is not a function". The queryFn now returns plain objects and
// the Maps are rebuilt per observer by `select`.
describe('category usage data', () => {
  const sample: CategoryUsageData = {
    lastInstrument: { 'cat-food': { accountId: null, cardId: 'card-ktc' } },
  }

  it('survives a JSON round-trip, which is what persistence does to it', () => {
    expect(JSON.parse(JSON.stringify(sample))).toEqual(sample)
  })

  it('rebuilds working Maps from round-tripped data', () => {
    const restored = toMaps(JSON.parse(JSON.stringify(sample)) as CategoryUsageData)
    expect(restored.lastInstrument.get('cat-food')).toEqual({ accountId: null, cardId: 'card-ktc' })
  })

  it('returns empty Maps rather than throwing when there is no usage yet', () => {
    const empty = toMaps({ lastInstrument: {} })
    expect(empty.lastInstrument.size).toBe(0)
    expect(empty.lastInstrument.get('anything')).toBeUndefined()
  })

  it('a Map would NOT have survived — the shape this guards against', () => {
    const asMap = new Map([['cat-food', 12]])
    expect(JSON.parse(JSON.stringify(asMap))).toEqual({})
  })
})
