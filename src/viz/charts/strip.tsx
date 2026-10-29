import * as d3 from 'd3'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { AxisLeft, BandAxis, ChartMessage, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { categoryColor } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { removeRows } from '../../data/table'
import { useTween } from '../../hooks/motion'
import { mean, standardDeviation } from '../../stats/descriptive'
import { dodge } from '../../stats/layout'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { addToBand, jitter, moveValue } from './groupShared'
import { groupedValues, paddedDomain } from './shared'

export interface StripParams {
  layout: 'jitter' | 'swarm' | 'none'
  jitter: number
  size: number
  opacity: number
  showMean: boolean
}

function StripChart({ table, mapping, params, width, height, compact, onTableChange }: ChartProps<StripParams>) {
  const valueCol = roleColumn(mapping, 'value')
  const groupCol = roleColumn(mapping, 'group')
  const groups = useMemo(() => groupedValues(table, valueCol, groupCol), [table, valueCol, groupCol])
  const color = useMemo(() => categoryColor(groups.map((g) => g.key)), [groups])
  const m = margins(compact)
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ row: number; moved: boolean; domain: [number, number] } | null>(null)
  const [dragging, setDragging] = useState(false)
  const { tip, show, hide } = useTooltip()
  const all = groups.flatMap((g) => g.values)
  const y = d3.scaleLinear().domain(drag.current?.domain ?? paddedDomain(all, 0.06)).range([ih, 0])
  if (!drag.current) y.nice()
  const x = d3.scaleBand().domain(groups.map((g) => g.key)).range([0, iw]).padding(0.2)
  const r = compact ? Math.max(1.2, params.size * 0.5) : params.size
  const half = x.bandwidth() / 2

  const positions = useMemo(() => groups.map((g) => {
    const cx = (x(g.key) ?? 0) + half
    const ys = g.values.map((v) => y(v))
    let offsets: number[]
    if (params.layout === 'swarm') offsets = dodge(ys, r + 0.4, half)
    else if (params.layout === 'jitter') offsets = g.rows.map((row) => jitter(row) * 2 * half * params.jitter)
    else offsets = ys.map(() => 0)
    return ys.map((py, k) => [cx + offsets[k], py])
  }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [groups, params.layout, params.jitter, r, iw, ih, y.domain()[0], y.domain()[1]])
  const shown = useTween(positions, { snapKey: `${iw}x${ih}`, enabled: !compact && !dragging && all.length <= 800 })

  if (!valueCol) return <ChartMessage>값으로 사용할 숫자형 열을 선택하세요.</ChartMessage>
  if (!all.length) return <ChartMessage>숫자 값이 없습니다.</ChartMessage>
  const editable = !!onTableChange && !compact

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!editable) return
    const t = (e.target as Element).closest('[data-row]')
    if (!t) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { row: Number(t.getAttribute('data-row')), moved: false, domain: y.domain() as [number, number] }
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    if (!d.moved) { d.moved = true; setDragging(true); hide() }
    onTableChange!(moveValue(e, svgRef.current!, m, y, table, d.row, valueCol), true)
  }
  const onUp = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    drag.current = null
    if (dragging) { setDragging(false); onTableChange!(table, false) }
    if (!editable) return
    if (d && !d.moved) { onTableChange!(removeRows(table, [d.row])); return }
    if (!d) { const t = addToBand(e, svgRef.current!, m, ih, x, y, table, valueCol, groupCol); if (t) onTableChange!(t) }
  }

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} role="img" data-testid="chart-svg"
        aria-label={`스트립 플롯: ${valueCol}, ${all.length}개 관측`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <rect width={iw} height={ih} className="plot-bg" fill="transparent" />
          <AxisLeft scale={y} x={0} grid={iw} label={valueCol} compact={compact} />
          {groups.map((g, gi) => {
            const c = color(g.key)
            const mu = mean(g.values)
            const sd = standardDeviation(g.values)
            const cx = (x(g.key) ?? 0) + half
            return (
              <g key={g.key} className="marks">
                {g.values.map((v, k) => {
                  const p = shown[gi]?.[k] ?? positions[gi][k]
                  return (
                    <circle key={g.rows[k]} data-row={g.rows[k]} className="mark-point" cx={p[0]} cy={p[1]} r={r} fill={c} fillOpacity={params.opacity}
                      onPointerEnter={compact ? undefined : (e) => {
                        if (drag.current) return
                        const lp = localPoint(svgRef.current!, e)
                        show(lp.x, lp.y, <><b>{g.key}</b><br />{valueCol}: {fmt(v)}</>)
                      }} onPointerLeave={hide} />
                  )
                })}
                {params.showMean && Number.isFinite(mu) && (
                  <g className="mean-sd" aria-hidden="true">
                    {Number.isFinite(sd) && <line x1={cx} x2={cx} y1={y(mu - sd)} y2={y(mu + sd)} />}
                    <line x1={cx - half * 0.6} x2={cx + half * 0.6} y1={y(mu)} y2={y(mu)} className="mean-line" />
                  </g>
                )}
              </g>
            )
          })}
          <BandAxis scale={x} orient="bottom" offset={ih} label={groupCol ?? undefined} compact={compact} />
        </g>
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function StripControls({ params, setParams }: ControlsProps<StripParams>) {
  return (
    <>
      <ControlGroup title="점 배치">
        <Segmented label="겹침 처리" value={params.layout} onChange={(layout) => setParams({ layout })} testId="ctl-layout"
          options={[{ value: 'jitter', label: '지터' }, { value: 'swarm', label: '스웜' }, { value: 'none', label: '없음' }]} />
        <Slider label="지터 폭" value={params.jitter} min={0} max={1} step={0.05} disabled={params.layout !== 'jitter'} onChange={(jitter) => setParams({ jitter })} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-jitter" />
        <Hint>지터는 가로 위치를 무작위로 흔들어 겹침을 줄이고, 스웜은 겹치지 않는 가장 가까운 자리를 찾아 분포의 모양이 드러나게 합니다. 세로 위치(값)는 바뀌지 않습니다.</Hint>
      </ControlGroup>
      <ControlGroup title="점 표시">
        <Slider label="점 크기" value={params.size} min={1.5} max={8} step={0.5} onChange={(size) => setParams({ size })} testId="ctl-size" />
        <Slider label="투명도" value={params.opacity} min={0.1} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} />
        <Toggle label="평균 ± 표준편차" checked={params.showMean} onChange={(showMean) => setParams({ showMean })} testId="ctl-mean" />
      </ControlGroup>
    </>
  )
}

export const stripModule: VizModule<StripParams> = {
  roles: [
    { key: 'value', label: '값', type: 'number', required: true },
    { key: 'group', label: '그룹', type: 'category', auto: true },
  ],
  datasets: ['groups', 'outliers', 'normal', 'bimodal'],
  defaultParams: { layout: 'jitter', jitter: 0.6, size: 3.5, opacity: 0.7, showMean: true },
  Chart: StripChart,
  Controls: StripControls,
  hint: '빈 곳을 클릭해 값 추가 · 점을 위아래로 드래그해 값 변경 · 점을 클릭하면 삭제',
}
