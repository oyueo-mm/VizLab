import * as d3 from 'd3'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Legend, Tooltip, localPoint, margins, toggleIn, useSvgId, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { categoryColor } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { updateRow } from '../../data/table'
import { useTween } from '../../hooks/motion'
import { movingAverage } from '../../stats/descriptive'
import { stackSeries } from '../../stats/stack'
import { roleColumn } from '../mapping'
import type { ColumnType } from '../../data/table'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { dragDigits, isDateColumn, paddedDomain, pointRows, roundTo, uniqueGroups, xFormat, type PointDatum } from './shared'

export type CurveName = 'linear' | 'monotone' | 'step' | 'natural' | 'basis'
export const curves: Record<CurveName, d3.CurveFactory> = {
  linear: d3.curveLinear, monotone: d3.curveMonotoneX, step: d3.curveStepAfter, natural: d3.curveNatural, basis: d3.curveBasis,
}
export const curveOptions: { value: CurveName; label: string }[] = [
  { value: 'linear', label: '직선 연결' }, { value: 'monotone', label: '단조 곡선 (monotone)' }, { value: 'step', label: '계단 (step)' },
  { value: 'natural', label: '자연 스플라인' }, { value: 'basis', label: 'B-스플라인 (점을 지나지 않음)' },
]

/** Points per series sorted by x. */
export function seriesOf(pts: PointDatum[]) {
  const groups = uniqueGroups(pts)
  const keys = groups.length ? groups : ['']
  return keys.map((k) => ({ key: k, pts: pts.filter((p) => p.group === k).sort((a, b) => a.x - b.x) }))
}

export interface LineParams {
  curve: CurveName
  points: boolean
  ma: number
  zero: boolean
  hidden: string[]
  /** area only */
  mode: 'overlap' | 'stack' | 'normalize' | 'stream'
  opacity: number
}

function LineChart({ table, mapping, params, setParams, width, height, compact, onTableChange }: ChartProps<LineParams>) {
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
  const clip = useSvgId('line-clip')
  const drag = useRef<{ row: number; domain: [number, number] } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [hoverX, setHoverX] = useState<number | null>(null)
  const { tip, show, hide } = useTooltip()

  const visiblePts = series.flatMap((s) => s.pts)
  const x = d3.scaleLinear().domain(d3.extent(pts, (p) => p.x) as [number, number]).range([0, iw])
  const y = d3.scaleLinear().domain(drag.current?.domain ?? paddedDomain(visiblePts.map((p) => p.y), 0.06, params.zero)).range([ih, 0])
  if (!drag.current) y.nice()
  const target = useMemo(() => all.map((s) => s.pts.map((p) => y(p.y))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, ih, y.domain()[0], y.domain()[1]])
  const shown = useTween(target, { snapKey: `${iw}x${ih}`, enabled: !compact && !dragging && pts.length < 1500 })

  if (!xCol || !yCol) return <ChartMessage>X축과 Y축 숫자형 열을 선택하세요.</ChartMessage>
  if (!pts.length) return <ChartMessage>그릴 수 있는 점이 없습니다.</ChartMessage>
  const editable = !!onTableChange && !compact && params.points
  const xs = [...new Set(visiblePts.map((p) => p.x))].sort((a, b) => a - b)

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!editable) return
    const t = (e.target as Element).closest('[data-row]')
    if (!t) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { row: Number(t.getAttribute('data-row')), domain: y.domain() as [number, number] }
    setDragging(true)
    hide()
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const lp = localPoint(svgRef.current!, e)
    if (drag.current) {
      onTableChange!(updateRow(table, drag.current.row, { [yCol]: roundTo(y.invert(lp.y - m.top), dragDigits(y.domain()[1] - y.domain()[0])) }), true)
      return
    }
    if (compact || !xs.length) return
    const gx = x.invert(lp.x - m.left)
    const i = d3.bisectCenter(xs, gx)
    const nx = xs[i]
    setHoverX(nx)
    show(x(nx) + m.left, lp.y, <><b>{xCol} = {fx(nx)}</b>{series.map((s) => {
      const p = s.pts.find((q) => q.x === nx)
      return p ? <span key={s.key}><br /><i className="tip-swatch" style={{ background: color(s.key) }} />{s.key || yCol}: {fmt(p.y)}</span> : null
    })}</>)
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
        aria-label={`선그래프: ${xCol}에 따른 ${yCol}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onPointerLeave={() => { hide(); setHoverX(null) }}>
        <defs><clipPath id={clip}><rect x={-8} y={-8} width={iw + 16} height={ih + 16} /></clipPath></defs>
        <g transform={`translate(${m.left},${m.top})`}>
          <rect width={iw} height={ih} className="plot-bg" fill="transparent" />
          <AxisBottom scale={x} y={ih} label={xCol} compact={compact} date={isDate} />
          <AxisLeft scale={y} x={0} grid={iw} label={yCol} compact={compact} />
          {hoverX != null && <line className="crosshair" x1={x(hoverX)} x2={x(hoverX)} y1={0} y2={ih} />}
          <g clipPath={`url(#${clip})`}>
            {all.map((s, si) => {
              if (params.hidden.includes(s.key)) return null
              const ys = shown[si] ?? target[si]
              const line = d3.line<PointDatum>().curve(curves[params.curve]).x((p) => x(p.x)).y((_, i) => ys[i] ?? y(s.pts[i].y))
              const ma = params.ma > 1 ? movingAverage(s.pts.map((p) => p.y), params.ma) : null
              return (
                <g key={s.key} className="marks">
                  <path className="series-line" d={line(s.pts) ?? ''} stroke={color(s.key)} strokeOpacity={ma ? 0.45 : 1} data-testid="series-line" />
                  {ma && <path className="ma-line" d={d3.line<number>().x((_, i) => x(s.pts[i].x)).y((v) => y(v))(ma) ?? ''} stroke={color(s.key)} />}
                  {params.points && !compact && s.pts.map((p, i) => (
                    <circle key={p.i} data-row={p.i} className={`line-point ${editable ? 'is-draggable' : ''}`} cx={x(p.x)} cy={ys[i] ?? y(p.y)} r={hoverX === p.x ? 5 : 3.2} fill="#fff" stroke={color(s.key)} />
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

function LineControls({ params, setParams }: ControlsProps<LineParams>) {
  return (
    <>
      <ControlGroup title="선 모양">
        <Select label="보간 방식" value={params.curve} onChange={(curve) => setParams({ curve })} options={curveOptions} testId="ctl-curve" />
        <Hint>점 사이를 곡선으로 이으면 매끄러워 보이지만, 관측하지 않은 값이 있는 것처럼 보일 수 있습니다.</Hint>
        <Toggle label="데이터 점 표시" description="점을 위아래로 드래그해 값을 바꿀 수 있습니다" checked={params.points} onChange={(points) => setParams({ points })} testId="ctl-points" />
      </ControlGroup>
      <ControlGroup title="추세">
        <Slider label="이동평균 창 크기" value={params.ma} min={1} max={12} onChange={(ma) => setParams({ ma })} format={(v) => (v <= 1 ? '끔' : `${v}개 점`)} testId="ctl-ma" />
        <Hint>최근 k개 값의 평균으로 잡음과 계절 변동을 누그러뜨려 장기 추세를 봅니다.</Hint>
        <Toggle label="세로축을 0부터" checked={params.zero} onChange={(zero) => setParams({ zero })} testId="ctl-zero" />
      </ControlGroup>
    </>
  )
}

const lineRoles = [
  { key: 'x', label: 'X축 (날짜·시간·순서)', type: 'date' as const, accept: ['date', 'number'] as ColumnType[], required: true },
  { key: 'y', label: 'Y축 (값)', type: 'number' as const, required: true },
  { key: 'series', label: '계열', type: 'category' as const, auto: true },
]

const lineDefaults: LineParams = { curve: 'linear', points: true, ma: 1, zero: false, hidden: [], mode: 'stack', opacity: 0.75 }

export const lineModule: VizModule<LineParams> = {
  roles: lineRoles,
  datasets: ['timeseries', 'visits-dated', 'daily'],
  defaultParams: lineDefaults,
  Chart: LineChart,
  Controls: LineControls,
  hint: '점을 위아래로 드래그해 값 수정 · 마우스를 올려 같은 시점의 값 비교 · 범례로 계열 숨기기',
}

// ─── Area chart ──────────────────────────────────────────────────────────────

export { stackSeries }

function AreaChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<LineParams>) {
  const xCol = roleColumn(mapping, 'x')
  const yCol = roleColumn(mapping, 'y')
  const sCol = roleColumn(mapping, 'series')
  const isDate = isDateColumn(table, xCol)
  const fx = xFormat(isDate)
  const pts = useMemo(() => pointRows(table, xCol, yCol, sCol), [table, xCol, yCol, sCol])
  const all = useMemo(() => seriesOf(pts), [pts])
  const color = useMemo(() => categoryColor(all.map((s) => s.key)), [all])
  const series = useMemo(() => all.filter((s) => !params.hidden.includes(s.key)), [all, params.hidden])
  const m = margins(compact)
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverX, setHoverX] = useState<number | null>(null)
  const { tip, show, hide } = useTooltip()

  const { xs, layers } = useMemo(() => stackSeries(series, params.mode), [series, params.mode])
  const overlap = params.mode === 'overlap'
  const yDomain: [number, number] = overlap
    ? [0, d3.max(series, (s) => d3.max(s.pts, (p) => p.y)) ?? 1]
    : [d3.min(layers, (l) => d3.min(l, (d) => d[0])) ?? 0, d3.max(layers, (l) => d3.max(l, (d) => d[1])) ?? 1]
  const x = d3.scaleLinear().domain(d3.extent(pts, (p) => p.x) as [number, number]).range([0, iw])
  const y = d3.scaleLinear().domain(yDomain).range([ih, 0])
  if (params.mode !== 'normalize') y.nice()
  // Tween key: per visible series, flattened [y0, y1] per aligned x.
  const target = useMemo(() => {
    if (overlap) return series.map((s) => xs.map((xv) => { const p = s.pts.find((q) => q.x === xv); return [y(0), y(Math.max(0, p?.y ?? 0))] }))
    return layers.map((l) => l.map((d) => [y(d[0]), y(d[1])]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, series, xs, overlap, ih, y.domain()[0], y.domain()[1]])
  const shown = useTween(target, { snapKey: `${iw}x${ih}${series.length}`, enabled: !compact })

  if (!xCol || !yCol) return <ChartMessage>X축과 Y축 숫자형 열을 선택하세요.</ChartMessage>
  if (!pts.length) return <ChartMessage>그릴 수 있는 점이 없습니다.</ChartMessage>
  if (pts.some((p) => p.y < 0)) return <ChartMessage>영역 그래프는 음수 값을 쌓을 수 없습니다. 음수 값을 수정하세요.</ChartMessage>
  const order = overlap ? series.map((s) => s.key) : layers.map((l) => l.key)

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`영역 그래프: ${xCol}에 따른 ${yCol}`}
        onPointerMove={compact ? undefined : (e) => {
          const lp = localPoint(svgRef.current!, e)
          const i = d3.bisectCenter(xs, x.invert(lp.x - m.left))
          const xv = xs[i]
          if (xv == null) return
          setHoverX(xv)
          const totals = d3.sum(series, (s) => s.pts.find((p) => p.x === xv)?.y ?? 0)
          show(x(xv) + m.left, lp.y, <><b>{xCol} = {fx(xv)}</b>{[...series].reverse().map((s) => {
            const v = s.pts.find((p) => p.x === xv)?.y ?? 0
            return <span key={s.key}><br /><i className="tip-swatch" style={{ background: color(s.key) }} />{s.key || yCol}: {fmt(v)}{series.length > 1 ? ` (${pct(totals ? v / totals : 0)})` : ''}</span>
          })}{series.length > 1 && <><br />합계: {fmt(totals)}</>}</>)
        }}
        onPointerLeave={() => { hide(); setHoverX(null) }}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisBottom scale={x} y={ih} label={xCol} compact={compact} date={isDate} />
          {params.mode !== 'stream'
            ? <AxisLeft scale={y} x={0} grid={iw} label={params.mode === 'normalize' ? '비율' : yCol} compact={compact} format={params.mode === 'normalize' ? (v) => pct(v, 0) : undefined} />
            : <AxisLeft scale={y} x={0} grid={0} label={`${yCol} (기준선 이동)`} compact={compact} format={() => ''} />}
          {order.map((key, li) => {
            const tweened = shown[li]
            const geo = tweened && tweened.length === xs.length ? tweened : target[li]
            if (!geo) return null
            const area = d3.area<number[]>().curve(curves[params.curve]).x((_, i) => x(xs[i])).y0((d) => d[0]).y1((d) => d[1])
            const top = d3.line<number[]>().curve(curves[params.curve]).x((_, i) => x(xs[i])).y((d) => d[1])
            return (
              <g key={key} className="marks">
                <path d={area(geo) ?? ''} fill={color(key)} fillOpacity={overlap ? params.opacity * 0.6 : params.opacity} data-testid="area-layer" />
                <path d={top(geo) ?? ''} className="area-top" stroke={color(key)} />
              </g>
            )
          })}
          {hoverX != null && <line className="crosshair" x1={x(hoverX)} x2={x(hoverX)} y1={0} y2={ih} />}
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

function AreaControls({ params, setParams }: ControlsProps<LineParams>) {
  return (
    <>
      <ControlGroup title="쌓기 방식">
        <Segmented label="배치" value={params.mode} onChange={(mode) => setParams({ mode })} testId="ctl-mode"
          options={[{ value: 'stack', label: '누적' }, { value: 'normalize', label: '100%' }, { value: 'overlap', label: '겹치기' }, { value: 'stream', label: '스트림' }]} />
        <Hint>
          {params.mode === 'stack' && '각 계열을 아래 계열 위에 쌓습니다. 맨 위 경계는 전체 합계입니다.'}
          {params.mode === 'normalize' && '시점마다 합계를 100%로 맞춰 구성 비율의 변화를 봅니다. 전체 크기 정보는 사라집니다.'}
          {params.mode === 'overlap' && '모든 계열이 0에서 시작합니다. 겹친 부분이 가려지므로 계열이 적을 때만 적합합니다.'}
          {params.mode === 'stream' && '기준선을 위아래로 움직여(wiggle) 층의 기울기 변화를 최소화합니다. 절대값보다 흐름을 보여줍니다.'}
        </Hint>
      </ControlGroup>
      <ControlGroup title="모양">
        <Select label="보간 방식" value={params.curve} onChange={(curve) => setParams({ curve })} options={curveOptions.filter((c) => c.value !== 'natural')} testId="ctl-curve" />
        <Slider label="채움 불투명도" value={params.opacity} min={0.2} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} />
      </ControlGroup>
    </>
  )
}

export const areaModule: VizModule<LineParams> = {
  roles: lineRoles,
  datasets: ['timeseries', 'visits-dated'],
  defaultParams: { ...lineDefaults, curve: 'monotone' },
  Chart: AreaChart,
  Controls: AreaControls,
  hint: '마우스를 올려 시점별 값과 비율 확인 · 범례를 클릭해 계열을 빼면 나머지가 다시 쌓입니다',
}
