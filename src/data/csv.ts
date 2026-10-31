import { csvFormatRows, csvParseRows } from 'd3'
import { formatISO, isAmbiguousDate, parseDateTime, type DateFormat } from '../stats/datetime'
import type { Cell, Column, DataTable } from './table'

export interface CsvResult {
  table: DataTable | null
  warnings: string[]
  error?: string
  /** Columns whose dates are written as day/month numbers and could be read in more than one order. */
  ambiguous: string[]
}

export const MAX_ROWS = 20000
const isNumeric = (s: string) => s.trim() !== '' && Number.isFinite(Number(s.replace(/,/g, '')))
const ISO_SHAPE = /^\s*\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?\s*$/

/** Normalises a typed date to ISO 8601 text, or null when it is not a real date in the given format. ISO text is kept as written. */
export function normalizeDate(text: string, format: DateFormat = 'iso'): string | null {
  const t = text.trim()
  const ms = parseDateTime(t, format)
  if (ms == null) return null
  return (format === 'iso' || format === 'ymd-dot') && ISO_SHAPE.test(t) ? t.replace(' ', 'T') : formatISO(ms)
}

/**
 * Decides each column's type from its non-empty cells: numbers if all are numeric; dates if all are real dates in the given
 * format (ISO 8601 and Y.M.D by default); otherwise categories. Numeric day/month dates are never guessed — such a column stays
 * categorical and is reported in `ambiguous` so the reader can pick day-first or month-first.
 */
export function inferColumns(names: readonly string[], body: readonly string[][], dateFormat: DateFormat = 'iso') {
  const warnings: string[] = []
  const ambiguous: string[] = []
  const columns: Column[] = names.map((name, i) => {
    const cells = body.map((r) => r[i]).filter((c) => c !== '')
    if (cells.length > 0 && cells.every(isNumeric)) return { name, type: 'number' }
    if (cells.length > 0 && cells.every((c) => parseDateTime(c, dateFormat) != null)) return { name, type: 'date' }
    if (cells.length > 0 && dateFormat === 'iso' && cells.every((c) => isAmbiguousDate(c) || parseDateTime(c, 'mdy') != null || parseDateTime(c, 'dmy') != null) && cells.some(isAmbiguousDate)) {
      ambiguous.push(name)
      warnings.push(`‘${name}’ 열은 03/04/2024처럼 일·월 순서가 모호한 날짜라 자동으로 해석하지 않고 범주형으로 두었습니다. 아래에서 날짜 형식(월/일/년 또는 일/월/년)을 고르세요.`)
    }
    return { name, type: 'category' }
  })
  const rows: Cell[][] = body.map((r) => r.map((c, i) => {
    if (c === '') return null
    if (columns[i].type === 'number') return Number(c.replace(/,/g, ''))
    if (columns[i].type === 'date') return normalizeDate(c, dateFormat) ?? c
    return c
  }))
  return { columns, rows, warnings, ambiguous }
}

/** Parses CSV text (RFC 4180 quoting via d3-dsv) into a typed table. */
export function parseCsv(text: string, dateFormat: DateFormat = 'iso'): CsvResult {
  const warnings: string[] = []
  const clean = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trim()
  if (!clean) return { table: null, warnings, error: '파일이 비어 있습니다.', ambiguous: [] }
  const raw = csvParseRows(clean).filter((r) => r.some((c) => c.trim() !== ''))
  if (raw.length < 2) return { table: null, warnings, error: '머리글 행과 최소 1개의 데이터 행이 필요합니다.', ambiguous: [] }
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
  const inferred = inferColumns(unique, body, dateFormat)
  warnings.push(...inferred.warnings)
  const dates = inferred.columns.filter((c) => c.type === 'date').map((c) => c.name)
  if (dates.length) warnings.push(`날짜 열: ${dates.join(', ')} (시간대 표기가 없는 값은 UTC 달력 시각으로 취급합니다).`)
  return { table: { columns: inferred.columns, rows: inferred.rows }, warnings, ambiguous: inferred.ambiguous }
}

export function formatCsv(table: DataTable) {
  return csvFormatRows([table.columns.map((c) => c.name), ...table.rows.map((r) => r.map((c) => (c == null ? '' : String(c))))])
}

// ─── JSON ──────────────────────────────────────────────────────────────────

const TYPES = new Set(['number', 'category', 'date'])

/** VizLab's JSON table: { "format": "vizlab-table", "version": 1, "columns": [{name, type}], "rows": [[…]] }. */
export function formatJson(table: DataTable) {
  return JSON.stringify({ format: 'vizlab-table', version: 1, columns: table.columns, rows: table.rows }, null, 2)
}

/**
 * Reads either VizLab's own JSON table or a plain array of records (`[{"a": 1, "b": "x"}, …]`). Cells that do not fit a column's
 * declared type are kept as text so they stay visible (and flagged) in the editor instead of vanishing.
 */
export function parseJson(text: string, dateFormat: DateFormat = 'iso'): CsvResult {
  const warnings: string[] = []
  let data: unknown
  try {
    data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch {
    return { table: null, warnings, error: 'JSON 형식이 올바르지 않습니다.', ambiguous: [] }
  }
  const obj = data as { columns?: unknown; rows?: unknown }
  if (data && !Array.isArray(data) && typeof data === 'object' && Array.isArray(obj.columns) && Array.isArray(obj.rows)) {
    const columns: Column[] = []
    for (const c of obj.columns as { name?: unknown; type?: unknown }[]) {
      if (!c || typeof c.name !== 'string' || !c.name || !TYPES.has(String(c.type))) return { table: null, warnings, error: '열 정의는 { "name": 문자열, "type": "number" | "category" | "date" } 형식이어야 합니다.', ambiguous: [] }
      columns.push({ name: c.name, type: c.type as Column['type'] })
    }
    if (new Set(columns.map((c) => c.name)).size !== columns.length) return { table: null, warnings, error: '열 이름이 중복되었습니다.', ambiguous: [] }
    if (!columns.length) return { table: null, warnings, error: '열이 하나도 없습니다.', ambiguous: [] }
    let rows = obj.rows as unknown[]
    if (rows.length > MAX_ROWS) { warnings.push(`행이 너무 많아 처음 ${MAX_ROWS.toLocaleString()}행만 불러왔습니다.`); rows = rows.slice(0, MAX_ROWS) }
    let bad = 0
    const out: Cell[][] = rows.map((r) => {
      const arr = Array.isArray(r) ? r : []
      if (!Array.isArray(r) || r.length !== columns.length) bad++
      return columns.map((c, i) => {
        const v = arr[i]
        if (v == null || v === '') return null
        if (c.type === 'number') return typeof v === 'number' && Number.isFinite(v) ? v : isNumeric(String(v)) ? Number(String(v).replace(/,/g, '')) : String(v)
        return String(v)
      })
    })
    if (bad) warnings.push(`${bad}개 행의 길이가 열 수와 달라 빈칸을 채우거나 잘라냈습니다.`)
    if (!out.length) return { table: null, warnings, error: '데이터 행이 없습니다.', ambiguous: [] }
    return { table: { columns, rows: out }, warnings, ambiguous: [] }
  }
  if (Array.isArray(data) && data.length && data.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
    const records = data.slice(0, MAX_ROWS) as Record<string, unknown>[]
    const names = [...new Set(records.flatMap((r) => Object.keys(r)))]
    const body = records.map((r) => names.map((n) => (r[n] == null ? '' : String(r[n]).trim())))
    const inferred = inferColumns(names, body, dateFormat)
    return { table: { columns: inferred.columns, rows: inferred.rows }, warnings: inferred.warnings, ambiguous: inferred.ambiguous }
  }
  return { table: null, warnings, error: 'VizLab JSON 표({ columns, rows }) 또는 객체 배열이어야 합니다.', ambiguous: [] }
}
