// What the app remembers about statements (ADR-0020, migration 0034): which
// files it has seen, who a name on a transfer line is, and what a description
// usually is. The database parts are thin; what is worth testing is pure.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { normalizeStatementText, type CounterpartyRule } from './statementImport'

// ---- files seen ------------------------------------------------------------

export interface StatementFile {
  id: string
  file_name: string
  sha256: string
  period_start: string | null
  period_end: string | null
  account_id: string | null
  card_id: string | null
  row_count: number
  uploaded_at: string
}

export function useStatementFiles(householdId: string) {
  return useQuery({
    queryKey: ['statement_files', householdId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('statement_files')
        .select('id, file_name, sha256, period_start, period_end, account_id, card_id, row_count, uploaded_at')
        .eq('household_id', householdId)
        .order('uploaded_at', { ascending: false })
      if (error) throw error
      return data as StatementFile[]
    },
  })
}

export interface NewStatementFile {
  fileName: string
  sha256: string
  periodStart: string | null
  periodEnd: string | null
  accountId: string | null
  cardId: string | null
  rowCount: number
}

/** A file already on record (same hash) is left as it is. */
export async function recordStatementFiles(householdId: string, uploadedBy: string, files: NewStatementFile[]): Promise<void> {
  if (files.length === 0) return
  const { error } = await supabase.from('statement_files').upsert(
    files.map((f) => ({
      household_id: householdId,
      file_name: f.fileName,
      sha256: f.sha256,
      period_start: f.periodStart,
      period_end: f.periodEnd,
      account_id: f.accountId,
      card_id: f.cardId,
      row_count: f.rowCount,
      uploaded_by: uploadedBy,
    })),
    { onConflict: 'household_id,sha256', ignoreDuplicates: true },
  )
  if (error) throw error
}

/** Hex SHA-256 of the file's bytes. Not personal: it only recognises the same file again. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Some banks put the full card number in the file name; it is never kept. */
export const safeFileName = (name: string) => name.replace(/\d{12,}/g, '…').slice(0, 200)

// ---- coverage --------------------------------------------------------------

const monthOf = (iso: string) => iso.slice(0, 7)

function monthsBetween(first: string, last: string): string[] {
  const out: string[] = []
  let [y, m] = first.split('-').map(Number)
  const [ly, lm] = last.split('-').map(Number)
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    if (++m > 12) {
      m = 1
      y++
    }
  }
  return out
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const label = (month: string) => `${MONTH_NAMES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`

/** "Jul 2026 – Aug 2026" for consecutive months, single months as they are. */
export function compressMonths(months: string[]): string[] {
  const runs: string[][] = []
  for (const m of months) {
    const run = runs[runs.length - 1]
    if (run && monthsBetween(run[run.length - 1], m).length === 2) run.push(m)
    else runs.push([m])
  }
  return runs.map((r) => (r.length === 1 ? label(r[0]) : `${label(r[0])} – ${label(r[r.length - 1])}`))
}

export interface Coverage {
  first: string
  last: string
  missing: string[]
}

/** Months between a card or account's first and last uploaded statement that no statement covers. */
export function coverageOf(files: Pick<StatementFile, 'period_start' | 'period_end'>[]): Coverage | null {
  const dated = files.filter((f) => f.period_start && f.period_end)
  if (dated.length === 0) return null
  const covered = new Set(dated.flatMap((f) => monthsBetween(monthOf(f.period_start!), monthOf(f.period_end!))))
  const sorted = [...covered].sort()
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  return { first, last, missing: monthsBetween(first, last).filter((m) => !covered.has(m)) }
}

export function describeCoverage(c: Coverage): string {
  const span = c.first === c.last ? label(c.first) : `${label(c.first)} – ${label(c.last)}`
  return c.missing.length ? `${span} · missing ${compressMonths(c.missing).join(', ')}` : span
}

// ---- who a name is ---------------------------------------------------------

export interface CounterpartyRow {
  id: string
  name_key: string
  role: 'own_account' | 'member' | 'merchant'
  account_id: string | null
  card_id: string | null
  member_id: string | null
  category_id: string | null
}

export function useCounterparties(householdId: string) {
  return useQuery({
    queryKey: ['counterparties', householdId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('counterparties')
        .select('id, name_key, role, account_id, card_id, member_id, category_id')
        .eq('household_id', householdId)
      if (error) throw error
      return data as CounterpartyRow[]
    },
  })
}

export interface Names {
  accounts: { id: string; name: string }[]
  cards: { id: string; name: string }[]
  members: { id: string; display_name: string }[]
  categories: { id: string; name: string }[]
}

/** Stored rows as the rules applyCounterparties reads; one whose target no longer exists is left out. */
export function rulesFromRows(rows: CounterpartyRow[], names: Names): Map<string, CounterpartyRule> {
  const out = new Map<string, CounterpartyRule>()
  for (const r of rows) {
    if (r.role === 'own_account') {
      const target = names.accounts.find((a) => a.id === r.account_id)?.name ?? names.cards.find((c) => c.id === r.card_id)?.name
      if (target) out.set(r.name_key, { role: 'own_account', target })
    } else if (r.role === 'member') {
      const memberName = names.members.find((m) => m.id === r.member_id)?.display_name
      if (memberName) out.set(r.name_key, { role: 'member', memberName })
    } else {
      const category = names.categories.find((c) => c.id === r.category_id)?.name
      if (category) out.set(r.name_key, { role: 'merchant', category })
    }
  }
  return out
}

export type CounterpartyAnswer =
  | { role: 'own_account'; accountId: string | null; cardId: string | null }
  | { role: 'member'; memberId: string }
  | { role: 'merchant'; categoryId: string }

/** One answer for any number of names, saved together. */
export function useSaveCounterparties(householdId: string, createdBy: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ names, answer }: { names: string[]; answer: CounterpartyAnswer }) => {
      const keys = [...new Set(names.map(normalizeStatementText))]
      const { error } = await supabase.from('counterparties').upsert(
        keys.map((name_key) => ({
          household_id: householdId,
          name_key,
          role: answer.role,
          account_id: answer.role === 'own_account' ? answer.accountId : null,
          card_id: answer.role === 'own_account' ? answer.cardId : null,
          member_id: answer.role === 'member' ? answer.memberId : null,
          category_id: answer.role === 'merchant' ? answer.categoryId : null,
          created_by: createdBy,
        })),
        { onConflict: 'household_id,name_key' },
      )
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['counterparties', householdId] }),
  })
}

// ---- what a description usually is ------------------------------------------

export interface HintRow {
  text_key: string
  category_id: string
  uses: number
}

/** For each description, the category it was most often given. */
export function hintMap(rows: HintRow[], categoryName: (id: string) => string | undefined): Map<string, string> {
  const best = new Map<string, HintRow>()
  for (const r of rows) {
    const current = best.get(r.text_key)
    if (!current || r.uses > current.uses) best.set(r.text_key, r)
  }
  const out = new Map<string, string>()
  for (const [key, r] of best) {
    const name = categoryName(r.category_id)
    if (name) out.set(key, name)
  }
  return out
}

const PAGE = 1000

/** The view already groups, but a household's years of descriptions can still pass the API's 1,000-row page. */
export function useCategoryHints(householdId: string) {
  return useQuery({
    queryKey: ['category_hints', householdId],
    queryFn: async () => {
      const all: HintRow[] = []
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('v_category_hints')
          .select('text_key, category_id, uses')
          .eq('household_id', householdId)
          .order('text_key')
          .order('category_id')
          .range(from, from + PAGE - 1)
        if (error) throw error
        all.push(...(data as HintRow[]))
        if (data.length < PAGE) return all
      }
    },
  })
}
