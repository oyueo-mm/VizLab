import * as d3 from 'd3'
import { useEffect, useMemo, useRef } from 'react'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, type DataTable } from '../../data/table'
import { fmt } from '../../lib/format'
import { buildCube, continuousParallel, continuousScatterplot, nodeSlice, splatStripe, timeSlice, type DynEdge, type Field2 } from '../../stats/dyn11'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'
import { viewDefaults, Scene3D } from './kit3d'
import { drawQuads, type Projector, type Quad } from './scene3d'
import { ViewControls } from './geo3dCharts'
import type { ViewParams } from './geo3dCharts'

// ───────────────────────────── shared readers ─────────────────────────────

function readEdges(table: DataTable, mapping: Mapping) {
  const ti = columnIndex(table, roleColumn(mapping, 'time')), ai = columnIndex(table, roleColumn(mapping, 'a')), bi = columnIndex(table, roleColumn(mapping, 'b')), wi = columnIndex(table, roleColumn(mapping, 'weight'))
  if (ti < 0 || ai < 0 || bi < 0) return null
  const edges: (DynEdge & { row: number })[] = []
  table.rows.forEach((r, row) => { const t = toNumber(r[ti]), w = wi >= 0 ? toNumber(r[wi]) : 1; if (t != null && w != null && w > 0) edges.push({ t, a: toLabel(r[ai]), b: toLabel(r[bi]), w, row }) })
  return edges.length ? edges : null
}

function readField(table: DataTable, mapping: Mapping) {
  const xi = columnIndex(table, roleColumn(mapping, 'x')), yi = columnIndex(table, roleColumn(mapping, 'y'))
  const names = roleColumns(mapping, 'attrs')
  if (xi < 0 || yi < 0 || names.length < 2) return null
  const xs = [...new Set(table.rows.map((r) => toNumber(r[xi])).filter((v): v is number => v != null))].sort((a, b) => a - b)
  const ys = [...new Set(table.rows.map((r) => toNumber(r[yi])).filter((v): v is number => v != null))].sort((a, b) => a - b)
  if (xs.length < 3 || ys.length < 3 || xs.length * ys.length > 4000) return null
  const xm = new Map(xs.map((v, i) => [v, i])), ym = new Map(ys.map((v, i) => [v, i]))
  const cols = names.map((n) => columnIndex(table, n))
  const attr = names.map(() => new Float64Array(xs.length * ys.length))
  let filled = 0
  for (const r of table.rows) {
    const x = toNumber(r[xi]), y = toNumber(r[yi])
    if (x == null || y == null) continue
    const k = ym.get(y)! * xs.length + xm.get(x)!
    let ok = true
    cols.forEach((c, a) => { const v = toNumber(r[c]); if (v == null) ok = false; else attr[a][k] = v })
    if (ok) filled++
  }
  if (filled < xs.length * ys.length) return null
  const f: Field2 = { nx: xs.length, ny: ys.length, attr }
  return { f, names }
}

const ramp = (t: number) => d3.interpolateRgb('#ffffff', '#0b3c5d')(Math.min(1, Math.max(0, t) ** 0.6))

/** Paints a density grid into a canvas; row 0 is drawn at the bottom when `flipY`. */
function paint(cv: HTMLCanvasElement | null, density: Float32Array, cols: number, rows: number, scale: 'linear' | 'log' | 'sqrt', flipY = true) {
  if (!cv) return
  cv.width = cols; cv.height = rows
  const ctx = cv.getContext('2d')
  if (!ctx) return
  const img = ctx.createImageData(cols, rows)
  // the scale is capped at the 99.8th percentile so that a few near-degenerate cells (huge densities) do not wash out the rest
  const sorted = Float32Array.from(density).sort()
  const mx = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.998))] || sorted[sorted.length - 1] || 0
  const f0 = (v: number) => (mx <= 0 ? 0 : scale === 'log' ? Math.log1p((Math.min(v, mx) / mx) * 200) / Math.log1p(200) : scale === 'sqrt' ? Math.sqrt(Math.min(v, mx) / mx) : Math.min(v, mx) / mx)
  const f = f0
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const col = d3.color(ramp(f(density[r * cols + c])))!.rgb()
    const o = ((flipY ? rows - 1 - r : r) * cols + c) * 4
    img.data[o] = col.r; img.data[o + 1] = col.g; img.data[o + 2] = col.b; img.data[o + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
}

// ───────────────────────────── Matrix Cube ─────────────────────────────

export interface CubeParams extends ViewParams { view: 'cube' | 'time' | 'node'; t: number; node: number; minW: number }

function CubeChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<CubeParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const edges = useMemo(() => readEdges(table, mapping), [table, mapping])
  const cube = useMemo(() => (edges ? buildCube(edges) : null), [edges])
  const rowsOf = useMemo(() => {
    const m = new Map<string, number[]>()
    if (cube && edges) { const ni = new Map(cube.nodes.map((v, i) => [v, i])); for (const e of edges) { const i = ni.get(e.a)!, j = ni.get(e.b)!; const t = cube.times.indexOf(e.t); for (const k of [`${t}|${i}|${j}`, `${t}|${j}|${i}`]) { if (!m.has(k)) m.set(k, []); m.get(k)!.push(e.row) } } }
    return m
  }, [cube, edges])
  const linkedSet = useMemo(() => new Set(linked?.rows ?? []), [linked?.rows])
  const wmax = useMemo(() => (cube ? Math.max(...cube.w, 1e-9) : 1), [cube])
  if (!cube || cube.n < 3 || cube.times.length < 2) return <ChartMessage>시점, 노드 A, 노드 B(범주형)와 가중치 열을 고르세요(시점이 2개 이상).</ChartMessage>
  const n = cube.n, T = cube.times.length
  const t = Math.min(T - 1, params.t), node = Math.min(n - 1, params.node)
  const color = (w: number) => d3.interpolateYlOrRd(0.15 + 0.85 * Math.min(1, w / wmax))

  if (params.view === 'cube') {
    const cell = 1 / n
    const coord = (i: number, j: number, k: number): [number, number, number] => [(j / n) * 2 - 1, 1 - (i / n) * 2, (k / Math.max(1, T - 1)) * 2 - 1]
    const draw = (ctx: CanvasRenderingContext2D, proj: Projector) => {
      const quads: Quad[] = []
      for (let k = 0; k < T; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const w = cube.w[k * n * n + i * n + j]
        if (w <= 0 || w < params.minW) continue
        const [x, y, z] = coord(i, j, k)
        const hs = cell
        const c = [proj([x, y, z]), proj([x + 2 * hs, y, z]), proj([x + 2 * hs, y - 2 * hs, z]), proj([x, y - 2 * hs, z])]
        const sel = k === t
        quads.push({ pts: c.map((p) => [p.x, p.y] as [number, number]), depth: (c[0].depth + c[2].depth) / 2, fill: sel ? '#d4452f' : color(w) })
      }
      quads.sort((a, b) => b.depth - a.depth)
      drawQuads(ctx, quads, 0)
    }
    const count = cube.w.reduce((s, w) => s + (w > 0 && w >= params.minW ? 1 : 0), 0)
    return (
      <Scene3D width={width} height={height} compact={compact} params={params} setParams={setParams} label={`행렬 큐브: ${n}×${n}×${T}`} draw={draw} fit={0.36} drawKey={`${params.minW}|${t}|${cube.w.length}|${wmax}`}
        overlay={(proj) => {
          const z = (t / Math.max(1, T - 1)) * 2 - 1
          const q = [proj([-1, 1, z]), proj([1, 1, z]), proj([1, -1, z]), proj([-1, -1, z])]
          return <g pointerEvents="none"><path d={'M' + q.map((p) => `${p.x},${p.y}`).join('L') + 'Z'} fill="none" stroke="#d4452f" strokeWidth={1.6} data-testid="cube-slice" /></g>
        }}
        readout={[{ label: '노드', value: n }, { label: '시점', value: T }, { label: '0이 아닌 칸', value: count }, { label: '선택 시점', value: `${cube.times[t]}` }]}
        note="붉은 면 = 선택한 시점의 인접 행렬, 끌어서 회전" />
    )
  }

  // 2-D cuts
  const mat = params.view === 'time' ? timeSlice(cube, t) : nodeSlice(cube, node)
  const rowsN = params.view === 'time' ? n : n
  const colsN = params.view === 'time' ? n : T
  const left = compact ? 4 : 70, top = compact ? 4 : 52
  const cw = Math.min((width - left - 10) / colsN, (height - top - 10) / rowsN)
  const rowLabels = cube.nodes, colLabels = params.view === 'time' ? cube.nodes : cube.times.map(String)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={params.view === 'time' ? `시점 ${cube.times[t]}의 인접 행렬` : `${cube.nodes[node]}의 시간별 연결`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <rect x={left} y={top} width={cw * colsN} height={cw * rowsN} fill="#fafcfc" stroke="#dbe3e3" />
        {!compact && cw > 9 && colLabels.map((c, j) => <text key={j} x={left + j * cw + cw / 2} y={top - 6} fontSize={Math.min(9, cw)} fill="#6b7280" transform={`rotate(-60 ${left + j * cw + cw / 2} ${top - 6})`}>{c.replace('노드 ', '')}</text>)}
        {!compact && cw > 9 && rowLabels.map((r, i) => <text key={i} x={left - 5} y={top + i * cw + cw / 2} dy="0.34em" textAnchor="end" fontSize={Math.min(9, cw)} fill="#6b7280">{r}</text>)}
        {Array.from({ length: rowsN }, (_, i) => Array.from({ length: colsN }, (_, j) => {
          const w = mat[i * colsN + j]
          if (w <= 0) return null
          const key = params.view === 'time' ? `${t}|${i}|${j}` : `${j}|${node}|${i}`
          const rows = rowsOf.get(key) ?? []
          const on = rows.some((r) => linkedSet.has(r))
          return <rect key={`${i}-${j}`} x={left + j * cw} y={top + i * cw} width={cw - 0.5} height={cw - 0.5} fill={color(w)} stroke={on ? '#111827' : 'none'} strokeWidth={1.6} data-testid="cube-cell" data-w={w}
            onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); linked?.set(rows); show(lp.x, lp.y, <><b>{params.view === 'time' ? `${rowLabels[i]} – ${colLabels[j]}` : `${cube.nodes[node]} – ${rowLabels[i]}`}</b><br />{params.view === 'time' ? `시점 ${cube.times[t]}` : `시점 ${colLabels[j]}`} · 가중치 {fmt(w, 3)}<br />원본 간선 {rows.length}행</>) }} onPointerLeave={() => { hide(); linked?.set(null) }} />
        }))}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function CubeControls({ params, setParams, table, mapping }: ControlsProps<CubeParams>) {
  const edges = useMemo(() => readEdges(table, mapping), [table, mapping])
  const cube = useMemo(() => (edges ? buildCube(edges) : null), [edges])
  return (
    <>
      <ControlGroup title="행렬 큐브">
        <Segmented label="보기" value={params.view} onChange={(view) => setParams({ view })} testId="ctl-cview" options={[{ value: 'cube', label: '3D 큐브' }, { value: 'time', label: '시간 단면' }, { value: 'node', label: '노드 단면' }]} />
        {cube && <Slider label="시점 번호" value={Math.min(params.t, cube.times.length - 1)} min={0} max={cube.times.length - 1} onChange={(t) => setParams({ t })} format={(v) => `${v + 1}/${cube.times.length}`} testId="ctl-ct" />}
        {cube && params.view === 'node' && <Slider label="노드" value={Math.min(params.node, cube.n - 1)} min={0} max={cube.n - 1} onChange={(node) => setParams({ node })} format={(v) => cube.nodes[v]} testId="ctl-cnode" />}
        <Slider label="가중치 하한(약한 연결 숨기기)" value={params.minW} min={0} max={4} step={0.5} onChange={(minW) => setParams({ minW })} format={(v) => v.toFixed(1)} testId="ctl-cminw" />
        <Hint>동적 네트워크를 시점마다의 인접 행렬로 만들어 시간 축으로 쌓은 3차원 상자(행 × 열 × 시간)입니다. 3D 큐브는 끌어서 회전하며 전체 구조를 보고, 붉은 면이 선택한 시점입니다. ‘시간 단면’은 큐브를 시간 축에 수직으로 잘라 그 시점의 인접 행렬을, ‘노드 단면’은 노드 축에 수직으로 잘라 한 노드가 시간에 걸쳐 누구와 연결되었는지(행 = 상대 노드, 열 = 시점)를 보입니다. 2D 칸에 올리면 원본 간선 행이 연결(linked)로 강조됩니다. 원 논문의 셀 집계·정렬 등 상세 인터랙션은 구현하지 않았습니다.</Hint>
      </ControlGroup>
      {params.view === 'cube' && <ViewControls params={params} setParams={setParams} />}
    </>
  )
}

export const cubeModule: VizModule<CubeParams> = {
  roles: [
    { key: 'time', label: '시점', type: 'number', required: true, prefer: '시점|time' },
    { key: 'a', label: '노드 A', type: 'category', required: true, prefer: '노드 A|source|출발' },
    { key: 'b', label: '노드 B', type: 'category', required: true, prefer: '노드 B|target|도착' },
    { key: 'weight', label: '가중치', type: 'number', auto: true, prefer: '가중치|weight' },
  ],
  datasets: ['dynamic-network'],
  defaultParams: { ...viewDefaults({ yaw: -32, pitch: 24, zoom: 1 }), view: 'cube', t: 5, node: 0, minW: 0 },
  Chart: CubeChart,
  Controls: CubeControls,
  hint: '3D 큐브를 돌려 보고 ‘시간 단면’·‘노드 단면’으로 잘라 보세요 · 2D 칸에 올리면 원본 간선이 강조됩니다',
}

// ───────────────────────────── Parallel Edge Splatting ─────────────────────────────

export interface PesParams { order: 'name' | 'degree'; both: boolean; scale: 'linear' | 'log' | 'sqrt'; from: number; to: number }

function PesChart({ table, mapping, params, width, height, compact }: ChartProps<PesParams>) {
  const cvRef = useRef<HTMLCanvasElement>(null)
  const edges = useMemo(() => readEdges(table, mapping), [table, mapping])
  const model = useMemo(() => {
    if (!edges) return null
    const times = [...new Set(edges.map((e) => e.t))].sort((a, b) => a - b)
    const deg = new Map<string, number>()
    for (const e of edges) { deg.set(e.a, (deg.get(e.a) ?? 0) + e.w); deg.set(e.b, (deg.get(e.b) ?? 0) + e.w) }
    const nodes = [...deg.keys()].sort((a, b) => (params.order === 'degree' ? (deg.get(b)! - deg.get(a)!) || a.localeCompare(b) : a.localeCompare(b)))
    return { times, nodes, idx: new Map(nodes.map((v, i) => [v, i])) }
  }, [edges, params.order])
  const range = model ? [Math.min(params.from, model.times.length - 1), Math.min(Math.max(params.to, params.from), model.times.length - 1)] : [0, 0]
  const stripes = useMemo(() => {
    if (!edges || !model) return null
    const rows = Math.max(model.nodes.length * 3, 60)
    const sel = model.times.slice(range[0], range[1] + 1)
    const stripeCols = Math.max(12, Math.floor((compact ? 220 : 720) / Math.max(1, sel.length)))
    const dens = sel.map((tt) => {
      const es = edges.filter((e) => e.t === tt).flatMap((e) => { const i = model.idx.get(e.a)!, j = model.idx.get(e.b)!; return params.both ? [{ i, j, w: e.w }, { i: j, j: i, w: e.w }] : [{ i, j, w: e.w }] })
      return splatStripe(es, model.nodes.length, stripeCols, rows)
    })
    return { dens, rows, stripeCols, sel }
  }, [edges, model, range[0], range[1], params.both, compact]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!stripes) return
    const cols = stripes.stripeCols * stripes.sel.length + (stripes.sel.length - 1) * 4
    const merged = new Float32Array(cols * stripes.rows)
    stripes.dens.forEach((d, s) => { for (let r = 0; r < stripes.rows; r++) for (let c = 0; c < stripes.stripeCols; c++) merged[r * cols + s * (stripes.stripeCols + 4) + c] = d[r * stripes.stripeCols + c] })
    paint(cvRef.current, merged, cols, stripes.rows, params.scale, false)
  }, [stripes, params.scale])
  if (!edges || !model || model.times.length < 2) return <ChartMessage>시점, 노드 A(출발), 노드 B(도착) 열을 고르세요(시점이 2개 이상).</ChartMessage>
  const pad = compact ? 4 : 30
  return (
    <div className="chart-root">
      <canvas ref={cvRef} data-testid="pes-canvas" data-stripes={stripes?.sel.length} data-edges={edges.filter((e) => model.times.slice(range[0], range[1] + 1).includes(e.t)).length} style={{ position: 'absolute', left: pad, top: pad, width: width - 2 * pad - (compact ? 0 : 40), height: height - 2 * pad - (compact ? 0 : 14), imageRendering: 'auto' }} role="img" aria-label={`평행 간선 스플래팅: 시점 ${stripes?.sel.length}개의 간선 밀도`} />
      {!compact && <svg width={width} height={height} className="chart-svg" style={{ pointerEvents: 'none' }} data-testid="chart-svg" aria-hidden="true">
        {stripes && stripes.sel.map((tt, s) => { const w = (width - 2 * pad - 40) / stripes.sel.length; return <rect key={`f${tt}`} x={pad + s * w} y={pad} width={Math.max(0, w - 2)} height={height - 2 * pad - 14} fill="none" stroke="#dbe3e3" data-testid="pes-frame" /> })}
        {stripes && stripes.sel.map((tt, s) => { const w = (width - 2 * pad - 40) / stripes.sel.length; return <text key={tt} x={pad + s * w + w / 2} y={height - 6} textAnchor="middle" fontSize={10} fill="#6b7280">t={tt}</text> })}
        <text x={pad - 4} y={pad + 8} fontSize={10} textAnchor="end" fill="#6b7280">{model.nodes[0].replace('노드 ', '')}</text>
        <text x={pad - 4} y={height - pad - 14} fontSize={10} textAnchor="end" fill="#6b7280">{model.nodes[model.nodes.length - 1].replace('노드 ', '')}</text>
      </svg>}
      {compact && <svg width={width} height={height} className="chart-svg" data-testid="chart-svg" aria-hidden="true" style={{ pointerEvents: 'none' }}>{stripes?.sel.map((tt, s) => <rect key={tt} x={4 + (s * (width - 8)) / stripes.sel.length} y={4} width={(width - 8) / stripes.sel.length - 1} height={height - 8} fill="none" stroke="#dbe3e3" />)}</svg>}
    </div>
  )
}

function PesControls({ params, setParams, table, mapping }: ControlsProps<PesParams>) {
  const edges = useMemo(() => readEdges(table, mapping), [table, mapping])
  const T = useMemo(() => (edges ? new Set(edges.map((e) => e.t)).size : 0), [edges])
  return (
    <ControlGroup title="평행 간선 스플래팅">
      <Segmented label="노드 정렬" value={params.order} onChange={(order) => setParams({ order })} testId="ctl-porder" options={[{ value: 'name', label: '이름순' }, { value: 'degree', label: '연결 가중치 큰 순' }]} />
      <Segmented label="밀도 눈금" value={params.scale} onChange={(scale) => setParams({ scale })} testId="ctl-pscale" options={[{ value: 'log', label: '로그' }, { value: 'sqrt', label: '제곱근' }, { value: 'linear', label: '선형' }]} />
      <Toggle label="간선을 양방향으로 합산" checked={params.both} onChange={(both) => setParams({ both })} testId="ctl-pboth" />
      {T > 1 && <Slider label="시작 시점" value={Math.min(params.from, T - 1)} min={0} max={T - 1} onChange={(from) => setParams({ from, to: Math.max(params.to, from) })} format={(v) => `${v + 1}`} testId="ctl-pfrom" />}
      {T > 1 && <Slider label="끝 시점" value={Math.min(Math.max(params.to, params.from), T - 1)} min={0} max={T - 1} onChange={(to) => setParams({ to, from: Math.min(params.from, to) })} format={(v) => `${v + 1}`} testId="ctl-pto" />}
      <Hint>시점마다 좁은 띠(stripe) 하나를 만들고 띠의 왼쪽 가장자리에 출발 노드, 오른쪽 가장자리에 도착 노드를 같은 순서로 세웁니다. 간선 하나는 두 노드를 잇는 직선이고, 이 직선들을 픽셀 격자에 퍼뜨려(splatting) 겹친 정도를 밀도로 모읍니다. 띠를 시간 순서로 나란히 놓으면 간선을 하나씩 그리지 않고도 수천 개의 간선이 시간에 따라 어떻게 바뀌는지 보입니다(공동체 안 연결 = 대각선 가까운 띠, 공동체 사이 연결 = 멀리 건너는 띠). 각 열의 밀도 합이 그 시점의 간선 가중치 합과 같도록 간선의 가중치를 이웃한 두 행에 나눠 담습니다. 원 논문의 계층적 노드 정렬과 다중 해상도는 구현하지 않았습니다.</Hint>
    </ControlGroup>
  )
}

export const pesModule: VizModule<PesParams> = {
  roles: [
    { key: 'time', label: '시점', type: 'number', required: true, prefer: '시점|time' },
    { key: 'a', label: '노드 A (출발)', type: 'category', required: true, prefer: '노드 A|source|출발' },
    { key: 'b', label: '노드 B (도착)', type: 'category', required: true, prefer: '노드 B|target|도착' },
    { key: 'weight', label: '가중치', type: 'number', auto: true, prefer: '가중치|weight' },
  ],
  datasets: ['dynamic-network'],
  defaultParams: { order: 'name', both: true, scale: 'log', from: 0, to: 11 },
  Chart: PesChart,
  Controls: PesControls,
  hint: '시점 범위와 노드 정렬을 바꿔 보세요 · 진한 곳일수록 그 위치를 지나는 간선이 많습니다',
}

// ───────────────────────────── Continuous scatterplot ─────────────────────────────

export interface CsParams { p: number; q: number; res: number; scale: 'linear' | 'log' | 'sqrt'; points: boolean }

function CsChart({ table, mapping, params, width, height, compact }: ChartProps<CsParams>) {
  const cvRef = useRef<HTMLCanvasElement>(null)
  const field = useMemo(() => readField(table, mapping), [table, mapping])
  const p = field ? Math.min(params.p, field.names.length - 1) : 0, q = field ? Math.min(params.q, field.names.length - 1) : 1
  const res = compact ? 64 : params.res
  const sp = useMemo(() => (field && p !== q ? continuousScatterplot(field.f, p, q, res, res) : null), [field, p, q, res])
  useEffect(() => { if (sp) paint(cvRef.current, sp.density, sp.cols, sp.rows, params.scale, true) }, [sp, params.scale])
  if (!field) return <ChartMessage>격자 x, y 좌표와 속성 열을 둘 이상 고르세요(규칙적인 격자, 4,000점 이하).</ChartMessage>
  if (!sp) return <ChartMessage>서로 다른 두 속성을 고르세요.</ChartMessage>
  const side = Math.min(width, height) - (compact ? 8 : 96)
  const ox = (width - side) / 2, oy = (height - side) / 2 - (compact ? 0 : 14)
  const sx = d3.scaleLinear().domain(sp.xr).range([ox, ox + side]), sy = d3.scaleLinear().domain(sp.yr).range([oy + side, oy])
  const area = (field.f.nx - 1) * (field.f.ny - 1)
  const dx = (sp.xr[1] - sp.xr[0]) / sp.cols, dy = (sp.yr[1] - sp.yr[0]) / sp.rows
  let mx = 0
  for (const v of sp.density) if (v > mx) mx = v
  return (
    <div className="chart-root">
      <canvas ref={cvRef} data-testid="cs-canvas" data-mass={(sp.mass).toFixed(3)} data-area={area} style={{ position: 'absolute', left: ox, top: oy, width: side, height: side, border: '1px solid #dbe3e3', boxSizing: 'border-box' }} role="img" aria-label={`연속 산점도: ${field.names[p]} 대 ${field.names[q]}`} />
      <svg width={width} height={height} className="chart-svg" data-testid="chart-svg" style={{ pointerEvents: 'none' }} aria-hidden="true">
        {params.points && !compact && Array.from({ length: field.f.nx * field.f.ny }, (_, k) => <circle key={k} cx={sx(field.f.attr[p][k])} cy={sy(field.f.attr[q][k])} r={1.4} fill="#d4452f" fillOpacity={0.55} data-testid="cs-point" />)}
        <rect x={ox} y={oy} width={side} height={side} fill="none" stroke="#dbe3e3" />
        {!compact && sx.ticks(5).map((t) => <line key={`x${t}`} x1={sx(t)} x2={sx(t)} y1={oy + side} y2={oy + side + 4} stroke="#9aa6a6" />)}
        {!compact && sy.ticks(5).map((t) => <line key={`y${t}`} x1={ox - 4} x2={ox} y1={sy(t)} y2={sy(t)} stroke="#9aa6a6" />)}
        {compact && <line x1={ox} y1={oy + side} x2={ox + side} y2={oy} stroke="#e5ebeb" />}
        {!compact && <><text x={ox + side / 2} y={oy + side + 28} textAnchor="middle" fontSize={11} fill="#374151">{field.names[p]}</text><text x={ox - 8} y={oy + side / 2} textAnchor="middle" fontSize={11} fill="#374151" transform={`rotate(-90 ${ox - 8} ${oy + side / 2})`}>{field.names[q]}</text>
        {sx.ticks(5).map((t) => <text key={t} x={sx(t)} y={oy + side + 13} textAnchor="middle" fontSize={9} fill="#9aa6a6">{fmt(t, 2)}</text>)}{sy.ticks(5).map((t) => <text key={t} x={ox - 4} y={sy(t)} dy="0.3em" textAnchor="end" fontSize={9} fill="#9aa6a6">{fmt(t, 2)}</text>)}</>}
      </svg>
      {!compact && <p className="chart-note" role="note" style={{ left: 8, right: 'auto', bottom: 2 }} data-testid="cs-readout">밀도 × 면적 = {fmt(sp.mass, 4)} (격자 면적 {area}) · 겹침 최대 밀도 {fmt(mx, 3)} · 퇴화한 삼각형 {sp.skipped}개 (칸 {fmt(dx * dy, 3)})</p>}
    </div>
  )
}

function attrOptions(mapping: Mapping) { return roleColumns(mapping, 'attrs').map((n, i) => ({ value: String(i), label: n })) }

function CsControls({ params, setParams, mapping }: ControlsProps<CsParams>) {
  const opts = useMemo(() => attrOptions(mapping), [mapping])
  return (
    <ControlGroup title="연속 산점도">
      {opts.length > 1 && <Select label="가로축 속성" value={String(params.p)} onChange={(v) => setParams({ p: Number(v) })} options={opts} />}
      {opts.length > 1 && <Select label="세로축 속성" value={String(params.q)} onChange={(v) => setParams({ q: Number(v) })} options={opts} />}
      <Segmented label="해상도" value={String(params.res)} onChange={(v) => setParams({ res: Number(v) })} testId="ctl-csres" options={[{ value: '48', label: '48' }, { value: '96', label: '96' }, { value: '160', label: '160' }]} />
      <Segmented label="밀도 눈금" value={params.scale} onChange={(scale) => setParams({ scale })} testId="ctl-csscale" options={[{ value: 'sqrt', label: '제곱근' }, { value: 'log', label: '로그' }, { value: 'linear', label: '선형' }]} />
      <Toggle label="격자점의 일반 산점도 겹쳐 보기" checked={params.points} onChange={(points) => setParams({ points })} testId="ctl-cspoints" />
      <Hint>보통의 산점도는 관측점 하나를 점 하나로 찍지만, 연속 산점도는 공간적으로 이어진 필드 전체를 속성 공간으로 옮깁니다. 격자 칸을 삼각형 둘로 나누어 속성값을 선형 보간하면 각 공간 삼각형이 속성 평면의 삼각형으로 옮겨지고, 그 안의 밀도는 (공간 삼각형 면적 ÷ 옮겨진 삼각형 면적)로 일정합니다. 여러 삼각형이 겹친 곳은 밀도가 더해져 필드가 속성 공간의 어디를 얼마나 덮는지가 매끈한 면으로 나타납니다. 겹쳐 본 점(붉은색)은 같은 격자점만 찍은 일반 산점도입니다. 아래 readout의 ‘밀도 × 면적’이 격자 면적과 거의 같아야 질량이 보존된 것입니다. 이 구현은 선형 보간의 2차원→2차원 경우만 다루며(원 논문은 n→m 일반 모델), 면적이 0인 삼각형은 그리지 않습니다.</Hint>
    </ControlGroup>
  )
}

const fieldRoles = [
  { key: 'x', label: 'x (격자)', type: 'number' as const, required: true, prefer: '^x$' },
  { key: 'y', label: 'y (격자)', type: 'number' as const, required: true, prefer: '^y$' },
  { key: 'attrs', label: '속성 (숫자, 2~6개)', type: 'number' as const, required: true, multiple: { min: 2, max: 6 }, prefer: '속성' },
]

export const csModule: VizModule<CsParams> = {
  roles: fieldRoles,
  datasets: ['multi-field'],
  defaultParams: { p: 0, q: 1, res: 96, scale: 'sqrt', points: false },
  Chart: CsChart,
  Controls: CsControls,
  hint: '속성 조합을 바꿔 필드가 속성 공간을 덮는 모양을 봅니다 · 격자점 겹쳐 보기로 일반 산점도와 비교',
}

// ───────────────────────────── Continuous parallel coordinates ─────────────────────────────

export interface CpcParams { order: string; samples: number; scale: 'linear' | 'log' | 'sqrt'; lines: boolean }

const PERMS = ['0,1,2', '1,2,0', '2,0,1', '0,2,1', '1,0,2', '2,1,0']

function CpcChart({ table, mapping, params, width, height, compact }: ChartProps<CpcParams>) {
  const cvRef = useRef<HTMLCanvasElement>(null)
  const field = useMemo(() => readField(table, mapping), [table, mapping])
  const order = useMemo(() => { const k = field ? field.names.length : 0; const base = params.order.split(',').map(Number).filter((v) => v < k); const rest = Array.from({ length: k }, (_, i) => i).filter((i) => !base.includes(i)); return [...base, ...rest] }, [field, params.order])
  const segCols = compact ? 48 : 120, rows = compact ? 64 : 160
  const segs = useMemo(() => {
    if (!field) return null
    let lo = Infinity, hi = -Infinity
    for (const a of order) for (const v of field.f.attr[a]) { if (v < lo) lo = v; if (v > hi) hi = v }
    return { lo, hi, d: order.slice(0, -1).map((a, i) => continuousParallel(field.f, a, order[i + 1], segCols, rows, compact ? 2 : params.samples, [lo, hi])) }
  }, [field, order, segCols, rows, params.samples, compact])
  useEffect(() => {
    if (!segs) return
    const gap = 3, cols = segs.d.length * (segCols + gap)
    const merged = new Float32Array(cols * rows)
    segs.d.forEach((d, s) => { for (let r = 0; r < rows; r++) for (let c = 0; c < segCols; c++) merged[r * cols + s * (segCols + gap) + c] = d.density[r * segCols + c] })
    paint(cvRef.current, merged, cols, rows, params.scale, true)
  }, [segs, params.scale, segCols, rows])
  if (!field || field.names.length < 2 || !segs) return <ChartMessage>격자 x, y 좌표와 속성 열을 둘 이상 고르세요(규칙적인 격자, 4,000점 이하).</ChartMessage>
  const pad = compact ? 4 : 36
  const w = width - 2 * pad, h = height - 2 * pad - (compact ? 0 : 10)
  const axisX = (i: number) => pad + (i * w) / (order.length - 1)
  const sy = d3.scaleLinear().domain([segs.lo, segs.hi]).range([pad + h, pad])
  return (
    <div className="chart-root">
      <canvas ref={cvRef} data-testid="cpc-canvas" data-axes={order.length} data-mass={segs.d[0].mass.toFixed(3)} style={{ position: 'absolute', left: pad, top: pad, width: w, height: h }} role="img" aria-label="연속 평행 좌표" />
      <svg width={width} height={height} className="chart-svg" data-testid="chart-svg" style={{ pointerEvents: 'none' }} aria-hidden="true">
        {params.lines && !compact && field && Array.from({ length: field.f.nx * field.f.ny }, (_, k) => k).filter((k) => k % 5 === 0).map((k) => <path key={k} d={'M' + order.map((a, i) => `${axisX(i)},${sy(field.f.attr[a][k])}`).join('L')} fill="none" stroke="#d4452f" strokeOpacity={0.15} data-testid="cpc-line" />)}
        {order.map((a, i) => <g key={a}><line x1={axisX(i)} x2={axisX(i)} y1={pad} y2={pad + h} stroke="#374151" strokeWidth={1.4} data-testid="cpc-axis" />{!compact && <text x={axisX(i)} y={pad - 8} textAnchor="middle" fontSize={11} fill="#374151">{field.names[a]}</text>}</g>)}
        {!compact && sy.ticks(5).map((t) => <line key={`l${t}`} x1={axisX(0) - 3} x2={axisX(0)} y1={sy(t)} y2={sy(t)} stroke="#9aa6a6" />)}
        {!compact && sy.ticks(5).map((t) => <text key={t} x={axisX(0) - 6} y={sy(t)} dy="0.3em" textAnchor="end" fontSize={9} fill="#9aa6a6">{fmt(t, 2)}</text>)}
      </svg>
    </div>
  )
}

function CpcControls({ params, setParams, table, mapping }: ControlsProps<CpcParams>) {
  const k = useMemo(() => roleColumns(mapping, 'attrs').length, [table, mapping]) // eslint-disable-line react-hooks/exhaustive-deps
  const names = roleColumns(mapping, 'attrs')
  const perms = PERMS.filter((p) => p.split(',').every((v) => Number(v) < k)).map((p) => ({ value: p, label: p.split(',').map((v) => names[Number(v)]?.replace('속성 ', '') ?? v).join(' → ') }))
  return (
    <ControlGroup title="연속 평행 좌표">
      {k >= 2 && perms.length > 0 && <Select label="축 순서" value={params.order} onChange={(order) => setParams({ order })} options={perms} />}
      <Segmented label="계산 표본(삼각형당)" value={String(params.samples)} onChange={(v) => setParams({ samples: Number(v) })} testId="ctl-cpcs" options={[{ value: '2', label: '3×3' }, { value: '4', label: '5×5' }, { value: '6', label: '7×7' }]} />
      <Segmented label="밀도 눈금" value={params.scale} onChange={(scale) => setParams({ scale })} testId="ctl-cpcscale" options={[{ value: 'sqrt', label: '제곱근' }, { value: 'log', label: '로그' }, { value: 'linear', label: '선형' }]} />
      <Toggle label="일반 평행 좌표 선(격자점) 겹쳐 보기" checked={params.lines} onChange={(lines) => setParams({ lines })} testId="ctl-cpclines" />
      <Hint>평행 좌표는 점 하나를 두 축 사이의 선분 하나로 바꿉니다(점-선 쌍대성). 연속 평행 좌표는 이산 점이 아니라 연속 필드의 밀도를 그 선분들로 퍼뜨립니다: 이웃한 두 축마다 연속 산점도의 밀도를 구하고, 속성 평면의 점 (x, y)를 ‘왼쪽 축의 x에서 오른쪽 축의 y로 가는 선분’으로 옮겨 모든 선분의 밀도를 더합니다. 선분을 투명하게 겹치는 것과 달리 격자 해상도와 무관하게 필드의 분포가 계산됩니다. 각 구간(열)의 밀도 합은 필드의 전체 면적과 같습니다. 이 구현은 삼각형 안을 균일한 표본점(barycentric 격자)으로 훑어 선을 긋는 수치 근사이며, 원 논문의 해석적·정확한 알고리즘은 아닙니다. 축 순서를 바꾸면 이웃한 쌍이 달라집니다.</Hint>
    </ControlGroup>
  )
}

export const cpcModule: VizModule<CpcParams> = {
  roles: fieldRoles,
  datasets: ['multi-field'],
  defaultParams: { order: '0,1,2', samples: 4, scale: 'sqrt', lines: false },
  Chart: CpcChart,
  Controls: CpcControls,
  hint: '축 순서를 바꾸면 이웃한 속성 쌍이 달라집니다 · 격자 선을 겹쳐 일반 평행 좌표와 비교',
}
