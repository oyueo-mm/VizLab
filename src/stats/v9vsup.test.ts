import { describe, expect, it } from 'vitest'
import { percentileRanker, vsupBins, vsupCell, vsupColor, vsupValue } from './vsup'

describe('VSUP', () => {
  const ramp = (t: number) => `rgb(${Math.round(255 * (1 - t))},${Math.round(120 * t)},${Math.round(255 * t)})`
  it('the number of value bins halves with every uncertainty level down to one', () => {
    expect([0, 1, 2, 3].map((l) => vsupBins(4, l))).toEqual([8, 4, 2, 1])
    expect([0, 1].map((l) => vsupBins(2, l))).toEqual([2, 1])
  })
  it('uncertain values that fall in the same merged bin get the same colour, certain ones stay distinguishable', () => {
    const a = vsupCell(0.1, 0.0, 4), b = vsupCell(0.2, 0.0, 4)
    expect(vsupColor(ramp, a, 4)).not.toBe(vsupColor(ramp, b, 4))
    const c = vsupCell(0.1, 0.95, 4), d = vsupCell(0.9, 0.95, 4)
    expect(c.bins).toBe(1)
    expect(vsupColor(ramp, c, 4)).toBe(vsupColor(ramp, d, 4))
  })
  it('a merged bin stands for the middle of the values it covers, and the cell index is monotone in value', () => {
    expect(vsupValue(vsupCell(0.0, 0.3, 4))).toBeCloseTo(0.125, 6) // level 1 of 4: 4 bins, first one
    let prev = -1
    for (let t = 0; t <= 1; t += 0.05) { const c = vsupCell(t, 0.1, 4); expect(c.bin).toBeGreaterThanOrEqual(prev); prev = c.bin }
    expect(vsupCell(1, 0, 4).bin).toBe(7)
    expect(vsupCell(1, 1, 4).level).toBe(3)
  })
  it('percentile ranks span 0…1 and are monotone', () => {
    const r = percentileRanker([5, 1, 9, 3, 7])
    expect(r(1)).toBe(0); expect(r(9)).toBe(1); expect(r(5)).toBeCloseTo(0.5, 6)
    expect(r(2)).toBeLessThanOrEqual(r(6))
  })
})
