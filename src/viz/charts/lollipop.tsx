import * as d3 from 'd3'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { AxisBottom, AxisLeft, BandAxis, ChartMessage, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { updateRow } from '../../data/table'
import { useTween } from '../../hooks/motion'
import { colorAt } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { aggregate } from '../../stats/descriptive'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { aggOptions, sortCategories, type BarParams } from './bar'
import { crossTab, dragDigits, roundTo } from './shared'

export interface LollipopParams {
  agg: BarParams['agg']
  sort: BarParams['sort']
  orientation: 'vertical' | 'horizontal'
  size: number
  stem: number
  labels: boolean
  zero: boolean
  /** Color negative values differently. */
  signColors: boolean
}

function LollipopChart({ table, mapping, params, width, height, compact, onTableChange }: ChartProps<LollipopParams>) {
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
  const span = hi - lo || Math.abs(hi) || 1
  const baseDomain: [number, number] = params.zero ? [Math.min(0, lo), Math.max(0, hi) || 1] : [lo - span * 0.15, hi + span * 0.08]
  const v = d3.scaleLinear().domain(drag.current?.domain ?? baseDomain)
  if (!drag.current) v.nice()
  v.range(horizontal ? [0, iw] : [ih, 0])
  const band = d3.scaleBand().domain(cats).range(horizontal ? [0, ih] : [0, iw]).padding(0.3)
  const zeroPx = v(Math.max(v.domain()[0], Math.min(0, v.domain()[1])))
  const target = useMemo(() => values.map((val) => [v(val)]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [values.join(','), v.domain()[0], v.domain()[1], iw, ih, horizontal])
  const shown = useTween(target, { snapKey: `${iw}x${ih}${horizontal}${cats.join()}`, enabled: !compact && !dragging })

  if (!catCol || !valueCol) return <ChartMessage>범주와 값 열을 선택하세요.</ChartMessage>
  if (!cats.length) return <ChartMessage>그릴 범주가 없습니다.</ChartMessage>
  const editable = !!onTableChange && !compact && params.agg !== 'count'
  const digits = dragDigits(v.domain()[1] - v.domain()[0])
  const r = compact ? Math.max(2, params.size * 0.5) : params.size

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
    onTableChange!(updateRow(table, drag.current.row, { [valueCol]: roundTo(v.invert(horizontal ? p.x - m.left : p.y - m.top), digits) }), true)
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
        aria-label={`롤리팝 차트: ${catCol}별 ${valueCol}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          {horizontal
            ? <><AxisBottom scale={v} y={ih} grid={ih} label={valueCol} compact={compact} /><BandAxis scale={band} orient="left" offset={0} label={catCol} compact={compact} /></>
            : <><AxisLeft scale={v} x={0} grid={iw} label={valueCol} compact={compact} /><BandAxis scale={band} orient="bottom" offset={ih} label={catCol} compact={compact} /></>}
          {cats.map((c, i) => {
            const px = shown[i]?.[0] ?? target[i][0]
            const mid = (band(c) ?? 0) + band.bandwidth() / 2
            const val = tab.value(c, '')
            const color = params.signColors && val < 0 ? '#cf4f6a' : colorAt(0)
            const [x1, y1, x2, y2] = horizontal ? [zeroPx, mid, px, mid] : [mid, zeroPx, mid, px]
            return (
              <g key={c} className="marks">
                <line className="lolli-stem" x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={compact ? 1.5 : params.stem} />
                <circle className={`lolli-dot ${editable && tab.rows(c, '').length === 1 ? 'is-draggable' : ''}`} data-cat={c} data-testid="lolli-dot" cx={x2} cy={y2} r={r} fill={color}
                  onPointerEnter={compact ? undefined : (e) => {
                    if (drag.current) return
                    const lp = localPoint(svgRef.current!, e)
                    show(lp.x, lp.y, <><b>{c}</b><br />{valueCol}: {fmt(val)}{editable && tab.rows(c, '').length === 1 && <><br />드래그해 값 변경</>}</>)
                  }} onPointerLeave={hide} />
                {params.labels && !compact && (
                  <text className="bar-label" x={horizontal ? x2 + (val < 0 ? -r - 5 : r + 5) : x2} y={horizontal ? y2 : y2 + (val < 0 ? r + 13 : -r - 6)} dy={horizontal ? '0.35em' : 0}
                    textAnchor={horizontal ? (val < 0 ? 'end' : 'start') : 'middle'}>{fmt(val)}</text>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function LollipopControls({ params, setParams }: ControlsProps<LollipopParams>) {
  return (
    <>
      <ControlGroup title="구성">
        <Select label="집계" value={params.agg} onChange={(agg) => setParams({ agg })} options={aggOptions} />
        <Select label="정렬 기준" value={params.sort} onChange={(sort) => setParams({ sort })} testId="ctl-sort"
          options={[{ value: 'none', label: '데이터 순서' }, { value: 'desc', label: '값 내림차순' }, { value: 'asc', label: '값 오름차순' }, { value: 'name', label: '이름순' }]} />
        <Segmented label="방향" value={params.orientation} onChange={(orientation) => setParams({ orientation })} testId="ctl-orient"
          options={[{ value: 'vertical', label: '세로' }, { value: 'horizontal', label: '가로' }]} />
      </ControlGroup>
      <ControlGroup title="모양">
        <Slider label="점 크기" value={params.size} min={3} max={14} step={0.5} onChange={(size) => setParams({ size })} testId="ctl-size" />
        <Slider label="선 굵기" value={params.stem} min={1} max={6} step={0.5} onChange={(stem) => setParams({ stem })} />
        <Toggle label="값 레이블" checked={params.labels} onChange={(labels) => setParams({ labels })} testId="ctl-labels" />
        <Toggle label="값 축을 0부터" description="끄면 선 길이가 값에 비례하지 않아 차이가 과장됩니다" checked={params.zero} onChange={(zero) => setParams({ zero })} testId="ctl-zero" />
        <Toggle label="음수 값 다른 색" checked={params.signColors} onChange={(signColors) => setParams({ signColors })} />
        <Hint>점을 드래그해 값을 바꿉니다. 선의 길이가 기준선에서 값까지의 거리이므로, 막대보다 잉크를 덜 쓰면서 같은 정보를 전달합니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const lollipopModule: VizModule<LollipopParams> = {
  roles: [
    { key: 'category', label: '범주', type: 'category', required: true },
    { key: 'value', label: '값', type: 'number', required: true },
  ],
  datasets: ['votes', 'categorical', 'nutrition'],
  defaultParams: { agg: 'sum', sort: 'desc', orientation: 'vertical', size: 7, stem: 2, labels: true, zero: true, signColors: true },
  Chart: LollipopChart,
  Controls: LollipopControls,
  hint: '점을 드래그해 값 수정 · 마우스를 올려 값 확인',
}
