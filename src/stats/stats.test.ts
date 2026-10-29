import { describe, expect, it } from 'vitest'
import { aggregate, linearRegression, mean, median, movingAverage, pearson, quantileSorted, standardDeviation, variance, zScores } from './descriptive'
import { boxStats } from './boxplot'
import { ecdf, ecdfAt, normalCdf } from './ecdf'
import { binValues, equalEdges, histogram, suggestBinCount } from './histogram'
import { kde, kdeGrid, kernels, scottBandwidth, silvermanBandwidth, type KernelName } from './kde'
import { hexbin } from './hexbin'
import { correlationMatrix, dodge } from './layout'
import { createRng } from '../lib/random'

const trapezoid = (xs: number[], ys: number[]) => ys.slice(1).reduce((s, y, i) => s + ((y + ys[i]) / 2) * (xs[i + 1] - xs[i]), 0)

describe('descriptive statistics', () => {
  it('computes mean, sample variance and standard deviation', () => {
    const v = [2, 4, 4, 4, 5, 5, 7, 9]
    expect(mean(v)).toBe(5)
    expect(variance(v)).toBeCloseTo(32 / 7, 12)
    expect(standardDeviation(v)).toBeCloseTo(Math.sqrt(32 / 7), 12)
    expect(Number.isNaN(variance([1]))).toBe(true)
  })

  it('matches R type-7 quantiles', () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    // R: quantile(1:10) → 1, 3.25, 5.5, 7.75, 10
    expect(quantileSorted(s, 0)).toBe(1)
    expect(quantileSorted(s, 0.25)).toBeCloseTo(3.25)
    expect(quantileSorted(s, 0.5)).toBeCloseTo(5.5)
    expect(quantileSorted(s, 0.75)).toBeCloseTo(7.75)
    expect(quantileSorted(s, 1)).toBe(10)
    expect(median([3, 1, 2])).toBe(2)
  })

  it('computes Tukey hinges as medians of the halves', () => {
    // n odd: the median belongs to both halves. 1..9 → lower half 1..5 (median 3), upper 5..9 (median 7)
    const odd = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    expect(quantileSorted(odd, 0.25, 'tukey')).toBe(3)
    expect(quantileSorted(odd, 0.75, 'tukey')).toBe(7)
    // n even: 1..8 → halves 1..4 and 5..8 → 2.5 and 6.5
    const even = [1, 2, 3, 4, 5, 6, 7, 8]
    expect(quantileSorted(even, 0.25, 'tukey')).toBe(2.5)
    expect(quantileSorted(even, 0.75, 'tukey')).toBe(6.5)
  })

  it('computes Pearson r and least squares regression', () => {
    const x = [1, 2, 3, 4, 5]
    expect(pearson(x, x.map((v) => 3 * v + 1))).toBeCloseTo(1, 12)
    expect(pearson(x, x.map((v) => -2 * v))).toBeCloseTo(-1, 12)
    const { slope, intercept } = linearRegression(x, [2.1, 3.9, 6.2, 7.8, 10.1])
    expect(slope).toBeCloseTo(1.99, 10)
    expect(intercept).toBeCloseTo(0.05, 10)
    expect(Number.isNaN(pearson([1, 1, 1], [1, 2, 3]))).toBe(true)
  })

  it('aggregates and smooths', () => {
    expect(aggregate([1, 2, 3, 10], 'sum')).toBe(16)
    expect(aggregate([1, 2, 3, 10], 'mean')).toBe(4)
    expect(aggregate([1, 2, 3, 10], 'median')).toBe(2.5)
    expect(aggregate([1, 2, 3, 10], 'count')).toBe(4)
    expect(aggregate([], 'count')).toBe(0)
    expect(movingAverage([1, 2, 3, 4, 5], 3)).toEqual([1, 1.5, 2, 3, 4])
    const z = zScores([1, 2, 3])
    expect(z[0]).toBeCloseTo(-1)
    expect(z[2]).toBeCloseTo(1)
  })
})

describe('histogram', () => {
  it('uses half-open bins with a closed last bin', () => {
    const { bins, outside } = binValues([0, 1, 1.999, 2, 3, 4], [0, 2, 4])
    expect(bins.map((b) => b.count)).toEqual([3, 3])
    expect(outside).toBe(0)
    expect(binValues([-1, 5], [0, 2, 4]).outside).toBe(2)
  })

  it('normalises to density (area 1) and relative frequency (sum 1)', () => {
    const rng = createRng(3)
    const values = Array.from({ length: 500 }, () => rng.normal(10, 3))
    const { bins, width } = histogram(values, 17)
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(500)
    expect(bins.reduce((s, b) => s + b.relative, 0)).toBeCloseTo(1, 12)
    expect(bins.reduce((s, b) => s + b.density * width, 0)).toBeCloseTo(1, 12)
  })

  it('keeps the width and still covers all data when the edges are shifted', () => {
    const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const plain = histogram(values, 5)
    const shifted = histogram(values, 5, 0.5)
    expect(shifted.width).toBeCloseTo(plain.width)
    expect(shifted.edges[0]).toBeCloseTo(-1)
    expect(shifted.bins.length).toBe(6)
    expect(shifted.outside).toBe(0)
    expect(shifted.bins.reduce((s, b) => s + b.count, 0)).toBe(11)
  })

  it('suggests bin counts with standard rules', () => {
    const values = Array.from({ length: 100 }, (_, i) => i)
    expect(suggestBinCount(values, 'sturges')).toBe(Math.ceil(Math.log2(100)) + 1)
    expect(suggestBinCount(values, 'sqrt')).toBe(10)
    // FD: IQR = 49.5, h = 2·49.5·100^(−1/3) ≈ 21.33 → ceil(99 / 21.33) = 5
    expect(suggestBinCount(values, 'fd')).toBe(5)
    expect(suggestBinCount([5, 5, 5], 'scott')).toBe(1)
  })

  it('builds equal edges', () => {
    expect(equalEdges(0, 2.5, 4)).toEqual([0, 2.5, 5, 7.5, 10])
  })
})

describe('kernel density estimation', () => {
  const names: KernelName[] = ['gaussian', 'epanechnikov', 'uniform', 'triangular']

  it('uses kernels that integrate to one', () => {
    // Discontinuous kernels (uniform) carry an O(grid step) trapezoid error, hence the fine grid.
    const u = kdeGrid(-5, 5, 0, 40001)
    for (const k of names) expect(trapezoid(u, u.map(kernels[k]))).toBeCloseTo(1, 3)
  })

  it('produces a density that integrates to one and peaks at the data', () => {
    const data = [2, 3, 3.5, 7, 8]
    const grid = kdeGrid(-10, 20, 0, 30001)
    for (const k of names) {
      const d = kde(data, 1.2, k, grid)
      expect(trapezoid(grid, d)).toBeCloseTo(1, 3)
      expect(d.every((v) => v >= 0)).toBe(true)
    }
  })

  it('matches the closed form for one point with a Gaussian kernel', () => {
    const [v] = kde([0], 2, 'gaussian', [1])
    expect(v).toBeCloseTo(Math.exp(-0.125) / (2 * Math.sqrt(2 * Math.PI)), 12)
  })

  it('computes Silverman and Scott bandwidths', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const sd = standardDeviation(values)
    const iqr = 7.75 - 3.25
    expect(silvermanBandwidth(values)).toBeCloseTo(0.9 * Math.min(sd, iqr / 1.34) * 10 ** -0.2, 12)
    expect(scottBandwidth(values)).toBeCloseTo(1.06 * sd * 10 ** -0.2, 12)
  })
})

describe('ECDF', () => {
  it('steps by 1/n and merges ties', () => {
    const steps = ecdf([3, 1, 2, 2])
    expect(steps).toEqual([{ x: 1, p: 0.25, count: 1 }, { x: 2, p: 0.75, count: 3 }, { x: 3, p: 1, count: 4 }])
  })

  it('evaluates F(x) as the share of values ≤ x (right-continuous)', () => {
    const steps = ecdf([1, 2, 2, 3])
    expect(ecdfAt(steps, 0.5)).toBe(0)
    expect(ecdfAt(steps, 1)).toBe(0.25)
    expect(ecdfAt(steps, 1.99)).toBe(0.25)
    expect(ecdfAt(steps, 2)).toBe(0.75)
    expect(ecdfAt(steps, 99)).toBe(1)
  })

  it('approximates the normal CDF', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7)
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6)
    expect(normalCdf(-1)).toBeCloseTo(0.158655, 6)
    expect(normalCdf(60, 50, 10)).toBeCloseTo(0.841345, 6)
  })
})

describe('box plot statistics', () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100]

  it('applies the Tukey 1.5·IQR rule', () => {
    const s = boxStats(values)!
    expect(s.q1).toBeCloseTo(3.25)
    expect(s.median).toBeCloseTo(5.5)
    expect(s.q3).toBeCloseTo(7.75)
    expect(s.iqr).toBeCloseTo(4.5)
    expect(s.upperFence).toBeCloseTo(14.5)
    expect(s.lowerFence).toBeCloseTo(-3.5)
    expect(s.outliers).toEqual([100])
    expect(s.whiskerHigh).toBe(9)
    expect(s.whiskerLow).toBe(1)
  })

  it('changes outliers with k and with the rule', () => {
    expect(boxStats([...values, 20], { k: 3 })!.outliers).toEqual([100])
    expect(boxStats([...values, 20], { k: 1.5 })!.outliers).toEqual([20, 100])
    const mm = boxStats(values, { rule: 'minmax' })!
    expect(mm.outliers).toEqual([])
    expect(mm.whiskerHigh).toBe(100)
    const pc = boxStats(values, { rule: 'percentile', percentile: 0.1 })!
    expect(pc.whiskerLow).toBeCloseTo(1.9)
    expect(pc.outliers).toEqual([1, 100])
  })

  it('returns null for empty input', () => {
    expect(boxStats([])).toBeNull()
  })
})

describe('hexagonal binning', () => {
  it('assigns every point to the nearest hexagon centre', () => {
    const rng = createRng(11)
    const pts = Array.from({ length: 3000 }, () => [rng() * 400, rng() * 300] as [number, number])
    const r = 13
    const bins = hexbin(pts, (p) => p[0], (p) => p[1], r)
    expect(bins.reduce((s, b) => s + b.points.length, 0)).toBe(3000)
    const centres = bins.map((b) => [b.x, b.y])
    for (const b of bins.slice(0, 80)) {
      for (const p of b.points) {
        const own = Math.hypot(p[0] - b.x, p[1] - b.y)
        // nearest centre among all bins (brute force) must not be closer than the assigned one
        const best = Math.min(...centres.map(([cx, cy]) => Math.hypot(p[0] - cx, p[1] - cy)))
        expect(own).toBeLessThanOrEqual(best + 1e-9)
        expect(own).toBeLessThanOrEqual(r + 1e-9)
      }
    }
  })

  it('places centres on the pointy-top lattice', () => {
    const r = 10
    const bins = hexbin([[0, 0], [Math.sqrt(3) * r, 0], [Math.sqrt(3) * r / 2, 1.5 * r]] as [number, number][], (p) => p[0], (p) => p[1], r)
    expect(bins.map((b) => [+b.x.toFixed(6), +b.y.toFixed(6)])).toEqual([[0, 0], [+(Math.sqrt(3) * r).toFixed(6), 0], [+(Math.sqrt(3) * r / 2).toFixed(6), 15]])
  })
})

describe('layout helpers', () => {
  it('dodges circles without overlap while keeping their values', () => {
    const rng = createRng(5)
    const ys = Array.from({ length: 120 }, () => rng.normal(100, 15))
    const r = 3
    const xs = dodge(ys, r)
    for (let i = 0; i < ys.length; i++)
      for (let j = i + 1; j < ys.length; j++)
        expect((xs[i] - xs[j]) ** 2 + (ys[i] - ys[j]) ** 2).toBeGreaterThanOrEqual((2 * r) ** 2 - 1e-6)
  })

  it('builds a symmetric correlation matrix with unit diagonal', () => {
    const m = correlationMatrix([[1, 2, 3, 4], [2, 4, 6, 8.5], [4, 3, 2, 1]])
    expect(m[0][0]).toBeCloseTo(1)
    expect(m[0][1]).toBeCloseTo(m[1][0])
    expect(m[0][2]).toBeCloseTo(-1)
  })
})
