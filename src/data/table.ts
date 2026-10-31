import { addMonths, formatISO, toTime } from '../stats/datetime'

export type ColumnType = 'number' | 'category' | 'date'
export type Cell = number | string | null

export interface Column {
  name: string
  type: ColumnType
}

/** Column-typed table shared by every chart. Rows are arrays aligned with `columns`. */
export interface DataTable {
  columns: Column[]
  rows: Cell[][]
}

export const columnIndex = (table: DataTable, name: string | null | undefined) =>
  name == null ? -1 : table.columns.findIndex((c) => c.name === name)

export const columnsOfType = (table: DataTable, type: ColumnType) => table.columns.filter((c) => c.type === type)

/** Numeric value or null when the cell is missing / not a finite number. */
export function toNumber(cell: Cell): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null
  if (typeof cell === 'string' && cell.trim() !== '') {
    const v = Number(cell.replace(/,/g, ''))
    return Number.isFinite(v) ? v : null
  }
  return null
}

export const toLabel = (cell: Cell) => (cell == null ? '' : String(cell))

export { toTime }

export function numbers(table: DataTable, name: string | null | undefined): (number | null)[] {
  const i = columnIndex(table, name)
  return i < 0 ? [] : table.rows.map((r) => toNumber(r[i]))
}

export function labels(table: DataTable, name: string | null | undefined): string[] {
  const i = columnIndex(table, name)
  return i < 0 ? [] : table.rows.map((r) => toLabel(r[i]))
}

/** Distinct labels in first-appearance order (empty labels excluded). */
export function uniqueLabels(values: readonly string[]) {
  const seen = new Set<string>()
  for (const v of values) if (v !== '') seen.add(v)
  return [...seen]
}

export function cloneTable(table: DataTable): DataTable {
  return { columns: table.columns.map((c) => ({ ...c })), rows: table.rows.map((r) => [...r]) }
}

export function setCell(table: DataTable, row: number, column: string, value: Cell): DataTable {
  const ci = columnIndex(table, column)
  if (ci < 0 || row < 0 || row >= table.rows.length) return table
  const rows = table.rows.slice()
  rows[row] = rows[row].slice()
  rows[row][ci] = value
  return { columns: table.columns, rows }
}

/** Patch several cells of one row at once. */
export function updateRow(table: DataTable, row: number, patch: Record<string, Cell>): DataTable {
  if (row < 0 || row >= table.rows.length) return table
  const rows = table.rows.slice()
  const next = rows[row].slice()
  for (const [name, value] of Object.entries(patch)) {
    const ci = columnIndex(table, name)
    if (ci >= 0) next[ci] = value
  }
  rows[row] = next
  return { columns: table.columns, rows }
}

export function appendRow(table: DataTable, values: Record<string, Cell> = {}): DataTable {
  const row = table.columns.map((c) => (c.name in values ? values[c.name] : null))
  return { columns: table.columns, rows: [...table.rows, row] }
}

export function removeRows(table: DataTable, indices: Iterable<number>): DataTable {
  const drop = new Set(indices)
  return { columns: table.columns, rows: table.rows.filter((_, i) => !drop.has(i)) }
}

/** Fills a new row with sensible values: the previous row's category labels and column means for numbers. */
export function templateRow(table: DataTable): Record<string, Cell> {
  const out: Record<string, Cell> = {}
  const last = table.rows[table.rows.length - 1]
  table.columns.forEach((c, i) => {
    if (c.type === 'category') out[c.name] = last ? last[i] : ''
    else if (c.type === 'date') {
      // Continue the date column with the spacing of its last two dates (month-aware for monthly data).
      const times = table.rows.map((r) => toTime(r[i])).filter((v): v is number => v != null)
      const [a, b] = [times[times.length - 2], times[times.length - 1]]
      if (b == null) out[c.name] = '2024-01-01'
      else if (a == null) out[c.name] = formatISO(b + 86400000)
      else {
        const monthly = new Date(a).getUTCDate() === new Date(b).getUTCDate() && b - a >= 27 * 86400000
        out[c.name] = formatISO(monthly ? addMonths(b, Math.max(1, Math.round((b - a) / (30.44 * 86400000)))) : b + (b - a || 86400000))
      }
    } else {
      const vals = table.rows.map((r) => toNumber(r[i])).filter((v): v is number => v != null)
      out[c.name] = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : 0
    }
  })
  return out
}

/** Count of cells in date columns that are not real calendar dates. */
export function invalidDateCells(table: DataTable) {
  let count = 0
  table.columns.forEach((c, i) => {
    if (c.type !== 'date') return
    for (const r of table.rows) {
      const cell = r[i]
      if (cell !== null && cell !== '' && toTime(cell) === null) count++
    }
  })
  return count
}

/** Count of cells in numeric columns that are not valid numbers. */
export function invalidNumericCells(table: DataTable) {
  let count = 0
  table.columns.forEach((c, i) => {
    if (c.type !== 'number') return
    for (const r of table.rows) {
      const cell = r[i]
      if (cell !== null && cell !== '' && toNumber(cell) === null) count++
    }
  })
  return count
}
