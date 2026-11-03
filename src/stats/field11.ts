import { createRng } from '../lib/random'

type V3 = [number, number, number]

// ───────────────────────────── Spot noise ─────────────────────────────

export type Vec2Field = (x: number, y: number) => [number, number]

export interface SpotNoise { w: number; h: number; tex: Float32Array; spots: number }

/**
 * Spot noise (van Wijk 1991): the texture is the sum of randomly weighted (±1) and positioned spots. Every spot is an ellipse bent to the local flow:
 * its long axis lies along the velocity and is stretched with the speed, its short axis shrinks so that the area stays the same. `field` returns the
 * velocity in pixel coordinates; the result is high-pass filtered (mean of a box neighbourhood removed) so that the pattern stands out.
 */
export function spotNoise(field: Vec2Field, w: number, h: number, nSpots: number, spotSize: number, stretch: number, seed: number, highPass = true): SpotNoise {
  const rng = createRng(seed)
  const tex = new Float32Array(w * h)
  let vmax = 1e-9
  for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) { const [u, v] = field(x, y); vmax = Math.max(vmax, Math.hypot(u, v)) }
  for (let s = 0; s < nSpots; s++) {
    const cx = rng() * w, cy = rng() * h, a = rng() < 0.5 ? -1 : 1
    const [u, v] = field(cx, cy)
    const sp = Math.hypot(u, v)
    const ex = sp > 1e-12 ? u / sp : 1, ey = sp > 1e-12 ? v / sp : 0
    const k = 1 + (stretch * sp) / vmax
    const major = spotSize * k, minor = spotSize / k
    const rad = Math.ceil(major)
    for (let y = Math.max(0, Math.floor(cy - rad)); y <= Math.min(h - 1, Math.ceil(cy + rad)); y++) for (let x = Math.max(0, Math.floor(cx - rad)); x <= Math.min(w - 1, Math.ceil(cx + rad)); x++) {
      const dx = x - cx, dy = y - cy
      const p = dx * ex + dy * ey, q = -dx * ey + dy * ex
      const e = (p / major) ** 2 + (q / minor) ** 2
      if (e <= 1) tex[y * w + x] += a * (1 - e) // a smooth bump, so that overlaps blend
    }
  }
  if (highPass) {
    const r = Math.max(2, Math.round(spotSize))
    const blur = new Float32Array(w * h), tmp = new Float32Array(w * h)
    for (let y = 0; y < h; y++) { let acc = 0, cnt = 0; for (let x = -r; x < w; x++) { if (x + r < w) { acc += tex[y * w + x + r]; cnt++ } if (x - r - 1 >= 0) { acc -= tex[y * w + x - r - 1]; cnt-- } if (x >= 0) tmp[y * w + x] = acc / cnt } }
    for (let x = 0; x < w; x++) { let acc = 0, cnt = 0; for (let y = -r; y < h; y++) { if (y + r < h) { acc += tmp[(y + r) * w + x]; cnt++ } if (y - r - 1 >= 0) { acc -= tmp[(y - r - 1) * w + x]; cnt-- } if (y >= 0) blur[y * w + x] = acc / cnt } }
    for (let i = 0; i < tex.length; i++) tex[i] -= blur[i]
  }
  return { w, h, tex, spots: nSpots }
}

/** Normalised autocorrelation of a texture at an integer lag. */
export function autocorrelation(t: SpotNoise, lx: number, ly: number): number {
  let num = 0, den = 0
  for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
    const v = t.tex[y * t.w + x]
    den += v * v
    const xx = x + lx, yy = y + ly
    if (xx >= 0 && xx < t.w && yy >= 0 && yy < t.h) num += v * t.tex[yy * t.w + xx]
  }
  return den ? num / den : 0
}

// ───────────────────────────── Stream ribbons ─────────────────────────────

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

/** Curl of a vector field by central differences with step h. */
export function curlAt(vec: (p: V3) => V3, p: V3, h = 1e-3): V3 {
  const d = (axis: number, comp: number) => {
    const a = [...p] as V3, b = [...p] as V3
    a[axis] += h; b[axis] -= h
    return (vec(a)[comp] - vec(b)[comp]) / (2 * h)
  }
  return [d(1, 2) - d(2, 1), d(2, 0) - d(0, 2), d(0, 1) - d(1, 0)]
}

export interface Ribbon { axis: V3[]; /** unit width direction at every axis point (perpendicular to the tangent) */ side: V3[]; /** twist angle accumulated along the ribbon (rad) */ twist: number[]; left: V3[]; right: V3[] }

/**
 * Stream ribbon: a streamline with a width vector that is carried along and rotates about the tangent with half the vorticity component along it,
 * dθ/dt = ½ (ω · T) (the rotation of a fluid element about the streamline). `dt` is the time step of the integration of the streamline (RK4).
 */
export function streamRibbon(vec: (p: V3) => V3, seed: V3, steps: number, dt: number, width: number, inBounds: (p: V3) => boolean = () => true): Ribbon {
  const axis: V3[] = [seed]
  const speed: number[] = []
  let p = seed
  for (let i = 0; i < steps; i++) {
    const k1 = vec(p), k2 = vec(add(p, mul(k1, dt / 2))), k3 = vec(add(p, mul(k2, dt / 2))), k4 = vec(add(p, mul(k3, dt)))
    const next = add(p, mul(add(add(k1, mul(k2, 2)), add(mul(k3, 2), k4)), dt / 6))
    if (!inBounds(next) || !next.every(Number.isFinite) || Math.hypot(...sub(next, p)) < 1e-12) break
    speed.push(Math.hypot(...k1))
    axis.push(next)
    p = next
  }
  const n = axis.length
  const tangent = axis.map((_, i) => norm(sub(axis[Math.min(n - 1, i + 1)], axis[Math.max(0, i - 1)])))
  // initial width direction: any vector perpendicular to the first tangent
  const t0 = tangent[0]
  let s: V3 = norm(cross(t0, Math.abs(t0[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]))
  const side: V3[] = [], twist: number[] = []
  let theta = 0
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      // parallel transport the width vector to the new tangent, then twist it about the tangent by the local rotation
      const tPrev = tangent[i - 1], tCur = tangent[i]
      const ax = cross(tPrev, tCur)
      const sinA = Math.hypot(...ax), cosA = dot(tPrev, tCur)
      if (sinA > 1e-12) { const u = mul(ax, 1 / sinA); s = add(add(mul(s, cosA), mul(cross(u, s), sinA)), mul(u, dot(u, s) * (1 - cosA))) }
      s = norm(sub(s, mul(tCur, dot(s, tCur))))
      const om = curlAt(vec, axis[i])
      const dtau = Math.hypot(...sub(axis[i], axis[i - 1])) / Math.max(1e-12, speed[i - 1] ?? 1)
      const dth = 0.5 * dot(om, tCur) * dtau
      theta += dth
      const rot = cross(tCur, s)
      s = norm(add(mul(s, Math.cos(dth)), mul(rot, Math.sin(dth))))
    }
    side.push(s)
    twist.push(theta)
  }
  const left = axis.map((q, i) => add(q, mul(side[i], width / 2))), right = axis.map((q, i) => sub(q, mul(side[i], width / 2)))
  return { axis, side, twist, left, right }
}

// ───────────────────────────── Rectangular cartogram ─────────────────────────────

export interface RegionIn { id: string; x: number; y: number; value: number }
export interface RectOut { id: string; x: number; y: number; w: number; h: number; value: number }

function slice(items: RegionIn[], x: number, y: number, w: number, h: number, flip: (depth: number) => boolean, depth: number, out: RectOut[]) {
  if (items.length === 1) { out.push({ id: items[0].id, x, y, w, h, value: items[0].value }); return }
  const total = items.reduce((s, r) => s + r.value, 0)
  // cut across the longer side of the rectangle, or the other way if the flip rule says so
  let vertical = w >= h
  if (flip(depth)) vertical = !vertical
  const sorted = [...items].sort((p, q) => (vertical ? p.x - q.x || p.y - q.y : p.y - q.y || p.x - q.x))
  let acc = 0, best = 1, bestD = Infinity
  for (let i = 1; i < sorted.length; i++) { acc += sorted[i - 1].value; const d = Math.abs(total / 2 - acc); if (d < bestD) { bestD = d; best = i } }
  const left = sorted.slice(0, best), right = sorted.slice(best)
  const f = left.reduce((s, r) => s + r.value, 0) / total
  if (vertical) { slice(left, x, y, w * f, h, flip, depth + 1, out); slice(right, x + w * f, y, w * (1 - f), h, flip, depth + 1, out) }
  else { slice(left, x, y, w, h * f, flip, depth + 1, out); slice(right, x, y + h * f, w, h * (1 - f), flip, depth + 1, out) }
}

/** Do two rectangles share a boundary segment of positive length? */
export function touches(a: RectOut, b: RectOut, eps = 1e-9): boolean {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  const nearX = Math.abs(a.x + a.w - b.x) < eps || Math.abs(b.x + b.w - a.x) < eps, nearY = Math.abs(a.y + a.h - b.y) < eps || Math.abs(b.y + b.h - a.y) < eps
  return (nearX && oy > eps) || (nearY && ox > eps)
}

/**
 * Rectangular cartogram by recursive slicing: the regions are cut into two groups of about equal value along their centroid order, and the rectangle is
 * cut in the same proportion, so every area is exactly proportional to the value. The orientation of each cut is chosen at random over `tries` seeds and the
 * layout that keeps the most map neighbours adjacent is returned — a simplification of the van Kreveld–Speckmann approach, which optimises the layout of a
 * rectangular dual with exact adjacency constraints.
 */
export function rectangularCartogram(regions: readonly RegionIn[], neighbours: readonly [string, string][], aspect: number, tries = 64, seed = 1) {
  let best: { rects: RectOut[]; kept: number } | null = null
  const rng = createRng(seed)
  for (let t = 0; t < tries; t++) {
    const bits = Array.from({ length: 64 }, () => (t === 0 ? false : rng() < 0.35))
    const out: RectOut[] = []
    slice([...regions], 0, 0, aspect, 1, (d) => bits[d % 64], 0, out)
    const byId = new Map(out.map((r) => [r.id, r]))
    const kept = neighbours.filter(([a, b]) => { const ra = byId.get(a), rb = byId.get(b); return ra && rb && touches(ra, rb, 1e-7) }).length
    if (!best || kept > best.kept) best = { rects: out, kept }
  }
  return { rects: best!.rects, adjacencyKept: best!.kept, adjacencyTotal: neighbours.length }
}

// ───────────────────────────── Travel-time cartogram ─────────────────────────────

export interface TNode { id: string; x: number; y: number }
export interface TEdge { a: string; b: string; minutes: number }

/** Shortest travel times (Dijkstra) from the origin over an undirected network. */
export function travelTimes(nodes: readonly TNode[], edges: readonly TEdge[], origin: string): Map<string, number> {
  const adj = new Map<string, { to: string; w: number }[]>()
  for (const n of nodes) adj.set(n.id, [])
  for (const e of edges) { adj.get(e.a)?.push({ to: e.b, w: e.minutes }); adj.get(e.b)?.push({ to: e.a, w: e.minutes }) }
  const dist = new Map<string, number>(nodes.map((n) => [n.id, Infinity]))
  dist.set(origin, 0)
  const done = new Set<string>()
  for (;;) {
    let u: string | null = null, du = Infinity
    for (const [k, v] of dist) if (!done.has(k) && v < du) { u = k; du = v }
    if (u == null) break
    done.add(u)
    for (const { to, w } of adj.get(u) ?? []) if (du + w < dist.get(to)!) dist.set(to, du + w)
  }
  return dist
}

/**
 * Radial travel-time cartogram: every place keeps its bearing from the origin but its distance becomes proportional to the travel time. `scale` is the
 * map distance per minute (the median of distance ÷ time over the reachable places keeps the overall size comparable), `blend` 0 → the real map, 1 → the time map.
 */
export function travelCartogram(nodes: readonly TNode[], times: Map<string, number>, origin: string, blend: number) {
  const o = nodes.find((n) => n.id === origin)!
  const ratios = nodes.filter((n) => n.id !== origin && Number.isFinite(times.get(n.id)!) && times.get(n.id)! > 0).map((n) => Math.hypot(n.x - o.x, n.y - o.y) / times.get(n.id)!).sort((p, q) => p - q)
  const scale = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1
  const pos = new Map<string, [number, number]>()
  for (const n of nodes) {
    const dx = n.x - o.x, dy = n.y - o.y, d = Math.hypot(dx, dy)
    const t = times.get(n.id)!
    const target = Number.isFinite(t) && d > 0 ? t * scale : d
    const r = d + (target - d) * blend
    pos.set(n.id, d > 0 ? [o.x + (dx / d) * r, o.y + (dy / d) * r] : [o.x, o.y])
  }
  return { pos, scale }
}

/**
 * Neighbour pairs of a map from its drawn outlines: two regions are neighbours when a vertex of one lies within `tol` of a vertex of the other
 * (a spatial hash of the vertices keeps this near-linear). Islands and regions far apart are never neighbours.
 */
export function adjacencyFromRings(regions: readonly { id: string; rings: readonly (readonly [number, number][])[] }[], tol: number): [string, string][] {
  const cell = (v: number) => Math.floor(v / tol)
  const grid = new Map<string, Set<string>>()
  for (const r of regions) for (const ring of r.rings) for (const [x, y] of ring) {
    const k = `${cell(x)},${cell(y)}`
    if (!grid.has(k)) grid.set(k, new Set())
    grid.get(k)!.add(r.id)
  }
  const pairs = new Set<string>()
  for (const r of regions) for (const ring of r.rings) for (const [x, y] of ring) {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const s = grid.get(`${cell(x) + dx},${cell(y) + dy}`)
      if (!s) continue
      for (const o of s) if (o !== r.id) pairs.add(r.id < o ? `${r.id}\u0000${o}` : `${o}\u0000${r.id}`)
    }
  }
  return [...pairs].map((p) => p.split('\u0000') as [string, string])
}
