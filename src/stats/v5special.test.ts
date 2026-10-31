import { describe, expect, it } from 'vitest'
import { cumulativeFlow, lexisTable, psth, spiralPoint } from './special'

describe('event raster PSTH', () => {
  it('counts events per bin and converts to a rate per trial per unit time', () => {
    const ev = [{ trial: 'a', t: 1 }, { trial: 'a', t: 1.5 }, { trial: 'b', t: 1.2 }, { trial: 'b', t: 9 }, { trial: 'c', t: 20 }]
    const h = psth(ev, 3, 0, 10, 2)
    expect(h.map((b) => b.count)).toEqual([3, 0, 0, 0, 1])
    expect(h[0].rate).toBeCloseTo(3 / 3 / 2, 12)
    expect(h.reduce((s, b) => s + b.count, 0)).toBe(4) // the event at t = 20 is outside the window
  })
})

describe('Lexis tabulation', () => {
  it('splits person-time along the 45° lifeline and conserves total exposure', () => {
    const lines = [{ id: 0, start: 1990.5, end: 1998.25, event: true, row: 0 }, { id: 1, start: 1992, end: 2000, event: false, row: 1 }]
    const cells = lexisTable(lines, 5)
    expect(cells.reduce((s, c) => s + c.exposure, 0)).toBeCloseTo(7.75 + 8, 9)
    expect(cells.reduce((s, c) => s + c.events, 0)).toBe(1)
    // the first lifeline starts mid-period: 1990.5–1995 in the 1990–1995 period at ages 0–4.5, then 1995–1998.25 in the next period at ages 4.5–7.75
    const first = cells.find((c) => c.period === 1990 && c.age === 0)!
    expect(first.exposure).toBeGreaterThan(4)
    const eventCell = cells.find((c) => c.events === 1)!
    expect(eventCell.period).toBe(1995)
    expect(eventCell.age).toBe(5)
  })
})

describe('cumulative flow', () => {
  it('accumulates arrivals per stage by date, keeps the lines ordered and never lets a later stage exceed an earlier one', () => {
    const rows = [
      { t: 1, stage: 0, n: 5 }, { t: 1, stage: 1, n: 2 }, { t: 2, stage: 0, n: 3 }, { t: 2, stage: 1, n: 4 }, { t: 2, stage: 2, n: 1 }, { t: 3, stage: 2, n: 9 },
    ]
    const f = cumulativeFlow(rows, 3)
    expect(f.map((p) => p.cum[0])).toEqual([5, 8, 8])
    expect(f[1].cum).toEqual([8, 6, 1])
    expect(f[2].cum[2]).toBeLessThanOrEqual(f[2].cum[1])
    for (const p of f) for (let s = 1; s < 3; s++) expect(p.cum[s]).toBeLessThanOrEqual(p.cum[s - 1])
    for (let s = 0; s < 3; s++) f.slice(1).forEach((p, i) => expect(p.cum[s]).toBeGreaterThanOrEqual(f[i].cum[s]))
  })
})

describe('spiral layout', () => {
  it('advances one full turn per period with the radius growing by the pitch', () => {
    const a = spiralPoint(0, 0, 7, 20, 10), b = spiralPoint(7, 0, 7, 20, 10), c = spiralPoint(3.5, 0, 7, 20, 10)
    expect(a.angle).toBeCloseTo(0, 12)
    expect(b.angle).toBeCloseTo(0, 9)
    expect(b.r - a.r).toBeCloseTo(10, 12)
    expect(c.angle).toBeCloseTo(Math.PI, 12)
    expect(spiralPoint(14, 0, 7, 20, 10).turns).toBeCloseTo(2, 12)
  })
})
