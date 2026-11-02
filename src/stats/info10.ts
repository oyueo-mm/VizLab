import * as d3 from 'd3'
import { createRng } from '../lib/random'

export type Pt = [number, number]

// ───────────────────────────── ZAME: multi-scale aggregated adjacency matrix ─────────────────────────────

export interface ZNode { id: number; parent: number; children: number[]; /** leaf (vertex) range in the leaf order */ lo: number; hi: number }
export interface ZameModel {
  n: number
  /** vertex order along the matrix (clusters are contiguous ranges) */
  order: number[]
  nodes: ZNode[]
  root: number
  /** adjacency of the vertices (weights summed; symmetric) */
  weight: Map<number, number>[]
}

/** Builds the cluster tree: communities first (label propagation), inside a community breadth-first order, then balanced binary splits. */
export function zameBuild(n: number, edges: readonly [number, number, number?][], seed = 3): ZameModel {
  const weight: Map<number, number>[] = Array.from({ length: n }, () => new Map())
  for (const [a, b, w = 1] of edges) { if (a === b) continue; weight[a].set(b, (weight[a].get(b) ?? 0) + w); weight[b].set(a, (weight[b].get(a) ?? 0) + w) }
  // label propagation (deterministic order, seeded tie-breaks)
  const r = createRng(seed)
  const label = Array.from({ length: n }, (_, i) => i)
  const idx = [...Array(n).keys()]
  for (let it = 0; it < 12; it++) {
    let changed = false
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]] }
    for (const v of idx) {
      const tally = new Map<number, number>()
      for (const [u, w] of weight[v]) tally.set(label[u], (tally.get(label[u]) ?? 0) + w)
      let best = label[v], bw = -1
      for (const [l, w] of tally) if (w > bw || (w === bw && l < best)) { bw = w; best = l }
      if (bw > 0 && best !== label[v]) { label[v] = best; changed = true }
    }
    if (!changed) break
  }
  const comms = new Map<number, number[]>()
  for (let v = 0; v < n; v++) comms.set(label[v], [...(comms.get(label[v]) ?? []), v])
  const groups = [...comms.values()].sort((a, b) => b.length - a.length)
  // breadth-first order inside every community, starting at the vertex of highest degree
  const order: number[] = []
  const bounds: [number, number][] = []
  for (const g of groups) {
    const inG = new Set(g)
    const seen = new Set<number>()
    const start = [...g].sort((a, b) => weight[b].size - weight[a].size || a - b)
    const lo = order.length
    for (const s of start) {
      if (seen.has(s)) continue
      const q = [s]; seen.add(s)
      while (q.length) { const v = q.shift()!; order.push(v); for (const u of [...weight[v].keys()].sort((a, b) => a - b)) if (inG.has(u) && !seen.has(u)) { seen.add(u); q.push(u) } }
    }
    bounds.push([lo, order.length])
  }
  const nodes: ZNode[] = []
  const split = (lo: number, hi: number, parent: number): number => {
    const id = nodes.length
    nodes.push({ id, parent, children: [], lo, hi })
    if (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); nodes[id].children = [split(lo, mid, id), split(mid, hi, id)] }
    return id
  }
  const root = nodes.length
  nodes.push({ id: root, parent: -1, children: [], lo: 0, hi: n })
  for (const [lo, hi] of bounds) nodes[root].children.push(split(lo, hi, root))
  return { n, order, nodes, root, weight }
}

export interface ZBlock { a: number; b: number; /** total weight between the two clusters (inside one cluster: its internal edges) */ sum: number; /** sum divided by the number of possible vertex pairs */ density: number }

/** Aggregated matrix for a set of clusters (a partition of the vertices, given as tree node ids in matrix order). */
export function zameBlocks(m: ZameModel, frontier: readonly number[]): ZBlock[] {
  const pos = new Array<number>(m.n)
  m.order.forEach((v, i) => { pos[v] = i })
  const at = (i: number) => frontier.findIndex((id) => m.nodes[id].lo <= i && i < m.nodes[id].hi)
  const cluster = new Array<number>(m.n)
  for (let v = 0; v < m.n; v++) cluster[v] = at(pos[v])
  const sums = new Map<number, number>()
  const K = frontier.length
  for (let v = 0; v < m.n; v++) for (const [u, w] of m.weight[v]) if (u >= v) { const a = Math.min(cluster[v], cluster[u]), b = Math.max(cluster[v], cluster[u]); sums.set(a * K + b, (sums.get(a * K + b) ?? 0) + w) }
  const out: ZBlock[] = []
  for (let a = 0; a < K; a++) for (let b = a; b < K; b++) {
    const sa = m.nodes[frontier[a]].hi - m.nodes[frontier[a]].lo, sb = m.nodes[frontier[b]].hi - m.nodes[frontier[b]].lo
    const pairs = a === b ? (sa * (sa - 1)) / 2 : sa * sb
    const sum = sums.get(a * K + b) ?? 0
    out.push({ a, b, sum, density: pairs > 0 ? sum / pairs : 0 })
  }
  return out
}

/** Splits the largest cluster of the frontier until it has at least `cells` clusters (or only single vertices remain). */
export function zameRefine(m: ZameModel, frontier: readonly number[], cells: number): number[] {
  const f = [...frontier]
  while (f.length < cells) {
    let best = -1, size = 1
    f.forEach((id, i) => { const s = m.nodes[id].hi - m.nodes[id].lo; if (m.nodes[id].children.length && s > size) { size = s; best = i } })
    if (best < 0) break
    f.splice(best, 1, ...m.nodes[f[best]].children)
  }
  return f.sort((a, b) => m.nodes[a].lo - m.nodes[b].lo)
}

// ───────────────────────────── Excentric labeling ─────────────────────────────

export interface LabelItem { index: number; x: number; y: number; text: string }
export interface PlacedLabel extends LabelItem { side: 'left' | 'right'; /** label box (left, top, width, height) */ box: [number, number, number, number]; anchor: Pt }

/**
 * Excentric labeling: the labels of the objects inside a circle around the cursor are stacked in two columns beside the circle, ordered
 * by the objects' heights so that the leader lines do not cross, without overlapping each other. At most `maxLabels` objects (the nearest) are labelled.
 */
export function excentricLabels(items: readonly LabelItem[], cursor: Pt, radius: number, opts: { maxLabels: number; labelH: number; labelW: (t: string) => number; gap: number; bounds: [number, number] }): { inside: LabelItem[]; placed: PlacedLabel[]; hidden: number } {
  const inside = items.filter((p) => Math.hypot(p.x - cursor[0], p.y - cursor[1]) <= radius)
  const nearest = [...inside].sort((a, b) => Math.hypot(a.x - cursor[0], a.y - cursor[1]) - Math.hypot(b.x - cursor[0], b.y - cursor[1])).slice(0, opts.maxLabels)
  const sides: Record<'left' | 'right', LabelItem[]> = { left: [], right: [] }
  nearest.forEach((p) => sides[p.x < cursor[0] ? 'left' : 'right'].push(p))
  // balance the columns when one side is much fuller than the other
  while (sides.left.length > sides.right.length + 2) sides.right.push(sides.left.splice(sides.left.reduce((b, p, i, a) => (p.x > a[b].x ? i : b), 0), 1)[0])
  while (sides.right.length > sides.left.length + 2) sides.left.push(sides.right.splice(sides.right.reduce((b, p, i, a) => (p.x < a[b].x ? i : b), 0), 1)[0])
  const placed: PlacedLabel[] = []
  for (const side of ['left', 'right'] as const) {
    const list = [...sides[side]].sort((a, b) => a.y - b.y || a.index - b.index)
    const n = list.length
    const total = n * opts.labelH
    let top = Math.min(Math.max(cursor[1] - total / 2, 0), Math.max(0, opts.bounds[1] - total))
    for (const p of list) {
      const w = opts.labelW(p.text)
      const x = side === 'right' ? cursor[0] + radius + opts.gap : cursor[0] - radius - opts.gap - w
      placed.push({ ...p, side, box: [x, top, w, opts.labelH], anchor: [side === 'right' ? x : x + w, top + opts.labelH / 2] })
      top += opts.labelH
    }
  }
  return { inside, placed, hidden: inside.length - nearest.length }
}

// ───────────────────────────── LineUp ─────────────────────────────

export interface LineUpColumn { name: string; weight: number; invert: boolean }
export interface LineUpRow { index: number; score: number; rank: number; /** weighted contribution of every column to the score (they add up to `score`) */ parts: number[] }

/** Multi-attribute ranking: every column is scaled to 0…1 (inverted columns count lower values as better) and the score is the weighted mean. */
export function lineUp(values: readonly (readonly number[])[], cols: readonly LineUpColumn[], sortBy: number | 'score' = 'score'): LineUpRow[] {
  const k = cols.length
  const lo = cols.map((_, j) => Math.min(...values.map((r) => r[j]))), hi = cols.map((_, j) => Math.max(...values.map((r) => r[j])))
  const norm = (v: number, j: number) => { const t = hi[j] > lo[j] ? (v - lo[j]) / (hi[j] - lo[j]) : 0.5; return cols[j].invert ? 1 - t : t }
  const wsum = cols.reduce((a, c) => a + Math.max(0, c.weight), 0)
  const rows: LineUpRow[] = values.map((r, index) => {
    const parts = Array.from({ length: k }, (_, j) => (wsum > 0 ? (Math.max(0, cols[j].weight) * norm(r[j], j)) / wsum : 0))
    return { index, score: parts.reduce((a, b) => a + b, 0), rank: 0, parts }
  })
  const key = (r: LineUpRow) => (sortBy === 'score' ? r.score : norm(values[r.index][sortBy], sortBy))
  rows.sort((a, b) => key(b) - key(a) || a.index - b.index)
  rows.forEach((r, i) => { r.rank = i + 1 })
  return rows
}

// ───────────────────────────── Unit visualization (Atom-style layouts) ─────────────────────────────

export interface UnitRecord { id: number; /** category of the record for every split level */ cats: string[]; value: number }
export type UnitLeaf = 'grid' | 'dodge' | 'pack' | 'jitter'
export interface UnitMark { id: number; x: number; y: number; r: number; cell: number }
export interface UnitCell { key: string; x: number; y: number; w: number; h: number; count: number }

/**
 * Unit visualization: the box is divided by the first split category along x and, inside every part, by the second split category along y
 * (part sizes proportional to their record counts); finally the records of every cell become one mark each, laid out as a waffle grid,
 * a dot histogram of their value (dodge), a tight circle packing, or a jitter plot.
 */
export function unitLayout(recs: readonly UnitRecord[], splits: number, leaf: UnitLeaf, w: number, h: number, gap = 6): { marks: UnitMark[]; cells: UnitCell[]; unit: number } {
  const keyOf = (r: UnitRecord, level: number) => r.cats[level] ?? ''
  const order = (items: readonly UnitRecord[], level: number) => [...new Set(items.map((r) => keyOf(r, level)))].sort((a, b) => a.localeCompare(b, 'ko'))
  const cells: { key: string; x: number; y: number; w: number; h: number; recs: UnitRecord[] }[] = []
  const partition = (items: UnitRecord[], x: number, y: number, ww: number, hh: number, level: number, key: string) => {
    if (level >= splits || !items.length) { cells.push({ key, x, y, w: ww, h: hh, recs: items }); return }
    const keys = order(items, level)
    const horizontal = level % 2 === 0
    const usable = (horizontal ? ww : hh) - gap * (keys.length - 1)
    let at = horizontal ? x : y
    for (const k of keys) {
      const part = items.filter((r) => keyOf(r, level) === k)
      const len = Math.max(2, (usable * part.length) / items.length)
      if (horizontal) partition(part, at, y, len, hh, level + 1, `${key}/${k}`)
      else partition(part, x, at, ww, len, level + 1, `${key}/${k}`)
      at += len + gap
    }
  }
  partition([...recs], 0, 0, w, h, 0, '')
  const marks: UnitMark[] = []
  let unit = Infinity
  const laid: { cell: number; local: { id: number; x: number; y: number; r: number }[] }[] = []
  cells.forEach((c, ci) => {
    const n = c.recs.length
    if (!n) { laid.push({ cell: ci, local: [] }); return }
    const sorted = [...c.recs].sort((a, b) => a.value - b.value || a.id - b.id)
    let local: { id: number; x: number; y: number; r: number }[]
    if (leaf === 'grid') {
      // the largest square unit for which n units fit in the cell
      let s = Math.min(c.w, c.h)
      for (; s > 1.5; s -= 0.5) { const cols = Math.max(1, Math.floor(c.w / s)); if (Math.ceil(n / cols) * s <= c.h) break }
      const cols = Math.max(1, Math.floor(c.w / s))
      local = sorted.map((r, i) => ({ id: r.id, x: (i % cols) * s + s / 2, y: c.h - (Math.floor(i / cols) * s + s / 2), r: s * 0.42 }))
    } else if (leaf === 'pack') {
      const rr = Math.max(1, Math.min(c.w, c.h) / (Math.sqrt(n) * 2.2))
      const packed = d3.packSiblings(sorted.map(() => ({ r: rr })))
      const enc = d3.packEnclose(packed)
      const sc = enc ? Math.min(c.w, c.h) / (2 * enc.r) : 1
      local = sorted.map((r, i) => ({ id: r.id, x: c.w / 2 + (packed[i].x - (enc?.x ?? 0)) * Math.min(sc, 1.4), y: c.h / 2 + (packed[i].y - (enc?.y ?? 0)) * Math.min(sc, 1.4), r: rr * Math.min(sc, 1.4) * 0.95 }))
    } else {
      const lo = Math.min(...sorted.map((r) => r.value)), hi = Math.max(...sorted.map((r) => r.value))
      const sx = (v: number) => (hi > lo ? ((v - lo) / (hi - lo)) * (c.w * 0.9) + c.w * 0.05 : c.w / 2)
      const rr = Math.max(1.2, Math.min(7, Math.sqrt((c.w * c.h) / (n * 5))))
      if (leaf === 'dodge') {
        const placed: { x: number; y: number }[] = []
        local = sorted.map((r) => {
          const x = sx(r.value)
          let y = c.h - rr
          for (let guard = 0; guard < 400; guard++) { if (!placed.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < (2 * rr) ** 2 - 1e-6)) break; y -= rr * 0.5 }
          placed.push({ x, y })
          return { id: r.id, x, y: Math.max(rr, y), r: rr }
        })
      } else {
        const rng = createRng(7 + n)
        local = sorted.map((r) => ({ id: r.id, x: sx(r.value), y: rr + rng() * Math.max(0, c.h - 2 * rr), r: rr }))
      }
    }
    unit = Math.min(unit, ...local.map((m) => m.r))
    laid.push({ cell: ci, local })
  })
  for (const { cell, local } of laid) for (const m of local) marks.push({ id: m.id, x: cells[cell].x + m.x, y: cells[cell].y + m.y, r: m.r, cell })
  return { marks, cells: cells.map((c) => ({ key: c.key, x: c.x, y: c.y, w: c.w, h: c.h, count: c.recs.length })), unit: Number.isFinite(unit) ? unit : 0 }
}

// ───────────────────────────── Splatterplot ─────────────────────────────

export interface SplatClass { points: Pt[]; /** polygon rings (in data coordinates) of the density contour enclosing `coverage` of the points */ rings: Pt[][]; inside: boolean[] }

/**
 * Splatterplot: a dense class is replaced by the contour of its smoothed density (the region holding `coverage` of its points) and only the points
 * outside that region are drawn one by one, so overdraw cannot hide the outliers.
 */
export function splatter(points: readonly Pt[], x: [number, number], y: [number, number], opts: { grid: number; bandwidth: number; coverage: number }): SplatClass {
  const G = opts.grid
  const dens = new Float64Array(G * G)
  const bw = opts.bandwidth * G
  const rad = Math.ceil(bw * 3)
  for (const [px, py] of points) {
    const gx = ((px - x[0]) / (x[1] - x[0])) * (G - 1), gy = ((py - y[0]) / (y[1] - y[0])) * (G - 1)
    for (let j = Math.max(0, Math.floor(gy) - rad); j <= Math.min(G - 1, Math.floor(gy) + rad); j++) for (let i = Math.max(0, Math.floor(gx) - rad); i <= Math.min(G - 1, Math.floor(gx) + rad); i++) dens[j * G + i] += Math.exp(-((i - gx) ** 2 + (j - gy) ** 2) / (2 * bw * bw))
  }
  const at = (p: Pt) => { const i = Math.round(((p[0] - x[0]) / (x[1] - x[0])) * (G - 1)), j = Math.round(((p[1] - y[0]) / (y[1] - y[0])) * (G - 1)); return dens[Math.min(G - 1, Math.max(0, j)) * G + Math.min(G - 1, Math.max(0, i))] }
  // the threshold is the density value below which the lowest-density (1 − coverage) share of the points lies
  const sorted = points.map(at).sort((a, b) => a - b)
  const level = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((1 - opts.coverage) * sorted.length))] : 0
  const contours = d3.contours().size([G, G]).thresholds([level])(Array.from(dens))
  const rings: Pt[][] = []
  for (const mp of contours[0]?.coordinates ?? []) for (const ring of mp) rings.push(ring.map(([gi, gj]) => [x[0] + ((gi - 0.5) / (G - 1)) * (x[1] - x[0]), y[0] + ((gj - 0.5) / (G - 1)) * (y[1] - y[0])] as Pt))
  return { points: points as Pt[], rings, inside: points.map((p) => at(p) >= level) }
}
