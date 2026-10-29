import { quantileSorted, sortNumbers, type QuantileMethod } from './descriptive'

export type WhiskerRule = 'tukey' | 'minmax' | 'percentile'

export interface BoxStats {
  n: number
  min: number
  max: number
  q1: number
  median: number
  q3: number
  iqr: number
  /** Bounds that classify outliers (for `minmax` they equal the data range). */
  lowerFence: number
  upperFence: number
  /** Whisker ends: the most extreme observations inside the fences (percentile rule: the percentiles themselves). */
  whiskerLow: number
  whiskerHigh: number
  outliers: number[]
}

export interface BoxOptions {
  method?: QuantileMethod
  rule?: WhiskerRule
  /** IQR multiplier for the Tukey rule (1.5 by convention). */
  k?: number
  /** Lower percentile for the percentile rule (0.05 → 5th–95th). */
  percentile?: number
}

export function boxStats(values: readonly number[], { method = 'linear', rule = 'tukey', k = 1.5, percentile = 0.05 }: BoxOptions = {}): BoxStats | null {
  const s = sortNumbers(values)
  const n = s.length
  if (!n) return null
  const q1 = quantileSorted(s, 0.25, method)
  const median = quantileSorted(s, 0.5, method)
  const q3 = quantileSorted(s, 0.75, method)
  const iqr = q3 - q1
  let lowerFence: number
  let upperFence: number
  if (rule === 'tukey') {
    lowerFence = q1 - k * iqr
    upperFence = q3 + k * iqr
  } else if (rule === 'percentile') {
    lowerFence = quantileSorted(s, percentile)
    upperFence = quantileSorted(s, 1 - percentile)
  } else {
    lowerFence = s[0]
    upperFence = s[n - 1]
  }
  const inside = s.filter((v) => v >= lowerFence && v <= upperFence)
  const outliers = s.filter((v) => v < lowerFence || v > upperFence)
  return {
    n, min: s[0], max: s[n - 1], q1, median, q3, iqr, lowerFence, upperFence,
    whiskerLow: rule === 'percentile' ? lowerFence : inside.length ? inside[0] : q1,
    whiskerHigh: rule === 'percentile' ? upperFence : inside.length ? inside[inside.length - 1] : q3,
    outliers,
  }
}
