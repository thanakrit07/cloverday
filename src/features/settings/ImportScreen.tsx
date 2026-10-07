import { useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Trash2, Undo2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAccounts } from '@/lib/accounts'
import { useCards } from '@/lib/cards'
import { useCategories } from '@/lib/categories'
import { useHousehold } from '@/lib/HouseholdContext'
import { applyPlan, hasExistingImportRows, type ApplyProgress, type ApplyResult, type ApplyStage } from '@/lib/import/apply'
import { detectMapping, mapRow, type ColumnMapping } from '@/lib/import/detect'
import type { FieldSpec } from '@/lib/import/fields'
import { ENTITY_LABELS, FIELD_SPECS } from '@/lib/import/fields'
import { parseCsvText, type ParsedCsv } from '@/lib/import/parseCsv'
import { parseXlsxFile } from '@/lib/import/parseXlsx'
import { buildPlan, type FilesInput } from '@/lib/import/plan'
import { buildTemplateCsv } from '@/lib/import/template'
import { buildTemplateWorkbook } from '@/lib/import/templateXlsx'
import {
  editKey,
  emptyRowEdits,
  ENTITY_KINDS,
  type DateFormat,
  type EntityKind,
  type ImportContext,
  type ImportIssue,
  type ImportPlan,
  type RowEdits,
} from '@/lib/import/types'
import { cn } from '@/lib/utils'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

type Stage = 'files' | 'mapping' | 'preview' | 'applying' | 'summary'

const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  dmy: 'DD/MM/YYYY (31/01/2026)',
  mdy: 'MM/DD/YYYY (01/31/2026)',
  ymd: 'YYYY-MM-DD (2026-01-31)',
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// v3.9-era redesign plan, "bulk import": in-app CSV import replacing
// scripts/import-sheet.ts (see the ADR). Five states: pick files (with a
// per-entity guide and template download) → map columns → preview (issues +
// consequences, read-only in this phase) → apply with progress → summary.
// All the logic lives in src/lib/import/* as pure functions — this
// component is a render of buildPlan()'s output plus the file/mapping state
// that feeds it.
//
// `mode: 'transactions'` restricts every step to the one entity most
// imports actually are — "add a pile of transactions at once" — skipping
// the six-file picker entirely. Nothing else changes: it's the same state,
// the same buildPlan/applyPlan calls, filtered to one entity up front
// rather than a parallel code path.
export function ImportScreen({ onClose, mode = 'full' }: { onClose: () => void; mode?: 'full' | 'transactions' }) {
  const availableEntities: readonly EntityKind[] = mode === 'transactions' ? ['transactions'] : ENTITY_KINDS
  const { householdId, members } = useHousehold()
  const { data: categories } = useCategories(householdId)
  const { data: accounts } = useAccounts(householdId)
  const { data: cards } = useCards(householdId)

  const [stage, setStage] = useState<Stage>('files')
  const [parsedByEntity, setParsedByEntity] = useState<Partial<Record<EntityKind, ParsedCsv>>>({})
  const [mappingByEntity, setMappingByEntity] = useState<Partial<Record<EntityKind, ColumnMapping>>>({})
  const [dateFormat, setDateFormat] = useState<DateFormat>('dmy')
  const [edits, setEdits] = useState<RowEdits>(emptyRowEdits())
  const [existingImportWarning, setExistingImportWarning] = useState(false)
  const [checkingExisting, setCheckingExisting] = useState(false)
  const [applyProgress, setApplyProgress] = useState<ApplyProgress | null>(null)
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null)

  const context: ImportContext = useMemo(
    () => ({
      // System and archived categories are excluded from every category
      // picker in the app (CategoryPickerPanel) — an import shouldn't be
      // able to offer or accept one either.
      categories: (categories ?? []).filter((c) => !c.system && !c.archived).map((c) => ({ name: c.name, kind: c.kind })),
      // Archived accounts/cards are excluded the same way
      // InstrumentPickerPanel excludes them everywhere else in the app.
      accounts: (accounts ?? []).filter((a) => !a.archived).map((a) => ({ name: a.name })),
      cards: (cards ?? []).filter((c) => !c.archived).map((c) => ({ name: c.name })),
      members: members.map((m) => ({ name: m.display_name })),
    }),
    [categories, accounts, cards, members],
  )

  const selectedEntities = availableEntities.filter((e) => parsedByEntity[e])

  const files: FilesInput = useMemo(() => {
    const out: FilesInput = {}
    for (const entity of selectedEntities) {
      const parsed = parsedByEntity[entity]
      const mapping = mappingByEntity[entity]
      if (parsed && mapping) out[entity] = { headers: parsed.headers, rows: parsed.rows, mapping }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedByEntity, mappingByEntity, selectedEntities.join(',')])

  const plan: ImportPlan = useMemo(
    () => buildPlan(files, edits, context, dateFormat, todayIso()),
    [files, edits, context, dateFormat],
  )

  const errorCount = plan.issues.filter((i) => i.severity === 'error').length
  const warningCount = plan.issues.filter((i) => i.severity === 'warning').length

  // Editing or deleting a row changes what other rows resolve against (a
  // renamed account, a deleted category another row named as its parent),
  // so the whole plan is rebuilt from `edits` on every change rather than
  // patched — see plan.ts's own note on this.
  function setOverride(entity: EntityKind, rowNumber: number, field: string, value: string) {
    setEdits((prev) => {
      const key = editKey(entity, rowNumber)
      return { ...prev, overrides: { ...prev.overrides, [key]: { ...prev.overrides[key], [field]: value } } }
    })
  }

  function setDeleted(entity: EntityKind, rowNumber: number, deleted: boolean) {
    setEdits((prev) => {
      const key = editKey(entity, rowNumber)
      const next = new Set(prev.deleted)
      if (deleted) next.add(key)
      else next.delete(key)
      return { ...prev, deleted: next }
    })
  }

  async function handleFileChange(entity: EntityKind, file: File | null) {
    if (!file) {
      setParsedByEntity((prev) => {
        const next = { ...prev }
        delete next[entity]
        return next
      })
      setMappingByEntity((prev) => {
        const next = { ...prev }
        delete next[entity]
        return next
      })
      return
    }
    const text = await file.text()
    const parsed = parseCsvText(text)
    setParsedByEntity((prev) => ({ ...prev, [entity]: parsed }))
    setMappingByEntity((prev) => ({ ...prev, [entity]: detectMapping(parsed.headers, FIELD_SPECS[entity]) }))
  }

  // One workbook can carry several entities at once (one sheet each), which
  // is the whole reason to offer it over one-CSV-per-entity: a household
  // doing a full import fills in one file, not six. Every matching sheet
  // found overwrites whatever was already picked for that entity.
  async function handleWorkbookUpload(file: File) {
    const buffer = await file.arrayBuffer()
    const parsedAll = await parseXlsxFile(buffer)
    // Quick "transactions only" mode ignores sheets for anything else, even
    // if the uploaded workbook has them — same restriction the CSV path
    // already applies via `availableEntities`.
    const found = Object.fromEntries(
      Object.entries(parsedAll).filter(([entity]) => availableEntities.includes(entity as EntityKind)),
    ) as Partial<Record<EntityKind, ParsedCsv>>
    setParsedByEntity((prev) => ({ ...prev, ...found }))
    setMappingByEntity((prev) => {
      const next = { ...prev }
      for (const entity of Object.keys(found) as EntityKind[]) {
        const parsed = found[entity]
        if (parsed) next[entity] = detectMapping(parsed.headers, FIELD_SPECS[entity])
      }
      return next
    })
  }

  async function handleWorkbookDownload() {
    const blob = await buildTemplateWorkbook(context, availableEntities)
    downloadBlob('cloversky-import-template.xlsx', blob)
  }

  async function goToMapping() {
    setStage('mapping')
  }

  async function goToPreview() {
    setCheckingExisting(true)
    try {
      setExistingImportWarning(await hasExistingImportRows(householdId))
    } finally {
      setCheckingExisting(false)
    }
    setStage('preview')
  }

  async function handleApply() {
    setStage('applying')
    setApplyProgress(null)
    const result = await applyPlan(householdId, plan, setApplyProgress)
    setApplyResult(result)
    setStage('summary')
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      {stage === 'files' && (
        <FilesStep
          entities={availableEntities}
          parsedByEntity={parsedByEntity}
          onFileChange={handleFileChange}
          onDownloadWorkbook={handleWorkbookDownload}
          onUploadWorkbook={handleWorkbookUpload}
          onContinue={goToMapping}
          canContinue={selectedEntities.length > 0}
        />
      )}
      {stage === 'mapping' && (
        <MappingStep
          selectedEntities={selectedEntities}
          parsedByEntity={parsedByEntity}
          mappingByEntity={mappingByEntity}
          onMappingChange={(entity, mapping) => setMappingByEntity((prev) => ({ ...prev, [entity]: mapping }))}
          dateFormat={dateFormat}
          onDateFormatChange={setDateFormat}
          onBack={() => setStage('files')}
          onContinue={goToPreview}
          checking={checkingExisting}
        />
      )}
      {stage === 'preview' && (
        <PreviewStep
          plan={plan}
          context={context}
          files={files}
          edits={edits}
          onEdit={setOverride}
          onSetDeleted={setDeleted}
          selectedEntities={selectedEntities}
          errorCount={errorCount}
          warningCount={warningCount}
          existingImportWarning={existingImportWarning}
          onBack={() => setStage('mapping')}
          onApply={handleApply}
        />
      )}
      {stage === 'applying' && <ApplyingStep progress={applyProgress} />}
      {stage === 'summary' && applyResult && <SummaryStep result={applyResult} onClose={onClose} />}
    </div>
  )
}

function FilesStep({
  entities,
  parsedByEntity,
  onFileChange,
  onDownloadWorkbook,
  onUploadWorkbook,
  onContinue,
  canContinue,
}: {
  entities: readonly EntityKind[]
  parsedByEntity: Partial<Record<EntityKind, ParsedCsv>>
  onFileChange: (entity: EntityKind, file: File | null) => void
  onDownloadWorkbook: () => void
  onUploadWorkbook: (file: File) => void
  onContinue: () => void
  canContinue: boolean
}) {
  const workbookInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {entities.length > 1
          ? "Fill in one CSV per kind of data, or one Excel workbook covering however many you need — its Category/Account/Owner columns are dropdowns built from your own data, so there's less to get wrong by hand."
          : "Fill in the CSV, or the Excel workbook — its Category/Account/Owner columns are dropdowns built from your own data, so there's less to get wrong by hand."}
      </p>

      <div className="space-y-2 rounded-2xl border bg-card p-3">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 text-sm font-medium">Excel workbook{entities.length > 1 ? ' (all in one file)' : ''}</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={onDownloadWorkbook}>
            <Download className="size-3.5" />
            Download template
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={() => workbookInputRef.current?.click()}>
            <Upload className="size-3.5" />
            Upload workbook
          </Button>
          <input
            ref={workbookInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onUploadWorkbook(file)
              e.target.value = ''
            }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          One sheet per kind of data{entities.length === 1 ? '' : ' — upload once, every matching sheet fills in at once'}. Dropdown
          picks outside the list still work; they're a guide, not a hard rule.
        </p>
      </div>

      {entities.length > 1 && <p className="text-xs text-muted-foreground">Or, per kind, a plain CSV:</p>}
      <ul className="space-y-3">
        {entities.map((entity) => (
          <EntityFilePicker key={entity} entity={entity} parsed={parsedByEntity[entity] ?? null} onFileChange={(f) => onFileChange(entity, f)} />
        ))}
      </ul>
      <Button className="w-full" onClick={onContinue} disabled={!canContinue}>
        Continue
      </Button>
    </div>
  )
}

function EntityFilePicker({
  entity,
  parsed,
  onFileChange,
}: {
  entity: EntityKind
  parsed: ParsedCsv | null
  onFileChange: (file: File | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [guideOpen, setGuideOpen] = useState(false)

  return (
    <li className="space-y-2 rounded-2xl border bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{ENTITY_LABELS[entity]}</span>
          <span className="block text-xs text-muted-foreground">
            {parsed ? `${parsed.rows.length} row${parsed.rows.length === 1 ? '' : 's'} loaded` : 'No file selected'}
          </span>
        </span>
        <Button variant="outline" size="sm" onClick={() => downloadText(`${entity}-template.csv`, buildTemplateCsv(entity))}>
          <Download className="size-3.5" />
          Template
        </Button>
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          <Upload className="size-3.5" />
          {parsed ? 'Replace' : 'Choose file'}
        </Button>
        {parsed && (
          <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => onFileChange(null)} aria-label={`Remove ${ENTITY_LABELS[entity]} file`}>
            <X className="size-4" />
          </Button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
        />
      </div>

      <button
        type="button"
        onClick={() => setGuideOpen((o) => !o)}
        className="flex w-full items-center gap-1 text-xs text-muted-foreground"
      >
        <ChevronDown className={cn('size-3.5 transition-transform', guideOpen && 'rotate-180')} />
        {guideOpen ? 'Hide column guide' : 'Show column guide'}
      </button>
      {guideOpen && (
        <ul className="space-y-1.5 rounded-xl bg-muted/40 p-2 text-xs">
          {FIELD_SPECS[entity].map((field) => (
            <li key={field.key}>
              <span className="font-medium">{field.column}</span>
              {field.required ? <span className="text-destructive"> (required)</span> : <span className="text-muted-foreground"> (optional)</span>}
              <span className="block text-muted-foreground">{field.description}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

const UNMAPPED = '__unmapped__'

function MappingStep({
  selectedEntities,
  parsedByEntity,
  mappingByEntity,
  onMappingChange,
  dateFormat,
  onDateFormatChange,
  onBack,
  onContinue,
  checking,
}: {
  selectedEntities: EntityKind[]
  parsedByEntity: Partial<Record<EntityKind, ParsedCsv>>
  mappingByEntity: Partial<Record<EntityKind, ColumnMapping>>
  onMappingChange: (entity: EntityKind, mapping: ColumnMapping) => void
  dateFormat: DateFormat
  onDateFormatChange: (format: DateFormat) => void
  onBack: () => void
  onContinue: () => void
  checking: boolean
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5 rounded-2xl border bg-card p-3">
        <span className="text-sm font-medium">Date format</span>
        <p className="text-xs text-muted-foreground">How dates are written in every file — chosen once, used everywhere.</p>
        <Select value={dateFormat} onValueChange={(v) => onDateFormatChange(v as DateFormat)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(DATE_FORMAT_LABELS) as DateFormat[]).map((f) => (
              <SelectItem key={f} value={f}>{DATE_FORMAT_LABELS[f]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedEntities.map((entity) => {
        const parsed = parsedByEntity[entity]
        const mapping = mappingByEntity[entity] ?? {}
        if (!parsed) return null
        return (
          <div key={entity} className="space-y-2 rounded-2xl border bg-card p-3">
            <span className="text-sm font-medium">{ENTITY_LABELS[entity]}</span>
            <ul className="space-y-2">
              {FIELD_SPECS[entity].map((field) => (
                <li key={field.key} className="flex items-center gap-2">
                  <span className="w-36 shrink-0 truncate text-xs text-muted-foreground">
                    {field.column}
                    {field.required && <span className="text-destructive"> *</span>}
                  </span>
                  <Select
                    value={mapping[field.key] ?? UNMAPPED}
                    onValueChange={(v) => onMappingChange(entity, { ...mapping, [field.key]: v === UNMAPPED ? null : v })}
                  >
                    <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNMAPPED}>— not mapped —</SelectItem>
                      {parsed.headers.map((h) => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              ))}
            </ul>
          </div>
        )
      })}

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onBack}>
          Back
        </Button>
        <Button className="flex-1" onClick={onContinue} disabled={checking}>
          {checking ? 'Checking…' : 'Preview'}
        </Button>
      </div>
    </div>
  )
}

function IssueList({ issues }: { issues: ImportIssue[] }) {
  return (
    <ul className="space-y-1">
      {issues.map((issue, i) => (
        <li key={i} className={cn('text-xs', issue.severity === 'error' ? 'text-destructive' : 'text-warning-foreground')}>
          Row {issue.rowNumber}
          {issue.field && ` · ${issue.field}`}: {issue.message}
        </li>
      ))}
    </ul>
  )
}

function PreviewStep({
  plan,
  context,
  files,
  edits,
  onEdit,
  onSetDeleted,
  selectedEntities,
  errorCount,
  warningCount,
  existingImportWarning,
  onBack,
  onApply,
}: {
  plan: ImportPlan
  context: ImportContext
  files: FilesInput
  edits: RowEdits
  onEdit: (entity: EntityKind, rowNumber: number, field: string, value: string) => void
  onSetDeleted: (entity: EntityKind, rowNumber: number, deleted: boolean) => void
  selectedEntities: EntityKind[]
  errorCount: number
  warningCount: number
  existingImportWarning: boolean
  onBack: () => void
  onApply: () => void
}) {
  return (
    <div className="space-y-4">
      {existingImportWarning && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          This household already has rows from an earlier import. Applying again will fail on the first name that collides — it
          never overwrites. If you meant to start over, clear the household's data first.
        </div>
      )}

      <div className="rounded-2xl border bg-card p-3 text-sm">
        <span className="font-medium">{errorCount === 0 ? 'Ready to import.' : `${errorCount} row${errorCount === 1 ? '' : 's'} need fixing.`}</span>
        {warningCount > 0 && <span className="block text-xs text-muted-foreground">{warningCount} warning{warningCount === 1 ? '' : 's'} — won't block the import.</span>}
      </div>

      {plan.consequences.length > 0 && (
        <div className="space-y-1 rounded-2xl border bg-warning/40 p-3 text-sm text-warning-foreground">
          <span className="font-medium">What happens after</span>
          <ul className="list-disc space-y-1 pl-4">
            {plan.consequences.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {selectedEntities.map((entity) => (
        <EntitySection
          key={entity}
          entity={entity}
          plan={plan}
          context={context}
          fileInput={files[entity]!}
          edits={edits}
          onEdit={onEdit}
          onSetDeleted={onSetDeleted}
        />
      ))}

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onBack}>
          Back
        </Button>
        <Button className="flex-1" onClick={onApply} disabled={errorCount > 0}>
          Import
        </Button>
      </div>
    </div>
  )
}

// Reads back from `plan` (post-edit) for a live row, but a deleted row is
// absent from `plan` entirely — mapRow against the original file is the only
// way left to show it (struck through, with Undo), which is the whole point
// of keeping delete reversible instead of forgetting the row outright.
//
// `plannedByRow` is an index rather than the plan array itself: a linear
// `.find()` here is O(rows²) over a file, which on a thousand-row
// transactions import is over a million comparisons per render.
function displayRawFor(
  entity: EntityKind,
  rowNumber: number,
  plannedByRow: Map<number, { raw: Record<string, string> }>,
  fileInput: FilesInput[EntityKind],
): Record<string, string> {
  const planned = plannedByRow.get(rowNumber)
  if (planned) return planned.raw
  const csvRow = fileInput!.rows[rowNumber - 1]
  return mapRow(csvRow, fileInput!.mapping, FIELD_SPECS[entity])
}

// Every reference dropdown on every row offers the same handful of lists, so
// they're built once per plan instead of per row × per field — the old
// per-cell rebuild allocated a Set and several arrays thousands of times for
// one render of a large file.
interface OptionSets {
  instruments: string[]
  members: string[]
  categories: Record<'income' | 'expense', string[]>
}

function buildOptionSets(context: ImportContext, plan: ImportPlan): OptionSets {
  const planAccounts = plan.accounts.map((r) => r.value).filter((v) => v !== null).map((v) => v.name)
  const planCards = plan.cards.map((r) => r.value).filter((v) => v !== null).map((v) => v.name)
  const planCategories = plan.categories.map((r) => r.value).filter((v) => v !== null)
  const categoriesOf = (kind: 'income' | 'expense') => [
    ...new Set([
      ...context.categories.filter((c) => c.kind === kind).map((c) => c.name),
      ...planCategories.filter((c) => c.kind === kind).map((c) => c.name),
    ]),
  ]
  return {
    instruments: [...new Set([...context.accounts.map((a) => a.name), ...planAccounts, ...context.cards.map((c) => c.name), ...planCards])],
    members: context.members.map((m) => m.name),
    categories: { income: categoriesOf('income'), expense: categoriesOf('expense') },
  }
}

function referenceOptions(entity: EntityKind, field: FieldSpec, raw: Record<string, string>, sets: OptionSets): readonly string[] | null {
  if (field.type === 'enum') return field.enumValues ?? null
  if (field.type === 'member-ref') return sets.members
  if (field.type === 'instrument-ref') return sets.instruments
  if (field.type === 'category-ref') {
    const kind: 'income' | 'expense' = entity === 'installments' ? 'expense' : raw.kind?.trim().toLowerCase() === 'income' ? 'income' : 'expense'
    return sets.categories[kind]
  }
  return null
}

const ROWS_PER_PAGE = 50
const EMPTY_ISSUES: ImportIssue[] = []

function Pager({
  page,
  pageCount,
  from,
  to,
  total,
  onPage,
}: {
  page: number
  pageCount: number
  from: number
  to: number
  total: number
  onPage: (page: number) => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="size-7" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="size-3.5" />
        </Button>
        <span className="min-w-16 text-center text-xs text-muted-foreground">
          {page + 1} / {pageCount}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="size-7"
          disabled={page >= pageCount - 1}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

function EntitySection({
  entity,
  plan,
  context,
  fileInput,
  edits,
  onEdit,
  onSetDeleted,
}: {
  entity: EntityKind
  plan: ImportPlan
  context: ImportContext
  fileInput: FilesInput[EntityKind]
  edits: RowEdits
  onEdit: (entity: EntityKind, rowNumber: number, field: string, value: string) => void
  onSetDeleted: (entity: EntityKind, rowNumber: number, deleted: boolean) => void
}) {
  const [rowsOpen, setRowsOpen] = useState(false)
  const [issuesOnly, setIssuesOnly] = useState(false)
  const [page, setPage] = useState(0)

  const rows = plan[entity] as { rowNumber: number; raw: Record<string, string>; value: unknown }[]
  const totalRows = fileInput?.rows.length ?? 0

  // One pass over the plan builds every per-row lookup the rows below need.
  // Scanning `plan.issues` and `plan[entity]` inside the row loop instead is
  // what made a large file lock the tab: each of a thousand rows walked both
  // lists in full, on every keystroke.
  const { entityIssues, errors, plannedByRow, issuesByRow } = useMemo(() => {
    const entityIssues = plan.issues.filter((i) => i.entity === entity)
    const plannedByRow = new Map<number, { rowNumber: number; raw: Record<string, string>; value: unknown }>()
    for (const row of rows) plannedByRow.set(row.rowNumber, row)
    const issuesByRow = new Map<number, ImportIssue[]>()
    for (const issue of entityIssues) {
      const list = issuesByRow.get(issue.rowNumber)
      if (list) list.push(issue)
      else issuesByRow.set(issue.rowNumber, [issue])
    }
    return { entityIssues, errors: entityIssues.filter((i) => i.severity === 'error'), plannedByRow, issuesByRow }
  }, [plan, entity, rows])

  const optionSets = useMemo(() => buildOptionSets(context, plan), [context, plan])

  const deletedCount = Array.from({ length: totalRows }, (_, i) => i + 1).filter((n) => edits.deleted.has(editKey(entity, n))).length
  const validCount = rows.filter((r) => r.value !== null).length

  const visibleRowNumbers = useMemo(
    () =>
      Array.from({ length: totalRows }, (_, i) => i + 1).filter((rowNumber) => {
        if (!issuesOnly) return true
        if (edits.deleted.has(editKey(entity, rowNumber))) return false
        return issuesByRow.has(rowNumber)
      }),
    [totalRows, issuesOnly, edits.deleted, entity, issuesByRow],
  )

  // A thousand rows is a thousand × nine form controls, several of them
  // dropdowns — enough mounted at once to freeze the tab, which is why the
  // rows are paged rather than all rendered and scrolled. `safePage` clamps
  // instead of an effect resetting it, so filtering down to a shorter list
  // can't leave the view stranded past the end.
  const pageCount = Math.max(1, Math.ceil(visibleRowNumbers.length / ROWS_PER_PAGE))
  const safePage = Math.min(page, pageCount - 1)
  const pageStart = safePage * ROWS_PER_PAGE
  const pageRowNumbers = visibleRowNumbers.slice(pageStart, pageStart + ROWS_PER_PAGE)

  return (
    <div className="space-y-1.5 rounded-2xl border bg-card p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{ENTITY_LABELS[entity]}</span>
        <span className="text-muted-foreground">
          {validCount}/{totalRows} ready
          {errors.length > 0 && <span className="text-destructive"> · {errors.length} error{errors.length === 1 ? '' : 's'}</span>}
          {deletedCount > 0 && <span> · {deletedCount} deleted</span>}
        </span>
      </div>

      <button type="button" onClick={() => setRowsOpen((o) => !o)} className="flex items-center gap-1 text-xs text-muted-foreground">
        <ChevronDown className={cn('size-3.5 transition-transform', rowsOpen && 'rotate-180')} />
        {rowsOpen ? 'Hide rows' : `Show rows (${totalRows})`}
      </button>

      {rowsOpen && (
        <div className="space-y-2">
          {entityIssues.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={issuesOnly}
                onChange={(e) => {
                  setIssuesOnly(e.target.checked)
                  setPage(0)
                }}
              />
              Show only rows with issues
            </label>
          )}
          {pageCount > 1 && (
            <Pager
              page={safePage}
              pageCount={pageCount}
              from={pageStart + 1}
              to={pageStart + pageRowNumbers.length}
              total={visibleRowNumbers.length}
              onPage={setPage}
            />
          )}
          <ul className="space-y-2">
            {pageRowNumbers.map((rowNumber) => {
              const key = editKey(entity, rowNumber)
              const deleted = edits.deleted.has(key)
              const raw = displayRawFor(entity, rowNumber, plannedByRow, fileInput)
              const rowIssues = issuesByRow.get(rowNumber) ?? EMPTY_ISSUES
              return (
                <li key={rowNumber} className={cn('space-y-1.5 rounded-xl border p-2', deleted ? 'bg-muted/40 opacity-60' : 'bg-background')}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Row {rowNumber}</span>
                    {deleted ? (
                      <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs" onClick={() => onSetDeleted(entity, rowNumber, false)}>
                        <Undo2 className="size-3" />
                        Undo
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 px-1.5 text-xs text-destructive hover:text-destructive"
                        onClick={() => onSetDeleted(entity, rowNumber, true)}
                      >
                        <Trash2 className="size-3" />
                        Delete
                      </Button>
                    )}
                  </div>
                  {!deleted && (
                    <div className="grid grid-cols-2 gap-1.5">
                      {FIELD_SPECS[entity].map((field) => {
                        const fieldIssue = rowIssues.find((i) => i.field === field.key)
                        const options = referenceOptions(entity, field, raw, optionSets)
                        const value = raw[field.key] ?? ''
                        return (
                          <label key={field.key} className="col-span-1 space-y-0.5">
                            <span className="block text-[10px] text-muted-foreground">{field.column}</span>
                            {options ? (
                              <Select value={value || UNMAPPED} onValueChange={(v) => onEdit(entity, rowNumber, field.key, v === UNMAPPED ? '' : v)}>
                                <SelectTrigger className={cn('h-7 w-full text-xs', fieldIssue?.severity === 'error' && 'border-destructive')}>
                                  <SelectValue placeholder="—" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={UNMAPPED}>—</SelectItem>
                                  {options.map((o) => (
                                    <SelectItem key={o} value={o}>{o}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input
                                value={value}
                                onChange={(e) => onEdit(entity, rowNumber, field.key, e.target.value)}
                                className={cn('h-7 text-xs', fieldIssue?.severity === 'error' && 'border-destructive')}
                              />
                            )}
                            {fieldIssue && (
                              <span className={cn('block text-[10px]', fieldIssue.severity === 'error' ? 'text-destructive' : 'text-warning-foreground')}>
                                {fieldIssue.message}
                              </span>
                            )}
                          </label>
                        )
                      })}
                    </div>
                  )}
                  {rowIssues.filter((i) => !i.field).length > 0 && <IssueList issues={rowIssues.filter((i) => !i.field)} />}
                </li>
              )
            })}
          </ul>
          {pageCount > 1 && (
            <Pager
              page={safePage}
              pageCount={pageCount}
              from={pageStart + 1}
              to={pageStart + pageRowNumbers.length}
              total={visibleRowNumbers.length}
              onPage={setPage}
            />
          )}
        </div>
      )}
    </div>
  )
}

const STAGE_LABELS: Record<ApplyStage, string> = {
  categories: 'Categories',
  accounts: 'Accounts',
  cards: 'Cards',
  installments: 'Installments',
  installmentPayments: 'Installment payments',
  recurringRules: 'Recurring rules',
  transactions: 'Transactions',
  openingBalances: 'Opening balances',
}

function ApplyingStep({ progress }: { progress: ApplyProgress | null }) {
  return (
    <div className="space-y-3 rounded-2xl border bg-card p-6 text-center">
      <p className="text-sm font-medium">Importing…</p>
      {progress && (
        <p className="text-xs text-muted-foreground">
          {STAGE_LABELS[progress.stage]} — {progress.completed}/{progress.total}
        </p>
      )}
    </div>
  )
}

function SummaryStep({ result, onClose }: { result: ApplyResult; onClose: () => void }) {
  return (
    <div className="space-y-4">
      <div className={cn('rounded-2xl border p-3 text-sm', result.error ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-good/40 bg-good-background text-good-foreground')}>
        <span className="font-medium">{result.error ? `Stopped at ${result.failedAt}` : 'Import complete.'}</span>
        {result.error && <span className="block text-xs">{result.error}</span>}
      </div>
      <ul className="space-y-1 rounded-2xl border bg-card p-3 text-sm">
        {(Object.entries(result.insertedCounts) as [string, number][]).map(([stage, count]) => (
          <li key={stage} className="flex items-center justify-between">
            <span className="text-muted-foreground">{STAGE_LABELS[stage as ApplyStage] ?? stage}</span>
            <span>{count}</span>
          </li>
        ))}
      </ul>
      <Button className="w-full" onClick={onClose}>
        Done
      </Button>
    </div>
  )
}
