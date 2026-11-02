import * as d3 from 'd3'
import { generateHeroDataset as generateDataset } from '../data/heroDatasets'
import { columnIndex, toLabel, toNumber } from '../data/table'
import { colorAt, schemes } from '../lib/colors'
import { bundlePath, treeFromPaths, type PathTree } from '../stats/graphs'
import { classBreaks, classIndex } from '../stats/geo'
import { metaAnalysis } from '../stats/meta'
import { buildNetwork } from '../stats/network'
import { buildFlame, flameLayout } from '../stats/process'
import type { Mark, PolyMark, RectMark } from './heroFrames'

/** Frames of the four v0.4 stages: choropleth map, forest plot, flame graph and hierarchical edge bundling. All use the app's own engines on seeded data. */

const CLEAR = 'rgba(0,0,0,0)'
const GRID = '#cfd6d3'
const seed = (cycle: number) => 7 + cycle * 13

const rectMark = (k: string, x: number, y: number, w: number, h: number, fill: string, extra: Partial<RectMark> = {}): RectMark => ({ t: 'rect', k, x, y, w, h, r: 2, fill, stroke: CLEAR, sw: 0, o: 1, ...extra })
const lineMark = (k: string, x1: number, y1: number, x2: number, y2: number, stroke: string, sw: number, from?: Mark['from']): Mark => ({ t: 'line', k, x1, y1, x2, y2, stroke, sw, o: 1, from })
const textMark = (k: string, x: number, y: number, text: string, anchor: 'start' | 'middle' | 'end' = 'middle', fill = '#4b5563'): Mark => ({ t: 'text', k, x, y, text, anchor, fill, o: 1 })

// ─── choropleth: the world map is loaded on demand, so the home page does not carry the shapes ───

type GeoModules = { maps: typeof import('../geo/maps'); projections: typeof import('../geo/projections') }
let geo: GeoModules | null = null
let loading: Promise<void> | null = null

/** Loads the map data once (a separate chunk). The home page calls it shortly before the map stage comes up. */
export function loadHeroGeo(): Promise<void> {
  loading ??= Promise.all([import('../geo/maps'), import('../geo/projections')]).then(([maps, projections]) => { geo = { maps, projections } })
  return loading
}
export const heroGeoReady = () => geo != null

export const HERO_GEO_METRICS = ['인구 밀도 (명/km²)', '1인당 GDP (달러)', '인구 (백만 명)'] as const

/** Per-region value of the metric used in this loop, from the map's own properties (population in persons, GDP in millions of US dollars, area in km²). */
export function heroGeoValue(cycle: number, pop: number | undefined, gdp: number | undefined, area: number): number | null {
  const m = cycle % 3
  if (pop == null || !(pop > 0) || !(area > 0)) return null
  if (m === 0) return pop / area
  if (m === 1) return gdp != null && gdp > 0 ? (gdp * 1e6) / pop : null
  return pop / 1e6
}

export function choroplethFrame(cycle: number, w: number, h: number): Mark[] {
  if (!geo) return []
  const { getMap } = geo.maps
  const { fitProjection, project } = geo.projections
  const map = getMap('world')
  const projection = fitProjection('equal-earth', map.collection as never, w - 20, h - 46, 4)
  const values = map.regions.map((r) => heroGeoValue(cycle, r.pop, r.gdp, r.area))
  const finite = values.filter((v): v is number => v != null)
  // Quantile classes: the same colours as the lab's default, so the map has the same meaning as there.
  const edges = classBreaks(finite, 'quantile', 6)
  const scheme = schemes.teal
  const marks: Mark[] = []
  map.regions.forEach((r, i) => {
    const v = values[i]
    const fill = v == null ? '#eef1f0' : scheme.interpolate(0.12 + 0.88 * (classIndex(v, edges) / Math.max(1, edges.length - 2)))
    const geom = r.feature.geometry
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
    polys.forEach((poly, pi) => {
      const ring = poly[0]
      const pts = ring.map((c) => project(projection, c[0], c[1])).filter((p): p is [number, number] => !!p).map(([x, y]) => [x + 10, y + 6] as [number, number])
      if (pts.length < 4 || Math.abs(d3.polygonArea(pts)) < 2.5) return
      marks.push({ t: 'poly', k: `geo:${r.id}:${pi}`, pts, closed: true, fill, stroke: '#ffffff', fo: 1, so: 0.9, sw: 0.5, o: 1, from: { o: 0 } } as PolyMark)
    })
  })
  // Legend: the six classes with their lower bound.
  const lx = 14
  const ly = h - 22
  const cw = Math.min(54, (w - 120) / 6)
  edges.slice(0, -1).forEach((e, i) => {
    marks.push(rectMark(`geo:lg${i}`, lx + i * cw, ly, cw - 2, 8, scheme.interpolate(0.12 + 0.88 * (i / Math.max(1, edges.length - 2))), { r: 1 }))
    if (i % 2 === 0) marks.push(textMark(`geo:lt${i}`, lx + i * cw + (cw - 2) / 2, ly + 21, d3.format('.2~s')(e)))
  })
  marks.push(textMark('geo:title', w - 12, ly + 8, HERO_GEO_METRICS[cycle % 3], 'end', '#6b7773'))
  return marks
}

// ─── forest plot: the meta-analysis of seeded studies ───

export function forestFrame(cycle: number, w: number, h: number): Mark[] {
  const n = 9 + (cycle % 3) * 2
  const t = generateDataset('studies', seed(cycle), n)
  const [ni, ei, li, ui] = ['연구', '효과크기', '하한', '상한'].map((c) => columnIndex(t, c))
  const rows = t.rows.map((r) => ({ name: toLabel(r[ni]), or: toNumber(r[ei])!, lo: toNumber(r[li])!, hi: toNumber(r[ui])! }))
  const studies = rows.map((r) => ({ effect: Math.log(r.or), se: (Math.log(r.hi) - Math.log(r.lo)) / (2 * 1.959964) }))
  const meta = metaAnalysis(studies, 'random')
  if (!meta) return []
  const left = 64
  const right = 16
  const top = 14
  const bottom = 40
  const lo = Math.max(0.12, d3.min(rows, (r) => r.lo)! / 1.1)
  const hi = Math.min(8, d3.max(rows, (r) => r.hi)! * 1.1)
  const x = d3.scaleLog().domain([lo, hi]).range([left, w - right]).clamp(true)
  const rowH = Math.min(34, (h - top - bottom) / (rows.length + 1.6))
  const wMax = d3.max(meta.weights) || 1
  const marks: Mark[] = []
  const nullX = x(1)
  marks.push(lineMark('fr:null', nullX, top - 4, nullX, top + rowH * (rows.length + 1.4), '#121816', 1.2))
  ;[0.25, 0.5, 1, 2, 4].filter((v) => v > lo && v < hi).forEach((v) => {
    marks.push(lineMark(`fr:g${v}`, x(v), top, x(v), top + rowH * (rows.length + 0.6), GRID, 1))
    marks.push(textMark(`fr:t${v}`, x(v), top + rowH * (rows.length + 1.55), String(v)))
  })
  rows.forEach((r, i) => {
    const cy = top + (i + 0.5) * rowH
    const half = 2.5 + 5 * Math.sqrt(meta.weights[i] / wMax)
    marks.push(lineMark(`fr:l${i}`, x(r.lo), cy, x(r.hi), cy, '#121816', 1.4, { x1: nullX, x2: nullX, o: 0 }))
    marks.push(rectMark(`fr:b${i}`, x(r.or) - half, cy - half, 2 * half, 2 * half, colorAt(0), { r: 1, from: { x: nullX, o: 0 } }))
    marks.push(textMark(`fr:n${i}`, left - 8, cy + 4, r.name, 'end', '#6b7773'))
  })
  const py = top + (rows.length + 0.9) * rowH
  const px = (v: number) => x(Math.exp(v))
  const dia: [number, number][] = [[px(meta.lo), py], [px(meta.effect), py - rowH * 0.42], [px(meta.hi), py], [px(meta.effect), py + rowH * 0.42]]
  marks.push({ t: 'poly', k: 'fr:pool', pts: dia, closed: true, fill: '#121816', stroke: '#121816', fo: 0.92, so: 1, sw: 1, o: 1, from: { pts: dia.map(() => [nullX, py] as [number, number]), o: 0.2 } } as PolyMark)
  marks.push(textMark('fr:poolt', left - 8, py + 4, '합동', 'end', '#121816'))
  marks.push(textMark('fr:foot', w - right, h - 8, `OR ${Math.exp(meta.effect).toFixed(2)} [${Math.exp(meta.lo).toFixed(2)}, ${Math.exp(meta.hi).toFixed(2)}] · I² ${Math.round(meta.I2 * 100)}%`, 'end', '#6b7773'))
  return marks
}

// ─── flame graph: folded stacks of the seeded profile ───

function flameColor(name: string) {
  let hsh = 2166136261
  for (let i = 0; i < name.length; i++) hsh = Math.imul(hsh ^ name.charCodeAt(i), 16777619) >>> 0
  return d3.interpolateOrRd(0.18 + 0.5 * ((hsh % 1000) / 1000))
}

export function flameFrame(cycle: number, w: number, h: number): Mark[] {
  const t = generateDataset('profile', seed(cycle))
  const [si, vi] = ['스택', '표본 수'].map((c) => columnIndex(t, c))
  const root = buildFlame(t.rows.map((r, row) => ({ stack: toLabel(r[si]), value: toNumber(r[vi]) ?? 0, row })))
  const { blocks } = flameLayout(root)
  const pad = 14
  const iw = w - 2 * pad
  const depth = d3.max(blocks, (b) => b.depth) ?? 0
  const rowH = Math.min(56, (h - 34) / (depth + 1))
  const base = h - 22
  const marks: Mark[] = []
  for (const b of blocks) {
    const bw = (b.x1 - b.x0) * iw
    if (bw < 1.2) continue
    const path = b.node.path.join(';') || 'root'
    const y = base - (b.depth + 1) * rowH
    marks.push(rectMark(`fl:${path}`, pad + b.x0 * iw, y, Math.max(0.6, bw - 0.8), rowH - 1.5, b.depth === 0 ? '#cfd6d3' : flameColor(b.node.name), { r: 1.5, from: { y: base, h: 0, o: 0 } }))
    if (bw > 44) marks.push(textMark(`fl:t:${path}`, pad + b.x0 * iw + 4, y + rowH / 2 + 3, b.node.name.length * 6 > bw - 8 ? `${b.node.name.slice(0, Math.max(1, Math.floor((bw - 8) / 6) - 1))}…` : b.node.name, 'start', '#121816'))
  }
  marks.push(textMark('fl:foot', w / 2, h - 5, '가로 = 포함 비용 비율 (시간 순서 아님)', 'middle', '#8a9490'))
  return marks
}

// ─── hierarchical edge bundling: edges start straight and are pulled along the hierarchy ───

const SAMPLES = 24
const BETA = 0.85

/** A polyline resampled to `n` points evenly spaced by length. */
export function resample(pts: readonly [number, number][], n: number): [number, number][] {
  const len = [0]
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  const total = len[len.length - 1] || 1
  const out: [number, number][] = []
  let j = 1
  for (let k = 0; k < n; k++) {
    const target = (k / (n - 1)) * total
    while (j < pts.length - 1 && len[j] < target) j++
    const seg = len[j] - len[j - 1] || 1
    const f = Math.max(0, Math.min(1, (target - len[j - 1]) / seg))
    out.push([pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * f, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * f])
  }
  return out
}

/** The bundled curve through control points: Holten's straightening by β, then a uniform cubic B-spline (d3.curveBasis), sampled. */
export function bundleCurve(control: readonly [number, number][], beta: number): [number, number][] {
  const n = control.length
  const [a, b] = [control[0], control[n - 1]]
  const adj = control.map((p, i) => [beta * p[0] + (1 - beta) * (a[0] + ((b[0] - a[0]) * i) / Math.max(1, n - 1)), beta * p[1] + (1 - beta) * (a[1] + ((b[1] - a[1]) * i) / Math.max(1, n - 1))] as [number, number])
  const pts: [number, number][] = []
  const ctx = {
    moveTo: (x: number, y: number) => { pts.push([x, y]) },
    lineTo: (x: number, y: number) => { pts.push([x, y]) },
    closePath: () => {},
    bezierCurveTo: (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => {
      const [x0, y0] = pts[pts.length - 1]
      for (let s = 1; s <= 6; s++) {
        const t = s / 6; const u = 1 - t
        pts.push([u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y])
      }
    },
  }
  d3.line().curve(d3.curveBasis).context(ctx as unknown as CanvasRenderingContext2D)(adj)
  return resample(pts, SAMPLES)
}

export function bundlingFrame(cycle: number, w: number, h: number): Mark[] {
  const t = generateDataset('modules', seed(cycle), 24 + (cycle % 3) * 6)
  const [si, ti, wi] = ['출발', '도착', '가중치'].map((c) => columnIndex(t, c))
  const net = buildNetwork(t.rows.map((r, row) => ({ source: toLabel(r[si]), target: toLabel(r[ti]), weight: toNumber(r[wi]), group: '', row })), { directed: true })
  const ids = net.nodes.map((n) => n.id)
  const root = d3.hierarchy<PathTree>(treeFromPaths(ids, '/'))
  const key = (n: d3.HierarchyNode<PathTree>) => n.ancestors().reverse().slice(1).map((a) => a.data.name).join('/')
  const R = Math.min(w, h) / 2 - 24
  const laid = d3.cluster<PathTree>().size([2 * Math.PI, R])(root)
  const cx = w / 2
  const cy = h / 2
  const xy = (n: { x: number; y: number }): [number, number] => [cx + Math.cos(n.x - Math.PI / 2) * n.y, cy + Math.sin(n.x - Math.PI / 2) * n.y]
  const tops = [...new Set(ids.map((id) => id.split('/')[0]))]
  const marks: Mark[] = []
  for (const l of net.links) {
    const path = bundlePath(laid, l.source, l.target, key)
    if (!path) continue
    const control = path.map((p) => xy(p as d3.HierarchyPointNode<PathTree>))
    const color = d3.color(colorAt(Math.max(0, tops.indexOf(l.source.split('/')[0]))))!.copy({ opacity: 0.55 }).formatRgb()
    marks.push({ t: 'poly', k: `eb:${l.source}>${l.target}`, pts: bundleCurve(control, BETA), closed: false, fill: CLEAR, stroke: color, fo: 0, so: 1, sw: 1 + Math.min(1.6, l.weight * 0.35), o: 1, from: { pts: bundleCurve(control, 0), so: 0.35 } } as PolyMark)
  }
  for (const leaf of laid.leaves()) {
    const [px, py] = xy(leaf)
    const id = key(leaf)
    marks.push({ t: 'circle', k: `eb:n:${id}`, x: px, y: py, r: 4.2, fill: colorAt(Math.max(0, tops.indexOf(id.split('/')[0]))), o: 1, from: { r: 0, o: 0 } })
  }
  tops.forEach((g, i) => {
    const members = laid.leaves().filter((l) => key(l).startsWith(`${g}/`) || key(l) === g)
    if (!members.length) return
    const a = d3.mean(members, (m) => m.x)!
    const [lx, ly] = [cx + Math.cos(a - Math.PI / 2) * (R + 16), cy + Math.sin(a - Math.PI / 2) * (R + 16)]
    marks.push(textMark(`eb:g${i}`, lx, ly + 4, g, Math.cos(a - Math.PI / 2) > 0.25 ? 'start' : Math.cos(a - Math.PI / 2) < -0.25 ? 'end' : 'middle', colorAt(i)))
  })
  return marks
}
