import * as d3 from 'd3'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AxisBottom, ChartMessage, Legend, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber } from '../../data/table'
import { useReducedMotion } from '../../hooks/motion'
import { categoryColor } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { buildTree } from '../../stats/hierarchy'
import { bundleEdges, hyperbolicLayout, linearDiagram, mobius, storylineLayout, type Cx, type Edge2 } from '../../stats/net7'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'

const ACCENT = '#2a8c82'

// ───────────────────────────── Hyperbolic Tree ─────────────────────────────

export interface HypParams { delta: number; focus: number; labelSize: number; edges: boolean }

/** Point at fraction t along the hyperbolic geodesic from c0 to c1. */
const geodesicStep = (c0: Cx, c1: Cx, t: number): Cx => mobius([mobius(c1, c0)[0] * t, mobius(c1, c0)[1] * t], [-c0[0], -c0[1]])

function HypChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<HypParams>) {
  const levels = roleColumns(mapping, 'levels')
  const reduced = useReducedMotion()
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const nodes = useMemo(() => (levels.length ? hyperbolicLayout(buildTree(table, levels, null).tree, params.delta) : []), [table, levels.join('|'), params.delta]) // eslint-disable-line react-hooks/exhaustive-deps
  const target = nodes[params.focus]?.z ?? [0, 0]
  const [center, setCenter] = useState<Cx>([0, 0])
  const from = useRef<Cx>([0, 0])
  useEffect(() => {
    if (reduced || compact) { setCenter(target as Cx); from.current = target as Cx; return }
    const c0 = from.current
    const t0 = performance.now()
    let raf = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 420)
      const e = 1 - (1 - t) ** 3
      const p = geodesicStep(c0, target as Cx, e)
      setCenter(p)
      if (t < 1) raf = requestAnimationFrame(step)
      else from.current = target as Cx
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target[0], target[1], reduced, compact]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!nodes.length || nodes.length < 2) return <ChartMessage>계층 열(범주형)을 선택하세요.</ChartMessage>
  const R = Math.max(40, Math.min(width, height) / 2 - (compact ? 6 : 16))
  const cx = width / 2, cy = height / 2
  const pos = nodes.map((n) => mobius(n.z, center))
  const P = (z: Cx) => [cx + z[0] * R, cy + z[1] * R] as [number, number]
  // a geodesic is drawn by moving the first end point to the origin, where it is a straight segment, and mapping the samples back
  const geodesic = (a: Cx, b: Cx): string => {
    const w = mobius(b, a)
    const pts = Array.from({ length: 11 }, (_, k) => { const t = k / 10; return P(mobius([w[0] * t, w[1] * t], [-a[0], -a[1]])) })
    return `M${pts.map((p) => p.join(',')).join('L')}`
  }
  const sizeOf = (z: Cx) => Math.max(1.2, (compact ? 5 : 10) * (1 - (z[0] * z[0] + z[1] * z[1])))
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Hyperbolic Tree: 노드 ${nodes.length}개를 쌍곡 평면(푸앵카레 원판)에 배치, 초점 ‘${nodes[params.focus]?.name ?? ''}’`} onPointerLeave={hide}>
        <circle cx={cx} cy={cy} r={R} fill="#fafbfc" stroke="#9aa3ad" data-testid="hyp-disc" />
        {nodes.slice(1).map((n) => <path key={`e${n.id}`} d={geodesic(pos[n.parent], pos[n.id])} fill="none" stroke="#b6bec6" strokeWidth={compact ? 0.7 : 1.1} data-testid="hyp-edge" />)}
        {nodes.map((n) => {
          const [x, y] = P(pos[n.id])
          const r = sizeOf(pos[n.id])
          const focused = n.id === params.focus
          return (
            <g key={n.id}>
              <circle cx={x} cy={y} r={r} fill={focused ? ACCENT : n.leaves > 1 ? '#4c6fb5' : '#d4a53a'} fillOpacity={0.88} stroke="#fff" strokeWidth={0.8} data-testid="hyp-node" style={{ cursor: compact ? undefined : 'pointer' }}
                onClick={compact ? undefined : () => setParams({ focus: n.id })}
                onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{n.name}</b><br />깊이 {n.depth} · 잎 {n.leaves}개<br />눌러서 중심으로 이동</>) }} onPointerLeave={hide} />
              {!compact && r >= params.labelSize && <text x={x} y={y - r - 3} textAnchor="middle" className="radar-level" fontSize={Math.min(12, 6 + r * 0.7)} style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3, pointerEvents: 'none' }}>{n.name}</text>}
            </g>
          )
        })}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function HypControls({ params, setParams }: ControlsProps<HypParams>) {
  return (
    <ControlGroup title="쌍곡 배치">
      <Slider label="단계당 쌍곡 거리 δ" value={params.delta} min={0.6} max={2} step={0.05} onChange={(delta) => setParams({ delta })} format={(v) => v.toFixed(2)} testId="ctl-delta" />
      <Slider label="이름 표시 기준 (노드 반지름)" value={params.labelSize} min={3} max={10} onChange={(labelSize) => setParams({ labelSize })} testId="ctl-label" />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ focus: 0 })} data-testid="hyp-home">루트로 돌아가기</button>
      <Hint>노드를 누르면 그 노드가 원판 중심으로 옵니다. 쌍곡 평면은 가장자리로 갈수록 공간이 지수적으로 넓어져 많은 노드를 담을 수 있고, 중심의 노드는 크게, 멀수록 작게 보여 초점+맥락이 됩니다. 선은 쌍곡 직선(측지선)입니다.</Hint>
    </ControlGroup>
  )
}

export const hypModule: VizModule<HypParams> = {
  roles: [{ key: 'levels', label: '계층 수준 (바깥 → 안쪽)', type: 'category', required: true, multiple: { min: 1, max: 4 } }],
  datasets: ['org-tree', 'budget'],
  defaultParams: { delta: 1.15, focus: 0, labelSize: 5.5, edges: true },
  Chart: HypChart,
  Controls: HypControls,
  hint: '노드를 눌러 중심으로 이동 · 주변이 압축되어 큰 트리도 한 화면에 들어옵니다',
}

// ───────────────────────────── Linear Set Diagram ─────────────────────────────

export interface LinearParams { sort: 'size' | 'degree' | 'pattern'; rowOrder: 'size' | 'original'; selected: number; counts: boolean }

function LinearChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<LinearParams>) {
  const sets = roleColumns(mapping, 'sets')
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const model = useMemo(() => {
    const idx = sets.map((s) => columnIndex(table, s))
    if (idx.length < 2 || idx.some((i) => i < 0)) return null
    const member = table.rows.map((r) => idx.map((i) => (toNumber(r[i]) ?? 0) > 0))
    return linearDiagram(member, params.sort)
  }, [table, sets.join('|'), params.sort]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!model || !model.total) return <ChartMessage>집합 열(0/1 소속)이 2개 이상 필요합니다.</ChartMessage>
  const order = sets.map((_, j) => j).sort((a, b) => (params.rowOrder === 'size' ? model.setSizes[b] - model.setSizes[a] : a - b))
  const m = compact ? { l: 6, r: 6, t: 6, b: 6 } : { l: 96, r: 30, t: 52, b: 20 }
  const w = width - m.l - m.r, h = height - m.t - m.b
  const row = d3.scaleBand<number>().domain(order).range([0, h]).padding(0.28)
  const color = categoryColor(sets)
  const gapPx = compact ? 0.5 : 1.5
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Linear Set Diagram: 집합 ${sets.length}개, 원소 ${model.total}개, 소속 조합 ${model.columns.length}가지`} onPointerLeave={hide}>
        <g transform={`translate(${m.l},${m.t})`}>
          {order.map((j) => (
            <g key={j}>
              <line x1={0} x2={w} y1={row(j)! + row.bandwidth() / 2} y2={row(j)! + row.bandwidth() / 2} stroke="#e6e9ec" />
              {!compact && <text x={-8} y={row(j)! + row.bandwidth() / 2} dy="0.34em" textAnchor="end" className="radar-axis-label">{sets[j]} <tspan className="radar-level">({model.setSizes[j]})</tspan></text>}
            </g>
          ))}
          {model.columns.map((c, ci) => {
            const x = c.x0 * w, cw = Math.max(0.6, (c.x1 - c.x0) * w - gapPx)
            const hot = params.selected === c.pattern
            const rowsIn = order.filter((j) => c.sets.includes(j))
            return (
              <g key={c.pattern} data-testid="lin-column" opacity={params.selected >= 0 && !hot ? 0.35 : 1}
                onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{c.sets.length ? c.sets.map((j) => sets[j]).join(' ∩ ') : '어느 집합에도 속하지 않음'}</b><br />원소 {c.count}개 ({((c.count / model.total) * 100).toFixed(1)}%)</>) }} onPointerLeave={hide}
                onClick={compact ? undefined : () => setParams({ selected: hot ? -1 : c.pattern })} style={{ cursor: compact ? undefined : 'pointer' }}>
                <rect x={x} y={-2} width={cw} height={h + 4} fill="transparent" />
                {rowsIn.map((j) => <rect key={j} x={x} y={row(j)!} width={cw} height={row.bandwidth()} fill={color(sets[j])} fillOpacity={0.88} data-testid="lin-cell" />)}
                {rowsIn.length > 1 && <line x1={x + cw / 2} x2={x + cw / 2} y1={row(rowsIn[0])!} y2={row(rowsIn[rowsIn.length - 1])! + row.bandwidth()} stroke="#333" strokeWidth={Math.min(2, cw / 2)} />}
                {!compact && params.counts && cw > 14 && ci < 40 && <text x={x + cw / 2} y={-8} textAnchor="middle" className="radar-level">{c.count}</text>}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function LinearControls({ params, setParams }: ControlsProps<LinearParams>) {
  return (
    <ControlGroup title="배치">
      <Segmented label="열 순서 (소속 조합)" value={params.sort} onChange={(sort) => setParams({ sort })} options={[{ value: 'size', label: '원소 수' }, { value: 'degree', label: '겹침 수' }, { value: 'pattern', label: '집합 순서' }]} testId="ctl-sort" />
      <Segmented label="집합 줄 순서" value={params.rowOrder} onChange={(rowOrder) => setParams({ rowOrder })} options={[{ value: 'size', label: '크기순' }, { value: 'original', label: '열 순서' }]} testId="ctl-rows" />
      <Toggle label="열 위 원소 수" checked={params.counts} onChange={(counts) => setParams({ counts })} />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ selected: -1 })} data-testid="lin-clear">선택 해제</button>
      <Hint>집합마다 한 줄이고 소속 조합(벤 다이어그램의 영역)마다 한 열입니다. 열 너비가 그 조합의 원소 수에 비례하므로 줄에 칠해진 구간의 합이 곧 집합 크기입니다. 열을 누르면 그 조합이 어느 집합에 걸쳐 있는지 강조됩니다.</Hint>
    </ControlGroup>
  )
}

export const linearModule: VizModule<LinearParams> = {
  roles: [{ key: 'sets', label: '집합 (0/1 소속 열)', type: 'number', required: true, multiple: { min: 2, max: 8 } }],
  datasets: ['set-members'],
  defaultParams: { sort: 'size', rowOrder: 'size', selected: -1, counts: true },
  Chart: LinearChart,
  Controls: LinearControls,
  hint: '열(소속 조합)을 눌러 강조 · 열 너비가 원소 수입니다',
}

// ───────────────────────────── Force-directed edge bundling ─────────────────────────────

export interface FdebParams { strength: number; cycles: number; threshold: number; mode: 'bundled' | 'straight' | 'both'; opacity: number; weighted: boolean }
const MAX_EDGES = 300

function FdebChart({ table, mapping, params, width, height, compact }: ChartProps<FdebParams>) {
  const cols = ['sx', 'sy', 'tx', 'ty'].map((k) => columnIndex(table, roleColumn(mapping, k)))
  const gcol = columnIndex(table, roleColumn(mapping, 'group')), wcol = columnIndex(table, roleColumn(mapping, 'weight'))
  const ms = useRef(0)
  const model = useMemo(() => {
    if (cols.some((c) => c < 0)) return null
    const raw = table.rows.map((r) => ({ v: cols.map((c) => toNumber(r[c])), g: gcol >= 0 ? toLabel(r[gcol]) : '', w: wcol >= 0 ? toNumber(r[wcol]) ?? 1 : 1 }))
      .filter((e): e is { v: number[]; g: string; w: number } => e.v.every((x) => x != null) && Math.hypot(e.v[0]! - e.v[2]!, e.v[1]! - e.v[3]!) > 0)
    if (raw.length < 2) return null
    const used = raw.length > MAX_EDGES ? Array.from({ length: MAX_EDGES }, (_, k) => raw[Math.floor((k * raw.length) / MAX_EDGES)]) : raw
    const xs = used.flatMap((e) => [e.v[0]!, e.v[2]!]), ys = used.flatMap((e) => [e.v[1]!, e.v[3]!])
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const sc = Math.max(x1 - x0, y1 - y0) || 1
    const edges: Edge2[] = used.map((e) => ({ x0: (e.v[0]! - x0) / sc, y0: (e.v[1]! - y0) / sc, x1: (e.v[2]! - x0) / sc, y1: (e.v[3]! - y0) / sc }))
    return { edges, used, extent: [(x1 - x0) / sc, (y1 - y0) / sc] as [number, number], dropped: raw.length - used.length }
  }, [table, cols.join(','), gcol, wcol]) // eslint-disable-line react-hooks/exhaustive-deps
  const lines = useMemo(() => {
    if (!model || params.mode === 'straight') return null
    const t0 = performance.now()
    const out = bundleEdges(model.edges, { cycles: compact ? 3 : params.cycles, iterations: compact ? 20 : 50, stiffness: params.strength, threshold: params.threshold })
    ms.current = performance.now() - t0
    return out
  }, [model, params.mode, params.strength, params.cycles, params.threshold, compact])
  if (!model) return <ChartMessage>출발·도착의 x, y 열(숫자형 4개)을 선택하세요.</ChartMessage>
  const m = compact ? 6 : 30
  const sc = Math.min((width - 2 * m) / model.extent[0], (height - 2 * m) / model.extent[1])
  const ox = (width - sc * model.extent[0]) / 2, oy = (height - sc * model.extent[1]) / 2
  const px = (p: [number, number]) => [ox + p[0] * sc, oy + (model.extent[1] - p[1]) * sc] as [number, number]
  const groups = [...new Set(model.used.map((e) => e.g))]
  const color = categoryColor(groups)
  const wmax = Math.max(...model.used.map((e) => e.w))
  const curve = d3.line<[number, number]>().x((p) => px(p)[0]).y((p) => px(p)[1]).curve(d3.curveBasis)
  return (
    <div className="chart-root">
      <svg width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Force-Directed Edge Bundling: 간선 ${model.edges.length}개를 힘 기반으로 묶음`}>
        {(params.mode === 'straight' || params.mode === 'both') && model.edges.map((e, i) => <line key={`s${i}`} x1={px([e.x0, e.y0])[0]} y1={px([e.x0, e.y0])[1]} x2={px([e.x1, e.y1])[0]} y2={px([e.x1, e.y1])[1]} stroke={params.mode === 'both' ? '#cfd5da' : color(model.used[i].g)} strokeOpacity={params.mode === 'both' ? 0.5 : params.opacity} strokeWidth={0.7} data-testid="fdeb-straight" />)}
        {lines && (params.mode === 'bundled' || params.mode === 'both') && lines.map((l, i) => <path key={`b${i}`} d={curve(l) ?? ''} fill="none" stroke={color(model.used[i].g)} strokeOpacity={params.opacity} strokeWidth={params.weighted ? 0.6 + 2.4 * (model.used[i].w / wmax) : 1.1} data-testid="fdeb-path" />)}
        {model.edges.map((e, i) => <g key={`n${i}`}><circle cx={px([e.x0, e.y0])[0]} cy={px([e.x0, e.y0])[1]} r={compact ? 1 : 2} fill="#111" fillOpacity={0.5} /><circle cx={px([e.x1, e.y1])[0]} cy={px([e.x1, e.y1])[1]} r={compact ? 1 : 2} fill="#111" fillOpacity={0.5} /></g>)}
        {!compact && lines && <text x={m} y={height - 8} className="radar-level" data-testid="fdeb-readout">간선 {model.edges.length}개{model.dropped ? `(${model.dropped}개는 표본에서 제외)` : ''} · 묶음 계산 {ms.current.toFixed(0)}ms</text>}
      </svg>
      {!compact && <Legend items={groups.filter(Boolean).map((g) => ({ key: g, color: color(g) }))} />}
    </div>
  )
}

function FdebControls({ params, setParams }: ControlsProps<FdebParams>) {
  return (
    <>
      <ControlGroup title="묶음 계산">
        <Slider label="묶음 강도 (스프링이 약할수록 강함)" value={params.strength} min={0.02} max={0.4} step={0.01} onChange={(strength) => setParams({ strength })} format={(v) => v.toFixed(2)} testId="ctl-strength" />
        <Slider label="반복 주기 (세분화 단계)" value={params.cycles} min={2} max={7} onChange={(cycles) => setParams({ cycles })} testId="ctl-cycles" />
        <Slider label="호환성 문턱" value={params.threshold} min={0.3} max={0.9} step={0.05} onChange={(threshold) => setParams({ threshold })} format={(v) => v.toFixed(2)} testId="ctl-threshold" />
        <Hint>서로 호환되는(방향·길이·위치·가시성이 비슷한) 간선끼리만 서로 끌어당깁니다. 각 간선은 점으로 쪼개져 이웃 점과의 스프링과 다른 간선의 같은 번째 점으로 향하는 인력을 받아 움직입니다. 기존 계층형 에지 번들링과 달리 계층 구조 없이 간선의 모양만으로 묶습니다. 간선 300개까지 계산합니다.</Hint>
      </ControlGroup>
      <ControlGroup title="표현">
        <Segmented label="표시" value={params.mode} onChange={(mode) => setParams({ mode })} options={[{ value: 'bundled', label: '묶음' }, { value: 'both', label: '겹쳐 비교' }, { value: 'straight', label: '직선' }]} testId="ctl-mode" />
        <Slider label="불투명도" value={params.opacity} min={0.1} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} />
        <Toggle label="물량에 따라 굵기" checked={params.weighted} onChange={(weighted) => setParams({ weighted })} />
      </ControlGroup>
    </>
  )
}

export const fdebModule: VizModule<FdebParams> = {
  roles: [
    { key: 'sx', label: '출발 x', type: 'number', required: true, prefer: '출발 x' },
    { key: 'sy', label: '출발 y', type: 'number', required: true, prefer: '출발 y' },
    { key: 'tx', label: '도착 x', type: 'number', required: true, prefer: '도착 x' },
    { key: 'ty', label: '도착 y', type: 'number', required: true, prefer: '도착 y' },
    { key: 'group', label: '묶음 이름 (색)', type: 'category', auto: true },
    { key: 'weight', label: '물량 (굵기)', type: 'number', auto: true, prefer: '물량|가중' },
  ],
  datasets: ['flow-edges'],
  defaultParams: { strength: 0.1, cycles: 6, threshold: 0.7, mode: 'bundled', opacity: 0.55, weighted: false },
  Chart: FdebChart,
  Controls: FdebControls,
  hint: '‘겹쳐 비교’로 직선과 묶음을 함께 보세요 · 호환성 문턱을 낮추면 더 많은 선이 한 다발이 됩니다',
}

// ───────────────────────────── Storyline ─────────────────────────────

export interface StoryParams { gap: number; highlight: string; blocks: boolean; labels: boolean }

function StoryChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<StoryParams>) {
  const ecol = roleColumn(mapping, 'entity'), tcol = roleColumn(mapping, 'time'), scol = roleColumn(mapping, 'session')
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const lay = useMemo(() => {
    const ei = columnIndex(table, ecol), ti = columnIndex(table, tcol), si = columnIndex(table, scol)
    if (ei < 0 || ti < 0 || si < 0) return null
    const events = table.rows.map((r) => ({ entity: toLabel(r[ei]), t: toNumber(r[ti]), session: toLabel(r[si]) })).filter((e): e is { entity: string; t: number; session: string } => e.t != null && !!e.entity)
    return events.length ? storylineLayout(events, params.gap) : null
  }, [table, ecol, tcol, scol, params.gap])
  if (!lay) return <ChartMessage>인물, 시점, 모임(장소) 열을 선택하세요.</ChartMessage>
  const entities = [...new Set(lay.points.map((p) => p.entity))]
  const m = compact ? { l: 6, r: 6, t: 6, b: 10 } : { l: 56, r: 24, t: 64, b: 46 }
  const w = width - m.l - m.r, h = height - m.t - m.b
  const x = d3.scaleLinear().domain([lay.times[0], lay.times[lay.times.length - 1]]).range([0, w])
  const y = d3.scaleLinear().domain([-0.5, Math.max(1, lay.height + 0.5)]).range([0, h])
  const color = categoryColor(entities)
  const line = d3.line<{ t: number; y: number }>().x((p) => x(p.t)).y((p) => y(p.y)).curve(d3.curveMonotoneX)
  const sessionsAt = lay.times.map((t) => {
    const at = lay.points.filter((p) => p.t === t)
    return [...new Set(at.map((p) => p.session))].map((s) => { const ys = at.filter((p) => p.session === s).map((p) => p.y); return { t, session: s, y0: Math.min(...ys), y1: Math.max(...ys), n: ys.length } })
  }).flat()
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Storyline Chart: 인물 ${entities.length}명의 ${lay.times.length}개 장면, 모임이 같은 인물의 선이 붙어 지나감, 선 교차 ${lay.crossings}회`} onPointerLeave={hide}>
        <g transform={`translate(${m.l},${m.t})`}>
          {params.blocks && sessionsAt.filter((s) => s.n > 1).map((s, i) => <rect key={i} x={x(s.t) - 7} y={y(s.y0) - 7} width={14} height={y(s.y1) - y(s.y0) + 14} rx={7} fill="#eef1f3" stroke="#d6dbe0" data-testid="story-block" />)}
          {entities.map((e) => {
            const pts = lay.points.filter((p) => p.entity === e).sort((a, b) => a.t - b.t)
            const dim = params.highlight && params.highlight !== e
            return <path key={e} d={line(pts) ?? ''} fill="none" stroke={color(e)} strokeWidth={params.highlight === e ? 4 : compact ? 1.4 : 2.4} strokeOpacity={dim ? 0.15 : 0.95} strokeLinecap="round" data-testid="story-line"
              onPointerEnter={compact ? undefined : (ev) => { const lp = localPoint(svgRef.current!, ev); show(lp.x, lp.y, <><b>{e}</b><br />{pts.length}개 장면에 등장</>) }} onPointerLeave={hide} />
          })}
          {!compact && lay.points.map((p, i) => <circle key={i} cx={x(p.t)} cy={y(p.y)} r={3} fill="#fff" stroke={color(p.entity)} strokeWidth={1.5} strokeOpacity={params.highlight && params.highlight !== p.entity ? 0.15 : 1} fillOpacity={params.highlight && params.highlight !== p.entity ? 0.15 : 1}
            onPointerEnter={(ev) => { const lp = localPoint(svgRef.current!, ev); show(lp.x, lp.y, <><b>{p.entity}</b><br />장면 {fmt(p.t)} · {p.session}</>) }} onPointerLeave={hide} />)}
          {params.labels && !compact && sessionsAt.filter((s) => s.n > 1).map((s, i) => <text key={`l${i}`} x={x(s.t)} y={y(s.y0) - 11} textAnchor="middle" className="radar-level">{s.session}</text>)}
          <AxisBottom scale={x} y={h + 6} compact={compact} label="장면" />
        </g>
      </svg>
      {!compact && <Legend items={entities.map((e) => ({ key: e, color: color(e) }))} hidden={params.highlight ? entities.filter((e) => e !== params.highlight) : []} onToggle={(k) => setParams({ highlight: params.highlight === k ? '' : k })} />}
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function StoryControls({ params, setParams }: ControlsProps<StoryParams>) {
  return (
    <ControlGroup title="스토리라인">
      <Slider label="모임 사이 간격" value={params.gap} min={0.2} max={2.5} step={0.1} onChange={(gap) => setParams({ gap })} format={(v) => v.toFixed(1)} testId="ctl-gap" />
      <Toggle label="모임 묶음 표시" checked={params.blocks} onChange={(blocks) => setParams({ blocks })} testId="ctl-blocks" />
      <Toggle label="모임(장소) 이름" checked={params.labels} onChange={(labels) => setParams({ labels })} />
      <Hint>세로 방향은 순서일 뿐 값이 아닙니다. 같은 모임의 인물은 한 장면에서 서로 붙어 지나가고, 헤어지면 선이 갈라집니다. 각 장면에서 모임은 직전 장면의 평균 위치 순서로 놓아 선의 교차를 줄입니다. 범례를 눌러 한 인물을 강조하세요.</Hint>
    </ControlGroup>
  )
}

export const storyModule: VizModule<StoryParams> = {
  roles: [
    { key: 'entity', label: '인물(선)', type: 'category', required: true, prefer: '인물|개체' },
    { key: 'time', label: '시점(장면)', type: 'number', required: true, prefer: '장면|시점|시간' },
    { key: 'session', label: '모임(장소)', type: 'category', required: true, prefer: '장소|모임' },
  ],
  datasets: ['story-scenes'],
  defaultParams: { gap: 1, highlight: '', blocks: true, labels: true },
  Chart: StoryChart,
  Controls: StoryControls,
  hint: '범례로 한 인물을 강조 · 같은 장소의 선이 붙어 지나갑니다',
}
