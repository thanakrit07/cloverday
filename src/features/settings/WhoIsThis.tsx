import { useState } from 'react'
import { CategoryOptions } from '@/components/CategoryOptions'
import { Button } from '@/components/ui/button'
import type { CategoryLike } from '@/lib/categoryGroups'
import type { CounterpartyAnswer } from '@/lib/statementMemory'

interface Props {
  /** One name, or several that are getting the same answer. */
  names: string[]
  accounts: { id: string; name: string }[]
  cards: { id: string; name: string }[]
  members: { id: string; display_name: string }[]
  categories: CategoryLike[]
  saving: boolean
  onCancel: () => void
  onSave: (answer: CounterpartyAnswer) => void
}

type Role = CounterpartyAnswer['role']

// ADR-0020: answered once, applied to every line with these names, and remembered.
export function WhoIsThis({ names, accounts, cards, members, categories, saving, onCancel, onSave }: Props) {
  const [role, setRole] = useState<Role>('own_account')
  const [target, setTarget] = useState('')

  function save() {
    if (!target) return
    if (role === 'own_account') {
      const isAccount = accounts.some((a) => a.id === target)
      onSave({ role, accountId: isAccount ? target : null, cardId: isAccount ? null : target })
    } else if (role === 'member') onSave({ role, memberId: target })
    else onSave({ role, categoryId: target })
  }

  return (
    <div className="space-y-2 border-b bg-muted/40 p-3 text-xs">
      <p>
        {names.length === 1 ? (
          <>
            Who is <span className="font-medium">{names[0]}</span>?
          </>
        ) : (
          <>
            One answer for <span className="font-medium">{names.length} names</span>:
          </>
        )}{' '}
        Every line with {names.length === 1 ? 'this name follows it' : 'these names follows it'}, now and on later statements.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-8 rounded-md border bg-background px-2"
          value={role}
          onChange={(e) => {
            setRole(e.target.value as Role)
            setTarget('')
          }}
        >
          <option value="own_account">One of our accounts or cards</option>
          <option value="member">A member of the household</option>
          <option value="merchant">A shop or company</option>
        </select>
        <select className="h-8 rounded-md border bg-background px-2" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Which one">
          <option value="">Choose…</option>
          {role === 'own_account' && [...accounts, ...cards].map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          {role === 'member' && members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
          {role === 'merchant' && <CategoryOptions categories={categories} kind="expense" />}
        </select>
        <Button size="sm" disabled={!target || saving} onClick={save}>
          {saving ? 'Saving…' : names.length === 1 ? 'Save' : `Save for ${names.length} names`}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}
