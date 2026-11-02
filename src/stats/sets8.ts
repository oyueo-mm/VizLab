/**
 * Engines of the v0.8 point-set techniques: Bubble Sets, LineSets, Kelp Diagram (with a KelpFusion-style fusion), Rainbow Boxes and Radial Sets.
 * All of them take points with a plane position and a set-membership matrix.
 */
import * as d3 from 'd3'

export type Pt = [number, number]

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** Distance from p to the segment ab and the position t∈[0,1] of the closest point. */
export function segDist(p: Pt, a: Pt, b: Pt): { d: number; t: number } {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
  return { d: Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)), t }
}

/** Minimum spanning tree (Prim) of the listed points; returns index pairs into `pts`. `cost` may add a penalty to a pair. */
export function spanningTree(idx: number[], pts: Pt[], cost: (a: number, b: number) => number = (a, b) => dist(pts[a], pts[b])): [number, number][] {
  if (idx.length < 2) return []
  const inTree = new Set<number>([idx[0]])
  const out: [number, number][] = []
  while (inTree.size < idx.length) {
    let best: [number, number] | null = null
    let bc = Infinity
    for (const a of inTree) for (const b of idx) {
      if (inTree.has(b)) continue
      const c = cost(a, b)
      if (c < bc) { bc = c; best = [a, b] }
    }
    out.push(best!)
    inTree.add(best![1])
  }
  return out
}

// ───────────────────────────── Bubble Sets ─────────────────────────────

export interface Circle { x: number; y: number; r: number }

/**
 * Routes the link a→b around circular obstacles (Bubble Sets "virtual edges"): when the straight segment passes through an obstacle
 * the route bends through a waypoint beside it, on the shorter side, and each part is routed again.
 */
export function routeAround(a: Pt, b: Pt, obstacles: Circle[], margin: number, depth = 3): Pt[] {
  if (depth > 0) {
    let hit: Circle | null = null
    let worst = 0
    for (const o of obstacles) {
      const { d, t } = segDist([o.x, o.y], a, b)
      if (t <= 0.02 || t >= 0.98) continue
      const pen = o.r + margin - d
      if (pen > worst) { worst = pen; hit = o }
    }
    if (hit) {
      const dx = b[0] - a[0], dy = b[1] - a[1]
      const len = Math.hypot(dx, dy) || 1
      const nx = -dy / len, ny = dx / len
      const side = (hit.x - a[0]) * nx + (hit.y - a[1]) * ny
      const s = side > 0 ? -1 : 1 // pass on the side away from the obstacle centre
      const off = hit.r + margin * 1.5
      const w: Pt = [hit.x + s * nx * off, hit.y + s * ny * off]
      const left = routeAround(a, w, obstacles.filter((o) => o !== hit), margin, depth - 1)
      const right = routeAround(w, b, obstacles.filter((o) => o !== hit), margin, depth - 1)
      return [...left.slice(0, -1), ...right]
    }
  }
  return [a, b]
}

export interface BubbleOptions {
  /** Item radius (the contour stays at least this far from a lone member). */
  r0: number
  /** Radius of influence of an item (morphing distance). */
  r1: number
  /** Weight of non-members (negative energy, as a positive number). */
  avoid: number
  /** Energy threshold of the iso-contour. */
  threshold: number
  /** Cell size of the potential grid in px. */
  cell: number
  /** Weight of the virtual edges relative to items. */
  edgeWeight: number
}

export const defaultBubble: BubbleOptions = { r0: 14, r1: 42, avoid: 0.8, threshold: 1, cell: 5, edgeWeight: 1 }

export interface SetRegion {
  /** Outline rings (closed polylines) of the region. */
  rings: Pt[][]
  /** Link skeleton (polylines) used to build the region, if any. */
  links: Pt[][]
  /** Members inside / total members, non-members inside the region. */
  coveredMembers: number
  members: number
  leakedOthers: number
}

const falloff = (d: number, r0: number, r1: number) => (d >= r1 ? 0 : ((r1 - d) * (r1 - d)) / ((r1 - r0) * (r1 - r0)))

/** Converts d3.contours output (grid units) into rings in pixels. */
function ringsOf(values: number[], gw: number, gh: number, threshold: number, cell: number): Pt[][] {
  const geo = d3.contours().size([gw, gh]).thresholds([threshold])(values)[0]
  const out: Pt[][] = []
  for (const poly of geo?.coordinates ?? []) for (const ring of poly) out.push(ring.map(([x, y]) => [(x - 0.5) * cell, (y - 0.5) * cell] as Pt))
  return out
}

function countInside(rings: Pt[][], pts: Pt[], member: boolean[]): { coveredMembers: number; members: number; leakedOthers: number } {
  // even-odd rule over all rings: holes of the multi-polygon are subtracted
  const inside = (p: Pt) => rings.reduce((n, r) => n + (d3.polygonContains(r, p) ? 1 : 0), 0) % 2 === 1
  let coveredMembers = 0, members = 0, leakedOthers = 0
  pts.forEach((p, i) => {
    const ins = inside(p)
    if (member[i]) { members++; if (ins) coveredMembers++ } else if (ins) leakedOthers++
  })
  return { coveredMembers, members, leakedOthers }
}

/**
 * Bubble Sets (Collins, Penn & Carpendale 2009): the region of a set is the iso-contour of an energy field. Each member adds a radial
 * falloff energy, virtual edges (spanning tree routed around non-members) add energy along the links so that distant members join, and
 * every non-member subtracts energy so the region keeps away from it.
 */
export function bubbleSet(pts: Pt[], member: boolean[], width: number, height: number, opt: BubbleOptions = defaultBubble): SetRegion {
  const idx = member.map((m, i) => (m ? i : -1)).filter((i) => i >= 0)
  if (!idx.length) return { rings: [], links: [], coveredMembers: 0, members: 0, leakedOthers: 0 }
  const others = pts.map((p, i) => ({ p, i })).filter(({ i }) => !member[i])
  const obstacles: Circle[] = others.map(({ p }) => ({ x: p[0], y: p[1], r: opt.r0 * 0.9 }))
  const tree = spanningTree(idx, pts, (a, b) => {
    // a link through a non-member is expensive, so the tree prefers going around crowds of non-members
    let c = dist(pts[a], pts[b])
    for (const o of obstacles) if (segDist([o.x, o.y], pts[a], pts[b]).d < o.r + 2) c += opt.r1 * 0.6
    return c
  })
  const links = tree.map(([a, b]) => routeAround(pts[a], pts[b], obstacles, opt.r0 * 0.5))
  const gw = Math.ceil(width / opt.cell) + 1, gh = Math.ceil(height / opt.cell) + 1
  const values = new Array<number>(gw * gh).fill(0)
  const segs: [Pt, Pt][] = links.flatMap((poly) => poly.slice(1).map((p, k) => [poly[k], p] as [Pt, Pt]))
  const edgeR1 = opt.r1 * 0.7, edgeR0 = opt.r0 * 0.6
  const reach = opt.r1
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const p: Pt = [gx * opt.cell, gy * opt.cell]
    let e = 0
    for (const i of idx) { const d = dist(p, pts[i]); if (d < reach) e += falloff(d, opt.r0, opt.r1) }
    for (const [a, b] of segs) {
      const { d } = segDist(p, a, b)
      if (d < edgeR1) e += opt.edgeWeight * falloff(d, edgeR0, edgeR1)
    }
    for (const { p: q } of others) { const d = dist(p, q); if (d < reach) e -= opt.avoid * falloff(d, opt.r0, opt.r1) }
    values[gy * gw + gx] = e
  }
  const rings = ringsOf(values, gw, gh, opt.threshold, opt.cell)
  return { rings, links, ...countInside(rings, pts, member) }
}

// ───────────────────────────── LineSets ─────────────────────────────

/** Open path through the given points: nearest-neighbour start followed by 2-opt improvement (a short Hamiltonian path). */
export function shortestPath(idx: number[], pts: Pt[]): number[] {
  if (idx.length <= 2) return [...idx]
  // start from the point farthest from the centroid so the path begins at an end of the cloud
  const cx = d3.mean(idx, (i) => pts[i][0])!, cy = d3.mean(idx, (i) => pts[i][1])!
  const start = idx.reduce((b, i) => (dist(pts[i], [cx, cy]) > dist(pts[b], [cx, cy]) ? i : b), idx[0])
  const left = new Set(idx)
  const path = [start]
  left.delete(start)
  while (left.size) {
    const last = pts[path[path.length - 1]]
    let best = -1, bd = Infinity
    for (const i of left) { const d = dist(last, pts[i]); if (d < bd) { bd = d; best = i } }
    path.push(best)
    left.delete(best)
  }
  const len = (p: number[]) => p.slice(1).reduce((s, v, k) => s + dist(pts[p[k]], pts[v]), 0)
  let improved = true
  let guard = 0
  while (improved && guard++ < 50) {
    improved = false
    for (let i = 0; i < path.length - 1; i++) for (let j = i + 1; j < path.length; j++) {
      const cand = [...path.slice(0, i), ...path.slice(i, j + 1).reverse(), ...path.slice(j + 1)]
      if (len(cand) < len(path) - 1e-9) { path.splice(0, path.length, ...cand); improved = true }
    }
  }
  return path
}

export const pathLength = (path: number[], pts: Pt[]) => path.slice(1).reduce((s, v, k) => s + dist(pts[path[k]], pts[v]), 0)

/** Counts proper crossings between the polylines of different sets. */
export function countCrossings(paths: Pt[][]): number {
  const cross = (p: Pt, q: Pt, r: Pt, s: Pt) => {
    const o = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    return o(p, q, r) * o(p, q, s) < 0 && o(r, s, p) * o(r, s, q) < 0
  }
  let n = 0
  for (let a = 0; a < paths.length; a++) for (let b = a + 1; b < paths.length; b++) {
    for (let i = 1; i < paths[a].length; i++) for (let j = 1; j < paths[b].length; j++) if (cross(paths[a][i - 1], paths[a][i], paths[b][j - 1], paths[b][j])) n++
  }
  return n
}

export interface LineSet { set: number; order: number[]; /** Waypoints, displaced sideways where several sets share an item. */ line: Pt[]; length: number }

/**
 * LineSets (Alper et al. 2011): every set is one curve through its members. Where several sets pass through the same item their lines are
 * laid side by side (offset along the local normal) so that each set stays followable.
 */
export function lineSets(pts: Pt[], member: boolean[][], gap = 4): { sets: LineSet[]; crossings: number } {
  const orders = member.map((m) => shortestPath(m.map((v, i) => (v ? i : -1)).filter((i) => i >= 0), pts))
  const through: number[][] = pts.map(() => [])
  orders.forEach((o, s) => o.forEach((i) => through[i].push(s)))
  const sets: LineSet[] = orders.map((order, s) => {
    const line = order.map((i, k) => {
      const prev = pts[order[Math.max(0, k - 1)]], next = pts[order[Math.min(order.length - 1, k + 1)]]
      const tx = next[0] - prev[0], ty = next[1] - prev[1]
      const tl = Math.hypot(tx, ty) || 1
      const rank = through[i].indexOf(s) - (through[i].length - 1) / 2
      return [pts[i][0] + (-ty / tl) * rank * gap, pts[i][1] + (tx / tl) * rank * gap] as Pt
    })
    return { set: s, order, line, length: pathLength(order, pts) }
  })
  return { sets, crossings: countCrossings(sets.map((s) => s.line)) }
}

// ───────────────────────────── Kelp Diagram / KelpFusion ─────────────────────────────

export interface KelpOptions {
  /** Radius of the swollen region around every member. */
  radius: number
  /** Share of the radius that remains in the middle of a link (0 = pinches to a thread, 1 = a uniform tube). */
  waist: number
  /** Penalty for links that run through a non-member. */
  avoid: number
  /** 0 = pure kelp skeleton; towards 1 empty triangles between members are filled (KelpFusion-style). */
  fusion: number
  cell: number
}

export const defaultKelp: KelpOptions = { radius: 16, waist: 0.35, avoid: 0.9, fusion: 0, cell: 5 }

/**
 * Kelp Diagram (Dinkla et al. 2012): a spanning structure of the members, drawn as a tube that bulges around members and narrows along
 * the links. Links avoid non-members. With `fusion` > 0 triangles of the members' Delaunay triangulation that contain no non-member are
 * added to the region, which moves the picture from a kelp towards a hull (the idea of KelpFusion, Meulemans et al. 2013, in a simplified form).
 */
export function kelp(pts: Pt[], member: boolean[], width: number, height: number, opt: KelpOptions = defaultKelp): SetRegion {
  const idx = member.map((m, i) => (m ? i : -1)).filter((i) => i >= 0)
  if (!idx.length) return { rings: [], links: [], coveredMembers: 0, members: 0, leakedOthers: 0 }
  const others = pts.map((p, i) => ({ p, i })).filter(({ i }) => !member[i])
  const clear = opt.radius * 0.9
  const tree = spanningTree(idx, pts, (a, b) => {
    let c = dist(pts[a], pts[b])
    for (const { p } of others) if (segDist(p, pts[a], pts[b]).d < clear) c += 1000 * opt.avoid
    return c
  })
  const links = tree.map(([a, b]) => [pts[a], pts[b]] as Pt[])
  const gw = Math.ceil(width / opt.cell) + 1, gh = Math.ceil(height / opt.cell) + 1
  const values = new Array<number>(gw * gh).fill(-opt.radius)
  // Delaunay triangles of the members that hold no non-member and are not too stretched for the chosen fusion
  const tris: [Pt, Pt, Pt][] = []
  if (opt.fusion > 0 && idx.length >= 3) {
    const del = d3.Delaunay.from(idx.map((i) => pts[i]))
    const maxEdge = d3.max(tree, ([a, b]) => dist(pts[a], pts[b])) ?? 0
    const limit = maxEdge * (0.6 + 1.6 * opt.fusion)
    for (let t = 0; t < del.triangles.length; t += 3) {
      const tri = [0, 1, 2].map((k) => pts[idx[del.triangles[t + k]]]) as [Pt, Pt, Pt]
      const longest = Math.max(dist(tri[0], tri[1]), dist(tri[1], tri[2]), dist(tri[2], tri[0]))
      if (longest > limit) continue
      if (others.some(({ p }) => d3.polygonContains(tri, p) || tri.some((v, k) => segDist(p, v, tri[(k + 1) % 3]).d < clear * 0.6))) continue
      tris.push(tri)
    }
  }
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const p: Pt = [gx * opt.cell, gy * opt.cell]
    let v = -opt.radius
    for (const i of idx) v = Math.max(v, opt.radius - dist(p, pts[i]))
    for (const [a, b] of tree) {
      const { d, t } = segDist(p, pts[a], pts[b])
      const mid = 1 - Math.abs(2 * t - 1) // 0 at the ends, 1 in the middle
      const rad = opt.radius * (1 - (1 - opt.waist) * mid * mid)
      v = Math.max(v, rad - d)
    }
    for (const tri of tris) if (d3.polygonContains(tri, p)) v = Math.max(v, 1)
    values[gy * gw + gx] = v
  }
  const rings = ringsOf(values, gw, gh, 0, opt.cell)
  return { rings, links, ...countInside(rings, pts, member) }
}

// ───────────────────────────── Rainbow Boxes ─────────────────────────────

export interface RainbowLayout {
  /** Element indexes in column order. */
  order: number[]
  /** For every set the maximal runs of consecutive columns that hold its members: [first, last] inclusive. */
  runs: [number, number][][]
  /** Lane (row of boxes) of each set; sets with disjoint column extents share a lane. */
  lane: number[]
  lanes: number
  /** Total number of runs; the minimum is the number of non-empty sets. */
  fragments: number
}

const runsOf = (order: number[], member: boolean[][]): [number, number][][] =>
  member.map((m) => {
    const out: [number, number][] = []
    let start = -1
    order.forEach((e, c) => {
      if (m[e]) { if (start < 0) start = c } else if (start >= 0) { out.push([start, c - 1]); start = -1 }
    })
    if (start >= 0) out.push([start, order.length - 1])
    return out
  })

/**
 * Rainbow Boxes (Lamy et al. 2016, 2017): elements form columns, every set is drawn as a box over the columns of its members, and the
 * column order is chosen to keep the boxes unbroken. The order is a heuristic: elements are sorted by membership signature, then
 * improved by moving single elements while the number of broken box fragments shrinks.
 */
export function rainbowBoxes(member: boolean[][], nElements: number): RainbowLayout {
  const S = member.length
  const size = member.map((m) => m.filter(Boolean).length)
  const rank = member.map((_, s) => s).sort((a, b) => size[b] - size[a])
  let order = Array.from({ length: nElements }, (_, e) => e).sort((a, b) => {
    for (const s of rank) { const da = member[s][a] ? 1 : 0, db = member[s][b] ? 1 : 0; if (da !== db) return db - da }
    return a - b
  })
  const frag = (o: number[]) => runsOf(o, member).reduce((n, r) => n + r.length, 0)
  let best = frag(order)
  // move-one improvement; elements with an identical signature never need to be separated
  for (let pass = 0; pass < 6; pass++) {
    let gained = false
    for (let from = 0; from < order.length; from++) {
      const e = order[from]
      const rest = [...order.slice(0, from), ...order.slice(from + 1)]
      let bestPos = from, bestVal = best
      for (let to = 0; to <= rest.length; to++) {
        if (to === from) continue
        const cand = [...rest.slice(0, to), e, ...rest.slice(to)]
        const v = frag(cand)
        if (v < bestVal) { bestVal = v; bestPos = to }
      }
      if (bestPos !== from) { order = [...rest.slice(0, bestPos), e, ...rest.slice(bestPos)]; best = bestVal; gained = true }
    }
    if (!gained) break
  }
  const runs = runsOf(order, member)
  // lane assignment: greedy interval colouring over the column extent of every set
  const extent = runs.map((r) => (r.length ? [r[0][0], r[r.length - 1][1]] : null))
  const lane = new Array<number>(S).fill(0)
  const laneEnd: number[] = []
  const bySize = member.map((_, s) => s).filter((s) => extent[s]).sort((a, b) => extent[a]![0] - extent[b]![0])
  for (const s of bySize) {
    const l = laneEnd.findIndex((end) => end < extent[s]![0])
    if (l >= 0) { lane[s] = l; laneEnd[l] = extent[s]![1] } else { lane[s] = laneEnd.length; laneEnd.push(extent[s]![1]) }
  }
  return { order, runs, lane, lanes: Math.max(1, laneEnd.length), fragments: runs.reduce((n, r) => n + r.length, 0) }
}

// ───────────────────────────── Radial Sets ─────────────────────────────

export interface RadialArc { set: number; degree: number; count: number; a0: number; a1: number }
export interface RadialSetsLayout {
  /** Sector of every set (angles in radians, clockwise from 12 o'clock). */
  sectors: { set: number; size: number; a0: number; a1: number }[]
  /** Within a sector, elements grouped by the number of sets they belong to (degree), ordered from degree 1 outwards. */
  arcs: RadialArc[]
  /** Overlap |A ∩ B| of every pair of sets with a non-empty overlap and its sub-arcs on both sectors. */
  links: { a: number; b: number; count: number; a0: number; a1: number; b0: number; b1: number }[]
  maxDegree: number
}

/**
 * Radial Sets (Alsallakh et al. 2013, simplified): sets are sectors of a circle whose angle is proportional to the set size; inside a
 * sector the elements are grouped by degree (how many sets they belong to), and overlaps are drawn as bands that connect the sub-arcs
 * of the two sets, with width proportional to the number of shared elements.
 */
export function radialSets(member: boolean[][], nElements: number, gap = 0.06): RadialSetsLayout {
  const S = member.length
  const size = member.map((m) => m.filter(Boolean).length)
  const total = size.reduce((a, b) => a + b, 0) || 1
  const avail = 2 * Math.PI - gap * S
  const sectors: RadialSetsLayout['sectors'] = []
  let a = 0
  for (let s = 0; s < S; s++) {
    const span = (size[s] / total) * avail
    sectors.push({ set: s, size: size[s], a0: a, a1: a + span })
    a += span + gap
  }
  const degree = Array.from({ length: nElements }, (_, e) => member.reduce((n, m) => n + (m[e] ? 1 : 0), 0))
  const maxDegree = Math.max(1, ...degree)
  const arcs: RadialArc[] = []
  for (let s = 0; s < S; s++) {
    const sec = sectors[s]
    let at = sec.a0
    for (let d = 1; d <= maxDegree; d++) {
      let count = 0
      for (let e = 0; e < nElements; e++) if (member[s][e] && degree[e] === d) count++
      if (!count) continue
      const span = size[s] ? ((sec.a1 - sec.a0) * count) / size[s] : 0
      arcs.push({ set: s, degree: d, count, a0: at, a1: at + span })
      at += span
    }
  }
  const links: RadialSetsLayout['links'] = []
  const used = new Array<number>(S).fill(0)
  for (let x = 0; x < S; x++) for (let y = x + 1; y < S; y++) {
    let count = 0
    for (let e = 0; e < nElements; e++) if (member[x][e] && member[y][e]) count++
    if (!count) continue
    const wx = size[x] ? ((sectors[x].a1 - sectors[x].a0) * count) / size[x] : 0
    const wy = size[y] ? ((sectors[y].a1 - sectors[y].a0) * count) / size[y] : 0
    links.push({ a: x, b: y, count, a0: sectors[x].a0 + used[x], a1: sectors[x].a0 + used[x] + wx, b0: sectors[y].a0 + used[y], b1: sectors[y].a0 + used[y] + wy })
    used[x] += wx
    used[y] += wy
  }
  return { sectors, arcs, links, maxDegree }
}
