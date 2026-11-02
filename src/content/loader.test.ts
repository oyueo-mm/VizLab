import { describe, expect, it } from 'vitest'
import { catalog } from '../viz/catalog'
import { content } from './index'
import { contentGroupOf, loadContent } from './loader'

describe('lazy explanation loading', () => {
  it('loads the same explanation as the merged object for every chart', async () => {
    for (const meta of catalog) expect(await loadContent(meta.id), meta.id).toEqual(content[meta.id])
  })
  it('assigns charts to the version group that introduced them', () => {
    expect(contentGroupOf('scatter')).toBe('legacy')
    expect(contentGroupOf('hyperbolic-tree')).toBe('v7')
    expect(contentGroupOf('bubble-sets')).toBe('v8')
    expect(contentGroupOf('lifeflow')).toBe('v8')
    expect(contentGroupOf('metrosets')).toBe('v9')
    expect(new Set(catalog.map((m) => contentGroupOf(m.id)))).toEqual(new Set(['legacy', 'v5', 'v6', 'v7', 'v8', 'v9']))
  })
  it('keeps the concept notes of computed results', async () => {
    expect((await loadContent('mandelbrot-set'))?.note).toContain('분석·계산 결과')
  })
  it('returns undefined for an unknown chart', async () => {
    expect(await loadContent('no-such-chart')).toBeUndefined()
  })
})
