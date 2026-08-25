import { describe, expect, it } from 'vitest'
import { formatPeriodLabel, installmentPeriodLabel, type LabelledPlan } from './installmentLabel'
import { toPlanMap } from './installments'

// ADR-0016: the label is composed from the plan and the row's source_key, so
// renaming a plan changes every period on the next render with nothing written.
describe('installmentPeriodLabel', () => {
  const plans = new Map<string, LabelledPlan>([['inst-1', { name: 'Notebook', total_periods: 10 }]])
  const period = { source: 'installment', source_key: 'installment:inst-1:4' }

  it('composes the plan name with the period the row is for', () => {
    expect(installmentPeriodLabel(period, plans)).toBe('Notebook (งวดที่ 4/10)')
  })

  it('follows a rename with no write, which is the whole point', () => {
    const renamed = new Map<string, LabelledPlan>([['inst-1', { name: 'MacBook', total_periods: 10 }]])
    expect(installmentPeriodLabel(period, renamed)).toBe('MacBook (งวดที่ 4/10)')
  })

  it('labels a period of a deleted plan, whose transactions outlive it (D15)', () => {
    // The lookup reads the base table for exactly this: a settled period stays
    // in the ledger when its plan is deleted, and must keep its description.
    expect(installmentPeriodLabel(period, plans)).toBe('Notebook (งวดที่ 4/10)')
  })

  it('returns null for an ordinary transaction', () => {
    expect(installmentPeriodLabel({ source: 'manual', source_key: null }, plans)).toBeNull()
    expect(installmentPeriodLabel({ source: 'recurring', source_key: 'recurring:r-1:2026-08-01' }, plans)).toBeNull()
  })

  it('returns null rather than half a label when the plan is missing', () => {
    // The caller falls back to the row's note or category; a label reading
    // "undefined (งวดที่ 4/10)" would be worse than no label at all.
    expect(installmentPeriodLabel(period, new Map())).toBeNull()
  })

  it('returns null when the source_key is not a period key', () => {
    expect(installmentPeriodLabel({ source: 'installment', source_key: 'import:transactions:3' }, plans)).toBeNull()
    expect(installmentPeriodLabel({ source: 'installment', source_key: null }, plans)).toBeNull()
  })
})

describe('toPlanMap', () => {
  it('rebuilds a working Map from data that has been through JSON', () => {
    // Same persistence trap as usePostedPeriods: a Map stringifies to {}.
    const data = { 'inst-1': { name: 'Notebook', total_periods: 10 } }
    const restored = toPlanMap(JSON.parse(JSON.stringify(data)))
    expect(restored.get('inst-1')?.name).toBe('Notebook')
  })
})

describe('formatPeriodLabel', () => {
  it('is the one place the label template lives', () => {
    expect(formatPeriodLabel('ค่าทำฟัน', 1, 10)).toBe('ค่าทำฟัน (งวดที่ 1/10)')
  })
})
