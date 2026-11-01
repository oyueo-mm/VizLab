import { jacobiEigen } from './pca'

/** 3-D scalar, vector and tensor fields on regular grids; isosurface extraction (marching tetrahedra) and ray marching. */

export type V3 = [number, number, number]

export interface Grid3 {
  nx: number; ny: number; nz: number
  x0: number; y0: number; z0: number
  dx: number; dy: number; dz: number
  /** Scalar samples, index = (k · ny + j) · nx + i; NaN where the table had no row. */
  data: Float64Array
  min: number; max: number
}

const uniqueSorted = (v: readonly number[]) => [...new Set(v.map((x) => Math.round(x * 1e9) / 1e9))].sort((a, b) => a - b)

/** Builds a regular grid from scattered rows (x, y, z, value). Spacing is the smallest gap; rows are snapped to the nearest grid node. */
export function gridFromRows(rows: readonly { x: number; y: number; z: number; v: number }[]): Grid3 | null {
  if (rows.length < 8) return null
  const xs = uniqueSorted(rows.map((r) => r.x)), ys = uniqueSorted(rows.map((r) => r.y)), zs = uniqueSorted(rows.map((r) => r.z))
  if (xs.length < 2 || ys.length < 2 || zs.length < 2) return null
  const step = (a: number[]) => { let m = Infinity; for (let i = 1; i < a.length; i++) m = Math.min(m, a[i] - a[i - 1]); return m }
  const dx = step(xs), dy = step(ys), dz = step(zs)
  const nx = Math.round((xs[xs.length - 1] - xs[0]) / dx) + 1, ny = Math.round((ys[ys.length - 1] - ys[0]) / dy) + 1, nz = Math.round((zs[zs.length - 1] - zs[0]) / dz) + 1
  if (nx * ny * nz > 200000) return null
  const data = new Float64Array(nx * ny * nz).fill(NaN)
  let min = Infinity, max = -Infinity
  for (const r of rows) {
    const i = Math.round((r.x - xs[0]) / dx), j = Math.round((r.y - ys[0]) / dy), k = Math.round((r.z - zs[0]) / dz)
    data[(k * ny + j) * nx + i] = r.v
    if (r.v < min) min = r.v
    if (r.v > max) max = r.v
  }
  for (let i = 0; i < data.length; i++) if (Number.isNaN(data[i])) data[i] = min
  return { nx, ny, nz, x0: xs[0], y0: ys[0], z0: zs[0], dx, dy, dz, data, min, max }
}

export const at = (g: Grid3, i: number, j: number, k: number) => g.data[(k * g.ny + j) * g.nx + i]

/** Trilinear interpolation at a world position; outside the grid returns the minimum. */
export function sample(g: Grid3, x: number, y: number, z: number): number {
  const fx = (x - g.x0) / g.dx, fy = (y - g.y0) / g.dy, fz = (z - g.z0) / g.dz
  if (fx < 0 || fy < 0 || fz < 0 || fx > g.nx - 1 || fy > g.ny - 1 || fz > g.nz - 1) return g.min
  const i = Math.min(g.nx - 2, Math.floor(fx)), j = Math.min(g.ny - 2, Math.floor(fy)), k = Math.min(g.nz - 2, Math.floor(fz))
  const u = fx - i, v = fy - j, w = fz - k
  const c = (a: number, b: number, d: number) => g.data[((k + d) * g.ny + (j + b)) * g.nx + (i + a)]
  return (
    c(0, 0, 0) * (1 - u) * (1 - v) * (1 - w) + c(1, 0, 0) * u * (1 - v) * (1 - w) + c(0, 1, 0) * (1 - u) * v * (1 - w) + c(1, 1, 0) * u * v * (1 - w) +
    c(0, 0, 1) * (1 - u) * (1 - v) * w + c(1, 0, 1) * u * (1 - v) * w + c(0, 1, 1) * (1 - u) * v * w + c(1, 1, 1) * u * v * w
  )
}

export interface Mesh { verts: V3[]; tris: [number, number, number][] }

const CUBE: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]
const TETS: [number, number, number, number][] = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]]

/** Isosurface {f = level} by marching tetrahedra: every cube is cut into six tetrahedra around its main diagonal. Vertices are shared between triangles (keyed by the grid edge they lie on), so a closed surface is a closed mesh. */
export function marchingTetrahedra(g: Grid3, level: number): Mesh {
  const verts: V3[] = [], tris: [number, number, number][] = []
  const cache = new Map<number, number>()
  const nodeId = (i: number, j: number, k: number) => (k * g.ny + j) * g.nx + i
  const vertex = (a: [number, number, number], b: [number, number, number]) => {
    const ia = nodeId(...a), ib = nodeId(...b)
    const key = ia < ib ? ia * 4194304 + ib : ib * 4194304 + ia
    let idx = cache.get(key)
    if (idx === undefined) {
      const fa = g.data[ia], fb = g.data[ib]
      const t = fb === fa ? 0.5 : (level - fa) / (fb - fa)
      verts.push([g.x0 + (a[0] + t * (b[0] - a[0])) * g.dx, g.y0 + (a[1] + t * (b[1] - a[1])) * g.dy, g.z0 + (a[2] + t * (b[2] - a[2])) * g.dz])
      idx = verts.length - 1
      cache.set(key, idx)
    }
    return idx
  }
  for (let k = 0; k < g.nz - 1; k++) for (let j = 0; j < g.ny - 1; j++) for (let i = 0; i < g.nx - 1; i++) {
    const corner = CUBE.map(([a, b, c]) => [i + a, j + b, k + c] as [number, number, number])
    const val = corner.map((c) => g.data[nodeId(...c)])
    if (val.every((v) => v >= level) || val.every((v) => v < level)) continue
    for (const t of TETS) {
      const inside = t.filter((q) => val[q] >= level), outside = t.filter((q) => val[q] < level)
      if (!inside.length || !outside.length) continue
      const e = (p: number, q: number) => vertex(corner[p], corner[q])
      if (inside.length === 1) tris.push([e(inside[0], outside[0]), e(inside[0], outside[1]), e(inside[0], outside[2])])
      else if (inside.length === 3) tris.push([e(outside[0], inside[0]), e(outside[0], inside[1]), e(outside[0], inside[2])])
      else {
        const a = e(inside[0], outside[0]), b = e(inside[0], outside[1]), c = e(inside[1], outside[1]), d = e(inside[1], outside[0])
        tris.push([a, b, c], [a, c, d])
      }
    }
  }
  return { verts, tris }
}

export function meshArea(m: Mesh): number {
  let s = 0
  for (const [a, b, c] of m.tris) {
    const p = m.verts[a], q = m.verts[b], r = m.verts[c]
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]]
    s += 0.5 * Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
  }
  return s
}

/** Counts how many triangles each undirected edge belongs to; a closed manifold surface has exactly 2 for every edge. */
export function edgeUse(m: Mesh): Map<string, number> {
  const e = new Map<string, number>()
  for (const [a, b, c] of m.tris) for (const [p, q] of [[a, b], [b, c], [c, a]] as const) { const k = p < q ? `${p}-${q}` : `${q}-${p}`; e.set(k, (e.get(k) ?? 0) + 1) }
  return e
}

/** Gradient of the scalar field at a world position (central differences of the trilinear interpolant). */
export function gradient(g: Grid3, x: number, y: number, z: number): V3 {
  const hx = g.dx * 0.5, hy = g.dy * 0.5, hz = g.dz * 0.5
  return [(sample(g, x + hx, y, z) - sample(g, x - hx, y, z)) / (2 * hx), (sample(g, x, y + hy, z) - sample(g, x, y - hy, z)) / (2 * hy), (sample(g, x, y, z + hz) - sample(g, x, y, z - hz)) / (2 * hz)]
}

// ─── vector fields ──────────────────────────────────────────────────────────────────

export interface VecGrid { u: Grid3; v: Grid3; w: Grid3 }

export function vecGridFromRows(rows: readonly { x: number; y: number; z: number; a: number; b: number; c: number }[]): VecGrid | null {
  const u = gridFromRows(rows.map((r) => ({ x: r.x, y: r.y, z: r.z, v: r.a }))), v = gridFromRows(rows.map((r) => ({ x: r.x, y: r.y, z: r.z, v: r.b }))), w = gridFromRows(rows.map((r) => ({ x: r.x, y: r.y, z: r.z, v: r.c })))
  return u && v && w ? { u, v, w } : null
}

const sampleOr0 = (g: Grid3, x: number, y: number, z: number) => { const fx = (x - g.x0) / g.dx, fy = (y - g.y0) / g.dy, fz = (z - g.z0) / g.dz; return fx < 0 || fy < 0 || fz < 0 || fx > g.nx - 1 || fy > g.ny - 1 || fz > g.nz - 1 ? NaN : sample(g, x, y, z) }
export const vecAt = (f: VecGrid, p: V3): V3 => [sampleOr0(f.u, ...p), sampleOr0(f.v, ...p), sampleOr0(f.w, ...p)]

/** Streamline by fourth-order Runge–Kutta on the trilinearly interpolated field; stops at the boundary or at a stagnation point. */
export function streamline(f: VecGrid, seed: V3, h: number, steps: number, direction: 1 | -1 = 1): V3[] {
  const out: V3[] = [seed]
  let p = seed
  const F = (q: V3): V3 | null => { const v = vecAt(f, q); if (!Number.isFinite(v[0] + v[1] + v[2])) return null; const m = Math.hypot(...v); return m < 1e-9 ? null : [(direction * v[0]) / m, (direction * v[1]) / m, (direction * v[2]) / m] }
  for (let s = 0; s < steps; s++) {
    const k1 = F(p); if (!k1) break
    const k2 = F([p[0] + (h / 2) * k1[0], p[1] + (h / 2) * k1[1], p[2] + (h / 2) * k1[2]]); if (!k2) break
    const k3 = F([p[0] + (h / 2) * k2[0], p[1] + (h / 2) * k2[1], p[2] + (h / 2) * k2[2]]); if (!k3) break
    const k4 = F([p[0] + h * k3[0], p[1] + h * k3[1], p[2] + h * k3[2]]); if (!k4) break
    p = [p[0] + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]), p[1] + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]), p[2] + (h / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2])]
    out.push(p)
  }
  return out
}

/** Divergence and curl magnitude of the field at a point (central differences). */
export function divCurl(f: VecGrid, p: V3): { div: number; curl: number } {
  const h = f.u.dx * 0.5
  const d = (comp: 'u' | 'v' | 'w', axis: 0 | 1 | 2) => { const a = [...p] as V3, b = [...p] as V3; a[axis] += h; b[axis] -= h; return (sampleOr0(f[comp], ...a) - sampleOr0(f[comp], ...b)) / (2 * h) }
  const cx = d('w', 1) - d('v', 2), cy = d('u', 2) - d('w', 0), cz = d('v', 0) - d('u', 1)
  return { div: d('u', 0) + d('v', 1) + d('w', 2), curl: Math.hypot(cx, cy, cz) }
}

// ─── tensors ────────────────────────────────────────────────────────────────────────

export interface TensorEigen { values: V3; vectors: [V3, V3, V3]; fa: number; trace: number }

/** Eigen-decomposition of a symmetric 3×3 tensor given as (xx, yy, zz, xy, xz, yz), eigenvalues descending, with fractional anisotropy. */
export function tensorEigen(t: readonly number[]): TensorEigen {
  const [xx, yy, zz, xy, xz, yz] = t
  const e = jacobiEigen([[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]])
  const values = e.values as V3
  const m = (values[0] + values[1] + values[2]) / 3
  const ss = values.reduce((a, v) => a + v * v, 0)
  const fa = ss > 0 ? Math.sqrt(1.5 * values.reduce((a, v) => a + (v - m) ** 2, 0) / ss) : 0
  return { values, vectors: e.vectors as [V3, V3, V3], fa, trace: xx + yy + zz }
}

// ─── volume ray marching ────────────────────────────────────────────────────────────

export interface Transfer { center: number; width: number; opacity: number }

/** Optical density per unit of the normalised path length (the volume is rescaled to length 2) for a normalised value s ∈ [0, 1]: a Gaussian bump at `center` that is cut off beyond 3 widths. */
export const opacityOf = (s: number, tf: Transfer) => { const z = (s - tf.center) / Math.max(1e-3, tf.width); return Math.abs(z) > 3 ? 0 : tf.opacity * Math.exp(-0.5 * z * z) }

/**
 * Orthographic front-to-back volume rendering of the grid for the orbit camera (same convention as the 3-D scenes: x1 = x·cos(yaw) − y·sin(yaw) …).
 * Returns RGBA pixels (width × height). Colours come from `color(s)` with s ∈ [0, 1]; `mip` switches to maximum-intensity projection.
 */
export function renderVolume(g: Grid3, view: { yaw: number; pitch: number; zoom: number }, width: number, height: number, tf: Transfer, color: (s: number) => [number, number, number], mip = false, samples = 48): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4)
  const yaw = (view.yaw * Math.PI) / 180, pit = (view.pitch * Math.PI) / 180
  const cy = Math.cos(yaw), sy = Math.sin(yaw), ce = Math.cos(pit), se = Math.sin(pit)
  const ex = [g.x0 + (g.nx - 1) * g.dx / 2, g.y0 + (g.ny - 1) * g.dy / 2, g.z0 + (g.nz - 1) * g.dz / 2]
  const half = [((g.nx - 1) * g.dx) / 2, ((g.ny - 1) * g.dy) / 2, ((g.nz - 1) * g.dz) / 2]
  const rad = Math.hypot(...half)
  const scale = (Math.min(width, height) * 0.46 * view.zoom) / rad
  const span = g.max - g.min || 1
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const sx = (px - width / 2) / scale, su = (height / 2 + height * 0.04 - py) / scale // screen right / up in world-centred units
    let r = 0, gg = 0, b = 0, a = 0, best = -Infinity
    for (let s = 0; s < samples; s++) {
      const d = -rad + (2 * rad * (s + 0.5)) / samples
      const y1 = su * se + d * ce, z = su * ce - d * se
      const x = sx * cy + y1 * sy + ex[0], y = -sx * sy + y1 * cy + ex[1], zz = z + ex[2]
      if (Math.abs(x - ex[0]) > half[0] || Math.abs(y - ex[1]) > half[1] || Math.abs(zz - ex[2]) > half[2]) continue
      const val = (sample(g, x, y, zz) - g.min) / span
      if (mip) { if (val > best) best = val; continue }
      const al = 1 - Math.exp(-opacityOf(val, tf) * (2 / samples))
      if (al <= 0.002) continue
      const [cr, cg, cb] = color(val)
      const w = (1 - a) * al
      r += w * cr; gg += w * cg; b += w * cb; a += w
      if (a > 0.985) break
    }
    const o = (py * width + px) * 4
    if (mip) { const [cr, cg, cb] = best > -Infinity ? color(best) : [255, 255, 255]; const al = best > -Infinity ? Math.min(1, 0.15 + best) : 0; out[o] = 255 * (1 - al) + cr * al; out[o + 1] = 255 * (1 - al) + cg * al; out[o + 2] = 255 * (1 - al) + cb * al; out[o + 3] = 255 }
    else { out[o] = r + 255 * (1 - a); out[o + 1] = gg + 255 * (1 - a); out[o + 2] = b + 255 * (1 - a); out[o + 3] = 255 }
  }
  return out
}
