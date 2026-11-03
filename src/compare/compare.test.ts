import { beforeAll, describe, expect, it } from 'vitest'
import { datasetById, generateDataset } from '../data/datasets'
import { cloneTable } from '../data/table'
import { vizById } from '../viz/catalog'
import { loadAllModules } from '../viz/charts'
import type { VizModule } from '../viz/types'
import { incompatibilityFromSlots } from '../viz/mapping'
import { needs } from '../viz/needs'
import { compareIssue, MAX_PANES, paneMapping, presets } from './presets'
import { stateForPreset } from './state'

let modules: Record<string, VizModule>
beforeAll(async () => { modules = await loadAllModules() })

const issueFor = (viz: string, table = generateDataset('normal'), remembered = {}) => compareIssue(modules[viz], table, paneMapping(modules[viz], table, remembered))

describe('recommended comparison presets', () => {
  it('has the v0.3 combinations the v0.4 geo, agreement, calibration, network and mosaic ones, ten v0.5 ones, nine v0.6 ones and seven v0.7 ones and nine v0.8 ones and eight v1.0 ones and eleven v1.1 ones', () => {
    expect(presets.map((p) => p.charts)).toEqual([
      ['histogram', 'kde', 'ecdf'], ['box', 'violin', 'raincloud'], ['scatter', 'hexbin', 'kde2d'], ['bar', 'lollipop', 'bullet'],
      ['line', 'area', 'step'], ['treemap', 'sunburst', 'icicle'], ['roc', 'pr'],
      ['roc', 'pr', 'calibration'], ['choropleth', 'symbol-map', 'bar'], ['choropleth', 'tile-grid', 'dorling'], ['scatter', 'bland-altman'],
      ['network', 'adjacency'], ['network', 'bipartite'], ['mosaic', 'marimekko'],
      // v0.5
      ['hillshade', 'slope-aspect', 'isoline'], ['vector-field', 'streamline', 'particle-flow'], ['choropleth', 'cartogram-contiguous', 'demers'],
      ['residual-plot', 'scale-location', 'influence-plot'], ['kaplan-meier', 'nelson-aalen'], ['candlestick', 'heikin-ashi', 'renko'],
      ['spectrogram', 'scalogram', 'recurrence-plot'], ['volcano', 'ma-plot'], ['venn', 'upset', 'hypergraph'], ['pcoa', 'phylogenetic-tree'],
      // v0.6
      ['tsne', 'umap'], ['acf-plot', 'pacf-plot', 'lag-plot'], ['stl', 'seasonal-subseries'], ['efficient-frontier', 'risk-return-scatter', 'risk-contribution'],
      ['community-blockmodel', 'spectral-embedding', 'adjacency'], ['dag-layout', 'max-flow'], ['collocation-matrix', 'lexical-dispersion', 'zipf-plot'], ['contact-map', 'ramachandran'],
      ['permutation-importance', 'ice-plot', 'ale-plot'],
      // v0.7
      ['scatter', 'radviz', 'star-coordinates'], ['pca-biplot', 'grand-tour'], ['parallel', 'dimensional-stacking', 'table-lens'], ['histogram', 'quantile-dotplot', 'wilkinson-dotplot'],
      ['ci', 'hops', 'gradient-plot'], ['venn', 'upset', 'linear-set-diagram'], ['treemap', 'voronoi-treemap', 'hyperbolic-tree'],
      // v0.8
      ['bubble-sets', 'linesets', 'kelp-diagram'], ['venn', 'upset', 'radial-sets'], ['linear-set-diagram', 'rainbow-boxes', 'radial-sets'], ['network', 'nodetrix', 'biofabric'],
      ['power-graph', 'confluent-drawing', 'nodetrix'], ['semantic-substrates', 'pivot-graph', 'adjacency'], ['vector-field-3d', 'stream-surface', 'streamtube'],
      ['treemap', 'hyperbolic-tree', 'cone-tree'], ['word-cloud', 'parallel-tag-clouds', 'textarc'],
      // v0.9
      ['metrosets', 'mosaicsets', 'rainbow-boxes'], ['setnet', 'metrosets', 'mosaicsets'], ['venn', 'upset', 'infocrystal'], ['lifeflow', 'sequence-braiding'], ['radviz', 'star-coordinates', 'dust-magnet'],
      ['treemap', 'voronoi-treemap', 'gosper-map'], ['ibfv', 'vector-field-topology'], ['tensor-glyph', 'hyperstreamlines'], ['od-maps', 'maptrix'], ['isosurface', 'fiber-surfaces'],
      // v1.0
      ['scatter', 'bagplot', 'kde2d'], ['scatter', 'splatterplot', 'hexbin'], ['stem-and-leaf', 'histogram', 'box'], ['lorenz-curve', 'ecdf', 'histogram'],
      ['contour-tree', 'persistence-diagram', 'topological-landscape'], ['spacetree', 'hyperbolic-tree', 'treemap'], ['decision-curve', 'roc', 'calibration'], ['hanging-rootogram', 'histogram'],
      // v1.1
      ['matrix-cube', 'parallel-edge-splatting'], ['pythagoras-tree', 'treemap', 'spacetree'], ['hinton-diagram', 'heatmap'], ['continuous-scatterplot', 'continuous-parallel-coordinates'], ['spot-noise', 'ibfv', 'vector-field-topology'],
      ['stream-ribbons', 'streamtube', 'stream-surface'], ['taylor-diagram', 'target-diagram', 'scatter'], ['piper-diagram', 'stiff-diagram'], ['rectangular-cartogram', 'cartogram-contiguous', 'tile-grid'], ['ring-map', 'choropleth'], ['hasse-diagram', 'dag-layout'],
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

  it('geo charts keep the region id ↔ value mapping, so a map and an ordinary chart read the same rows', () => {
    const t = generateDataset('kr-regions', 7)
    const map = paneMapping(modules.choropleth, t)
    const tile = paneMapping(modules['tile-grid'], t)
    const bar = paneMapping(modules.bar, t)
    expect(map.region).toBe('ID')
    expect(tile.region).toBe(map.region)
    expect(map.value).toBe(tile.value)
    expect(bar.value).toBe(map.value)
    // a map cannot be drawn from a table that has no category column for the region id
    expect(issueFor('choropleth', generateDataset('normal'))).toMatch(/범주형/)
    expect(issueFor('choropleth', t)).toBeNull()
  })

  it('judges compatibility of every chart before its module is loaded (static slots)', () => {
    const t = generateDataset('votes')
    for (const id of ['scatter', 'bland-altman', 'calibration', 'gantt', 'adjacency']) expect(incompatibilityFromSlots(needs[id], t), id).toBeTruthy()
    expect(incompatibilityFromSlots(needs.bar, t)).toBeNull()
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
