import { createRng } from '../lib/random'
import { erfc, normalPdf, normalQuantile } from './distributions'

/** Portfolio theory, option pricing and implied volatility, event studies and tail-risk measures. Synthetic data only; nothing here is investment advice. */

const sum = (a: readonly number[]) => a.reduce((s, v) => s + v, 0)
const mean = (a: readonly number[]) => (a.length ? sum(a) / a.length : 0)

// ─── linear algebra helpers ─────────────────────────────────────────────────────────

export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-14) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k] }
  }
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r] }
  return x
}

export const meanVector = (returns: readonly (readonly number[])[]) => (returns[0] ?? []).map((_, j) => mean(returns.map((r) => r[j])))
export function covariance(returns: readonly (readonly number[])[]): number[][] {
  const n = returns.length, p = returns[0]?.length ?? 0
  const mu = meanVector(returns)
  return Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => (n > 1 ? sum(returns.map((r) => (r[i] - mu[i]) * (r[j] - mu[j]))) / (n - 1) : 0)))
}

export const portfolioReturn = (w: readonly number[], mu: readonly number[]) => sum(w.map((x, i) => x * mu[i]))
export const portfolioVariance = (w: readonly number[], S: readonly (readonly number[])[]) => sum(w.map((x, i) => x * sum(w.map((y, j) => y * S[i][j]))))

// ─── mean–variance optimisation ─────────────────────────────────────────────────────

/** Minimum-variance weights with Σw = 1 (and Σ μw = target when given) on the subset `idx` of assets, short selling allowed on that subset (Lagrange / KKT system). */
function kkt(mu: readonly number[], S: readonly (readonly number[])[], idx: readonly number[], target?: number): number[] | null {
  const m = idx.length, extra = target == null ? 1 : 2
  const A: number[][] = Array.from({ length: m + extra }, () => new Array<number>(m + extra).fill(0))
  const b = new Array<number>(m + extra).fill(0)
  for (let i = 0; i < m; i++) { for (let j = 0; j < m; j++) A[i][j] = 2 * S[idx[i]][idx[j]]; A[i][m] = 1; A[m][i] = 1; if (target != null) { A[i][m + 1] = mu[idx[i]]; A[m + 1][i] = mu[idx[i]] } }
  b[m] = 1
  if (target != null) b[m + 1] = target
  const x = solveLinear(A, b)
  return x ? x.slice(0, m) : null
}

/** Efficient frontier point for a target return. `longOnly` enumerates active sets (exact for up to ~10 assets): the best feasible subset solution (all weights ≥ 0) wins. */
export function minVarianceWeights(mu: readonly number[], S: readonly (readonly number[])[], target: number, longOnly: boolean): number[] | null {
  const p = mu.length
  if (!longOnly) { const w = kkt(mu, S, mu.map((_, i) => i), target); return w }
  let best: { w: number[]; v: number } | null = null
  for (let mask = 1; mask < 1 << p; mask++) {
    const idx = Array.from({ length: p }, (_, i) => i).filter((i) => mask & (1 << i))
    const sub = kkt(mu, S, idx, idx.length > 1 ? target : undefined)
    if (!sub || sub.some((v) => v < -1e-10)) continue
    const w = new Array<number>(p).fill(0)
    idx.forEach((i, k) => { w[i] = Math.max(0, sub[k]) })
    if (Math.abs(portfolioReturn(w, mu) - target) > 1e-7) continue
    const v = portfolioVariance(w, S)
    if (!best || v < best.v) best = { w, v }
  }
  return best?.w ?? null
}

/** Global minimum-variance portfolio (long-only or unconstrained): w = Σ⁻¹1 / 1ᵀΣ⁻¹1 on the best active set. */
export function globalMinVariance(S: readonly (readonly number[])[], longOnly: boolean): number[] {
  const p = S.length, zeros = new Array<number>(p).fill(0)
  let best: { w: number[]; v: number } | null = null
  for (let mask = 1; mask < (longOnly ? 1 << p : 2); mask++) {
    const idx = longOnly ? Array.from({ length: p }, (_, i) => i).filter((i) => mask & (1 << i)) : Array.from({ length: p }, (_, i) => i)
    const sub = kkt(zeros, S, idx)
    if (!sub || (longOnly && sub.some((v) => v < -1e-10))) continue
    const w = new Array<number>(p).fill(0)
    idx.forEach((i, k) => { w[i] = sub[k] })
    const v = portfolioVariance(w, S)
    if (!best || v < best.v) best = { w, v }
  }
  return best?.w ?? zeros.map(() => 1 / p)
}

export interface FrontierPoint { ret: number; vol: number; w: number[] }

export function efficientFrontier(mu: readonly number[], S: readonly (readonly number[])[], points: number, longOnly: boolean): FrontierPoint[] {
  const gmv = globalMinVariance(S, longOnly)
  const lo = portfolioReturn(gmv, mu), hi = longOnly ? Math.max(...mu) : Math.max(...mu) * 1.25
  const out: FrontierPoint[] = []
  for (let i = 0; i < points; i++) {
    const t = lo + ((hi - lo) * i) / Math.max(1, points - 1)
    const w = minVarianceWeights(mu, S, t, longOnly)
    if (w) out.push({ ret: portfolioReturn(w, mu), vol: Math.sqrt(portfolioVariance(w, S)), w })
  }
  return out
}

/** Maximum Sharpe (tangency) portfolio: for the unconstrained case w ∝ Σ⁻¹(μ − r_f); long-only scans the frontier. */
export function tangency(mu: readonly number[], S: readonly (readonly number[])[], rf: number, longOnly: boolean): FrontierPoint | null {
  const fr = efficientFrontier(mu, S, longOnly ? 120 : 200, longOnly)
  let best: FrontierPoint | null = null, bs = -Infinity
  for (const f of fr) { const s = (f.ret - rf) / f.vol; if (s > bs) { bs = s; best = f } }
  return best
}

/** Risk contributions: RC_i = w_i (Σw)_i / σ_p; they add up to the portfolio volatility. */
export function riskContributions(w: readonly number[], S: readonly (readonly number[])[]) {
  const sw = w.map((_, i) => sum(w.map((x, j) => x * S[i][j])))
  const vol = Math.sqrt(sum(w.map((x, i) => x * sw[i])))
  return { vol, marginal: sw.map((v) => (vol > 0 ? v / vol : 0)), contribution: w.map((x, i) => (vol > 0 ? (x * sw[i]) / vol : 0)) }
}

/** Equal-risk-contribution weights by the cyclical fixed-point iteration w_i ← (1/σ_i-like) on the Σ w system (Spinu / Maillard iteration). */
export function equalRiskContribution(S: readonly (readonly number[])[], iters = 500): number[] {
  const p = S.length
  let w = new Array<number>(p).fill(1 / p)
  for (let it = 0; it < iters; it++) {
    const sw = w.map((_, i) => sum(w.map((x, j) => x * S[i][j])))
    const next = w.map((x, i) => (sw[i] > 0 ? x * Math.sqrt((1 / p) / ((x * sw[i]) / sum(w.map((y, k) => y * sw[k])))) : x))
    const s = sum(next)
    w = next.map((v) => v / s)
  }
  return w
}

// ─── Black–Scholes and implied volatility ───────────────────────────────────────────

export const normalCdf = (x: number) => 0.5 * erfc(-x / Math.SQRT2)

export interface BsInput { S: number; K: number; T: number; r: number; q?: number; sigma: number; call: boolean }

export function bsPrice({ S, K, T, r, q = 0, sigma, call }: BsInput): number {
  if (T <= 0) return Math.max(0, call ? S - K : K - S)
  const sd = sigma * Math.sqrt(T)
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / sd, d2 = d1 - sd
  return call ? S * Math.exp(-q * T) * normalCdf(d1) - K * Math.exp(-r * T) * normalCdf(d2) : K * Math.exp(-r * T) * normalCdf(-d2) - S * Math.exp(-q * T) * normalCdf(-d1)
}
export function bsDelta({ S, K, T, r, q = 0, sigma, call }: BsInput): number {
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T))
  return call ? Math.exp(-q * T) * normalCdf(d1) : -Math.exp(-q * T) * normalCdf(-d1)
}
export function bsVega({ S, K, T, r, q = 0, sigma }: BsInput): number {
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T))
  return S * Math.exp(-q * T) * normalPdf(d1) * Math.sqrt(T)
}

/** Implied volatility by Brent-like bisection on [1e-4, 5]; returns NaN when the price violates no-arbitrage bounds. */
export function impliedVol(price: number, S: number, K: number, T: number, r: number, call: boolean, q = 0): number {
  const lower = call ? Math.max(0, S * Math.exp(-q * T) - K * Math.exp(-r * T)) : Math.max(0, K * Math.exp(-r * T) - S * Math.exp(-q * T))
  const upper = call ? S * Math.exp(-q * T) : K * Math.exp(-r * T)
  if (!(price > lower + 1e-10) || price >= upper) return NaN
  let lo = 1e-4, hi = 5
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2
    const p = bsPrice({ S, K, T, r, q, sigma: mid, call })
    if (p > price) hi = mid; else lo = mid
  }
  return (lo + hi) / 2
}

/** Raw SVI total variance parametrisation w(k) = a + b (ρ (k − m) + √((k − m)² + s²)) used to generate smooth synthetic smiles. */
export const sviVariance = (k: number, p: { a: number; b: number; rho: number; m: number; s: number }) => p.a + p.b * (p.rho * (k - p.m) + Math.sqrt((k - p.m) ** 2 + p.s * p.s))

// ─── event study ────────────────────────────────────────────────────────────────────

/** OLS market model R = α + β R_m on the estimation window. */
export function marketModel(stock: readonly number[], market: readonly number[]) {
  const n = stock.length
  const mx = mean(market), my = mean(stock)
  const sxx = sum(market.map((x) => (x - mx) ** 2)), sxy = sum(market.map((x, i) => (x - mx) * (stock[i] - my)))
  const beta = sxx > 0 ? sxy / sxx : 0, alpha = my - beta * mx
  const resid = stock.map((y, i) => y - alpha - beta * market[i])
  const sd = Math.sqrt(sum(resid.map((e) => e * e)) / Math.max(1, n - 2))
  return { alpha, beta, sd, n }
}

export interface EventRow { event: string; offset: number; stock: number; market: number }

/** Abnormal returns per event in [−pre, +post] around day 0 using the market model fitted on offsets < −pre; cumulates to CAR and averages across events (CAAR) with a cross-sectional t-test. */
export function eventStudy(rows: readonly EventRow[], pre: number, post: number) {
  const events = [...new Set(rows.map((r) => r.event))]
  const days = Array.from({ length: pre + post + 1 }, (_, i) => i - pre)
  const perEvent = events.map((e) => {
    const er = rows.filter((r) => r.event === e)
    const est = er.filter((r) => r.offset < -pre)
    const mm = marketModel(est.map((r) => r.stock), est.map((r) => r.market))
    const ar = days.map((d) => { const r = er.find((x) => x.offset === d); return r ? r.stock - mm.alpha - mm.beta * r.market : NaN })
    let acc = 0
    const car = ar.map((v) => (acc += Number.isFinite(v) ? v : 0))
    return { event: e, mm, ar, car }
  }).filter((e) => e.mm.n >= 5)
  const n = perEvent.length
  const aar = days.map((_, i) => mean(perEvent.map((e) => e.ar[i]).filter(Number.isFinite)))
  const caar = days.map((_, i) => mean(perEvent.map((e) => e.car[i])))
  const sdCar = days.map((_, i) => { const m = caar[i]; return Math.sqrt(sum(perEvent.map((e) => (e.car[i] - m) ** 2)) / Math.max(1, n - 1)) })
  const t = caar.map((v, i) => (sdCar[i] > 0 ? v / (sdCar[i] / Math.sqrt(n)) : NaN))
  return { days, perEvent, aar, caar, sdCar, t, n }
}

// ─── tail risk ──────────────────────────────────────────────────────────────────────

/** Historical VaR (loss quantile) and expected shortfall of a P&L sample at confidence 1 − alpha: VaR = −q_α, ES = −E[x | x ≤ q_α]. */
export function historicalVarEs(pnl: readonly number[], alpha: number) {
  const s = [...pnl].sort((a, b) => a - b)
  const k = Math.max(1, Math.floor(alpha * s.length))
  const q = s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(alpha * s.length) - 1))] : NaN
  return { var: -q, es: -mean(s.slice(0, k)), tail: k }
}
export function normalVarEs(mu: number, sd: number, alpha: number) {
  const z = normalQuantile(alpha)
  return { var: -(mu + sd * z), es: -(mu - (sd * normalPdf(z)) / alpha) }
}
/** Cornish–Fisher VaR: adjusts the normal quantile for the sample skewness and excess kurtosis. */
export function cornishFisherVar(pnl: readonly number[], alpha: number) {
  const m = mean(pnl), sd = Math.sqrt(sum(pnl.map((x) => (x - m) ** 2)) / Math.max(1, pnl.length - 1)) || 1
  const sk = mean(pnl.map((x) => ((x - m) / sd) ** 3)), ku = mean(pnl.map((x) => ((x - m) / sd) ** 4)) - 3
  const z = normalQuantile(alpha)
  const zc = z + ((z * z - 1) * sk) / 6 + ((z ** 3 - 3 * z) * ku) / 24 - ((2 * z ** 3 - 5 * z) * sk * sk) / 36
  return { var: -(m + sd * zc), skew: sk, kurt: ku }
}

/** Kupiec proportion-of-failures log-likelihood ratio for the number of exceedances x out of n at coverage alpha (χ²₁ under the null). */
export function kupiecLR(x: number, n: number, alpha: number) {
  const p = x / n
  const l = (q: number) => (x > 0 ? x * Math.log(q) : 0) + (n - x > 0 ? (n - x) * Math.log(1 - q) : 0)
  return -2 * (l(alpha) - l(Math.min(1 - 1e-12, Math.max(1e-12, p))))
}

/** Random-portfolio cloud on the simplex (Dirichlet(1)) for plotting the feasible set. */
export function randomPortfolios(mu: readonly number[], S: readonly (readonly number[])[], n: number, seed: number): FrontierPoint[] {
  const rng = createRng(seed)
  return Array.from({ length: n }, () => {
    const e = mu.map(() => -Math.log(1 - rng()))
    const s = sum(e), w = e.map((v) => v / s)
    return { ret: portfolioReturn(w, mu), vol: Math.sqrt(portfolioVariance(w, S)), w }
  })
}
