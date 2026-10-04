import { categoryGroups, categoryLabel, type CategoryLike } from '@/lib/categoryGroups'

// <option>s for a native <select>, grouped by Main: the group heading names the
// Main, its own entry comes first, and each Sub reads "Main/Sub", so whatever is
// selected says where it sits. Without `kind`, both kinds are listed and a
// group's heading says which.
export function CategoryOptions({ categories, kind }: { categories: CategoryLike[]; kind?: 'income' | 'expense' }) {
  return (
    <>
      {categoryGroups(categories, kind).map((g) => (
        <optgroup key={g.main.id} label={kind ? g.main.name : `${g.main.kind === 'income' ? 'Income' : 'Expense'} · ${g.main.name}`}>
          <option value={g.main.id}>{categoryLabel(g.main, g)}</option>
          {g.subs.map((s) => (
            <option key={s.id} value={s.id}>
              {categoryLabel(s, g)}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  )
}
