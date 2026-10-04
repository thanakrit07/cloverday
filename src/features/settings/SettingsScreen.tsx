import { lazy, Suspense, useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FullScreenPage } from '@/components/FullScreenPage'
import { CategoriesScreen } from '@/features/categories/CategoriesScreen'
import { ChangePasswordDialog } from '@/features/settings/ChangePasswordDialog'
import { InviteSection } from '@/features/settings/InviteSection'
import { PresetsScreen } from '@/features/settings/PresetsScreen'
import { useHousehold } from '@/lib/HouseholdContext'
import { clearPersistedCache } from '@/lib/queryClient'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Lazy: exceljs alone is ~900KB minified, pulled in only by the xlsx
// template/parsing code Import uses. Bundling that into the main chunk
// would tax every app open for a settings screen most sessions never
// visit — a dynamic import keeps it out until someone actually taps in.
const StatementImportScreen = lazy(() =>
  import('@/features/settings/StatementImportScreen').then((m) => ({ default: m.StatementImportScreen })),
)
const ImportScreen = lazy(() => import('@/features/settings/ImportScreen').then((m) => ({ default: m.ImportScreen })))

const THEMES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  // next-themes resolves the active theme only on the client, so the first
  // render would otherwise highlight the wrong segment.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <div className="flex gap-1 rounded-lg border p-1">
      {THEMES.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => setTheme(value)}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs transition-colors',
            mounted && theme === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground active:bg-accent',
          )}
        >
          <Icon className="size-3.5" />
          {label}
        </button>
      ))}
    </div>
  )
}

export function SettingsScreen({
  statementOpen,
  onStatementOpenChange: setStatementOpen,
}: {
  statementOpen: boolean
  onStatementOpenChange: (open: boolean) => void
}) {
  const { self, members } = useHousehold()
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [importOpen, setImportOpen] = useState<'full' | 'transactions' | null>(null)
  const [passwordOpen, setPasswordOpen] = useState(false)

  // Clear the local cache first: signing out re-renders into the auth screen,
  // and a still-populated client could flush household data back to
  // localStorage on the way out (DESIGN.md §8).
  async function handleSignOut() {
    await clearPersistedCache()
    await supabase.auth.signOut()
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <section>
        <h2 className="text-sm font-medium text-muted-foreground">Household</h2>
        <ul className="mt-2 space-y-1">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-2 text-sm">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: m.color }} />
              {m.display_name}
              {m.id === self.id && <span className="text-muted-foreground">(you)</span>}
            </li>
          ))}
        </ul>
      </section>

      <InviteSection />

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Data</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setCategoriesOpen(true)}>
            Manage categories
          </Button>
          <Button variant="outline" onClick={() => setPresetsOpen(true)}>
            Presets
          </Button>
          <Button variant="outline" onClick={() => setImportOpen('transactions')}>
            Bulk add transactions
          </Button>
          <Button variant="outline" onClick={() => setImportOpen('full')}>
            Import
          </Button>
          <Button variant="outline" onClick={() => setStatementOpen(true)}>
            Import statement
          </Button>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Appearance</h2>
        <ThemeToggle />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Account</h2>
        <Button variant="outline" onClick={() => setPasswordOpen(true)}>
          Change password
        </Button>
      </section>

      <Button variant="outline" onClick={handleSignOut}>
        Sign out
      </Button>
      <p className="text-xs text-muted-foreground">
        Signing out also clears the financial data cached on this device.
      </p>

      {categoriesOpen && (
        <FullScreenPage title="Categories" onClose={() => setCategoriesOpen(false)}>
          <CategoriesScreen />
        </FullScreenPage>
      )}

      {presetsOpen && (
        <FullScreenPage title="Presets" onClose={() => setPresetsOpen(false)}>
          <PresetsScreen />
        </FullScreenPage>
      )}

      {importOpen && (
        <FullScreenPage title={importOpen === 'transactions' ? 'Bulk add transactions' : 'Import'} onClose={() => setImportOpen(null)}>
          <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading…</p>}>
            <ImportScreen onClose={() => setImportOpen(null)} mode={importOpen} />
          </Suspense>
        </FullScreenPage>
      )}

      {statementOpen && (
        <FullScreenPage title="Import statement" onClose={() => setStatementOpen(false)}>
          <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading…</p>}>
            <StatementImportScreen onClose={() => setStatementOpen(false)} />
          </Suspense>
        </FullScreenPage>
      )}

      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </div>
  )
}
