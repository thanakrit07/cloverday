import { periodDate } from './finance/billingCycle'
import type { Installment } from './installments'
import { supabase } from './supabase'
import { applyRatioSplit, computeShareRows } from './transactionShares'

// DESIGN.md §6.7/§4.5 (D11): an installment plan writes **every** period as
// a real transaction the moment the plan exists — not just the periods due
// so far. A 10-period plan is ten known, dated, unavoidable charges; hiding
// the future ones made them invisible in the months they actually land,
// which is the whole reason a plan is entered in the first place.
//
// Whether a period has been *settled* is a separate question from whether it
// has been *posted*: settlement is an `installment_payments` event, written
// by ticking the period's checkbox in the ledger (card-billed plans) or the
// "mark period paid" button (account-billed). So the materialiser never
// writes payment rows — it only posts the charge.
//
// Idempotency: each posted period gets source_key = "installment:<id>:<n>",
// covered by the (household_id, source_key) unique constraint (0014), so a
// concurrent run from the other phone resolves to a no-op rather than a
// duplicate charge.

/** The `source_key` a given period's transaction carries. */
export function periodSourceKey(installmentId: string, periodNo: number): string {
  return `${periodSourceKeyPrefix(installmentId)}${periodNo}`
}

/**
 * The ledger label a period is posted with.
 *
 * One definition, because D15's rename rule works by *recognising* a label
 * this function produced: a note that still reads exactly as it was posted is
 * generated, anything else has been edited by hand and is not ours to
 * overwrite. Two copies of this template drifting apart would turn every
 * posted period into a hand-edited one.
 */
export function periodNote(name: string, periodNo: number, totalPeriods: number): string {
  return `${name} (งวดที่ ${periodNo}/${totalPeriods})`
}

/** Every period of one plan, for a prefix match on `source_key`. */
export function periodSourceKeyPrefix(installmentId: string): string {
  return `installment:${installmentId}:`
}

/** Inverse of `periodSourceKey`; null when the key isn't an installment one. */
export function parsePeriodSourceKey(
  sourceKey: string | null,
): { installmentId: string; periodNo: number } | null {
  if (!sourceKey) return null
  const [tag, installmentId, periodNoStr] = sourceKey.split(':')
  if (tag !== 'installment' || !installmentId) return null
  const periodNo = Number(periodNoStr)
  return Number.isFinite(periodNo) ? { installmentId, periodNo } : null
}

export async function materialiseInstallmentsDue(
  householdId: string,
  installments: Installment[],
): Promise<number> {
  const active = installments.filter((i) => i.status === 'active' && (i.card_id || i.account_id))
  if (active.length === 0) return 0

  const [{ data: existing, error: existingError }, { data: members, error: membersError }, { data: cards, error: cardsError }, { data: accounts, error: accountsError }] =
    await Promise.all([
      supabase.from('transactions').select('source_key').eq('household_id', householdId).eq('source', 'installment').is('deleted_at', null),
      supabase.from('household_members').select('id').eq('household_id', householdId),
      supabase.from('cards').select('id, owner_id').eq('household_id', householdId),
      supabase.from('accounts').select('id, owner_id').eq('household_id', householdId),
    ])
  if (existingError) throw existingError
  if (membersError) throw membersError
  if (cardsError) throw cardsError
  if (accountsError) throw accountsError

  const postedSet = new Set((existing ?? []).map((t) => t.source_key as string))
  // D13: who fronted the money for each plan's own instrument, and who's in
  // the household to split between — fetched once, reused for every period
  // of every plan in this run.
  const memberIds = (members ?? []).map((m) => m.id as string)
  const cardOwner = new Map((cards ?? []).map((c) => [c.id as string, c.owner_id as string | null]))
  const accountOwner = new Map((accounts ?? []).map((a) => [a.id as string, a.owner_id as string | null]))

  let posted = 0
  for (const inst of active) {
    const cardBilled = Boolean(inst.card_id)

    // An expense must carry a category (transactions' category_iff_not_transfer
    // check), but a plan can be saved without one. Skipping the plan keeps a
    // single un-categorised plan from failing the batch and stalling posting
    // for every other plan — which is exactly what happened in production.
    if (!inst.category_id) {
      console.warn(`Installment "${inst.name}" has no category; its periods cannot post until one is set.`)
      continue
    }

    const rows: Record<string, unknown>[] = []
    for (let n = 1; n <= inst.total_periods; n++) {
      const sourceKey = periodSourceKey(inst.id, n)
      if (postedSet.has(sourceKey)) continue

      rows.push({
        household_id: householdId,
        date: periodDate(inst.start_date, n),
        kind: 'expense',
        category_id: inst.category_id,
        category_kind: 'expense',
        // note, not description: note is the ledger's primary label (0020).
        // No description key here — every row in this batch omits it
        // uniformly, so PostgREST leaves the column to its NOT NULL default
        // rather than sending an explicit null.
        note: periodNote(inst.name, n, inst.total_periods),
        amount: n === inst.total_periods && inst.final_amount != null ? inst.final_amount : inst.monthly_amount,
        owner_id: inst.owner_id,
        from_card_id: cardBilled ? inst.card_id : null,
        from_account_id: cardBilled ? null : inst.account_id,
        source: 'installment',
        source_key: sourceKey,
        // Posted, not settled — these are scheduled charges the user already
        // committed to, so they don't need a second review tap. The paid
        // checkbox is what tracks settlement.
        confirmed: true,
      })
    }

    if (rows.length === 0) continue

    // Per plan, not one batch for all: a row Postgres refuses aborts the whole
    // statement, so batching every plan together lets one bad plan block
    // posting for all of them. upsert-ignore rather than insert because a
    // period may have been posted by the other device mid-run. .select()
    // after ignoreDuplicates returns only the periods genuinely posted this
    // run — the only ones that need a fresh Split (D13).
    const { data: inserted, error } = await supabase
      .from('transactions')
      .upsert(rows, { onConflict: 'household_id,source_key', ignoreDuplicates: true })
      .select('id, source_key')
    if (error) {
      console.error(`Could not post periods for installment "${inst.name}"`, error)
      continue
    }
    posted += rows.length

    const frontingMemberId = cardBilled
      ? (cardOwner.get(inst.card_id as string) ?? null)
      : (accountOwner.get(inst.account_id as string) ?? null)
    const amountBySourceKey = new Map(rows.map((r) => [r.source_key as string, r.amount as number]))
    const shareRowsToInsert = (inserted ?? []).flatMap((t) => {
      const amount = amountBySourceKey.get(t.source_key as string)
      if (amount == null) return []
      return computeShareRows({
        kind: 'expense',
        ownerId: inst.owner_id,
        frontingMemberId,
        amount,
        memberIds,
        // Applied per period, not once for the plan: the final period's
        // amount differs (ADR-0001's rounding remainder), and each period
        // must stay proportional to what it actually charges, not to the
        // plan's nominal monthly figure.
        custom: inst.split ? applyRatioSplit(inst.split, amount) : undefined,
      }).map((r) => ({
        household_id: householdId,
        transaction_id: t.id as string,
        ...r,
      }))
    })
    if (shareRowsToInsert.length > 0) {
      const { error: shareError } = await supabase.from('transaction_shares').insert(shareRowsToInsert)
      if (shareError) console.error(`Could not write shares for installment "${inst.name}"`, shareError)
    }
  }

  return posted
}

// ---------------------------------------------------------------------------
// Renaming a plan (D15, amended v4.3)
//
// A plan is still immutable in every way that involves money: changing its
// amount, count, start date, category or instrument stops at the `installments`
// row, because working out which posted period may follow an edit — due, paid,
// hand-edited, already settled up — is the propagation problem D15 exists to
// refuse. The name is not that. It moves nothing, so it propagates to every
// period the plan posted, settled ones included: a ledger listing the same debt
// under two names is worse than one that renames its own history.
//
// **The guard recognises the shape of a generated label, not one particular
// name.** The first version compared each note against the name the plan was
// being renamed *from*, which quietly excluded the plans that needed this most:
// one renamed before this shipped has periods carrying a name the plan no
// longer holds, so nothing matched and no later rename could ever repair it.
// A label this app wrote ends in `(งวดที่ n/total)` with an `n` that agrees
// with the row's own `source_key`; a note somebody typed does not. Matching on
// that lets a drifted plan come back into line while still leaving hand-written
// notes alone.

/** What `periodsToRename` needs off a posted period; the query selects exactly this. */
export interface PostedPeriodNote {
  id: string
  source_key: string | null
  note: string | null
}

/** The label the plan should be carrying now. */
export interface PeriodLabel {
  name: string
  totalPeriods: number
}

// Anchored at both ends, so a note that merely mentions a period somewhere in
// the middle is not mistaken for a generated one. The name is `(.*)` because it
// is whatever the plan was called at the time -- possibly a name that has since
// been changed twice, which is exactly the case the first version missed.
const GENERATED_NOTE = /^(.*) \(งวดที่ (\d+)\/(\d+)\)$/

/**
 * True when this note is one `periodNote` wrote for this very period.
 *
 * The period number inside the label has to agree with the one in the row's
 * `source_key`: that is what a coincidence would fail, and it costs nothing.
 */
export function isGeneratedPeriodNote(note: string | null, periodNo: number): boolean {
  const match = note?.match(GENERATED_NOTE)
  return match != null && Number(match[2]) === periodNo
}

/**
 * Which posted periods a save may relabel, and to what.
 *
 * Pure, so the recognition rule can be tested without a database: rows whose
 * note has been hand-written, rows belonging to another plan, and rows that
 * already read correctly all drop out here.
 */
export function periodsToRename(
  rows: PostedPeriodNote[],
  installmentId: string,
  target: PeriodLabel,
): { id: string; note: string }[] {
  const updates: { id: string; note: string }[] = []
  for (const row of rows) {
    const parsed = parsePeriodSourceKey(row.source_key)
    if (!parsed || parsed.installmentId !== installmentId) continue
    if (!isGeneratedPeriodNote(row.note, parsed.periodNo)) continue
    const note = periodNote(target.name, parsed.periodNo, target.totalPeriods)
    if (note === row.note) continue
    updates.push({ id: row.id, note })
  }
  return updates
}

/**
 * Brings the notes on every period this plan posted back in line with the plan.
 *
 * Returns how many rows were rewritten. Never throws for a row it could not
 * update: the plan itself has already been saved by the time this runs, and a
 * label failing to catch up is not a reason to tell the user their edit failed.
 */
export async function renameInstallmentPeriods(
  householdId: string,
  installmentId: string,
  target: PeriodLabel,
): Promise<number> {
  const { data, error } = await supabase
    .from('transactions')
    .select('id, source_key, note')
    .eq('household_id', householdId)
    .eq('source', 'installment')
    .like('source_key', `${periodSourceKeyPrefix(installmentId)}%`)
    .is('deleted_at', null)
  if (error) throw error

  const updates = periodsToRename((data ?? []) as PostedPeriodNote[], installmentId, target)
  if (updates.length === 0) return 0

  // One statement per row, since each carries its own period number. A plan is
  // tens of periods at most, and they are independent — one failing leaves the
  // rest correctly renamed rather than taking them down with it.
  const results = await Promise.all(
    updates.map((u) => supabase.from('transactions').update({ note: u.note }).eq('id', u.id)),
  )
  const failed = results.filter((r) => r.error)
  if (failed.length > 0) {
    console.error(`Could not rename ${failed.length} posted period(s)`, failed[0].error)
  }
  return updates.length - failed.length
}
