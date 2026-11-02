import * as d3 from 'd3'

/**
 * Value-Suppressing Uncertainty Palette (Correll, Moritz, Heer 2018): the value scale is split into 2^(L-1) bins when the uncertainty is
 * lowest and the bins merge pairwise as uncertainty rises, down to a single colour at the highest level, so uncertain values cannot be
 * told apart. The merged colour is the colour of the merged bin's middle, lightly pulled toward grey with the uncertainty level.
 */
export const vsupBins = (levels: number, level: number) => 2 ** Math.max(0, levels - 1 - level)

export interface VsupCell { level: number; bin: number; bins: number }

/** Cell of a (value, uncertainty) pair, both given as fractions 0…1 (e.g. percentile ranks). */
export function vsupCell(tValue: number, tUncertainty: number, levels: number): VsupCell {
  const level = Math.min(levels - 1, Math.max(0, Math.floor(tUncertainty * levels)))
  const bins = vsupBins(levels, level)
  return { level, bins, bin: Math.min(bins - 1, Math.max(0, Math.floor(tValue * bins))) }
}

/** The value (0…1) a cell stands for: the middle of its bin. */
export const vsupValue = (c: VsupCell) => (c.bin + 0.5) / c.bins

export function vsupColor(ramp: (t: number) => string, c: VsupCell, levels: number, grey = '#e6e6e6', pull = 0.3): string {
  const base = ramp(vsupValue(c))
  return d3.interpolateLab(base, grey)(levels > 1 ? (pull * c.level) / (levels - 1) : 0)
}

/** Percentile rank (0…1) of a value among `values` (ties share the mean rank). */
export function percentileRanker(values: readonly number[]): (v: number) => number {
  const s = [...values].sort((a, b) => a - b)
  const n = s.length
  return (v) => {
    if (n < 2) return 0
    let lo = 0, hi = n
    while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < v) lo = m + 1; else hi = m }
    let up = lo
    while (up < n && s[up] === v) up++
    return Math.min(1, Math.max(0, (lo + Math.max(lo, up - 1)) / 2 / (n - 1)))
  }
}
