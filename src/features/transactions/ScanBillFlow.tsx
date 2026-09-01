import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { SplitReceiptDialog } from './SplitReceiptDialog'
import { TransactionSheet } from './TransactionSheet'
import { categoryPath, useCategories } from '@/lib/categories'
import { useHousehold } from '@/lib/HouseholdContext'
import { scanBill, type BillScan } from '@/lib/scanBill'
import { supabase } from '@/lib/supabase'
import type { Transaction } from '@/lib/transactions'

interface Props {
  file: File
  onDone: () => void
}

/**
 * Photograph → the ordinary entry form → the ordinary split form (ADR-0017).
 *
 * There is no third path here: the scan fills in the two screens the household
 * already uses and then gets out of the way. That is why splitting stays an
 * edit (ADR-0015) and why this feature needed no migration — every row it
 * produces is written by code that predates it.
 */
export function ScanBillFlow({ file, onDone }: Props) {
  const { householdId } = useHousehold()
  const { data: categories } = useCategories(householdId)
  const [scan, setScan] = useState<BillScan | null>(null)
  const [splitting, setSplitting] = useState<Transaction | null>(null)

  useEffect(() => {
    let cancelled = false
    async function run() {
      const options = (categories ?? [])
        .filter((c) => !c.archived && !c.system && c.kind === 'expense')
        .map((c) => ({ id: c.id, path: categoryPath(c, categories ?? []) }))
      if (options.length === 0) return
      try {
        const result = await scanBill(file, options)
        if (!cancelled) setScan(result)
      } catch (error) {
        if (cancelled) return
        toast.error(error instanceof Error ? error.message : 'Could not read that photo.')
        onDone()
      }
    }
    run()
    return () => {
      cancelled = true
    }
    // Runs once per photo. `categories` is read at call time rather than
    // depended on, so a background refetch cannot re-scan the same image and
    // bill for it twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  /**
   * The row the form just wrote, fetched by id rather than read out of the
   * transactions cache: that cache is month-scoped and may not hold this row
   * yet, and the split dialog needs the real amount the database stored.
   */
  async function openSplit(transactionId: string) {
    if (!scan?.lines) {
      onDone()
      return
    }
    const { data, error } = await supabase
      .from('v_transactions')
      .select(
        'id, household_id, date, kind, category_id, category_kind, description, amount, owner_id, from_account_id, from_card_id, to_account_id, to_card_id, note, confirmed, source, source_key, receipt_id',
      )
      .eq('id', transactionId)
      .single()
    if (error || !data) {
      // The transaction is saved; only the split step is lost. Saying so beats
      // a silent close, because the household would otherwise assume the
      // categories they saw on screen had been recorded.
      toast.error('Saved, but could not open the split — split it from the ledger.')
      onDone()
      return
    }
    setSplitting(data as Transaction)
  }

  if (splitting) {
    return (
      <SplitReceiptDialog
        transaction={splitting}
        prefill={scan?.lines ? { label: scan.merchant, lines: scan.lines } : null}
        onClose={onDone}
      />
    )
  }

  if (!scan) {
    return (
      <Dialog open>
        <DialogContent className="sm:max-w-xs" aria-describedby={undefined}>
          <DialogTitle className="sr-only">Reading the receipt</DialogTitle>
          <div className="flex items-center gap-3 py-2">
            <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Reading the receipt…</p>
              <p className="text-xs text-muted-foreground">
                Everything it finds is yours to check before anything is saved.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <TransactionSheet
      open
      onOpenChange={(open) => !open && onDone()}
      scan={scan}
      onCreated={openSplit}
    />
  )
}
