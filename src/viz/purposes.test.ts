import { describe, expect, it } from 'vitest'
import { catalog, searchCatalog, vizById } from './catalog'
import { abbreviations, purposes } from './purposes'

describe('search by analysis purpose and abbreviation', () => {
  it('only refers to charts that exist', () => {
    for (const p of purposes) for (const id of p.ids) expect(vizById.has(id), `${p.label}: ${id}`).toBe(true)
    for (const id of Object.keys(abbreviations)) expect(vizById.has(id), id).toBe(true)
  })

  it('finds charts by the question being asked', () => {
    const ids = (q: string) => searchCatalog(q).map((m) => m.id)
    expect(ids('병목')).toEqual(expect.arrayContaining(['max-flow', 'process-map', 'queue-simulation']))
    expect(ids('이상치')).toContain('box')
    expect(ids('군집')).toEqual(expect.arrayContaining(['tsne', 'community-blockmodel']))
    expect(ids('모델 해석')).toContain('shap-summary')
    expect(ids('주기')).toContain('stl')
  })

  it('finds charts by abbreviation, case-insensitively', () => {
    const ids = (q: string) => searchCatalog(q).map((m) => m.id)
    expect(ids('GSEA')).toContain('gsea-running-sum')
    expect(ids('pmi')).toContain('collocation-matrix')
    expect(ids('CVaR')).toContain('var-es-distribution')
    expect(ids('LISA')).toContain('moran-scatterplot')
  })

  it('does not make unrelated queries match everything', () => {
    expect(searchCatalog('병목').length).toBeLessThan(15)
    expect(catalog.length).toBeGreaterThanOrEqual(250)
  })
})
