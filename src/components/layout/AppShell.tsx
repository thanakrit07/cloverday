import { useState, type ReactNode } from 'react'
import { Camera, ChevronLeft, ChevronRight, CloudOff, Plus, Search, Settings as SettingsIcon, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MonthYearPicker } from '@/components/MonthYearPicker'
import { cn } from '@/lib/utils'
import { useOnline } from '@/hooks/useOnline'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { useHousehold } from '@/lib/HouseholdContext'
import { monthLabel, shiftMonth } from '@/lib/month'
import type { PersonFilter } from '@/lib/filters'
import { NavRail } from './NavRail'
import { TABS } from './tabs'
import type { Tab } from './tab-type'

export type { Tab } from './tab-type'

interface Props {
  month: string
  onMonthChange: (month: string) => void
  person: PersonFilter
  onPersonChange: (person: PersonFilter) => void
  tab: Tab
  onTabChange: (tab: Tab) => void
  onQuickAdd: () => void
  /** A photographed bill (ADR-0017). Undefined disables the camera button. */
  onScanBill?: (file: File) => void
  onOpenSettings: () => void
  search: string
  onSearchChange: (search: string) => void
  // Records' Filter screen (kind/category/account, distinct from the month
  // and person controls already here) — undefined disables the button
  // entirely rather than rendering it disabled, matching onScanBill below.
  filterActive?: boolean
  onOpenFilter?: () => void
  children: ReactNode
  // A card's detail reuses Records (§7.3 v3.8), but its natural period is
  // the billing cycle, not the calendar month — set while one is open to
  // swap the month nav for cycle nav; null/undefined for the normal month.
  cardCycle?: { label: string; onPrev: () => void; onNext: () => void } | null
  // Records' Monthly tab (2026-09): swaps the month stepper for a year one,
  // same slot, same shape as cardCycle above — mutually exclusive with it
  // (TransactionsScreen falls back to Daily while a card is open, so the two
  // never both apply) and beaten by it in the precedence below regardless.
  yearNav?: { label: string; onPrev: () => void; onNext: () => void } | null
  // Desktop-only (≥ lg) third region. Only Records fills this today; every
  // other tab renders with no aside. Wrap content in <SummaryColumn>.
  aside?: ReactNode
}

export function AppShell({
  month,
  onMonthChange,
  person,
  onPersonChange,
  tab,
  onTabChange,
  onQuickAdd,
  onScanBill,
  onOpenSettings,
  search,
  onSearchChange,
  filterActive,
  onOpenFilter,
  children,
  cardCycle,
  yearNav,
  aside,
}: Props) {
  const { members } = useHousehold()
  const online = useOnline()
  const isDesktop = useIsDesktop()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  const personOptions: { value: PersonFilter; label: string }[] = [
    ...members.map((m) => ({ value: m.id, label: m.display_name })),
    { value: 'all', label: 'All' },
  ]

  const isRecords = tab === 'records'
  const filterButton = isRecords && onOpenFilter && (
    <Button variant="ghost" size="icon" onClick={onOpenFilter} aria-label="Filter records" className="relative">
      <SlidersHorizontal className="size-4" />
      {filterActive && (
        <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary" aria-hidden="true" />
      )}
    </Button>
  )
  // Balances honours the person filter too now (D19) — "You" narrows it to
  // your own accounts and cards, so the chips need to be reachable there,
  // not just on Records.
  const showPersonFilter = isRecords || tab === 'balances'
  const tabLabel = TABS.find((t) => t.key === tab)?.label ?? ''

  function closeSearch() {
    setSearchOpen(false)
    onSearchChange('')
  }

  const monthYearPicker = pickerOpen && (
    <MonthYearPicker month={month} onSelect={onMonthChange} onClose={() => setPickerOpen(false)} />
  )

  const personChips = showPersonFilter && (
    <div className="flex flex-wrap gap-1.5">
      {personOptions.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onPersonChange(opt.value)}
          className={cn(
            'rounded-full border px-2.5 py-1 text-xs transition-colors',
            person === opt.value
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border text-muted-foreground hover:bg-accent',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )

  // Desktop (≥ lg): nav rail replaces the bottom nav + FAB, the sticky
  // mobile header becomes a toolbar, and the whole shell is a fixed-height
  // three-region row (rail · content · optional summary) that scrolls
  // internally instead of the document scrolling — the bottom nav's `fixed`
  // positioning and the FAB's magic-number clearance don't apply here.
  if (isDesktop) {
    return (
      <div className="flex h-svh bg-background">
        <NavRail tab={tab} onTabChange={onTabChange} onQuickAdd={onQuickAdd} onOpenSettings={onOpenSettings} />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5">
            {cardCycle ? (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={cardCycle.onPrev} aria-label="Previous cycle">
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="font-heading text-base font-semibold">{cardCycle.label}</span>
                <Button variant="ghost" size="icon" onClick={cardCycle.onNext} aria-label="Next cycle">
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            ) : isRecords && search.trim() ? (
              // v3.9: search leaves the month, so the month nav isn't the
              // subject while a query is running — swapped for a plain
              // label rather than arrows that no longer mean anything.
              <h1 className="font-heading text-base font-semibold">Search results</h1>
            ) : isRecords && yearNav ? (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={yearNav.onPrev} aria-label="Previous year">
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="rounded-lg px-2 py-1 font-heading text-base font-semibold">{yearNav.label}</span>
                <Button variant="ghost" size="icon" onClick={yearNav.onNext} aria-label="Next year">
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            ) : isRecords ? (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => onMonthChange(shiftMonth(month, -1))} aria-label="Previous month">
                  <ChevronLeft className="size-4" />
                </Button>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="rounded-lg px-2 py-1 font-heading text-base font-semibold transition-colors hover:bg-accent"
                >
                  {monthLabel(month)}
                </button>
                <Button variant="ghost" size="icon" onClick={() => onMonthChange(shiftMonth(month, 1))} aria-label="Next month">
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            ) : (
              <h1 className="font-heading text-base font-semibold">{tabLabel}</h1>
            )}

            {personChips}

            <span className="flex-1" />

            {isRecords && (
              <label className="flex w-64 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm text-muted-foreground has-[input:focus-visible]:border-ring">
                <Search className="size-4 shrink-0" />
                <Input
                  value={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Search records…"
                  aria-label="Search records"
                  className="h-auto flex-1 border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
                />
              </label>
            )}

            {filterButton}

            {!online && (
              <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                <CloudOff className="size-3.5" />
                Offline
              </span>
            )}
          </header>

          {monthYearPicker}

          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>

        {aside}
      </div>
    )
  }

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-10 space-y-2 border-b bg-linear-to-r from-secondary/70 via-background/95 to-accent/60 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur">
        {!online && (
          <div className="flex items-center justify-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
            <CloudOff className="size-3.5" />
            Offline — showing the last data saved
          </div>
        )}

        {isRecords && searchOpen ? (
          <div className="flex items-center gap-1.5">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search notes, categories, accounts…"
              className="h-8 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
            />
            <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={closeSearch} aria-label="Close search">
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            {isRecords ? (
              <Button variant="ghost" size="icon" onClick={() => setSearchOpen(true)} aria-label="Search">
                <Search className="size-4" />
              </Button>
            ) : (
              <span className="size-9" />
            )}

            {isRecords && cardCycle ? (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={cardCycle.onPrev} aria-label="Previous cycle">
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="rounded-lg px-2 py-1 font-heading text-sm font-medium">{cardCycle.label}</span>
                <Button variant="ghost" size="icon" onClick={cardCycle.onNext} aria-label="Next cycle">
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            ) : isRecords && yearNav ? (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={yearNav.onPrev} aria-label="Previous year">
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="rounded-lg px-2 py-1 font-heading text-sm font-medium">{yearNav.label}</span>
                <Button variant="ghost" size="icon" onClick={yearNav.onNext} aria-label="Next year">
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            ) : isRecords ? (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => onMonthChange(shiftMonth(month, -1))} aria-label="Previous month">
                  <ChevronLeft className="size-4" />
                </Button>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="rounded-lg px-2 py-1 font-heading text-sm font-medium transition-colors active:bg-accent"
                >
                  {monthLabel(month)}
                </button>
                <Button variant="ghost" size="icon" onClick={() => onMonthChange(shiftMonth(month, 1))} aria-label="Next month">
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            ) : (
              <h1 className="font-heading text-sm font-medium">{tabLabel}</h1>
            )}

            <div className="flex items-center">
              {filterButton}
              <Button variant="ghost" size="icon" onClick={onOpenSettings} aria-label="Settings">
                <SettingsIcon className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {!searchOpen && personChips}
      </header>

      {monthYearPicker}

      {/* 9rem clears the FAB, which spans 5rem–8.5rem above the safe area:
          with less, the last line of a screen's content sits under it. */}
      <main className="flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+9rem)]">{children}</main>

      {/* Sits above the FAB rather than beside it: the FAB's position is the
          one control every screen shares, and moving it to make room would
          cost more than the second button gains. Smaller and unfilled, so it
          reads as the specialised way in, not a rival to it. */}
      {onScanBill && (
        <label
          className="fixed bottom-[calc(env(safe-area-inset-bottom)+9.25rem)] right-[1.375rem] z-20 flex size-11 cursor-pointer items-center justify-center rounded-full border bg-background text-foreground shadow-md transition-transform active:scale-95"
          aria-label="Scan a receipt"
        >
          <Camera className="size-5" />
          <input
            type="file"
            accept="image/*"
            // Opens the camera directly on a phone, the gallery on desktop.
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              // Cleared so photographing the same slip twice still fires a
              // change event the second time.
              e.target.value = ''
              if (file) onScanBill(file)
            }}
          />
        </label>
      )}

      <Button
        onClick={onQuickAdd}
        size="icon"
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] right-4 z-20 size-14 rounded-full border-0 bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-transform active:scale-95"
        aria-label="Quick add"
      >
        <Plus className="size-6" />
      </Button>

      <nav aria-label="Sections" className="fixed inset-x-0 bottom-0 z-10 flex border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => onTabChange(key)}
            className={cn(
              'flex min-h-12 flex-1 flex-col items-center justify-center gap-1 py-2 text-xs transition-colors active:bg-accent/60',
              tab === key ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <Icon className="size-5" />
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}
