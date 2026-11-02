/** Engines of the v0.7 scientific and geospatial techniques: line integral convolution, orthographic globe and multi-planar reconstruction. */
import { createRng } from '../lib/random'
import { sample, type Grid3 } from './field3d'

// ───────────────────────────── Vector field sources and LIC ─────────────────────────────

export interface FlowSource { kind: '소용돌이' | '흡입' | '방출' | '균일'; x: number; y: number; strength: number; radius: number }

/** Velocity at (x, y) of a field that is the sum of vortices, sinks, sources and a uniform stream (each with a smoothed core). */
export function fieldAt(sources: readonly FlowSource[], x: number, y: number): [number, number] {
  let u = 0, v = 0
  for (const s of sources) {
    if (s.kind === '균일') { u += s.strength; continue }
    const dx = x - s.x, dy = y - s.y
    const d2 = dx * dx + dy * dy + s.radius * s.radius
    const k = s.strength / d2 * s.radius
    if (s.kind === '소용돌이') { u += -dy * k; v += dx * k }
    else if (s.kind === '방출') { u += dx * k; v += dy * k }
    else { u += -dx * k; v += -dy * k }
  }
  return [u, v]
}

/** Seeded white noise on a w × h grid, values in [0, 1]. */
export function whiteNoise(w: number, h: number, seed = 1): Float32Array {
  const r = createRng(seed)
  const out = new Float32Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = r()
  return out
}

/**
 * Line integral convolution: every pixel averages the noise along the streamline through it, `length` steps of one pixel in each
 * direction (box kernel). Pixels on the same streamline share most of their samples, so intensity is smooth along the flow and
 * uncorrelated across it. `field` gives the velocity in pixel coordinates; the output is stretched to [0, 1].
 */
export function lic(field: (px: number, py: number) => [number, number], noise: Float32Array, w: number, h: number, length: number): Float32Array {
  const out = new Float32Array(w * h)
  const n = (x: number, y: number) => { const i = Math.round(x), j = Math.round(y); return i < 0 || j < 0 || i >= w || j >= h ? -1 : noise[j * w + i] }
  let lo = Infinity, hi = -Infinity
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let sum = noise[j * w + i], cnt = 1
    for (const dir of [1, -1]) {
      let x = i, y = j
      for (let s = 0; s < length; s++) {
        let [u, v] = field(x, y)
        let m = Math.hypot(u, v)
        if (m < 1e-12) break
        // midpoint (RK2) step of one pixel along the unit velocity
        const mx = x + (dir * u) / m * 0.5, my = y + (dir * v) / m * 0.5
        ;[u, v] = field(mx, my)
        m = Math.hypot(u, v)
        if (m < 1e-12) break
        x += (dir * u) / m; y += (dir * v) / m
        const val = n(x, y)
        if (val < 0) break
        sum += val; cnt++
      }
    }
    const val = sum / cnt
    out[j * w + i] = val
    if (val < lo) lo = val
    if (val > hi) hi = val
  }
  if (hi > lo) for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo)
  return out
}

/** Mean absolute difference between horizontal neighbours and between vertical neighbours of an image (anisotropy of the texture). */
export function neighbourContrast(img: Float32Array, w: number, h: number): { alongX: number; alongY: number } {
  let ax = 0, ay = 0, nx = 0, ny = 0
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (i + 1 < w) { ax += Math.abs(img[j * w + i + 1] - img[j * w + i]); nx++ }
    if (j + 1 < h) { ay += Math.abs(img[(j + 1) * w + i] - img[j * w + i]); ny++ }
  }
  return { alongX: ax / Math.max(1, nx), alongY: ay / Math.max(1, ny) }
}

// ───────────────────────────── Orthographic globe ─────────────────────────────

const RAD = Math.PI / 180

export type Vec3 = [number, number, number]

/** Unit vector of a longitude/latitude (degrees): x towards (0°, 0°), y east, z north. */
export const lonLatToVec = (lon: number, lat: number): Vec3 => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)]
export const vecToLonLat = (v: Vec3): [number, number] => [Math.atan2(v[1], v[0]) / RAD, Math.asin(Math.max(-1, Math.min(1, v[2]))) / RAD]

/**
 * Orthographic projection with the globe centred on (lon0, lat0): returns the screen position for radius R (x right, y down) and whether
 * the point is on the visible hemisphere (cos of the angular distance to the centre ≥ 0).
 */
export function orthographic(lon: number, lat: number, lon0: number, lat0: number, R = 1): { x: number; y: number; visible: boolean; cosc: number } {
  const [l, p, l0, p0] = [lon * RAD, lat * RAD, lon0 * RAD, lat0 * RAD]
  const cosc = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l - l0)
  return { x: R * Math.cos(p) * Math.sin(l - l0), y: -R * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l - l0)), visible: cosc >= 0, cosc }
}

/** Inverse of `orthographic`: the longitude/latitude under the screen point, or null outside the disc. */
export function orthographicInvert(x: number, y: number, lon0: number, lat0: number, R = 1): [number, number] | null {
  const px = x / R, py = -y / R
  const rho = Math.hypot(px, py)
  if (rho > 1) return null
  if (rho < 1e-12) return [lon0, lat0]
  const c = Math.asin(rho)
  const p0 = lat0 * RAD
  const lat = Math.asin(Math.cos(c) * Math.sin(p0) + (py * Math.sin(c) * Math.cos(p0)) / rho)
  const lon = lon0 * RAD + Math.atan2(px * Math.sin(c), rho * Math.cos(p0) * Math.cos(c) - py * Math.sin(p0) * Math.sin(c))
  return [((lon / RAD + 540) % 360) - 180, lat / RAD]
}

/** Great-circle (central angle) distance in degrees. */
export const centralAngle = (a: [number, number], b: [number, number]) => {
  const u = lonLatToVec(a[0], a[1]), v = lonLatToVec(b[0], b[1])
  return Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))) / RAD
}

// ───────────────────────────── Multi-planar reconstruction ─────────────────────────────

export type Plane = 'axial' | 'coronal' | 'sagittal'

/**
 * A 2-D section through a volume at world position `pos`: axial = plane z = pos[2] (u = x, v = y), coronal = plane y = pos[1]
 * (u = x, v = z), sagittal = plane x = pos[0] (u = y, v = z). Returns nv rows × nu columns, row 0 at the largest v (top).
 */
export function mprSlice(g: Grid3, plane: Plane, pos: readonly [number, number, number], nu: number, nv: number): number[][] {
  const x1 = g.x0 + (g.nx - 1) * g.dx, y1 = g.y0 + (g.ny - 1) * g.dy, z1 = g.z0 + (g.nz - 1) * g.dz
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  const out: number[][] = []
  for (let r = 0; r < nv; r++) {
    const tv = 1 - (r + 0.5) / nv
    const row: number[] = []
    for (let c = 0; c < nu; c++) {
      const tu = (c + 0.5) / nu
      row.push(plane === 'axial' ? sample(g, lerp(g.x0, x1, tu), lerp(g.y0, y1, tv), pos[2])
        : plane === 'coronal' ? sample(g, lerp(g.x0, x1, tu), pos[1], lerp(g.z0, z1, tv))
          : sample(g, pos[0], lerp(g.y0, y1, tu), lerp(g.z0, z1, tv)))
    }
    out.push(row)
  }
  return out
}
