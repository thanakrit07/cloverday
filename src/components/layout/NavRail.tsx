import { Plus, Settings as SettingsIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Tab } from './tab-type'
import { TABS } from './tabs'

interface Props {
  tab: Tab
  onTabChange: (tab: Tab) => void
  onQuickAdd: () => void
  onOpenSettings: () => void
}

// Desktop (≥ lg) counterpart to AppShell's mobile bottom nav + FAB.
// docs/DESIGN.md §7.1 has promised "the bottom nav becomes a sidebar" since
// v3.5; the --sidebar-* tokens in index.css have sat unused since then too.
export function NavRail({ tab, onTabChange, onQuickAdd, onOpenSettings }: Props) {
  return (
    <nav
      aria-label="Sections"
      className="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r bg-sidebar px-3 py-4 text-sidebar-foreground"
    >
      <div className="flex items-center gap-2 px-2 pb-4">
        <span aria-hidden className="size-6 shrink-0 rounded-md bg-sidebar-primary" />
        <span className="font-heading text-sm font-semibold">Cloversky</span>
      </div>

      {TABS.map(({ key, label, icon: Icon }) => {
        return (
          <button
            key={key}
            type="button"
            onClick={() => onTabChange(key)}
            aria-current={tab === key ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
              tab === key
                ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" />
            {label}
          </button>
        )
      })}

      <button
        type="button"
        onClick={onQuickAdd}
        className="mt-2 flex items-center justify-center gap-1.5 rounded-lg bg-sidebar-primary px-2.5 py-2 text-sm font-medium text-sidebar-primary-foreground transition-opacity active:opacity-90"
      >
        <Plus className="size-4" />
        New record
      </button>

      <span className="flex-1" />

      <button
        type="button"
        onClick={onOpenSettings}
        className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
      >
        <SettingsIcon className="size-4 shrink-0" />
        Settings
      </button>
    </nav>
  )
}
