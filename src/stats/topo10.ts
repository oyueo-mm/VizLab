import { createRng } from '../lib/random'

export interface Grid2 { nx: number; ny: number; v: Float64Array }

export const idx2 = (g: Grid2, i: number, j: number) => j * g.nx + i

/** Neighbours in the triangulation of the grid (4 axis neighbours + one diagonal), the usual choice for contour trees of 2-D grids. */
export function neighbours(g: Grid2, k: number): number[] {
  const i = k % g.nx, j = Math.floor(k / g.nx)
  const out: number[] = []
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]] as const) {
    const a = i + di, b = j + dj
    if (a >= 0 && b >= 0 && a < g.nx && b < g.ny) out.push(b * g.nx + a)
  }
  return out
}

/** Vertex order by (value, index): ties are broken by index so that all values are distinct (simulation of simplicity). */
export function sortedVertices(g: Grid2): number[] {
  return [...Array(g.nx * g.ny).keys()].sort((a, b) => g.v[a] - g.v[b] || a - b)
}

const find = (p: Int32Array, x: number): number => { while (p[x] !== x) { p[x] = p[p[x]]; x = p[x] }; return x }

// ───────────────────────────── join / split trees and persistence ─────────────────────────────

export interface MergeTree {
  /** parent[v]: the next vertex of the tree below v (join tree: next lower; split tree: next higher), −1 for the root */
  parent: Int32Array
  /** children count of every vertex */
  kids: Int32Array
}

/**
 * Augmented merge tree by a sweep (Carr et al.): join tree sweeps from the highest vertex down (components of superlevel sets), split tree from the
 * lowest up. Every vertex is a node; a vertex gets one child arc for every component it joins.
 */
export function mergeTree(g: Grid2, kind: 'join' | 'split'): MergeTree {
  const n = g.nx * g.ny
  const asc = sortedVertices(g)
  const order = kind === 'join' ? [...asc].reverse() : asc
  const done = new Uint8Array(n)
  const uf = new Int32Array(n).map((_, i) => i)
  const tip = new Int32Array(n).fill(-1) // the most recently added vertex of every component
  const parent = new Int32Array(n).fill(-1), kids = new Int32Array(n)
  for (const v of order) {
    for (const u of neighbours(g, v)) {
      if (!done[u]) continue
      const r = find(uf, u)
      if (find(uf, v) === r) continue
      const t = tip[r]
      parent[t] = v; kids[v]++
      uf[r] = v // v is the root of its own set: the component of u now hangs below v
    }
    done[v] = 1
    tip[find(uf, v)] = v
  }
  return { parent, kids }
}

export interface PersistencePair { birth: number; death: number; /** vertex of the extremum that is born */ extremum: number; /** vertex of the saddle where it dies (−1 for the essential component) */ saddle: number; kind: 'max' | 'min' }

/** 0-dimensional persistence of the superlevel (maxima) and sublevel (minima) sets with the elder rule. */
export function persistence(g: Grid2): PersistencePair[] {
  const out: PersistencePair[] = []
  const n = g.nx * g.ny
  const asc = sortedVertices(g)
  for (const kind of ['max', 'min'] as const) {
    const order = kind === 'max' ? [...asc].reverse() : asc
    const done = new Uint8Array(n)
    const uf = new Int32Array(n).map((_, i) => i)
    const born = new Int32Array(n).fill(-1) // extremum of every component root
    for (const v of order) {
      const roots = new Set<number>()
      for (const u of neighbours(g, v)) if (done[u]) roots.add(find(uf, u))
      done[v] = 1
      if (!roots.size) { born[v] = v; continue }
      const rs = [...roots]
      // the component with the more extreme extremum survives
      rs.sort((a, b) => (kind === 'max' ? g.v[born[b]] - g.v[born[a]] || born[a] - born[b] : g.v[born[a]] - g.v[born[b]] || born[a] - born[b]))
      const keep = rs[0]
      for (const r of rs.slice(1)) {
        out.push({ birth: g.v[born[r]], death: g.v[v], extremum: born[r], saddle: v, kind })
        uf[r] = keep
      }
      uf[v] = keep
    }
    const root = find(uf, order[0])
    out.push({ birth: g.v[born[root]], death: kind === 'max' ? g.v[asc[0]] : g.v[asc[n - 1]], extremum: born[root], saddle: -1, kind })
  }
  return out
}

// ───────────────────────────── contour tree ─────────────────────────────

export interface ContourArc { from: number; to: number }
export interface ContourTree {
  /** critical vertices (extrema and saddles) */
  nodes: { v: number; type: 'max' | 'min' | 'saddle' }[]
  /** arcs between critical vertices; `path` holds the vertices of the augmented tree along the arc */
  arcs: { a: number; b: number; path: number[] }[]
}

/**
 * Contour tree by the merge of the join and the split tree (Carr, Snoeyink, Axen): repeatedly peel a leaf that is a leaf of one tree and an
 * ordinary (degree-2) vertex of the other, and record its arc. The result is reduced to the critical vertices.
 */
export function contourTree(g: Grid2): ContourTree {
  const n = g.nx * g.ny
  const jt = mergeTree(g, 'join'), st = mergeTree(g, 'split')
  // adjacency of both trees as sets: jDown/jUp (join: down = parent), sDown (children) / sUp (parent)
  const jUp: Set<number>[] = Array.from({ length: n }, () => new Set()), sDown: Set<number>[] = Array.from({ length: n }, () => new Set())
  const jParent = Int32Array.from(jt.parent), sParent = Int32Array.from(st.parent)
  for (let v = 0; v < n; v++) { if (jParent[v] >= 0) jUp[jParent[v]].add(v); if (sParent[v] >= 0) sDown[sParent[v]].add(v) }
  const alive = new Uint8Array(n).fill(1)
  const arcs: [number, number][] = []
  const queue: number[] = []
  const jDeg = (v: number) => jUp[v].size + (jParent[v] >= 0 ? 1 : 0)
  const sDeg = (v: number) => sDown[v].size + (sParent[v] >= 0 ? 1 : 0)
  for (let v = 0; v < n; v++) if (jDeg(v) <= 1 || sDeg(v) <= 1) queue.push(v)
  let remaining = n
  let guard = 0
  while (queue.length && remaining > 2 && guard++ < 20 * n + 100) {
    const v = queue.shift()!
    if (!alive[v]) continue
    // v is an upper leaf of the contour tree when no component lies above it (no join-tree child) and exactly one below it (one split-tree child)
    const upperLeaf = jUp[v].size === 0 && jParent[v] >= 0 && sDown[v].size === 1
    const lowerLeaf = sDown[v].size === 0 && sParent[v] >= 0 && jUp[v].size === 1
    if (upperLeaf) {
      arcs.push([v, jParent[v]])
      const p = jParent[v]; jUp[p].delete(v)
      const c = [...sDown[v]][0], q = sParent[v]
      if (q >= 0) { sDown[q].delete(v); sDown[q].add(c) }
      sParent[c] = q
      alive[v] = 0; remaining--
      queue.push(p, c)
      if (q >= 0) queue.push(q)
    } else if (lowerLeaf) {
      arcs.push([v, sParent[v]])
      const p = sParent[v]; sDown[p].delete(v)
      const c = [...jUp[v]][0], q = jParent[v]
      if (q >= 0) { jUp[q].delete(v); jUp[q].add(c) }
      jParent[c] = q
      alive[v] = 0; remaining--
      queue.push(p, c)
      if (q >= 0) queue.push(q)
    }
  }
  if (remaining === 2) { const [a, b] = [...Array(n).keys()].filter((v) => alive[v]); arcs.push([a, b]) }
  // reduce: contract the vertices of degree 2 in the (augmented) contour tree
  const adj: Map<number, number[]> = new Map()
  for (const [a, b] of arcs) { adj.set(a, [...(adj.get(a) ?? []), b]); adj.set(b, [...(adj.get(b) ?? []), a]) }
  const crit = [...adj.keys()].filter((v) => adj.get(v)!.length !== 2)
  const nodes = crit.map((v) => {
    const deg = adj.get(v)!.length
    const up = adj.get(v)!.filter((u) => g.v[u] > g.v[v] || (g.v[u] === g.v[v] && u > v)).length
    return { v, type: (deg === 1 ? (up === 0 ? 'max' : 'min') : 'saddle') as 'max' | 'min' | 'saddle' }
  })
  const critSet = new Set(crit)
  const out: ContourTree['arcs'] = []
  const walked = new Set<string>() // directed edges (from → to) already followed, including the reverse of every finished arc
  for (const s of crit) for (const first of adj.get(s)!) {
    if (walked.has(`${s}>${first}`)) continue
    let prev = s, cur = first
    const path = [s]
    while (!critSet.has(cur)) { path.push(cur); const nx = adj.get(cur)!.find((u) => u !== prev)!; prev = cur; cur = nx }
    path.push(cur)
    walked.add(`${s}>${first}`); walked.add(`${cur}>${prev}`)
    out.push({ a: s, b: cur, path })
  }
  return { nodes, arcs: out }
}

/** Leaf pruning by persistence: removes the leaf arcs whose value range is below `threshold` (repeatedly, smallest first). */
export function simplifyContourTree(t: ContourTree, g: Grid2, threshold: number): ContourTree {
  let arcs = t.arcs.map((a) => ({ ...a }))
  for (;;) {
    const deg = new Map<number, number>()
    for (const a of arcs) { deg.set(a.a, (deg.get(a.a) ?? 0) + 1); deg.set(a.b, (deg.get(a.b) ?? 0) + 1) }
    let best = -1, bp = Infinity
    arcs.forEach((a, i) => {
      const leaf = deg.get(a.a) === 1 ? a.a : deg.get(a.b) === 1 ? a.b : -1
      if (leaf < 0 || arcs.length < 2) return
      const p = Math.abs(g.v[a.a] - g.v[a.b])
      if (p < threshold && p < bp) { bp = p; best = i }
    })
    if (best < 0) break
    const rem = arcs[best]
    arcs = arcs.filter((_, i) => i !== best)
    // contract the saddle that became an ordinary vertex
    const mid = deg.get(rem.a) === 1 ? rem.b : rem.a
    const touching = arcs.filter((a) => a.a === mid || a.b === mid)
    if (touching.length === 2) {
      const [x, y] = touching
      const xo = x.a === mid ? x.b : x.a, yo = y.a === mid ? y.b : y.a
      const px = x.a === mid ? [...x.path].reverse() : x.path, py = y.a === mid ? y.path : [...y.path].reverse()
      arcs = arcs.filter((a) => a !== x && a !== y)
      arcs.push({ a: xo, b: yo, path: [...px, ...py.slice(1)] })
    }
  }
  const deg = new Map<number, number>()
  for (const a of arcs) { deg.set(a.a, (deg.get(a.a) ?? 0) + 1); deg.set(a.b, (deg.get(a.b) ?? 0) + 1) }
  const nodes = [...deg.keys()].map((v) => {
    if (deg.get(v) !== 1) return { v, type: 'saddle' as const }
    const a = arcs.find((x) => x.a === v || x.b === v)!
    const o = a.a === v ? a.b : a.a
    return { v, type: (g.v[v] > g.v[o] || (g.v[v] === g.v[o] && v > o) ? 'max' : 'min') as 'max' | 'min' }
  })
  return { nodes, arcs }
}

// ───────────────────────────── probabilistic isocontours ─────────────────────────────

/** Probability that the isocontour of level `level` passes through each cell of a grid whose vertices have independent Gaussian noise (Monte Carlo). */
export function crossingProbability(mean: Grid2, sigma: Float64Array, level: number, samples: number, seed: number): Float64Array {
  const r = createRng(seed)
  const cells = (mean.nx - 1) * (mean.ny - 1)
  const count = new Float64Array(cells)
  const s = new Float64Array(mean.nx * mean.ny)
  for (let k = 0; k < samples; k++) {
    for (let i = 0; i < s.length; i++) s[i] = mean.v[i] + sigma[i] * r.normal()
    for (let j = 0; j < mean.ny - 1; j++) for (let i = 0; i < mean.nx - 1; i++) {
      const a = s[j * mean.nx + i] >= level, b = s[j * mean.nx + i + 1] >= level, c = s[(j + 1) * mean.nx + i] >= level, d = s[(j + 1) * mean.nx + i + 1] >= level
      if (!(a === b && b === c && c === d)) count[j * (mean.nx - 1) + i]++
    }
  }
  return count.map((c) => c / samples)
}

// ───────────────────────────── topological landscape (simplified) ─────────────────────────────

export interface Hill { max: number; /** vertices owned by the hill */ volume: number; /** height of the peak above the saddle where it merges into a higher hill */ rise: number; saddleValue: number; /** parent hill (the one it merges into), −1 for the highest */ parent: number; cx: number; cy: number; r: number }

/**
 * Terrain whose peaks are the maxima of the field: every maximum becomes a hill with a footprint proportional to the vertices it owns, a height equal to
 * its persistence, placed on the slope of the hill it merges into. The resulting height field has the same peaks and saddle heights as the data
 * in this simplified model (a bump profile, not the exact terrain of Weber et al.).
 */
export function landscapeHills(g: Grid2): Hill[] {
  const n = g.nx * g.ny
  const asc = sortedVertices(g), order = [...asc].reverse()
  const done = new Uint8Array(n)
  const uf = new Int32Array(n).map((_, i) => i)
  const born = new Int32Array(n).fill(-1)
  const owned = new Int32Array(n)
  const hills: Hill[] = []
  const hillOf = new Map<number, number>()
  for (const v of order) {
    const roots = new Set<number>()
    for (const u of neighbours(g, v)) if (done[u]) roots.add(find(uf, u))
    done[v] = 1
    if (!roots.size) { born[v] = v; hillOf.set(v, hills.length); hills.push({ max: v, volume: 0, rise: 0, saddleValue: g.v[asc[0]], parent: -1, cx: 0, cy: 0, r: 0 }) }
    const rs = [...roots].sort((a, b) => g.v[born[b]] - g.v[born[a]] || born[a] - born[b])
    const keep = rs.length ? rs[0] : v
    for (const r of rs.slice(1)) {
      const h = hills[hillOf.get(born[r])!]
      h.rise = g.v[born[r]] - g.v[v]; h.saddleValue = g.v[v]; h.parent = hillOf.get(born[keep])!
      uf[r] = keep
    }
    uf[v] = keep
    owned[born[keep]]++
  }
  hills.forEach((h) => { h.volume = owned[h.max]; if (h.parent < 0) h.rise = g.v[h.max] - g.v[asc[0]] })
  // footprints: a hill is placed inside its parent's footprint, siblings side by side around the parent's centre
  const area = hills.reduce((a, h) => a + h.volume, 0) || 1
  const roots = hills.map((h, i) => ({ h, i })).filter(({ h }) => h.parent < 0)
  roots.forEach(({ h }) => { h.cx = 0; h.cy = 0; h.r = 0.5 * Math.sqrt(h.volume / area) * 2 })
  const kids = (i: number) => hills.map((h, k) => ({ h, k })).filter(({ h }) => h.parent === i).sort((a, b) => b.h.volume - a.h.volume)
  const place = (i: number) => {
    const p = hills[i]
    kids(i).forEach(({ h, k }, m, all) => {
      h.r = Math.max(0.02, 0.5 * Math.sqrt(h.volume / area) * 2)
      const ang = (m / Math.max(1, all.length)) * Math.PI * 2 + i
      const dist = p.r * 0.9 + h.r * 0.8
      h.cx = p.cx + Math.cos(ang) * dist; h.cy = p.cy + Math.sin(ang) * dist
      place(k)
    })
  }
  roots.forEach(({ i }) => place(i))
  return hills
}

/** Height field of the landscape on a size × size grid over the square [−1, 1]²: hills add their bump on top of their parent's surface. */
export function landscapeHeights(hills: readonly Hill[], size: number): { h: Float64Array; extent: number } {
  let ext = 0.2
  hills.forEach((h) => { ext = Math.max(ext, Math.abs(h.cx) + h.r, Math.abs(h.cy) + h.r) })
  const h = new Float64Array(size * size)
  const order = hills.map((_, i) => i)
  const depth = (i: number): number => (hills[i].parent < 0 ? 0 : 1 + depth(hills[i].parent))
  order.sort((a, b) => depth(a) - depth(b))
  const base = new Map<number, number>()
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = ((i / (size - 1)) * 2 - 1) * ext, y = ((j / (size - 1)) * 2 - 1) * ext
    let z = 0
    for (const k of order) {
      const hl = hills[k]
      const d = Math.hypot(x - hl.cx, y - hl.cy) / Math.max(1e-9, hl.r * 1.6)
      if (d < 1) z += hl.rise * (0.5 + 0.5 * Math.cos(Math.PI * d)) * (1)
    }
    h[j * size + i] = z
  }
  void base
  return { h, extent: ext }
}

/** Keeps the hills whose rise is at least `minRise` (the highest hill always stays); a hill whose parent was dropped moves onto the nearest kept ancestor. */
export function filterHills(hills: readonly Hill[], minRise: number): Hill[] {
  const keep = hills.map((h) => h.parent < 0 || h.rise >= minRise)
  const newIndex = new Map<number, number>()
  hills.forEach((_, i) => { if (keep[i]) newIndex.set(i, newIndex.size) })
  const anc = (i: number): number => { let p = hills[i].parent; while (p >= 0 && !keep[p]) p = hills[p].parent; return p }
  return hills.flatMap((h, i) => (keep[i] ? [{ ...h, parent: h.parent < 0 ? -1 : newIndex.get(anc(i)) ?? -1 }] : []))
}
