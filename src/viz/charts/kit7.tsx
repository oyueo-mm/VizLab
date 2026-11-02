import { useMemo } from 'react'
import { columnIndex, toLabel, toNumber, uniqueLabels, type DataTable } from '../../data/table'
import { categoryColor } from '../../lib/colors'
import { normalizeColumns, type Matrix } from '../../stats/multivar7'
import { roleColumn, roleColumns } from '../mapping'
import type { Mapping, RoleSpec } from '../types'

/** Observations of a multivariate table: rows with every chosen variable present, normalized columns and an optional grouping. */
export interface Obs {
  vars: string[]
  /** Original table row of each observation. */
  rows: number[]
  raw: Matrix
  norm: Matrix
  groups: string[]
  groupNames: string[]
  color: (g: string) => string
}

export function buildObs(table: DataTable, vars: string[], groupCol: string | null, mode: 'minmax' | 'zscore' = 'minmax'): Obs {
  const vi = vars.map((v) => columnIndex(table, v))
  const gi = columnIndex(table, groupCol)
  const rows: number[] = []
  const raw: Matrix = []
  const groups: string[] = []
  table.rows.forEach((r, i) => {
    const v = vi.map((k) => (k >= 0 ? toNumber(r[k]) : null))
    if (v.some((x) => x == null)) return
    rows.push(i)
    raw.push(v as number[])
    groups.push(gi >= 0 ? toLabel(r[gi]) : '')
  })
  const groupNames = uniqueLabels(groups)
  return { vars, rows, raw, norm: normalizeColumns(raw, mode), groups, groupNames, color: groupNames.length ? categoryColor(groupNames) : () => '#2a8c82' }
}

export function useObs(table: DataTable, mapping: Mapping, mode: 'minmax' | 'zscore' = 'minmax', cap = 3000): Obs {
  const vars = roleColumns(mapping, 'vars')
  const groupCol = roleColumn(mapping, 'group')
  return useMemo(() => {
    const o = buildObs(table, vars, groupCol, mode)
    if (o.rows.length <= cap) return o
    // Evenly spaced subsample keeps the picture representative and the SVG small.
    const step = o.rows.length / cap
    const keep = Array.from({ length: cap }, (_, k) => Math.floor(k * step))
    return { ...o, rows: keep.map((k) => o.rows[k]), raw: keep.map((k) => o.raw[k]), norm: keep.map((k) => o.norm[k]), groups: keep.map((k) => o.groups[k]) }
  }, [table, vars.join('|'), groupCol, mode, cap])
}

/** Roles shared by the multivariate techniques: three or more numeric variables and an optional group. */
export const multivarRoles = (max = 12, min = 3): RoleSpec[] => [
  { key: 'vars', label: '변수 (숫자형)', type: 'number', required: true, multiple: { min, max } },
  { key: 'group', label: '그룹 (색)', type: 'category', auto: true },
]

export const MULTIVAR_DATASETS = ['flowers', 'cars', 'players'] as const

export const pct = (v: number) => `${Math.round(v * 100)}%`

/** Orders the variables by `order` (indexes), falling back to table order for indexes the list does not mention. */
export function applyOrder(n: number, order: readonly number[]): number[] {
  const valid = order.filter((i) => i >= 0 && i < n)
  const used = new Set(valid)
  const out = [...new Set(valid)]
  for (let i = 0; i < n; i++) if (!used.has(i)) out.push(i)
  return out
}

/** Enabled variables: `off` lists names that are switched off. */
export function enabledVars(obs: Obs, off: readonly string[]): number[] {
  return obs.vars.map((v, i) => (off.includes(v) ? -1 : i)).filter((i) => i >= 0)
}
