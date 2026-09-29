import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useAccounts } from '@/lib/accounts'
import { useCards } from '@/lib/cards'
import { useCategories } from '@/lib/categories'
import { addDays } from '@/lib/finance/billingCycle'
import { formatBaht } from '@/lib/format'
import { useHousehold } from '@/lib/HouseholdContext'
import { parseCsvText } from '@/lib/import/parseCsv'
import { applyStatementRows, buildStatementRows, type StatementRow } from '@/lib/statementImport'
import { useTransactions } from '@/lib/transactions'
import { cn } from '@/lib/utils'

type Tab = 'review' | 'new' | 'imported'
const TAB_OF: Record<StatementRow['status'], Tab> = { error: 'review', match: 'review', review: 'review', new: 'new', imported: 'imported' }
const TAB_LABEL: Record<Tab, string> = { review: 'Needs review', new: 'New', imported: 'Already imported' }

// ADR-0019: the unmasked statement CSV is read here in the browser and written
// only on Apply. Nothing is accepted by default — "Accept all" is one tap.
export function StatementImportScreen({ onClose }: { onClose: () => void }) {
  const { householdId } = useHousehold()
  const queryClient = useQueryClient()
  const { data: accounts } = useAccounts(householdId)
  const { data: cards } = useCards(householdId)
  const { data: categories } = useCategories(householdId)
  const [csvRows, setCsvRows] = useState<Record<string, string>[] | null>(null)
  const [tab, setTab] = useState<Tab>('review')
  const [accepted, setAccepted] = useState<Set<number>>(new Set())
  const [categoryOverride, setCategoryOverride] = useState<Map<number, string>>(new Map())
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [applying, setApplying] = useState(false)

  // Existing rows around the file's dates, for keys already imported and hand-entered matches.
  const range = useMemo(() => {
    const dates = (csvRows ?? []).map((r) => r['Date']?.split('/').reverse().join('-')).filter(Boolean).sort()
    return dates.length ? { start: addDays(dates[0], -3), end: addDays(dates[dates.length - 1], 3) } : { start: '', end: '' }
  }, [csvRows])
  const { data: existing } = useTransactions(householdId, range)

  const rows = useMemo(() => {
    if (!csvRows || !accounts || !cards || !categories || !existing) return null
    return buildStatementRows(csvRows, { accounts, cards, categories, existing })
  }, [csvRows, accounts, cards, categories, existing])

  const liveCategories = useMemo(() => (categories ?? []).filter((c) => !c.archived && !c.system), [categories])
  const categoryById = useMemo(() => new Map((categories ?? []).map((c) => [c.id, c])), [categories])
  const instrumentName = (accountId: string | null, cardId: string | null) =>
    (accounts ?? []).find((a) => a.id === accountId)?.name ?? (cards ?? []).find((c) => c.id === cardId)?.name ?? '—'

  if (!csvRows) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 p-4 text-sm">
        <p>Pick <code>statements/raw/final/transactions.csv</code> (after <code>npm run statements:unmask</code>). It is read on this device only; nothing is saved until you press Apply.</p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (file) setCsvRows(parseCsvText(await file.text()).rows)
          }}
        />
      </div>
    )
  }
  if (!rows) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>

  const visible = rows.filter((r) => TAB_OF[r.status] === tab)
  const actionable = (r: StatementRow) => r.status !== 'error' && r.status !== 'imported'
  const effective = (r: StatementRow): StatementRow => {
    const categoryId = categoryOverride.get(r.line)
    return categoryId ? { ...r, categoryId } : r
  }
  const toApply = rows.filter((r) => actionable(r) && accepted.has(r.line)).map(effective)

  function update(lines: number[], accept: boolean) {
    setAccepted((prev) => {
      const next = new Set(prev)
      for (const l of lines) {
        if (accept) next.add(l)
        else next.delete(l)
      }
      return next
    })
  }
  function setCategory(lines: number[], categoryId: string) {
    setCategoryOverride((prev) => new Map([...prev, ...lines.map((l) => [l, categoryId] as const)]))
  }
  const selectedLines = visible.filter((r) => selected.has(r.line) && actionable(r)).map((r) => r.line)

  async function apply() {
    setApplying(true)
    try {
      const result = await applyStatementRows(householdId, toApply, (id) => categoryById.get(id)?.kind ?? null)
      await queryClient.invalidateQueries({ queryKey: ['transactions', householdId] })
      toast.success(`Imported ${result.inserted}, confirmed ${result.matched} matches`)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b p-2">
        {(['review', 'new', 'imported'] as Tab[]).map((t) => (
          <Button key={t} size="sm" variant={tab === t ? 'default' : 'ghost'} onClick={() => { setTab(t); setSelected(new Set()) }}>
            {TAB_LABEL[t]} ({rows.filter((r) => TAB_OF[r.status] === t).length})
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{toApply.length} to apply</span>
          <Button size="sm" disabled={!toApply.length || applying} onClick={apply}>
            {applying ? 'Applying…' : 'Apply'}
          </Button>
        </div>
      </div>

      {tab !== 'imported' && (
        <div className="flex flex-wrap items-center gap-2 border-b p-2 text-xs">
          {tab === 'new' && (
            <Button size="sm" variant="outline" onClick={() => update(visible.filter(actionable).map((r) => r.line), true)}>
              Accept all
            </Button>
          )}
          <span className="text-muted-foreground">{selectedLines.length} selected:</span>
          <Button size="sm" variant="outline" disabled={!selectedLines.length} onClick={() => update(selectedLines, true)}>Accept</Button>
          <Button size="sm" variant="outline" disabled={!selectedLines.length} onClick={() => update(selectedLines, false)}>Skip</Button>
          <select
            className="h-8 rounded-md border bg-background px-2"
            disabled={!selectedLines.length}
            value=""
            onChange={(e) => e.target.value && setCategory(selectedLines, e.target.value)}
          >
            <option value="">Set category…</option>
            {liveCategories.map((c) => (
              <option key={c.id} value={c.id}>{c.kind === 'income' ? '↓ ' : ''}{c.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-background text-left text-muted-foreground">
            <tr>
              <th className="p-2">
                <Checkbox
                  checked={visible.length > 0 && visible.every((r) => selected.has(r.line))}
                  onCheckedChange={(v) => setSelected(v ? new Set(visible.map((r) => r.line)) : new Set())}
                  aria-label="Select all"
                />
              </th>
              <th className="p-2">Date</th>
              <th className="p-2">Account</th>
              <th className="p-2">Description</th>
              <th className="p-2 text-right">Amount</th>
              <th className="p-2">Category</th>
              <th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((raw) => {
              const r = effective(raw)
              const isAccepted = accepted.has(r.line) && actionable(r)
              return (
                <tr key={r.line} className={cn('border-t', isAccepted && 'bg-primary/5')}>
                  <td className="p-2">
                    <Checkbox
                      checked={selected.has(r.line)}
                      onCheckedChange={(v) =>
                        setSelected((prev) => {
                          const next = new Set(prev)
                          if (v) next.add(r.line)
                          else next.delete(r.line)
                          return next
                        })
                      }
                      aria-label={`Select line ${r.line}`}
                    />
                  </td>
                  <td className="whitespace-nowrap p-2">{r.date}</td>
                  <td className="whitespace-nowrap p-2">
                    {instrumentName(r.fromAccountId, r.fromCardId)}
                    {r.kind === 'transfer' && ` → ${instrumentName(r.toAccountId, r.toCardId)}`}
                  </td>
                  <td className="max-w-64 truncate p-2" title={r.note}>{r.note}</td>
                  <td className={cn('whitespace-nowrap p-2 text-right tabular-nums', r.kind === 'income' && 'text-emerald-600')}>
                    {formatBaht(r.amount)}
                  </td>
                  <td className="p-2">
                    {r.kind === 'transfer' || r.status === 'match' || !actionable(r) ? (
                      categoryById.get(r.categoryId ?? '')?.name ?? '—'
                    ) : (
                      <select
                        className="h-7 rounded border bg-background px-1"
                        value={r.categoryId ?? ''}
                        onChange={(e) => setCategory([r.line], e.target.value)}
                      >
                        {liveCategories.filter((c) => c.kind === r.kind).map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="p-2">
                    {r.status === 'error' && <span className="text-destructive">{r.issue}</span>}
                    {r.status === 'imported' && <span className="text-muted-foreground">Already imported</span>}
                    {actionable(r) && (
                      <label className="flex items-center gap-1.5">
                        <Checkbox checked={isAccepted} onCheckedChange={(v) => update([r.line], v === true)} />
                        {r.status === 'match' ? 'Same as a row you entered — confirm' : r.status === 'review' ? 'Accept (check category)' : 'Accept'}
                      </label>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!visible.length && <p className="p-4 text-sm text-muted-foreground">Nothing here.</p>}
      </div>
    </div>
  )
}
