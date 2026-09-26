import { calendarCells } from '@/lib/month'
import { cn } from '@/lib/utils'

interface DayTotals {
  income: number
  expense: number
}

interface Props {
  month: string
  totals: Map<string, DayTotals>
  onSelectDay: (date: string) => void
}

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// A cell's number has to fit next to six others on one row on a phone, so
// it's rounded to the nearest hundred/thousand rather than using formatBaht
// (DESIGN §7.4's "1,234.50 throughout the UI" is for a row's own amount —
// a day cell is a glance, not a receipt; the exact figure is one tap away
// in the drawer this opens).
function compactBaht(amount: number): string {
  if (amount >= 1000) return `${(amount / 1000).toFixed(amount >= 10000 ? 0 : 1)}k`
  return String(Math.round(amount))
}

// Records' Calendar tab (2026-09 grilling session): a month grid, each real
// day showing its income/expense totals in the same colors the Daily
// ledger's own day headers use. Tapping a day is the caller's job (opens a
// bottom drawer reusing TransactionsScreen's existing row rendering) — this
// component only lays out the grid and reports totals it's given.
export function CalendarGrid({ month, totals, onSelectDay }: Props) {
  const cells = calendarCells(month)

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
        {WEEKDAY_LABELS.map((label, i) => (
          <span key={i}>{label}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          if (!date) return <span key={`blank-${i}`} />
          const t = totals.get(date)
          const day = Number(date.slice(-2))
          return (
            <button
              key={date}
              type="button"
              onClick={(e) => {
                // Without this, the cell stays focused after the drawer
                // opens and marks the rest of the page aria-hidden — a
                // focused element inside an aria-hidden ancestor is invalid
                // and Chrome warns on it (vaul doesn't shift focus into the
                // drawer itself since it's opened via `open`, not a
                // DrawerTrigger, so nothing does this automatically).
                e.currentTarget.blur()
                onSelectDay(date)
              }}
              className={cn(
                'flex aspect-square flex-col items-center justify-center gap-px rounded-lg border p-1 transition-colors active:bg-accent/60',
                t ? 'bg-card' : 'border-transparent text-muted-foreground/60',
              )}
            >
              <span className="text-xs font-medium">{day}</span>
              {t?.income ? <span className="text-[9px] leading-none tabular-nums text-good">+{compactBaht(t.income)}</span> : null}
              {t?.expense ? (
                <span className="text-[9px] leading-none tabular-nums text-destructive">-{compactBaht(t.expense)}</span>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
