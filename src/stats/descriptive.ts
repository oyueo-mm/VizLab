export type QuantileMethod = 'linear' | 'tukey'

export const finite = (values: readonly (number | null | undefined)[]): number[] =>
  values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))

export const sortNumbers = (values: readonly number[]) => [...values].sort((a, b) => a - b)

export function sum(values: readonly number[]) {
  let s = 0
  for (const v of values) s += v
  return s
}

export function mean(values: readonly number[]) {
  return values.length ? sum(values) / values.length : NaN
}

/** Unbiased sample variance (n − 1 in the denominator). */
export function variance(values: readonly number[]) {
  const n = values.length
  if (n < 2) return NaN
  const m = mean(values)
  let s = 0
  for (const v of values) s += (v - m) ** 2
  return s / (n - 1)
}

export const standardDeviation = (values: readonly number[]) => Math.sqrt(variance(values))

/**
 * Quantile of an ascending-sorted array.
 * - `linear`: Hyndman–Fan type 7 (R/NumPy/D3 default): h = (n − 1)p, linear interpolation.
 * - `tukey`: Tukey's hinges — medians of the lower/upper halves (median included in both halves when n is odd).
 *   Only defined for p ∈ {0.25, 0.5, 0.75}; other p fall back to `linear`.
 */
export function quantileSorted(sorted: readonly number[], p: number, method: QuantileMethod = 'linear'): number {
  const n = sorted.length
  if (!n) return NaN
  if (method === 'tukey' && (p === 0.25 || p === 0.75)) {
    const half = Math.ceil(n / 2)
    const part = p === 0.25 ? sorted.slice(0, half) : sorted.slice(n - half)
    return quantileSorted(part, 0.5, 'linear')
  }
  if (p <= 0) return sorted[0]
  if (p >= 1) return sorted[n - 1]
  const h = (n - 1) * p
  const lo = Math.floor(h)
  return sorted[lo] + (h - lo) * (sorted[Math.min(lo + 1, n - 1)] - sorted[lo])
}

export const median = (values: readonly number[]) => quantileSorted(sortNumbers(values), 0.5)

export function extent(values: readonly number[]): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const v of values) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return [lo, hi]
}

/** Pearson correlation coefficient over paired finite values. */
export function pearson(xs: readonly number[], ys: readonly number[]) {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return NaN
  const mx = mean(xs.slice(0, n))
  const my = mean(ys.slice(0, n))
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  return sxx === 0 || syy === 0 ? NaN : sxy / Math.sqrt(sxx * syy)
}

/** Ordinary least squares fit y = intercept + slope·x. */
export function linearRegression(xs: readonly number[], ys: readonly number[]) {
  const n = Math.min(xs.length, ys.length)
  const mx = mean(xs.slice(0, n))
  const my = mean(ys.slice(0, n))
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
  }
  const slope = sxx === 0 ? NaN : sxy / sxx
  return { slope, intercept: my - slope * mx }
}

export type Aggregate = 'sum' | 'mean' | 'median' | 'count' | 'min' | 'max'

export function aggregate(values: readonly number[], method: Aggregate) {
  if (method === 'count') return values.length
  if (!values.length) return NaN
  switch (method) {
    case 'sum': return sum(values)
    case 'mean': return mean(values)
    case 'median': return median(values)
    case 'min': return extent(values)[0]
    case 'max': return extent(values)[1]
  }
}

/** Trailing moving average; the first window − 1 points average whatever is available. */
export function movingAverage(values: readonly number[], window: number) {
  const out: number[] = []
  let s = 0
  for (let i = 0; i < values.length; i++) {
    s += values[i]
    if (i >= window) s -= values[i - window]
    out.push(s / Math.min(i + 1, window))
  }
  return out
}

export function zScores(values: readonly number[]) {
  const m = mean(values)
  const sd = standardDeviation(values)
  return values.map((v) => (sd > 0 ? (v - m) / sd : 0))
}
