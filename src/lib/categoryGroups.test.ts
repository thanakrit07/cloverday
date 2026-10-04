import { describe, expect, it } from 'vitest'
import { categoryGroups, categoryLabel, type CategoryLike } from './categoryGroups'

const cat = (id: string, name: string, kind: 'income' | 'expense', parent_id: string | null, sort_order: number): CategoryLike => ({ id, name, kind, parent_id, sort_order })

const all = [
  cat('food', 'Food', 'expense', null, 1),
  cat('lunch', 'Lunch', 'expense', 'food', 2),
  cat('coffee', 'Coffee', 'expense', 'food', 1),
  cat('travel', 'Travel', 'expense', null, 0),
  cat('salary', 'Salary', 'income', null, 0),
  cat('base', 'Base pay', 'income', 'salary', 0),
]

describe('categoryGroups', () => {
  it('lists each Main with its Subs, both in the household\'s order', () => {
    const groups = categoryGroups(all, 'expense')
    expect(groups.map((g) => g.main.name)).toEqual(['Travel', 'Food'])
    expect(groups[1].subs.map((s) => s.name)).toEqual(['Coffee', 'Lunch'])
  })

  it('keeps the two kinds apart when asked, and together when not', () => {
    expect(categoryGroups(all, 'income').map((g) => g.main.name)).toEqual(['Salary'])
    expect(categoryGroups(all).map((g) => g.main.name)).toEqual(['Travel', 'Food', 'Salary']) // spending first, then income
  })

  it('still offers a Sub whose Main is not among the choices', () => {
    const groups = categoryGroups(all.filter((c) => c.id !== 'food'), 'expense')
    expect(groups.map((g) => g.main.name)).toContain('Lunch')
  })

  it('writes a Main as its name and a Sub as Main/Sub', () => {
    const g = categoryGroups(all, 'expense')[1]
    expect(categoryLabel(g.main, g)).toBe('Food')
    expect(categoryLabel(g.subs[1], g)).toBe('Food/Lunch')
  })
})
