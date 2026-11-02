import * as d3 from 'd3'
import { generateDataset } from '../data/datasets'
import { toNumber } from '../data/table'
import { colorAt } from '../lib/colors'
import { buildTree } from '../stats/hierarchy'
import { bagplot, decisionCurve, divergingBars } from '../stats/stat10b'
import { contourBoxplot, spaceTree } from '../stats/stat10c'
import { functionalBoxplot, lorenz, poissonPmf, rootogram, tornado } from '../stats/stat10'
import { persistence, type Grid2 } from '../stats/topo10'
import type { CircleMark, LineMark, Mark, PolyMark, RectMark, TextMark } from './heroFrames'

/**
 * Frames of the ten v1.0 stages: Functional Boxplot, Lorenz Curve, Tornado Chart, Bagplot, Diverging Stacked Bar, Decision Curve,
 * Contour Boxplot, Hanging Rootogram, Persistence Barcode and SpaceTree. Each runs the app's own engine on seeded data; the module
 * is a separate chunk that the home page fetches a few stages before the first of them.
 */

type Pt = [number, number]
const CLEAR = 'rgba(0,0,0,0)'
const PAD = { l: 22, r: 18, t: 20, b: 34 }
const seed = (cycle: number) => 31 + cycle * 13

const rectM = (k: string, x: number, y: number, wd: number, ht: number, fill: string, o = 1, r = 1.5): RectMark => ({ t: 'rect', k, x, y, w: Math.max(0, wd), h: Math.max(0, ht), r, fill, stroke: CLEAR, sw: 0, o })
const dot = (k: string, x: number, y: number, r: number, fill: string, o = 1): CircleMark => ({ t: 'circle', k, x, y, r, fill, o, from: { r: 0, o: 0 } })
const lineM = (k: string, x1: number, y1: number, x2: number, y2: number, stroke: string, sw: number, o = 1): LineMark => ({ t: 'line', k, x1, y1, x2, y2, stroke, sw, o, from: { o: 0 } })
const textM = (k: string, x: number, y: number, s: string, fill = '#8a9490'): TextMark => ({ t: 'text', k, x, y, text: s, anchor: 'middle', fill, o: 1 })
const pathM = (k: string, pts: Pt[], stroke: string, sw: number, so = 0.9): PolyMark => ({ t: 'poly', k, pts, closed: false, fill: CLEAR, stroke, fo: 0, so, sw, o: 1, from: { so: 0, o: 0 } })
const polyM = (k: string, pts: Pt[], fill: string, fo: number, stroke = '#fff', sw = 0.6): PolyMark => ({ t: 'poly', k, pts, closed: true, fill, stroke, fo, so: 1, sw, o: 1, from: { fo: 0, o: 0 } })

const inner = (w: number, h: number) => ({ x0: PAD.l, x1: w - PAD.r, y0: PAD.t, y1: h - PAD.b })
const note = (k: string, w: number, h: number, s: string) => textM(k, w / 2, h - 12, s)
const num = (v: unknown) => toNumber(v as never) ?? 0

// ─── Functional boxplot ──────────────────────────────────────────────────

function fboxFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('ensemble-curves', seed(cycle), 24)
  const by = new Map<string, number[]>()
  const times = [...new Set(t.rows.map((r) => num(r[1])))].sort((p, q) => p - q)
  for (const r of t.rows) { const k = String(r[0]); if (!by.has(k)) by.set(k, []); by.get(k)![times.indexOf(num(r[1]))] = num(r[2]) }
  const curves = [...by.values()]
  const fb = functionalBoxplot(curves, 1.5)
  const all = [...curves.flat(), ...fb.fenceLo, ...fb.fenceHi]
  const sx = d3.scaleLinear().domain([0, times.length - 1]).range([a.x0, a.x1]), sy = d3.scaleLinear().domain([Math.min(...curves.flat()), Math.max(...curves.flat())]).range([a.y1, a.y0])
  void all
  const P = (ys: number[]) => ys.map((v, i) => [sx(i), sy(v)] as Pt)
  const marks: Mark[] = []
  const band = (lo: number[], hi: number[]) => [...P(hi), ...P(lo).reverse()]
  marks.push(polyM('fb:box', band(fb.lower, fb.upper), '#a9d3c4', 0.7, CLEAR, 0))
  curves.forEach((c, i) => { if (!fb.outliers.includes(i)) marks.push(pathM(`fb:c${i}`, P(c), '#b4bdbd', 0.8, 0.5)) })
  fb.outliers.forEach((i) => marks.push(pathM(`fb:o${i}`, P(curves[i]), '#d4452f', 1.6, 0.95)))
  marks.push(pathM('fb:med', P(curves[fb.median]), '#111827', 2.6, 1))
  marks.push(note('fb:note', w, h, `깊이 가장 큰 곡선 = 중앙값 · 이상 곡선 ${fb.outliers.length}개`))
  return marks
}

// ─── Lorenz curve ────────────────────────────────────────────────────────

function lorenzFrame(cycle: number, w: number, h: number): Mark[] {
  const t = generateDataset('income-dist', seed(cycle), 100)
  const l = lorenz(t.rows.map((r) => num(r[1])))
  const side = Math.min(w - 60, h - PAD.b - PAD.t - 6), ox = (w - side) / 2, oy = PAD.t
  const X = (v: number) => ox + v * side, Y = (v: number) => oy + side - v * side
  const curve = l.points.map((p) => [X(p[0]), Y(p[1])] as Pt)
  const marks: Mark[] = [
    polyM('lz:area', [[X(0), Y(0)], [X(1), Y(1)], ...[...curve].reverse()], '#e07a3f', 0.28, CLEAR, 0),
    lineM('lz:eq', X(0), Y(0), X(1), Y(1), '#6b7280', 1.2, 0.9),
    pathM('lz:curve', curve, '#d4452f', 2.6, 1),
    textM('lz:gini', X(0.22), Y(0.85), `지니계수 ${l.gini.toFixed(2)}`, '#d4452f'),
  ]
  for (let d = 1; d <= 9; d++) { const p = l.points[Math.round((d / 10) * (l.points.length - 1))]; marks.push(dot(`lz:d${d}`, X(p[0]), Y(p[1]), 3.6, '#fff', 1)) }
  marks.push(note('lz:note', w, h, '누적 인구 비율에 대한 누적 소득 비율 · 대각선과의 면적 = 지니계수/2'))
  return marks
}

// ─── Tornado chart ───────────────────────────────────────────────────────

function tornadoFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const rows = generateDataset('sensitivity', seed(cycle)).rows.map((r) => ({ name: String(r[0]), low: num(r[1]), high: num(r[2]) }))
  // jitter the swing a little per cycle so the loop is not static
  const j = (i: number) => 1 + 0.25 * Math.sin(cycle * 1.7 + i * 2.3)
  const bars = tornado(100, rows.map((r, i) => ({ ...r, low: 100 + (r.low - 100) * j(i), high: 100 + (r.high - 100) * j(i) })))
  const lo = Math.min(...bars.flatMap((b) => [b.low, b.high])), hi = Math.max(...bars.flatMap((b) => [b.low, b.high]))
  const sx = d3.scaleLinear().domain([lo, hi]).range([a.x0 + 4, a.x1 - 4])
  const rowH = (a.y1 - a.y0) / bars.length
  const marks: Mark[] = []
  bars.forEach((b, i) => {
    const y = a.y0 + i * rowH + 2
    marks.push(rectM(`tn:l${i}`, Math.min(sx(100), sx(b.low)), y, Math.abs(sx(b.low) - sx(100)), rowH - 5, '#4c6fb5', 0.9, 2))
    marks.push(rectM(`tn:h${i}`, Math.min(sx(100), sx(b.high)), y, Math.abs(sx(b.high) - sx(100)), rowH - 5, '#e07a3f', 0.9, 2))
  })
  marks.push(lineM('tn:base', sx(100), a.y0 - 4, sx(100), a.y1, '#1f2937', 1.4, 1))
  marks.push(note('tn:note', w, h, '입력 변수를 하나씩만 바꿨을 때의 결과 변화 · 영향 큰 순'))
  return marks
}

// ─── Bagplot ─────────────────────────────────────────────────────────────

function bagFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('bag-points', seed(cycle), 70)
  const pts = t.rows.map((r) => [num(r[1]), num(r[2])] as Pt)
  const bp = bagplot(pts, 3, 120)
  const ex = d3.extent([...pts.map((p) => p[0]), ...bp.fence.map((p) => p[0])]) as [number, number], ey = d3.extent([...pts.map((p) => p[1]), ...bp.fence.map((p) => p[1])]) as [number, number]
  const sx = d3.scaleLinear().domain(ex).range([a.x0, a.x1]), sy = d3.scaleLinear().domain(ey).range([a.y1, a.y0])
  const S = (p: Pt): Pt => [sx(p[0]), sy(p[1])]
  const out = new Set(bp.outliers)
  const marks: Mark[] = [polyM('bg:fence', bp.fence.map(S), '#e8f1ee', 0.9, '#9fc4b8', 1), polyM('bg:bag', bp.bag.map(S), '#a9d3c4', 0.85, '#3f8f78', 1.4)]
  pts.forEach((p, i) => { const q = S(p); marks.push(dot(`bg:p${i}`, q[0], q[1], out.has(i) ? 4 : 2.4, out.has(i) ? '#d4452f' : '#3b4a52', out.has(i) ? 1 : 0.7)) })
  const c = S(bp.center)
  marks.push(dot('bg:c', c[0], c[1], 5, '#fff', 1))
  marks.push(note('bg:note', w, h, `깊이가 큰 절반 = 가방 · 울타리 밖 ${bp.outliers.length}점 = 이상점`))
  return marks
}

// ─── Diverging stacked bar ───────────────────────────────────────────────

const DIV = ['#b2182b', '#ef8a62', '#d9d9d9', '#67a9cf', '#2166ac']

function divFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('likert-survey', seed(cycle), 200)
  const by = new Map<string, number[]>()
  for (const r of t.rows) { const k = String(r[0]); if (!by.has(k)) by.set(k, [0, 0, 0, 0, 0]); by.get(k)![num(r[1]) - 1] += num(r[2]) }
  const bars = divergingBars([...by.entries()].map(([name, counts]) => ({ name, counts }))).sort((p, q) => q.positive - p.positive)
  const lim = Math.max(...bars.map((b) => Math.max(b.negative + b.neutral / 2, b.positive + b.neutral / 2)))
  const sx = d3.scaleLinear().domain([-lim, lim]).range([a.x0, a.x1])
  const rowH = (a.y1 - a.y0) / bars.length
  const marks: Mark[] = []
  bars.forEach((b, i) => b.shares.forEach((s, l) => marks.push(rectM(`dv:${i}:${l}`, sx(b.starts[l]), a.y0 + i * rowH + 2, sx(b.starts[l] + s) - sx(b.starts[l]), rowH - 5, DIV[l], 0.95, 1))))
  marks.push(lineM('dv:zero', sx(0), a.y0 - 4, sx(0), a.y1, '#1f2937', 1.4, 1))
  marks.push(note('dv:note', w, h, '중립 응답을 0선에 걸치고 부정은 왼쪽, 긍정은 오른쪽'))
  return marks
}

// ─── Decision curve ──────────────────────────────────────────────────────

function dcaFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('risk-prediction', seed(cycle), 400)
  const o = t.rows.map((r) => num(r[1]))
  const ts = Array.from({ length: 60 }, (_, k) => 0.01 * (k + 1))
  const A = decisionCurve(o, t.rows.map((r) => num(r[2])), ts), B = decisionCurve(o, t.rows.map((r) => num(r[3])), ts)
  const ys = [...A.flatMap((p) => [p.model, p.all]), ...B.map((p) => p.model), 0]
  const sx = d3.scaleLinear().domain([0.01, 0.6]).range([a.x0, a.x1]), sy = d3.scaleLinear().domain([Math.max(-0.05, Math.min(...ys)), Math.max(...ys) * 1.05]).range([a.y1, a.y0])
  const L = (pts: { threshold: number; v: number }[]) => pts.map((p) => [sx(p.threshold), sy(Math.max(sy.domain()[0], p.v))] as Pt)
  const ticks: Mark[] = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6].flatMap((v) => [lineM(`dc:t${v}`, sx(v), a.y1, sx(v), a.y1 + 4, '#9aa6a6', 1, 1), textM(`dc:tl${v}`, sx(v), a.y1 + 15, `${Math.round(v * 100)}%`)])
  return [
    ...ticks,
    pathM('dc:all', L(A.map((p) => ({ threshold: p.threshold, v: p.all }))), '#8f98a3', 1.6, 0.9),
    lineM('dc:none', sx(0.01), sy(0), sx(0.6), sy(0), '#1f2937', 1.6, 1),
    pathM('dc:b', L(B.map((p) => ({ threshold: p.threshold, v: p.model }))), '#4c6fb5', 2.2, 0.95),
    pathM('dc:a', L(A.map((p) => ({ threshold: p.threshold, v: p.model }))), '#d4452f', 2.6, 1),
    note('dc:note', w, h, '임계 확률별 순이득 · 모두 개입(점선)·아무도 개입 안 함(0)보다 위일 때 유용'),
  ]
}

// ─── Contour boxplot ─────────────────────────────────────────────────────

function contourFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const G = 28
  const t = generateDataset('contour-ensemble', seed(cycle), 14)
  const names = [...new Set(t.rows.map((r) => String(r[0])))]
  const masks = names.map((nm) => { const m = new Uint8Array(G * G); for (const r of t.rows) if (String(r[0]) === nm && num(r[3]) >= 0.5) m[num(r[2]) * G + num(r[1])] = 1; return m })
  const cb = contourBoxplot(masks, 1.5)
  const side = Math.min(a.x1 - a.x0, a.y1 - a.y0), k = side / G, ox = (w - side) / 2, oy = a.y0
  const rings = (m: Uint8Array): Pt[][] => {
    const mp = d3.contours().size([G, G]).thresholds([0.5])(Array.from(m))[0]
    return mp.coordinates.flatMap((poly) => poly.map((ring) => ring.map(([x, y]) => [ox + x * k, oy + y * k] as Pt)))
  }
  const marks: Mark[] = []
  masks.forEach((m, mi) => { if (mi !== cb.median && !cb.outliers.includes(mi)) rings(m).forEach((r, i) => marks.push(pathM(`cb:a${mi}:${i}`, [...r, r[0]], '#b4bdbd', 0.8, 0.5))) })
  rings(cb.union).forEach((r, i) => marks.push(polyM(`cb:u${i}`, r, '#a9d3c4', 0.55, '#3f8f78', 1)))
  rings(cb.intersection).forEach((r, i) => marks.push(polyM(`cb:i${i}`, r, '#ffffff', 0.9, '#3f8f78', 1)))
  cb.outliers.forEach((o) => rings(masks[o]).forEach((r, i) => marks.push(pathM(`cb:o${o}:${i}`, [...r, r[0]], '#d4452f', 1.6, 0.95))))
  rings(masks[cb.median]).forEach((r, i) => marks.push(pathM(`cb:m${i}`, [...r, r[0]], '#111827', 2.4, 1)))
  marks.push(textM('cb:l1', ox + side / 2, oy + side + 12, '초록 = 상자(깊이 큰 절반의 합집합), 흰색 = 교집합'))
  marks.push(note('cb:note', w, h, `윤곽 띠 깊이 · 중앙 윤곽(검정) · 이상 윤곽 ${cb.outliers.length}개(점선 색)`))
  return marks
}

// ─── Hanging rootogram ───────────────────────────────────────────────────

function rootFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const counts = generateDataset('count-data', seed(cycle), 300).rows.map((r) => num(r[1]))
  const K = 9
  const obs = Array.from({ length: K + 1 }, (_, k) => counts.filter((c) => c === k).length)
  const mean = counts.reduce((s, v) => s + v, 0) / counts.length
  const bars = rootogram(obs, poissonPmf(mean, K).map((p) => p * counts.length))
  const ymin = Math.min(0, ...bars.map((b) => b.bottom)), ymax = Math.max(...bars.map((b) => b.top))
  const sy = d3.scaleLinear().domain([ymin * 1.1, ymax * 1.05]).range([a.y1, a.y0])
  const bw = (a.x1 - a.x0) / bars.length
  const marks: Mark[] = []
  bars.forEach((b, i) => marks.push(rectM(`rt:b${i}`, a.x0 + i * bw + 3, sy(b.top), bw - 6, Math.max(0, sy(b.bottom) - sy(b.top)), b.bottom < 0 ? '#d4452f' : '#6fa8dc', 0.85, 1.5)))
  marks.push(pathM('rt:exp', bars.map((b, i) => [a.x0 + (i + 0.5) * bw, sy(b.top)] as Pt), '#1f2937', 2, 1))
  marks.push(lineM('rt:zero', a.x0, sy(0), a.x1, sy(0), '#6b7280', 1.2, 1))
  marks.push(note('rt:note', w, h, '기대 곡선에 매달린 막대 · 0선 아래로 내려가면 포아송이 과소 예측'))
  return marks
}

// ─── Persistence barcode ─────────────────────────────────────────────────

function persistFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const rows = generateDataset('terrain-field', seed(cycle)).rows
  const xs = [...new Set(rows.map((r) => num(r[0])))].sort((p, q) => p - q), ys = [...new Set(rows.map((r) => num(r[1])))].sort((p, q) => p - q)
  const g: Grid2 = { nx: xs.length, ny: ys.length, v: new Float64Array(xs.length * ys.length) }
  for (const r of rows) g.v[ys.indexOf(num(r[1])) * xs.length + xs.indexOf(num(r[0]))] = num(r[2])
  const pairs = persistence(g).filter((p) => p.kind === 'max' && p.saddle >= 0).sort((p, q) => (q.birth - q.death) - (p.birth - p.death)).slice(0, 14)
  const lo = Math.min(...pairs.map((p) => p.death)), hi = Math.max(...pairs.map((p) => p.birth))
  if (!pairs.length) return [note('ps:note', w, h, '봉우리가 하나뿐입니다')]
  const sx = d3.scalePow().exponent(0.5).domain([lo, hi]).range([a.x0, a.x1]) // square-root scale so that the small bars stay visible next to the dominant peak
  const rowH = (a.y1 - a.y0) / pairs.length
  const marks: Mark[] = []
  pairs.forEach((p, i) => marks.push(rectM(`ps:b${i}`, sx(p.death), a.y0 + i * rowH + 2, Math.max(2, sx(p.birth) - sx(p.death)), Math.max(2, rowH - 5), colorAt(0), 0.9, 1.5)))
  marks.push(note('ps:note', w, h, '극대마다 생성(오른쪽 끝)에서 소멸(왼쪽 끝)까지 · 긴 막대 = 의미 있는 봉우리(제곱근 눈금)'))
  return marks
}

// ─── SpaceTree ───────────────────────────────────────────────────────────

function spaceFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('org-tree', seed(cycle))
  const { tree } = buildTree(t, ['부문', '팀', '파트'], null)
  // walk a path that changes from cycle to cycle: the selected node moves down the tree
  const sel: string[] = []
  let node: { name: string; children?: { name: string; children?: unknown[] }[] } = tree
  for (let d = 0; d < 2 && node.children?.length; d++) { node = node.children[(cycle * 3 + d) % node.children.length] as typeof node; sel.push(node.name) }
  const nodes = spaceTree(tree, sel, h, 16)
  const maxD = Math.max(...nodes.map((n) => n.depth))
  const colW = (w - 28) / (maxD + 1.3), bw = Math.min(colW * 0.7, 90)
  const X = (d: number) => 14 + d * colW
  const marks: Mark[] = []
  nodes.forEach((n, i) => {
    if (n.parent >= 0) { const p = nodes[n.parent]; const x0 = X(p.depth) + bw, x1 = X(n.depth), mx = (x0 + x1) / 2; marks.push(pathM(`sp:e${i}`, Array.from({ length: 9 }, (_, q) => { const u = q / 8, s = u * u * (3 - 2 * u); return [x0 + (x1 - x0) * u, p.y + (n.y - p.y) * s] as Pt }), '#b7c3c3', 1.2, 0.9)); void mx }
    marks.push(rectM(`sp:n${i}`, X(n.depth), n.y - n.h / 2, bw, n.h, n.open ? '#cfe6dd' : '#eef2f2', 1, 3))
    if (n.hasKids && !n.open) marks.push(polyM(`sp:t${i}`, [[X(n.depth) + bw + 3, n.y - Math.min(n.h, 3 + Math.sqrt(n.leaves) * 2)], [X(n.depth) + bw + 14, n.y], [X(n.depth) + bw + 3, n.y + Math.min(n.h, 3 + Math.sqrt(n.leaves) * 2)]], '#8fb7a8', 0.95, CLEAR, 0))
  })
  void a
  marks.push(note('sp:note', w, h, '선택한 경로만 펼치고 나머지는 접은 트리 · 삼각형 = 아래 잎 수'))
  return marks
}

export const HERO_V10 = { fbox: fboxFrame, lorenz: lorenzFrame, tornado: tornadoFrame, bag: bagFrame, divbar: divFrame, dca: dcaFrame, cbox: contourFrame, rootogram: rootFrame, persist: persistFrame, spacetree: spaceFrame }
export type HeroV10Key = keyof typeof HERO_V10

export function buildV10(key: HeroV10Key, cycle: number, w: number, h: number): Mark[] {
  return HERO_V10[key](cycle, w, h)
}
