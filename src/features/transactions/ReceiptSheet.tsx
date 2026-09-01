import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AmountField } from '@/components/AmountField'
import { DatePickerPanel } from '@/components/DatePickerPanel'
import { EntryPage } from '@/components/EntryPage'
import { EntryRow } from '@/components/EntryRow'
import { InstrumentPickerPanel } from '@/components/InstrumentPickerPanel'
import type { Instrument } from '@/components/InstrumentSelect'
import { Keypad } from '@/components/Keypad'
import { evenSplit, WhoBearsField, type WhoBearsValue } from '@/components/WhoBearsField'
import { useAmountEntry } from '@/hooks/useAmountEntry'
import { useEntryPanel } from '@/hooks/useEntryPanel'
import { categoryPath, useCategories } from '@/lib/categories'
import { sharesByTransaction } from '@/lib/filters'
import { formatBaht } from '@/lib/format'
import { useHousehold } from '@/lib/HouseholdContext'
import { toBuddhistYear } from '@/lib/month'
import { inheritedSplitFor } from '@/lib/receiptSplit'
import { useSplitIntoReceipt, type ReceiptLineInput } from '@/lib/receipts'
import type { DraftLine } from '@/lib/scanBill'
import { supabase } from '@/lib/supabase'
import {
  useCreateTransaction,
  type Transaction,
  type TransactionInput,
} from '@/lib/transactions'
import {
  invalidateShareQueries,
  syncTransactionShares,
  useTransactionShares,
  type ShareRow,
} from '@/lib/transactionShares'
import { useQueryClient } from '@tanstack/react-query'

/**
 * One payment, seen the way the slip shows it: what it was, when, what paid
 * for it, and the categories underneath (ADR-0018).
 *
 * Three ways in, two behaviours:
 *
 * - `scan` — nothing is saved yet. The photographed total is authoritative and
 *   editable, the first line derives from it, and Save writes the transaction
 *   and splits it in one press.
 * - `split` — the transaction exists and is being divided. Same form; the
 *   amount comes from what was charged and is not the receipt's to restate.
 * - `edit` — the receipt exists. The total is the **sum of its lines** and is
 *   shown, not typed: a Receipt holds no money (D22), and a field here would
 *   teach otherwise. Changing a figure means changing a line.
 */
export type ReceiptDraft =
  | { kind: 'scan'; scan: { merchant: string; date: string | null; total: number; lines: DraftLine[] } }
  | { kind: 'split'; transaction: Transaction }
  | { kind: 'edit'; receiptId: string; label: string; lines: Transaction[] }

interface Props {
  draft: ReceiptDraft
  onClose: () => void
}

interface Line {
  key: string
  categoryId: string | null
  /** Free text while typing. Blank on the derived line, which has no field. */
  amount: string
  description: string
  /** Set in `edit`: the row this line already is. */
  transactionId?: string
}

let nextKey = 0
const newLine = (partial: Partial<Line> = {}): Line => ({
  key: `line-${nextKey++}`,
  categoryId: null,
  amount: '',
  description: '',
  ...partial,
})

const today = () => new Date().toISOString().slice(0, 10)

function dateLabel(value: string): string {
  if (value === today()) return 'Today'
  const d = new Date(`${value}T00:00:00`)
  return `${d.getDate()} ${d.toLocaleDateString('en-US', { month: 'short' })} ${toBuddhistYear(d.getFullYear())}`
}

type PanelKey = 'amount' | 'date' | 'instrument'

export function ReceiptSheet({ draft, onClose }: Props) {
  const { householdId, self, members } = useHousehold()
  const { data: categories } = useCategories(householdId)
  const { data: allShares } = useTransactionShares(householdId)
  const queryClient = useQueryClient()
  const createTransaction = useCreateTransaction(householdId)
  const split = useSplitIntoReceipt(householdId)
  const panel = useEntryPanel<PanelKey>()
  const [saving, setSaving] = useState(false)

  const editing = draft.kind === 'edit'
  // In `edit` the lines are the truth and their sum is the total; everywhere
  // else a payment of a known size is being divided.
  const source: Transaction | null =
    draft.kind === 'split' ? draft.transaction : draft.kind === 'edit' ? (draft.lines[0] ?? null) : null
  const kind = source?.kind ?? 'expense'

  const [label, setLabel] = useState(() =>
    draft.kind === 'scan'
      ? draft.scan.merchant
      : draft.kind === 'edit'
        ? draft.label
        : draft.transaction.note || draft.transaction.description || '',
  )
  const [date, setDate] = useState(() =>
    draft.kind === 'scan' ? (draft.scan.date ?? today()) : (source?.date ?? today()),
  )
  const [instrument, setInstrument] = useState<Instrument>(() => ({
    accountId: source?.from_account_id ?? null,
    cardId: source?.from_card_id ?? null,
  }))
  const amountField = useAmountEntry(
    draft.kind === 'scan' ? String(draft.scan.total) : draft.kind === 'split' ? String(draft.transaction.amount) : '',
  )
  const [whoBears, setWhoBears] = useState<WhoBearsValue>({ mode: 'you', custom: {} })

  const [lines, setLines] = useState<Line[]>(() => {
    if (draft.kind === 'scan') {
      return draft.scan.lines.map((l) =>
        newLine({ categoryId: l.categoryId, amount: l.amount, description: l.description }),
      )
    }
    if (draft.kind === 'edit') {
      return draft.lines.map((t) =>
        newLine({
          categoryId: t.category_id,
          amount: String(t.amount),
          description: t.description || t.note || '',
          transactionId: t.id,
        }),
      )
    }
    return [newLine({ categoryId: draft.transaction.category_id }), newLine()]
  })

  const options = useMemo(() => {
    const all = categories ?? []
    return all
      .filter((c) => !c.archived && !c.system && c.kind === kind)
      .map((c) => ({ id: c.id, path: categoryPath(c, all) }))
      .sort((a, b) => a.path.localeCompare(b.path))
  }, [categories, kind])

  const typed = (l: Line) => Number.parseFloat(l.amount) || 0
  // `edit` types every line and the total follows them. The other two divide a
  // known payment, so the first line takes whatever the rest leave — which is
  // what makes a split that doesn't add up unrepresentable rather than merely
  // rejected (0029's sum check can then never be the thing that tells the
  // household they got it wrong).
  const charged = editing ? lines.reduce((s, l) => s + typed(l), 0) : amountField.value
  const itemised = editing ? 0 : lines.slice(1).reduce((s, l) => s + typed(l), 0)
  const remainder = editing ? 0 : Math.round((charged - itemised) * 100) / 100
  const amountOf = (l: Line, i: number) => (editing || i > 0 ? typed(l) : remainder)

  const update = (key: string, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const problem =
    lines.length < 2
      ? 'A receipt needs at least two lines.'
      : !label.trim()
        ? 'Give the receipt a name.'
        : !instrument.accountId && !instrument.cardId
          ? 'Say what paid for this.'
          : lines.some((l) => l.categoryId == null)
            ? 'Every line needs a category.'
            : !editing && remainder <= 0
              ? `The lines below add up to more than ${formatBaht(charged)}.`
              : lines.some((l, i) => amountOf(l, i) <= 0)
                ? 'Every line needs an amount.'
                : null

  /** The Split each line inherits, scaled to its own amount (ADR-0015). */
  function sharesFor(originalShares: ShareRow[], amount: number) {
    return inheritedSplitFor(
      originalShares.map((s) => ({ member_id: s.member_id, share_amount: s.share_amount })),
      amount,
    )
  }

  async function handleSave() {
    if (problem || saving) return
    setSaving(true)
    try {
      if (editing) {
        await saveEdits()
      } else {
        await saveNewReceipt()
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save this receipt')
      setSaving(false)
      return
    }
    invalidateShareQueries(queryClient, householdId)
    queryClient.invalidateQueries({ queryKey: ['transactions', householdId] })
    queryClient.invalidateQueries({ queryKey: ['receipts', householdId] })
    toast.success(editing ? 'Receipt updated' : 'Split into a receipt')
    onClose()
  }

  async function saveNewReceipt() {
    let transactionId: string
    let originalShares: ShareRow[]

    if (draft.kind === 'split') {
      transactionId = draft.transaction.id
      originalShares = sharesByTransaction(allShares).get(draft.transaction.id) ?? []
    } else {
      // The payment has to exist before it can be divided --
      // `split_transaction_into_receipt` stamps a row that is already there,
      // which is what keeps the three foreign keys pointing at
      // `transactions.id` from ever moving (ADR-0015). One Save press, two
      // statements the household never sees separately.
      const first = lines[0]
      const input: TransactionInput = {
        date,
        kind,
        categoryId: first.categoryId,
        categoryKind: kind as 'income' | 'expense',
        description: '',
        amount: charged,
        ownerId: self.id,
        fromAccountId: instrument.accountId,
        fromCardId: instrument.cardId,
        toAccountId: null,
        toCardId: null,
        note: label.trim(),
      }
      transactionId = await createTransaction.mutateAsync(input)
      // Same derivation the entry form uses, so "Who bears" means one thing in
      // the app rather than one thing per screen.
      const memberIds = members.map((m) => m.id)
      const custom: ShareRow[] =
        whoBears.mode === 'you'
          ? []
          : whoBears.mode === 'split'
            ? memberIds.map((id) => ({ member_id: id, share_amount: evenSplit(charged, memberIds)[id] }))
            : whoBears.mode === 'sole'
              ? [{ member_id: whoBears.soleBearerId!, share_amount: charged }]
              : Object.entries(whoBears.custom).map(([member_id, share_amount]) => ({ member_id, share_amount }))
      await syncTransactionShares({
        householdId,
        transactionId,
        kind,
        ownerId: self.id,
        frontingMemberId: null,
        amount: charged,
        memberIds,
        custom,
      })
      // Read back rather than assumed: `computeShareRows` decides what an
      // empty `custom` means (D13's owner heuristic), and the lines inherit
      // whatever it actually wrote.
      const { data: written } = await supabase
        .from('transaction_shares')
        .select('member_id, share_amount')
        .eq('transaction_id', transactionId)
      originalShares = (written ?? []) as ShareRow[]
    }

    const payload: ReceiptLineInput[] = lines.map((line, i) => {
      const amount = amountOf(line, i)
      return {
        categoryId: line.categoryId!,
        amount,
        description: line.description.trim(),
        shares: sharesFor(originalShares, amount),
      }
    })
    await split.mutateAsync({ transactionId, label: label.trim(), kind, lines: payload })
  }

  async function saveEdits() {
    if (draft.kind !== 'edit') return
    // One statement for the fields the whole receipt shares. This is the edit
    // the schema refused outright until 0032 deferred the shape check: row by
    // row, every order left the receipt momentarily spanning two dates.
    const { error: sharedError } = await supabase
      .from('transactions')
      .update({
        date,
        from_account_id: instrument.accountId,
        from_card_id: instrument.cardId,
      })
      .eq('receipt_id', draft.receiptId)
    if (sharedError) throw sharedError

    const { error: labelError } = await supabase
      .from('receipts')
      .update({ label: label.trim() })
      .eq('id', draft.receiptId)
    if (labelError) throw labelError

    const byTransaction = sharesByTransaction(allShares)
    for (const [i, line] of lines.entries()) {
      const amount = amountOf(line, i)
      if (!line.transactionId) continue
      const before = draft.lines.find((t) => t.id === line.transactionId)
      const unchanged =
        before &&
        before.category_id === line.categoryId &&
        before.amount === amount &&
        (before.description || '') === line.description.trim()
      if (unchanged) continue

      const { error } = await supabase
        .from('transactions')
        .update({
          category_id: line.categoryId,
          category_kind: kind as 'income' | 'expense',
          amount,
          description: line.description.trim(),
        })
        .eq('id', line.transactionId)
      if (error) throw error

      // A line's shares must sum to its amount (0022), so an amount that moved
      // takes its Split with it, in the same proportions it already had.
      if (before && before.amount !== amount) {
        await syncTransactionShares({
          householdId,
          transactionId: line.transactionId,
          kind,
          ownerId: before.owner_id,
          frontingMemberId: null,
          amount,
          memberIds: members.map((m) => m.id),
          custom: sharesFor(byTransaction.get(line.transactionId) ?? [], amount),
        })
      }
    }
  }

  return (
    <EntryPage
      title={editing ? 'Receipt' : 'Split into a receipt'}
      onClose={onClose}
      panelOpen={panel.active !== null}
      footer={
        panel.active === 'amount' ? (
          <Keypad onKey={amountField.press} onEquals={amountField.pressEquals} onDone={panel.close} />
        ) : panel.active === 'date' ? (
          <DatePickerPanel
            value={date}
            onChange={(d) => {
              setDate(d)
              panel.close()
            }}
          />
        ) : panel.active === 'instrument' ? (
          <InstrumentPickerPanel
            value={instrument}
            onChange={(next) => {
              setInstrument(next)
              panel.close()
            }}
          />
        ) : (
          <Button className="w-full" onClick={handleSave} disabled={problem != null || saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Save receipt'}
          </Button>
        )
      }
    >
      <div className="space-y-1.5">
        <Label htmlFor="receipt-label">Receipt name</Label>
        <Input
          id="receipt-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onFocus={panel.close}
          placeholder="Makro"
        />
      </div>

      {editing ? (
        // Read-only on purpose (D22): a Receipt holds no money, so this is the
        // sum of the rows below and has nowhere else it could come from.
        // Changing it means changing a line.
        <div className="rounded-lg border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="text-2xl font-semibold tabular-nums">{formatBaht(charged)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Added up from the {lines.length} lines below — edit a line to change it.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label>Amount charged</Label>
          <AmountField
            expr={amountField.expr}
            active={panel.active === 'amount'}
            onActivate={() => panel.toggle('amount')}
            size="lg"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <EntryRow label="Date" active={panel.active === 'date'} onClick={() => panel.toggle('date')} value={dateLabel(date)} />
        <EntryRow
          label="Paid with"
          placeholder={!instrument.accountId && !instrument.cardId}
          active={panel.active === 'instrument'}
          onClick={() => panel.toggle('instrument')}
          value={instrument.accountId || instrument.cardId ? 'Selected' : 'Choose'}
        />
      </div>

      {!editing && (
        <div className="space-y-1.5">
          <Label>Who bears</Label>
          {/* One answer for the payment, inherited by every line in proportion
              (ADR-0015). A line that is borne differently -- the halved
              saucepan among unhalved snacks -- is corrected on that line
              afterwards, which is where its Split has lived since the split
              RPC was written. */}
          <WhoBearsField members={members} selfId={self.id} value={whoBears} onChange={setWhoBears} amount={charged} />
        </div>
      )}

      <div className="space-y-2">
        <Label>Lines</Label>
        <ul className="space-y-2">
          {lines.map((line, i) => (
            <li key={line.key} className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <Select value={line.categoryId ?? undefined} onValueChange={(v) => update(line.key, { categoryId: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.path}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={line.description}
                  onChange={(e) => update(line.key, { description: e.target.value })}
                  onFocus={panel.close}
                  placeholder="Note (optional)"
                  className="h-8 text-xs"
                />
              </div>
              <div className="w-28 shrink-0">
                {!editing && i === 0 ? (
                  <div className="flex h-9 items-center justify-end rounded-md border border-dashed px-3 text-sm tabular-nums text-muted-foreground">
                    {formatBaht(remainder)}
                  </div>
                ) : (
                  <Input
                    inputMode="decimal"
                    value={line.amount}
                    onChange={(e) => update(line.key, { amount: e.target.value })}
                    onFocus={panel.close}
                    placeholder="0.00"
                    className="text-right tabular-nums"
                  />
                )}
                {!editing && i === 0 && (
                  <span className="mt-1 block text-center text-[10px] text-muted-foreground">the rest</span>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="mt-0.5 size-9 shrink-0"
                // The derived line is the one the others are measured against,
                // and two lines is what makes a receipt a receipt.
                disabled={(!editing && i === 0) || lines.length <= 2 || Boolean(line.transactionId)}
                onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                aria-label="Remove line"
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        {!editing && (
          <Button variant="outline" className="w-full" onClick={() => setLines((prev) => [...prev, newLine()])}>
            <Plus className="size-4" /> Add a line
          </Button>
        )}
      </div>

      {problem && <p className="text-sm text-destructive">{problem}</p>}
    </EntryPage>
  )
}
