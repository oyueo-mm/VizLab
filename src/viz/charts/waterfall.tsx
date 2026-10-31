import * as d3 from 'd3'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { AxisLeft, ChartMessage, Legend, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ColorField, ControlGroup, Hint, NumberField, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, updateRow } from '../../data/table'
import { useTween } from '../../hooks/motion'
import { fmt } from '../../lib/format'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { dragDigits, paddedDomain, roundTo } from './shared'

export interface WaterfallParams {
  start: number
  startLabel: string
  total: boolean
  totalLabel: string
  connectors: boolean
  labels: boolean
  posColor: string
  negColor: string
  totalColor: string
}

export interface WaterfallStep { key: string; label: string; kind: 'start' | 'delta' | 'total'; row: number; delta: number; from: number; to: number }

/** Running totals: each delta bar floats from the previous cumulative value to the new one. */
export function waterfallSteps(items: { label: string; delta: number; row: number }[], start: number, startLabel: string, total: boolean, totalLabel: string): WaterfallStep[] {
  const steps: WaterfallStep[] = []
  let run = start
  if (startLabel) steps.push({ key: 'start', label: startLabel, kind: 'start', row: -1, delta: start, from: 0, to: start })
  else run = start
  for (const it of items) {
    steps.push({ key: `r${it.row}`, label: it.label, kind: 'delta', row: it.row, delta: it.delta, from: run, to: run + it.delta })
    run += it.delta
  }
  if (total) steps.push({ key: 'total', label: totalLabel || '합계', kind: 'total', row: -1, delta: run, from: 0, to: run })
  return steps
}

function WaterfallChart({ table, mapping, params, width, height, compact, onTableChange }: ChartProps<WaterfallParams>) {
  const catCol = roleColumn(mapping, 'category')
  const deltaCol = roleColumn(mapping, 'delta')
  const items = useMemo(() => {
    const ci = columnIndex(table, catCol)
    const di = columnIndex(table, deltaCol)
    if (ci < 0 || di < 0) return []
    const out: { label: string; delta: number; row: number }[] = []
    table.rows.forEach((r, row) => {
      const d = toNumber(r[di])
      const label = toLabel(r[ci])
      if (d != null && label) out.push({ label, delta: d, row })
    })
    return out
  }, [table, catCol, deltaCol])
  const steps = useMemo(() => waterfallSteps(items, params.start, params.startLabel, params.total, params.totalLabel), [items, params])
  const m = margins(compact)
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ row: number; prev: number; domain: [number, number] } | null>(null)
  const [dragging, setDragging] = useState(false)
  const { tip, show, hide } = useTooltip()

  const y = d3.scaleLinear().domain(drag.current?.domain ?? paddedDomain([0, ...steps.flatMap((s) => [s.from, s.to])], 0.08, true)).range([ih, 0])
  if (!drag.current) y.nice()
  const band = d3.scaleBand().domain(steps.map((s) => s.key)).range([0, iw]).padding(0.25)
  const target = useMemo(() => steps.map((s) => [y(s.from), y(s.to)]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [steps, ih, y.domain()[0], y.domain()[1]])
  const shown = useTween(target, { snapKey: `${iw}x${ih}${steps.length}`, enabled: !compact && !dragging })

  if (!catCol || !deltaCol) return <ChartMessage>항목과 증감값 열을 선택하세요.</ChartMessage>
  if (!items.length) return <ChartMessage>증감값이 있는 항목이 없습니다.</ChartMessage>
  const editable = !!onTableChange && !compact
  const final = steps[steps.length - 1]?.to ?? 0
  const color = (s: WaterfallStep) => (s.kind === 'delta' ? (s.delta >= 0 ? params.posColor : params.negColor) : params.totalColor)
  const digits = dragDigits(y.domain()[1] - y.domain()[0])

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!editable) return
    const t = (e.target as Element).closest('[data-step]')
    if (!t) return
    const s = steps.find((x) => x.key === t.getAttribute('data-step'))
    if (!s || s.kind !== 'delta') return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { row: s.row, prev: s.from, domain: y.domain() as [number, number] }
    setDragging(true)
    hide()
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return
    const p = localPoint(svgRef.current!, e)
    // The bar's far end follows the pointer, so the delta is the distance from the unchanged previous total.
    onTableChange!(updateRow(table, drag.current.row, { [deltaCol]: roundTo(y.invert(p.y - m.top) - drag.current.prev, digits) }), true)
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
        aria-label={`워터폴 차트: 시작 ${fmt(params.start)}에서 ${fmt(final)}까지`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisLeft scale={y} x={0} grid={iw} label={deltaCol} compact={compact} />
          {steps.map((s, i) => {
            const [ya, yb] = shown[i] ?? target[i]
            const x = band(s.key) ?? 0
            const bw = band.bandwidth()
            const next = steps[i + 1]
            const c = color(s)
            return (
              <g key={s.key} className="marks">
                {!compact && <text className="cat-label" x={x + bw / 2} y={ih + 18} textAnchor="middle"><title>{s.label}</title>{s.label.length > Math.max(3, Math.floor(bw / 7)) ? `${s.label.slice(0, Math.max(2, Math.floor(bw / 7) - 1))}…` : s.label}</text>}
                {params.connectors && next && <line className="wf-connector" x1={x + bw} x2={band(next.key) ?? 0} y1={y(s.to)} y2={y(s.to)} />}
                <rect className={`mark-bar wf-bar ${editable && s.kind === 'delta' ? 'is-draggable' : ''}`} data-step={s.key} data-testid="wf-bar" x={x} width={bw} y={Math.min(ya, yb)} height={Math.max(1, Math.abs(yb - ya))} fill={c}
                  onPointerEnter={compact ? undefined : (e) => {
                    if (drag.current) return
                    const lp = localPoint(svgRef.current!, e)
                    show(lp.x, lp.y, <><b>{s.label}</b><br />{s.kind === 'delta' ? <>증감 {s.delta > 0 ? '+' : ''}{fmt(s.delta)}<br />{fmt(s.from)} → {fmt(s.to)}</> : <>누적 {fmt(s.to)}</>}{editable && s.kind === 'delta' && <><br />끝을 드래그해 증감 변경</>}</>)
                  }} onPointerLeave={hide} />
                {params.labels && !compact && (
                  <text className="bar-label" x={x + bw / 2} y={s.kind === 'delta' && s.delta < 0 ? y(Math.min(s.from, s.to)) + 14 : y(Math.max(s.from, s.to)) - 6} textAnchor="middle">
                    {s.kind === 'delta' && s.delta > 0 ? '+' : ''}{fmt(s.delta)}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          <Legend items={[{ key: '증가', color: params.posColor }, { key: '감소', color: params.negColor }, { key: '시작·합계', color: params.totalColor }]} />
          <Readout items={[{ label: '시작', value: fmt(params.start) }, { label: '순증감', value: fmt(final - params.start) }, { label: '최종', value: fmt(final) }]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function WaterfallControls({ params, setParams }: ControlsProps<WaterfallParams>) {
  return (
    <>
      <ControlGroup title="시작과 끝">
        <NumberField label="시작값" value={params.start} onChange={(start) => setParams({ start })} testId="ctl-start" step={10} />
        <Toggle label="시작 막대 표시" checked={params.startLabel !== ''} onChange={(on) => setParams({ startLabel: on ? '시작' : '' })} testId="ctl-show-start" />
        <Toggle label="누적 결과(합계) 막대" description="마지막 증감 뒤의 최종값" checked={params.total} onChange={(total) => setParams({ total })} testId="ctl-total" />
        <Hint>각 막대는 직전 누적값에서 시작해 증감만큼 떠 있습니다. 양수는 올라가고 음수는 내려가며, 합계는 시작값 + 모든 증감의 합입니다.</Hint>
      </ControlGroup>
      <ControlGroup title="표시">
        <Toggle label="값 레이블" checked={params.labels} onChange={(labels) => setParams({ labels })} />
        <Toggle label="연결선" checked={params.connectors} onChange={(connectors) => setParams({ connectors })} />
        <ColorField label="증가" value={params.posColor} onChange={(posColor) => setParams({ posColor })} />
        <ColorField label="감소" value={params.negColor} onChange={(negColor) => setParams({ negColor })} />
        <ColorField label="시작·합계" value={params.totalColor} onChange={(totalColor) => setParams({ totalColor })} />
      </ControlGroup>
    </>
  )
}

export const waterfallModule: VizModule<WaterfallParams> = {
  roles: [
    { key: 'category', label: '항목', type: 'category', required: true },
    { key: 'delta', label: '증감값', type: 'number', required: true },
  ],
  datasets: ['cashflow'],
  defaultParams: { start: 0, startLabel: '', total: true, totalLabel: '순이익', connectors: true, labels: true, posColor: '#2a8c82', negColor: '#cf4f6a', totalColor: '#4c6fb5' },
  Chart: WaterfallChart,
  Controls: WaterfallControls,
  hint: '증감 막대의 끝을 위아래로 드래그해 값 수정 · 이후 막대가 함께 이동합니다',
}
