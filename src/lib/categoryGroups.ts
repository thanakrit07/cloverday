// Categories as the pickers should show them: each Main with its Subs under it,
// in the household's own order, so a Sub is never listed without saying whose it is.
export interface CategoryLike {
  id: string
  name: string
  kind: 'income' | 'expense'
  parent_id: string | null
  sort_order: number
}

export interface CategoryGroup<C extends CategoryLike> {
  main: C
  subs: C[]
}

const byOrder = <C extends CategoryLike>(a: C, b: C) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
// Spending first, then income, so a list of both reads as two blocks.
const kindRank = (c: CategoryLike) => (c.kind === 'expense' ? 0 : 1)
const byKindThenOrder = <C extends CategoryLike>(a: C, b: C) => kindRank(a) - kindRank(b) || byOrder(a, b)

export function categoryGroups<C extends CategoryLike>(categories: C[], kind?: 'income' | 'expense'): CategoryGroup<C>[] {
  const wanted = kind ? categories.filter((c) => c.kind === kind) : categories
  const ids = new Set(wanted.map((c) => c.id))
  // A Sub whose Main isn't among the choices (archived, say) is still a choice, listed on its own.
  const mains = wanted.filter((c) => c.parent_id === null || !ids.has(c.parent_id)).sort(byKindThenOrder)
  return mains.map((main) => ({ main, subs: wanted.filter((c) => c.parent_id === main.id).sort(byOrder) }))
}

/** "Food" for a Main, "Food/Lunch" for a Sub: the form the rest of the app writes it in. */
export function categoryLabel<C extends CategoryLike>(category: C, group: CategoryGroup<C>): string {
  return category.id === group.main.id ? category.name : `${group.main.name}/${category.name}`
}
