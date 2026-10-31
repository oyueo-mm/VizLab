import { normalQuantile } from './distributions'

/** Survival analysis: Kaplan–Meier, Nelson–Aalen, the log-rank test and risk tables, with right-censored data. */

export interface Subject { time: number; /** true = the event was observed, false = censored. */ event: boolean; row: number }

export interface SurvivalStep { time: number; atRisk: number; events: number; censored: number; surv: number; lo: number; hi: number; cumHaz: number; hazVar: number }

export interface SurvivalCurve { steps: SurvivalStep[]; n: number; events: number; /** Smallest time at which the survival function drops to 0.5 or below, or null. */ median: number | null }

/** Kaplan–Meier estimate with Greenwood variance and a log(−log) confidence band; the same pass yields the Nelson–Aalen cumulative hazard. */
export function kaplanMeier(subjects: readonly Subject[], level = 0.95): SurvivalCurve {
  const times = [...new Set(subjects.map((s) => s.time))].sort((a, b) => a - b)
  const z = normalQuantile(1 - (1 - level) / 2)
  let atRisk = subjects.length, surv = 1, greenwood = 0, haz = 0, hazVar = 0
  const steps: SurvivalStep[] = []
  for (const t of times) {
    const here = subjects.filter((s) => s.time === t)
    const d = here.filter((s) => s.event).length, c = here.length - d
    if (d > 0) {
      surv *= 1 - d / atRisk
      if (atRisk > d) greenwood += d / (atRisk * (atRisk - d))
      haz += d / atRisk
      hazVar += d / (atRisk * atRisk)
    }
    let lo = surv, hi = surv
    if (d > 0 || steps.length === 0) {
      if (surv > 0 && surv < 1 && greenwood > 0) {
        // log(−log S) interval keeps the band inside [0, 1]
        const se = Math.sqrt(greenwood) / Math.abs(Math.log(surv))
        lo = surv ** Math.exp(z * se)
        hi = surv ** Math.exp(-z * se)
      } else if (surv === 0) { lo = 0; hi = 0 }
    }
    steps.push({ time: t, atRisk, events: d, censored: c, surv, lo, hi, cumHaz: haz, hazVar })
    atRisk -= here.length
  }
  const med = steps.find((s) => s.surv <= 0.5)
  return { steps, n: subjects.length, events: subjects.filter((s) => s.event).length, median: med ? med.time : null }
}

/** Survival probability at time t (right-continuous step function). */
export function survivalAt(curve: SurvivalCurve, t: number): number {
  let s = 1
  for (const st of curve.steps) { if (st.time <= t) s = st.surv; else break }
  return s
}

export function cumHazardAt(curve: SurvivalCurve, t: number): number {
  let h = 0
  for (const st of curve.steps) { if (st.time <= t) h = st.cumHaz; else break }
  return h
}

/** Nelson–Aalen confidence limits (log-transformed, so the lower limit stays positive). */
export function nelsonAalenBand(curve: SurvivalCurve, level = 0.95): { time: number; h: number; lo: number; hi: number }[] {
  const z = normalQuantile(1 - (1 - level) / 2)
  return curve.steps.map((s) => {
    if (s.cumHaz <= 0) return { time: s.time, h: 0, lo: 0, hi: 0 }
    const f = Math.exp((z * Math.sqrt(s.hazVar)) / s.cumHaz)
    return { time: s.time, h: s.cumHaz, lo: s.cumHaz / f, hi: s.cumHaz * f }
  })
}

/** Number still at risk at each requested time (subjects whose follow-up has not ended before t). */
export function riskTable(subjects: readonly Subject[], times: readonly number[]): number[] {
  return times.map((t) => subjects.filter((s) => s.time >= t).length)
}

/**
 * Log-rank test for two or more groups (Mantel–Haenszel): chi-square on k − 1 degrees of freedom from the observed minus expected events of the
 * first k − 1 groups and their hypergeometric covariance.
 */
export function logRank(groups: readonly (readonly Subject[])[]): { chi2: number; df: number; p: number } {
  const k = groups.length
  if (k < 2) return { chi2: NaN, df: 0, p: NaN }
  const times = [...new Set(groups.flat().filter((s) => s.event).map((s) => s.time))].sort((a, b) => a - b)
  const O = new Array(k).fill(0), E = new Array(k).fill(0)
  const V = Array.from({ length: k }, () => new Array(k).fill(0))
  for (const t of times) {
    const n = groups.map((g) => g.filter((s) => s.time >= t).length)
    const d = groups.map((g) => g.filter((s) => s.time === t && s.event).length)
    const N = n.reduce((a, b) => a + b, 0), D = d.reduce((a, b) => a + b, 0)
    if (N < 2) continue
    for (let i = 0; i < k; i++) {
      O[i] += d[i]
      E[i] += (n[i] * D) / N
      for (let j = 0; j < k; j++) V[i][j] += ((D * (N - D)) / (N * N * (N - 1))) * n[i] * ((i === j ? N : 0) - n[j])
    }
  }
  const dfree = k - 1
  const diff = Array.from({ length: dfree }, (_, i) => O[i] - E[i])
  const cov = V.slice(0, dfree).map((r) => r.slice(0, dfree))
  const inv = invertSmall(cov)
  const chi2 = inv ? diff.reduce((s, a, i) => s + a * inv[i].reduce((q, v, j) => q + v * diff[j], 0), 0) : NaN
  return { chi2, df: dfree, p: Number.isFinite(chi2) ? chiSquareSf(chi2, dfree) : NaN }
}

function invertSmall(a: number[][]): number[][] | null {
  const n = a.length
  const m = a.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r
    if (Math.abs(m[p][c]) < 1e-12) return null
    ;[m[c], m[p]] = [m[p], m[c]]
    const d = m[c][c]
    for (let j = 0; j < 2 * n; j++) m[c][j] /= d
    for (let r = 0; r < n; r++) if (r !== c) { const f = m[r][c]; for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[c][j] }
  }
  return m.map((r) => r.slice(n))
}

/** Survival function of the chi-square distribution: regularised upper incomplete gamma Q(df/2, x/2) by series / continued fraction. */
export function chiSquareSf(x: number, df: number): number {
  if (x <= 0) return 1
  const a = df / 2, xx = x / 2
  const lg = (z: number): number => { const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let y = z, t = z + 5.5; t -= (z + 0.5) * Math.log(t); let s = 1.000000000190015; for (const cj of c) s += cj / ++y; return -t + Math.log((2.5066282746310005 * s) / z) }
  if (xx < a + 1) {
    let sum = 1 / a, term = sum
    for (let n = 1; n < 500; n++) { term *= xx / (a + n); sum += term; if (Math.abs(term) < Math.abs(sum) * 1e-14) break }
    return 1 - sum * Math.exp(-xx + a * Math.log(xx) - lg(a))
  }
  let b = xx + 1 - a, c = 1e300, d = 1 / b, h = d
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-14) break
  }
  return Math.exp(-xx + a * Math.log(xx) - lg(a)) * h
}
