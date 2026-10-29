import type { ScaleBand, ScaleLinear } from 'd3'
import type { PointerEvent } from 'react'
import { localPoint, type Margin } from '../../components/chart/primitives'
import { appendRow, templateRow, updateRow, type DataTable } from '../../data/table'
import { dragDigits, roundTo } from './shared'

/** Adds a value to the group whose band was clicked, at the clicked height. */
export function addToBand(e: PointerEvent, svg: SVGSVGElement, m: Margin, ih: number, x: ScaleBand<string>, y: ScaleLinear<number, number>, table: DataTable, valueCol: string, groupCol: string | null) {
  const p = localPoint(svg, e)
  const px = p.x - m.left
  const py = p.y - m.top
  if (py < 0 || py > ih) return null
  const group = x.domain().find((g) => {
    const s = x(g) ?? 0
    return px >= s && px <= s + x.bandwidth()
  })
  if (!group) return null
  const [lo, hi] = y.domain()
  const value = roundTo(y.invert(py), dragDigits(hi - lo))
  const base = templateRow(table)
  if (groupCol) base[groupCol] = group
  return appendRow(table, { ...base, [valueCol]: value })
}

/** Moves one observation vertically to the pointer's value. */
export function moveValue(e: PointerEvent, svg: SVGSVGElement, m: Margin, y: ScaleLinear<number, number>, table: DataTable, row: number, valueCol: string) {
  const p = localPoint(svg, e)
  const [lo, hi] = y.domain()
  return updateRow(table, row, { [valueCol]: roundTo(y.invert(p.y - m.top), dragDigits(hi - lo)) })
}

/** Deterministic pseudo-random jitter in [-0.5, 0.5) per row, stable across renders. */
export function jitter(row: number) {
  const s = Math.sin(row * 12.9898 + 78.233) * 43758.5453
  return s - Math.floor(s) - 0.5
}
