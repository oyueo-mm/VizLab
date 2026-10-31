import type { Network } from './network'

/** Set and network-layout computations: intersection counts, area-proportional Euler layouts and the BioFabric ordering. */

// ─── intersections ──────────────────────────────────────────────────────────────────

export interface Intersection { /** Bit i is set when the combination includes set i. */ mask: number; sets: number[]; /** Items that belong to exactly these sets (and no other). */ count: number; degree: number; rows: number[] }

/** Exclusive intersections: every item with membership pattern `mask` is counted once, so counts add up to the number of items in at least one set. */
export function exclusiveIntersections(member: readonly (readonly boolean[])[], k: number): Intersection[] {
  const by = new Map<number, number[]>()
  member.forEach((m, row) => {
    let mask = 0
    for (let i = 0; i < k; i++) if (m[i]) mask |= 1 << i
    if (mask === 0) return
    const list = by.get(mask)
    if (list) list.push(row); else by.set(mask, [row])
  })
  return [...by].map(([mask, rows]) => {
    const sets = Array.from({ length: k }, (_, i) => i).filter((i) => (mask >> i) & 1)
    return { mask, sets, count: rows.length, degree: sets.length, rows }
  })
}

/** Items that belong to at least all the sets in `mask` (inclusive intersection). */
export function inclusiveCount(member: readonly (readonly boolean[])[], mask: number): number {
  let n = 0
  for (const m of member) {
    let ok = true
    for (let i = 0; mask >> i; i++) if ((mask >> i) & 1 && !m[i]) { ok = false; break }
    if (ok) n++
  }
  return n
}

/** Jaccard similarity of two sets from their sizes and the size of their intersection. */
export const jaccard = (a: number, b: number, ab: number) => (a + b - ab > 0 ? ab / (a + b - ab) : 0)

// ─── area-proportional (Euler) layout ───────────────────────────────────────────────

export interface Circle { x: number; y: number; r: number }

/** Area of the lens where two circles of radii r1, r2 whose centres are d apart overlap. */
export function lensArea(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2
  const a1 = Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1)), a2 = Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2))
  return r1 * r1 * (a1 - Math.sin(2 * a1) / 2) + r2 * r2 * (a2 - Math.sin(2 * a2) / 2)
}

/** Centre distance at which two circles overlap by `area` (the overlap decreases with the distance, so bisection converges). */
export function distanceForOverlap(r1: number, r2: number, area: number): number {
  const lo0 = Math.abs(r1 - r2), hi0 = r1 + r2
  if (area <= 0) return hi0
  if (area >= Math.PI * Math.min(r1, r2) ** 2) return lo0
  let lo = lo0, hi = hi0
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    if (lensArea(r1, r2, mid) > area) lo = mid; else hi = mid
  }
  return (lo + hi) / 2
}

/**
 * Circles with area proportional to the set sizes for up to three sets. Pairwise centre distances match the pairwise overlaps exactly;
 * the third circle is placed where its two distances meet (clamped to the nearest feasible triangle when they cannot all be met, in
 * which case the three-way region is only approximate). `pair[i][j]` is the size of the inclusive intersection of sets i and j.
 */
export function eulerLayout(sizes: readonly number[], pair: readonly (readonly number[])[]): Circle[] {
  const k = Math.min(3, sizes.length)
  const r = sizes.slice(0, k).map((s) => Math.sqrt(Math.max(s, 1e-9) / Math.PI))
  if (k === 1) return [{ x: 0, y: 0, r: r[0] }]
  const dAB = distanceForOverlap(r[0], r[1], pair[0][1])
  const out: Circle[] = [{ x: 0, y: 0, r: r[0] }, { x: dAB, y: 0, r: r[1] }]
  if (k === 2) return recentre(out)
  const dAC = distanceForOverlap(r[0], r[2], pair[0][2]), dBC = distanceForOverlap(r[1], r[2], pair[1][2])
  // third centre: distance dAC from A and dBC from B (law of cosines); when the triangle inequality fails put it on the line AB
  const cos = dAB > 0 ? (dAC * dAC + dAB * dAB - dBC * dBC) / (2 * dAC * dAB || 1) : 1
  const c = Math.max(-1, Math.min(1, cos))
  out.push({ x: dAC * c, y: -dAC * Math.sqrt(1 - c * c), r: r[2] })
  return recentre(out)
}

function recentre(cs: Circle[]): Circle[] {
  const x0 = Math.min(...cs.map((c) => c.x - c.r)), x1 = Math.max(...cs.map((c) => c.x + c.r))
  const y0 = Math.min(...cs.map((c) => c.y - c.r)), y1 = Math.max(...cs.map((c) => c.y + c.r))
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  return cs.map((c) => ({ ...c, x: c.x - cx, y: c.y - cy }))
}

/** Three (or fewer) equal circles in the classical Venn arrangement, with radius `r`. */
export function classicVenn(k: number, r = 1): Circle[] {
  if (k <= 1) return [{ x: 0, y: 0, r }]
  if (k === 2) return [{ x: -0.55 * r, y: 0, r }, { x: 0.55 * r, y: 0, r }]
  const d = 0.6 * r
  return [0, 1, 2].map((i) => { const a = ((-90 + i * 120) * Math.PI) / 180; return { x: d * Math.cos(a), y: d * Math.sin(a), r } })
}

export interface Region { mask: number; area: number; cx: number; cy: number }

/** Area and centroid of every region (exclusive combination of circles), by sampling a fine grid over the bounding box. */
export function regionAreas(circles: readonly Circle[], resolution = 240): Region[] {
  if (!circles.length) return []
  const x0 = Math.min(...circles.map((c) => c.x - c.r)), x1 = Math.max(...circles.map((c) => c.x + c.r))
  const y0 = Math.min(...circles.map((c) => c.y - c.r)), y1 = Math.max(...circles.map((c) => c.y + c.r))
  const step = Math.max(x1 - x0, y1 - y0) / resolution
  const acc = new Map<number, { n: number; sx: number; sy: number }>()
  for (let y = y0 + step / 2; y < y1; y += step) {
    for (let x = x0 + step / 2; x < x1; x += step) {
      let mask = 0
      for (let i = 0; i < circles.length; i++) { const c = circles[i]; if ((x - c.x) ** 2 + (y - c.y) ** 2 <= c.r * c.r) mask |= 1 << i }
      if (!mask) continue
      const a = acc.get(mask) ?? { n: 0, sx: 0, sy: 0 }
      a.n++; a.sx += x; a.sy += y
      acc.set(mask, a)
    }
  }
  return [...acc].map(([mask, a]) => ({ mask, area: a.n * step * step, cx: a.sx / a.n, cy: a.sy / a.n }))
}

// ─── BioFabric ──────────────────────────────────────────────────────────────────────

export interface Fabric { /** Node ids in row order (top to bottom). */ rows: string[]; /** Edges in column order, with the rows of their two endpoints (top row first). */ edges: { source: string; target: string; top: number; bottom: number; weight: number }[] }

/**
 * BioFabric layout (Longabaugh): every node is a horizontal line (row), every edge a vertical line (column) between its endpoints' rows.
 * Rows follow a breadth-first search from the node with the most links (ties: name), which puts neighbours next to each other; edges are
 * ordered by the row of their upper endpoint and then by the lower endpoint.
 */
export function bioFabric(net: Network, order: 'bfs' | 'degree' | 'name' = 'bfs'): Fabric {
  const nodes = net.nodes.map((n) => n.id)
  const adj = new Map<string, string[]>(nodes.map((n) => [n, []]))
  for (const l of net.links) { if (l.source === l.target) continue; adj.get(l.source)!.push(l.target); adj.get(l.target)!.push(l.source) }
  const deg = (id: string) => new Set(adj.get(id)).size
  const byDegree = [...nodes].sort((a, b) => deg(b) - deg(a) || a.localeCompare(b))
  let rows: string[]
  if (order === 'name') rows = [...nodes].sort((a, b) => a.localeCompare(b))
  else if (order === 'degree') rows = byDegree
  else {
    const seen = new Set<string>()
    rows = []
    for (const start of byDegree) {
      if (seen.has(start)) continue
      const queue = [start]
      seen.add(start)
      while (queue.length) {
        const v = queue.shift()!
        rows.push(v)
        const next = [...new Set(adj.get(v))].filter((u) => !seen.has(u)).sort((a, b) => deg(b) - deg(a) || a.localeCompare(b))
        for (const u of next) { seen.add(u); queue.push(u) }
      }
    }
  }
  const at = new Map(rows.map((id, i) => [id, i]))
  const edges = net.links.filter((l) => l.source !== l.target).map((l) => {
    const a = at.get(l.source)!, b = at.get(l.target)!
    return { source: a <= b ? l.source : l.target, target: a <= b ? l.target : l.source, top: Math.min(a, b), bottom: Math.max(a, b), weight: l.weight }
  }).sort((p, q) => p.top - q.top || p.bottom - q.bottom)
  return { rows, edges }
}
