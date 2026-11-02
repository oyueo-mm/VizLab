/** Engines of the v0.8 text techniques: TextArc, Parallel Tag Clouds and Phrase Net. */
import { PARTICLES, textWidthEm, tokenize } from './struct7'

export type P = [number, number]

// ───────────────────────────── TextArc ─────────────────────────────

export interface ArcWord { word: string; count: number; /** Sentences (by index) where the word occurs. */ occ: number[]; x: number; y: number }

/** Point on the unit circle where sentence `i` of `n` lies (the text runs clockwise from 12 o'clock). */
export const arcPoint = (i: number, n: number): P => { const a = (i / Math.max(1, n)) * 2 * Math.PI - Math.PI / 2; return [Math.cos(a), Math.sin(a)] }

/**
 * TextArc (Paley 2002, simplified): the sentences are laid out in reading order around a circle, and every word that occurs at least
 * `minCount` times is placed at the average position of the points where it occurs. A word that occurs in the whole text is drawn near the
 * centre, a word that occurs in one part is pulled towards that part. `relax` rounds of pushing keep the labels apart (they move the
 * average positions slightly; use 0 to get the exact centroids).
 */
export function textArc(sentences: readonly string[], opt: { minCount: number; maxWords: number; relax: number; stop?: ReadonlySet<string>; fontMax?: number } = { minCount: 2, maxWords: 60, relax: 40 }): ArcWord[] {
  const occ = new Map<string, number[]>()
  sentences.forEach((s, i) => { for (const w of tokenize(s, opt.stop)) { const l = occ.get(w) ?? []; if (l[l.length - 1] !== i) l.push(i); occ.set(w, l) } })
  const words: ArcWord[] = [...occ.entries()].filter(([, l]) => l.length >= opt.minCount).map(([word, l]) => {
    const pts = l.map((i) => arcPoint(i, sentences.length))
    return { word, count: l.length, occ: l, x: pts.reduce((s, p) => s + p[0], 0) / pts.length, y: pts.reduce((s, p) => s + p[1], 0) / pts.length }
  }).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word)).slice(0, opt.maxWords)
  const maxC = Math.max(1, ...words.map((w) => w.count))
  const box = (w: ArcWord) => { const size = 0.035 + 0.05 * (w.count / maxC); return { w: textWidthEm(w.word) * size * 0.5, h: size * 0.6 } }
  for (let it = 0; it < opt.relax; it++) {
    for (let i = 0; i < words.length; i++) for (let j = i + 1; j < words.length; j++) {
      const a = words[i], b = words[j]
      const ba = box(a), bb = box(b)
      const dx = b.x - a.x, dy = b.y - a.y
      const ox = ba.w + bb.w - Math.abs(dx), oy = ba.h + bb.h - Math.abs(dy)
      if (ox > 0 && oy > 0) {
        // push apart along the axis of smaller overlap
        if (ox < oy) { const s = (dx >= 0 ? 1 : -1) * ox * 0.25; a.x -= s; b.x += s } else { const s = (dy >= 0 ? 1 : -1) * oy * 0.25; a.y -= s; b.y += s }
      }
    }
    for (const w of words) { const r = Math.hypot(w.x, w.y); if (r > 0.92) { w.x *= 0.92 / r; w.y *= 0.92 / r } }
  }
  return words
}

// ───────────────────────────── Parallel Tag Clouds ─────────────────────────────

export interface TagWord { word: string; count: number; score: number }
export interface TagColumn { name: string; words: TagWord[] }

/**
 * Parallel Tag Clouds (Collins, Viégas & Wattenberg 2009): one column of words per document group, the words of a column stacked
 * vertically in descending score, sized by their score. With `metric: 'distinct'` the score is the frequency multiplied by how few groups
 * contain the word (TF-IDF style), so words that set a group apart rise to the top; with 'count' it is the plain frequency.
 */
export function parallelTags(groups: readonly { name: string; texts: readonly string[] }[], opt: { top: number; metric: 'count' | 'distinct'; stop?: ReadonlySet<string> }): { columns: TagColumn[]; links: { word: string; col: number; a: number; b: number }[] } {
  const counts = groups.map((g) => { const m = new Map<string, number>(); for (const t of g.texts) for (const w of tokenize(t, opt.stop)) m.set(w, (m.get(w) ?? 0) + 1); return m })
  const df = new Map<string, number>()
  for (const m of counts) for (const w of m.keys()) df.set(w, (df.get(w) ?? 0) + 1)
  const G = groups.length
  const columns: TagColumn[] = groups.map((g, k) => ({
    name: g.name,
    words: [...counts[k].entries()].map(([word, count]) => ({ word, count, score: opt.metric === 'distinct' ? count * (Math.log((G + 1) / df.get(word)!) + 0.05) : count }))
      .sort((a, b) => b.score - a.score || b.count - a.count || a.word.localeCompare(b.word)).slice(0, opt.top),
  }))
  const links: { word: string; col: number; a: number; b: number }[] = []
  for (let c = 0; c + 1 < columns.length; c++) columns[c].words.forEach((w, a) => { const b = columns[c + 1].words.findIndex((x) => x.word === w.word); if (b >= 0) links.push({ word: w.word, col: c, a, b }) })
  return { columns, links }
}

// ───────────────────────────── Phrase Net ─────────────────────────────

export interface PhrasePattern { id: string; label: string; example: string; /** Suffixes of the left word (the particle) and the relation drawn as an arrow from left to right. */ suffixes: string[] }

export const phrasePatterns: PhrasePattern[] = [
  { id: 'and', label: 'X와/과 Y', example: '막대와 선', suffixes: ['와', '과', '하고'] },
  { id: 'of', label: 'X의 Y', example: '데이터의 관계', suffixes: ['의'] },
  { id: 'topic', label: 'X은/는 Y', example: '지도는 위치', suffixes: ['은', '는'] },
  { id: 'object', label: 'X을/를 Y', example: '변화를 보여', suffixes: ['을', '를'] },
  { id: 'at', label: 'X에/에서 Y', example: '시간에 따른', suffixes: ['에서', '에'] },
]

/** Lower-cased word with one trailing particle removed; unlike the word cloud it keeps one-character stems ("선은" → "선"). Verb endings are dropped (null). */
function stem(raw: string, stop?: ReadonlySet<string>): string | null {
  let w = raw.toLowerCase()
  if (!w || /니다$/.test(w)) return null
  const p = PARTICLES.find((q) => w.endsWith(q))
  if (p && w.length - p.length >= 1 && /[ㄱ-힝]/.test(w)) w = w.slice(0, -p.length)
  return w.length < 1 || stop?.has(w) ? null : w
}

export interface PhraseEdge { a: string; b: string; count: number }

/**
 * Phrase Net (van Ham, Wattenberg & Viégas 2009, simplified): finds pairs of consecutive words where the first carries the particle of the
 * chosen pattern and links them. Words are normalised like in the word cloud (one trailing particle removed); the pattern is checked on
 * the raw word, so "관계와 변화" matches "X와/과 Y". Edge width is the number of occurrences.
 */
export function phraseNet(sentences: readonly string[], patternId: string, opt: { minCount: number; stop?: ReadonlySet<string> }): { edges: PhraseEdge[]; nodes: { word: string; count: number }[] } {
  const pat = phrasePatterns.find((p) => p.id === patternId) ?? phrasePatterns[0]
  const m = new Map<string, number>()
  for (const s of sentences) {
    const raw = s.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    for (let i = 0; i + 1 < raw.length; i++) {
      const suf = pat.suffixes.find((q) => raw[i].endsWith(q))
      if (!suf || raw[i].length - suf.length < 2 || !/[ㄱ-힝]/.test(raw[i])) continue
      const left = stem(raw[i], opt.stop)
      const right = stem(raw[i + 1], opt.stop)
      if (!left || !right || left === right) continue
      const key = `${left}\u0001${right}`
      m.set(key, (m.get(key) ?? 0) + 1)
    }
  }
  const edges: PhraseEdge[] = [...m.entries()].filter(([, c]) => c >= opt.minCount).map(([k, count]) => { const [a, b] = k.split('\u0001'); return { a, b, count } }).sort((x, y) => y.count - x.count || x.a.localeCompare(y.a))
  const nc = new Map<string, number>()
  for (const e of edges) { nc.set(e.a, (nc.get(e.a) ?? 0) + e.count); nc.set(e.b, (nc.get(e.b) ?? 0) + e.count) }
  return { edges, nodes: [...nc.entries()].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count) }
}
