import { createRng } from '../lib/random'
import { erfc, normalQuantile, studentTCdf } from './distributions'

/** Resampling, process-monitoring (EWMA, CUSUM), cumulative-gain and probability-integral-transform computations. */

// ─── bootstrap ──────────────────────────────────────────────────────────────────────

export type StatName = 'mean' | 'median' | 'sd' | 'trimmed' | 'iqr'

export const statLabels: Record<StatName, string> = { mean: '평균', median: '중앙값', sd: '표준편차', trimmed: '절사평균 (10%)', iqr: '사분위범위(IQR)' }

const quantile = (sorted: readonly number[], p: number) => {
  const h = (sorted.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo)
}

export function statistic(name: StatName, data: readonly number[]): number {
  const n = data.length
  if (!n) return NaN
  if (name === 'mean') return data.reduce((a, b) => a + b, 0) / n
  const s = [...data].sort((a, b) => a - b)
  if (name === 'median') return quantile(s, 0.5)
  if (name === 'iqr') return quantile(s, 0.75) - quantile(s, 0.25)
  if (name === 'trimmed') { const k = Math.floor(0.1 * n); const kept = s.slice(k, n - k); return kept.reduce((a, b) => a + b, 0) / (kept.length || 1) }
  const m = data.reduce((a, b) => a + b, 0) / n
  return n > 1 ? Math.sqrt(data.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : NaN
}

/** `reps` bootstrap replicates of a statistic (resampling with replacement, seeded). */
export function bootstrap(data: readonly number[], stat: StatName, reps: number, seed = 1): number[] {
  const rng = createRng(seed)
  const n = data.length
  const out: number[] = []
  const buf = new Array<number>(n)
  for (let b = 0; b < reps; b++) {
    for (let i = 0; i < n; i++) buf[i] = data[Math.floor(rng() * n)]
    out.push(statistic(stat, buf))
  }
  return out
}

export interface BootCi { lo: number; hi: number; method: 'percentile' | 'bca' | 'normal' }

export function bootstrapCi(data: readonly number[], stat: StatName, boot: readonly number[], level: number, method: BootCi['method']): BootCi {
  const sorted = [...boot].filter(Number.isFinite).sort((a, b) => a - b)
  const alpha = (1 - level) / 2
  const theta = statistic(stat, data)
  if (method === 'normal') {
    const m = sorted.reduce((a, b) => a + b, 0) / sorted.length
    const se = Math.sqrt(sorted.reduce((a, b) => a + (b - m) ** 2, 0) / (sorted.length - 1))
    const z = normalQuantile(1 - alpha)
    return { lo: theta - z * se, hi: theta + z * se, method }
  }
  if (method === 'percentile') return { lo: quantile(sorted, alpha), hi: quantile(sorted, 1 - alpha), method }
  // BCa: bias correction z0 from the share of replicates below the estimate, acceleration from the jackknife
  const below = sorted.filter((v) => v < theta).length / sorted.length
  const z0 = normalQuantile(Math.min(1 - 1e-9, Math.max(1e-9, below)))
  const jack = data.map((_, i) => statistic(stat, data.filter((__, j) => j !== i)))
  const jm = jack.reduce((a, b) => a + b, 0) / jack.length
  const num = jack.reduce((a, b) => a + (jm - b) ** 3, 0), den = 6 * jack.reduce((a, b) => a + (jm - b) ** 2, 0) ** 1.5
  const acc = den > 0 ? num / den : 0
  const cdf = (z: number) => 0.5 * erfc(-z / Math.SQRT2)
  const adj = (zq: number) => cdf(z0 + (z0 + zq) / (1 - acc * (z0 + zq)))
  return { lo: quantile(sorted, adj(normalQuantile(alpha))), hi: quantile(sorted, adj(normalQuantile(1 - alpha))), method }
}

// ─── EWMA & CUSUM control charts ────────────────────────────────────────────────────

/** Baseline mean and an individuals-chart sigma (mean moving range / 1.128) from the first `m` points. */
export function baseline(x: readonly number[], m: number): { mu: number; sigma: number } {
  const b = x.slice(0, Math.max(2, Math.min(m, x.length)))
  const mu = b.reduce((a, v) => a + v, 0) / b.length
  let mr = 0
  for (let i = 1; i < b.length; i++) mr += Math.abs(b[i] - b[i - 1])
  return { mu, sigma: b.length > 1 ? mr / (b.length - 1) / 1.128 : 1 }
}

export interface EwmaResult { z: number[]; ucl: number[]; lcl: number[]; signals: number[] }

/**
 * EWMA chart: z_t = λx_t + (1−λ)z_{t−1}, z_0 = μ0. The exact limits widen with time,
 * μ0 ± L σ √( λ/(2−λ) · (1 − (1−λ)^{2t}) ), and approach the asymptotic limits μ0 ± L σ √(λ/(2−λ)).
 */
export function ewma(x: readonly number[], { lambda, L, mu0, sigma0, exact = true }: { lambda: number; L: number; mu0: number; sigma0: number; exact?: boolean }): EwmaResult {
  const z: number[] = [], ucl: number[] = [], lcl: number[] = [], signals: number[] = []
  let prev = mu0
  x.forEach((v, i) => {
    prev = lambda * v + (1 - lambda) * prev
    z.push(prev)
    const w = L * sigma0 * Math.sqrt((lambda / (2 - lambda)) * (exact ? 1 - (1 - lambda) ** (2 * (i + 1)) : 1))
    ucl.push(mu0 + w); lcl.push(mu0 - w)
    if (prev > mu0 + w || prev < mu0 - w) signals.push(i)
  })
  return { z, ucl, lcl, signals }
}

export interface CusumResult { upper: number[]; lower: number[]; h: number; signals: { index: number; side: 'up' | 'down' }[] }

/**
 * Tabular CUSUM: C⁺_t = max(0, C⁺_{t−1} + (x_t − μ0)/σ − k), C⁻_t = max(0, C⁻_{t−1} − (x_t − μ0)/σ − k) in standard-deviation units.
 * A signal is raised the first time either sum exceeds h; after a signal the sum restarts from 0.
 */
export function cusum(x: readonly number[], { k, h, mu0, sigma0, restart = true }: { k: number; h: number; mu0: number; sigma0: number; restart?: boolean }): CusumResult {
  const upper: number[] = [], lower: number[] = [], signals: CusumResult['signals'] = []
  let cp = 0, cm = 0
  x.forEach((v, i) => {
    const zz = (v - mu0) / sigma0
    cp = Math.max(0, cp + zz - k)
    cm = Math.max(0, cm - zz - k)
    upper.push(cp); lower.push(cm)
    if (cp > h) { signals.push({ index: i, side: 'up' }); if (restart) cp = 0 }
    if (cm > h) { signals.push({ index: i, side: 'down' }); if (restart) cm = 0 }
  })
  return { upper, lower, h, signals }
}

// ─── cumulative gain & lift ─────────────────────────────────────────────────────────

export interface GainPoint { frac: number; gain: number; lift: number; perfect: number; threshold: number }

/** Cumulative gain / lift of a scored 0/1 sample: sort by score (high first) and, for the top k/bins share, the share of all positives captured. */
export function gainCurve(scored: readonly { score: number; label: 0 | 1 }[], bins: number): { points: GainPoint[]; prevalence: number; gini: number } {
  const n = scored.length
  const pos = scored.filter((s) => s.label === 1).length
  const sorted = [...scored].sort((a, b) => b.score - a.score)
  const prevalence = n ? pos / n : 0
  const points: GainPoint[] = [{ frac: 0, gain: 0, lift: NaN, perfect: 0, threshold: sorted[0]?.score ?? 0 }]
  for (let k = 1; k <= bins; k++) {
    const cut = Math.round((k / bins) * n)
    const got = sorted.slice(0, cut).filter((s) => s.label === 1).length
    points.push({ frac: k / bins, gain: pos ? got / pos : 0, lift: pos && cut ? got / pos / (cut / n) : NaN, perfect: prevalence > 0 ? Math.min(1, k / bins / prevalence) : 0, threshold: sorted[Math.max(0, cut - 1)]?.score ?? 0 })
  }
  // Gini / accuracy ratio: area between the gain curve and the diagonal over the same area for a perfect model
  const area = (key: 'gain' | 'perfect') => points.slice(1).reduce((s, p, i) => s + ((p[key] + points[i][key]) / 2) * (p.frac - points[i].frac), 0)
  const gini = area('perfect') - 0.5 > 0 ? (area('gain') - 0.5) / (area('perfect') - 0.5) : NaN
  return { points, prevalence, gini }
}

// ─── probability integral transform ─────────────────────────────────────────────────

export type PitFamily = 'normal' | 't5'

const normalCdf = (z: number) => 0.5 * erfc(-z / Math.SQRT2)

/** PIT value of an observation under a predictive distribution with the given mean and scale (t₅ is scaled to the same standard deviation). */
export function pit(y: number, mu: number, sd: number, family: PitFamily = 'normal'): number {
  const z = (y - mu) / sd
  return family === 'normal' ? normalCdf(z) : studentTCdf(z / Math.sqrt(5 / 3), 5)
}

export interface PitBin { lo: number; hi: number; count: number; density: number }

/** Histogram of PIT values with the binomial 95% band that a calibrated forecast would stay inside (uniform density = 1). */
export function pitHistogram(values: readonly number[], bins: number): { bins: PitBin[]; band: [number, number]; n: number } {
  const n = values.length
  const counts = new Array<number>(bins).fill(0)
  for (const v of values) counts[Math.min(bins - 1, Math.max(0, Math.floor(v * bins)))]++
  const p = 1 / bins, sd = Math.sqrt((n * p * (1 - p)))
  return { bins: counts.map((c, i) => ({ lo: i / bins, hi: (i + 1) / bins, count: c, density: n ? c / n * bins : 0 })), band: [Math.max(0, (n * p - 1.96 * sd) / n * bins), (n * p + 1.96 * sd) / n * bins], n }
}

/** Kolmogorov–Smirnov distance of the PIT values from the uniform distribution. */
export function pitKs(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const n = s.length
  let d = 0
  s.forEach((v, i) => { d = Math.max(d, Math.abs(v - i / n), Math.abs((i + 1) / n - v)) })
  return d
}
