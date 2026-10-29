import * as d3 from 'd3'
import { useMemo, useRef, useState } from 'react'
import { ChartMessage, Legend, Tooltip, localPoint, toggleIn, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider } from '../../components/controls'
import { colorAt, textOn } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { useTween } from '../../hooks/motion'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { crossTab } from './shared'

export interface PieParams {
  inner: number
  padAngle: number
  sort: 'none' | 'desc'
  labels: 'percent' | 'value' | 'name' | 'none'
  other: number
  start: number
  hidden: string[]
}

const OTHER = '기타'

/** Category totals, optionally folding slices below `threshold` share into one '기타' slice. */
export function pieSlices(cats: string[], value: (c: string) => number, hidden: string[], threshold: number) {
  const vis = cats.filter((c) => !hidden.includes(c)).map((c) => ({ key: c, value: value(c) }))
  const total = d3.sum(vis, (d) => d.value)
  if (threshold <= 0 || !total) return { slices: vis, total }
  const small = vis.filter((d) => d.value / total < threshold)
  if (small.length < 2) return { slices: vis, total }
  return { slices: [...vis.filter((d) => d.value / total >= threshold), { key: OTHER, value: d3.sum(small, (d) => d.value) }], total }
}

function PieChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<PieParams>) {
  const catCol = roleColumn(mapping, 'category')
  const valueCol = roleColumn(mapping, 'value')
  const tab = useMemo(() => crossTab(table, catCol, null, valueCol), [table, catCol, valueCol])
  const svgRef = useRef<SVGSVGElement>(null)
  const [active, setActive] = useState<string | null>(null)
  const { tip, show, hide } = useTooltip()
  const negative = tab.cats.some((c) => tab.value(c, '') < 0)
  const { slices, total } = useMemo(() => pieSlices(tab.cats, (c) => tab.value(c, ''), params.hidden, params.other), [tab, params.hidden, params.other])
  const colorKeys = [...tab.cats, OTHER]
  const color = (k: string) => (k === OTHER ? '#9ca3af' : colorAt(colorKeys.indexOf(k)))
  const arcs = useMemo(() => {
    const pie = d3.pie<{ key: string; value: number }>().value((d) => d.value).padAngle(params.padAngle)
      .startAngle((params.start * Math.PI) / 180).endAngle((params.start * Math.PI) / 180 + 2 * Math.PI)
    if (params.sort === 'desc') pie.sort((a, b) => b.value - a.value)
    else pie.sort(null)
    return pie(slices)
  }, [slices, params.padAngle, params.sort, params.start])
  // Tween angles keyed by category so slices grow/shrink in place.
  const keys = useMemo(() => [...tab.cats, OTHER], [tab.cats])
  const target = useMemo(() => keys.map((k) => {
    const a = arcs.find((d) => d.data.key === k)
    if (a) return [a.startAngle, a.endAngle]
    // Hidden slices collapse to a zero-width wedge at the angle of their neighbour.
    const prev = arcs.find((d) => keys.indexOf(d.data.key) > keys.indexOf(k))
    const ang = prev ? prev.startAngle : (params.start * Math.PI) / 180 + 2 * Math.PI
    return [ang, ang]
  }), [arcs, keys, params.start])
  const shown = useTween(target, { enabled: !compact, snapKey: params.sort })

  if (!catCol || !valueCol) return <ChartMessage>범주와 값 열을 선택하세요.</ChartMessage>
  if (negative) return <ChartMessage>원 차트는 음수 값을 표현할 수 없습니다. 음수인 범주의 값을 수정하세요.</ChartMessage>
  if (!total) return <ChartMessage>값의 합계가 0입니다.</ChartMessage>

  const legendH = 0
  const r = Math.max(10, Math.min(width, height - legendH) / 2 - (compact ? 4 : 36))
  const arc = d3.arc<{ startAngle: number; endAngle: number }>().innerRadius(r * params.inner).outerRadius(r).cornerRadius(params.padAngle > 0 ? 2 : 0)
  const labelArc = d3.arc<{ startAngle: number; endAngle: number }>().innerRadius(params.inner > 0 ? r * (params.inner + (1 - params.inner) / 2) : r * 0.62).outerRadius(params.inner > 0 ? r * (params.inner + (1 - params.inner) / 2) : r * 0.62)

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`원 차트: ${catCol}별 ${valueCol} 비율`} onPointerLeave={() => { hide(); setActive(null) }}>
        <g transform={`translate(${width / 2},${height / 2})`}>
          {keys.map((k, i) => {
            const a = arcs.find((d) => d.data.key === k)
            const ang = shown[i] ?? target[i]
            if (!a && ang[1] - ang[0] < 1e-4) return null
            const geo = { startAngle: ang[0], endAngle: ang[1] }
            const mid = (ang[0] + ang[1]) / 2
            const lift = active === k ? 8 : 0
            const share = a ? a.data.value / total : 0
            const c = color(k)
            const [lx, ly] = labelArc.centroid(geo)
            const big = ang[1] - ang[0] > 0.28
            return (
              <g key={k} className="marks" transform={`translate(${Math.sin(mid) * lift},${-Math.cos(mid) * lift})`}>
                <path className="mark-slice" d={arc(geo) ?? ''} fill={c} stroke="#fff" strokeWidth={1.5} data-testid="pie-slice"
                  onPointerEnter={compact ? undefined : (e) => {
                    setActive(k)
                    const lp = localPoint(svgRef.current!, e)
                    show(lp.x, lp.y, <><b>{k}</b><br />{valueCol}: {fmt(a?.data.value)}<br />비율: {pct(share)} · 각도 {fmt((share * 360), 1)}°</>)
                  }} />
                {!compact && params.labels !== 'none' && big && a && (
                  <text className="slice-label" x={lx} y={ly} dy="0.35em" textAnchor="middle" fill={textOn(c)}>
                    {params.labels === 'percent' ? pct(share, 0) : params.labels === 'value' ? fmt(a.data.value) : k}
                  </text>
                )}
              </g>
            )
          })}
          {params.inner > 0.35 && !compact && (
            <g className="donut-center" aria-hidden="true">
              <text y={-6} textAnchor="middle" className="donut-total">{fmt(active ? (slices.find((s) => s.key === active)?.value ?? total) : total)}</text>
              <text y={16} textAnchor="middle">{active ?? '합계'}</text>
            </g>
          )}
        </g>
      </svg>
      {!compact && (
        <>
          <Legend items={tab.cats.map((c) => ({ key: c, color: color(c) }))} hidden={params.hidden} title={catCol} onToggle={(k) => setParams({ hidden: toggleIn(params.hidden, k) })} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function PieControls({ params, setParams }: ControlsProps<PieParams>) {
  return (
    <>
      <ControlGroup title="모양">
        <Slider label="안쪽 반지름 (도넛)" value={params.inner} min={0} max={0.85} step={0.05} onChange={(inner) => setParams({ inner })} format={(v) => (v === 0 ? '원 차트' : `${Math.round(v * 100)}%`)} testId="ctl-inner" />
        <Slider label="조각 간격" value={params.padAngle} min={0} max={0.06} step={0.005} onChange={(padAngle) => setParams({ padAngle })} format={(v) => `${((v * 180) / Math.PI).toFixed(1)}°`} />
        <Slider label="시작 각도" value={params.start} min={0} max={359} step={1} onChange={(start) => setParams({ start })} format={(v) => `${v}°`} />
      </ControlGroup>
      <ControlGroup title="정리">
        <Segmented label="정렬" value={params.sort} onChange={(sort) => setParams({ sort })} testId="ctl-sort" options={[{ value: 'none', label: '데이터 순서' }, { value: 'desc', label: '큰 조각부터' }]} />
        <Slider label="‘기타’로 묶을 기준" value={params.other} min={0} max={0.15} step={0.01} onChange={(other) => setParams({ other })} format={(v) => (v === 0 ? '묶지 않음' : `${Math.round(v * 100)}% 미만`)} testId="ctl-other" />
        <Select label="조각 레이블" value={params.labels} onChange={(labels) => setParams({ labels })}
          options={[{ value: 'percent', label: '비율 (%)' }, { value: 'value', label: '값' }, { value: 'name', label: '이름' }, { value: 'none', label: '없음' }]} />
        <Hint>각도의 차이는 길이보다 구별하기 어렵습니다. 조각이 많거나 비슷한 크기라면 막대그래프가 더 정확합니다. 범례를 클릭해 범주를 빼면 비율이 다시 계산됩니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const pieModule: VizModule<PieParams> = {
  roles: [
    { key: 'category', label: '범주', type: 'category', required: true },
    { key: 'value', label: '값', type: 'number', required: true },
  ],
  datasets: ['votes', 'categorical', 'budget'],
  defaultParams: { inner: 0, padAngle: 0, sort: 'none', labels: 'percent', other: 0, start: 0, hidden: [] },
  Chart: PieChart,
  Controls: PieControls,
  hint: '조각에 마우스를 올려 비율과 각도 확인 · 범례를 클릭해 범주를 빼고 비율 변화 보기',
}
