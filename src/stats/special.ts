/** Helpers of the special-purpose charts: event rasters, Lexis diagrams, cumulative flow and spiral time plots. */

/** Peri-stimulus time histogram: event counts per bin across trials, converted to a rate (events per trial per unit time). */
export function psth(events: readonly { trial: string; t: number }[], trials: number, lo: number, hi: number, binWidth: number): { x0: number; x1: number; count: number; rate: number }[] {
  const n = Math.max(1, Math.ceil((hi - lo) / binWidth))
  const counts = new Array<number>(n).fill(0)
  for (const e of events) { if (e.t < lo || e.t > hi) continue; counts[Math.min(n - 1, Math.floor((e.t - lo) / binWidth))]++ }
  return counts.map((count, i) => ({ x0: lo + i * binWidth, x1: lo + (i + 1) * binWidth, count, rate: trials ? count / trials / binWidth : 0 }))
}

export interface Lifeline { id: number; start: number; end: number; event: boolean; row: number }

export interface LexisCell { period: number; age: number; /** person-time lived inside the (period, age) square */ exposure: number; events: number }

/**
 * Lexis diagram tabulation: every lifeline runs at 45° from (start, age 0) to (end, end − start). Person-years are split over calendar-period × age
 * squares of `width` years, and an event is counted in the square where the lifeline ends. Rate = events / exposure.
 */
export function lexisTable(lines: readonly Lifeline[], width: number): LexisCell[] {
  const cells = new Map<string, LexisCell>()
  const get = (p: number, a: number) => { const k = `${p},${a}`; let c = cells.get(k); if (!c) { c = { period: p * width, age: a * width, exposure: 0, events: 0 }; cells.set(k, c) } return c }
  for (const l of lines) {
    // walk along the diagonal: the age at calendar time t is t − start; split at every period boundary and every age boundary
    let t = l.start
    while (t < l.end - 1e-12) {
      const age = t - l.start
      const nextPeriod = (Math.floor(t / width + 1e-12) + 1) * width
      const nextAge = l.start + (Math.floor(age / width + 1e-12) + 1) * width
      const next = Math.min(l.end, nextPeriod, nextAge)
      get(Math.floor(t / width + 1e-12), Math.floor(age / width + 1e-12)).exposure += next - t
      t = next
    }
    if (l.event) { const age = Math.max(0, l.end - l.start - 1e-9); get(Math.floor((l.end - 1e-9) / width), Math.floor(age / width)).events++ }
  }
  return [...cells.values()]
}

export interface FlowPoint { t: number; /** cumulative count reached each stage by time t, in stage order (first = entered, last = done) */ cum: number[] }

/** Cumulative flow: for each date the number of items that have reached each stage (the lines of a CFD never decrease and are ordered). */
export function cumulativeFlow(rows: readonly { t: number; stage: number; n: number }[], stages: number): FlowPoint[] {
  const times = [...new Set(rows.map((r) => r.t))].sort((a, b) => a - b)
  const by = new Map<number, number[]>()
  for (const t of times) by.set(t, new Array(stages).fill(0))
  for (const r of rows) by.get(r.t)![r.stage] += r.n
  const out: FlowPoint[] = []
  const run = new Array(stages).fill(0)
  for (const t of times) {
    const day = by.get(t)!
    for (let s = 0; s < stages; s++) run[s] += day[s]
    // a stage cannot hold more items than the stage before it has admitted
    const cum = run.slice()
    for (let s = 1; s < stages; s++) cum[s] = Math.min(cum[s], cum[s - 1])
    out.push({ t, cum })
  }
  return out
}

/** Spiral layout: angle advances 2π per `period` time units, radius grows by `pitch` per revolution from `inner`. */
export function spiralPoint(t: number, t0: number, period: number, inner: number, pitch: number, startAngle = 0): { angle: number; r: number; turns: number } {
  const turns = (t - t0) / period
  return { angle: startAngle + 2 * Math.PI * (turns - Math.floor(turns)), r: inner + pitch * turns, turns }
}
