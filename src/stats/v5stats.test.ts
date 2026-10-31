import { describe, expect, it } from 'vitest'
import { createRng } from '../lib/random'
import { baseline, bootstrap, bootstrapCi, cusum, ewma, gainCurve, pit, pitHistogram, pitKs, statistic } from './inference2'
import { coefIntervals, diagnostics, fitForest, lowess, ols, partialDependence, polyRows } from './regression'
import { chiSquareSf, cumHazardAt, kaplanMeier, logRank, nelsonAalenBand, riskTable, survivalAt, type Subject } from './survival'

const subj = (times: number[], censored: number[] = []): Subject[] => [...times.map((t, i) => ({ time: t, event: true, row: i })), ...censored.map((t, i) => ({ time: t, event: false, row: 100 + i }))]

describe('regression diagnostics', () => {
  const rng = createRng(4)
  const x = Array.from({ length: 30 }, () => rng() * 10)
  const y = x.map((v) => 2 + 1.5 * v + rng.normal(0, 1.2))
  x.push(25); y.push(10) // a high-leverage point that pulls the line down
  const X = x.map((v) => [v])
  const fit = ols(X, y)!
  it('recovers a known line and satisfies the normal equations (residuals orthogonal to the design)', () => {
    const clean = ols(x.slice(0, 30).map((v) => [v]), y.slice(0, 30))!
    expect(clean.beta[1]).toBeGreaterThan(1.3)
    expect(clean.beta[1]).toBeLessThan(1.7)
    expect(fit.residuals.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 8)
    expect(fit.residuals.reduce((a, e, i) => a + e * x[i], 0)).toBeCloseTo(0, 6)
  })
  it('leverages sum to the number of coefficients and flag the extreme x', () => {
    expect(fit.hat.reduce((a, b) => a + b, 0)).toBeCloseTo(2, 8)
    expect(fit.hat[30]).toBe(Math.max(...fit.hat))
    expect(fit.hat[30]).toBeGreaterThan(diagnostics(fit).hatLimit)
  })
  it("Cook's distance equals the change in all fitted values when the point is left out", () => {
    const d = diagnostics(fit)
    for (const i of [0, 7, 30]) {
      const keepX = X.filter((_, k) => k !== i), keepY = y.filter((_, k) => k !== i)
      const loo = ols(keepX, keepY)!
      let change = 0
      X.forEach((r, k) => { const pred = loo.beta[0] + loo.beta[1] * r[0]; change += (fit.fitted[k] - pred) ** 2 })
      expect(d.cooks[i]).toBeCloseTo(change / (fit.p * fit.sigma ** 2), 8)
    }
    expect(d.cooks[30]).toBe(Math.max(...d.cooks))
  })
  it('studentized residuals equal the leave-one-out prediction error over its standard error', () => {
    const d = diagnostics(fit)
    const i = 12
    const loo = ols(X.filter((_, k) => k !== i), y.filter((_, k) => k !== i))!
    const pred = loo.beta[0] + loo.beta[1] * x[i]
    const hLoo = (1 / loo.n) + 0 // not needed: use the identity e_i / (σ_(i) √(1−h_i))
    void hLoo
    expect(d.studentized[i]).toBeCloseTo((y[i] - fit.fitted[i]) / (loo.sigma * Math.sqrt(1 - fit.hat[i])), 8)
    expect(Math.abs(pred - y[i])).toBeGreaterThan(0)
  })
  it('coefficient intervals use the t quantile and contain the estimate', () => {
    const ci = coefIntervals(fit, 0.95)
    ci.forEach(([lo, hi], i) => { expect(lo).toBeLessThan(fit.beta[i]); expect(hi).toBeGreaterThan(fit.beta[i]) })
    expect((ci[1][1] - ci[1][0]) / 2).toBeCloseTo(2.048 * fit.se[1], 2)
  })
  it('polynomial terms capture curvature that a line leaves in the residuals; LOWESS follows a curve', () => {
    const xs = Array.from({ length: 60 }, (_, i) => i / 6), ys = xs.map((v) => 1 + 0.5 * v + 0.3 * v * v)
    expect(ols(polyRows(xs, 1), ys)!.sigma).toBeGreaterThan(1)
    expect(ols(polyRows(xs, 2), ys)!.sigma).toBeLessThan(1e-6)
    const sm = lowess(xs, ys, 0.3)
    expect(Math.abs(sm[30] - ys[30])).toBeLessThan(0.2)
    expect(ols([[1, 1], [2, 2], [3, 3]], [1, 2, 3])).toBeNull() // collinear columns
  })
  it('a random forest learns the relevant feature, and partial dependence follows it', () => {
    const r = createRng(9)
    const Xf = Array.from({ length: 220 }, () => [r() * 10, r() * 10])
    const yf = Xf.map(([a]) => 3 * a + r.normal(0, 1))
    const model = fitForest(Xf, yf, { trees: 30, depth: 5, seed: 2 })
    const mse = Xf.reduce((s, row, i) => s + (model.predict(row) - yf[i]) ** 2, 0) / Xf.length
    const mean = yf.reduce((a, b) => a + b, 0) / yf.length
    const varY = yf.reduce((s, v) => s + (v - mean) ** 2, 0) / yf.length
    expect(mse).toBeLessThan(varY * 0.1)
    const grid = [1, 3, 5, 7, 9]
    const pd0 = partialDependence(model, Xf, 0, grid).pdp, pd1 = partialDependence(model, Xf, 1, grid).pdp
    expect(pd0[4] - pd0[0]).toBeGreaterThan(15)
    expect(Math.max(...pd1) - Math.min(...pd1)).toBeLessThan(5)
    expect(partialDependence(model, Xf, 0, grid, [0, 5]).ice).toHaveLength(2)
  })
})

describe('survival analysis', () => {
  // classic 6-MP leukaemia remission times (Freireich et al., 1963), as printed in survival-analysis textbooks
  const sixMp = subj([6, 6, 6, 7, 10, 13, 16, 22, 23], [6, 9, 10, 11, 17, 19, 20, 25, 32, 32, 34, 35])
  const placebo = subj([1, 1, 2, 2, 3, 4, 4, 5, 5, 8, 8, 8, 8, 11, 11, 12, 12, 15, 17, 22, 23])
  it('Kaplan–Meier reproduces the published 6-MP survival probabilities', () => {
    const km = kaplanMeier(sixMp)
    for (const [t, s] of [[6, 0.857], [7, 0.807], [10, 0.753], [13, 0.69], [16, 0.627], [22, 0.538], [23, 0.448]] as const) expect(survivalAt(km, t)).toBeCloseTo(s, 3)
    expect(km.median).toBe(23)
    expect(survivalAt(km, 5)).toBe(1)
  })
  it('the Greenwood band stays inside [0, 1] and brackets the estimate', () => {
    for (const st of kaplanMeier(sixMp).steps) { expect(st.lo).toBeLessThanOrEqual(st.surv + 1e-12); expect(st.hi).toBeGreaterThanOrEqual(st.surv - 1e-12); expect(st.lo).toBeGreaterThanOrEqual(0); expect(st.hi).toBeLessThanOrEqual(1) }
    // Greenwood standard error at t = 6 of the 6-MP group: S·√(Σ d/(n(n−d))) = 0.857·√(3/(21·18)) ≈ 0.0764
    const s6 = kaplanMeier(sixMp, 0.95).steps.find((s) => s.time === 6)!
    expect(s6.hi - s6.lo).toBeGreaterThan(0.2)
  })
  it('Nelson–Aalen cumulative hazard is the sum of events over the number at risk and tracks −log S', () => {
    const km = kaplanMeier(sixMp)
    expect(cumHazardAt(km, 6)).toBeCloseTo(3 / 21, 12)
    expect(cumHazardAt(km, 7)).toBeCloseTo(3 / 21 + 1 / 17, 12)
    expect(Math.abs(cumHazardAt(km, 10) + Math.log(survivalAt(km, 10)))).toBeLessThan(0.02)
    const band = nelsonAalenBand(km)
    band.forEach((b) => { expect(b.lo).toBeLessThanOrEqual(b.h + 1e-12); expect(b.hi).toBeGreaterThanOrEqual(b.h - 1e-12) })
  })
  it('the log-rank test of 6-MP against placebo gives the published statistic (≈ 16.8, p < 0.0001)', () => {
    const lr = logRank([sixMp, placebo])
    expect(lr.chi2).toBeGreaterThan(16.4)
    expect(lr.chi2).toBeLessThan(17.1)
    expect(lr.df).toBe(1)
    expect(lr.p).toBeLessThan(1e-4)
    expect(logRank([placebo, placebo]).chi2).toBeCloseTo(0, 9)
  })
  it('the risk table counts subjects whose follow-up reaches each time; chi-square tail matches known values', () => {
    expect(riskTable(sixMp, [0, 10, 23])).toEqual([21, 15, 6])
    expect(chiSquareSf(3.841, 1)).toBeCloseTo(0.05, 3)
    expect(chiSquareSf(5.991, 2)).toBeCloseTo(0.05, 3)
    expect(chiSquareSf(0, 3)).toBe(1)
  })
})

describe('bootstrap', () => {
  const rng = createRng(11)
  const data = Array.from({ length: 80 }, () => rng.normal(50, 10))
  it('the bootstrap standard error of the mean matches s/√n and replicates are reproducible', () => {
    const boot = bootstrap(data, 'mean', 4000, 5)
    const m = boot.reduce((a, b) => a + b, 0) / boot.length
    const se = Math.sqrt(boot.reduce((a, b) => a + (b - m) ** 2, 0) / (boot.length - 1))
    expect(se).toBeCloseTo(statistic('sd', data) / Math.sqrt(80), 1)
    expect(bootstrap(data, 'median', 50, 3)).toEqual(bootstrap(data, 'median', 50, 3))
  })
  it('percentile, normal and BCa intervals agree for a symmetric statistic and contain the estimate', () => {
    const boot = bootstrap(data, 'mean', 3000, 6)
    const est = statistic('mean', data)
    const p = bootstrapCi(data, 'mean', boot, 0.95, 'percentile'), n = bootstrapCi(data, 'mean', boot, 0.95, 'normal'), b = bootstrapCi(data, 'mean', boot, 0.95, 'bca')
    for (const ci of [p, n, b]) { expect(ci.lo).toBeLessThan(est); expect(ci.hi).toBeGreaterThan(est) }
    expect(Math.abs(p.lo - n.lo)).toBeLessThan(0.5)
    expect(Math.abs(b.hi - p.hi)).toBeLessThan(0.6)
    expect(bootstrapCi(data, 'mean', boot, 0.99, 'percentile').hi - est).toBeGreaterThan(p.hi - est)
  })
  it('statistics are computed by their definitions', () => {
    expect(statistic('median', [1, 2, 3, 4, 100])).toBe(3)
    expect(statistic('iqr', [1, 2, 3, 4, 5])).toBe(2)
    expect(statistic('trimmed', [0, 1, 2, 3, 4, 5, 6, 7, 8, 100])).toBeCloseTo(4.5, 9)
    expect(statistic('sd', [2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3)
  })
})

describe('EWMA and CUSUM', () => {
  it('EWMA follows the recursion and its exact limits widen to the asymptotic limits', () => {
    const r = ewma([10, 12, 11], { lambda: 0.2, L: 3, mu0: 10, sigma0: 1 })
    expect(r.z[0]).toBeCloseTo(0.2 * 10 + 0.8 * 10, 12)
    expect(r.z[1]).toBeCloseTo(0.2 * 12 + 0.8 * r.z[0], 12)
    expect(r.ucl[0]).toBeCloseTo(10 + 3 * Math.sqrt((0.2 / 1.8) * (1 - 0.8 ** 2)), 12)
    const long = ewma(Array(60).fill(10), { lambda: 0.2, L: 3, mu0: 10, sigma0: 1 })
    expect(long.ucl[59]).toBeCloseTo(10 + 3 * Math.sqrt(0.2 / 1.8), 6)
    expect(long.ucl[5]).toBeLessThan(long.ucl[59])
  })
  it('EWMA signals a small sustained shift that individual points would not show; CUSUM does too, and restarts', () => {
    const rng = createRng(3)
    const x = Array.from({ length: 80 }, (_, i) => 50 + (i >= 40 ? 0.8 : 0) + rng.normal(0, 1))
    const { mu, sigma } = baseline(x, 30)
    const e = ewma(x, { lambda: 0.15, L: 2.7, mu0: mu, sigma0: sigma })
    expect(e.signals.some((i) => i >= 40)).toBe(true)
    expect(e.signals.filter((i) => i < 30).length).toBeLessThan(3)
    expect(x.filter((v) => Math.abs(v - mu) > 3 * sigma).length).toBeLessThan(3)
    const c = cusum(x, { k: 0.5, h: 4, mu0: mu, sigma0: sigma })
    expect(c.signals.some((s) => s.index >= 40 && s.side === 'up')).toBe(true)
  })
  it('CUSUM accumulates (x − μ − kσ) exactly and never goes below zero', () => {
    const c = cusum([1.5, 1.5, 0, 0, -3], { k: 0.5, h: 100, mu0: 0, sigma0: 1 })
    expect(c.upper).toEqual([1, 2, 1.5, 1, 0])
    expect(c.lower).toEqual([0, 0, 0, 0, 2.5])
  })
})

describe('gain / lift and PIT', () => {
  it('a perfect ranking reaches the perfect gain curve (Gini 1); a random one hugs the diagonal; lift of the top bin is gain/share', () => {
    const perfect = Array.from({ length: 200 }, (_, i) => ({ score: 200 - i, label: (i < 40 ? 1 : 0) as 0 | 1 }))
    const g = gainCurve(perfect, 10)
    expect(g.gini).toBeCloseTo(1, 9)
    expect(g.points[2].gain).toBe(1)
    expect(g.points[1].lift).toBeCloseTo(5, 9)
    const rng = createRng(2)
    const random = Array.from({ length: 4000 }, () => ({ score: rng(), label: (rng() < 0.2 ? 1 : 0) as 0 | 1 }))
    const r = gainCurve(random, 10)
    expect(Math.abs(r.gini)).toBeLessThan(0.1)
    expect(r.points[10].gain).toBe(1)
    expect(r.prevalence).toBeCloseTo(0.2, 1)
  })
  it('PIT values of calibrated forecasts are uniform, over-confident forecasts give a U shape, under-confident a hump', () => {
    const rng = createRng(8)
    const make = (spread: number) => Array.from({ length: 3000 }, () => { const mu = rng.normal(0, 3); const y = mu + rng.normal(0, spread); return pit(y, mu, 1, 'normal') })
    const good = make(1), over = make(2), under = make(0.5)
    expect(pitKs(good)).toBeLessThan(0.03)
    expect(pitKs(over)).toBeGreaterThan(0.1)
    const hOver = pitHistogram(over, 10), hUnder = pitHistogram(under, 10)
    expect(hOver.bins[0].density).toBeGreaterThan(1.5)
    expect(hOver.bins[9].density).toBeGreaterThan(1.5)
    expect(hUnder.bins[4].density).toBeGreaterThan(1.3)
    const hGood = pitHistogram(good, 10)
    expect(hGood.bins.filter((b) => b.density >= hGood.band[0] && b.density <= hGood.band[1]).length).toBeGreaterThanOrEqual(8)
    expect(hGood.bins.reduce((s, b) => s + b.count, 0)).toBe(3000)
  })
  it('PIT of the median observation is 0.5 under both families', () => {
    expect(pit(5, 5, 2, 'normal')).toBeCloseTo(0.5, 6)
    expect(pit(5, 5, 2, 't5')).toBeCloseTo(0.5, 6)
    expect(pit(7, 5, 2, 't5')).toBeGreaterThan(0.5)
  })
})
