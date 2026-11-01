import { describe, expect, it } from 'vitest'
import { createRng } from '../lib/random'
import {
  acf, bartlettSe, betaPdf, ccf, cumulativeIncidence, ess, gammaPdf, gammaSample, gevLMoments, gevQuantile, gringorten, kernelHazard, ljungBox, metropolis, mutualInformation, normalPosterior, pacf, pearsonR, pooledRanks,
  rankHistogram, returnLevel, returnLevelBand, rhat, sbcRanks, spearmanR, stl, weibullMle, type TimedEvent,
} from './tsa'

const ar1 = (n: number, phi: number, seed: number) => { const r = createRng(seed); const x = [0]; for (let t = 1; t < n; t++) x.push(phi * x[t - 1] + r.normal()); return x }

describe('autocorrelation', () => {
  it('matches hand-computed values on 1..5 (r1 = 0.4, r2 = −0.1)', () => {
    const r = acf([1, 2, 3, 4, 5], 2)
    expect(r[0]).toBe(1)
    expect(r[1]).toBeCloseTo(0.4, 12)
    expect(r[2]).toBeCloseTo(-0.1, 12)
  })
  it('an AR(1) series has r_k ≈ φ^k and a partial autocorrelation that cuts off after lag 1', () => {
    const x = ar1(4000, 0.7, 3)
    const r = acf(x, 4), p = pacf(x, 4)
    expect(r[1]).toBeCloseTo(0.7, 1)
    expect(r[2]).toBeCloseTo(0.49, 1)
    expect(p[0]).toBeCloseTo(r[1], 12)
    expect(Math.abs(p[1])).toBeLessThan(0.06)
    expect(Math.abs(p[2])).toBeLessThan(0.06)
  })
  it('Durbin–Levinson reproduces the closed form for lag 2: (r2 − r1²)/(1 − r1²)', () => {
    const x = ar1(300, 0.5, 8)
    const r = acf(x, 2)
    expect(pacf(x, 2)[1]).toBeCloseTo((r[2] - r[1] ** 2) / (1 - r[1] ** 2), 12)
  })
  it('white noise stays inside the ±1.96/√n band about 95% of the time and the Ljung–Box Q is small', () => {
    const r = createRng(5)
    const x = Array.from({ length: 2000 }, () => r.normal())
    const a = acf(x, 40)
    const out = a.slice(1).filter((v) => Math.abs(v) > 1.96 / Math.sqrt(2000)).length
    expect(out).toBeLessThanOrEqual(5)
    expect(ljungBox(a, 2000, 20)).toBeLessThan(40)
    expect(bartlettSe(a, 1, 2000)).toBeCloseTo(1 / Math.sqrt(2000), 12)
  })
  it('the cross-correlation of a delayed copy peaks at the delay with value ≈ 1', () => {
    const x = ar1(600, 0.6, 2)
    const y = x.map((_, t) => (t >= 4 ? x[t - 4] : 0))
    const c = ccf(x, y, 8)
    const best = c.reduce((b, v) => (v.r > b.r ? v : b))
    expect(best.lag).toBe(4)
    expect(best.r).toBeGreaterThan(0.97)
    expect(c.find((v) => v.lag === -4)!.r).toBeLessThan(0.5)
  })
})

describe('STL', () => {
  const period = 12, n = 144
  const rng = createRng(4)
  const trueSeason = (t: number) => 3 * Math.sin((2 * Math.PI * t) / period) + Math.cos((4 * Math.PI * t) / period)
  const y = Array.from({ length: n }, (_, t) => 10 + 0.15 * t + trueSeason(t) + rng.normal(0, 0.3))
  it('trend + seasonal + remainder reproduces the series exactly', () => {
    const r = stl(y, period, { seasonal: 7 })
    y.forEach((v, i) => expect(r.trend[i] + r.seasonal[i] + r.remainder[i]).toBeCloseTo(v, 10))
  })
  it('recovers the linear trend and the seasonal shape, and the seasonal part averages out', () => {
    const r = stl(y, period, { seasonal: 7, outer: 1 })
    const mid = r.trend.slice(24, 120)
    const slope = (mid[mid.length - 1] - mid[0]) / (mid.length - 1)
    expect(slope).toBeCloseTo(0.15, 1)
    const err = r.seasonal.slice(12, 132).map((s, i) => s - trueSeason(i + 12))
    expect(Math.sqrt(err.reduce((a, v) => a + v * v, 0) / err.length)).toBeLessThan(0.45)
    expect(Math.abs(r.seasonal.reduce((a, v) => a + v, 0) / n)).toBeLessThan(0.2)
    expect(r.seasonalStrength).toBeGreaterThan(0.9)
    expect(r.trendStrength).toBeGreaterThan(0.9)
  })
  it('robust iterations give an outlier a low weight and keep it out of the seasonal part', () => {
    const z = [...y]; z[50] += 40
    const r = stl(z, period, { seasonal: 7, outer: 3 })
    expect(r.weights[50]).toBeLessThan(0.05)
    expect(Math.abs(r.seasonal[50] - trueSeason(50))).toBeLessThan(1.5)
    expect(r.remainder[50]).toBeGreaterThan(30)
  })
})

describe('Bayesian helpers', () => {
  it('the beta and gamma densities integrate to one', () => {
    const grid = (a: number, b: number, f: (x: number) => number) => { let s = 0; const N = 4000; for (let i = 0; i < N; i++) s += f(a + ((i + 0.5) * (b - a)) / N) * ((b - a) / N); return s }
    expect(grid(0, 1, (x) => betaPdf(x, 3, 5))).toBeCloseTo(1, 3)
    expect(grid(0, 40, (x) => gammaPdf(x, 3, 0.5))).toBeCloseTo(1, 3)
  })
  it('gamma samples have mean = shape and variance = shape', () => {
    const r = createRng(2)
    const x = Array.from({ length: 20000 }, () => gammaSample(3.5, r))
    expect(x.reduce((a, v) => a + v, 0) / x.length).toBeCloseTo(3.5, 1)
    const m = x.reduce((a, v) => a + v, 0) / x.length
    expect(x.reduce((a, v) => a + (v - m) ** 2, 0) / x.length).toBeCloseTo(3.5, 0)
    const small = Array.from({ length: 20000 }, () => gammaSample(0.4, r))
    expect(small.reduce((a, v) => a + v, 0) / small.length).toBeCloseTo(0.4, 1)
  })
  it('the normal posterior centres on the sample mean with the t-distribution spread', () => {
    const r = createRng(6)
    const data = Array.from({ length: 30 }, () => r.normal(5, 2))
    const mean = data.reduce((a, v) => a + v, 0) / 30
    const post = normalPosterior(data, 6000, createRng(1))
    expect(post.reduce((a, d) => a + d.mu, 0) / post.length).toBeCloseTo(mean, 1)
    const s = Math.sqrt(data.reduce((a, v) => a + (v - mean) ** 2, 0) / 29)
    expect(post.reduce((a, d) => a + d.sigma, 0) / post.length).toBeGreaterThan(s * 0.95)
  })
  it('Metropolis on a Gaussian target recovers its moments; split R̂ ≈ 1 for good chains and ≫ 1 for stuck ones', () => {
    const logp = (t: readonly number[]) => -0.5 * ((t[0] - 3) / 2) ** 2
    const good = metropolis(logp, [[-8], [0], [8], [15]], 6000, [3.5], 1)
    const flat = good.chains.map((c) => c.slice(1000).map((v) => v[0]))
    const all = flat.flat()
    expect(all.reduce((a, v) => a + v, 0) / all.length).toBeCloseTo(3, 0)
    expect(Math.sqrt(all.reduce((a, v) => a + (v - 3) ** 2, 0) / all.length)).toBeCloseTo(2, 0)
    expect(rhat(flat)).toBeLessThan(1.05)
    const stuck = metropolis(logp, [[-8], [0], [8], [15]], 400, [0.01], 1)
    expect(rhat(stuck.chains.map((c) => c.map((v) => v[0])))).toBeGreaterThan(1.5)
    expect(good.accept[0]).toBeGreaterThan(0.2)
  })
  it('effective sample size is ≈ n for independent draws and much smaller for a sticky chain', () => {
    const r = createRng(9)
    const iid = Array.from({ length: 4000 }, () => r.normal())
    expect(ess(iid)).toBeGreaterThan(2500)
    expect(ess(ar1(4000, 0.95, 1))).toBeLessThan(500)
  })
  it('pooled ranks of well-mixed chains are uniform in every chain', () => {
    const r = createRng(3)
    const chains = Array.from({ length: 4 }, () => Array.from({ length: 2000 }, () => r.normal()))
    const ranks = pooledRanks(chains)
    expect(Math.max(...ranks.flat())).toBe(8000)
    for (const rk of ranks) { const h = rankHistogram(rk, 8000, 10); for (const c of h) expect(Math.abs(c - 200)).toBeLessThan(60) }
  })
  it('SBC ranks are uniform for the exact posterior and visibly U-shaped for an over-confident one', () => {
    const chi = (ranks: number[]) => { const h = rankHistogram(ranks.map((r) => r + 1), 100, 10); const e = ranks.length / 10; return h.reduce((a, c) => a + (c - e) ** 2 / e, 0) }
    expect(chi(sbcRanks(10, 1, { sims: 1500, seed: 2 }))).toBeLessThan(25)
    expect(chi(sbcRanks(10, 1, { sims: 1500, seed: 2, mode: 'overconfident' }))).toBeGreaterThan(80)
    expect(chi(sbcRanks(10, 1, { sims: 1500, seed: 2, mode: 'biased' }))).toBeGreaterThan(40)
  })
})

describe('competing risks and hazards', () => {
  const rng = createRng(12)
  const data: TimedEvent[] = Array.from({ length: 600 }, () => {
    const t1 = -Math.log(1 - rng()) / 0.05, t2 = -Math.log(1 - rng()) / 0.03, c = 40 * rng()
    const t = Math.min(t1, t2, c)
    return { time: t, cause: t === c ? 0 : t === t1 ? 1 : 2 }
  })
  it('incidences and the all-cause survival add up to one at every time', () => {
    const steps = cumulativeIncidence(data, 2)
    for (const s of steps) expect(s.cif[0] + s.cif[1] + s.surv).toBeCloseTo(1, 10)
    for (let i = 1; i < steps.length; i++) expect(steps[i].cif[0]).toBeGreaterThanOrEqual(steps[i - 1].cif[0] - 1e-12)
  })
  it('matches the exponential theory λ1/(λ1+λ2)·(1 − e^{−(λ1+λ2)t}) and the naive 1 − KM overshoots it', () => {
    const steps = cumulativeIncidence(data, 2)
    const at = (t: number) => steps.filter((s) => s.time <= t).pop()!
    const s = at(10), theory = (0.05 / 0.08) * (1 - Math.exp(-0.08 * 10))
    expect(s.cif[0]).toBeCloseTo(theory, 1)
    expect(s.naive[0]).toBeGreaterThan(s.cif[0])
  })
  it('the kernel hazard of exponential data is flat at the true rate and the Weibull MLE finds shape ≈ 1', () => {
    const r = createRng(5)
    const t = Array.from({ length: 4000 }, () => -Math.log(1 - r()) / 0.2)
    const ev = t.map(() => true)
    const h = kernelHazard(t, ev, 1.2, [2, 5, 8])
    for (const v of h) expect(v).toBeCloseTo(0.2, 1)
    const w = weibullMle(t, ev)!
    expect(w.shape).toBeCloseTo(1, 1)
    expect(w.scale).toBeCloseTo(5, 0)
  })
})

describe('extreme values', () => {
  it('L-moments recover a Gumbel (k = 0) and a heavy-tailed GEV from exact quantiles', () => {
    const n = 4000
    const gum = Array.from({ length: n }, (_, i) => 100 - 10 * Math.log(-Math.log((i + 0.5) / n)))
    const g = gevLMoments(gum)!
    expect(g.loc).toBeCloseTo(100, 0)
    expect(g.scale).toBeCloseTo(10, 0)
    expect(Math.abs(g.k)).toBeLessThan(0.03)
    const heavy = Array.from({ length: n }, (_, i) => 50 + (10 / -0.2) * (1 - (-Math.log((i + 0.5) / n)) ** -0.2))
    const h = gevLMoments(heavy)!
    expect(h.k).toBeCloseTo(-0.2, 1)
    expect(h.loc).toBeCloseTo(50, 0)
  })
  it('return levels increase with the period and the 100-year level matches the Gumbel closed form', () => {
    const g = { loc: 100, scale: 10, k: 0 }
    expect(returnLevel(g, 100)).toBeCloseTo(100 - 10 * Math.log(-Math.log(0.99)), 9)
    expect(returnLevel(g, 100)).toBeGreaterThan(returnLevel(g, 10))
    expect(gevQuantile(g, 0.5)).toBeCloseTo(100 - 10 * Math.log(Math.LN2), 9)
  })
  it('the bootstrap band contains the point estimate and widens with the return period', () => {
    const r = createRng(7)
    const x = Array.from({ length: 60 }, () => 100 - 10 * Math.log(-Math.log(r())))
    const g = gevLMoments(x)!
    const band = returnLevelBand(x, [5, 50, 200], 200, 0.9, 1)
    band.forEach((b, i) => { const v = returnLevel(g, [5, 50, 200][i]); expect(b.lo).toBeLessThan(v); expect(b.hi).toBeGreaterThan(v) })
    expect(band[2].hi - band[2].lo).toBeGreaterThan(band[0].hi - band[0].lo)
    expect(gringorten(10)[0]).toBeCloseTo(0.56 / 10.12, 12)
  })
})

describe('dependence measures', () => {
  it('Pearson, Spearman and mutual information separate linear, monotone and nonlinear dependence', () => {
    const r = createRng(4)
    const x = Array.from({ length: 800 }, () => r.normal())
    const lin = x.map((v) => 2 * v + r.normal(0, 0.1)), expo = x.map((v) => Math.exp(2 * v)), sq = x.map((v) => v * v + r.normal(0, 0.05))
    expect(pearsonR(x, lin)).toBeGreaterThan(0.99)
    expect(spearmanR(x, expo)).toBeCloseTo(1, 6)
    expect(pearsonR(x, expo)).toBeLessThan(0.8)
    expect(Math.abs(pearsonR(x, sq))).toBeLessThan(0.1)
    expect(mutualInformation(x, sq, 8)).toBeGreaterThan(0.3)
    const indep = x.map(() => r.normal())
    expect(mutualInformation(x, indep, 8)).toBeLessThan(0.08)
  })
})
