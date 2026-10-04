// An installment conversion shows on a statement as the purchase, then a credit
// that undoes it, then the periods. When both land in one import the staging
// rules cancel them. When the purchase went in with an earlier statement, the
// credit has nothing to cancel in this batch while the purchase is still in the
// ledger as an ordinary expense, which the plan's own periods would then count a
// second time. This finds that expense so the household can remove it.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { addDays } from './finance/billingCycle'
import { supabase } from './supabase'

export interface OrphanConversion {
  instrument: string
  date: string
  amount: number
  text: string
}

export interface SupersededCandidate {
  id: string
  date: string
  amount: number
  description: string
  note: string | null
}

/** How far back before the credit a purchase can be and still be the one it converted. */
export const LOOKBACK_DAYS = 120

/** Earlier expenses of exactly the credit's amount, nearest in time first. */
export function candidatesFor(orphan: Pick<OrphanConversion, 'date' | 'amount'>, rows: SupersededCandidate[]): SupersededCandidate[] {
  const earliest = addDays(orphan.date, -LOOKBACK_DAYS)
  return rows
    .filter((r) => Math.abs(r.amount - orphan.amount) < 0.005 && r.date <= orphan.date && r.date >= earliest)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
}

export interface OrphanWithCandidates {
  orphan: OrphanConversion
  candidates: SupersededCandidate[]
}

export function useSupersededCandidates(
  householdId: string,
  orphans: OrphanConversion[],
  instrumentIds: (name: string) => { accountId: string | null; cardId: string | null },
) {
  return useQuery({
    queryKey: ['superseded', householdId, JSON.stringify(orphans)],
    enabled: orphans.length > 0,
    queryFn: async (): Promise<OrphanWithCandidates[]> =>
      Promise.all(
        orphans.map(async (orphan) => {
          const { accountId, cardId } = instrumentIds(orphan.instrument)
          if (!accountId && !cardId) return { orphan, candidates: [] }
          let query = supabase
            .from('v_transactions')
            .select('id, date, amount, description, note')
            .eq('household_id', householdId)
            .eq('kind', 'expense')
            .neq('source', 'installment') // a plan's own periods are not what it replaced
            .eq('amount', orphan.amount)
            .gte('date', addDays(orphan.date, -LOOKBACK_DAYS))
            .lte('date', orphan.date)
          query = cardId ? query.eq('from_card_id', cardId) : query.eq('from_account_id', accountId!)
          const { data, error } = await query
          if (error) throw error
          return { orphan, candidates: candidatesFor(orphan, data as SupersededCandidate[]) }
        }),
      ),
  })
}

/** Soft-deletes the chosen expenses, which the installment plan now stands in for. */
export async function removeSuperseded(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { error } = await supabase.from('transactions').update({ deleted_at: new Date().toISOString() }).in('id', ids)
  if (error) throw error
}

export function useRefreshAfterSuperseding(householdId: string) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: ['transactions', householdId] })
}
