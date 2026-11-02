/** Layout engines of the v0.7 relation techniques: hyperbolic tree, linear set diagram, force-directed edge bundling and storyline chart. */
import type { TreeNode } from './hierarchy'

// ───────────────────────────── Hyperbolic tree (Poincaré disk) ─────────────────────────────

export type Cx = [number, number]

export interface HNode { id: number; name: string; depth: number; parent: number; /** hyperbolic radius */ rho: number; theta: number; z: Cx; leaves: number }

/**
 * Hyperbolic tree layout: depth k sits at hyperbolic distance k·δ from the root, and the angle around the root is divided among the
 * subtrees in proportion to their leaf counts. The Poincaré-disk position of a point at hyperbolic radius ρ is tanh(ρ/2) in that direction.
 */
export function hyperbolicLayout(root: TreeNode, delta = 1.1): HNode[] {
  const nodes: HNode[] = []
  const count = (n: TreeNode): number => (n.children?.length ? n.children.reduce((s, c) => s + count(c), 0) : 1)
  const walk = (n: TreeNode, depth: number, parent: number, a0: number, a1: number) => {
    const id = nodes.length
    const rho = depth * delta
    const theta = (a0 + a1) / 2
    const r = Math.tanh(rho / 2)
    nodes.push({ id, name: n.name, depth, parent, rho, theta, z: [r * Math.cos(theta), r * Math.sin(theta)], leaves: count(n) })
    if (n.children?.length) {
      const total = count(n)
      let a = a0
      for (const c of n.children) { const span = ((a1 - a0) * count(c)) / total; walk(c, depth + 1, id, a, a + span); a += span }
    }
  }
  walk(root, 0, -1, 0, 2 * Math.PI)
  return nodes
}

const cmul = (a: Cx, b: Cx): Cx => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]
const cdiv = (a: Cx, b: Cx): Cx => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d] }
const conj = (a: Cx): Cx => [a[0], -a[1]]

/** Möbius transformation of the disc that carries `a` to the origin: z ↦ (z − a) / (1 − ā z). It is an isometry of the hyperbolic plane. */
export const mobius = (z: Cx, a: Cx): Cx => cdiv([z[0] - a[0], z[1] - a[1]], [1 - cmul(conj(a), z)[0], -cmul(conj(a), z)[1]])

/** Hyperbolic distance between two points of the Poincaré disc. */
export function hyperbolicDistance(z: Cx, w: Cx): number {
  const m = mobius(z, w)
  return 2 * Math.atanh(Math.min(1 - 1e-15, Math.hypot(m[0], m[1])))
}

/** Rotation of the whole disc about the origin by `phi` (also an isometry); used to keep the previous orientation when the focus moves. */
export const rotate = (z: Cx, phi: number): Cx => cmul(z, [Math.cos(phi), Math.sin(phi)])

// ───────────────────────────── Linear set diagram ─────────────────────────────

export interface LinearColumn { pattern: number; sets: number[]; count: number; x0: number; x1: number }

/**
 * Linear diagram of set membership: one row per set, one column per distinct membership pattern with width proportional to how many
 * elements have exactly that pattern. A set's row is filled over the columns whose pattern contains it, so every region of a Venn
 * diagram becomes a column and every set is the union of its filled columns.
 */
export function linearDiagram(member: readonly (readonly boolean[])[], sort: 'size' | 'degree' | 'pattern' = 'size') {
  const nSets = member[0]?.length ?? 0
  const byPattern = new Map<number, number>()
  for (const row of member) { let p = 0; row.forEach((b, j) => { if (b) p |= 1 << j }); byPattern.set(p, (byPattern.get(p) ?? 0) + 1) }
  const popcount = (p: number) => { let c = 0; for (let q = p; q; q &= q - 1) c++; return c }
  const patterns = [...byPattern.entries()].map(([pattern, count]) => ({ pattern, count, degree: popcount(pattern) }))
  patterns.sort((a, b) => (sort === 'size' ? b.count - a.count : sort === 'degree' ? a.degree - b.degree || b.count - a.count : a.pattern - b.pattern) || a.pattern - b.pattern)
  const total = member.length
  let x = 0
  const columns: LinearColumn[] = patterns.map((p) => {
    const col = { pattern: p.pattern, sets: Array.from({ length: nSets }, (_, j) => j).filter((j) => p.pattern & (1 << j)), count: p.count, x0: x / (total || 1), x1: (x + p.count) / (total || 1) }
    x += p.count
    return col
  })
  const setSizes = Array.from({ length: nSets }, (_, j) => member.filter((r) => r[j]).length)
  return { columns, setSizes, total }
}

// ───────────────────────────── Force-directed edge bundling ─────────────────────────────

export interface Edge2 { x0: number; y0: number; x1: number; y1: number }
type Pt = [number, number]

const len = (e: Edge2) => Math.hypot(e.x1 - e.x0, e.y1 - e.y0)
const mid = (e: Edge2): Pt => [(e.x0 + e.x1) / 2, (e.y0 + e.y1) / 2]

/** Compatibility of two edges (Holten & van Wijk 2009): the product of angle, scale, position and visibility measures, each in [0, 1]. */
export function edgeCompatibility(p: Edge2, q: Edge2): number {
  const lp = len(p), lq = len(q)
  if (lp < 1e-9 || lq < 1e-9) return 0
  const dot = ((p.x1 - p.x0) * (q.x1 - q.x0) + (p.y1 - p.y0) * (q.y1 - q.y0)) / (lp * lq)
  const angle = Math.abs(dot)
  const lavg = (lp + lq) / 2
  const scale = 2 / (lavg / Math.min(lp, lq) + Math.max(lp, lq) / lavg)
  const mp = mid(p), mq = mid(q)
  const position = lavg / (lavg + Math.hypot(mp[0] - mq[0], mp[1] - mq[1]))
  const vis = (a: Edge2, b: Edge2) => {
    // project b's endpoints onto a's line; visibility is how much the projected segment overlaps a's centre portion
    const la = len(a)
    const ux = (a.x1 - a.x0) / la, uy = (a.y1 - a.y0) / la
    const proj = (x: number, y: number): [number, number] => { const t = (x - a.x0) * ux + (y - a.y0) * uy; return [a.x0 + t * ux, a.y0 + t * uy] }
    const i0 = proj(b.x0, b.y0), i1 = proj(b.x1, b.y1)
    const im: Pt = [(i0[0] + i1[0]) / 2, (i0[1] + i1[1]) / 2]
    const am = mid(a)
    const il = Math.hypot(i0[0] - i1[0], i0[1] - i1[1])
    return Math.max(0, 1 - (2 * Math.hypot(am[0] - im[0], am[1] - im[1])) / Math.max(il, 1e-9))
  }
  const visibility = Math.min(vis(p, q), vis(q, p))
  return angle * scale * position * visibility
}

export interface BundleOptions { cycles?: number; iterations?: number; subdivisions?: number; stiffness?: number; threshold?: number }

/**
 * Force-directed edge bundling. Every edge is split into P control points; in each cycle the points of an edge are pulled by springs
 * towards their neighbours along the edge and attracted to the corresponding points of compatible edges. The number of subdivision
 * points doubles and the step size halves each cycle. End points stay fixed. Returns one polyline per edge.
 */
export function bundleEdges(edges: readonly Edge2[], opts: BundleOptions = {}): Pt[][] {
  const { cycles = 6, iterations = 50, stiffness = 0.1, threshold = 0.6 } = opts
  const n = edges.length
  const compat: { j: number; c: number }[][] = Array.from({ length: n }, () => [])
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const c = edgeCompatibility(edges[i], edges[j]); if (c > threshold) { compat[i].push({ j, c }); compat[j].push({ j: i, c }) } }
  let P = 1
  let step = 0.04
  let lines: Pt[][] = edges.map((e) => [[e.x0, e.y0], [e.x1, e.y1]])
  let I = iterations
  for (let cycle = 0; cycle < cycles; cycle++) {
    P = P === 1 ? 2 : P * 2
    if (opts.subdivisions && P > opts.subdivisions) P = opts.subdivisions
    lines = lines.map((pts) => {
      // resample the polyline into P + 1 equally spaced points
      const total = pts.reduce((s, p, k) => (k ? s + Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) : 0), 0)
      const out: Pt[] = [pts[0]]
      let acc = 0, k = 1
      for (let s = 1; s < P; s++) {
        const target = (total * s) / P
        while (k < pts.length - 1 && acc + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]) < target) { acc += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); k++ }
        const segLen = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]) || 1
        const t = (target - acc) / segLen
        out.push([pts[k - 1][0] + t * (pts[k][0] - pts[k - 1][0]), pts[k - 1][1] + t * (pts[k][1] - pts[k - 1][1])])
      }
      out.push(pts[pts.length - 1])
      return out
    })
    for (let it = 0; it < I; it++) {
      lines = lines.map((pts, i) => {
        const L = len(edges[i]) || 1
        return pts.map((p, s) => {
          if (s === 0 || s === pts.length - 1) return p
          // spring: pull towards the neighbours along the edge; attraction: pull towards the same point of every compatible edge (weaker when far away)
          let fx = stiffness * (pts[s - 1][0] - p[0] + pts[s + 1][0] - p[0])
          let fy = stiffness * (pts[s - 1][1] - p[1] + pts[s + 1][1] - p[1])
          for (const { j, c } of compat[i]) {
            const q = lines[j][s]
            const dx = q[0] - p[0], dy = q[1] - p[1]
            const d = Math.hypot(dx, dy)
            if (d < 1e-9) continue
            const g = c * Math.min(1, L / d)
            fx += (step * L * g * dx) / d
            fy += (step * L * g * dy) / d
          }
          return [p[0] + fx, p[1] + fy] as Pt
        })
      })
    }
    step /= 2
    I = Math.max(10, Math.round(I * 0.67))
  }
  return lines
}

export const polylineLength = (pts: readonly Pt[]) => pts.reduce((s, p, k) => (k ? s + Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) : 0), 0)

// ───────────────────────────── Storyline ─────────────────────────────

export interface StoryEvent { entity: string; t: number; session: string }
export interface StoryPoint { entity: string; t: number; y: number; session: string }

/**
 * Storyline layout: at every time step the entities of a session are placed next to each other (one block per session, blocks separated
 * by a gap, entities not present are left out). Blocks are ordered by the mean vertical position their members had in the previous step,
 * and members inside a block by their own previous position, which keeps lines roughly parallel and keeps crossings low.
 */
export function storylineLayout(events: readonly StoryEvent[], gap = 1.0, spacing = 1): { points: StoryPoint[]; times: number[]; crossings: number; height: number } {
  const times = [...new Set(events.map((e) => e.t))].sort((a, b) => a - b)
  const prev = new Map<string, number>()
  const entities = [...new Set(events.map((e) => e.entity))]
  entities.forEach((e, i) => prev.set(e, i))
  const points: StoryPoint[] = []
  let maxY = 0
  for (const t of times) {
    const at = events.filter((e) => e.t === t)
    const sessions = new Map<string, string[]>()
    for (const e of at) { if (!sessions.has(e.session)) sessions.set(e.session, []); sessions.get(e.session)!.push(e.entity) }
    const blocks = [...sessions.entries()].map(([session, members]) => ({ session, members: members.sort((a, b) => prev.get(a)! - prev.get(b)!), key: members.reduce((s, m) => s + prev.get(m)!, 0) / members.length }))
    blocks.sort((a, b) => a.key - b.key)
    let y = 0
    for (const b of blocks) {
      for (const m of b.members) { points.push({ entity: m, t, y, session: b.session }); y += spacing }
      y += gap
    }
    maxY = Math.max(maxY, y - gap - spacing)
    // positions of absent entities are kept so they re-enter in a sensible place; present ones are updated
    let rank = 0
    const ordered = points.filter((p) => p.t === t).sort((a, b) => a.y - b.y)
    for (const p of ordered) prev.set(p.entity, rank++)
  }
  return { points, times, crossings: storyCrossings(points, times), height: maxY }
}

/** Number of pairs of lines that swap their vertical order between two consecutive time steps. */
export function storyCrossings(points: readonly StoryPoint[], times: readonly number[]): number {
  let c = 0
  for (let k = 0; k + 1 < times.length; k++) {
    const a = new Map(points.filter((p) => p.t === times[k]).map((p) => [p.entity, p.y]))
    const b = new Map(points.filter((p) => p.t === times[k + 1]).map((p) => [p.entity, p.y]))
    const common = [...a.keys()].filter((e) => b.has(e))
    for (let i = 0; i < common.length; i++) for (let j = i + 1; j < common.length; j++) if ((a.get(common[i])! - a.get(common[j])!) * (b.get(common[i])! - b.get(common[j])!) < 0) c++
  }
  return c
}
