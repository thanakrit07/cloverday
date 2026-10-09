import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSetCardCycleAdjustment, useCardCycleAdjustments } from '@/lib/cardCycleAdjustments'
import { closedCycleAsOf, cycleBill, type Cycle } from '@/lib/finance/billingCycle'
import { formatBaht } from '@/lib/format'
import { useHousehold } from '@/lib/HouseholdContext'
import { useInstallments, usePostedPeriods } from '@/lib/installments'
import { dayMonthLabel } from '@/lib/month'
import { useRecurringRules } from '@/lib/recurring'
import type { Transaction } from '@/lib/transactions'
import type { Card } from '@/lib/cards'
import { cn } from '@/lib/utils'

interface Props {
  card: Card
  cycle: Cycle
  /**
   * Scoped by the caller (RecordsSummary) to this cycle's own window
   * *plus* enough of the following cycle to catch a payment made after
   * this one closes — which is where a payment settling this cycle's bill
   * almost always lands, since bills fall due only after their cycle
   * closes. `cycleBill`'s own date filter still bounds the charge total to
   * exactly this cycle regardless of how wide this list is.
   */
  cycleTransactions: Transaction[]
}

// The bill total, utilisation gauge and "reconcile to statement" editor that
// used to live in the now-retired CardCycleDialog, ported so a card's detail
// can reuse Records (§7.3 v3.8) instead of its own dialog. Everything below
// the total — the actual charge/payment list — is Records' own list, filtered
// to this card; this component owns only the figures a plain transaction
// list can't derive by itself.
export function CardCycleSummary({ card, cycle, cycleTransactions }: Props) {
  const { householdId } = useHousehold()
  const { data: installments } = useInstallments(householdId)
  const { data: postedPeriods } = usePostedPeriods(householdId)
  const { data: adjustments } = useCardCycleAdjustments(householdId)
  const { data: rules } = useRecurringRules(householdId)
  const setAdjustment = useSetCardCycleAdjustment(householdId)

  const [open, setOpen] = useState(false)
  const [editingAdjustment, setEditingAdjustment] = useState(false)
  const existingAdjustment = (adjustments ?? []).find((a) => a.card_id === card.id && a.cycle_start === cycle.start)
  const [adjustmentAmount, setAdjustmentAmount] = useState(String(existingAdjustment?.amount ?? '0'))
  const [adjustmentNote, setAdjustmentNote] = useState(existingAdjustment?.note ?? '')

  const cardInstallments = (installments ?? []).filter((i) => i.card_id === card.id && i.status === 'active')
  const bill = cycleBill({
    cycle,
    cardId: card.id,
    transactions: cycleTransactions,
    installments: cardInstallments,
    adjustment: existingAdjustment?.amount ?? null,
    postedPeriods: postedPeriods?.keys,
    recurringRules: rules ?? [],
  })
  // A payment settles whichever cycle had most recently closed when it was
  // made, not the cycle its own date falls inside — due dates land after
  // the cycle closes, so attributing by window (what this used to do)
  // showed "฿0 paid" on bills that had been settled in full.
  const paidSoFar = cycleTransactions
    .filter((t) => t.confirmed && t.kind === 'transfer' && t.to_card_id === card.id)
    .filter((t) => closedCycleAsOf(card, t.date).start === cycle.start)
    .reduce((sum, t) => sum + t.amount, 0)
  const utilization = card.credit_limit > 0 ? Math.min(100, (bill / card.credit_limit) * 100) : 0

  async function saveAdjustment() {
    await setAdjustment.mutateAsync({
      cardId: card.id,
      cycleStart: cycle.start,
      amount: Number(adjustmentAmount),
      note: adjustmentNote || null,
    })
    setEditingAdjustment(false)
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="block w-full px-1 pb-1 pt-2 text-left"
      >
        <span className="flex items-center gap-1 text-[13px] text-muted-foreground">
          Bill · due {dayMonthLabel(cycle.dueDate)}
          <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
        </span>
        <span className="mt-1 block text-[42px] font-semibold leading-none tracking-[-0.035em] tabular-nums">{formatBaht(bill)}</span>
        {paidSoFar > 0 && (
          <span className="mt-2.5 block text-[13px] tabular-nums text-muted-foreground">
            <span className="font-medium text-good">{formatBaht(paidSoFar)}</span> paid
          </span>
        )}
      </button>

      {open && (
        <div className="space-y-3 rounded-2xl border bg-card p-3">
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Used</span>
              <span>{formatBaht(card.credit_limit)} limit</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={utilization >= 80 ? 'h-full rounded-full bg-destructive' : 'h-full rounded-full bg-primary/70'}
                style={{ width: `${utilization}%` }}
              />
            </div>
          </div>

          {!editingAdjustment ? (
            <button
              type="button"
              onClick={() => setEditingAdjustment(true)}
              className="text-sm text-muted-foreground underline-offset-2 hover:underline"
            >
              {existingAdjustment ? `Adjustment: ${formatBaht(existingAdjustment.amount)} — edit` : 'Reconcile to statement'}
            </button>
          ) : (
            <div className="space-y-2 rounded-xl border p-3">
              <p className="text-xs text-muted-foreground">Signed delta vs. the computed total, if the real statement differs.</p>
              <div className="space-y-1.5">
                <Label htmlFor="adj-amount">Adjustment amount</Label>
                <Input id="adj-amount" type="number" inputMode="decimal" value={adjustmentAmount} onChange={(e) => setAdjustmentAmount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adj-note">Note</Label>
                <Input id="adj-note" value={adjustmentNote} onChange={(e) => setAdjustmentNote(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditingAdjustment(false)}>
                  Cancel
                </Button>
                <Button size="sm" className="flex-1" onClick={saveAdjustment} disabled={setAdjustment.isPending}>
                  Save
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
