import * as d3 from 'd3'
import { ArrowLeft, ArrowRight, FlipVertical2 } from 'lucide-react'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { ChartMessage, Legend, localPoint, margins } from '../../components/chart/primitives'
import { ControlGroup, Hint, Slider, Toggle } from '../../components/controls'
import { categoryColor } from '../../lib/colors'
import { fmt, tick } from '../../lib/format'
import { columnIndex, toLabel, toNumber, uniqueLabels } from '../../data/table'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { paddedDomain } from './shared'

export interface ParallelParams {
  order: string[]
  inverted: string[]
  filters: Record<string, [number, number]>
  opacity: number
  curved: boolean
}

/** Axis order: the saved order first (for columns still mapped), then newly mapped columns. */
export function orderedDims(mapped: string[], order: string[]) {
  return [...order.filter((d) => mapped.includes(d)), ...mapped.filter((d) => !order.includes(d))]
}

/** A row passes when every brushed axis contains its value (inclusive). */
export const passes = (values: Record<string, number>, filters: Record<string, [number, number]>) =>
  Object.entries(filters).every(([dim, [lo, hi]]) => !(dim in values) || (values[dim] >= lo && values[dim] <= hi))

function ParallelChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<ParallelParams>) {
  const dims = orderedDims(roleColumns(mapping, 'dims'), params.order)
  const colorCol = roleColumn(mapping, 'color')
  const svgRef = useRef<SVGSVGElement>(null)
  const m = margins(compact, compact ? {} : { top: 64, bottom: 28, left: 40, right: 40 })
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const [axisDrag, setAxisDrag] = useState<{ dim: string; x: number } | null>(null)
  const brush = useRef<{ dim: string; start: number; moved: boolean } | null>(null)
  const [hoverRow, setHoverRow] = useState<number | null>(null)

  const rows = useMemo(() => {
    const idx = dims.map((d) => columnIndex(table, d))
    const ci = columnIndex(table, colorCol)
    const out: { i: number; v: Record<string, number>; g: string }[] = []
    table.rows.forEach((r, i) => {
      const v: Record<string, number> = {}
      let ok = true
      dims.forEach((d, k) => { const n = toNumber(r[idx[k]]); if (n == null) ok = false; else v[d] = n })
      if (ok) out.push({ i, v, g: ci >= 0 ? toLabel(r[ci]) : '' })
    })
    return out
  }, [table, dims, colorCol])
  const groups = useMemo(() => uniqueLabels(rows.map((r) => r.g)), [rows])
  const color = useMemo(() => categoryColor(groups), [groups])
  const yScales = useMemo(() => Object.fromEntries(dims.map((d) => {
    const s = d3.scaleLinear().domain(paddedDomain(rows.map((r) => r.v[d]), 0.03)).range(params.inverted.includes(d) ? [0, ih] : [ih, 0])
    return [d, s]
  })), [dims, rows, ih, params.inverted])
  const xPos = d3.scalePoint().domain(dims).range([0, iw])
  const px = (d: string) => (axisDrag?.dim === d ? axisDrag.x : xPos(d) ?? 0)

  if (dims.length < 2) return <ChartMessage>축으로 쓸 숫자형 변수를 2개 이상 선택하세요.</ChartMessage>
  if (!rows.length) return <ChartMessage>모든 축 값이 채워진 행이 없습니다.</ChartMessage>
  const interactive = !compact
  const selected = rows.filter((r) => passes(r.v, params.filters))
  const linePath = (r: { v: Record<string, number> }) => {
    const pts = dims.map((d) => [px(d), yScales[d](r.v[d])] as [number, number]).sort((a, b) => a[0] - b[0])
    return (params.curved ? d3.line().curve(d3.curveMonotoneX) : d3.line())(pts) ?? ''
  }

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!interactive) return
    const t = e.target as Element
    const head = t.closest('[data-axis-head]')
    const body = t.closest('[data-axis-body]')
    if (!head && !body) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const lp = localPoint(svgRef.current!, e)
    if (head) setAxisDrag({ dim: head.getAttribute('data-axis-head')!, x: lp.x - m.left })
    else brush.current = { dim: body!.getAttribute('data-axis-body')!, start: lp.y - m.top, moved: false }
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const lp = localPoint(svgRef.current!, e)
    if (axisDrag) {
      const xNow = Math.max(0, Math.min(iw, lp.x - m.left))
      // Reorder live once the dragged axis passes a neighbour's position.
      const others = dims.filter((d) => d !== axisDrag.dim)
      const idx = others.filter((d) => (xPos(d) ?? 0) < xNow).length
      const next = [...others.slice(0, idx), axisDrag.dim, ...others.slice(idx)]
      if (next.join() !== dims.join()) setParams({ order: next })
      setAxisDrag({ dim: axisDrag.dim, x: xNow })
      return
    }
    const b = brush.current
    if (b) {
      const yNow = Math.max(0, Math.min(ih, lp.y - m.top))
      if (Math.abs(yNow - b.start) < 3 && !b.moved) return
      b.moved = true
      const s = yScales[b.dim]
      const [v0, v1] = [s.invert(b.start), s.invert(yNow)].sort((a, c) => a - c)
      setParams({ filters: { ...params.filters, [b.dim]: [v0, v1] } })
    }
  }
  const onUp = () => {
    if (axisDrag) setAxisDrag(null)
    const b = brush.current
    brush.current = null
    if (b && !b.moved && params.filters[b.dim]) {
      const { [b.dim]: _drop, ...rest } = params.filters
      void _drop
      setParams({ filters: rest })
    }
  }

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg"
        aria-label={`평행좌표 그래프: ${dims.join(', ')} 축, ${selected.length}/${rows.length}개 선택`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => setHoverRow(null)}>
        <g transform={`translate(${m.left},${m.top})`}>
          <g className="pc-lines-bg">
            {rows.map((r) => !passes(r.v, params.filters) && <path key={r.i} d={linePath(r)} className="pc-line is-out" />)}
          </g>
          <g className="pc-lines">
            {selected.map((r) => (
              <path key={r.i} d={linePath(r)} className="pc-line" stroke={groups.length ? color(r.g) : '#2a8c82'} strokeOpacity={hoverRow == null ? params.opacity : hoverRow === r.i ? 1 : params.opacity * 0.35}
                strokeWidth={hoverRow === r.i ? 2.6 : compact ? 0.8 : 1.3} data-testid="pc-line"
                onPointerEnter={interactive ? () => setHoverRow(r.i) : undefined} />
            ))}
          </g>
          {dims.map((d) => {
            const s = yScales[d]
            const f = params.filters[d]
            const x = px(d)
            return (
              <g key={d} transform={`translate(${x},0)`} className={`pc-axis ${axisDrag?.dim === d ? 'is-dragging' : ''}`}>
                <line y1={0} y2={ih} className="pc-axis-line" />
                {!compact && s.ticks(5).map((t) => (
                  <g key={t} transform={`translate(0,${s(t)})`} className="axis" aria-hidden="true"><line x2={-4} /><text x={-7} dy="0.32em" textAnchor="end">{tick(t)}</text></g>
                ))}
                {f && <rect className="pc-brush" x={-9} width={18} y={Math.min(s(f[0]), s(f[1]))} height={Math.abs(s(f[1]) - s(f[0]))} />}
                {interactive && <rect data-axis-body={d} className="pc-hit" x={-12} width={24} y={0} height={ih}><title>위아래로 드래그해 범위 필터 · 클릭하면 해제</title></rect>}
                {!compact && (
                  <text data-axis-head={d} className="pc-title" y={-16} textAnchor="middle">
                    {d}{params.inverted.includes(d) ? ' ↓' : ''}<title>좌우로 드래그해 축 순서 바꾸기</title>
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          {colorCol && <Legend items={groups.map((g) => ({ key: g, color: color(g) }))} title={colorCol} />}
          <dl className="chart-readout">
            <div><dt>선택</dt><dd data-testid="pc-selected">{selected.length} / {rows.length}</dd></div>
            {Object.entries(params.filters).filter(([d]) => dims.includes(d)).map(([d, [lo, hi]]) => <div key={d}><dt>{d}</dt><dd>{fmt(lo)} – {fmt(hi)}</dd></div>)}
          </dl>
        </>
      )}
    </div>
  )
}

function ParallelControls({ params, setParams, mapping }: ControlsProps<ParallelParams>) {
  const dims = orderedDims(roleColumns(mapping, 'dims'), params.order)
  const move = (i: number, dir: -1 | 1) => {
    const next = [...dims]
    ;[next[i], next[i + dir]] = [next[i + dir], next[i]]
    setParams({ order: next })
  }
  return (
    <>
      <ControlGroup title="축 순서와 방향">
        <ol className="order-list" data-testid="axis-order">
          {dims.map((d, i) => (
            <li key={d}>
              <span>{d}</span>
              <button type="button" aria-label={`${d} 왼쪽으로`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowLeft size={14} /></button>
              <button type="button" aria-label={`${d} 오른쪽으로`} disabled={i === dims.length - 1} onClick={() => move(i, 1)}><ArrowRight size={14} /></button>
              <button type="button" aria-label={`${d} 축 뒤집기`} aria-pressed={params.inverted.includes(d)} onClick={() => setParams({ inverted: params.inverted.includes(d) ? params.inverted.filter((x) => x !== d) : [...params.inverted, d] })}><FlipVertical2 size={14} /></button>
            </li>
          ))}
        </ol>
        <Hint>이웃한 축 사이의 관계만 잘 보입니다. 선들이 축 사이에서 X자로 교차하면 음의 상관, 나란하면 양의 상관입니다. 축을 뒤집으면 교차가 평행으로 바뀝니다.</Hint>
      </ControlGroup>
      <ControlGroup title="필터">
        <Hint>그래프의 축 위를 위아래로 드래그하면 그 범위의 행만 강조됩니다. 여러 축에 걸면 모두 만족하는 행만 남습니다.</Hint>
        <button type="button" className="btn btn-secondary" disabled={!Object.keys(params.filters).length} onClick={() => setParams({ filters: {} })} data-testid="clear-filters">모든 필터 해제</button>
      </ControlGroup>
      <ControlGroup title="선 표시">
        <Slider label="선 불투명도" value={params.opacity} min={0.05} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} testId="ctl-opacity" />
        <Toggle label="곡선으로 잇기" checked={params.curved} onChange={(curved) => setParams({ curved })} />
      </ControlGroup>
    </>
  )
}

export const parallelModule: VizModule<ParallelParams> = {
  roles: [
    { key: 'dims', label: '축 (숫자형 변수)', type: 'number', required: true, multiple: { min: 2, max: 10 } },
    { key: 'color', label: '색상', type: 'category', auto: true },
  ],
  datasets: ['cars', 'flowers', 'players'],
  defaultParams: { order: [], inverted: [], filters: {}, opacity: 0.55, curved: false },
  Chart: ParallelChart,
  Controls: ParallelControls,
  hint: '축 위를 위아래로 드래그해 범위 필터 · 축 이름을 좌우로 드래그해 순서 변경',
}
