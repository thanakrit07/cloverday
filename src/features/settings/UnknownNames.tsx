import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { formatBaht } from '@/lib/format'
import type { UnknownName } from '@/lib/statementImport'

interface Props {
  names: UnknownName[]
  selected: Set<string>
  onChange: (selected: Set<string>) => void
  onAnswer: () => void
}

// Every name the app can't place yet, in one list, so a household with thirty of
// them answers a few times and not thirty: tick the ones that share an answer,
// answer once.
export function UnknownNames({ names, selected, onChange, onAnswer }: Props) {
  const allSelected = names.length > 0 && names.every((n) => selected.has(n.key))
  const toggle = (key: string, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(key)
    else next.delete(key)
    onChange(next)
  }
  return (
    <details className="border-b bg-muted/30 p-2 text-xs" open={names.length <= 8}>
      <summary className="cursor-pointer font-medium">Who are these? {names.length} {names.length === 1 ? 'name' : 'names'} the app does not know yet</summary>
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5">
            <Checkbox checked={allSelected} onCheckedChange={(v) => onChange(v ? new Set(names.map((n) => n.key)) : new Set())} aria-label="Select all names" />
            Select all
          </label>
          <Button size="sm" disabled={selected.size === 0} onClick={onAnswer}>
            Answer for {selected.size} selected
          </Button>
        </div>
        <ul className="max-h-48 space-y-0.5 overflow-auto">
          {names.map((n) => (
            <li key={n.key}>
              <label className="flex items-center gap-2">
                <Checkbox checked={selected.has(n.key)} onCheckedChange={(v) => toggle(n.key, v === true)} />
                <span className="min-w-0 flex-1 truncate">{n.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {n.count} {n.count === 1 ? 'line' : 'lines'} · {formatBaht(n.total)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </details>
  )
}
