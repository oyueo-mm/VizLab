import * as d3 from 'd3'
import { project } from '../geo/projections'
import { hexbin } from './hexbin'

// ─── choropleth classification ──────────────────────────────────────────────

export type ClassMethod = 'equal' | 'quantile' | 'jenks'

export const classMethods: { value: ClassMethod; label: string; hint: string }[] = [
  { value: 'equal', label: '등간격', hint: '값의 범위를 같은 폭으로 나눕니다. 분포가 치우치면 대부분의 지역이 한두 계급에 몰립니다.' },
  { value: 'quantile', label: '분위수', hint: '각 계급에 지역 수가 비슷하게 들어갑니다. 값의 간격은 무시되므로 비슷한 값이 다른 색이 될 수 있습니다.' },
  { value: 'jenks', label: '자연 구분 (Jenks)', hint: '계급 안의 분산을 최소로 하는 경계를 찾습니다. 값이 군집을 이룰 때 그 틈새에서 나뉩니다.' },
]

/**
 * Fisher–Jenks natural breaks by dynamic programming: the partition of the sorted values into k classes with the smallest total
 * within-class sum of squared deviations. O(k·n²), fine for the few hundred regions of a map.
 */
export function jenksBreaks(values: readonly number[], k: number): number[] {
  const v = [...values].sort((a, b) => a - b)
  const n = v.length
  if (!n) return []
  const classes = Math.max(1, Math.min(k, new Set(v).size))
  if (classes === 1) return [v[0], v[n - 1]]
  // prefix sums for O(1) within-class variance
  const s1 = [0]
  const s2 = [0]
  for (const x of v) { s1.push(s1[s1.length - 1] + x); s2.push(s2[s2.length - 1] + x * x) }
  const cost = (i: number, j: number) => { const m = j - i + 1; const a = s1[j + 1] - s1[i]; return s2[j + 1] - s2[i] - (a * a) / m }
  const D: number[][] = Array.from({ length: classes + 1 }, () => new Array(n).fill(Infinity))
  const B: number[][] = Array.from({ length: classes + 1 }, () => new Array(n).fill(0))
  for (let j = 0; j < n; j++) D[1][j] = cost(0, j)
  for (let c = 2; c <= classes; c++) {
    for (let j = c - 1; j < n; j++) {
      for (let i = c - 1; i <= j; i++) {
        const d = D[c - 1][i - 1] + cost(i, j)
        if (d < D[c][j]) { D[c][j] = d; B[c][j] = i }
      }
    }
  }
  const edges = [v[n - 1]]
  let j = n - 1
  // each class starts at its first value, so a value equal to an edge belongs to the class above it
  for (let c = classes; c >= 2; c--) { const i = B[c][j]; edges.unshift(v[i]); j = i - 1 }
  edges.unshift(v[0])
  return edges
}

/**
 * Class edges [min, …, max] for k classes. A class i holds values in [edges[i], edges[i+1]); the last class includes the maximum.
 * Quantile and Jenks edges are merged when values repeat, so fewer than k classes can come back for tied data.
 */
export function classBreaks(values: readonly number[], method: ClassMethod, k: number): number[] {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!v.length) return []
  const [lo, hi] = [v[0], v[v.length - 1]]
  if (lo === hi) return [lo, hi]
  let edges: number[]
  if (method === 'equal') edges = Array.from({ length: k + 1 }, (_, i) => lo + ((hi - lo) * i) / k)
  else if (method === 'quantile') edges = Array.from({ length: k + 1 }, (_, i) => d3.quantile(v, i / k)!)
  else edges = jenksBreaks(v, k)
  return edges.filter((e, i) => i === 0 || e > edges[i - 1])
}

/** Class index of a value for the given edges (clamped to the first/last class). */
export function classIndex(v: number, edges: readonly number[]): number {
  const n = edges.length - 1
  if (n < 1) return 0
  for (let i = 0; i < n; i++) if (v < edges[i + 1]) return i
  return n - 1
}

export type NormalizeMode = 'none' | 'area' | 'base'

/** The value actually mapped to colour: raw, per km² of land area, or per unit of a base column (e.g. per capita). Null when undefined (zero base, missing). */
export function normalizeValue(value: number | null, mode: NormalizeMode, areaKm2: number, base: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null
  if (mode === 'none') return value
  if (mode === 'area') return areaKm2 > 0 ? value / areaKm2 : null
  return base != null && base > 0 ? value / base : null
}

// ─── Dorling cartogram ──────────────────────────────────────────────────────

export interface DorlingInput { id: string; x: number; y: number; value: number }
export interface DorlingNode extends DorlingInput { r: number; px: number; py: number }

/** Circle radius whose area is proportional to the value: r = R·√(v / vmax). */
export const dorlingRadius = (value: number, maxValue: number, maxRadius: number) => (maxValue > 0 && value > 0 ? maxRadius * Math.sqrt(value / maxValue) : 0)

/**
 * Dorling cartogram: each region becomes a circle (area ∝ value) starting on its projected centroid; a force simulation pulls every
 * circle back toward that centroid (`pull`, 0–1) while a collision force keeps circles from overlapping. Deterministic: the d3-force
 * random source is a fixed LCG and the start positions are given.
 */
export function dorling(items: readonly DorlingInput[], { maxRadius, pull, padding = 1, ticks = 300 }: { maxRadius: number; pull: number; padding?: number; ticks?: number }): DorlingNode[] {
  const vmax = Math.max(0, ...items.map((i) => i.value))
  const nodes: DorlingNode[] = items.map((i) => ({ ...i, r: dorlingRadius(i.value, vmax, maxRadius), px: i.x, py: i.y }))
  if (nodes.length < 2) return nodes
  const strength = 0.02 + 0.98 * Math.max(0, Math.min(1, pull)) ** 2
  const sim = d3.forceSimulation(nodes)
    .force('x', d3.forceX<DorlingNode>((d) => d.px).strength(strength))
    .force('y', d3.forceY<DorlingNode>((d) => d.py).strength(strength))
    .force('collide', d3.forceCollide<DorlingNode>((d) => d.r + padding).strength(1).iterations(4))
    .stop()
  for (let i = 0; i < ticks; i++) sim.tick()
  return nodes
}

/** Largest overlap between two circles (0 when none overlap beyond the tolerance). */
export function maxOverlap(nodes: readonly { x: number; y: number; r: number }[]): number {
  let worst = 0
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const o = nodes[i].r + nodes[j].r - Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y)
    if (o > worst) worst = o
  }
  return worst
}

// ─── geographic hexbin ──────────────────────────────────────────────────────

export interface GeoPoint { lon: number; lat: number; value: number; row: number }

export interface GeoHex {
  /** Centre in the binning plane. */
  x: number
  y: number
  points: GeoPoint[]
  count: number
  sum: number
  /** Corners as [lon, lat], so the cell can be projected with any display projection. */
  corners: [number, number][]
}

/**
 * Bins points into pointy-top hexagons of circumradius `radius` in the plane of `plane` (a projection). The cell corners are mapped back
 * to longitude/latitude so each cell can be drawn in any map projection. With the display projection as the plane the cells are regular
 * on screen but cover unequal ground areas; with an equal-area projection every cell covers the same ground area but looks distorted.
 */
export function geoHexbin(points: readonly GeoPoint[], plane: d3.GeoProjection, radius: number): GeoHex[] {
  const proj = points.map((p) => ({ p, xy: project(plane, p.lon, p.lat) })).filter((q): q is { p: GeoPoint; xy: [number, number] } => !!q.xy)
  const bins = hexbin(proj, (q) => q.xy[0], (q) => q.xy[1], radius)
  const out: GeoHex[] = []
  for (const b of bins) {
    const corners: [number, number][] = []
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i
      const c = plane.invert?.([b.x + Math.sin(a) * radius, b.y - Math.cos(a) * radius])
      if (c && Number.isFinite(c[0]) && Number.isFinite(c[1])) corners.push([c[0], c[1]])
    }
    if (corners.length < 6) continue
    const pts = b.points.map((q) => q.p)
    out.push({ x: b.x, y: b.y, points: pts, count: pts.length, sum: d3.sum(pts, (q) => q.value), corners })
  }
  return out
}

/** Ground area (km²) enclosed by a cell's corners (spherical polygon, geodesic edges). */
export const cellAreaKm2 = (corners: readonly [number, number][]) => d3.geoArea({ type: 'Polygon', coordinates: [[...corners, corners[0]]] }) * 6371.0088 ** 2

// ─── flow map ───────────────────────────────────────────────────────────────

export interface Flow { from: string; to: string; value: number; row: number; a: [number, number]; b: [number, number] }

/** True when the straight longitude difference is more than half the globe: the short way round crosses the antimeridian. */
export const crossesDateline = (lon0: number, lon1: number) => Math.abs(lon1 - lon0) > 180

/** Total flow leaving (out) and arriving at (in) each place; flows from a place to itself are ignored. */
export function flowTotals(flows: readonly Pick<Flow, 'from' | 'to' | 'value'>[]) {
  const out = new Map<string, number>()
  const inn = new Map<string, number>()
  for (const f of flows) {
    if (f.from === f.to || !(f.value > 0)) continue
    out.set(f.from, (out.get(f.from) ?? 0) + f.value)
    inn.set(f.to, (inn.get(f.to) ?? 0) + f.value)
  }
  return { out, in: inn }
}

/**
 * Control point of a quadratic arc between two screen points; `curve` is the bulge as a fraction of the chord length (0 = straight).
 * The bulge is to the left of the direction of travel, so two opposite flows between the same places do not overlap.
 */
export function arcControl(a: readonly [number, number], b: readonly [number, number], curve: number): [number, number] {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  return [(a[0] + b[0]) / 2 + dy * curve, (a[1] + b[1]) / 2 - dx * curve]
}
