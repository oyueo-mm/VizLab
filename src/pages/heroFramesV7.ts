import * as d3 from 'd3'
import { generateDataset } from '../data/datasets'
import { columnIndex, toNumber } from '../data/table'
import { colorAt, schemes } from '../lib/colors'
import { createRng } from '../lib/random'
import { buildTree } from '../stats/hierarchy'
import { anchorAngle, dimensionalStacking, faceGeometry, normalizeColumns, project, radviz, starCoordinates, tourFrame, defaultAxes } from '../stats/multivar7'
import { bundleEdges, storylineLayout } from '../stats/net7'
import { fieldAt, lic, whiteNoise } from '../stats/sci7'
import { classicalMDS, euclid, fitDist, groupStats, hopDraw, quantileDots, wilkinsonStack } from '../stats/uncert7'
import { parallelSets, voronoiTreemap, type P2 } from '../stats/struct7'
import type { CircleMark, LineMark, Mark, PolyMark, RectMark, TextMark } from './heroFrames'

/**
 * Frames of the fourteen v0.7 stages: RadViz, Chernoff faces, Star Coordinates, Grand Tour, Dimensional Stacking, Parallel Sets, Voronoi treemap,
 * quantile dotplot, hypothetical outcome plots, time curves, line integral convolution, force-directed edge bundling, storyline and the table lens.
 * Each runs the app's own engine on seeded data; the module is a separate chunk that the home page fetches a few stages before the first of them.
 */

const CLEAR = 'rgba(0,0,0,0)'
const GRID = '#cfd6d3'
const PAD = { l: 18, r: 18, t: 18, b: 34 }
const seed = (cycle: number) => 7 + cycle * 11

const rectM = (k: string, x: number, y: number, wd: number, ht: number, fill: string, extra: Partial<RectMark> = {}): RectMark => ({ t: 'rect', k, x, y, w: wd, h: Math.max(0, ht), r: 1.5, fill, stroke: CLEAR, sw: 0, o: 1, from: { o: 0 }, ...extra })
const dot = (k: string, x: number, y: number, r: number, fill: string, o = 1): CircleMark => ({ t: 'circle', k, x, y, r, fill, o, from: { r: 0, o: 0 } })
const lineM = (k: string, x1: number, y1: number, x2: number, y2: number, stroke: string, sw: number, o = 1): LineMark => ({ t: 'line', k, x1, y1, x2, y2, stroke, sw, o, from: { o: 0 } })
const textM = (k: string, x: number, y: number, s: string, anchor: TextMark['anchor'] = 'middle', fill = '#8a9490'): TextMark => ({ t: 'text', k, x, y, text: s, anchor, fill, o: 1 })
const pathM = (k: string, pts: [number, number][], stroke: string, sw: number, so = 0.9): PolyMark => ({ t: 'poly', k, pts, closed: false, fill: CLEAR, stroke, fo: 0, so, sw, o: 1, from: { so: 0, o: 0 } })
const polyM = (k: string, pts: [number, number][], fill: string, fo: number, stroke = '#fff', sw = 1.4): PolyMark => ({ t: 'poly', k, pts, closed: true, fill, stroke, fo, so: 1, sw, o: 1, from: { fo: 0, o: 0 } })

const inner = (w: number, h: number) => ({ x0: PAD.l + 4, x1: w - PAD.r - 4, y0: PAD.t + 4, y1: h - PAD.b - 2 })
const note = (k: string, w: number, h: number, s: string) => textM(k, w / 2, h - 12, s)

/** Standardized flower measurements (three species) used by the multivariate stages. */
function flowers(cycle: number, n: number) {
  const t = generateDataset('flowers', seed(cycle), n)
  const cols = [1, 2, 3, 4].map((c) => t.rows.map((r) => toNumber(r[c]) ?? 0))
  const raw = t.rows.map((_, i) => cols.map((c) => c[i]))
  const si = columnIndex(t, '품종')
  return { norm: normalizeColumns(raw), species: t.rows.map((r) => String(r[si])), raw }
}
const speciesColor = (s: string) => colorAt(['품종 A', '품종 B', '품종 C'].indexOf(s))

/** Resamples a closed polygon to a fixed number of points along its perimeter so that cells can morph into each other. */
function resample(poly: readonly P2[], n: number): [number, number][] {
  const pts = [...poly, poly[0]]
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]))
  const total = seg.reduce((a, b) => a + b, 0) || 1
  const out: [number, number][] = []
  let k = 0, acc = 0
  for (let s = 0; s < n; s++) {
    const target = (total * s) / n
    while (k < seg.length - 1 && acc + seg[k] < target) { acc += seg[k]; k++ }
    const t = seg[k] ? (target - acc) / seg[k] : 0
    out.push([pts[k][0] + t * (pts[k + 1][0] - pts[k][0]), pts[k][1] + t * (pts[k + 1][1] - pts[k][1])])
  }
  return out
}

// ─── RadViz ─────────────────────────────────────────────────────────────────────────

function radvizFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h), { norm, species } = flowers(cycle, 66)
  const R = Math.min(a.x1 - a.x0, a.y1 - a.y0) / 2 - 4, cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2
  const perms = [[0, 1, 2, 3], [0, 2, 1, 3], [1, 0, 3, 2], [0, 1, 3, 2]]
  const perm = perms[cycle % perms.length]
  const angles = [0, 1, 2, 3].map((j) => anchorAngle(perm.indexOf(j), 4))
  const pts = radviz(norm, angles)
  return [
    ...Array.from({ length: 72 }, (_, i) => lineM(`rv:r${i}`, cx + Math.cos((i / 72) * 6.2832) * R, cy + Math.sin((i / 72) * 6.2832) * R, cx + Math.cos(((i + 1) / 72) * 6.2832) * R, cy + Math.sin(((i + 1) / 72) * 6.2832) * R, GRID, 1)),
    ...angles.map((an, j) => dot(`rv:a${j}`, cx + Math.cos(an) * R, cy + Math.sin(an) * R, 5.5, '#334155', 1)),
    ...pts.map((p, i) => dot(`rv:p${i}`, cx + p[0] * R, cy + p[1] * R, 3.8, speciesColor(species[i]), 0.82)),
    note('rv:note', w, h, '앵커 4개의 가중 평균 위치'),
  ]
}

// ─── Chernoff faces ─────────────────────────────────────────────────────────────────

function chernoffFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h), { norm, species } = flowers(cycle, 90)
  const marks: Mark[] = []
  const cols = 3, rows = 2, cw = (a.x1 - a.x0) / cols, ch = (a.y1 - a.y0) / rows
  for (let f = 0; f < cols * rows; f++) {
    const i = f * 14 + (cycle % 7) // two flowers of every species appear in each cycle
    const g = faceGeometry([norm[i][0], norm[i][1], norm[i][2], norm[i][3], norm[i][0], norm[i][1]])
    const cx = a.x0 + (f % cols + 0.5) * cw, cy = a.y0 + (Math.floor(f / cols) + 0.5) * ch
    const S = Math.min(cw, ch) * 0.92
    const col = speciesColor(species[i])
    marks.push(polyM(`cf:${f}:head`, Array.from({ length: 28 }, (_, k) => [cx + Math.cos((k / 28) * 6.2832) * g.rx * S, cy + Math.sin((k / 28) * 6.2832) * g.ry * S] as [number, number]), col, 0.22, col, 1.6))
    for (const s of [-1, 1]) {
      marks.push(dot(`cf:${f}:e${s}`, cx + s * g.eyeGap * S, cy - 0.08 * S, g.eyeR * S, '#ffffff', 1))
      marks.push(dot(`cf:${f}:p${s}`, cx + s * g.eyeGap * S, cy - 0.08 * S, g.eyeR * S * 0.45, '#334155', 1))
      marks.push(lineM(`cf:${f}:b${s}`, cx + s * g.eyeGap * S - 0.05 * S, cy - 0.18 * S - s * g.browTilt * S, cx + s * g.eyeGap * S + 0.05 * S, cy - 0.18 * S + s * g.browTilt * S, '#334155', 1.8))
    }
    marks.push(lineM(`cf:${f}:n`, cx, cy - 0.06 * S, cx, cy - 0.06 * S + g.noseLen * S, '#334155', 1.4))
    const mouth = Array.from({ length: 9 }, (_, k) => { const t = k / 8; return [cx + (t * 2 - 1) * g.mouthHalf * S, cy + 0.17 * S + g.mouthCurve * 2 * S * 2 * t * (1 - t)] as [number, number] })
    marks.push(pathM(`cf:${f}:m`, mouth, '#334155', 2, 1))
  }
  marks.push(note('cf:note', w, h, '변수 → 눈 크기·눈썹·입 곡률·얼굴 너비'))
  return marks
}

// ─── Star coordinates ───────────────────────────────────────────────────────────────

function starFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h), { norm, species } = flowers(cycle, 66)
  const R = Math.min(a.x1 - a.x0, a.y1 - a.y0) / 2 - 4, cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2
  const base = defaultAxes(4)
  const axes = base.map(([x, y], j) => { const s = 0.55 + 0.9 * Math.abs(Math.sin(cycle * 0.9 + j * 1.3)); const rot = (cycle % 4) * 0.25 * (j % 2 ? 1 : -1); return [(x * Math.cos(rot) - y * Math.sin(rot)) * s, (x * Math.sin(rot) + y * Math.cos(rot)) * s] as [number, number] })
  const pts = starCoordinates(norm, axes)
  return [
    ...axes.map((ax, j) => lineM(`sc:ax${j}`, cx, cy, cx + ax[0] * R, cy + ax[1] * R, '#64748b', 2)),
    ...axes.map((ax, j) => dot(`sc:ah${j}`, cx + ax[0] * R, cy + ax[1] * R, 5.5, '#334155')),
    ...pts.map((p, i) => dot(`sc:p${i}`, cx + p[0] * R * 1.5, cy + p[1] * R * 1.5, 3.8, speciesColor(species[i]), 0.82)),
    note('sc:note', w, h, '축 벡터를 바꿔 가며 군집이 드러나는 투영 찾기'),
  ]
}

// ─── Grand Tour ─────────────────────────────────────────────────────────────────────

function tourMarks(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h), { norm, species } = flowers(0, 66)
  const R = Math.min(a.x1 - a.x0, a.y1 - a.y0) / 2 - 4, cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2
  const pts = project(norm.map((r) => r.map((v) => v - 0.5)), tourFrame(4, cycle * 0.8 + 0.3, 3))
  return [
    ...pts.map((p, i) => dot(`gt:p${i}`, cx + p[0] * R, cy + p[1] * R, 3.8, speciesColor(species[i]), 0.82)),
    note('gt:note', w, h, '고차원 데이터의 2차원 정사영이 연속으로 변합니다'),
  ]
}

// ─── Dimensional stacking ───────────────────────────────────────────────────────────

function stackFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h), { norm } = flowers(0, 150)
  const orders = [[0, 1, 2], [1, 2, 0], [2, 0, 1], [0, 2, 1]]
  const st = dimensionalStacking(norm, orders[cycle % orders.length], 3, norm.map((r) => r[3]))
  const cw = (a.x1 - a.x0) / st.cols, ch = (a.y1 - a.y0) / st.rows
  return [
    ...st.cells.map((c) => rectM(`ds:${c.cx}:${c.cy}`, a.x0 + c.cx * cw, a.y0 + c.cy * ch, cw - 1.5, ch - 1.5, schemes.viridis.interpolate(c.mean), { r: 2 })),
    note('ds:note', w, h, '변수를 가로·세로로 번갈아 중첩한 격자'),
  ]
}

// ─── Parallel Sets ──────────────────────────────────────────────────────────────────

function psFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('survey-cats', 3)
  const cats = [0, 1, 2, 3]
  const rot = cycle % 4
  const order = [cats[rot], cats[(rot + 1) % 4], cats[(rot + 2) % 4]]
  const rows = t.rows.map((r) => ({ cats: order.map((c) => String(r[c])), w: toNumber(r[4]) ?? 1 }))
  const ps = parallelSets(rows, 3, 0.012, 0)
  const bar = 9, span = a.x1 - a.x0 - bar
  const xAt = (d: number) => a.x0 + (d * span) / 2
  const hh = a.y1 - a.y0
  const color = d3.scaleOrdinal<string, string>().domain([...new Set(ps.segments.filter((s) => s.dim === 0).map((s) => s.key))]).range([0, 1, 2, 3, 4].map(colorAt))
  const marks: Mark[] = []
  ps.ribbons.forEach((r, i) => {
    const x0 = xAt(r.dim) + bar, x1 = xAt(r.dim + 1)
    const c = (x1 - x0) * 0.5
    const top: [number, number][] = Array.from({ length: 9 }, (_, k) => { const u = k / 8, m = 3 * (1 - u) ** 2 * u, n = 3 * (1 - u) * u * u; return [(1 - u) ** 3 * x0 + m * (x0 + c) + n * (x1 - c) + u ** 3 * x1, (1 - u) ** 3 * (a.y0 + r.ya0 * hh) + m * (a.y0 + r.ya0 * hh) + n * (a.y0 + r.yb0 * hh) + u ** 3 * (a.y0 + r.yb0 * hh)] })
    const bot: [number, number][] = Array.from({ length: 9 }, (_, k) => { const u = 1 - k / 8, m = 3 * (1 - u) ** 2 * u, n = 3 * (1 - u) * u * u; return [(1 - u) ** 3 * x0 + m * (x0 + c) + n * (x1 - c) + u ** 3 * x1, (1 - u) ** 3 * (a.y0 + r.ya1 * hh) + m * (a.y0 + r.ya1 * hh) + n * (a.y0 + r.yb1 * hh) + u ** 3 * (a.y0 + r.yb1 * hh)] })
    marks.push(polyM(`ps:${r.dim}:${order[r.dim]}:${r.a}>${r.b}:${r.color}:${i % 1}`, [...top, ...bot], color(r.color), 0.55, '#fff', 0.5))
  })
  ps.segments.forEach((s) => marks.push(rectM(`ps:s${s.dim}:${order[s.dim]}:${s.key}`, xAt(s.dim), a.y0 + s.y0 * hh, bar, Math.max(1, (s.y1 - s.y0) * hh), '#475569', { r: 1 })))
  marks.push(note('ps:note', w, h, '범주형 변수들 사이의 리본 흐름'))
  return marks
}

// ─── Voronoi treemap ────────────────────────────────────────────────────────────────

function voronoiTreemapFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('budget', 1)
  const { tree } = buildTree(t, ['부문', '부서'], '예산')
  const jitter = (n: typeof tree, i: number): typeof tree => ({ ...n, value: n.value != null ? n.value * (0.7 + 0.6 * Math.abs(Math.sin(cycle * 1.1 + i * 2.3))) : undefined, children: n.children?.map((c, j) => jitter(c, i * 7 + j + 1)) })
  const cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2, rx = (a.x1 - a.x0) / 2, ry = (a.y1 - a.y0) / 2
  const poly: P2[] = Array.from({ length: 36 }, (_, k) => [cx + Math.cos((k / 36) * 6.2832) * rx, cy + Math.sin((k / 36) * 6.2832) * ry])
  const cells = voronoiTreemap(jitter(tree, 1), poly, 2, 90).filter((c) => c.leaf)
  const names = [...new Set(buildTree(t, ['부문'], '예산').tree.children!.map((c) => c.name))]
  return [
    ...cells.map((c, i) => polyM(`vt:${c.node.name}:${i}`, resample(c.polygon, 24), colorAt(Math.max(0, names.indexOf(t.rows.find((r) => r[1] === c.node.name)?.[0] as string))), 0.8)),
    note('vt:note', w, h, '면적이 값에 비례하는 보로노이 셀'),
  ]
}

// ─── Quantile dotplot ───────────────────────────────────────────────────────────────

function quantileFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h), r = createRng(seed(cycle))
  const sample = Array.from({ length: 200 }, () => 50 + (cycle % 2 ? Math.exp(r.normal(0, 0.45)) * 10 - 10 : r.normal(0, 10)))
  const dist = fitDist(sample, cycle % 2 ? 'lognormal' : 'normal')!
  const dots = quantileDots(dist, 40)
  const x = d3.scaleLinear().domain([20, 100]).range([a.x0, a.x1])
  const binW = (100 - 20) / 12
  const st = wilkinsonStack(dots, binW)
  const rad = Math.min(((a.x1 - a.x0) / 12) / 2 - 0.5, (a.y1 - a.y0) / 9 / 2)
  const lo = dist.quantile(0.1), hi = dist.quantile(0.9)
  return [
    lineM('qd:axis', a.x0, a.y1 + 2, a.x1, a.y1 + 2, GRID, 1.4, 1),
    ...st.map((s, i) => dot(`qd:d${i}`, x(s.x), a.y1 - rad - s.level * 2.05 * rad, rad, s.value >= lo && s.value <= hi ? colorAt(0) : '#c3cad1', 0.95)),
    note('qd:note', w, h, '점 하나 = 확률 2.5% · 중앙 80% 구간 강조'),
  ]
}

// ─── Hypothetical outcome plots ─────────────────────────────────────────────────────

function hopFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('groups', 3)
  const gi = columnIndex(t, '반'), vi = columnIndex(t, '점수')
  const gs = groupStats(t.rows.map((r) => String(r[gi])), t.rows.map((r) => toNumber(r[vi]) ?? 0))
  const draw = hopDraw(gs, cycle, 7)
  const lo = Math.min(...gs.map((g) => g.mean - 4 * g.se)), hi = Math.max(...gs.map((g) => g.mean + 4 * g.se))
  const y = d3.scaleLinear().domain([lo, hi]).range([a.y1, a.y0])
  const bw = (a.x1 - a.x0) / gs.length
  return [
    ...gs.map((g, i) => lineM(`hp:m${i}`, a.x0 + i * bw + bw * 0.12, y(g.mean), a.x0 + (i + 1) * bw - bw * 0.12, y(g.mean), '#94a3b8', 1.5, 0.9)),
    ...gs.map((_, i) => rectM(`hp:b${i}`, a.x0 + i * bw + bw * 0.2, y(draw[i]), bw * 0.6, a.y1 - y(draw[i]), colorAt(i), { r: 3 })),
    note('hp:note', w, h, '가능한 결과를 한 번씩 뽑아 보여줍니다'),
  ]
}

// ─── Time curves ────────────────────────────────────────────────────────────────────

function timeCurveFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('state-series', seed(cycle), 36)
  const states = t.rows.map((r) => [1, 2, 3, 4, 5].map((c) => toNumber(r[c]) ?? 0))
  const z = normalizeColumns(states, 'zscore')
  const Y = classicalMDS(z.map((p) => z.map((q) => euclid(p, q))))
  // fix the arbitrary sign of the axes so that consecutive frames morph instead of flipping
  const flipX = Y[Math.floor(Y.length / 2)][0] < Y[0][0] ? -1 : 1, flipY = Y[Math.floor(Y.length / 4)][1] < Y[0][1] ? -1 : 1
  const [x0, x1] = d3.extent(Y, (p) => p[0] * flipX) as [number, number], [y0, y1] = d3.extent(Y, (p) => p[1] * flipY) as [number, number]
  const sc = Math.min((a.x1 - a.x0) / (x1 - x0 || 1), (a.y1 - a.y0) / (y1 - y0 || 1))
  const px = (p: [number, number]) => (a.x0 + a.x1) / 2 + (p[0] * flipX - (x0 + x1) / 2) * sc, py = (p: [number, number]) => (a.y0 + a.y1) / 2 + (p[1] * flipY - (y0 + y1) / 2) * sc
  return [
    ...Y.slice(0, -1).map((p, i) => lineM(`tc:s${i}`, px(p), py(p), px(Y[i + 1]), py(Y[i + 1]), schemes.viridis.interpolate(i / (Y.length - 2)), 2.6, 0.9)),
    ...Y.map((p, i) => dot(`tc:p${i}`, px(p), py(p), 3.8, schemes.viridis.interpolate(i / (Y.length - 1)), 1)),
    note('tc:note', w, h, '상태가 비슷한 시점은 가깝게, 시간 순서로 이은 곡선'),
  ]
}

// ─── Line integral convolution ──────────────────────────────────────────────────────

function licFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h), cols = 36, rows = 22, cw = (a.x1 - a.x0) / cols, ch = (a.y1 - a.y0) / rows
  const k = cycle % 6
  const src = [{ kind: '소용돌이' as const, x: 0.3 + 0.05 * k, y: 0.5, strength: 1.2, radius: 0.12 }, { kind: '소용돌이' as const, x: 0.72 - 0.04 * k, y: 0.5, strength: -1, radius: 0.12 }, { kind: '균일' as const, x: 0.5, y: 0.5, strength: 0.15, radius: 1 }]
  const noise = whiteNoise(cols, rows, 3)
  const img = lic((px, py) => { const [u, v] = fieldAt(src, px / cols, 1 - py / rows); return [u, -v] }, noise, cols, rows, 7)
  const marks: Mark[] = []
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const [u, v] = fieldAt(src, (i + 0.5) / cols, 1 - (j + 0.5) / rows)
    const s = Math.min(1, Math.hypot(u, v) / 3)
    marks.push(rectM(`lic:${j}:${i}`, a.x0 + i * cw, a.y0 + j * ch, cw + 0.4, ch + 0.4, d3.interpolateRgb('#0f2a3a', '#e8f5ef')(0.15 + 0.85 * img[j * cols + i] * (0.45 + 0.55 * Math.sqrt(s))), { r: 0 }))
  }
  marks.push(note('lic:note', w, h, '벡터장을 따라 노이즈를 적분한 결 텍스처'))
  return marks
}

// ─── Force-directed edge bundling ───────────────────────────────────────────────────

function fdebFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('flow-edges', seed(cycle), 36)
  const edges = t.rows.map((r) => ({ x0: (toNumber(r[0]) ?? 0) / 100, y0: (toNumber(r[1]) ?? 0) / 100, x1: (toNumber(r[2]) ?? 0) / 100, y1: (toNumber(r[3]) ?? 0) / 100 }))
  const bundled = bundleEdges(edges, { cycles: 4, iterations: 30, stiffness: 0.1, threshold: 0.7 })
  const resampleLine = (pts: [number, number][], n: number): [number, number][] => Array.from({ length: n }, (_, k) => { const f = (k / (n - 1)) * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), u = f - i; return [pts[i][0] + u * (pts[i + 1][0] - pts[i][0]), pts[i][1] + u * (pts[i + 1][1] - pts[i][1])] })
  const showBundled = cycle % 2 === 0
  const px = (p: [number, number]): [number, number] => [a.x0 + p[0] * (a.x1 - a.x0), a.y1 - p[1] * (a.y1 - a.y0)]
  const gr = t.rows.map((r) => String(r[4]))
  const names = [...new Set(gr)]
  return [
    ...bundled.map((l, i) => pathM(`fd:${i}`, resampleLine(showBundled ? l : [[edges[i].x0, edges[i].y0], [edges[i].x1, edges[i].y1]], 17).map(px), colorAt(names.indexOf(gr[i])), 1.4, showBundled ? 0.7 : 0.45)),
    note('fd:note', w, h, showBundled ? '비슷한 간선이 힘으로 한 다발이 됩니다' : '묶기 전: 직선 간선'),
  ]
}

// ─── Storyline ──────────────────────────────────────────────────────────────────────

function storyFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('story-scenes', seed(cycle))
  const ev = t.rows.map((r) => ({ entity: String(r[0]), t: toNumber(r[1]) ?? 0, session: String(r[2]) }))
  const lay = storylineLayout(ev, 1)
  const ents = [...new Set(ev.map((e) => e.entity))]
  const x = d3.scaleLinear().domain([1, 12]).range([a.x0, a.x1]), y = d3.scaleLinear().domain([-0.5, lay.height + 0.5]).range([a.y0, a.y1])
  return [
    ...ents.map((e, i) => {
      const pts = Array.from({ length: 12 }, (_, tIdx) => { const here = lay.points.find((p) => p.entity === e && p.t === tIdx + 1); return here ? ([x(tIdx + 1), y(here.y)] as [number, number]) : null })
      // scenes where a character is absent are bridged from the previous visible position so every polyline keeps 12 points
      let last: [number, number] = pts.find((p) => p) ?? [x(1), y(0)]
      const filled = pts.map((p, k) => { if (p) { last = p; return p } return [x(k + 1), last[1]] as [number, number] })
      return pathM(`sl:${e}`, filled, colorAt(i), 2.4, 0.9)
    }),
    note('sl:note', w, h, '같은 장소에 있는 인물의 선이 붙어 지나갑니다'),
  ]
}

// ─── Table lens ─────────────────────────────────────────────────────────────────────

function lensFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h), { norm, species } = flowers(0, 120)
  const sortCol = cycle % 4
  const order = norm.map((_, i) => i).sort((p, q) => norm[p][sortCol] - norm[q][sortCol])
  const n = 60, rows = order.filter((_, i) => i % 2 === 0).slice(0, n)
  const focus = (cycle * 7) % (n - 6) + 2
  const fh = 22, rest = (a.y1 - a.y0 - 4 * fh) / (n - 4)
  const colW = (a.x1 - a.x0) / 4
  const marks: Mark[] = []
  let y = a.y0
  rows.forEach((idx, p) => {
    const inFocus = p >= focus && p < focus + 4
    const rh = inFocus ? fh : rest
    for (let c = 0; c < 4; c++) marks.push(rectM(`tl:${idx}:${c}`, a.x0 + c * colW + 2, y, Math.max(1, norm[idx][c] * (colW - 6)), Math.max(0.8, rh - (inFocus ? 4 : 0.3)), speciesColor(species[idx]), { r: inFocus ? 3 : 0, o: inFocus ? 1 : 0.75 }))
    y += rh
  })
  marks.push(note('tl:note', w, h, '선택한 행만 펼치고 나머지는 압축'))
  return marks
}

export const HERO_V7 = { radviz: radvizFrame, chernoff: chernoffFrame, star: starFrame, tour: tourMarks, stacking: stackFrame, psets: psFrame, vtreemap: voronoiTreemapFrame, qdot: quantileFrame, hops: hopFrame, tcurve: timeCurveFrame, lic: licFrame, fdeb: fdebFrame, story: storyFrame, lens: lensFrame }
export type HeroV7Key = keyof typeof HERO_V7

export function buildV7(key: HeroV7Key, cycle: number, w: number, h: number): Mark[] {
  return HERO_V7[key](cycle, w, h)
}
