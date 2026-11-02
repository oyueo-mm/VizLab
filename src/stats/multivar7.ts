/** Layout engines of the v0.7 multivariate / high-dimensional techniques. Every function is pure and tested against its defining property. */
import { createRng } from '../lib/random'

export type Matrix = number[][]

/** Scales every column to [0, 1] (min–max) or to z-scores mapped through a logistic-free clamp [-2.5, 2.5] → [0, 1]. */
export function normalizeColumns(X: Matrix, mode: 'minmax' | 'zscore' = 'minmax'): Matrix {
  const d = X[0]?.length ?? 0
  const out = X.map((r) => r.slice())
  for (let j = 0; j < d; j++) {
    const col = X.map((r) => r[j])
    if (mode === 'minmax') {
      const lo = Math.min(...col), hi = Math.max(...col)
      for (const r of out) r[j] = hi > lo ? (r[j] - lo) / (hi - lo) : 0.5
    } else {
      const m = col.reduce((a, b) => a + b, 0) / col.length
      const s = Math.sqrt(col.reduce((a, b) => a + (b - m) ** 2, 0) / col.length) || 1
      for (const r of out) r[j] = Math.min(1, Math.max(0, ((r[j] - m) / s + 2.5) / 5))
    }
  }
  return out
}

/** Anchor angle of dimension j of d on the unit circle (first anchor at the top, clockwise). */
export const anchorAngle = (j: number, d: number) => (2 * Math.PI * j) / d - Math.PI / 2

/** RadViz: each observation sits at the weighted mean of the anchors, weights being its (non-negative) normalized values. */
export function radviz(Xn: Matrix, angles: readonly number[]): [number, number][] {
  return Xn.map((row) => {
    let sum = 0, x = 0, y = 0
    row.forEach((v, j) => { sum += v; x += v * Math.cos(angles[j]); y += v * Math.sin(angles[j]) })
    return sum > 1e-12 ? [x / sum, y / sum] : [0, 0]
  })
}

/** Star coordinates: the sum of each normalized value times the 2-D axis vector, scaled so that the largest point fits the unit disc. */
export function starCoordinates(Xn: Matrix, axes: readonly [number, number][], weights?: readonly number[]): [number, number][] {
  const raw = Xn.map((row) => {
    let x = 0, y = 0
    row.forEach((v, j) => { const w = weights?.[j] ?? 1; x += (v - 0.5) * w * axes[j][0]; y += (v - 0.5) * w * axes[j][1] })
    return [x, y] as [number, number]
  })
  // Fixed scale (not data dependent) so dragging one axis does not rescale the others.
  const bound = axes.reduce((a, v, j) => a + 0.5 * (weights?.[j] ?? 1) * Math.hypot(v[0], v[1]), 0) || 1
  return raw.map(([x, y]) => [x / bound, y / bound])
}

/** Unit axis vectors for star coordinates, evenly spread on the circle. */
export const defaultAxes = (d: number): [number, number][] => Array.from({ length: d }, (_, j) => [Math.cos(anchorAngle(j, d)), Math.sin(anchorAngle(j, d))])

/** Gram–Schmidt on two vectors of R^d: returns an orthonormal 2-frame. */
export function orthonormalFrame(a: readonly number[], b: readonly number[]): [number[], number[]] {
  const na = Math.hypot(...a) || 1
  const u = a.map((v) => v / na)
  const dot = b.reduce((s, v, i) => s + v * u[i], 0)
  const w = b.map((v, i) => v - dot * u[i])
  const nw = Math.hypot(...w) || 1
  return [u, w.map((v) => v / nw)]
}

const smooth = (t: number) => t * t * (3 - 2 * t)

/**
 * Grand tour: a continuous path of 2-D orthonormal projections of R^d. Random waypoint frames (seeded) are connected by interpolating the
 * frames with a smooth ease and re-orthonormalizing, so every instant of the tour is a valid orthogonal projection.
 * `t` is measured in segments (t = 2.5 is halfway between waypoints 2 and 3).
 */
export function tourFrame(d: number, t: number, seed = 1): [number[], number[]] {
  const waypoint = (k: number) => {
    const r = createRng(seed * 7919 + k * 104729)
    return orthonormalFrame(Array.from({ length: d }, () => r.normal()), Array.from({ length: d }, () => r.normal()))
  }
  const k = Math.floor(t)
  const s = smooth(t - k)
  const A = waypoint(k), B = waypoint(k + 1)
  // Align the sign of B to A so the interpolation takes the short way round instead of passing through zero.
  const flip = (i: number) => (A[i].reduce((sum, v, j) => sum + v * B[i][j], 0) < 0 ? -1 : 1)
  const f0 = flip(0), f1 = flip(1)
  return orthonormalFrame(A[0].map((v, j) => (1 - s) * v + s * f0 * B[0][j]), A[1].map((v, j) => (1 - s) * v + s * f1 * B[1][j]))
}

export const project = (X: Matrix, frame: readonly [number[], number[]]): [number, number][] =>
  X.map((r) => [r.reduce((s, v, j) => s + v * frame[0][j], 0), r.reduce((s, v, j) => s + v * frame[1][j], 0)])

/** Equal-width bin index of v in [0, 1] among k bins. */
export const binOf = (v: number, k: number) => Math.min(k - 1, Math.max(0, Math.floor(v * k)))

export interface StackCell { cx: number; cy: number; count: number; mean: number; rows: number[] }

/**
 * Dimensional stacking: variables (already ordered) alternate between the horizontal and the vertical axis and are nested
 * from the outermost to the innermost, `bins` equal-width bins each. Returns the grid size and the occupied cells.
 */
export function dimensionalStacking(Xn: Matrix, order: readonly number[], bins: number, value: readonly number[], firstHorizontal = true) {
  const cells = new Map<string, StackCell>()
  const nx = order.filter((_, i) => (i % 2 === 0) === firstHorizontal).length
  const ny = order.length - nx
  Xn.forEach((row, r) => {
    let cx = 0, cy = 0
    order.forEach((v, i) => {
      const b = binOf(row[v], bins)
      if ((i % 2 === 0) === firstHorizontal) cx = cx * bins + b
      else cy = cy * bins + b
    })
    const key = `${cx},${cy}`
    const c = cells.get(key) ?? { cx, cy, count: 0, mean: 0, rows: [] }
    c.mean = (c.mean * c.count + value[r]) / (c.count + 1)
    c.count++
    c.rows.push(r)
    cells.set(key, c)
  })
  return { cols: bins ** nx, rows: bins ** ny, cells: [...cells.values()] }
}

/**
 * Focus+context row layout of the table lens: rows in `focus` get `focusH` pixels, all others share the rest equally (at least `minH`).
 * Returns the top offset and height of each row; the heights sum to `total` unless the focus rows alone do not fit.
 */
export function lensLayout(n: number, focus: ReadonlySet<number>, total: number, focusH: number, minH = 1): { top: number[]; height: number[] } {
  const f = [...focus].filter((i) => i >= 0 && i < n).length
  const rest = n - f
  const free = Math.max(0, total - f * focusH)
  const base = rest > 0 ? Math.max(minH, free / rest) : 0
  const height: number[] = []
  const top: number[] = []
  let y = 0
  for (let i = 0; i < n; i++) {
    const h = focus.has(i) ? focusH : base
    top.push(y); height.push(h); y += h
  }
  return { top, height }
}

/**
 * Recursive pattern: `levels[0]` is the innermost [w, h] block of records; each next level arranges the blocks of the level before it on
 * a w × h grid. Records i = 0.. are placed so neighbours in the order stay neighbours; returns the pixel (x, y) of record i. Cells are
 * filled in a left-to-right, then top-to-bottom order (`snake` reverses every second row, which keeps consecutive records adjacent).
 */
export function recursivePos(i: number, levels: readonly [number, number][], snake = false): [number, number] {
  let x = 0, y = 0, scaleX = 1, scaleY = 1
  let rest = i
  for (const [w, h] of levels) {
    const idx = rest % (w * h)
    rest = Math.floor(rest / (w * h))
    let cx = idx % w
    const cy = Math.floor(idx / w)
    if (snake && cy % 2 === 1) cx = w - 1 - cx
    x += cx * scaleX
    y += cy * scaleY
    scaleX *= w
    scaleY *= h
  }
  return [x, y]
}

export const recursiveSize = (levels: readonly [number, number][]): [number, number] => levels.reduce(([w, h], [lw, lh]) => [w * lw, h * lh], [1, 1])

/**
 * Circle segments: d dimensions share a disc, one sector each. Inside a sector records are placed ring by ring from the centre outward
 * (ring r holds as many pixels as fit on its arc), in the order given. Returns the polar position of record k of a sector.
 */
export function segmentPixels(count: number, sectors: number, sector: number, pixel: number, inner = 0.18) {
  const span = (2 * Math.PI) / sectors
  const a0 = sector * span - Math.PI / 2
  const out: { angle: number; radius: number }[] = []
  let ring = 0
  while (out.length < count) {
    const radius = inner + (ring + 0.5) * pixel
    const cap = Math.max(1, Math.floor((radius * span) / pixel))
    for (let c = 0; c < cap && out.length < count; c++) out.push({ angle: a0 + ((c + 0.5) / cap) * span, radius })
    ring++
  }
  return out
}

/** Gaussian kernel density estimate in d dimensions (bandwidth h in normalized units), evaluated at point x. */
export function kdeND(Xn: Matrix, x: readonly number[], h: number): number {
  const d = x.length
  let s = 0
  for (const row of Xn) {
    let q = 0
    for (let j = 0; j < d; j++) q += (row[j] - x[j]) ** 2
    s += Math.exp(-q / (2 * h * h))
  }
  return s / (Xn.length * (h * Math.sqrt(2 * Math.PI)) ** d)
}

/** HyperSlice panel: the function on a grid over variables (a, b) with all others fixed at `point`. */
export function sliceGrid(f: (p: number[]) => number, point: readonly number[], a: number, b: number, n: number) {
  const out: number[][] = []
  for (let iy = 0; iy < n; iy++) {
    const row: number[] = []
    for (let ix = 0; ix < n; ix++) {
      const p = point.slice()
      p[a] = (ix + 0.5) / n
      p[b] = 1 - (iy + 0.5) / n
      row.push(f(p))
    }
    out.push(row)
  }
  return out
}

export interface PixelBar { key: string; rows: number[]; pixels: { row: number; col: number; record: number }[]; cols: number; height: number }

/**
 * Pixel bar chart: records are grouped by category; each bar is as wide as `cols` pixels and as tall as its record count needs; inside the
 * bar, records sorted by `sortBy` fill pixels from the bottom row upward.
 */
export function pixelBars(keys: readonly string[], sortBy: readonly number[], cols: number, order: readonly string[]): PixelBar[] {
  return order.map((key) => {
    const rows = keys.map((k, i) => (k === key ? i : -1)).filter((i) => i >= 0).sort((a, b) => sortBy[a] - sortBy[b] || a - b)
    return { key, rows, cols, height: Math.ceil(rows.length / cols), pixels: rows.map((record, k) => ({ row: Math.floor(k / cols), col: k % cols, record })) }
  })
}

/** Chernoff face features, each controlled by a normalized value in [0, 1] (index = order of the variables mapped onto them). */
export const faceFeatures = ['얼굴 너비', '눈 크기', '눈 간격', '눈썹 기울기', '입 곡률', '입 너비', '코 길이', '얼굴 높이'] as const

export interface FaceGeometry {
  rx: number; ry: number; eyeR: number; eyeGap: number; browTilt: number; mouthCurve: number; mouthHalf: number; noseLen: number
}

/** Maps normalized values (missing ones = 0.5) to face geometry in a unit square; every feature is monotone in its value. */
export function faceGeometry(v: readonly number[]): FaceGeometry {
  const g = (k: number) => Math.min(1, Math.max(0, v[k] ?? 0.5))
  return {
    rx: 0.28 + 0.14 * g(0), ry: 0.32 + 0.12 * g(7), eyeR: 0.025 + 0.05 * g(1), eyeGap: 0.07 + 0.09 * g(2),
    browTilt: -0.07 + 0.14 * g(3), mouthCurve: -0.09 + 0.18 * g(4), mouthHalf: 0.05 + 0.13 * g(5), noseLen: 0.03 + 0.1 * g(6),
  }
}
