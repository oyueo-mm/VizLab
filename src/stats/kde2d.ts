import * as d3 from 'd3'
import { standardDeviation } from './descriptive'

export interface Density2D {
  nx: number
  ny: number
  x0: number
  y0: number
  dx: number
  dy: number
  /** Row-major (y * nx + x) density values f̂(x, y). */
  values: Float64Array
  max: number
  hx: number
  hy: number
}

/** Scott's rule for two dimensions: h = σ · n^(−1/(d+4)) = σ · n^(−1/6), per axis. (Silverman's d = 2 constant is 1, so the rules coincide.) */
export function bandwidth2d(xs: readonly number[], ys: readonly number[]): [number, number] {
  const n = xs.length
  if (n < 2) return [1, 1]
  const f = n ** (-1 / 6)
  return [(standardDeviation(xs) || 1) * f, (standardDeviation(ys) || 1) * f]
}

/**
 * Product Gaussian kernel density estimate on an nx × ny grid:
 *   f̂(x, y) = 1/(n·hx·hy) · Σᵢ φ((x − xᵢ)/hx) · φ((y − yᵢ)/hy).
 * The grid extends `3·h` beyond the data so almost all of the probability mass lies inside it.
 */
export function kde2d(xs: readonly number[], ys: readonly number[], hx: number, hy: number, nx = 80, ny = 80, extent?: { x: [number, number]; y: [number, number] }): Density2D {
  const n = xs.length
  const [xlo, xhi] = extent?.x ?? [d3.min(xs) ?? 0, d3.max(xs) ?? 1]
  const [ylo, yhi] = extent?.y ?? [d3.min(ys) ?? 0, d3.max(ys) ?? 1]
  const x0 = xlo - 3 * hx
  const y0 = ylo - 3 * hy
  const dx = (xhi + 3 * hx - x0) / (nx - 1)
  const dy = (yhi + 3 * hy - y0) / (ny - 1)
  const values = new Float64Array(nx * ny)
  if (!n || !(hx > 0) || !(hy > 0)) return { nx, ny, x0, y0, dx, dy, values, max: 0, hx, hy }
  // The kernel factorises, so evaluate each 1-D factor once: A[i][gx] and B[i][gy].
  const A = new Float64Array(n * nx)
  const B = new Float64Array(n * ny)
  for (let i = 0; i < n; i++) {
    for (let gx = 0; gx < nx; gx++) { const u = (x0 + gx * dx - xs[i]) / hx; A[i * nx + gx] = Math.exp(-0.5 * u * u) }
    for (let gy = 0; gy < ny; gy++) { const u = (y0 + gy * dy - ys[i]) / hy; B[i * ny + gy] = Math.exp(-0.5 * u * u) }
  }
  const norm = 1 / (2 * Math.PI * n * hx * hy)
  let max = 0
  for (let gy = 0; gy < ny; gy++) {
    for (let gx = 0; gx < nx; gx++) {
      let s = 0
      for (let i = 0; i < n; i++) s += A[i * nx + gx] * B[i * ny + gy]
      const v = s * norm
      values[gy * nx + gx] = v
      if (v > max) max = v
    }
  }
  return { nx, ny, x0, y0, dx, dy, values, max, hx, hy }
}

/** Σ f̂ · Δx · Δy — the probability mass inside the grid (≈ 1 when the grid covers the data). */
export function gridMass(d: Density2D) {
  let s = 0
  for (let i = 0; i < d.values.length; i++) s += d.values[i]
  return s * d.dx * d.dy
}

/**
 * Density thresholds of highest-density regions: for each mass p, the level t such that the region
 * {f̂ ≥ t} contains a fraction p of the probability mass (so the p = 0.5 contour encloses half the data).
 */
export function hdrThresholds(d: Density2D, masses: readonly number[]): number[] {
  const sorted = Float64Array.from(d.values).sort().reverse()
  const cell = d.dx * d.dy
  const total = sorted.reduce((s, v) => s + v * cell, 0) || 1
  return masses.map((p) => {
    let acc = 0
    for (let i = 0; i < sorted.length; i++) {
      acc += sorted[i] * cell
      if (acc / total >= p) return sorted[i]
    }
    return sorted[sorted.length - 1] ?? 0
  })
}

/** `count` evenly spaced density levels strictly between 0 and the peak. */
export function equalThresholds(d: Density2D, count: number): number[] {
  return Array.from({ length: count }, (_, i) => (d.max * (i + 1)) / (count + 1))
}

/** Contour polygons for the thresholds, in grid index space (value (i, j) sits at (i + 0.5, j + 0.5)). */
export function contourPolygons(d: Density2D, thresholds: readonly number[]) {
  return d3.contours().size([d.nx, d.ny]).thresholds([...thresholds])(Array.from(d.values))
}
