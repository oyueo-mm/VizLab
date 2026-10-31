import * as d3 from 'd3'
import { describe, expect, it } from 'vitest'
import { createRng } from '../lib/random'
import { buildAlluvial, stageTotals } from './alluvial'
import { andrewsCurve, andrewsGrid, andrewsValue } from './andrews'
import { bulletBand, bulletRanges, pyramidValues } from './bars'
import { addMonths, daysBetween, formatISO, formatTime, isAmbiguousDate, parseDateTime, periodStart, toTime } from './datetime'
import { normalQuantile } from './distributions'
import { bandsFromSigma, fanIssue, repairFan, zFor } from './fan'
import { horizonLayers, unfold } from './horizon'
import { icicleLayout } from './icicle'
import { bandwidth2d, contourPolygons, equalThresholds, gridMass, hdrThresholds, kde2d } from './kde2d'
import { boxCount, letterDepths, letterValues } from './letterValue'
import { chiSquare, collectCounts, mosaicLayout } from './mosaic'
import { buildNetwork, layoutNetwork, type ForceOptions } from './network'
import { aggregateCandles, ohlcIssue, type Candle } from './ohlc'
import { pareto, vitalFew } from './pareto'
import { jacobiEigen, pca } from './pca'
import { empiricalP, fitReference, ksStatistic, ppPoints } from './pp'
import { aucByRanks, averagePrecision, confusionAt, curveIssue, curvePoints, pointAt, prAucTrapezoid, prevalence, rocAuc, type Scored } from './roc'
import { stepValueAt, stepVertices } from './step'

const normalSample = (n: number, seed: number, mean = 0, sd = 1) => { const r = createRng(seed); return Array.from({ length: n }, () => r.normal(mean, sd)) }

describe('2D KDE', () => {
  const r = createRng(5)
  const xs = Array.from({ length: 300 }, () => r.normal(10, 2))
  const ys = xs.map((x) => 0.8 * x + r.normal(0, 1))

  it('uses Scott’s bandwidth σ·n^(−1/6) per axis', () => {
    const [hx, hy] = bandwidth2d(xs, ys)
    expect(hx).toBeCloseTo(d3.deviation(xs)! * 300 ** (-1 / 6), 10)
    expect(hy).toBeCloseTo(d3.deviation(ys)! * 300 ** (-1 / 6), 10)
  })

  it('integrates to 1 over the grid and matches a direct evaluation of the formula', () => {
    const [hx, hy] = bandwidth2d(xs, ys)
    const d = kde2d(xs, ys, hx, hy, 90, 90)
    expect(gridMass(d)).toBeGreaterThan(0.985)
    expect(gridMass(d)).toBeLessThan(1.015)
    for (const [gx, gy] of [[10, 12], [45, 40], [80, 20]]) {
      const x = d.x0 + gx * d.dx
      const y = d.y0 + gy * d.dy
      let s = 0
      for (let i = 0; i < xs.length; i++) s += Math.exp(-0.5 * (((x - xs[i]) / hx) ** 2 + ((y - ys[i]) / hy) ** 2))
      expect(d.values[gy * d.nx + gx]).toBeCloseTo(s / (2 * Math.PI * xs.length * hx * hy), 12)
    }
  })

  it('peaks near the data centre and a single point gives a bivariate normal bump', () => {
    const d = kde2d([0], [0], 1, 1, 61, 61)
    expect(d.max).toBeCloseTo(1 / (2 * Math.PI), 3)
    const ix = d.values.indexOf(d.max) % d.nx
    expect(d.x0 + ix * d.dx).toBeCloseTo(0, 1)
  })

  it('highest-density-region thresholds enclose the requested mass', () => {
    const [hx, hy] = bandwidth2d(xs, ys)
    const d = kde2d(xs, ys, hx, hy, 100, 100)
    const [t50, t90] = hdrThresholds(d, [0.5, 0.9])
    expect(t50).toBeGreaterThan(t90)
    for (const [t, p] of [[t50, 0.5], [t90, 0.9]] as const) {
      let mass = 0
      for (const v of d.values) if (v >= t) mass += v * d.dx * d.dy
      expect(mass / gridMass(d)).toBeGreaterThanOrEqual(p - 1e-9)
      expect(mass / gridMass(d)).toBeLessThan(p + 0.02)
    }
    expect(equalThresholds(d, 4)).toHaveLength(4)
    const polys = contourPolygons(d, equalThresholds(d, 4))
    expect(polys).toHaveLength(4)
    expect(polys.every((p) => p.coordinates.length > 0)).toBe(true)
  })
})

describe('P-P plot', () => {
  it('uses the stated plotting positions', () => {
    expect(empiricalP(1, 10, 'hazen')).toBeCloseTo(0.05)
    expect(empiricalP(10, 10, 'hazen')).toBeCloseTo(0.95)
    expect(empiricalP(3, 9, 'weibull')).toBeCloseTo(0.3)
    expect(empiricalP(10, 10, 'ecdf')).toBe(1)
  })

  it('a normal sample against a fitted normal lies close to the diagonal', () => {
    const xs = normalSample(400, 11, 50, 10)
    const { ref } = fitReference(xs, 'normal')
    const pts = ppPoints(xs.map((value, row) => ({ row, value })), ref!)
    const worst = Math.max(...pts.map((p) => Math.abs(p.empirical - p.reference)))
    expect(worst).toBeLessThan(0.05)
    expect(pts.every((p, i) => i === 0 || (p.empirical > pts[i - 1].empirical && p.reference >= pts[i - 1].reference))).toBe(true)
  })

  it('shows a clear departure for a skewed sample against a normal reference and fits it as lognormal', () => {
    const r = createRng(4)
    const xs = Array.from({ length: 400 }, () => Math.exp(r.normal(3, 0.6)))
    const normal = fitReference(xs, 'normal').ref!
    const logn = fitReference(xs, 'lognormal').ref!
    expect(ksStatistic(xs, normal)).toBeGreaterThan(ksStatistic(xs, logn) * 2)
  })

  it('computes known reference CDFs and rejects impossible fits', () => {
    const exp = fitReference([1, 2, 3], 'exponential').ref!
    expect(exp.cdf(2)).toBeCloseTo(1 - Math.exp(-1), 12)
    expect(fitReference([-1, 2, 3], 'exponential').ref).toBeNull()
    expect(fitReference([0, 2, 3], 'lognormal').ref).toBeNull()
    expect(fitReference([3, 5], 'uniform').ref!.cdf(4)).toBeCloseTo(0.5)
  })
})

describe('letter-value plot', () => {
  it('follows the depth recurrence d₁ = (n+1)/2, dᵢ₊₁ = (⌊dᵢ⌋+1)/2', () => {
    expect(letterDepths(11)).toEqual([6, 3.5, 2, 1.5, 1])
    expect(letterDepths(1000).slice(0, 5)).toEqual([500.5, 250.5, 125.5, 63, 32])
  })

  it('returns the median, fourths and eighths of 1…11', () => {
    const lv = letterValues(d3.range(1, 12), 4)!
    expect(lv.median).toBe(6)
    expect(lv.boxes.map((b) => [b.lower, b.upper])).toEqual([[3.5, 8.5], [2, 10], [1.5, 10.5], [1, 11]])
    expect(lv.outliers).toEqual([])
  })

  it('each box holds about half of the remaining tail and leaves the expected outliers', () => {
    const xs = normalSample(2000, 3)
    const lv = letterValues(xs, 6)!
    const sorted = [...xs].sort((a, b) => a - b)
    for (const b of lv.boxes) {
      const below = sorted.filter((v) => v < b.lower).length / 2000
      expect(below).toBeCloseTo(2 ** -(b.level + 1), 1)
    }
    expect(lv.outliers.length).toBe(xs.filter((v) => v < lv.boxes[5].lower || v > lv.boxes[5].upper).length)
    expect(lv.boxes.map((b) => b.upper - b.lower)).toEqual([...lv.boxes.map((b) => b.upper - b.lower)].sort((a, b) => a - b))
  })

  it('draws fewer boxes for small samples', () => {
    expect(boxCount(12, 'proportion')).toBeLessThanOrEqual(letterDepths(12).length - 1)
    expect(boxCount(20, 'tukey')).toBe(1)
    expect(boxCount(1000, 'tukey')).toBe(6)
    expect(boxCount(100000, 'tukey')).toBeGreaterThan(boxCount(1000, 'tukey'))
    expect(boxCount(2, 'full')).toBe(1)
  })
})

describe('PCA', () => {
  it('diagonalises known matrices', () => {
    const e = jacobiEigen([[2, -1, 0], [-1, 2, -1], [0, -1, 2]])
    expect(e.values[0]).toBeCloseTo(2 + Math.SQRT2, 10)
    expect(e.values[1]).toBeCloseTo(2, 10)
    expect(e.values[2]).toBeCloseTo(2 - Math.SQRT2, 10)
    // A v = λ v
    const A = [[2, -1, 0], [-1, 2, -1], [0, -1, 2]]
    e.vectors.forEach((v, k) => A.forEach((row, i) => expect(row.reduce((s, a, j) => s + a * v[j], 0)).toBeCloseTo(e.values[k] * v[i], 9)))
    const c = jacobiEigen([[1, 0.8], [0.8, 1]])
    expect(c.values[0]).toBeCloseTo(1.8, 12)
    expect(c.values[1]).toBeCloseTo(0.2, 12)
  })

  it('explained variance, score variance and orthogonality are consistent', () => {
    const r = createRng(9)
    const data = Array.from({ length: 200 }, () => { const a = r.normal(); const b = r.normal(); return [3 * a + r.normal(0, 0.3), 2 * a + b, b + r.normal(0, 0.5), r.normal(0, 0.2)] })
    const res = pca(data, { center: true, scale: false })!
    expect(res.explained.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12)
    res.eigenvalues.forEach((l, k) => expect(d3.variance(res.scores, (s) => s[k])).toBeCloseTo(l, 8))
    // total variance is preserved
    const totalVar = [0, 1, 2, 3].reduce((s, j) => s + d3.variance(data, (row) => row[j])!, 0)
    expect(res.eigenvalues.reduce((s, v) => s + v, 0)).toBeCloseTo(totalVar, 8)
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) expect(res.vectors[a].reduce((s, v, j) => s + v * res.vectors[b][j], 0)).toBeCloseTo(a === b ? 1 : 0, 9)
    // scores are uncorrelated
    expect(d3.sum(res.scores, (s) => s[0] * s[1]) / 199).toBeCloseTo(0, 8)
  })

  it('standardising uses the correlation matrix: eigenvalues sum to p and loadings are correlations', () => {
    const r = createRng(2)
    const data = Array.from({ length: 150 }, () => { const a = r.normal(); return [100 * a + r.normal(0, 30), a + r.normal(0, 0.4), r.normal()] })
    const res = pca(data, { center: true, scale: true })!
    expect(res.eigenvalues.reduce((s, v) => s + v, 0)).toBeCloseTo(3, 9)
    for (let j = 0; j < 3; j++) expect(res.loadings[0][j]).toBeCloseTo(pearsonOf(data.map((row) => row[j]), res.scores.map((s) => s[0])), 6)
  })

  it('finds a single component for collinear data and refuses degenerate input', () => {
    const line = Array.from({ length: 20 }, (_, i) => [i, 2 * i])
    const res = pca(line, { center: true, scale: false })!
    expect(res.explained[0]).toBeCloseTo(1, 12)
    expect(res.vectors[0][1] / res.vectors[0][0]).toBeCloseTo(2, 9)
    expect(pca([[1, 2], [3, 4]], { center: true, scale: false })).toBeNull()
    expect(pca(line.map((r) => [r[0]]), { center: true, scale: false })).toBeNull()
  })
})

function pearsonOf(a: number[], b: number[]) {
  const ma = d3.mean(a)!
  const mb = d3.mean(b)!
  return d3.sum(a, (v, i) => (v - ma) * (b[i] - mb)) / Math.sqrt(d3.sum(a, (v) => (v - ma) ** 2) * d3.sum(b, (v) => (v - mb) ** 2))
}

describe('Andrews curves', () => {
  it('evaluates the Fourier series terms', () => {
    expect(andrewsValue([1], 0.3)).toBeCloseTo(1 / Math.SQRT2)
    expect(andrewsValue([0, 1], Math.PI / 2)).toBeCloseTo(1)
    expect(andrewsValue([0, 0, 1], Math.PI)).toBeCloseTo(-1)
    expect(andrewsValue([0, 0, 0, 1], Math.PI / 4)).toBeCloseTo(1)
    expect(andrewsValue([0, 0, 0, 0, 1], Math.PI / 2)).toBeCloseTo(-1)
    expect(andrewsValue([1, 2, 3, 4, 5], 0)).toBeCloseTo(1 / Math.SQRT2 + 3 + 5)
  })

  it('is an isometry: ∫(f_x − f_y)² dt = π‖x − y‖²', () => {
    const x = [1.2, -0.5, 2, 0.3, -1]
    const y = [0.2, 0.8, -1, 1.3, 0.4]
    const ts = andrewsGrid(4001)
    const diff = andrewsCurve(x, ts).map((v, i) => v - andrewsCurve(y, ts)[i])
    const h = (2 * Math.PI) / 4000
    const integral = d3.sum(diff.slice(0, -1), (v, i) => ((v * v + diff[i + 1] ** 2) / 2) * h)
    expect(integral).toBeCloseTo(Math.PI * d3.sum(x, (v, i) => (v - y[i]) ** 2), 4)
  })
})

describe('Pareto', () => {
  it('sorts descending and accumulates shares up to 100 %', () => {
    const { rows, total } = pareto([{ name: 'a', value: 10, row: 0 }, { name: 'b', value: 50, row: 1 }, { name: 'c', value: 30, row: 2 }, { name: 'd', value: 10, row: 3 }])
    expect(total).toBe(100)
    expect(rows.map((r) => r.name)).toEqual(['b', 'c', 'a', 'd'])
    expect(rows.map((r) => r.cum)).toEqual([0.5, 0.8, 0.9, 1])
    expect(rows.map((r) => r.share)).toEqual([0.5, 0.3, 0.1, 0.1])
    expect(vitalFew(rows, 0.8)).toBe(1)
    expect(vitalFew(rows, 0.85)).toBe(2)
  })

  it('ignores negative and non-finite values and keeps the order when sorting is off', () => {
    const { rows } = pareto([{ name: 'a', value: 1, row: 0 }, { name: 'x', value: -3, row: 1 }, { name: 'b', value: NaN, row: 2 }, { name: 'c', value: 3, row: 3 }], false)
    expect(rows.map((r) => r.name)).toEqual(['a', 'c'])
    expect(rows[1].cum).toBe(1)
  })
})

describe('candlestick data', () => {
  it('validates the OHLC relationships', () => {
    expect(ohlcIssue(10, 12, 9, 11)).toBeNull()
    expect(ohlcIssue(10, 9, 8, 9)).toMatch(/고가/)
    expect(ohlcIssue(10, 12, 11, 11)).toMatch(/저가/)
    expect(ohlcIssue(10, 8, 9, 9)).toMatch(/고가/)
    expect(ohlcIssue(10, NaN, 9, 11)).toMatch(/숫자/)
    expect(ohlcIssue(10, 10, 10, 10)).toBeNull()
  })

  it('aggregates days into weeks with first open, last close, extreme high/low and summed volume', () => {
    const day = (iso: string, o: number, h: number, l: number, c: number, v: number): Candle => ({ t: parseDateTime(iso)!, o, h, l, c, v, row: 0 })
    // 2024-03-04 is a Monday
    const weeks = aggregateCandles([day('2024-03-04', 10, 12, 9, 11, 100), day('2024-03-06', 11, 15, 10, 14, 50), day('2024-03-08', 14, 14, 8, 9, 25), day('2024-03-11', 9, 10, 7, 8, 5)], 'week')
    expect(weeks).toHaveLength(2)
    expect(weeks[0]).toMatchObject({ o: 10, c: 9, h: 15, l: 8, v: 175 })
    expect(formatISO(weeks[0].t)).toBe('2024-03-04')
    expect(weeks[1]).toMatchObject({ o: 9, c: 8, h: 10, l: 7, v: 5 })
  })
})

describe('horizon chart', () => {
  it('folds a series into bands whose sum reproduces the value', () => {
    const vals = [0, 1, 2.5, 3, -1, -2.5, -3, 0.5]
    const layers = horizonLayers(vals, 0, 3)
    expect(layers.bandWidth).toBeCloseTo(1)
    vals.forEach((v, i) => expect(unfold(layers, i)).toBeCloseTo(v))
    expect(layers.pos[0][2]).toBe(1)
    expect(layers.pos[1][2]).toBe(1)
    expect(layers.pos[2][2]).toBeCloseTo(0.5)
    expect(layers.neg[2][5]).toBeCloseTo(0.5)
    // a value only fills a darker band once the lighter ones are full
    layers.pos.forEach((_, k) => k > 0 && layers.pos[k].forEach((f, i) => expect(f).toBeLessThanOrEqual(layers.pos[k - 1][i])))
  })

  it('respects the baseline and saturates beyond the range', () => {
    const layers = horizonLayers([8, 10, 14], 10, 2, 2)
    expect(layers.bandWidth).toBe(1)
    expect(unfold(layers, 0)).toBeCloseTo(-2)
    expect(unfold(layers, 2)).toBeCloseTo(2)
    expect(layers.pos.map((b) => b[2])).toEqual([1, 1])
  })
})

describe('mosaic plot', () => {
  const rows = [
    { keys: ['남', '찬성'], count: 30, row: 0 }, { keys: ['남', '반대'], count: 20, row: 1 },
    { keys: ['여', '찬성'], count: 10, row: 2 }, { keys: ['여', '반대'], count: 40, row: 3 },
  ]

  it('gives every cell an area proportional to its count', () => {
    const { levels, counts } = collectCounts(rows, 2)
    const { cells, total } = mosaicLayout(levels, counts, 400, 250, 'x')
    expect(total).toBe(100)
    for (const c of cells) expect((c.w * c.h) / (400 * 250)).toBeCloseTo(c.count / 100, 12)
    expect(cells.reduce((s, c) => s + c.w * c.h, 0)).toBeCloseTo(400 * 250, 6)
    // columns are as wide as the first variable's marginal share: 남 = 50 %
    expect(cells.filter((c) => c.keys[0] === '남')[0].w).toBeCloseTo(200)
    const flipped = mosaicLayout(levels, counts, 400, 250, 'y').cells
    for (const c of flipped) expect((c.w * c.h) / (400 * 250)).toBeCloseTo(c.count / 100, 12)
  })

  it('computes expected counts, residuals and χ²', () => {
    const { levels, counts } = collectCounts([{ keys: ['a', 'x'], count: 10, row: 0 }, { keys: ['a', 'y'], count: 20, row: 1 }, { keys: ['b', 'x'], count: 30, row: 2 }, { keys: ['b', 'y'], count: 40, row: 3 }], 2)
    const { cells } = mosaicLayout(levels, counts, 100, 100, 'x')
    const { stat, df } = chiSquare(cells, levels)
    expect(stat).toBeCloseTo(0.7937, 3)
    expect(df).toBe(1)
    expect(cells[0].expected).toBeCloseTo(12)
    expect(cells[0].residual).toBeCloseTo((10 - 12) / Math.sqrt(12))
  })

  it('supports three variables, gaps and empty combinations', () => {
    const r3 = [{ keys: ['a', 'x', 'p'], count: 5, row: 0 }, { keys: ['a', 'y', 'q'], count: 15, row: 1 }, { keys: ['b', 'x', 'q'], count: 30, row: 2 }]
    const { levels, counts } = collectCounts(r3, 3)
    const { cells, total } = mosaicLayout(levels, counts, 300, 300, 'x', 0)
    expect(total).toBe(50)
    expect(cells).toHaveLength(2 * 2 * 2)
    expect(cells.reduce((s, c) => s + c.w * c.h, 0)).toBeCloseTo(300 * 300, 6)
    expect(cells.filter((c) => c.count === 0)).toHaveLength(5)
    const gapped = mosaicLayout(levels, counts, 300, 300, 'x', 4).cells
    expect(gapped.every((c) => c.x >= 0 && c.x + c.w <= 300 + 1e-9 && c.y + c.h <= 300 + 1e-9)).toBe(true)
  })
})

describe('icicle layout', () => {
  const tree = { name: 'root', children: [
    { name: 'A', children: [{ name: 'a1', value: 30 }, { name: 'a2', value: 10 }] },
    { name: 'B', children: [{ name: 'b1', value: 20 }, { name: 'b2', children: [{ name: 'b2x', value: 25 }, { name: 'b2y', value: 15 }] }] },
  ] }

  it('children partition their parent exactly, with depth bands of equal height', () => {
    const nodes = icicleLayout(tree, [], 5)
    const by = (...p: string[]) => nodes.find((n) => n.path.join('/') === p.join('/'))!
    expect(by().a0).toBe(0)
    expect(by().a1).toBe(1)
    expect(by('A').a1 - by('A').a0).toBeCloseTo(40 / 100)
    expect(by('A', 'a1').a1 - by('A', 'a1').a0).toBeCloseTo(30 / 100)
    for (const parent of nodes.filter((n) => n.hasChildren)) {
      const kids = nodes.filter((n) => n.depth === parent.depth + 1 && n.path.slice(0, -1).join('/') === parent.path.join('/'))
      expect(kids.reduce((s, k) => s + (k.a1 - k.a0), 0)).toBeCloseTo(parent.a1 - parent.a0, 12)
      expect(Math.min(...kids.map((k) => k.a0))).toBeCloseTo(parent.a0, 12)
    }
    expect(by('B', 'b2', 'b2x').depth).toBe(3)
    expect(by('B', 'b2', 'b2x').d1).toBeCloseTo(1)
    expect(by().value).toBe(100)
  })

  it('limits the depth and zooms onto a focused node', () => {
    expect(icicleLayout(tree, [], 1).every((n) => n.depth <= 1)).toBe(true)
    const zoom = icicleLayout(tree, ['B'], 5)
    expect(zoom[0].path).toEqual(['B'])
    expect(zoom[0].a0).toBe(0)
    expect(zoom[0].a1).toBe(1)
    expect(zoom.find((n) => n.name === 'b2')!.a1 - zoom.find((n) => n.name === 'b2')!.a0).toBeCloseTo(40 / 60)
    expect(icicleLayout(tree, ['nope'], 5)[0].path).toEqual([])
  })
})

describe('network graph', () => {
  const rows = [
    { source: 'A', target: 'B', weight: 2, group: 'g1', row: 0 }, { source: 'B', target: 'A', weight: 3, group: '', row: 1 },
    { source: 'B', target: 'C', weight: null, group: '', row: 2 }, { source: 'C', target: 'C', weight: 1, group: '', row: 3 },
    { source: 'D', target: '', weight: null, group: 'g2', row: 4 }, { source: '', target: 'E', weight: 1, group: '', row: 5 },
    { source: 'F', target: 'G', weight: 0, group: '', row: 6 },
  ]

  it('merges duplicate and reversed edges, keeps isolated nodes, and reports unusable rows', () => {
    const net = buildNetwork(rows)
    expect(net.nodes.map((n) => n.id).sort()).toEqual(['A', 'B', 'C', 'D'])
    expect(net.links).toHaveLength(2)
    expect(net.links.find((l) => [l.source, l.target].includes('A'))!.weight).toBe(5)
    expect(net.links.find((l) => [l.source, l.target].includes('C'))!.weight).toBe(1)
    expect(net.selfLoops).toBe(1)
    expect(net.skipped).toBe(2)
    const deg = Object.fromEntries(net.nodes.map((n) => [n.id, n.degree]))
    expect(deg).toEqual({ A: 1, B: 2, C: 1, D: 0 })
    expect(net.nodes.find((n) => n.id === 'A')!.strength).toBe(5)
    expect(net.nodes.find((n) => n.id === 'A')!.group).toBe('g1')
    expect(new Set(net.nodes.filter((n) => n.id !== 'D').map((n) => n.component)).size).toBe(1)
    expect(net.nodes.find((n) => n.id === 'D')!.component).not.toBe(net.nodes.find((n) => n.id === 'A')!.component)
  })

  const opts: ForceOptions = { width: 600, height: 400, linkDistance: 60, linkStrength: 1, charge: 120, gravity: 0.06, radius: 8 }
  const cluster = (prefix: string, n: number, row0: number) => Array.from({ length: n }, (_, i) => Array.from({ length: i }, (_, j) => ({ source: `${prefix}${i}`, target: `${prefix}${j}`, weight: 1, group: '', row: row0 + i * 10 + j }))).flat()

  it('places densely connected nodes closer together than unconnected ones, deterministically', () => {
    const net = buildNetwork([...cluster('a', 5, 0), ...cluster('b', 5, 100), { source: 'a0', target: 'b0', weight: 1, group: '', row: 999 }])
    const pos = layoutNetwork(net, opts, 300)
    const dist = (p: string, q: string) => Math.hypot(pos.get(p)!.x - pos.get(q)!.x, pos.get(p)!.y - pos.get(q)!.y)
    const within = d3.mean([dist('a1', 'a2'), dist('a3', 'a4'), dist('b1', 'b2'), dist('b3', 'b4')])!
    const between = d3.mean([dist('a1', 'b1'), dist('a2', 'b3'), dist('a4', 'b4'), dist('a3', 'b2')])!
    expect(within).toBeLessThan(between)
    expect([...pos.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    const again = layoutNetwork(net, opts, 300)
    expect(again.get('a2')).toEqual(pos.get('a2'))
  })

  it('keeps pinned starting positions as the initial state (restart continues from the current layout)', () => {
    const net = buildNetwork(cluster('n', 4, 0))
    const first = layoutNetwork(net, opts, 200)
    const resumed = layoutNetwork(net, opts, 1, first)
    for (const [id, p] of first) expect(Math.hypot(resumed.get(id)!.x - p.x, resumed.get(id)!.y - p.y)).toBeLessThan(5)
  })
})

describe('alluvial diagram', () => {
  const flows = [
    ['1학년', '2학년', '문과', '문과', 40], ['1학년', '2학년', '문과', '이과', 10], ['1학년', '2학년', '이과', '이과', 35], ['1학년', '2학년', '이과', '문과', 15],
    ['2학년', '3학년', '문과', '문과', 38], ['2학년', '3학년', '문과', '이과', 17], ['2학년', '3학년', '이과', '이과', 30], ['2학년', '3학년', '이과', '문과', 15],
  ].map(([fromStage, toStage, from, to, value], row) => ({ fromStage, toStage, from, to, value, row })) as Parameters<typeof buildAlluvial>[0]
  const opts = { width: 600, height: 300, nodeWidth: 14, nodePad: 12, order: 'data' as const }

  it('conserves the flow: every column carries the same total and interior nodes balance', () => {
    const a = buildAlluvial(flows, opts)
    expect(a.stages).toEqual(['1학년', '2학년', '3학년'])
    expect(stageTotals(a)).toEqual([100, 100, 100])
    expect(a.imbalanced).toEqual([])
    expect(a.issues).toEqual([])
    const mid = a.nodes.find((n) => n.stage === 1 && n.name === '문과')!
    expect(mid.inflow).toBe(55)
    expect(mid.outflow).toBe(55)
    const idle = a.nodes.find((n) => n.stage === 1 && n.name === '이과')!
    expect(idle.inflow).toBe(45)
    expect(idle.outflow).toBe(45)
  })

  it('reports interior imbalance when people appear or disappear', () => {
    const edited = flows.map((f, i) => (i === 0 ? { ...f, value: 50 } : f))
    expect(buildAlluvial(edited, opts).imbalanced.map((n) => n.key).length).toBeGreaterThan(0)
  })

  it('ribbons tile their nodes without overlap and keep the same width at both ends', () => {
    const a = buildAlluvial(flows, opts)
    expect(a.links.every((l) => Math.abs(l.width - l.value * a.scale) < 1e-9)).toBe(true)
    for (const n of a.nodes) {
      const out = a.links.filter((l) => l.source === n.key).sort((p, q) => p.sy - q.sy)
      out.forEach((l, i) => { expect(l.sy).toBeGreaterThanOrEqual(n.y0 - 1e-9); if (i) expect(l.sy).toBeCloseTo(out[i - 1].sy + out[i - 1].width, 9) })
      if (out.length) expect(out[out.length - 1].sy + out[out.length - 1].width).toBeLessThanOrEqual(n.y1 + 1e-9)
      const inn = a.links.filter((l) => l.target === n.key).sort((p, q) => p.ty - q.ty)
      inn.forEach((l, i) => { if (i) expect(l.ty).toBeCloseTo(inn[i - 1].ty + inn[i - 1].width, 9) })
    }
    expect(Math.max(...a.nodes.map((n) => n.y1))).toBeLessThanOrEqual(300 + 1e-9)
    expect(Math.min(...a.nodes.map((n) => n.y0))).toBeGreaterThanOrEqual(-1e-9)
  })

  it('skips flows that jump over a stage or have no value, and orders by size on request', () => {
    const bad = [...flows, { fromStage: '1학년', toStage: '3학년', from: '문과', to: '문과', value: 5, row: 8 }, { fromStage: '2학년', toStage: '3학년', from: '문과', to: '문과', value: 0, row: 9 }]
    const a = buildAlluvial(bad, opts)
    expect(a.issues).toHaveLength(2)
    expect(a.links).toHaveLength(8)
    const sized = buildAlluvial(flows.map((f, i) => (i === 2 ? { ...f, value: 90 } : f)), { ...opts, order: 'size' })
    const first = sized.nodes.filter((n) => n.stage === 0).sort((p, q) => p.y0 - q.y0)[0]
    expect(first.name).toBe('이과')
  })
})

describe('ROC and precision–recall', () => {
  // scikit-learn documentation example
  const sk: Scored[] = [0.1, 0.4, 0.35, 0.8].map((score, row) => ({ score, label: ([0, 0, 1, 1] as const)[row], row }))

  it('matches scikit-learn on the documented example', () => {
    const pts = curvePoints(sk)
    expect(rocAuc(pts)).toBeCloseTo(0.75, 12)
    expect(aucByRanks(sk)).toBeCloseTo(0.75, 12)
    expect(averagePrecision(pts)).toBeCloseTo(0.8333333333, 9)
    expect(prAucTrapezoid(pts)).toBeCloseTo(0.7916666667, 9)
    expect(pts.map((p) => [p.fpr, p.tpr])).toEqual([[0, 0], [0, 0.5], [0.5, 0.5], [0.5, 1], [1, 1]])
  })

  it('AP and the trapezoid PR AUC are different quantities', () => {
    const pts = curvePoints(sk)
    expect(Math.abs(averagePrecision(pts) - prAucTrapezoid(pts))).toBeGreaterThan(0.03)
  })

  it('treats tied scores as one threshold (a diagonal step) and gives AUC ½ for constant scores', () => {
    const tied: Scored[] = [1, 1, 1, 1].map((score, row) => ({ score, label: ([1, 0, 1, 0] as const)[row], row }))
    const pts = curvePoints(tied)
    expect(pts).toHaveLength(2)
    expect(rocAuc(pts)).toBeCloseTo(0.5)
    expect(aucByRanks(tied)).toBeCloseTo(0.5)
    expect(averagePrecision(pts)).toBeCloseTo(prevalence(tied))
  })

  it('trapezoid AUC equals the rank-based AUC on random data with ties', () => {
    const r = createRng(3)
    const data: Scored[] = Array.from({ length: 300 }, (_, row) => { const label = r() < 0.3 ? 1 : 0; return { score: Math.round((label ? r.normal(0.6, 0.25) : r.normal(0.4, 0.25)) * 20) / 20, label, row } })
    expect(rocAuc(curvePoints(data))).toBeCloseTo(aucByRanks(data), 12)
  })

  it('computes the confusion matrix at a threshold, including the boundary (score ≥ threshold)', () => {
    const c = confusionAt(sk, 0.4)
    expect(c).toEqual({ tp: 1, fp: 1, tn: 1, fn: 1 })
    const p = pointAt(sk, 0.35)
    expect([p.tpr, p.fpr, p.precision]).toEqual([1, 0.5, 2 / 3])
    expect(pointAt(sk, 2)).toMatchObject({ tpr: 0, fpr: 0, precision: 1 })
    expect(pointAt(sk, -1)).toMatchObject({ tpr: 1, fpr: 1, precision: 0.5 })
  })

  it('reports missing classes instead of drawing a meaningless curve', () => {
    expect(curveIssue(sk.map((d) => ({ ...d, label: 0 as const })))).toMatch(/양성/)
    expect(curveIssue(sk.map((d) => ({ ...d, label: 1 as const })))).toMatch(/음성/)
    expect(curveIssue([])).toMatch(/없습니다/)
    expect(curveIssue(sk)).toBeNull()
  })

  it('a random classifier on imbalanced data has AUC ≈ ½ but AP ≈ the positive rate', () => {
    const r = createRng(8)
    const data: Scored[] = Array.from({ length: 4000 }, (_, row) => ({ score: r(), label: r() < 0.05 ? 1 : 0, row }))
    const pts = curvePoints(data)
    expect(rocAuc(pts)).toBeGreaterThan(0.45)
    expect(rocAuc(pts)).toBeLessThan(0.55)
    expect(averagePrecision(pts)).toBeLessThan(0.1)
    expect(prevalence(data)).toBeCloseTo(0.05, 1)
  })
})

describe('fan chart', () => {
  it('uses the normal quantiles for 50 %, 80 % and 95 % intervals', () => {
    expect(zFor(0.5)).toBeCloseTo(0.6744898, 6)
    expect(zFor(0.8)).toBeCloseTo(1.2815516, 6)
    expect(zFor(0.95)).toBeCloseTo(1.959964, 5)
    expect(zFor(0.95)).toBeCloseTo(normalQuantile(0.975), 12)
  })

  it('normal-theory bands are nested and centred', () => {
    const b = bandsFromSigma(100, 10)
    expect(fanIssue({ center: 100, ...b })).toBeNull()
    expect(b.hi[0.95] - 100).toBeCloseTo(100 - b.lo[0.95])
    expect(b.hi[0.8] - b.lo[0.8]).toBeCloseTo(2 * 1.2815516 * 10, 5)
  })

  it('detects a band that does not contain the centre or is not inside the wider band, and repairs it', () => {
    const b = bandsFromSigma(100, 10)
    expect(fanIssue({ center: 100, lo: { ...b.lo, 0.5: 101 }, hi: b.hi })).toMatch(/50%.*중심/)
    expect(fanIssue({ center: 100, lo: { ...b.lo, 0.8: 98 }, hi: b.hi })).toMatch(/80%.*50%/)
    expect(fanIssue({ center: 100, lo: { ...b.lo, 0.95: NaN }, hi: b.hi })).toMatch(/숫자/)
    const broken = { center: 100, lo: { ...b.lo, 0.8: 98 }, hi: { ...b.hi, 0.95: 104 } }
    const fixed = repairFan(broken)
    expect(fanIssue({ center: 100, ...fixed })).toBeNull()
  })
})

describe('step plot', () => {
  const pts = [{ x: 0, y: 1 }, { x: 2, y: 3 }, { x: 6, y: 2 }]

  it('builds the staircase for each mode', () => {
    expect(stepVertices(pts, 'after')).toEqual([[0, 1], [2, 1], [2, 3], [6, 3], [6, 2]])
    expect(stepVertices(pts, 'before')).toEqual([[0, 1], [0, 3], [2, 3], [2, 2], [6, 2]])
    expect(stepVertices(pts, 'middle')).toEqual([[0, 1], [1, 1], [1, 3], [2, 3], [4, 3], [4, 2], [6, 2]])
  })

  it('evaluates the step function with the right side of each jump', () => {
    expect(stepValueAt(pts, 1, 'after')).toBe(1)
    expect(stepValueAt(pts, 1, 'before')).toBe(3)
    expect(stepValueAt(pts, 3.9, 'middle')).toBe(3)
    expect(stepValueAt(pts, 4.1, 'middle')).toBe(2)
    expect(stepValueAt(pts, 2, 'after')).toBe(3)
    expect(stepValueAt(pts, 7, 'after')).toBeUndefined()
  })
})

describe('pyramid and bullet helpers', () => {
  const rows = [{ name: '0–9', left: 30, right: 20, row: 0 }, { name: '10–19', left: 10, right: 40, row: 1 }]

  it('normalises by grand total or by group', () => {
    expect(pyramidValues(rows, 'absolute')).toEqual([{ left: 30, right: 20 }, { left: 10, right: 40 }])
    const total = pyramidValues(rows, 'total')
    expect(total.reduce((s, r) => s + r.left + r.right, 0)).toBeCloseTo(100)
    const grp = pyramidValues(rows, 'group')
    expect(grp.reduce((s, r) => s + r.left, 0)).toBeCloseTo(100)
    expect(grp.reduce((s, r) => s + r.right, 0)).toBeCloseTo(100)
  })

  it('keeps bullet ranges ascending and finds the band of a value', () => {
    expect(bulletRanges([50, 40, 90], 100)).toEqual([50, 50, 90])
    expect(bulletRanges([null, null, null], 90)).toEqual([30, 60, 90])
    expect(bulletBand(55, [50, 70, 100])).toBe(1)
    expect(bulletBand(120, [50, 70, 100])).toBe(2)
    expect(bulletBand(-1, [50, 70, 100])).toBe(-1)
  })
})

describe('dates and times', () => {
  it('parses ISO 8601 strictly and rejects impossible dates', () => {
    expect(parseDateTime('2024-03-15')).toBe(Date.UTC(2024, 2, 15))
    expect(parseDateTime('2024-03-15T09:30')).toBe(Date.UTC(2024, 2, 15, 9, 30))
    expect(parseDateTime('2024-03-15 09:30:15')).toBe(Date.UTC(2024, 2, 15, 9, 30, 15))
    expect(parseDateTime('2023-02-29')).toBeNull()
    expect(parseDateTime('2024-02-29')).toBe(Date.UTC(2024, 1, 29))
    expect(parseDateTime('1900-02-29')).toBeNull()
    expect(parseDateTime('2000-02-29')).toBe(Date.UTC(2000, 1, 29))
    expect(parseDateTime('2024-13-01')).toBeNull()
    expect(parseDateTime('2024-04-31')).toBeNull()
    expect(parseDateTime('2024-03-15T25:00')).toBeNull()
    expect(parseDateTime('hello')).toBeNull()
    expect(parseDateTime('0024-01-01')).toBeNull()
    expect(toTime('2024-03-15')).toBe(Date.UTC(2024, 2, 15))
    expect(toTime(null)).toBeNull()
    expect(toTime('')).toBeNull()
  })

  it('treats a missing offset as floating wall-clock time and converts explicit offsets to UTC', () => {
    const floating = parseDateTime('2024-03-15T09:30')!
    expect(parseDateTime('2024-03-15T09:30Z')).toBe(floating)
    expect(parseDateTime('2024-03-15T09:30+09:00')).toBe(floating - 9 * 3600000)
    expect(parseDateTime('2024-03-15T09:30-05:00')).toBe(floating + 5 * 3600000)
    expect(formatISO(floating)).toBe('2024-03-15T09:30')
    expect(formatISO(parseDateTime('2024-03-15')!)).toBe('2024-03-15')
  })

  it('does not guess ambiguous day/month order', () => {
    expect(parseDateTime('03/04/2024')).toBeNull()
    expect(isAmbiguousDate('03/04/2024')).toBe(true)
    expect(isAmbiguousDate('13/04/2024')).toBe(false)
    expect(parseDateTime('03/04/2024', 'mdy')).toBe(Date.UTC(2024, 2, 4))
    expect(parseDateTime('03/04/2024', 'dmy')).toBe(Date.UTC(2024, 3, 3))
    expect(parseDateTime('31/01/2024', 'dmy')).toBe(Date.UTC(2024, 0, 31))
    expect(parseDateTime('31/01/2024', 'mdy')).toBeNull()
    expect(parseDateTime('2024.03.15')).toBe(Date.UTC(2024, 2, 15))
  })

  it('handles month ends, leap years and daylight-saving transition days in UTC', () => {
    expect(formatISO(addMonths(parseDateTime('2024-01-31')!, 1))).toBe('2024-02-29')
    expect(formatISO(addMonths(parseDateTime('2023-01-31')!, 1))).toBe('2023-02-28')
    expect(formatISO(addMonths(parseDateTime('2024-03-31')!, -1))).toBe('2024-02-29')
    expect(formatISO(addMonths(parseDateTime('2024-11-15')!, 3))).toBe('2025-02-15')
    expect(daysBetween(parseDateTime('2024-02-28')!, parseDateTime('2024-03-01')!)).toBe(2)
    expect(daysBetween(parseDateTime('2023-02-28')!, parseDateTime('2023-03-01')!)).toBe(1)
    // US spring-forward (2024-03-10) and fall-back (2024-11-03): exactly one day in the chart's time base
    expect(daysBetween(parseDateTime('2024-03-09')!, parseDateTime('2024-03-11')!)).toBe(2)
    expect(parseDateTime('2024-03-11')! - parseDateTime('2024-03-10')!).toBe(86400000)
    expect(parseDateTime('2024-11-04')! - parseDateTime('2024-11-03')!).toBe(86400000)
    expect(formatTime(parseDateTime('2024-03-15T09:30')!)).toBe('2024. 3. 15. 09:30')
    expect(formatTime(parseDateTime('2024-03-15')!)).toBe('2024. 3. 15.')
  })

  it('finds period starts (weeks begin on Monday)', () => {
    const wed = parseDateTime('2024-03-13T15:00')!
    expect(formatISO(periodStart(wed, 'week'))).toBe('2024-03-11')
    expect(formatISO(periodStart(wed, 'month'))).toBe('2024-03-01')
    expect(formatISO(periodStart(wed, 'quarter'))).toBe('2024-01-01')
    expect(formatISO(periodStart(wed, 'year'))).toBe('2024-01-01')
    expect(formatISO(periodStart(parseDateTime('2024-03-10')!, 'week'))).toBe('2024-03-04')
  })
})
