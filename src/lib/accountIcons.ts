import { Banknote, Landmark, Smartphone, type LucideIcon } from 'lucide-react'
import type { AccountType } from './accounts'

// One icon per kind of account, shared by Balances' rows and the entry
// form's picker so an account looks the same where it's picked and where its
// balance is read.
export const ACCOUNT_ICON: Record<AccountType, LucideIcon> = { bank: Landmark, cash: Banknote, ewallet: Smartphone }
