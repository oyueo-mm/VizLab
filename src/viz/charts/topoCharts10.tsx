import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { columnIndex, toNumber, type DataTable } from '../../data/table'
import { createRng } from '../../lib/random'
import { schemes } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { contourTree, crossingProbability, filterHills, landscapeHeights, landscapeHills, persistence, simplifyContourTree, type ContourTree, type Grid2 } from '../../stats/topo10'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, RoleSpec, VizModule } from '../types'
import { ViewControls, type ViewParams } from './geo3dCharts'
import { drawQuads, type Projector, type Quad } from './scene3d'
import { Scene3D } from './kit3d'

const gridRoles = (value = '값', prefer = '값|value|높이'): RoleSpec[] => [
  { key: 'x', label: 'x (열)', type: 'number', required: true, prefer: '^x' }, { key: 'y', label: 'y (행)', type: 'number', required: true, prefer: '^y' },
  { key: 'value', label: value, type: 'number', required: true, prefer },
]

/** Regular grid from rows (x, y, value); `rowOf[k]` is the table row of grid vertex k. */
function readGrid(table: DataTable, mapping: Mapping, valueKey = 'value', extraKey?: string) {
  const xi = columnIndex(table, roleColumn(mapping, 'x')), yi = columnIndex(table, roleColumn(mapping, 'y')), vi = columnIndex(table, roleColumn(mapping, valueKey)), ei = extraKey ? columnIndex(table, roleColumn(mapping, extraKey)) : -1
  if (xi < 0 || yi < 0 || vi < 0) return null
  const xs = [...new Set(table.rows.map((r) => toNumber(r[xi])).filter((v): v is number => v != null))].sort((a, b) => a - b)
  const ys = [...new Set(table.rows.map((r) => toNumber(r[yi])).filter((v): v is number => v != null))].sort((a, b) => a - b)
  if (xs.length < 3 || ys.length < 3 || xs.length * ys.length > 6000) return null
  const xm = new Map(xs.map((v, i) => [v, i])), ym = new Map(ys.map((v, i) => [v, i]))
  const g: Grid2 = { nx: xs.length, ny: ys.length, v: new Float64Array(xs.length * ys.length) }
  const extra = new Float64Array(xs.length * ys.length)
  const rowOf = new Int32Array(xs.length * ys.length).fill(-1)
  table.rows.forEach((r, row) => { const x = toNumber(r[xi]), y = toNumber(r[yi]), v = toNumber(r[vi]); if (x == null || y == null || v == null) return; const k = ym.get(y)! * xs.length + xm.get(x)!; g.v[k] = v; rowOf[k] = row; if (ei >= 0) extra[k] = toNumber(r[ei]) ?? 0 })
  return { g, extra, rowOf, xs, ys }
}

const ramp = schemes.viridis.interpolate

function FieldImage({ g, size, x, y, nodes }: { g: Grid2; size: number; x: number; y: number; nodes?: React.ReactNode }) {
  const lo = Math.min(...g.v), hi = Math.max(...g.v)
  const c = size / Math.max(g.nx, g.ny)
  return (
    <g transform={`translate(${x},${y})`}>
      {Array.from({ length: g.ny }, (_, j) => Array.from({ length: g.nx }, (_, i) => <rect key={`${i}-${j}`} x={i * c} y={(g.ny - 1 - j) * c} width={c + 0.4} height={c + 0.4} fill={ramp(0.05 + 0.9 * ((g.v[j * g.nx + i] - lo) / Math.max(1e-12, hi - lo)))} />))}
      {nodes}
    </g>
  )
}

// ───────────────────────────── Contour tree ─────────────────────────────

export interface CtParams { simplify: number; level: number; selArc: number }

function treeLayout(t: ContourTree, g: Grid2) {
  const adj = new Map<number, number[]>()
  t.arcs.forEach((a, i) => { adj.set(a.a, [...(adj.get(a.a) ?? []), i]); adj.set(a.b, [...(adj.get(a.b) ?? []), i]) })
  const root = t.nodes.reduce((b, n) => (g.v[n.v] > g.v[b.v] ? n : b), t.nodes[0]).v
  const x = new Map<number, number>()
  let leaf = 0
  const seenArc = new Set<number>()
  const walk = (v: number): number => {
    const kids = (adj.get(v) ?? []).filter((i) => !seenArc.has(i))
    kids.forEach((i) => seenArc.add(i))
    if (!kids.length) { x.set(v, leaf++); return x.get(v)! }
    const xs = kids.map((i) => walk(t.arcs[i].a === v ? t.arcs[i].b : t.arcs[i].a))
    x.set(v, xs.reduce((a, b) => a + b, 0) / xs.length)
    return x.get(v)!
  }
  walk(root)
  return { x, leaves: Math.max(1, leaf) }
}

function ContourTreeChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<CtParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const data = useMemo(() => readGrid(table, mapping), [table, mapping])
  const full = useMemo(() => (data ? contourTree(data.g) : null), [data])
  const range = data ? Math.max(...data.g.v) - Math.min(...data.g.v) : 1
  const tree = useMemo(() => (data && full ? (params.simplify > 0 ? simplifyContourTree(full, data.g, params.simplify * range) : full) : null), [data, full, params.simplify, range])
  if (!data || !full || !tree) return <ChartMessage>x, y 좌표와 값 열을 고르세요. 규칙적인 이차원 격자(최대 6,000점)여야 합니다.</ChartMessage>
  const g = data.g
  const lo = Math.min(...g.v), hi = Math.max(...g.v)
  const stacked = width < 640
  const fieldSide = compact ? Math.min(width, height) - 8 : stacked ? Math.min(width - 24, height * 0.42) : Math.min(width * 0.46, height - 40)
  const lay = treeLayout(tree, g)
  const tx0 = stacked ? 20 : fieldSide + 56, tw = stacked ? width - 40 : width - fieldSide - 80
  const ty0 = stacked ? fieldSide + 36 : 24, th = stacked ? height - fieldSide - 56 : height - 56
  const X = (v: number) => tx0 + ((lay.x.get(v) ?? 0) + 0.5) / lay.leaves * tw
  const Y = (v: number) => ty0 + th - ((g.v[v] - lo) / Math.max(1e-12, hi - lo)) * th
  const c = fieldSide / Math.max(g.nx, g.ny)
  const levelV = lo + params.level * (hi - lo)
  const crossing = tree.arcs.filter((a) => (g.v[a.a] - levelV) * (g.v[a.b] - levelV) < 0).length
  const sel = params.selArc >= 0 ? tree.arcs[params.selArc] : null
  const pos = (v: number) => [(v % g.nx + 0.5) * c, (g.ny - 1 - Math.floor(v / g.nx) + 0.5) * c] as const
  const iso = useMemo(() => d3.contours().size([g.nx, g.ny]).thresholds([levelV])(Array.from(g.v))[0], [g, levelV])
  const ctOff = { x: 10, y: 20 }
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`컨투어 트리: 극값과 안장점 ${tree.nodes.length}개, 현재 값에서 등치선 연결 성분 ${crossing}개`} onPointerLeave={hide}>
        <FieldImage g={g} size={fieldSide} x={ctOff.x} y={ctOff.y}
          nodes={<g pointerEvents="none">
            <path d={d3.geoPath(d3.geoTransform({ point(px: number, py: number) { this.stream.point(px * c, (g.ny - py) * c) } }))(iso) ?? ''} fill="none" stroke="#fff" strokeWidth={2} data-testid="ct-iso" />
            {sel && sel.path.map((v) => <circle key={v} cx={pos(v)[0]} cy={pos(v)[1]} r={Math.max(1.5, c * 0.45)} fill="#d4452f" />)}
            {tree.nodes.map((n) => <circle key={n.v} cx={pos(n.v)[0]} cy={pos(n.v)[1]} r={compact ? 2.5 : 5} fill={n.type === 'max' ? '#d4452f' : n.type === 'min' ? '#4c6fb5' : '#fff'} stroke="#1f2937" strokeWidth={1.2} />)}
          </g>} />
        {!compact && (
          <g data-testid="ct-tree">
            <line x1={tx0 - 8} x2={tx0 + tw + 8} y1={ty0 + th - ((levelV - lo) / Math.max(1e-12, hi - lo)) * th} y2={ty0 + th - ((levelV - lo) / Math.max(1e-12, hi - lo)) * th} stroke="#d4452f" strokeDasharray="4 3" />
            {tree.arcs.map((a, i) => (
              <line key={i} x1={X(a.a)} y1={Y(a.a)} x2={X(a.b)} y2={Y(a.b)} stroke={params.selArc === i ? '#d4452f' : '#6b7280'} strokeWidth={params.selArc === i ? 3 : 1.6} data-testid="ct-arc" style={{ cursor: 'pointer' }}
                onClick={() => setParams({ selArc: params.selArc === i ? -1 : i })}
                onPointerEnter={(e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>호 {i + 1}</b><br />값 {fmt(g.v[a.a], 3)} ~ {fmt(g.v[a.b], 3)}<br />경로 정점 {a.path.length}개</>) }} onPointerLeave={hide} />
            ))}
            {tree.nodes.map((n) => <circle key={n.v} cx={X(n.v)} cy={Y(n.v)} r={5} fill={n.type === 'max' ? '#d4452f' : n.type === 'min' ? '#4c6fb5' : '#fff'} stroke="#1f2937" strokeWidth={1.2} data-testid="ct-node" data-type={n.type} />)}
            <text x={tx0} y={ty0 - 8} fontSize={11} fill="#6b7280">컨투어 트리(세로 = 값)</text>
          </g>
        )}
        {!compact && <text x={12} y={height - 8} fontSize={11} fill="#374151" data-testid="ct-readout">극대 {tree.nodes.filter((n) => n.type === 'max').length} · 극소 {tree.nodes.filter((n) => n.type === 'min').length} · 안장점 {tree.nodes.filter((n) => n.type === 'saddle').length} · 값 {fmt(levelV, 3)}의 등치선 연결 성분 {crossing}개</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function CtControls({ params, setParams }: ControlsProps<CtParams>) {
  return (
    <ControlGroup title="단순화와 등치선">
      <Slider label="지속성 단순화 (값 범위 대비 비율, 이보다 짧은 가지를 제거)" value={params.simplify} min={0} max={0.5} step={0.01} onChange={(simplify) => setParams({ simplify, selArc: -1 })} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-simplify" />
      <Slider label="등치선의 값 (최소~최대 위치)" value={params.level} min={0} max={1} step={0.01} onChange={(level) => setParams({ level })} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-level" />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ selArc: -1 })} data-testid="ct-clear">선택 해제</button>
      <Hint>스칼라장의 값을 높이로 보고 등치선을 연속적으로 움직일 때 등치선의 연결 성분이 생기고(극대·극소), 합쳐지고(안장점), 사라지는 과정을 나무로 그린 것이 컨투어 트리입니다. 가지(호) 하나는 그 구간에서 연결 성분이 하나로 이어지는 값의 범위이고, 트리의 가로 위치는 보기 좋게 정한 것입니다. 붉은 점선(및 지도의 흰 등치선)의 값에서 트리를 가로지르는 가지 수가 등치선의 연결 성분 수입니다. 가지를 누르면 그 구간의 정점들이 격자에 표시됩니다. 계산은 Carr·Snoeyink·Axen의 합병 알고리즘(조인·스플릿 트리를 한쪽만 잎인 정점부터 벗겨 내는 방식)이며, 단순화는 지속성이 작은 잎 가지를 순서대로 제거합니다(가지의 정확한 지속성 쌍 정의 대신 값 범위를 씁니다).</Hint>
    </ControlGroup>
  )
}

export const contourTreeModule: VizModule<CtParams> = {
  roles: gridRoles(),
  datasets: ['terrain-field'],
  defaultParams: { simplify: 0.05, level: 0.4, selArc: -1 },
  Chart: ContourTreeChart,
  Controls: CtControls,
  hint: '단순화 슬라이더로 작은 봉우리를 지우고 등치선 값을 바꿔 연결 성분 수의 변화를 봅니다 · 트리의 가지를 눌러 격자에서 확인',
}

// ───────────────────────────── Persistence barcode and diagram ─────────────────────────────

export interface PersParams { kind: 'max' | 'min' | 'both'; threshold: number; selected: number }

function PersChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<PersParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const data = useMemo(() => readGrid(table, mapping), [table, mapping])
  const pairs = useMemo(() => (data ? persistence(data.g) : null), [data])
  if (!data || !pairs) return <ChartMessage>x, y 좌표와 값 열을 고르세요. 규칙적인 이차원 격자여야 합니다.</ChartMessage>
  const g = data.g
  const lo = Math.min(...g.v), hi = Math.max(...g.v), range = hi - lo || 1
  const shown = pairs.map((p, i) => ({ ...p, i, pers: Math.abs(p.birth - p.death) })).filter((p) => params.kind === 'both' || p.kind === params.kind).sort((a, b) => b.pers - a.pers)
  const limit = params.threshold * range
  const pad = compact ? 6 : 30
  const half = width / 2
  const barH = Math.max(2, Math.min(14, (height - 2 * pad - 20) / Math.max(1, shown.length)))
  const bx = (v: number, w: number) => pad + ((v - lo) / range) * (w - 2 * pad)
    const side = Math.min(half - 2 * pad, height - 2 * pad - 20)
  const kept = shown.filter((p) => p.pers >= limit).length
  const col = (k: string) => (k === 'max' ? '#d4452f' : '#4c6fb5')
  const sel = shown.find((p) => p.i === params.selected)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`지속성 바코드와 다이어그램: 특징 ${shown.length}개 중 ${kept}개가 문턱 이상`} onPointerLeave={hide}>
        <g data-testid="pers-barcode">
          {shown.map((p, k) => {
            const keep = p.pers >= limit
            const x0 = bx(Math.min(p.birth, p.death), half), x1 = bx(Math.max(p.birth, p.death), half)
            return <rect key={p.i} x={x0} y={pad + k * barH} width={Math.max(1.5, x1 - x0)} height={Math.max(1.5, barH - 1.5)} fill={col(p.kind)} opacity={keep ? (params.selected === p.i ? 1 : 0.8) : 0.18} stroke={params.selected === p.i ? '#1f2937' : 'none'} data-testid="pers-bar" data-pers={p.pers.toFixed(4)} style={{ cursor: compact ? undefined : 'pointer' }}
              onClick={compact ? undefined : () => setParams({ selected: params.selected === p.i ? -1 : p.i })}
              onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{p.kind === 'max' ? '극대' : '극소'}</b> 지속성 {fmt(p.pers, 4)}<br />생성 {fmt(p.birth, 4)} → 소멸 {fmt(p.death, 4)}{p.saddle < 0 ? ' (전체에서 마지막까지 존속)' : ''}</>) }} onPointerLeave={hide} />
          })}
          {!compact && <text x={pad} y={pad - 8} fontSize={11} fill="#6b7280">바코드: 가로 = 값, 막대 길이 = 지속성</text>}
        </g>
        {!compact && (
          <g transform={`translate(${half + pad},${pad})`} data-testid="pers-diagram">
            <rect width={side} height={side} fill="#fafcfc" stroke="#dbe3e3" />
            <line x1={0} y1={side} x2={side} y2={0} stroke="#b6bec4" strokeDasharray="3 3" />
            {shown.map((p) => <circle key={p.i} cx={((Math.min(p.birth, p.death) - lo) / range) * side} cy={side - ((Math.max(p.birth, p.death) - lo) / range) * side} r={params.selected === p.i ? 6 : 4} fill={col(p.kind)} opacity={p.pers >= limit ? 0.85 : 0.2} stroke={params.selected === p.i ? '#1f2937' : '#fff'} data-testid="pers-point" />)}
            <text x={0} y={side + 14} fontSize={11} fill="#6b7280">다이어그램: 가로 = 낮은 값, 세로 = 높은 값 (대각선에서 멀수록 지속성이 큼)</text>
          </g>
        )}
        {!compact && sel && <text x={half + pad} y={height - 14} fontSize={11} fill="#374151" data-testid="pers-sel">선택: {sel.kind === 'max' ? '극대' : '극소'} · 격자 위치 ({sel.extremum % g.nx}, {Math.floor(sel.extremum / g.nx)}) · 지속성 {fmt(sel.pers, 4)}</text>}
        {!compact && <text x={pad} y={height - 8} fontSize={11} fill="#374151" data-testid="pers-readout">특징 {shown.length}개 중 지속성 {fmt(limit, 3)} 이상 {kept}개</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function PersControls({ params, setParams }: ControlsProps<PersParams>) {
  return (
    <ControlGroup title="특징과 문턱">
      <Segmented label="보는 특징" value={params.kind} onChange={(kind) => setParams({ kind, selected: -1 })} options={[{ value: 'both', label: '극대 + 극소' }, { value: 'max', label: '극대(위쪽 집합)' }, { value: 'min', label: '극소(아래쪽 집합)' }]} testId="ctl-kind" />
      <Slider label="지속성 문턱 (값 범위 대비)" value={params.threshold} min={0} max={0.5} step={0.01} onChange={(threshold) => setParams({ threshold })} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-threshold" />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ selected: -1 })} data-testid="pers-clear">선택 해제</button>
      <Hint>값을 높이로 보고 수준을 낮춰 가면 극대가 연결 성분으로 나타나고(생성), 서로 합쳐질 때 더 낮은 쪽이 사라집니다(소멸, 연장자 규칙). 생성~소멸 값의 구간이 클수록(지속성이 클수록) 노이즈가 아닌 의미 있는 특징입니다. 바코드는 특징마다 구간 하나를 막대로, 다이어그램은 (생성, 소멸) 쌍을 점으로 그리며 대각선에서 멀수록 중요합니다. 마지막까지 살아남는 하나(전체의 최댓값·최솟값)는 가장 긴 막대입니다. 문턱을 올리면 노이즈에 해당하는 짧은 막대가 흐려집니다. 계산은 격자 삼각분할 위의 0차원 지속성(유니온-파인드)입니다.</Hint>
    </ControlGroup>
  )
}

export const persistenceModule: VizModule<PersParams> = {
  roles: gridRoles(),
  datasets: ['terrain-field'],
  defaultParams: { kind: 'both', threshold: 0.05, selected: -1 },
  Chart: PersChart,
  Controls: PersControls,
  hint: '문턱을 올려 노이즈(짧은 막대)가 사라지는 것을 봅니다 · 막대를 눌러 격자 위 위치와 지속성 확인',
}

// ───────────────────────────── Topological landscape ─────────────────────────────

export interface LandParams extends ViewParams { res: number; exaggeration: number; color: 'height' | 'hill'; minRise: number }

function LandChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<LandParams>) {
  const data = useMemo(() => readGrid(table, mapping), [table, mapping])
  const model = useMemo(() => {
    if (!data) return null
    const all = landscapeHills(data.g)
    const range = Math.max(...data.g.v) - Math.min(...data.g.v)
    const hills = filterHills(all, params.minRise * range)
    return { hills, total: all.length, terrain: landscapeHeights(hills, compact ? 28 : params.res) }
  }, [data, params.res, params.minRise, compact])
  if (!data || !model) return <ChartMessage>x, y 좌표와 값 열을 고르세요. 규칙적인 이차원 격자여야 합니다.</ChartMessage>
  const { hills, terrain } = model
  const size = Math.round(Math.sqrt(terrain.h.length))
  const hmax = Math.max(1e-9, ...terrain.h)
  const hillIndexOf = (x: number, y: number) => { let best = 0, bd = Infinity; hills.forEach((h, i) => { const d = Math.hypot(x - h.cx, y - h.cy) / Math.max(1e-9, h.r); if (d < bd) { bd = d; best = i } }); return best }
  const draw = (ctx: CanvasRenderingContext2D, proj: Projector) => {
    const quads: Quad[] = []
    const pts = Array.from({ length: size }, (_, j) => Array.from({ length: size }, (_, i) => {
      const x = (i / (size - 1)) * 2 - 1, y = (j / (size - 1)) * 2 - 1, z = (terrain.h[j * size + i] / hmax) * 0.9 * params.exaggeration - 0.45
      return { w: [x, y, z] as [number, number, number], p: proj([x, y, z]), t: terrain.h[j * size + i] / hmax, hi: params.color === 'hill' ? hillIndexOf(x * terrain.extent, y * terrain.extent) : 0 }
    }))
    for (let j = 0; j < size - 1; j++) for (let i = 0; i < size - 1; i++) {
      const a = pts[j][i], b = pts[j][i + 1], c = pts[j + 1][i + 1], d = pts[j + 1][i]
      const t = (a.t + b.t + c.t + d.t) / 4
      const fill = params.color === 'hill' ? d3.color(d3.schemeTableau10[a.hi % 10])!.brighter(0.6 - 1.1 * t).formatRgb() : ramp(0.08 + 0.85 * t)
      quads.push({ pts: [[a.p.x, a.p.y], [b.p.x, b.p.y], [c.p.x, c.p.y], [d.p.x, d.p.y]], depth: (a.p.depth + c.p.depth) / 2, fill, stroke: fill })
    }
    drawQuads(ctx, quads, 0.3)
  }
  return (
    <Scene3D width={width} height={height} compact={compact} params={params} setParams={setParams} label={`토폴로지컬 랜드스케이프: 봉우리 ${hills.length}개`} draw={draw} fit={0.42} box={{ x: [-1, 1], y: [-1, 1], z: [-0.45, 0.45] }}
      drawKey={`${params.res}|${params.exaggeration}|${params.color}|${hills.length}|${size}|${params.minRise}`}
      readout={[{ label: '봉우리(극대)', value: `${hills.length}개 (전체 ${model.total}개)` }, { label: '가장 높은 봉우리의 높이', value: fmt(Math.max(...hills.map((h) => h.rise)), 3) }, { label: '가장 낮은 안장점', value: fmt(Math.min(...hills.map((h) => h.saddleValue)), 3) }]}
      note="봉우리 하나가 극대 하나, 봉우리 밑면의 넓이가 그 봉우리가 가진 정점 수, 봉우리 사이의 능선 높이가 안장점의 값" />
  )
}

function LandControls({ params, setParams }: ControlsProps<LandParams>) {
  return (
    <>
      <ControlGroup title="지형">
        <Slider label="지형 해상도" value={params.res} min={30} max={90} step={5} onChange={(res) => setParams({ res })} testId="ctl-res" />
        <Slider label="작은 봉우리 걸러내기 (값 범위 대비 높이 비율)" value={params.minRise} min={0} max={0.3} step={0.01} onChange={(minRise) => setParams({ minRise })} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-minrise" />
        <Slider label="높이 과장" value={params.exaggeration} min={0.5} max={2} step={0.1} onChange={(exaggeration) => setParams({ exaggeration })} format={(v) => v.toFixed(1)} testId="ctl-exag" />
        <Segmented label="색" value={params.color} onChange={(color) => setParams({ color })} options={[{ value: 'height', label: '높이' }, { value: 'hill', label: '봉우리별' }]} testId="ctl-color" />
        <Hint>스칼라장의 위상 구조(어떤 극대가 어떤 값에서 서로 합쳐지는가)를 ‘봉우리와 능선이 있는 지형’의 은유로 바꾼 그림입니다. 봉우리마다 합쳐지기 전까지 그 극대가 소유한 정점 수에 비례하는 넓이를 주고, 더 낮은 봉우리는 합쳐지는 더 높은 봉우리의 비탈 위에 안장점의 높이에서 올려 놓습니다. 그래서 지형의 봉우리 수와 높이, 합쳐지는 순서가 원래 장의 병합 트리와 같습니다. 이 구현은 원 논문(Weber 외 2007)처럼 컨투어 트리와 똑같은 위상을 가진 지형을 구성하지 않고, 병합(조인) 트리에서 만든 종 모양 봉우리를 더하는 단순화한 근사입니다. 지형의 거리와 모양은 원래 장의 공간 위치와 무관합니다.</Hint>
      </ControlGroup>
      <ViewControls params={params} setParams={setParams} />
    </>
  )
}

export const landscapeModule: VizModule<LandParams> = {
  roles: gridRoles(),
  datasets: ['terrain-field'],
  defaultParams: { yaw: -35, pitch: 38, zoom: 0.95, res: 60, exaggeration: 1.2, color: 'hill', minRise: 0.06 },
  Chart: LandChart,
  Controls: LandControls,
  hint: '지형을 돌려 봉우리와 능선을 확인합니다 · 봉우리별 색으로 어떤 극대가 어떤 봉우리에 합쳐지는지 구분',
}

// ───────────────────────────── Probabilistic isocontours ─────────────────────────────

export interface ProbParams { level: number; samples: number; spread: number; showSamples: boolean; selCell: number }

function ProbChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<ProbParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const data = useMemo(() => readGrid(table, mapping, 'mean', 'sigma'), [table, mapping])
  const lo = data ? Math.min(...data.g.v) : 0, hi = data ? Math.max(...data.g.v) : 1
  const level = lo + params.level * (hi - lo)
  const sigma = useMemo(() => (data ? data.extra.map((s) => s * params.spread) : null), [data, params.spread])
  const prob = useMemo(() => (data && sigma ? crossingProbability(data.g, sigma, level, compact ? 60 : params.samples, 11) : null), [data, sigma, level, params.samples, compact])
  const samples = useMemo(() => {
    if (!data || !sigma || !params.showSamples || compact) return []
    const r = createRng(5)
    return Array.from({ length: 8 }, () => d3.contours().size([data.g.nx, data.g.ny]).thresholds([level])(Array.from(data.g.v, (v, i) => v + sigma[i] * r.normal()))[0])
  }, [data, sigma, level, params.showSamples, compact])
  if (!data || !prob || !sigma) return <ChartMessage>x, y, 평균, 표준편차 열을 고르세요. 규칙적인 이차원 격자여야 합니다.</ChartMessage>
  const g = data.g
  const side = Math.min(width, height - (compact ? 4 : 44)) - (compact ? 4 : 20)
  const c = side / Math.max(g.nx, g.ny)
  const ox = (width - side) / 2, oy = compact ? 2 : 14
  const mean = d3.contours().size([g.nx, g.ny]).thresholds([level])(Array.from(g.v))[0]
  const tf = d3.geoPath(d3.geoTransform({ point(px: number, py: number) { this.stream.point(px * c, (g.ny - py) * c) } }))
  const certain = Array.from(prob).filter((p) => p === 0 || p === 1).length
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`확률적 등치선: 값 ${fmt(level, 3)}, 최대 통과 확률 ${fmt(Math.max(...prob), 2)}`} onPointerLeave={hide}>
        <g transform={`translate(${ox},${oy})`}>
          {Array.from({ length: g.ny - 1 }, (_, j) => Array.from({ length: g.nx - 1 }, (_, i) => {
            const k = j * (g.nx - 1) + i
            return <rect key={k} x={i * c + c / 2} y={(g.ny - 2 - j) * c + c / 2} width={c + 0.4} height={c + 0.4} fill={prob[k] > 0 ? d3.interpolateOranges(0.08 + 0.92 * Math.sqrt(prob[k])) : '#f6f8f8'} stroke={params.selCell === k ? '#1f2937' : 'none'} data-testid="prob-cell" data-p={prob[k].toFixed(3)} style={{ cursor: compact ? undefined : 'pointer' }}
              onClick={compact ? undefined : () => setParams({ selCell: params.selCell === k ? -1 : k })}
              onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <>등치선이 이 칸을 지날 확률 <b>{fmt(prob[k] * 100, 3)}%</b></>) }} onPointerLeave={hide} />
          }))}
          {samples.map((s, i) => <path key={i} d={tf(s) ?? ''} fill="none" stroke="#4c6fb5" strokeWidth={0.9} opacity={0.55} transform={`translate(${c / 2},${-c / 2})`} data-testid="prob-sample" pointerEvents="none" />)}
          <path d={tf(mean) ?? ''} fill="none" stroke="#1f2937" strokeWidth={2} transform={`translate(${c / 2},${-c / 2})`} data-testid="prob-mean" pointerEvents="none" />
        </g>
        {!compact && <text x={12} y={height - 8} fontSize={11} fill="#374151" data-testid="prob-readout">값 {fmt(level, 3)} · 표본 {params.samples}개 · 최대 통과 확률 {fmt(Math.max(...prob) * 100, 3)}% · 확실한 칸(0 또는 1) {certain}/{prob.length}</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function ProbControls({ params, setParams }: ControlsProps<ProbParams>) {
  return (
    <ControlGroup title="등치선과 불확실성">
      <Slider label="등치선의 값 (최소~최대 위치)" value={params.level} min={0.05} max={0.95} step={0.01} onChange={(level) => setParams({ level, selCell: -1 })} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-level" />
      <Slider label="표준편차 배율" value={params.spread} min={0} max={3} step={0.1} onChange={(spread) => setParams({ spread })} format={(v) => v.toFixed(1)} testId="ctl-spread" />
      <Slider label="몬테카를로 표본 수" value={params.samples} min={50} max={800} step={50} onChange={(samples) => setParams({ samples })} testId="ctl-samples" />
      <Toggle label="표본 등치선 8개 겹치기" checked={params.showSamples} onChange={(showSamples) => setParams({ showSamples })} testId="ctl-showsamples" />
      <Hint>격자점마다 평균과 표준편차를 가진 불확실한 스칼라장에서, 장의 값을 정규분포에서 여러 번 뽑아(몬테카를로) 각 표본마다 등치선이 지나는 격자 칸을 세고, 그 비율을 칸의 색으로 칠합니다. 검은 선은 평균 장의 등치선이고, 색이 진한 칸은 불확실성 때문에 등치선이 그곳을 지날 확률이 높다는 뜻입니다. 표준편차가 큰 오른쪽에서 확률이 넓은 띠로 번집니다. 표본 등치선을 겹치면 가능한 등치선들이 평균선 둘레에 흩어지는 모습이 보입니다. 이 구현은 격자점 값을 서로 독립으로 가정하고(공간 상관 없음) 칸 단위 통과 확률만 계산하며, 원 논문(Pöthkow·Hege)의 상관 구조를 반영한 확률 계산은 하지 않습니다.</Hint>
    </ControlGroup>
  )
}

export const probIsoModule: VizModule<ProbParams> = {
  roles: [
    { key: 'x', label: 'x (열)', type: 'number', required: true, prefer: '^x' }, { key: 'y', label: 'y (행)', type: 'number', required: true, prefer: '^y' },
    { key: 'mean', label: '평균', type: 'number', required: true, prefer: '평균|mean' }, { key: 'sigma', label: '표준편차', type: 'number', required: true, prefer: '표준편차|sigma|sd' },
  ],
  datasets: ['noisy-field'],
  defaultParams: { level: 0.55, samples: 300, spread: 1, showSamples: true, selCell: -1 },
  Chart: ProbChart,
  Controls: ProbControls,
  hint: '등치선 값과 표준편차 배율을 바꿔 불확실한 영역이 번지는 것을 봅니다 · 칸에 올려 통과 확률 확인',
}
