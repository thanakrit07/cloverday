import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AmountField } from '@/components/AmountField'
import { CategoryPickerPanel } from '@/components/CategoryPickerPanel'
import { EntryPage } from '@/components/EntryPage'
import { EntryRow } from '@/components/EntryRow'
import { InstrumentPickerPanel } from '@/components/InstrumentPickerPanel'
import { Keypad } from '@/components/Keypad'
import { useAmountEntry } from '@/hooks/useAmountEntry'
import { useEntryPanel } from '@/hooks/useEntryPanel'
import { useAccounts } from '@/lib/accounts'
import { useCards } from '@/lib/cards'
import { categoryPath, useCategories, type CategoryKind } from '@/lib/categories'
import { CategoryIcon } from '@/lib/categoryIcons'
import { useHousehold } from '@/lib/HouseholdContext'
import { useCreatePreset, useDeletePreset, useUpdatePreset, type Preset } from '@/lib/presets'
import { cn } from '@/lib/utils'

type PanelKey = 'amount' | 'category' | 'instrument'

// D27: creates or edits a Preset with the same rows and bottom panel as the
// entry form (ADR-0006). Only Kind, Category and a name are required; leaving
// the amount empty means the preset fills no amount, and leaving the account
// or card unset means the form's usual last-used default applies.
export function PresetSheet({ preset, onClose }: { preset: Preset | null; onClose: () => void }) {
  const { householdId, self } = useHousehold()
  const { data: categories } = useCategories(householdId)
  const { data: accounts } = useAccounts(householdId)
  const { data: cards } = useCards(householdId)
  const create = useCreatePreset(householdId, self.id)
  const update = useUpdatePreset(householdId)
  const remove = useDeletePreset(householdId)
  const panel = useEntryPanel<PanelKey>(null)

  const [kind, setKind] = useState<CategoryKind>(preset?.kind ?? 'expense')
  const [name, setName] = useState(preset?.name ?? '')
  const [categoryId, setCategoryId] = useState<string | null>(preset?.category_id ?? null)
  const [accountId, setAccountId] = useState<string | null>(preset?.account_id ?? null)
  const [cardId, setCardId] = useState<string | null>(preset?.card_id ?? null)
  const [note, setNote] = useState(preset?.note ?? '')
  const amountField = useAmountEntry(preset?.amount != null ? String(preset.amount) : '')

  const category = categories?.find((c) => c.id === categoryId) ?? null
  const instrumentName = accountId
    ? accounts?.find((a) => a.id === accountId)?.name
    : cardId
      ? cards?.find((c) => c.id === cardId)?.name
      : null
  const canSave = Boolean(name.trim() && categoryId)
  const pending = create.isPending || update.isPending

  function changeKind(next: CategoryKind) {
    setKind(next)
    panel.close()
    if (category && category.kind !== next) setCategoryId(null)
  }

  async function handleSave() {
    if (!categoryId) return
    const input = {
      name: name.trim(),
      kind,
      category_id: categoryId,
      note: note.trim() || null,
      account_id: accountId,
      card_id: cardId,
      amount: amountField.value > 0 ? amountField.value : null,
    }
    try {
      if (preset) await update.mutateAsync({ id: preset.id, input })
      else await create.mutateAsync(input)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the preset.')
    }
  }

  async function handleDelete() {
    if (!preset) return
    await remove.mutateAsync(preset.id)
    onClose()
  }

  return (
    <EntryPage
      title={preset ? 'Edit preset' : 'New preset'}
      onClose={onClose}
      panelOpen={panel.active !== null}
      footer={
        panel.active === 'amount' ? (
          <Keypad onKey={amountField.press} onEquals={amountField.pressEquals} onDone={panel.close} />
        ) : panel.active === 'category' ? (
          <CategoryPickerPanel
            categories={categories ?? []}
            kind={kind}
            selectedId={categoryId}
            onSelect={(c, hasSubs) => {
              setCategoryId(c.id)
              if (!name.trim()) setName(c.name)
              if (!hasSubs) panel.close()
            }}
          />
        ) : panel.active === 'instrument' ? (
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={() => {
                setAccountId(null)
                setCardId(null)
                panel.close()
              }}
              className={cn(
                'w-full rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors',
                !accountId && !cardId ? 'border-primary bg-primary/10' : 'border-border',
              )}
            >
              Last used with the category
            </button>
            <InstrumentPickerPanel
              value={{ accountId, cardId }}
              onChange={(next) => {
                setAccountId(next.accountId)
                setCardId(next.cardId)
                panel.close()
              }}
            />
          </div>
        ) : (
          <div className="flex gap-2">
            {preset && (
              <Button variant="outline" size="icon" onClick={handleDelete} aria-label="Delete preset">
                <Trash2 className="size-4" />
              </Button>
            )}
            <Button className="flex-1" onClick={handleSave} disabled={!canSave || pending}>
              Save
            </Button>
          </div>
        )
      }
    >
      <div className="space-y-1.5">
        <Label htmlFor="preset-name">Name</Label>
        <Input id="preset-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onFocus={panel.close} />
      </div>

      <Tabs value={kind} onValueChange={(v) => changeKind(v as CategoryKind)}>
        <TabsList className="w-full">
          <TabsTrigger value="expense" className="flex-1">
            Expense
          </TabsTrigger>
          <TabsTrigger value="income" className="flex-1">
            Income
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <EntryRow
        label="Category"
        placeholder={!category}
        active={panel.active === 'category'}
        onClick={() => panel.toggle('category')}
        value={
          category ? (
            <span className="flex items-center gap-1.5">
              <CategoryIcon icon={category.icon} color={category.color} className="size-4" />
              {categoryPath(category, categories ?? [])}
            </span>
          ) : (
            'Choose a category'
          )
        }
      />

      <EntryRow
        label="Account / card"
        placeholder={!instrumentName}
        active={panel.active === 'instrument'}
        onClick={() => panel.toggle('instrument')}
        value={instrumentName ?? 'Last used'}
      />

      <AmountField
        label="Amount (optional)"
        placeholder="Any amount"
        expr={amountField.expr}
        active={panel.active === 'amount'}
        onActivate={() => panel.toggle('amount')}
      />

      <div className="space-y-1.5">
        <Label htmlFor="preset-note">Note</Label>
        <Input id="preset-note" value={note} onChange={(e) => setNote(e.target.value)} onFocus={panel.close} />
      </div>
    </EntryPage>
  )
}
