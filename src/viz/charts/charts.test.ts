import { describe, expect, it } from 'vitest'
import { generateDataset } from '../../data/datasets'
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

describe('router', () => {
  it('parses and formats hash routes', () => {
    expect(parseHash('')).toEqual({ page: 'home' })
    expect(parseHash('#/catalog')).toEqual({ page: 'catalog', category: 'all' })
    expect(parseHash('#/catalog/distribution')).toEqual({ page: 'catalog', category: 'distribution' })
    expect(parseHash('#/catalog/bogus')).toEqual({ page: 'catalog', category: 'all' })
    expect(parseHash('#/catalog/hierarchy')).toEqual({ page: 'catalog', category: 'hierarchy' })
    expect(parseHash('#/catalog/uncertainty')).toEqual({ page: 'catalog', category: 'uncertainty' })
    expect(parseHash('#/catalog/other')).toEqual({ page: 'catalog', category: 'all' })
    expect(parseHash('#/viz/stacked-bar-100')).toEqual({ page: 'viz', id: 'stacked-bar-100' })
    expect(parseHash('#/viz/kde')).toEqual({ page: 'viz', id: 'kde' })
    expect(routeHref({ page: 'viz', id: 'grouped-bar' })).toBe('#/viz/grouped-bar')
    expect(parseHash(routeHref({ page: 'catalog', category: 'timeseries' }))).toEqual({ page: 'catalog', category: 'timeseries' })
  })

  it('keeps search text and data-type filters in the URL and restores them', () => {
    const route = { page: 'catalog' as const, category: 'comparison' as const, q: '막대 chart', kinds: ['categorical' as const, 'timeseries' as const] }
    const href = routeHref(route)
    expect(href).toBe('#/catalog/comparison?q=%EB%A7%89%EB%8C%80+chart&t=categorical%2Ctimeseries')
    expect(parseHash(href)).toEqual(route)
    expect(parseHash('#/catalog?t=network')).toEqual({ page: 'catalog', category: 'all', kinds: ['network'] })
    expect(parseHash('#/catalog?t=bogus,numeric')).toEqual({ page: 'catalog', category: 'all', kinds: ['numeric'] })
    expect(parseHash('#/catalog?q=')).toEqual({ page: 'catalog', category: 'all' })
    expect(routeHref({ page: 'catalog', category: 'all', q: '  ', kinds: [] })).toBe('#/catalog')
  })

  it('routes the comparison lab and its presets', () => {
    expect(parseHash('#/compare')).toEqual({ page: 'compare' })
    expect(parseHash('#/compare/xy')).toEqual({ page: 'compare', preset: 'xy' })
    expect(routeHref({ page: 'compare', preset: 'time' })).toBe('#/compare/time')
    expect(routeHref({ page: 'compare' })).toBe('#/compare')
  })
})
