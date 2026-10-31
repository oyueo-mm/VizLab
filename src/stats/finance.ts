import type { Candle } from './ohlc'

/** Price-transformation charts (Renko, Heikin-Ashi, Kagi, Point & Figure, Three-Line Break), volume profile, drawdown, yield curves and order books. */

export interface Brick { index: number; /** time (ms) of the candle that completed the brick */ t: number; open: number; close: number; up: boolean }

/**
 * Renko bricks from closing prices. A brick has a fixed size; an up brick forms when the close is at least one brick above the top of the last
 * brick, a down brick when it is at least one brick below the bottom of the last brick, so a reversal needs two bricks of movement from the last close.
 * Several bricks can form from one large move.
 */
export function renko(closes: readonly { t: number; c: number }[], size: number): Brick[] {
  const out: Brick[] = []
  if (!closes.length || !(size > 0)) return out
  const start = Math.floor(closes[0].c / size) * size
  let top = start, bottom = start // the last brick spans [bottom, top]; before the first brick it has zero height at the starting level
  for (const { t, c } of closes) {
    for (;;) {
      if (c >= top + size) { out.push({ index: out.length, t, open: top, close: top + size, up: true }); bottom = top; top += size } else if (c <= bottom - size) { out.push({ index: out.length, t, open: bottom, close: bottom - size, up: false }); top = bottom; bottom -= size } else break
    }
  }
  return out
}

/** Average true range of the candles (simple mean over the whole series), used as an automatic Renko brick size. */
export function averageTrueRange(c: readonly Candle[]): number {
  if (c.length < 2) return 1
  let s = 0
  for (let i = 1; i < c.length; i++) s += Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c))
  return s / (c.length - 1)
}

export interface HaCandle { t: number; o: number; h: number; l: number; c: number; row: number }

/** Heikin-Ashi candles: close = (O+H+L+C)/4, open = midpoint of the previous Heikin-Ashi body (first: (O+C)/2), high/low = extremes of the real high/low and the new body. */
export function heikinAshi(c: readonly Candle[]): HaCandle[] {
  const out: HaCandle[] = []
  c.forEach((k, i) => {
    const hc = (k.o + k.h + k.l + k.c) / 4
    const ho = i === 0 ? (k.o + k.c) / 2 : (out[i - 1].o + out[i - 1].c) / 2
    out.push({ t: k.t, o: ho, h: Math.max(k.h, ho, hc), l: Math.min(k.l, ho, hc), c: hc, row: k.row })
  })
  return out
}

export interface KagiSegment { x: number; from: number; to: number; /** thick (yang) line when the price is above the previous shoulder, thin (yin) when below the previous waist */ thick: boolean; up: boolean; t: number }

/** Kagi chart from closing prices with a fixed reversal amount. Segments are vertical moves; the x index advances at every reversal. */
export function kagi(closes: readonly { t: number; c: number }[], reversal: number): KagiSegment[] {
  const out: KagiSegment[] = []
  if (closes.length < 2 || !(reversal > 0)) return out
  let dir = closes[1].c >= closes[0].c ? 1 : -1
  let start = closes[0].c, end = closes[0].c
  let x = 0
  let thick = dir > 0
  const push = (t: number) => out.push({ x, from: start, to: end, thick, up: dir > 0, t })
  for (const { t, c } of closes) {
    if (dir > 0) {
      if (c > end) end = c
      else if (end - c >= reversal) {
        push(t)
        x++
        start = end; end = c; dir = -1
      }
    } else if (c < end) end = c
    else if (c - end >= reversal) {
      push(t)
      x++
      start = end; end = c; dir = 1
    }
    // thickness switches when the line breaks the previous turning point
    const prevSeg = out[out.length - 1]
    if (dir > 0 && prevSeg && end > Math.max(prevSeg.from, prevSeg.to) && !thick) thick = true
    if (dir < 0 && prevSeg && end < Math.min(prevSeg.from, prevSeg.to) && thick) thick = false
  }
  push(closes[closes.length - 1].t)
  return out
}

export interface PfColumn { dir: 'X' | 'O'; /** price of the lowest box (the box's lower edge) in the column */ low: number; boxes: number; t: number }

/**
 * Point & Figure on closing prices: a column of X (rising) or O (falling) boxes of `box` price units. A column grows when the price moves a
 * whole box further; a new column in the opposite direction starts after a move of `reversal` boxes against the current column.
 */
export function pointAndFigure(closes: readonly { t: number; c: number }[], box: number, reversal = 3): PfColumn[] {
  const cols: PfColumn[] = []
  if (!closes.length || !(box > 0)) return cols
  const snap = (p: number) => Math.floor(p / box + 1e-9) * box
  let dir: 'X' | 'O' | null = null
  let lo = snap(closes[0].c), hi = lo // box edges [lo, hi]: the column covers boxes from lo up to hi (hi is the last box's lower edge)
  let col: PfColumn | null = null
  const open = (d: 'X' | 'O', bottom: number, top: number, t: number) => { col = { dir: d, low: bottom, boxes: Math.round((top - bottom) / box) + 1, t }; cols.push(col) }
  for (const { t, c } of closes) {
    const p = snap(c)
    if (dir === null) {
      if (p >= lo + box) { dir = 'X'; hi = p; open('X', lo, hi, t) } else if (p <= lo - box) { dir = 'O'; hi = lo; lo = p; open('O', lo, hi, t) }
      continue
    }
    if (dir === 'X') {
      if (p >= hi + box) { hi = p; col!.boxes = Math.round((hi - lo) / box) + 1; col!.t = t } else if (hi - p >= reversal * box) {
        dir = 'O'; const top = hi - box; hi = top; lo = p; open('O', lo, hi, t)
      }
    } else if (p <= lo - box) { lo = p; col!.low = lo; col!.boxes = Math.round((hi - lo) / box) + 1; col!.t = t } else if (p - lo >= reversal * box) {
      dir = 'X'; const bottom = lo + box; lo = bottom; hi = p; open('X', lo, hi, t)
    }
  }
  return cols
}

export interface LbLine { index: number; t: number; open: number; close: number; up: boolean }

/** Three-line break: a new line extends the trend when the close passes the last line's extreme; a reversal needs a close beyond the extreme of the last `n` lines. */
export function lineBreak(closes: readonly { t: number; c: number }[], n = 3): LbLine[] {
  const out: LbLine[] = []
  if (closes.length < 2) return out
  out.push({ index: 0, t: closes[1].t, open: closes[0].c, close: closes[1].c, up: closes[1].c >= closes[0].c })
  for (let i = 2; i < closes.length; i++) {
    const last = out[out.length - 1], c = closes[i].c
    const hi = Math.max(last.open, last.close), lo = Math.min(last.open, last.close)
    if (last.up) {
      if (c > hi) out.push({ index: out.length, t: closes[i].t, open: last.close, close: c, up: true })
      else {
        const low = Math.min(...out.slice(-n).flatMap((l) => [l.open, l.close]))
        if (c < low) out.push({ index: out.length, t: closes[i].t, open: last.open, close: c, up: false })
      }
    } else if (c < lo) out.push({ index: out.length, t: closes[i].t, open: last.close, close: c, up: false })
    else {
      const high = Math.max(...out.slice(-n).flatMap((l) => [l.open, l.close]))
      if (c > high) out.push({ index: out.length, t: closes[i].t, open: last.open, close: c, up: true })
    }
  }
  return out
}

export interface ProfileBin { lo: number; hi: number; volume: number; buy: number }

/**
 * Volume profile: every candle's volume is spread over the price bins its [low, high] range overlaps, in proportion to the overlap
 * (the candle's up/down direction sets the share counted as buying). POC = the bin with the most volume; the value area is the smallest
 * set of bins around the POC holding `areaShare` of the volume.
 */
export function volumeProfile(c: readonly Candle[], bins: number, areaShare = 0.7) {
  const lo = Math.min(...c.map((k) => k.l)), hi = Math.max(...c.map((k) => k.h))
  const w = (hi - lo) / bins || 1
  const out: ProfileBin[] = Array.from({ length: bins }, (_, i) => ({ lo: lo + i * w, hi: lo + (i + 1) * w, volume: 0, buy: 0 }))
  for (const k of c) {
    const v = k.v ?? 0
    if (!v) continue
    const range = k.h - k.l
    for (const b of out) {
      const ov = Math.min(b.hi, k.h) - Math.max(b.lo, k.l)
      if (range === 0) { if (k.h >= b.lo && k.h < b.hi + 1e-12) { b.volume += v; if (k.c >= k.o) b.buy += v } } else if (ov > 0) { const part = (v * ov) / range; b.volume += part; if (k.c >= k.o) b.buy += part }
    }
  }
  const total = out.reduce((s, b) => s + b.volume, 0)
  const poc = out.reduce((best, b, i) => (b.volume > out[best].volume ? i : best), 0)
  let a = poc, z = poc, got = out[poc].volume
  while (got < areaShare * total && (a > 0 || z < bins - 1)) {
    const up = z < bins - 1 ? out[z + 1].volume : -1, down = a > 0 ? out[a - 1].volume : -1
    if (up >= down) { z++; got += up } else { a--; got += down }
  }
  return { bins: out, poc, valueArea: [a, z] as [number, number], total }
}

export interface Drawdown { dd: number[]; peak: number[]; maxDd: number; maxIndex: number; peakIndex: number; /** longest stretch (in observations) spent below a previous peak */ longest: number; recovered: boolean }

/** Drawdown series dd_t = P_t / max_{s≤t} P_s − 1 (≤ 0), its maximum and the longest underwater period. */
export function drawdown(prices: readonly number[]): Drawdown {
  let peak = -Infinity, peakIdx = 0
  const dd: number[] = [], pk: number[] = []
  let maxDd = 0, maxIndex = 0, maxPeak = 0, run = 0, longest = 0
  prices.forEach((p, i) => {
    if (p >= peak) { peak = p; peakIdx = i; run = 0 } else run++
    longest = Math.max(longest, run)
    const d = peak > 0 ? p / peak - 1 : 0
    dd.push(d); pk.push(peak)
    if (d < maxDd) { maxDd = d; maxIndex = i; maxPeak = peakIdx }
  })
  return { dd, peak: pk, maxDd, maxIndex, peakIndex: maxPeak, longest, recovered: prices.length > 0 && dd[dd.length - 1] === 0 }
}

/** Nelson–Siegel yield curve y(τ) = β0 + β1 (1−e^{−τ/λ})/(τ/λ) + β2 [(1−e^{−τ/λ})/(τ/λ) − e^{−τ/λ}] fitted by least squares over a grid of λ. */
export function nelsonSiegel(tau: readonly number[], y: readonly number[]) {
  const load = (t: number, lam: number): [number, number] => { const x = t / lam; const f = (1 - Math.exp(-x)) / x; return [f, f - Math.exp(-x)] }
  let best: { lam: number; b: [number, number, number]; sse: number } | null = null
  for (let lam = 0.5; lam <= 10; lam += 0.25) {
    // OLS for (β0, β1, β2) with the two loadings
    const rows = tau.map((t) => [1, ...load(t, lam)])
    const xtx = [0, 0, 0].map((_, a) => [0, 0, 0].map((__, b) => rows.reduce((s, r) => s + r[a] * r[b], 0)))
    const xty = [0, 1, 2].map((a) => rows.reduce((s, r, i) => s + r[a] * y[i], 0))
    const sol = solve3(xtx, xty)
    if (!sol) continue
    const sse = rows.reduce((s, r, i) => s + (r[0] * sol[0] + r[1] * sol[1] + r[2] * sol[2] - y[i]) ** 2, 0)
    if (!best || sse < best.sse) best = { lam, b: sol as [number, number, number], sse }
  }
  if (!best) return null
  const { lam, b } = best
  return { lambda: lam, beta: b, sse: best.sse, at: (t: number) => { const [l1, l2] = load(Math.max(t, 1e-6), lam); return b[0] + b[1] * l1 + b[2] * l2 } }
}

function solve3(a: number[][], b: number[]): number[] | null {
  const m = a.map((r, i) => [...r, b[i]])
  for (let c = 0; c < 3; c++) {
    let p = c
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r
    if (Math.abs(m[p][c]) < 1e-12) return null
    ;[m[c], m[p]] = [m[p], m[c]]
    for (let r = 0; r < 3; r++) if (r !== c) { const f = m[r][c] / m[c][c]; for (let j = c; j < 4; j++) m[r][j] -= f * m[c][j] }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]]
}

export interface DepthLevel { price: number; size: number; cum: number }

/** Cumulative order-book depth: bids sorted from the best (highest) price down, asks from the best (lowest) price up. */
export function orderBookDepth(bids: readonly { price: number; size: number }[], asks: readonly { price: number; size: number }[]) {
  const b = [...bids].sort((x, y) => y.price - x.price), a = [...asks].sort((x, y) => x.price - y.price)
  let cb = 0, ca = 0
  const bid: DepthLevel[] = b.map((l) => ({ price: l.price, size: l.size, cum: (cb += l.size) }))
  const ask: DepthLevel[] = a.map((l) => ({ price: l.price, size: l.size, cum: (ca += l.size) }))
  const bestBid = bid[0]?.price ?? NaN, bestAsk = ask[0]?.price ?? NaN
  return { bid, ask, bestBid, bestAsk, spread: bestAsk - bestBid, mid: (bestAsk + bestBid) / 2, crossed: bestBid >= bestAsk }
}

/** Volume-weighted average price of a market order of `qty` against the ask (side 'buy') or bid (side 'sell') side, and the slippage versus the best price. */
export function marketImpact(levels: readonly DepthLevel[], qty: number) {
  let left = qty, cost = 0
  for (const l of levels) { const take = Math.min(left, l.size); cost += take * l.price; left -= take; if (left <= 0) break }
  const filled = qty - Math.max(0, left)
  const vwap = filled > 0 ? cost / filled : NaN
  return { filled, vwap, slippage: filled > 0 && levels[0] ? vwap - levels[0].price : NaN, complete: left <= 1e-9 }
}
