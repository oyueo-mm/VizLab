import * as d3 from 'd3'
import { Trash2 } from 'lucide-react'
import { useMemo, useRef, type PointerEvent } from 'react'
import { ChartMessage, Readout, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Select, Toggle } from '../../components/controls'
import { columnIndex, removeRows, toLabel, type DataTable } from '../../data/table'
import { fmt } from '../../lib/format'
import { barycenterOrder, buildBipartite, crossings } from '../../stats/graphs'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'
import { edgeRoles, edgeRows } from './networkShared'

export interface BipartiteParams {
  order: 'data' | 'name' | 'degree' | 'barycenter' | 'manual'
  /** Node order the user set by dragging (used when order = 'manual'). */
  manualLeft: string[]
  manualRight: string[]
  widthBy: 'weight' | 'fixed'
  curve: boolean
  selected: string
}

const LEFT = '#2a7d74'
const RIGHT = '#c4631f'

/** Applies the chosen ordering to both sides. */
function orderSides(bp: ReturnType<typeof buildBipartite>, params: BipartiteParams) {
  const deg = (side: 'a' | 'b') => { const m = new Map<string, number>(); for (const e of bp.edges) m.set(e[side], (m.get(e[side]) ?? 0) + e.weight); return m }
  const byDeg = (list: string[], m: Map<string, number>) => [...list].sort((x, y) => (m.get(y) ?? 0) - (m.get(x) ?? 0) || x.localeCompare(y, 'ko'))
  if (params.order === 'name') return { left: [...bp.left].sort((a, b) => a.localeCompare(b, 'ko')), right: [...bp.right].sort((a, b) => a.localeCompare(b, 'ko')) }
  if (params.order === 'degree') return { left: byDeg(bp.left, deg('a')), right: byDeg(bp.right, deg('b')) }
  if (params.order === 'barycenter') return barycenterOrder(bp)
  if (params.order === 'manual') {
    const fix = (saved: string[], all: string[]) => [...saved.filter((n) => all.includes(n)), ...all.filter((n) => !saved.includes(n))]
    return { left: fix(params.manualLeft, bp.left), right: fix(params.manualRight, bp.right) }
  }
  return { left: bp.left, right: bp.right }
}

function removeNode(table: DataTable, mapping: Mapping, name: string) {
  const si = columnIndex(table, roleColumn(mapping, 'source'))
  const ti = columnIndex(table, roleColumn(mapping, 'target'))
  return removeRows(table, table.rows.map((r, i) => (toLabel(r[si]).trim() === name || toLabel(r[ti]).trim() === name ? i : -1)).filter((i) => i >= 0))
}

function BipartiteChart({ table, mapping, params, setParams, width, height, compact, onTableChange, linked }: ChartProps<BipartiteParams>) {
  const rows = useMemo(() => edgeRows(table, mapping), [table, mapping])
  const bp = useMemo(() => buildBipartite(rows), [rows])
  const { left, right } = useMemo(() => orderSides(bp, params), [bp, params])
  const cross = useMemo(() => crossings(bp.edges, left, right), [bp, left, right])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ side: 'left' | 'right'; name: string } | null>(null)
  const marked = new Set(linked?.rows ?? [])
  const editable = !!onTableChange && !compact
  const nameW = compact ? 0 : Math.min(130, width * 0.2)
  const pad = compact ? 6 : 28
  const iw = Math.max(40, width - 2 * nameW - 2 * pad)
  const ih = Math.max(40, height - 2 * pad - (compact ? 0 : 12))
  const rowsMax = Math.max(left.length, right.length, 1)
  const wmax = d3.max(bp.edges, (e) => e.weight) || 1
  const yL = (n: string) => pad + ((left.indexOf(n) + 0.5) / Math.max(1, left.length)) * ih
  const yR = (n: string) => pad + ((right.indexOf(n) + 0.5) / Math.max(1, right.length)) * ih
  const x0 = nameW + pad
  const x1 = x0 + iw
  const sel = params.selected
  const ew = (w: number) => (params.widthBy === 'weight' ? Math.max(0.6, (compact ? 3 : 7) * (w / wmax)) : compact ? 0.8 : 1.6)
  const nodeR = compact ? 2 : Math.max(3, Math.min(8, (ih / rowsMax) * 0.28))

  if (!roleColumn(mapping, 'source') || !roleColumn(mapping, 'target')) return <ChartMessage>왼쪽 집합(출발)과 오른쪽 집합(도착) 열을 선택하세요.</ChartMessage>
  if (!bp.edges.length) return <ChartMessage>두 집합 사이의 연결이 없습니다.<small>왼쪽 열과 오른쪽 열의 값이 서로 달라야 합니다.</small></ChartMessage>

  const path = (a: number, b: number) => (params.curve ? `M${x0},${a}C${x0 + iw * 0.5},${a} ${x1 - iw * 0.5},${b} ${x1},${b}` : `M${x0},${a}L${x1},${b}`)
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    const y = localPoint(svgRef.current!, e).y
    const list = d.side === 'left' ? left : right
    const to = Math.max(0, Math.min(list.length - 1, Math.floor(((y - pad) / ih) * list.length)))
    const next = list.filter((n) => n !== d.name)
    next.splice(to, 0, d.name)
    setParams(d.side === 'left' ? { order: 'manual', manualLeft: next, manualRight: right } : { order: 'manual', manualLeft: left, manualRight: next })
  }
  const nodeRow = (name: string) => bp.edges.filter((e) => e.a === name || e.b === name).flatMap((e) => e.rows)

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`이분 그래프: 왼쪽 ${left.length}개, 오른쪽 ${right.length}개, 연결 ${bp.edges.length}개`} style={{ touchAction: editable ? 'none' : undefined }}
        onPointerMove={move} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onPointerLeave={() => { hide(); linked?.set(null) }}
        onKeyDown={(e) => { if (editable && sel && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); onTableChange!(removeNode(table, mapping, sel)); setParams({ selected: '' }) } }} tabIndex={editable ? 0 : undefined}>
        <g>
          {bp.edges.map((e) => {
            const on = sel ? e.a === sel || e.b === sel : false
            const mk = e.rows.some((r) => marked.has(r))
            const dim = sel && !on
            return (
              <path key={`${e.a}>${e.b}`} data-testid="bip-edge" data-a={e.a} data-b={e.b} data-weight={e.weight} d={path(yL(e.a), yR(e.b))} fill="none" stroke={on || mk ? '#e07a3f' : '#7f8f8a'} strokeOpacity={dim ? 0.1 : on || mk ? 0.9 : 0.45} strokeWidth={ew(e.weight)}
                onPointerEnter={compact ? undefined : (ev) => { linked?.set(e.rows); const p = localPoint(svgRef.current!, ev); show(p.x, p.y, <><b>{e.a} – {e.b}</b><br />가중치 {fmt(e.weight)}</>) }} onPointerLeave={() => { hide(); linked?.set(null) }} />
            )
          })}
          {([['left', left, LEFT, x0, yL], ['right', right, RIGHT, x1, yR]] as const).map(([side, list, color, x, yf]) => list.map((n) => {
            const on = sel === n || (sel && bp.edges.some((e) => (e.a === sel && e.b === n) || (e.b === sel && e.a === n)))
            return (
              <g key={`${side}${n}`} data-testid="bip-node" data-side={side} data-name={n} style={{ cursor: editable ? 'grab' : compact ? undefined : 'pointer' }}
                onPointerDown={editable ? (e) => { svgRef.current!.setPointerCapture(e.pointerId); drag.current = { side, name: n }; setParams({ selected: n }); hide() } : undefined}
                onClick={compact || editable ? undefined : () => setParams({ selected: sel === n ? '' : n })}
                onPointerEnter={compact ? undefined : (e) => { if (drag.current) return; linked?.set(nodeRow(n)); const p = localPoint(svgRef.current!, e); show(p.x, p.y, <><b>{n}</b> <small>{side === 'left' ? '왼쪽 집합' : '오른쪽 집합'}</small><br />연결 {bp.edges.filter((e2) => e2.a === n || e2.b === n).length}개 · 가중치 합 {fmt(d3.sum(bp.edges.filter((e2) => e2.a === n || e2.b === n), (e2) => e2.weight))}{editable ? <><br />위아래로 끌어 순서 변경</> : null}</>) }}
                onPointerLeave={() => { hide(); linked?.set(null) }}>
                <circle cx={x} cy={yf(n)} r={sel === n ? nodeR + 2 : nodeR} fill={color} fillOpacity={sel && !on ? 0.3 : 1} stroke={sel === n ? '#121816' : '#ffffff'} strokeWidth={sel === n ? 2 : 1} />
                {!compact && <text x={side === 'left' ? x - nodeR - 6 : x + nodeR + 6} y={yf(n)} dy="0.34em" textAnchor={side === 'left' ? 'end' : 'start'} fontSize={Math.max(9, Math.min(12, (ih / rowsMax) * 0.7))} fillOpacity={sel && !on ? 0.35 : 1} fontWeight={sel === n ? 700 : 400}>{n.length > 14 ? `${n.slice(0, 13)}…` : n}</text>}
              </g>
            )
          }))}
        </g>
      </svg>
      {!compact && (
        <>
          <Readout items={[{ label: '왼쪽', value: left.length }, { label: '오른쪽', value: right.length }, { label: '연결', value: bp.edges.length }, { label: '교차', value: cross }]} />
          {bp.issues.length > 0 && <p className="chart-warning" role="status">{bp.issues.slice(0, 2).map((i) => i.text).join(' ')}{bp.issues.length > 2 ? ` 외 ${bp.issues.length - 2}건` : ''} 해당 노드는 그리지 않았습니다.</p>}
          {editable && sel && <div className="chart-actions" style={{ bottom: 6, right: 8 }}><span>{sel}</span><button type="button" onClick={() => { onTableChange!(removeNode(table, mapping, sel)); setParams({ selected: '' }) }} data-testid="bip-delete"><Trash2 size={14} aria-hidden="true" />노드 삭제</button></div>}
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function BipartiteControls({ params, setParams, table, mapping }: ControlsProps<BipartiteParams>) {
  const rows = useMemo(() => edgeRows(table, mapping), [table, mapping])
  const bp = useMemo(() => buildBipartite(rows), [rows])
  const results = useMemo(() => (['data', 'name', 'degree', 'barycenter'] as const).map((o) => { const s = orderSides(bp, { ...params, order: o }); return [o, crossings(bp.edges, s.left, s.right)] as const }), [bp, params])
  return (
    <>
      <ControlGroup title="배치">
        <Select label="노드 순서" value={params.order} onChange={(order) => setParams({ order })} testId="ctl-bip-order"
          options={[{ value: 'data', label: '입력 순서' }, { value: 'name', label: '이름순' }, { value: 'degree', label: '연결 가중치 합순' }, { value: 'barycenter', label: '교차 줄이기 (무게중심)' }, { value: 'manual', label: '직접 배치(끌어서)' }]} />
        <Hint>무게중심 방식은 각 노드를 이웃 노드 위치의 평균 가까이에 놓기를 반복해 선이 교차하는 횟수를 줄이는 휴리스틱입니다. 최소 교차를 보장하지는 않습니다. 노드를 위아래로 끌면 ‘직접 배치’가 됩니다.</Hint>
        <Select label="선 굵기" value={params.widthBy} onChange={(widthBy) => setParams({ widthBy })} options={[{ value: 'weight', label: '가중치' }, { value: 'fixed', label: '일정' }]} />
        <Toggle label="곡선으로 그리기" checked={params.curve} onChange={(curve) => setParams({ curve })} />
      </ControlGroup>
      <ControlGroup title="순서별 선 교차 수">
        <ul className="issue-list" style={{ listStyle: 'none', paddingLeft: 0 }}>{results.map(([o, c]) => <li key={o}>{{ data: '입력 순서', name: '이름순', degree: '가중치 합순', barycenter: '무게중심' }[o]}: <b>{c}</b></li>)}</ul>
      </ControlGroup>
      {bp.issues.length > 0 && <ControlGroup title="집합 구조 문제"><ul className="issue-list">{bp.issues.map((i) => <li key={i.node}>{i.text}</li>)}</ul></ControlGroup>}
    </>
  )
}

export const bipartiteModule: VizModule<BipartiteParams> = {
  roles: edgeRoles.filter((r) => r.key !== 'group').map((r) => (r.key === 'source' ? { ...r, label: '왼쪽 집합 (예: 사람)' } : r.key === 'target' ? { ...r, label: '오른쪽 집합 (예: 모임)' } : r)),
  datasets: ['affiliations'],
  defaultParams: { order: 'barycenter', manualLeft: [], manualRight: [], widthBy: 'weight', curve: true, selected: '' },
  Chart: BipartiteChart,
  Controls: BipartiteControls,
  hint: '노드를 위아래로 끌어 순서 변경 · 노드를 선택(Delete)하면 연결된 행이 삭제 · 양쪽 집합에 같은 이름이 있으면 경고 · 무게중심 정렬로 교차 줄이기',
}
