import * as d3 from 'd3'
import { ArrowDown, ArrowUp, Pause, Play, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Select, Slider, Toggle } from '../../components/controls'
import { appendRow, columnIndex, removeRows, templateRow, toLabel, toNumber, updateRow, type DataTable } from '../../data/table'
import { useReducedMotion } from '../../hooks/motion'
import { fmt } from '../../lib/format'
import { formatTime } from '../../stats/datetime'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { dragDigits, paddedDomain, roundTo, xOfCell } from './shared'

export interface ConnectedParams {
  curve: 'linear' | 'monotone' | 'catmull'
  arrows: boolean
  labelEvery: number
  /** 0–1: how much of the path has been drawn. */
  progress: number
  /** Row index of the emphasised time point, or -1. */
  focus: number
  size: number
}

interface Step { row: number; order: number; x: number; y: number; label: string }

/** Time points in path order: sorted by the order column when mapped, else in table order. */
export function pathSteps(table: DataTable, mapping: ChartProps<ConnectedParams>['mapping']): Step[] {
  const xi = columnIndex(table, roleColumn(mapping, 'x'))
  const yi = columnIndex(table, roleColumn(mapping, 'y'))
  const oc = roleColumn(mapping, 'order')
  const oi = columnIndex(table, oc)
  const li = columnIndex(table, roleColumn(mapping, 'label'))
  if (xi < 0 || yi < 0) return []
  const orderDate = oi >= 0 && table.columns[oi].type === 'date'
  const out: Step[] = []
  table.rows.forEach((r, row) => {
    const x = toNumber(r[xi])
    const y = toNumber(r[yi])
    if (x == null || y == null) return
    const o = oi >= 0 ? xOfCell(r[oi], orderDate) : row
    out.push({ row, order: o ?? row, x, y, label: li >= 0 ? toLabel(r[li]) : oi >= 0 ? (orderDate ? formatTime(o ?? 0) : toLabel(r[oi])) : String(row + 1) })
  })
  return oi >= 0 ? out.sort((a, b) => a.order - b.order) : out
}

function ConnectedChart({ table, mapping, params, setParams, width, height, compact, onTableChange }: ChartProps<ConnectedParams>) {
  const xCol = roleColumn(mapping, 'x')
  const yCol = roleColumn(mapping, 'y')
  const steps = useMemo(() => pathSteps(table, mapping), [table, mapping])
  const m = margins(compact)
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ row: number; domain: [number[], number[]] } | null>(null)
  const { tip, show, hide } = useTooltip()
  const [dragging, setDragging] = useState(false)
  const [playing, setPlaying] = useState(false)
  const reduced = useReducedMotion()
  const progressRef = useRef(params.progress)
  progressRef.current = params.progress

  // Path animation: advance `progress` from 0 to 1 over about 4 s, then stop.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const next = Math.min(1, progressRef.current + (now - last) / 4000)
      last = now
      setParams({ progress: next })
      if (next >= 1) setPlaying(false)
      else raf = requestAnimationFrame(tick)
    }
    if (progressRef.current >= 1) setParams({ progress: 0 })
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  const domX = drag.current?.domain[0] ?? paddedDomain(steps.map((s) => s.x), 0.08)
  const domY = drag.current?.domain[1] ?? paddedDomain(steps.map((s) => s.y), 0.08)
  const x = d3.scaleLinear().domain(domX).range([0, iw])
  const y = d3.scaleLinear().domain(domY).range([ih, 0])

  if (!xCol || !yCol) return <ChartMessage>X축과 Y축 숫자형 열을 선택하세요.</ChartMessage>
  if (steps.length < 2) return <ChartMessage>경로를 이으려면 시점이 2개 이상 필요합니다.</ChartMessage>

  const visible = Math.max(2, Math.round(params.progress * (steps.length - 1)) + 1)
  const shown = steps.slice(0, Math.min(steps.length, params.progress >= 1 ? steps.length : visible))
  const curve = params.curve === 'linear' ? d3.curveLinear : params.curve === 'monotone' ? d3.curveMonotoneX : d3.curveCatmullRom.alpha(0.5)
  const line = d3.line<Step>().curve(curve).x((s) => x(s.x)).y((s) => y(s.y))
  const editable = !!onTableChange && !compact
  const dx = dragDigits(domX[1] - domX[0])
  const dy = dragDigits(domY[1] - domY[0])
  const r = compact ? 2.5 : params.size

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!editable) return
    const t = (e.target as Element).closest('[data-row]')
    if (!t) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { row: Number(t.getAttribute('data-row')), domain: [domX, domY] }
    setParams({ focus: drag.current.row })
    setDragging(true)
    hide()
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return
    const p = localPoint(svgRef.current!, e)
    onTableChange!(updateRow(table, drag.current.row, { [xCol]: roundTo(x.invert(p.x - m.left), dx), [yCol]: roundTo(y.invert(p.y - m.top), dy) }), true)
  }
  const onUp = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    drag.current = null
    if (dragging) { setDragging(false); onTableChange!(table, false); return }
    if (!editable || d) return
    // A click on empty plot space appends a new time point at the end of the path.
    const p = localPoint(svgRef.current!, e)
    const px = p.x - m.left
    const py = p.y - m.top
    if (px < 0 || py < 0 || px > iw || py > ih || (e.target as Element).closest('[data-row]')) return
    const base = templateRow(table)
    const orderCol = roleColumn(mapping, 'order')
    onTableChange!(appendRow(table, { ...base, [xCol]: roundTo(x.invert(px), dx), [yCol]: roundTo(y.invert(py), dy), ...(orderCol && table.columns.find((c) => c.name === orderCol)?.type === 'number' ? { [orderCol]: (steps[steps.length - 1]?.order ?? 0) + 1 } : {}) }))
    setParams({ progress: 1 })
  }

  const last = shown[shown.length - 1]
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} role="img" data-testid="chart-svg" aria-label={`연결 산점도: ${xCol}과 ${yCol}의 이동 경로`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={hide}>
        <defs>
          <marker id="cs-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" fill="#1f6f66" /></marker>
        </defs>
        <g transform={`translate(${m.left},${m.top})`}>
          <rect width={iw} height={ih} fill="transparent" />
          <AxisBottom scale={x} y={ih} grid={ih} label={xCol} compact={compact} />
          <AxisLeft scale={y} x={0} grid={iw} label={yCol} compact={compact} />
          <path className="series-line" d={line(shown) ?? ''} stroke="#1f6f66" strokeOpacity={0.55} data-testid="cs-path" fill="none" />
          {params.arrows && !compact && shown.slice(1).map((s, i) => {
            const a = shown[i]
            const mx = (x(a.x) + x(s.x)) / 2
            const my = (y(a.y) + y(s.y)) / 2
            const len = Math.hypot(x(s.x) - x(a.x), y(s.y) - y(a.y))
            if (len < 18) return null
            const ux = (x(s.x) - x(a.x)) / len
            const uy = (y(s.y) - y(a.y)) / len
            return <line key={s.row} x1={mx - ux * 3} y1={my - uy * 3} x2={mx + ux * 3} y2={my + uy * 3} stroke="#1f6f66" strokeWidth={1.6} markerEnd="url(#cs-arrow)" aria-hidden="true" data-testid="cs-arrow" />
          })}
          {shown.map((s, i) => {
            const t = shown.length > 1 ? i / (shown.length - 1) : 1
            const focus = params.focus === s.row
            return (
              <g key={s.row}>
                <circle data-row={s.row} className={`cs-point ${editable ? 'is-draggable' : ''}`} data-testid="cs-point" cx={x(s.x)} cy={y(s.y)} r={focus ? r + 3 : r}
                  fill={focus ? '#e07a3f' : d3.interpolateYlGnBu(0.3 + 0.65 * t)} stroke={focus ? '#121816' : '#fff'} strokeWidth={focus ? 2 : 1.2}
                  onPointerEnter={compact ? undefined : (e) => {
                    if (drag.current) return
                    const lp = localPoint(svgRef.current!, e)
                    show(lp.x, lp.y, <><b>{s.label}</b><br />{xCol}: {fmt(s.x)}<br />{yCol}: {fmt(s.y)}<br />{i + 1}번째 시점{editable ? ' · 드래그해 이동' : ''}</>)
                  }} onPointerLeave={hide} />
                {!compact && (focus || (params.labelEvery > 0 && i % params.labelEvery === 0) || i === shown.length - 1 && params.labelEvery > 0) && (
                  <text className="cs-label" x={x(s.x) + r + 4} y={y(s.y) - r - 3} aria-hidden="true">{s.label}</text>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          <div className="chart-actions" style={{ bottom: 'auto', top: 44, right: 8 }}>
            <button type="button" onClick={() => setPlaying((p) => !p)} disabled={reduced && false} data-testid="cs-play" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
              {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}{playing ? '멈춤' : '경로 재생'}
            </button>
          </div>
          <Readout items={[{ label: '시점', value: `${shown.length} / ${steps.length}` }, ...(last ? [{ label: '현재', value: last.label }] : [])]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function ConnectedControls({ params, setParams, table, mapping, setTable }: ControlsProps<ConnectedParams>) {
  const steps = useMemo(() => pathSteps(table, mapping), [table, mapping])
  const orderCol = roleColumn(mapping, 'order')
  const orderIdx = columnIndex(table, orderCol)
  const swap = (i: number, j: number) => {
    if (!setTable || j < 0 || j >= steps.length) return
    const a = steps[i].row
    const b = steps[j].row
    if (orderIdx >= 0) {
      // Swap the order values of the two rows so they trade places in the sorted path.
      const rows = table.rows.slice()
      const ra = rows[a].slice()
      const rb = rows[b].slice()
      ;[ra[orderIdx], rb[orderIdx]] = [rb[orderIdx], ra[orderIdx]]
      rows[a] = ra
      rows[b] = rb
      setTable({ columns: table.columns, rows })
    } else {
      const rows = table.rows.slice()
      ;[rows[a], rows[b]] = [rows[b], rows[a]]
      setTable({ columns: table.columns, rows })
    }
  }
  const add = () => {
    if (!setTable) return
    const lastStep = steps[steps.length - 1]
    const base = templateRow(table)
    if (lastStep) {
      const xc = roleColumn(mapping, 'x')
      const yc = roleColumn(mapping, 'y')
      if (xc && yc) { base[xc] = roundTo(lastStep.x * 1.02, 2); base[yc] = roundTo(lastStep.y * 1.01, 2) }
      if (orderCol && table.columns[orderIdx]?.type === 'number') base[orderCol] = lastStep.order + 1
    }
    setTable(appendRow(table, base))
    setParams({ progress: 1 })
  }
  return (
    <>
      <ControlGroup title="경로">
        <Slider label="경로 진행" value={params.progress} min={0} max={1} step={0.01} onChange={(progress) => setParams({ progress })} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-progress" />
        <Select label="연결 방식" value={params.curve} onChange={(curve) => setParams({ curve })} testId="ctl-curve"
          options={[{ value: 'linear', label: '직선' }, { value: 'monotone', label: '단조 곡선' }, { value: 'catmull', label: 'Catmull–Rom 곡선' }]} />
        <Toggle label="이동 방향 화살표" checked={params.arrows} onChange={(arrows) => setParams({ arrows })} testId="ctl-arrows" />
        <Slider label="레이블 간격" value={params.labelEvery} min={0} max={10} onChange={(labelEvery) => setParams({ labelEvery })} format={(v) => (v === 0 ? '없음' : `${v}점마다`)} />
        <Slider label="점 크기" value={params.size} min={3} max={10} step={0.5} onChange={(size) => setParams({ size })} />
      </ControlGroup>
      <ControlGroup title={`시점 편집 (${steps.length})`}>
        <div className="order-list" data-testid="cs-steps">
          <ul>
            {steps.slice(0, 40).map((s, i) => (
              <li key={s.row}>
                <button type="button" aria-pressed={params.focus === s.row} onClick={() => setParams({ focus: params.focus === s.row ? -1 : s.row })} title="이 시점 강조">{s.label}</button>
                <span>
                  <button type="button" className="icon-btn-xs" aria-label={`${s.label} 위로`} disabled={i === 0} onClick={() => swap(i, i - 1)}><ArrowUp size={13} /></button>
                  <button type="button" className="icon-btn-xs" aria-label={`${s.label} 아래로`} disabled={i === steps.length - 1} onClick={() => swap(i, i + 1)}><ArrowDown size={13} /></button>
                  <button type="button" className="icon-btn-xs" aria-label={`${s.label} 삭제`} disabled={steps.length <= 2} onClick={() => { setTable?.(removeRows(table, [s.row])); if (params.focus === s.row) setParams({ focus: -1 }) }}><Trash2 size={13} /></button>
                </span>
              </li>
            ))}
          </ul>
        </div>
        {steps.length > 40 && <Hint>처음 40개만 표시합니다. 나머지는 데이터 탭에서 편집하세요.</Hint>}
        <button type="button" className="btn btn-secondary btn-sm" onClick={add} data-testid="cs-add"><Plus size={14} aria-hidden="true" />시점 추가</button>
        <Hint>차트의 빈 곳을 클릭해도 시점이 추가되고, 점을 끌어 값을 바꿀 수 있습니다. 순서를 바꾸면 경로의 연결 순서가 달라집니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const connectedScatterModule: VizModule<ConnectedParams> = {
  roles: [
    { key: 'x', label: 'X축', type: 'number', required: true },
    { key: 'y', label: 'Y축', type: 'number', required: true },
    { key: 'order', label: '순서·시간 (선택)', type: 'number', accept: ['number', 'date'], auto: true },
    { key: 'label', label: '점 레이블 (선택)', type: 'category' },
  ],
  datasets: ['trajectory'],
  defaultParams: { curve: 'linear', arrows: true, labelEvery: 4, progress: 1, focus: -1, size: 5 },
  Chart: ConnectedChart,
  Controls: ConnectedControls,
  hint: '점을 끌어 이동 · 빈 곳을 클릭해 시점 추가 · ‘경로 재생’으로 순서대로 그리기',
}
