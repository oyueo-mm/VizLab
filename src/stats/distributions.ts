/**
 * Quantile and distribution functions used by the Q-Q plot and confidence intervals.
 * Accuracy targets are documented per function and verified against reference values in tests.
 */

/**
 * Standard normal quantile Φ⁻¹(p) — Acklam's rational approximation (relative error < 1.15e−9).
 */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const pLow = 0.02425
  let x: number
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p))
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  } else if (p <= 1 - pLow) {
    const q = p - 0.5
    const r = q * q
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  return x
}

/** Complementary error function (Numerical Recipes erfcc, fractional error < 1.2e−7 everywhere). */
export function erfc(x: number): number {
  const z = Math.abs(x)
  const t = 1 / (1 + 0.5 * z)
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))))
  return x >= 0 ? r : 2 - r
}

export const normalPdf = (x: number, mean = 0, sd = 1) => Math.exp(-0.5 * ((x - mean) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI))

/** ln Γ(x) for x > 0 (Lanczos, g = 7, n = 9; ~15 significant digits). */
export function logGamma(x: number): number {
  const g = 7
  const coef = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
  x -= 1
  let a = coef[0]
  const t = x + g + 0.5
  for (let i = 1; i < g + 2; i++) a += coef[i] / (x + i)
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
}

/** Continued fraction for the incomplete beta function (modified Lentz, Numerical Recipes betacf). */
function betaContinuedFraction(a: number, b: number, x: number) {
  const MAXIT = 300
  const EPS = 3e-16
  const FPMIN = 1e-300
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return h
}

/** Regularized incomplete beta I_x(a, b). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  return x < (a + 1) / (a + b + 2) ? (bt * betaContinuedFraction(a, b, x)) / a : 1 - (bt * betaContinuedFraction(b, a, 1 - x)) / b
}

/** Student t CDF with ν degrees of freedom: F(t) = 1 − ½·I_{ν/(ν+t²)}(ν/2, ½) for t ≥ 0. */
export function studentTCdf(t: number, df: number): number {
  if (!(df > 0)) return NaN
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0
  const tail = 0.5 * incompleteBeta(df / (df + t * t), df / 2, 0.5)
  return t >= 0 ? 1 - tail : tail
}

/** Student t quantile: bracketed Newton/bisection on the CDF (|error| < 1e−10 in t). */
export function studentTQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1) || !(df > 0)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN
  if (p === 0.5) return 0
  if (p < 0.5) return -studentTQuantile(1 - p, df)
  let lo = 0
  let hi = Math.max(2, normalQuantile(p) * 2)
  while (studentTCdf(hi, df) < p) hi *= 2
  let x = Math.min(hi, Math.max(lo, normalQuantile(p)))
  for (let i = 0; i < 200; i++) {
    const f = studentTCdf(x, df) - p
    if (Math.abs(f) < 1e-14) break
    if (f > 0) hi = x
    else lo = x
    const pdf = Math.exp(logGamma((df + 1) / 2) - logGamma(df / 2) - 0.5 * Math.log(df * Math.PI) - ((df + 1) / 2) * Math.log(1 + (x * x) / df))
    let next = x - f / pdf
    if (!(next > lo && next < hi)) next = (lo + hi) / 2
    if (Math.abs(next - x) < 1e-12) { x = next; break }
    x = next
  }
  return x
}

export type ReferenceDist = 'normal' | 'uniform' | 'exponential'

/** Quantile of the *standard* member of a location–scale family. */
export function standardQuantile(dist: ReferenceDist, p: number): number {
  if (dist === 'normal') return normalQuantile(p)
  if (dist === 'uniform') return p
  return -Math.log(1 - p)
}

/**
 * Plotting positions pᵢ = (i − a) / (n + 1 − 2a), i = 1…n.
 * a = 3/8 (Blom; R's ppoints for n ≤ 10), a = 1/2 (Hazen; R's ppoints for n > 10), a = 0 (Weibull, i/(n+1)).
 */
export function plottingPositions(n: number, a: number) {
  return Array.from({ length: n }, (_, k) => (k + 1 - a) / (n + 1 - 2 * a))
}
