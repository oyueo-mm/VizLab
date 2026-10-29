import { extent, quantileSorted, sortNumbers, standardDeviation } from './descriptive'

export type BinRule = 'sturges' | 'sqrt' | 'scott' | 'fd'
export type HistogramNorm = 'count' | 'density' | 'relative'

export interface Bin {
  x0: number
  x1: number
  count: number
  /** count / (n · width): the bar areas sum to 1. */
  density: number
  /** count / n: the bar heights sum to 1. */
  relative: number
}

/** Suggested bin count for a rule. Width-based rules are converted with the data range. */
export function suggestBinCount(values: readonly number[], rule: BinRule): number {
  const n = values.length
  if (n < 2) return 1
  const [lo, hi] = extent(values)
  const range = hi - lo
  if (range === 0) return 1
  let width: number
  switch (rule) {
    case 'sturges': return Math.ceil(Math.log2(n)) + 1
    case 'sqrt': return Math.ceil(Math.sqrt(n))
    case 'scott': width = 3.49 * standardDeviation(values) * n ** (-1 / 3); break
    case 'fd': {
      const s = sortNumbers(values)
      width = 2 * (quantileSorted(s, 0.75) - quantileSorted(s, 0.25)) * n ** (-1 / 3)
      break
    }
  }
  if (!(width > 0)) return Math.ceil(Math.log2(n)) + 1
  return Math.max(1, Math.ceil(range / width))
}

/** Equally spaced edges: `count` bins of `width`, starting at `start`. */
export function equalEdges(start: number, width: number, count: number) {
  return Array.from({ length: count + 1 }, (_, i) => start + i * width)
}

/**
 * Bins over explicit ascending edges. Every bin is half-open [x0, x1) except the last, which
 * is closed [x0, x1] so the maximum is not lost. Values outside the edges are reported, not dropped silently.
 */
export function binValues(values: readonly number[], edges: readonly number[]) {
  const bins: Bin[] = []
  const k = edges.length - 1
  for (let i = 0; i < k; i++) bins.push({ x0: edges[i], x1: edges[i + 1], count: 0, density: 0, relative: 0 })
  let outside = 0
  for (const v of values) {
    if (k < 1 || v < edges[0] || v > edges[k]) { outside++; continue }
    // binary search for the last edge <= v
    let lo = 0
    let hi = k
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (edges[mid] <= v) lo = mid
      else hi = mid
    }
    bins[Math.min(lo, k - 1)].count++
  }
  const n = values.length
  for (const b of bins) {
    b.relative = n ? b.count / n : 0
    b.density = n && b.x1 > b.x0 ? b.count / (n * (b.x1 - b.x0)) : 0
  }
  return { bins, outside }
}

/**
 * Builds `count` equal-width bins covering the data. `offset` ∈ [0, 1) shifts every edge left by
 * offset·width, keeping the width fixed (one extra bin is added so the data stay covered).
 */
export function histogram(values: readonly number[], count: number, offset = 0) {
  if (!values.length) return { bins: [] as Bin[], outside: 0, width: 0, edges: [] as number[] }
  let [lo, hi] = extent(values)
  if (lo === hi) { lo -= 0.5; hi += 0.5 }
  const width = (hi - lo) / count
  const start = lo - offset * width
  const edges = equalEdges(start, width, count + (offset > 0 ? 1 : 0))
  return { ...binValues(values, edges), width, edges }
}
