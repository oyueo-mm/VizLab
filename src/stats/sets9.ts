import { createRng } from '../lib/random'

export type Pt = [number, number]

// ───────────────────────────── MetroSets ─────────────────────────────

export interface MetroOpts {
  /** Weight of an edge that another line already uses (smaller = lines are pulled onto common edges). */
  share: number
  /** Grid spacing used for the schematic (octilinear) layout. */
  seed: number
}

export interface MetroSegment { a: number; b: number; pts: Pt[] }
export interface MetroLayout {
  /** Station position (integer grid coordinates) per item; items in no set are `null`. */
  pos: (Pt | null)[]
  /** Station order of every line (set). */
  lines: number[][]
  /** Support-graph edges (unordered station pair) with the lines that use them. */
  edges: { a: number; b: number; lines: number[]; pts: Pt[] }[]
  /** Stations that lie on two or more lines. */
  transfers: number[]
  stats: { sharedEdges: number; bends: number; crossings: number; length: number; cols: number; rows: number }
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** Spring layout of items so that items with similar set signatures end up close together. */
function similarityLayout(member: boolean[][], items: number[], seed: number): Pt[] {
  const r = createRng(seed)
  const sig = items.map((i) => member.map((m) => (m[i] ? 1 : 0)))
  const sim = (a: number, b: number) => {
    let both = 0, any = 0
    for (let s = 0; s < member.length; s++) { if (sig[a][s] && sig[b][s]) both++; if (sig[a][s] || sig[b][s]) any++ }
    return any ? both / any : 0
  }
  const p: Pt[] = items.map(() => [r() * 10, r() * 10])
  for (let it = 0; it < 260; it++) {
    const cool = 1 - it / 260
    for (let a = 0; a < items.length; a++) {
      let fx = 0, fy = 0
      for (let b = 0; b < items.length; b++) {
        if (a === b) continue
        const dx = p[b][0] - p[a][0], dy = p[b][1] - p[a][1]
        const d = Math.max(0.05, Math.hypot(dx, dy))
        const want = 1.4 + 3.2 * (1 - sim(a, b))
        const f = (d - want) * 0.06 + (d < 1 ? -0.4 : 0)
        fx += (dx / d) * f; fy += (dy / d) * f
      }
      const step = (cool * 12) / Math.max(12, items.length); p[a][0] += fx * step; p[a][1] += fy * step
    }
  }
  return p
}

/** Shortest open path through `ids` where already-used edges are cheaper (greedy nearest neighbour + 2-opt). */
function supportPath(ids: number[], p: (i: number) => Pt, used: Set<string>, share: number): number[] {
  if (ids.length <= 2) return [...ids]
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`)
  const cost = (a: number, b: number) => dist(p(a), p(b)) * (used.has(key(a, b)) ? share : 1)
  let best: number[] = [], bestLen = Infinity
  const starts = ids.length > 10 ? ids.filter((_, k) => k % Math.ceil(ids.length / 10) === 0) : ids
  for (const s of starts) {
    const left = new Set(ids); left.delete(s)
    const path = [s]
    while (left.size) {
      const last = path[path.length - 1]
      let n = -1, nd = Infinity
      for (const c of left) { const d = cost(last, c); if (d < nd) { nd = d; n = c } }
      path.push(n); left.delete(n)
    }
    let improved = true
    while (improved) {
      improved = false
      for (let i = 0; i < path.length - 1; i++) for (let j = i + 1; j < path.length; j++) {
        const before = (i > 0 ? cost(path[i - 1], path[i]) : 0) + (j < path.length - 1 ? cost(path[j], path[j + 1]) : 0)
        const after = (i > 0 ? cost(path[i - 1], path[j]) : 0) + (j < path.length - 1 ? cost(path[i], path[j + 1]) : 0)
        if (after + 1e-9 < before) { path.splice(i, j - i + 1, ...path.slice(i, j + 1).reverse()); improved = true }
      }
    }
    let len = 0
    for (let k = 0; k < path.length - 1; k++) len += cost(path[k], path[k + 1])
    if (len < bestLen) { bestLen = len; best = path }
  }
  return best
}

/** Octilinear route between two grid points: one diagonal run and one straight run (at most one bend). */
export function octilinearRoute(a: Pt, b: Pt, diagFirst: boolean): Pt[] {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const m = Math.min(Math.abs(dx), Math.abs(dy))
  if (m === 0 || Math.abs(dx) === Math.abs(dy)) return [a, b]
  const diag: Pt = [a[0] + Math.sign(dx) * m, a[1] + Math.sign(dy) * m]
  const rest: Pt = [b[0] - Math.sign(dx) * m, b[1] - Math.sign(dy) * m]
  return diagFirst ? [a, diag, b] : [a, rest, b]
}

function segCross(p: Pt, q: Pt, r: Pt, s: Pt): boolean {
  const o = (a: Pt, b: Pt, c: Pt) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
  const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1]
  if (same(p, r) || same(p, s) || same(q, r) || same(q, s)) return false
  return o(p, q, r) * o(p, q, s) < 0 && o(r, s, p) * o(r, s, q) < 0
}

export function metroSets(member: boolean[][], nItems: number, opts: MetroOpts): MetroLayout {
  const inAny = Array.from({ length: nItems }, (_, i) => member.some((m) => m[i]))
  const items = [...Array(nItems).keys()].filter((i) => inAny[i])
  const pos: (Pt | null)[] = Array(nItems).fill(null)
  if (!items.length) return { pos, lines: member.map(() => []), edges: [], transfers: [], stats: { sharedEdges: 0, bends: 0, crossings: 0, length: 0, cols: 0, rows: 0 } }
  const sp = similarityLayout(member, items, opts.seed)
  const local = new Map(items.map((it, k) => [it, k]))
  const P = (i: number): Pt => sp[local.get(i)!]
  // 1. support graph: a path per set, preferring edges that other sets already use (largest sets first so that small ones can reuse their edges)
  const order = member.map((_, s) => s).sort((a, b) => member[b].filter(Boolean).length - member[a].filter(Boolean).length)
  const used = new Set<string>()
  const lines: number[][] = member.map(() => [])
  for (const s of order) {
    const ids = items.filter((i) => member[s][i])
    const path = supportPath(ids, P, used, opts.share)
    lines[s] = path
    for (let k = 0; k < path.length - 1; k++) used.add(path[k] < path[k + 1] ? `${path[k]}-${path[k + 1]}` : `${path[k + 1]}-${path[k]}`)
  }
  // 2. schematic layout: scale to a coarse grid, snap, and resolve collisions with the nearest free node
  const xs = sp.map((p) => p[0]), ys = sp.map((p) => p[1])
  const x0 = Math.min(...xs), y0 = Math.min(...ys)
  const span = Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0, 1)
  const cells = Math.max(6, Math.ceil(Math.sqrt(items.length) * 2.6))
  const taken = new Set<string>()
  const place = (g: Pt): Pt => {
    for (let rad = 0; rad < cells; rad++) for (let dx = -rad; dx <= rad; dx++) for (let dy = -rad; dy <= rad; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue
      const c: Pt = [g[0] + dx, g[1] + dy]
      if (c[0] < 0 || c[1] < 0 || taken.has(c.join())) continue
      taken.add(c.join()); return c
    }
    return g
  }
  const byDegree = [...items].sort((a, b) => member.filter((m) => m[b]).length - member.filter((m) => m[a]).length)
  for (const i of byDegree) pos[i] = place([Math.round(((P(i)[0] - x0) / span) * cells), Math.round(((P(i)[1] - y0) / span) * cells)])
  // 3. edges with octilinear routes; the bend side is chosen to avoid crossing already-routed edges
  const edges: MetroLayout['edges'] = []
  const edgeKey = new Map<string, number>()
  lines.forEach((path, s) => {
    for (let k = 0; k < path.length - 1; k++) {
      const a = path[k], b = path[k + 1]
      const key = a < b ? `${a}-${b}` : `${b}-${a}`
      const found = edgeKey.get(key)
      if (found != null) { edges[found].lines.push(s); continue }
      const lo = Math.min(a, b), hi = Math.max(a, b)
      const cross = (pts: Pt[]) => {
        let n = 0
        for (const e of edges) for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < e.pts.length - 1; j++) if (segCross(pts[i], pts[i + 1], e.pts[j], e.pts[j + 1])) n++
        return n
      }
      const r1 = octilinearRoute(pos[lo]!, pos[hi]!, true), r2 = octilinearRoute(pos[lo]!, pos[hi]!, false)
      edgeKey.set(key, edges.length)
      edges.push({ a: lo, b: hi, lines: [s], pts: cross(r1) <= cross(r2) ? r1 : r2 })
    }
  })
  let crossings = 0, bends = 0, length = 0
  for (let i = 0; i < edges.length; i++) {
    bends += edges[i].pts.length - 2
    for (let k = 0; k < edges[i].pts.length - 1; k++) length += dist(edges[i].pts[k], edges[i].pts[k + 1])
    for (let j = i + 1; j < edges.length; j++) for (let a = 0; a < edges[i].pts.length - 1; a++) for (let b = 0; b < edges[j].pts.length - 1; b++) if (segCross(edges[i].pts[a], edges[i].pts[a + 1], edges[j].pts[b], edges[j].pts[b + 1])) crossings++
  }
  const placed = items.map((i) => pos[i]!)
  return {
    pos, lines, edges,
    transfers: items.filter((i) => member.filter((m) => m[i]).length >= 2),
    stats: { sharedEdges: edges.filter((e) => e.lines.length > 1).length, bends, crossings, length, cols: Math.max(...placed.map((p) => p[0])) + 1, rows: Math.max(...placed.map((p) => p[1])) + 1 },
  }
}

/** Direction of a polyline segment in multiples of 45° (0..7), or -1 when it is not octilinear. */
export function octDirection(a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  if (dx === 0 && dy === 0) return -1
  if (dx !== 0 && dy !== 0 && Math.abs(dx) !== Math.abs(dy)) return -1
  return ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8
}

// ───────────────────────────── MosaicSets ─────────────────────────────

export type GridKind = 'square' | 'hex'
export interface MosaicLayout {
  kind: GridKind
  cols: number
  rows: number
  /** Cell index of every item. */
  cellOf: number[]
  /** Item in every cell or -1. */
  itemAt: number[]
  /** Number of connected components of each set (1 = contiguous, 0 = empty). */
  components: number[]
  cost: number
  initialCost: number
}

export function gridNeighbours(kind: GridKind, cols: number, rows: number, c: number): number[] {
  const x = c % cols, y = Math.floor(c / cols)
  const d: Pt[] = kind === 'square' ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : (y % 2 === 0 ? [[1, 0], [-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]] : [[1, 0], [-1, 0], [1, -1], [0, -1], [1, 1], [0, 1]])
  const out: number[] = []
  for (const [dx, dy] of d) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) out.push(ny * cols + nx) }
  return out
}

function countComponents(cells: number[], nb: (c: number) => number[]): number {
  const set = new Set(cells), seen = new Set<number>()
  let n = 0
  for (const c of cells) {
    if (seen.has(c)) continue
    n++
    const st = [c]; seen.add(c)
    while (st.length) for (const m of nb(st.pop()!)) if (set.has(m) && !seen.has(m)) { seen.add(m); st.push(m) }
  }
  return n
}

/**
 * Embeds the items into distinct grid cells so that every set tends to form one connected region. The original paper solves
 * this exactly by integer linear programming; this is simulated annealing on the number of connected components plus a perimeter term.
 */
export function mosaicSets(member: boolean[][], nItems: number, kind: GridKind, seed: number, iterations = 6000, spare = 0.35): MosaicLayout {
  const total = Math.max(nItems, 1)
  const cols = Math.max(2, Math.ceil(Math.sqrt(total * (1 + spare)))), rows = Math.max(2, Math.ceil((total * (1 + spare)) / cols))
  const nb = (() => { const cache = new Map<number, number[]>(); return (c: number) => cache.get(c) ?? (cache.set(c, gridNeighbours(kind, cols, rows, c)), cache.get(c)!) })()
  const r = createRng(seed)
  // start: items sorted by set signature fill the grid in a snake order, which already puts similar items together
  const sigOf = (i: number) => member.map((m) => (m[i] ? '1' : '0')).join('')
  const order = [...Array(nItems).keys()].sort((a, b) => (sigOf(a) < sigOf(b) ? -1 : sigOf(a) > sigOf(b) ? 1 : a - b))
  const cellOf: number[] = Array(nItems).fill(-1), itemAt: number[] = Array(cols * rows).fill(-1)
  order.forEach((it, k) => { const y = Math.floor(k / cols), x = y % 2 === 0 ? k % cols : cols - 1 - (k % cols); cellOf[it] = y * cols + x; itemAt[y * cols + x] = it })
  const setCells = (s: number) => { const out: number[] = []; for (let i = 0; i < nItems; i++) if (member[s][i]) out.push(cellOf[i]); return out }
  const perim = (cells: number[]) => { const set = new Set(cells); let p = 0; for (const c of cells) for (const m of nb(c)) if (!set.has(m)) p++; return p }
  const setCost = (s: number) => { const c = setCells(s); if (!c.length) return 0; return (countComponents(c, nb) - 1) * 12 + perim(c) * 0.25 }
  const costs = member.map((_, s) => setCost(s))
  const total0 = () => costs.reduce((a, b) => a + b, 0)
  const initialCost = total0()
  let cur = initialCost
  for (let it = 0; it < iterations; it++) {
    const T = 3 * (1 - it / iterations) + 0.02
    const i = Math.floor(r() * nItems)
    const target = Math.floor(r() * cols * rows)
    const from = cellOf[i], other = itemAt[target]
    if (target === from) continue
    const touched = member.map((_, s) => s).filter((s) => member[s][i] || (other >= 0 && member[s][other]))
    const before = touched.reduce((a, s) => a + costs[s], 0)
    // swap
    cellOf[i] = target; itemAt[target] = i
    if (other >= 0) { cellOf[other] = from; itemAt[from] = other } else itemAt[from] = -1
    const after = touched.map((s) => setCost(s))
    const delta = after.reduce((a, b) => a + b, 0) - before
    if (delta <= 0 || r() < Math.exp(-delta / T)) { touched.forEach((s, k) => { costs[s] = after[k] }); cur += delta } else {
      cellOf[i] = from; itemAt[from] = i
      if (other >= 0) { cellOf[other] = target; itemAt[target] = other } else itemAt[target] = -1
    }
  }
  return { kind, cols, rows, cellOf, itemAt, components: member.map((_, s) => countComponents(setCells(s), nb)), cost: cur, initialCost }
}

// ───────────────────────────── InfoCrystal ─────────────────────────────

export interface CrystalIcon {
  /** Criteria bitmask satisfied (and only these). */
  mask: number
  /** Number of criteria combined (the icon's degree). */
  degree: number
  /** Position inside the unit circle. */
  x: number
  y: number
  /** Documents that satisfy exactly this combination. */
  count: number
  docs: number[]
}

/**
 * InfoCrystal layout: one icon for every non-empty combination of criteria, placed in the direction of the criteria it combines;
 * the more criteria an icon combines the nearer it sits to the centre.
 */
export function infoCrystal(match: boolean[][], nDocs: number): { icons: CrystalIcon[]; corners: Pt[]; outside: number[] } {
  const k = match.length
  const corners: Pt[] = match.map((_, i) => [Math.cos(-Math.PI / 2 + (2 * Math.PI * i) / k), Math.sin(-Math.PI / 2 + (2 * Math.PI * i) / k)])
  const groups = new Map<number, number[]>()
  const outside: number[] = []
  for (let d = 0; d < nDocs; d++) {
    let mask = 0
    for (let c = 0; c < k; c++) if (match[c][d]) mask |= 1 << c
    if (!mask) { outside.push(d); continue }
    groups.set(mask, [...(groups.get(mask) ?? []), d])
  }
  const icons: CrystalIcon[] = []
  const sameDir = new Map<string, number>()
  for (let mask = 1; mask < 1 << k; mask++) {
    const members = [...Array(k).keys()].filter((c) => mask & (1 << c))
    const degree = members.length
    let mx = 0, my = 0
    for (const c of members) { mx += corners[c][0]; my += corners[c][1] }
    mx /= degree; my /= degree
    const len = Math.hypot(mx, my)
    let ang: number
    if (len < 1e-6) { // opposite criteria cancel: spread such icons around the centre ring so they do not coincide
      const key = String(degree); const n = sameDir.get(key) ?? 0; sameDir.set(key, n + 1)
      ang = Math.PI / 8 + (n * Math.PI) / 2
    } else ang = Math.atan2(my, mx)
    const radius = degree === k ? 0 : (1 - (degree - 1) / k) * (k <= 2 ? 1 : 0.95)
    const docs = groups.get(mask) ?? []
    icons.push({ mask, degree, x: Math.cos(ang) * radius, y: Math.sin(ang) * radius, count: docs.length, docs })
  }
  return { icons, corners, outside }
}

/** Documents selected by a set of icons (their union) – the Boolean query the user built by clicking icons. */
export const crystalResult = (icons: CrystalIcon[], masks: ReadonlySet<number>): number[] => icons.filter((i) => masks.has(i.mask)).flatMap((i) => i.docs).sort((a, b) => a - b)

export function crystalPreset(k: number, kind: 'and' | 'or' | 'one' | 'multi'): Set<number> {
  const out = new Set<number>()
  for (let mask = 1; mask < 1 << k; mask++) {
    const deg = mask.toString(2).split('1').length - 1
    if (kind === 'and' && deg === k) out.add(mask)
    if (kind === 'or') out.add(mask)
    if (kind === 'one' && deg === 1) out.add(mask)
    if (kind === 'multi' && deg >= 2) out.add(mask)
  }
  return out
}

// ───────────────────────────── SetNet ─────────────────────────────

export interface SetNetModel {
  /** circle centre and radius of every set in the unit square */
  centers: Pt[]
  radii: number[]
  /** node positions in the unit square */
  pos: Pt[]
  /** set bitmask of every node */
  mask: number[]
  /** nodes that could not be placed in the zone their sets ask for (the zone is empty) */
  violations: number
  edges: [number, number][]
}

const inCircle = (p: Pt, c: Pt, r: number) => Math.hypot(p[0] - c[0], p[1] - c[1]) <= r

/**
 * Combined set and network layout in the spirit of SetNet: the sets are laid out first as Euler-style circles (sets that share nodes or are
 * joined by many edges are drawn overlapping), then every node is placed inside the zone of exactly its own sets while a force layout keeps
 * the connected nodes close. Nodes are projected back into their zone after every step.
 */
export function setNet(member: boolean[][], nNodes: number, edges: readonly [number, number][], seed: number): SetNetModel {
  const k = member.length
  const r = createRng(seed)
  const size = member.map((m) => m.filter(Boolean).length)
  const maxSize = Math.max(1, ...size)
  const radii = size.map((s) => (k >= 4 ? 0.23 : 0.28) * Math.sqrt(Math.max(1, s) / maxSize))
  const shared = (a: number, b: number) => { let c = 0; for (let i = 0; i < nNodes; i++) if (member[a][i] && member[b][i]) c++; return c }
  const between = (a: number, b: number) => edges.filter(([u, v]) => (member[a][u] && member[b][v]) || (member[a][v] && member[b][u])).length
  const centers: Pt[] = member.map((_, i) => [0.5 + 0.18 * Math.cos((2 * Math.PI * i) / k) + (r() - 0.5) * 0.02, 0.5 + 0.18 * Math.sin((2 * Math.PI * i) / k) + (r() - 0.5) * 0.02])
  for (let it = 0; it < 400; it++) for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) {
    const sh = shared(a, b)
    const want = sh > 0
      ? (radii[a] + radii[b]) * (0.9 - 0.35 * Math.min(1, sh / Math.max(1, Math.min(size[a], size[b])) + (0.15 * between(a, b)) / Math.max(1, edges.length)))
      : (radii[a] + radii[b]) * 1.12
    const dx = centers[b][0] - centers[a][0], dy = centers[b][1] - centers[a][1]
    const d = Math.max(1e-6, Math.hypot(dx, dy))
    const f = ((d - want) / d) * 0.08
    centers[a][0] += dx * f; centers[a][1] += dy * f; centers[b][0] -= dx * f; centers[b][1] -= dy * f
  }
  // fit everything into the unit square with a margin
  const lo: Pt = [Math.min(...centers.map((c, i) => c[0] - radii[i])), Math.min(...centers.map((c, i) => c[1] - radii[i]))]
  const hi: Pt = [Math.max(...centers.map((c, i) => c[0] + radii[i])), Math.max(...centers.map((c, i) => c[1] + radii[i]))]
  const sc = 0.92 / Math.max(hi[0] - lo[0], hi[1] - lo[1])
  const mid: Pt = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2]
  const fc = centers.map((c) => [0.5 + (c[0] - mid[0]) * sc, 0.5 + (c[1] - mid[1]) * sc] as Pt)
  const fr = radii.map((x) => x * sc)
  const maskOf = (p: Pt) => fc.reduce((m, c, i) => m | (inCircle(p, c, fr[i]) ? 1 << i : 0), 0)
  const mask = Array.from({ length: nNodes }, (_, i) => member.reduce((m, s, si) => m | (s[i] ? 1 << si : 0), 0))
  // sample every zone on a grid
  const G = 70
  const zone = new Map<number, Pt[]>()
  for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) { const p: Pt = [(gx + 0.5) / G, (gy + 0.5) / G]; const m = maskOf(p); zone.set(m, [...(zone.get(m) ?? []), p]) }
  const nearestIn = (p: Pt, pts: Pt[]) => { let best = pts[0], bd = Infinity; for (const q of pts) { const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; if (d < bd) { bd = d; best = q } } return best }
  const feasible = (m: number) => (zone.get(m)?.length ?? 0) > 0
  const popcount = (v: number) => v.toString(2).split('1').length - 1
  // a node whose zone is empty goes to the sampled zone that disagrees with its sets in the fewest circles
  const targetZone = (m: number) => { if (feasible(m)) return m; let best = -1, bd = Infinity; for (const z of zone.keys()) { const d = popcount(z ^ m); if (d < bd) { bd = d; best = z } } return best }
  const want = mask.map(targetZone)
  const pos: Pt[] = want.map((z) => { const pts = zone.get(z)!; return pts[Math.floor(r() * pts.length)] })
  const violations = mask.filter((m) => !feasible(m)).length
  for (let it = 0; it < 220; it++) {
    const cool = 1 - it / 220
    const force: Pt[] = pos.map(() => [0, 0])
    for (let a = 0; a < nNodes; a++) for (let b = a + 1; b < nNodes; b++) {
      const dx = pos[b][0] - pos[a][0], dy = pos[b][1] - pos[a][1], d = Math.max(1e-4, Math.hypot(dx, dy))
      if (d < 0.085) { const f = (0.085 - d) * 0.6; force[a][0] -= (dx / d) * f; force[a][1] -= (dy / d) * f; force[b][0] += (dx / d) * f; force[b][1] += (dy / d) * f }
    }
    for (const [a, b] of edges) {
      const dx = pos[b][0] - pos[a][0], dy = pos[b][1] - pos[a][1], d = Math.max(1e-4, Math.hypot(dx, dy))
      const f = (d - 0.12) * 0.1
      force[a][0] += (dx / d) * f; force[a][1] += (dy / d) * f; force[b][0] -= (dx / d) * f; force[b][1] -= (dy / d) * f
    }
    for (let i = 0; i < nNodes; i++) {
      const q: Pt = [pos[i][0] + force[i][0] * cool, pos[i][1] + force[i][1] * cool]
      pos[i] = maskOf(q) === want[i] ? q : nearestIn(q, zone.get(want[i])!)
    }
  }
  return { centers: fc, radii: fr, pos, mask, violations, edges: edges.map(([a, b]) => [a, b] as [number, number]) }
}

/** The set bitmask a point lies in for a given layout. */
export const setNetMaskAt = (m: Pick<SetNetModel, 'centers' | 'radii'>, p: Pt) => m.centers.reduce((acc, c, i) => acc | (inCircle(p, c, m.radii[i]) ? 1 << i : 0), 0)

