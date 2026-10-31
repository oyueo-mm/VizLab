import { describe, expect, it } from 'vitest'
import { averageTrueRange, drawdown, heikinAshi, kagi, lineBreak, marketImpact, nelsonSiegel, orderBookDepth, pointAndFigure, renko, volumeProfile } from './finance'
import type { Candle } from './ohlc'

const px = (cs: number[]) => cs.map((c, i) => ({ t: i, c }))
const candle = (t: number, o: number, h: number, l: number, c: number, v: number | null = null): Candle => ({ t, o, h, l, c, v, row: t })

describe('Renko', () => {
  it('forms the first brick one full brick away from the starting level and ignores smaller moves', () => {
    const b = renko(px([100, 101, 105, 109, 108, 106, 104, 103]), 4)
    expect(b.map((x) => [x.open, x.close, x.up])).toEqual([[100, 104, true], [104, 108, true]])
    expect(renko(px([100, 101, 102, 103.9]), 4)).toEqual([])
  })
  it('a steady rise gives consecutive up bricks of exactly the brick size, each brick starting where the last one ended', () => {
    const b = renko(px([100, 103, 107, 112, 120]), 5)
    expect(b.every((x) => x.up)).toBe(true)
    b.forEach((x, i) => { expect(x.close - x.open).toBe(5); if (i) expect(x.open).toBe(b[i - 1].close) })
    expect(b[b.length - 1].close).toBeLessThanOrEqual(120)
    expect(b[b.length - 1].close + 5).toBeGreaterThan(120)
  })
  it('a reversal draws a down brick opening at the last brick\'s open, never at its close', () => {
    const b = renko(px([100, 112, 99]), 5)
    const downs = b.filter((x) => !x.up)
    expect(downs.length).toBeGreaterThan(0)
    const lastUp = [...b].reverse().find((x) => x.up)!
    expect(downs[0].open).toBe(lastUp.open)
    expect(downs[0].close).toBe(lastUp.open - 5)
  })
  it('ATR of constant-range candles is that range', () => {
    const cs = Array.from({ length: 6 }, (_, i) => candle(i, 10, 12, 10, 11))
    expect(averageTrueRange(cs)).toBeCloseTo(2, 9)
  })
})

describe('Heikin-Ashi', () => {
  it('follows the textbook recursion', () => {
    const ha = heikinAshi([candle(0, 10, 12, 9, 11), candle(1, 11, 14, 10, 13)])
    expect(ha[0].c).toBeCloseTo((10 + 12 + 9 + 11) / 4, 12)
    expect(ha[0].o).toBeCloseTo((10 + 11) / 2, 12)
    expect(ha[1].o).toBeCloseTo((ha[0].o + ha[0].c) / 2, 12)
    expect(ha[1].c).toBeCloseTo((11 + 14 + 10 + 13) / 4, 12)
    expect(ha[1].h).toBeCloseTo(Math.max(14, ha[1].o, ha[1].c), 12)
    expect(ha[1].l).toBeCloseTo(Math.min(10, ha[1].o, ha[1].c), 12)
  })
  it('a steady uptrend gives candles that never open above their close', () => {
    const cs = Array.from({ length: 30 }, (_, i) => candle(i, 100 + i, 102 + i, 99 + i, 101.5 + i))
    const ha = heikinAshi(cs)
    for (const k of ha.slice(3)) expect(k.c).toBeGreaterThanOrEqual(k.o)
  })
})

describe('Kagi, Point & Figure, Three-Line Break', () => {
  it('a Kagi line only reverses after the reversal amount and every segment connects to the previous one', () => {
    const k = kagi(px([100, 104, 108, 106, 103, 104, 110]), 5)
    expect(k.length).toBeGreaterThanOrEqual(3)
    k.slice(1).forEach((s, i) => expect(s.from).toBe(k[i].to))
    // from the 108 high a fall of at least 5 is needed: 106 does not reverse, 103 does
    expect(k[0].to).toBe(108)
    expect(k[0].up).toBe(true)
    expect(k[1].up).toBe(false)
  })
  it('Point & Figure columns alternate, grow by whole boxes and reverse only after the reversal distance', () => {
    const cols = pointAndFigure(px([100, 101, 104, 108, 112, 109, 105, 100, 96, 99, 106]), 2, 3)
    expect(cols.length).toBeGreaterThanOrEqual(3)
    cols.slice(1).forEach((c, i) => expect(c.dir).not.toBe(cols[i].dir))
    // first X column from 100 up to 112 = 7 boxes of 2 (100, 102, …, 112)
    expect(cols[0].dir).toBe('X')
    expect(cols[0].low).toBe(100)
    expect(cols[0].boxes).toBe(7)
    // the 109 close is only 1.5 boxes below 112, so it does not reverse; 105 (3.5 boxes) does
    expect(cols[1].dir).toBe('O')
    expect(cols[1].low).toBeLessThan(106)
  })
  it('Three-Line Break extends on a new extreme and reverses only through the extreme of the last three lines', () => {
    const l = lineBreak(px([10, 11, 12, 13, 12.5, 11.5, 14, 9]), 3)
    expect(l[0]).toMatchObject({ open: 10, close: 11, up: true })
    expect(l.slice(0, 3).every((x) => x.up)).toBe(true)
    // 12.5 and 11.5 are above the low (10) of the last three lines: no reversal; only the close at 9 breaks it
    expect(l.filter((x) => !x.up)).toHaveLength(1)
    expect(l[l.length - 1].close).toBe(9)
    expect(l[l.length - 1].open).toBe(l[l.length - 2].open)
  })
})

describe('volume profile, drawdown, yield curve, order book', () => {
  it('volume profile conserves volume, puts the POC where most volume traded and the value area holds ≥ 70%', () => {
    const cs = [candle(0, 10, 12, 10, 11, 100), candle(1, 11, 12, 11, 11.5, 300), candle(2, 11.5, 14, 11, 13, 100)]
    const vp = volumeProfile(cs, 8)
    expect(vp.total).toBeCloseTo(500, 9)
    expect(vp.bins.reduce((s, b) => s + b.volume, 0)).toBeCloseTo(500, 9)
    const [a, z] = vp.valueArea
    expect(vp.bins.slice(a, z + 1).reduce((s, b) => s + b.volume, 0)).toBeGreaterThanOrEqual(0.7 * 500 - 1e-9)
    expect(vp.bins[vp.poc].lo).toBeGreaterThanOrEqual(11 - 1e-9)
    expect(vp.bins[vp.poc].hi).toBeLessThanOrEqual(12.3)
  })
  it('drawdown: 100 → 120 → 90 → 130 has a maximum drawdown of −25% and recovers', () => {
    const d = drawdown([100, 120, 90, 110, 130])
    expect(d.maxDd).toBeCloseTo(90 / 120 - 1, 12)
    expect(d.maxIndex).toBe(2)
    expect(d.peakIndex).toBe(1)
    expect(d.longest).toBe(2)
    expect(d.recovered).toBe(true)
    expect(d.dd[1]).toBe(0)
    expect(drawdown([5, 4, 3]).recovered).toBe(false)
  })
  it('Nelson–Siegel recovers a curve generated by its own formula', () => {
    const tau = [0.25, 0.5, 1, 2, 3, 5, 7, 10, 20, 30]
    const truth = (t: number) => { const x = t / 2.5; const f = (1 - Math.exp(-x)) / x; return 4.5 - 2 * f - 1.2 * (f - Math.exp(-x)) }
    const fit = nelsonSiegel(tau, tau.map(truth))!
    for (const t of [0.5, 4, 15]) expect(fit.at(t)).toBeCloseTo(truth(t), 3)
    expect(fit.beta[0]).toBeCloseTo(4.5, 1)
    expect(fit.lambda).toBeCloseTo(2.5, 1)
  })
  it('order book depth accumulates from the best price outwards; market impact walks the book', () => {
    const book = orderBookDepth([{ price: 99, size: 5 }, { price: 100, size: 2 }, { price: 98, size: 10 }], [{ price: 102, size: 4 }, { price: 101, size: 3 }, { price: 103, size: 8 }])
    expect(book.bid.map((l) => l.price)).toEqual([100, 99, 98])
    expect(book.bid.map((l) => l.cum)).toEqual([2, 7, 17])
    expect(book.ask.map((l) => l.cum)).toEqual([3, 7, 15])
    expect(book.spread).toBe(1)
    expect(book.mid).toBe(100.5)
    expect(book.crossed).toBe(false)
    const m = marketImpact(book.ask, 5)
    expect(m.vwap).toBeCloseTo((3 * 101 + 2 * 102) / 5, 12)
    expect(m.slippage).toBeCloseTo(m.vwap - 101, 12)
    expect(marketImpact(book.ask, 100).complete).toBe(false)
  })
})
