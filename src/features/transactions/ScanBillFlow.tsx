import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ReceiptSheet } from './ReceiptSheet'
import { TransactionSheet } from './TransactionSheet'
import { categoryPath, useCategories } from '@/lib/categories'
import { useHousehold } from '@/lib/HouseholdContext'
import { scanBill, type BillScan } from '@/lib/scanBill'

interface Props {
  file: File
  onDone: () => void
}

/**
 * Photograph → the receipt itself (ADR-0018).
 *
 * The first version routed a scan through the ordinary entry form and then on
 * to a split dialog, which cost two screens for one payment and gave the
 * household no sign on the first that a second was coming. Worse, the hand-off
 * could not work: the entry form closed itself in the same tick it announced
 * the new row, unmounting this component while the split it had just asked for
 * was still being fetched, so the split screen never appeared at all.
 *
 * Landing straight on the receipt removes the hand-off rather than fixing it.
 */
export function ScanBillFlow({ file, onDone }: Props) {
  const { householdId } = useHousehold()
  const { data: categories } = useCategories(householdId)
  const [scan, setScan] = useState<BillScan | null>(null)

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
    // Once per photo. `categories` is read at call time rather than depended
    // on, so a background refetch cannot re-scan the same image and bill for
    // it twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

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

  // One category is not a receipt, it is a payment that happened to be
  // photographed — so it goes to the ordinary form, which is what it is.
  if (!scan.lines) {
    return <TransactionSheet open onOpenChange={(open) => !open && onDone()} scan={scan} />
  }

  return (
    <ReceiptSheet
      draft={{ kind: 'scan', scan: { ...scan, lines: scan.lines } }}
      onClose={onDone}
    />
  )
}
