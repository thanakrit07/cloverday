import { useState } from 'react'
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripHorizontal, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SwipeableRow } from '@/components/SwipeableRow'
import { useAccounts } from '@/lib/accounts'
import { useCards } from '@/lib/cards'
import { categoryPath, useCategories, type Category } from '@/lib/categories'
import { CategoryIcon } from '@/lib/categoryIcons'
import { formatBaht } from '@/lib/format'
import { useHousehold } from '@/lib/HouseholdContext'
import {
  suggestPresets,
  useCreatePreset,
  useDeletePreset,
  usePresetHistory,
  usePresets,
  useRenamePreset,
  useReorderPresets,
  type Preset,
  type PresetInput,
} from '@/lib/presets'

// D27: rename, reorder, delete, and add from suggestions. What a preset fills
// is changed by saving a new one from the entry form, which is already the
// form for exactly those fields (ADR-0021).
export function PresetsScreen() {
  const { householdId, self } = useHousehold()
  const { data: presets } = usePresets(householdId, self.id)
  const { data: history } = usePresetHistory(householdId, self.id)
  const { data: categories } = useCategories(householdId)
  const { data: accounts } = useAccounts(householdId)
  const { data: cards } = useCards(householdId)
  const create = useCreatePreset(householdId, self.id)
  const remove = useDeletePreset(householdId)
  const reorder = useReorderPresets(householdId)
  const [renaming, setRenaming] = useState<Preset | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const list = presets ?? []
  const byId = new Map((categories ?? []).map((c) => [c.id, c]))
  const usable = (categoryId: string) => {
    const c = byId.get(categoryId)
    return c != null && !c.archived && !c.system
  }
  const suggestions = suggestPresets(history ?? [], list).filter((s) => usable(s.category_id))

  function describe(p: Pick<Preset, 'category_id' | 'account_id' | 'card_id' | 'amount'>): string {
    const category = byId.get(p.category_id)
    const instrument = p.account_id
      ? accounts?.find((a) => a.id === p.account_id)?.name
      : p.card_id
        ? cards?.find((c) => c.id === p.card_id)?.name
        : null
    return [
      category ? categoryPath(category, categories ?? []) : '…',
      instrument,
      p.amount != null ? formatBaht(p.amount) : null,
    ]
      .filter(Boolean)
      .join(' · ')
  }

  async function handleReorder(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = list.findIndex((p) => p.id === active.id)
    const newIndex = list.findIndex((p) => p.id === over.id)
    await reorder.mutateAsync(arrayMove(list, oldIndex, newIndex))
  }

  async function handleAdd(s: PresetInput) {
    const name = s.name || byId.get(s.category_id)?.name || 'Preset'
    try {
      await create.mutateAsync({
        input: { ...s, name: name.slice(0, 40) },
        sortOrder: Math.max(-1, ...list.map((p) => p.sort_order)) + 1,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add the preset.')
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <section className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Tap one on the add-transaction form to fill it in. To make a new one, fill the form and tap the bookmark at
          the top. Only you see your presets.
        </p>
        {list.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No presets yet.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleReorder}>
            <SortableContext items={list.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1.5">
                {list.map((p) => (
                  <PresetRow
                    key={p.id}
                    preset={p}
                    category={byId.get(p.category_id)}
                    subtitle={describe(p)}
                    onRename={() => setRenaming(p)}
                    onDelete={() => remove.mutate(p.id)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </section>

      {suggestions.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Suggested</h2>
          <p className="text-xs text-muted-foreground">What you've recorded three or more times in the last 90 days.</p>
          <ul className="space-y-1.5">
            {suggestions.map((s) => {
              const category = byId.get(s.category_id)
              return (
                <li key={`${s.category_id}|${s.note}`} className="flex items-center gap-2 rounded-lg border px-2 py-2 text-sm">
                  <CategoryIcon icon={category?.icon ?? null} color={category?.color ?? null} className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{s.name || category?.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{describe(s)}</span>
                  </span>
                  <Button size="sm" variant="outline" onClick={() => handleAdd(s)} disabled={create.isPending}>
                    <Plus className="size-4" />
                    Add
                  </Button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {renaming && <RenameDialog preset={renaming} onClose={() => setRenaming(null)} />}
    </div>
  )
}

function PresetRow({
  preset,
  category,
  subtitle,
  onRename,
  onDelete,
}: {
  preset: Preset
  category: Category | undefined
  subtitle: string
  onRename: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: preset.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }

  return (
    <li ref={setNodeRef} style={style} className="overflow-hidden rounded-lg border bg-card">
      <SwipeableRow onDelete={onDelete}>
        <div className="flex items-center gap-1.5 px-2 py-2 text-sm">
          <CategoryIcon icon={category?.icon ?? null} color={category?.color ?? null} className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className={category?.archived ? 'block truncate text-muted-foreground line-through' : 'block truncate'}>
              {preset.name}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {category?.archived ? 'Category archived — hidden on the form' : subtitle}
            </span>
          </span>
          <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={onRename} aria-label={`Rename ${preset.name}`}>
            <Pencil className="size-3.5" />
          </Button>
          <button
            {...attributes}
            {...listeners}
            className="flex size-7 shrink-0 touch-none items-center justify-center text-muted-foreground"
            aria-label={`Reorder ${preset.name}`}
          >
            <GripHorizontal className="size-4" />
          </button>
        </div>
      </SwipeableRow>
    </li>
  )
}

function RenameDialog({ preset, onClose }: { preset: Preset; onClose: () => void }) {
  const { householdId } = useHousehold()
  const rename = useRenamePreset(householdId)
  const [name, setName] = useState(preset.name)

  async function handleSave() {
    await rename.mutateAsync({ id: preset.id, name: name.trim() })
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename preset</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="preset-rename">Name</Label>
          <Input id="preset-rename" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || rename.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
