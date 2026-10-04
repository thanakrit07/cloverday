import { useMemo, useState } from 'react'
import { ArrowRightLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FullScreenPage } from '@/components/FullScreenPage'
import { SwipeableRow } from '@/components/SwipeableRow'
import { Button } from '@/components/ui/button'
import { useCards } from '@/lib/cards'
import { CategoryIcon } from '@/lib/categoryIcons'
import { categoryPath, useCategories } from '@/lib/categories'
import { addDays, cycleFetchRange, cycleOf, inCycle } from '@/lib/finance/billingCycle'
import { sharesByTransaction } from '@/lib/filters'
import { formatBaht } from '@/lib/format'
import { useHousehold } from '@/lib/HouseholdContext'
import { dayMonthLabel, dayOfMonthLabel, weekdayLabel } from '@/lib/month'
import { useTransactionShares } from '@/lib/transactionShares'
import { useDeleteTransaction, useTransactions, type Transaction } from '@/lib/transactions'
import { cn } from '@/lib/utils'
import { CardCycleSummary } from '@/features/transactions/CardCycleSummary'
import { TransactionSheet } from '@/features/transactions/TransactionSheet'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

interface Props {
  cardId: string
  onClose: () => void
}

// Card Details mirrors Account Details, but a card's natural period is its
// billing cycle, not the calendar month (§7.3) — the nav here steps cycles,
// same as the header's own card-cycle arrows elsewhere in the app, rather
// than months.
export function CardDetailsScreen({ cardId, onClose }: Props) {
  const { householdId, members } = useHousehold()
  const { data: cards } = useCards(householdId)
  const [anchor, setAnchor] = useState(todayIso())
  const { data: categories } = useCategories(householdId)
  const { data: shares } = useTransactionShares(householdId)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<Transaction | null>(null)
  const remove = useDeleteTransaction(householdId)

  const card = (cards ?? []).find((c) => c.id === cardId) ?? null
  const cycle = card ? cycleOf(card, anchor) : null
  const range = cycle ? cycleFetchRange(cycle) : { start: anchor, end: anchor }
  const { data: cycleTxns } = useTransactions(householdId, range)
  // CardCycleSummary's paidSoFar needs to see a payment settling this cycle
  // even though it's dated after this cycle closes (bills fall due only
  // once the cycle is over) — widened just for that, not for `range`
  // itself, so the ledger list below still shows only this cycle's own
  // transactions.
  // Not memoized, matching `range` above — useTransactions keys its query
  // on the start/end strings, not this object's identity, so there's
  // nothing an identity-stable reference would buy here.
  const paymentSearchRange =
    card && cycle ? { start: range.start, end: cycleOf(card, addDays(cycle.end, 1)).end } : range
  const { data: widerCycleTxns } = useTransactions(householdId, paymentSearchRange)
  const categoryById = useMemo(() => new Map((categories ?? []).map((c) => [c.id, c])), [categories])
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const sharesByTxn = useMemo(() => sharesByTransaction(shares), [shares])

  const items = useMemo(
    () =>
      (cycleTxns ?? []).filter(
        (t) => t.confirmed && (t.from_card_id === cardId || t.to_card_id === cardId) && (!cycle || inCycle(t, cycle)),
      ),
    [cycleTxns, cardId, cycle],
  )
  // For CardCycleSummary only — includes the extra days past cycle close
  // where a payment settling it actually lands. cycleBill filters its own
  // date range internally, so the wider set doesn't change the bill total.
  const widerItems = useMemo(
    () => (widerCycleTxns ?? []).filter((t) => t.confirmed && (t.from_card_id === cardId || t.to_card_id === cardId)),
    [widerCycleTxns, cardId],
  )

  const groups = useMemo(() => {
    const map = new Map<string, Transaction[]>()
    for (const t of items) {
      const list = map.get(t.date) ?? []
      list.push(t)
      map.set(t.date, list)
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [items])

  async function handleDelete(t: Transaction) {
    await remove.mutateAsync(t.id)
    toast.success('Transaction deleted')
  }

  if (!card || !cycle) return null

  return (
    <FullScreenPage
      title={card.name}
      onClose={onClose}
      headerActions={
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setAnchor(addDays(cycle.start, -1))} aria-label="Previous cycle">
            <ChevronLeft className="size-4" />
          </Button>
          <span className="px-1 text-sm font-medium">
            {dayMonthLabel(cycle.start)} – {dayMonthLabel(cycle.end)}
          </span>
          <Button variant="ghost" size="icon" onClick={() => setAnchor(addDays(cycle.end, 1))} aria-label="Next cycle">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      }
    >
      <div className="mx-auto max-w-2xl space-y-3 p-4">
        <CardCycleSummary card={card} cycle={cycle} cycleTransactions={widerItems} />

        {groups.length === 0 && <p className="text-sm text-muted-foreground">No transactions this cycle.</p>}

        <div className="overflow-hidden rounded-xl border bg-card">
          {groups.map(([date, dayItems], groupIndex) => (
            <div key={date} className={groupIndex > 0 ? 'border-t' : undefined}>
              <div className="flex items-center gap-2 bg-muted/50 px-3 py-1">
                <span className="text-sm font-semibold tabular-nums">{dayOfMonthLabel(date)}</span>
                <span className="rounded bg-background px-1.5 py-px text-[10px] text-muted-foreground">{weekdayLabel(date)}</span>
              </div>
              <ul>
                {dayItems.map((t) => {
                  const category = t.category_id ? categoryById.get(t.category_id) : null
                  const isTransfer = t.kind === 'transfer'
                  const isOut = t.from_card_id === cardId
                  const catPath = category ? categoryPath(category, categories ?? []) : null
                  const title = isTransfer ? (isOut ? 'Payment out' : 'Payment in') : t.note || catPath || t.kind
                  // One dot per member who Bears part of this row (D13) —
                  // same colour convention as Settings/Balances/Records.
                  const bearers = [...new Set((sharesByTxn.get(t.id) ?? []).filter((s) => s.share_amount > 0).map((s) => s.member_id))]
                    .map((id) => memberById.get(id))
                    .filter((m): m is (typeof members)[number] => m != null)
                  return (
                    <li key={t.id} className="border-t first:border-t-0">
                      <SwipeableRow onDelete={() => setConfirmingDelete(t)}>
                        <button
                          onClick={() => setEditing(t)}
                          className="flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left transition-colors active:bg-accent/60"
                        >
                          {isTransfer ? (
                            <ArrowRightLeft className="size-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <CategoryIcon icon={category?.icon ?? null} color={category?.color} className="size-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="truncate text-sm">{title}</span>
                            {(catPath && catPath !== title) || bearers.length > 0 ? (
                              <span className="flex items-center gap-1">
                                {catPath && catPath !== title && (
                                  <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{catPath}</span>
                                )}
                                {bearers.length > 0 && (
                                  <span
                                    className="flex shrink-0 items-center gap-0.5"
                                    aria-label={`Shared with ${bearers.map((m) => m.display_name).join(', ')}`}
                                  >
                                    {bearers.map((m) => (
                                      <span key={m.id} className="size-1.5 rounded-full" style={{ backgroundColor: m.color }} />
                                    ))}
                                  </span>
                                )}
                              </span>
                            ) : null}
                          </span>
                          <span
                            className={cn(
                              'shrink-0 text-sm tabular-nums',
                              isTransfer ? 'text-muted-foreground' : 'text-destructive',
                            )}
                          >
                            {isTransfer ? (isOut ? '-' : '+') : '-'}
                            {formatBaht(t.amount)}
                          </span>
                        </button>
                      </SwipeableRow>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {editing && <TransactionSheet open onOpenChange={(open) => !open && setEditing(null)} transaction={editing} />}
      {confirmingDelete && (
        <ConfirmDialog
          title="Delete this transaction?"
          description="Removes it from every total. You'll have a few seconds to undo right after."
          onConfirm={() => handleDelete(confirmingDelete)}
          onClose={() => setConfirmingDelete(null)}
        />
      )}
    </FullScreenPage>
  )
}
