// Monthly statement import (ADR-0019). Turns the unmasked staged CSV into rows
// the review screen can show, each with an identity (source_key) so the same
// line uploaded twice, or two statements whose periods overlap, never inserts
// twice. Matching against hand-entered rows is only ever a suggestion: the
// household confirms it on screen.
import { supabase } from './supabase'
import { parseAmount, parseDate } from './import/values'
import type { TransactionKind, Transaction } from './transactions'
import type { Category } from './categories'
import { computeShareRows } from './transactionShares'

export type RowStatus = 'error' | 'imported' | 'match' | 'review' | 'new'

export interface StatementRow {
  line: number
  status: RowStatus
  issue: string | null
  date: string
  postedDate: string | null
  kind: TransactionKind
  amount: number
  note: string
  categoryId: string | null
  fromAccountId: string | null
  fromCardId: string | null
  toAccountId: string | null
  toCardId: string | null
  sourceKey: string
  /** CSV's Owner column as written (a member's name, "shared", or blank). */
  ownerHint: string
  /** For 'match': the hand-entered row the screen suggests this line is. */
  matchId: string | null
}

export interface StatementContext {
  accounts: { id: string; name: string }[]
  cards: { id: string; name: string }[]
  categories: Pick<Category, 'id' | 'name' | 'kind' | 'archived' | 'system'>[]
  existing: Pick<Transaction, 'id' | 'date' | 'amount' | 'source' | 'source_key' | 'from_account_id' | 'from_card_id'>[]
}

// Staging writes this into Details for an installment line whose plan the app
// doesn't have yet: it's shown, never imported — creating the plan posts it.
export const NEEDS_PLAN = 'needs-installment-plan'
const MATCH_WINDOW_DAYS = 3

// FNV-1a: stable, synchronous, and only has to tell descriptions apart within
// one instrument-date-amount bucket, not resist anyone.
function hash(text: string): string {
  let h = 0x811c9dc5
  for (const ch of text.normalize('NFC')) {
    h ^= ch.codePointAt(0)!
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000
}

export function buildStatementRows(rows: Record<string, string>[], ctx: StatementContext): StatementRow[] {
  const byName = <T extends { name: string }>(list: T[], name: string) => list.filter((x) => x.name.trim() === name.trim())
  const liveCategories = ctx.categories.filter((c) => !c.archived && !c.system)
  const existingKeys = new Set(ctx.existing.map((t) => t.source_key).filter(Boolean))
  const claimed = new Set<string>()
  const seen = new Map<string, number>()

  function instrument(name: string): { accountId: string | null; cardId: string | null; issue: string | null } {
    if (!name.trim()) return { accountId: null, cardId: null, issue: 'No account or card' }
    const a = byName(ctx.accounts, name)
    const c = byName(ctx.cards, name)
    if (a.length + c.length === 0) return { accountId: null, cardId: null, issue: `Unknown account or card "${name}"` }
    if (a.length + c.length > 1) return { accountId: null, cardId: null, issue: `"${name}" names more than one account or card` }
    return { accountId: a[0]?.id ?? null, cardId: c[0]?.id ?? null, issue: null }
  }

  return rows.map((raw, i) => {
    const issues: string[] = []
    const date = parseDate(raw['Date'] ?? '', 'dmy')
    if (!date) issues.push('Invalid date')
    const postedRaw = (raw['Posted date'] ?? '').trim()
    const postedDate = postedRaw ? parseDate(postedRaw, 'dmy') : null
    if (postedRaw && !postedDate) issues.push('Invalid posting date')
    const kind = (raw['Kind'] ?? '').trim() as TransactionKind
    if (!['income', 'expense', 'transfer'].includes(kind)) issues.push(`Invalid kind "${raw['Kind']}"`)
    const amount = parseAmount(raw['Amount'] ?? '')
    if (amount == null || amount <= 0) issues.push('Amount must be positive (a refund is income under Refund)')
    const note = (raw['Note'] ?? '').trim()

    const from = instrument(raw['Account or card'] ?? '')
    if (from.issue) issues.push(from.issue)
    let to = { accountId: null as string | null, cardId: null as string | null }
    if (kind === 'transfer') {
      const t = instrument(raw['To account or card'] ?? '')
      if (t.issue) issues.push(`Destination: ${t.issue}`)
      to = t
    }

    let categoryId: string | null = null
    const categoryName = (raw['Category'] ?? '').trim()
    if (kind !== 'transfer') {
      const matches = liveCategories.filter((c) => c.kind === kind && c.name === categoryName)
      if (matches.length === 1) categoryId = matches[0].id
      else issues.push(matches.length ? `Category "${categoryName}" is ambiguous` : `Unknown ${kind} category "${categoryName}"`)
    }

    if ((raw['Details'] ?? '').trim() === NEEDS_PLAN) issues.unshift('Installment with no plan in the app — create the plan first')

    const instr = kind === 'transfer' ? `${from.accountId ?? from.cardId}>${to.accountId ?? to.cardId}` : (from.accountId ?? from.cardId)
    const base = `stmt:${instr}:${date}:${(amount ?? 0).toFixed(2)}:${hash(note)}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    const sourceKey = `${base}:${n}`

    let status: RowStatus = 'new'
    let matchId: string | null = null
    if (issues.length) status = 'error'
    else if (existingKeys.has(sourceKey)) status = 'imported'
    else {
      const candidate = ctx.existing.find(
        (t) =>
          t.source === 'manual' &&
          !t.source_key &&
          !claimed.has(t.id) &&
          t.amount === amount &&
          (from.cardId ? t.from_card_id === from.cardId : t.from_account_id === from.accountId) &&
          daysBetween(t.date, date!) <= MATCH_WINDOW_DAYS,
      )
      if (candidate) {
        status = 'match'
        matchId = candidate.id
        claimed.add(candidate.id)
      } else if (categoryName === 'Other') status = 'review'
    }

    return {
      line: i + 2,
      status,
      issue: issues[0] ?? null,
      date: date ?? '',
      postedDate,
      kind,
      amount: amount ?? 0,
      note,
      categoryId,
      fromAccountId: from.accountId,
      fromCardId: from.cardId,
      toAccountId: to.accountId,
      toCardId: to.cardId,
      sourceKey,
      ownerHint: (raw['Owner'] ?? '').trim(),
      matchId,
    }
  })
}

/** Who bears a row: a member's id, or SHARED for an even split (D13). */
export const SHARED = 'shared'

export interface ApplyContext {
  categoryKindOf: (id: string) => 'income' | 'expense' | null
  /** The member an instrument belongs to (null = Common Pot) — the one who fronted the money. */
  instrumentOwnerOf: (accountId: string | null, cardId: string | null) => string | null
  memberIds: string[]
  /** line -> member id or SHARED */
  whoOf: (row: StatementRow) => string
}

/** Accepted new rows are inserted (ON CONFLICT DO NOTHING); confirmed matches update the hand-entered row. */
export async function applyStatementRows(
  householdId: string,
  rows: StatementRow[],
  { categoryKindOf, instrumentOwnerOf, memberIds, whoOf }: ApplyContext,
): Promise<{ inserted: number; matched: number }> {
  const ownerOf = (r: StatementRow) => {
    const who = whoOf(r)
    return who === SHARED ? null : who
  }
  const inserts = rows
    .filter((r) => !r.matchId)
    .map((r) => ({
      household_id: householdId,
      date: r.date,
      posted_date: r.postedDate,
      kind: r.kind,
      category_id: r.categoryId,
      category_kind: r.categoryId ? categoryKindOf(r.categoryId) : null,
      owner_id: ownerOf(r),
      description: '',
      amount: r.amount,
      from_account_id: r.fromAccountId,
      from_card_id: r.fromCardId,
      to_account_id: r.toAccountId,
      to_card_id: r.toCardId,
      note: r.note || null,
      source: 'import' as const,
      source_key: r.sourceKey,
    }))
  if (inserts.length) {
    const { data, error } = await supabase
      .from('transactions')
      .upsert(inserts, { onConflict: 'household_id,source_key', ignoreDuplicates: true })
      .select('id, source_key')
    if (error) throw error
    // Splits for the rows that actually went in (a skipped duplicate returns nothing).
    const byKey = new Map(rows.map((r) => [r.sourceKey, r]))
    const shares = (data ?? []).flatMap(({ id, source_key }) => {
      const r = byKey.get(source_key)!
      return computeShareRows({
        kind: r.kind,
        ownerId: ownerOf(r),
        frontingMemberId: instrumentOwnerOf(r.fromAccountId, r.fromCardId),
        amount: r.amount,
        memberIds,
      }).map((s) => ({ household_id: householdId, transaction_id: id, ...s }))
    })
    if (shares.length) {
      const { error: shareError } = await supabase.from('transaction_shares').insert(shares)
      if (shareError) throw shareError
    }
  }
  const matches = rows.filter((r) => r.matchId)
  for (const r of matches) {
    // Keeps the household's category, note and shares; the statement is right about money and dates.
    const { error } = await supabase
      .from('transactions')
      .update({ source_key: r.sourceKey, amount: r.amount, date: r.date, posted_date: r.postedDate })
      .eq('id', r.matchId!)
    if (error) throw error
  }
  return { inserted: inserts.length, matched: matches.length }
}
