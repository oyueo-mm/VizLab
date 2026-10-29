import * as d3 from 'd3'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { AxisBottom, AxisLeft, BandAxis, ChartMessage, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Toggle } from '../../components/controls'
import { colorAt } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { updateRow } from '../../data/table'
import { useTween } from '../../hooks/motion'
import { aggregate, type Aggregate } from '../../stats/descriptive'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { crossTab, dragDigits, roundTo } from './shared'

export interface BarParams {
  agg: Aggregate
  sort: 'none' | 'desc' | 'asc' | 'name'
  orientation: 'vertical' | 'horizontal'
  zero: boolean
  labels: boolean
  colorful: boolean
}

export const aggOptions: { value: Aggregate; label: string }[] = [
  { value: 'sum', label: '합계' }, { value: 'mean', label: '평균' }, { value: 'median', label: '중앙값' },
  { value: 'count', label: '개수' }, { value: 'max', label: '최댓값' }, { value: 'min', label: '최솟값' },
]

export function sortCategories(cats: string[], value: (c: string) => number, sort: BarParams['sort']) {
  const out = [...cats]
  if (sort === 'desc') out.sort((a, b) => value(b) - value(a))
  if (sort === 'asc') out.sort((a, b) => value(a) - value(b))
  if (sort === 'name') out.sort((a, b) => a.localeCompare(b, 'ko'))
  return out
}

function BarChart({ table, mapping, params, width, height, compact, onTableChange }: ChartProps<BarParams>) {
  const catCol = roleColumn(mapping, 'category')
  const valueCol = roleColumn(mapping, 'value')
  const tab = useMemo(() => crossTab(table, catCol, null, valueCol, (v) => aggregate(v, params.agg)), [table, catCol, valueCol, params.agg])
  const cats = useMemo(() => sortCategories(tab.cats, (c) => tab.value(c, ''), params.sort), [tab, params.sort])
  const horizontal = params.orientation === 'horizontal'
  const m = margins(compact, horizontal && !compact ? { left: 92 } : {})
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ row: number; domain: [number, number] } | null>(null)
  const [dragging, setDragging] = useState(false)
  const { tip, show, hide } = useTooltip()

  const values = cats.map((c) => tab.value(c, ''))
  const lo = d3.min(values) ?? 0
  const hi = d3.max(values) ?? 1
  // Without a zero baseline the axis starts just below the minimum, exaggerating differences.
  const span = hi - lo || Math.abs(hi) || 1
  const baseDomain: [number, number] = params.zero ? [Math.min(0, lo), Math.max(0, hi) || 1] : [lo - span * 0.15, hi + span * 0.05]
  const v = d3.scaleLinear().domain(drag.current?.domain ?? baseDomain)
  if (!drag.current) v.nice()
  v.range(horizontal ? [0, iw] : [ih, 0])
  const band = d3.scaleBand().domain(cats).range(horizontal ? [0, ih] : [0, iw]).padding(0.22)
  const base = v(Math.max(v.domain()[0], Math.min(0, v.domain()[1])))
  const geometry = useMemo(() => values.map((val) => [v(val)]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [values.join(','), v.domain()[0], v.domain()[1], iw, ih, horizontal])
  const shown = useTween(geometry, { snapKey: `${iw}x${ih}${horizontal}${cats.join()}`, enabled: !compact && !dragging })

  if (!catCol || !valueCol) return <ChartMessage>범주와 값 열을 선택하세요.</ChartMessage>
  if (!cats.length) return <ChartMessage>그릴 범주가 없습니다.</ChartMessage>
  const editable = !!onTableChange && !compact && params.agg !== 'count'
  const digits = dragDigits(v.domain()[1] - v.domain()[0])

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!editable) return
    const t = (e.target as Element).closest('[data-cat]')
    if (!t) return
    const rows = tab.rows(t.getAttribute('data-cat')!, '')
    if (rows.length !== 1) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { row: rows[0], domain: v.domain() as [number, number] }
    setDragging(true)
    hide()
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return
    const p = localPoint(svgRef.current!, e)
    const val = v.invert(horizontal ? p.x - m.left : p.y - m.top)
    onTableChange!(updateRow(table, drag.current.row, { [valueCol]: roundTo(val, digits) }), true)
  }
  const onUp = () => {
    if (!drag.current) return
    drag.current = null
    setDragging(false)
    onTableChange!(table, false)
  }

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} role="img" data-testid="chart-svg"
        aria-label={`막대그래프: ${catCol}별 ${valueCol}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          {horizontal
            ? <AxisBottom scale={v} y={ih} grid={ih} label={valueCol} compact={compact} />
            : <AxisLeft scale={v} x={0} grid={iw} label={valueCol} compact={compact} />}
          {cats.map((c, i) => {
            const pos = band(c) ?? 0
            const end = shown[i]?.[0] ?? geometry[i][0]
            const fill = params.colorful ? colorAt(i) : '#2a8c82'
            const single = tab.rows(c, '').length === 1
            const rect = horizontal
              ? { x: Math.min(base, end), width: Math.abs(end - base), y: pos, height: band.bandwidth() }
              : { x: pos, width: band.bandwidth(), y: Math.min(base, end), height: Math.abs(end - base) }
            return (
              <g key={c} className="marks">
                <rect className={`mark-bar ${editable && single ? 'is-draggable' : ''}`} data-cat={c} {...rect} fill={fill} rx={2}
                  onPointerEnter={compact ? undefined : (e) => {
                    if (drag.current) return
                    const lp = localPoint(svgRef.current!, e)
                    show(lp.x, lp.y, <><b>{c}</b><br />{aggOptions.find((a) => a.value === params.agg)?.label}: {fmt(values[i])}<br />행 {tab.rows(c, '').length}개{editable && single ? ' · 끝을 드래그해 수정' : ''}</>)
                  }} onPointerLeave={hide} />
                {params.labels && !compact && (horizontal
                  ? <text className="bar-label" x={Math.max(base, end) + 5} y={pos + band.bandwidth() / 2} dy="0.35em">{fmt(values[i])}</text>
                  : <text className="bar-label" x={pos + band.bandwidth() / 2} y={Math.min(base, end) - 6} textAnchor="middle">{fmt(values[i])}</text>)}
              </g>
            )
          })}
          {horizontal
            ? <BandAxis scale={band} orient="left" offset={0} compact={compact} maxChars={8} />
            : <BandAxis scale={band} orient="bottom" offset={ih} label={catCol} compact={compact} />}
          {!params.zero && !compact && <text className="axis-warning" x={horizontal ? 4 : 6} y={horizontal ? ih - 6 : ih - 8}>축이 0에서 시작하지 않음</text>}
        </g>
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function BarControls({ params, setParams }: ControlsProps<BarParams>) {
  return (
    <>
      <ControlGroup title="값 계산">
        <Select label="같은 범주 행의 집계" value={params.agg} onChange={(agg) => setParams({ agg })} options={aggOptions} testId="ctl-agg" />
        <Hint>범주마다 행이 하나뿐이면 막대 끝을 드래그해 값을 바꿀 수 있습니다.</Hint>
      </ControlGroup>
      <ControlGroup title="배치">
        <Select label="정렬" value={params.sort} onChange={(sort) => setParams({ sort })} testId="ctl-sort"
          options={[{ value: 'none', label: '데이터 순서' }, { value: 'desc', label: '값 내림차순' }, { value: 'asc', label: '값 오름차순' }, { value: 'name', label: '이름순' }]} />
        <Segmented label="방향" value={params.orientation} onChange={(orientation) => setParams({ orientation })} testId="ctl-orientation"
          options={[{ value: 'vertical', label: '세로' }, { value: 'horizontal', label: '가로' }]} />
      </ControlGroup>
      <ControlGroup title="표시">
        <Toggle label="값 축을 0부터 시작" description="끄면 작은 차이가 과장되어 보입니다" checked={params.zero} onChange={(zero) => setParams({ zero })} testId="ctl-zero" />
        <Toggle label="값 레이블" checked={params.labels} onChange={(labels) => setParams({ labels })} testId="ctl-labels" />
        <Toggle label="범주마다 다른 색" description="막대 길이가 정보이므로 보통은 한 색이면 충분합니다" checked={params.colorful} onChange={(colorful) => setParams({ colorful })} />
      </ControlGroup>
    </>
  )
}

export const barModule: VizModule<BarParams> = {
  roles: [
    { key: 'category', label: '범주', type: 'category', required: true },
    { key: 'value', label: '값', type: 'number', required: true },
  ],
  datasets: ['votes', 'categorical', 'groups', 'outliers'],
  defaultParams: { agg: 'sum', sort: 'none', orientation: 'vertical', zero: true, labels: true, colorful: false },
  Chart: BarChart,
  Controls: BarControls,
  hint: '막대 끝을 위아래로 드래그해 값을 바꿀 수 있습니다 (범주당 행이 하나일 때)',
}
