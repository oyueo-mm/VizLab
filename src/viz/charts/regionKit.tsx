import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { useTooltip } from '../../components/chart/primitives'
import { columnIndex, toLabel, toNumber, type DataTable } from '../../data/table'
import { project } from '../../geo/projections'
import { useMapZoom } from '../../geo/useMapZoom'
import { roleColumn } from '../mapping'
import type { Mapping } from '../types'
import { resolveMap, useProjection, type GeoParams } from './geoShared'
import type { Pt, Shape } from '../../stats/cartogram'

/** Shared set-up of region-based thematic maps: parsed region values, the map, its projection, zoom and tooltip. */

export interface RegionRow { id: string; values: Record<string, number | null>; text: string; rows: number[] }

/** Table rows keyed by region id; every key in `numeric` is read from the column mapped to that role (later rows of the same id are summed). */
export function regionRows(table: DataTable, mapping: Mapping, numeric: readonly string[], textKey?: string, columns: readonly string[] = []): Map<string, RegionRow> {
  const ri = columnIndex(table, roleColumn(mapping, 'region'))
  // `numeric` lists role keys; `columns` lists extra numeric columns by name (a multi-column role), stored under the column's own name
  const cols = [...numeric.map((k) => columnIndex(table, roleColumn(mapping, k))), ...columns.map((c) => columnIndex(table, c))]
  const names = [...numeric, ...columns]
  const ti = textKey ? columnIndex(table, roleColumn(mapping, textKey)) : -1
  const out = new Map<string, RegionRow>()
  if (ri < 0) return out
  table.rows.forEach((r, row) => {
    const id = toLabel(r[ri]).trim()
    if (!id) return
    let e = out.get(id)
    if (!e) { e = { id, values: Object.fromEntries(names.map((k) => [k, null])), text: '', rows: [] }; out.set(id, e) }
    e.rows.push(row)
    names.forEach((k, j) => { const v = cols[j] >= 0 ? toNumber(r[cols[j]]) : null; if (v != null) e!.values[k] = (e!.values[k] ?? 0) + v })
    if (ti >= 0 && !e.text) e.text = toLabel(r[ti])
  })
  return out
}

const NO_COLS: readonly string[] = []

export function useRegionStage(table: DataTable, mapping: Mapping, params: GeoParams, width: number, height: number, compact: boolean | undefined, numeric: readonly string[], textKey?: string, zoomEnabled = true, columns: readonly string[] = NO_COLS) {
  const data = useMemo(() => regionRows(table, mapping, numeric, textKey, columns), [table, mapping, numeric, textKey, columns])
  const resolved = useMemo(() => resolveMap(params, [...data.keys()]), [params, data])
  const projection = useProjection(resolved.map, params, width, height, resolved.id)
  const svgRef = useRef<SVGSVGElement>(null)
  const zoom = useMapZoom(svgRef, { enabled: !compact && zoomEnabled, width, height })
  const tip = useTooltip()
  const paths = useMemo(() => { const g = d3.geoPath(projection); return resolved.map.regions.map((r) => ({ r, d: g(r.feature) ?? '' })) }, [resolved.map, projection])
  const unmatched = useMemo(() => [...data.keys()].filter((id) => !resolved.map.byId.has(id)).length, [data, resolved.map])
  return { data, resolved, map: resolved.map, projection, svgRef, zoom, ...tip, paths, unmatched }
}

/** Projected outer rings of every region (all polygon parts), for the cartogram algorithms that work on screen coordinates. */
export function projectedShapes(map: ReturnType<typeof useRegionStage>['map'], projection: d3.GeoProjection): Shape[] {
  return map.regions.map((r) => {
    const g = r.feature.geometry
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
    const rings: Pt[][] = []
    for (const poly of polys) {
      const ring = poly[0].map((c) => project(projection, c[0], c[1])).filter((p): p is Pt => !!p)
      if (ring.length >= 4) rings.push(ring)
    }
    return { id: r.id, rings }
  })
}

export const ringPath = (ring: readonly Pt[]) => `M${ring.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L')}Z`
export const shapePath = (s: Shape) => s.rings.map(ringPath).join('')

/** Pearson correlation of two samples (NaN when undefined). */
export function correlation(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length
  if (n < 3) return NaN
  const mx = d3.mean(xs)!, my = d3.mean(ys)!
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2 }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN
}
