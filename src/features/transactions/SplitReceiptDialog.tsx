import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { categoryPath, useCategories } from '@/lib/categories'
import { sharesByTransaction } from '@/lib/filters'
import { formatBaht } from '@/lib/format'
import { useHousehold } from '@/lib/HouseholdContext'
import { useSplitIntoReceipt, type ReceiptLineInput } from '@/lib/receipts'
import { inheritedSplitFor } from '@/lib/receiptSplit'
import { useTransactionShares } from '@/lib/transactionShares'
import type { DraftLine } from '@/lib/scanBill'
import type { Transaction } from '@/lib/transactions'

interface Props {
  transaction: Transaction
  onClose: () => void
  /**
   * Lines a bill scan proposed (ADR-0017), in this component's own shape —
   * index 0 is the remainder line and carries no amount. Every value here is
   * a suggestion the household edits or overrides before Save; the dialog
   * treats them exactly as if they had been typed.
   */
  prefill?: { label: string; lines: DraftLine[] } | null
}

interface Line {
  key: string
  categoryId: string | null
  /** Free text while typing; parsed only on save. Blank means nothing yet. */
  amount: string
  description: string
}

let nextKey = 0
const newLine = (categoryId: string | null = null): Line => ({
  key: `line-${nextKey++}`,
  categoryId,
  amount: '',
  description: '',
})

/**
 * Splitting is an edit, not an entry mode (D22 / ADR-0015): the transaction is
 * already in the ledger, and this converts it in place rather than offering a
 * second way to record one.
 *
 * The first line is the rest of the basket and its amount is **derived** —
 * the total less everything itemised below it. That is how a receipt is
 * actually read ("of this ฿1,800, ฿300 was snacks, ฿300 was a saucepan, the
 * rest was groceries"), and it makes an invalid split unrepresentable: the
 * lines always add up, so `split_transaction_into_receipt`'s sum check can
 * never be what tells the user they got it wrong.
 */
export function SplitReceiptDialog({ transaction, onClose, prefill }: Props) {
  const { householdId } = useHousehold()
  const { data: categories } = useCategories(householdId)
  const { data: shares } = useTransactionShares(householdId)
  const split = useSplitIntoReceipt(householdId)

  const originalCategory = categories?.find((c) => c.id === transaction.category_id) ?? null
  const [label, setLabel] = useState(
    () => prefill?.label || transaction.note || transaction.description || originalCategory?.name || '',
  )
  const [lines, setLines] = useState<Line[]>(() =>
    prefill?.lines?.length
      ? prefill.lines.map((l) => ({ ...newLine(l.categoryId), amount: l.amount, description: l.description }))
      : [newLine(transaction.category_id), newLine(null)],
  )

  const options = useMemo(() => {
    const all = categories ?? []
    return all
      .filter((c) => !c.archived && !c.system && c.kind === transaction.kind)
      .map((c) => ({ id: c.id, path: categoryPath(c, all) }))
      .sort((a, b) => a.path.localeCompare(b.path))
  }, [categories, transaction.kind])

  const itemised = lines
    .slice(1)
    .reduce((sum, l) => sum + (Number.parseFloat(l.amount) || 0), 0)
  const remainder = Math.round((transaction.amount - itemised) * 100) / 100

  const update = (key: string, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const problem =
    lines.length < 2
      ? 'A receipt needs at least two lines.'
      : remainder <= 0
        ? `The lines below add up to more than ${formatBaht(transaction.amount)}.`
        : lines.some((l) => l.categoryId == null)
          ? 'Every line needs a category.'
          : lines.slice(1).some((l) => (Number.parseFloat(l.amount) || 0) <= 0)
            ? 'Every itemised line needs an amount.'
            : !label.trim()
              ? 'Give the receipt a name.'
              : null

  // The Split the transaction already carried is what every line inherits,
  // scaled to its own amount. Nothing is asked again and nothing is stored on
  // the receipt — each line's shares are the whole truth about it, and any
  // one of them can be edited afterwards on its own row.
  const originalShares = sharesByTransaction(shares).get(transaction.id) ?? []

  async function handleSave() {
    if (problem) return
    const payload: ReceiptLineInput[] = lines.map((line, i) => {
      const amount = i === 0 ? remainder : Number.parseFloat(line.amount)
      return {
        categoryId: line.categoryId!,
        amount,
        description: line.description.trim(),
        shares: inheritedSplitFor(
          originalShares.map((s) => ({ member_id: s.member_id, share_amount: s.share_amount })),
          amount,
        ),
      }
    })
    try {
      await split.mutateAsync({
        transactionId: transaction.id,
        label: label.trim(),
        kind: transaction.kind,
        lines: payload,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not split this transaction')
      return
    }
    toast.success('Split into a receipt')
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Split into a receipt</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          One payment of {formatBaht(transaction.amount)} that covered more than one category. The
          first line takes whatever is left over.
        </p>

        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Receipt name</span>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Makro" />
        </label>

        <ul className="space-y-2">
          {lines.map((line, i) => (
            <li key={line.key} className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <Select
                  value={line.categoryId ?? undefined}
                  onValueChange={(value) => update(line.key, { categoryId: value })}
                >
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
                  placeholder="Note (optional)"
                  className="h-8 text-xs"
                />
              </div>
              <div className="w-28 shrink-0">
                {i === 0 ? (
                  <div className="flex h-9 items-center justify-end rounded-md border border-dashed px-3 text-sm tabular-nums text-muted-foreground">
                    {formatBaht(remainder)}
                  </div>
                ) : (
                  <Input
                    inputMode="decimal"
                    value={line.amount}
                    onChange={(e) => update(line.key, { amount: e.target.value })}
                    placeholder="0.00"
                    className="text-right tabular-nums"
                  />
                )}
                {i === 0 && <span className="mt-1 block text-center text-[10px] text-muted-foreground">the rest</span>}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="mt-0.5 size-9 shrink-0"
                disabled={i === 0 || lines.length <= 2}
                onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                aria-label="Remove line"
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>

        <Button variant="outline" onClick={() => setLines((prev) => [...prev, newLine(null)])}>
          <Plus className="size-4" /> Add a line
        </Button>

        {problem && <p className="text-sm text-destructive">{problem}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={problem != null || split.isPending}>
            {split.isPending ? 'Splitting…' : 'Split'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
