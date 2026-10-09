import { useMemo } from 'react'
import { useCategories } from '@/lib/categories'
import { useHousehold } from '@/lib/HouseholdContext'
import { borneAmount, matchesPersonFilter, sharesByTransaction, type PersonFilter } from '@/lib/filters'
import { formatBaht } from '@/lib/format'
import { monthDayRangeLabel, monthShortLabel, monthsOfYear, yearLabel, yearRange } from '@/lib/month'
import { matchesRecordsFilter, type RecordsFilterState } from '@/lib/recordsFilter'
import { useTransactionShares } from '@/lib/transactionShares'
import { useTransactions } from '@/lib/transactions'
import { cn } from '@/lib/utils'

interface Props {
  year: string
  person: PersonFilter
  filter: RecordsFilterState
  onSelectMonth: (month: string) => void
}

// Records' Monthly tab (2026-09 grilling session): a year-at-a-time rollup,
// one row per calendar month, newest first — the reference the feature was
// specced from lists Dec down to Jan. Reuses the exact confirmed/system/
// person/filter rules RecordsSummary already applies to its own month, so a
// figure here and the one Daily shows for that same month never disagree.
export function MonthlyBreakdown({ year, person, filter, onSelectMonth }: Props) {
  const { householdId } = useHousehold()
  const range = useMemo(() => yearRange(year), [year])
  const { data: transactions } = useTransactions(householdId, range)
  const { data: categories } = useCategories(householdId)
  const { data: shares } = useTransactionShares(householdId)

  const categoryById = useMemo(() => new Map((categories ?? []).map((c) => [c.id, c])), [categories])
  const sharesByTxn = useMemo(() => sharesByTransaction(shares), [shares])

  const rows = useMemo(() => {
    const filtered = (transactions ?? []).filter(
      (t) =>
        t.confirmed &&
        !categoryById.get(t.category_id ?? '')?.system &&
        matchesPersonFilter(t, sharesByTxn, person) &&
        matchesRecordsFilter(t, filter),
    )
    const borneOf = (t: (typeof filtered)[number]) => (person === 'all' ? t.amount : borneAmount(t, sharesByTxn, person))

    return monthsOfYear(year).map((month) => {
      const inMonth = filtered.filter((t) => t.date.slice(0, 7) === month)
      const income = inMonth.filter((t) => t.kind === 'income').reduce((sum, t) => sum + borneOf(t), 0)
      const expense = inMonth.filter((t) => t.kind === 'expense').reduce((sum, t) => sum + borneOf(t), 0)
      return { month, income, expense }
    })
  }, [transactions, categoryById, sharesByTxn, person, filter, year])

  const yearIncome = rows.reduce((sum, r) => sum + r.income, 0)
  const yearExpense = rows.reduce((sum, r) => sum + r.expense, 0)

  return (
    <div className="space-y-3">
      <div className="px-1 pt-2">
        <p className="text-[13px] text-muted-foreground">Spent in {yearLabel(year)}</p>
        <p className="mt-1 text-[42px] font-semibold leading-none tracking-[-0.035em] tabular-nums">{formatBaht(yearExpense)}</p>
        <p className="mt-2.5 text-[13px] tabular-nums text-muted-foreground">
          In <span className="font-medium text-good">{formatBaht(yearIncome)}</span>
          <span className="mx-2 text-border">/</span>
          Net{' '}
          <span className={cn('font-medium', yearIncome - yearExpense >= 0 ? 'text-good' : 'text-destructive')}>
            {yearIncome - yearExpense >= 0 ? '+' : '−'}
            {formatBaht(Math.abs(yearIncome - yearExpense))}
          </span>
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        {rows.map((row, i) => {
          const net = row.income - row.expense
          return (
            <button
              key={row.month}
              type="button"
              onClick={() => onSelectMonth(row.month)}
              className={cn(
                'flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors active:bg-accent/60',
                i > 0 && 'border-t',
              )}
            >
              <span>
                <span className="block text-sm font-semibold">{monthShortLabel(row.month)}</span>
                <span className="block text-[11px] text-muted-foreground">{monthDayRangeLabel(row.month)}</span>
              </span>
              <span className="text-right">
                <span className="flex items-center gap-3 text-sm tabular-nums">
                  <span className="text-good">{formatBaht(row.income)}</span>
                  <span className="text-destructive">{formatBaht(row.expense)}</span>
                </span>
                <span className="block text-[11px] tabular-nums text-muted-foreground">
                  Total {net >= 0 ? '+' : ''}
                  {formatBaht(net)}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
