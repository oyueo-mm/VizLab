import { generateDataset } from '../data/datasets'
import { toNumber } from '../data/table'
import { colorAt } from '../lib/colors'
import { buildTree } from '../stats/hierarchy'
import { dustTarget, gosperLevelFor, gosperMap, normalizeColumns, type GNode, type Magnet } from '../stats/multi9'
import { metroSets, mosaicSets } from '../stats/sets9'
import { braid, paoh, setStreams, type EventRecord, type HyperEdge, type MembershipRecord } from '../stats/tempo9'
import { edgeAt, wordStream, type WordRow } from '../stats/text9'
import type { CircleMark, LineMark, Mark, PolyMark, RectMark, TextMark } from './heroFrames'

/**
 * Frames of the eight v0.9 stages: MetroSets, MosaicSets, Set Streams, Dust & Magnet, GosperMap, WordStream, PAOHvis and Sequence Braiding.
 * Each runs the app's own engine on seeded data; the module is a separate chunk that the home page fetches a few stages before the first of them.
 */

type Pt = [number, number]
const CLEAR = 'rgba(0,0,0,0)'
const PAD = { l: 18, r: 18, t: 18, b: 34 }
const seed = (cycle: number) => 11 + cycle * 17

const rectM = (k: string, x: number, y: number, wd: number, ht: number, fill: string, o = 1, r = 1.5): RectMark => ({ t: 'rect', k, x, y, w: Math.max(0, wd), h: Math.max(0, ht), r, fill, stroke: CLEAR, sw: 0, o })
const dot = (k: string, x: number, y: number, r: number, fill: string, o = 1): CircleMark => ({ t: 'circle', k, x, y, r, fill, o, from: { r: 0, o: 0 } })
const lineM = (k: string, x1: number, y1: number, x2: number, y2: number, stroke: string, sw: number, o = 1): LineMark => ({ t: 'line', k, x1, y1, x2, y2, stroke, sw, o, from: { o: 0 } })
const textM = (k: string, x: number, y: number, s: string, fill = '#8a9490'): TextMark => ({ t: 'text', k, x, y, text: s, anchor: 'middle', fill, o: 1 })
const pathM = (k: string, pts: Pt[], stroke: string, sw: number, so = 0.85): PolyMark => ({ t: 'poly', k, pts, closed: false, fill: CLEAR, stroke, fo: 0, so, sw, o: 1, from: { so: 0, o: 0 } })
const polyM = (k: string, pts: Pt[], fill: string, fo: number, stroke = '#fff', sw = 0.6): PolyMark => ({ t: 'poly', k, pts, closed: true, fill, stroke, fo, so: 1, sw, o: 1, from: { fo: 0, o: 0 } })

const inner = (w: number, h: number) => ({ x0: PAD.l + 4, x1: w - PAD.r - 4, y0: PAD.t + 4, y1: h - PAD.b - 2 })
const note = (k: string, w: number, h: number, s: string) => textM(k, w / 2, h - 12, s)

/** Cubic-bezier-like S curve between two points sampled at nine points (so that it can morph). */
const sCurve = (x0: number, y0: number, x1: number, y1: number): Pt[] => Array.from({ length: 9 }, (_, i) => { const t = i / 8, s = t * t * (3 - 2 * t); return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * s] as Pt })

function setsOf(cycle: number, n: number) {
  const t = generateDataset('lab-members', seed(cycle), n)
  const k = 5
  return { names: t.rows.map((r) => String(r[0])), member: Array.from({ length: k }, (_, s) => t.rows.map((r) => (toNumber(r[1 + s]) ?? 0) > 0)) }
}

// ─── MetroSets ───────────────────────────────────────────────────────────

function metroFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const { member, names } = setsOf(cycle, 18)
  const m = metroSets(member, names.length, { share: 0.2, seed: seed(cycle) })
  const cell = Math.min((a.x1 - a.x0) / Math.max(1, m.stats.cols - 1), (a.y1 - a.y0) / Math.max(1, m.stats.rows - 1), 40)
  const ox = (a.x0 + a.x1) / 2 - (cell * (m.stats.cols - 1)) / 2, oy = (a.y0 + a.y1) / 2 - (cell * (m.stats.rows - 1)) / 2
  const P = (p: Pt): Pt => [ox + p[0] * cell, oy + p[1] * cell]
  const marks: Mark[] = []
  m.edges.forEach((e, k) => e.lines.slice().sort((p, q) => p - q).forEach((s, j, arr) => {
    const pts = e.pts.map(P)
    const off = (j - (arr.length - 1) / 2) * 3.4
    const dx = pts[pts.length - 1][0] - pts[0][0], dy = pts[pts.length - 1][1] - pts[0][1], l = Math.hypot(dx, dy) || 1
    marks.push(pathM(`mt:e${k}:${s}`, pts.map((p) => [p[0] - (dy / l) * off, p[1] + (dx / l) * off] as Pt), colorAt(s), 3, 0.9))
  }))
  m.pos.forEach((p, i) => {
    if (!p) return
    const q = P(p), sets = member.map((_, s) => s).filter((s) => member[s][i])
    marks.push(dot(`mt:n${i}`, q[0], q[1], sets.length > 1 ? 5.4 : 3.2, sets.length > 1 ? '#374151' : colorAt(sets[0]), 1))
  })
  marks.push(note('mt:note', w, h, '집합 = 노선, 원소 = 역, 둘 이상의 노선이 만나면 환승역'))
  return marks
}

// ─── MosaicSets ──────────────────────────────────────────────────────────

function mosaicFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const { member, names } = setsOf(cycle, 22)
  const l = mosaicSets(member, names.length, 'hex', seed(cycle), 3000)
  const R = Math.min((a.x1 - a.x0) / ((l.cols + 0.5) * Math.sqrt(3)), (a.y1 - a.y0) / ((l.rows - 1) * 1.5 + 2)) * 0.98
  const ox = (a.x0 + a.x1) / 2 - ((l.cols + 0.5) * Math.sqrt(3) * R) / 2, oy = (a.y0 + a.y1) / 2 - (((l.rows - 1) * 1.5 + 2) * R) / 2
  const marks: Mark[] = []
  for (let c = 0; c < l.cols * l.rows; c++) {
    const x = c % l.cols, y = Math.floor(c / l.cols)
    const cx = ox + (x * Math.sqrt(3) + (y % 2 ? Math.sqrt(3) : Math.sqrt(3) / 2)) * R, cy = oy + (1 + y * 1.5) * R
    const item = l.itemAt[c]
    const sets = item >= 0 ? member.map((_, s) => s).filter((s) => member[s][item]) : []
    const pts: Pt[] = Array.from({ length: 6 }, (_, j) => [cx + R * 0.93 * Math.cos(Math.PI / 6 + (j * Math.PI) / 3), cy + R * 0.93 * Math.sin(Math.PI / 6 + (j * Math.PI) / 3)] as Pt)
    marks.push(polyM(`ms:c${c}`, pts, sets.length ? colorAt(sets[0]) : '#eef1f1', sets.length ? 0.42 : 0.5, '#fff', 1))
    if (sets.length > 1) marks.push(dot(`ms:d${c}`, cx, cy, R * 0.3, colorAt(sets[1]), 0.95))
  }
  marks.push(note('ms:note', w, h, '원소 하나가 격자 셀 하나, 같은 집합은 이어진 영역으로'))
  return marks
}

// ─── Set Streams ─────────────────────────────────────────────────────────

function streamsFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('membership-history', seed(cycle), 40)
  const rec: MembershipRecord[] = t.rows.map((r) => ({ item: String(r[0]), time: toNumber(r[1]) ?? 0, set: String(r[2]) }))
  const m = setStreams(rec)
  const R = m.combos.length, T = m.times.length
  const laneY = (c: number) => a.y0 + ((c + 0.5) / R) * (a.y1 - a.y0)
  const tx = (i: number) => a.x0 + 8 + (i / (T - 1)) * (a.x1 - a.x0 - 16)
  const unit = ((a.y1 - a.y0) / R) * 0.9 / Math.max(1, ...m.counts.flat())
  const marks: Mark[] = []
  m.flows.forEach((fl, ti) => fl.forEach((f) => {
    if (f.from === f.to) return
    const first = m.combos[f.from].sets[0]
    marks.push(pathM(`ss:f${ti}:${f.from}:${f.to}`, sCurve(tx(ti) + 4, laneY(f.from), tx(ti + 1) - 4, laneY(f.to)), first == null ? '#b6bec4' : colorAt(first), Math.max(1, f.n * unit), 0.5))
  }))
  m.counts.forEach((row, c) => row.forEach((n, ti) => { if (n > 0) marks.push(rectM(`ss:b${c}:${ti}`, tx(ti) - 4, laneY(c) - (n * unit) / 2, 8, Math.max(1.5, n * unit), m.combos[c].sets[0] == null ? '#b6bec4' : colorAt(m.combos[c].sets[0]), 0.95, 2)) }))
  marks.push(note('ss:note', w, h, '줄 = 집합 조합, 리본 = 같은 개체가 다음 시점에 옮겨 가는 조합'))
  return marks
}

// ─── Dust & Magnet ───────────────────────────────────────────────────────

function dustFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('phone-specs', 7, 30)
  const vars = [1, 2, 3, 4, 5, 6]
  const vals = normalizeColumns(t.rows.map((r) => vars.map((c) => toNumber(r[c]) ?? 0)))
  const cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2, R = Math.min(a.x1 - a.x0, a.y1 - a.y0) * 0.42
  const spin = cycle * 0.6
  const mags: Magnet[] = vars.map((_, j) => ({ x: cx + R * Math.cos(spin - Math.PI / 2 + (2 * Math.PI * j) / 6), y: cy + R * Math.sin(spin - Math.PI / 2 + (2 * Math.PI * j) / 6), strength: 1, on: true }))
  const marks: Mark[] = []
  vals.forEach((v, i) => {
    const p = dustTarget(v, mags, 2.5) ?? [cx, cy]
    marks.push(dot(`dm:p${i}`, p[0], p[1], 4.4, colorAt(v.indexOf(Math.max(...v))), 0.8))
  })
  mags.forEach((m, j) => marks.push(dot(`dm:m${j}`, m.x, m.y, 9, colorAt(j), 0.95)))
  marks.push(note('dm:note', w, h, '변수 = 자석, 관측값 = 먼지 — 끌림이 균형을 이루는 곳에 놓임'))
  return marks
}

// ─── GosperMap ───────────────────────────────────────────────────────────

function gosperFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('budget', 7, 0)
  const { tree } = buildTree(t, ['부문', '부서', '항목'], t.columns.find((c) => c.type === 'number')?.name ?? null)
  const leaves = (n: GNode): number => (n.children?.length ? n.children.reduce((s, c) => s + leaves(c), 0) : 1)
  const g = gosperMap(tree as GNode, Math.min(3, gosperLevelFor(leaves(tree as GNode), 6)))
  const xs = g.cells.map((c) => c[0]), ys = g.cells.map((c) => c[1])
  const minX = Math.min(...xs) - 1, maxX = Math.max(...xs) + 1, minY = Math.min(...ys) - 1, maxY = Math.max(...ys) + 1
  const k = Math.min((a.x1 - a.x0) / (maxX - minX), (a.y1 - a.y0) / (maxY - minY))
  const ox = (a.x0 + a.x1) / 2 - ((maxX - minX) * k) / 2, oy = (a.y0 + a.y1) / 2 - ((maxY - minY) * k) / 2
  const top = [...new Set(g.leaves.map((l) => l.path[0]))]
  const marks: Mark[] = []
  const rot = (cycle % 6) // the colours rotate between loops so the picture changes
  g.cells.forEach((c, i) => {
    const li = g.leafOf[i], lf = g.leaves[li]
    const idx = top.indexOf(lf.path[0])
    const pts: Pt[] = Array.from({ length: 6 }, (_, j) => [ox + (c[0] + (Math.cos(Math.PI / 6 + (j * Math.PI) / 3)) / Math.sqrt(3) - minX) * k, oy + (c[1] + (Math.sin(Math.PI / 6 + (j * Math.PI) / 3)) / Math.sqrt(3) - minY) * k] as Pt)
    marks.push(polyM(`gm:c${i}`, pts, colorAt(idx + rot), 0.55 + 0.35 * ((li % 5) / 4), '#fff', 0.5))
  })
  marks.push(note('gm:note', w, h, '고스퍼 곡선을 따라 계층의 잎에 값만큼의 구간을 줌'))
  return marks
}

// ─── WordStream ──────────────────────────────────────────────────────────

function wordStreamFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('topic-words', seed(cycle), 8)
  const rows: WordRow[] = t.rows.map((r) => ({ time: toNumber(r[0]) ?? 0, topic: String(r[1]), word: String(r[2]), freq: toNumber(r[3]) ?? 0 }))
  const W = a.x1 - a.x0, H = a.y1 - a.y0
  const L = wordStream(rows, W, H, { topWords: 2, minSize: 9, maxSize: 20 })
  const marks: Mark[] = []
  const xs = Array.from({ length: 28 }, (_, i) => L.xs[0] + (i * (L.xs[L.xs.length - 1] - L.xs[0])) / 27)
  L.topics.forEach((_, k) => {
    const pts: Pt[] = [...xs.map((x) => [a.x0 + x, a.y0 + edgeAt(L.xs, L.top[k], x)] as Pt), ...[...xs].reverse().map((x) => [a.x0 + x, a.y0 + edgeAt(L.xs, L.bottom[k], x)] as Pt)]
    marks.push(polyM(`wsm:b${k}`, pts, colorAt(k), 0.3, colorAt(k), 1))
  })
  L.words.filter((x) => x.size >= 12).slice(0, 14).forEach((x, i) => marks.push(textM(`wsm:w${i}:${x.text}`, a.x0 + x.x, a.y0 + x.y + 4, x.text, colorAt(x.topic))))
  marks.push(note('wsm:note', w, h, '토픽 = 시간을 따라 흐르는 띠, 띠 안의 글자 크기 = 빈도'))
  return marks
}

// ─── PAOHvis ─────────────────────────────────────────────────────────────

function paohFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('team-projects', seed(cycle), 6)
  const map = new Map<string, HyperEdge>()
  for (const r of t.rows) { const time = toNumber(r[0]) ?? 0, id = String(r[1]); const e = map.get(`${time}|${id}`) ?? { time, id, members: [] }; e.members.push(String(r[2])); map.set(`${time}|${id}`, e) }
  const l = paoh([...map.values()].filter((e) => new Set(e.members).size >= 2), 'barycenter')
  const rowH = (a.y1 - a.y0) / l.nodes.length
  const step = (a.x1 - a.x0 - 16) / Math.max(1, l.columns.length)
  const marks: Mark[] = []
  l.nodes.forEach((_, r) => marks.push(lineM(`ph:r${r}`, a.x0, a.y0 + (r + 0.5) * rowH, a.x1, a.y0 + (r + 0.5) * rowH, '#e3e8e8', 1)))
  l.columns.forEach((c, i) => {
    const x = a.x0 + 8 + (i + 0.5) * step
    marks.push(lineM(`ph:e${i}`, x, a.y0 + (c.rows[0] + 0.5) * rowH, x, a.y0 + (c.rows[c.rows.length - 1] + 0.5) * rowH, colorAt(0), 1.8 + c.count))
    c.rows.forEach((r) => marks.push(dot(`ph:d${i}:${r}`, x, a.y0 + (r + 0.5) * rowH, 3.2, '#1f6f67', 1)))
  })
  marks.push(note('ph:note', w, h, '가로선 = 참여자, 세로선 = 한 번의 모임(하이퍼에지)'))
  return marks
}

// ─── Sequence Braiding ───────────────────────────────────────────────────

function braidFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('care-braids', seed(cycle), 24)
  const rec: EventRecord[] = t.rows.map((r) => ({ entity: String(r[0]), order: toNumber(r[1]) ?? 0, event: String(r[2]), group: String(r[3]) }))
  const m = braid(rec, 'path')
  const colW = (a.x1 - a.x0) / m.layers, nodeW = Math.min(14, colW * 0.4)
  const per = m.nodes.map((_, i) => i)
  const unit = Math.max(1, Math.min(4, (a.y1 - a.y0 - 50) / Math.max(1, Math.max(...Array.from({ length: m.layers }, (_, l) => per.filter((i) => m.nodes[i].layer === l).reduce((s, i) => s + m.nodes[i].visits, 0))))))
  const pos = new Map<number, { x: number; y: number; hgt: number }>()
  for (let l = 0; l < m.layers; l++) {
    const ids = per.filter((i) => m.nodes[i].layer === l).sort((p, q) => m.nodes[p].rank - m.nodes[q].rank)
    const total = ids.reduce((s, i) => s + m.nodes[i].visits * unit, 0) + Math.max(0, ids.length - 1) * 14
    let y = (a.y0 + a.y1) / 2 - total / 2
    ids.forEach((i) => { pos.set(i, { x: a.x0 + l * colW + (colW - nodeW) / 2, y, hgt: m.nodes[i].visits * unit }); y += m.nodes[i].visits * unit + 14 })
  }
  const marks: Mark[] = []
  const gc = (g: string) => colorAt(m.groups.indexOf(g))
  m.strands.forEach((s, si) => { for (let k = 0; k < s.path.length - 1; k++) {
    const A = pos.get(s.path[k])!, B = pos.get(s.path[k + 1])!
    const ya = A.y + ((m.slots[s.path[k]].findIndex(([q, st]) => q === si && st === k) + 0.5) * A.hgt) / m.nodes[s.path[k]].visits
    const yb = B.y + ((m.slots[s.path[k + 1]].findIndex(([q, st]) => q === si && st === k + 1) + 0.5) * B.hgt) / m.nodes[s.path[k + 1]].visits
    marks.push(pathM(`bd:s${si}:${k}`, sCurve(A.x + nodeW, ya, B.x, yb), gc(s.group), 1, 0.5))
  } })
  pos.forEach((p, i) => marks.push(rectM(`bd:n${i}`, p.x, p.y, nodeW, p.hgt, '#e8ecec', 0.95, 2)))
  marks.push(note('bd:note', w, h, '사건 유형 = 노드, 개체의 사건열 = 노드를 지나는 가닥'))
  return marks
}

export const HERO_V9 = { metro: metroFrame, mosaic: mosaicFrame, streams: streamsFrame, dust: dustFrame, gosper: gosperFrame, wstream: wordStreamFrame, paoh: paohFrame, braid: braidFrame }
export type HeroV9Key = keyof typeof HERO_V9

export function buildV9(key: HeroV9Key, cycle: number, w: number, h: number): Mark[] {
  return HERO_V9[key](cycle, w, h)
}
