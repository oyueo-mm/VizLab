import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Legend, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Select, Slider, Toggle } from '../../components/controls'
import { categoryColor } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { fitReference, ksStatistic, ppDists, ppPoints, ppPositions, type PPDist, type PPPosition } from '../../stats/pp'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { groupedValues } from './shared'

export interface PPParams {
  dist: PPDist
  position: PPPosition
  size: number
  diagonal: boolean
  band: boolean
}

function PPChart({ table, mapping, params, width, height, compact, linked }: ChartProps<PPParams>) {
  const valueCol = roleColumn(mapping, 'value')
  const groupCol = roleColumn(mapping, 'group')
  const groups = useMemo(() => groupedValues(table, valueCol, groupCol), [table, valueCol, groupCol])
  const color = useMemo(() => categoryColor(groups.map((g) => g.key)), [groups])
  const fits = useMemo(() => groups.map((g) => {
    const { ref, reason } = fitReference(g.values, params.dist)
    return { g, ref, reason, pts: ref ? ppPoints(g.values.map((value, k) => ({ row: g.rows[k], value })), ref, params.position) : [], ks: ref ? ksStatistic(g.values, ref) : NaN }
  }), [groups, params.dist, params.position])
  const m = margins(compact, compact ? {} : { right: 30 })
  const side = Math.max(10, Math.min(width - m.left - m.right, height - m.top - m.bottom))
  const svgRef = useRef<SVGSVGElement>(null)
  const { tip, show, hide } = useTooltip()
  const x = d3.scaleLinear().domain([0, 1]).range([0, side])
  const y = d3.scaleLinear().domain([0, 1]).range([side, 0])
  const ox = Math.max(0, (width - m.left - m.right - side) / 2)
  const marked = new Set(linked?.rows ?? [])

  if (!valueCol) return <ChartMessage>값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!groups.length) return <ChartMessage>표본이 없습니다. 숫자 값을 입력하세요.</ChartMessage>
  const failed = fits.find((f) => !f.ref)
  if (fits.every((f) => !f.ref)) return <ChartMessage>{failed?.reason ?? '기준 분포를 맞출 수 없습니다.'}<small>다른 기준 분포를 고르거나 데이터를 바꿔 보세요.</small></ChartMessage>
  const r = compact ? 1.6 : params.size
  const n0 = fits[0]
  // Approximate 95 % KS acceptance band around the diagonal: ±1.36/√n.
  const half = n0.g.values.length ? 1.36 / Math.sqrt(n0.g.values.length) : 0

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`P-P 플롯: ${valueCol}의 경험적 누적확률과 ${ppDists.find((d) => d.value === params.dist)?.label} 누적확률`} onPointerLeave={hide}>
        <g transform={`translate(${m.left + ox},${m.top})`}>
          <AxisBottom scale={x} y={side} grid={side} label={compact ? undefined : '기준 분포의 누적확률 F(x)'} compact={compact} ticks={5} />
          <AxisLeft scale={y} x={0} grid={side} label={compact ? undefined : '경험적 누적확률 F̂(x)'} compact={compact} ticks={5} />
          {params.band && !compact && fits.length === 1 && <path d={`M0,${y(0)}L${x(Math.max(0, 1 - half))},${y(1)}L${x(1)},${y(1)}L${x(1)},${y(Math.max(0, 1 - half))}L${x(half)},${y(0)}Z`} fill="#1f6f66" fillOpacity={0.07} stroke="none" aria-hidden="true" />}
          {params.diagonal && <line className="qq-line" x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="#8a9692" aria-hidden="true" />}
          {fits.map((f) => f.pts.map((p) => (
            <circle key={`${f.g.key}${p.row}`} className="mark-point" cx={x(p.reference)} cy={y(p.empirical)} r={marked.has(p.row) ? r + 2.5 : r} fill={marked.has(p.row) ? '#e07a3f' : color(f.g.key)} fillOpacity={0.75} stroke="#fff" strokeWidth={marked.has(p.row) ? 1.5 : 0.6} data-testid="pp-point"
              onPointerEnter={compact ? undefined : (e) => {
                linked?.set([p.row])
                const lp = localPoint(svgRef.current!, e)
                show(lp.x, lp.y, <><b>{valueCol} = {fmt(p.value)}</b><br />경험적 누적확률 {fmt(p.empirical, 3)}<br />기준 누적확률 {fmt(p.reference, 3)}<br />차이 {fmt(p.empirical - p.reference, 3)}</>)
              }} onPointerLeave={() => { linked?.set(null); hide() }} />
          )))}
        </g>
      </svg>
      {!compact && (
        <>
          {groupCol && <Legend items={groups.map((g) => ({ key: g.key, color: color(g.key) }))} title={groupCol} />}
          <Readout items={[
            { label: '기준 분포', value: fits.length === 1 ? (n0.ref?.label ?? '–') : ppDists.find((d) => d.value === params.dist)?.label ?? '' },
            { label: 'n', value: fits.reduce((s, f) => s + f.g.values.length, 0).toLocaleString() },
            ...(fits.length === 1 ? [{ label: '최대 격차 D', value: fmt(n0.ks, 3) }] : []),
          ]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function PPControls({ params, setParams }: ControlsProps<PPParams>) {
  const pos = ppPositions.find((p) => p.value === params.position)
  return (
    <>
      <ControlGroup title="기준 분포">
        <Select label="기준 분포" value={params.dist} onChange={(dist) => setParams({ dist })} options={ppDists} testId="ctl-dist" />
        <Hint>기준 분포의 모수는 표본에서 최대가능도로 추정합니다(정규: 평균·표준편차, 균등: 최솟값·최댓값, 지수: 평균의 역수, 로그정규: 로그의 평균·표준편차).</Hint>
      </ControlGroup>
      <ControlGroup title="표현">
        <Select label="경험적 확률 계산" value={params.position} onChange={(position) => setParams({ position })} options={ppPositions.map((p) => ({ value: p.value, label: p.label }))} testId="ctl-position" />
        {pos && <Hint>{pos.hint}</Hint>}
        <Toggle label="기준 대각선 y = x" checked={params.diagonal} onChange={(diagonal) => setParams({ diagonal })} testId="ctl-diagonal" />
        <Toggle label="KS 허용 띠 (95%)" description="그룹이 하나일 때만 표시. 점이 이 띠를 벗어나면 적합이 나쁘다는 신호입니다" checked={params.band} onChange={(band) => setParams({ band })} testId="ctl-band" />
        <Slider label="점 크기" value={params.size} min={1.5} max={7} step={0.5} onChange={(size) => setParams({ size })} />
      </ControlGroup>
      <ControlGroup title="Q-Q 플롯과의 차이" defaultOpen={false}>
        <Hint>P-P 플롯은 누적확률(0–1)끼리, Q-Q 플롯은 분위수(실제 값의 단위)끼리 짝지어 찍습니다. P-P는 분포의 중앙부 차이에, Q-Q는 꼬리 차이에 더 민감합니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const ppModule: VizModule<PPParams> = {
  roles: [
    { key: 'value', label: '값', type: 'number', required: true },
    { key: 'group', label: '그룹 (선택)', type: 'category' },
  ],
  datasets: ['normal', 'skewed', 'uniform', 'bimodal', 'groups'],
  defaultParams: { dist: 'normal', position: 'hazen', size: 3.5, diagonal: true, band: true },
  Chart: PPChart,
  Controls: PPControls,
  hint: '기준 분포를 바꿔 점이 대각선에서 벗어나는 모양을 비교 · 점에 마우스를 올려 두 확률 확인',
}
