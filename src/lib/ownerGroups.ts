// Balances' "All" view: accounts and cards grouped by whose they are, the
// signed-in person first and the other members after, in the household's own
// member order. Instruments with no owner are the Common Pot (D18) and are not
// grouped here. An owner who is no longer a member still gets their group, last,
// so nothing silently disappears from the screen.
export interface OwnerGroup<T> {
  ownerId: string
  items: T[]
}

export function groupByOwner<T extends { owner_id: string | null }>(items: T[], memberIds: string[], selfId: string): OwnerGroup<T>[] {
  const order = [selfId, ...memberIds.filter((id) => id !== selfId)]
  const owned = items.filter((i) => i.owner_id !== null)
  const strangers = [...new Set(owned.map((i) => i.owner_id!))].filter((id) => !order.includes(id))
  return [...order, ...strangers]
    .map((ownerId) => ({ ownerId, items: owned.filter((i) => i.owner_id === ownerId) }))
    .filter((g) => g.items.length > 0)
}
