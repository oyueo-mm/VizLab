import * as d3 from 'd3'
import { generateDataset } from '../data/datasets'
import { columnIndex, toNumber } from '../data/table'
import { colorAt, schemes } from '../lib/colors'
import { createRng } from '../lib/random'
import { phaseSystems, attractor, trajectory } from '../stats/dynamics'
import { renko } from '../stats/finance'
import { voronoiCells, type P2 } from '../stats/geometry'
import { chromosomeOffsets } from '../stats/bio'
import { eulerLayout, exclusiveIntersections, inclusiveCount, regionAreas } from '../stats/sets'
import { spiralPoint } from '../stats/special'
import { contourLevels, evenStreamlines, fieldAt, gridExtent, gridIsolines, hillsHeight, makeGrid, niceInterval, speedOf, type BBox, type VectorField } from '../stats/spatial'
import { kaplanMeier } from '../stats/survival'
import type { ArcMark, CircleMark, LineMark, Mark, PolyMark, RectMark, TextMark } from './heroFrames'

/**
 * Frames of the twelve v0.5 stages (isolines, streamlines, Voronoi map, Kaplan–Meier, Renko, Manhattan, phase portrait, UpSet, Nightingale rose,
 * Euler diagram, bifurcation diagram, spiral plot). Each runs the app's own engine on seeded data; the module is a separate chunk that the home
 * page fetches a few stages before the first of them comes up.
 */

const CLEAR = 'rgba(0,0,0,0)'
const GRID = '#cfd6d3'
const INK = '#4b5563'
const PAD = { l: 18, r: 18, t: 18, b: 34 }
const seed = (cycle: number) => 11 + cycle * 17

const rectM = (k: string, x: number, y: number, wd: number, ht: number, fill: string, extra: Partial<RectMark> = {}): RectMark => ({ t: 'rect', k, x, y, w: wd, h: Math.max(0, ht), r: 1.5, fill, stroke: CLEAR, sw: 0, o: 1, from: { h: 0, o: 0.2 }, ...extra })
const dot = (k: string, x: number, y: number, r: number, fill: string, o = 1): CircleMark => ({ t: 'circle', k, x, y, r, fill, o, from: { r: 0, o: 0 } })
const lineM = (k: string, x1: number, y1: number, x2: number, y2: number, stroke: string, sw: number, o = 1, from?: Partial<LineMark>): LineMark => ({ t: 'line', k, x1, y1, x2, y2, stroke, sw, o, from: from ?? { o: 0 } })
const textM = (k: string, x: number, y: number, s: string, anchor: TextMark['anchor'] = 'middle', fill = '#8a9490'): TextMark => ({ t: 'text', k, x, y, text: s, anchor, fill, o: 1 })
const path = (k: string, pts: [number, number][], stroke: string, sw: number, so = 0.9): PolyMark => ({ t: 'poly', k, pts, closed: false, fill: CLEAR, stroke, fo: 0, so, sw, o: 1, from: { so: 0, o: 0 } })
const area = (k: string, pts: [number, number][], fill: string, fo: number): PolyMark => ({ t: 'poly', k, pts, closed: true, fill, stroke: '#ffffff', fo, so: 1, sw: 1, o: 1, from: { fo: 0, o: 0 } })

/** Bottom axis line with labelled ticks. */
function axisX(k: string, scale: (v: number) => number, base: number, ticks: [number, string][], w: number): Mark[] {
  return [lineM(`${k}:ax`, PAD.l, base + 0.5, w - PAD.r, base + 0.5, GRID, 1, 1, { o: 1 }), ...ticks.map(([v, label]) => textM(`${k}:t${label}`, scale(v), base + 18, label))]
}

const inner = (w: number, h: number) => ({ x0: PAD.l + 4, x1: w - PAD.r - 4, y0: PAD.t + 4, y1: h - PAD.b - 2 })

// ─── isolines of a synthetic terrain ────────────────────────────────────────────────

function isolineFrame(cycle: number, w: number, h: number): Mark[] {
  const r = createRng(seed(cycle))
  const a = inner(w, h)
  const spanLon = 10, spanLat = (spanLon * (a.y1 - a.y0)) / (a.x1 - a.x0)
  const box: BBox = { west: 0, east: spanLon, south: 0, north: spanLat }
  const hills = [
    { lon: 2.7 + r() * 0.6, lat: spanLat * (0.55 + 0.1 * r()), height: 900, radiusKm: 120 },
    { lon: 6.4 + r() * 0.6, lat: spanLat * (0.3 + 0.1 * r()), height: 720, radiusKm: 105 },
    { lon: 7.7, lat: spanLat * (0.72 + 0.08 * r()), height: 520, radiusKm: 85 },
    { lon: 4.6, lat: spanLat * 0.2, height: 380, radiusKm: 70 },
  ]
  const grid = makeGrid(box, 80, Math.round(80 * spanLat / spanLon), hillsHeight(hills, 70, seed(cycle)))
  const [lo, hi] = gridExtent(grid)
  const step = niceInterval(lo, hi, 9)
  const levels = contourLevels(lo, hi, step)
  const px = (lon: number) => a.x0 + (lon / spanLon) * (a.x1 - a.x0), py = (lat: number) => a.y1 - (lat / spanLat) * (a.y1 - a.y0)
  const marks: Mark[] = []
  gridIsolines(grid, levels).forEach(({ value, lines }, li) => {
    const t = (value - lo) / (hi - lo || 1)
    lines.forEach((line, i) => marks.push(path(`iso:${li}:${i}`, line.map(([lon, lat]) => [px(lon), py(lat)] as [number, number]), d3.interpolateYlGnBu(0.25 + 0.7 * t), Math.round(value / step) % 5 === 0 ? 2.4 : 1.2)))
  })
  marks.push(textM('iso:note', w / 2, h - 12, `등고선 간격 ${step} m (합성 지형)`, 'middle', '#8a9490'))
  return marks
}

// ─── streamlines of a synthetic wind field ──────────────────────────────────────────

function streamFrame(cycle: number, w: number, h: number): Mark[] {
  const r = createRng(seed(cycle))
  const a = inner(w, h)
  const west = 124, east = 131, midLat = 35.5
  const spanLat = ((east - west) * Math.cos((midLat * Math.PI) / 180) * (a.y1 - a.y0)) / (a.x1 - a.x0)
  const box: BBox = { west, east, south: midLat - spanLat / 2, north: midLat + spanLat / 2 }
  const field: VectorField = {
    sources: [
      { kind: 'vortex', lon: 127.6 + r() * 0.8, lat: midLat - 0.7 + r() * 0.5, strength: 26, radiusKm: 120 },
      { kind: 'vortex', lon: 128.3, lat: midLat + 1.3, strength: -11, radiusKm: 170 },
      { kind: 'source', lon: 125.6, lat: midLat + 0.2, strength: 7, radiusKm: 140 },
      { kind: 'sink', lon: 129.9, lat: midLat + 0.6, strength: 6, radiusKm: 110 },
    ],
    uniform: [2, 1],
  }
  const lines = evenStreamlines(field, box, 42, 14, 110)
  const px = (lon: number) => a.x0 + ((lon - box.west) / (box.east - box.west)) * (a.x1 - a.x0), py = (lat: number) => a.y1 - ((lat - box.south) / (box.north - box.south)) * (a.y1 - a.y0)
  const sp = lines.map((l) => d3.mean(l, (p) => speedOf(fieldAt(field, p[0], p[1]))) ?? 0)
  const smax = Math.max(1, ...sp)
  return lines.filter((l) => l.length > 2).map((l, i) => path(`sl:${i}`, l.map(([lon, lat]) => [px(lon), py(lat)] as [number, number]), schemes.viridis.interpolate(0.15 + 0.75 * (sp[i] / smax)), 1.8))
}

// ─── Voronoi map of seeded sites ────────────────────────────────────────────────────

function voronoiFrame(cycle: number, w: number, h: number): Mark[] {
  const r = createRng(seed(cycle))
  const a = inner(w, h)
  // jittered grid sites: even coverage without coincident points
  const cols = 6, rows = 4
  const sites: P2[] = []
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) sites.push([a.x0 + ((i + 0.2 + 0.6 * r()) / cols) * (a.x1 - a.x0), a.y0 + ((j + 0.2 + 0.6 * r()) / rows) * (a.y1 - a.y0)])
  const cells = voronoiCells(sites, [a.x0, a.y0, a.x1, a.y1])
  const areas = cells.map((c) => (c ? Math.abs(d3.polygonArea(c)) : 0))
  const [lo, hi] = d3.extent(areas) as [number, number]
  const marks: Mark[] = []
  cells.forEach((c, i) => { if (c) marks.push(area(`vm:c${i}`, c, schemes.teal.interpolate(0.2 + 0.7 * ((areas[i] - lo) / (hi - lo || 1))), 0.9)) })
  sites.forEach((s, i) => marks.push(dot(`vm:s${i}`, s[0], s[1], 3.4, '#1f2937')))
  return marks
}

// ─── Kaplan–Meier curves with 95% bands ─────────────────────────────────────────────

function kmFrame(cycle: number, w: number, h: number): Mark[] {
  const r = createRng(seed(cycle))
  const a = inner(w, h)
  const groups = [{ rate: 0.14, color: colorAt(1) }, { rate: 0.065 + 0.01 * (cycle % 3), color: colorAt(0) }]
  const tmax = 24
  const x = d3.scaleLinear([0, tmax], [a.x0 + 6, a.x1])
  const y = d3.scaleLinear([0, 1], [a.y1, a.y0 + 2])
  const marks: Mark[] = []
  groups.forEach((g, gi) => {
    const subs = Array.from({ length: 40 }, (_, i) => { const ev = -Math.log(1 - r()) / g.rate, cen = r() * tmax; return { time: Math.min(ev, cen), event: ev <= cen, row: i } })
    const km = kaplanMeier(subs.map((s) => ({ ...s, time: Math.min(s.time, tmax) })))
    const steps = km.steps.filter((s) => s.time <= tmax)
    const pts: [number, number][] = [[x(0), y(1)]]
    let prev = 1
    for (const s of steps) { pts.push([x(s.time), y(prev)], [x(s.time), y(s.surv)]); prev = s.surv }
    pts.push([x(tmax), y(prev)])
    marks.push({ t: 'band', k: `km:b${gi}`, pts: [[x(0), y(1), y(1)], ...steps.map((s) => [x(s.time), y(s.hi), y(s.lo)] as [number, number, number]), [x(tmax), y(steps.at(-1)?.hi ?? 1), y(steps.at(-1)?.lo ?? 1)]], fill: g.color, stroke: g.color, fo: 0.16, so: 0, sw: 0, o: 1, from: { fo: 0, o: 0 } })
    marks.push({ ...path(`km:l${gi}`, pts, g.color, 2.4), pts })
    marks.push(textM(`km:n${gi}`, a.x1 - 4, y(0.97 - 0.09 * gi), gi === 0 ? '대조군' : '치료군', 'end', g.color))
  })
  return [...marks, ...axisX('km', x, a.y1, [0, 6, 12, 18, 24].map((v) => [v, `${v}`] as [number, string]), w)]
}

// ─── Renko bricks on a seeded price walk ────────────────────────────────────────────

function renkoFrame(cycle: number, w: number, h: number): Mark[] {
  const r = createRng(seed(cycle))
  const a = inner(w, h)
  let c = 100
  const closes = Array.from({ length: 220 }, (_, i) => { c *= Math.exp(r.normal(0.0009, 0.011)); return { t: i * 86400000, c } })
  const range = (d3.max(closes, (d) => d.c) ?? 1) - (d3.min(closes, (d) => d.c) ?? 0)
  let size = Math.max(0.2, range / 14)
  let bricks = renko(closes, size)
  while (bricks.length > 56) { size *= 1.25; bricks = renko(closes, size) }
  const lo = d3.min(bricks, (b) => Math.min(b.open, b.close)) ?? 0, hi = d3.max(bricks, (b) => Math.max(b.open, b.close)) ?? 1
  const y = d3.scaleLinear([lo, hi], [a.y1 - 2, a.y0 + 2])
  const bw = Math.min(26, (a.x1 - a.x0) / Math.max(1, bricks.length))
  const x0 = a.x0 + ((a.x1 - a.x0) - bw * bricks.length) / 2
  return [
    ...bricks.map((b) => { const top = y(Math.max(b.open, b.close)), bot = y(Math.min(b.open, b.close)); return rectM(`rk:${b.index}`, x0 + b.index * bw + 0.5, top, bw - 1, bot - top, b.up ? colorAt(0) : colorAt(1), { from: { y: bot, h: 0, o: 0.2 } }) }),
    textM('rk:note', w / 2, h - 12, `벽돌 하나 = ${size.toFixed(1)}`, 'middle'),
  ]
}

// ─── Manhattan plot of synthetic association results ────────────────────────────────

function manhattanFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('gwas-synth', seed(cycle), 260)
  const ci = columnIndex(t, '염색체'), pi = columnIndex(t, '위치'), qi = columnIndex(t, 'p값')
  const chrLen = Array.from({ length: 22 }, (_, c) => Math.max(...t.rows.filter((r) => toNumber(r[ci]) === c + 1).map((r) => toNumber(r[pi]) ?? 0), 1))
  const off = chromosomeOffsets(chrLen, 6e6)
  const total = off[21] + chrLen[21]
  const x = d3.scaleLinear([0, total], [a.x0 + 4, a.x1])
  const lp = t.rows.map((r) => -Math.log10(Math.max(1e-300, toNumber(r[qi]) ?? 1)))
  const y = d3.scaleLinear([0, Math.max(9, Math.max(...lp) * 1.05)], [a.y1 - 2, a.y0 + 2])
  const marks: Mark[] = []
  t.rows.forEach((r, i) => { const c = (toNumber(r[ci]) ?? 1) - 1; marks.push(dot(`mh:${i}`, x(off[c] + (toNumber(r[pi]) ?? 0)), y(lp[i]), lp[i] > 7.3 ? 3.4 : 2.2, c % 2 ? colorAt(2) : colorAt(0), 0.85)) })
  marks.push(lineM('mh:gw', a.x0, y(-Math.log10(5e-8)), a.x1, y(-Math.log10(5e-8)), '#c94b4b', 1.4, 0.9))
  return [...marks, textM('mh:note', w / 2, h - 12, '점선: 유전체 전체 유의 기준 5×10⁻⁸ (합성 데이터)', 'middle')]
}

// ─── phase portrait of the Van der Pol oscillator ───────────────────────────────────

function phaseFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const sys = phaseSystems.find((s) => s.id === 'van-der-pol')!
  const mu = [0.6, 1.0, 1.6, 2.2][cycle % 4]
  const f = sys.field({ mu })
  const x = d3.scaleLinear(sys.window.x, [a.x0, a.x1]), y = d3.scaleLinear(sys.window.y, [a.y1, a.y0])
  const starts: [number, number][] = Array.from({ length: 12 }, (_, i) => { const ang = (i / 12) * Math.PI * 2, rad = i % 2 ? 3.4 : 0.6; return [rad * Math.cos(ang), rad * 1.6 * Math.sin(ang)] })
  const marks: Mark[] = [lineM('pp:x', a.x0, y(0), a.x1, y(0), GRID, 1, 1, { o: 1 }), lineM('pp:y', x(0), a.y0, x(0), a.y1, GRID, 1, 1, { o: 1 })]
  starts.forEach((p, i) => {
    const tr = trajectory(f, p, 0.04, 330, sys.window)
    marks.push(path(`pp:t${i}`, tr.filter((_, k) => k % 3 === 0).map((q) => [x(q[0]), y(q[1])] as [number, number]), d3.interpolateYlGnBu(0.35 + 0.5 * (i / 12)), 1.7, 0.85))
  })
  marks.push(dot('pp:eq', x(0), y(0), 4.5, '#c94b4b'))
  return [...marks, textM('pp:note', w / 2, h - 12, `반 데르 폴 진동자 (μ = ${mu}): 모든 궤적이 한 극한 순환으로 모입니다`, 'middle')]
}

// ─── UpSet plot of club membership ──────────────────────────────────────────────────

function upsetFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('set-members', seed(cycle), 120)
  const names = t.columns.slice(1).map((c) => c.name)
  const member = t.rows.map((r) => names.map((_, j) => (toNumber(r[j + 1]) ?? 0) > 0))
  const sizes = names.map((_, j) => member.filter((m) => m[j]).length)
  const order = names.map((_, j) => j).sort((p, q) => sizes[q] - sizes[p])
  const combos = exclusiveIntersections(member, names.length).sort((p, q) => q.count - p.count).slice(0, 10)
  const leftW = 66, rowH = Math.min(22, (a.y1 - a.y0) * 0.5 / names.length)
  const mTop = a.y1 - names.length * rowH
  const gx0 = a.x0 + leftW, gw = a.x1 - gx0, cw = gw / combos.length
  const maxC = combos[0]?.count ?? 1
  const y = d3.scaleLinear([0, maxC], [mTop - 8, a.y0 + 6])
  const maxS = Math.max(...sizes)
  const marks: Mark[] = []
  combos.forEach((c, i) => {
    const cx = gx0 + (i + 0.5) * cw
    marks.push(rectM(`us:b${c.mask}`, cx - cw * 0.3, y(c.count), cw * 0.6, mTop - 8 - y(c.count), '#374151', { from: { y: mTop - 8, h: 0, o: 0.2 } }))
    const rs = c.sets.map((s) => order.indexOf(s))
    if (rs.length > 1) marks.push(lineM(`us:l${c.mask}`, cx, mTop + Math.min(...rs) * rowH + rowH / 2, cx, mTop + Math.max(...rs) * rowH + rowH / 2, '#374151', 2.2))
    order.forEach((s, ri) => marks.push(dot(`us:d${c.mask}:${s}`, cx, mTop + ri * rowH + rowH / 2, Math.min(4.4, cw * 0.3), c.sets.includes(s) ? '#374151' : '#e1e6e4')))
  })
  order.forEach((s, ri) => {
    marks.push(rectM(`us:s${s}`, a.x0 + leftW - 50 - 38 * (sizes[s] / maxS), mTop + ri * rowH + rowH * 0.2, 38 * (sizes[s] / maxS), rowH * 0.6, colorAt(s), { from: { w: 0, o: 0.2 } }))
    marks.push(textM(`us:n${s}`, a.x0 + leftW - 44, mTop + ri * rowH + rowH / 2 + 4, names[s], 'start', INK))
  })
  void inclusiveCount
  return marks
}

// ─── Nightingale rose: area-proportional monthly values ─────────────────────────────

function roseFrame(cycle: number, w: number, h: number): Mark[] {
  const r = createRng(seed(cycle))
  const cx = w / 2, cy = (h - PAD.b + PAD.t) / 2 + 4
  const R = Math.min(w - 2 * PAD.l, h - PAD.t - PAD.b) / 2 - 6
  const vals = Array.from({ length: 12 }, (_, m) => 40 + 34 * Math.sin(((m - 2 + (cycle % 3)) / 12) * Math.PI * 2) + 16 * r())
  const vmax = Math.max(...vals)
  const marks: Mark[] = []
  vals.forEach((v, m) => {
    const rad = R * Math.sqrt(v / vmax)
    const arc: ArcMark = { t: 'arc', k: `nr:${m}`, cx, cy, a0: (m / 12) * Math.PI * 2 + 0.02, a1: ((m + 1) / 12) * Math.PI * 2 - 0.02, r0: 0, r1: rad, fill: schemes.ylorrd.interpolate(0.2 + 0.7 * (v / vmax)), stroke: '#ffffff', o: 1, from: { r1: 0, o: 0.2 } }
    marks.push(arc)
    const ang = ((m + 0.5) / 12) * Math.PI * 2
    marks.push(textM(`nr:t${m}`, cx + (R + 11) * Math.sin(ang), cy - (R + 11) * Math.cos(ang) + 4, `${m + 1}월`, 'middle', INK))
  })
  return marks
}

// ─── Euler diagram of three club memberships ────────────────────────────────────────

function vennFrame(cycle: number, w: number, h: number): Mark[] {
  const t = generateDataset('set-members', seed(cycle), 120)
  const pick = [0, 1, 2]
  const names = pick.map((j) => t.columns[j + 1].name)
  const member = t.rows.map((r) => pick.map((j) => (toNumber(r[j + 1]) ?? 0) > 0))
  const sizes = pick.map((_, j) => member.filter((m) => m[j]).length)
  const pair = pick.map((_, i) => pick.map((__, j) => (i === j ? sizes[i] : inclusiveCount(member, (1 << i) | (1 << j)))))
  const circles = eulerLayout(sizes, pair)
  const x0 = Math.min(...circles.map((c) => c.x - c.r)), x1 = Math.max(...circles.map((c) => c.x + c.r)), y0 = Math.min(...circles.map((c) => c.y - c.r)), y1 = Math.max(...circles.map((c) => c.y + c.r))
  const a = inner(w, h)
  const sc = Math.min((a.x1 - a.x0 - 60) / (x1 - x0), (a.y1 - a.y0 - 10) / (y1 - y0))
  const ox = (a.x0 + a.x1) / 2 - ((x0 + x1) / 2) * sc, oy = (a.y0 + a.y1) / 2 - ((y0 + y1) / 2) * sc
  const ex = exclusiveIntersections(member, 3)
  const marks: Mark[] = circles.map((c, i) => ({ t: 'circle', k: `vn:c${i}`, x: ox + c.x * sc, y: oy + c.y * sc, r: c.r * sc, fill: colorAt([0, 1, 2][i]), o: 0.4, from: { r: 0, o: 0 } }) as CircleMark)
  regionAreas(circles, 140).forEach((rg) => {
    const e = ex.find((q) => q.mask === rg.mask)
    if (e && rg.area * sc * sc > 600) marks.push(textM(`vn:n${rg.mask}`, ox + rg.cx * sc, oy + rg.cy * sc + 4, String(e.count), 'middle', '#111827'))
  })
  circles.forEach((c, i) => marks.push(textM(`vn:l${i}`, ox + c.x * sc, oy + (c.y - c.r) * sc - 6, `${names[i]} ${sizes[i]}`, 'middle', INK)))
  return marks
}

// ─── bifurcation diagram of the logistic map ────────────────────────────────────────

function bifurcationFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const lo = 2.8 + 0.1 * (cycle % 3), hi = 4
  const x = d3.scaleLinear([lo, hi], [a.x0 + 4, a.x1]), y = d3.scaleLinear([0, 1], [a.y1 - 2, a.y0 + 2])
  const marks: Mark[] = []
  const N = 46
  for (let i = 0; i < N; i++) {
    const r = lo + ((hi - lo) * i) / (N - 1)
    attractor('logistic', r, 400, 7).forEach((v, j) => marks.push(dot(`bf:${i}:${j}`, x(r), y(v), 1.7, schemes.viridis.interpolate(0.1 + 0.8 * ((r - lo) / (hi - lo))), 0.85)))
  }
  return [...marks, ...axisX('bf', x, a.y1, [lo, (lo + hi) / 2, hi].map((v) => [v, v.toFixed(1)] as [number, string]), w), textM('bf:r', a.x1, a.y1 - 6, 'r', 'end', INK)]
}

// ─── spiral plot with a weekly rhythm ───────────────────────────────────────────────

function spiralFrame(cycle: number, w: number, h: number): Mark[] {
  const r = createRng(seed(cycle))
  const cx = w / 2, cy = (h - PAD.b + PAD.t) / 2 + 2
  const R = Math.min(w - 2 * PAD.l, h - PAD.t - PAD.b) / 2 - 8
  const days = 98
  const vals = Array.from({ length: days }, (_, d) => { const wk = d % 7; return 40 + (wk >= 5 ? 38 : 0) + 8 * Math.sin(d / 14) + 9 * r() })
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const pitch = (R - 22) / (days / 7), innerR = 18
  return vals.map((v, d) => {
    const p = spiralPoint(d, 0, 7, innerR, pitch)
    return dot(`sp:${d}`, cx + p.r * Math.sin(p.angle), cy - p.r * Math.cos(p.angle), 3.3 + 1.6 * ((v - lo) / (hi - lo || 1)), schemes.viridis.interpolate(0.1 + 0.85 * ((v - lo) / (hi - lo || 1))))
  })
}

export const HERO_V5 = { isoline: isolineFrame, streamline: streamFrame, voronoi: voronoiFrame, km: kmFrame, renko: renkoFrame, manhattan: manhattanFrame, phase: phaseFrame, upset: upsetFrame, rose: roseFrame, venn: vennFrame, bifurcation: bifurcationFrame, spiral: spiralFrame } as const
export type HeroV5Key = keyof typeof HERO_V5

export function buildV5(key: HeroV5Key, cycle: number, w: number, h: number): Mark[] {
  return HERO_V5[key](cycle, w, h)
}
