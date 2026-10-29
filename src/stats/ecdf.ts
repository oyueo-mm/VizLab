import { sortNumbers } from './descriptive'

export interface EcdfStep {
  x: number
  /** F̂(x) = #{xᵢ ≤ x} / n */
  p: number
  count: number
}

/** Empirical CDF as jump points: one per distinct value, ties merged into a single larger jump. */
export function ecdf(values: readonly number[]): EcdfStep[] {
  const s = sortNumbers(values)
  const n = s.length
  const steps: EcdfStep[] = []
  for (let i = 0; i < n; i++) {
    if (i + 1 < n && s[i + 1] === s[i]) continue
    steps.push({ x: s[i], p: (i + 1) / n, count: i + 1 })
  }
  return steps
}

/** F̂(x) for an arbitrary x. */
export function ecdfAt(steps: readonly EcdfStep[], x: number) {
  let lo = 0
  let hi = steps.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (steps[mid].x <= x) lo = mid + 1
    else hi = mid
  }
  return lo === 0 ? 0 : steps[lo - 1].p
}

/** Normal CDF via the Abramowitz–Stegun 7.1.26 erf approximation (|error| < 1.5e−7). */
export function normalCdf(x: number, mean = 0, sd = 1) {
  const z = (x - mean) / (sd * Math.SQRT2)
  const t = 1 / (1 + 0.3275911 * Math.abs(z))
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z)
  return 0.5 * (1 + (z >= 0 ? y : -y))
}
