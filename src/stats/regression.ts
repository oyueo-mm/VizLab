import { createRng } from '../lib/random'
import { studentTQuantile } from './distributions'

/** Ordinary least squares with the diagnostics used by the residual, scale–location, influence and coefficient charts. */

/** Inverse of a small symmetric positive-definite matrix by Gauss–Jordan elimination with partial pivoting; null when singular. */
export function invert(a: readonly (readonly number[])[]): number[][] | null {
  const n = a.length
  const m = a.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r
    if (Math.abs(m[p][c]) < 1e-12) return null
    ;[m[c], m[p]] = [m[p], m[c]]
    const d = m[c][c]
    for (let j = 0; j < 2 * n; j++) m[c][j] /= d
    for (let r = 0; r < n; r++) if (r !== c) { const f = m[r][c]; if (f) for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[c][j] }
  }
  return m.map((r) => r.slice(n))
}

export interface OlsFit {
  n: number
  /** Number of coefficients including the intercept. */
  p: number
  beta: number[]
  se: number[]
  fitted: number[]
  residuals: number[]
  /** Leverage h_ii (diagonal of the hat matrix). */
  hat: number[]
  sigma: number
  df: number
  r2: number
  /** (XᵀX)⁻¹ */
  xtxInv: number[][]
}

/** Fits y on the predictor columns (an intercept is added). Returns null when there are too few rows or the design is singular. */
export function ols(X: readonly (readonly number[])[], y: readonly number[], intercept = true): OlsFit | null {
  const n = y.length
  const rows = X.map((r) => (intercept ? [1, ...r] : [...r]))
  const p = rows[0]?.length ?? 0
  if (n <= p || p === 0) return null
  const xtx = Array.from({ length: p }, () => new Array<number>(p).fill(0)), xty = new Array<number>(p).fill(0)
  for (let i = 0; i < n; i++) for (let a = 0; a < p; a++) { xty[a] += rows[i][a] * y[i]; for (let b = 0; b < p; b++) xtx[a][b] += rows[i][a] * rows[i][b] }
  const inv = invert(xtx)
  if (!inv) return null
  const beta = inv.map((r) => r.reduce((s, v, j) => s + v * xty[j], 0))
  const fitted = rows.map((r) => r.reduce((s, v, j) => s + v * beta[j], 0))
  const residuals = y.map((v, i) => v - fitted[i])
  const rss = residuals.reduce((s, e) => s + e * e, 0)
  const df = n - p
  const sigma2 = rss / df
  const hat = rows.map((r) => { let s = 0; for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) s += r[a] * inv[a][b] * r[b]; return s })
  const ym = y.reduce((s, v) => s + v, 0) / n
  const tss = intercept ? y.reduce((s, v) => s + (v - ym) ** 2, 0) : y.reduce((s, v) => s + v * v, 0)
  return { n, p, beta, se: inv.map((r, i) => Math.sqrt(sigma2 * r[i])), fitted, residuals, hat, sigma: Math.sqrt(sigma2), df, r2: tss > 0 ? 1 - rss / tss : NaN, xtxInv: inv }
}

export interface Diagnostics {
  /** Internally standardised residuals e_i / (s √(1−h_i)). */
  standardized: number[]
  /** Externally studentised (leave-one-out) residuals. */
  studentized: number[]
  /** Cook's distance. */
  cooks: number[]
  hat: number[]
  /** Leverage threshold 2p/n and Cook threshold 4/n. */
  hatLimit: number
  cookLimit: number
}

export function diagnostics(fit: OlsFit): Diagnostics {
  const { n, p, sigma, residuals, hat, df } = fit
  const standardized = residuals.map((e, i) => e / (sigma * Math.sqrt(Math.max(1e-12, 1 - hat[i]))))
  const studentized = standardized.map((r) => r * Math.sqrt(Math.max(0, (df - 1) / Math.max(1e-12, df - r * r))))
  const cooks = standardized.map((r, i) => (r * r * hat[i]) / (p * Math.max(1e-12, 1 - hat[i])))
  return { standardized, studentized, cooks, hat, hatLimit: (2 * p) / n, cookLimit: 4 / n }
}

/** Two-sided confidence interval for every coefficient (t distribution with the residual degrees of freedom). */
export function coefIntervals(fit: OlsFit, level = 0.95): [number, number][] {
  const t = studentTQuantile(1 - (1 - level) / 2, fit.df)
  return fit.beta.map((b, i) => [b - t * fit.se[i], b + t * fit.se[i]] as [number, number])
}

/** Polynomial design columns [x, x², …, x^degree]. */
export const polyRows = (x: readonly number[], degree: number) => x.map((v) => Array.from({ length: degree }, (_, k) => v ** (k + 1)))

/** LOWESS (locally weighted linear regression with tricube weights) of y on x, evaluated at the x values themselves. */
export function lowess(x: readonly number[], y: readonly number[], span = 2 / 3): number[] {
  const n = x.length
  const k = Math.max(3, Math.min(n, Math.ceil(span * n)))
  return x.map((x0) => {
    const d = x.map((v) => Math.abs(v - x0))
    const h = [...d].sort((a, b) => a - b)[k - 1] || 1e-12
    let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0
    for (let i = 0; i < n; i++) {
      const u = d[i] / h
      const w = u < 1 ? (1 - u ** 3) ** 3 : 0
      sw += w; sx += w * x[i]; sy += w * y[i]; sxx += w * x[i] * x[i]; sxy += w * x[i] * y[i]
    }
    const den = sw * sxx - sx * sx
    return Math.abs(den) < 1e-12 ? sy / (sw || 1) : (sy * sxx - sx * sxy) / den + ((sw * sxy - sx * sy) / den) * x0
  })
}

// ─── bagged regression trees (for partial dependence) ───────────────────────────────

interface TreeNode { feature: number; threshold: number; left?: TreeNode; right?: TreeNode; value: number }

function grow(X: number[][], y: number[], idx: number[], depth: number, maxDepth: number, minLeaf: number): TreeNode {
  const mean = idx.reduce((s, i) => s + y[i], 0) / idx.length
  if (depth >= maxDepth || idx.length < 2 * minLeaf) return { feature: -1, threshold: 0, value: mean }
  let best: { f: number; t: number; score: number } | null = null
  const total = idx.reduce((s, i) => s + y[i], 0), n = idx.length
  for (let f = 0; f < X[0].length; f++) {
    const sorted = [...idx].sort((a, b) => X[a][f] - X[b][f])
    let sl = 0
    for (let k = 0; k < n - 1; k++) {
      sl += y[sorted[k]]
      const nl = k + 1, nr = n - nl
      if (nl < minLeaf || nr < minLeaf || X[sorted[k]][f] === X[sorted[k + 1]][f]) continue
      // maximising the between-group sum of squares is the same as minimising the within-group variance
      const score = (sl * sl) / nl + ((total - sl) * (total - sl)) / nr
      if (!best || score > best.score) best = { f, t: (X[sorted[k]][f] + X[sorted[k + 1]][f]) / 2, score }
    }
  }
  if (!best) return { feature: -1, threshold: 0, value: mean }
  const left = idx.filter((i) => X[i][best!.f] <= best!.t), right = idx.filter((i) => X[i][best!.f] > best!.t)
  return { feature: best.f, threshold: best.t, value: mean, left: grow(X, y, left, depth + 1, maxDepth, minLeaf), right: grow(X, y, right, depth + 1, maxDepth, minLeaf) }
}

export interface Forest { predict: (x: readonly number[]) => number }

/** A seeded random forest of regression trees (bootstrap samples, random feature subsets are not used: all features compete at every split). */
export function fitForest(X: number[][], y: number[], { trees = 40, depth = 5, minLeaf = 3, seed = 1 } = {}): Forest {
  const rng = createRng(seed)
  const n = y.length
  const ts: TreeNode[] = []
  for (let t = 0; t < trees; t++) {
    const idx = Array.from({ length: n }, () => Math.floor(rng() * n))
    ts.push(grow(X, y, idx, 0, depth, minLeaf))
  }
  const pred = (node: TreeNode, x: readonly number[]): number => (node.left && node.right ? pred(x[node.feature] <= node.threshold ? node.left : node.right, x) : node.value)
  return { predict: (x) => ts.reduce((s, t) => s + pred(t, x), 0) / ts.length }
}

/** Partial dependence: the model's mean prediction when feature j is set to each grid value for every row. ICE curves are the per-row predictions. */
export function partialDependence(model: Forest, X: readonly (readonly number[])[], j: number, grid: readonly number[], iceRows: readonly number[] = []) {
  const pdp = grid.map((g) => X.reduce((s, r) => { const x = r.slice(); x[j] = g; return s + model.predict(x) }, 0) / X.length)
  const ice = iceRows.map((i) => grid.map((g) => { const x = X[i].slice(); x[j] = g; return model.predict(x) }))
  return { pdp, ice }
}
