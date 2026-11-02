import * as d3 from 'd3'

// ───────────────────────────── bagplot ─────────────────────────────

export interface Bagplot {
  /** halfspace (Tukey) depth of every point, as a count */
  depth: number[]
  center: [number, number]
  bag: [number, number][]
  fence: [number, number][]
  outliers: number[]
  /** indices of the points inside the fence but outside the bag */
  loop: number[]
}

/** Halfspace depth of each point: the smallest number of points in a closed half-plane through it, searched over `dirs` directions. */
export function halfspaceDepth(pts: readonly [number, number][], dirs = 360): number[] {
  const us = Array.from({ length: dirs }, (_, k) => { const a = (Math.PI * k) / dirs; return [Math.cos(a), Math.sin(a)] as const })
  return pts.map((p) => {
    let best = pts.length
    for (const [ux, uy] of us) {
      let pos = 0, neg = 0
      for (const q of pts) { const s = (q[0] - p[0]) * ux + (q[1] - p[1]) * uy; if (s >= -1e-12) pos++; if (s <= 1e-12) neg++ }
      best = Math.min(best, pos, neg)
    }
    return best
  })
}

/** Bagplot (Rousseeuw, Ruts & Tukey 1999), computed from the depths at the data points: the bag is the hull of the deepest half of the points, the fence inflates it by `factor` about the depth median. */
export function bagplot(pts: readonly [number, number][], factor = 3, dirs = 360): Bagplot {
  const n = pts.length
  const depth = halfspaceDepth(pts, dirs)
  const order = depth.map((d, i) => i).sort((a, b) => depth[b] - depth[a] || a - b)
  const k = Math.ceil(n / 2)
  const cut = depth[order[k - 1]]
  const inBag = order.filter((i) => depth[i] >= cut)
  const dmax = depth[order[0]]
  const deepest = order.filter((i) => depth[i] === dmax)
  const center: [number, number] = [d3.mean(deepest, (i) => pts[i][0])!, d3.mean(deepest, (i) => pts[i][1])!]
  const bag = (d3.polygonHull(inBag.map((i) => pts[i])) ?? inBag.map((i) => pts[i])) as [number, number][]
  const fence = bag.map(([x, y]) => [center[0] + factor * (x - center[0]), center[1] + factor * (y - center[1])] as [number, number])
  const outliers: number[] = [], loop: number[] = []
  const inBagSet = new Set(inBag)
  for (let i = 0; i < n; i++) {
    if (inBagSet.has(i)) continue
    if (fence.length >= 3 && d3.polygonContains(fence, pts[i])) loop.push(i)
    else outliers.push(i)
  }
  return { depth, center, bag, fence, outliers, loop }
}

// ───────────────────────────── diverging stacked bar ─────────────────────────────

export interface DivergingBar { name: string; shares: number[]; /** left edge of each level segment */ starts: number[]; negative: number; positive: number; neutral: number; n: number }

/** Diverging stacked bars for ordered rating levels: the neutral level (if odd) is centred on zero and the levels left of it extend to the negative side. Shares are percentages. */
export function divergingBars(items: readonly { name: string; counts: readonly number[] }[]): DivergingBar[] {
  return items.map((it) => {
    const n = it.counts.reduce((a, b) => a + b, 0)
    const shares = it.counts.map((c) => (n > 0 ? (100 * c) / n : 0))
    const L = shares.length, mid = (L - 1) / 2
    const neutral = L % 2 === 1 ? shares[mid] : 0
    const negative = shares.slice(0, Math.floor(L / 2)).reduce((a, b) => a + b, 0)
    const positive = shares.slice(Math.ceil(L / 2)).reduce((a, b) => a + b, 0)
    const starts: number[] = []
    let x = -(negative + neutral / 2)
    shares.forEach((s) => { starts.push(x); x += s })
    return { name: it.name, shares, starts, negative, positive, neutral, n }
  })
}

// ───────────────────────────── decision curve analysis ─────────────────────────────

export interface DecisionPoint { threshold: number; model: number; all: number; none: number }

/** Net benefit of acting on `risk >= t` (Vickers & Elkin 2006): TP/n − FP/n · t/(1−t); treating everyone has net benefit prevalence − (1−prevalence)·t/(1−t). */
export function decisionCurve(outcome: readonly number[], risk: readonly number[], thresholds: readonly number[]): DecisionPoint[] {
  const n = outcome.length
  const prev = outcome.filter((o) => o === 1).length / n
  return thresholds.map((t) => {
    let tp = 0, fp = 0
    for (let i = 0; i < n; i++) if (risk[i] >= t) { if (outcome[i] === 1) tp++; else fp++ }
    const w = t / (1 - t)
    return { threshold: t, model: tp / n - (fp / n) * w, all: prev - (1 - prev) * w, none: 0 }
  })
}
