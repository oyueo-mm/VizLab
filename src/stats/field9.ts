import { createRng } from '../lib/random'
import { gridFromRows, sample, tensorEigen, type Grid3, type V3 } from './field3d'

export type Pt = [number, number]

// ───────────────────────────── Image-based flow visualization (IBFV) ─────────────────────────────

export interface Field2 { nx: number; ny: number; x0: number; y0: number; x1: number; y1: number; u: Float32Array; v: Float32Array; maxSpeed: number; /** typical speed (90th percentile): the speed that moves a pixel by `pixelsPerStep` */ refSpeed: number }

/** Regular 2-D vector field from rows (x, y, u, v). */
export function field2FromRows(rows: readonly { x: number; y: number; u: number; v: number }[]): Field2 | null {
  if (rows.length < 4) return null
  const uniq = (a: number[]) => [...new Set(a.map((x) => Math.round(x * 1e9) / 1e9))].sort((p, q) => p - q)
  const xs = uniq(rows.map((r) => r.x)), ys = uniq(rows.map((r) => r.y))
  if (xs.length < 2 || ys.length < 2) return null
  const nx = xs.length, ny = ys.length
  const u = new Float32Array(nx * ny), v = new Float32Array(nx * ny)
  const xi = new Map(xs.map((x, i) => [x, i])), yi = new Map(ys.map((y, j) => [y, j]))
  let maxSpeed = 0
  for (const r of rows) {
    const i = xi.get(Math.round(r.x * 1e9) / 1e9), j = yi.get(Math.round(r.y * 1e9) / 1e9)
    if (i === undefined || j === undefined) continue
    u[j * nx + i] = r.u; v[j * nx + i] = r.v
    maxSpeed = Math.max(maxSpeed, Math.hypot(r.u, r.v))
  }
  const speeds = [...u].map((a, i) => Math.hypot(a, v[i])).sort((a, b) => a - b)
  return { nx, ny, x0: xs[0], y0: ys[0], x1: xs[nx - 1], y1: ys[ny - 1], u, v, maxSpeed, refSpeed: speeds[Math.floor(speeds.length * 0.9)] || maxSpeed }
}

/** Bilinear velocity at a world position (clamped to the field's box). */
export function sampleField2(f: Field2, x: number, y: number): Pt {
  const fx = Math.min(f.nx - 1, Math.max(0, ((x - f.x0) / (f.x1 - f.x0)) * (f.nx - 1))), fy = Math.min(f.ny - 1, Math.max(0, ((y - f.y0) / (f.y1 - f.y0)) * (f.ny - 1)))
  const i = Math.min(f.nx - 2, Math.floor(fx)), j = Math.min(f.ny - 2, Math.floor(fy)), a = fx - i, b = fy - j
  const g = (arr: Float32Array) => arr[j * f.nx + i] * (1 - a) * (1 - b) + arr[j * f.nx + i + 1] * a * (1 - b) + arr[(j + 1) * f.nx + i] * (1 - a) * b + arr[(j + 1) * f.nx + i + 1] * a * b
  return [g(f.u), g(f.v)]
}

/** Smooth noise texture: random values on a coarse lattice (cell pixels apart), bilinearly interpolated. */
export function makeNoise(w: number, h: number, cell: number, seed: number): Float32Array {
  const r = createRng(seed)
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2
  const lat = Float32Array.from({ length: gw * gh }, () => (r() < 0.5 ? 0 : 1))
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = x / cell, fy = y / cell, i = Math.floor(fx), j = Math.floor(fy), a = fx - i, b = fy - j
    out[y * w + x] = lat[j * gw + i] * (1 - a) * (1 - b) + lat[j * gw + i + 1] * a * (1 - b) + lat[(j + 1) * gw + i] * (1 - a) * b + lat[(j + 1) * gw + i + 1] * a * b
  }
  return out
}

const bilinear = (t: Float32Array, w: number, h: number, x: number, y: number) => {
  const cx = Math.min(w - 1, Math.max(0, x)), cy = Math.min(h - 1, Math.max(0, y))
  const i = Math.min(w - 2, Math.floor(cx)), j = Math.min(h - 2, Math.floor(cy)), a = cx - i, b = cy - j
  return t[j * w + i] * (1 - a) * (1 - b) + t[j * w + i + 1] * a * (1 - b) + t[(j + 1) * w + i] * (1 - a) * b + t[(j + 1) * w + i + 1] * a * b
}

/**
 * One IBFV step: the previous image is advected (each pixel takes the value found one step upstream along the flow), then a little new noise is
 * blended in. `pixelsPerStep` is the distance the fastest flow moves per step; image y points down while the field's y points up.
 */
export function ibfvStep(prev: Float32Array, w: number, h: number, field: Field2, noise: Float32Array, pixelsPerStep: number, alpha: number): Float32Array {
  const out = new Float32Array(w * h)
  const pxX = w / (field.x1 - field.x0), pxY = h / (field.y1 - field.y0)
  const dt = field.refSpeed > 0 ? pixelsPerStep / (field.refSpeed * Math.max(pxX, pxY)) : 0
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const wx = field.x0 + ((px + 0.5) / w) * (field.x1 - field.x0), wy = field.y1 - ((py + 0.5) / h) * (field.y1 - field.y0)
    const [u, v] = sampleField2(field, wx, wy)
    // flow velocity in pixels per step: x as is, y flipped (image y points down)
    const sx = u * dt * pxX, sy = v * dt * pxY
    const back = bilinear(prev, w, h, px - sx, py + sy)
    out[py * w + px] = (1 - alpha) * back + alpha * noise[py * w + px]
  }
  return out
}

// ───────────────────────────── Hyperstreamlines ─────────────────────────────

export interface TensorField { comps: Grid3[] }

/** Six scalar grids (xx, yy, zz, xy, xz, yz) from rows. */
export function tensorFieldFromRows(rows: readonly { x: number; y: number; z: number; t: readonly number[] }[]): TensorField | null {
  const comps: Grid3[] = []
  for (let c = 0; c < 6; c++) {
    const g = gridFromRows(rows.map((r) => ({ x: r.x, y: r.y, z: r.z, v: r.t[c] })))
    if (!g) return null
    comps.push(g)
  }
  return { comps }
}

export const tensorAt = (f: TensorField, p: V3): number[] => f.comps.map((g) => sample(g, p[0], p[1], p[2]))
const inside = (g: Grid3, p: V3) => p[0] >= g.x0 && p[1] >= g.y0 && p[2] >= g.z0 && p[0] <= g.x0 + (g.nx - 1) * g.dx && p[1] <= g.y0 + (g.ny - 1) * g.dy && p[2] <= g.z0 + (g.nz - 1) * g.dz
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

export interface HyperSample { p: V3; /** eigenvalues, descending */ values: V3; /** eigenvectors matching `values` */ vectors: [V3, V3, V3]; /** index of the traced eigenvector (0 = major) */ axis: 0 | 1 | 2 }

/** Eigenvector `axis` of the interpolated tensor with its sign chosen to continue `ref` (eigenvectors have no sign of their own). */
function eigenAt(f: TensorField, p: V3, axis: 0 | 1 | 2, ref: V3 | null) {
  const e = tensorEigen(tensorAt(f, p))
  const vecs = e.vectors.map((v) => (ref && dot(v, ref) < 0 ? ([-v[0], -v[1], -v[2]] as V3) : v)) as [V3, V3, V3]
  // keep the traced axis aligned with ref; the other two align among themselves later
  return { values: e.values, vectors: vecs, dir: vecs[axis] }
}

/** Traces a hyperstreamline along eigenvector `axis` from `seed` in both directions (RK2 midpoint, stops at the boundary or where the tensor is isotropic). */
export function hyperstreamline(f: TensorField, seed: V3, axis: 0 | 1 | 2, h: number, steps: number): HyperSample[] {
  const g = f.comps[0]
  const trace = (sign: 1 | -1, first: V3 | null): HyperSample[] => {
    const out: HyperSample[] = []
    let p = seed
    let ref: V3 | null = first
    for (let s = 0; s < steps; s++) {
      if (!inside(g, p)) break
      const e = eigenAt(f, p, axis, ref)
      if (e.values[0] - e.values[2] < 1e-6) break
      let dir = e.dir
      if (!ref) dir = [dir[0] * sign, dir[1] * sign, dir[2] * sign]
      out.push({ p, values: e.values, vectors: e.vectors, axis })
      const mid: V3 = [p[0] + (dir[0] * h) / 2, p[1] + (dir[1] * h) / 2, p[2] + (dir[2] * h) / 2]
      const e2 = eigenAt(f, mid, axis, dir)
      p = [p[0] + e2.dir[0] * h, p[1] + e2.dir[1] * h, p[2] + e2.dir[2] * h]
      ref = e2.dir
    }
    return out
  }
  const fwd = trace(1, null)
  const e0 = fwd.length ? fwd[0].vectors[axis] : null
  const back = e0 ? trace(-1, [-e0[0], -e0[1], -e0[2]]) : []
  return [...back.slice(1).reverse(), ...fwd]
}

export interface HyperTube { rings: V3[][]; quads: { a: [number, number]; b: [number, number]; c: [number, number]; d: [number, number] }[]; /** semi-axes of the cross-section at each sample (the two eigenvalues not traced) */ axes: [number, number][] }

/** Elliptic tube along the line: the cross-section lies in the plane of the other two eigenvectors with semi-axes proportional to their eigenvalues. */
export function hypertube(line: readonly HyperSample[], scale: number, sides: number): HyperTube {
  const rings: V3[][] = [], axes: [number, number][] = []
  let prevA: V3 | null = null
  for (const s of line) {
    const idx = [0, 1, 2].filter((i) => i !== s.axis)
    const lam = [s.values[idx[0]], s.values[idx[1]]]
    let a = s.vectors[idx[0]]
    if (prevA && dot(a, prevA) < 0) a = [-a[0], -a[1], -a[2]]
    prevA = a
    const t = s.vectors[s.axis]
    // second axis: perpendicular to both the tangent and `a` so that the pair stays a right-handed, twist-free frame
    const b: V3 = [t[1] * a[2] - t[2] * a[1], t[2] * a[0] - t[0] * a[2], t[0] * a[1] - t[1] * a[0]]
    const ra = Math.max(1e-4, lam[0]) * scale, rb = Math.max(1e-4, lam[1]) * scale
    axes.push([ra, rb])
    rings.push(Array.from({ length: sides }, (_, k) => {
      const th = (2 * Math.PI * k) / sides
      const ca = Math.cos(th) * ra, sb = Math.sin(th) * rb
      return [s.p[0] + a[0] * ca + b[0] * sb, s.p[1] + a[1] * ca + b[1] * sb, s.p[2] + a[2] * ca + b[2] * sb] as V3
    }))
  }
  const quads: HyperTube['quads'] = []
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < sides; j++) quads.push({ a: [i, j], b: [i + 1, j], c: [i + 1, (j + 1) % sides], d: [i, (j + 1) % sides] })
  return { rings, quads, axes }
}

// ───────────────────────────── Fiber surfaces ─────────────────────────────

export interface FiberMesh { verts: V3[]; /** range (f1, f2) of each vertex, interpolated along the tetrahedron edge it lies on */ range: Pt[]; tris: [number, number, number][] }

const CUBE_PTS: V3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]
const CUBE_TETS: [number, number, number, number][] = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]]

interface CV { p: V3; r: Pt; t: number }

/**
 * Fiber surface of the bivariate field (f1, f2) for a closed polygon in the range plane: the set of points whose range value lies on the
 * polygon's boundary. Every polygon edge contributes the plane {n·(f − a) = 0} inside each tetrahedron, clipped to the edge's extent
 * 0 ≤ d·(f − a)/|d|² ≤ 1 (Carr et al.: piecewise-linear fibers per tetrahedron).
 */
export function fiberSurface(f1: Grid3, f2: Grid3, polygon: readonly Pt[], maxCells = 60000): FiberMesh {
  const verts: V3[] = [], range: Pt[] = [], tris: [number, number, number][] = []
  const edges = polygon.map((a, i) => [a, polygon[(i + 1) % polygon.length]] as [Pt, Pt])
  const at = (g: Grid3, i: number, j: number, k: number) => g.data[(k * g.ny + j) * g.nx + i]
  let cells = 0
  for (let k = 0; k < f1.nz - 1; k++) for (let j = 0; j < f1.ny - 1; j++) for (let i = 0; i < f1.nx - 1; i++) {
    if (++cells > maxCells) return { verts, range, tris }
    const corner = CUBE_PTS.map(([a, b, c]) => ({ p: [f1.x0 + (i + a) * f1.dx, f1.y0 + (j + b) * f1.dy, f1.z0 + (k + c) * f1.dz] as V3, r: [at(f1, i + a, j + b, k + c), at(f2, i + a, j + b, k + c)] as Pt }))
    // quick reject: the cube's range box must touch the polygon's box
    for (const tet of CUBE_TETS) {
      const tv = tet.map((q) => corner[q])
      for (const [a, b] of edges) {
        const d: Pt = [b[0] - a[0], b[1] - a[1]]
        const dd = d[0] * d[0] + d[1] * d[1]
        if (dd < 1e-18) continue
        const vs = tv.map((c) => ({ ...c, g: -d[1] * (c.r[0] - a[0]) + d[0] * (c.r[1] - a[1]), t: (d[0] * (c.r[0] - a[0]) + d[1] * (c.r[1] - a[1])) / dd }))
        // plane g = 0 inside the tetrahedron: points where g changes sign on an edge
        const pts: CV[] = []
        const pairs: [number, number][] = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]
        const pos = vs.filter((v) => v.g > 0).length
        if (pos === 0 || pos === 4) continue
        for (const [p, q] of pairs) {
          const A = vs[p], B = vs[q]
          if ((A.g > 0) === (B.g > 0)) continue
          const s = A.g / (A.g - B.g)
          pts.push({ p: [A.p[0] + (B.p[0] - A.p[0]) * s, A.p[1] + (B.p[1] - A.p[1]) * s, A.p[2] + (B.p[2] - A.p[2]) * s], r: [A.r[0] + (B.r[0] - A.r[0]) * s, A.r[1] + (B.r[1] - A.r[1]) * s], t: A.t + (B.t - A.t) * s })
        }
        // order the 3 or 4 intersection points around the polygon (a quad when two vertices are on each side)
        let poly = pts
        if (poly.length === 4) poly = orderQuad(pts)
        // clip against t ≥ 0 and t ≤ 1
        poly = clipT(poly, (v) => v.t); poly = clipT(poly, (v) => 1 - v.t)
        if (poly.length < 3) continue
        const base = verts.length
        poly.forEach((v) => { verts.push(v.p); range.push(v.r) })
        for (let m = 1; m < poly.length - 1; m++) tris.push([base, base + m, base + m + 1])
      }
    }
  }
  return { verts, range, tris }
}

/** The four intersection points of a tetrahedron with a plane lie on a quadrilateral; return them in cyclic order. */
function orderQuad(p: CV[]): CV[] {
  // the points come from edges (0,1)(0,2)(0,3)(1,2)(1,3)(2,3) sign-changing ones; for the 2-2 case the cyclic order alternates, found by centroid angle
  const c: V3 = [0, 0, 0]
  p.forEach((v) => { c[0] += v.p[0] / 4; c[1] += v.p[1] / 4; c[2] += v.p[2] / 4 })
  const n = cross(sub(p[1].p, p[0].p), sub(p[2].p, p[0].p))
  const u = sub(p[0].p, c), w = cross(n, u)
  const ang = (v: CV) => Math.atan2(dot(sub(v.p, c), w), dot(sub(v.p, c), u))
  return [...p].sort((a, b) => ang(a) - ang(b))
}
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/** Sutherland–Hodgman clip of a convex polygon to `f(v) ≥ 0`, interpolating position, range and t linearly. */
function clipT(poly: CV[], f: (v: CV) => number): CV[] {
  const out: CV[] = []
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length]
    const fa = f(A), fb = f(B)
    if (fa >= 0) out.push(A)
    if ((fa >= 0) !== (fb >= 0)) {
      const s = fa / (fa - fb)
      out.push({ p: [A.p[0] + (B.p[0] - A.p[0]) * s, A.p[1] + (B.p[1] - A.p[1]) * s, A.p[2] + (B.p[2] - A.p[2]) * s], r: [A.r[0] + (B.r[0] - A.r[0]) * s, A.r[1] + (B.r[1] - A.r[1]) * s], t: A.t + (B.t - A.t) * s })
    }
  }
  return out
}

/** Distance from a range point to the polygon boundary. */
export function distToPolygon(pt: Pt, polygon: readonly Pt[]): number {
  let best = Infinity
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length]
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
    best = Math.min(best, Math.hypot(pt[0] - (a[0] + t * dx), pt[1] - (a[1] + t * dy)))
  }
  return best
}
