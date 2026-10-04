import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, subDays } from 'date-fns'
import type { CategoryKind } from './categories'
import { supabase } from './supabase'

// D27 / ADR-0021: a Preset fills the entry form in one tap — a category, and
// optionally a note, an instrument and an amount. It never saves anything by
// itself; the form's Save does.
export interface Preset {
  id: string
  member_id: string
  name: string
  kind: CategoryKind
  category_id: string
  note: string | null
  account_id: string | null
  card_id: string | null
  amount: number | null
  sort_order: number
}

export type PresetInput = Omit<Preset, 'id' | 'member_id' | 'sort_order'>

export function usePresets(householdId: string, memberId: string) {
  return useQuery({
    queryKey: ['presets', householdId, memberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('entry_presets')
        .select('id, member_id, name, kind, category_id, note, account_id, card_id, amount, sort_order')
        .eq('member_id', memberId)
        .order('sort_order')
        .order('created_at')
      if (error) throw error
      // numeric comes back as a string from PostgREST.
      return data.map((p) => ({ ...p, amount: p.amount == null ? null : Number(p.amount) })) as Preset[]
    },
  })
}

function useInvalidatePresets(householdId: string) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: ['presets', householdId] })
}

export function useCreatePreset(householdId: string, memberId: string) {
  const queryClient = useQueryClient()
  const invalidate = useInvalidatePresets(householdId)
  return useMutation({
    // Appended at the end: sort_order is only ever compared within one
    // member's list, so "after the largest" is enough.
    mutationFn: async (input: PresetInput) => {
      const current = queryClient.getQueryData<Preset[]>(['presets', householdId, memberId]) ?? []
      const sortOrder = Math.max(-1, ...current.map((p) => p.sort_order)) + 1
      const { error } = await supabase
        .from('entry_presets')
        .insert({ ...input, household_id: householdId, member_id: memberId, sort_order: sortOrder })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useUpdatePreset(householdId: string) {
  const invalidate = useInvalidatePresets(householdId)
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: PresetInput }) => {
      const { error } = await supabase.from('entry_presets').update(input).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useDeletePreset(householdId: string) {
  const invalidate = useInvalidatePresets(householdId)
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('entry_presets').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

// Same shape as useReorderCategories: write each row's new index after a drag.
export function useReorderPresets(householdId: string) {
  const invalidate = useInvalidatePresets(householdId)
  return useMutation({
    mutationFn: async (ordered: Preset[]) => {
      await Promise.all(ordered.map((p, i) => supabase.from('entry_presets').update({ sort_order: i }).eq('id', p.id)))
    },
    onSuccess: invalidate,
  })
}

export interface HistoryRow {
  kind: string
  category_id: string | null
  note: string | null
  amount: number
  from_account_id: string | null
  from_card_id: string | null
}

const MIN_REPEATS = 3
const MAX_SUGGESTIONS = 5

function noteKey(note: string | null): string {
  return (note ?? '').trim().toLowerCase()
}

/**
 * Suggested presets: what this person has recorded at least three times with
 * the same category and note. The instrument is the most recent one used; the
 * amount only when every occurrence was the same (a ฿40 motorbike taxi, not a
 * coffee that's ฿65 one day and ฿80 the next). Anything already a preset is
 * left out. `rows` must be newest-first.
 */
export function suggestPresets(rows: HistoryRow[], existing: Pick<Preset, 'category_id' | 'note'>[]): PresetInput[] {
  const taken = new Set(existing.map((p) => `${p.category_id}|${noteKey(p.note)}`))
  const groups = new Map<string, { first: HistoryRow; count: number; amounts: Set<number> }>()
  for (const row of rows) {
    if (!row.category_id || (row.kind !== 'expense' && row.kind !== 'income')) continue
    const key = `${row.category_id}|${noteKey(row.note)}`
    if (taken.has(key)) continue
    const group = groups.get(key)
    if (group) {
      group.count++
      group.amounts.add(Number(row.amount))
    } else {
      groups.set(key, { first: row, count: 1, amounts: new Set([Number(row.amount)]) })
    }
  }
  return [...groups.values()]
    .filter((g) => g.count >= MIN_REPEATS)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_SUGGESTIONS)
    .map(({ first, amounts }) => {
      const note = first.note?.trim() || null
      return {
        name: note ?? '',
        kind: first.kind as CategoryKind,
        category_id: first.category_id!,
        note,
        account_id: first.from_account_id,
        card_id: first.from_card_id,
        amount: amounts.size === 1 ? [...amounts][0] : null,
      }
    })
}

/** The last 90 days of this person's own entries, newest first — the input to suggestPresets. */
export function usePresetHistory(householdId: string, memberId: string) {
  return useQuery({
    queryKey: ['preset-history', householdId, memberId],
    queryFn: async (): Promise<HistoryRow[]> => {
      const since = format(subDays(new Date(), 90), 'yyyy-MM-dd')
      const { data, error } = await supabase
        .from('v_transactions')
        .select('kind, category_id, note, amount, from_account_id, from_card_id')
        .eq('household_id', householdId)
        .eq('owner_id', memberId)
        .not('category_id', 'is', null)
        .gte('date', since)
        .order('date', { ascending: false })
        .limit(1000)
      if (error) throw error
      return data as HistoryRow[]
    },
    staleTime: 60_000,
  })
}
