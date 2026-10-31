import * as d3 from 'd3'
import { Plus } from 'lucide-react'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { AxisLeft, BandAxis, ChartMessage, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Slider, Toggle } from '../../components/controls'
import { appendRow, templateRow, updateRow } from '../../data/table'
import { colorAt } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { pareto, vitalFew } from '../../stats/pareto'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { crossTab, dragDigits, roundTo } from './shared'

export interface ParetoParams {
  sort: boolean
  cumulative: boolean
  /** Reference line at this cumulative share (0 hides it). */
  threshold: number
  labels: boolean
  alignTotal: boolean
}

function ParetoChart({ table, mapping, params, width, height, compact, onTableChange }: ChartProps<ParetoParams>) {
  const catCol = roleColumn(mapping, 'category')
  const valueCol = roleColumn(mapping, 'value')
  const tab = useMemo(() => crossTab(table, catCol, null, valueCol), [table, catCol, valueCol])
  const { rows, total } = useMemo(() => pareto(tab.cats.map((c, i) => ({ name: c, value: tab.value(c, ''), row: i })), params.sort), [tab, params.sort])
  const m = margins(compact, compact ? {} : { right: 52 })
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ cat: string; top: number } | null>(null)
  const [, setDragging] = useState(false)
  const { tip, show, hide } = useTooltip()

  if (!catCol || !valueCol) return <ChartMessage>범주와 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!rows.length || total <= 0) return <ChartMessage>0보다 큰 값을 가진 항목이 없습니다. 값은 0 이상이어야 합니다.</ChartMessage>
  const negatives = tab.cats.filter((c) => tab.value(c, '') < 0)
  const maxBar = rows.reduce((mx, r) => Math.max(mx, r.value), 0)
  const topValue = drag.current?.top ?? (params.alignTotal && params.cumulative ? total : maxBar * 1.08)
  const band = d3.scaleBand().domain(rows.map((r) => r.name)).range([0, iw]).padding(0.22)
  const yv = d3.scaleLinear().domain([0, topValue]).range([ih, 0])
  const yp = d3.scaleLinear().domain([0, 1]).range([ih, 0])
  const few = vitalFew(rows, params.threshold || 0.8)
  const editable = !!onTableChange && !compact
  const digits = dragDigits(topValue)

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!editable) return
    const t = (e.target as Element).closest('[data-cat]')
    if (!t) return
    const cat = t.getAttribute('data-cat')!
    if (tab.rows(cat, '').length !== 1) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { cat, top: yv.domain()[1] }
    setDragging(true)
    hide()
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    const p = localPoint(svgRef.current!, e)
    onTableChange!(updateRow(table, tab.rows(d.cat, '')[0], { [valueCol]: Math.max(0, roundTo(yv.invert(p.y - m.top), digits)) }), true)
  }
  const onUp = () => {
    if (!drag.current) return
    drag.current = null
    setDragging(false)
    onTableChange!(table, false)
  }
  const cumLine = d3.line<(typeof rows)[number]>().x((r) => (band(r.name) ?? 0) + band.bandwidth() / 2).y((r) => yp(r.cum))
  const cutX = (band(rows[few].name) ?? 0) + band.bandwidth() + band.step() * band.paddingInner() / 2

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} role="img" data-testid="chart-svg" aria-label={`파레토 차트: ${catCol}별 ${valueCol}와 누적 비율`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisLeft scale={yv} x={0} grid={iw} label={valueCol} compact={compact} />
          <BandAxis scale={band} orient="bottom" offset={ih} label={catCol} compact={compact} />
          {params.cumulative && !compact && (
            <g transform={`translate(${iw},0)`} className="axis" aria-hidden="true">
              <line className="domain" y1={0} y2={ih} />
              {[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => <g key={t} transform={`translate(0,${yp(t)})`}><line x2={5} /><text x={9} dy="0.32em">{Math.round(t * 100)}%</text></g>)}
            </g>
          )}
          {rows.map((r, i) => (
            <g key={r.name} className="marks">
              <rect className={`pareto-bar ${editable && tab.rows(r.name, '').length === 1 ? 'is-draggable' : ''}`} data-cat={r.name} data-testid="pareto-bar"
                x={band(r.name)} y={yv(r.value)} width={band.bandwidth()} height={Math.max(0, ih - yv(r.value))} fill={params.cumulative && i <= few ? colorAt(0) : '#a9c9c5'}
                onPointerEnter={compact ? undefined : (e) => {
                  if (drag.current) return
                  const lp = localPoint(svgRef.current!, e)
                  show(lp.x, lp.y, <><b>{r.name}</b><br />{valueCol}: {fmt(r.value)}<br />비중 {pct(r.share)}<br />누적 {pct(r.cum)}{editable && tab.rows(r.name, '').length === 1 ? <><br />드래그해 값 변경</> : null}</>)
                }} onPointerLeave={hide} />
              {params.labels && !compact && band.bandwidth() > 18 && <text className="bar-label" x={(band(r.name) ?? 0) + band.bandwidth() / 2} y={yv(r.value) - 5} textAnchor="middle">{fmt(r.value)}</text>}
            </g>
          ))}
          {params.cumulative && (
            <>
              <path className="series-line" d={cumLine(rows) ?? ''} stroke={colorAt(1)} fill="none" data-testid="pareto-line" />
              {!compact && rows.map((r) => <circle key={r.name} cx={(band(r.name) ?? 0) + band.bandwidth() / 2} cy={yp(r.cum)} r={3.4} fill="#fff" stroke={colorAt(1)} strokeWidth={1.6} />)}
              {params.threshold > 0 && (
                <g aria-hidden="true" data-testid="pareto-threshold">
                  <line x1={0} x2={iw} y1={yp(params.threshold)} y2={yp(params.threshold)} stroke="#b4233a" strokeDasharray="6 4" strokeWidth={1.4} />
                  {!compact && <text x={4} y={yp(params.threshold) - 5} className="bar-label" fill="#b4233a">{Math.round(params.threshold * 100)}%</text>}
                  <line x1={cutX} x2={cutX} y1={yp(params.threshold)} y2={ih} stroke="#b4233a" strokeDasharray="2 4" strokeWidth={1.2} />
                </g>
              )}
            </>
          )}
        </g>
      </svg>
      {!compact && (
        <>
          <Readout items={[{ label: '합계', value: fmt(total) }, ...(params.cumulative && params.threshold > 0 ? [{ label: `${Math.round(params.threshold * 100)}% 도달`, value: `${few + 1} / ${rows.length}개 항목` }] : [])]} />
          {negatives.length > 0 && <p className="chart-footnote" style={{ top: 'auto', bottom: 4 }}>음수 값 {negatives.length}개 항목은 제외했습니다.</p>}
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function ParetoControls({ params, setParams, table, mapping, setTable }: ControlsProps<ParetoParams>) {
  const catCol = roleColumn(mapping, 'category')
  const valueCol = roleColumn(mapping, 'value')
  const add = () => {
    if (!setTable || !catCol || !valueCol) return
    const n = table.rows.length + 1
    setTable(appendRow(table, { ...templateRow(table), [catCol]: `새 항목 ${n}`, [valueCol]: 10 }))
  }
  return (
    <>
      <ControlGroup title="계산">
        <Toggle label="내림차순 정렬" description="끄면 입력 순서대로 놓이고 누적 선이 단조롭지 않게 보입니다" checked={params.sort} onChange={(sort) => setParams({ sort })} testId="ctl-sort" />
        <Toggle label="누적 비율 선" checked={params.cumulative} onChange={(cumulative) => setParams({ cumulative })} testId="ctl-cumulative" />
        <Toggle label="왼쪽 축을 합계까지" description="누적 선과 막대가 같은 척도를 쓰는 전통적인 파레토 차트입니다" checked={params.alignTotal} onChange={(alignTotal) => setParams({ alignTotal })} />
      </ControlGroup>
      <ControlGroup title="기준선">
        <Toggle label="80% 기준선" checked={params.threshold > 0} onChange={(on) => setParams({ threshold: on ? 0.8 : 0 })} testId="ctl-80" />
        <Slider label="기준 누적 비율" value={params.threshold || 0.8} min={0.5} max={0.95} step={0.05} onChange={(threshold) => setParams({ threshold })} disabled={params.threshold === 0} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-threshold" />
        <Toggle label="값 레이블" checked={params.labels} onChange={(labels) => setParams({ labels })} />
      </ControlGroup>
      <ControlGroup title="항목">
        <button type="button" className="btn btn-secondary btn-sm" onClick={add} data-testid="pareto-add"><Plus size={14} aria-hidden="true" />항목 추가</button>
        <Hint>막대를 끌어 값을 바꾸거나 데이터 탭에서 항목을 삭제·수정하세요. 같은 이름이 여러 행이면 합산합니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const paretoModule: VizModule<ParetoParams> = {
  roles: [
    { key: 'category', label: '항목', type: 'category', required: true },
    { key: 'value', label: '값 (0 이상)', type: 'number', required: true },
  ],
  datasets: ['defects', 'votes', 'cashflow'],
  defaultParams: { sort: true, cumulative: true, threshold: 0.8, labels: true, alignTotal: true },
  Chart: ParetoChart,
  Controls: ParetoControls,
  hint: '막대를 끌어 값 수정 · 누적 선이 80% 기준선과 만나는 곳까지가 ‘핵심 소수’',
}
