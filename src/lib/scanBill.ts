import { supabase } from './supabase'

// ADR-0017. The scan proposes; the household confirms; the code that already
// exists writes. Nothing in this file touches the database.

/** What the Edge Function's schema guarantees back. Values are still unchecked. */
interface RawScan {
  merchant: string
  date: string
  total: number
  lines: { category_id: string | null; amount: number; items: string[] }[]
}

/** A line as `SplitReceiptDialog` holds it: index 0's amount is derived, not typed. */
export interface DraftLine {
  categoryId: string | null
  /** Blank on the remainder line — the dialog computes it. */
  amount: string
  description: string
}

export interface BillScan {
  /** Suggested receipt name and transaction note. */
  merchant: string
  /** yyyy-mm-dd, or null when the slip showed none we could use. */
  date: string | null
  /** What was charged. The dialog treats this as authoritative. */
  total: number
  /**
   * Lines for the split form, or null when the scan produced fewer than the
   * two a Receipt needs — in which case the payment is recorded as an ordinary
   * one-category transaction, which is the correct outcome, not a failure.
   */
  lines: DraftLine[] | null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Turns what the model returned into what the split form holds.
 *
 * Pure, and the place every value is checked. The schema guarantees the
 * *shape* of the response; nothing guarantees the model named a category that
 * exists or an amount that makes sense, so both are verified here rather than
 * trusted into a form the household is about to press Save on.
 *
 * **The largest line becomes the remainder line.** `SplitReceiptDialog` derives
 * its first line's amount as the total less everything itemised below it, which
 * is what makes an invalid split unrepresentable there. That same property is
 * what absorbs an OCR shortfall — discounts, VAT and rounding land on one line
 * automatically — and putting the largest line in that slot puts the difference
 * where it is proportionally smallest and least likely to be read as wrong.
 */
export function toDraftLines(
  raw: Pick<RawScan, 'total' | 'lines'>,
  validCategoryIds: ReadonlySet<string>,
): DraftLine[] | null {
  const usable = raw.lines
    .filter((l) => Number.isFinite(l.amount) && l.amount > 0)
    // An id the household does not have is dropped to null, never repaired by
    // guessing at a near match: the blank is visible and a wrong category is not.
    .map((l) => ({
      categoryId: l.category_id && validCategoryIds.has(l.category_id) ? l.category_id : null,
      amount: Math.round(l.amount * 100) / 100,
      description: l.items.filter(Boolean).join(', '),
    }))
    .sort((a, b) => b.amount - a.amount)

  // Two lines is what `split_transaction_into_receipt` requires, and one line
  // is not a receipt — it is an ordinary transaction that happens to have been
  // photographed.
  if (usable.length < 2) return null

  // Itemising every line would leave the remainder line at zero whenever the
  // slip reconciles exactly, which the dialog rejects ("the lines below add up
  // to more than …"). The largest line gives up its typed amount to become the
  // remainder instead.
  const [largest, ...rest] = usable
  return [
    { categoryId: largest.categoryId, amount: '', description: largest.description },
    ...rest.map((l) => ({ ...l, amount: l.amount.toFixed(2) })),
  ]
}

/** Whatever of a scanned date we can actually use; null rather than today's date. */
export function toIsoDate(value: string): string | null {
  return ISO_DATE.test(value) ? value : null
}

/**
 * Shrinks a photo to the long edge this model tier reads at.
 *
 * Haiku 4.5 caps images at 1568px on the long edge and downscales anything
 * larger itself, so a 12-megapixel phone photo buys no accuracy — it just
 * spends seconds of upload on pixels the API is about to throw away. Moving to
 * a tier with high-resolution vision (2576px) means raising this number too.
 */
export async function downscale(file: File, maxEdge = 1568): Promise<{ base64: string; mediaType: 'image/jpeg' }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not read that photo.')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85),
  )
  if (!blob) throw new Error('Could not read that photo.')

  const buffer = await blob.arrayBuffer()
  // Chunked rather than String.fromCharCode(...bytes): a spread of a
  // multi-hundred-kilobyte array overflows the call stack on Safari.
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return { base64: btoa(binary), mediaType: 'image/jpeg' }
}

export async function scanBill(
  file: File,
  categories: { id: string; path: string }[],
): Promise<BillScan> {
  const { base64, mediaType } = await downscale(file)
  const { data, error } = await supabase.functions.invoke<RawScan & { error?: string }>('scan-bill', {
    body: { image: base64, mediaType, categories },
  })
  // The function answers a refusal or an unreadable photo with a message meant
  // for the household; surface it rather than a generic failure.
  if (error) throw new Error(data?.error ?? 'Could not read that photo.')
  if (!data || data.error) throw new Error(data?.error ?? 'Could not read that photo.')
  if (!Number.isFinite(data.total) || data.total <= 0) {
    throw new Error('Could not find a total on that receipt.')
  }

  return {
    merchant: data.merchant?.trim() ?? '',
    date: toIsoDate(data.date ?? ''),
    total: Math.round(data.total * 100) / 100,
    lines: toDraftLines(data, new Set(categories.map((c) => c.id))),
  }
}
