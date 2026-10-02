// PDF -> lines of text, the input every parser in this folder takes. Shared by
// the review screen and `npm run statements:shape`, so what the tool shows
// about a layout is what the screen will read.
//
// The pdf.js module is passed in rather than imported: the browser and Node
// need different builds of it, and this file must not decide which.

export interface TextItem {
  str: string
  /** pdf.js's transform: [scaleX, skewY, skewX, scaleY, x, y]. */
  transform: number[]
  width: number
}

const LINE_TOLERANCE = 2.5
const WORD_GAP = 1

/** Words come out of pdf.js in drawing order, not reading order; sort them back into lines. */
export function itemsToLines(items: TextItem[]): string[] {
  const placed = items.filter((it) => it.str.trim() !== '').map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width }))
  placed.sort((a, b) => b.y - a.y || a.x - b.x)

  const rows: (typeof placed)[] = []
  for (const it of placed) {
    const row = rows[rows.length - 1]
    if (row && Math.abs(row[0].y - it.y) <= LINE_TOLERANCE) row.push(it)
    else rows.push([it])
  }
  return rows
    .map((row) => {
      row.sort((a, b) => a.x - b.x)
      let text = ''
      let end = Number.NEGATIVE_INFINITY
      for (const it of row) {
        const joined = text === '' || text.endsWith(' ') || it.str.startsWith(' ') || it.x - end <= WORD_GAP
        text += (joined ? '' : ' ') + it.str
        end = it.x + it.width
      }
      return text.replace(/\s+/g, ' ').trim()
    })
    .filter(Boolean)
}

/** Passwords tried before asking: ones that already opened another file in this run. */
export interface PasswordSource {
  known: string[]
  /** Return null to give up on this file. `wrong` is true after a rejected try. */
  ask(wrong: boolean): Promise<string | null>
}

// The slice of pdf.js used here.
interface PdfTask {
  promise: Promise<{ numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }> }>
  onPassword?: (update: (password: string) => void, reason: number) => void
  destroy(): Promise<void>
}
export interface PdfJs {
  getDocument(src: { data: Uint8Array }): PdfTask
}

export class PasswordCancelled extends Error {
  constructor() {
    super('No password given')
  }
}

export async function extractPdfLines(pdfjs: PdfJs, data: Uint8Array, passwords: PasswordSource): Promise<string[]> {
  const task = pdfjs.getDocument({ data: data.slice() })
  const triedKnown = new Set<string>()
  let lastTried: string | null = null
  let askedTheUser = false
  task.onPassword = (update, reason) => {
    const next = passwords.known.find((p) => !triedKnown.has(p))
    if (next !== undefined) {
      triedKnown.add(next)
      lastTried = next
      update(next)
      return
    }
    // "Wrong password" is only worth saying once the user has typed one.
    const wrong = reason === 2 && askedTheUser
    askedTheUser = true
    void passwords.ask(wrong).then((p) => {
      if (p === null) {
        void task.destroy()
        return
      }
      lastTried = p
      update(p)
    })
  }
  let doc
  try {
    doc = await task.promise
  } catch (e) {
    if (e instanceof Error && /destroyed|cancel/i.test(e.message)) throw new PasswordCancelled()
    throw e
  }
  if (lastTried !== null && !passwords.known.includes(lastTried)) passwords.known.push(lastTried)

  const out: string[] = []
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      out.push(...itemsToLines(content.items as TextItem[]))
    }
  } finally {
    await task.destroy() // the loading task owns the document; the document itself has no destroy
  }
  return out
}
