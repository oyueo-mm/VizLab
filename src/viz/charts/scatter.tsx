import * as d3 from 'd3'
import { Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Legend, Readout, Tooltip, localPoint, margins, useSvgId, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { categoryColor } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { appendRow, removeRows, templateRow, updateRow } from '../../data/table'
import { useTween } from '../../hooks/motion'
import { linearRegression, pearson } from '../../stats/descriptive'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { dragDigits, paddedDomain, pointRows, roundTo, uniqueGroups } from './shared'

export interface ScatterParams {
  size: number
  opacity: number
  regression: boolean
  /** bubble only */
  maxRadius: number
  sizeMode: 'area' | 'radius'
  hidden: string[]
}

const defaults: ScatterParams = { size: 5, opacity: 0.75, regression: false, maxRadius: 26, sizeMode: 'area', hidden: [] }

function PointChart({ table, mapping, params, setParams, width, height, compact, onTableChange, bubble, linked }: ChartProps<ScatterParams> & { bubble?: boolean }) {
  const xCol = roleColumn(mapping, 'x')
  const yCol = roleColumn(mapping, 'y')
  const colorCol = roleColumn(mapping, 'color')
  const sizeCol = bubble ? roleColumn(mapping, 'size') : null
  const all = useMemo(() => pointRows(table, xCol, yCol, colorCol, sizeCol), [table, xCol, yCol, colorCol, sizeCol])
  const groups = useMemo(() => uniqueGroups(all), [all])
  const color = useMemo(() => categoryColor(groups), [groups])
  const pts = useMemo(() => all.filter((p) => !params.hidden.includes(p.group)), [all, params.hidden])
  const m = margins(compact)
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const [selected, setSelected] = useState<number[]>([])
  const linkedSet = useMemo(() => new Set(linked?.rows ?? []), [linked?.rows])
  const [dragging, setDragging] = useState(false)
  const locked = useRef<{ x: [number, number]; y: [number, number] } | null>(null)
  const drag = useRef<{ i: number; moved: boolean } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const { tip, show, hide } = useTooltip()
  const clipId = useSvgId('scatter-clip')

  const domainX = locked.current?.x ?? paddedDomain(all.map((p) => p.x))
  const domainY = locked.current?.y ?? paddedDomain(all.map((p) => p.y))
  const x = d3.scaleLinear().domain(domainX).range([0, iw])
  const y = d3.scaleLinear().domain(domainY).range([ih, 0])
  const sizes = all.map((p) => p.size).filter((s): s is number => s != null && s >= 0)
  const maxSize = d3.max(sizes) ?? 1
  // Area encoding (sqrt) keeps circle area proportional to the value; radius encoding exaggerates large values.
  const r = bubble
    ? params.sizeMode === 'area'
      ? d3.scaleSqrt().domain([0, maxSize]).range([0, compact ? params.maxRadius / 2.4 : params.maxRadius])
      : d3.scaleLinear().domain([0, maxSize]).range([0, compact ? params.maxRadius / 2.4 : params.maxRadius])
    : () => (compact ? Math.max(1.5, params.size * 0.55) : params.size)

  const order = useMemo(() => (bubble ? [...pts].sort((a, b) => (b.size ?? 0) - (a.size ?? 0)) : pts), [pts, bubble])
  const geometry = useMemo(
    () => order.map((p) => [x(p.x), y(p.y), p.size != null && p.size >= 0 ? (r as (v: number) => number)(p.size) : bubble ? 0 : (r as () => number)()] as [number, number, number]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order, iw, ih, domainX[0], domainX[1], domainY[0], domainY[1], params.size, params.maxRadius, params.sizeMode, compact, bubble, maxSize],
  )
  const shown = useTween(geometry, { enabled: !dragging && pts.length <= 600, snapKey: `${iw}x${ih}` })

  const reg = useMemo(() => {
    if (pts.length < 2) return null
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    return { ...linearRegression(xs, ys), r: pearson(xs, ys) }
  }, [pts])

  useEffect(() => { setSelected((s) => s.filter((i) => i < table.rows.length)) }, [table.rows.length])

  if (!xCol || !yCol) return <ChartMessage>X축과 Y축에 사용할 숫자형 열을 선택하세요.</ChartMessage>
  if (!all.length) return <ChartMessage>그릴 수 있는 숫자 쌍이 없습니다. 데이터에 숫자 값을 입력하세요.</ChartMessage>

  const editable = !!onTableChange && !compact
  const digitsX = dragDigits(domainX[1] - domainX[0])
  const digitsY = dragDigits(domainY[1] - domainY[0])
  const toData = (e: PointerEvent) => {
    const p = localPoint(svgRef.current!, e)
    return { dx: roundTo(x.invert(p.x - m.left), digitsX), dy: roundTo(y.invert(p.y - m.top), digitsY), px: p.x, py: p.y }
  }

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!editable) return
    const target = (e.target as Element).closest('[data-i]')
    if (target) {
      const i = Number(target.getAttribute('data-i'))
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      drag.current = { i, moved: false }
      locked.current = { x: domainX, y: domainY }
      setSelected((s) => (e.shiftKey ? (s.includes(i) ? s.filter((k) => k !== i) : [...s, i]) : [i]))
      hide()
    } else drag.current = { i: -1, moved: false }
  }
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (d && d.i >= 0) {
      const { dx, dy } = toData(e)
      d.moved = true
      if (!dragging) setDragging(true)
      onTableChange!(updateRow(table, d.i, { [xCol]: dx, [yCol]: dy }), true)
    }
  }
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    drag.current = null
    locked.current = null
    if (dragging) { setDragging(false); onTableChange!(table, false) }
    if (!editable || !d || d.i >= 0) return
    const { dx, dy, px, py } = toData(e)
    if (px < m.left || py < m.top || px > m.left + iw || py > m.top + ih) return
    const base = templateRow(table)
    // A new point joins the first visible colour group so it is not immediately hidden.
    if (colorCol && groups.length) base[colorCol] = groups.find((g) => !params.hidden.includes(g)) ?? groups[0]
    onTableChange!(appendRow(table, { ...base, [xCol]: dx, [yCol]: dy }))
    setSelected([table.rows.length])
  }
  const removeSelected = () => {
    if (!selected.length) return
    onTableChange!(removeRows(table, selected))
    setSelected([])
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (!editable) return
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) { e.preventDefault(); removeSelected() }
    if (e.key === 'Escape') setSelected([])
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }
    if (arrows[e.key] && selected.length === 1) {
      e.preventDefault()
      const p = all.find((q) => q.i === selected[0])
      if (!p) return
      const [ax, ay] = arrows[e.key]
      const sx = (domainX[1] - domainX[0]) / 100
      const sy = (domainY[1] - domainY[0]) / 100
      onTableChange!(updateRow(table, p.i, { [xCol]: roundTo(p.x + ax * sx, digitsX), [yCol]: roundTo(p.y + ay * sy, digitsY) }))
    }
  }

  const sizeLegend = bubble && !compact && sizes.length ? [maxSize / 4, maxSize / 2, maxSize].map((v) => ({ v, r: (r as (v: number) => number)(v) })) : []

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} tabIndex={editable ? 0 : -1}
        role="img" aria-label={`${bubble ? '버블 차트' : '산점도'}: ${xCol} 대 ${yCol}, ${pts.length}개 점`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onKeyDown={onKeyDown}
        onPointerLeave={hide} data-testid="chart-svg">
        <g transform={`translate(${m.left},${m.top})`}>
          <clipPath id={clipId}><rect width={iw} height={ih} /></clipPath>
          <rect width={iw} height={ih} fill="transparent" className="plot-bg" />
          <AxisBottom scale={x} y={ih} grid={ih} label={xCol} compact={compact} />
          <AxisLeft scale={y} x={0} grid={iw} label={yCol} compact={compact} />
          <g className="marks">
            {order.map((p, k) => {
              const g = shown[k] ?? geometry[k]
              const sel = selected.includes(p.i)
              const hot = linkedSet.has(p.i)
              return (
                <circle key={p.i} data-i={p.i} className={`mark-point ${sel ? 'is-selected' : ''}`} cx={g[0]} cy={g[1]} r={Math.max(0, g[2])}
                  fill={hot ? '#e07a3f' : color(p.group)} fillOpacity={hot ? 1 : params.opacity} stroke={hot ? '#111827' : sel ? '#111827' : bubble ? '#fff' : 'none'} strokeWidth={hot || sel ? 2 : 0.8}
                  onPointerEnter={compact ? undefined : (e) => {
                    if (drag.current) return
                    linked?.set([p.i])
                    const lp = localPoint(svgRef.current!, e)
                    show(lp.x, lp.y, <><b>{p.group || `행 ${p.i + 1}`}</b><br />{xCol}: {fmt(p.x)}<br />{yCol}: {fmt(p.y)}{sizeCol && <><br />{sizeCol}: {fmt(p.size)}</>}</>)
                  }}
                  onPointerLeave={() => { hide(); linked?.set(null) }} />
              )
            })}
          </g>
          {params.regression && reg && Number.isFinite(reg.slope) && (
            <line className="regression" x1={0} x2={iw} y1={y(reg.intercept + reg.slope * domainX[0])} y2={y(reg.intercept + reg.slope * domainX[1])} clipPath={`url(#${clipId})`} />
          )}
          {sizeLegend.length > 0 && (
            <g transform={`translate(${iw - 4},${ih - 6})`} className="size-legend" aria-hidden="true">
              {sizeLegend.map((s) => <circle key={s.v} cx={-params.maxRadius} cy={-s.r} r={s.r} />)}
              {sizeLegend.map((s) => <text key={`t${s.v}`} x={-params.maxRadius * 2 - 6} y={-2 * s.r} dy="0.35em" textAnchor="end">{fmt(s.v, 1)}</text>)}
            </g>
          )}
        </g>
      </svg>
      {!compact && (
        <>
          {colorCol && <Legend items={groups.map((g) => ({ key: g, color: color(g) }))} hidden={params.hidden} title={colorCol}
            onToggle={(k) => setParams({ hidden: params.hidden.includes(k) ? params.hidden.filter((h) => h !== k) : [...params.hidden, k] })} />}
          <Readout items={[
            { label: 'n', value: pts.length },
            { label: '피어슨 r', value: reg ? fmt(reg.r, 3) : '–' },
            ...(params.regression && reg ? [{ label: '회귀식', value: `y = ${fmt(reg.slope, 3)}x ${reg.intercept < 0 ? '−' : '+'} ${fmt(Math.abs(reg.intercept), 2)}` }] : []),
          ]} />
          {editable && selected.length > 0 && (
            <div className="chart-actions">
              <span>{selected.length}개 선택</span>
              <button type="button" onClick={removeSelected} data-testid="delete-selected"><Trash2 size={14} aria-hidden="true" />삭제</button>
            </div>
          )}
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function ScatterControls({ params, setParams }: ControlsProps<ScatterParams>) {
  return (
    <>
      <ControlGroup title="점 표시">
        <Slider label="점 크기" value={params.size} min={1} max={14} step={0.5} onChange={(size) => setParams({ size })} testId="ctl-size" />
        <Slider label="투명도" value={params.opacity} min={0.1} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} testId="ctl-opacity" />
        <Hint>점이 많이 겹칠 때 투명도를 낮추면 밀집된 곳이 더 진하게 보입니다.</Hint>
      </ControlGroup>
      <ControlGroup title="분석">
        <Toggle label="회귀선 표시" description="최소제곱 직선 y = a + bx" checked={params.regression} onChange={(regression) => setParams({ regression })} testId="ctl-regression" />
      </ControlGroup>
    </>
  )
}

function BubbleControls({ params, setParams }: ControlsProps<ScatterParams>) {
  return (
    <>
      <ControlGroup title="크기 인코딩">
        <Segmented label="크기 대응 방식" value={params.sizeMode} onChange={(sizeMode) => setParams({ sizeMode })} testId="ctl-sizemode"
          options={[{ value: 'area', label: '면적 ∝ 값' }, { value: 'radius', label: '반지름 ∝ 값' }]} />
        <Hint>사람은 원의 넓이로 크기를 판단합니다. 반지름에 비례시키면 큰 값이 실제보다 제곱만큼 과장됩니다.</Hint>
        <Slider label="최대 반지름" value={params.maxRadius} min={8} max={50} onChange={(maxRadius) => setParams({ maxRadius })} format={(v) => `${v}px`} testId="ctl-maxradius" />
        <Slider label="투명도" value={params.opacity} min={0.1} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} testId="ctl-opacity" />
      </ControlGroup>
      <ControlGroup title="분석">
        <Toggle label="회귀선 표시" checked={params.regression} onChange={(regression) => setParams({ regression })} />
      </ControlGroup>
    </>
  )
}

export const scatterModule: VizModule<ScatterParams> = {
  roles: [
    { key: 'x', label: 'X축', type: 'number', required: true },
    { key: 'y', label: 'Y축', type: 'number', required: true },
    { key: 'color', label: '색상', type: 'category', auto: true },
  ],
  datasets: ['pos-corr', 'neg-corr', 'flowers', 'cars', 'dense'],
  defaultParams: defaults,
  Chart: (p) => <PointChart {...p} />,
  Controls: ScatterControls,
  hint: '빈 곳을 클릭해 점 추가 · 점을 드래그해 이동 · Shift+클릭으로 여러 개 선택 · Delete로 삭제',
}

export const bubbleModule: VizModule<ScatterParams> = {
  roles: [
    { key: 'x', label: 'X축', type: 'number', required: true },
    { key: 'y', label: 'Y축', type: 'number', required: true },
    { key: 'size', label: '크기', type: 'number', required: true },
    { key: 'color', label: '색상', type: 'category', auto: true },
  ],
  datasets: ['pos-corr', 'neg-corr', 'cars', 'flowers'],
  defaultParams: { ...defaults, opacity: 0.6 },
  Chart: (p) => <PointChart {...p} bubble />,
  Controls: BubbleControls,
  hint: '빈 곳을 클릭해 버블 추가 · 드래그해 이동 · Delete로 선택 삭제',
}
