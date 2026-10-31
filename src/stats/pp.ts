import { mean, standardDeviation } from './descriptive'
import { normalCdf } from './ecdf'

export type PPDist = 'normal' | 'uniform' | 'exponential' | 'lognormal'

export const ppDists: { value: PPDist; label: string }[] = [
  { value: 'normal', label: '정규분포' },
  { value: 'uniform', label: '균등분포' },
  { value: 'exponential', label: '지수분포' },
  { value: 'lognormal', label: '로그정규분포' },
]

export interface RefDist {
  /** Human-readable parameters, e.g. "N(50.1, 9.8²)". */
  label: string
  cdf: (x: number) => number
}

/** Reference distribution fitted to the sample by maximum likelihood. `ref` is null when the sample cannot follow the family. */
export function fitReference(values: readonly number[], dist: PPDist): { ref: RefDist | null; reason?: string } {
  const n = values.length
  if (n < 2) return { ref: null, reason: '표본이 2개 이상 필요합니다.' }
  let lo = Infinity
  let hi = -Infinity
  for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v }
  switch (dist) {
    case 'normal': {
      const m = mean(values)
      const sd = standardDeviation(values) || 1
      return { ref: { label: `N(${m.toFixed(1)}, ${sd.toFixed(1)}²)`, cdf: (x) => normalCdf(x, m, sd) } }
    }
    case 'uniform': {
      const w = hi - lo || 1
      return { ref: { label: `U(${lo.toFixed(1)}, ${hi.toFixed(1)})`, cdf: (x) => Math.min(1, Math.max(0, (x - lo) / w)) } }
    }
    case 'exponential': {
      if (lo < 0) return { ref: null, reason: '지수분포는 0 이상의 값에만 맞출 수 있습니다. 음수 값이 있습니다.' }
      const m = mean(values) || 1
      return { ref: { label: `Exp(λ=${(1 / m).toFixed(3)})`, cdf: (x) => (x <= 0 ? 0 : 1 - Math.exp(-x / m)) } }
    }
    default: {
      if (lo <= 0) return { ref: null, reason: '로그정규분포는 양수에만 맞출 수 있습니다. 0 이하의 값이 있습니다.' }
      const logs = values.map(Math.log)
      const m = mean(logs)
      const sd = standardDeviation(logs) || 1
      return { ref: { label: `LogN(${m.toFixed(2)}, ${sd.toFixed(2)}²)`, cdf: (x) => (x <= 0 ? 0 : normalCdf(Math.log(x), m, sd)) } }
    }
  }
}

export type PPPosition = 'hazen' | 'weibull' | 'ecdf'

export const ppPositions: { value: PPPosition; label: string; hint: string }[] = [
  { value: 'hazen', label: '(i − 0.5) / n', hint: 'Hazen. 0과 1을 피하면서 대칭입니다.' },
  { value: 'weibull', label: 'i / (n + 1)', hint: 'Weibull. 순서통계량의 기대 확률입니다.' },
  { value: 'ecdf', label: 'i / n', hint: '경험적 누적분포함수 값 그대로입니다.' },
]

/** Empirical cumulative probability assigned to the i-th smallest value (1-based). */
export function empiricalP(i: number, n: number, position: PPPosition): number {
  return position === 'hazen' ? (i - 0.5) / n : position === 'weibull' ? i / (n + 1) : i / n
}

export interface PPPoint { row: number; value: number; empirical: number; reference: number }

/** One point per observation: x = F_ref(x₍ᵢ₎), y = empirical probability of x₍ᵢ₎. Points on y = x mean a perfect fit. */
export function ppPoints(rows: readonly { row: number; value: number }[], ref: RefDist, position: PPPosition = 'hazen'): PPPoint[] {
  const sorted = [...rows].sort((a, b) => a.value - b.value)
  const n = sorted.length
  return sorted.map((r, k) => ({ row: r.row, value: r.value, empirical: empiricalP(k + 1, n, position), reference: ref.cdf(r.value) }))
}

/** Kolmogorov–Smirnov statistic D = max |F̂(x) − F(x)|, the largest vertical gap between the empirical and reference CDFs. */
export function ksStatistic(values: readonly number[], ref: RefDist): number {
  const s = [...values].sort((a, b) => a - b)
  const n = s.length
  let d = 0
  for (let i = 0; i < n; i++) {
    const f = ref.cdf(s[i])
    d = Math.max(d, (i + 1) / n - f, f - i / n)
  }
  return d
}
