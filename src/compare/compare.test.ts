import { beforeAll, describe, expect, it } from 'vitest'
import { datasetById, generateDataset } from '../data/datasets'
import { cloneTable } from '../data/table'
import { vizById } from '../viz/catalog'
import { loadAllModules } from '../viz/charts'
import type { VizModule } from '../viz/types'
import { compareIssue, MAX_PANES, paneMapping, presets } from './presets'
import { stateForPreset } from './state'

let modules: Record<string, VizModule>
beforeAll(async () => { modules = await loadAllModules() })

const issueFor = (viz: string, table = generateDataset('normal'), remembered = {}) => compareIssue(modules[viz], table, paneMapping(modules[viz], table, remembered))

describe('recommended comparison presets', () => {
  it('has the seven requested combinations of two or three charts', () => {
    expect(presets.map((p) => p.charts)).toEqual([
      ['histogram', 'kde', 'ecdf'], ['box', 'violin', 'raincloud'], ['scatter', 'hexbin', 'kde2d'], ['bar', 'lollipop', 'bullet'],
      ['line', 'area', 'step'], ['treemap', 'sunburst', 'icicle'], ['roc', 'pr'],
    ])
    for (const p of presets) { expect(p.charts.length).toBeLessThanOrEqual(MAX_PANES); expect(p.charts.length).toBeGreaterThanOrEqual(2) }
  })

  it('every chart of a preset can use the preset’s shared dataset directly, with no conversion', () => {
    for (const p of presets) {
      expect(datasetById.has(p.datasetId), p.id).toBe(true)
      const table = generateDataset(p.datasetId, 7, p.n)
      for (const id of p.charts) {
        expect(vizById.has(id), id).toBe(true)
        expect(issueFor(id, table), `${p.id}:${id}`).toBeNull()
      }
    }
  })

  it('builds a state whose charts and shared table match the preset', () => {
    const s = stateForPreset('xy')
    expect(s.panes.map((p) => p.viz)).toEqual(['scatter', 'hexbin', 'kde2d'])
    expect(s.datasetId).toBe('dense')
    expect(s.table.rows.length).toBe(1200)
    expect(new Set(s.panes.map((p) => p.id)).size).toBe(3)
    expect(stateForPreset('nope').presetId).toBe(presets[0].id)
  })
})

describe('data compatibility between a chart and the shared data', () => {
  it('explains structural mismatches in Korean instead of drawing something wrong', () => {
    expect(issueFor('scatter', generateDataset('votes'))).toMatch(/숫자형 열이 2개 이상/)
    expect(issueFor('bar', generateDataset('normal'))).toMatch(/범주형/)
    expect(issueFor('roc', generateDataset('normal'))).toMatch(/2개 이상/)
    expect(issueFor('treemap', generateDataset('votes'))).toBeNull()
    expect(issueFor('candlestick', generateDataset('timeseries'))).toMatch(/열이 \d+개 이상/)
    expect(issueFor('line', generateDataset('votes'))).toMatch(/숫자형·날짜형 열이 2개 이상/)
    expect(issueFor('network', generateDataset('normal'))).toBeTruthy()
  })

  it('the same table suits some charts and not others', () => {
    const t = generateDataset('pos-corr', 3, 60)
    for (const ok of ['scatter', 'histogram', 'kde2d', 'hexbin', 'pca-biplot', 'box']) expect(issueFor(ok, t), ok).toBeNull()
    for (const bad of ['candlestick', 'alluvial', 'step-nope']) if (modules[bad]) expect(issueFor(bad, t), bad).toBeTruthy()
  })

  it('reports required columns that contain only missing values', () => {
    const t = cloneTable(generateDataset('pos-corr', 3, 30))
    const yi = t.columns.findIndex((c) => c.name === '매출')
    t.rows.forEach((r) => { r[yi] = null })
    expect(issueFor('scatter', t, { x: '광고비', y: '매출', color: null })).toMatch(/‘매출’.*결측값/)
    expect(issueFor('histogram', t)).toBeNull()
  })

  it('keeps a pane’s own column choice while the other charts keep theirs', () => {
    const t = generateDataset('pos-corr', 3, 30)
    const a = paneMapping(modules.scatter, t, { x: '직원 수', y: '매출', color: null })
    const b = paneMapping(modules.scatter, t)
    expect(a.x).toBe('직원 수')
    expect(b.x).toBe('광고비')
  })

  it('a choice that stops being valid after the data changes falls back to automatic mapping', () => {
    const next = generateDataset('cars', 3, 30)
    const m = paneMapping(modules.scatter, next, { x: '광고비', y: '매출', color: null })
    expect(m.x).toBe('배기량')
  })
})
