import * as d3 from 'd3'
import { useMemo, useRef, type PointerEvent } from 'react'
import { ChartMessage, Legend, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { updateRow } from '../../data/table'
import { fmt } from '../../lib/format'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { pairRows, type PairRow } from './dumbbell'
import { dragDigits, paddedDomain, roundTo } from './shared'

export interface SlopeParams {
  sort: 'none' | 'start' | 'end' | 'change' | 'name'
  highlight: 'direction' | 'none'
  /** Name of one emphasised item; the rest are dimmed. */
  focus: string
  size: number
  showValues: boolean
  scale: 'linear' | 'log'
}

/** Spreads label y positions so neighbouring labels are at least `gap` apart while staying near their targets. */
export function spreadLabels(targets: readonly number[], gap: number, lo: number, hi: number) {
  const order = targets.map((t, i) => [t, i] as const).sort((a, b) => a[0] - b[0])
  const pos = order.map(([t]) => t)
  for (let iter = 0; iter < 40; iter++) {
    let moved = false
    for (let k = 1; k < pos.length; k++) {
      const d = pos[k] - pos[k - 1]
      if (d < gap) { const s = (gap - d) / 2; pos[k - 1] -= s; pos[k] += s; moved = true }
    }
    pos[0] = Math.max(lo, pos[0])
    pos[pos.length - 1] = Math.min(hi, pos[pos.length - 1])
    if (!moved) break
  }
  const out = new Array<number>(targets.length)
  order.forEach(([, i], k) => { out[i] = pos[k] })
  return out
}

const UP = '#2a8c82'
const DOWN = '#cf4f6a'
const FLAT = '#9aa3a0'

function SlopeChart({ table, mapping, params, setParams, width, height, compact, onTableChange }: ChartProps<SlopeParams>) {
  const catCol = roleColumn(mapping, 'category')
  const aCol = roleColumn(mapping, 'start')
  const bCol = roleColumn(mapping, 'end')
  const rows = useMemo(() => {
    const out = pairRows(table, catCol, aCol, bCol)
    const by: Record<string, (p: PairRow, q: PairRow) => number> = { start: (p, q) => q.a - p.a, end: (p, q) => q.b - p.b, change: (p, q) => q.diff - p.diff, name: (p, q) => p.name.localeCompare(q.name, 'ko') }
    return by[params.sort] ? out.sort(by[params.sort]) : out
  }, [table, catCol, aCol, bCol, params.sort])
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ row: number; col: string; domain: [number, number] } | null>(null)
  const { tip, show, hide } = useTooltip()
  const padX = compact ? 10 : Math.min(150, width * 0.24)
  const top = compact ? 10 : 68
  const bottom = compact ? 10 : 26
  const ih = Math.max(10, height - top - bottom)
  const x0 = padX
  const x1 = Math.max(padX + 20, width - padX)
  const log = params.scale === 'log' && rows.every((p) => p.a > 0 && p.b > 0)
  const dom = drag.current?.domain ?? paddedDomain(rows.flatMap((p) => [p.a, p.b]), 0.06)
  const y = (log ? d3.scaleLog().domain([Math.max(1e-9, dom[0] <= 0 ? d3.min(rows.flatMap((p) => [p.a, p.b])) ?? 1 : dom[0]), dom[1]]) : d3.scaleLinear().domain(dom)).range([ih, 0])
  if (!drag.current && !log) (y as d3.ScaleLinear<number, number>).nice()

  const gap = 15
  const labelsL = useMemo(() => spreadLabels(rows.map((p) => y(p.a)), gap, 0, ih), [rows, ih, dom[0], dom[1], log]) // eslint-disable-line react-hooks/exhaustive-deps
  const labelsR = useMemo(() => spreadLabels(rows.map((p) => y(p.b)), gap, 0, ih), [rows, ih, dom[0], dom[1], log]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!catCol || !aCol || !bCol) return <ChartMessage>항목, 시작값, 종료값 열을 선택하세요.</ChartMessage>
  if (aCol === bCol) return <ChartMessage>시작값과 종료값에 서로 다른 열을 선택하세요.</ChartMessage>
  if (!rows.length) return <ChartMessage>두 값이 모두 있는 항목이 없습니다.</ChartMessage>
  const editable = !!onTableChange && !compact
  const digits = dragDigits(dom[1] - dom[0])
  const colorOf = (p: PairRow) => (params.highlight === 'none' ? '#4c6fb5' : p.diff > 0 ? UP : p.diff < 0 ? DOWN : FLAT)
  const dim = (p: PairRow) => !!params.focus && params.focus !== p.name

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!editable) return
    const t = (e.target as Element).closest('[data-row]')
    if (!t) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { row: Number(t.getAttribute('data-row')), col: t.getAttribute('data-end') === 'a' ? aCol : bCol, domain: dom as [number, number] }
    hide()
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag.current || log) return
    const p = localPoint(svgRef.current!, e)
    onTableChange!(updateRow(table, drag.current.row, { [drag.current.col]: roundTo((y as d3.ScaleLinear<number, number>).invert(p.y - top), digits) }), true)
  }
  const onUp = () => {
    if (!drag.current) return
    drag.current = null
    onTableChange!(table, false)
  }
  const ups = rows.filter((p) => p.diff > 0).length
  const downs = rows.filter((p) => p.diff < 0).length

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable && !log ? 'is-editable' : ''}`} role="img" data-testid="chart-svg"
        aria-label={`슬로프 차트: ${catCol}별 ${aCol}에서 ${bCol}으로의 변화`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={hide}>
        {!compact && (
          <g className="axis" aria-hidden="true">
            <text className="axis-label" x={x0} y={top - 22} textAnchor="middle">{aCol}</text>
            <text className="axis-label" x={x1} y={top - 22} textAnchor="middle">{bCol}</text>
          </g>
        )}
        <g transform={`translate(0,${top})`}>
          <line className="slope-axis" x1={x0} x2={x0} y1={0} y2={ih} />
          <line className="slope-axis" x1={x1} x2={x1} y1={0} y2={ih} />
          {rows.map((p, i) => {
            const c = colorOf(p)
            const faded = dim(p)
            const label = p.name.length > 10 ? `${p.name.slice(0, 9)}…` : p.name
            return (
              <g key={p.row} className="marks slope-item" opacity={faded ? 0.25 : 1} data-testid="slope-item"
                onPointerEnter={compact ? undefined : (e) => { if (drag.current) return; const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{p.name}</b><br />{aCol}: {fmt(p.a)}<br />{bCol}: {fmt(p.b)}<br />변화: {p.diff > 0 ? '+' : ''}{fmt(p.diff)}{p.a !== 0 && <> ({p.diff > 0 ? '+' : ''}{fmt((p.diff / Math.abs(p.a)) * 100, 1)}%)</>}</>) }} onPointerLeave={hide}
                onClick={compact ? undefined : () => setParams({ focus: params.focus === p.name ? '' : p.name })}>
                <line className="slope-line" x1={x0} y1={y(p.a)} x2={x1} y2={y(p.b)} stroke={c} strokeWidth={compact ? 1.5 : params.focus === p.name ? 3.4 : 2} />
                <circle data-row={p.row} data-end="a" className={editable && !log ? 'is-draggable' : ''} cx={x0} cy={y(p.a)} r={compact ? 2.5 : params.size} fill={c} />
                <circle data-row={p.row} data-end="b" className={editable && !log ? 'is-draggable' : ''} cx={x1} cy={y(p.b)} r={compact ? 2.5 : params.size} fill={c} />
                {!compact && (
                  <>
                    <text className="slope-label" x={x0 - params.size - 6} y={labelsL[i]} dy="0.32em" textAnchor="end">{label}{params.showValues ? ` ${fmt(p.a)}` : ''}</text>
                    <text className="slope-label" x={x1 + params.size + 6} y={labelsR[i]} dy="0.32em">{params.showValues ? `${fmt(p.b)} ` : ''}{label}</text>
                  </>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          {params.highlight === 'direction' && <Legend items={[{ key: `증가 ${ups}`, color: UP }, { key: `감소 ${downs}`, color: DOWN }, { key: `변화 없음 ${rows.length - ups - downs}`, color: FLAT }]} />}
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function SlopeControls({ params, setParams, table, mapping }: ControlsProps<SlopeParams>) {
  const names = pairRows(table, roleColumn(mapping, 'category'), roleColumn(mapping, 'start'), roleColumn(mapping, 'end')).map((p) => p.name)
  return (
    <>
      <ControlGroup title="정렬·강조">
        <Select label="정렬 기준" value={params.sort} onChange={(sort) => setParams({ sort })} testId="ctl-sort"
          options={[{ value: 'none', label: '데이터 순서' }, { value: 'start', label: '시작값 큰 순' }, { value: 'end', label: '종료값 큰 순' }, { value: 'change', label: '변화량 큰 순' }, { value: 'name', label: '이름순' }]} />
        <Segmented label="선 색" value={params.highlight} onChange={(highlight) => setParams({ highlight })} testId="ctl-highlight"
          options={[{ value: 'direction', label: '증가·감소 구분' }, { value: 'none', label: '단색' }]} />
        <Select label="강조할 항목" value={params.focus} onChange={(focus) => setParams({ focus })} testId="ctl-focus"
          options={[{ value: '', label: '없음' }, ...names.map((n) => ({ value: n, label: n }))]} />
        <Hint>선을 클릭해도 강조됩니다. 값이 비슷한 항목의 레이블은 겹치지 않게 위아래로 벌려 놓지만 점의 위치는 그대로입니다.</Hint>
      </ControlGroup>
      <ControlGroup title="표시">
        <Slider label="점 크기" value={params.size} min={2} max={9} step={0.5} onChange={(size) => setParams({ size })} />
        <Toggle label="값 표시" checked={params.showValues} onChange={(showValues) => setParams({ showValues })} />
        <Segmented label="세로축" value={params.scale} onChange={(scale) => setParams({ scale })} testId="ctl-scale"
          options={[{ value: 'linear', label: '선형' }, { value: 'log', label: '로그 (비율 변화)' }]} />
        <Hint>로그 축에서는 기울기가 변화율(%)에 비례합니다. 값이 모두 양수일 때만 적용되며, 이 모드에서는 드래그 편집이 꺼집니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const slopeModule: VizModule<SlopeParams> = {
  roles: [
    { key: 'category', label: '항목', type: 'category', required: true },
    { key: 'start', label: '시작값 (왼쪽)', type: 'number', required: true },
    { key: 'end', label: '종료값 (오른쪽)', type: 'number', required: true },
  ],
  datasets: ['before-after', 'players'],
  defaultParams: { sort: 'none', highlight: 'direction', focus: '', size: 5, showValues: true, scale: 'linear' },
  Chart: SlopeChart,
  Controls: SlopeControls,
  hint: '양 끝점을 위아래로 드래그해 값 수정 · 선을 클릭해 강조 · 데이터 탭에서 항목 추가·삭제',
}
