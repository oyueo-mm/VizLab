import * as d3 from 'd3'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { AxisBottom, BandAxis, ChartMessage, Legend, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ColorField, ControlGroup, Hint, Select, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, updateRow } from '../../data/table'
import { colorAt } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { pyramidValues, type PyramidMode } from '../../stats/bars'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { dragDigits, roundTo } from './shared'

export interface PyramidParams {
  mode: PyramidMode
  sort: 'data' | 'total' | 'name'
  /** Fixed half-axis range; 0 chooses it from the data. */
  axisMax: number
  firstAtBottom: boolean
  gap: number
  labels: boolean
  leftColor: string
  rightColor: string
}

interface Item { name: string; left: number; right: number; leftRows: number[]; rightRows: number[]; row: number }

function itemsOf(table: ChartProps<PyramidParams>['table'], cat: string | null, l: string | null, r: string | null): Item[] {
  const ci = columnIndex(table, cat)
  const li = columnIndex(table, l)
  const ri = columnIndex(table, r)
  if (ci < 0 || li < 0 || ri < 0) return []
  const map = new Map<string, Item>()
  table.rows.forEach((row, i) => {
    const name = toLabel(row[ci])
    if (name === '') return
    const a = toNumber(row[li])
    const b = toNumber(row[ri])
    let it = map.get(name)
    if (!it) { it = { name, left: 0, right: 0, leftRows: [], rightRows: [], row: i }; map.set(name, it) }
    if (a != null) { it.left += a; it.leftRows.push(i) }
    if (b != null) { it.right += b; it.rightRows.push(i) }
  })
  return [...map.values()]
}

function PyramidChart({ table, mapping, params, width, height, compact, onTableChange }: ChartProps<PyramidParams>) {
  const catCol = roleColumn(mapping, 'category')
  const leftCol = roleColumn(mapping, 'left')
  const rightCol = roleColumn(mapping, 'right')
  const items = useMemo(() => {
    const list = itemsOf(table, catCol, leftCol, rightCol)
    if (params.sort === 'total') list.sort((a, b) => b.left + b.right - (a.left + a.right))
    if (params.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    return list
  }, [table, catCol, leftCol, rightCol, params.sort])
  const display = useMemo(() => pyramidValues(items.map((i) => ({ name: i.name, left: i.left, right: i.right, row: i.row })), params.mode), [items, params.mode])
  const m = margins(compact, compact ? {} : { left: 74, right: 30 })
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ item: Item; side: 'left' | 'right' } | null>(null)
  const [, setDragging] = useState(false)
  const { tip, show, hide } = useTooltip()

  if (!catCol || !leftCol || !rightCol) return <ChartMessage>범주와 두 집단의 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!items.length) return <ChartMessage>그릴 범주가 없습니다.</ChartMessage>
  const percent = params.mode !== 'absolute'
  const peak = Math.max(1e-9, d3.max(display, (d) => Math.max(d.left, d.right)) ?? 1)
  // Leave room beside the longest bar for its value label.
  const half = params.axisMax > 0 ? params.axisMax : peak * (params.labels && !compact ? 1.14 : 1)
  const x = d3.scaleLinear().domain([-half, half]).range([0, iw]).nice()
  const order = params.firstAtBottom ? [...items].reverse() : items
  const band = d3.scaleBand().domain(order.map((i) => i.name)).range([0, ih]).padding(Math.min(0.6, params.gap))
  const bh = band.bandwidth()
  const suffix = percent ? '%' : ''
  const editable = !!onTableChange && !compact && params.mode === 'absolute'
  const digits = dragDigits(x.domain()[1])
  const idx = new Map(items.map((it, i) => [it.name, i]))

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!editable) return
    const t = (e.target as Element).closest('[data-side]')
    if (!t) return
    const item = items[idx.get(t.getAttribute('data-name')!)!]
    const side = t.getAttribute('data-side') as 'left' | 'right'
    if ((side === 'left' ? item.leftRows : item.rightRows).length !== 1) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { item, side }
    setDragging(true)
    hide()
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    const p = localPoint(svgRef.current!, e)
    const v = Math.max(0, roundTo(Math.abs(x.invert(p.x - m.left)), digits))
    const row = (d.side === 'left' ? d.item.leftRows : d.item.rightRows)[0]
    onTableChange!(updateRow(table, row, { [d.side === 'left' ? leftCol : rightCol]: v }), true)
  }
  const onUp = () => {
    if (!drag.current) return
    drag.current = null
    setDragging(false)
    onTableChange!(table, false)
  }
  const tipFor = (it: Item, side: 'left' | 'right', e: PointerEvent) => {
    if (drag.current) return
    const k = idx.get(it.name)!
    const lp = localPoint(svgRef.current!, e)
    const value = side === 'left' ? it.left : it.right
    const shown = side === 'left' ? display[k].left : display[k].right
    show(lp.x, lp.y, <><b>{it.name}</b><br />{side === 'left' ? leftCol : rightCol}: {fmt(value)}{percent && <><br />{params.mode === 'total' ? '전체 대비' : '집단 내'} {fmt(shown, 2)}%</>}{editable ? <><br />드래그해 값 변경</> : null}</>)
  }
  const axisFormat = (v: number) => `${fmt(Math.abs(v), 3)}${suffix}`

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} role="img" data-testid="chart-svg" aria-label={`인구 피라미드: ${leftCol}와 ${rightCol}의 ${catCol}별 비교`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisBottom scale={x} y={ih} grid={ih} format={axisFormat} label={compact ? undefined : percent ? '비율 (%)' : '값'} compact={compact} />
          <BandAxis scale={band} orient="left" offset={0} compact={compact} maxChars={8} />
          {order.map((it) => {
            const k = idx.get(it.name)!
            const d = display[k]
            const y0 = band(it.name) ?? 0
            return (
              <g key={it.name} className="marks">
                <rect className={`pyr-bar ${editable ? 'is-draggable' : ''}`} data-side="left" data-name={it.name} data-testid="pyr-left" x={x(-d.left)} y={y0} width={Math.max(0, x(0) - x(-d.left))} height={bh} fill={params.leftColor}
                  onPointerEnter={compact ? undefined : (e) => tipFor(it, 'left', e)} onPointerLeave={hide} />
                <rect className={`pyr-bar ${editable ? 'is-draggable' : ''}`} data-side="right" data-name={it.name} data-testid="pyr-right" x={x(0)} y={y0} width={Math.max(0, x(d.right) - x(0))} height={bh} fill={params.rightColor}
                  onPointerEnter={compact ? undefined : (e) => tipFor(it, 'right', e)} onPointerLeave={hide} />
                {params.labels && !compact && bh >= 11 && (
                  <>
                    <text className="bar-label" x={x(-d.left) - 4} y={y0 + bh / 2} dy="0.35em" textAnchor="end">{fmt(percent ? d.left : it.left, percent ? 1 : 2)}</text>
                    <text className="bar-label" x={x(d.right) + 4} y={y0 + bh / 2} dy="0.35em" textAnchor="start">{fmt(percent ? d.right : it.right, percent ? 1 : 2)}</text>
                  </>
                )}
              </g>
            )
          })}
          <line x1={x(0)} x2={x(0)} y1={0} y2={ih} stroke="#121816" strokeWidth={1.2} aria-hidden="true" />
        </g>
      </svg>
      {!compact && (
        <>
          <Legend items={[{ key: leftCol, color: params.leftColor }, { key: rightCol, color: params.rightColor }]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function PyramidControls({ params, setParams }: ControlsProps<PyramidParams>) {
  return (
    <>
      <ControlGroup title="값">
        <Select label="표시 값" value={params.mode} onChange={(mode) => setParams({ mode })} testId="ctl-mode"
          options={[{ value: 'absolute', label: '절댓값' }, { value: 'total', label: '전체 대비 백분율' }, { value: 'group', label: '집단 내 백분율' }]} />
        <Hint>{params.mode === 'absolute' ? '막대를 끌어 값을 바꿀 수 있습니다.' : params.mode === 'total' ? '두 집단 합계를 100%로 보고 각 칸의 비율을 그립니다. 막대 편집은 절댓값에서만 됩니다.' : '각 집단의 합계를 100%로 맞춰 두 집단의 구성 모양을 비교합니다. 규모가 다른 집단 비교에 알맞습니다.'}</Hint>
        <Select label="정렬" value={params.sort} onChange={(sort) => setParams({ sort })} testId="ctl-sort"
          options={[{ value: 'data', label: '데이터 순서' }, { value: 'total', label: '합계 큰 순' }, { value: 'name', label: '이름순' }]} />
        <Toggle label="첫 범주를 아래에" description="연령처럼 아래에서 위로 늘어나는 범주에 맞습니다" checked={params.firstAtBottom} onChange={(firstAtBottom) => setParams({ firstAtBottom })} testId="ctl-bottom" />
      </ControlGroup>
      <ControlGroup title="표현">
        <Slider label="축 범위 (한쪽)" value={params.axisMax} min={0} max={200} step={5} onChange={(axisMax) => setParams({ axisMax })} format={(v) => (v === 0 ? '자동' : `±${v}`)} testId="ctl-axis" />
        <Slider label="막대 간격" value={params.gap} min={0.05} max={0.5} step={0.05} onChange={(gap) => setParams({ gap })} />
        <Toggle label="값 레이블" checked={params.labels} onChange={(labels) => setParams({ labels })} />
        <ColorField label="왼쪽 집단 색" value={params.leftColor} onChange={(leftColor) => setParams({ leftColor })} testId="ctl-left-color" />
        <ColorField label="오른쪽 집단 색" value={params.rightColor} onChange={(rightColor) => setParams({ rightColor })} testId="ctl-right-color" />
      </ControlGroup>
    </>
  )
}

export const pyramidModule: VizModule<PyramidParams> = {
  roles: [
    { key: 'category', label: '범주 (연령 등)', type: 'category', required: true },
    { key: 'left', label: '왼쪽 집단 값', type: 'number', required: true },
    { key: 'right', label: '오른쪽 집단 값', type: 'number', required: true },
  ],
  datasets: ['pyramid', 'before-after'],
  defaultParams: { mode: 'absolute', sort: 'data', axisMax: 0, firstAtBottom: true, gap: 0.12, labels: true, leftColor: colorAt(2), rightColor: colorAt(1) },
  Chart: PyramidChart,
  Controls: PyramidControls,
  hint: '막대를 좌우로 끌어 값 수정 · 표시 값을 백분율로 바꿔 구성비 비교',
}
