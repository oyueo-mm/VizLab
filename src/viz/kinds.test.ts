import { describe, expect, it } from 'vitest'
import { catalog, searchCatalog, vizById } from './catalog'
import { content } from '../content'
import { kindDefs, kindOf, kindTotals, kindsAlsoOf, techniqueResultLinks } from './kinds'
import { legacyIds } from './legacyIds'
import { parseHash, routeHref } from '../router'

describe('v0.7 classification', () => {
  it('keeps all 250 legacy ids with their content and category', () => {
    expect(legacyIds.length).toBe(250)
    expect(new Set(legacyIds).size).toBe(250)
    for (const id of legacyIds) {
      expect(vizById.has(id), id).toBe(true)
      expect(content[id], id).toBeTruthy()
    }
    for (const id of ['mandelbrot-set', 'julia-set', 'newton-fractal', 'tsne', 'umap', 'kriging-map']) expect(vizById.has(id), id).toBe(true)
  })

  it('gives every entry exactly one main kind and the totals add up', () => {
    const totals = kindTotals(catalog)
    expect(Object.values(totals).reduce((a, b) => a + b, 0)).toBe(catalog.length)
    for (const m of catalog) expect(kindDefs.some((k) => k.id === kindOf(m.id)), m.id).toBe(true)
    // secondary kinds never repeat the main kind
    for (const m of catalog) expect(kindsAlsoOf(m.id).includes(kindOf(m.id)), m.id).toBe(false)
  })

  it('classifies result-oriented entries as analysis, not as techniques', () => {
    for (const id of ['mandelbrot-set', 'julia-set', 'newton-fractal', 'tsne', 'umap', 'kriging-map']) expect(kindOf(id), id).toBe('analysis')
    expect(kindOf('scatter')).toBe('technique')
    expect(kindOf('roc')).toBe('specialized')
  })

  it('filters by kind independently of the category and the text query', () => {
    const tech = searchCatalog('', 'all', catalog, [], undefined, 'technique')
    expect(tech.length).toBeGreaterThan(50)
    expect(tech.every((m) => kindOf(m.id) === 'technique' || kindsAlsoOf(m.id).includes('technique'))).toBe(true)
    const geoTech = searchCatalog('', 'geo', catalog, [], undefined, 'technique')
    expect(geoTech.length).toBeGreaterThan(0)
    expect(geoTech.length).toBeLessThan(searchCatalog('', 'geo').length)
    expect(geoTech.every((m) => m.category === 'geo' || m.alsoIn?.includes('geo'))).toBe(true)
    const q = searchCatalog('산점도', 'all', catalog, [], undefined, 'analysis')
    expect(q.every((m) => kindOf(m.id) === 'analysis' || kindsAlsoOf(m.id).includes('analysis'))).toBe(true)
    expect(searchCatalog('', 'all', catalog, [], undefined, '').length).toBe(catalog.length)
  })

  it('links techniques and results in both directions', () => {
    for (const [t, results] of techniqueResultLinks) {
      for (const r of results) {
        expect(vizById.get(t)!.related, `${t}->${r}`).toContain(r)
        expect(vizById.get(r)!.related, `${r}->${t}`).toContain(t)
      }
    }
  })

  it('keeps the kind in the URL', () => {
    const route = { page: 'catalog', category: 'geo', kind: 'technique' } as const
    expect(routeHref(route)).toBe('#/catalog/geo?k=technique')
    expect(parseHash('#/catalog/geo?k=technique')).toEqual(route)
    expect(parseHash('#/catalog/geo?k=bogus')).toEqual({ page: 'catalog', category: 'geo' })
    expect(parseHash('#/catalog')).toEqual({ page: 'catalog', category: 'all' })
  })
})
