import { describe, expect, it } from 'vitest'
import { catalog } from './catalog'
import { encodingById, encodingDefs, encodingsOf, hasEncoding } from './encodings'

describe('encoding principles', () => {
  it('assigns a main principle to every catalog entry exactly once', () => {
    const missing = catalog.filter((m) => !encodingById.has(encodingsOf(m.id).main) || encodingsOf(m.id).main === 'composite' && !['raincloud', 'joint-distribution', 'shap-summary', 'flowstrates'].includes(m.id))
    expect(missing.map((m) => m.id)).toEqual([])
  })
  it('secondary principles differ from the main one and are known', () => {
    for (const m of catalog) {
      const { main, also } = encodingsOf(m.id)
      expect(also).not.toContain(main)
      for (const e of also) expect(encodingById.has(e)).toBe(true)
    }
  })
  it('every principle has at least one entry and the filter sees main and secondary', () => {
    for (const d of encodingDefs) expect(catalog.some((m) => hasEncoding(m, d.id))).toBe(true)
    expect(hasEncoding({ id: 'treemap' }, 'partition')).toBe(true)
    expect(hasEncoding({ id: 'treemap' }, 'area')).toBe(true)
    expect(hasEncoding({ id: 'treemap' }, 'flow')).toBe(false)
  })
})
