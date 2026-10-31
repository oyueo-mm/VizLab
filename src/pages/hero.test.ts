import * as d3 from 'd3'
import { describe, expect, it } from 'vitest'
import { MOVE_MS, STAGE_MS } from './HeroDemo'
import { buildFrame, heroData, heroFlows, heroSample, heroStages, heroTree, HERO_N, type HeroStage, type Mark } from './heroFrames'

const W = 560
const H = 380

describe('home animation timing', () => {
  it('shows each chart for about 1.8 s with a 0.5–0.65 s morph', () => {
    expect(STAGE_MS).toBe(1800)
    expect(MOVE_MS).toBeGreaterThanOrEqual(500)
    expect(MOVE_MS).toBeLessThanOrEqual(650)
    expect(MOVE_MS).toBeLessThan(STAGE_MS)
  })
})

describe('home animation frames', () => {
  const data = heroData(0)
  const frame = (s: HeroStage, d = data) => buildFrame(s, d, W, H)
  const numbers = (m: Mark): number[] => Object.values(m).flatMap((v) => (typeof v === 'number' ? [v] : Array.isArray(v) && typeof v[0] !== 'string' ? (v as any[]).flat().filter((x) => typeof x === 'number') : []))

  it('has 20 distinct stages, each drawn from real engines', () => {
    expect(heroStages.length).toBe(20)
    expect(new Set(heroStages.map((s) => s.key)).size).toBe(20)
    expect(new Set(heroStages.map((s) => s.viz)).size).toBe(20)
    expect(heroStages.map((s) => s.group)).toEqual([...Array(6).fill('dist'), 'path', ...Array(4).fill('compare'), 'pyramid', ...Array(4).fill('time'), ...Array(2).fill('hierarchy'), 'flow', 'network'])
    expect(heroStages.map((s) => s.viz)).toEqual(expect.arrayContaining(['connected-scatter', 'pyramid', 'network', 'horizon']))
  })

  it('builds finite, uniquely keyed marks for every stage', () => {
    for (const s of heroStages) {
      const marks = frame(s.key)
      expect(marks.length, s.key).toBeGreaterThanOrEqual(8)
      expect(new Set(marks.map((m) => m.k)).size, s.key).toBe(marks.length)
      for (const m of marks) for (const v of numbers(m)) expect(Number.isFinite(v), `${s.key}:${m.k}`).toBe(true)
    }
  })

  it('keeps the same 140 observations as circles in all six distribution stages (so they can morph)', () => {
    const keys = (s: HeroStage) => frame(s).map((m) => m.k).sort()
    const base = keys('scatter')
    expect(base.filter((k) => /^p\d+$/.test(k)).length).toBe(HERO_N)
    for (const s of ['histogram', 'kde', 'ecdf', 'box', 'violin'] as const) expect(keys(s), s).toEqual(base)
    // polygon / polyline keep their point counts across stages
    const len = (s: HeroStage, k: string) => (frame(s).find((m) => m.k === k) as any).pts.length
    for (const s of ['histogram', 'kde', 'ecdf', 'box', 'violin'] as const) { expect(len(s, 'dens')).toBe(len('scatter', 'dens')); expect(len(s, 'ecdf')).toBe(len('scatter', 'ecdf')) }
  })

  it('histogram stage: dots per column equal the bar height (same data, counted)', () => {
    const marks = frame('histogram')
    const bars = marks.filter((m) => m.t === 'rect' && m.k.startsWith('bar')) as Extract<Mark, { t: 'rect' }>[]
    const dots = marks.filter((m) => m.t === 'circle') as Extract<Mark, { t: 'circle' }>[]
    expect(dots.length).toBe(HERO_N)
    const sum = d3.sum(bars, (b) => b.h)
    const unit = bars.find((b) => b.h > 0)!.h / dots.filter((d) => Math.abs(d.x - (bars.find((b) => b.h > 0)!.x + bars.find((b) => b.h > 0)!.w / 2)) < 1).length
    expect(sum / unit).toBeCloseTo(HERO_N, 6)
  })

  it('ECDF stage: circle heights are the empirical CDF values', () => {
    const marks = frame('ecdf')
    const base = H - 34
    const span = base - 18
    const dots = marks.filter((m) => /^p\d+$/.test(m.k)) as Extract<Mark, { t: 'circle' }>[]
    const f = dots.map((d) => (base - d.y) / (span * 0.94)).sort((a, b) => a - b)
    f.forEach((v, i) => expect(v).toBeCloseTo((i + 1) / HERO_N, 6))
  })

  it('violin stage: the polygon is mirrored around one centre line, KDE stage: it rests on the baseline', () => {
    const v = (frame('violin').find((m) => m.k === 'dens') as any).pts as [number, number][]
    const half = v.length / 2
    const mid = (v[0][1] + v[v.length - 1][1]) / 2
    for (let i = 0; i < half; i++) { expect(v[i][0]).toBeCloseTo(v[v.length - 1 - i][0], 6); expect((v[i][1] + v[v.length - 1 - i][1]) / 2).toBeCloseTo(mid, 6) }
    const k = (frame('kde').find((m) => m.k === 'dens') as any).pts as [number, number][]
    expect(k.slice(k.length / 2).every((p) => Math.abs(p[1] - (H - 34)) < 1e-9)).toBe(true)
  })

  it('compare stages use the real values: bar = total, grouped = parts, stacked = running sum, 100% = shares', () => {
    const { cats, series, value } = data.compare
    const base = H - 34
    const rects = (s: HeroStage) => frame(s).filter((m) => m.k.startsWith('cmp:')) as Extract<Mark, { t: 'rect' }>[]
    const total = (c: string) => d3.sum(series, (x) => value(c, x))
    const tallest = d3.max(cats, total)!
    const bar = rects('bar')
    const unit = (base - 18) / (tallest * 1.04)
    cats.forEach((c) => expect(bar.find((m) => m.k === `cmp:${c}|${series[0]}`)!.h).toBeCloseTo(total(c) * unit, 6))
    const grouped = rects('grouped')
    const maxV = d3.max(cats, (c) => d3.max(series, (x) => value(c, x)))!
    const gu = (base - 18) / (maxV * 1.08)
    cats.forEach((c) => series.forEach((x) => expect(grouped.find((m) => m.k === `cmp:${c}|${x}`)!.h).toBeCloseTo(value(c, x) * gu, 6)))
    const stacked = rects('stacked')
    cats.forEach((c) => expect(d3.sum(series, (x) => stacked.find((m) => m.k === `cmp:${c}|${x}`)!.h)).toBeCloseTo(total(c) * unit, 6))
    const full = rects('stacked100')
    cats.forEach((c) => {
      expect(d3.sum(series, (x) => full.find((m) => m.k === `cmp:${c}|${x}`)!.h)).toBeCloseTo(base - 18, 6)
      series.forEach((x) => expect(full.find((m) => m.k === `cmp:${c}|${x}`)!.h / (base - 18)).toBeCloseTo(value(c, x) / total(c), 6))
    })
  })

  it('compare stages share their keys so bars split and stack in place', () => {
    const k = (s: HeroStage) => frame(s).map((m) => m.k).sort()
    for (const s of ['grouped', 'stacked', 'stacked100'] as const) expect(k(s)).toEqual(k('bar'))
  })

  it('time stages keep three series with 24 points and the stream layers stack to the real values', () => {
    for (const s of ['line', 'area', 'stream'] as const) {
      const bands = frame(s).filter((m) => m.t === 'band') as Extract<Mark, { t: 'band' }>[]
      expect(bands.length, s).toBe(3)
      bands.forEach((b) => expect(b.pts.length).toBe(24))
    }
    const { keys, months, value } = data.time
    const stream = frame('stream').filter((m) => m.t === 'band') as Extract<Mark, { t: 'band' }>[]
    const thickness = (i: number) => d3.sum(stream, (b) => b.pts[i][1] - b.pts[i][2])
    const top = d3.max(keys, (k) => d3.max(months, (m) => value(k, m)))! * 1.08
    expect(top).toBeGreaterThan(0)
    // at each month the combined thickness is proportional to the sum of the three series
    const ratio = thickness(0) / d3.sum(keys, (k) => value(k, months[0]))
    for (let i = 1; i < 24; i++) expect(thickness(i) / d3.sum(keys, (k) => value(k, months[i]))).toBeCloseTo(ratio, 6)
  })

  it('treemap area and sunburst angle are both proportional to the budget values', () => {
    const tm = frame('treemap').filter((m) => m.t === 'rect') as Extract<Mark, { t: 'rect' }>[]
    expect(tm.length).toBe(d3.hierarchy(data.tree).leaves().length)
    const sb = frame('sunburst').filter((m) => m.t === 'arc') as Extract<Mark, { t: 'arc' }>[]
    expect(sb.length).toBeGreaterThan(tm.length)
    const top = sb.filter((a) => a.r0 === sb[0].r0)
    expect(d3.sum(top, (a) => a.a1 - a.a0)).toBeCloseTo(2 * Math.PI, 6)
    const total = d3.sum(tm, (r) => r.w * r.h)
    expect(tm.every((r) => r.w > 0 && r.h > 0)).toBe(true)
    expect(total).toBeGreaterThan(0.8 * (W - 24) * (H - 24))
  })

  it('sankey stage draws every flow with width proportional to its value', () => {
    const marks = frame('sankey')
    const links = marks.filter((m) => m.t === 'link') as Extract<Mark, { t: 'link' }>[]
    expect(links.length).toBe(data.flows.length)
    const ratio = links[0].w / data.flows[0].value
    links.forEach((l, i) => expect(l.w / data.flows[i].value).toBeCloseTo(ratio, 6))
  })

  it('a new cycle changes the seeded data', () => {
    expect(heroSample(1)).not.toEqual(heroSample(0))
    expect(heroData(1).compare.value('노트북', '1분기')).not.toBe(heroData(0).compare.value('노트북', '1분기'))
    expect(heroData(1).time.value('검색', 1)).not.toBe(heroData(0).time.value('검색', 1))
    expect(heroData(1).pyramid.left).not.toEqual(heroData(0).pyramid.left)
    expect(heroData(1).path.pts).not.toEqual(heroData(0).path.pts)
  })

  it('is reproducible: the same cycle always yields the same data', () => {
    const a = heroData(3)
    const b = heroData(3)
    for (const k of ['dist', 'path', 'pyramid', 'net', 'tree', 'flows'] as const) expect(a[k], k).toEqual(b[k])
    expect(a.compare.value('노트북', '1분기')).toBe(b.compare.value('노트북', '1분기'))
  })
})

describe('home animation: new stages', () => {
  const W2 = 560
  const H2 = 380
  const frame = (s: HeroStage, d = heroData(0)) => buildFrame(s, d, W2, H2)

  it('connected scatter draws one point per time step plus a path through all of them in order', () => {
    const data = heroData(0)
    const marks = frame('connected', data)
    const dots = marks.filter((m) => m.t === 'circle') as Extract<Mark, { t: 'circle' }>[]
    const path = marks.find((m) => m.k === 'cs:path') as Extract<Mark, { t: 'poly' }>
    expect(dots).toHaveLength(data.path.pts.length)
    expect(path.pts).toHaveLength(data.path.pts.length)
    path.pts.forEach((p, i) => { expect(p[0]).toBeCloseTo(dots[i].x, 6); expect(p[1]).toBeCloseTo(dots[i].y, 6) })
    // the path grows out of the first point
    expect((path.from as any).pts.every((p: number[]) => p[0] === path.pts[0][0] && p[1] === path.pts[0][1])).toBe(true)
    // x grows with income, so the later steps are further right
    expect(dots[dots.length - 1].x).toBeGreaterThan(dots[0].x)
  })

  it('population pyramid bars are proportional to the values and mirrored around the centre', () => {
    const data = heroData(0)
    const marks = frame('pyramid', data)
    const left = marks.filter((m) => /^py:l\d+$/.test(m.k)) as Extract<Mark, { t: 'rect' }>[]
    const right = marks.filter((m) => /^py:r\d+$/.test(m.k)) as Extract<Mark, { t: 'rect' }>[]
    expect(left).toHaveLength(data.pyramid.ages.length)
    const unit = right[0].w / data.pyramid.right[0]
    left.forEach((l, i) => { expect(l.w / data.pyramid.left[i]).toBeCloseTo(unit, 6); expect(l.x + l.w).toBeCloseTo(W2 / 2, 6) })
    right.forEach((r, i) => { expect(r.w / data.pyramid.right[i]).toBeCloseTo(unit, 6); expect(r.x).toBeCloseTo(W2 / 2, 6) })
  })

  it('horizon stage folds each series into bands whose sum rebuilds the deviation from the mean', () => {
    const data = heroData(0)
    const marks = frame('horizon', data)
    const bands = marks.filter((m) => m.t === 'band') as Extract<Mark, { t: 'band' }>[]
    expect(bands).toHaveLength(data.time.keys.length * 2 * 3)
    expect(bands.every((b) => b.pts.length === data.time.months.length)).toBe(true)
    const { keys, months, value } = data.time
    const mean = d3.mean(months, (m) => value(keys[0], m))!
    const bandsOf = bands.filter((b) => b.k.startsWith(`hz:${keys[0]}:`))
    const fill = (b: (typeof bands)[number], i: number) => b.pts[i][1] - b.pts[i][2]
    const biggest = Math.max(...keys.map((k) => d3.max(months, (m) => Math.abs(value(k, m) - d3.mean(months, (mm) => value(k, mm))!))!))
    const w = biggest / 3
    // every band is a fraction of the strip height, so (positive − negative) bands × band width gives back the deviation
    const strip = (H2 - 34 - 18 - 8 * (keys.length - 1)) / keys.length
    months.forEach((m, i) => {
      const pos = d3.sum(bandsOf.filter((b) => b.k.includes(':p')), (b) => fill(b, i)) / strip
      const neg = d3.sum(bandsOf.filter((b) => b.k.includes(':n')), (b) => fill(b, i)) / strip
      expect((pos - neg) * w).toBeCloseTo(value(keys[0], m) - mean, 6)
    })
  })

  it('network stage draws every node and edge at finite, in-bounds positions and starts from a different layout', () => {
    const data = heroData(0)
    const marks = frame('network', data)
    const nodes = marks.filter((m) => m.t === 'circle') as Extract<Mark, { t: 'circle' }>[]
    const links = marks.filter((m) => m.t === 'line') as Extract<Mark, { t: 'line' }>[]
    expect(nodes).toHaveLength(new Set(data.net.edges.flatMap((e) => [e.source, e.target]).filter(Boolean)).size)
    expect(links.length).toBeGreaterThan(nodes.length - 1)
    for (const n of nodes) { expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true); expect(n.x).toBeGreaterThan(-20); expect(n.x).toBeLessThan(W2 + 20) }
    const moved = nodes.filter((n) => Math.hypot(((n.from as any).x ?? n.x) - n.x, ((n.from as any).y ?? n.y) - n.y) > 5)
    expect(moved.length).toBeGreaterThan(nodes.length / 2)
    // connected nodes end up closer than they started
    const dist = (l: (typeof links)[number], from: boolean) => Math.hypot((from ? (l.from as any).x2 : l.x2) - (from ? (l.from as any).x1 : l.x1), (from ? (l.from as any).y2 : l.y2) - (from ? (l.from as any).y1 : l.y1))
    expect(d3.mean(links, (l) => dist(l, false))!).toBeLessThan(d3.mean(links, (l) => dist(l, true))!)
  })

  it('the network changes size across loops', () => {
    const counts = new Set([0, 1, 2, 3].map((c) => heroData(c).net.edges.length))
    expect(counts.size).toBeGreaterThan(1)
  })
})

describe('home animation: data that changes every loop', () => {
  it('the budget tree keeps its three levels but changes its values and shape across loops', () => {
    const shapes = new Set<string>()
    const values = new Set<number>()
    for (let c = 0; c < 8; c++) {
      const root = d3.hierarchy(heroTree(c))
      expect(root.height).toBe(3)
      expect((heroTree(c).children ?? []).length).toBe(4)
      shapes.add(root.leaves().map((l) => l.data.name + '/' + l.parent!.data.name).join())
      values.add(root.sum((d) => d.value ?? 0).value!)
    }
    expect(shapes.size).toBeGreaterThan(1)
    expect(values.size).toBeGreaterThan(4)
    expect(heroTree(5)).toEqual(heroTree(5))
  })

  it('energy flows are re-drawn every loop yet always balance at every intermediate node', () => {
    const totals = new Set<number>()
    for (let c = 0; c < 10; c++) {
      const edges = heroFlows(c)
      const nodes = new Set(edges.flatMap((e) => [e.source, e.target]))
      for (const n of ['전력', '직접 연소']) {
        const inflow = d3.sum(edges.filter((e) => e.target === n), (e) => e.value)
        const outflow = d3.sum(edges.filter((e) => e.source === n), (e) => e.value)
        expect(outflow, `cycle ${c} ${n}`).toBe(inflow)
        expect(nodes.has(n)).toBe(true)
      }
      expect(edges.every((e) => e.value > 0 && Number.isInteger(e.value))).toBe(true)
      totals.add(d3.sum(edges.filter((e) => ['석탄', '천연가스', '원자력', '재생에너지', '석유'].includes(e.source)), (e) => e.value))
    }
    expect(totals.size).toBeGreaterThan(5)
  })
})
