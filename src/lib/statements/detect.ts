// Which layout is this? Asked of the transaction lines themselves, not a
// header: each parser reads what it recognises and the one that reads the most
// wins. A file nothing reads is "not supported yet", not a guess.
import { parseCardx } from './cardx'
import { parseKbank } from './kbank'
import { parseKtc } from './ktc'
import { parseUob } from './uob'
import type { ParseResult, Parser } from './types'

const PARSERS: Parser[] = [parseCardx, parseKtc, parseUob, parseKbank]
const MIN_LINES = 3

export function parseStatement(lines: string[], asOf: string): ParseResult | null {
  let best: ParseResult | null = null
  for (const parse of PARSERS) {
    const result = parse(lines, asOf)
    if (result && (!best || result.lines.length > best.lines.length)) best = result
  }
  return best && best.lines.length >= MIN_LINES ? best : null
}
