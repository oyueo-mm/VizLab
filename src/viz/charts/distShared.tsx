import type { ScaleLinear } from 'd3'
import type { PointerEvent } from 'react'
import { localPoint, type Margin } from '../../components/chart/primitives'
import { appendRow, removeRows, templateRow, type DataTable } from '../../data/table'
import { fmt } from '../../lib/format'
import { dragDigits, roundTo, type ValueGroup } from './shared'

/** Adds a row whose value column takes the clicked x position. */
export function addValueAt(e: PointerEvent, svg: SVGSVGElement, m: Margin, iw: number, ih: number, x: ScaleLinear<number, number>, table: DataTable, valueCol: string, groupCol: string | null, group?: string) {
  const p = localPoint(svg, e)
  if (p.x < m.left || p.x > m.left + iw || p.y < m.top || p.y > m.top + ih + 24) return null
  const [lo, hi] = x.domain()
  const value = roundTo(x.invert(p.x - m.left), dragDigits(hi - lo))
  const base = templateRow(table)
  if (groupCol && group) base[groupCol] = group
  return appendRow(table, { ...base, [valueCol]: value })
}

/** Tick marks below the axis, one per observation. Clicking one (when editable) deletes that row. */
export function Rug({ groups, x, y, color, editable, table, onTableChange, height = 8, max = 1500 }: {
  groups: ValueGroup[]; x: ScaleLinear<number, number>; y: number; color: (g: string) => string; editable: boolean; table: DataTable
  onTableChange?: (t: DataTable) => void; height?: number; max?: number
}) {
  const total = groups.reduce((s, g) => s + g.values.length, 0)
  if (total > max) return null
  return (
    <g className={`rug ${editable ? 'is-editable' : ''}`} transform={`translate(0,${y})`}>
      {groups.flatMap((g, gi) => g.values.map((v, k) => (
        <line key={`${gi}-${g.rows[k]}`} x1={x(v)} x2={x(v)} y1={-height - gi * 0} y2={0} stroke={color(g.key)} data-row={g.rows[k]}
          onPointerUp={editable ? (e) => { e.stopPropagation(); onTableChange!(removeRows(table, [g.rows[k]])) } : undefined}>
          {editable && <title>{fmt(v)} · 클릭하면 삭제</title>}
        </line>
      )))}
    </g>
  )
}
