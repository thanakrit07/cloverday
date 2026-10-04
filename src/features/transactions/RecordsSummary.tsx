import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { CategoryIcon } from '@/lib/categoryIcons'
import { CATEGORY_COLORS, effectiveMainId, useCategories, type Category } from '@/lib/categories'
import type { Card } from '@/lib/cards'
import { addDays, cycleFetchRange, cycleOf, inCycle, type Cycle } from '@/lib/finance/billingCycle'
import { useHousehold } from '@/lib/HouseholdContext'
import { borneAmount, matchesPersonFilter, sharesByTransaction, type PersonFilter } from '@/lib/filters'
import { formatBaht } from '@/lib/format'
import { monthLabel, monthRange, shiftMonth } from '@/lib/month'
import { matchesRecordsFilter, type RecordsFilterState } from '@/lib/recordsFilter'
import { useTransactionShares } from '@/lib/transactionShares'
import { useTransactions } from '@/lib/transactions'
import { cn } from '@/lib/utils'
import { CardCycleSummary } from './CardCycleSummary'

interface MainRow {
  main: Category
  total: number
  subs: { category: Category; total: number }[]
}

// A category's colour, as spent by the donut — falls back to the palette
// (by rank, not id, so it's stable within one render but not a permanent
// per-category assignment) when the category itself has none set. This is
// the single source for that fallback: the donut's ring and the list row
// right next to it both call this, so a slice's colour and its row's dot
// are guaranteed to be the same value, never two independent computations
// that happen to agree.
function categoryColor(row: MainRow, index: number): string {
  return row.main.color ?? CATEGORY_COLORS[index % CATEGORY_COLORS.length]
}

// F (redesign plan): a category donut, CSS conic-gradient rather than a
// charting library — the prototype's own read was that the simple case
// needs no dependency, and a ring is exactly that case. Reuses
// categoryRows/categoryTotal, so it's always in sync with the list it sits
// inside. No separate legend: a colour that isn't on `category.color`
// exists nowhere else in the app, so the only trustworthy legend is the
// list itself, sitting right underneath and carrying the matching dot.
function CategoryDonut({ rows, total }: { rows: MainRow[]; total: number }) {
  const stops = useMemo(() => {
    if (total <= 0) return []
    let cursor = 0
    return rows.map((row, i) => {
      const pct = (row.total / total) * 100
      const start = cursor
      cursor += pct
      return { color: categoryColor(row, i), start, end: cursor }
    })
  }, [rows, total])

  if (stops.length === 0) return null

  const gradient = stops.map((s) => `${s.color} ${s.start}% ${s.end}%`).join(', ')

  return (
    <div className="flex items-center justify-center py-2">
      <div className="relative size-28 shrink-0 rounded-full" style={{ background: `conic-gradient(${gradient})` }}>
        <div className="absolute inset-3 flex flex-col items-center justify-center rounded-full bg-card text-center">
          <span className="text-[10px] text-muted-foreground">Spent</span>
          <span className="text-sm font-semibold">{formatBaht(total)}</span>
        </div>
      </div>
    </div>
  )
}

const TREND_MONTHS = 6

// F: a month trend, so "is this month normal" has an answer without
// tapping back through five months by hand. Net (income − expense), not
// separate bars — the sign is the thing worth seeing at a glance, and the
// gap-shows-the-story approach already works for CardForecastTab's
// Posted/Projected split.
function MonthTrendChart({ householdId, month, person }: { householdId: string; month: string; person: PersonFilter }) {
  const trendRange = useMemo(() => {
    const firstMonth = shiftMonth(month, -(TREND_MONTHS - 1))
    return { start: monthRange(firstMonth).start, end: monthRange(month).end }
  }, [month])
  const { data: transactions } = useTransactions(householdId, trendRange)
  const { data: categories } = useCategories(householdId)
  const { data: shares } = useTransactionShares(householdId)

  const months = useMemo(() => {
    return Array.from({ length: TREND_MONTHS }, (_, i) => shiftMonth(month, -(TREND_MONTHS - 1 - i)))
  }, [month])

  const rows = useMemo(() => {
    const categoryById = new Map((categories ?? []).map((c) => [c.id, c]))
    const sharesByTxn = sharesByTransaction(shares)
    const netByMonth = new Map<string, number>()
    for (const t of transactions ?? []) {
      if (!t.confirmed || categoryById.get(t.category_id ?? '')?.system) continue
      if (!matchesPersonFilter(t, sharesByTxn, person)) continue
      if (t.kind === 'transfer') continue
      const key = t.date.slice(0, 7)
      const amount = person === 'all' ? t.amount : borneAmount(t, sharesByTxn, person)
      const signed = t.kind === 'income' ? amount : -amount
      netByMonth.set(key, (netByMonth.get(key) ?? 0) + signed)
    }
    return months.map((m) => ({ month: m, net: netByMonth.get(m) ?? 0 }))
  }, [transactions, categories, shares, person, months])

  const peak = Math.max(...rows.map((r) => Math.abs(r.net)), 1)

  return (
    <div className="flex items-end justify-between gap-2 px-1 pb-1" style={{ height: '4.5rem' }}>
      {rows.map((row) => {
        const heightPct = Math.max(4, (Math.abs(row.net) / peak) * 100)
        const isCurrent = row.month === month
        return (
          <div key={row.month} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-12 w-full items-end justify-center">
              <div
                className={cn('w-full max-w-6 rounded-t-sm', row.net >= 0 ? 'bg-good' : 'bg-destructive', isCurrent && 'opacity-100', !isCurrent && 'opacity-60')}
                style={{ height: `${heightPct}%` }}
                title={`${monthLabel(row.month)}: ${formatBaht(row.net)}`}
              />
            </div>
            <span className={cn('text-[10px]', isCurrent ? 'font-medium text-foreground' : 'text-muted-foreground')}>
              {monthLabel(row.month).slice(0, 3)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

interface Props {
  month: string
  person: PersonFilter
  // A card's natural period is its billing cycle, not the calendar month
  // (§7.3 v3.8) — when set, this overrides `month` and swaps the usual
  // In/Out headline for CardCycleSummary's bill total.
  card?: Card | null
  cardCycle?: Cycle | null
  filter: RecordsFilterState
}

// Records' month summary + category rollup (DESIGN §7.1 v3.5), extracted so
// it can render inline above the ledger on mobile or in AppShell's desktop
// summary column — same component, two hosts (App.tsx picks which one).
// Self-contained: fetches and derives from `month`/`person`/`card`/`cardCycle`
// on its own rather than taking the figures as props, so the two hosts never
// need to be kept in sync by hand. The underlying queries share TanStack
// Query's cache with TransactionsScreen's own (identical `queryKey`), so
// this costs a recomputation, not a second network round-trip.
export function RecordsSummary({ month, person, card, cardCycle, filter }: Props) {
  const { householdId, members } = useHousehold()
  const range = useMemo(
    () => (cardCycle ? cycleFetchRange(cardCycle) : monthRange(month)),
    [month, cardCycle],
  )
  // CardCycleSummary's paidSoFar needs to see a payment settling this
  // cycle even though it's dated after this cycle closes (bills fall due
  // only once the cycle is over) — widened just for that fetch, not for
  // range itself, so the ledger list TransactionsScreen renders alongside
  // this still shows only what actually happened in this cycle.
  const paymentSearchRange = useMemo(() => {
    if (!cardCycle || !card) return range
    const nextCycle = cycleOf(card, addDays(cardCycle.end, 1))
    return { start: cycleFetchRange(cardCycle).start, end: nextCycle.end }
  }, [cardCycle, card, range])
  const { data: transactions } = useTransactions(householdId, range)
  const { data: widerTransactions } = useTransactions(householdId, paymentSearchRange)
  const { data: categories } = useCategories(householdId)
  const { data: shares } = useTransactionShares(householdId)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [expandedMainId, setExpandedMainId] = useState<string | null>(null)

  const categoryById = useMemo(() => new Map((categories ?? []).map((c) => [c.id, c])), [categories])
  const sharesByTxn = useMemo(() => sharesByTransaction(shares), [shares])
  // Unconfirmed rows and Balance Adjustments the household marked "just a
  // correction" (system category — balanceAdjustments.ts) are excluded from
  // every total here, same as in TransactionsScreen.
  const confirmed = useMemo(
    () =>
      (transactions ?? []).filter(
        (t) =>
          t.confirmed &&
          !categoryById.get(t.category_id ?? '')?.system &&
          (!cardCycle || inCycle(t, cardCycle)),
      ),
    [transactions, categoryById, cardCycle],
  )
  // Sourced from the wider fetch (paymentSearchRange), not `confirmed`, so
  // a payment dated after this cycle closes — where one settling this
  // cycle's bill almost always lands — is actually there for
  // CardCycleSummary's paidSoFar to find.
  const cardTransactions = useMemo(
    () =>
      card
        ? (widerTransactions ?? [])
            .filter((t) => t.confirmed && !categoryById.get(t.category_id ?? '')?.system)
            .filter((t) => t.from_card_id === card.id || t.to_card_id === card.id)
        : [],
    [card, widerTransactions, categoryById],
  )

  // CardCycleSummary, below, deliberately does *not* see this filter — a
  // card's billing-cycle total has to be its real total regardless of which
  // categories happen to be ticked in Records' Filter screen, or it would
  // quietly understate what's actually due.
  const filtered = useMemo(
    () => confirmed.filter((t) => matchesPersonFilter(t, sharesByTxn, person) && matchesRecordsFilter(t, filter)),
    [confirmed, sharesByTxn, person, filter],
  )

  // D14: the headline is what this person Borne, not the face value of what
  // they're merely listed on — full amounts here would double-count a
  // shared row across both people's totals and break "A + B = All".
  const borneOf = (t: (typeof filtered)[number]) => (person === 'all' ? t.amount : borneAmount(t, sharesByTxn, person))
  const income = filtered.filter((t) => t.kind === 'income').reduce((sum, t) => sum + borneOf(t), 0)
  const expense = filtered.filter((t) => t.kind === 'expense').reduce((sum, t) => sum + borneOf(t), 0)

  // Per-person Borne breakdown for the month, regardless of the active chip
  // — useful to see "how much did each of us spend" no matter who's
  // currently selected.
  const personRows = useMemo(() => {
    const inFilter = confirmed.filter((t) => matchesRecordsFilter(t, filter))
    return members
      .map((m) => {
        const own = inFilter.filter((t) => matchesPersonFilter(t, sharesByTxn, m.id))
        const income = own.filter((t) => t.kind === 'income').reduce((s, t) => s + t.amount, 0)
        const expense = own.filter((t) => t.kind === 'expense').reduce((s, t) => s + borneAmount(t, sharesByTxn, m.id), 0)
        return { key: m.id, label: m.display_name, color: m.color, income, expense }
      })
      .filter((row) => row.income > 0 || row.expense > 0)
  }, [confirmed, members, sharesByTxn, filter])

  // Expense by category, rolled up to effective mains (D10) and to Borne
  // amounts under the active person filter.
  const categoryRows = useMemo<MainRow[]>(() => {
    const mainTotals = new Map<string, number>()
    const subTotals = new Map<string, Map<string, number>>()

    for (const t of filtered) {
      if (t.kind !== 'expense' || !t.category_id) continue
      const category = categoryById.get(t.category_id)
      if (!category) continue
      const amount = person === 'all' ? t.amount : borneAmount(t, sharesByTxn, person)
      const mainId = effectiveMainId(category)
      mainTotals.set(mainId, (mainTotals.get(mainId) ?? 0) + amount)
      if (category.parent_id) {
        const subs = subTotals.get(mainId) ?? new Map<string, number>()
        subs.set(category.id, (subs.get(category.id) ?? 0) + amount)
        subTotals.set(mainId, subs)
      }
    }

    return [...mainTotals.entries()]
      .map(([id, total]) => {
        const main = categoryById.get(id)
        if (!main) return null
        const subs = [...(subTotals.get(id) ?? new Map<string, number>()).entries()]
          .map(([subId, subTotal]) => ({ category: categoryById.get(subId), total: subTotal }))
          .filter((row): row is { category: Category; total: number } => row.category != null)
          .sort((a, b) => b.total - a.total)
        return { main, total, subs }
      })
      .filter((row): row is MainRow => row != null)
      .sort((a, b) => b.total - a.total)
  }, [filtered, categoryById, person, sharesByTxn])
  const maxCategoryTotal = categoryRows[0]?.total ?? 0
  const categoryTotal = categoryRows.reduce((sum, row) => sum + row.total, 0)

  if (card && cardCycle) {
    return <CardCycleSummary card={card} cycle={cardCycle} cycleTransactions={cardTransactions} />
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setSummaryOpen((open) => !open)}
        className="flex w-full items-center gap-2 rounded-2xl border bg-linear-to-br from-secondary/50 via-card to-accent/40 px-4 py-2.5 text-left text-sm shadow-sm"
      >
        <span className="flex-1 truncate">
          In <span className="text-good">{formatBaht(income)}</span> · Out{' '}
          <span className="text-destructive">{formatBaht(expense)}</span>
        </span>
        <span className={cn('font-semibold', income - expense >= 0 ? 'text-good' : 'text-destructive')}>
          {income - expense >= 0 ? '+' : ''}
          {formatBaht(income - expense)}
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', summaryOpen && 'rotate-180')} />
      </button>

      {summaryOpen && personRows.length > 0 && (
        <div className="divide-y rounded-2xl border bg-card">
          {personRows.map((row) => (
            <div key={row.key} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
              <span className="flex-1 truncate">{row.label}</span>
              <span className="text-good">+{formatBaht(row.income)}</span>
              <span className="text-destructive">-{formatBaht(row.expense)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl border bg-card px-3 pt-2">
        <p className="text-xs text-muted-foreground">Last {TREND_MONTHS} months</p>
        <MonthTrendChart householdId={householdId} month={month} person={person} />
      </div>

      {categoryRows.length > 0 && (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setCategoriesOpen((open) => !open)}
            className="flex w-full items-center gap-2 rounded-xl border bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-accent/60 active:bg-accent/60"
          >
            <span className="flex-1 text-muted-foreground">Categories</span>
            <span>{formatBaht(categoryTotal)}</span>
            <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', categoriesOpen && 'rotate-180')} />
          </button>

          {categoriesOpen && (
            <>
              {/* Nested inside Categories, not floating above it — its
                  colours only mean anything next to the list carrying the
                  matching dots, so it opens and closes with that list. */}
              <CategoryDonut rows={categoryRows} total={categoryTotal} />

              <ul className="space-y-1.5">
                {categoryRows.map(({ main, total, subs }, i) => {
                  const isExpanded = expandedMainId === main.id
                  const dotColor = categoryColor({ main, total, subs }, i)
                  return (
                    <li key={main.id} className="space-y-1">
                      <div className="space-y-1.5 rounded-xl border bg-card px-3 py-2">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="flex min-w-0 flex-1 items-center gap-2">
                            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: dotColor }} />
                            <CategoryIcon icon={main.icon} color={main.color} className="size-4 shrink-0 text-muted-foreground" />
                            <span className="flex-1 truncate">{main.name}</span>
                            <span>{formatBaht(total)}</span>
                          </span>
                        {subs.length > 0 && (
                          <button
                            onClick={() => setExpandedMainId(isExpanded ? null : main.id)}
                            className="shrink-0 text-muted-foreground"
                            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${main.name}`}
                          >
                            <ChevronRight className={cn('size-4 transition-transform', isExpanded && 'rotate-90')} />
                          </button>
                        )}
                      </div>
                      <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full bg-primary/70"
                          style={{ width: `${Math.max(4, (total / maxCategoryTotal) * 100)}%` }}
                        />
                      </span>
                    </div>
                    {isExpanded && subs.length > 0 && (
                      <ul className="ml-4 space-y-1 border-l pl-3">
                        {subs.map(({ category, total: subTotal }) => (
                          <li key={category.id} className="flex items-center gap-2 px-2 py-1.5 text-left text-sm">
                            <CategoryIcon icon={category.icon} color={category.color} className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="flex-1 truncate">{category.name}</span>
                            <span className="text-muted-foreground">{formatBaht(subTotal)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
