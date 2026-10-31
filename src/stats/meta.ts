import { normalQuantile, studentTCdf, logGamma } from './distributions'

export const Z95 = normalQuantile(0.975)

export interface Study { name: string; effect: number; se: number; row: number }

/** Standard error recovered from a confidence interval of the given level: (upper − lower) / (2·z). On a ratio scale pass log bounds. */
export const seFromCi = (lo: number, hi: number, level = 0.95) => (hi - lo) / (2 * normalQuantile((1 + level) / 2))

// ─── regularised incomplete gamma, for the χ² tail of Cochran's Q ─────────

function gammaP(a: number, x: number): number {
  if (x <= 0) return 0
  if (x < a + 1) {
    let sum = 1 / a
    let term = sum
    for (let n = 1; n < 500; n++) { term *= x / (a + n); sum += term; if (Math.abs(term) < Math.abs(sum) * 1e-14) break }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a))
  }
  // continued fraction for Q(a, x)
  let b = x + 1 - a
  let c = 1 / 1e-300
  let d = 1 / b
  let h = d
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
  return 1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * h
}

/** Upper tail P(χ²_df ≥ q). */
export const chiSquareSf = (q: number, df: number) => (df > 0 && q > 0 ? 1 - gammaP(df / 2, q / 2) : 1)

export type MetaModel = 'fixed' | 'random'

export interface MetaResult {
  model: MetaModel
  k: number
  effect: number
  se: number
  lo: number
  hi: number
  z: number
  /** Two-sided p-value of the pooled effect against 0. */
  p: number
  /** Cochran's Q, its degrees of freedom and p-value; I² (% of variability beyond chance) and the between-study variance τ² (DerSimonian–Laird). */
  Q: number
  df: number
  pQ: number
  I2: number
  tau2: number
  /** Each study's weight as a share of the total (sums to 1), under the chosen model. */
  weights: number[]
}

/**
 * Inverse-variance meta-analysis. Fixed effect: w = 1/se², pooled = Σwθ / Σw. Random effects (DerSimonian–Laird): w* = 1/(se² + τ²) with
 * τ² = max(0, (Q − df) / (Σw − Σw²/Σw)). Assumes the effects are on a scale where they are approximately normal (log for ratios) and independent.
 */
export function metaAnalysis(studies: readonly { effect: number; se: number }[], model: MetaModel): MetaResult | null {
  const s = studies.filter((x) => Number.isFinite(x.effect) && Number.isFinite(x.se) && x.se > 0)
  const k = s.length
  if (!k) return null
  const w = s.map((x) => 1 / x.se ** 2)
  const sw = w.reduce((a, b) => a + b, 0)
  const fixed = s.reduce((a, x, i) => a + w[i] * x.effect, 0) / sw
  const Q = s.reduce((a, x, i) => a + w[i] * (x.effect - fixed) ** 2, 0)
  const df = k - 1
  const C = sw - w.reduce((a, b) => a + b * b, 0) / sw
  const tau2 = model === 'random' && df > 0 && C > 0 ? Math.max(0, (Q - df) / C) : 0
  const ws = s.map((x) => 1 / (x.se ** 2 + tau2))
  const sws = ws.reduce((a, b) => a + b, 0)
  const effect = s.reduce((a, x, i) => a + ws[i] * x.effect, 0) / sws
  const se = 1 / Math.sqrt(sws)
  const z = effect / se
  return {
    model, k, effect, se, lo: effect - Z95 * se, hi: effect + Z95 * se, z, p: 2 * (1 - normalCdf(Math.abs(z))), Q, df, pQ: df > 0 ? chiSquareSf(Q, df) : 1,
    I2: Q > 0 && df > 0 ? Math.max(0, (Q - df) / Q) : 0, tau2, weights: ws.map((x) => x / sws),
  }
}

function normalCdf(x: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2)
  return 0.5 * (1 + (x >= 0 ? y : -y))
}

export interface Egger { intercept: number; se: number; t: number; df: number; p: number; slope: number }

/**
 * Egger's regression test for funnel-plot asymmetry: regress the standardised effect z = θ/se on precision 1/se; an intercept far from 0
 * means small, imprecise studies report systematically different effects. It needs ≥ 3 studies, and asymmetry has many causes
 * besides publication bias (heterogeneity, chance, different populations in small studies).
 */
export function eggerTest(studies: readonly { effect: number; se: number }[]): Egger | null {
  const s = studies.filter((x) => Number.isFinite(x.effect) && x.se > 0)
  const n = s.length
  if (n < 3) return null
  const xs = s.map((x) => 1 / x.se)
  const ys = s.map((x) => x.effect / x.se)
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0)
  if (sxx === 0) return null
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx
  const intercept = my - slope * mx
  const rss = ys.reduce((a, y, i) => a + (y - intercept - slope * xs[i]) ** 2, 0)
  const df = n - 2
  const s2 = rss / df
  const se = Math.sqrt(s2 * (1 / n + (mx * mx) / sxx))
  const t = se > 0 ? intercept / se : 0
  return { intercept, se, t, df, p: se > 0 ? 2 * (1 - studentTCdf(Math.abs(t), df)) : 1, slope }
}

/** Funnel limits at a given standard error: pooled ± z·se (the region where 100·level % of studies fall if there is no bias or heterogeneity). */
export const funnelLimits = (pooled: number, se: number, level = 0.95) => {
  const z = normalQuantile((1 + level) / 2)
  return [pooled - z * se, pooled + z * se] as const
}
