import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { ChartMessage, Legend, Readout, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { categoryColor } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { hiveLayout, type HiveAxisRule, type HivePosition } from '../../stats/graphs'
import { buildNetwork } from '../../stats/network'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { edgeRoles, edgeRows } from './networkShared'

export interface HiveParams {
  axes: 2 | 3 | 4
  rule: HiveAxisRule
  position: HivePosition
  edgeOpacity: number
  labels: boolean
  selected: string
}

const RULES: { value: HiveAxisRule; label: string; hint: string }[] = [
  { value: 'group', label: '그룹', hint: '그룹 이름 가나다순으로 축에 배정합니다. 그룹이 축보다 많으면 나머지 그룹은 마지막 축에 함께 놓입니다.' },
  { value: 'degree', label: '연결 수 구간', hint: '연결 수가 비슷한 노드끼리 같은 수의 노드로 나눈 구간별로 축을 배정합니다.' },
  { value: 'component', label: '연결 성분', hint: '서로 이어진 덩어리(연결 성분)를 큰 순서대로 축에 배정합니다. 성분이 축보다 많으면 나머지는 마지막 축에 놓입니다.' },
]
const POSITIONS: { value: HivePosition; label: string }[] = [{ value: 'degree', label: '연결 수' }, { value: 'strength', label: '연결 강도(가중치 합)' }, { value: 'name', label: '이름순' }]

const polar = (angle: number, r: number): [number, number] => [Math.cos(angle) * r, Math.sin(angle) * r]

function HiveChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<HiveParams>) {
  const rows = useMemo(() => edgeRows(table, mapping), [table, mapping])
  const net = useMemo(() => buildNetwork(rows), [rows])
  const layout = useMemo(() => hiveLayout(net, params.axes, params.rule, params.position), [net, params.axes, params.rule, params.position])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const marked = new Set(linked?.rows ?? [])
  const pad = compact ? 6 : 44
  const R = Math.max(30, Math.min(width, height) / 2 - pad)
  const r0 = R * 0.1
  const k = params.axes
  // Axes start at the top and go clockwise. With two axes they point left and right so the plot reads as a bipartite layout.
  const angleOf = (axis: number) => (k === 2 ? (axis === 0 ? Math.PI : 0) : -Math.PI / 2 + (axis * 2 * Math.PI) / k)
  const colors = useMemo(() => categoryColor(d3.range(k).map(String)), [k])
  const pos = useMemo(() => new Map(layout.map((n) => [n.id, { axis: n.axis, r: r0 + n.t * (R - r0), angle: angleOf(n.axis) }])), [layout, R, r0, k]) // eslint-disable-line react-hooks/exhaustive-deps
  const nodeById = new Map(net.nodes.map((n) => [n.id, n]))
  const sel = params.selected

  const axisLabel = (a: number) => {
    const on = layout.filter((n) => n.axis === a)
    if (params.rule === 'group') { const g = [...new Set(net.nodes.map((n) => n.group || '(없음)'))].sort((x, y) => x.localeCompare(y, 'ko')); return a === k - 1 && g.length > k ? `${g.slice(k - 1).join('·')}` : g[a] ?? `축 ${a + 1}` }
    if (params.rule === 'degree') return `연결 ${['적음', '중간', '많음', '최다'][k === 2 ? [0, 3][a] : a]} (${on.length}개)`
    return `성분 ${a + 1} (${on.length}개)`
  }

  if (!roleColumn(mapping, 'source') || !roleColumn(mapping, 'target')) return <ChartMessage>출발·도착 노드(범주형) 열을 선택하세요.</ChartMessage>
  if (net.nodes.length < 3 || !net.links.length) return <ChartMessage>노드 3개와 연결 1개 이상이 필요합니다.</ChartMessage>

  const wmax = d3.max(net.links, (l) => l.weight) || 1
  const edgePath = (a: string, b: string) => {
    const A = pos.get(a); const B = pos.get(b)
    if (!A || !B) return null
    const P = polar(A.angle, A.r); const Q = polar(B.angle, B.r)
    if (A.axis === B.axis) {
      // Same axis: bow outward, so it does not run through the centre.
      const mid = polar(A.angle + 0.5, (A.r + B.r) / 2 + R * 0.08)
      return `M${P}Q${mid} ${Q}`
    }
    let da = B.angle - A.angle
    while (da > Math.PI) da -= 2 * Math.PI
    while (da < -Math.PI) da += 2 * Math.PI
    const c1 = polar(A.angle + da / 3, A.r)
    const c2 = polar(B.angle - da / 3, B.r)
    return `M${P}C${c1} ${c2} ${Q}`
  }
  const touching = (id: string) => net.links.filter((l) => l.source === id || l.target === id)
  const neighbor = new Set(sel ? touching(sel).flatMap((l) => [l.source, l.target]) : [])

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`하이브 플롯: 축 ${k}개, 노드 ${net.nodes.length}개, 연결 ${net.links.length}개`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${width / 2},${height / 2})`}>
          {d3.range(k).map((a) => {
            const [x, y] = polar(angleOf(a), R)
            const [lx, ly] = polar(angleOf(a), R + 16)
            return (
              <g key={a} data-testid="hive-axis" data-axis={a} aria-hidden="true">
                <line x1={polar(angleOf(a), r0)[0]} y1={polar(angleOf(a), r0)[1]} x2={x} y2={y} stroke={colors(String(a))} strokeWidth={2.4} strokeLinecap="round" />
                {!compact && <text x={lx} y={ly} textAnchor={Math.abs(lx) < 8 ? 'middle' : lx > 0 ? 'start' : 'end'} dy={ly > 8 ? '0.8em' : ly < -8 ? '-0.2em' : '0.34em'} fontSize={11} fill={colors(String(a))} fontWeight={600}>{axisLabel(a)}</text>}
              </g>
            )
          })}
          {net.links.map((l) => {
            const d = edgePath(l.source, l.target)
            if (!d) return null
            const on = sel ? l.source === sel || l.target === sel : false
            const mk = l.rows.some((r) => marked.has(r))
            const A = pos.get(l.source)!
            return <path key={`${l.source}>${l.target}`} data-testid="hive-edge" data-source={l.source} data-target={l.target} d={d} fill="none" stroke={on || mk ? '#e07a3f' : colors(String(A.axis))} strokeOpacity={sel && !on ? 0.05 : on || mk ? 0.95 : params.edgeOpacity} strokeWidth={Math.max(0.5, (compact ? 1.2 : 2.6) * (l.weight / wmax) + 0.4)}
              onPointerEnter={compact ? undefined : (e) => { linked?.set(l.rows); const p = localPoint(svgRef.current!, e); show(p.x, p.y, <><b>{l.source} – {l.target}</b><br />가중치 {fmt(l.weight)}</>) }} onPointerLeave={() => { hide(); linked?.set(null) }} />
          })}
          {layout.map((h) => {
            const p = pos.get(h.id)!
            const [x, y] = polar(p.angle, p.r)
            const n = nodeById.get(h.id)!
            const on = sel === h.id
            const dim = sel && !on && !neighbor.has(h.id)
            return (
              <g key={h.id} data-testid="hive-node" data-id={h.id} data-axis={h.axis} data-t={h.t.toFixed(4)} style={{ cursor: compact ? undefined : 'pointer' }}
                onClick={compact ? undefined : () => setParams({ selected: on ? '' : h.id })}
                onPointerEnter={compact ? undefined : (e) => { linked?.set(n.rows); const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{h.id}</b>{n.group ? ` · ${n.group}` : ''}<br />연결 {n.degree}개 · 가중치 합 {fmt(n.strength)}<br />축 {h.axis + 1} · 위치 {fmt(h.t * 100, 0)}%</>) }} onPointerLeave={() => { hide(); linked?.set(null) }}>
                <circle cx={x} cy={y} r={on ? 7 : compact ? 2 : 4.5} fill={colors(String(h.axis))} fillOpacity={dim ? 0.25 : 1} stroke={on ? '#121816' : '#ffffff'} strokeWidth={on ? 2 : 1} />
                {params.labels && !compact && (on || neighbor.has(h.id) || net.nodes.length <= 30) && <text x={x + (Math.cos(p.angle) >= 0 ? 8 : -8)} y={y} dy="0.34em" textAnchor={Math.cos(p.angle) >= 0 ? 'start' : 'end'} fontSize={10.5} fillOpacity={dim ? 0.3 : 1} pointerEvents="none">{h.id.length > 12 ? `${h.id.slice(0, 11)}…` : h.id}</text>}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          <Legend items={d3.range(k).map((a) => ({ key: axisLabel(a), color: colors(String(a)) }))} />
          <Readout items={[{ label: '노드', value: net.nodes.length }, { label: '연결', value: net.links.length }, { label: '같은 축 연결', value: net.links.filter((l) => pos.get(l.source)?.axis === pos.get(l.target)?.axis).length }]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function HiveControls({ params, setParams }: ControlsProps<HiveParams>) {
  const rule = RULES.find((r) => r.value === params.rule)
  return (
    <>
      <ControlGroup title="축 규칙">
        <Segmented label="축 개수" value={String(params.axes)} onChange={(v) => setParams({ axes: Number(v) as HiveParams['axes'] })} testId="ctl-hive-axes" options={[{ value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' }]} />
        <Select label="노드를 축에 나누는 기준" value={params.rule} onChange={(rule) => setParams({ rule })} testId="ctl-hive-rule" options={RULES.map((r) => ({ value: r.value, label: r.label }))} />
        {rule && <Hint>{rule.hint}</Hint>}
        <Select label="축 위의 위치(중심에서 멀수록 큼)" value={params.position} onChange={(position) => setParams({ position })} testId="ctl-hive-pos" options={POSITIONS} />
        <Hint>위치는 값 그 자체가 아니라 축 안에서의 순위를 0~100%로 펼친 것입니다. 힘 기반 배치와 달리 계산에 난수가 없어 같은 데이터는 항상 같은 그림이 됩니다. 노드의 위치가 임의가 아니라 속성으로 정해지므로 축 사이 연결의 모양을 서로 비교할 수 있습니다.</Hint>
      </ControlGroup>
      <ControlGroup title="표시">
        <Slider label="연결선 불투명도" value={params.edgeOpacity} min={0.05} max={1} step={0.05} onChange={(edgeOpacity) => setParams({ edgeOpacity })} format={(v) => v.toFixed(2)} />
        <Toggle label="노드 이름 표시" checked={params.labels} onChange={(labels) => setParams({ labels })} />
      </ControlGroup>
    </>
  )
}

export const hiveModule: VizModule<HiveParams> = {
  roles: edgeRoles,
  datasets: ['network', 'modules', 'energy'],
  defaultParams: { axes: 3, rule: 'group', position: 'degree', edgeOpacity: 0.4, labels: true, selected: '' },
  Chart: HiveChart,
  Controls: HiveControls,
  hint: '노드를 클릭해 연결 강조 · 축 개수와 배정 규칙·축 위 위치를 바꿔 구조 비교 · 난수가 없어 항상 같은 배치',
}
