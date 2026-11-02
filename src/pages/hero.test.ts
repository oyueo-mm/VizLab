import * as d3 from 'd3'
import { beforeAll, describe, expect, it } from 'vitest'
import { MOVE_MS, STAGE_MS } from './HeroDemo'
import { bundleCurve, heroGeoValue, loadHeroGeo, resample } from './heroFramesV4'
import { loadHeroV5 } from './heroFramesV5Lazy'
import { loadHeroV6 } from './heroFramesV6Lazy'
import { buildFrame, heroData, heroFlows, heroSample, heroStages, heroTree, HERO_N, type HeroStage, type Mark } from './heroFrames'

const W = 560
const H = 380

beforeAll(async () => { await loadHeroGeo(); await loadHeroV5(); await loadHeroV6() })

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

  it('has 50 distinct stages, each drawn from real engines', () => {
    expect(heroStages.length).toBe(50)
    expect(new Set(heroStages.map((s) => s.key)).size).toBe(50)
    expect(new Set(heroStages.map((s) => s.viz)).size).toBe(50)
    expect(heroStages.slice(0, 24).map((s) => s.group)).toEqual([...Array(6).fill('dist'), 'path', ...Array(4).fill('compare'), 'pyramid', ...Array(4).fill('time'), ...Array(2).fill('hierarchy'), 'flame', 'flow', 'network', 'bundle', 'geo', 'meta'])
    expect(heroStages.slice(24, 36).every((s) => s.group === 'v5')).toBe(true)
    expect(heroStages.slice(36).every((s) => s.group === 'v6')).toBe(true)
    expect(heroStages.map((s) => s.viz)).toEqual(expect.arrayContaining(['connected-scatter', 'pyramid', 'network', 'horizon', 'choropleth', 'forest', 'flame', 'edge-bundling', 'isoline', 'kaplan-meier', 'manhattan', 'upset']))
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

describe('home animation: v0.4 stages', () => {
  const frame = (s: HeroStage, cycle = 0) => buildFrame(s, heroData(cycle), W, H)

  it('choropleth colours regions by quantile classes of a real metric that changes each loop', () => {
    const polys = frame('choropleth').filter((m) => m.t === 'poly') as Extract<Mark, { t: 'poly' }>[]
    expect(polys.length).toBeGreaterThan(120)
    expect(new Set(polys.map((p) => p.fill)).size).toBeGreaterThanOrEqual(5)
    for (const p of polys) for (const [x, y] of p.pts) { expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true); expect(x).toBeGreaterThan(-30); expect(x).toBeLessThan(W + 30); expect(y).toBeGreaterThan(-30); expect(y).toBeLessThan(H + 30) }
    const fills = (c: number) => (frame('choropleth', c).filter((m) => m.t === 'poly') as Extract<Mark, { t: 'poly' }>[]).map((p) => `${p.k}:${p.fill}`).join()
    expect(fills(0)).not.toBe(fills(1))
    // 50 million people on 1,000,000 km² with a GDP of 100,000 million dollars
    expect(heroGeoValue(0, 5e7, 1e5, 1e6)).toBeCloseTo(50, 6)
    expect(heroGeoValue(1, 5e7, 1e5, 1e6)).toBeCloseTo(2000, 6)
    expect(heroGeoValue(2, 5e7, 1e5, 1e6)).toBeCloseTo(50, 6)
    expect(heroGeoValue(1, 5e7, undefined, 1e6)).toBeNull()
  })

  it('forest plot has one interval and box per study plus a pooled diamond, and the studies change every loop', () => {
    const marks = frame('forest')
    const boxes = marks.filter((m) => m.k.startsWith('fr:b'))
    expect(boxes.length).toBe(9)
    expect(marks.filter((m) => m.k.startsWith('fr:l')).length).toBe(9)
    const pooled = marks.find((m) => m.k === 'fr:pool') as Extract<Mark, { t: 'poly' }>
    expect(pooled.pts).toHaveLength(4)
    expect(pooled.pts[0][0]).toBeLessThan(pooled.pts[1][0])
    expect(pooled.pts[1][0]).toBeLessThan(pooled.pts[2][0])
    expect(frame('forest', 1).filter((m) => m.k.startsWith('fr:b')).length).toBe(11)
  })

  it('flame graph block widths are proportional to the cost and children sit inside their parent', () => {
    const rects = frame('flame').filter((m) => m.t === 'rect' && m.k.startsWith('fl:') && !m.k.startsWith('fl:t:')) as Extract<Mark, { t: 'rect' }>[]
    expect(rects.length).toBeGreaterThan(15)
    const root = rects.find((r) => r.k === 'fl:root')!
    const main = rects.find((r) => r.k === 'fl:main')!
    expect(main.w).toBeLessThanOrEqual(root.w + 1)
    expect(main.y).toBeLessThan(root.y)
    // a child never extends beyond its parent
    for (const r of rects) {
      const parent = r.k.includes(';') ? rects.find((q) => q.k === r.k.slice(0, r.k.lastIndexOf(';'))) : r.k === 'fl:root' ? undefined : rects.find((q) => q.k === 'fl:root')
      if (parent) { expect(r.x).toBeGreaterThanOrEqual(parent.x - 0.5); expect(r.x + r.w).toBeLessThanOrEqual(parent.x + parent.w + 1.5) }
    }
  })

  it('edge bundling starts from straight edges and ends on curves with the same number of points', () => {
    const edges = frame('bundle').filter((m) => m.t === 'poly') as Extract<Mark, { t: 'poly' }>[]
    expect(edges.length).toBeGreaterThan(15)
    let bent = 0
    for (const e of edges) {
      const from = (e.from as { pts?: [number, number][] }).pts!
      expect(e.pts.length).toBe(from.length)
      const [a, b] = [e.pts[0], e.pts[e.pts.length - 1]]
      const chord = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      const dev = (pts: [number, number][]) => Math.max(...pts.map((p) => Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / chord))
      expect(dev(from)).toBeLessThan(1.5)
      if (dev(e.pts) > 3) bent++
    }
    expect(bent).toBeGreaterThan(edges.length / 2)
  })

  it('resample keeps the end points and spaces points evenly; bundle β = 0 is the straight chord', () => {
    const line = resample([[0, 0], [10, 0], [10, 10]], 5)
    expect(line[0]).toEqual([0, 0])
    expect(line[4][0]).toBeCloseTo(10, 6); expect(line[4][1]).toBeCloseTo(10, 6)
    expect(line[2][0]).toBeCloseTo(10, 6)
    const curve = bundleCurve([[0, 0], [30, 60], [60, 0], [100, 40]], 0)
    for (const [x, y] of curve) expect(Math.abs(y - 0.4 * x)).toBeLessThan(2.5)
  })
})

describe('v0.5 stages', () => {
  const W5 = 560, H5 = 380
  const f = (k: HeroStage, cycle = 0) => buildFrame(k, heroData(cycle), W5, H5)

  it('isolines: contour lines of a terrain, one level per interval, the highest levels have the fewest lines', () => {
    const lines = f('isoline').filter((m) => m.t === 'poly') as Extract<Mark, { t: 'poly' }>[]
    expect(lines.length).toBeGreaterThan(8)
    expect(lines.every((l) => !l.closed && l.pts.length >= 2)).toBe(true)
  })
  it('Kaplan–Meier: survival steps never increase and stay between 0 and 1', () => {
    for (const g of [0, 1]) {
      const l = f('km').find((m) => m.k === `km:l${g}`) as Extract<Mark, { t: 'poly' }>
      const ys = l.pts.map((p) => p[1])
      // screen y grows downward, so a non-increasing survival curve has non-decreasing y
      for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1] - 1e-9)
    }
  })
  it('Renko: bricks are equal-sized and each starts where the previous one ended or one brick apart', () => {
    const bricks = f('renko').filter((m) => m.t === 'rect' && m.k.startsWith('rk:')) as Extract<Mark, { t: 'rect' }>[]
    expect(bricks.length).toBeGreaterThan(5)
    const hs = bricks.map((b) => b.h)
    for (const v of hs) expect(v).toBeCloseTo(hs[0], 6)
  })
  it('Manhattan: significant points rise above the 5×10⁻⁸ line (a planted signal), most points lie below it', () => {
    const marks = f('manhattan')
    const line = marks.find((m) => m.k === 'mh:gw') as Extract<Mark, { t: 'line' }>
    const dots = marks.filter((m) => m.t === 'circle') as Extract<Mark, { t: 'circle' }>[]
    const above = dots.filter((d) => d.y < line.y1)
    expect(above.length).toBeGreaterThan(0)
    expect(above.length).toBeLessThan(dots.length * 0.2)
  })
  it('UpSet: bars are sorted by size and set membership dots match the bar columns', () => {
    const marks = f('upset')
    const bars = marks.filter((m) => m.t === 'rect' && /^us:b/.test(m.k)) as Extract<Mark, { t: 'rect' }>[]
    expect(bars.length).toBe(10)
    for (let i = 1; i < bars.length; i++) expect(bars[i].h).toBeLessThanOrEqual(bars[i - 1].h + 1e-9)
  })
  it('Nightingale rose: slice area is proportional to the value', () => {
    const arcs = f('rose').filter((m) => m.t === 'arc') as Extract<Mark, { t: 'arc' }>[]
    expect(arcs.length).toBe(12)
    const widths = new Set(arcs.map((a) => (a.a1 - a.a0).toFixed(6)))
    expect(widths.size).toBe(1)
  })
  it('the home loop stays reproducible: the same cycle gives the same marks, another cycle differs', () => {
    for (const k of ['isoline', 'streamline', 'voronoi', 'km', 'renko', 'manhattan', 'phase', 'upset', 'rose', 'venn', 'bifurcation', 'spiral'] as const) {
      expect(JSON.stringify(f(k, 1)), k).toBe(JSON.stringify(f(k, 1)))
      expect(JSON.stringify(f(k, 1)), k).not.toBe(JSON.stringify(f(k, 2)))
    }
  })
})
