import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FullScreenPage } from '@/components/FullScreenPage'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { useAccounts } from '@/lib/accounts'
import { CategoryIcon } from '@/lib/categoryIcons'
import { useCategories, type Category, type CategoryKind } from '@/lib/categories'
import { useCards } from '@/lib/cards'
import { ALL_RECORDS_FILTERS, type RecordsFilterState } from '@/lib/recordsFilter'
import { useHousehold } from '@/lib/HouseholdContext'
import { cn } from '@/lib/utils'

interface Props {
  filter: RecordsFilterState
  onApply: (next: RecordsFilterState) => void
  onClose: () => void
}

// A category or instrument id set, initialised to "every id that exists
// today" when the incoming filter says "no restriction" (null) — the
// screen's own checkboxes have to start somewhere ticked, and "everything"
// is what null actually means. A restricted filter is intersected with
// what's live now, so a stale id from an old shared link (an
// since-archived/deleted category) simply isn't checkable rather than
// crashing or silently reappearing as "selected".
function initialSelection(ids: string[] | null, universe: string[]): Set<string> {
  if (ids == null) return new Set(universe)
  const live = new Set(universe)
  return new Set(ids.filter((id) => live.has(id)))
}

function CategoryTab({
  kind,
  categories,
  selected,
  onChange,
}: {
  kind: CategoryKind
  categories: Category[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const [expandedMainId, setExpandedMainId] = useState<string | null>(null)
  const mains = useMemo(() => categories.filter((c) => c.kind === kind && !c.parent_id), [categories, kind])
  const subsByMain = useMemo(() => {
    const map = new Map<string, Category[]>()
    for (const c of categories) {
      if (c.kind !== kind || !c.parent_id) continue
      map.set(c.parent_id, [...(map.get(c.parent_id) ?? []), c])
    }
    return map
  }, [categories, kind])
  const allIds = useMemo(() => categories.filter((c) => c.kind === kind).map((c) => c.id), [categories, kind])

  function setChecked(ids: string[], checked: boolean) {
    const next = new Set(selected)
    for (const id of ids) {
      if (checked) next.add(id)
      else next.delete(id)
    }
    onChange(next)
  }

  const allChecked = allIds.length > 0 && allIds.every((id) => selected.has(id))

  return (
    <ul className="space-y-1">
      <li className="flex items-center gap-2.5 rounded-lg px-2 py-2">
        <Checkbox checked={allChecked} onCheckedChange={(c) => setChecked(allIds, c === true)} />
        <span className="text-sm font-medium">All</span>
      </li>
      {mains.map((main) => {
        const subs = subsByMain.get(main.id) ?? []
        const groupIds = [main.id, ...subs.map((s) => s.id)]
        const checkedCount = groupIds.filter((id) => selected.has(id)).length
        const state: boolean | 'indeterminate' =
          checkedCount === 0 ? false : checkedCount === groupIds.length ? true : 'indeterminate'
        const isExpanded = expandedMainId === main.id
        return (
          <li key={main.id}>
            <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
              <Checkbox checked={state} onCheckedChange={(c) => setChecked(groupIds, c !== false)} />
              <CategoryIcon icon={main.icon} color={main.color} className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-sm">{main.name}</span>
              {subs.length > 0 && (
                <button
                  type="button"
                  onClick={() => setExpandedMainId(isExpanded ? null : main.id)}
                  className="shrink-0 p-1 text-muted-foreground"
                  aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${main.name}`}
                >
                  <ChevronRight className={cn('size-4 transition-transform', isExpanded && 'rotate-90')} />
                </button>
              )}
            </div>
            {isExpanded && subs.length > 0 && (
              <ul className="ml-4 space-y-1 border-l pl-3">
                {subs.map((sub) => (
                  <li key={sub.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                    <Checkbox
                      checked={selected.has(sub.id)}
                      onCheckedChange={(c) => setChecked([sub.id], c === true)}
                    />
                    <CategoryIcon icon={sub.icon} color={sub.color} className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate text-sm">{sub.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function AccountTab({
  accounts,
  cards,
  selectedInstruments,
  onInstrumentsChange,
  includeTransfers,
  onIncludeTransfersChange,
  includeUncategorized,
  onIncludeUncategorizedChange,
}: {
  accounts: { id: string; name: string }[]
  cards: { id: string; name: string }[]
  selectedInstruments: Set<string>
  onInstrumentsChange: (next: Set<string>) => void
  includeTransfers: boolean
  onIncludeTransfersChange: (next: boolean) => void
  includeUncategorized: boolean
  onIncludeUncategorizedChange: (next: boolean) => void
}) {
  const allIds = useMemo(() => [...accounts, ...cards].map((i) => i.id), [accounts, cards])
  const allChecked = allIds.length > 0 && allIds.every((id) => selectedInstruments.has(id))

  function toggle(id: string, checked: boolean) {
    const next = new Set(selectedInstruments)
    if (checked) next.add(id)
    else next.delete(id)
    onInstrumentsChange(next)
  }

  function toggleAll(checked: boolean) {
    onInstrumentsChange(checked ? new Set(allIds) : new Set())
  }

  return (
    <div className="space-y-4">
      {/* Transfers and uncategorized rows have no category and no place in
          the Income/Exp tabs at all — they live here instead, next to the
          instrument they're otherwise scoped by (Q19). */}
      <ul className="space-y-1">
        <li className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <Checkbox checked={includeTransfers} onCheckedChange={(c) => onIncludeTransfersChange(c === true)} />
          <span className="flex-1 text-sm">Transfers</span>
        </li>
        <li className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <Checkbox
            checked={includeUncategorized}
            onCheckedChange={(c) => onIncludeUncategorizedChange(c === true)}
          />
          <span className="flex-1 text-sm">Uncategorized</span>
        </li>
      </ul>

      <ul className="space-y-1">
        <li className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <Checkbox checked={allChecked} onCheckedChange={(c) => toggleAll(c === true)} />
          <span className="text-sm font-medium">All accounts &amp; cards</span>
        </li>
      </ul>

      {accounts.length > 0 && (
        <div>
          <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Accounts</p>
          <ul className="space-y-1">
            {accounts.map((a) => (
              <li key={a.id} className="flex items-center gap-2.5 rounded-lg px-2 py-2">
                <Checkbox checked={selectedInstruments.has(a.id)} onCheckedChange={(c) => toggle(a.id, c === true)} />
                <span className="flex-1 truncate text-sm">{a.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {cards.length > 0 && (
        <div>
          <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Card</p>
          <ul className="space-y-1">
            {cards.map((c) => (
              <li key={c.id} className="flex items-center gap-2.5 rounded-lg px-2 py-2">
                <Checkbox checked={selectedInstruments.has(c.id)} onCheckedChange={(checked) => toggle(c.id, checked === true)} />
                <span className="flex-1 truncate text-sm">{c.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// The Filter screen (grilling session, 2026-09): Income/Exp/Account tabs,
// tree checkboxes for categories, plain checkboxes for accounts/cards. An
// explicit Apply/Cancel rather than live-applying — every tick would
// otherwise push a URL history entry (useUrlState batches per action, not
// per keystroke-equivalent), so Back would have to be pressed once per
// checkbox instead of once for the whole edit.
export function RecordsFilterSheet({ filter, onApply, onClose }: Props) {
  const { householdId } = useHousehold()
  const isDesktop = useIsDesktop()
  const { data: categories } = useCategories(householdId)
  const { data: accounts } = useAccounts(householdId)
  const { data: cards } = useCards(householdId)

  const liveCategories = useMemo(() => (categories ?? []).filter((c) => !c.archived && !c.system), [categories])
  const liveAccounts = useMemo(() => (accounts ?? []).filter((a) => !a.archived), [accounts])
  const liveCards = useMemo(() => (cards ?? []).filter((c) => !c.archived), [cards])

  const allCategoryIds = useMemo(() => liveCategories.map((c) => c.id), [liveCategories])
  const allInstrumentIds = useMemo(
    () => [...liveAccounts.map((a) => a.id), ...liveCards.map((c) => c.id)],
    [liveAccounts, liveCards],
  )

  const [categoryIds, setCategoryIds] = useState(() => initialSelection(filter.categoryIds, allCategoryIds))
  const [instrumentIds, setInstrumentIds] = useState(() => initialSelection(filter.instrumentIds, allInstrumentIds))
  const [includeTransfers, setIncludeTransfers] = useState(filter.includeTransfers)
  const [includeUncategorized, setIncludeUncategorized] = useState(filter.includeUncategorized)

  function handleApply() {
    onApply({
      categoryIds: categoryIds.size >= allCategoryIds.length ? null : [...categoryIds],
      instrumentIds: instrumentIds.size >= allInstrumentIds.length ? null : [...instrumentIds],
      includeTransfers,
      includeUncategorized,
    })
  }

  function handleReset() {
    setCategoryIds(new Set(allCategoryIds))
    setInstrumentIds(new Set(allInstrumentIds))
    setIncludeTransfers(true)
    setIncludeUncategorized(true)
  }

  const body = (
    <Tabs defaultValue="expense" className="flex h-full min-h-0 flex-col">
      <TabsList className="mx-4 mt-2">
        <TabsTrigger value="income">Income</TabsTrigger>
        <TabsTrigger value="expense">Exp.</TabsTrigger>
        <TabsTrigger value="account">Account</TabsTrigger>
      </TabsList>
      <div className="flex-1 overflow-y-auto p-4">
        <TabsContent value="income">
          <CategoryTab kind="income" categories={liveCategories} selected={categoryIds} onChange={setCategoryIds} />
        </TabsContent>
        <TabsContent value="expense">
          <CategoryTab kind="expense" categories={liveCategories} selected={categoryIds} onChange={setCategoryIds} />
        </TabsContent>
        <TabsContent value="account">
          <AccountTab
            accounts={liveAccounts}
            cards={liveCards}
            selectedInstruments={instrumentIds}
            onInstrumentsChange={setInstrumentIds}
            includeTransfers={includeTransfers}
            onIncludeTransfersChange={setIncludeTransfers}
            includeUncategorized={includeUncategorized}
            onIncludeUncategorizedChange={setIncludeUncategorized}
          />
        </TabsContent>
      </div>
    </Tabs>
  )

  if (isDesktop) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="flex h-[32rem] max-h-[80vh] flex-col p-0 sm:max-w-md">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>Filter</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1">{body}</div>
          <DialogFooter className="mx-0 mb-0 rounded-b-xl">
            <Button variant="ghost" onClick={handleReset}>
              Reset
            </Button>
            <Button onClick={handleApply}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <FullScreenPage
      title="Filter"
      onClose={onClose}
      headerActions={
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={handleReset}>
            Reset
          </Button>
          <Button size="sm" onClick={handleApply}>
            Filter
          </Button>
        </div>
      }
    >
      {body}
    </FullScreenPage>
  )
}

export { ALL_RECORDS_FILTERS }
