import { Check, CreditCard, type LucideIcon } from 'lucide-react'
import { ACCOUNT_ICON } from '@/lib/accountIcons'
import { useAccounts } from '@/lib/accounts'
import { useCards } from '@/lib/cards'
import { useHousehold } from '@/lib/HouseholdContext'
import { groupByOwner } from '@/lib/ownerGroups'
import { cn } from '@/lib/utils'
import type { Instrument } from '@/components/InstrumentSelect'

interface Props {
  value: Instrument
  onChange: (instrument: Instrument) => void
}

interface Item {
  key: string
  name: string
  owner_id: string | null
  icon: LucideIcon
  isCard: boolean
  instrument: Instrument
}

// The account/card row's content for the shared bottom panel (v3.6,
// ADR-0006) — a flat tappable list instead of InstrumentSelect's own Radix
// popover, so it sits in the same panel as the keypad/calendar/category
// grid instead of opening a second overlay on top of the page. A two-up
// grid rather than one row per instrument: most households have a handful
// of accounts and cards, and a single-column list left most of that width
// empty while pushing the panel taller than it needed to be.
// InstrumentSelect itself stays in use where a plain dropdown still fits
// (SettleUpSheet, which isn't part of this redesign).
//
// 2026-10 redesign: grouped the way Balances is — by whose it is, yours
// first, the Common Pot last — with Balances' own row look (an icon square,
// amber for a card), so an instrument reads the same where it's picked and
// where it's read. No figures: this panel answers "which one", not "how much".
export function InstrumentPickerPanel({ value, onChange }: Props) {
  const { householdId, members, self } = useHousehold()
  const { data: accounts } = useAccounts(householdId)
  const { data: cards } = useCards(householdId)

  const items: Item[] = [
    ...(accounts ?? [])
      .filter((a) => !a.archived)
      .map((a) => ({
        key: `account:${a.id}`,
        name: a.name,
        owner_id: a.owner_id,
        icon: ACCOUNT_ICON[a.type],
        isCard: false,
        instrument: { accountId: a.id, cardId: null },
      })),
    ...(cards ?? [])
      .filter((c) => !c.archived)
      .map((c) => ({
        key: `card:${c.id}`,
        name: c.name,
        owner_id: c.owner_id,
        icon: CreditCard,
        isCard: true,
        instrument: { accountId: null, cardId: c.id },
      })),
  ]
  const ownerGroups = groupByOwner(items, members.map((m) => m.id), self.id)
  const potItems = items.filter((i) => i.owner_id === null)
  // One owner and no pot has nothing to tell apart, so no headings at all.
  const showHeadings = ownerGroups.length + (potItems.length > 0 ? 1 : 0) > 1

  const isSelected = (i: Item) =>
    i.isCard ? value.cardId === i.instrument.cardId : value.accountId === i.instrument.accountId

  const group = (key: string, heading: React.ReactNode, groupItems: Item[]) => (
    <div key={key} className="space-y-1.5">
      {showHeadings && <p className="flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">{heading}</p>}
      <div className="grid grid-cols-2 gap-1.5">
        {groupItems.map((i) => {
          const selected = isSelected(i)
          const Icon = i.icon
          return (
            <button
              key={i.key}
              type="button"
              onClick={() => onChange(i.instrument)}
              className={cn(
                'flex items-center gap-2.5 rounded-xl p-1.5 pr-2.5 text-left text-sm transition-colors active:scale-[0.98]',
                selected ? 'bg-primary/15 ring-1 ring-inset ring-primary' : 'bg-muted/60',
              )}
            >
              <span
                className={cn(
                  'grid size-8 shrink-0 place-items-center rounded-lg',
                  i.isCard ? 'bg-warning text-warning-foreground' : 'bg-secondary text-secondary-foreground',
                )}
              >
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1 truncate">{i.name}</span>
              {selected && <Check className="size-4 shrink-0 text-primary" />}
            </button>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="max-h-full space-y-3 overflow-y-auto">
      {ownerGroups.map((g) => {
        const member = members.find((m) => m.id === g.ownerId)
        return group(
          g.ownerId,
          <>
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: member?.color ?? 'currentColor' }} />
            {member?.display_name ?? 'Former member'}
            {g.ownerId === self.id ? ' (you)' : ''}
          </>,
          g.items,
        )
      })}
      {potItems.length > 0 &&
        group(
          'pot',
          <>
            <span className="size-2 shrink-0 rounded-full border border-dashed border-current" />
            Common pot
          </>,
          potItems,
        )}
    </div>
  )
}
