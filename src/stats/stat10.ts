// ───────────────────────────── functional boxplot ─────────────────────────────

export interface FunctionalBoxplot {
  /** modified band depth of every curve (0…1, larger = more central) */
  depth: number[]
  /** index of the deepest curve (the median) */
  median: number
  /** curves ordered from the deepest to the shallowest */
  ranked: number[]
  /** indexes of the central 50 % curves */
  central: number[]
  /** lower and upper envelope of the central curves at every time */
  lower: number[]
  upper: number[]
  /** fences: the envelope widened by `factor` times its height */
  fenceLo: number[]
  fenceHi: number[]
  outliers: number[]
}

/** Modified band depth: the mean over all pairs of curves of the share of time points at which the curve lies between the pair. */
export function modifiedBandDepth(curves: readonly (readonly number[])[]): number[] {
  const n = curves.length, T = curves[0]?.length ?? 0
  const depth = new Array<number>(n).fill(0)
  if (n < 3 || !T) return depth
  for (let i = 0; i < n; i++) {
    let acc = 0
    for (let a = 0; a < n - 1; a++) for (let b = a + 1; b < n; b++) {
      let inside = 0
      for (let t = 0; t < T; t++) { const lo = Math.min(curves[a][t], curves[b][t]), hi = Math.max(curves[a][t], curves[b][t]); if (curves[i][t] >= lo && curves[i][t] <= hi) inside++ }
      acc += inside / T
    }
    depth[i] = acc / ((n * (n - 1)) / 2)
  }
  return depth
}

export function functionalBoxplot(curves: readonly (readonly number[])[], factor = 1.5): FunctionalBoxplot {
  const n = curves.length, T = curves[0]?.length ?? 0
  const depth = modifiedBandDepth(curves)
  const ranked = [...Array(n).keys()].sort((a, b) => depth[b] - depth[a] || a - b)
  const central = ranked.slice(0, Math.max(1, Math.ceil(n / 2)))
  const lower = Array.from({ length: T }, (_, t) => Math.min(...central.map((i) => curves[i][t])))
  const upper = Array.from({ length: T }, (_, t) => Math.max(...central.map((i) => curves[i][t])))
  const fenceLo = lower.map((l, t) => l - factor * (upper[t] - l)), fenceHi = upper.map((u, t) => u + factor * (u - lower[t]))
  const outliers = ranked.filter((i) => curves[i].some((v, t) => v < fenceLo[t] || v > fenceHi[t]))
  return { depth, median: ranked[0] ?? 0, ranked, central, lower, upper, fenceLo, fenceHi, outliers }
}

// ───────────────────────────── stem-and-leaf ─────────────────────────────

export interface StemRow { stem: number; leaves: number[] }

/**
 * Stem-and-leaf display (Tukey): every value is split into a stem (the digits above the leaf unit) and a one-digit leaf. `unit` is the value of one leaf
 * step (e.g. 1 for integers, 0.1 for one decimal); `split` shows every stem twice (leaves 0–4 and 5–9).
 */
export function stemLeaf(values: readonly number[], unit: number, split: boolean): { rows: StemRow[]; unit: number } {
  const scaled = values.map((v) => Math.round(v / unit)).sort((a, b) => a - b)
  const map = new Map<string, StemRow>()
  const keyOf = (stem: number, half: number) => `${stem}|${half}`
  const lo = Math.floor(scaled[0] / 10), hi = Math.floor(scaled[scaled.length - 1] / 10)
  for (let s = lo; s <= hi; s++) for (let h = 0; h < (split ? 2 : 1); h++) map.set(keyOf(s, h), { stem: s, leaves: [] })
  for (const v of scaled) {
    const stem = Math.floor(v / 10), leaf = v - stem * 10
    map.get(keyOf(stem, split ? (leaf >= 5 ? 1 : 0) : 0))!.leaves.push(leaf)
  }
  return { rows: [...map.values()], unit }
}

// ───────────────────────────── sunflower plot ─────────────────────────────

export interface Sunflower { x: number; y: number; /** number of observations in the bin */ n: number; ids: number[] }

/** Sunflower plot (Cleveland & McGill): the observations of a bin are drawn as one symbol with as many petals as there are observations. */
export function sunflower(points: readonly [number, number][], x: [number, number], y: [number, number], bins: [number, number]): Sunflower[] {
  const cells = new Map<number, Sunflower>()
  points.forEach(([px, py], id) => {
    const i = Math.min(bins[0] - 1, Math.max(0, Math.floor(((px - x[0]) / (x[1] - x[0])) * bins[0]))), j = Math.min(bins[1] - 1, Math.max(0, Math.floor(((py - y[0]) / (y[1] - y[0])) * bins[1])))
    const k = j * bins[0] + i
    const c = cells.get(k) ?? { x: x[0] + ((i + 0.5) / bins[0]) * (x[1] - x[0]), y: y[0] + ((j + 0.5) / bins[1]) * (y[1] - y[0]), n: 0, ids: [] }
    c.n++; c.ids.push(id); cells.set(k, c)
  })
  return [...cells.values()]
}

// ───────────────────────────── hanging rootogram ─────────────────────────────

export interface RootogramBar { k: number; observed: number; expected: number; /** square-root scale: where the hanging bar starts and ends */ top: number; bottom: number }

/** Poisson probabilities for k = 0…max with the given mean. */
export function poissonPmf(mean: number, max: number): number[] {
  const p = [Math.exp(-mean)]
  for (let k = 1; k <= max; k++) p.push((p[k - 1] * mean) / k)
  return p
}

/** Hanging rootogram: bars of height √observed hang from the curve √expected, so a perfect fit ends every bar on the zero line. */
export function rootogram(observed: readonly number[], expected: readonly number[]): RootogramBar[] {
  return observed.map((o, k) => ({ k, observed: o, expected: expected[k] ?? 0, top: Math.sqrt(expected[k] ?? 0), bottom: Math.sqrt(expected[k] ?? 0) - Math.sqrt(o) }))
}

// ───────────────────────────── Lorenz curve ─────────────────────────────

export interface Lorenz { points: [number, number][]; gini: number }

/** Lorenz curve (cumulative share of the total against the cumulative share of the population) and the Gini coefficient. */
export function lorenz(values: readonly number[]): Lorenz {
  const s = [...values].sort((a, b) => a - b)
  const total = s.reduce((a, b) => a + b, 0)
  const pts: [number, number][] = [[0, 0]]
  let acc = 0
  s.forEach((v, i) => { acc += v; pts.push([(i + 1) / s.length, total > 0 ? acc / total : (i + 1) / s.length]) })
  let area = 0
  for (let i = 1; i < pts.length; i++) area += ((pts[i][1] + pts[i - 1][1]) / 2) * (pts[i][0] - pts[i - 1][0])
  return { points: pts, gini: 1 - 2 * area }
}

// ───────────────────────────── tornado chart ─────────────────────────────

export interface TornadoBar { name: string; low: number; high: number; /** result change at the low and the high parameter value, relative to the base case */ dLow: number; dHigh: number; swing: number }

/** Tornado chart: one-at-a-time sensitivity bars sorted by their total swing (largest on top). */
export function tornado(base: number, rows: readonly { name: string; low: number; high: number }[]): TornadoBar[] {
  return rows.map((r) => ({ ...r, dLow: r.low - base, dHigh: r.high - base, swing: Math.abs(r.high - r.low) })).sort((a, b) => b.swing - a.swing || a.name.localeCompare(b.name, 'ko'))
}
