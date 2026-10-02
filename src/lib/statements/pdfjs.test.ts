import { describe, expect, it } from 'vitest'
import { extractPdfLines, type PdfJs } from './lines'
import { parseStatement } from './detect'

// A one-page PDF built here, holding invented card lines, read by the real pdf.js.
function tinyPdf(lines: string[]): Uint8Array {
  const content = lines.map((l, i) => `BT /F1 10 Tf 1 0 0 1 40 ${760 - i * 14} Tm (${l}) Tj ET`).join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new TextEncoder().encode(pdf)
}

describe('extractPdfLines with the real pdf.js', () => {
  it('reads a PDF into the lines a parser takes', async () => {
    const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs
    const pdf = tinyPdf(['23/09/26 1,000.00 100.00 13/10/26', '24/08 24/08 Cash Adv Fee 936.25', '26/08 25/08 DEMO CAFE BANGKOK THA 120.00', '01/09 01/09 Payment received from Easy App -8,000.00'])
    const lines = await extractPdfLines(pdfjs, pdf, { known: [], ask: () => Promise.resolve(null) })
    expect(lines).toEqual(['23/09/26 1,000.00 100.00 13/10/26', '24/08 24/08 Cash Adv Fee 936.25', '26/08 25/08 DEMO CAFE BANGKOK THA 120.00', '01/09 01/09 Payment received from Easy App -8,000.00'])
    expect(parseStatement(lines, '2026-09-27')).toMatchObject({ layout: 'cardx' })
  }, 20000)
})
