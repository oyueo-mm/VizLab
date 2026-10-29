import { quantileSorted, sortNumbers, standardDeviation } from './descriptive'

export type KernelName = 'gaussian' | 'epanechnikov' | 'uniform' | 'triangular'

/** Kernels K(u) with ∫K = 1. Compact kernels are zero outside |u| ≤ 1. */
export const kernels: Record<KernelName, (u: number) => number> = {
  gaussian: (u) => Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI),
  epanechnikov: (u) => (Math.abs(u) <= 1 ? 0.75 * (1 - u * u) : 0),
  uniform: (u) => (Math.abs(u) <= 1 ? 0.5 : 0),
  triangular: (u) => (Math.abs(u) <= 1 ? 1 - Math.abs(u) : 0),
}

/** Half-width of the kernel's support in units of h (Gaussian: effectively 4σ). */
export const kernelReach: Record<KernelName, number> = { gaussian: 4, epanechnikov: 1, uniform: 1, triangular: 1 }

/** Silverman's rule of thumb: 0.9 · min(σ, IQR/1.34) · n^(−1/5). */
export function silvermanBandwidth(values: readonly number[]) {
  const n = values.length
  if (n < 2) return 1
  const s = sortNumbers(values)
  const sd = standardDeviation(values)
  const iqr = quantileSorted(s, 0.75) - quantileSorted(s, 0.25)
  const spread = Math.min(sd, iqr / 1.34) || sd || 1
  return 0.9 * spread * n ** -0.2
}

/** Scott's rule: 1.06 · σ · n^(−1/5). */
export function scottBandwidth(values: readonly number[]) {
  const n = values.length
  if (n < 2) return 1
  return 1.06 * (standardDeviation(values) || 1) * n ** -0.2
}

/** f̂(x) = 1/(n·h) · Σ K((x − xᵢ)/h), evaluated on the given grid. */
export function kde(values: readonly number[], bandwidth: number, kernel: KernelName, grid: readonly number[]) {
  const n = values.length
  const K = kernels[kernel]
  const h = bandwidth
  if (!n || !(h > 0)) return grid.map(() => 0)
  return grid.map((x) => {
    let s = 0
    for (const v of values) s += K((x - v) / h)
    return s / (n * h)
  })
}

/** Evenly spaced evaluation grid that extends `pad` beyond the data. */
export function kdeGrid(min: number, max: number, pad: number, steps = 160) {
  const lo = min - pad
  const hi = max + pad
  const step = (hi - lo) / (steps - 1 || 1)
  return Array.from({ length: steps }, (_, i) => lo + i * step)
}
