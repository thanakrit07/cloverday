import { describe, expect, it } from 'vitest'
import { groupByOwner } from './ownerGroups'

const item = (name: string, owner_id: string | null) => ({ name, owner_id })

describe('groupByOwner', () => {
  const items = [item('a1', 'mint'), item('a2', 'guy'), item('a3', 'mint'), item('pot', null), item('a4', 'guy')]

  it('puts the signed-in person first, then the other members, keeping each one\'s own order', () => {
    const groups = groupByOwner(items, ['mint', 'guy'], 'guy')
    expect(groups.map((g) => g.ownerId)).toEqual(['guy', 'mint'])
    expect(groups[0].items.map((i) => i.name)).toEqual(['a2', 'a4'])
    expect(groups[1].items.map((i) => i.name)).toEqual(['a1', 'a3'])
  })

  it('leaves the common pot out, and members with nothing out', () => {
    const groups = groupByOwner([item('pot', null), item('x', 'mint')], ['guy', 'mint'], 'guy')
    expect(groups.map((g) => g.ownerId)).toEqual(['mint'])
    expect(groupByOwner([item('pot', null)], ['guy'], 'guy')).toEqual([])
  })

  it('still shows an owner who is no longer a member, last', () => {
    const groups = groupByOwner([item('x', 'gone'), item('y', 'guy')], ['guy', 'mint'], 'guy')
    expect(groups.map((g) => g.ownerId)).toEqual(['guy', 'gone'])
  })
})
