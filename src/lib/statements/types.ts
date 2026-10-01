// What a statement parser hands back: lines of text in, structured lines out.
// Nothing here knows about the database, accounts or categories (stage.ts does).

export type Layout = 'cardx' | 'ktc' | 'uob' | 'kbank'

export interface StatementLine {
  /** 1-based position in the text the parser was given, for pointing at a line. */
  line: number
  /** The day the money moved: purchase date for a card, transaction date for a bank. */
  date: string
  /** The day the bank posted it. Cards only. */
  postedDate: string | null
  /** Always positive; `direction` says which way. */
  amount: number
  /** debit = a charge or money out, credit = a payment, refund or money in. */
  direction: 'debit' | 'credit'
  /** The description exactly as printed, installment marker and all. */
  text: string
  /** "003/006" or "02/06": which period of how many. */
  installment: { k: number; total: number } | null
  isInterest: boolean
}

/** A line that looks like a transaction but couldn't be read. Never dropped silently. */
export interface Unreadable {
  line: number
  text: string
  reason: string
}

export interface ParseResult {
  layout: Layout
  lines: StatementLine[]
  unreadable: Unreadable[]
  periodStart: string | null
  periodEnd: string | null
}

export type Parser = (lines: string[], asOf: string) => ParseResult | null
