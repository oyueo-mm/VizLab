// ───────────────────────────── WordStream ─────────────────────────────

export interface WordRow { time: number; topic: string; word: string; freq: number }
export interface PlacedWord { text: string; topic: number; time: number; freq: number; x: number; y: number; w: number; h: number; size: number }
export interface StreamBands {
  times: number[]
  topics: string[]
  /** x of each time slot */
  xs: number[]
  /** top and bottom y of every topic band at every time slot: [topic][time] */
  top: number[][]
  bottom: number[][]
  totals: number[][]
  /** pixels per unit of frequency */
  unit: number
}
export interface WordStreamLayout extends StreamBands { words: PlacedWord[]; unplaced: number }

const smooth = (u: number) => u * u * (3 - 2 * u)

/** Edge position of a band at x, interpolating between the time slots with a smoothstep so that the drawn outline and the containment test agree. */
export function edgeAt(xs: readonly number[], ys: readonly number[], x: number): number {
  if (x <= xs[0]) return ys[0]
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1]
  let i = 0
  while (i < xs.length - 2 && x > xs[i + 1]) i++
  return ys[i] + (ys[i + 1] - ys[i]) * smooth((x - xs[i]) / (xs[i + 1] - xs[i]))
}

/** Font size from frequency: monotone, between minSize and maxSize. */
export const fontFor = (freq: number, maxFreq: number, minSize: number, maxSize: number) => minSize + (maxSize - minSize) * Math.sqrt(Math.max(0, freq) / Math.max(1, maxFreq))

/** Rough text width: full-width characters are one em wide, other characters about 0.56 em. */
export const textWidth = (s: string, size: number) => [...s].reduce((a, ch) => a + (/[ᄀ-ᇿ㄰-㆏가-힯一-鿿]/.test(ch) ? 1 : 0.56), 0) * size

/**
 * WordStream layout: topics are stacked bands whose thickness follows the topic's total frequency at each time (ThemeRiver-style, centred
 * baseline); the words of a topic are placed inside its band at the time slot they belong to, larger for higher frequency, without overlapping.
 */
export function wordStream(rows: readonly WordRow[], width: number, height: number, opts: { topWords: number; minSize: number; maxSize: number; range?: [number, number] }): WordStreamLayout {
  const kept = rows.filter((r) => r.freq > 0 && (!opts.range || (r.time >= opts.range[0] && r.time <= opts.range[1])))
  const times = [...new Set(kept.map((r) => r.time))].sort((a, b) => a - b)
  const topics = [...new Set(kept.map((r) => r.topic))]
  const T = times.length
  const padX = 24
  const xs = times.map((_, i) => (T === 1 ? width / 2 : padX + (i * (width - 2 * padX)) / (T - 1)))
  const totals = topics.map((tp) => times.map((t) => kept.filter((r) => r.topic === tp && r.time === t).reduce((a, r) => a + r.freq, 0)))
  const sumAt = times.map((_, i) => totals.reduce((a, row) => a + row[i], 0))
  const unit = (height * 0.9) / Math.max(1, ...sumAt)
  const top: number[][] = topics.map(() => []), bottom: number[][] = topics.map(() => [])
  times.forEach((_, i) => {
    let y = height / 2 - (sumAt[i] * unit) / 2
    topics.forEach((_, k) => { top[k].push(y); y += totals[k][i] * unit; bottom[k].push(y) })
  })
  const maxFreq = Math.max(1, ...kept.map((r) => r.freq))
  const words: PlacedWord[] = []
  let unplaced = 0
  const hit = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => Math.abs(a.x - b.x) * 2 < a.w + b.w + 2 && Math.abs(a.y - b.y) * 2 < a.h + b.h + 1
  // larger words first so that they get the best positions
  const order = kept.map((r) => ({ r, ti: times.indexOf(r.time), k: topics.indexOf(r.topic) })).sort((a, b) => b.r.freq - a.r.freq)
  const perCell = new Map<string, number>()
  for (const { r, ti, k } of order) {
    const key = `${k}|${ti}`
    if ((perCell.get(key) ?? 0) >= opts.topWords) continue
    perCell.set(key, (perCell.get(key) ?? 0) + 1)
    let size = fontFor(r.freq, maxFreq, opts.minSize, opts.maxSize)
    let done = false
    const slot = T > 1 ? (width - 2 * padX) / (T - 1) : width
    while (!done && size >= opts.minSize - 1e-9) {
      const w = textWidth(r.word, size), h = size * 1.05
      for (const dxFrac of [0, -0.3, 0.3, -0.6, 0.6]) {
        const cx = xs[ti] + dxFrac * slot
        const midY = (edgeAt(xs, top[k], cx) + edgeAt(xs, bottom[k], cx)) / 2
        for (let step = 0; step < 40 && !done; step++) {
          const cy = midY + (step % 2 ? 1 : -1) * Math.ceil(step / 2) * (h * 0.5)
          const cand = { x: cx, y: cy, w, h }
          // the rectangle must lie between the band's edges at its left, middle and right
          const ok = cx - w / 2 >= xs[0] - 1e-9 && cx + w / 2 <= xs[T - 1] + 1e-9 && [cx - w / 2, cx, cx + w / 2].every((x) => edgeAt(xs, top[k], x) <= cy - h / 2 + 1e-9 && edgeAt(xs, bottom[k], x) >= cy + h / 2 - 1e-9) && words.every((o) => !hit(cand, o))
          if (ok) { words.push({ text: r.word, topic: k, time: r.time, freq: r.freq, x: cx, y: cy, w, h, size }); done = true }
        }
        if (done) break
      }
      if (!done) size *= 0.86
    }
    if (!done) unplaced++
  }
  return { times, topics, xs, top, bottom, totals, unit, words, unplaced }
}

// ───────────────────────────── TileBars ─────────────────────────────

export interface TermGroup { label: string; terms: string[] }

/** "지도|맵, 네트워크, 시간" → term groups (comma = separate rows, bar = alternative spellings of one row). */
export function parseQuery(s: string): TermGroup[] {
  return s.split(/[,，]/).map((g) => g.trim()).filter(Boolean).map((g) => ({ label: g, terms: g.split('|').map((t) => t.trim().toLowerCase()).filter(Boolean) })).filter((g) => g.terms.length)
}

export const countTerm = (text: string, terms: readonly string[]) => {
  const t = text.toLowerCase()
  let n = 0
  for (const term of terms) { let at = t.indexOf(term); while (at >= 0) { n++; at = t.indexOf(term, at + term.length) } }
  return n
}

const tokens = (s: string) => s.toLowerCase().split(/[^0-9a-zㄱ-힝]+/).filter((w) => w.length > 1)

/** Boundaries (tile start indexes) from fixed length or from lexical cohesion between neighbouring blocks (a simplified TextTiling). */
export function tileStarts(sentences: readonly string[], mode: 'fixed' | 'topic', size: number): number[] {
  const n = sentences.length
  if (n === 0) return []
  if (mode === 'fixed') return Array.from({ length: Math.ceil(n / Math.max(1, size)) }, (_, i) => i * Math.max(1, size))
  const w = Math.max(2, Math.min(4, size))
  const bag = (a: number, b: number) => { const m = new Map<string, number>(); for (let i = Math.max(0, a); i < Math.min(n, b); i++) for (const t of tokens(sentences[i])) m.set(t, (m.get(t) ?? 0) + 1); return m }
  const cos = (a: Map<string, number>, b: Map<string, number>) => { let d = 0, x = 0, y = 0; for (const [k, v] of a) { x += v * v; d += v * (b.get(k) ?? 0) } for (const v of b.values()) y += v * v; return x && y ? d / Math.sqrt(x * y) : 0 }
  const gaps: number[] = []
  for (let g = 1; g < n; g++) gaps.push(cos(bag(g - w, g), bag(g, g + w)))
  // depth score of every gap: how far the similarity falls below its neighbouring peaks
  const depth = gaps.map((s, i) => { let l = s, r = s; for (let k = i - 1; k >= 0 && gaps[k] >= l; k--) l = gaps[k]; for (let k = i + 1; k < gaps.length && gaps[k] >= r; k++) r = gaps[k]; return l - s + (r - s) })
  const mean = depth.reduce((a, b) => a + b, 0) / Math.max(1, depth.length)
  const sd = Math.sqrt(depth.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, depth.length))
  const starts = [0]
  depth.forEach((d, i) => { const at = i + 1; if (d > mean + sd * 0.5 && at - starts[starts.length - 1] >= 2 && n - at >= 2 && depth[i] >= (depth[i - 1] ?? -1) && depth[i] >= (depth[i + 1] ?? -1)) starts.push(at) })
  return starts
}

export interface TileDoc { name: string; sentences: string[]; tiles: { start: number; end: number }[]; /** counts[group][tile] */ counts: number[][]; hits: number; /** tiles in which every group appears */ together: number }

export function tileBars(docs: readonly { name: string; sentences: string[] }[], groups: readonly TermGroup[], mode: 'fixed' | 'topic', size: number): TileDoc[] {
  return docs.map((d) => {
    const starts = tileStarts(d.sentences, mode, size)
    const tiles = starts.map((s, i) => ({ start: s, end: i + 1 < starts.length ? starts[i + 1] : d.sentences.length }))
    const counts = groups.map((g) => tiles.map((t) => countTerm(d.sentences.slice(t.start, t.end).join(' '), g.terms)))
    const hits = counts.reduce((a, row) => a + row.reduce((b, c) => b + c, 0), 0)
    const together = tiles.filter((_, i) => groups.length > 0 && counts.every((row) => row[i] > 0)).length
    return { name: d.name, sentences: d.sentences, tiles, counts, hits, together }
  })
}
