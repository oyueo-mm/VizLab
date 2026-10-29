import { describe, expect, it } from 'vitest'
import { generateDataset } from '../../data/datasets'
import { heroLayout, heroSample, heroStages } from '../../pages/HeroDemo'
import { parseHash, routeHref } from '../../router'
import { stepPath } from './ecdf'
import { buildMatrix } from './heatmap'
import { histogramLayout } from './histogram'
import { stackSeries, seriesOf } from './line'
import { stackCrossTab } from './multibar'
import { orderedDims, passes } from './parallel'
import { pieSlices } from './pie'
import { radarPoint } from './radar'
import { crossTab, groupedValues, pointRows } from './shared'
import { buildTree } from './treemap'

describe('chart data transforms', () => {
  const sales = generateDataset('categorical')

  it('cross-tabulates and stacks real group totals', () => {
    const tab = crossTab(sales, '제품', '분기', '판매량')
    expect(tab.cats).toEqual(['노트북', '태블릿', '스마트폰', '이어폰', '스마트워치'])
    expect(tab.groups).toEqual(['1분기', '2분기', '3분기', '4분기'])
    const series = stackCrossTab(tab.cats, tab.groups, tab.value, 'stack', 'none')
    tab.cats.forEach((c, i) => {
      const total = tab.groups.reduce((s, g) => s + tab.value(c, g), 0)
      expect(series[series.length - 1][i][1]).toBe(total)
      // each segment's height equals that group's value
      series.forEach((s, k) => expect(s[i][1] - s[i][0]).toBe(tab.value(c, tab.groups[k])))
    })
    const norm = stackCrossTab(tab.cats, tab.groups, tab.value, 'normalize', 'none')
    norm[norm.length - 1].forEach((d) => expect(d[1]).toBeCloseTo(1))
  })

  it('aligns area series on shared x values', () => {
    const t = generateDataset('timeseries', 7, 12)
    const s = seriesOf(pointRows(t, '월', '방문자', '채널'))
    expect(s.map((x) => x.key)).toEqual(['검색', 'SNS', '직접 유입'])
    const { xs, layers } = stackSeries(s, 'stack')
    expect(xs.length).toBe(12)
    xs.forEach((_, i) => expect(layers[2][i][1]).toBe(s.reduce((sum, ser) => sum + ser.pts[i].y, 0)))
  })

  it('groups small pie slices into 기타', () => {
    const cats = ['a', 'b', 'c', 'd']
    const vals: Record<string, number> = { a: 90, b: 6, c: 3, d: 1 }
    expect(pieSlices(cats, (c) => vals[c], [], 0).slices.length).toBe(4)
    const folded = pieSlices(cats, (c) => vals[c], [], 0.05)
    expect(folded.slices).toEqual([{ key: 'a', value: 90 }, { key: 'b', value: 6 }, { key: '기타', value: 4 }])
    expect(pieSlices(cats, (c) => vals[c], ['a'], 0).total).toBe(10)
  })

  it('builds a summed hierarchy for the treemap', () => {
    const t = generateDataset('budget')
    const { tree, skipped } = buildTree(t, ['부문', '부서'], '예산')
    expect(skipped).toBe(0)
    const rd = tree.children!.find((c) => c.name === '연구개발')!
    expect(rd.children!.map((c) => [c.name, c.value])).toEqual([['플랫폼', 79], ['신사업', 33], ['데이터', 28]])
  })

  it('z-scores heatmap rows and columns', () => {
    const t = generateDataset('players')
    const cols = ['속도', '힘', '기술']
    const row = buildMatrix(t, '선수', cols, { mode: 'values', normalize: 'row', sortRows: 'none' })
    row.values.forEach((r) => expect(r.reduce<number>((acc, v) => acc + (v ?? 0), 0)).toBeCloseTo(0))
    const col = buildMatrix(t, '선수', cols, { mode: 'values', normalize: 'col', sortRows: 'none' })
    cols.forEach((_, j) => expect(col.values.reduce<number>((acc, r) => acc + (r[j] ?? 0), 0)).toBeCloseTo(0))
    const corr = buildMatrix(t, null, cols, { mode: 'corr', normalize: 'none', sortRows: 'none' })
    expect(corr.values[0][0]).toBeCloseTo(1)
    const sorted = buildMatrix(t, '선수', cols, { mode: 'values', normalize: 'none', sortRows: 'sum' })
    expect(sorted.rows).toEqual(['선수 C', '선수 A', '선수 B'])
  })

  it('filters parallel-coordinate rows by every brushed axis', () => {
    expect(passes({ a: 1, b: 5 }, { a: [0, 2], b: [4, 6] })).toBe(true)
    expect(passes({ a: 1, b: 5 }, { a: [0, 2], b: [6, 7] })).toBe(false)
    expect(orderedDims(['a', 'b', 'c'], ['c', 'x', 'a'])).toEqual(['c', 'a', 'b'])
  })

  it('places radar vertices clockwise from the top', () => {
    const [x0, y0] = radarPoint(0, 4, 10)
    const [x1, y1] = radarPoint(1, 4, 10)
    expect(x0).toBeCloseTo(0)
    expect(y0).toBeCloseTo(-10)
    expect(x1).toBeCloseTo(10)
    expect(y1).toBeCloseTo(0)
  })

  it('draws the ECDF as a right-continuous step path', () => {
    const d = stepPath([{ x: 1, p: 0.5 }, { x: 2, p: 1 }], (v) => v * 10, (p) => 100 - p * 100, 0, 3, false)
    expect(d).toBe('M0,100H10V50H20V0H30')
  })

  it('shares one bin layout across groups', () => {
    const g = groupedValues(generateDataset('groups', 1, 40), '점수', '반')
    expect(g.map((x) => x.key)).toEqual(['A반', 'B반', 'C반', 'D반'])
    const all = g.flatMap((x) => x.values)
    const lay = histogramLayout(all, { rule: 'custom', bins: 8, offset: 0 })
    expect(lay.edges.length).toBe(9)
    expect(lay.edges[0]).toBe(Math.min(...all))
    expect(lay.edges[8]).toBeCloseTo(Math.max(...all))
  })
})

describe('home demo', () => {
  it('lays out the same sample for every stage', () => {
    const { xs, ys } = heroSample(0)
    for (const s of heroStages) {
      const l = heroLayout(s.key, xs, ys, 560, 380)
      expect(l.pts.length).toBe(xs.length)
      expect(l.pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))).toBe(true)
    }
    // histogram stage: one stacked dot per observation, so dots per column ∝ bar height
    const h = heroLayout('histogram', xs, ys, 560, 380)
    const perColumn = new Map<string, number>()
    for (const p of h.pts) perColumn.set(p[0].toFixed(3), (perColumn.get(p[0].toFixed(3)) ?? 0) + 1)
    const filled = h.bars.filter((b) => b.h > 0)
    expect(filled.length).toBe(perColumn.size)
    const unit = filled[0].h / perColumn.get((filled[0].x - 1 + (filled[0].w + 2) / 2).toFixed(3))!
    for (const b of filled) expect(b.h / unit).toBeCloseTo(perColumn.get((b.x - 1 + (b.w + 2) / 2).toFixed(3))!, 6)
    expect(heroSample(1)).not.toEqual(heroSample(0))
  })
})

describe('router', () => {
  it('parses and formats hash routes', () => {
    expect(parseHash('')).toEqual({ page: 'home' })
    expect(parseHash('#/catalog')).toEqual({ page: 'catalog', category: 'all' })
    expect(parseHash('#/catalog/distribution')).toEqual({ page: 'catalog', category: 'distribution' })
    expect(parseHash('#/catalog/bogus')).toEqual({ page: 'catalog', category: 'all' })
    expect(parseHash('#/viz/kde')).toEqual({ page: 'viz', id: 'kde' })
    expect(routeHref({ page: 'viz', id: 'grouped-bar' })).toBe('#/viz/grouped-bar')
    expect(parseHash(routeHref({ page: 'catalog', category: 'timeseries' }))).toEqual({ page: 'catalog', category: 'timeseries' })
  })
})
