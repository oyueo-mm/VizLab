import * as d3 from 'd3'
import { generateDataset } from '../data/datasets'
import { columnIndex, toNumber } from '../data/table'
import { colorAt, schemes } from '../lib/colors'
import { createRng } from '../lib/random'
import { buildBackbone, enrichmentWalk, phiPsi, ramaRegion, simulateQueue, toleranceStack, weibullFit, zipf } from '../stats/applied'
import { efficientFrontier, covariance, meanVector, sviVariance } from '../stats/finance2'
import { mandelbrot } from '../stats/fractal'
import { adjacency, dagLayout, laplacianSpectrum, louvain, maxFlow } from '../stats/graph2'
import { acf } from '../stats/tsa'
import type { CircleMark, LineMark, LinkMark, Mark, PolyMark, RectMark, TextMark } from './heroFrames'

/**
 * Frames of the fourteen v0.6 stages (Mandelbrot set, spectral embedding, layered DAG, maximum flow, Weibull plot, GSEA, Zipf plot, community blockmodel,
 * efficient frontier, volatility smile, autocorrelation, tolerance stack-up, queue length, Ramachandran plot). Each runs the app's own engine on seeded
 * data; the module is a separate chunk that the home page fetches a few stages before the first of them comes up.
 */

const CLEAR = 'rgba(0,0,0,0)'
const GRID = '#cfd6d3'
const PAD = { l: 18, r: 18, t: 18, b: 34 }
const seed = (cycle: number) => 5 + cycle * 13

const rectM = (k: string, x: number, y: number, wd: number, ht: number, fill: string, extra: Partial<RectMark> = {}): RectMark => ({ t: 'rect', k, x, y, w: wd, h: Math.max(0, ht), r: 1.5, fill, stroke: CLEAR, sw: 0, o: 1, from: { h: 0, o: 0.2 }, ...extra })
const dot = (k: string, x: number, y: number, r: number, fill: string, o = 1): CircleMark => ({ t: 'circle', k, x, y, r, fill, o, from: { r: 0, o: 0 } })
const lineM = (k: string, x1: number, y1: number, x2: number, y2: number, stroke: string, sw: number, o = 1): LineMark => ({ t: 'line', k, x1, y1, x2, y2, stroke, sw, o, from: { o: 0 } })
const textM = (k: string, x: number, y: number, s: string, anchor: TextMark['anchor'] = 'middle', fill = '#8a9490'): TextMark => ({ t: 'text', k, x, y, text: s, anchor, fill, o: 1 })
const path = (k: string, pts: [number, number][], stroke: string, sw: number, so = 0.9): PolyMark => ({ t: 'poly', k, pts, closed: false, fill: CLEAR, stroke, fo: 0, so, sw, o: 1, from: { so: 0, o: 0 } })
const link = (k: string, x0: number, y0: number, x1: number, y1: number, w: number, stroke: string): LinkMark => ({ t: 'link', k, x0, y0, x1, y1, w, stroke, o: 0.8, from: { w: 0, o: 0 } })

const inner = (w: number, h: number) => ({ x0: PAD.l + 4, x1: w - PAD.r - 4, y0: PAD.t + 4, y1: h - PAD.b - 2 })
const note = (k: string, w: number, h: number, s: string) => textM(k, w / 2, h - 12, s)

/** Stochastic-block-model graph: `k` groups of `n` nodes, dense inside and sparse between. */
function blockGraph(cycle: number, k: number, n: number) {
  const r = createRng(seed(cycle)), edges: { a: number; b: number; w: number }[] = []
  for (let i = 0; i < k * n; i++) for (let j = i + 1; j < k * n; j++) if (r() < (Math.floor(i / n) === Math.floor(j / n) ? 0.5 : 0.04)) edges.push({ a: i, b: j, w: 1 })
  return { N: k * n, edges }
}

// ─── Mandelbrot set ─────────────────────────────────────────────────────────────────

function mandelbrotFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h), cols = 28, rows = 16, cw = (a.x1 - a.x0) / cols, ch = (a.y1 - a.y0) / rows
  const zoom = 1 + 0.35 * Math.sin(cycle * 0.9)
  const marks: Mark[] = []
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = -0.75 + ((i + 0.5) / cols - 0.5) * (3.2 / zoom), y = ((j + 0.5) / rows - 0.5) * (3.2 * (rows / cols) * (a.x1 - a.x0) / (a.y1 - a.y0) / zoom) * 0.62
    const t = mandelbrot(x, y, 60)
    marks.push(rectM(`mb:${j}:${i}`, a.x0 + i * cw, a.y0 + j * ch, cw + 0.5, ch + 0.5, t < 0 ? '#111827' : schemes.viridis.interpolate(0.12 + 0.85 * Math.min(1, t / 30)), { r: 0, from: { o: 0 } }))
  }
  marks.push(note('mb:note', w, h, '복소 평면 z → z² + c의 탈출 시간'))
  return marks
}

// ─── spectral embedding ─────────────────────────────────────────────────────────────

function spectralFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h), { N, edges } = blockGraph(cycle, 4, 10)
  const spec = laplacianSpectrum(adjacency(N, edges), 'symmetric'), vx = spec.vectors[1], vy = spec.vectors[2]
  const sx = d3.scaleLinear().domain(d3.extent(vx) as [number, number]).range([a.x0 + 10, a.x1 - 10]), sy = d3.scaleLinear().domain(d3.extent(vy) as [number, number]).range([a.y1 - 8, a.y0 + 8])
  const marks: Mark[] = edges.map((e, i) => lineM(`sp:e${i}`, sx(vx[e.a]), sy(vy[e.a]), sx(vx[e.b]), sy(vy[e.b]), '#cfd6d3', 0.8, 0.5))
  for (let i = 0; i < N; i++) marks.push(dot(`sp:n${i}`, sx(vx[i]), sy(vy[i]), 5.2, colorAt(Math.floor(i / 10))))
  marks.push(note('sp:note', w, h, '라플라시안 고유벡터 v₂, v₃ (스펙트럼 임베딩)'))
  return marks
}

// ─── layered drawing: DAG and maximum flow ──────────────────────────────────────────

function layered(prefix: string, names: string[], edges: [number, number][], w: number, h: number, edgeStyle: (i: number) => { stroke: string; w: number }, fill: (v: number) => string, fixedLayer?: number[]): Mark[] {
  const a = inner(w, h), L = dagLayout(names.length, edges, 8, fixedLayer), depth = L.layers.length, maxSize = Math.max(...L.layers.map((l) => l.length))
  const bw = Math.min(56, (a.x1 - a.x0) / depth - 14), bh = 20
  const P = names.map((_, v) => ({ x: a.x0 + bw / 2 + (depth > 1 ? (L.layer[v] * (a.x1 - a.x0 - bw)) / (depth - 1) : 0), y: (a.y0 + a.y1) / 2 + L.x[v] * Math.min(34, (a.y1 - a.y0 - bh) / Math.max(1, maxSize - 1)) }))
  const marks: Mark[] = edges.map(([u, v], i) => {
    const st = edgeStyle(i), back = L.layer[u] >= L.layer[v]
    return link(`${prefix}:l${i}`, P[u].x + (back ? 0 : bw / 2), P[u].y, P[v].x - (back ? 0 : bw / 2), P[v].y, st.w, st.stroke)
  })
  names.forEach((nm, v) => { marks.push(rectM(`${prefix}:n${v}`, P[v].x - bw / 2, P[v].y - bh / 2, bw, bh, fill(v), { r: 5, stroke: '#9aa1a9', sw: 1 })); marks.push(textM(`${prefix}:t${v}`, P[v].x, P[v].y + 4, nm.length > 5 ? nm.slice(0, 5) : nm, 'middle', '#111827')) })
  return marks
}

function dagFrame(cycle: number, w: number, h: number): Mark[] {
  const names = ['설계', '개발', '디자인', '시험', '문서', '보안', '성능', '출시']
  const edges: [number, number][] = [[0, 1], [0, 2], [2, 1], [1, 3], [0, 4], [3, 5], [3, 6], [5, 7], [6, 7], [4, 7]]
  const dur = [5, 10, 6, 4, 4, 3, 4, 1].map((d, i) => d + ((cycle + i) % 3))
  const hot = new Set([0, 2, 1, 3, 6, 7])
  const marks = layered('dg', names, edges, w, h, (i) => (hot.has(edges[i][0]) && hot.has(edges[i][1]) ? { stroke: colorAt(1), w: 3 } : { stroke: '#b4bcb8', w: 1.4 }), (v) => (hot.has(v) ? '#fbe3d3' : '#eef2f6'))
  marks.push(note('dg:note', w, h, `임계 경로 길이 ${dur[0] + dur[2] + dur[1] + dur[3] + dur[6]}일 (층별 배치)`))
  return marks
}

function flowFrame(cycle: number, w: number, h: number): Mark[] {
  const names = ['S', 'A', 'B', 'C', 'D', 'T']
  const cap = [16, 13, 10, 4, 12, 9, 14, 7, 20, 4].map((c, i) => c + (i === cycle % 10 ? 2 : 0))
  const pairs: [number, number][] = [[0, 1], [0, 2], [1, 2], [2, 1], [1, 3], [3, 2], [2, 4], [4, 3], [3, 5], [4, 5]]
  const fe = pairs.map(([from, to], i) => ({ from, to, cap: cap[i] })), res = maxFlow(6, fe, 0, 5)
  const layer = [0, 1, 1, 2, 2, 3]
  const marks = layered('mf', names, pairs, w, h, (i) => ({ stroke: res.flows[i] >= fe[i].cap - 1e-9 ? colorAt(1) : res.flows[i] > 0 ? colorAt(0) : '#b4bcb8', w: 1 + (5 * fe[i].cap) / 20 }), (v) => (res.cutSide[v] ? '#e3f2ef' : '#f1f3f5'), layer)
  marks.push(note('mf:note', w, h, `최대 유량 ${res.value} = 최소 절단 용량`))
  return marks
}

// ─── Weibull probability plot ───────────────────────────────────────────────────────

function weibullFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h), r = createRng(seed(cycle)), beta = 1.8 + 0.5 * Math.sin(cycle), eta = 100
  const t = Array.from({ length: 18 }, () => eta * (-Math.log(1 - r())) ** (1 / beta))
  const fit = weibullFit(t, t.map(() => true), 'rry')
  if (!fit) return []
  const xs = fit.points.map((p) => p.x), ys = fit.points.map((p) => p.y)
  const sx = d3.scaleLinear().domain([Math.min(...xs) - 0.2, Math.max(...xs) + 0.2]).range([a.x0, a.x1]), sy = d3.scaleLinear().domain([Math.min(...ys) - 0.3, Math.max(...ys) + 0.3]).range([a.y1, a.y0])
  const x0 = Math.min(...xs) - 0.2, x1 = Math.max(...xs) + 0.2
  return [
    lineM('wb:ref', a.x0, sy(0), a.x1, sy(0), GRID, 1, 1),
    path('wb:fit', [[sx(x0), sy(fit.beta * (x0 - Math.log(fit.eta)))], [sx(x1), sy(fit.beta * (x1 - Math.log(fit.eta)))]], colorAt(1), 2.4),
    ...fit.points.map((p, i) => dot(`wb:p${i}`, sx(p.x), sy(p.y), 4.4, colorAt(0))),
    textM('wb:beta', a.x0 + 4, a.y0 + 12, `β = ${fit.beta.toFixed(2)}`, 'start', '#4b5563'),
    note('wb:note', w, h, '와이블 확률지: 직선의 기울기 = 형상 β'),
  ]
}

// ─── GSEA running sum ───────────────────────────────────────────────────────────────

function gseaFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h), r = createRng(seed(cycle)), n = 400
  const scores = Array.from({ length: n }, (_, i) => 3 - (6 * i) / (n - 1))
  const inSet = scores.map((_, i) => r() < (i < 110 ? 0.16 : 0.025))
  const walk = enrichmentWalk(scores, inSet, 1)
  if (!walk) return []
  const bandH = 22, plotBottom = a.y1 - bandH - 8
  const sx = d3.scaleLinear().domain([0, n]).range([a.x0, a.x1]), sy = d3.scaleLinear().domain([Math.min(0, ...walk.run), Math.max(...walk.run) * 1.1]).range([plotBottom, a.y0 + 8])
  const marks: Mark[] = [lineM('gs:z', a.x0, sy(0), a.x1, sy(0), GRID, 1, 1), path('gs:run', walk.run.filter((_, i) => i % 4 === 0 || i === walk.at).map((v, i) => [sx(i * 4), sy(v)] as [number, number]), colorAt(0), 2.6), lineM('gs:at', sx(walk.at), a.y0 + 8, sx(walk.at), plotBottom, colorAt(1), 1.6, 0.8)]
  inSet.forEach((v, i) => { if (v) marks.push(lineM(`gs:h${i}`, sx(i), a.y1 - bandH, sx(i), a.y1, '#4c6fb5', 1.2, 0.8)) })
  marks.push(textM('gs:es', a.x1 - 4, a.y0 + 14, `ES = ${walk.es.toFixed(2)}`, 'end', '#4b5563'))
  return marks
}

// ─── Zipf plot ──────────────────────────────────────────────────────────────────────

function zipfFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h), r = createRng(seed(cycle)), V = 300, cdf: number[] = []
  let acc = 0
  for (let i = 1; i <= V; i++) { acc += i ** -1.05; cdf.push(acc) }
  const tokens = Array.from({ length: 2500 }, () => { const x = r() * acc; let lo = 0, hi = V - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < x) lo = m + 1; else hi = m } return `w${lo}` })
  const z = zipf(tokens, 1, 60)
  const rows = z.rows.slice(0, 120), sx = d3.scaleLog().domain([1, 120]).range([a.x0, a.x1]), sy = d3.scaleLog().domain([1, rows[0].freq * 1.2]).range([a.y1, a.y0])
  const marks: Mark[] = rows.map((p, i) => dot(`zp:p${i}`, sx(p.rank), sy(p.freq), 3.2, i < 60 ? colorAt(0) : '#b4bcb8'))
  if (z.fit) marks.push(path('zp:fit', [[sx(1), sy(Math.exp(z.fit.intercept))], [sx(60), sy(Math.exp(z.fit.intercept + z.fit.slope * Math.log(60)))]], colorAt(1), 2.4), textM('zp:s', a.x1 - 4, a.y0 + 14, `기울기 ${z.fit.slope.toFixed(2)}`, 'end', '#4b5563'))
  marks.push(note('zp:note', w, h, '순위–빈도 로그–로그 (지프 법칙)'))
  return marks
}

// ─── community blockmodel ───────────────────────────────────────────────────────────

function blockFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h), { N, edges } = blockGraph(cycle, 4, 9), A = adjacency(N, edges), comm = louvain(A, 1)
  const order = Array.from({ length: N }, (_, i) => i).sort((p, q) => comm[p] - comm[q] || p - q)
  const side = Math.min(a.x1 - a.x0, a.y1 - a.y0), cell = side / N, ox = (w - side) / 2, oy = a.y0
  const marks: Mark[] = []
  order.forEach((i, ri) => order.forEach((j, ci) => { if (A[i][j] > 0) marks.push(rectM(`bm:${ri}:${ci}`, ox + ci * cell, oy + ri * cell, cell - 0.6, cell - 0.6, colorAt(comm[i]), { r: 0.5, from: { o: 0, h: cell } })) }))
  marks.push(note('bm:note', w, h, '루뱅 군집별로 정렬한 인접 행렬'))
  return marks
}

// ─── efficient frontier ─────────────────────────────────────────────────────────────

function frontierFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h), t = generateDataset('asset-returns', seed(cycle), 96)
  const idx = [1, 2, 3, 4, 5].map((c) => columnIndex(t, t.columns[c].name))
  const R = t.rows.map((r) => idx.map((i) => toNumber(r[i]) ?? 0)), mu = meanVector(R).map((v) => v * 12), S = covariance(R).map((row) => row.map((v) => v * 12))
  const fr = efficientFrontier(mu, S, 28, true)
  const vols = [...fr.map((f) => f.vol), ...S.map((row, i) => Math.sqrt(row[i]))], rets = [...fr.map((f) => f.ret), ...mu]
  const sx = d3.scaleLinear().domain([0, Math.max(...vols) * 1.08]).range([a.x0, a.x1]), sy = d3.scaleLinear().domain([Math.min(...rets) * 0.9, Math.max(...rets) * 1.08]).range([a.y1, a.y0])
  return [
    path('ef:line', fr.map((f) => [sx(f.vol), sy(f.ret)] as [number, number]), colorAt(0), 3),
    ...mu.map((m, i) => dot(`ef:a${i}`, sx(Math.sqrt(S[i][i])), sy(m), 5.5, '#1f2937')),
    dot('ef:min', sx(fr[0].vol), sy(fr[0].ret), 7, colorAt(2)),
    ...fr.filter((_, i) => i % 4 === 0).map((f, i) => dot(`ef:f${i}`, sx(f.vol), sy(f.ret), 3.4, colorAt(2), 0.9)),
    note('ef:note', w, h, '효율적 투자선 (합성 수익률, 투자 조언 아님)'),
  ]
}

// ─── volatility smile ───────────────────────────────────────────────────────────────

function smileFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h), ks = Array.from({ length: 31 }, (_, i) => -0.3 + (0.6 * i) / 30), marks: Mark[] = []
  const tilt = -0.45 - 0.2 * Math.sin(cycle)
  const curves = [1 / 12, 0.5, 1].map((T) => ks.map((k) => Math.sqrt(Math.max(1e-4, sviVariance(k, { a: 0.012 * T + 0.004, b: 0.09 * Math.sqrt(T) + 0.03, rho: tilt, m: 0, s: 0.12 + 0.1 * T }) / T))))
  const all = curves.flat(), sx = d3.scaleLinear().domain([-0.3, 0.3]).range([a.x0, a.x1]), sy = d3.scaleLinear().domain([Math.min(...all) * 0.95, Math.max(...all) * 1.05]).range([a.y1, a.y0])
  curves.forEach((c, i) => marks.push(path(`sm:c${i}`, c.map((v, j) => [sx(ks[j]), sy(v)] as [number, number]), colorAt(i), 2.8)))
  curves.forEach((c, i) => marks.push(dot(`sm:atm${i}`, sx(0), sy(c[15]), 5, colorAt(i))))
  ;['1개월', '6개월', '1년'].forEach((nm, i) => marks.push(textM(`sm:l${i}`, sx(0.3) - 4, sy(curves[i][30]) - 6, nm, 'end', colorAt(i))))
  marks.push(lineM('sm:atm', sx(0), a.y0, sx(0), a.y1, GRID, 1, 1), note('sm:note', w, h, '내재변동성 스마일 (만기 1개월·6개월·1년)'))
  return marks
}

// ─── autocorrelation ────────────────────────────────────────────────────────────────

function acfFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h), r = createRng(seed(cycle)), n = 240, x: number[] = [0, 0]
  const phi1 = 0.9 - 0.1 * (cycle % 3), phi2 = -0.45
  for (let t = 2; t < n + 40; t++) x.push(phi1 * x[t - 1] + phi2 * x[t - 2] + r.normal())
  const rho = acf(x.slice(40), 24), sx = (lag: number) => a.x0 + ((lag + 0.5) / 25) * (a.x1 - a.x0), sy = d3.scaleLinear().domain([-1, 1]).range([a.y1, a.y0]), bw = ((a.x1 - a.x0) / 25) * 0.55
  const band = 1.96 / Math.sqrt(n)
  return [
    ...rho.slice(0, 25).map((v, lag) => rectM(`ac:${lag}`, sx(lag) - bw / 2, v >= 0 ? sy(v) : sy(0), bw, Math.abs(sy(v) - sy(0)), Math.abs(v) > band ? colorAt(0) : '#b4bcb8', { r: 1 })),
    lineM('ac:zero', a.x0, sy(0), a.x1, sy(0), '#9aa1a9', 1, 1), lineM('ac:hi', a.x0, sy(band), a.x1, sy(band), colorAt(1), 1.2, 0.8), lineM('ac:lo', a.x0, sy(-band), a.x1, sy(-band), colorAt(1), 1.2, 0.8),
    note('ac:note', w, h, '자기상관함수 ACF와 95% 신뢰대 (AR(2) 합성 시계열)'),
  ]
}

// ─── tolerance stack-up ─────────────────────────────────────────────────────────────

function toleranceFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h), items = [0, 1, 2, 3].map((i) => ({ name: `p${i}`, nominal: 10 + i, plus: 0.1 + 0.02 * ((cycle + i) % 3), minus: 0.1, dist: 'normal' as const, dir: (i === 0 ? 1 : -1) as 1 | -1 }))
  const r = toleranceStack(items, { n: 6000, seed: seed(cycle), cp: 1, lsl: null, usl: null, bins: 36 })
  const sx = d3.scaleLinear().domain([r.worstLo - 0.03, r.worstHi + 0.03]).range([a.x0, a.x1]), mx = Math.max(...r.hist), bw = (a.x1 - a.x0) * (r.width / (r.worstHi - r.worstLo + 0.06))
  return [
    ...r.hist.map((c, i) => rectM(`tl:${i}`, sx(r.lo + i * r.width), a.y1 - (c / mx) * (a.y1 - a.y0 - 6), Math.max(1, bw - 1), (c / mx) * (a.y1 - a.y0 - 6), '#9ab8b4', { r: 1 })),
    lineM('tl:wl', sx(r.worstLo), a.y0, sx(r.worstLo), a.y1, colorAt(3), 1.6, 0.9), lineM('tl:wh', sx(r.worstHi), a.y0, sx(r.worstHi), a.y1, colorAt(3), 1.6, 0.9),
    lineM('tl:rl', sx(r.rssLo), a.y0, sx(r.rssLo), a.y1, colorAt(2), 1.6, 0.9), lineM('tl:rh', sx(r.rssHi), a.y0, sx(r.rssHi), a.y1, colorAt(2), 1.6, 0.9),
    note('tl:note', w, h, '조립 틈새: 최악 경우(붉은색)와 RSS ±3σ(파란색)'),
  ]
}

// ─── queue length ───────────────────────────────────────────────────────────────────

function queueFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h), run = simulateQueue(1.5, 1, 2, 120, seed(cycle) + 3)
  const steps = run.steps.filter((_, i) => i % 3 === 0), tmax = run.horizon + run.arrive[0]
  const sx = d3.scaleLinear().domain([0, tmax]).range([a.x0, a.x1]), sy = d3.scaleLinear().domain([0, Math.max(3, ...steps.map((s) => s.inQueue))]).range([a.y1, a.y0])
  const pts: [number, number][] = []
  steps.forEach((s, i) => { if (i) pts.push([sx(s.t), sy(steps[i - 1].inQueue)]); pts.push([sx(s.t), sy(s.inQueue)]) })
  const samples = steps.filter((_, i) => i % 12 === 0).map((s, i) => dot(`qs:d${i}`, sx(s.t), sy(s.inQueue), 3.6, colorAt(1)))
  return [...samples, lineM('qs:0', a.x0, sy(0), a.x1, sy(0), GRID, 1, 1), path('qs:len', pts, colorAt(1), 2.2), textM('qs:w', a.x1 - 4, a.y0 + 14, `평균 대기 ${run.meanWait.toFixed(1)}`, 'end', '#4b5563'), note('qs:note', w, h, '창구 2개 대기열 길이 (M/M/2 시뮬레이션)')]
}

// ─── Ramachandran plot ──────────────────────────────────────────────────────────────

function ramaFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h), r = createRng(seed(cycle)), side = Math.min(a.x1 - a.x0, a.y1 - a.y0), ox = (w - side) / 2
  const seg = (n: number, phi: number, psi: number) => Array.from({ length: n }, () => [phi + r.normal() * 8, psi + r.normal() * 8])
  const ang = [...seg(30, -57, -47), ...seg(18, -120, 130), ...seg(6, 60, 45)]
  const pp = phiPsi(buildBackbone(ang.map((p) => p[0]), ang.map((p) => p[1]))).filter((p) => Number.isFinite(p.phi) && Number.isFinite(p.psi))
  const sx = d3.scaleLinear().domain([-180, 180]).range([ox, ox + side]), sy = d3.scaleLinear().domain([-180, 180]).range([a.y0 + side, a.y0])
  const cl: Record<string, string> = { 'α-나선': colorAt(0), 'β-가닥': colorAt(2), '왼손 나선': colorAt(1), 기타: '#9aa1a9' }
  return [
    lineM('rm:x', ox, sy(0), ox + side, sy(0), GRID, 1, 1), lineM('rm:y', sx(0), a.y0, sx(0), a.y0 + side, GRID, 1, 1),
    ...pp.map((p, i) => dot(`rm:p${i}`, sx(p.phi), sy(p.psi), 4.4, cl[ramaRegion(p.phi, p.psi)], 0.9)),
    note('rm:note', w, h, 'φ–ψ 이면각 (골격 좌표에서 계산)'),
  ]
}

export const HERO_V6 = { mandelbrot: mandelbrotFrame, spectral: spectralFrame, dag: dagFrame, flow: flowFrame, weibull: weibullFrame, gsea: gseaFrame, zipf: zipfFrame, blockmodel: blockFrame, frontier: frontierFrame, smile: smileFrame, acf: acfFrame, tolerance: toleranceFrame, queue: queueFrame, rama: ramaFrame }
export type HeroV6Key = keyof typeof HERO_V6

export function buildV6(key: HeroV6Key, cycle: number, w: number, h: number): Mark[] {
  return HERO_V6[key](cycle, w, h)
}
