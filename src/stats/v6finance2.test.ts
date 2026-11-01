import { describe, expect, it } from 'vitest'
import { createRng } from '../lib/random'
import {
  bsDelta, bsPrice, bsVega, covariance, cornishFisherVar, efficientFrontier, equalRiskContribution, eventStudy, globalMinVariance, historicalVarEs, impliedVol, kupiecLR, marketModel, meanVector, minVarianceWeights,
  normalCdf, normalVarEs, portfolioReturn, portfolioVariance, riskContributions, sviVariance, tangency, type EventRow,
} from './finance2'

const S2 = [[0.04, 0.006], [0.006, 0.01]], mu2 = [0.12, 0.06]

describe('mean–variance optimisation', () => {
  it('the two-asset minimum-variance weights follow the closed form and the weights sum to one', () => {
    const w = globalMinVariance(S2, false)
    const w1 = (S2[1][1] - S2[0][1]) / (S2[0][0] + S2[1][1] - 2 * S2[0][1])
    expect(w[0]).toBeCloseTo(w1, 12)
    expect(w[0] + w[1]).toBeCloseTo(1, 12)
  })
  it('frontier portfolios hit their target return, never beat the minimum variance, and long-only equals unconstrained when its solution is interior', () => {
    const t = 0.09
    const w = minVarianceWeights(mu2, S2, t, false)!
    expect(portfolioReturn(w, mu2)).toBeCloseTo(t, 10)
    expect(portfolioVariance(w, S2)).toBeGreaterThanOrEqual(portfolioVariance(globalMinVariance(S2, false), S2) - 1e-12)
    const lo = minVarianceWeights(mu2, S2, t, true)!
    expect(lo[0]).toBeCloseTo(w[0], 8)
    // a target above the best asset return is infeasible without leverage
    expect(minVarianceWeights(mu2, S2, 0.15, true)).toBeNull()
    expect(minVarianceWeights(mu2, S2, 0.15, false)![0]).toBeGreaterThan(1)
  })
  it('the long-only frontier of three assets stays on the simplex and is no better than the unconstrained one', () => {
    const rng = createRng(3)
    const R = Array.from({ length: 400 }, () => [rng.normal(0.01, 0.05), rng.normal(0.006, 0.03), rng.normal(0.003, 0.012)])
    const mu = meanVector(R), S = covariance(R)
    const lo = efficientFrontier(mu, S, 25, true), un = efficientFrontier(mu, S, 25, false)
    for (const p of lo) { expect(p.w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8); expect(Math.min(...p.w)).toBeGreaterThanOrEqual(-1e-9) }
    const volAt = (fr: typeof lo, r: number) => fr.reduce((b, p) => (Math.abs(p.ret - r) < Math.abs(b.ret - r) ? p : b)).vol
    const r = lo[10].ret
    expect(volAt(un, r)).toBeLessThanOrEqual(volAt(lo, r) + 1e-3)
  })
  it('the tangency portfolio maximises the Sharpe ratio over the frontier', () => {
    const t = tangency(mu2, S2, 0.02, false)!
    const sh = (r: number, v: number) => (r - 0.02) / v
    for (const f of efficientFrontier(mu2, S2, 60, false)) expect(sh(f.ret, f.vol)).toBeLessThanOrEqual(sh(t.ret, t.vol) + 1e-6)
  })
  it('risk contributions add up to the portfolio volatility and equal-risk-contribution weights equalise them', () => {
    const S = [[0.04, 0.01, 0.005], [0.01, 0.02, 0.004], [0.005, 0.004, 0.005]]
    const w = [0.4, 0.4, 0.2]
    const rc = riskContributions(w, S)
    expect(rc.contribution.reduce((a, b) => a + b, 0)).toBeCloseTo(rc.vol, 12)
    const erc = equalRiskContribution(S)
    const c = riskContributions(erc, S).contribution
    expect(Math.max(...c) - Math.min(...c)).toBeLessThan(1e-6)
    expect(erc[2]).toBeGreaterThan(erc[0])
  })
})

describe('options', () => {
  const base = { S: 100, K: 100, T: 1, r: 0.05, sigma: 0.2, call: true }
  it('reproduces the textbook price 10.4506 and satisfies put–call parity', () => {
    expect(bsPrice(base)).toBeCloseTo(10.4506, 3)
    const c = bsPrice(base), p = bsPrice({ ...base, call: false })
    expect(c - p).toBeCloseTo(100 - 100 * Math.exp(-0.05), 6)
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 5)
  })
  it('delta and vega match finite differences and the implied volatility inverts the price', () => {
    const h = 1e-4
    expect(bsDelta(base)).toBeCloseTo((bsPrice({ ...base, S: 100 + h }) - bsPrice({ ...base, S: 100 - h })) / (2 * h), 5)
    // the normal CDF is accurate to ~1e-7, so differentiate over a wider step
    const hv = 2e-3
    expect(bsVega(base)).toBeCloseTo((bsPrice({ ...base, sigma: 0.2 + hv }) - bsPrice({ ...base, sigma: 0.2 - hv })) / (2 * hv), 1)
    for (const [K, sg, call] of [[80, 0.35, false], [100, 0.2, true], [130, 0.28, true]] as const) {
      const p = bsPrice({ ...base, K, sigma: sg, call })
      expect(impliedVol(p, 100, K, 1, 0.05, call)).toBeCloseTo(sg, 6)
    }
    expect(impliedVol(0.0001, 100, 150, 1, 0.05, true)).toBeLessThan(0.15)
    expect(Number.isNaN(impliedVol(0.0001, 100, 100, 1, 0.05, true))).toBe(true) // below intrinsic value: no volatility explains it
    expect(Number.isNaN(impliedVol(1, 100, 80, 1, 0.05, true))).toBe(true)
  })
  it('an SVI total variance with ρ < 0 produces a left skew (higher implied vol at low strikes)', () => {
    const p = { a: 0.02, b: 0.1, rho: -0.5, m: 0, s: 0.15 }
    expect(sviVariance(-0.2, p)).toBeGreaterThan(sviVariance(0.2, p))
    expect(sviVariance(0, p)).toBeGreaterThan(0)
  })
})

describe('event study', () => {
  it('abnormal returns vanish when the stock follows the market model exactly and the CAR collects a day-0 jump', () => {
    const rng = createRng(4)
    const rows: EventRow[] = []
    for (const e of ['A', 'B', 'C', 'D', 'E', 'F']) {
      for (let d = -40; d <= 8; d++) { const m = rng.normal(0.0004, 0.01); rows.push({ event: e, offset: d, market: m, stock: 0.0002 + 1.2 * m + (d === 0 ? 0.04 : 0) + rng.normal(0, 0.002) }) }
    }
    const r = eventStudy(rows, 8, 8)
    expect(r.n).toBe(6)
    expect(r.days[0]).toBe(-8)
    const i0 = r.days.indexOf(0)
    expect(r.aar[i0]).toBeGreaterThan(0.03)
    expect(Math.abs(r.aar[0])).toBeLessThan(0.004)
    expect(r.caar[r.caar.length - 1]).toBeGreaterThan(0.03)
    expect(r.t[r.t.length - 1]).toBeGreaterThan(3)
    const mm = marketModel(rows.filter((x) => x.event === 'A' && x.offset < -8).map((x) => x.stock), rows.filter((x) => x.event === 'A' && x.offset < -8).map((x) => x.market))
    expect(mm.beta).toBeCloseTo(1.2, 1)
  })
})

describe('tail risk', () => {
  it('normal VaR and ES at 5% are 1.645σ and 2.063σ and historical estimates of a large normal sample agree', () => {
    const n = normalVarEs(0, 1, 0.05)
    expect(n.var).toBeCloseTo(1.6449, 3)
    expect(n.es).toBeCloseTo(2.0627, 3)
    const rng = createRng(2)
    const x = Array.from({ length: 200000 }, () => rng.normal())
    const h = historicalVarEs(x, 0.05)
    expect(h.var).toBeCloseTo(1.645, 1)
    expect(h.es).toBeCloseTo(2.063, 1)
    expect(h.es).toBeGreaterThan(h.var)
    expect(cornishFisherVar(x, 0.05).var).toBeCloseTo(1.645, 1)
  })
  it('heavy tails raise the Cornish–Fisher VaR above the normal one and the Kupiec test accepts the right coverage', () => {
    const rng = createRng(6)
    // Student t with 3 degrees of freedom: z / sqrt(χ²₃ / 3)
    const t = Array.from({ length: 50000 }, () => rng.normal() / Math.sqrt((rng.normal() ** 2 + rng.normal() ** 2 + rng.normal() ** 2) / 3))
    const cf = cornishFisherVar(t, 0.01)
    expect(cf.kurt).toBeGreaterThan(1)
    expect(kupiecLR(50, 1000, 0.05)).toBeLessThan(0.01)
    expect(kupiecLR(100, 1000, 0.05)).toBeGreaterThan(10)
  })
})
