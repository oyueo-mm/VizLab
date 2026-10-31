import * as d3 from 'd3'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Legend, Tooltip, localPoint, margins, toggleIn, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Toggle } from '../../components/controls'
import { appendRow, removeRows, templateRow, updateRow } from '../../data/table'
import { categoryColor } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { formatISO } from '../../stats/datetime'
import { stepModes, stepValueAt, stepVertices, type StepMode } from '../../stats/step'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { seriesOf } from './line'
import { dragDigits, isDateColumn, paddedDomain, pointRows, roundTo, xFormat } from './shared'

export interface StepParams {
  mode: StepMode
  compareLine: boolean
  points: boolean
  fill: boolean
  zero: boolean
  hidden: string[]
}

function StepChart({ table, mapping, params, setParams, width, height, compact, onTableChange }: ChartProps<StepParams>) {
  const xCol = roleColumn(mapping, 'x')
  const yCol = roleColumn(mapping, 'y')
  const sCol = roleColumn(mapping, 'series')
  const isDate = isDateColumn(table, xCol)
  const fx = xFormat(isDate)
  const pts = useMemo(() => pointRows(table, xCol, yCol, sCol), [table, xCol, yCol, sCol])
  const all = useMemo(() => seriesOf(pts), [pts])
  const color = useMemo(() => categoryColor(all.map((s) => s.key)), [all])
  const series = all.filter((s) => !params.hidden.includes(s.key))
  const m = margins(compact)
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ row: number; domain: [number, number] } | null>(null)
  const [hoverX, setHoverX] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const { tip, show, hide } = useTooltip()

  if (!xCol || !yCol) return <ChartMessage>X축(날짜 또는 숫자)과 Y축 숫자형 열을 선택하세요.</ChartMessage>
  if (!pts.length) return <ChartMessage>그릴 수 있는 점이 없습니다.{isDate ? ' 날짜 형식(예: 2024-03-15)을 확인하세요.' : ''}</ChartMessage>
  const visible = series.flatMap((s) => s.pts)
  const [x0, x1] = d3.extent(pts, (p) => p.x) as [number, number]
  const x = d3.scaleLinear().domain([x0, x1 === x0 ? x0 + 1 : x1]).range([0, iw])
  const y = d3.scaleLinear().domain(drag.current?.domain ?? paddedDomain(visible.map((p) => p.y), 0.08, params.zero)).range([ih, 0])
  if (!drag.current) y.nice()
  const editable = !!onTableChange && !compact
  const xs = [...new Set(visible.map((p) => p.x))].sort((a, b) => a - b)
  const line = d3.line<[number, number]>().x((d) => x(d[0])).y((d) => y(d[1]))
  const dec = dragDigits(y.domain()[1] - y.domain()[0])

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!editable) return
    const t = (e.target as Element).closest('[data-row]')
    if (!t) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const row = Number(t.getAttribute('data-row'))
    drag.current = { row, domain: y.domain() as [number, number] }
    setSelected(row)
    hide()
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const lp = localPoint(svgRef.current!, e)
    if (drag.current) { onTableChange!(updateRow(table, drag.current.row, { [yCol]: roundTo(y.invert(lp.y - m.top), dec) }), true); return }
    if (compact || !xs.length) return
    const nx = xs[d3.bisectCenter(xs, x.invert(lp.x - m.left))]
    setHoverX(nx)
    show(x(nx) + m.left, lp.y, <><b>{xCol} = {fx(nx)}</b>{series.map((s) => {
      const v = stepValueAt(s.pts, nx, params.mode)
      return v == null ? null : <span key={s.key}><br /><i className="tip-swatch" style={{ background: color(s.key) }} />{s.key || yCol}: {fmt(v)}</span>
    })}<br />{stepModes.find((s) => s.value === params.mode)?.label}</>)
  }
  const onUp = (e: PointerEvent<SVGSVGElement>) => {
    const had = drag.current
    drag.current = null
    if (had) { onTableChange!(table, false); return }
    if (!editable) return
    const lp = localPoint(svgRef.current!, e)
    const px = lp.x - m.left
    const py = lp.y - m.top
    if (px < 0 || py < 0 || px > iw || py > ih || (e.target as Element).closest('[data-row]')) return
    const base = templateRow(table)
    const raw = x.invert(px)
    // New x snaps to a whole day (dates) or the data's precision (numbers).
    base[xCol] = isDate ? formatISO(Math.round(raw / 86400000) * 86400000) : roundTo(raw, dragDigits(x1 - x0))
    base[yCol] = roundTo(y.invert(py), dec)
    if (sCol && series.length) base[sCol] = series[0].key
    onTableChange!(appendRow(table, base))
    setSelected(table.rows.length)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (editable && selected != null && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); onTableChange!(removeRows(table, [selected])); setSelected(null) }
  }

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} role="img" tabIndex={editable ? 0 : undefined} data-testid="chart-svg" aria-label={`스텝 플롯: ${xCol}에 따른 ${yCol}`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey} onPointerLeave={() => { hide(); setHoverX(null) }}>
        <defs><clipPath id="step-clip"><rect x={-4} y={-4} width={iw + 8} height={ih + 8} /></clipPath></defs>
        <g transform={`translate(${m.left},${m.top})`}>
          <rect width={iw} height={ih} fill="transparent" />
          <AxisBottom scale={x} y={ih} label={xCol} compact={compact} date={isDate} />
          <AxisLeft scale={y} x={0} grid={iw} label={yCol} compact={compact} />
          {hoverX != null && <line className="crosshair" x1={x(hoverX)} x2={x(hoverX)} y1={0} y2={ih} />}
          <g clipPath="url(#step-clip)">
            {series.map((s) => {
              const verts = stepVertices(s.pts, params.mode)
              const d = line(verts) ?? ''
              return (
                <g key={s.key} className="marks">
                  {params.fill && verts.length > 0 && <path d={`${d}L${x(verts[verts.length - 1][0])},${y(Math.max(y.domain()[0], 0))}L${x(verts[0][0])},${y(Math.max(y.domain()[0], 0))}Z`} fill={color(s.key)} fillOpacity={0.12} />}
                  {params.compareLine && !compact && <path d={line(s.pts.map((p) => [p.x, p.y])) ?? ''} fill="none" stroke={color(s.key)} strokeOpacity={0.55} strokeWidth={1.6} strokeDasharray="4 4" data-testid="step-line-compare" />}
                  <path className="series-line" d={d} stroke={color(s.key)} data-testid="step-path" fill="none" />
                  {params.points && !compact && s.pts.map((p) => (
                    <circle key={p.i} data-row={p.i} className={`line-point ${editable ? 'is-draggable' : ''}`} cx={x(p.x)} cy={y(p.y)} r={selected === p.i ? 5.5 : 3.4} fill={selected === p.i ? color(s.key) : '#fff'} stroke={color(s.key)} />
                  ))}
                </g>
              )
            })}
          </g>
        </g>
      </svg>
      {!compact && (
        <>
          {sCol && <Legend items={all.map((s) => ({ key: s.key, color: color(s.key) }))} hidden={params.hidden} title={sCol} onToggle={(k) => setParams({ hidden: toggleIn(params.hidden, k) })} />}
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function StepControls({ params, setParams }: ControlsProps<StepParams>) {
  const mode = stepModes.find((s) => s.value === params.mode)
  return (
    <>
      <ControlGroup title="계단 방식">
        <Segmented label="변화 위치" value={params.mode} onChange={(m) => setParams({ mode: m })} testId="ctl-mode"
          options={stepModes.map((s) => ({ value: s.value, label: s.label.replace('Step ', '') }))} />
        {mode && <Hint>{mode.hint}</Hint>}
        <Toggle label="선그래프와 비교" description="점선: 같은 점을 직선으로 이은 선그래프" checked={params.compareLine} onChange={(compareLine) => setParams({ compareLine })} testId="ctl-compare" />
      </ControlGroup>
      <ControlGroup title="표현">
        <Toggle label="데이터 점" description="점을 위아래로 끌어 값을 바꾸고, 선택 후 Delete로 지웁니다" checked={params.points} onChange={(points) => setParams({ points })} testId="ctl-points" />
        <Toggle label="아래 채우기" checked={params.fill} onChange={(fill) => setParams({ fill })} />
        <Toggle label="세로축을 0부터" checked={params.zero} onChange={(zero) => setParams({ zero })} />
      </ControlGroup>
    </>
  )
}

export const stepModule: VizModule<StepParams> = {
  roles: [
    { key: 'x', label: 'X축 (날짜·순서)', type: 'date', accept: ['date', 'number'], required: true },
    { key: 'y', label: 'Y축 (값)', type: 'number', required: true },
    { key: 'series', label: '계열', type: 'category', auto: true },
  ],
  datasets: ['inventory', 'visits-dated', 'timeseries', 'daily'],
  defaultParams: { mode: 'after', compareLine: false, points: true, fill: false, zero: false, hidden: [] },
  Chart: StepChart,
  Controls: StepControls,
  hint: '빈 곳을 클릭해 시점 추가 · 점을 끌어 값 수정 · 변화 위치(Step After·Before·Middle)를 바꿔 비교',
}
