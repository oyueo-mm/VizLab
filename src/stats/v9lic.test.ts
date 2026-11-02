import { describe, expect, it } from 'vitest'
import { fieldAt, lic, licFast, neighbourContrast, whiteNoise, type FlowSource } from './sci7'
import { computeLic, previewRequest } from './licJob'

const sources: FlowSource[] = [{ kind: '소용돌이', x: 0.35, y: 0.5, strength: 1, radius: 0.12 }, { kind: '흡입', x: 0.75, y: 0.4, strength: 0.6, radius: 0.1 }]

describe('LIC speed-up keeps the meaning', () => {
  const w = 120, h = 120
  const noise = whiteNoise(w, h, 4)
  const field = (px: number, py: number): [number, number] => { const [u, v] = fieldAt(sources, px / w, 1 - py / h); return [u, -v] }
  const a = lic(field, noise, w, h, 12), b = licFast(field, noise, w, h, 12)
  it('the fast image correlates strongly with the reference image', () => {
    const mean = (x: Float32Array) => x.reduce((s, v) => s + v, 0) / x.length
    const ma = mean(a), mb = mean(b)
    let sab = 0, saa = 0, sbb = 0
    for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2 }
    expect(sab / Math.sqrt(saa * sbb)).toBeGreaterThan(0.85)
  })
  it('a uniform horizontal flow gives streaks along x for both versions', () => {
    const uni = (): [number, number] => [1, 0]
    for (const f of [lic, licFast]) {
      const img = f(uni, noise, w, h, 12)
      const c = neighbourContrast(img, w, h)
      expect(c.alongX).toBeLessThan(c.alongY * 0.5)
    }
  })
  it('the job returns an image of the requested size and the preview is smaller', () => {
    const req = { sources, res: 150, length: 10, seed: 3 }
    const r = computeLic(req)
    expect(r.texture.length).toBe(150 * 150); expect(r.speed.length).toBe(150 * 150); expect(r.maxSp).toBeGreaterThan(0)
    expect(previewRequest(req).res).toBe(50)
  })
})
