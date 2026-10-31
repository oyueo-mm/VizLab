import * as d3 from 'd3'
import { generateDataset } from '../data/datasets'
import { columnIndex, toLabel, toNumber } from '../data/table'
import { colorAt } from '../lib/colors'
import { createRng } from '../lib/random'
import { boxStats } from '../stats/boxplot'
import { ecdf, ecdfAt } from '../stats/ecdf'
import { buildTree, type TreeNode } from '../stats/hierarchy'
import { binValues, equalEdges } from '../stats/histogram'
import { kde, kdeGrid, silvermanBandwidth } from '../stats/kde'
import { collectFlows, sankeyLayout } from '../stats/sankey'
import { stackRows } from '../stats/stack'

// ─── stages ──────────────────────────────────────────────────────────────────

export type HeroGroup = 'dist' | 'compare' | 'time' | 'hierarchy' | 'flow'

export const heroStages = [
  { key: 'scatter', label: '산점도', viz: 'scatter', group: 'dist' },
  { key: 'histogram', label: '히스토그램', viz: 'histogram', group: 'dist' },
  { key: 'kde', label: 'KDE 플롯', viz: 'kde', group: 'dist' },
  { key: 'ecdf', label: 'ECDF 플롯', viz: 'ecdf', group: 'dist' },
  { key: 'box', label: '박스 플롯', viz: 'box', group: 'dist' },
  { key: 'violin', label: '바이올린 플롯', viz: 'violin', group: 'dist' },
  { key: 'bar', label: '막대그래프', viz: 'bar', group: 'compare' },
  { key: 'grouped', label: '그룹 막대그래프', viz: 'grouped-bar', group: 'compare' },
  { key: 'stacked', label: '누적 막대그래프', viz: 'stacked-bar', group: 'compare' },
  { key: 'stacked100', label: '100% 누적 막대그래프', viz: 'stacked-bar-100', group: 'compare' },
  { key: 'line', label: '선그래프', viz: 'line', group: 'time' },
  { key: 'area', label: '영역 그래프', viz: 'area', group: 'time' },
  { key: 'stream', label: '스트림그래프', viz: 'streamgraph', group: 'time' },
  { key: 'treemap', label: '트리맵', viz: 'treemap', group: 'hierarchy' },
  { key: 'sunburst', label: '선버스트 차트', viz: 'sunburst', group: 'hierarchy' },
  { key: 'sankey', label: '생키 다이어그램', viz: 'sankey', group: 'flow' },
] as const
export type HeroStage = (typeof heroStages)[number]['key']

// ─── marks: the drawing primitives the engine animates ───────────────────────

const CLEAR = 'rgba(0,0,0,0)'

interface Base { k: string; o: number; from?: Partial<Mark> }
export interface RectMark extends Base { t: 'rect'; x: number; y: number; w: number; h: number; r: number; fill: string; stroke: string; sw: number }
export interface CircleMark extends Base { t: 'circle'; x: number; y: number; r: number; fill: string }
export interface LineMark extends Base { t: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; sw: number }
/** Closed (fill) or open (stroke) polygon; `pts` must keep its length between frames to morph. */
export interface PolyMark extends Base { t: 'poly'; pts: [number, number][]; closed: boolean; fill: string; stroke: string; fo: number; so: number; sw: number }
/** Area between two curves over x: pts are [x, y0, y1]. */
export interface BandMark extends Base { t: 'band'; pts: [number, number, number][]; fill: string; stroke: string; fo: number; so: number; sw: number }
export interface ArcMark extends Base { t: 'arc'; cx: number; cy: number; a0: number; a1: number; r0: number; r1: number; fill: string; stroke: string }
export interface LinkMark extends Base { t: 'link'; x0: number; y0: number; x1: number; y1: number; w: number; stroke: string }
export interface TextMark extends Base { t: 'text'; x: number; y: number; text: string; anchor: 'start' | 'middle' | 'end'; fill: string }
export type Mark = RectMark | CircleMark | LineMark | PolyMark | BandMark | ArcMark | LinkMark | TextMark

const rect = (k: string, x: number, y: number, w: number, h: number, fill: string, o = 1, extra: Partial<RectMark> = {}): RectMark => ({ t: 'rect', k, x, y, w, h, r: 2, fill, stroke: CLEAR, sw: 0, o, ...extra })
const circle = (k: string, x: number, y: number, r: number, fill: string, o: number): CircleMark => ({ t: 'circle', k, x, y, r, fill, o, from: { r: 0, o: 0 } })
const seg = (k: string, x1: number, y1: number, x2: number, y2: number, stroke: string, sw: number, o = 1): LineMark => ({ t: 'line', k, x1, y1, x2, y2, stroke, sw, o })
const text = (k: string, x: number, y: number, s: string, anchor: TextMark['anchor'] = 'middle', fill = '#8a9490'): TextMark => ({ t: 'text', k, x, y, text: s, anchor, fill, o: 1 })

const TEAL = colorAt(0)
const ORANGE = colorAt(1)
const GRID = '#cfd6d3'
const PAD = { l: 18, r: 18, t: 18, b: 34 }

// ─── data ────────────────────────────────────────────────────────────────────

export const HERO_N = 140

/** One synthetic study-time (x) vs. score (y) sample; the cycle number shifts the mixture so every loop differs. */
export function heroSample(cycle: number) {
  const rng = createRng(1000 + cycle * 7919)
  const shift = Math.sin(cycle * 1.3) * 5
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < HERO_N; i++) {
    const x = rng() < 0.58 ? rng.normal(38 + shift, 7) : rng.normal(66 - shift / 2, 8)
    xs.push(Math.max(5, Math.min(95, x)))
    ys.push(Math.max(5, Math.min(98, 18 + 0.8 * x + rng.normal(0, 8))))
  }
  return { xs, ys }
}

export interface HeroData {
  dist: { xs: number[]; ys: number[] }
  compare: { cats: string[]; series: string[]; value: (c: string, s: string) => number }
  time: { months: number[]; keys: string[]; value: (k: string, m: number) => number }
  tree: TreeNode
  flows: ReturnType<typeof collectFlows>['edges']
}

/** Every group draws from the app's own dataset generators; the cycle changes the seeded ones. */
export function heroData(cycle: number): HeroData {
  const seed = 7 + cycle * 13
  const sales = generateDataset('categorical', seed)
  const ci = [0, 1, 2].map((c) => columnIndex(sales, ['제품', '분기', '판매량'][c]))
  const cmp = new Map<string, number>()
  const cats: string[] = []
  const series: string[] = []
  for (const r of sales.rows) {
    const c = toLabel(r[ci[0]])
    const s = toLabel(r[ci[1]])
    if (!cats.includes(c)) cats.push(c)
    if (!series.includes(s)) series.push(s)
    cmp.set(`${c}|${s}`, toNumber(r[ci[2]]) ?? 0)
  }
  const ts = generateDataset('timeseries', seed, 24)
  const ti = [0, 1, 2].map((c) => columnIndex(ts, ['월', '채널', '방문자'][c]))
  const tv = new Map<string, number>()
  const keys: string[] = []
  const months: number[] = []
  for (const r of ts.rows) {
    const m = toNumber(r[ti[0]])!
    const k = toLabel(r[ti[1]])
    if (!keys.includes(k)) keys.push(k)
    if (!months.includes(m)) months.push(m)
    tv.set(`${k}|${m}`, toNumber(r[ti[2]]) ?? 0)
  }
  const budget = generateDataset('budget')
  const energy = generateDataset('energy')
  const [si, di, vi] = [0, 1, 2].map((c) => columnIndex(energy, ['출발', '도착', '양'][c]))
  const flows = collectFlows(energy.rows.map((r, row) => ({ source: toLabel(r[si]), target: toLabel(r[di]), value: toNumber(r[vi]), row }))).edges
  return {
    dist: heroSample(cycle),
    compare: { cats, series, value: (c, s) => cmp.get(`${c}|${s}`) ?? 0 },
    time: { months, keys, value: (k, m) => tv.get(`${k}|${m}`) ?? 0 },
    tree: buildTree(budget, ['부문', '부서', '항목'], '예산').tree,
    flows,
  }
}

// ─── distribution group: the same N observations in six representations ────────

const jitter = (i: number) => { const j = Math.sin(i * 12.9898) * 43758.5453; return j - Math.floor(j) }

export function distFrame(stage: HeroStage, data: HeroData['dist'], w: number, h: number): Mark[] {
  const { xs, ys } = data
  const x = d3.scaleLinear().domain([0, 100]).range([PAD.l, w - PAD.r])
  const base = h - PAD.b
  const top = PAD.t
  const span = base - top
  const mid = top + span * 0.5
  const edges = equalEdges(0, 100 / 14, 14)
  const { bins } = binValues(xs, edges)
  const maxCount = d3.max(bins, (b) => b.count) ?? 1
  const dot = Math.min((x(edges[1]) - x(edges[0])) * 0.9, span / maxCount)
  const grid = kdeGrid(0, 100, 0, 40)
  const bw = silvermanBandwidth(xs)
  const dens = kde(xs, bw, 'gaussian', grid)
  const dMax = d3.max(dens) ?? 1
  const steps = ecdf(xs)
  const yF = (p: number) => base - p * span * 0.94
  const box = boxStats(xs)!

  // circles
  const stack = bins.map(() => 0)
  const order = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0])
  const stackPos: [number, number][] = new Array(xs.length)
  for (const [v, i] of order) {
    const b = Math.min(bins.length - 1, Math.max(0, Math.floor(v / (100 / 14))))
    const k = stack[b]++
    stackPos[i] = [(x(edges[b]) + x(edges[b + 1])) / 2, base - (k + 0.5) * dot]
  }
  const halfW = (v: number) => (kde(xs, bw, 'gaussian', [v])[0] / dMax) * span * 0.3
  const marks: Mark[] = []
  const accent = TEAL
  xs.forEach((v, i) => {
    let m: [number, number, number, string, number]
    if (stage === 'scatter') m = [x(v), base - (ys[i] / 100) * span, 4, accent, 0.78]
    else if (stage === 'histogram') m = [stackPos[i][0], stackPos[i][1], Math.max(1.5, dot / 2 - 0.6), accent, 0.78]
    else if (stage === 'kde') m = [x(v), base + 9, 2.2, accent, 0.55]
    else if (stage === 'ecdf') m = [x(v), yF(ecdfAt(steps, v)), 2.6, accent, 0.7]
    else if (stage === 'box') m = [x(v), mid + (jitter(i) - 0.5) * span * 0.36, 3, ORANGE, 0.55]
    else m = [x(v), mid + (jitter(i) - 0.5) * 2 * halfW(v) * 0.8, 2.4, accent, 0.6]
    marks.push(circle(`p${i}`, m[0], m[1], m[2], m[3], m[4]))
  })

  // histogram bars
  bins.forEach((b, j) => {
    const on = stage === 'histogram'
    const bh = on ? b.count * dot : 0
    marks.push(rect(`bar${j}`, x(b.x0) + 1, base - bh, Math.max(0, x(b.x1) - x(b.x0) - 2), bh, TEAL, on ? 0.2 : 0, { stroke: TEAL, sw: on ? 1 : 0 }))
  })

  // one polygon morphs between density area and violin: top edge left→right, bottom edge right→left
  const polyPts = (topY: (i: number) => number, bottomY: (i: number) => number): [number, number][] => [
    ...grid.map((g, i) => [x(g), topY(i)] as [number, number]),
    ...grid.map((g, i) => [x(g), bottomY(i)] as [number, number]).reverse(),
  ]
  const dens01 = dens.map((d) => d / dMax)
  let densPts: [number, number][]
  if (stage === 'kde') densPts = polyPts((i) => base - dens01[i] * span * 0.92, () => base)
  else if (stage === 'violin') densPts = polyPts((i) => mid - dens01[i] * span * 0.3, (i) => mid + dens01[i] * span * 0.3)
  else densPts = polyPts(() => base, () => base)
  const densOn = stage === 'kde' || stage === 'violin'
  marks.push({ t: 'poly', k: 'dens', pts: densPts, closed: true, fill: TEAL, stroke: TEAL, fo: densOn ? 0.18 : 0, so: densOn ? 1 : 0, sw: 2.2, o: 1 })

  // ECDF staircase: same point count every frame, flat on the axis when inactive
  const ep: [number, number][] = [[x(0), yF(0)]]
  let prev = 0
  for (const s of steps) { ep.push([x(s.x), yF(prev)], [x(s.x), yF(s.p)]); prev = s.p }
  ep.push([x(100), yF(1)])
  const eOn = stage === 'ecdf'
  marks.push({ t: 'poly', k: 'ecdf', pts: eOn ? ep : ep.map(([px]) => [px, base] as [number, number]), closed: false, fill: CLEAR, stroke: TEAL, fo: 0, so: eOn ? 1 : 0, sw: 1.8, o: 1 })

  // box plot
  const bOn = stage === 'box'
  const bx = (v: number) => (bOn ? x(v) : x(box.median))
  const bh = span * 0.42
  const bo = bOn ? 1 : 0
  const bs = '#c4602a'
  marks.push(
    seg('bx-wl', bx(box.whiskerLow), mid, bx(box.q1), mid, bs, 1.8, bo),
    seg('bx-wr', bx(box.q3), mid, bx(box.whiskerHigh), mid, bs, 1.8, bo),
    seg('bx-cl', bx(box.whiskerLow), mid - bh / 4, bx(box.whiskerLow), mid + bh / 4, bs, 1.8, bo),
    seg('bx-cr', bx(box.whiskerHigh), mid - bh / 4, bx(box.whiskerHigh), mid + bh / 4, bs, 1.8, bo),
    rect('bx-box', bx(box.q1), mid - bh / 2, Math.max(1, bx(box.q3) - bx(box.q1)), bh, ORANGE, bOn ? 0.14 : 0, { r: 3, stroke: bs, sw: 1.8 }),
    seg('bx-med', bx(box.median), mid - bh / 2, bx(box.median), mid + bh / 2, bs, 3, bo),
  )
  return [...marks, ...axisX('d', x, base, [0, 20, 40, 60, 80, 100].map((v) => [v, String(v)] as [number, string]), w)]
}

function axisX(prefix: string, x: (v: number) => number, base: number, ticks: [number, string][], w: number): Mark[] {
  return [
    seg('axis', PAD.l, base + 0.5, w - PAD.r, base + 0.5, GRID, 1),
    ...ticks.map(([v, label], i) => text(`${prefix}:tick${i}`, x(v), base + 22, label)),
  ]
}

// ─── comparison group: one category × series table, four bar layouts ──────────

export function compareFrame(stage: HeroStage, data: HeroData['compare'], w: number, h: number): Mark[] {
  const { cats, series, value } = data
  const base = h - PAD.b
  const top = PAD.t
  const x0 = d3.scaleBand().domain(cats).range([PAD.l, w - PAD.r]).paddingInner(0.22).paddingOuter(0.1)
  const x1 = d3.scaleBand().domain(series).range([0, x0.bandwidth()]).padding(0.1)
  const total = (c: string) => d3.sum(series, (s) => value(c, s))
  const maxTotal = d3.max(cats, total) ?? 1
  const maxVal = d3.max(cats, (c) => d3.max(series, (s) => value(c, s))) ?? 1
  const marks: Mark[] = []
  cats.forEach((c) => {
    let acc = 0
    series.forEach((s, si) => {
      const v = value(c, s)
      const bx = x0(c) ?? 0
      let x = bx
      let wd = x0.bandwidth()
      let y0: number
      let y1: number
      let fill = colorAt(si)
      if (stage === 'bar') {
        const y = d3.scaleLinear().domain([0, maxTotal * 1.04]).range([base, top])
        fill = colorAt(0)
        y0 = si === 0 ? base : y(total(c)); y1 = y(total(c))
      } else if (stage === 'grouped') {
        const y = d3.scaleLinear().domain([0, maxVal * 1.08]).range([base, top])
        x = bx + (x1(s) ?? 0); wd = x1.bandwidth(); y0 = base; y1 = y(v)
      } else if (stage === 'stacked') {
        const y = d3.scaleLinear().domain([0, maxTotal * 1.04]).range([base, top])
        y0 = y(acc); y1 = y(acc + v)
      } else {
        const y = d3.scaleLinear().domain([0, 1]).range([base, top])
        const t = total(c)
        y0 = y(acc / t); y1 = y((acc + v) / t)
      }
      acc += v
      marks.push(rect(`cmp:${c}|${s}`, x, Math.min(y0, y1), wd, Math.abs(y0 - y1), fill, 1, { r: 1.5, stroke: '#fff', sw: 0.8, from: { o: 0, h: 0, y: base } }))
    })
  })
  const centers = (c: string) => (x0(c) ?? 0) + x0.bandwidth() / 2
  return [...marks, seg('axis', PAD.l, base + 0.5, w - PAD.r, base + 0.5, GRID, 1), ...cats.map((c, i) => text(`c:lab${i}`, centers(c), base + 22, c))]
}

// ─── time-series group: three series as lines, areas and a wiggle stream ───────

export function timeFrame(stage: HeroStage, data: HeroData['time'], w: number, h: number): Mark[] {
  const { months, keys, value } = data
  const base = h - PAD.b
  const top = PAD.t
  const x = d3.scaleLinear().domain([d3.min(months)!, d3.max(months)!]).range([PAD.l + 4, w - PAD.r - 4])
  const max = d3.max(keys, (k) => d3.max(months, (m) => value(k, m))) ?? 1
  const yv = d3.scaleLinear().domain([0, max * 1.08]).range([base, top])
  const marks: Mark[] = []
  if (stage === 'stream') {
    const rows = months.map((m) => Object.fromEntries(keys.map((k) => [k, value(k, m)])))
    const layers = stackRows(keys, rows, 'wiggle', 'insideOut')
    const lo = d3.min(layers, (l) => d3.min(l, (d) => d[0])) ?? 0
    const hi = d3.max(layers, (l) => d3.max(l, (d) => d[1])) ?? 1
    const ys = d3.scaleLinear().domain([lo, hi]).range([base - 6, top + 6])
    keys.forEach((k, ki) => {
      const layer = layers.find((l) => l.key === k)!
      marks.push({ t: 'band', k: `ts:${k}`, pts: months.map((m, i) => [x(m), ys(layer[i][0]), ys(layer[i][1])] as [number, number, number]), fill: colorAt(ki), stroke: '#fff', fo: 0.88, so: 0.9, sw: 0.8, o: 1 })
    })
  } else {
    keys.forEach((k, ki) => {
      const line = stage === 'line'
      marks.push({ t: 'band', k: `ts:${k}`, pts: months.map((m) => [x(m), line ? yv(value(k, m)) : base, yv(value(k, m))] as [number, number, number]), fill: colorAt(ki), stroke: colorAt(ki), fo: line ? 0 : 0.3, so: 1, sw: line ? 2.6 : 2, o: 1 })
    })
  }
  const ticks = [months[0], months[Math.floor(months.length / 3)], months[Math.floor((months.length * 2) / 3)], months[months.length - 1]]
  return [...marks, ...axisX('t', x, base, ticks.map((m) => [m, `${m}월`] as [number, string]), w)]
}

// ─── hierarchy group: the same budget tree as treemap rectangles and sunburst rings

function branchFill(node: d3.HierarchyNode<TreeNode>, tops: string[]) {
  const top = node.ancestors().reverse()[1]
  return d3.interpolateRgb(colorAt(Math.max(0, tops.indexOf(top?.data.name ?? ''))), '#ffffff')(Math.min(0.55, (node.depth - 1) * 0.16))
}

export function hierarchyFrame(stage: HeroStage, tree: TreeNode, w: number, h: number): Mark[] {
  const tops = (tree.children ?? []).map((c) => c.name)
  const root = d3.hierarchy<TreeNode>(tree).sum((d) => d.value ?? 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
  const path = (n: d3.HierarchyNode<TreeNode>) => n.ancestors().reverse().slice(1).map((a) => a.data.name).join('/')
  if (stage === 'treemap') {
    d3.treemap<TreeNode>().size([w - 24, h - 24]).paddingInner(2).paddingOuter(1).round(true)(root)
    return root.leaves().map((n) => {
      const r = n as d3.HierarchyRectangularNode<TreeNode>
      return rect(`tm:${path(n)}`, r.x0 + 12, r.y0 + 12, r.x1 - r.x0, r.y1 - r.y0, branchFill(n, tops), 1, { r: 2, from: { o: 0 } })
    })
  }
  d3.partition<TreeNode>().size([Math.PI * 2, root.height + 1])(root)
  const R = Math.min(w, h) / 2 - 12
  const hole = R * 0.16
  const ring = (R - hole) / root.height
  return root.descendants().filter((n) => n.depth > 0).map((n) => {
    const r = n as d3.HierarchyRectangularNode<TreeNode>
    const m: ArcMark = { t: 'arc', k: `sb:${path(n)}`, cx: w / 2, cy: h / 2, a0: r.x0, a1: r.x1, r0: hole + (n.depth - 1) * ring, r1: hole + n.depth * ring - 1, fill: branchFill(n, tops), stroke: '#fff', o: 1, from: { a1: r.x0, o: 0 } }
    return m
  })
}

// ─── flow group ──────────────────────────────────────────────────────────────

export function flowFrame(edges: HeroData['flows'], w: number, h: number): Mark[] {
  const labelRoom = 84
  const { graph } = sankeyLayout(edges, { width: Math.max(40, w - 24 - labelRoom), height: h - 28, nodeWidth: 12, nodePadding: 10, align: 'justify' })
  const color = d3.scaleOrdinal<string, string>(d3.range(graph.nodes.length).map(colorAt)).domain(graph.nodes.map((n) => n.name))
  const ox = 12
  const oy = 14
  const marks: Mark[] = []
  graph.links.forEach((l, i) => {
    const s = l.source as any
    const t = l.target as any
    marks.push({ t: 'link', k: `sk:l${i}`, x0: ox + s.x1, y0: oy + l.y0!, x1: ox + t.x0, y1: oy + l.y1!, w: Math.max(1, l.width ?? 1), stroke: d3.color(color(s.name))!.copy({ opacity: 0.42 }).formatRgb(), o: 1, from: { w: 0, o: 0 } })
  })
  graph.nodes.forEach((n) => {
    marks.push(rect(`sk:n:${n.name}`, ox + n.x0!, oy + n.y0!, n.x1! - n.x0!, Math.max(1, n.y1! - n.y0!), color(n.name), 1, { r: 1, from: { o: 0 } }))
    const left = n.x0! < (w - labelRoom) / 2
    marks.push(text(`sk:t:${n.name}`, ox + (left ? n.x1! + 5 : n.x0! - 5), oy + (n.y0! + n.y1!) / 2 + 4, n.name, left ? 'start' : 'end', '#4b5563'))
  })
  return marks
}

/** All marks of one stage. */
export function buildFrame(stage: HeroStage, data: HeroData, w: number, h: number): Mark[] {
  const group = heroStages.find((s) => s.key === stage)!.group
  switch (group) {
    case 'dist': return distFrame(stage, data.dist, w, h)
    case 'compare': return compareFrame(stage, data.compare, w, h)
    case 'time': return timeFrame(stage, data.time, w, h)
    case 'hierarchy': return hierarchyFrame(stage, data.tree, w, h)
    default: return flowFrame(data.flows, w, h)
  }
}
