import { createRng } from '../lib/random'
import { mean, quantileSorted, standardDeviation } from './descriptive'
import { normalQuantile, studentTQuantile } from './distributions'

export type CiMethod = 't' | 'z' | 'bootstrap'

export interface MeanInterval {
  n: number
  mean: number
  sd: number
  /** Standard error s / √n. */
  se: number
  lo: number
  hi: number
  /** Critical value (t or z); NaN for the bootstrap. */
  crit: number
  /** Degrees of freedom for the t method. */
  df: number
}

/**
 * Confidence interval for a population mean.
 * - `t`: x̄ ± t_{1−α/2, n−1} · s/√n — exact when the population is normal, σ unknown.
 * - `z`: x̄ ± z_{1−α/2} · s/√n — large-sample normal approximation (too narrow for small n).
 * - `bootstrap`: percentile interval of B resampled means (seeded, reproducible).
 */
export function meanInterval(values: readonly number[], level: number, method: CiMethod = 't', { seed = 1, resamples = 2000 } = {}): MeanInterval | null {
  const n = values.length
  if (n < 2) return null
  const m = mean(values)
  const sd = standardDeviation(values)
  const se = sd / Math.sqrt(n)
  const alpha = 1 - level
  if (method === 'bootstrap') {
    const rng = createRng(seed)
    const means = new Float64Array(resamples)
    for (let b = 0; b < resamples; b++) {
      let s = 0
      for (let i = 0; i < n; i++) s += values[Math.floor(rng() * n)]
      means[b] = s / n
    }
    const sorted = Array.from(means).sort((a, b) => a - b)
    return { n, mean: m, sd, se, lo: quantileSorted(sorted, alpha / 2), hi: quantileSorted(sorted, 1 - alpha / 2), crit: NaN, df: n - 1 }
  }
  const crit = method === 't' ? studentTQuantile(1 - alpha / 2, n - 1) : normalQuantile(1 - alpha / 2)
  return { n, mean: m, sd, se, lo: m - crit * se, hi: m + crit * se, crit, df: n - 1 }
}

export interface SimulatedInterval { lo: number; hi: number; mean: number; covers: boolean }

/** Draws `count` samples of size n from N(μ, σ²) and builds an interval for each (coverage demonstration). */
export function simulateIntervals(count: number, n: number, mu: number, sigma: number, level: number, method: CiMethod, seed: number): SimulatedInterval[] {
  const rng = createRng(seed)
  const out: SimulatedInterval[] = []
  for (let k = 0; k < count; k++) {
    const sample = Array.from({ length: n }, () => rng.normal(mu, sigma))
    const ci = meanInterval(sample, level, method, { seed: seed * 31 + k, resamples: 600 })
    if (ci) out.push({ lo: ci.lo, hi: ci.hi, mean: ci.mean, covers: ci.lo <= mu && mu <= ci.hi })
  }
  return out
}
