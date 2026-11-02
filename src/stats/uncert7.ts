/** Engines of the v0.7 distribution and uncertainty techniques. */
import { createRng, type Rng } from '../lib/random'
import { erfc, normalQuantile, studentTQuantile } from './distributions'
import { kde, silvermanBandwidth } from './kde'

export type DistKind = 'normal' | 'lognormal' | 'exponential' | 'empirical'

export interface Dist {
  kind: DistKind
  quantile: (p: number) => number
  cdf: (x: number) => number
  pdf: (x: number) => number
  sample: (rng: Rng) => number
  mean: number
}

const mean = (v: readonly number[]) => v.reduce((a, b) => a + b, 0) / (v.length || 1)
const sd = (v: readonly number[]) => { const m = mean(v); return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, v.length - 1)) }
const stdCdf = (z: number) => 0.5 * erfc(-z / Math.SQRT2)
const clampP = (p: number) => Math.min(1 - 1e-12, Math.max(1e-12, p))

/** Fits the chosen distribution family to a sample (maximum likelihood for the parametric families). */
export function fitDist(values: readonly number[], kind: DistKind): Dist | null {
  const v = values.filter((x) => Number.isFinite(x))
  if (v.length < 2) return null
  if (kind === 'normal') {
    const m = mean(v), s = sd(v) || 1e-9
    return { kind, mean: m, quantile: (p) => m + s * normalQuantile(clampP(p)), cdf: (x) => stdCdf((x - m) / s), pdf: (x) => Math.exp(-0.5 * ((x - m) / s) ** 2) / (s * Math.sqrt(2 * Math.PI)), sample: (r) => r.normal(m, s) }
  }
  if (kind === 'lognormal') {
    const pos = v.filter((x) => x > 0)
    if (pos.length < 2) return null
    const l = pos.map(Math.log)
    const mu = mean(l), s = sd(l) || 1e-9
    return { kind, mean: Math.exp(mu + (s * s) / 2), quantile: (p) => Math.exp(mu + s * normalQuantile(clampP(p))), cdf: (x) => (x <= 0 ? 0 : stdCdf((Math.log(x) - mu) / s)),
      pdf: (x) => (x <= 0 ? 0 : Math.exp(-0.5 * ((Math.log(x) - mu) / s) ** 2) / (x * s * Math.sqrt(2 * Math.PI))), sample: (r) => Math.exp(r.normal(mu, s)) }
  }
  if (kind === 'exponential') {
    const lo = Math.min(...v)
    const m = Math.max(1e-9, mean(v) - lo)
    return { kind, mean: lo + m, quantile: (p) => lo - m * Math.log(1 - clampP(p)), cdf: (x) => (x < lo ? 0 : 1 - Math.exp(-(x - lo) / m)), pdf: (x) => (x < lo ? 0 : Math.exp(-(x - lo) / m) / m), sample: (r) => lo - m * Math.log(1 - r()) }
  }
  const s = [...v].sort((a, b) => a - b)
  const n = s.length
  const h = silvermanBandwidth(s) || 1
  return {
    kind, mean: mean(s),
    quantile: (p) => { const t = Math.min(1, Math.max(0, p)) * (n - 1); const i = Math.floor(t); return i >= n - 1 ? s[n - 1] : s[i] + (t - i) * (s[i + 1] - s[i]) },
    cdf: (x) => { let lo = 0, hi = n; while (lo < hi) { const mid = (lo + hi) >> 1; if (s[mid] <= x) lo = mid + 1; else hi = mid } return lo / n },
    pdf: (x) => kde(s, h, 'gaussian', [x])[0],
    sample: (r) => s[Math.min(n - 1, Math.floor(r() * n))],
  }
}

/** n quantile-dotplot positions: the quantiles at p = (i + ½)/n, each dot carrying a probability mass of 1/n. */
export const quantileDots = (dist: Dist, n: number) => Array.from({ length: n }, (_, i) => dist.quantile((i + 0.5) / n))

export interface StackedDot { x: number; level: number; value: number }

/**
 * Wilkinson's dot-plot algorithm: sort the values, start a bin at the first value not yet placed, put every value within `binWidth` of
 * the bin start into the bin, and stack its dots at the bin's centre (the mean of its values), one level per dot.
 */
export function wilkinsonStack(values: readonly number[], binWidth: number): StackedDot[] {
  const s = [...values].sort((a, b) => a - b)
  const out: StackedDot[] = []
  let i = 0
  while (i < s.length) {
    let j = i
    while (j < s.length && s[j] - s[i] < binWidth) j++
    const centre = mean(s.slice(i, j))
    for (let k = i; k < j; k++) out.push({ x: centre, level: k - i, value: s[k] })
    i = j
  }
  return out
}

export interface GroupStat { key: string; n: number; mean: number; sd: number; se: number }

export function groupStats(keys: readonly string[], values: readonly number[]): GroupStat[] {
  const order: string[] = []
  const by = new Map<string, number[]>()
  keys.forEach((k, i) => {
    if (!Number.isFinite(values[i])) return
    if (!by.has(k)) { by.set(k, []); order.push(k) }
    by.get(k)!.push(values[i])
  })
  return order.map((key) => { const v = by.get(key)!; const s = sd(v); return { key, n: v.length, mean: mean(v), sd: s, se: v.length > 1 ? s / Math.sqrt(v.length) : 0 } })
}

/** The sampling distribution of a group mean is a scaled Student t with n−1 degrees of freedom; `p` → its quantile. */
export const meanQuantile = (g: GroupStat, p: number) => (g.n < 2 ? g.mean : g.mean + g.se * studentTQuantile(clampP(p), g.n - 1))

/** One hypothetical outcome per frame: every group mean drawn from its sampling distribution, reproducible from (seed, frame). */
export function hopDraw(groups: readonly GroupStat[], frame: number, seed: number): number[] {
  const rng = createRng(seed * 1000003 + frame * 7919 + 1)
  return groups.map((g) => (g.n < 2 ? g.mean : meanQuantile(g, rng())))
}

/** Normal-approximation density of the group mean at x (used for the gradient plot's opacity). */
export const meanDensity = (g: GroupStat, x: number) => (g.se > 0 ? Math.exp(-0.5 * ((x - g.mean) / g.se) ** 2) / (g.se * Math.sqrt(2 * Math.PI)) : 0)

/** Classical (Torgerson) MDS in 2-D: double-centres the squared distances and takes the top two eigenvectors by power iteration. */
export function classicalMDS(D: readonly (readonly number[])[]): [number, number][] {
  const n = D.length
  if (n === 0) return []
  const B: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  const rowMean = D.map((r) => r.reduce((a, b) => a + b * b, 0) / n)
  const total = rowMean.reduce((a, b) => a + b, 0) / n
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) B[i][j] = -0.5 * (D[i][j] ** 2 - rowMean[i] - rowMean[j] + total)
  const eig = (M: number[][], seed: number): { vec: number[]; val: number } => {
    const rng = createRng(seed)
    let v = Array.from({ length: n }, () => rng() - 0.5)
    for (let it = 0; it < 300; it++) {
      const w = M.map((row) => row.reduce((a, b, k) => a + b * v[k], 0))
      const norm = Math.hypot(...w) || 1
      const next = w.map((x) => x / norm)
      const diff = Math.hypot(...next.map((x, k) => x - v[k]))
      v = next
      if (diff < 1e-12) break
    }
    // Rayleigh quotient gives the signed eigenvalue
    const Mv = M.map((row) => row.reduce((a, b, k) => a + b * v[k], 0))
    const val = v.reduce((a, b, k) => a + b * Mv[k], 0)
    return { vec: v, val }
  }
  const e1 = eig(B, 11)
  const B2 = B.map((row, i) => row.map((x, j) => x - e1.val * e1.vec[i] * e1.vec[j]))
  const e2 = eig(B2, 23)
  const s1 = Math.sqrt(Math.max(0, e1.val)), s2 = Math.sqrt(Math.max(0, e2.val))
  return e1.vec.map((x, i) => [x * s1, e2.vec[i] * s2])
}

export const euclid = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((x, i) => x - b[i]))

export interface Seg { x0: number; y0: number; x1: number; y1: number }

/** Intersection of two segments (proper crossings only), or null. */
export function segmentCross(a: Seg, b: Seg): { x: number; y: number } | null {
  const d = (a.x1 - a.x0) * (b.y1 - b.y0) - (a.y1 - a.y0) * (b.x1 - b.x0)
  if (Math.abs(d) < 1e-12) return null
  const t = ((b.x0 - a.x0) * (b.y1 - b.y0) - (b.y0 - a.y0) * (b.x1 - b.x0)) / d
  const u = ((b.x0 - a.x0) * (a.y1 - a.y0) - (b.y0 - a.y0) * (a.x1 - a.x0)) / d
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null
  return { x: a.x0 + t * (a.x1 - a.x0), y: a.y0 + t * (a.y1 - a.y0) }
}

/** All crossings between the polylines of different trains (Marey chart: each is a meeting or an overtaking). */
export function polylineCrossings(lines: readonly { key: string; pts: readonly [number, number][] }[]) {
  const out: { a: string; b: string; x: number; y: number }[] = []
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    for (let p = 0; p + 1 < lines[i].pts.length; p++) for (let q = 0; q + 1 < lines[j].pts.length; q++) {
      const c = segmentCross(
        { x0: lines[i].pts[p][0], y0: lines[i].pts[p][1], x1: lines[i].pts[p + 1][0], y1: lines[i].pts[p + 1][1] },
        { x0: lines[j].pts[q][0], y0: lines[j].pts[q][1], x1: lines[j].pts[q + 1][0], y1: lines[j].pts[q + 1][1] })
      if (c) out.push({ a: lines[i].key, b: lines[j].key, ...c })
    }
  }
  return out
}
