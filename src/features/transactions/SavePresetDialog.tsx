import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatBaht } from '@/lib/format'
import { useHousehold } from '@/lib/HouseholdContext'
import { useCreatePreset, usePresets, type PresetInput } from '@/lib/presets'

// D27: "Save as preset" on the entry form keeps what is typed there. The
// amount is opt-in — most spending isn't the same price twice, and a preset
// that fills a wrong amount by default is worse than one that fills none.
export function SavePresetDialog({
  draft,
  defaultName,
  onClose,
}: {
  draft: Omit<PresetInput, 'name'>
  defaultName: string
  onClose: () => void
}) {
  const { householdId, self } = useHousehold()
  const { data: presets } = usePresets(householdId, self.id)
  const create = useCreatePreset(householdId, self.id)
  const [name, setName] = useState(defaultName.slice(0, 40))
  const [withAmount, setWithAmount] = useState(false)

  async function handleSave() {
    try {
      await create.mutateAsync({
        input: { ...draft, name: name.trim(), amount: withAmount ? draft.amount : null },
        sortOrder: Math.max(-1, ...(presets ?? []).map((p) => p.sort_order)) + 1,
      })
      toast.success(`Preset "${name.trim()}" saved`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the preset.')
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save as preset</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="preset-name">Name</Label>
            <Input id="preset-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          </div>
          {draft.amount != null && draft.amount > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={withAmount} onCheckedChange={(v) => setWithAmount(v === true)} />
              Include the amount ({formatBaht(draft.amount)})
            </label>
          )}
          <p className="text-xs text-muted-foreground">
            Keeps the category, note and account or card. Who bears is chosen each time.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || create.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
