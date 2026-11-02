/** Engines of the v0.8 three-dimensional techniques: stream surface, streamtube and cone tree. */
import { vecAt, type Mesh, type V3, type VecGrid } from './field3d'
import type { TreeNode } from './hierarchy'

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = (a: V3) => Math.hypot(a[0], a[1], a[2])
const unit = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

// ───────────────────────────── time integration ─────────────────────────────

/** Integral curve of the (unnormalised) field with fixed time step, fourth-order Runge–Kutta; stops at the boundary or a stagnation point. */
export function integrateTime(f: VecGrid, seed: V3, dt: number, steps: number): V3[] {
  const out: V3[] = [seed]
  let p = seed
  const F = (q: V3): V3 | null => { const v = vecAt(f, q); return Number.isFinite(v[0] + v[1] + v[2]) ? v : null }
  for (let s = 0; s < steps; s++) {
    const k1 = F(p); if (!k1 || len(k1) < 1e-9) break
    const k2 = F(add(p, mul(k1, dt / 2))); if (!k2) break
    const k3 = F(add(p, mul(k2, dt / 2))); if (!k3) break
    const k4 = F(add(p, mul(k3, dt))); if (!k4) break
    p = add(p, mul(add(add(k1, mul(k2, 2)), add(mul(k3, 2), k4)), dt / 6))
    out.push(p)
  }
  return out
}

// ───────────────────────────── Stream Surface ─────────────────────────────

export interface StreamSurface {
  /** Integral curves from the seed line, ordered along the seed line. */
  lines: V3[][]
  /** Parameter s ∈ [0, 1] of every curve on the seed line. */
  params: number[]
  mesh: Mesh
  /** Number of curves that were added by refinement because neighbours drifted apart. */
  refined: number
}

export interface StreamSurfaceOptions { seeds: number; dt: number; steps: number; /** Largest allowed distance between neighbouring curves at the same time. */ maxSpan: number; maxSeeds: number }

/**
 * Stream surface (Hultquist 1992, simplified): the surface swept by the integral curves of a steady 3-D field that start on a seed line.
 * Neighbouring curves are integrated with the same time step and joined into triangle strips; where two neighbours drift further apart
 * than `maxSpan` a curve started between them on the seed line is inserted (up to `maxSeeds`), so the mesh stays dense where the flow diverges.
 * It does not trim or re-triangulate the front as the original advancing-front algorithm does.
 */
export function streamSurface(f: VecGrid, p0: V3, p1: V3, opt: StreamSurfaceOptions): StreamSurface {
  const seedAt = (s: number) => lerp(p0, p1, s)
  let params = Array.from({ length: Math.max(2, opt.seeds) }, (_, i) => i / (Math.max(2, opt.seeds) - 1))
  const cache = new Map<number, V3[]>()
  const line = (s: number) => { let l = cache.get(s); if (!l) { l = integrateTime(f, seedAt(s), opt.dt, opt.steps); cache.set(s, l) } return l }
  let refined = 0
  for (let pass = 0; pass < 6 && params.length < opt.maxSeeds; pass++) {
    const next: number[] = [params[0]]
    let changed = false
    for (let i = 1; i < params.length; i++) {
      const a = line(params[i - 1]), b = line(params[i])
      const n = Math.min(a.length, b.length)
      let worst = 0
      for (let t = 0; t < n; t++) worst = Math.max(worst, len(sub(a[t], b[t])))
      if (worst > opt.maxSpan && params.length + next.length - i < opt.maxSeeds) { next.push((params[i - 1] + params[i]) / 2); refined++; changed = true }
      next.push(params[i])
    }
    params = next
    if (!changed) break
  }
  const lines = params.map(line)
  const verts: V3[] = []
  const offset: number[] = []
  for (const l of lines) { offset.push(verts.length); verts.push(...l) }
  const tris: [number, number, number][] = []
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1], b = lines[i]
    const n = Math.min(a.length, b.length)
    for (let t = 0; t + 1 < n; t++) {
      const a0 = offset[i - 1] + t, a1 = a0 + 1, b0 = offset[i] + t, b1 = b0 + 1
      tris.push([a0, b0, a1], [a1, b0, b1])
    }
  }
  return { lines, params, mesh: { verts, tris }, refined }
}

/** Area of the triangles of a mesh. */
export const surfaceArea = (m: Mesh) => m.tris.reduce((s, [a, b, c]) => s + len(cross(sub(m.verts[b], m.verts[a]), sub(m.verts[c], m.verts[a]))) / 2, 0)

// ───────────────────────────── Streamtube ─────────────────────────────

export type TubeRadius = 'fixed' | 'speed' | 'conservation'

/**
 * Radius along a streamline. `conservation` keeps the volume flux |v|·πr² constant (a tube of an incompressible flow narrows where the
 * flow speeds up); `speed` makes the tube thicker where the flow is faster.
 */
export function tubeRadius(mode: TubeRadius, base: number, speed: number, meanSpeed: number): number {
  const rel = Math.max(1e-6, speed) / Math.max(1e-6, meanSpeed)
  if (mode === 'speed') return base * Math.min(2.5, Math.max(0.3, rel))
  if (mode === 'conservation') return base / Math.sqrt(Math.min(6, Math.max(0.25, rel)))
  return base
}

export interface Tube { rings: V3[][]; /** Unit normals of the ring vertices (pointing away from the axis). */ normals: V3[][]; quads: { a: [number, number]; b: [number, number]; c: [number, number]; d: [number, number] }[]; axis: V3[]; radius: number[] }

/**
 * Tube mesh around a polyline: rings of `sides` vertices in the plane orthogonal to the tangent, with a parallel-transport (Bishop) frame so
 * the tube does not twist. Quads join consecutive rings.
 */
export function streamtube(axis: V3[], radius: number[], sides = 12): Tube {
  const n = axis.length
  const rings: V3[][] = [], normals: V3[][] = []
  if (n < 2) return { rings, normals, quads: [], axis, radius }
  const tangent = (i: number) => unit(sub(axis[Math.min(n - 1, i + 1)], axis[Math.max(0, i - 1)]))
  let t = tangent(0)
  // start frame: any vector orthogonal to the first tangent
  let u = unit(cross(t, Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]))
  for (let i = 0; i < n; i++) {
    const ti = tangent(i)
    // parallel transport: rotate the previous normal by the rotation that carries t to ti
    const axisR = cross(t, ti)
    const s = len(axisR)
    if (s > 1e-9) {
      const k = mul(axisR, 1 / s), c = dot(t, ti)
      u = add(add(mul(u, c), mul(cross(k, u), s)), mul(k, dot(k, u) * (1 - c)))
    }
    t = ti
    const v = unit(cross(t, u))
    const ring: V3[] = [], nor: V3[] = []
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * 2 * Math.PI
      const nn = add(mul(u, Math.cos(a)), mul(v, Math.sin(a)))
      nor.push(nn)
      ring.push(add(axis[i], mul(nn, radius[i])))
    }
    rings.push(ring)
    normals.push(nor)
  }
  const quads: Tube['quads'] = []
  for (let i = 0; i + 1 < n; i++) for (let j = 0; j < sides; j++) quads.push({ a: [i, j], b: [i, (j + 1) % sides], c: [i + 1, (j + 1) % sides], d: [i + 1, j] })
  return { rings, normals, quads, axis, radius }
}

// ───────────────────────────── Cone Tree ─────────────────────────────

export interface ConeNode {
  id: number
  /** Path of names from the root, stable while other branches are collapsed. */
  key: string
  name: string
  depth: number
  parent: number
  children: number[]
  /** Position in the tree space (x, y horizontal, z vertical, root at the top). */
  pos: V3
  /** Radius of the ring that holds this node's children. */
  ring: number
  /** Radius of the disc that contains the whole subtree. */
  extent: number
  leaves: number
}

/**
 * Cone tree layout (Robertson, Mackinlay & Card 1991): every node sits at the apex of a cone whose base ring holds its children, one level
 * below. A ring is wide enough that the discs of the children's subtrees do not overlap, so a subtree never collides with its siblings.
 * `phase[id]` rotates the ring of node `id` (radians); `hidden` nodes lose their descendants.
 */
export function coneTree(root: TreeNode, opt: { levelGap?: number; leafRadius?: number; maxDepth?: number; collapsed?: ReadonlySet<string>; phase?: ReadonlyMap<string, number> } = {}): ConeNode[] {
  const gap = opt.levelGap ?? 0.5
  const leaf = opt.leafRadius ?? 0.06
  const maxDepth = opt.maxDepth ?? 99
  const collapsed = opt.collapsed ?? new Set<string>()
  const phase = opt.phase ?? new Map<string, number>()
  const nodes: ConeNode[] = []
  const build = (n: TreeNode, depth: number, parent: number, key: string): number => {
    const id = nodes.length
    nodes.push({ id, key, name: n.name, depth, parent, children: [], pos: [0, 0, -depth * gap], ring: 0, extent: leaf, leaves: 1 })
    const kids = depth < maxDepth && !collapsed.has(key) ? n.children ?? [] : []
    if (kids.length) {
      const ids = kids.map((c) => build(c, depth + 1, id, `${key}/${c.name}`))
      nodes[id].children = ids
      nodes[id].leaves = ids.reduce((s, c) => s + nodes[c].leaves, 0)
      const maxE = Math.max(...ids.map((c) => nodes[c].extent))
      const ring = ids.length === 1 ? 0 : (maxE * 1.08) / Math.sin(Math.PI / ids.length)
      nodes[id].ring = ring
      nodes[id].extent = ring + maxE
    }
    return id
  }
  build(root, 0, -1, root.name)
  const place = (id: number, cx: number, cy: number) => {
    const n = nodes[id]
    n.pos = [cx, cy, -n.depth * gap]
    const k = n.children.length
    n.children.forEach((c, i) => {
      const a = (i / k) * 2 * Math.PI + (phase.get(n.key) ?? 0)
      place(c, cx + n.ring * Math.cos(a), cy + n.ring * Math.sin(a))
    })
  }
  place(0, 0, 0)
  return nodes
}

/** Ancestors of `id` from the root down to `id` (inclusive). */
export function pathTo(nodes: readonly ConeNode[], id: number): number[] {
  const out: number[] = []
  for (let v = id; v >= 0; v = nodes[v].parent) out.unshift(v)
  return out
}

/**
 * Phases that rotate every ancestor's ring so the child on the way to `target` faces the angle `front` (the direction towards the viewer).
 * Returned as a map from node key to the ring rotation.
 */
export function facePhases(nodes: readonly ConeNode[], target: number, front: number): Map<string, number> {
  const out = new Map<string, number>()
  const path = pathTo(nodes, target)
  for (let i = 0; i + 1 < path.length; i++) {
    const a = nodes[path[i]]
    const k = a.children.length
    const idx = a.children.indexOf(path[i + 1])
    out.set(a.key, front - (idx / k) * 2 * Math.PI)
  }
  return out
}
