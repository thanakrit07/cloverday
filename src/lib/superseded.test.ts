import { describe, expect, it } from 'vitest'
import { candidatesFor, type SupersededCandidate } from './superseded'

const row = (id: string, date: string, amount: number): SupersededCandidate => ({ id, date, amount, description: 'DEMO SHOP', note: null })

describe('candidatesFor', () => {
  const orphan = { date: '2026-09-23', amount: 3500 }

  it('keeps expenses of exactly that amount, earlier than the credit, nearest first', () => {
    const rows = [row('old', '2026-07-01', 3500), row('near', '2026-09-02', 3500), row('later', '2026-09-24', 3500), row('other', '2026-09-02', 3499.99)]
    expect(candidatesFor(orphan, rows).map((r) => r.id)).toEqual(['near', 'old'])
  })

  it('does not reach back past the lookback window', () => {
    expect(candidatesFor(orphan, [row('ancient', '2026-01-01', 3500)])).toEqual([])
  })

  it('tolerates a float that is a cent-fraction off', () => {
    expect(candidatesFor(orphan, [row('x', '2026-09-01', 3500.001)])).toHaveLength(1)
  })
})
