import { csvFormatRows, csvParseRows } from 'd3'
import type { Cell, Column, DataTable } from './table'

export interface CsvResult {
  table: DataTable | null
  warnings: string[]
  error?: string
}

const MAX_ROWS = 20000
const isNumeric = (s: string) => s.trim() !== '' && Number.isFinite(Number(s.replace(/,/g, '')))

/**
 * Parses CSV text (RFC 4180 quoting via d3-dsv) into a typed table. A column is numeric when
 * every non-empty cell parses as a number; everything else is categorical.
 */
export function parseCsv(text: string): CsvResult {
  const warnings: string[] = []
  const clean = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trim()
  if (!clean) return { table: null, warnings, error: '파일이 비어 있습니다.' }
  const raw = csvParseRows(clean).filter((r) => r.some((c) => c.trim() !== ''))
  if (raw.length < 2) return { table: null, warnings, error: '머리글 행과 최소 1개의 데이터 행이 필요합니다.' }
  const header = raw[0].map((h, i) => h.trim() || `열${i + 1}`)
  const names = new Map<string, number>()
  const unique = header.map((h) => {
    const k = names.get(h) ?? 0
    names.set(h, k + 1)
    return k ? `${h}_${k + 1}` : h
  })
  if (unique.some((h, i) => h !== header[i])) warnings.push('중복된 열 이름에 번호를 붙였습니다.')
  let body = raw.slice(1)
  if (body.length > MAX_ROWS) {
    warnings.push(`행이 너무 많아 처음 ${MAX_ROWS.toLocaleString()}행만 불러왔습니다.`)
    body = body.slice(0, MAX_ROWS)
  }
  const width = unique.length
  let ragged = 0
  body = body.map((r) => {
    if (r.length !== width) ragged++
    return Array.from({ length: width }, (_, i) => (r[i] ?? '').trim())
  })
  if (ragged) warnings.push(`${ragged}개 행의 열 개수가 머리글과 달라 빈칸을 채우거나 잘라냈습니다.`)
  const columns: Column[] = unique.map((name, i) => {
    const cells = body.map((r) => r[i]).filter((c) => c !== '')
    return { name, type: cells.length > 0 && cells.every(isNumeric) ? 'number' : 'category' }
  })
  const rows: Cell[][] = body.map((r) =>
    r.map((c, i) => (c === '' ? null : columns[i].type === 'number' ? Number(c.replace(/,/g, '')) : c)),
  )
  return { table: { columns, rows }, warnings }
}

export function formatCsv(table: DataTable) {
  return csvFormatRows([table.columns.map((c) => c.name), ...table.rows.map((r) => r.map((c) => (c == null ? '' : String(c))))])
}
