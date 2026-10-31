import katex from 'katex'
import { describe, expect, it } from 'vitest'
import { catalog } from '../viz/catalog'
import { content } from './index'
import { contentV3 } from './v3'

describe('explanations', () => {
  it('every chart has complete content and its formulas are valid KaTeX', () => {
    for (const meta of catalog) {
      const c = content[meta.id]
      expect(c, meta.id).toBeDefined()
      for (const f of c.math) {
        expect(() => katex.renderToString(f.tex, { displayMode: true, throwOnError: true, strict: 'ignore' }), `${meta.id}: ${f.tex}`).not.toThrow()
        expect(f.caption.length, meta.id).toBeGreaterThanOrEqual(4)
      }
    }
  })

  it('the 20 new charts explain the points readers most often get wrong', () => {
    expect(Object.keys(contentV3)).toHaveLength(20)
    const text = (id: string) => JSON.stringify(contentV3[id])
    expect(text('pp')).toContain('Q-Q')
    expect(text('pca-biplot')).toContain('화살표')
    expect(text('pca-biplot')).toContain('배율')
    expect(text('alluvial')).toContain('생키')
    expect(text('pr')).toContain('Average Precision')
    expect(text('pr')).toMatch(/사다리꼴/)
    expect(text('fan')).toContain('신뢰구간')
    expect(text('fan')).toContain('예측구간')
    expect(text('candlestick')).toContain('합성')
    expect(text('horizon')).toContain('층')
    expect(text('network')).toContain('d3-force')
    for (const [id, c] of Object.entries(contentV3)) {
      expect(c.pros.length, id).toBeGreaterThanOrEqual(2)
      expect(c.cons.length, id).toBeGreaterThanOrEqual(2)
      expect(c.cautions.length, id).toBeGreaterThanOrEqual(2)
      expect(c.howItWorks.length, id).toBeGreaterThanOrEqual(3)
    }
  })
})
