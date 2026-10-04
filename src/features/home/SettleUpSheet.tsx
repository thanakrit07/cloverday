import { useEffect, useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Drawer, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { DateField } from '@/components/DateField'
import { InstrumentSelect, type Instrument } from '@/components/InstrumentSelect'
import { addDays, format } from 'date-fns'
import { useAccounts } from '@/lib/accounts'
import { useCards } from '@/lib/cards'
import { useTransactions } from '@/lib/transactions'
import { useCategories } from '@/lib/categories'
import { formatBaht } from '@/lib/format'
import { useHousehold } from '@/lib/HouseholdContext'
import { dayMonthLabel } from '@/lib/month'
import {
  repaymentCandidates,
  useLinkRepayment,
  useRecordRepayment,
  useSettlements,
  useUnsettledShares,
  type UnsettledShare,
} from '@/lib/transactionShares'
import { cn } from '@/lib/utils'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

const NO_INSTRUMENT: Instrument = { accountId: null, cardId: null }

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The two people squaring up. Order doesn't matter — who pays is worked
   *  out from whichever side of the selection comes out heavier. */
  memberA: string
  memberB: string
}

export function SettleUpSheet({ open, onOpenChange, memberA, memberB }: Props) {
  const { householdId, members } = useHousehold()
  const { data: shares } = useUnsettledShares(householdId)
  const { data: categories } = useCategories(householdId)
  const { data: accounts } = useAccounts(householdId)
  const { data: cards } = useCards(householdId)
  const { data: settlements } = useSettlements(householdId)
  const recordRepayment = useRecordRepayment(householdId)
  const linkRepayment = useLinkRepayment(householdId)
  // A transfer already in the ledger (a bank line, say) can stand as the repayment
  // instead of Settle up making a second one: the last 120 days is far enough back.
  const { data: recent } = useTransactions(householdId, {
    start: format(addDays(new Date(), -120), 'yyyy-MM-dd'),
    end: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
  })
  const [useExisting, setUseExisting] = useState(false)
  const [transferId, setTransferId] = useState<string | null>(null)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [settledOn, setSettledOn] = useState(today())
  const [note, setNote] = useState('')
  const [from, setFrom] = useState<Instrument>(NO_INSTRUMENT)
  const [to, setTo] = useState<Instrument>(NO_INSTRUMENT)
  const [instrumentsTouched, setInstrumentsTouched] = useState(false)

  const nameOf = (id: string) => members.find((m) => m.id === id)?.display_name ?? 'Someone'
  const kindLabel = (kind: UnsettledShare['debt_kind']) => (kind === 'borrow' ? 'put on your card' : 'your share')

  // Both directions: squaring up clears everything between the two of them,
  // and only the difference actually changes hands. Listing one side only is
  // what made the headline disagree with the items under it, earlier.
  const owedByA = useMemo(
    () => (shares ?? []).filter((s) => s.owes_member_id === memberA && s.owed_member_id === memberB),
    [shares, memberA, memberB],
  )
  const owedByB = useMemo(
    () => (shares ?? []).filter((s) => s.owes_member_id === memberB && s.owed_member_id === memberA),
    [shares, memberA, memberB],
  )

  // Settling the whole balance is the common case; unticking is the exception.
  useEffect(() => {
    if (open) setSelected(new Set([...owedByA, ...owedByB].map((i) => i.id)))
  }, [open, owedByA, owedByB])

  const sumSelected = (items: UnsettledShare[]) =>
    items.filter((i) => selected.has(i.id)).reduce((sum, i) => sum + i.amount, 0)
  const totalA = sumSelected(owedByA)
  const totalB = sumSelected(owedByB)
  const net = totalA - totalB
  const payerId = net >= 0 ? memberA : memberB
  const payeeId = net >= 0 ? memberB : memberA
  const cash = Math.abs(net)

  // Whoever pays defaults to their own first account; same for the receiver.
  // A real transfer needs somewhere for the money to actually come from and
  // go to, so this can't be left blank the way a debt with no cash moving
  // could.
  useEffect(() => {
    if (!open || instrumentsTouched || !accounts) return
    const accountOf = (memberId: string) => accounts.find((a) => !a.archived && a.owner_id === memberId)?.id ?? null
    setFrom({ accountId: accountOf(payerId), cardId: null })
    setTo({ accountId: accountOf(payeeId), cardId: null })
  }, [open, instrumentsTouched, accounts, payerId, payeeId])

  useEffect(() => {
    if (!open) {
      setUseExisting(false)
      setTransferId(null)
      setInstrumentsTouched(false)
      setFrom(NO_INSTRUMENT)
      setTo(NO_INSTRUMENT)
    }
  }, [open])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function labelFor(item: UnsettledShare): string {
    if (item.note) return item.note
    if (item.description) return item.description
    return categories?.find((c) => c.id === item.category_id)?.name ?? 'Shared expense'
  }

  const ownerOf = (accountId: string | null, cardId: string | null) =>
    accountId ? (accounts?.find((a) => a.id === accountId)?.owner_id ?? null) : cardId ? (cards?.find((c) => c.id === cardId)?.owner_id ?? null) : null
  const candidates = useMemo(
    () =>
      repaymentCandidates(
        (recent ?? []).filter((t) => t.kind === 'transfer'),
        ownerOf,
        payerId,
        payeeId,
        new Set((settlements ?? []).map((s) => s.id)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recent, accounts, cards, settlements, payerId, payeeId],
  )
  const chosen = candidates.find((t) => t.id === transferId) ?? null

  async function handleLink() {
    if (!chosen) return
    try {
      await linkRepayment.mutateAsync({ shareIds: [...selected], transactionId: chosen.id })
      onOpenChange(false)
      toast.success(`Linked to the ${formatBaht(chosen.amount)} transfer on ${dayMonthLabel(chosen.date)}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not link the transfer.')
    }
  }

  async function handleSave() {
    try {
      await recordRepayment.mutateAsync({
        shareIds: [...selected],
        fromMemberId: payerId,
        from,
        to,
        amount: cash,
        date: settledOn,
        note: note || null,
      })
      onOpenChange(false)
      setNote('')
      toast.success(`Recorded ${formatBaht(cash)} from ${nameOf(payerId)}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not record the repayment.')
    }
  }

  function renderGroup(items: UnsettledShare[], debtorId: string, creditorId: string) {
    if (items.length === 0) return null
    return (
      <div className="space-y-1.5">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {nameOf(debtorId)} owes {nameOf(creditorId)}
        </h3>
        <ul className="space-y-1.5">
          {items.map((item) => {
            const isSelected = selected.has(item.id)
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => toggle(item.id)}
                  aria-pressed={isSelected}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition-colors',
                    isSelected ? 'border-primary bg-primary/10' : 'border-border',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-md border',
                      isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
                    )}
                  >
                    {isSelected && <Check className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{labelFor(item)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {dayMonthLabel(item.date)} · {kindLabel(item.debt_kind)} of {formatBaht(item.transaction_amount)}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium">{formatBaht(item.amount)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  const canSave = selected.size > 0 && cash > 0 && !useExisting && Boolean(from.accountId || from.cardId) && Boolean(to.accountId || to.cardId)

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>
            {nameOf(memberA)} and {nameOf(memberB)} settle up
          </DrawerTitle>
        </DrawerHeader>

        <div className="space-y-3 px-4 pb-4">
          <p className="text-sm text-muted-foreground">
            Pick what this covers. Anything left unticked stays owed.
          </p>

          <div className="max-h-56 space-y-3 overflow-y-auto">
            {renderGroup(owedByA, memberA, memberB)}
            {renderGroup(owedByB, memberB, memberA)}
          </div>

          {/* The arithmetic, spelled out: the figure on the button is only
              trustworthy if you can see where it came from. */}
          {owedByA.length > 0 && owedByB.length > 0 && (
            <dl className="space-y-1 rounded-xl bg-muted/50 px-3 py-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{nameOf(memberA)} owes</dt>
                <dd>{formatBaht(totalA)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{nameOf(memberB)} owes</dt>
                <dd>−{formatBaht(totalB)}</dd>
              </div>
              <div className="flex justify-between border-t pt-1 font-medium">
                <dt>{cash > 0 ? `${nameOf(payerId)} pays` : 'Even'}</dt>
                <dd>{formatBaht(cash)}</dd>
              </div>
            </dl>
          )}

          {/* Every repayment is a real transfer (§4.3) -- money has to move
              from somewhere to somewhere, so unlike an ordinary debt this
              can't be left with no cash changing hands even when the two
              sides net to zero. */}
          {cash > 0 && (candidates.length > 0 || useExisting) && (
            <div className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm">
              <span>
                {useExisting ? 'Using a transfer already in the ledger' : `${candidates.length} transfer${candidates.length === 1 ? '' : 's'} already in the ledger could be this`}
              </span>
              <Button size="sm" variant="outline" onClick={() => setUseExisting((v) => !v)}>
                {useExisting ? 'Make a new one' : 'Pick one'}
              </Button>
            </div>
          )}

          {useExisting && (
            <div className="space-y-1.5">
              <ul className="max-h-40 space-y-1.5 overflow-y-auto">
                {candidates.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setTransferId(t.id)}
                      aria-pressed={t.id === transferId}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm',
                        t.id === transferId ? 'border-primary bg-primary/10' : 'border-border',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{t.note || t.description || 'Transfer'}</span>
                        <span className="block text-xs text-muted-foreground">{dayMonthLabel(t.date)}</span>
                      </span>
                      <span className="shrink-0 font-medium">{formatBaht(t.amount)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {chosen && chosen.amount !== cash && (
                <p className="text-xs text-muted-foreground">
                  The transfer is {formatBaht(chosen.amount)}; these items come to {formatBaht(cash)}. The{' '}
                  {formatBaht(Math.abs(chosen.amount - cash))} {chosen.amount > cash ? 'extra' : 'short'} is left as it is.
                </p>
              )}
            </div>
          )}

          {cash === 0 && selected.size > 0 && (
            <p className="rounded-xl bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              These net to ฿0, so there's nothing to transfer. Untick some items on one side to leave a balance.
            </p>
          )}

          {cash > 0 && !useExisting && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{nameOf(payerId)} pays from</Label>
                <InstrumentSelect
                  value={from}
                  onChange={(next) => {
                    setFrom(next)
                    setInstrumentsTouched(true)
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{nameOf(payeeId)} receives into</Label>
                <InstrumentSelect
                  value={to}
                  onChange={(next) => {
                    setTo(next)
                    setInstrumentsTouched(true)
                  }}
                />
              </div>
            </div>
          )}

          <div className={cn('grid grid-cols-2 gap-3', useExisting && 'hidden')}>
            <div className="space-y-1.5">
              <Label htmlFor="settle-date">Paid on</Label>
              <DateField id="settle-date" value={settledOn} onChange={setSettledOn} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="settle-note">Note (optional)</Label>
              <Input
                id="settle-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Cash, transfer…"
              />
            </div>
          </div>
        </div>

        <DrawerFooter>
          {useExisting ? (
            <Button onClick={handleLink} disabled={!chosen || selected.size === 0 || linkRepayment.isPending}>
              Link to this transfer
            </Button>
          ) : (
            <Button onClick={handleSave} disabled={!canSave || recordRepayment.isPending}>
              {cash > 0 ? `Record ${formatBaht(cash)} from ${nameOf(payerId)}` : 'Select a balance to settle'}
            </Button>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
