// Showing the layout of a statement without showing what is in it. Every word
// not on the structural list becomes its shape (<t8> Thai letters, <a5> other
// letters), every digit becomes 9. A word missing from the list is hidden, not
// shown, so forgetting one makes a sample less useful and never leaks. Used by
// `npm run statements:shape`, whose output is only ever printed.

export const STRUCTURAL_WORDS: ReadonlySet<string> = new Set(
  [
    // card statements
    'PAYMENT', 'RECEIVED', 'FROM', 'EASY', 'APP', 'IPP', 'INTEREST', 'SETUP', 'CASH', 'ADV', 'FEE', 'PREVIOUS', 'BALANCE', 'TOTAL',
    'THANK', 'YOU', 'CR', 'ADJUST', 'TRANSFER', 'TO', 'FLEXI', 'PAYLATER', 'PAGE', 'BANGKOK', 'THA',
    // months on UOB lines
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
    // bank statements: types, channels, bank codes
    // Kept columns
    'DATE', 'TIME', 'TRANSACTION', 'WITHDRAWAL', 'DEPOSIT', 'CHANNEL', 'THB', 'ENDING', 'PROMPTPAY',
    'K', 'PLUS', 'KBANK', 'BAY', 'SCB', 'KTB', 'TTB', 'KK', 'UOBT', 'TMRW', 'REF', 'EDC', 'MYQR', 'SHOP', 'INTERNET', 'MOBILE',
    'ยอดยกมา', 'รับโอนเงิน', 'รับโอนเงินอัตโนมัติ', 'โอนเงิน', 'ชำระเงิน', 'หักบัญชี', 'ฝากเงิน', 'โอนไป', 'จาก', 'เพื่อชำระ', 'พร้อมเพย์',
  ].map((w) => w.toUpperCase()),
)

// Thai letters (with their tone marks) are one kind of run, any other letters
// another, digits (Thai ones too) a single 9 each; the rest is punctuation.
const RUN = /[\p{Script=Thai}\p{M}]+|\p{L}[\p{L}\p{M}]*|\p{N}/gu

function shapeToken(token: string): string {
  return token.replace(RUN, (run) => {
    if (/^\p{N}$/u.test(run)) return '9'
    const length = [...run].filter((c) => !/\p{M}/u.test(c)).length
    return /^[\p{Script=Thai}\p{M}]/u.test(run) ? `<t${length}>` : `<a${length}>`
  })
}

function shapeWord(word: string, allowed: ReadonlySet<string>): string {
  return word === '' || allowed.has(word.toUpperCase()) ? word : shapeToken(word)
}

export function shapeText(text: string, allowed: ReadonlySet<string> = STRUCTURAL_WORDS): string {
  return text
    .split(/(\s+)/)
    .map((part) => (part === '' || /^\s+$/.test(part) ? part : part.split('/').map((piece) => shapeWord(piece, allowed)).join('/')))
    .join('')
}
