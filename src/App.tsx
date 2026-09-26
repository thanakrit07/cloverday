import { useEffect, useState } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import type { Tab } from '@/components/layout/AppShell'
import { SummaryColumn } from '@/components/layout/SummaryColumn'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { FullScreenPage } from '@/components/FullScreenPage'
import { ErrorScreen } from '@/components/ErrorScreen'
import { AuthScreen } from './components/AuthScreen'
import { HouseholdSetup } from './components/HouseholdSetup'
import { ResetPasswordScreen } from './components/ResetPasswordScreen'
import { TransactionsScreen, type RecordsView } from '@/features/transactions/TransactionsScreen'
import { ScanBillFlow } from '@/features/transactions/ScanBillFlow'
import { TransactionSheet } from '@/features/transactions/TransactionSheet'
import { RecordsSummary } from '@/features/transactions/RecordsSummary'
import { AccountDetailsScreen } from '@/features/accounts/AccountDetailsScreen'
import { AccountsScreen } from '@/features/accounts/AccountsScreen'
import { CardDetailsScreen } from '@/features/accounts/CardDetailsScreen'
import { InstallmentMaterialiser } from '@/features/installments/InstallmentMaterialiser'
import { PlanScreen } from '@/features/plan/PlanScreen'
import { RecurringMaterialiser } from '@/features/plan/RecurringMaterialiser'
import { SettingsScreen } from '@/features/settings/SettingsScreen'
import { useCards } from './lib/cards'
import { addDays, cycleOf } from './lib/finance/billingCycle'
import { fetchOwnMember, type HouseholdMember } from './lib/household'
import { HouseholdProvider } from './lib/HouseholdContext'
import { useIsDesktop } from './hooks/useIsDesktop'
import { useUrlState } from './hooks/useUrlState'
import { currentMonthKey, dayMonthLabel, shiftMonth, yearLabel, yearOfMonth } from './lib/month'
import type { PersonFilter } from './lib/filters'
import {
  ALL_RECORDS_FILTERS,
  decodeRecordsFilter,
  encodeRecordsFilter,
  isRecordsFilterActive,
  type RecordsFilterState,
} from './lib/recordsFilter'
import { RecordsFilterSheet } from '@/features/transactions/RecordsFilterSheet'
import { useSession } from './lib/useSession'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function SignedInApp({ self }: { self: HouseholdMember }) {
  const isDesktop = useIsDesktop()
  const [month, setMonth] = useUrlState('month', currentMonthKey())
  const [person, setPerson] = useUrlState('person', 'all')
  // Records is the landing tab (DESIGN.md §7.1 v3.5): the daily habit is
  // "open → jot what was spent → check what's recorded". The url key stays
  // 'transactions' so existing bookmarks/URL state keep working.
  const [tab, setTab] = useUrlState('tab', 'transactions')
  // Records' Filter screen (cat/acct repurpose two url keys that were wired
  // through App.tsx for an older single-value tap-through flow but, by the
  // time this shipped, nothing anywhere still wrote a value into either —
  // see recordsFilter.ts). `crd` is a separate, already-live feature (a
  // card's billing-cycle view below) and is left untouched.
  const [cat, setCat] = useUrlState('cat', '')
  const [acct, setAcct] = useUrlState('acct', '')
  const [xfer, setXfer] = useUrlState('xfer', '')
  const [unc, setUnc] = useUrlState('unc', '')
  const filter = decodeRecordsFilter({ cat, acct, xfer, unc })
  function setFilter(next: RecordsFilterState) {
    const params = encodeRecordsFilter(next)
    setCat(params.cat)
    setAcct(params.acct)
    setXfer(params.xfer)
    setUnc(params.unc)
  }
  const [filterOpen, setFilterOpen] = useState(false)
  // Daily/Monthly (2026-09) — URL-backed like every other Records mode here,
  // so a shared link to the yearly rollup lands on the yearly rollup.
  const [view, setView] = useUrlState('view', 'daily')
  const [cardId, setCardId] = useUrlState('crd', '')
  // Ephemeral, unlike the filters above: it's which cycle a card's detail is
  // scrolled to, not a fact worth round-tripping through a shared link.
  // Reset to today whenever a (possibly different) card is opened.
  const [cardAnchor, setCardAnchor] = useState(todayIso())
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  // ADR-0017. The file is the flow's identity: setting a new one restarts it,
  // clearing it ends it, and nothing else about a scan lives out here.
  const [scannedBill, setScannedBill] = useState<File | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [viewingAccountId, setViewingAccountId] = useState<string | null>(null)
  const [viewingCardId, setViewingCardId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const { data: cards } = useCards(self.household_id)
  const activeCard = cardId ? ((cards ?? []).find((c) => c.id === cardId) ?? null) : null
  const activeCycle = activeCard ? cycleOf(activeCard, cardAnchor) : null

  // Records/Balances/Upcoming — the tab bar's own keys — mapped onto the
  // URL's legacy tab names so an old bookmark for the removed Overview/Plan
  // tabs still lands somewhere sensible instead of a blank screen.
  const resolvedTab: Tab =
    tab === 'accounts' ? 'balances' : tab === 'plan' ? 'upcoming' : tab === 'home' || tab === 'transactions' ? 'records' : (tab as Tab)

  const screens: Record<Tab, React.ReactNode> = {
    records: (
      <TransactionsScreen
        month={month}
        onMonthChange={setMonth}
        view={view as RecordsView}
        onViewChange={(v) => setView(v)}
        person={person as PersonFilter}
        search={search}
        filter={filter}
        onClearFilter={() => setFilter(ALL_RECORDS_FILTERS)}
        card={activeCard}
        cardCycle={activeCycle}
        onClearCard={() => setCardId('')}
      />
    ),
    balances: (
      <AccountsScreen
        person={person as PersonFilter}
        onOpenAccount={(accountId) => setViewingAccountId(accountId)}
        onOpenCard={(id) => setViewingCardId(id)}
      />
    ),
    upcoming: <PlanScreen />,
  }

  return (
    <HouseholdProvider self={self}>
      <RecurringMaterialiser />
      <InstallmentMaterialiser />
      <AppShell
        month={month}
        onMonthChange={setMonth}
        person={person as PersonFilter}
        onPersonChange={(p) => setPerson(p)}
        tab={resolvedTab}
        onTabChange={(t) => setTab(t)}
        onQuickAdd={() => setQuickAddOpen(true)}
        onScanBill={setScannedBill}
        onOpenSettings={() => setSettingsOpen(true)}
        search={search}
        onSearchChange={setSearch}
        filterActive={isRecordsFilterActive(filter)}
        onOpenFilter={() => setFilterOpen(true)}
        cardCycle={
          activeCard && activeCycle
            ? {
                label: `${dayMonthLabel(activeCycle.start)} – ${dayMonthLabel(activeCycle.end)}`,
                onPrev: () => setCardAnchor(addDays(activeCycle.start, -1)),
                onNext: () => setCardAnchor(addDays(activeCycle.end, 1)),
              }
            : null
        }
        yearNav={
          resolvedTab === 'records' && view === 'monthly' && !activeCard && !search.trim()
            ? {
                label: yearLabel(yearOfMonth(month)),
                onPrev: () => setMonth(shiftMonth(month, -12)),
                onNext: () => setMonth(shiftMonth(month, 12)),
              }
            : null
        }
        aside={
          isDesktop && resolvedTab === 'records' && !search.trim() ? (
            <SummaryColumn>
              <RecordsSummary
                month={month}
                person={person as PersonFilter}
                card={activeCard}
                cardCycle={activeCycle}
                filter={filter}
              />
            </SummaryColumn>
          ) : undefined
        }
      >
        {/* Inside the shell, so a screen that throws leaves the bottom nav
            usable — tapping any other tab is itself the recovery, and the
            resetKeys below clear the error when it happens. */}
        <ErrorBoundary
          resetKeys={[resolvedTab]}
          fallback={(error, reset) => (
            <ErrorScreen
              error={error}
              variant="inline"
              onRetry={reset}
              onGoHome={() => {
                setTab('transactions')
                reset()
              }}
            />
          )}
        >
          {screens[resolvedTab] ?? screens.records}
        </ErrorBoundary>
      </AppShell>
      <TransactionSheet open={quickAddOpen} onOpenChange={setQuickAddOpen} />
      {filterOpen && (
        <RecordsFilterSheet
          filter={filter}
          onApply={(next) => {
            setFilter(next)
            setFilterOpen(false)
          }}
          onClose={() => setFilterOpen(false)}
        />
      )}
      {scannedBill && <ScanBillFlow file={scannedBill} onDone={() => setScannedBill(null)} />}
      {settingsOpen && (
        <FullScreenPage title="Settings" onClose={() => setSettingsOpen(false)}>
          <SettingsScreen />
        </FullScreenPage>
      )}
      {viewingAccountId && (
        <AccountDetailsScreen accountId={viewingAccountId} onClose={() => setViewingAccountId(null)} />
      )}
      {viewingCardId && <CardDetailsScreen cardId={viewingCardId} onClose={() => setViewingCardId(null)} />}
    </HouseholdProvider>
  )
}

function App() {
  const { session, loading: sessionLoading, passwordRecovery, clearPasswordRecovery } = useSession()
  const [member, setMember] = useState<HouseholdMember | null>(null)
  const [memberLoading, setMemberLoading] = useState(true)

  // Keyed on the user's id, not the session object. supabase-js hands back a
  // brand-new session object on every TOKEN_REFRESHED — which it emits when
  // the tab regains focus after being backgrounded — so depending on
  // `session` re-ran this for the same signed-in user, flipped
  // memberLoading, and dropped the whole app into the "Loading…" branch
  // below. That unmounts SignedInApp and everything under it, so switching
  // away from the app and back threw away whatever was in progress: an
  // in-flight import's files, column mappings and row edits, a half-typed
  // transaction, the screen you were on. The token still rotates underneath;
  // this only stops a rotation from being mistaken for a change of user.
  const userId = session?.user.id ?? null

  useEffect(() => {
    if (!userId) {
      setMember(null)
      setMemberLoading(false)
      return
    }
    let cancelled = false
    setMemberLoading(true)
    fetchOwnMember(userId)
      .then((result) => {
        if (!cancelled) setMember(result)
      })
      .finally(() => {
        if (!cancelled) setMemberLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  if (sessionLoading || (session && memberLoading)) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  if (passwordRecovery) {
    return <ResetPasswordScreen onDone={clearPasswordRecovery} />
  }

  if (!session) {
    return <AuthScreen />
  }

  if (!member) {
    const inviteCode = new URLSearchParams(window.location.search).get('invite')
    return <HouseholdSetup onCreated={setMember} inviteCode={inviteCode} />
  }

  // Outer net for anything the per-tab boundary can't catch (the shell, the
  // providers, a materialiser). Nothing of the app is left to navigate with
  // here, so recovery is a reload at the bare path.
  return (
    <ErrorBoundary fallback={(error) => <ErrorScreen error={error} variant="screen" />}>
      <SignedInApp self={member} />
    </ErrorBoundary>
  )
}

export default App
