import * as d3 from 'd3'
import { generateDataset } from '../data/datasets'
import { toNumber } from '../data/table'
import { colorAt } from '../lib/colors'
import { koreaRows } from '../geo/data/stats'
import { continuousScatterplot, type Field2 } from '../stats/dyn11'
import { rectangularCartogram } from '../stats/field11'
import { buildTree } from '../stats/hierarchy'
import { hasse, hasseOrder, hintonSide, nomogram, piperLayout, piperPercents, piperPoints, skillStats, taylorPoint, toMeq, type Ions } from '../stats/model11'
import { bspline, bundlePath, cactusTree, historyFlow, pythagoras, type TreeIn } from '../stats/tree11'
import type { CircleMark, LineMark, Mark, PolyMark, RectMark, TextMark } from './heroFrames'

/**
 * Frames of the ten v1.1 stages: Hinton Diagram, Taylor Diagram, Piper Diagram, Pythagoras Tree, CactusTree, History Flow, Hasse Diagram, Nomogram,
 * Continuous Scatterplot and Rectangular Cartogram. Each runs the app's own engine on seeded data; the module is a separate chunk that the home page
 * fetches a few stages before the first of them.
 */

type Pt = [number, number]
const CLEAR = 'rgba(0,0,0,0)'
const PAD = { l: 22, r: 18, t: 20, b: 34 }
const seed = (cycle: number) => 41 + cycle * 11

const rectM = (k: string, x: number, y: number, wd: number, ht: number, fill: string, o = 1, r = 1.5): RectMark => ({ t: 'rect', k, x, y, w: Math.max(0, wd), h: Math.max(0, ht), r, fill, stroke: CLEAR, sw: 0, o })
const dot = (k: string, x: number, y: number, r: number, fill: string, o = 1): CircleMark => ({ t: 'circle', k, x, y, r, fill, o, from: { r: 0, o: 0 } })
const lineM = (k: string, x1: number, y1: number, x2: number, y2: number, stroke: string, sw: number, o = 1): LineMark => ({ t: 'line', k, x1, y1, x2, y2, stroke, sw, o, from: { o: 0 } })
const textM = (k: string, x: number, y: number, s: string, fill = '#8a9490'): TextMark => ({ t: 'text', k, x, y, text: s, anchor: 'middle', fill, o: 1 })
const pathM = (k: string, pts: Pt[], stroke: string, sw: number, so = 0.9): PolyMark => ({ t: 'poly', k, pts, closed: false, fill: CLEAR, stroke, fo: 0, so, sw, o: 1, from: { so: 0, o: 0 } })
const polyM = (k: string, pts: Pt[], fill: string, fo: number, stroke = '#fff', sw = 0.6): PolyMark => ({ t: 'poly', k, pts, closed: true, fill, stroke, fo, so: 1, sw, o: 1, from: { fo: 0, o: 0 } })

const inner = (w: number, h: number) => ({ x0: PAD.l, x1: w - PAD.r, y0: PAD.t, y1: h - PAD.b })
const note = (k: string, w: number, h: number, s: string) => textM(k, w / 2, h - 12, s)
const num = (v: unknown) => toNumber(v as never) ?? 0

// ─── Hinton diagram ──────────────────────────────────────────────────────

function hintonFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const n = 7
  const t = generateDataset('signed-matrix', seed(cycle), n)
  const maxAbs = Math.max(...t.rows.map((r) => Math.abs(num(r[2]))))
  const cw = Math.min((a.x1 - a.x0) / n, (a.y1 - a.y0) / n)
  const ox = (w - cw * n) / 2, oy = a.y0
  const marks: Mark[] = []
  t.rows.forEach((r, k) => {
    const i = Math.floor(k / n), j = k % n, v = num(r[2])
    const s = hintonSide(v, maxAbs) * cw * 0.9
    marks.push(rectM(`hn:${i}:${j}`, ox + j * cw + (cw - s) / 2, oy + i * cw + (cw - s) / 2, s, s, v >= 0 ? '#2a8c82' : '#d4452f', 0.92, 1))
  })
  marks.push(note('hn:note', w, h, '면적 = |값|, 청록 = 양수, 붉은색 = 음수'))
  return marks
}

// ─── Taylor diagram ──────────────────────────────────────────────────────

function taylorFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('model-skill', seed(cycle), 120)
  const o = t.rows.map((r) => num(r[1]))
  const stats = [2, 3, 4].map((c) => skillStats(o, t.rows.map((r) => num(r[c]))))
  const rmax = Math.max(...stats.map((s) => s.sdMod), stats[0].sdObs) * 1.25
  const R = Math.min(a.x1 - a.x0, a.y1 - a.y0 - 6), sc = R / rmax
  const cx = a.x0 + 6, cy = a.y1
  const P = (r: number, th: number): Pt => [cx + r * sc * Math.cos(th), cy - r * sc * Math.sin(th)]
  const marks: Mark[] = []
  d3.ticks(0, rmax, 4).filter((x) => x > 0).forEach((r) => marks.push(pathM(`ty:r${r}`, Array.from({ length: 19 }, (_, i) => P(r, (i / 18) * (Math.PI / 2))), '#dbe3e3', 1, 1)))
  ;[0.2, 0.4, 0.6, 0.8, 0.95].forEach((c) => marks.push(lineM(`ty:c${c}`, cx, cy, P(rmax, Math.acos(c))[0], P(rmax, Math.acos(c))[1], '#e5ebeb', 1, 1)))
  const ref = P(stats[0].sdObs, 0)
  ;[0.5, 1].forEach((k) => marks.push(pathM(`ty:e${k}`, Array.from({ length: 25 }, (_, i) => { const th = (i / 24) * Math.PI; const x = stats[0].sdObs + k * stats[0].sdObs * 0.5 * Math.cos(th), y = k * stats[0].sdObs * 0.5 * Math.sin(th); return [cx + x * sc, cy - y * sc] as Pt }).filter((p) => p[0] <= cx + R + 2 && p[1] <= cy), '#b8cfc9', 1, 1)))
  marks.push(dot('ty:ref', ref[0], ref[1], 6, '#111827', 1))
  stats.forEach((s, i) => { const p = taylorPoint(s), q = P(p.radius, p.angle); marks.push(dot(`ty:m${i}`, q[0], q[1], 6.5, colorAt(i), 1)) })
  marks.push(note('ty:note', w, h, '반지름 = 표준편차, 각도 = arccos(상관), 관측점과의 거리 = 중심화 RMS 오차'))
  return marks
}

// ─── Piper diagram ───────────────────────────────────────────────────────

function piperFrame(cycle: number, w: number, h: number): Mark[] {
  const t = generateDataset('water-chem', seed(cycle), 20)
  const L = piperLayout()
  const totalW = 2.5, totalH = L.diamond.bottom[1] + 2 * Math.sqrt(3) / 2
  const s = Math.min((w - 36) / totalW, (h - 56) / totalH)
  const ox = (w - totalW * s) / 2, oy = h - 28
  const X = (p: readonly [number, number]) => ox + p[0] * s, Y = (p: readonly [number, number]) => oy - p[1] * s
  const tri = (v: Record<string, [number, number]>) => Object.values(v).map((p) => [X(p), Y(p)] as Pt)
  const d = L.diamond
  const dm: Pt[] = [d.bottom, [d.bottom[0] + d.eA[0], d.bottom[1] + d.eA[1]], [d.bottom[0] + d.eC[0] + d.eA[0], d.bottom[1] + d.eC[1] + d.eA[1]], [d.bottom[0] + d.eC[0], d.bottom[1] + d.eC[1]]].map((p) => [X(p as Pt), Y(p as Pt)] as Pt)
  const marks: Mark[] = [polyM('pp:c', tri(L.cat), CLEAR, 0, '#6b7280', 1), polyM('pp:a', tri(L.an), CLEAR, 0, '#6b7280', 1), polyM('pp:d', dm, CLEAR, 0, '#6b7280', 1)]
  const types = [...new Set(t.rows.map((r) => String(r[1])))]
  t.rows.forEach((r, i) => {
    const ion = { Ca: num(r[2]), Mg: num(r[3]), Na: num(r[4]), K: num(r[5]), HCO3: num(r[6]), SO4: num(r[7]), Cl: num(r[8]) } as Ions
    const pp = piperPoints(piperPercents(toMeq(ion)))
    const c = colorAt(types.indexOf(String(r[1])))
    ;[pp.cation, pp.anion, pp.diamond].forEach((p, k) => marks.push(dot(`pp:${i}:${k}`, X(p), Y(p), 3.2, c, 0.85)))
  })
  marks.push(note('pp:note', w, h, '양이온·음이온 삼각형과 이를 합친 마름모 위의 시료'))
  return marks
}

// ─── Pythagoras tree ─────────────────────────────────────────────────────

function pythFrame(cycle: number, w: number, h: number): Mark[] {
  const t = generateDataset('org-tree', seed(cycle))
  const { tree } = buildTree(t, ['부문', '팀', '파트'], '인원')
  const nodes = pythagoras(tree as TreeIn, 1, 5)
  const xs = nodes.flatMap((n) => n.corners.map((c) => c[0])), ys = nodes.flatMap((n) => n.corners.map((c) => c[1]))
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const k = Math.min((w - 40) / (x1 - x0), (h - 56) / (y1 - y0))
  const ox = (w - (x1 - x0) * k) / 2 - x0 * k, oy = h - 30 + y0 * k
  const branches = [...new Set(nodes.filter((n) => n.depth === 1).map((n) => n.name))]
  const marks: Mark[] = nodes.map((n, i) => polyM(`py:${i}`, n.corners.map((c) => [ox + c[0] * k, oy - c[1] * k] as Pt), n.depth === 0 ? '#9aa6a6' : d3.color(colorAt(branches.indexOf(n.path[1] ?? n.name)))!.brighter(Math.max(0, (n.depth - 1) * 0.2)).formatHex(), 0.9))
  marks.push(note('py:note', w, h, '정사각형 = 노드, 자식은 부모 윗변 위 탈레스 원의 현 위'))
  return marks
}

// ─── CactusTree ──────────────────────────────────────────────────────────

function cactusFrame(cycle: number, w: number, h: number): Mark[] {
  const t = generateDataset('org-links', seed(cycle), 40)
  const { tree } = buildTree(t, ['부문', '팀', '담당'], null)
  const nodes = cactusTree(tree as TreeIn, 0.8)
  const xs = nodes.flatMap((n) => [n.x - n.r, n.x + n.r]), ys = nodes.flatMap((n) => [n.y - n.r, n.y + n.r])
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const k = Math.min((w - 40) / (x1 - x0), (h - 56) / (y1 - y0))
  const X = (v: number) => (w - (x1 - x0) * k) / 2 + (v - x0) * k, Y = (v: number) => (h - 26 - (y1 - y0) * k) / 2 + 6 + (v - y0) * k
  const branches = [...new Set(nodes.filter((n) => n.depth === 1).map((n) => n.name))]
  const top = (i: number) => nodes[i].path[1] ?? nodes[i].name
  const marks: Mark[] = nodes.map((n, i) => dot(`cc:n${i}`, X(n.x), Y(n.y), n.r * k, n.depth === 0 ? '#eef2f2' : d3.color(colorAt(branches.indexOf(top(i))))!.brighter(0.4 * Math.max(0, n.depth - 1)).formatHex(), n.leaf ? 0.9 : 0.35))
  const byLeaf = new Map(nodes.map((n, i) => [n.name, i]))
  t.rows.forEach((r, row) => {
    const a = byLeaf.get(String(r[2])), b = byLeaf.get(String(r[3]))
    if (a == null || b == null || a === b) return
    marks.push(pathM(`cc:l${row}`, bspline(bundlePath(nodes, a, b, 0.85), 5).map((p) => [X(p[0]), Y(p[1])] as Pt), '#d4452f', 1.1, 0.45))
  })
  marks.push(note('cc:note', w, h, '원 면적 = 하위 가중치, 연결은 트리 경로를 따라 묶음'))
  return marks
}

// ─── History flow ────────────────────────────────────────────────────────

function flowFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('doc-revisions', seed(cycle), 8)
  const revs = t.rows.map((r) => ({ version: num(r[0]), seg: String(r[1]), author: String(r[2]), length: num(r[3]), order: num(r[4]) }))
  const f = historyFlow(revs)
  const colW = Math.min(18, ((a.x1 - a.x0) / f.versions.length) * 0.32)
  const xOf = (v: number) => a.x0 + (f.versions.indexOf(v) * (a.x1 - a.x0 - colW)) / Math.max(1, f.versions.length - 1)
  const sy = (v: number) => (v / f.height) * (a.y1 - a.y0)
  const col = (au: string) => colorAt(f.authors.indexOf(au))
  const marks: Mark[] = []
  f.ribbons.forEach((r, i) => {
    const xa = xOf(r.from) + colW, xb = xOf(r.to)
    const curve = (ya: number, yb: number): Pt[] => Array.from({ length: 7 }, (_, q) => { const u = q / 6, s = u * u * (3 - 2 * u); return [xa + (xb - xa) * u, ya + (yb - ya) * s] as Pt })
    marks.push(polyM(`hf:r${i}`, [...curve(a.y0 + sy(r.y0a), a.y0 + sy(r.y0b)), ...curve(a.y0 + sy(r.y1a), a.y0 + sy(r.y1b)).reverse()], col(r.author), 0.3, CLEAR, 0))
  })
  f.rects.forEach((r, i) => marks.push(rectM(`hf:s${i}`, xOf(r.version), a.y0 + sy(r.y0), colW, Math.max(1, sy(r.y1 - r.y0) - 0.6), col(r.author), 1, 0.5)))
  marks.push(note('hf:note', w, h, '버전마다 막대, 같은 구간은 띠로 이어지고 색은 저자'))
  return marks
}

// ─── Hasse diagram ───────────────────────────────────────────────────────

function hasseFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('poset', seed(cycle), 12)
  const p = hasse(t.rows.map((r) => [String(r[0]), String(r[1])] as [string, string]))
  const rows = hasseOrder(p)
  const L = rows.length
  const pos = new Map<string, Pt>()
  rows.forEach((r, l) => r.forEach((e, i) => pos.set(e, [a.x0 + ((i + 1) * (a.x1 - a.x0)) / (r.length + 1), a.y1 - (L === 1 ? 0 : (l * (a.y1 - a.y0)) / (L - 1))])))
  const marks: Mark[] = p.covers.map(([x, y], i) => lineM(`hs:e${i}`, pos.get(x)![0], pos.get(x)![1], pos.get(y)![0], pos.get(y)![1], '#6b7280', 1.4, 1))
  p.elements.forEach((e) => { const q = pos.get(e)!; marks.push(dot(`hs:n${e}`, q[0], q[1], 9, '#2a8c82', 1)); marks.push(textM(`hs:t${e}`, q[0], q[1] + 3.5, e, '#ffffff')) })
  marks.push(note('hs:note', w, h, '약수 관계의 피복 관계만 이은 도표(이행적 축약)'))
  return marks
}

// ─── Nomogram ────────────────────────────────────────────────────────────

function nomoFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const rows = generateDataset('nomogram-model', seed(cycle)).rows.map((r) => ({ name: String(r[0]), min: num(r[1]), max: num(r[2]), beta: num(r[3]), val: num(r[4]) }))
  const nm = nomogram(rows, -4.2)
  const left = 70
  const x = d3.scaleLinear().domain([0, 100]).range([a.x0 + left, a.x1])
  const rowH = (a.y1 - a.y0) / (rows.length + 2)
  const marks: Mark[] = [lineM('nm:p', x(0), a.y0 + rowH / 2, x(100), a.y0 + rowH / 2, '#374151', 1.6, 1)]
  // the current value moves with the cycle so that the total points and the probability change
  const shift = 0.5 + 0.5 * Math.sin(cycle * 1.3)
  let total = 0
  nm.scales.forEach((s, i) => {
    const y = a.y0 + (i + 1.5) * rowH
    marks.push(lineM(`nm:a${i}`, x(s.points(s.min)), y, x(s.points(s.max)), y, '#6b7280', 2, 1))
    const v = s.min + (s.max - s.min) * (0.3 + 0.5 * ((shift + i * 0.37) % 1))
    total += s.points(v)
    marks.push(dot(`nm:m${i}`, x(s.points(v)), y, 5, '#d4452f', 1))
    marks.push(textM(`nm:l${i}`, a.x0 + 30, y + 3, rows[i].name.slice(0, 6), '#374151'))
  })
  const ty = a.y0 + (rows.length + 1.5) * rowH
  const tx = d3.scaleLinear().domain([0, nm.totalMax]).range([x(0), x(100)])
  marks.push(lineM('nm:t', tx(0), ty, tx(nm.totalMax), ty, '#111827', 2, 1))
  marks.push(dot('nm:tm', tx(total), ty, 6, '#d4452f', 1))
  marks.push(textM('nm:r', w / 2, ty + 16, `총점 ${total.toFixed(0)} → 확률 ${(nm.probability(total) * 100).toFixed(1)}%`, '#d4452f'))
  marks.push(note('nm:note', w, h, '변수마다 점수를 읽어 더한 총점에서 확률을 읽음'))
  return marks
}

// ─── Continuous scatterplot ──────────────────────────────────────────────

function contFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('multi-field', seed(cycle), 20)
  const N = 20
  const attr = [2, 3].map((c) => Float64Array.from(t.rows.map((r) => num(r[c]))))
  const f: Field2 = { nx: N, ny: N, attr }
  const R = 40
  const sp = continuousScatterplot(f, 0, 1, R, R)
  const sorted = Float32Array.from(sp.density).sort()
  const mx = sorted[Math.floor(sorted.length * 0.99)] || 1
  const side = Math.min(a.x1 - a.x0, a.y1 - a.y0), ox = (w - side) / 2, oy = a.y0
  const levels = [0.08, 0.2, 0.4, 0.65].map((q) => q * mx)
  const conts = d3.contours().size([R, R]).thresholds(levels)(Array.from(sp.density, (v) => v))
  const marks: Mark[] = [polyM('cs:f', [[ox, oy], [ox + side, oy], [ox + side, oy + side], [ox, oy + side]], '#f7f9f9', 1, '#dbe3e3', 1)]
  conts.forEach((c, li) => c.coordinates.forEach((poly, pi) => poly.forEach((ring, ri) => marks.push(polyM(`cs:c${li}:${pi}:${ri}`, ring.map(([x, y]) => [ox + (x / R) * side, oy + side - (y / R) * side] as Pt), d3.interpolateBlues(0.25 + li * 0.2), 0.45, '#ffffff', 0.4)))))
  marks.push(note('cs:note', w, h, '두 속성의 연속 밀도 윤곽: 필드가 속성 공간을 덮는 모양'))
  return marks
}

// ─── Rectangular cartogram ───────────────────────────────────────────────

function rectCartoFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const r = Math.sin(cycle * 1.9)
  const regs = koreaRows.map(([id, , , , lon, lat], i) => ({ id, x: lon, y: -lat, value: 100 + 80 * Math.abs(Math.sin(i * 1.7 + cycle)) * (i % 3 === 0 ? 3 : 1) + r * 0 }))
  const aspect = (a.x1 - a.x0) / (a.y1 - a.y0)
  const cg = rectangularCartogram(regs, [], aspect, 1, 5)
  const k = (a.x1 - a.x0) / aspect
  return [...cg.rects.map((q, i) => rectM(`rc:${q.id}`, a.x0 + q.x * k, a.y0 + q.y * k, q.w * k - 1, q.h * k - 1, colorAt(i), 0.85, 1)), note('rc:note', w, h, '면적이 값에 정확히 비례하는 사각형 지도(재귀 분할)')]
}

export const HERO_V11 = { hinton: hintonFrame, taylor: taylorFrame, piper: piperFrame, pyth: pythFrame, cactus: cactusFrame, hflow: flowFrame, hasse: hasseFrame, nomo: nomoFrame, contscat: contFrame, rectcarto: rectCartoFrame }
export type HeroV11Key = keyof typeof HERO_V11

export function buildV11(key: HeroV11Key, cycle: number, w: number, h: number): Mark[] {
  return HERO_V11[key](cycle, w, h)
}
