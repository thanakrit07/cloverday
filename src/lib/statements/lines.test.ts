import { describe, expect, it } from 'vitest'
import { extractPdfLines, itemsToLines, PasswordCancelled, type PdfJs, type TextItem } from './lines'

const item = (str: string, x: number, y: number, width = str.length * 5): TextItem => ({ str, transform: [1, 0, 0, 1, x, y], width })

describe('itemsToLines', () => {
  it('puts drawing-order items back into reading order, top to bottom and left to right', () => {
    const lines = itemsToLines([item('60.00', 200, 700), item('DEMO CAFE', 60, 700), item('01-04-26', 10, 700), item('second line', 10, 680)])
    expect(lines).toEqual(['01-04-26 DEMO CAFE 60.00', 'second line'])
  })

  it('joins items that touch and spaces items that do not', () => {
    const lines = itemsToLines([item('ชำ', 10, 700, 10), item('ระ', 20, 700, 10), item('120.00', 80, 700)])
    expect(lines).toEqual(['ชำระ 120.00'])
  })

  it('treats a small drift in height as the same line', () => {
    expect(itemsToLines([item('A', 10, 700), item('B', 30, 699.2)])).toEqual(['A B'])
  })
})

describe('extractPdfLines', () => {
  const fakePdf = (opts: { password?: string }): PdfJs => ({
    getDocument() {
      const task = {
        onPassword: undefined as ((update: (p: string) => void, reason: number) => void) | undefined,
        destroyed: false,
        destroy() {
          this.destroyed = true
          return Promise.resolve()
        },
        promise: undefined as unknown as ReturnType<PdfJs['getDocument']>['promise'],
      }
      task.promise = new Promise((resolve, reject) => {
        const open = () =>
          resolve({
            numPages: 1,
            getPage: () => Promise.resolve({ getTextContent: () => Promise.resolve({ items: [item('hello', 10, 700)] }) }),
          })
        queueMicrotask(() => {
          if (opts.password === undefined) return open()
          const ask = (reason: number) =>
            task.onPassword!((p) => (p === opts.password ? open() : ask(2)), reason)
          // a task cancelled while waiting rejects, as pdf.js does
          const watch = setInterval(() => {
            if (task.destroyed) {
              clearInterval(watch)
              reject(new Error('Loading aborted: destroyed'))
            }
          }, 1)
          ask(1)
        })
      })
      return task as unknown as ReturnType<PdfJs['getDocument']>
    },
  })

  it('reads an open file without asking for anything', async () => {
    const passwords = { known: [], ask: () => Promise.reject(new Error('should not ask')) }
    expect(await extractPdfLines(fakePdf({}), new Uint8Array(), passwords)).toEqual(['hello'])
  })

  it('tries a password that opened an earlier file before asking, and remembers the one that works', async () => {
    const asked: boolean[] = []
    const passwords = { known: ['old'], ask: (wrong: boolean) => (asked.push(wrong), Promise.resolve(asked.length === 1 ? 'nope' : 'right')) }
    expect(await extractPdfLines(fakePdf({ password: 'right' }), new Uint8Array(), passwords)).toEqual(['hello'])
    expect(asked).toEqual([false, true]) // the known one failed silently; then asked, wrong once, then right
    expect(passwords.known).toContain('right')
  })

  it('gives up when no password is given', async () => {
    const passwords = { known: [], ask: () => Promise.resolve(null) }
    await expect(extractPdfLines(fakePdf({ password: 'x' }), new Uint8Array(), passwords)).rejects.toBeInstanceOf(PasswordCancelled)
  })
})
