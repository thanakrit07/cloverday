import { useEffect, useMemo, useState } from 'react'
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
import { useInstallments } from '@/lib/installments'
import { parseCsvText } from '@/lib/import/parseCsv'
import { applyCounterparties, applyStatementRows, buildStatementRows, normalizeStatementText, SHARED, type StatementRow } from '@/lib/statementImport'
import {
  hintMap,
  recordStatementFiles,
  rulesFromRows,
  useCategoryHints,
  useCounterparties,
  useSaveCounterparty,
  useStatementFiles,
  type NewStatementFile,
} from '@/lib/statementMemory'
import { useTransactions } from '@/lib/transactions'
import { cn } from '@/lib/utils'
import { StatementPdfSource, type StatementWarning } from './StatementPdfSource'
import { WhoIsThis } from './WhoIsThis'

type Tab = 'review' | 'new' | 'imported'
const TAB_OF: Record<StatementRow['status'], Tab> = { error: 'review', match: 'review', review: 'review', new: 'new', imported: 'imported' }
const TAB_LABEL: Record<Tab, string> = { review: 'Needs review', new: 'New', imported: 'Already imported' }
const PAGE = 100

// Work in progress survives a reload but not the browser tab: sessionStorage,
// never localStorage — this is the unmasked statement.
const DRAFT_KEY = 'statement-import-draft'
interface Draft {
  csvRows: Record<string, string>[]
  accepted: number[]
  categoryOverride: [number, string][]
  whoOverride: [number, string][]
  warnings?: StatementWarning[]
  files?: NewStatementFile[]
}
function loadDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    return raw ? (JSON.parse(raw) as Draft) : null
  } catch {
    return null
  }
}
function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    // nothing to clear
  }
}

// ADR-0019: the unmasked statement CSV is read here in the browser and written
// only on Apply. Nothing is accepted by default — "Accept all" is one tap.
export function StatementImportScreen({ onClose }: { onClose: () => void }) {
  const { householdId, self, members } = useHousehold()
  const queryClient = useQueryClient()
  const { data: accounts } = useAccounts(householdId)
  const { data: cards } = useCards(householdId)
  const { data: categories } = useCategories(householdId)
  const { data: installments } = useInstallments(householdId)
  const { data: seenFiles } = useStatementFiles(householdId)
  const { data: counterpartyRows } = useCounterparties(householdId)
  const { data: hintRows } = useCategoryHints(householdId)
  const saveCounterparty = useSaveCounterparty(householdId, self.id)
  const [draft] = useState(loadDraft)
  const [csvRows, setCsvRows] = useState<Record<string, string>[] | null>(draft?.csvRows ?? null)
  const [tab, setTab] = useState<Tab>('review')
  const [accepted, setAccepted] = useState<Set<number>>(new Set(draft?.accepted))
  const [categoryOverride, setCategoryOverride] = useState<Map<number, string>>(new Map(draft?.categoryOverride))
  const [whoOverride, setWhoOverride] = useState<Map<number, string>>(new Map(draft?.whoOverride))
  const [shown, setShown] = useState(PAGE)
  // Lines the reader could not read, and rows it could not place: shown, never dropped quietly.
  const [warnings, setWarnings] = useState<StatementWarning[]>(draft?.warnings ?? [])
  // The files this review was built from, recorded when Apply succeeds.
  const [fileMeta, setFileMeta] = useState<NewStatementFile[]>(draft?.files ?? [])
  // A name the household is being asked about ("who is this?").
  const [asking, setAsking] = useState<string | null>(null)

  useEffect(() => {
    if (!csvRows) return
    const next: Draft = { csvRows, accepted: [...accepted], categoryOverride: [...categoryOverride], whoOverride: [...whoOverride], warnings, files: fileMeta }
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(next))
    } catch {
      // storage full or blocked: the screen still works, it just won't survive a reload
    }
  }, [csvRows, accepted, categoryOverride, whoOverride, warnings, fileMeta])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [applying, setApplying] = useState(false)

  // What the household has said about names, applied before rows are built so a
  // transfer to its own other account is a transfer, and keys never notice.
  const rules = useMemo(
    () => rulesFromRows(counterpartyRows ?? [], { accounts: accounts ?? [], cards: cards ?? [], members, categories: categories ?? [] }),
    [counterpartyRows, accounts, cards, members, categories],
  )
  const hints = useMemo(() => {
    const names = new Map((categories ?? []).map((c) => [c.id, c.name]))
    return hintMap(hintRows ?? [], (id) => names.get(id))
  }, [hintRows, categories])
  const records = useMemo(() => (csvRows ? applyCounterparties(csvRows, rules) : null), [csvRows, rules])

  // Existing rows around the file's dates, for keys already imported and hand-entered matches.
  const range = useMemo(() => {
    const dates = (records ?? []).map((r) => r['Date']?.split('/').reverse().join('-')).filter(Boolean).sort()
    return dates.length ? { start: addDays(dates[0], -3), end: addDays(dates[dates.length - 1], 3) } : { start: '', end: '' }
  }, [records])
  const { data: existing } = useTransactions(householdId, range)

  const rows = useMemo(() => {
    if (!records || !accounts || !cards || !categories || !existing) return null
    return buildStatementRows(records, { accounts, cards, categories, existing })
  }, [records, accounts, cards, categories, existing])

  const liveCategories = useMemo(() => (categories ?? []).filter((c) => !c.archived && !c.system), [categories])
  const categoryById = useMemo(() => new Map((categories ?? []).map((c) => [c.id, c])), [categories])
  const instrumentOwnerOf = (accountId: string | null, cardId: string | null) =>
    (accounts ?? []).find((a) => a.id === accountId)?.owner_id ?? (cards ?? []).find((c) => c.id === cardId)?.owner_id ?? null
  // Who bears it: an explicit choice on screen, else the CSV's Owner column, else whoever owns the card or account.
  const whoOf = (r: StatementRow): string => {
    const chosen = whoOverride.get(r.line)
    if (chosen) return chosen
    const hint = r.ownerHint.toLowerCase()
    if (hint === 'shared' || hint === 'แชร์') return SHARED
    const named = members.find((m) => m.display_name.toLowerCase() === hint)
    if (named) return named.id
    return instrumentOwnerOf(r.fromAccountId, r.fromCardId) ?? self.id
  }
  const instrumentName = (accountId: string | null, cardId: string | null) =>
    (accounts ?? []).find((a) => a.id === accountId)?.name ?? (cards ?? []).find((c) => c.id === cardId)?.name ?? '—'

  if (!csvRows) {
    // The plans the app already has, by the name of the card or account they sit on.
    const plans = (installments ?? []).flatMap((i) => {
      const instrument = (cards ?? []).find((c) => c.id === i.card_id)?.name ?? (accounts ?? []).find((a) => a.id === i.account_id)?.name
      return instrument ? [{ instrument, total: i.total_periods, startDate: i.start_date }] : []
    })
    return (
      <div>
        <StatementPdfSource
          accounts={accounts ?? []}
          cards={cards ?? []}
          plans={plans}
          hints={hints}
          seen={seenFiles ?? []}
          onReady={(staged, found, files) => {
            setWarnings(found)
            setFileMeta(files)
            setCsvRows(staged)
          }}
        />
        <details className="mx-auto max-w-2xl p-4 text-sm">
          <summary className="cursor-pointer text-muted-foreground">From the old pipeline (CSV)</summary>
          <div className="space-y-3 pt-3">
            <p>Pick <code>statements/raw/final/transactions.csv</code> (after <code>npm run statements:unmask</code>).</p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                try {
                  setWarnings([])
                  setFileMeta([])
                  setCsvRows(parseCsvText(await file.text()).rows)
                } catch (err) {
                  toast.error(`Couldn't read this CSV: ${err instanceof Error ? err.message : String(err)}`)
                }
                e.target.value = '' // picking the same file again should still fire onChange
              }}
            />
          </div>
        </details>
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
      const result = await applyStatementRows(householdId, toApply, {
        categoryKindOf: (id) => categoryById.get(id)?.kind ?? null,
        instrumentOwnerOf,
        memberIds: members.map((m) => m.id),
        whoOf,
      })
      await recordStatementFiles(householdId, self.id, fileMeta)
      await queryClient.invalidateQueries({ queryKey: ['transactions', householdId] })
      await queryClient.invalidateQueries({ queryKey: ['statement_files', householdId] })
      await queryClient.invalidateQueries({ queryKey: ['category_hints', householdId] })
      clearDraft()
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
      {warnings.length > 0 && (
        <details className="border-b border-destructive/40 bg-destructive/5 p-2 text-xs" open>
          <summary className="cursor-pointer font-medium text-destructive">
            {warnings.length} {warnings.length === 1 ? 'line was' : 'lines were'} not imported: they could not be read or placed
          </summary>
          <ul className="mt-2 max-h-40 space-y-1 overflow-auto">
            {warnings.slice(0, 100).map((w, i) => (
              <li key={i}>
                <span className="text-muted-foreground">{w.source}:</span> {w.reason} — <span className="break-all">{w.text}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {asking && (
        <WhoIsThis
          name={asking}
          accounts={accounts ?? []}
          cards={cards ?? []}
          members={members}
          categories={liveCategories}
          saving={saveCounterparty.isPending}
          onCancel={() => setAsking(null)}
          onSave={async (answer) => {
            try {
              await saveCounterparty.mutateAsync({ name: asking, answer })
              setAsking(null)
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Could not save')
            }
          }}
        />
      )}
      <div className="flex flex-wrap items-center gap-2 border-b p-2">
        {(['review', 'new', 'imported'] as Tab[]).map((t) => (
          <Button key={t} size="sm" variant={tab === t ? 'default' : 'ghost'} onClick={() => { setTab(t); setSelected(new Set()); setShown(PAGE) }}>
            {TAB_LABEL[t]} ({rows.filter((r) => TAB_OF[r.status] === t).length})
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              clearDraft()
              setCsvRows(null)
              setWarnings([])
              setFileMeta([])
              setAccepted(new Set())
              setCategoryOverride(new Map())
              setWhoOverride(new Map())
            }}
          >
            Start over
          </Button>
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
            onChange={(e) =>
              e.target.value &&
              setWhoOverride((prev) => new Map([...prev, ...selectedLines.map((l) => [l, e.target.value] as const)]))
            }
          >
            <option value="">Set who…</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.display_name}</option>
            ))}
            {members.length > 1 && <option value={SHARED}>Shared (split evenly)</option>}
          </select>
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
              <th className="p-2">Who</th>
              <th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.slice(0, shown).map((raw) => {
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
                  <td className="max-w-64 p-2">
                    <div className="truncate" title={r.description}>{r.description}</div>
                    {r.counterparty && actionable(r) && !rules.has(normalizeStatementText(r.counterparty)) && (
                      <button className="text-primary underline underline-offset-2" onClick={() => setAsking(r.counterparty)}>
                        Who is {r.counterparty}?
                      </button>
                    )}
                  </td>
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
                    {r.kind === 'transfer' || r.status === 'match' || !actionable(r) ? (
                      '—'
                    ) : (
                      <select
                        className="h-7 rounded border bg-background px-1"
                        value={whoOf(r)}
                        onChange={(e) => setWhoOverride((prev) => new Map(prev).set(r.line, e.target.value))}
                      >
                        {members.map((m) => (
                          <option key={m.id} value={m.id}>{m.display_name}</option>
                        ))}
                        {r.kind === 'expense' && members.length > 1 && <option value={SHARED}>Shared (split evenly)</option>}
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
        {visible.length > shown && (
          <div className="p-3 text-center">
            <Button size="sm" variant="outline" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, visible.length - shown)} more ({visible.length - shown} left)
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
