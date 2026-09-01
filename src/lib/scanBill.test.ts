import { describe, expect, it } from 'vitest'
import { toDraftLines, toIsoDate } from './scanBill'

// ADR-0017: the schema guarantees the response's shape, nothing guarantees its
// values. This is where a scan stops being trusted and starts being checked.
describe('toDraftLines', () => {
  const valid = new Set(['food', 'snacks', 'home'])

  it('puts the largest line in the remainder slot, which absorbs the OCR shortfall', () => {
    // 1240 + 320 + 240 = 1800 exactly here, but a slip with a discount line
    // would come up short — and the dialog derives the first line as
    // total-minus-the-rest, so the gap lands on the biggest line by itself.
    const lines = toDraftLines(
      {
        total: 1800,
        lines: [
          { category_id: 'snacks', amount: 320, items: ['มันฝรั่ง', 'ช็อกโกแลต'] },
          { category_id: 'food', amount: 1240, items: ['ผัก', 'หมู', 'ไข่'] },
          { category_id: 'home', amount: 240, items: ['กระทะ'] },
        ],
      },
      valid,
    )
    expect(lines).toEqual([
      { categoryId: 'food', amount: '', description: 'ผัก, หมู, ไข่' },
      { categoryId: 'snacks', amount: '320.00', description: 'มันฝรั่ง, ช็อกโกแลต' },
      { categoryId: 'home', amount: '240.00', description: 'กระทะ' },
    ])
  })

  it('blanks a category the household does not have rather than guessing a near match', () => {
    const lines = toDraftLines(
      {
        total: 500,
        lines: [
          { category_id: 'food', amount: 300, items: ['ผัก'] },
          { category_id: 'groceries', amount: 200, items: ['สบู่'] },
        ],
      },
      valid,
    )
    // Visible blank beats an invisible mistake — the household fills it in.
    expect(lines?.[1].categoryId).toBeNull()
  })

  it('keeps a null category through as a line to be filled, not a dropped item', () => {
    const lines = toDraftLines(
      {
        total: 500,
        lines: [
          { category_id: 'food', amount: 300, items: ['ผัก'] },
          { category_id: null, amount: 200, items: ['ของแปลก'] },
        ],
      },
      valid,
    )
    expect(lines).toHaveLength(2)
    expect(lines?.[1]).toEqual({ categoryId: null, amount: '200.00', description: 'ของแปลก' })
  })

  it('drops lines with no money in them', () => {
    const lines = toDraftLines(
      {
        total: 500,
        lines: [
          { category_id: 'food', amount: 300, items: ['ผัก'] },
          { category_id: 'snacks', amount: 200, items: ['ขนม'] },
          { category_id: 'home', amount: 0, items: ['ถุง'] },
          { category_id: 'home', amount: -50, items: ['ส่วนลด'] },
        ],
      },
      valid,
    )
    expect(lines).toHaveLength(2)
  })

  it('returns null when there is only one category — that is a transaction, not a receipt', () => {
    expect(
      toDraftLines({ total: 300, lines: [{ category_id: 'food', amount: 300, items: ['ผัก'] }] }, valid),
    ).toBeNull()
    expect(toDraftLines({ total: 300, lines: [] }, valid)).toBeNull()
  })

  it('never leaves the remainder line carrying a typed amount', () => {
    // The dialog derives index 0 and ignores whatever is in its amount field;
    // itemising all three would make the remainder zero and the split invalid.
    const lines = toDraftLines(
      {
        total: 900,
        lines: [
          { category_id: 'food', amount: 500, items: ['a'] },
          { category_id: 'snacks', amount: 400, items: ['b'] },
        ],
      },
      valid,
    )
    expect(lines?.[0].amount).toBe('')
    expect(lines?.slice(1).every((l) => l.amount !== '')).toBe(true)
  })

  it('rounds to satang rather than carrying float noise into the form', () => {
    const lines = toDraftLines(
      {
        total: 100,
        lines: [
          { category_id: 'food', amount: 66.666, items: ['a'] },
          { category_id: 'snacks', amount: 33.334, items: ['b'] },
        ],
      },
      valid,
    )
    expect(lines?.[1].amount).toBe('33.33')
  })
})

describe('toIsoDate', () => {
  it('takes a date the slip actually showed', () => {
    expect(toIsoDate('2026-08-31')).toBe('2026-08-31')
  })

  it('returns null rather than inventing one, so the form falls back to today', () => {
    expect(toIsoDate('')).toBeNull()
    expect(toIsoDate('31/08/2026')).toBeNull()
    expect(toIsoDate('unknown')).toBeNull()
  })
})
