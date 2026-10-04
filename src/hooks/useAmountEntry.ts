import { useState } from 'react'
import { appendKey, evaluateExpression, formatResult } from '@/lib/calculator'

// Backs one amount field driven by the in-app Keypad (DESIGN.md §7.2 D9):
// `expr` is the raw calculator expression as typed (e.g. "120+85"), `value`
// is always its evaluated number. Several of these can coexist in one sheet
// (e.g. installment's "amount per period" and "final period"), each getting
// its own instance while sharing the one Keypad in the sheet's footer.
export function useAmountEntry(initial = '') {
  const [expr, setExpr] = useState(initial)
  // Set by `fill` (a Preset's amount, D27): the first digit typed replaces
  // the filled value instead of extending it, as if it were selected text —
  // so 7 0 gives 70, not 6570. An operator still builds on it (65+10).
  const [replaceNext, setReplaceNext] = useState(false)
  const value = evaluateExpression(expr)

  function press(key: string) {
    const replace = replaceNext && /^[0-9.]$/.test(key)
    setReplaceNext(false)
    setExpr((prev) => appendKey(replace ? '' : prev, key))
  }

  function fill(next: string) {
    setExpr(next)
    setReplaceNext(true)
  }

  function pressEquals() {
    setReplaceNext(false)
    setExpr((prev) => {
      const result = evaluateExpression(prev)
      return result > 0 ? formatResult(result) : ''
    })
  }

  function reset() {
    setExpr('')
    setReplaceNext(false)
  }

  return { expr, setExpr, fill, value, press, pressEquals, reset }
}
