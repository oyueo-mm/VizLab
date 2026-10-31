import * as d3 from 'd3'
import { describe, expect, it } from 'vitest'
import { createRng } from '../lib/random'
import { blandAltman, calibration, wilson } from './agreement'
import { CONSTANTS, capability, cChart, detectSignals, individualsChart, pChart, xbarChart } from './control'
import { addMonths, formatISO, parseDateTime } from './datetime'
import { chiSquareSf, eggerTest, funnelLimits, metaAnalysis, seFromCi, Z95 } from './meta'
import { adjacencyMatrix, barycenterOrder, buildBipartite, bundlePath, crossings, hiveLayout, orderNodes, treeFromPaths } from './graphs'
import { buildNetwork, type EdgeRow } from './network'
import { buildFlame, durationDays, findCycle, flameLayout, flameMatches, funnelMetrics, marimekko, resizeTask, shiftTask, validateTasks, type Task } from './process'

const rows = (pairs: [string, string, number?, string?][]): EdgeRow[] => pairs.map(([source, target, weight, group], row) => ({ source, target, weight: weight ?? null, group: group ?? '', row }))

describe('meta-analysis', () => {
  it('recovers the standard error from a 95 % interval', () => {
    expect(seFromCi(0.2, 0.8)).toBeCloseTo(0.3 / 1.959964, 6)
    expect(Z95).toBeCloseTo(1.959964, 5)
    expect(seFromCi(0, 2, 0.9)).toBeCloseTo(1 / 1.644854, 5)
  })

  it('fixed effect: inverse-variance mean, its standard error and Cochran’s Q (hand-computed)', () => {
    const m = metaAnalysis([{ effect: 0.2, se: 0.1 }, { effect: 0.4, se: 0.2 }], 'fixed')!
    expect(m.effect).toBeCloseTo(0.24, 12)
    expect(m.se).toBeCloseTo(1 / Math.sqrt(125), 12)
    expect(m.Q).toBeCloseTo(0.8, 12)
    expect(m.df).toBe(1)
    expect(m.I2).toBe(0)
    expect(m.weights[0]).toBeCloseTo(0.8, 12)
    expect(m.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
    expect(m.lo).toBeCloseTo(0.24 - 1.959964 / Math.sqrt(125), 5)
  })

  it('random effects (DerSimonian–Laird): τ², I² and equalised weights under strong heterogeneity (hand-computed)', () => {
    const m = metaAnalysis([{ effect: 0, se: 0.1 }, { effect: 1, se: 0.1 }], 'random')!
    expect(m.Q).toBeCloseTo(50, 9)
    expect(m.tau2).toBeCloseTo(0.49, 9)
    expect(m.I2).toBeCloseTo(0.98, 9)
    expect(m.effect).toBeCloseTo(0.5, 9)
    expect(m.se).toBeCloseTo(0.5, 9)
    const f = metaAnalysis([{ effect: 0, se: 0.1 }, { effect: 1, se: 0.1 }], 'fixed')!
    expect(f.se).toBeLessThan(m.se)
    expect(f.tau2).toBe(0)
  })

  it('χ² tail matches known critical values', () => {
    expect(chiSquareSf(3.841459, 1)).toBeCloseTo(0.05, 4)
    expect(chiSquareSf(5.991465, 2)).toBeCloseTo(0.05, 4)
    expect(chiSquareSf(18.307, 10)).toBeCloseTo(0.05, 3)
    expect(chiSquareSf(0, 3)).toBe(1)
  })

  it('ignores unusable studies and returns null when none remain', () => {
    expect(metaAnalysis([{ effect: NaN, se: 0.1 }, { effect: 1, se: 0 }], 'fixed')).toBeNull()
    expect(metaAnalysis([], 'random')).toBeNull()
    const one = metaAnalysis([{ effect: 0.3, se: 0.1 }], 'random')!
    expect(one.effect).toBeCloseTo(0.3, 12)
    expect(one.tau2).toBe(0)
  })

  it('works on the log scale for ratios: exp of the pooled log odds ratio', () => {
    const studies = [{ or: 1.5, lo: 1.1, hi: 2.05 }, { or: 2.0, lo: 1.2, hi: 3.3 }, { or: 0.9, lo: 0.5, hi: 1.6 }].map((s) => ({ effect: Math.log(s.or), se: seFromCi(Math.log(s.lo), Math.log(s.hi)) }))
    const m = metaAnalysis(studies, 'fixed')!
    expect(Math.exp(m.effect)).toBeGreaterThan(0.9)
    expect(Math.exp(m.effect)).toBeLessThan(2)
    expect(Math.exp(m.lo)).toBeLessThan(Math.exp(m.effect))
    expect(Math.exp(m.hi)).toBeGreaterThan(Math.exp(m.effect))
  })

  it('Egger’s test: no asymmetry gives an intercept near 0; small studies shifted upward give a clearly positive one', () => {
    const rng = createRng(2)
    const se = Array.from({ length: 40 }, (_, i) => 0.05 + 0.4 * (i / 40))
    const sym = se.map((s) => ({ effect: 0.3 + s * rng.normal(), se: s }))
    const biased = se.map((s) => ({ effect: 0.3 + 1.5 * s + s * rng.normal(), se: s }))
    const a = eggerTest(sym)!
    const b = eggerTest(biased)!
    expect(Math.abs(a.intercept)).toBeLessThan(1.2)
    expect(a.p).toBeGreaterThan(0.05)
    expect(b.intercept).toBeGreaterThan(0.8)
    expect(b.p).toBeLessThan(0.05)
    expect(eggerTest([{ effect: 1, se: 0.1 }, { effect: 2, se: 0.2 }])).toBeNull()
    // exact: points on a line z = 2 + 3·precision give intercept 2 with zero residual
    const exact = [0.1, 0.2, 0.4, 0.5].map((s) => ({ se: s, effect: (2 + 3 / s) * s }))
    expect(eggerTest(exact)!.intercept).toBeCloseTo(2, 9)
    expect(eggerTest(exact)!.slope).toBeCloseTo(3, 9)
  })

  it('funnel limits are pooled ± 1.96·se', () => {
    const [lo, hi] = funnelLimits(0.5, 0.1)
    expect(lo).toBeCloseTo(0.5 - 0.1959964, 6)
    expect(hi).toBeCloseTo(0.5 + 0.1959964, 6)
    expect(funnelLimits(0, 1, 0.99)[1]).toBeCloseTo(2.575829, 5)
  })
})

describe('Bland–Altman agreement', () => {
  const pairs = [[10, 9], [12, 12], [15, 13], [20, 21], [22, 20], [30, 29], [35, 33], [41, 41]].map(([a, b], row) => ({ a, b, row }))

  it('bias, SD and limits of agreement (hand-computed)', () => {
    const r = blandAltman(pairs)!
    const diffs = pairs.map((p) => p.a - p.b)
    expect(r.n).toBe(8)
    expect(r.bias).toBeCloseTo(d3.mean(diffs)!, 12)
    expect(r.sd).toBeCloseTo(d3.deviation(diffs)!, 12)
    expect(r.loaHi).toBeCloseTo(r.bias + 1.96 * r.sd, 2)
    expect(r.loaLo).toBeCloseTo(r.bias - 1.96 * r.sd, 2)
    expect(r.points.map((p) => p.mean)).toEqual(pairs.map((p) => (p.a + p.b) / 2))
    expect(r.biasCi[0]).toBeLessThan(r.bias)
    expect(r.loaHiCi[0]).toBeLessThan(r.loaHi)
    expect(r.loaHiCi[1]).toBeGreaterThan(r.loaHi)
  })

  it('flags points outside the limits and detects proportional bias', () => {
    const rng = createRng(1)
    const many = Array.from({ length: 60 }, (_, row) => { const b = 20 + 60 * rng(); return { a: b + rng.normal(0, 1), b, row } })
    many.push({ a: 80, b: 40, row: 60 })
    const r = blandAltman(many)!
    expect(r.points.find((p) => p.row === 60)!.outside).toBe(true)
    expect(r.points.filter((p) => p.outside).length).toBeLessThanOrEqual(5)
    const prop = Array.from({ length: 50 }, (_, row) => { const b = 10 + 90 * rng(); return { a: b * 1.15 + rng.normal(0, 0.5), b, row } })
    expect(blandAltman(prop)!.slope).toBeGreaterThan(0.1)
    expect(Math.abs(blandAltman(many.slice(0, 60))!.slope)).toBeLessThan(0.05)
  })

  it('percent and ratio forms, and refusal of impossible input', () => {
    const p = blandAltman(pairs, 'percent')!
    expect(p.points[0].diff).toBeCloseTo(((10 - 9) / 9.5) * 100, 9)
    const r = blandAltman(pairs, 'ratio')!
    expect(r.points[0].diff).toBeCloseTo(Math.log(10 / 9), 12)
    expect(r.points[0].mean).toBeCloseTo((Math.log(10) + Math.log(9)) / 2, 12)
    expect(blandAltman(pairs.slice(0, 2))).toBeNull()
    expect(blandAltman([{ a: -1, b: 2, row: 0 }, { a: 1, b: 2, row: 1 }, { a: 2, b: 2, row: 2 }], 'ratio')).toBeNull()
    expect(blandAltman([{ a: NaN, b: 1, row: 0 }, { a: 1, b: 1, row: 1 }, { a: 2, b: 1, row: 2 }])).toBeNull()
  })

  it('correlation is not agreement: B = 2A correlates perfectly but disagrees by a growing amount', () => {
    const doubled = Array.from({ length: 20 }, (_, i) => ({ a: i + 5, b: 2 * (i + 5), row: i }))
    const r = blandAltman(doubled)!
    expect(d3.mean(doubled, (p) => p.a)).toBeLessThan(d3.mean(doubled, (p) => p.b)!)
    expect(r.bias).toBeLessThan(-10)
    expect(r.slope).toBeLessThan(-0.5)
  })
})

describe('calibration', () => {
  it('ECE, MCE and Brier score on a small example (hand-computed)', () => {
    const data = [0.1, 0.1, 0.9, 0.9].map((p, row) => ({ p, y: ([0, 1, 1, 1] as const)[row], row }))
    const c = calibration(data, 2, 'uniform')!
    expect(c.bins).toHaveLength(2)
    expect(c.bins[0]).toMatchObject({ n: 2, positives: 1, meanPred: 0.1, observed: 0.5 })
    expect(c.bins[1]).toMatchObject({ n: 2, positives: 2, meanPred: 0.9, observed: 1 })
    expect(c.ece).toBeCloseTo(0.25, 12)
    expect(c.mce).toBeCloseTo(0.4, 12)
    expect(c.brier).toBeCloseTo(0.21, 12)
  })

  it('a perfectly calibrated model has a small ECE; an over-confident one does not', () => {
    const rng = createRng(6)
    const good = Array.from({ length: 4000 }, (_, row) => { const p = rng(); return { p, y: (rng() < p ? 1 : 0) as 0 | 1, row } })
    const bad = good.map((d) => ({ ...d, p: d.p < 0.5 ? d.p ** 2 / 2 : 1 - (1 - d.p) ** 2 / 2 }))
    expect(calibration(good, 10, 'uniform')!.ece).toBeLessThan(0.03)
    expect(calibration(bad, 10, 'uniform')!.ece).toBeGreaterThan(0.08)
    expect(calibration(good, 10, 'quantile')!.bins.every((b) => Math.abs(b.n - 400) <= 1)).toBe(true)
  })

  it('Wilson interval and edge cases', () => {
    const [lo, hi] = wilson(5, 10)
    expect(lo).toBeCloseTo(0.2366, 3)
    expect(hi).toBeCloseTo(0.7634, 3)
    expect(wilson(0, 0)).toEqual([0, 1])
    expect(wilson(0, 20)[0]).toBe(0)
    expect(wilson(20, 20)[1]).toBe(1)
    expect(calibration([], 5, 'uniform')).toBeNull()
    expect(calibration([{ p: 1.5, y: 1, row: 0 }, { p: NaN, y: 0, row: 1 }], 5, 'uniform')).toBeNull()
    const edge = calibration([{ p: 0, y: 0, row: 0 }, { p: 1, y: 1, row: 1 }], 4, 'uniform')!
    expect(edge.bins.map((b) => b.n)).toEqual([1, 1])
    expect(edge.ece).toBe(0)
  })
})

describe('control charts', () => {
  const x = [10, 12, 11, 13, 12, 11, 10, 12, 13, 11]

  it('individuals chart: σ̂ = MR̄ / 1.128 and 3σ limits (hand-computed)', () => {
    const mr = x.slice(1).map((v, i) => Math.abs(v - x[i]))
    const mrBar = d3.mean(mr)!
    const c = individualsChart(x)!
    expect(c.center[0]).toBeCloseTo(d3.mean(x)!, 12)
    expect(c.sigma[0]).toBeCloseTo(mrBar / 1.128, 12)
    expect(c.ucl[0]).toBeCloseTo(d3.mean(x)! + (3 * mrBar) / 1.128, 12)
    expect(c.lcl[0]).toBeCloseTo(d3.mean(x)! - (3 * mrBar) / 1.128, 12)
    expect(c.range!.ucl).toBeCloseTo(3.267 * mrBar, 12)
    expect(c.range!.lcl).toBe(0)
    expect(individualsChart([5])).toBeNull()
  })

  it('X̄–R chart uses A₂, D₃, D₄ for the subgroup size', () => {
    const g = [[10, 12, 11, 13, 12], [11, 10, 12, 13, 11], [12, 12, 13, 11, 12], [10, 11, 12, 10, 11]]
    const c = xbarChart(g)!
    const rBar = d3.mean(g.map((s) => Math.max(...s) - Math.min(...s)))!
    const grand = d3.mean(g.map((s) => d3.mean(s)!))!
    expect(c.center[0]).toBeCloseTo(grand, 12)
    expect(c.ucl[0]).toBeCloseTo(grand + 0.577 * rBar, 12)
    expect(c.lcl[0]).toBeCloseTo(grand - 0.577 * rBar, 12)
    expect(c.range!.ucl).toBeCloseTo(2.114 * rBar, 12)
    expect(c.range!.lcl).toBe(0)
    expect(c.sigma[0]).toBeCloseTo((0.577 * rBar) / 3, 12)
    expect(CONSTANTS[7].D3).toBe(0.076)
    expect(xbarChart([[1], [2]])).toBeNull()
  })

  it('p chart: limits widen for small samples and stay within [0, 1]', () => {
    const c = pChart([5, 8, 3, 40, 6], [100, 200, 50, 100, 25])!
    const pbar = 62 / 475
    expect(c.center[0]).toBeCloseTo(pbar, 12)
    expect(c.ucl[0]).toBeCloseTo(pbar + 3 * Math.sqrt((pbar * (1 - pbar)) / 100), 12)
    expect(c.ucl[4] - c.center[4]).toBeGreaterThan(c.ucl[1] - c.center[1])
    expect(c.lcl.every((v) => v >= 0)).toBe(true)
    expect(c.ucl.every((v) => v <= 1)).toBe(true)
    // more defects than inspected items, or nothing inspected, cannot be plotted
    expect(pChart([5, 3], [4, 0])).toBeNull()
    expect(pChart([5, 2], [4, 10])!.values).toEqual([0.2])
    expect(pChart([1], [0])).toBeNull()
  })

  it('c chart: c̄ ± 3√c̄ with the lower limit floored at 0', () => {
    const c = cChart([4, 6, 5, 3, 7, 5])!
    expect(c.center[0]).toBeCloseTo(5, 12)
    expect(c.ucl[0]).toBeCloseTo(5 + 3 * Math.sqrt(5), 12)
    expect(cChart([1, 0, 2, 1])!.lcl[0]).toBe(0)
    expect(cChart([])).toBeNull()
  })

  it('signals: beyond the limits, 9 on one side, 6 trending, 2 of 3 beyond 2σ', () => {
    const mk = (v: number[]) => ({ values: v, center: v.map(() => 0), sigma: v.map(() => 1), ucl: v.map(() => 3), lcl: v.map(() => -3) })
    expect(detectSignals(mk([0, 0.5, 4, -0.2, -3.5]), [1]).map((s) => s.index)).toEqual([2, 4])
    const nine = detectSignals(mk([0.2, 0.3, 0.1, 0.4, 0.2, 0.5, 0.3, 0.1, 0.2, -0.3]), [2])
    expect(nine.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(detectSignals(mk([0.2, 0.3, 0.1, 0.4, 0.2, 0.5, 0.3, 0.1, -0.2, 0.3]), [2])).toEqual([])
    expect(detectSignals(mk([0, 1, 2, 3, 4, 5, 6].map((v) => v * 0.1)), [3]).map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6].slice(0, 7).filter((i) => i >= 1 || true).slice(0, 7))
    const two = detectSignals(mk([0, 2.5, 0, 2.2, 0]), [5])
    expect(two.map((s) => s.index)).toEqual([1, 3])
    expect(detectSignals(mk([0, 0, 0, 0, 0, 0, 0]), [1, 2, 3, 5])).toEqual([])
  })

  it('a stable random process raises few false alarms; a shifted process is caught', () => {
    const rng = createRng(9)
    const stable = Array.from({ length: 200 }, () => rng.normal(50, 2))
    const c = individualsChart(stable)!
    expect(detectSignals(c, [1]).length).toBeLessThanOrEqual(3)
    const shifted = [...stable.slice(0, 40), ...stable.slice(40, 80).map((v) => v + 5)]
    const base = individualsChart(stable.slice(0, 40))!
    const sig = detectSignals({ ...base, values: shifted, center: shifted.map(() => base.center[0]), sigma: shifted.map(() => base.sigma[0]), ucl: shifted.map(() => base.ucl[0]), lcl: shifted.map(() => base.lcl[0]) }, [1, 2])
    expect(sig.filter((s) => s.index >= 40).length).toBeGreaterThan(10)
  })

  it('capability uses specification limits, which are not control limits', () => {
    const cap = capability(50, 2, 42, 58)
    expect(cap.cp).toBeCloseTo(16 / 12, 12)
    expect(cap.cpk).toBeCloseTo(8 / 6, 12)
    expect(capability(54, 2, 42, 58).cpk).toBeCloseTo(4 / 6, 12)
    expect(capability(50, 2, null, 58)).toEqual({ cp: null, cpk: 8 / 6 })
    expect(capability(50, 0, 42, 58)).toEqual({ cp: null, cpk: null })
  })
})

describe('funnel chart', () => {
  it('conversion, drop-off and share of the first stage', () => {
    const m = funnelMetrics([{ name: '방문', value: 1000, row: 0 }, { name: '가입', value: 400, row: 1 }, { name: '구매', value: 100, row: 2 }])
    expect(m[0].conversion).toBeNull()
    expect(m[1].conversion).toBeCloseTo(0.4, 12)
    expect(m[1].dropRate).toBeCloseTo(0.6, 12)
    expect(m[1].dropped).toBe(600)
    expect(m[2].ofFirst).toBeCloseTo(0.1, 12)
    expect(m[2].conversion).toBeCloseTo(0.25, 12)
    expect(m.every((s) => !s.inflow)).toBe(true)
  })

  it('flags stages that grow (new entries) instead of hiding or clamping them', () => {
    const m = funnelMetrics([{ name: 'A', value: 100, row: 0 }, { name: 'B', value: 60, row: 1 }, { name: 'C', value: 90, row: 2 }, { name: 'D', value: 0, row: 3 }])
    expect(m[2].inflow).toBe(true)
    expect(m[2].conversion).toBeCloseTo(1.5, 12)
    expect(m[2].dropRate).toBeCloseTo(-0.5, 12)
    expect(m[3].conversion).toBe(0)
    expect(funnelMetrics([{ name: 'A', value: 0, row: 0 }, { name: 'B', value: 5, row: 1 }])[1].conversion).toBeNull()
    expect(funnelMetrics([])).toEqual([])
  })
})

describe('Gantt schedule', () => {
  const d = (s: string) => parseDateTime(s)!
  const task = (name: string, start: string, end: string, deps: string[] = [], row = 0): Task => ({ name, start: d(start), end: d(end), group: '', progress: null, deps, row })

  it('counts both the first and the last day, across a leap day', () => {
    expect(durationDays(task('a', '2024-02-28', '2024-03-01'))).toBe(3)
    expect(durationDays(task('a', '2023-02-28', '2023-03-01'))).toBe(2)
    expect(durationDays(task('a', '2024-03-09', '2024-03-11'))).toBe(3)
    expect(durationDays(task('a', '2024-05-05', '2024-05-05'))).toBe(1)
  })

  it('moves and resizes in whole days, never below one day, with exact calendar results', () => {
    const t = task('a', '2024-02-27', '2024-03-02')
    const s = shiftTask(t, 3)
    expect(formatISO(s.start)).toBe('2024-03-01')
    expect(formatISO(s.end)).toBe('2024-03-05')
    expect(formatISO(shiftTask(t, -1).start)).toBe('2024-02-26')
    expect(formatISO(resizeTask(t, 'end', -100).end)).toBe('2024-02-27')
    expect(formatISO(resizeTask(t, 'start', 100).start)).toBe('2024-03-02')
    expect(formatISO(resizeTask(t, 'end', 2).end)).toBe('2024-03-04')
    expect(formatISO(addMonths(t.start, 1))).toBe('2024-03-27')
  })

  it('reports reversed dates, unknown or self predecessors, early starts and cycles', () => {
    const tasks = [
      task('설계', '2024-03-01', '2024-03-10', [], 0), task('개발', '2024-03-08', '2024-03-20', ['설계'], 1), task('테스트', '2024-03-21', '2024-03-25', ['개발', '없는 작업'], 2),
      task('역순', '2024-03-30', '2024-03-20', [], 3), task('자기', '2024-04-01', '2024-04-02', ['자기'], 4),
    ]
    const msgs = validateTasks(tasks).map((i) => i.text).join('\n')
    expect(msgs).toMatch(/‘개발’이\(가\) 선행 작업 ‘설계’이\(가\) 끝나기 전에/)
    expect(msgs).toMatch(/‘없는 작업’/)
    expect(msgs).toMatch(/종료일이 시작일보다 빠릅니다/)
    expect(msgs).toMatch(/자기 자신에 의존/)
    expect(validateTasks([task('a', '2024-01-01', '2024-01-05', [], 0), task('b', '2024-01-06', '2024-01-09', ['a'], 1)])).toEqual([])
    const cyc = [task('a', '2024-01-01', '2024-01-02', ['c']), task('b', '2024-01-03', '2024-01-04', ['a']), task('c', '2024-01-05', '2024-01-06', ['b'])]
    expect(findCycle(cyc)).toEqual(['a', 'c', 'b', 'a'])
    expect(validateTasks(cyc).some((i) => /순환/.test(i.text))).toBe(true)
    expect(findCycle([task('a', '2024-01-01', '2024-01-02'), task('b', '2024-01-03', '2024-01-04', ['a'])])).toBeNull()
  })
})

describe('Marimekko', () => {
  const data = [['동아시아', '모바일', 30], ['동아시아', '웹', 10], ['유럽', '모바일', 20], ['유럽', '웹', 60], ['북미', '웹', 40]].map(([category, segment, value], row) => ({ category: category as string, segment: segment as string, value: value as number, row }))

  it('widths follow category totals and heights follow shares, so area is proportional to value', () => {
    const m = marimekko(data)
    expect(m.grand).toBe(160)
    expect(m.columns.map((c) => [c.name, c.total])).toEqual([['동아시아', 40], ['유럽', 80], ['북미', 40]])
    const W = 400
    const H = 300
    for (const c of m.columns) for (const s of c.segments) expect(((c.total / m.grand) * W * (s.share * H)) / (W * H)).toBeCloseTo(s.value / m.grand, 12)
    expect(m.columns[1].segments.map((s) => s.share)).toEqual([0.25, 0.75])
  })

  it('keeps a given category order, skips negatives and merges duplicate rows', () => {
    const m = marimekko([...data, { category: '유럽', segment: '웹', value: 5, row: 9 }, { category: '유럽', segment: '모바일', value: -5, row: 10 }], ['북미', '유럽', '동아시아'])
    expect(m.columns.map((c) => c.name)).toEqual(['북미', '유럽', '동아시아'])
    expect(m.columns[1].segments.find((s) => s.name === '웹')!.value).toBe(65)
    expect(m.columns[1].total).toBe(85)
    expect(marimekko([]).columns).toEqual([])
  })
})

describe('flame graph', () => {
  const stacks = [['main;parse;lex', 30], ['main;parse;ast', 20], ['main;eval', 40], ['main;eval;gc', 10], ['main', 5], ['idle', 15]].map(([stack, value], row) => ({ stack: stack as string, value: value as number, row }))

  it('merges shared prefixes and keeps self and total cost consistent', () => {
    const root = buildFlame(stacks)
    expect(root.total).toBe(120)
    const main = root.children.find((c) => c.name === 'main')!
    expect(main.total).toBe(105)
    expect(main.self).toBe(5)
    expect(main.children.find((c) => c.name === 'parse')!.total).toBe(50)
    const ev = main.children.find((c) => c.name === 'eval')!
    expect(ev.self).toBe(40)
    expect(ev.total).toBe(50)
    const check = (n: typeof root): void => { expect(n.total).toBe(n.self + n.children.reduce((s, c) => s + c.total, 0)); n.children.forEach(check) }
    check(root)
  })

  it('layout: block widths are proportional to total cost and children fit inside their parent', () => {
    const { blocks, top } = flameLayout(buildFlame(stacks))
    expect(top.total).toBe(120)
    const w = (path: string) => { const b = blocks.find((x) => x.node.path.join(';') === path)!; return b.x1 - b.x0 }
    expect(w('main')).toBeCloseTo(105 / 120, 12)
    expect(w('main;parse;lex')).toBeCloseTo(30 / 120, 12)
    for (const b of blocks) {
      const kids = blocks.filter((k) => k.depth === b.depth + 1 && k.node.path.slice(0, -1).join(';') === b.node.path.join(';'))
      if (kids.length) { expect(Math.min(...kids.map((k) => k.x0))).toBeGreaterThanOrEqual(b.x0 - 1e-12); expect(Math.max(...kids.map((k) => k.x1))).toBeLessThanOrEqual(b.x1 + 1e-12) }
    }
    // siblings are ordered by name, not by cost or by time
    const order = blocks.filter((b) => b.depth === 1).sort((a, c) => a.x0 - c.x0).map((b) => b.node.name)
    expect(order).toEqual(['idle', 'main'])
  })

  it('zooming rescales to the focused function; unknown focus falls back; search finds matches', () => {
    const root = buildFlame(stacks)
    const z = flameLayout(root, ['main', 'eval'])
    expect(z.top.name).toBe('eval')
    expect(z.blocks[0].x1 - z.blocks[0].x0).toBeCloseTo(1, 12)
    expect(flameLayout(root, ['nope']).top.name).toBe('전체')
    const all = flameLayout(root).blocks
    expect([...flameMatches(all, 'PAR')]).toEqual(['main;parse'])
    expect(flameMatches(all, '').size).toBe(0)
  })

  it('ignores rows without cost or a stack', () => {
    expect(buildFlame([{ stack: 'a;b', value: 0, row: 0 }, { stack: '', value: 5, row: 1 }, { stack: 'x', value: -1, row: 2 }]).total).toBe(0)
  })
})

describe('network structure tools', () => {
  const edges = rows([['A', 'B', 2, 'g1'], ['B', 'A', 3], ['B', 'C', 1, 'g1'], ['D', '', undefined, 'g2'], ['C', 'D', 4]])

  it('a directed graph keeps A→B and B→A apart, an undirected one merges them', () => {
    expect(buildNetwork(edges).links).toHaveLength(3)
    const d = buildNetwork(edges, { directed: true })
    expect(d.links).toHaveLength(4)
    expect(d.links.find((l) => l.source === 'A' && l.target === 'B')!.weight).toBe(2)
    expect(d.links.find((l) => l.source === 'B' && l.target === 'A')!.weight).toBe(3)
    expect(d.nodes.find((n) => n.id === 'B')!.inDeg).toBe(1)
    expect(d.nodes.find((n) => n.id === 'B')!.outDeg).toBe(2)
  })

  it('adjacency matrix: symmetric when undirected, row = source when directed', () => {
    const net = buildNetwork(edges)
    const order = ['A', 'B', 'C', 'D']
    const m = adjacencyMatrix(net, order, false)
    expect(m[0][1]).toBe(5)
    expect(m[1][0]).toBe(5)
    for (let i = 0; i < 4; i++) { expect(m[i][i]).toBe(0); for (let j = 0; j < 4; j++) expect(m[i][j]).toBe(m[j][i]) }
    const dn = buildNetwork(edges, { directed: true })
    const dm = adjacencyMatrix(dn, order, true)
    expect(dm[0][1]).toBe(2)
    expect(dm[1][0]).toBe(3)
    expect(dm[2][3]).toBe(4)
    expect(dm[3][2]).toBe(0)
    const rev = adjacencyMatrix(net, ['D', 'C', 'B', 'A'], false)
    expect(rev[3][2]).toBe(5)
    // total weight equals twice the edge weight sum for an undirected matrix
    expect(d3.sum(m.flat())).toBe(2 * d3.sum(net.links, (l) => l.weight))
  })

  it('node orders are permutations; cluster order keeps components together', () => {
    const net = buildNetwork(rows([['a', 'b'], ['b', 'c'], ['c', 'a'], ['x', 'y'], ['y', 'z'], ['q', '']]))
    for (const o of ['data', 'name', 'degree', 'group', 'cluster'] as const) expect(orderNodes(net, o).map((n) => n.id).sort()).toEqual(['a', 'b', 'c', 'q', 'x', 'y', 'z'])
    const ids = orderNodes(net, 'cluster').map((n) => n.id)
    const comp = (id: string) => net.nodes.find((n) => n.id === id)!.component
    const changes = ids.slice(1).filter((id, i) => comp(id) !== comp(ids[i])).length
    expect(changes).toBe(new Set(net.nodes.map((n) => n.component)).size - 1)
  })

  it('bipartite: reports names on both sides and drops the conflicting edges', () => {
    const bp = buildBipartite(rows([['민준', '독서', 2], ['서연', '독서'], ['서연', '등산', 3], ['독서', '민준'], ['민준', '독서', 5]]))
    expect(bp.issues.map((i) => i.node).sort()).toEqual(['독서', '민준'])
    expect(bp.edges.find((e) => e.a === '서연' && e.b === '등산')!.weight).toBe(3)
    expect(bp.edges.every((e) => bp.left.includes(e.a) && bp.right.includes(e.b))).toBe(true)
    const ok = buildBipartite(rows([['a', 'x', 1], ['a', 'x', 2], ['b', 'y']]))
    expect(ok.issues).toEqual([])
    expect(ok.edges.find((e) => e.a === 'a')!.weight).toBe(3)
    expect(ok.left).toEqual(['a', 'b'])
    expect(ok.right).toEqual(['x', 'y'])
  })

  it('crossing count and barycenter ordering remove avoidable crossings', () => {
    const e = [['a', 'z'], ['b', 'y'], ['c', 'x']].map(([a, b]) => ({ a, b, weight: 1, rows: [0] }))
    expect(crossings(e, ['a', 'b', 'c'], ['x', 'y', 'z'])).toBe(3)
    expect(crossings(e, ['a', 'b', 'c'], ['z', 'y', 'x'])).toBe(0)
    const o = barycenterOrder({ left: ['a', 'b', 'c'], right: ['x', 'y', 'z'], edges: e })
    expect(crossings(e, o.left, o.right)).toBe(0)
    const rng = createRng(3)
    const L = Array.from({ length: 8 }, (_, i) => `L${i}`)
    const R = Array.from({ length: 8 }, (_, i) => `R${i}`)
    const rand = Array.from({ length: 24 }, () => ({ a: L[Math.floor(rng() * 8)], b: R[Math.floor(rng() * 8)], weight: 1, rows: [0] }))
    const before = crossings(rand, L, R)
    const after = barycenterOrder({ left: L, right: R, edges: rand })
    expect(crossings(rand, after.left, after.right)).toBeLessThanOrEqual(before)
  })

  it('hive layout is deterministic, uses the rule for axes and ranks nodes along the axis', () => {
    const net = buildNetwork(rows([['a', 'b', 1, 'X'], ['b', 'c', 1, 'Y'], ['c', 'd', 1, 'Z'], ['d', 'a'], ['e', 'a', 1, 'X'], ['f', 'a', 1, 'Y']]))
    const g = hiveLayout(net, 3, 'group', 'degree')
    expect(g).toEqual(hiveLayout(net, 3, 'group', 'degree'))
    // groups are sorted by name — (없음), X, Y, Z — and map to axes in that order; the extra group shares the last axis
    expect(g.find((n) => n.id === 'd')!.axis).toBe(0)
    expect(g.find((n) => n.id === 'a')!.axis).toBe(1)
    expect(g.find((n) => n.id === 'b')!.axis).toBe(2)
    expect(g.find((n) => n.id === 'c')!.axis).toBe(2)
    expect(new Set(g.map((n) => n.id)).size).toBe(net.nodes.length)
    const deg = hiveLayout(net, 3, 'degree', 'degree')
    const axisOf = (id: string) => deg.find((n) => n.id === id)!.axis
    const byDegree = [...net.nodes].sort((p, q) => p.degree - q.degree)
    expect(axisOf(byDegree[0].id)).toBe(0)
    expect(axisOf(byDegree[byDegree.length - 1].id)).toBe(2)
    for (const a of [0, 1, 2]) { const on = deg.filter((n) => n.axis === a); for (const n of on) { expect(n.t).toBeGreaterThanOrEqual(0); expect(n.t).toBeLessThanOrEqual(1) } }
    const byName = hiveLayout(net, 2, 'component', 'name')
    expect(byName.every((n) => n.axis === 0 || n.axis === 1)).toBe(true)
  })

  it('edge bundling follows the hierarchy: the path goes up to the lowest common ancestor and down', () => {
    const tree = treeFromPaths(['app/ui/Button', 'app/ui/Modal', 'app/data/Store', 'lib/http/Client', 'lib/http/Retry'])
    expect(tree.children!.map((c) => c.name)).toEqual(['app', 'lib'])
    const root = d3.hierarchy(tree)
    const key = (n: d3.HierarchyNode<{ name: string }>) => n.ancestors().reverse().slice(1).map((a) => a.data.name).join('/')
    const same = bundlePath(root, 'app/ui/Button', 'app/ui/Modal', key)!
    expect(same.map((n) => n.data.name)).toEqual(['Button', 'ui', 'Modal'])
    const across = bundlePath(root, 'app/ui/Button', 'lib/http/Client', key)!
    expect(across.map((n) => n.data.name)).toEqual(['Button', 'ui', 'app', '', 'lib', 'http', 'Client'])
    expect(bundlePath(root, 'app/ui/Button', 'nope', key)).toBeNull()
    expect(treeFromPaths([]).children).toEqual([])
  })
})
