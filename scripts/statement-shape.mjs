// Shows the layout of a statement PDF without showing what is in it, so a
// sample can be shared to get a parser right. Every word not on a short list of
// structural words becomes its shape (<t8> Thai, <a5> other letters) and every
// digit becomes 9. Output goes to the terminal only; nothing is written.
//
//   npm run statements:shape                (asks for the file; drag it in)
//   npm run statements:shape path/to/a.pdf  (one or more)
//
// Look through the output once before sharing it: it is built to hide
// everything it does not recognise, but you are the last check.
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { extractPdfLines, PasswordCancelled } from '../src/lib/statements/lines.ts'
import { parseStatement } from '../src/lib/statements/detect.ts'
import { shapeText } from '../src/lib/statements/shape.ts'

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

function askHidden(prompt) {
  return new Promise((resolve) => {
    process.stderr.write(prompt)
    let value = ''
    const stdin = process.stdin
    stdin.setRawMode?.(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode?.(false)
          stdin.pause()
          stdin.off('data', onData)
          process.stderr.write('\n')
          return resolve(value)
        }
        if (c === '\u0003') process.exit(130)
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1)
        else value += c
      }
    }
    stdin.on('data', onData)
  })
}

const passwords = {
  known: [],
  ask: async (wrong) => (await askHidden(wrong ? 'Wrong password, try again (Enter to skip): ' : 'This PDF has a password (not shown; Enter to skip): ')) || null,
}

// A path dragged into a terminal arrives quoted or with backslashes before spaces.
const clean = (p) => p.trim().replace(/^['"]|['"]$/g, '').replace(/\\(.)/g, '$1')

let files = process.argv.slice(2).map(clean).filter(Boolean)
if (files.length === 0) {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  const answer = await rl.question('PDF file (drag it here, then Enter): ')
  rl.close()
  files = answer.trim() ? [clean(answer)] : []
}

const today = new Date().toISOString().slice(0, 10)
for (const file of files) {
  console.log(`\n===== layout sample (${files.length > 1 ? `file ${files.indexOf(file) + 1}` : 'file'}) =====`)
  let lines
  try {
    lines = await extractPdfLines(pdfjs, new Uint8Array(await readFile(file)), passwords)
  } catch (e) {
    console.log(e instanceof PasswordCancelled ? 'Skipped: no password.' : `Could not read this file (${e instanceof Error ? e.name : 'error'}).`)
    continue
  }
  const parsed = parseStatement(lines, today)
  console.log(
    parsed
      ? `Layout: ${parsed.layout} | ${parsed.lines.length} transaction lines read | ${parsed.unreadable.length} that look like transactions but could not be read`
      : 'Layout: not recognised (no parser reads at least 3 lines)',
  )
  const unreadable = new Set(parsed?.unreadable.map((u) => u.line) ?? [])
  const read = new Set(parsed?.lines.map((l) => l.line) ?? [])
  console.log('(R = read, ? = could not be read, . = not a transaction line)\n')
  lines.forEach((line, i) => {
    const mark = read.has(i + 1) ? 'R' : unreadable.has(i + 1) ? '?' : '.'
    console.log(`${String(i + 1).padStart(4)} ${mark} ${shapeText(line)}`)
  })
}
