import { useEffect, useMemo, useRef, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCardCycleAdjustments } from '@/lib/cardCycleAdjustments'
import { useCards } from '@/lib/cards'
import { cycleBill, cycleDueInMonth, cycleFetchRange, periodDate } from '@/lib/finance/billingCycle'
import { formatBaht } from '@/lib/format'
import { useHousehold } from '@/lib/HouseholdContext'
import { useInstallments, usePostedPeriods } from '@/lib/installments'
import { currentMonthKey, dayMonthLabel, monthLabel, shiftMonth, toBuddhistYear } from '@/lib/month'
import { useRecurringRules } from '@/lib/recurring'
import { useTransactions } from '@/lib/transactions'
import { cn } from '@/lib/utils'

// The default window straddles today: enough history to check the last few
// statements against reality, and the forward horizon the tab was built for.
const PAST_MONTHS = 3
const FUTURE_MONTHS = 6

/** 'recent' = the rolling window; otherwise a 4-digit year showing Jan–Dec. */
type ViewWindow = 'recent' | string

function monthsOfYear(year: string): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
}

function rollingMonths(): string[] {
  const first = shiftMonth(currentMonthKey(), -PAST_MONTHS)
  return Array.from({ length: PAST_MONTHS + 1 + FUTURE_MONTHS }, (_, i) => shiftMonth(first, i))
}

// Forward calendar for credit cards (DESIGN.md §7.3 Plan): the in-app
// version of the sheet's per-card-per-cycle table, which SPEC §5 calls its
// single most valuable output. Rows are months (each showing the combined
// bill across every card) so the whole thing scrolls vertically on a phone;
// tapping a month opens the per-card breakdown.
//
// A future cycle has no recorded transactions yet, so its number splits in
// two: Posted (installment periods — a real row in the ledger, unescapable)
// and Projected (recurring charges — cancellable tomorrow, rarely the same
// amount twice). Both show at once rather than behind a toggle, because the
// gap between them is the most useful thing on the screen.
function useCardForecast(view: ViewWindow) {
  const { householdId } = useHousehold()
  const { data: cards } = useCards(householdId)
  const { data: installments } = useInstallments(householdId)
  const { data: postedPeriods } = usePostedPeriods(householdId)
  const { data: adjustments } = useCardCycleAdjustments(householdId)
  const { data: rules } = useRecurringRules(householdId)

  const months = useMemo(() => (view === 'recent' ? rollingMonths() : monthsOfYear(view)), [view])

  // Offered years come from the plans themselves — a plan's first and last
  // period bound the range where a card bill can exist — so the picker can
  // always reach every month the forecast has something to say about.
  const years = useMemo(() => {
    const now = new Date().getFullYear()
    const found = new Set<number>([now - 1, now, now + 1])
    for (const inst of installments ?? []) {
      found.add(Number(inst.start_date.slice(0, 4)))
      found.add(Number(periodDate(inst.start_date, inst.total_periods).slice(0, 4)))
    }
    return [...found].sort((a, b) => a - b).map(String)
  }, [installments])

  const activeCards = useMemo(() => (cards ?? []).filter((c) => !c.archived), [cards])

  // Every cycle in the window, so one transaction query can cover them all.
  const grid = useMemo(
    () => months.map((month) => ({ month, cells: activeCards.map((card) => ({ card, cycle: cycleDueInMonth(card, month) })) })),
    [months, activeCards],
  )
  const range = useMemo(() => {
    const all = grid.flatMap((row) => row.cells.map((c) => c.cycle))
    if (all.length === 0) return null
    return {
      start: cycleFetchRange(all.reduce((min, c) => (c.start < min.start ? c : min), all[0])).start,
      end: all.reduce((max, c) => (c.end > max ? c.end : max), all[0].end),
    }
  }, [grid])
  const { data: transactions } = useTransactions(householdId, range ?? { start: '', end: '' })

  const rows = useMemo(() => {
    return grid.map(({ month, cells }) => {
      const cards = cells
        .map(({ card, cycle }) => {
          const cardTxns = (transactions ?? []).filter(
            (t) => (t.from_card_id === card.id || t.to_card_id === card.id) && t.confirmed,
          )
          const cardInstallments = (installments ?? []).filter((i) => i.card_id === card.id && i.status === 'active')
          const adjustment = (adjustments ?? []).find((a) => a.card_id === card.id && a.cycle_start === cycle.start)
          const posted = cycleBill({
            cycle,
            cardId: card.id,
            transactions: cardTxns,
            installments: cardInstallments,
            adjustment: adjustment?.amount ?? null,
            postedPeriods: postedPeriods.keys,
          })
          const bill = cycleBill({
            cycle,
            cardId: card.id,
            transactions: cardTxns,
            installments: cardInstallments,
            adjustment: adjustment?.amount ?? null,
            postedPeriods: postedPeriods.keys,
            recurringRules: rules ?? [],
          })
          return { card, cycle, posted, projected: bill - posted, bill }
        })
        .filter((cell) => cell.bill > 0)
        .sort((a, b) => (a.cycle.dueDate < b.cycle.dueDate ? -1 : 1))
      return {
        month,
        cards,
        posted: cards.reduce((sum, c) => sum + c.posted, 0),
        projected: cards.reduce((sum, c) => sum + c.projected, 0),
        total: cards.reduce((sum, c) => sum + c.bill, 0),
      }
    })
  }, [grid, transactions, installments, adjustments, postedPeriods, rules])

  const peak = Math.max(...rows.map((r) => r.total), 0)
  return { months, years, activeCards, rows, peak }
}

// 2026-10 redesign: the month list became a column chart, so a spike is seen
// before it's read. Each column stacks Posted (solid, at the baseline) under
// Projected (the lighter extension) with a 2px gap; past months are greyed —
// they're what was actually charged. Tapping a column opens its per-card
// breakdown under the chart, which is also what a tooltip is on a phone.
// Columns keep room for a three-letter month, so on a phone the chart scrolls
// sideways rather than squeezing them, and it starts scrolled to this month.
export function CardForecastTab() {
  const thisMonth = currentMonthKey()
  const [view, setView] = useState<ViewWindow>('recent')
  const [picked, setPicked] = useState<string>(thisMonth)
  const { months, years, activeCards, rows, peak } = useCardForecast(view)
  const thisMonthRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    thisMonthRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [view])

  if (activeCards.length === 0) {
    return <p className="text-sm text-muted-foreground">No credit cards yet.</p>
  }

  const pickedRow = rows.find((r) => r.month === picked)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        {/* The span, not the mode name — the picker already says the mode,
            and what's useful here is knowing how far the chart actually runs. */}
        <p className="truncate text-sm text-muted-foreground">
          {monthLabel(months[0])} – {monthLabel(months[months.length - 1])}
        </p>
        <Select value={view} onValueChange={setView}>
          {/* No width override: SelectTrigger already defaults to w-fit, and a
              hardcoded w-32 was clipping longer Buddhist-era year labels. */}
          <SelectTrigger className="shrink-0" aria-label="Period shown"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Recent</SelectItem>
            {years.map((y) => (
              <SelectItem key={y} value={y}>{toBuddhistYear(Number(y))}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto px-1">
        <div className="grid min-w-full grid-flow-col auto-cols-[minmax(2.5rem,1fr)] items-end gap-1.5">
          {rows.map(({ month, posted, projected, total }) => {
            const isPeak = total > 0 && total === peak
            const isPast = month < thisMonth
            const name = monthLabel(month)
            return (
              <button
                key={month}
                ref={month === thisMonth ? thisMonthRef : undefined}
                type="button"
                onClick={() => setPicked(month)}
                aria-pressed={picked === month}
                aria-label={`${name}: ${formatBaht(posted)}${isPast ? ' charged' : ' posted'}${projected > 0 ? `, ${formatBaht(projected)} projected` : ''}`}
                title={`${name}: ${formatBaht(posted)}${projected > 0 ? ` + ${formatBaht(projected)} projected` : ''}`}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg px-0.5 pt-1 pb-1.5 transition-colors',
                  picked === month ? 'bg-muted' : 'active:bg-muted/60',
                )}
              >
                <span className={cn('h-3.5 text-[10px] tabular-nums', isPeak ? 'font-medium' : 'invisible')}>
                  {Math.round(total / 1000)}k
                </span>
                <StackBar posted={posted} projected={projected} peak={peak} past={isPast} />
                <span className={cn('text-[11px]', month === thisMonth ? 'font-semibold' : 'text-muted-foreground')}>
                  {name.slice(0, 3)}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-primary" /> Posted</span>
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-primary/35" /> Projected</span>
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-muted-foreground/35" /> Past (actual)</span>
      </div>

      {pickedRow && (
        <div className="rounded-2xl bg-muted/60 p-3">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">
              {monthLabel(pickedRow.month)}
              {pickedRow.month < thisMonth && pickedRow.total > 0 && <span className="ml-1.5 text-xs font-normal text-muted-foreground">actual</span>}
            </span>
            <PostedProjected posted={pickedRow.posted} projected={pickedRow.projected} />
          </div>
          <ul className="mt-2 space-y-1.5">
            {pickedRow.cards.map(({ card, cycle, posted, projected }) => (
              <li key={card.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{card.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {dayMonthLabel(cycle.start)} – {dayMonthLabel(cycle.end)} · due {dayMonthLabel(cycle.dueDate)}
                  </span>
                </span>
                <PostedProjected posted={posted} projected={projected} />
              </li>
            ))}
            {pickedRow.cards.length === 0 && <li className="text-sm text-muted-foreground">Nothing due this month.</li>}
          </ul>
        </div>
      )}

      {/* pr-20 keeps the text clear of the floating FAB: this tab's content is
          often shorter than the viewport, so it can't just be scrolled out.
          Desktop has no floating FAB (AppShell's rail has "New record"
          instead), so the clearance isn't needed there. */}
      <p className="pr-20 text-xs text-muted-foreground lg:pr-0">
        Past months show what was actually charged. Future months split Posted (installment periods — unescapable)
        and Projected (recurring charges — cancellable) — day-to-day spending that hasn't happened yet is never
        included.
      </p>
    </div>
  )
}

const BAR_HEIGHT = 96

// Posted at the baseline, Projected stacked on top with a 2px surface gap;
// only the ends that meet the baseline and the top are rounded.
function StackBar({ posted, projected, peak, past }: { posted: number; projected: number; peak: number; past: boolean }) {
  const scale = peak > 0 ? BAR_HEIGHT / peak : 0
  const p = posted * scale
  const q = projected * scale
  return (
    <div className="flex w-full flex-col justify-end" style={{ height: BAR_HEIGHT }}>
      {q > 0 && <div className="rounded-t-[4px] bg-primary/35" style={{ height: Math.max(q, 2), marginBottom: p > 0 ? 2 : 0 }} />}
      {p > 0 && (
        <div
          className={cn(past ? 'bg-muted-foreground/35' : 'bg-primary', q > 0 ? 'rounded-b-[4px]' : 'rounded-[4px]')}
          style={{ height: Math.max(p, 2) }}
        />
      )}
    </div>
  )
}

function PostedProjected({ posted, projected }: { posted: number; projected: number }) {
  return (
    <span className="shrink-0 tabular-nums">
      {formatBaht(posted)}
      {projected > 0 && <span className="text-muted-foreground"> + {formatBaht(projected)}</span>}
    </span>
  )
}
