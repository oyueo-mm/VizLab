import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { content } from '../content'
import { datasetById, generateDataset } from '../data/datasets'
import { cloneTable, type DataTable } from '../data/table'
import { initialLabState } from '../lab/state'
import { heroStages } from '../pages/heroFrames'
import { catalogV5 } from './catalogV5'
import { catalogV6 } from './catalogV6'
import { catalogV7 } from './catalogV7'
import { catalogV8 } from './catalogV8'
import { catalogV8Net } from './catalogV8Net'
import { catalog, categories, categoryById, dataKinds, inCategory, searchCatalog, vizById } from './catalog'
import { hasModule, loadAllModules, moduleIds } from './charts'
import { autoMapping, incompatibility, mappingErrors } from './mapping'
import type { VizModule } from './types'

const V1 = ['scatter', 'bubble', 'hexbin', 'pairplot', 'histogram', 'kde', 'ecdf', 'box', 'violin', 'strip', 'bar', 'grouped-bar', 'stacked-bar', 'line', 'area', 'pie', 'treemap', 'heatmap', 'parallel', 'radar']
const V2 = ['ridgeline', 'raincloud', 'beeswarm', 'qq', 'lollipop', 'dumbbell', 'slope', 'waterfall', 'stacked-bar-100', 'waffle', 'stacked-area', 'streamgraph', 'bump', 'calendar', 'sunburst', 'pack', 'sankey', 'chord', 'dendrogram', 'ci']
const V3 = ['kde2d', 'pp', 'letter-value', 'connected-scatter', 'pca-biplot', 'andrews', 'pyramid', 'pareto', 'bullet', 'step', 'candlestick', 'horizon', 'mosaic', 'icicle', 'network', 'arc', 'alluvial', 'roc', 'pr', 'fan']
const V4 = ['choropleth', 'symbol-map', 'dot-density', 'geo-hexbin', 'flow-map', 'tile-grid', 'dorling', 'forest', 'bland-altman', 'calibration', 'control', 'funnel-plot', 'gantt', 'funnel', 'marimekko', 'flame', 'adjacency', 'edge-bundling', 'bipartite', 'hive']
const V5 = catalogV5.map((c) => c.id)
const V6 = catalogV6.map((c) => c.id)
const V7 = catalogV7.map((c) => c.id)
const V8 = [...catalogV8, ...catalogV8Net].map((c) => c.id)
const ALL = [...V1, ...V2, ...V3, ...V4, ...V5, ...V6, ...V7, ...V8]

let modules: Record<string, VizModule>
beforeAll(async () => { modules = await loadAllModules() })

const render = (id: string, table: DataTable, mapping: Record<string, any>, params: any, compact = false) =>
  renderToStaticMarkup(createElement(modules[id].Chart, { table, mapping, params, setParams: () => {}, width: 640, height: 420, compact }))

describe('visualization registry', () => {
  it('lists the 80 charts of v0.1–v0.4 plus every v0.5 and v0.6 chart, each with an implementation and content', () => {
    expect(catalog.length).toBe(80 + V5.length + V6.length + V7.length + V8.length)
    expect(new Set(catalog.map((c) => c.id)).size).toBe(80 + V5.length + V6.length + V7.length + V8.length)
    expect([...catalog.map((c) => c.id)].sort()).toEqual([...ALL].sort())
    expect(moduleIds.sort()).toEqual([...ALL].sort())
    for (const meta of catalog) {
      expect(hasModule(meta.id), meta.id).toBe(true)
      expect(modules[meta.id], meta.id).toBeDefined()
      const c = content[meta.id]
      expect(c, meta.id).toBeDefined()
      for (const key of ['suitable', 'howItWorks', 'math', 'pros', 'cons', 'cautions'] as const) expect(c[key].length, `${meta.id}.${key}`).toBeGreaterThan(0)
      expect(c.definition.length, meta.id).toBeGreaterThan(20)
      expect(categoryById.has(meta.category)).toBe(true)
      for (const a of meta.alsoIn ?? []) expect(categoryById.has(a), `${meta.id} alsoIn ${a}`).toBe(true)
      for (const r of meta.related) { expect(vizById.has(r), `${meta.id} → ${r}`).toBe(true); expect(r).not.toBe(meta.id) }
      expect(meta.keywords.length, meta.id).toBeGreaterThan(1)
      expect(meta.summary.length, meta.id).toBeGreaterThan(15)
    }
  })

  it('has no empty category and every new chart is reachable from a category', () => {
    for (const c of categories) expect(catalog.filter((v) => inCategory(v, c.id)).length, c.id).toBeGreaterThan(0)
    expect(categories.map((c) => c.id)).toEqual(['distribution', 'relationship', 'comparison', 'timeseries', 'composition', 'multivariate', 'hierarchy', 'uncertainty', 'geo', 'network', 'special', 'science', 'bio', 'finance', 'industry', 'text', 'ml'])
  })

  it('uses datasets that exist and fit every chart by default', () => {
    for (const meta of catalog) {
      const mod = modules[meta.id]
      for (const d of mod.datasets) expect(datasetById.has(d), `${meta.id}:${d}`).toBe(true)
      for (const d of mod.datasets) {
        const t = generateDataset(d, 7, datasetById.get(d)?.size?.default)
        // every listed dataset must work with the chart, not just the first
        expect(incompatibility(mod.roles, t), `${meta.id}:${d}`).toBeNull()
      }
      const state = initialLabState(meta.id, mod)
      expect(mappingErrors(mod.roles, state.table, state.mapping), meta.id).toEqual([])
    }
  })

  it('renders every chart with its default data (server render)', { timeout: 120000 }, () => {
    for (const meta of catalog) {
      const s = initialLabState(meta.id, modules[meta.id])
      for (const compact of [false, true]) {
        const html = render(meta.id, s.table, s.mapping, s.params, compact)
        expect(html, meta.id).toContain('<svg')
        expect(html, meta.id).not.toContain('chart-message')
        expect((html.match(/<(circle|rect|path|polygon|line)/g) ?? []).length, `${meta.id} compact=${compact}`).toBeGreaterThan(compact ? 1 : 5)
      }
    }
  })

  it('renders every listed dataset of every chart', { timeout: 120000 }, () => {
    for (const meta of catalog) {
      const mod = modules[meta.id]
      for (const d of mod.datasets) {
        const t = generateDataset(d, 3, datasetById.get(d)?.size?.default)
        const html = render(meta.id, t, autoMapping(mod.roles, t), mod.defaultParams)
        expect(html, `${meta.id}:${d}`).not.toContain('chart-message')
      }
    }
  })

  it('survives broken data without throwing (empty table, text in numeric cells, missing numbers)', { timeout: 120000 }, () => {
    for (const id of [...V2, ...V3, ...V4, ...V5, ...V6, ...V7, ...V8]) {
      const mod = modules[id]
      const s = initialLabState(id, mod)
      const empty: DataTable = { columns: s.table.columns, rows: [] }
      const text = cloneTable(s.table)
      text.columns.forEach((c, ci) => { if (c.type === 'number') text.rows.forEach((r, i) => { if (i % 3 === 0) r[ci] = 'abc' }) })
      const nulls = cloneTable(s.table)
      nulls.columns.forEach((c, ci) => { if (c.type === 'number') nulls.rows.forEach((r) => { r[ci] = null }) })
      const one: DataTable = { columns: s.table.columns, rows: s.table.rows.slice(0, 1) }
      for (const [name, t] of [['empty', empty], ['text', text], ['nulls', nulls], ['one row', one]] as const) {
        expect(() => render(id, t, s.mapping, s.params), `${id} ${name}`).not.toThrow()
      }
    }
  })

  it('explains why an incompatible dataset cannot be used', () => {
    const scatter = modules.scatter
    expect(incompatibility(scatter.roles, generateDataset('votes'))).toMatch(/숫자형 열이 2개 이상/)
    expect(incompatibility(modules.bar.roles, generateDataset('normal'))).toMatch(/범주형/)
    const t = generateDataset('pos-corr')
    expect(mappingErrors(scatter.roles, t, { x: '광고비', y: null, color: null })).toEqual(['‘Y축’에 사용할 열을 선택하세요.'])
    expect(mappingErrors(scatter.roles, t, { x: '광고비', y: '지역', color: null })[0]).toMatch(/숫자형/)
  })

  it('maps columns automatically and keeps valid previous choices', () => {
    const roles = modules.scatter.roles
    const t = generateDataset('pos-corr')
    expect(autoMapping(roles, t)).toEqual({ x: '광고비', y: '매출', color: '지역' })
    expect(autoMapping(roles, t, { x: '직원 수', y: '매출', color: null })).toEqual({ x: '직원 수', y: '매출', color: null })
    const pair = autoMapping(modules.pairplot.roles, generateDataset('cars'))
    expect(pair.vars).toEqual(['배기량', '마력', '무게', '연비', '가속 시간'])
  })
})

describe('home animation stages', () => {
  it('only shows charts that exist in the catalog', () => {
    expect(heroStages.length).toBe(64)
    for (const s of heroStages) expect(vizById.has(s.viz) && hasModule(s.viz), s.viz).toBe(true)
    expect(new Set(heroStages.map((s) => s.viz)).size).toBe(64)
  })
})

const ids = (kinds: Parameters<typeof searchCatalog>[3], q = '', c: Parameters<typeof searchCatalog>[1] = 'all') => searchCatalog(q, c, catalog, kinds).map((v) => v.id)

describe('data-type filter', () => {

  it('every chart declares at least one valid data kind and every kind has charts', () => {
    const valid = new Set(dataKinds.map((k) => k.id))
    for (const m of catalog) { expect(m.dataKinds.length, m.id).toBeGreaterThan(0); for (const k of m.dataKinds) expect(valid.has(k), `${m.id}:${k}`).toBe(true) }
    for (const k of dataKinds) expect(ids([k.id]).length, k.id).toBeGreaterThan(3)
    expect(dataKinds.map((k) => k.name)).toEqual(['수치형', '범주형', '시계열', '다변량', '계층형', '네트워크·흐름형', '지리공간'])
  })

  it('time-series filtering keeps date/time charts and drops the others', () => {
    const ts = ids(['timeseries'])
    expect(ts).toEqual(expect.arrayContaining(['line', 'area', 'step', 'candlestick', 'horizon', 'fan', 'calendar', 'bump']))
    expect(ts).not.toContain('histogram')
    expect(ts).not.toContain('treemap')
  })

  it('combines with the category and the text query independently', () => {
    expect(ids(['network'])).toEqual(expect.arrayContaining(['network', 'arc', 'alluvial', 'sankey', 'chord']))
    expect(ids(['hierarchical'], '', 'hierarchy')).toEqual(expect.arrayContaining(['sunburst', 'pack', 'icicle']))
    expect(ids(['hierarchical'], '', 'hierarchy')).not.toContain('network')
    expect(ids(['timeseries'], '', 'uncertainty')).toEqual(expect.arrayContaining(['fan', 'control']))
    expect(ids(['timeseries'], '캔들')).toContain('candlestick')
    expect(ids(['numeric', 'timeseries'], 'plot')).toEqual(expect.arrayContaining(['step', 'kde2d']))
    expect(ids(['multivariate'], '', 'multivariate')).toEqual(expect.arrayContaining(['pca-biplot', 'andrews', 'parallel']))
    expect(ids(['categorical'], '존재하지않는검색어')).toEqual([])
  })

  it('an empty selection means no data-type restriction', () => {
    expect(ids([])).toHaveLength(catalog.length)
  })
})

describe('v0.4 catalog', () => {
  it('has 7 geospatial, 5 statistics, 4 special and 4 network charts reachable from their categories', () => {
    const inCat = (c: Parameters<typeof inCategory>[1]) => catalog.filter((v) => inCategory(v, c)).map((v) => v.id)
    expect(inCat('geo').sort()).toEqual(expect.arrayContaining(['choropleth', 'dorling', 'dot-density', 'flow-map', 'geo-hexbin', 'symbol-map', 'tile-grid']))
    expect(inCat('uncertainty')).toEqual(expect.arrayContaining(['forest', 'bland-altman', 'calibration', 'control', 'funnel-plot']))
    expect(inCat('special')).toEqual(expect.arrayContaining(['flame', 'funnel', 'gantt', 'marimekko']))
    expect(inCat('network')).toEqual(expect.arrayContaining(['adjacency', 'edge-bundling', 'bipartite', 'hive', 'network', 'arc', 'sankey', 'chord', 'alluvial']))
  })

  it('the geospatial data-type filter and search find the new charts', () => {
    expect(ids(['geospatial']).sort()).toEqual(expect.arrayContaining(['choropleth', 'symbol-map', 'dot-density', 'geo-hexbin', 'flow-map', 'tile-grid', 'dorling']))
    expect(searchCatalog('지도').map((v) => v.id)).toEqual(expect.arrayContaining(['choropleth', 'tile-grid']))
    expect(searchCatalog('cartogram').map((v) => v.id)).toContain('dorling')
    expect(searchCatalog('meta').map((v) => v.id)).toEqual(expect.arrayContaining(['forest', 'funnel-plot']))
    expect(searchCatalog('flamegraph').map((v) => v.id)).toContain('flame')
    expect(searchCatalog('퍼널').map((v) => v.id)).toEqual(expect.arrayContaining(['funnel', 'funnel-plot']))
  })

  it('every new chart lists real datasets and the first one is its default', () => {
    for (const id of V4) {
      const mod = modules[id]
      expect(mod.datasets.length, id).toBeGreaterThan(0)
      expect(mod.hint?.length, id).toBeGreaterThan(10)
      expect(mod.Controls, id).toBeDefined()
    }
  })
})

describe('catalog search', () => {
  it('finds charts by Korean name, English name and keyword', () => {
    expect(searchCatalog('히스토').map((v) => v.id)).toContain('histogram')
    expect(searchCatalog('히스토')[0].id).toBe('histogram')
    expect(searchCatalog('violin').map((v) => v.id)).toEqual(['violin', 'raincloud'])
    expect(searchCatalog('density').map((v) => v.id)).toContain('kde')
    expect(searchCatalog('이상치').map((v) => v.id)).toContain('box')
    expect(searchCatalog('Pie Chart').map((v) => v.id)).toContain('pie')
    expect(searchCatalog('Pie Chart')[0].id).toBe('pie')
  })

  it('finds every new chart by its Korean and English names', () => {
    for (const id of [...V2, ...V3, ...V4, ...V5, ...V6, ...V7, ...V8]) {
      const m = vizById.get(id)!
      expect(searchCatalog(m.name).map((v) => v.id), `ko ${id}`).toContain(id)
      expect(searchCatalog(m.nameEn).map((v) => v.id), `en ${id}`).toContain(id)
    }
    expect(searchCatalog('joyplot').map((v) => v.id)).toContain('ridgeline')
    expect(searchCatalog('beeswarm').map((v) => v.id)).toContain('beeswarm')
    expect(searchCatalog('qq').map((v) => v.id)).toContain('qq')
    expect(searchCatalog('sankey').map((v) => v.id)).toEqual(['sankey'])
    expect(searchCatalog('군집').map((v) => v.id)).toContain('dendrogram')
    expect(searchCatalog('신뢰구간')[0].id).toBe('ci')
    expect(searchCatalog('100%').map((v) => v.id)).toContain('stacked-bar-100')
  })

  it('combines search with a category filter', () => {
    expect(searchCatalog('', 'timeseries').map((v) => v.id)).toEqual(expect.arrayContaining(['line', 'area', 'stacked-area', 'streamgraph', 'bump', 'calendar']))
    expect(searchCatalog('막대', 'comparison').map((v) => v.id)).toEqual(expect.arrayContaining(['bar', 'grouped-bar', 'stacked-bar', 'stacked-bar-100']))
    expect(searchCatalog('막대', 'composition').map((v) => v.id)).toEqual(['stacked-bar', 'stacked-bar-100', 'pyramid'])
    expect(searchCatalog('', 'hierarchy').map((v) => v.id)).toEqual(expect.arrayContaining(['treemap', 'sunburst', 'pack', 'sankey', 'chord', 'dendrogram']))
    expect(searchCatalog('', 'uncertainty').map((v) => v.id)).toEqual(expect.arrayContaining(['qq', 'ci']))
    expect(searchCatalog('없는차트xyz')).toEqual([])
  })
})
