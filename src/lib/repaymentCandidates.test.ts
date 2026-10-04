import { describe, expect, it } from 'vitest'
import { isSettleKey, repaymentCandidates, type TransferLike } from './transactionShares'

const t = (id: string, date: string, from: string | null, to: string | null): TransferLike => ({
  id, date, amount: 100, note: null, description: '', from_account_id: from, from_card_id: null, to_account_id: to, to_card_id: null,
})
// accounts a1/a2 are Guy's, b1 is Mint's, pot has no owner
const owners: Record<string, string | null> = { a1: 'guy', a2: 'guy', b1: 'mint', pot: null }
const ownerOf = (account: string | null) => (account ? (owners[account] ?? null) : null)

describe('repaymentCandidates', () => {
  const transfers = [t('old', '2026-08-01', 'a1', 'b1'), t('new', '2026-09-01', 'a2', 'b1'), t('back', '2026-09-02', 'b1', 'a1'), t('own', '2026-09-03', 'a1', 'a2'), t('pot', '2026-09-04', 'a1', 'pot')]

  it('offers transfers from the payer\'s instruments to the payee\'s, newest first', () => {
    expect(repaymentCandidates(transfers, ownerOf, 'guy', 'mint', new Set()).map((x) => x.id)).toEqual(['new', 'old'])
  })

  it('leaves out the other direction, moves between one person\'s own accounts, and the common pot', () => {
    expect(repaymentCandidates(transfers, ownerOf, 'mint', 'guy', new Set()).map((x) => x.id)).toEqual(['back'])
  })

  it('leaves out a transfer that already clears something', () => {
    expect(repaymentCandidates(transfers, ownerOf, 'guy', 'mint', new Set(['new'])).map((x) => x.id)).toEqual(['old'])
  })
})

describe('isSettleKey', () => {
  it('recognises a transfer Settle up made, and not a bank line or a hand-entered one', () => {
    expect(isSettleKey('settle:7f3a')).toBe(true)
    expect(isSettleKey('stmt:abc:2026-09-01:1.00:x:1')).toBe(false)
    expect(isSettleKey(null)).toBe(false)
  })
})
