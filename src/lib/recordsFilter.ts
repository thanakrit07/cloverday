import type { Transaction } from './transactions'

// Records' Filter screen (as distinct from the month/person chips AppShell
// already owns): which categories, accounts/cards, transfers and
// uncategorised rows show up. `null` on either id list means "no
// restriction" rather than "match nothing" — the screen's own checkboxes
// start fully ticked, and ticking everything back on collapses to this same
// "no filter" shape instead of an explicit list of every id that exists
// today (which would silently stop matching a category created tomorrow).
export interface RecordsFilterState {
  /** Leaf category ids (a Main or a Sub — either can be a transaction's own
   *  category_id) allowed to match. */
  categoryIds: string[] | null
  /** Account and card ids allowed to match, merged into one list since a
   *  transaction can only ever touch one or the other on a given side and
   *  the two id spaces never collide. */
  instrumentIds: string[] | null
  includeTransfers: boolean
  includeUncategorized: boolean
}

export const ALL_RECORDS_FILTERS: RecordsFilterState = {
  categoryIds: null,
  instrumentIds: null,
  includeTransfers: true,
  includeUncategorized: true,
}

export function isRecordsFilterActive(filter: RecordsFilterState): boolean {
  return (
    filter.categoryIds != null ||
    filter.instrumentIds != null ||
    !filter.includeTransfers ||
    !filter.includeUncategorized
  )
}

type FilterableTransaction = Pick<
  Transaction,
  'kind' | 'category_id' | 'from_account_id' | 'to_account_id' | 'from_card_id' | 'to_card_id'
>

// Kind is never checked directly: a category already belongs to exactly one
// kind (categories.ts), so leaving every income category ticked and
// unticking every expense one already narrows to income-only — a separate
// Kind control would just be a second way to say the same thing.
export function matchesRecordsFilter(t: FilterableTransaction, filter: RecordsFilterState): boolean {
  if (filter.instrumentIds) {
    const ids = filter.instrumentIds
    const touches =
      (t.from_account_id != null && ids.includes(t.from_account_id)) ||
      (t.to_account_id != null && ids.includes(t.to_account_id)) ||
      (t.from_card_id != null && ids.includes(t.from_card_id)) ||
      (t.to_card_id != null && ids.includes(t.to_card_id))
    if (!touches) return false
  }

  if (t.kind === 'transfer') return filter.includeTransfers
  if (t.category_id == null) return filter.includeUncategorized
  if (filter.categoryIds && !filter.categoryIds.includes(t.category_id)) return false
  return true
}

// --- URL encoding -----------------------------------------------------
//
// Reuses `cat`/`acct` — declared in App.tsx but, as of this feature, never
// actually written to by anything else in the app (the tap-through flow
// they were built for was removed) — as comma-joined multi-value lists.
// `crd` is a different, already-live feature (a card's billing-cycle view)
// and is left alone; card ids from the Filter screen fold into `acct`
// alongside account ids.

function encodeIdList(ids: string[] | null): string {
  return ids ? ids.join(',') : ''
}

function decodeIdList(raw: string): string[] | null {
  if (!raw) return null
  const ids = raw.split(',').filter(Boolean)
  return ids.length > 0 ? ids : null
}

export interface RecordsFilterParams {
  cat: string
  acct: string
  xfer: string
  unc: string
}

export function encodeRecordsFilter(filter: RecordsFilterState): RecordsFilterParams {
  return {
    cat: encodeIdList(filter.categoryIds),
    acct: encodeIdList(filter.instrumentIds),
    xfer: filter.includeTransfers ? '' : '0',
    unc: filter.includeUncategorized ? '' : '0',
  }
}

export function decodeRecordsFilter(params: RecordsFilterParams): RecordsFilterState {
  return {
    categoryIds: decodeIdList(params.cat),
    instrumentIds: decodeIdList(params.acct),
    includeTransfers: params.xfer !== '0',
    includeUncategorized: params.unc !== '0',
  }
}

// One line for the summary strip that replaces the old per-filter chip row,
// e.g. "Food +2 more · KTC" or "No transfers". Empty when nothing is active
// (callers should hide the strip entirely in that case).
export function describeRecordsFilter(
  filter: RecordsFilterState,
  nameOf: { category: (id: string) => string | undefined; instrument: (id: string) => string | undefined },
): string {
  const parts: string[] = []

  if (filter.categoryIds) {
    const names = filter.categoryIds.map(nameOf.category).filter((n): n is string => n != null)
    if (names.length > 0) {
      parts.push(names.length === 1 ? names[0] : `${names[0]} +${names.length - 1} more`)
    }
  }
  if (filter.instrumentIds) {
    const names = filter.instrumentIds.map(nameOf.instrument).filter((n): n is string => n != null)
    if (names.length > 0) {
      parts.push(names.length === 1 ? names[0] : `${names[0]} +${names.length - 1} more`)
    }
  }
  if (!filter.includeTransfers) parts.push('No transfers')
  if (!filter.includeUncategorized) parts.push('No uncategorized')

  return parts.join(' · ')
}
