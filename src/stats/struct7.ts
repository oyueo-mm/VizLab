/** Layout engines of the v0.7 set, flow, text, hierarchy and pixel-curve techniques. */
import { createRng } from '../lib/random'
import type { ClusterNode } from './cluster'
import type { TreeNode } from './hierarchy'

export type P2 = [number, number]

// ───────────────────────────── Parallel Sets ─────────────────────────────

export interface PSSegment { dim: number; key: string; total: number; y0: number; y1: number }
export interface PSRibbon { dim: number; a: string; b: string; color: string; weight: number; ya0: number; ya1: number; yb0: number; yb1: number }

/**
 * Parallel sets: every dimension is an axis split into one segment per category (height ∝ total weight, largest first); between
 * neighbouring axes a ribbon per pair of categories carries the weight of the records having both. Heights are fractions of 1.
 */
export function parallelSets(rows: readonly { cats: readonly string[]; w: number }[], dims: number, gap = 0, colorDim = 0) {
  const total = rows.reduce((s, r) => s + r.w, 0)
  const segments: PSSegment[] = []
  const segPos = new Map<string, PSSegment>()
  for (let d = 0; d < dims; d++) {
    const t = new Map<string, number>()
    for (const r of rows) t.set(r.cats[d], (t.get(r.cats[d]) ?? 0) + r.w)
    const keys = [...t.keys()].sort((a, b) => t.get(b)! - t.get(a)! || a.localeCompare(b))
    const usable = 1 - gap * (keys.length - 1)
    let y = 0
    for (const k of keys) {
      const h = total > 0 ? (t.get(k)! / total) * usable : 0
      const seg = { dim: d, key: k, total: t.get(k)!, y0: y, y1: y + h }
      segments.push(seg); segPos.set(`${d}\u0001${k}`, seg)
      y += h + gap
    }
  }
  const ribbons: PSRibbon[] = []
  for (let d = 0; d + 1 < dims; d++) {
    const pair = new Map<string, number>()
    for (const r of rows) { const k = `${r.cats[d]}\u0001${r.cats[d + 1]}\u0001${r.cats[colorDim] ?? ''}`; pair.set(k, (pair.get(k) ?? 0) + r.w) }
    const outCursor = new Map<string, number>(), inCursor = new Map<string, number>()
    const items = [...pair.entries()].map(([k, w]) => { const [a, b, c] = k.split('\u0001'); return { a, b, c, w } })
    // order ribbons so that they do not cross needlessly: by source segment position, then target segment position
    const colorRank = (c: string) => segPos.get(`${colorDim}\u0001${c}`)?.y0 ?? 0
    items.sort((p, q) => segPos.get(`${d}\u0001${p.a}`)!.y0 - segPos.get(`${d}\u0001${q.a}`)!.y0 || segPos.get(`${d + 1}\u0001${p.b}`)!.y0 - segPos.get(`${d + 1}\u0001${q.b}`)!.y0 || colorRank(p.c) - colorRank(q.c))
    const bySource = (p: { a: string; b: string }, q: { a: string; b: string }) => segPos.get(`${d + 1}\u0001${p.b}`)!.y0 - segPos.get(`${d + 1}\u0001${q.b}`)!.y0
    for (const it of items) {
      const sa = segPos.get(`${d}\u0001${it.a}`)!
      const usable = 1 - gap * (segments.filter((s) => s.dim === d).length - 1)
      const h = total > 0 ? (it.w / total) * usable : 0
      const ya = sa.y0 + (outCursor.get(it.a) ?? 0)
      outCursor.set(it.a, (outCursor.get(it.a) ?? 0) + h)
      ribbons.push({ dim: d, a: it.a, b: it.b, color: it.c, weight: it.w, ya0: ya, ya1: ya + h, yb0: 0, yb1: 0 })
    }
    // target side: stack arriving ribbons in the order of their source position
    const arriving = ribbons.filter((r) => r.dim === d).sort((p, q) => bySource(p, q) || colorRank(p.color) - colorRank(q.color) || p.ya0 - q.ya0)
    for (const r of arriving) {
      const sb = segPos.get(`${d + 1}\u0001${r.b}`)!
      const h = r.ya1 - r.ya0
      const yb = sb.y0 + (inCursor.get(r.b) ?? 0)
      inCursor.set(r.b, (inCursor.get(r.b) ?? 0) + h)
      r.yb0 = yb; r.yb1 = yb + h
    }
  }
  return { segments, ribbons, total }
}

// ───────────────────────────── Words ─────────────────────────────

const PARTICLES = ['에서는', '으로는', '에서', '으로', '에게', '까지', '부터', '하고', '이다', '은', '는', '이', '가', '을', '를', '의', '에', '와', '과', '로', '도', '만']

/** Splits text into word tokens and removes one trailing Korean particle (a conservative rule: the stem must keep two or more characters). */
export function tokenize(text: string, stop: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = []
  for (const raw of text.split(/[^\p{L}\p{N}]+/u)) {
    let w = raw.toLowerCase()
    if (!w) continue
    if (/니다$/.test(w)) continue
    const p = PARTICLES.find((q) => w.endsWith(q))
    if (p && w.length - p.length >= 2 && /[ㄱ-힝]/.test(w)) w = w.slice(0, -p.length)
    if (w.length < 2 || stop.has(w)) continue
    out.push(w)
  }
  return out
}

export function wordFrequencies(texts: readonly string[], stop: ReadonlySet<string> = new Set()): { word: string; count: number }[] {
  const m = new Map<string, number>()
  for (const t of texts) for (const w of tokenize(t, stop)) m.set(w, (m.get(w) ?? 0) + 1)
  return [...m.entries()].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
}

/** Rough text width in em: CJK characters are one em wide, Latin letters about 0.56. */
export const textWidthEm = (w: string) => [...w].reduce((s, ch) => s + (/[ᄀ-퟿぀-ヿ一-鿿]/.test(ch) ? 1 : 0.56), 0)

export interface PlacedWord { word: string; count: number; size: number; x: number; y: number; w: number; h: number; rotated: boolean }

/** Word cloud layout: the biggest words go first and each moves outward on an Archimedean spiral until its box no longer overlaps one already placed. */
export function wordCloud(words: readonly { word: string; count: number }[], width: number, height: number, opts: { minSize: number; maxSize: number; rotate: boolean; pad?: number; seed?: number }) {
  const pad = opts.pad ?? 2
  const counts = words.map((w) => w.count)
  const lo = Math.min(...counts), hi = Math.max(...counts)
  const rng = createRng(opts.seed ?? 1)
  const placed: PlacedWord[] = []
  const skipped: string[] = []
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    Math.abs(a.x - b.x) * 2 < a.w + b.w + pad * 2 && Math.abs(a.y - b.y) * 2 < a.h + b.h + pad * 2
  words.forEach((wd, idx) => {
    const t = hi > lo ? Math.sqrt((wd.count - lo) / (hi - lo)) : 1
    const size = opts.minSize + t * (opts.maxSize - opts.minSize)
    const rotated = opts.rotate && idx % 5 === 4
    const bw = textWidthEm(wd.word) * size, bh = size * 1.12
    const w = rotated ? bh : bw, h = rotated ? bw : bh
    const phase = rng() * Math.PI * 2
    // Archimedean spiral r = b·θ/2π advanced by a constant arc length, so the search is fine near the centre and never skips space far out.
    let theta = 0
    for (let s = 0; s < 9000; s++) {
      const rad = (opts.minSize * 0.7 * theta) / (2 * Math.PI)
      theta += 5 / Math.max(5, rad)
      const ang = phase + theta
      const box = { x: width / 2 + Math.cos(ang) * rad * 1.5, y: height / 2 + Math.sin(ang) * rad, w, h }
      if (box.x - w / 2 < 0 || box.x + w / 2 > width || box.y - h / 2 < 0 || box.y + h / 2 > height) continue
      if (placed.some((p) => overlaps(box, p))) continue
      placed.push({ word: wd.word, count: wd.count, size, rotated, ...box })
      return
    }
    skipped.push(wd.word)
  })
  return { placed, skipped }
}

export interface WordNode { word: string; count: number; children: WordNode[] }

/**
 * Word tree: all sentences containing `root` are aligned at it; the words after it form a prefix tree (right) and the words before it,
 * read backwards, another (left). Counts are the number of sentences passing through a node.
 */
export function wordTree(sentences: readonly string[], root: string, depth: number, minCount = 1, stop: ReadonlySet<string> = new Set()) {
  const right: WordNode = { word: root, count: 0, children: [] }, left: WordNode = { word: root, count: 0, children: [] }
  const add = (node: WordNode, seq: readonly string[]) => {
    node.count++
    let cur = node
    for (const w of seq.slice(0, depth)) {
      let c = cur.children.find((x) => x.word === w)
      if (!c) { c = { word: w, count: 0, children: [] }; cur.children.push(c) }
      c.count++
      cur = c
    }
  }
  for (const s of sentences) {
    const toks = tokenize(s, stop)
    toks.forEach((t, i) => {
      if (t !== root) return
      add(right, toks.slice(i + 1))
      add(left, toks.slice(0, i).reverse())
    })
  }
  const prune = (n: WordNode) => { n.children = n.children.filter((c) => c.count >= minCount).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word)); n.children.forEach(prune) }
  prune(right); prune(left)
  return { right, left, occurrences: right.count }
}

// ───────────────────────────── Space-filling curves ─────────────────────────────

export type CurveKind = 'hilbert' | 'zorder' | 'snake' | 'row'

/** Hilbert curve: index d (0 … side²−1) → cell (x, y) on a side × side grid; side must be a power of two. */
export function hilbertD2XY(side: number, d: number): P2 {
  let x = 0, y = 0, t = d
  for (let s = 1; s < side; s *= 2) {
    const rx = 1 & (t >> 1)
    const ry = 1 & (t ^ rx)
    if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y } const tmp = x; x = y; y = tmp }
    x += s * rx; y += s * ry
    t = Math.floor(t / 4)
  }
  return [x, y]
}

export function mortonD2XY(d: number): P2 {
  let x = 0, y = 0
  for (let b = 0; b < 16; b++) { x |= ((d >> (2 * b)) & 1) << b; y |= ((d >> (2 * b + 1)) & 1) << b }
  return [x, y]
}

export const curveSide = (n: number, kind: CurveKind) => {
  const s = Math.ceil(Math.sqrt(Math.max(1, n)))
  return kind === 'hilbert' || kind === 'zorder' ? 2 ** Math.ceil(Math.log2(Math.max(1, s))) : s
}

export function curveCell(kind: CurveKind, side: number, d: number): P2 {
  if (kind === 'hilbert') return hilbertD2XY(side, d)
  if (kind === 'zorder') return mortonD2XY(d)
  const y = Math.floor(d / side), x = d % side
  return [kind === 'snake' && y % 2 === 1 ? side - 1 - x : x, y]
}

// ───────────────────────────── Voronoi treemap ─────────────────────────────

const polyArea = (p: readonly P2[]) => { let a = 0; for (let i = 0; i < p.length; i++) { const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length]; a += x0 * y1 - x1 * y0 } return Math.abs(a) / 2 }
export const polygonArea = polyArea

function polyCentroid(p: readonly P2[]): P2 {
  let a = 0, cx = 0, cy = 0
  for (let i = 0; i < p.length; i++) { const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length]; const c = x0 * y1 - x1 * y0; a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c }
  if (Math.abs(a) < 1e-12) { const m = p.reduce((s, q) => [s[0] + q[0], s[1] + q[1]] as P2, [0, 0] as P2); return [m[0] / (p.length || 1), m[1] / (p.length || 1)] }
  return [cx / (3 * a), cy / (3 * a)]
}

/** Sutherland–Hodgman clip of a convex polygon by the half-plane a·x + b·y ≤ c. */
function clipHalf(poly: readonly P2[], a: number, b: number, c: number): P2[] {
  const out: P2[] = []
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length]
    const fp = a * p[0] + b * p[1] - c, fq = a * q[0] + b * q[1] - c
    if (fp <= 0) out.push(p)
    if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) { const t = fp / (fp - fq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]) }
  }
  return out
}

/** Power-diagram cell of site i inside a convex polygon: |x − sᵢ|² − wᵢ ≤ |x − sⱼ|² − wⱼ is a half-plane for every j. */
function powerCell(i: number, sites: readonly P2[], w: readonly number[], bounds: readonly P2[]): P2[] {
  let cell = bounds.slice() as P2[]
  const [xi, yi] = sites[i]
  for (let j = 0; j < sites.length && cell.length; j++) {
    if (j === i) continue
    const [xj, yj] = sites[j]
    cell = clipHalf(cell, 2 * (xj - xi), 2 * (yj - yi), xj * xj + yj * yj - w[j] - xi * xi - yi * yi + w[i])
  }
  return cell
}

/**
 * Voronoi (power-diagram) partition of a convex polygon into cells whose areas follow `values`: sites move to cell centroids (Lloyd) while
 * the weights are adapted until every area is within `tol` of its target, or `iters` rounds have passed. Deterministic for a given seed.
 */
export function voronoiPartition(values: readonly number[], polygon: readonly P2[], iters = 140, seed = 1, tol = 0.01): { cells: P2[][]; error: number } {
  const n = values.length
  if (n === 0) return { cells: [], error: 0 }
  const total = polyArea(polygon)
  if (n === 1) return { cells: [polygon.slice() as P2[]], error: 0 }
  const sum = values.reduce((a, b) => a + b, 0) || 1
  const target = values.map((v) => (v / sum) * total)
  const rng = createRng(seed)
  const xs = polygon.map((p) => p[0]), ys = polygon.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const inside = (p: P2) => { let c = false; for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) { const [xi, yi] = polygon[i], [xj, yj] = polygon[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c } return c }
  const sites: P2[] = []
  while (sites.length < n) { const p: P2 = [x0 + rng() * (x1 - x0), y0 + rng() * (y1 - y0)]; if (inside(p)) sites.push(p) }
  const w = new Array<number>(n).fill(0)
  const R2 = total / n
  let cells: P2[][] = []
  let error = Infinity
  for (let it = 0; it < iters; it++) {
    cells = sites.map((_, i) => powerCell(i, sites, w, polygon))
    const areas = cells.map(polyArea)
    error = Math.max(...areas.map((a, i) => Math.abs(a - target[i]) / Math.max(target[i], 1e-12)))
    if (error < tol) break
    cells.forEach((c, i) => {
      if (c.length >= 3) { const g = polyCentroid(c); sites[i] = [sites[i][0] + 0.35 * (g[0] - sites[i][0]), sites[i][1] + 0.35 * (g[1] - sites[i][1])] }
      w[i] += 0.5 * R2 * ((target[i] - areas[i]) / Math.max(R2, 1e-12)) * 0.6
    })
  }
  cells = sites.map((_, i) => powerCell(i, sites, w, polygon))
  const areas = cells.map(polyArea)
  error = Math.max(...areas.map((a, i) => Math.abs(a - target[i]) / Math.max(target[i], 1e-12)))
  return { cells, error }
}

export interface VCell { node: TreeNode; polygon: P2[]; depth: number; value: number; leaf: boolean }

/** Recursive Voronoi treemap: each node's cell is partitioned by its children (values: leaf value or the sum below). */
export function voronoiTreemap(root: TreeNode, polygon: readonly P2[], maxDepth: number, iters = 140): VCell[] {
  const sumOf = (n: TreeNode): number => (n.children?.length ? n.children.reduce((s, c) => s + sumOf(c), 0) : n.value ?? 0)
  const out: VCell[] = []
  const walk = (n: TreeNode, poly: readonly P2[], depth: number, seed: number) => {
    const kids = (n.children ?? []).filter((c) => sumOf(c) > 0)
    if (!kids.length || depth >= maxDepth) return
    const { cells } = voronoiPartition(kids.map(sumOf), poly, iters, seed)
    kids.forEach((k, i) => {
      const leaf = !k.children?.length || depth + 1 >= maxDepth
      out.push({ node: k, polygon: cells[i], depth: depth + 1, value: sumOf(k), leaf })
      walk(k, cells[i], depth + 1, seed * 31 + i + 1)
    })
  }
  walk(root, polygon, 0, 7)
  return out
}

// ───────────────────────────── Tanglegram ─────────────────────────────

export const leafOrder = (t: ClusterNode): number[] => (t.children?.length ? t.children.flatMap(leafOrder) : [t.id])

/** Number of crossing connection lines between two leaf orders over the same leaves (= inversions of the induced permutation). */
export function tangleCrossings(left: readonly number[], right: readonly number[]): number {
  const pos = new Map(right.map((id, i) => [id, i]))
  const seq = left.map((id) => pos.get(id)!)
  let c = 0
  for (let i = 0; i < seq.length; i++) for (let j = i + 1; j < seq.length; j++) if (seq[i] > seq[j]) c++
  return c
}

const clone = (n: ClusterNode): ClusterNode => ({ ...n, children: n.children?.map(clone) })

/**
 * Untangling: flipping the children of an internal node never changes which leaves belong together, only their order. Greedy passes
 * flip a node of either tree whenever that lowers the number of crossings, until no flip helps. Returns the reordered copies.
 */
export function untangle(a: ClusterNode, b: ClusterNode, maxPasses = 12): { a: ClusterNode; b: ClusterNode; before: number; after: number } {
  const A = clone(a), B = clone(b)
  const before = tangleCrossings(leafOrder(A), leafOrder(B))
  const internals = (t: ClusterNode): ClusterNode[] => (t.children?.length ? [t, ...t.children.flatMap(internals)] : [])
  const nodesA = internals(A), nodesB = internals(B)
  let best = before
  for (let pass = 0; pass < maxPasses && best > 0; pass++) {
    let improved = false
    for (const [nodes] of [[nodesA], [nodesB]] as const) {
      for (const n of nodes) {
        n.children!.reverse()
        const c = tangleCrossings(leafOrder(A), leafOrder(B))
        if (c < best) { best = c; improved = true } else n.children!.reverse()
      }
    }
    if (!improved) break
  }
  return { a: A, b: B, before, after: best }
}
