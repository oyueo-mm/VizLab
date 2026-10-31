import * as d3 from 'd3'
import { describe, expect, it } from 'vitest'
import { generateDataset } from '../data/datasets'
import { columnIndex, toLabel, toNumber } from '../data/table'
import { createRng } from '../lib/random'
import { calendarCell, dayNumber, daysInMonth, daysInYear, formatDate, fromDayNumber, isLeapYear, parseDate, weekday, yearDates } from './calendar'
import { relationMatrix, reorderMatrix } from './chord'
import { clusterCount, cutTree, hclust, linkageTree, standardizeColumns } from './cluster'
import { normalQuantile, plottingPositions, standardQuantile, studentTCdf, studentTQuantile } from './distributions'
import { buildTree, rowsUnder } from './hierarchy'
import { meanInterval, simulateIntervals } from './inference'
import { dodge } from './layout'
import { rankValues } from './rank'
import { collectFlows, findCycle, flowBalance, sankeyLayout } from './sankey'
import { stackCrossTab, stackRows, stackSeries } from './stack'
import { allocateCells } from './waffle'

describe('quantile functions', () => {
  it('matches reference normal quantiles', () => {
    expect(normalQuantile(0.5)).toBeCloseTo(0, 9)
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5)
    expect(normalQuantile(0.025)).toBeCloseTo(-1.959964, 5)
    expect(normalQuantile(0.8413447)).toBeCloseTo(1, 5)
    expect(normalQuantile(0.999)).toBeCloseTo(3.090232, 5)
    expect(normalQuantile(0.0001)).toBeCloseTo(-3.719016, 5)
    expect(normalQuantile(0)).toBe(-Infinity)
    expect(normalQuantile(2)).toBeNaN()
  })

  it('matches reference Student t quantiles (R qt)', () => {
    expect(studentTQuantile(0.975, 1)).toBeCloseTo(12.7062047, 5)
    expect(studentTQuantile(0.975, 4)).toBeCloseTo(2.7764451, 5)
    expect(studentTQuantile(0.975, 10)).toBeCloseTo(2.2281389, 5)
    expect(studentTQuantile(0.975, 30)).toBeCloseTo(2.0422725, 5)
    expect(studentTQuantile(0.95, 5)).toBeCloseTo(2.0150484, 5)
    expect(studentTQuantile(0.995, 2)).toBeCloseTo(9.9248432, 4)
    expect(studentTQuantile(0.025, 10)).toBeCloseTo(-2.2281389, 5)
    expect(studentTQuantile(0.975, 100000)).toBeCloseTo(1.959964, 3)
  })

  it('is the inverse of the t CDF', () => {
    expect(studentTCdf(0, 7)).toBeCloseTo(0.5, 12)
    expect(studentTCdf(2.2281389, 10)).toBeCloseTo(0.975, 6)
    for (const p of [0.01, 0.2, 0.7, 0.99]) expect(studentTCdf(studentTQuantile(p, 6), 6)).toBeCloseTo(p, 9)
  })

  it('builds Q-Q plotting positions and reference quantiles', () => {
    const p = plottingPositions(5, 3 / 8)
    expect(p[0]).toBeCloseTo((1 - 0.375) / 5.25, 12)
    expect(p[4]).toBeCloseTo((5 - 0.375) / 5.25, 12)
    expect(p[2]).toBeCloseTo(0.5, 12)
    expect(plottingPositions(4, 0)).toEqual([0.2, 0.4, 0.6000000000000001, 0.8].map((v) => expect.closeTo(v, 12)))
    expect(standardQuantile('normal', p[2])).toBeCloseTo(0, 9)
    expect(standardQuantile('exponential', 0.5)).toBeCloseTo(Math.LN2, 12)
    expect(standardQuantile('uniform', 0.3)).toBe(0.3)
  })
})

describe('confidence intervals', () => {
  it('computes the t interval of a small sample exactly', () => {
    const ci = meanInterval([1, 2, 3, 4, 5], 0.95, 't')!
    expect(ci.mean).toBe(3)
    expect(ci.se).toBeCloseTo(Math.sqrt(2.5) / Math.sqrt(5), 12)
    expect(ci.crit).toBeCloseTo(2.7764451, 5)
    expect(ci.lo).toBeCloseTo(3 - 2.7764451 * ci.se, 5)
    expect(ci.hi).toBeCloseTo(3 + 2.7764451 * ci.se, 5)
    expect(ci.df).toBe(4)
  })

  it('z intervals are narrower than t intervals for small n and converge for large n', () => {
    const small = [4, 5, 6, 9]
    expect(meanInterval(small, 0.95, 'z')!.hi - meanInterval(small, 0.95, 'z')!.lo).toBeLessThan(meanInterval(small, 0.95, 't')!.hi - meanInterval(small, 0.95, 't')!.lo)
    const r = createRng(3)
    const big = Array.from({ length: 5000 }, () => r.normal(10, 2))
    const t = meanInterval(big, 0.95, 't')!
    const z = meanInterval(big, 0.95, 'z')!
    expect(t.hi - t.lo).toBeCloseTo(z.hi - z.lo, 3)
  })

  it('widens with the confidence level and narrows with n', () => {
    const r = createRng(5)
    const s = Array.from({ length: 40 }, () => r.normal(0, 1))
    const w = (level: number, v = s) => { const c = meanInterval(v, level, 't')!; return c.hi - c.lo }
    expect(w(0.99)).toBeGreaterThan(w(0.95))
    expect(w(0.95)).toBeGreaterThan(w(0.8))
    expect(w(0.95, s.slice(0, 10))).toBeGreaterThan(w(0.95, s))
    expect(meanInterval([3], 0.95)).toBeNull()
  })

  it('bootstrap intervals are reproducible and bracket the mean', () => {
    const v = [2, 4, 4, 5, 7, 9, 12]
    const a = meanInterval(v, 0.9, 'bootstrap', { seed: 4 })!
    const b = meanInterval(v, 0.9, 'bootstrap', { seed: 4 })!
    expect(a).toEqual(b)
    expect(a.lo).toBeLessThan(a.mean)
    expect(a.hi).toBeGreaterThan(a.mean)
    expect(a.lo).toBeGreaterThanOrEqual(2)
    expect(a.hi).toBeLessThanOrEqual(12)
  })

  it('t intervals cover the true mean at about the nominal rate; z intervals undercover at small n', () => {
    const tCover = simulateIntervals(3000, 8, 50, 10, 0.95, 't', 11).filter((s) => s.covers).length / 3000
    const zCover = simulateIntervals(3000, 5, 50, 10, 0.95, 'z', 11).filter((s) => s.covers).length / 3000
    expect(tCover).toBeGreaterThan(0.935)
    expect(tCover).toBeLessThan(0.965)
    expect(zCover).toBeLessThan(0.91)
  })
})

describe('hierarchical clustering', () => {
  const pts = [[0], [1], [5], [6], [20]]

  it('reproduces SciPy linkage heights for each method', () => {
    const h = (m: ReturnType<typeof hclust>) => m.map((x) => +x.height.toFixed(4))
    expect(h(hclust(pts, 'euclidean', 'single'))).toEqual([1, 1, 4, 14])
    expect(h(hclust(pts, 'euclidean', 'complete'))).toEqual([1, 1, 6, 20])
    expect(h(hclust(pts, 'euclidean', 'average'))).toEqual([1, 1, 5, 17])
    // Ward: sqrt(2·n₁n₂/(n₁+n₂))·‖mean difference‖
    const w = hclust(pts, 'euclidean', 'ward')
    expect(w[2].height).toBeCloseTo(Math.sqrt(2) * 5, 6)
    expect(w[3].height).toBeCloseTo(Math.sqrt((2 * 4 * 1) / 5) * Math.abs(3 - 20), 6)
    expect(hclust(pts, 'manhattan', 'average').map((x) => x.height)).toEqual(hclust(pts, 'euclidean', 'average').map((x) => x.height))
  })

  it('uses leaf ids 0…n−1 and merge ids n…2n−2, and heights never decrease for these linkages', () => {
    const m = hclust(pts, 'euclidean', 'average')
    expect(m.map((x) => [x.a, x.b])).toEqual([[0, 1], [2, 3], [5, 6], [4, 7]])
    expect(m.map((x) => x.size)).toEqual([2, 2, 4, 5])
    const r = createRng(2)
    const random = Array.from({ length: 30 }, () => [r.normal(), r.normal(), r.normal()])
    for (const link of ['single', 'complete', 'average', 'ward'] as const) {
      const hs = hclust(random, 'euclidean', link).map((x) => x.height)
      for (let i = 1; i < hs.length; i++) expect(hs[i], link).toBeGreaterThanOrEqual(hs[i - 1] - 1e-9)
    }
  })

  it('cuts the tree into the expected flat clusters', () => {
    const m = hclust(pts, 'euclidean', 'single')
    expect(cutTree(m, 5, 2)).toEqual([0, 0, 1, 1, 2])
    expect(cutTree(m, 5, 4)).toEqual([0, 0, 0, 0, 1])
    expect(cutTree(m, 5, 0.5)).toEqual([0, 1, 2, 3, 4])
    expect(clusterCount(m, 5, 2)).toBe(3)
    expect(clusterCount(m, 5, 100)).toBe(1)
  })

  it('builds a nested tree whose leaves are the input labels', () => {
    const labels = ['a', 'b', 'c', 'd', 'e']
    const tree = linkageTree(hclust(pts, 'euclidean', 'average'), labels)
    const leaves: string[] = []
    d3.hierarchy(tree, (n) => n.children).each((n) => { if (!n.children) leaves.push(n.data.label!) })
    expect(leaves.sort()).toEqual(labels)
    expect(tree.height).toBe(17)
    expect(tree.size).toBe(5)
  })

  it('standardizes columns to zero mean and unit variance', () => {
    const z = standardizeColumns([[1, 10], [2, 20], [3, 30], [4, 40]])
    for (const j of [0, 1]) {
      const col = z.map((r) => r[j])
      expect(d3.mean(col)).toBeCloseTo(0, 12)
      expect(d3.deviation(col)).toBeCloseTo(1, 12)
    }
  })
})

describe('ranking', () => {
  it('handles ties with each method', () => {
    const v = [10, 20, 20, 5]
    expect(rankValues(v, 'min')).toEqual([3, 1, 1, 4])
    expect(rankValues(v, 'dense')).toEqual([2, 1, 1, 3])
    expect(rankValues(v, 'average')).toEqual([3, 1.5, 1.5, 4])
    expect(rankValues(v, 'first')).toEqual([3, 1, 2, 4])
    expect(rankValues(v, 'min', false)).toEqual([2, 3, 3, 1])
    expect(rankValues([3, null, 1], 'min')).toEqual([1, null, 2])
  })
})

describe('waffle allocation', () => {
  it('always fills exactly the grid with largest remainders', () => {
    expect(allocateCells([50, 30, 20], 100).counts).toEqual([50, 30, 20])
    expect(allocateCells([1, 1, 1], 100).counts).toEqual([34, 33, 33])
    expect(allocateCells([0.5, 0.3, 0.2], 7).counts).toEqual([4, 2, 1])
    const r = createRng(9)
    for (let t = 0; t < 200; t++) {
      const vals = Array.from({ length: 2 + (t % 6) }, () => r() * 100)
      const total = [25, 50, 100, 144][t % 4]
      const a = allocateCells(vals, total, 'largest')
      expect(a.counts.reduce((s, c) => s + c, 0)).toBe(total)
      a.counts.forEach((c, i) => { expect(Math.abs(c - a.quotas[i])).toBeLessThan(1) })
    }
  })

  it('reports the cell difference of plain rounding and flooring', () => {
    expect(allocateCells([1, 1, 1], 100, 'round')).toMatchObject({ counts: [33, 33, 33], diff: -1 })
    expect(allocateCells([1, 1, 1], 100, 'floor')).toMatchObject({ counts: [33, 33, 33], diff: -1 })
    expect(allocateCells([1, 1, 1, 1, 1, 1, 1], 10, 'round').diff).toBe(0 + allocateCells([1, 1, 1, 1, 1, 1, 1], 10, 'round').counts.reduce((a, b) => a + b, 0) - 10)
    expect(allocateCells([0, 0], 100).counts).toEqual([0, 0])
  })
})

describe('calendar arithmetic', () => {
  it('knows leap years and month lengths', () => {
    expect([1900, 2000, 2023, 2024, 2100].map(isLeapYear)).toEqual([false, true, false, true, false])
    expect(daysInMonth(2023, 2)).toBe(28)
    expect(daysInMonth(2024, 2)).toBe(29)
    expect([1, 3, 4, 12].map((m) => daysInMonth(2024, m))).toEqual([31, 31, 30, 31])
    expect(daysInYear(2024)).toBe(366)
    expect(daysInYear(2023)).toBe(365)
    for (const y of [2023, 2024, 1900, 2000]) expect(d3.sum(Array.from({ length: 12 }, (_, i) => daysInMonth(y, i + 1)))).toBe(daysInYear(y))
  })

  it('parses only real dates', () => {
    expect(parseDate('2024-02-29')).toEqual({ y: 2024, m: 2, d: 29 })
    expect(parseDate('2023-02-29')).toBeNull()
    expect(parseDate('2023-13-01')).toBeNull()
    expect(parseDate('2023-04-31')).toBeNull()
    expect(parseDate('2023/4/5')).toEqual({ y: 2023, m: 4, d: 5 })
    expect(parseDate('hello')).toBeNull()
    expect(formatDate({ y: 2023, m: 4, d: 5 })).toBe('2023-04-05')
  })

  it('converts between day numbers and dates', () => {
    expect(dayNumber({ y: 1970, m: 1, d: 1 })).toBe(0)
    expect(fromDayNumber(dayNumber({ y: 2024, m: 12, d: 31 }))).toEqual({ y: 2024, m: 12, d: 31 })
    expect(weekday({ y: 2023, m: 1, d: 1 })).toBe(0) // Sunday
    expect(weekday({ y: 2024, m: 2, d: 29 })).toBe(4) // Thursday
    const dates = yearDates(2024)
    expect(dates.length).toBe(366)
    expect(formatDate(dates[59])).toBe('2024-02-29')
    expect(formatDate(dates[365])).toBe('2024-12-31')
    expect(new Set(dates.map(formatDate)).size).toBe(366)
  })

  it('places days in a week × weekday grid', () => {
    expect(calendarCell({ y: 2023, m: 1, d: 1 }, 0)).toEqual({ col: 0, row: 0 })
    expect(calendarCell({ y: 2023, m: 1, d: 8 }, 0)).toEqual({ col: 1, row: 0 })
    expect(calendarCell({ y: 2023, m: 1, d: 1 }, 1)).toEqual({ col: 0, row: 6 })
    expect(calendarCell({ y: 2023, m: 1, d: 2 }, 1)).toEqual({ col: 1, row: 0 })
    const last = calendarCell({ y: 2024, m: 12, d: 31 }, 0)
    expect(last).toEqual({ col: 52, row: 2 })
    for (const y of [2023, 2024]) for (const ws of [0, 1] as const) {
      const cells = yearDates(y).map((d) => calendarCell(d, ws))
      expect(new Set(cells.map((c) => `${c.col},${c.row}`)).size).toBe(daysInYear(y))
      expect(Math.max(...cells.map((c) => c.col))).toBeLessThanOrEqual(53)
    }
  })

  it('reads the daily dataset with its gaps', () => {
    const t = generateDataset('daily', 7)
    const di = columnIndex(t, '날짜')
    const dates = t.rows.map((r) => parseDate(toLabel(r[di])))
    expect(dates.every(Boolean)).toBe(true)
    expect(t.rows.length).toBeLessThan(365 + 366)
    expect(t.rows.length).toBeGreaterThan(600)
  })
})

describe('stacking and streamgraph baselines', () => {
  const series = ['a', 'b', 'c'].map((key, k) => ({ key, pts: Array.from({ length: 8 }, (_, i) => ({ x: i, y: 5 + k * 2 + Math.sin(i + k * 2) * 3 })) }))

  it('stacks to the exact running totals', () => {
    const { xs, layers } = stackSeries(series, 'stack')
    expect(xs.length).toBe(8)
    xs.forEach((_, i) => {
      expect(layers[2][i][1]).toBeCloseTo(d3.sum(series, (s) => s.pts[i].y), 10)
      layers.forEach((l, k) => expect(l[i][1] - l[i][0]).toBeCloseTo(series[k].pts[i].y, 10))
    })
  })

  it('normalizes each time point to 1', () => {
    const { layers } = stackSeries(series, 'normalize')
    layers[2].forEach((d) => expect(d[1]).toBeCloseTo(1, 10))
  })

  it('keeps layer thickness for every baseline and centres the silhouette', () => {
    const keys = ['a', 'b', 'c']
    const rows = Array.from({ length: 8 }, (_, i) => Object.fromEntries(keys.map((k, j) => [k, series[j].pts[i].y])))
    for (const off of ['none', 'expand', 'wiggle', 'silhouette'] as const) {
      const layers = stackRows(keys, rows, off, 'none')
      layers.forEach((l, k) => l.forEach((d, i) => { if (off !== 'expand') expect(d[1] - d[0]).toBeCloseTo(rows[i][keys[k]], 9) }))
    }
    const sil = stackRows(keys, rows, 'silhouette', 'none')
    rows.forEach((_, i) => expect(sil[0][i][0] + sil[2][i][1]).toBeCloseTo(0, 9))
  })

  it('wiggle reduces the weighted slope of the layer centrelines compared with a zero baseline', () => {
    const t = generateDataset('streams', 7, 40)
    const [xi, ki, vi] = ['주', '장르', '재생 수'].map((c) => columnIndex(t, c))
    const keys = [...new Set(t.rows.map((r) => toLabel(r[ki])))]
    const weeks = [...new Set(t.rows.map((r) => toNumber(r[xi])!))]
    const rows = weeks.map((w) => Object.fromEntries(keys.map((k) => [k, toNumber(t.rows.find((r) => toNumber(r[xi]) === w && toLabel(r[ki]) === k)![vi])!])))
    const wiggleScore = (layers: d3.Series<any, string>[]) => d3.sum(layers, (l) => d3.sum(rows.slice(1), (_, i) => {
      const c0 = (l[i][0] + l[i][1]) / 2
      const c1 = (l[i + 1][0] + l[i + 1][1]) / 2
      return rows[i + 1][l.key] * (c1 - c0) ** 2
    }))
    const none = wiggleScore(stackRows(keys, rows, 'none', 'insideOut'))
    const wig = wiggleScore(stackRows(keys, rows, 'wiggle', 'insideOut'))
    expect(wig).toBeLessThan(none)
  })

  it('cross-tab stacking supports every order', () => {
    const tab = { cats: ['x', 'y'], groups: ['p', 'q'], value: (c: string, g: string) => (c === 'x' ? 1 : 3) * (g === 'p' ? 2 : 1) }
    for (const order of ['none', 'ascending', 'descending', 'insideOut', 'reverse'] as const) {
      const s = stackCrossTab(tab.cats, tab.groups, tab.value, 'stack', order)
      expect(Math.max(...s.map((l) => l[0][1]))).toBe(3)
      expect(Math.max(...s.map((l) => l[1][1]))).toBe(9)
    }
  })
})

describe('beeswarm dodge', () => {
  it('never overlaps two points and keeps every value in place', () => {
    const r = createRng(21)
    const ys = Array.from({ length: 220 }, () => r.normal(100, 25))
    for (const radius of [2, 3.5, 6]) {
      const off = dodge(ys, radius)
      for (let i = 0; i < ys.length; i++) for (let j = i + 1; j < ys.length; j++) {
        if (Math.abs(ys[i] - ys[j]) >= 2 * radius) continue
        expect(Math.hypot(ys[i] - ys[j], off[i] - off[j]), `r=${radius} ${i},${j}`).toBeGreaterThanOrEqual(2 * radius - 1e-4)
      }
    }
  })

  it('is deterministic and symmetric about the centre; one-sided never goes negative', () => {
    const ys = [10, 10, 10, 10, 10]
    const a = dodge(ys, 3)
    expect(dodge(ys, 3)).toEqual(a)
    expect(Math.abs(a.reduce((s, v) => s + v, 0))).toBeLessThan(7)
    expect(dodge(ys, 3, Infinity, true).every((o) => o >= 0)).toBe(true)
    expect(dodge([5], 3)).toEqual([0])
  })

  it('stays within the maximum offset', () => {
    const off = dodge(Array.from({ length: 50 }, () => 10), 3, 12)
    expect(off.every((o) => Math.abs(o) <= 12)).toBe(true)
  })
})

describe('sankey flows', () => {
  const energy = () => {
    const t = generateDataset('energy')
    const [s, d, v] = ['출발', '도착', '양'].map((c) => columnIndex(t, c))
    return collectFlows(t.rows.map((r, row) => ({ source: toLabel(r[s]), target: toLabel(r[d]), value: toNumber(r[v]), row })))
  }

  it('merges duplicates and reports self-loops and invalid rows', () => {
    const r = collectFlows([
      { source: 'a', target: 'b', value: 2, row: 0 }, { source: 'a', target: 'b', value: 3, row: 1 },
      { source: 'b', target: 'b', value: 1, row: 2 }, { source: 'b', target: 'c', value: -1, row: 3 }, { source: 'b', target: 'c', value: null, row: 4 }, { source: '', target: 'c', value: 1, row: 5 },
    ])
    expect(r.edges).toEqual([{ source: 'a', target: 'b', value: 5, rows: [0, 1] }])
    expect(r.selfLoops).toBe(1)
    expect(r.invalid).toBe(3)
  })

  it('detects cycles', () => {
    expect(findCycle([{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }])).toBeNull()
    expect(findCycle([{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'c', target: 'a' }])).toEqual(['a', 'b', 'c', 'a'])
    expect(findCycle([{ source: 'x', target: 'y' }, { source: 'y', target: 'x' }])).toEqual(['x', 'y', 'x'])
  })

  it('conserves flow in the layout: link widths add up to node heights', () => {
    const { edges } = energy()
    expect(findCycle(edges)).toBeNull()
    const bal = flowBalance(edges)
    // intermediate nodes are balanced in the example data
    for (const n of ['전력', '직접 연소']) expect(bal.get(n)!.in).toBe(bal.get(n)!.out)
    const { graph } = sankeyLayout(edges, { width: 600, height: 400, nodeWidth: 14, nodePadding: 10, align: 'justify' })
    expect(graph.nodes.length).toBe(bal.size)
    for (const n of graph.nodes) {
      expect(n.value).toBe(Math.max(bal.get(n.name)!.in, bal.get(n.name)!.out))
      const inW = d3.sum(n.targetLinks ?? [], (l) => l.width ?? 0)
      const outW = d3.sum(n.sourceLinks ?? [], (l) => l.width ?? 0)
      const h = (n.y1 ?? 0) - (n.y0 ?? 0)
      if (inW) expect(inW).toBeLessThanOrEqual(h + 1e-6)
      if (outW) expect(outW).toBeLessThanOrEqual(h + 1e-6)
    }
    const sources = ['석탄', '천연가스', '원자력', '재생에너지', '석유']
    const sinks = ['가정', '상업', '산업', '손실', '수송']
    expect(d3.sum(sources, (n) => bal.get(n)!.out)).toBe(d3.sum(sinks, (n) => bal.get(n)!.in))
  })
})

describe('relation matrix (chord diagram)', () => {
  const t = generateDataset('migration')
  const cols = t.columns.filter((c) => c.type === 'number').map((c) => c.name)

  it('reads the matrix with row = origin and column = destination', () => {
    const rel = relationMatrix(t, '출발 지역', cols)
    expect(rel.labels).toEqual(['수도권', '충청', '호남', '영남', '강원'])
    expect(rel.matrix[0][1]).toBe(62)
    expect(rel.matrix[1][0]).toBe(70)
    expect(rel.matrix.every((r, i) => r[i] === 0)).toBe(true)
    expect(rel.unmatchedColumns).toEqual([])
    expect(rel.unmatchedRows).toEqual([])
    expect(d3.sum(rel.matrix.flat())).toBe(d3.sum(t.rows.flatMap((r) => r.slice(1) as number[])))
  })

  it('ignores columns without a matching group and clamps negatives', () => {
    const rel = relationMatrix({ columns: [{ name: 'g', type: 'category' }, { name: 'A', type: 'number' }, { name: 'B', type: 'number' }, { name: 'zzz', type: 'number' }], rows: [['A', 1, -5, 9], ['B', 4, 0, 9]] }, 'g', ['A', 'B', 'zzz'])
    expect(rel.matrix).toEqual([[1, 0], [4, 0]])
    expect(rel.unmatchedColumns).toEqual(['zzz'])
  })

  it('reorders groups and keeps the relations attached to their names', () => {
    const rel = relationMatrix(t, '출발 지역', cols)
    const r = reorderMatrix(rel, ['영남', '수도권'])
    expect(r.labels).toEqual(['영남', '수도권', '충청', '호남', '강원'])
    expect(r.matrix[0][1]).toBe(rel.matrix[3][0])
    expect(r.matrix[1][0]).toBe(rel.matrix[0][3])
  })

  it('group arcs are proportional to row totals (undirected) or to outgoing + incoming totals (directed)', () => {
    const rel = relationMatrix(t, '출발 지역', cols)
    const total = d3.sum(rel.matrix.flat())
    d3.chord()(rel.matrix).groups.forEach((g, i) => expect((g.endAngle - g.startAngle) / (2 * Math.PI)).toBeCloseTo(d3.sum(rel.matrix[i]) / total, 6))
    d3.chordDirected()(rel.matrix).groups.forEach((g, i) => expect((g.endAngle - g.startAngle) / (2 * Math.PI)).toBeCloseTo((d3.sum(rel.matrix[i]) + d3.sum(rel.matrix, (r) => r[i])) / (2 * total), 6))
  })
})

describe('hierarchy', () => {
  const tree = buildTree(generateDataset('budget'), ['부문', '부서', '항목'], '예산').tree
  const root = d3.hierarchy(tree).sum((d) => d.value ?? 0)

  it('sums values up the tree', () => {
    expect(root.value).toBe(d3.sum(generateDataset('budget').rows, (r) => r[3] as number))
    expect(root.leaves().length).toBe(generateDataset('budget').rows.length)
  })

  it('sunburst angles split each parent in proportion to its children', () => {
    const r = root.copy().sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    d3.partition<any>().size([2 * Math.PI, r.height + 1])(r)
    const p = r as d3.HierarchyRectangularNode<any>
    expect(d3.sum(p.children!, (c: any) => c.x1 - c.x0)).toBeCloseTo(2 * Math.PI, 9)
    p.each((n: any) => {
      if (!n.children) return
      expect(d3.sum(n.children, (c: any) => c.x1 - c.x0)).toBeCloseTo(n.x1 - n.x0, 9)
      n.children.forEach((c: any) => expect((c.x1 - c.x0) / (n.x1 - n.x0)).toBeCloseTo(c.value / n.value, 9))
    })
  })

  it('circle packing makes leaf areas proportional to values and children fit inside parents without overlap', () => {
    const r = root.copy().sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    d3.pack<any>().size([600, 600]).padding(3)(r)
    const leaves = r.leaves() as d3.HierarchyCircularNode<any>[]
    const k = leaves[0].r ** 2 / leaves[0].value!
    leaves.forEach((l) => expect(l.r ** 2 / l.value!).toBeCloseTo(k, 6))
    ;(r as d3.HierarchyCircularNode<any>).each((n) => {
      const kids = (n.children ?? []) as d3.HierarchyCircularNode<any>[]
      for (const c of kids) expect(Math.hypot(c.x - n.x, c.y - n.y) + c.r).toBeLessThanOrEqual(n.r + 1e-6)
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) expect(Math.hypot(kids[i].x - kids[j].x, kids[i].y - kids[j].y)).toBeGreaterThanOrEqual(kids[i].r + kids[j].r - 1e-6)
    })
  })

  it('finds the rows below a path', () => {
    const t = generateDataset('budget')
    expect(rowsUnder(t, ['부문', '부서'], ['영업']).length).toBe(6)
    expect(rowsUnder(t, ['부문', '부서'], ['영업', '국내 영업']).length).toBe(3)
    expect(rowsUnder(t, ['부문'], []).length).toBe(t.rows.length)
  })
})
