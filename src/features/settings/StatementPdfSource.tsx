import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { extractPdfLines, PasswordCancelled, type PdfJs } from '@/lib/statements/lines'
import { parseStatement } from '@/lib/statements/detect'
import { stageStatements, type PlanRef, type StageInput } from '@/lib/statements/stage'
import type { Layout, ParseResult } from '@/lib/statements/types'
import { NEEDS_PLAN } from '@/lib/statementImport'

// ADR-0020: the statement PDFs are read right here, in this browser. The file,
// its text and any password stay in memory on this device and are gone when the
// page is; only the rows the household accepts are ever written, by Apply.

export interface StatementWarning {
  source: string
  reason: string
  text: string
}

interface Props {
  accounts: { id: string; name: string }[]
  cards: { id: string; name: string }[]
  plans: PlanRef[]
  onReady: (records: Record<string, string>[], warnings: StatementWarning[]) => void
}

// ponytail: which of this household's accounts a layout can be a statement of.
// Moves into counterparties/settings; until then a layout with two candidates
// asks which.
const LAYOUT_INSTRUMENTS: Record<Layout, string[]> = {
  cardx: ['CardX', 'SpeedyCash'],
  ktc: ['KTC'],
  uob: ['UOB Premier', 'UOB Cash Plus'],
  kbank: ['กสิกร'],
}

interface FileState {
  id: number
  /** Shown name: some banks put the full card number in the file name. */
  name: string
  status: 'reading' | 'ready' | 'unsupported' | 'skipped' | 'error'
  message?: string
  result?: ParseResult
  candidates: string[]
  instrument?: string
}

const displayName = (name: string) => name.replace(/\d{12,}/g, '…')
const dmy = (iso: string) => iso.split('-').reverse().join('/')
const todayLocal = () => new Date().toLocaleDateString('sv-SE')

async function loadPdfjs(): Promise<PdfJs> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  return pdfjs as unknown as PdfJs
}

export function StatementPdfSource({ accounts, cards, plans, onReady }: Props) {
  const [files, setFiles] = useState<FileState[]>([])
  const [prompt, setPrompt] = useState<{ name: string; wrong: boolean; resolve: (p: string | null) => void } | null>(null)
  const [typed, setTyped] = useState('')
  // Memory only: passwords that opened a file are tried on the next one first.
  const known = useRef<string[]>([])
  const nextId = useRef(1)

  const existingNames = new Set([...accounts, ...cards].map((x) => x.name))
  const busy = files.some((f) => f.status === 'reading')
  const usable = files.filter((f) => f.status === 'ready' && f.instrument)

  function patch(id: number, change: Partial<FileState>) {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...change } : f)))
  }

  async function readAll(picked: File[]) {
    const pdfjs = await loadPdfjs()
    for (const file of picked) {
      const id = nextId.current++
      const name = displayName(file.name)
      setFiles((prev) => [...prev, { id, name, status: 'reading', candidates: [] }])
      try {
        const lines = await extractPdfLines(pdfjs, new Uint8Array(await file.arrayBuffer()), {
          known: known.current,
          ask: (wrong) => new Promise((resolve) => setPrompt({ name, wrong, resolve })),
        })
        const result = parseStatement(lines, todayLocal())
        if (!result) {
          patch(id, { status: 'unsupported', message: 'This statement layout is not supported yet.' })
          continue
        }
        const candidates = LAYOUT_INSTRUMENTS[result.layout].filter((n) => existingNames.has(n))
        patch(id, { status: 'ready', result, candidates, instrument: candidates.length === 1 ? candidates[0] : undefined })
      } catch (e) {
        if (e instanceof PasswordCancelled) patch(id, { status: 'skipped', message: 'Skipped: no password.' })
        else patch(id, { status: 'error', message: 'Could not read this file.' })
      }
    }
  }

  function carryOn() {
    const inputs: StageInput[] = usable.map((f) => ({ instrument: f.instrument!, result: f.result! }))
    const { rows, issues } = stageStatements(inputs, { plans, hints: new Map() })
    const records = rows.map((r) => ({
      Date: dmy(r.date),
      'Posted date': r.postedDate ? dmy(r.postedDate) : '',
      Kind: r.kind,
      Amount: r.amount.toFixed(2),
      Category: r.category,
      'Account or card': r.from,
      'To account or card': r.to,
      Description: r.text,
      Details: r.needsPlan ? NEEDS_PLAN : '',
      Owner: '',
    }))
    const warnings: StatementWarning[] = [
      ...issues.map((i) => ({ source: i.instrument, reason: i.reason, text: i.text })),
      ...usable.flatMap((f) => f.result!.unreadable.map((u) => ({ source: f.instrument!, reason: u.reason, text: u.text }))),
    ]
    onReady(records, warnings)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3 p-4 text-sm">
      <p>
        Pick your statement PDFs (several at once is fine: a payment from a bank account is only recorded once when both statements are here). They are read on this device only and never uploaded; nothing is saved until you press Apply.
      </p>
      <input
        type="file"
        accept=".pdf,application/pdf"
        multiple
        disabled={busy || prompt !== null}
        onChange={(e) => {
          const picked = [...(e.target.files ?? [])]
          e.target.value = ''
          if (picked.length) void readAll(picked)
        }}
      />

      {prompt && (
        <form
          className="space-y-2 rounded-md border p-3"
          onSubmit={(e) => {
            e.preventDefault()
            prompt.resolve(typed || null)
            setTyped('')
            setPrompt(null)
          }}
        >
          <p>{prompt.wrong ? 'That password is not right. Try again' : 'This PDF has a password'} — <span className="text-muted-foreground">{prompt.name}</span></p>
          <input
            type="password"
            autoComplete="off"
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="h-9 w-full rounded-md border bg-background px-2"
            aria-label="PDF password"
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm">Open</Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                prompt.resolve(null)
                setTyped('')
                setPrompt(null)
              }}
            >
              Skip this file
            </Button>
          </div>
        </form>
      )}

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((f) => (
            <li key={f.id} className="rounded-md border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</span>
                {f.status === 'reading' && <span className="text-muted-foreground">Reading…</span>}
                {f.status === 'ready' && f.result && (
                  <span className="text-muted-foreground">
                    {f.result.lines.length} lines read{f.result.unreadable.length > 0 && <span className="text-destructive"> · {f.result.unreadable.length} could not be read</span>}
                  </span>
                )}
              </div>
              {f.status === 'ready' && f.candidates.length > 1 && (
                <label className="mt-1 flex items-center gap-2">
                  Statement of
                  <select className="h-8 rounded-md border bg-background px-2" value={f.instrument ?? ''} onChange={(e) => patch(f.id, { instrument: e.target.value || undefined })}>
                    <option value="">Choose…</option>
                    {f.candidates.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
              )}
              {f.status === 'ready' && f.candidates.length === 0 && f.result && (
                <p className="mt-1 text-destructive">No account or card in the app matches this layout ({LAYOUT_INSTRUMENTS[f.result.layout].join(' / ')}).</p>
              )}
              {f.message && <p className={f.status === 'skipped' ? 'mt-1 text-muted-foreground' : 'mt-1 text-destructive'}>{f.message}</p>}
            </li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <Button disabled={busy || prompt !== null || usable.length === 0} onClick={carryOn}>
          Review {usable.length} {usable.length === 1 ? 'statement' : 'statements'}
        </Button>
      )}
    </div>
  )
}
