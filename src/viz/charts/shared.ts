import * as d3 from 'd3'
import { columnIndex, toLabel, toNumber, uniqueLabels, type DataTable } from '../../data/table'

export interface PointDatum { i: number; x: number; y: number; group: string; size: number | null }

/** Rows with finite x and y, keeping their original row index for editing. */
export function pointRows(table: DataTable, xCol: string | null, yCol: string | null, groupCol?: string | null, sizeCol?: string | null): PointDatum[] {
  const xi = columnIndex(table, xCol)
  const yi = columnIndex(table, yCol)
  const gi = columnIndex(table, groupCol)
  const si = columnIndex(table, sizeCol)
  if (xi < 0 || yi < 0) return []
  const out: PointDatum[] = []
  table.rows.forEach((r, i) => {
    const x = toNumber(r[xi])
    const y = toNumber(r[yi])
    if (x == null || y == null) return
    out.push({ i, x, y, group: gi >= 0 ? toLabel(r[gi]) : '', size: si >= 0 ? toNumber(r[si]) : null })
  })
  return out
}

export interface ValueGroup { key: string; values: number[]; rows: number[] }

/** Splits a numeric column by an optional category column (one group named '전체' when absent). */
export function groupedValues(table: DataTable, valueCol: string | null, groupCol: string | null): ValueGroup[] {
  const vi = columnIndex(table, valueCol)
  if (vi < 0) return []
  const gi = columnIndex(table, groupCol)
  const map = new Map<string, ValueGroup>()
  if (gi >= 0) for (const k of uniqueLabels(table.rows.map((r) => toLabel(r[gi])))) map.set(k, { key: k, values: [], rows: [] })
  table.rows.forEach((r, i) => {
    const v = toNumber(r[vi])
    if (v == null) return
    const key = gi >= 0 ? toLabel(r[gi]) || '(빈 값)' : '전체'
    let g = map.get(key)
    if (!g) { g = { key, values: [], rows: [] }; map.set(key, g) }
    g.values.push(v)
    g.rows.push(i)
  })
  return [...map.values()].filter((g) => g.values.length > 0)
}

/** Linear domain padded by a fraction of its span (and widened when degenerate). */
export function paddedDomain(values: readonly number[], pad = 0.06, includeZero = false): [number, number] {
  if (!values.length) return [0, 1]
  let [lo, hi] = d3.extent(values) as [number, number]
  if (includeZero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0) }
  if (lo === hi) { lo -= Math.abs(lo) * 0.1 || 1; hi += Math.abs(hi) * 0.1 || 1 }
  const span = hi - lo
  return [includeZero && lo === 0 ? 0 : lo - span * pad, includeZero && hi === 0 ? 0 : hi + span * pad]
}

/** Rounding precision suitable for values typed via a drag across a domain of this span. */
export function dragDigits(span: number) {
  if (!(span > 0)) return 2
  return Math.max(0, Math.min(4, 2 - Math.floor(Math.log10(span))))
}

export const roundTo = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits

/** Aggregated value per category (and optional sub-group), preserving first-appearance order. */
export function crossTab(table: DataTable, catCol: string | null, groupCol: string | null, valueCol: string | null, agg: (vals: number[]) => number = (v) => d3.sum(v)) {
  const ci = columnIndex(table, catCol)
  const gi = columnIndex(table, groupCol)
  const vi = columnIndex(table, valueCol)
  const cats: string[] = []
  const groups: string[] = []
  const cells = new Map<string, number[]>()
  const rowsOf = new Map<string, number[]>()
  table.rows.forEach((r, i) => {
    const c = toLabel(r[ci])
    const g = gi >= 0 ? toLabel(r[gi]) : ''
    const v = vi >= 0 ? toNumber(r[vi]) : 1
    if (c === '' || v == null) return
    if (!cats.includes(c)) cats.push(c)
    if (!groups.includes(g)) groups.push(g)
    const key = `${c}\u0000${g}`
    if (!cells.has(key)) { cells.set(key, []); rowsOf.set(key, []) }
    cells.get(key)!.push(v)
    rowsOf.get(key)!.push(i)
  })
  const value = (c: string, g: string) => {
    const vals = cells.get(`${c}\u0000${g}`)
    return vals ? agg(vals) : 0
  }
  const rows = (c: string, g: string) => rowsOf.get(`${c}\u0000${g}`) ?? []
  return { cats, groups, value, rows }
}

export const uniqueGroups = (pts: readonly { group: string }[]) => uniqueLabels(pts.map((p) => p.group))
