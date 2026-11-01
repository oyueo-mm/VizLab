import { createRng, type Rng } from '../lib/random'
import { logGamma, normalQuantile } from './distributions'

/** Time-series analysis (ACF/PACF/CCF/STL), Bayesian sampling and checks, competing-risk survival and extreme-value statistics. */

const sum = (a: readonly number[]) => { let s = 0; for (const v of a) s += v; return s }
const mean = (a: readonly number[]) => (a.length ? sum(a) / a.length : 0)
export const sdOf = (a: readonly number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(sum(a.map((v) => (v - m) ** 2)) / (a.length - 1)) }
const medianOf = (a: readonly number[]) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0 }

// ─── correlation functions ──────────────────────────────────────────────────────────

/** Sample autocorrelation r_0..r_maxLag (divisor n, as in R's acf). */
export function acf(x: readonly number[], maxLag: number): number[] {
  const n = x.length
  if (n < 2) return []
  const m = mean(x)
  const d = x.map((v) => v - m)
  const c0 = sum(d.map((v) => v * v))
  if (c0 === 0) return Array.from({ length: Math.min(maxLag, n - 1) + 1 }, (_, k) => (k === 0 ? 1 : 0))
  return Array.from({ length: Math.min(maxLag, n - 1) + 1 }, (_, k) => { let s = 0; for (let t = 0; t + k < n; t++) s += d[t] * d[t + k]; return s / c0 })
}

/** Partial autocorrelations at lags 1..maxLag by the Durbin–Levinson recursion. */
export function pacf(x: readonly number[], maxLag: number): number[] {
  const r = acf(x, maxLag)
  const K = r.length - 1
  const out: number[] = []
  let phi: number[] = []
  for (let k = 1; k <= K; k++) {
    let num = r[k], den = 1
    for (let j = 1; j < k; j++) { num -= phi[j - 1] * r[k - j]; den -= phi[j - 1] * r[j] }
    const a = den === 0 ? 0 : num / den
    const next = phi.map((p, j) => p - a * phi[k - 2 - j])
    phi = [...next, a]
    out.push(a)
  }
  return out
}

/** Cross-correlation r_xy(k) = corr(x_t, y_{t+k}) for k = −maxLag..maxLag (positive k: y lags behind x). */
export function ccf(x: readonly number[], y: readonly number[], maxLag: number): { lag: number; r: number }[] {
  const n = Math.min(x.length, y.length)
  if (n < 3) return []
  const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n))
  const dx = x.slice(0, n).map((v) => v - mx), dy = y.slice(0, n).map((v) => v - my)
  const sx = Math.sqrt(sum(dx.map((v) => v * v))), sy = Math.sqrt(sum(dy.map((v) => v * v)))
  const out: { lag: number; r: number }[] = []
  for (let k = -maxLag; k <= maxLag; k++) {
    if (Math.abs(k) >= n) continue
    let s = 0
    for (let t = 0; t < n; t++) { const u = t + k; if (u >= 0 && u < n) s += dx[t] * dy[u] }
    out.push({ lag: k, r: sx * sy === 0 ? 0 : s / (sx * sy) })
  }
  return out
}

/** Bartlett large-lag standard error of r_k under an MA(k−1) null: sqrt((1 + 2 Σ_{j<k} r_j²) / n). */
export const bartlettSe = (r: readonly number[], k: number, n: number) => Math.sqrt((1 + 2 * sum(r.slice(1, k).map((v) => v * v))) / n)

/** Ljung–Box Q statistic over lags 1..h. */
export const ljungBox = (r: readonly number[], n: number, h: number) => n * (n + 2) * sum(Array.from({ length: Math.min(h, r.length - 1) }, (_, i) => r[i + 1] ** 2 / (n - i - 1)))

// ─── STL decomposition ──────────────────────────────────────────────────────────────

const tricube = (u: number) => { const a = Math.abs(u); return a < 1 ? (1 - a ** 3) ** 3 : 0 }

/** Local linear regression at x0 over the q nearest points (xs ascending), tricube weights times `w`. */
function loessAt(xs: readonly number[], ys: readonly number[], w: readonly number[], q: number, x0: number): number {
  const n = xs.length
  if (!n) return 0
  const qq = Math.max(2, Math.min(q, n))
  // window of the qq nearest points: slide the start until the next point is not closer
  let best = 0
  for (let i = 1; i < n; i++) if (Math.abs(xs[i] - x0) < Math.abs(xs[best] - x0)) best = i
  let lo = Math.max(0, Math.min(n - qq, best - Math.floor(qq / 2)))
  while (lo > 0 && Math.abs(xs[lo - 1] - x0) < Math.abs(xs[lo + qq - 1] - x0)) lo--
  while (lo + qq < n && Math.abs(xs[lo + qq] - x0) < Math.abs(xs[lo] - x0)) lo++
  let h = Math.max(Math.abs(xs[lo] - x0), Math.abs(xs[lo + qq - 1] - x0))
  if (q > n) h *= q / n
  if (h <= 0) h = 1
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0
  for (let i = lo; i < lo + qq; i++) {
    const wi = tricube((xs[i] - x0) / (h * 1.000001)) * w[i]
    sw += wi; sx += wi * xs[i]; sy += wi * ys[i]; sxx += wi * xs[i] * xs[i]; sxy += wi * xs[i] * ys[i]
  }
  if (sw <= 0) return mean(ys.slice(lo, lo + qq))
  const det = sw * sxx - sx * sx
  if (Math.abs(det) < 1e-12 * (sw * sxx + 1e-30)) return sy / sw
  const b = (sw * sxy - sx * sy) / det
  const a = (sy - b * sx) / sw
  return a + b * x0
}

const loessSeries = (y: readonly number[], w: readonly number[], q: number) => { const xs = y.map((_, i) => i); return y.map((_, i) => loessAt(xs, y, w, q, i)) }
const movingAvg = (x: readonly number[], len: number) => Array.from({ length: x.length - len + 1 }, (_, i) => mean(x.slice(i, i + len)))
const odd = (v: number) => { const k = Math.max(3, Math.round(v)); return k % 2 ? k : k + 1 }

export interface StlResult { trend: number[]; seasonal: number[]; remainder: number[]; weights: number[]; seasonalStrength: number; trendStrength: number }

/** Seasonal-trend decomposition by loess (Cleveland et al., 1990): inner loop of cycle-subseries smoothing, low-pass filtering and trend smoothing, with optional bisquare robustness iterations. */
export function stl(y: readonly number[], period: number, { seasonal: ns0 = 7, inner = 2, outer = 0 }: { seasonal?: number; inner?: number; outer?: number } = {}): StlResult {
  const n = y.length, np = Math.max(2, Math.round(period))
  const ns = odd(ns0), nl = odd(np), nt = odd(Math.ceil((1.5 * np) / (1 - 1.5 / ns)))
  let trend = new Array<number>(n).fill(0), seas = new Array<number>(n).fill(0)
  let rob = new Array<number>(n).fill(1)
  for (let o = 0; o <= outer; o++) {
    for (let it = 0; it < inner; it++) {
      const detr = y.map((v, i) => v - trend[i])
      const C = new Array<number>(n + 2 * np).fill(0)
      for (let j = 0; j < np; j++) {
        const idx: number[] = []
        for (let t = j; t < n; t += np) idx.push(t)
        const xs = idx.map((_, k) => k), vals = idx.map((t) => detr[t]), ws = idx.map((t) => rob[t])
        for (let k = -1; k <= idx.length; k++) C[j + (k + 1) * np] = loessAt(xs, vals, ws, ns, k)
      }
      const low = loessSeries(movingAvg(movingAvg(movingAvg(C, np), np), 3), new Array(n).fill(1), nl)
      seas = C.slice(np, np + n).map((v, i) => v - low[i])
      trend = loessSeries(y.map((v, i) => v - seas[i]), rob, nt)
    }
    if (o < outer) {
      const r = y.map((v, i) => Math.abs(v - trend[i] - seas[i]))
      const h = 6 * medianOf(r) || 1
      rob = r.map((v) => { const u = v / h; return u < 1 ? (1 - u * u) ** 2 : 0 })
    }
  }
  const remainder = y.map((v, i) => v - trend[i] - seas[i])
  const vr = sdOf(remainder) ** 2
  return {
    trend, seasonal: seas, remainder, weights: rob,
    seasonalStrength: Math.max(0, 1 - vr / (sdOf(seas.map((s, i) => s + remainder[i])) ** 2 || 1)),
    trendStrength: Math.max(0, 1 - vr / (sdOf(trend.map((t, i) => t + remainder[i])) ** 2 || 1)),
  }
}

// ─── Bayesian helpers ───────────────────────────────────────────────────────────────

export const betaPdf = (x: number, a: number, b: number) => (x <= 0 || x >= 1 ? 0 : Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) + logGamma(a + b) - logGamma(a) - logGamma(b)))
export const gammaPdf = (x: number, shape: number, rate: number) => (x <= 0 ? 0 : Math.exp(shape * Math.log(rate) + (shape - 1) * Math.log(x) - rate * x - logGamma(shape)))

/** Gamma(shape, 1) variate (Marsaglia & Tsang). */
export function gammaSample(shape: number, rng: Rng): number {
  if (shape < 1) return gammaSample(shape + 1, rng) * rng() ** (1 / shape)
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x = rng.normal(), v = 1 + c * x
    while (v <= 0) { x = rng.normal(); v = 1 + c * x }
    v = v ** 3
    const u = rng()
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

/** Posterior draws (μ, σ) of a normal model under the Jeffreys prior p(μ, σ²) ∝ 1/σ²: σ² ~ Inv-χ²(n−1, s²), μ | σ² ~ N(x̄, σ²/n). */
export function normalPosterior(x: readonly number[], draws: number, rng: Rng): { mu: number; sigma: number }[] {
  const n = x.length
  if (n < 2) return []
  const m = mean(x), s2 = sdOf(x) ** 2
  return Array.from({ length: draws }, () => {
    const sig2 = ((n - 1) * s2) / (2 * gammaSample((n - 1) / 2, rng))
    return { mu: m + Math.sqrt(sig2 / n) * rng.normal(), sigma: Math.sqrt(sig2) }
  })
}

export interface McmcRun { chains: number[][][]; accept: number[] }

/** Random-walk Metropolis for a log-density; `init[c]` is the start of chain c. Returns draws[chain][step][dim]. */
export function metropolis(logp: (t: readonly number[]) => number, init: readonly (readonly number[])[], steps: number, prop: readonly number[], seed: number): McmcRun {
  const chains: number[][][] = [], accept: number[] = []
  init.forEach((start, c) => {
    const rng = createRng(seed + 101 * c)
    let cur = [...start], lp = logp(cur), acc = 0
    const out: number[][] = []
    for (let s = 0; s < steps; s++) {
      const cand = cur.map((v, j) => v + prop[j] * rng.normal())
      const lc = logp(cand)
      if (Math.log(rng()) < lc - lp) { cur = cand; lp = lc; acc++ }
      out.push(cur)
    }
    chains.push(out); accept.push(acc / Math.max(1, steps))
  })
  return { chains, accept }
}

/** Split-R̂ (Gelman et al.): each chain is cut in two halves, so a drifting chain also inflates R̂. */
export function rhat(chains: readonly (readonly number[])[]): number {
  const parts = chains.flatMap((c) => { const h = Math.floor(c.length / 2); return h >= 2 ? [c.slice(0, h), c.slice(h, 2 * h)] : [] })
  const m = parts.length, n = parts[0]?.length ?? 0
  if (m < 2 || n < 2) return NaN
  const means = parts.map(mean)
  const W = mean(parts.map((p) => sdOf(p) ** 2))
  const B = n * sdOf(means) ** 2
  if (W === 0) return 1
  return Math.sqrt(((n - 1) / n * W + B / n) / W)
}

/** Effective sample size of one chain: n / (1 + 2 Σ ρ_k) with Geyer's initial positive sequence truncation. */
export function ess(x: readonly number[]): number {
  const n = x.length
  if (n < 4) return n
  const r = acf(x, Math.min(n - 1, 400))
  let tau = 1
  for (let k = 1; k + 1 < r.length; k += 2) { const pair = r[k] + r[k + 1]; if (pair < 0) break; tau += 2 * pair }
  return Math.min(n, n / Math.max(1, tau))
}

/** Rank of every draw among all draws pooled across chains (1 = smallest), returned per chain. */
export function pooledRanks(chains: readonly (readonly number[])[]): number[][] {
  const all = chains.flatMap((c, ci) => c.map((v, i) => ({ v, ci, i })))
  all.sort((a, b) => a.v - b.v)
  const out = chains.map((c) => new Array<number>(c.length).fill(0))
  all.forEach((e, r) => { out[e.ci][e.i] = r + 1 })
  return out
}

/** Counts of ranks in `bins` equal-width bins over 1..total. */
export function rankHistogram(ranks: readonly number[], total: number, bins: number): number[] {
  const h = new Array<number>(bins).fill(0)
  for (const r of ranks) h[Math.min(bins - 1, Math.floor(((r - 1) / total) * bins))]++
  return h
}

export type SbcMode = 'correct' | 'overconfident' | 'underconfident' | 'biased'

/**
 * Simulation-based calibration for a normal mean with a N(m0, τ²) prior and known noise σ: θ ~ prior, y ~ N(θ, σ²), L posterior draws, rank of θ among them.
 * The `mode` perturbs the sampler (narrowed, widened or shifted posterior) to show how a faulty inference procedure bends the rank histogram.
 */
export function sbcRanks(n: number, sigma: number, { sims = 400, draws = 99, m0 = 0, tau = 1, mode = 'correct', seed = 1 }: { sims?: number; draws?: number; m0?: number; tau?: number; mode?: SbcMode; seed?: number } = {}): number[] {
  const rng = createRng(seed)
  const prec0 = 1 / tau ** 2, precL = n / sigma ** 2
  const sd = Math.sqrt(1 / (prec0 + precL))
  const ranks: number[] = []
  for (let s = 0; s < sims; s++) {
    const theta = m0 + tau * rng.normal()
    const ybar = theta + (sigma / Math.sqrt(n)) * rng.normal()
    const mu = (prec0 * m0 + precL * ybar) / (prec0 + precL)
    const scale = mode === 'overconfident' ? 0.5 : mode === 'underconfident' ? 2 : 1
    const shift = mode === 'biased' ? 0.6 * sd : 0
    let r = 0
    for (let d = 0; d < draws; d++) if (mu + shift + scale * sd * rng.normal() < theta) r++
    ranks.push(r)
  }
  return ranks
}

// ─── survival: hazards and competing risks ──────────────────────────────────────────

export interface TimedEvent { time: number; /** 0 = censored, 1..K = cause of failure. */ cause: number }

export interface CifStep { time: number; atRisk: number; surv: number; cif: number[]; naive: number[] }

/** Aalen–Johansen cumulative incidence per cause: CIF_k(t) = Σ_{t_i ≤ t} S(t_{i−1}) d_{k,i} / n_i, where S is the all-cause Kaplan–Meier curve. `naive` is 1 − KM treating other causes as censoring. */
export function cumulativeIncidence(data: readonly TimedEvent[], causes: number): CifStep[] {
  const sorted = [...data].sort((a, b) => a.time - b.time)
  const times = [...new Set(sorted.filter((d) => d.cause > 0).map((d) => d.time))]
  let atRisk = sorted.length
  let surv = 1
  const cif = new Array<number>(causes).fill(0)
  const kmCause = new Array<number>(causes).fill(1)
  const steps: CifStep[] = []
  let pos = 0
  for (const t of times) {
    while (pos < sorted.length && sorted[pos].time < t) { pos++; atRisk-- }
    // `atRisk` counts everyone with time ≥ t
    const here = sorted.filter((d) => d.time === t)
    const dAll = here.filter((d) => d.cause > 0).length
    for (let k = 0; k < causes; k++) {
      const dk = here.filter((d) => d.cause === k + 1).length
      cif[k] += (surv * dk) / atRisk
      kmCause[k] *= 1 - dk / atRisk
    }
    surv *= 1 - dAll / atRisk
    steps.push({ time: t, atRisk, surv, cif: [...cif], naive: kmCause.map((v) => 1 - v) })
  }
  return steps
}

/** Kernel-smoothed hazard from Nelson–Aalen increments, ĥ(t) = (1/b) Σ K((t − t_i)/b) ΔĤ(t_i) with an Epanechnikov kernel. */
export function kernelHazard(times: readonly number[], events: readonly boolean[], bandwidth: number, grid: readonly number[]): number[] {
  const order = times.map((_, i) => i).sort((a, b) => times[a] - times[b])
  const inc: { t: number; dH: number }[] = []
  let atRisk = times.length
  for (let p = 0; p < order.length;) {
    const t = times[order[p]]
    let d = 0, c = 0
    const n0 = atRisk
    while (p < order.length && times[order[p]] === t) { if (events[order[p]]) d++; else c++; p++ }
    atRisk -= d + c
    if (d > 0) inc.push({ t, dH: d / n0 })
  }
  const K = (u: number) => (Math.abs(u) < 1 ? 0.75 * (1 - u * u) : 0)
  return grid.map((g) => sum(inc.map((e) => K((g - e.t) / bandwidth) * e.dH)) / bandwidth)
}

/** Weibull maximum likelihood with right censoring: S(t) = exp(−(t/λ)^k). Solves the profile score for k by bisection. */
export function weibullMle(times: readonly number[], events: readonly boolean[]): { shape: number; scale: number } | null {
  const d = events.filter(Boolean).length
  const pos = times.map((t, i) => ({ t, e: events[i] })).filter((p) => p.t > 0)
  if (d < 2 || pos.length < 3) return null
  const slog = sum(pos.filter((p) => p.e).map((p) => Math.log(p.t)))
  const score = (k: number) => { const a = sum(pos.map((p) => p.t ** k * Math.log(p.t))), b = sum(pos.map((p) => p.t ** k)); return a / b - 1 / k - slog / d }
  let lo = 0.05, hi = 20
  if (score(lo) * score(hi) > 0) return null
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (score(lo) * score(mid) <= 0) hi = mid; else lo = mid }
  const k = (lo + hi) / 2
  return { shape: k, scale: (sum(pos.map((p) => p.t ** k)) / d) ** (1 / k) }
}

// ─── extreme values ─────────────────────────────────────────────────────────────────

export interface Gev { loc: number; scale: number; /** Hosking's k = −ξ. */ k: number }

const gammaFn = (x: number) => Math.exp(logGamma(x))

/** GEV parameters by L-moments (Hosking, Wallis & Wood, 1985). */
export function gevLMoments(x: readonly number[]): Gev | null {
  const n = x.length
  if (n < 8) return null
  const s = [...x].sort((a, b) => a - b)
  let b0 = 0, b1 = 0, b2 = 0
  s.forEach((v, i) => { b0 += v; b1 += (i / (n - 1)) * v; b2 += ((i * (i - 1)) / ((n - 1) * (n - 2))) * v })
  b0 /= n; b1 /= n; b2 /= n
  const l1 = b0, l2 = 2 * b1 - b0, l3 = 6 * b2 - 6 * b1 + b0
  if (l2 <= 0) return null
  const t3 = l3 / l2
  const c = 2 / (3 + t3) - Math.log(2) / Math.log(3)
  const k = 7.859 * c + 2.9554 * c * c
  if (Math.abs(k) < 1e-6) { const a = l2 / Math.LN2; return { loc: l1 - 0.5772156649 * a, scale: a, k: 0 } }
  const g = gammaFn(1 + k)
  const a = (l2 * k) / ((1 - 2 ** -k) * g)
  return { loc: l1 + (a * (g - 1)) / k, scale: a, k }
}

/** Quantile of the GEV at non-exceedance probability F. */
export function gevQuantile(g: Gev, F: number): number {
  const y = -Math.log(F)
  return Math.abs(g.k) < 1e-9 ? g.loc - g.scale * Math.log(y) : g.loc + (g.scale / g.k) * (1 - y ** g.k)
}

/** Return level for return period T (years): the 1 − 1/T quantile of the annual-maximum distribution. */
export const returnLevel = (g: Gev, T: number) => gevQuantile(g, 1 - 1 / T)

/** Percentile bootstrap band of the fitted return-level curve. */
export function returnLevelBand(x: readonly number[], periods: readonly number[], reps: number, level: number, seed: number) {
  const rng = createRng(seed)
  const draws = periods.map(() => [] as number[])
  for (let r = 0; r < reps; r++) {
    const sample = x.map(() => x[Math.floor(rng() * x.length)])
    const g = gevLMoments(sample)
    if (g) periods.forEach((T, i) => { const v = returnLevel(g, T); if (Number.isFinite(v)) draws[i].push(v) })
  }
  const q = (a: number[], p: number) => { const s = [...a].sort((u, v) => u - v); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))] : NaN }
  return periods.map((_, i) => ({ lo: q(draws[i], (1 - level) / 2), hi: q(draws[i], 1 - (1 - level) / 2) }))
}

/** Weibull plotting positions F_i = (i − 0.44)/(n + 0.12) (Gringorten), the usual choice for extreme-value plots. */
export const gringorten = (n: number) => Array.from({ length: n }, (_, i) => (i + 1 - 0.44) / (n + 0.12))

export const zOf = (level: number) => normalQuantile(1 - (1 - level) / 2)

// ─── dependence ─────────────────────────────────────────────────────────────────────

const ranksOf = (x: readonly number[]) => { const o = x.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]); const r = new Array<number>(x.length); for (let i = 0; i < o.length;) { let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++; for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2 + 1; i = j + 1 } return r }

export function pearsonR(x: readonly number[], y: readonly number[]): number {
  const mx = mean(x), my = mean(y)
  let sxy = 0, sxx = 0, syy = 0
  x.forEach((v, i) => { sxy += (v - mx) * (y[i] - my); sxx += (v - mx) ** 2; syy += (y[i] - my) ** 2 })
  return sxx * syy ? sxy / Math.sqrt(sxx * syy) : 0
}
export const spearmanR = (x: readonly number[], y: readonly number[]) => pearsonR(ranksOf(x), ranksOf(y))

/** Mutual information (nats) estimated from a k × k equal-frequency histogram. */
export function mutualInformation(x: readonly number[], y: readonly number[], bins: number): number {
  const n = x.length
  if (n < 10) return 0
  const rx = ranksOf(x), ry = ranksOf(y)
  const bx = rx.map((r) => Math.min(bins - 1, Math.floor(((r - 1) / n) * bins))), by = ry.map((r) => Math.min(bins - 1, Math.floor(((r - 1) / n) * bins)))
  const joint = Array.from({ length: bins }, () => new Array<number>(bins).fill(0))
  bx.forEach((a, i) => { joint[a][by[i]]++ })
  const px = joint.map((r) => sum(r) / n), py = Array.from({ length: bins }, (_, j) => sum(joint.map((r) => r[j])) / n)
  let mi = 0
  for (let i = 0; i < bins; i++) for (let j = 0; j < bins; j++) { const p = joint[i][j] / n; if (p > 0) mi += p * Math.log(p / (px[i] * py[j])) }
  return mi
}
