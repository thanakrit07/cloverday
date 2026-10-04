import { describe, expect, it } from 'vitest'
import { shapeText } from './shape'

// What this must never do is let a word it was not told about through, so the
// check is on the output alone: nothing but shapes, 9s and punctuation.
const ONLY_SHAPES = /^(?:<[at]\d+>|9|[^\p{L}\p{M}\p{N}])*$/u

describe('shapeText', () => {
  it('keeps the structural words and hides everything else', () => {
    expect(shapeText('01-04-26 09:10 ชำระเงิน 60.00 940.00 EDC/K SHOP/MYQR เพื่อชำระ Ref X0000 DEMO CAFE')).toBe(
      '99-99-99 99:99 ชำระเงิน 99.99 999.99 EDC/K SHOP/MYQR เพื่อชำระ Ref <a1>9999 <a4> <a4>',
    )
  })

  it('hides a name, an address and an account number written in either script', () => {
    const secrets = ['สมชาย ใจดี', 'Somchai Jaidee', '99/123 หมู่บ้านสุขใจ', 'ซ. ลาดพร้าว 71', '123-4-56789-0', '1234 5678 9012 3456', 'บจก. เดโมสโตร์']
    for (const secret of secrets) {
      const shaped = shapeText(`โอนไป KBANK X1234 ${secret}`)
      expect(shaped).not.toMatch(/สมชาย|ใจดี|Somchai|Jaidee|หมู่บ้าน|ลาดพร้าว|เดโม/)
      expect(shaped.replace(/<[at]\d+>/g, '')).not.toMatch(/[0-8]/)
      expect(shaped).toContain('โอนไป KBANK')
    }
  })

  it('leaves nothing but shapes whatever it is given, including Thai digits and tone marks', () => {
    const alphabet = [...'abcXYZ019๑๒๓กขคงจ่้๊๋ะาิีุูเแโใไ -/.,:*()ñΩ漢字']
    let seed = 7
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648)
    for (let i = 0; i < 2000; i++) {
      const text = Array.from({ length: 1 + (next() % 40) }, () => alphabet[next() % alphabet.length]).join('')
      expect(shapeText(text, new Set())).toMatch(ONLY_SHAPES)
    }
  })
})
