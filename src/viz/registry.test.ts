import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { content } from '../content'
import { datasetById, generateDataset } from '../data/datasets'
import { initialLabState } from '../lab/state'
import { catalog, categories, categoryById, searchCatalog, vizById } from './catalog'
import { modules } from './charts'
import { autoMapping, incompatibility, mappingErrors } from './mapping'

describe('visualization registry', () => {
  it('lists the 20 v0.1 charts, each with an implementation and content', () => {
    expect(catalog.length).toBe(20)
    expect(new Set(catalog.map((c) => c.id)).size).toBe(catalog.length)
    for (const meta of catalog) {
      expect(modules[meta.id], meta.id).toBeDefined()
      const c = content[meta.id]
      expect(c, meta.id).toBeDefined()
      for (const key of ['suitable', 'howItWorks', 'math', 'pros', 'cons', 'cautions'] as const) expect(c[key].length, `${meta.id}.${key}`).toBeGreaterThan(0)
      expect(categoryById.has(meta.category)).toBe(true)
      for (const r of meta.related) expect(vizById.has(r), `${meta.id} → ${r}`).toBe(true)
    }
  })

  it('uses datasets that exist and fit every chart by default', () => {
    for (const meta of catalog) {
      const mod = modules[meta.id]
      for (const d of mod.datasets) expect(datasetById.has(d), `${meta.id}:${d}`).toBe(true)
      const state = initialLabState(meta.id)
      expect(incompatibility(mod.roles, state.table), meta.id).toBeNull()
      expect(mappingErrors(mod.roles, state.table, state.mapping), meta.id).toEqual([])
    }
  })

  it('renders every chart with its default data (server render)', () => {
    for (const meta of catalog) {
      const mod = modules[meta.id]
      const s = initialLabState(meta.id)
      for (const compact of [false, true]) {
        const html = renderToStaticMarkup(createElement(mod.Chart, { table: s.table, mapping: s.mapping, params: s.params, setParams: () => {}, width: 640, height: 420, compact }))
        expect(html, meta.id).toContain('<svg')
        expect(html, meta.id).not.toContain('chart-message')
        // every chart draws data marks (thumbnails omit axes, rugs and labels)
        expect((html.match(/<(circle|rect|path|polygon|line)/g) ?? []).length, meta.id).toBeGreaterThan(compact ? 1 : 5)
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

describe('catalog search', () => {
  it('finds charts by Korean name, English name and keyword', () => {
    expect(searchCatalog('히스토').map((v) => v.id)).toEqual(['histogram'])
    expect(searchCatalog('violin').map((v) => v.id)).toEqual(['violin'])
    expect(searchCatalog('density').map((v) => v.id)).toContain('kde')
    expect(searchCatalog('이상치').map((v) => v.id)).toContain('box')
    expect(searchCatalog('Pie Chart').map((v) => v.id)).toEqual(['pie'])
  })

  it('combines search with a category filter', () => {
    expect(searchCatalog('', 'timeseries').map((v) => v.id)).toEqual(['line', 'area'])
    expect(searchCatalog('막대', 'comparison').map((v) => v.id)).toEqual(['bar', 'grouped-bar', 'stacked-bar'])
    expect(searchCatalog('막대', 'composition').map((v) => v.id)).toEqual(['stacked-bar'])
    expect(searchCatalog('없는차트xyz')).toEqual([])
    expect(searchCatalog('', 'other')).toEqual([])
  })

  it('covers every category id', () => {
    expect(categories.map((c) => c.id)).toEqual(['distribution', 'relationship', 'comparison', 'timeseries', 'composition', 'multivariate', 'other'])
  })
})
