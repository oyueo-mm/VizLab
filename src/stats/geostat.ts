import { createRng } from '../lib/random'
import { KM_PER_DEG } from './spatial'

/** Geostatistics: empirical and directional semivariograms, model fitting, ordinary kriging, space-time kernel density and case–control density ratios. */

export interface Pt { x: number; y: number; v: number }

const RAD = Math.PI / 180

/** Equirectangular local km coordinates around the centroid of the points (adequate for regional extents). */
export function localKm(points: readonly { lon: number; lat: number }[]) {
  const lon0 = points.reduce((s, p) => s + p.lon, 0) / (points.length || 1), lat0 = points.reduce((s, p) => s + p.lat, 0) / (points.length || 1)
  const k = Math.cos(lat0 * RAD) * KM_PER_DEG
  return {
    to: (lon: number, lat: number): [number, number] => [(lon - lon0) * k, (lat - lat0) * KM_PER_DEG],
    from: (x: number, y: number): [number, number] => [lon0 + x / k, lat0 + y / KM_PER_DEG],
  }
}

export interface VarioBin { h: number; gamma: number; n: number }

/**
 * Empirical semivariogram γ(h) = (1 / 2N(h)) Σ (z_i − z_j)² over the pairs whose distance falls in each lag bin.
 * With `direction` (degrees clockwise from north) only pairs whose separation vector is within ±`tolerance` of that axis (in either sense) count.
 */
export function empiricalVariogram(pts: readonly Pt[], { bins = 15, maxDist, direction, tolerance = 22.5 }: { bins?: number; maxDist?: number; direction?: number; tolerance?: number } = {}): VarioBin[] {
  const n = pts.length
  if (n < 3) return []
  let dmax = maxDist
  if (!dmax) { let m = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) m = Math.max(m, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)); dmax = m / 2 }
  const w = dmax / bins
  const sum = new Array<number>(bins).fill(0), cnt = new Array<number>(bins).fill(0), hs = new Array<number>(bins).fill(0)
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y, d = Math.hypot(dx, dy)
    if (d === 0 || d >= dmax) continue
    if (direction != null) {
      const az = (Math.atan2(dx, dy) / RAD + 360) % 180 // azimuth of the separation, axis not sense
      const diff = Math.min(Math.abs(az - (direction % 180)), 180 - Math.abs(az - (direction % 180)))
      if (diff > tolerance) continue
    }
    const b = Math.min(bins - 1, Math.floor(d / w))
    sum[b] += (pts[i].v - pts[j].v) ** 2; cnt[b]++; hs[b] += d
  }
  return sum.map((s, b) => ({ h: cnt[b] ? hs[b] / cnt[b] : (b + 0.5) * w, gamma: cnt[b] ? s / (2 * cnt[b]) : NaN, n: cnt[b] })).filter((b) => b.n > 0)
}

export type VarioModel = 'spherical' | 'exponential' | 'gaussian'
export interface VarioFit { model: VarioModel; nugget: number; psill: number; range: number; ssr: number }

const shape = (model: VarioModel, u: number) => (model === 'spherical' ? (u >= 1 ? 1 : 1.5 * u - 0.5 * u ** 3) : model === 'exponential' ? 1 - Math.exp(-3 * u) : 1 - Math.exp(-3 * u * u))
/** Model semivariance (practical range for exponential / gaussian: γ reaches 95% of the sill at h = range). */
export const gammaOf = (f: VarioFit, h: number) => (h <= 0 ? 0 : f.nugget + f.psill * shape(f.model, h / f.range))

/** Weighted least-squares fit (weights N(h)/γ_model(h)², Cressie 1985): for each candidate range the nugget and partial sill follow from a 2-parameter linear regression. */
export function fitVariogram(bins: readonly VarioBin[], model: VarioModel): VarioFit | null {
  const b = bins.filter((x) => Number.isFinite(x.gamma) && x.n > 0)
  if (b.length < 3) return null
  const hmax = Math.max(...b.map((x) => x.h))
  let best: VarioFit | null = null
  for (let r = hmax * 0.1; r <= hmax * 2.5; r += hmax * 0.01) {
    // γ ≈ c0 + c1 · g(h/r); weights from the empirical γ (iteratively reweighted once)
    let c0 = 0, c1 = Math.max(...b.map((x) => x.gamma))
    for (let pass = 0; pass < 3; pass++) {
      let sw = 0, sg = 0, sy = 0, sgg = 0, sgy = 0
      for (const x of b) {
        const g = shape(model, x.h / r), pred = Math.max(1e-9, c0 + c1 * g), w = x.n / (pred * pred)
        sw += w; sg += w * g; sy += w * x.gamma; sgg += w * g * g; sgy += w * g * x.gamma
      }
      const det = sw * sgg - sg * sg
      if (Math.abs(det) < 1e-18) break
      c1 = (sw * sgy - sg * sy) / det; c0 = (sy - c1 * sg) / sw
      if (c0 < 0) { c0 = 0; c1 = sgy / Math.max(sgg, 1e-18) }
      if (c1 < 0) { c1 = 0; c0 = sy / sw }
    }
    const ssr = b.reduce((s, x) => { const pred = Math.max(1e-9, c0 + c1 * shape(model, x.h / r)); return s + (x.n / (pred * pred)) * (x.gamma - pred) ** 2 }, 0)
    if (!best || ssr < best.ssr) best = { model, nugget: c0, psill: c1, range: r, ssr }
  }
  return best
}

/** Fits only the range with the nugget and partial sill held fixed (the usual way to compare directions: same sill, different range). */
export function fitRange(bins: readonly VarioBin[], model: VarioModel, nugget: number, psill: number): VarioFit | null {
  const b = bins.filter((x) => Number.isFinite(x.gamma) && x.n > 0)
  if (b.length < 3) return null
  const hmax = Math.max(...b.map((x) => x.h))
  let best: VarioFit | null = null
  for (let r = hmax * 0.08; r <= hmax * 4; r += hmax * 0.01) {
    const ssr = b.reduce((s, x) => { const pred = Math.max(1e-9, nugget + psill * shape(model, x.h / r)); return s + x.n * ((x.gamma - pred) / pred) ** 2 }, 0)
    if (!best || ssr < best.ssr) best = { model, nugget, psill, range: r, ssr }
  }
  return best
}

function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-12) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k] }
  }
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r] }
  return x
}

/** Ordinary kriging prediction and kriging variance at (x, y) from the k nearest samples: weights solve [Γ 1; 1ᵀ 0][w; μ] = [γ₀; 1]. */
export function krige(pts: readonly Pt[], fit: VarioFit, x: number, y: number, k = 12): { pred: number; variance: number } {
  const near = pts.map((p, i) => ({ i, d: Math.hypot(p.x - x, p.y - y) })).sort((a, b) => a.d - b.d).slice(0, Math.min(k, pts.length))
  if (near[0].d < 1e-9) return { pred: pts[near[0].i].v, variance: 0 }
  const m = near.length
  const A: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(m + 1).fill(1))
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) A[i][j] = gammaOf(fit, Math.hypot(pts[near[i].i].x - pts[near[j].i].x, pts[near[i].i].y - pts[near[j].i].y))
  A[m][m] = 0
  const rhs = [...near.map((q) => gammaOf(fit, q.d)), 1]
  const sol = solve(A, rhs)
  if (!sol) return { pred: NaN, variance: NaN }
  let pred = 0, variance = sol[m]
  for (let i = 0; i < m; i++) { pred += sol[i] * pts[near[i].i].v; variance += sol[i] * rhs[i] }
  return { pred, variance: Math.max(0, variance) }
}

/** A Gaussian random field with an exponential covariance (practical range `range`, optional anisotropy: `ratio` < 1 shortens the range perpendicular to `angle` degrees from north). Cholesky simulation at the given points. */
export function simulateField(coords: readonly [number, number][], { sill = 1, nugget = 0.05, range = 120, ratio = 1, angle = 0, seed = 1, mean = 0 }: { sill?: number; nugget?: number; range?: number; ratio?: number; angle?: number; seed?: number; mean?: number } = {}): number[] {
  const n = coords.length
  const a = angle * RAD
  const cov = (i: number, j: number) => {
    if (i === j) return sill + nugget
    const dx = coords[i][0] - coords[j][0], dy = coords[i][1] - coords[j][1]
    const along = dx * Math.sin(a) + dy * Math.cos(a), across = dx * Math.cos(a) - dy * Math.sin(a)
    return sill * Math.exp(-3 * Math.hypot(along, across / ratio) / range)
  }
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = cov(i, j)
    for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]
    L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-9)) : s / L[j][j]
  }
  const rng = createRng(seed)
  const e = Array.from({ length: n }, () => rng.normal())
  return Array.from({ length: n }, (_, i) => mean + L[i].reduce((s, v, k) => s + v * e[k], 0))
}

// ─── space-time kernel density ──────────────────────────────────────────────────────

export interface STEvent { x: number; y: number; t: number }

/** f(x, y, t) = (1/n) Σ K_hs(‖s − s_i‖) · K_ht(t − t_i) with a 2-D Gaussian spatial kernel and a 1-D Gaussian temporal kernel; integrates to 1 over (x, y, t). */
export function stDensity(events: readonly STEvent[], hs: number, ht: number, x: number, y: number, t: number): number {
  let s = 0
  const cs = 1 / (2 * Math.PI * hs * hs), ct = 1 / (Math.sqrt(2 * Math.PI) * ht)
  for (const e of events) {
    const dt = (t - e.t) / ht
    if (Math.abs(dt) > 4) continue
    const d2 = ((x - e.x) ** 2 + (y - e.y) ** 2) / (hs * hs)
    if (d2 > 16) continue
    s += cs * Math.exp(-0.5 * d2) * ct * Math.exp(-0.5 * dt * dt)
  }
  return s / events.length
}

/** Temporal marginal intensity λ(t) = (1/n) Σ K_ht(t − t_i) (events per unit time per event). */
export const timeDensity = (events: readonly STEvent[], ht: number, t: number) => events.reduce((s, e) => s + Math.exp(-0.5 * ((t - e.t) / ht) ** 2), 0) / (events.length * Math.sqrt(2 * Math.PI) * ht)

// ─── case–control density ratio ─────────────────────────────────────────────────────

export function kde2(points: readonly { x: number; y: number }[], h: number, x: number, y: number): number {
  let s = 0
  const c = 1 / (2 * Math.PI * h * h)
  for (const p of points) { const d2 = ((x - p.x) ** 2 + (y - p.y) ** 2) / (h * h); if (d2 < 16) s += Math.exp(-0.5 * d2) }
  return (s * c) / (points.length || 1)
}

/** Log relative risk log(f_cases / f_controls) on a grid (Kelsall & Diggle 1995) and pointwise permutation p-values from random relabelling of the pooled points. */
export function densityRatio(cases: readonly { x: number; y: number }[], controls: readonly { x: number; y: number }[], h: number, gx: readonly number[], gy: readonly number[], perms = 0, seed = 1) {
  // a small relative floor (1% of the largest control density) keeps the ratio finite where both densities vanish
  const nodes = gy.flatMap((y) => gx.map((x) => ({ x, y })))
  const floor = 0.01 * Math.max(...nodes.map((n) => kde2(controls, h, n.x, n.y)), 1e-300)
  const lr = (a: readonly { x: number; y: number }[], b: readonly { x: number; y: number }[]) => nodes.map((n) => Math.log((kde2(a, h, n.x, n.y) + floor) / (kde2(b, h, n.x, n.y) + floor)))
  const obs = lr(cases, controls)
  const p = new Array<number>(obs.length).fill(NaN)
  if (perms > 0) {
    const pool = [...cases, ...controls]
    const rng = createRng(seed)
    const ge = new Array<number>(obs.length).fill(0), le = new Array<number>(obs.length).fill(0)
    for (let s = 0; s < perms; s++) {
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]] }
      const sim = lr(pool.slice(0, cases.length), pool.slice(cases.length))
      for (let i = 0; i < obs.length; i++) { if (sim[i] >= obs[i]) ge[i]++; if (sim[i] <= obs[i]) le[i]++ }
    }
    for (let i = 0; i < obs.length; i++) p[i] = (Math.min(ge[i], le[i]) * 2 + 1) / (perms + 1)
  }
  return { logRatio: obs, p }
}

/** Moran scatterplot coordinates: standardised value z and the spatial lag Wz (row-standardised neighbour mean of z). The slope of Wz on z equals Moran's I when Σw = n. */
export function moranScatter(values: readonly number[], nb: readonly (readonly number[])[]) {
  const n = values.length
  const m = values.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / n) || 1
  const z = values.map((v) => (v - m) / sd)
  const lag = z.map((_, i) => (nb[i].length ? nb[i].reduce((s, j) => s + z[j], 0) / nb[i].length : NaN))
  const ok = z.map((_, i) => i).filter((i) => Number.isFinite(lag[i]))
  const sxy = ok.reduce((s, i) => s + z[i] * lag[i], 0), sxx = ok.reduce((s, i) => s + z[i] * z[i], 0)
  return { z, lag, slope: sxx > 0 ? sxy / sxx : NaN }
}
