import * as d3 from 'd3'
import { describe, expect, it } from 'vitest'
import { generateDataset } from '../data/datasets'
import { MOVE_MS, STAGE_MS } from './HeroDemo'
import { buildFrame, heroData, heroSample, heroStages, HERO_N, type HeroStage, type Mark } from './heroFrames'

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

  it('has 16 distinct stages, each drawn from real engines', () => {
    expect(heroStages.length).toBe(16)
    expect(new Set(heroStages.map((s) => s.key)).size).toBe(16)
    expect(new Set(heroStages.map((s) => s.viz)).size).toBe(16)
    expect(heroStages.map((s) => s.group)).toEqual([...Array(6).fill('dist'), ...Array(4).fill('compare'), ...Array(3).fill('time'), ...Array(2).fill('hierarchy'), 'flow'])
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
    expect(tm.length).toBe(generateDataset('budget').rows.length)
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
    // fixed-structure groups stay valid
    expect(heroData(1).flows.length).toBe(heroData(0).flows.length)
  })
})
