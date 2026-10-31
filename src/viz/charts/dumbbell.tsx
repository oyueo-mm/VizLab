import * as d3 from 'd3'
import { useMemo, useRef, type PointerEvent } from 'react'
import { AxisBottom, ChartMessage, Legend, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Select, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, updateRow } from '../../data/table'
import { fmt } from '../../lib/format'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { dragDigits, paddedDomain, roundTo } from './shared'

export interface DumbbellParams {
  sort: 'none' | 'diff-desc' | 'diff-asc' | 'start' | 'end' | 'name'
  size: number
  showDiff: boolean
  labels: boolean
  colorByDirection: boolean
}

export interface PairRow { row: number; name: string; a: number; b: number; diff: number }

/** Rows with a label and two finite values; `diff` = end − start. */
export function pairRows(table: ChartProps<unknown>['table'], catCol: string | null, aCol: string | null, bCol: string | null): PairRow[] {
  const ci = columnIndex(table, catCol)
  const ai = columnIndex(table, aCol)
  const bi = columnIndex(table, bCol)
  if (ci < 0 || ai < 0 || bi < 0) return []
  const out: PairRow[] = []
  table.rows.forEach((r, row) => {
    const a = toNumber(r[ai])
    const b = toNumber(r[bi])
    const name = toLabel(r[ci])
    if (a == null || b == null || !name) return
    out.push({ row, name, a, b, diff: b - a })
  })
  return out
}

export function sortPairs(rows: PairRow[], sort: DumbbellParams['sort']) {
  const out = [...rows]
  const by: Record<string, (p: PairRow, q: PairRow) => number> = {
    'diff-desc': (p, q) => q.diff - p.diff, 'diff-asc': (p, q) => p.diff - q.diff, start: (p, q) => q.a - p.a, end: (p, q) => q.b - p.b, name: (p, q) => p.name.localeCompare(q.name, 'ko'),
  }
  if (by[sort]) out.sort(by[sort])
  return out
}

const UP = '#2a8c82'
const DOWN = '#cf4f6a'

function DumbbellChart({ table, mapping, params, width, height, compact, onTableChange }: ChartProps<DumbbellParams>) {
  const catCol = roleColumn(mapping, 'category')
  const aCol = roleColumn(mapping, 'start')
  const bCol = roleColumn(mapping, 'end')
  const rows = useMemo(() => sortPairs(pairRows(table, catCol, aCol, bCol), params.sort), [table, catCol, aCol, bCol, params.sort])
  const m = margins(compact, compact ? {} : { left: 92, top: 44 })
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ row: number; col: string; domain: [number, number] } | null>(null)
  const { tip, show, hide } = useTooltip()
  const x = d3.scaleLinear().domain(drag.current?.domain ?? paddedDomain(rows.flatMap((p) => [p.a, p.b]), 0.08)).range([0, iw])
  if (!drag.current) x.nice()
  const band = d3.scaleBand().domain(rows.map((p) => String(p.row))).range([0, ih]).padding(0.45)

  if (!catCol || !aCol || !bCol) return <ChartMessage>항목, 시작값, 종료값 열을 선택하세요.</ChartMessage>
  if (aCol === bCol) return <ChartMessage>시작값과 종료값에 서로 다른 열을 선택하세요.</ChartMessage>
  if (!rows.length) return <ChartMessage>두 값이 모두 있는 항목이 없습니다.</ChartMessage>
  const editable = !!onTableChange && !compact
  const digits = dragDigits(x.domain()[1] - x.domain()[0])
  const r = compact ? 2.5 : params.size
  const color = (p: PairRow) => (params.colorByDirection ? (p.diff >= 0 ? UP : DOWN) : '#4c6fb5')

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!editable) return
    const t = (e.target as Element).closest('[data-row]')
    if (!t) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { row: Number(t.getAttribute('data-row')), col: t.getAttribute('data-end') === 'a' ? aCol : bCol, domain: x.domain() as [number, number] }
    hide()
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return
    const p = localPoint(svgRef.current!, e)
    onTableChange!(updateRow(table, drag.current.row, { [drag.current.col]: roundTo(x.invert(p.x - m.left), digits) }), true)
  }
  const onUp = () => {
    if (!drag.current) return
    drag.current = null
    onTableChange!(table, false)
  }

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} role="img" data-testid="chart-svg"
        aria-label={`덤벨 차트: ${catCol}별 ${aCol}과 ${bCol}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisBottom scale={x} y={ih} grid={ih} compact={compact} label="값" />
          {rows.map((p) => {
            const cy = (band(String(p.row)) ?? 0) + band.bandwidth() / 2
            const c = color(p)
            const mid = (x(p.a) + x(p.b)) / 2
            return (
              <g key={p.row} className="marks">
                {!compact && <text className="cat-label" x={-10} y={cy} dy="0.32em" textAnchor="end"><title>{p.name}</title>{p.name.length > 9 ? `${p.name.slice(0, 8)}…` : p.name}</text>}
                <line className="dumbbell-bar" x1={x(p.a)} x2={x(p.b)} y1={cy} y2={cy} stroke={c} strokeWidth={compact ? 1.5 : 3} strokeOpacity={0.55} />
                <circle className="dumbbell-a" data-row={p.row} data-end="a" cx={x(p.a)} cy={cy} r={r} fill="#fff" stroke={c} strokeWidth={2.2}
                  onPointerEnter={compact ? undefined : (e) => { if (drag.current) return; const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{p.name}</b><br />{aCol}: {fmt(p.a)}<br />{bCol}: {fmt(p.b)}<br />차이: {p.diff > 0 ? '+' : ''}{fmt(p.diff)}</>) }} onPointerLeave={hide} />
                <circle className="dumbbell-b" data-row={p.row} data-end="b" data-testid="dumbbell-end" cx={x(p.b)} cy={cy} r={r} fill={c} stroke={c} strokeWidth={2.2}
                  onPointerEnter={compact ? undefined : (e) => { if (drag.current) return; const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{p.name}</b><br />{aCol}: {fmt(p.a)}<br />{bCol}: {fmt(p.b)}<br />차이: {p.diff > 0 ? '+' : ''}{fmt(p.diff)}</>) }} onPointerLeave={hide} />
                {params.showDiff && !compact && <text className="bar-label" x={mid} y={cy - r - 4} textAnchor="middle">{p.diff > 0 ? '+' : ''}{fmt(p.diff)}</text>}
                {params.labels && !compact && (
                  <>
                    <text className="bar-label" x={Math.min(x(p.a), x(p.b)) - r - 5} y={cy} dy="0.35em" textAnchor="end">{fmt(p.diff >= 0 ? p.a : p.b)}</text>
                    <text className="bar-label" x={Math.max(x(p.a), x(p.b)) + r + 5} y={cy} dy="0.35em">{fmt(p.diff >= 0 ? p.b : p.a)}</text>
                  </>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          <Legend items={[{ key: `○ ${aCol}`, color: '#6b7280' }, { key: `● ${bCol}`, color: '#6b7280' }, ...(params.colorByDirection ? [{ key: '증가', color: UP }, { key: '감소', color: DOWN }] : [])]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function DumbbellControls({ params, setParams }: ControlsProps<DumbbellParams>) {
  return (
    <>
      <ControlGroup title="정렬">
        <Select label="정렬 기준" value={params.sort} onChange={(sort) => setParams({ sort })} testId="ctl-sort"
          options={[{ value: 'none', label: '데이터 순서' }, { value: 'diff-desc', label: '차이 큰 순 (증가 먼저)' }, { value: 'diff-asc', label: '차이 작은 순 (감소 먼저)' }, { value: 'start', label: '시작값 큰 순' }, { value: 'end', label: '종료값 큰 순' }, { value: 'name', label: '이름순' }]} />
      </ControlGroup>
      <ControlGroup title="표시">
        <Slider label="점 크기" value={params.size} min={3} max={12} step={0.5} onChange={(size) => setParams({ size })} />
        <Toggle label="차이값 표시" description="종료값 − 시작값" checked={params.showDiff} onChange={(showDiff) => setParams({ showDiff })} testId="ctl-diff" />
        <Toggle label="양 끝 값 표시" checked={params.labels} onChange={(labels) => setParams({ labels })} />
        <Toggle label="증가·감소 색 구분" checked={params.colorByDirection} onChange={(colorByDirection) => setParams({ colorByDirection })} testId="ctl-direction" />
        <Hint>속이 빈 점이 시작값, 채워진 점이 종료값입니다. 두 점을 각각 좌우로 드래그하면 데이터 표의 값이 바뀌고 차이값도 함께 갱신됩니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const dumbbellModule: VizModule<DumbbellParams> = {
  roles: [
    { key: 'category', label: '항목', type: 'category', required: true },
    { key: 'start', label: '시작값', type: 'number', required: true },
    { key: 'end', label: '종료값', type: 'number', required: true },
  ],
  datasets: ['before-after', 'players'],
  defaultParams: { sort: 'diff-desc', size: 7, showDiff: true, labels: false, colorByDirection: true },
  Chart: DumbbellChart,
  Controls: DumbbellControls,
  hint: '점을 좌우로 드래그해 시작·종료 값 수정 · 마우스를 올려 차이 확인',
}
