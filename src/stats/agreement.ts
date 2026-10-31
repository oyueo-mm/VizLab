import { standardDeviation } from './descriptive'
import { normalQuantile, studentTQuantile } from './distributions'

// ─── Bland–Altman ───────────────────────────────────────────────────────────

export type DiffMode = 'difference' | 'percent' | 'ratio'

export interface BAPoint { row: number; a: number; b: number; mean: number; diff: number; outside: boolean }

export interface BlandAltman {
  n: number
  mode: DiffMode
  /** Mean of the differences (the systematic bias) and their standard deviation. */
  bias: number
  sd: number
  /** Limits of agreement: bias ± z·sd (z = 1.96 by default). */
  loaLo: number
  loaHi: number
  biasCi: [number, number]
  loaLoCi: [number, number]
  loaHiCi: [number, number]
  /** Regression of the difference on the mean: a slope far from 0 means the bias depends on the size of the measurement. */
  slope: number
  intercept: number
  points: BAPoint[]
}

/**
 * Bland–Altman agreement of two measurement methods. For each pair, x = (A + B)/2 and y = A − B (or the percent difference
 * (A − B)/mean·100, or ln(A/B) for the ratio form on positive data). The limits of agreement are bias ± 1.96·SD, which assume the differences are roughly
 * normal and do not depend on the size of the measurement; the 95 % intervals use the t distribution (Bland & Altman 1999).
 */
export function blandAltman(pairs: readonly { a: number; b: number; row: number }[], mode: DiffMode = 'difference', level = 0.95): BlandAltman | null {
  const usable = pairs.filter((p) => Number.isFinite(p.a) && Number.isFinite(p.b) && (mode !== 'ratio' || (p.a > 0 && p.b > 0)) && (mode !== 'percent' || p.a + p.b !== 0))
  const n = usable.length
  if (n < 3) return null
  const pts = usable.map((p) => {
    const mean = mode === 'ratio' ? (Math.log(p.a) + Math.log(p.b)) / 2 : (p.a + p.b) / 2
    const diff = mode === 'difference' ? p.a - p.b : mode === 'percent' ? ((p.a - p.b) / ((p.a + p.b) / 2)) * 100 : Math.log(p.a / p.b)
    return { row: p.row, a: p.a, b: p.b, mean, diff, outside: false }
  })
  const bias = pts.reduce((s, p) => s + p.diff, 0) / n
  const sd = standardDeviation(pts.map((p) => p.diff))
  const z = normalQuantile((1 + level) / 2)
  const t = studentTQuantile((1 + level) / 2, n - 1)
  const loaLo = bias - z * sd
  const loaHi = bias + z * sd
  const seBias = sd / Math.sqrt(n)
  const seLoa = sd * Math.sqrt(1 / n + (z * z) / (2 * (n - 1)))
  const mx = pts.reduce((s, p) => s + p.mean, 0) / n
  const sxx = pts.reduce((s, p) => s + (p.mean - mx) ** 2, 0)
  const slope = sxx > 0 ? pts.reduce((s, p) => s + (p.mean - mx) * (p.diff - bias), 0) / sxx : 0
  return {
    n, mode, bias, sd, loaLo, loaHi, biasCi: [bias - t * seBias, bias + t * seBias], loaLoCi: [loaLo - t * seLoa, loaLo + t * seLoa], loaHiCi: [loaHi - t * seLoa, loaHi + t * seLoa],
    slope, intercept: bias - slope * mx, points: pts.map((p) => ({ ...p, outside: p.diff < loaLo || p.diff > loaHi })),
  }
}

// ─── calibration ────────────────────────────────────────────────────────────

export interface CalBin { lo: number; hi: number; n: number; positives: number; meanPred: number; observed: number; ciLo: number; ciHi: number; rows: number[] }

export interface Calibration {
  n: number
  bins: CalBin[]
  /** Expected calibration error Σ (nᵦ/N)·|observed − predicted|, maximum calibration error, and the Brier score mean((p − y)²). */
  ece: number
  mce: number
  brier: number
}

/** Wilson score interval for a proportion x/n. */
export function wilson(x: number, n: number, z = normalQuantile(0.975)): [number, number] {
  if (!n) return [0, 1]
  const p = x / n
  const d = 1 + (z * z) / n
  const c = (p + (z * z) / (2 * n)) / d
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return [Math.max(0, c - h), Math.min(1, c + h)]
}

/**
 * Reliability diagram data. Predicted probabilities are grouped into `bins` equal-width intervals (strategy 'uniform') or equal-count
 * groups ('quantile'); in each group the mean prediction is compared with the observed share of positives. Empty groups are dropped.
 */
export function calibration(data: readonly { p: number; y: 0 | 1; row: number }[], bins: number, strategy: 'uniform' | 'quantile'): Calibration | null {
  const d = data.filter((x) => Number.isFinite(x.p) && x.p >= 0 && x.p <= 1)
  const n = d.length
  if (!n) return null
  const sorted = [...d].sort((a, b) => a.p - b.p)
  const groups: (typeof d)[] = []
  if (strategy === 'uniform') {
    const g: (typeof d)[] = Array.from({ length: bins }, () => [])
    for (const x of sorted) g[Math.min(bins - 1, Math.floor(x.p * bins))].push(x)
    groups.push(...g)
  } else {
    for (let i = 0; i < bins; i++) groups.push(sorted.slice(Math.floor((i * n) / bins), Math.floor(((i + 1) * n) / bins)))
  }
  const out: CalBin[] = groups.map((g, i) => {
    if (!g.length) return null
    const pos = g.filter((x) => x.y === 1).length
    const [ciLo, ciHi] = wilson(pos, g.length)
    return {
      lo: strategy === 'uniform' ? i / bins : g[0].p, hi: strategy === 'uniform' ? (i + 1) / bins : g[g.length - 1].p, n: g.length, positives: pos,
      meanPred: g.reduce((s, x) => s + x.p, 0) / g.length, observed: pos / g.length, ciLo, ciHi, rows: g.map((x) => x.row),
    }
  }).filter((b): b is CalBin => !!b)
  const ece = out.reduce((s, b) => s + (b.n / n) * Math.abs(b.observed - b.meanPred), 0)
  return { n, bins: out, ece, mce: Math.max(...out.map((b) => Math.abs(b.observed - b.meanPred))), brier: d.reduce((s, x) => s + (x.p - x.y) ** 2, 0) / n }
}
