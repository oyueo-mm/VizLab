import type { ScaleBand, ScaleLinear } from 'd3'
import type { PointerEvent } from 'react'
import { localPoint, type Margin } from '../../components/chart/primitives'
import { appendRow, templateRow, type DataTable } from '../../data/table'
import { dragDigits, roundTo } from './shared'

/** Adds a value to the group row that was clicked (horizontal value axis), at the clicked position. */
export function addValueAtBand(e: PointerEvent, svg: SVGSVGElement, m: Margin, iw: number, ih: number, x: ScaleLinear<number, number>, band: ScaleBand<string>, table: DataTable, valueCol: string, groupCol: string | null) {
  const p = localPoint(svg, e)
  const px = p.x - m.left
  const py = p.y - m.top
  if (px < 0 || px > iw || py < 0 || py > ih) return null
  const group = band.domain().find((g) => py >= (band(g) ?? 0) - band.step() * band.paddingInner() / 2 && py <= (band(g) ?? 0) + band.bandwidth() + band.step() * band.paddingInner() / 2)
  if (!group) return null
  const [lo, hi] = x.domain()
  const base = templateRow(table)
  if (groupCol) base[groupCol] = group
  return appendRow(table, { ...base, [valueCol]: roundTo(x.invert(px), dragDigits(hi - lo)) })
}
