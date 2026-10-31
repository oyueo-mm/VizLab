import * as d3 from 'd3'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { appendRow, removeRows, templateRow, updateRow } from '../../data/table'
import { useTween } from '../../hooks/motion'
import { categoryColor } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { boxStats } from '../../stats/boxplot'
import { extent } from '../../stats/descriptive'
import { kde, kdeGrid, silvermanBandwidth } from '../../stats/kde'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { jitter } from './groupShared'
import { dragDigits, groupedValues, paddedDomain, roundTo } from './shared'

export interface RaincloudParams {
  cloud: boolean
  box: boolean
  rain: boolean
  bwScale: number
  jitter: number
  size: number
  opacity: number
  orientation: 'horizontal' | 'vertical'
}

function RaincloudChart({ table, mapping, params, width, height, compact, onTableChange }: ChartProps<RaincloudParams>) {
  const valueCol = roleColumn(mapping, 'value')
  const groupCol = roleColumn(mapping, 'group')
  const groups = useMemo(() => groupedValues(table, valueCol, groupCol), [table, valueCol, groupCol])
  const color = useMemo(() => categoryColor(groups.map((g) => g.key)), [groups])
  const horizontal = params.orientation === 'horizontal'
  const m = margins(compact, !compact && horizontal ? { left: 78 } : {})
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ row: number; moved: boolean; domain: [number, number] } | null>(null)
  const [dragging, setDragging] = useState(false)
  const { tip, show, hide } = useTooltip()

  const model = useMemo(() => {
    const all = groups.flatMap((g) => g.values)
    if (!all.length) return null
    const shapes = groups.map((g) => {
      const h = silvermanBandwidth(g.values) * params.bwScale
      const [lo, hi] = extent(g.values)
      const grid = kdeGrid(lo, hi, 0, 80)
      return { h, grid, dens: kde(g.values, h, 'gaussian', grid), box: boxStats(g.values)! }
    })
    return { all, shapes, maxDens: d3.max(shapes, (s) => d3.max(s.dens)) || 1 }
  }, [groups, params.bwScale])

  // v: value scale along the value axis; band: group position across it.
  const valueLen = horizontal ? iw : ih
  const crossLen = horizontal ? ih : iw
  const v = d3.scaleLinear().domain(drag.current?.domain ?? paddedDomain(model?.all ?? [0, 1], 0.05)).range(horizontal ? [0, valueLen] : [valueLen, 0])
  if (!drag.current) v.nice()
  const band = d3.scaleBand().domain(groups.map((g) => g.key)).range([0, crossLen]).paddingInner(0.12).paddingOuter(0.06)
  const B = band.bandwidth()
  // Within a band (measured from its start): cloud above the baseline, box on it, rain below.
  const cloudBase = B * 0.52
  const P = (val: number, cross: number) => (horizontal ? [v(val), cross] : [cross, v(val)]) as [number, number]
  const rainPos = useMemo(() => groups.map((g) => g.values.map((val, k) => {
    const start = band(g.key) ?? 0
    return P(val, start + cloudBase + B * 0.24 + jitter(g.rows[k]) * B * 0.36 * params.jitter)
  })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [groups, B, params.jitter, horizontal, iw, ih, v.domain()[0], v.domain()[1]])
  const shown = useTween(rainPos, { snapKey: `${iw}x${ih}${horizontal}`, enabled: !compact && !dragging && (model?.all.length ?? 0) <= 800 })

  if (!valueCol) return <ChartMessage>값으로 사용할 숫자형 열을 선택하세요.</ChartMessage>
  if (!model) return <ChartMessage>숫자 값이 없습니다.</ChartMessage>
  const editable = !!onTableChange && !compact
  const digits = dragDigits(v.domain()[1] - v.domain()[0])
  const valueAt = (e: PointerEvent) => {
    const p = localPoint(svgRef.current!, e)
    return roundTo(v.invert(horizontal ? p.x - m.left : p.y - m.top), digits)
  }

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!editable) return
    const t = (e.target as Element).closest('[data-row]')
    if (!t) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { row: Number(t.getAttribute('data-row')), moved: false, domain: v.domain() as [number, number] }
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    if (!d.moved) { d.moved = true; setDragging(true); hide() }
    onTableChange!(updateRow(table, d.row, { [valueCol]: valueAt(e) }), true)
  }
  const onUp = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    drag.current = null
    if (dragging) { setDragging(false); onTableChange!(table, false) }
    if (!editable) return
    if (d && !d.moved) { onTableChange!(removeRows(table, [d.row])); return }
    if (d) return
    const p = localPoint(svgRef.current!, e)
    const cross = horizontal ? p.y - m.top : p.x - m.left
    const g = groups.find((gr) => cross >= (band(gr.key) ?? 0) && cross <= (band(gr.key) ?? 0) + B)
    if (!g || (horizontal ? p.x - m.left : p.y - m.top) < 0) return
    const base = templateRow(table)
    if (groupCol) base[groupCol] = g.key
    onTableChange!(appendRow(table, { ...base, [valueCol]: valueAt(e) }))
  }

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} role="img" data-testid="chart-svg"
        aria-label={`레인클라우드 플롯: ${valueCol}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <rect width={iw} height={ih} className="plot-bg" fill="transparent" />
          {horizontal ? <AxisBottom scale={v} y={ih} grid={ih} label={valueCol} compact={compact} /> : <AxisLeft scale={v} x={0} grid={iw} label={valueCol} compact={compact} />}
          {groups.map((g, gi) => {
            const s = model.shapes[gi]
            const c = color(g.key)
            const start = band(g.key) ?? 0
            const base = start + cloudBase
            const scale = (B * 0.48) / model.maxDens
            const cloudPts = s.grid.map((gv, k) => [v(gv), base - s.dens[k] * scale] as [number, number])
            const cloud = horizontal
              ? d3.area<[number, number]>().curve(d3.curveBasis).x((p) => p[0]).y0(base).y1((p) => p[1])(cloudPts)
              : d3.area<[number, number]>().curve(d3.curveBasis).y((p) => p[0]).x0(base).x1((p) => p[1])(cloudPts)
            const b = s.box
            const bh = Math.max(4, B * 0.1)
            const boxC = base + bh * 0.9
            const rect = horizontal
              ? { x: v(b.q1), y: boxC - bh / 2, width: Math.max(1, v(b.q3) - v(b.q1)), height: bh }
              : { x: boxC - bh / 2, y: v(b.q3), width: bh, height: Math.max(1, v(b.q1) - v(b.q3)) }
            const seg = (a: number, z: number) => { const [x1, y1] = P(a, boxC); const [x2, y2] = P(z, boxC); return { x1, y1, x2, y2 } }
            const med = horizontal ? { x1: v(b.median), x2: v(b.median), y1: boxC - bh / 2, y2: boxC + bh / 2 } : { y1: v(b.median), y2: v(b.median), x1: boxC - bh / 2, x2: boxC + bh / 2 }
            return (
              <g key={g.key} className="marks" data-group={g.key}>
                {params.cloud && (
                  <path className="rc-cloud" d={cloud ?? ''} fill={c} fillOpacity={0.35} stroke={c} data-testid="rc-cloud"
                    onPointerEnter={compact ? undefined : (e) => {
                      const lp = localPoint(svgRef.current!, e)
                      show(lp.x, lp.y, <><b>{g.key}</b> (n = {g.values.length})<br />대역폭 h = {fmt(s.h, 3)}<br />중앙값 {fmt(b.median)} · IQR {fmt(b.iqr)}</>)
                    }} onPointerLeave={hide} />
                )}
                {params.box && (
                  <g className="rc-box" data-testid="rc-box">
                    <line {...seg(b.whiskerLow, b.q1)} stroke="#374151" />
                    <line {...seg(b.q3, b.whiskerHigh)} stroke="#374151" />
                    <rect {...rect} fill="#fff" stroke="#374151" strokeWidth={1.3} rx={1.5} />
                    <line {...med} stroke="#111827" strokeWidth={2.2} />
                  </g>
                )}
                {params.rain && g.values.map((val, k) => {
                  const p = shown[gi]?.[k] ?? rainPos[gi][k]
                  return (
                    <circle key={g.rows[k]} data-row={g.rows[k]} className="mark-point rc-drop" cx={p[0]} cy={p[1]} r={compact ? Math.max(1, params.size * 0.5) : params.size} fill={c} fillOpacity={params.opacity}
                      onPointerEnter={compact ? undefined : (e) => {
                        if (drag.current) return
                        const lp = localPoint(svgRef.current!, e)
                        show(lp.x, lp.y, <><b>{g.key}</b><br />{valueCol}: {fmt(val)}{editable && <><br />드래그: 값 변경 · 클릭: 삭제</>}</>)
                      }} onPointerLeave={hide} />
                  )
                })}
                {!compact && (horizontal
                  ? <text className="ridge-label" x={-8} y={base} dy="0.32em" textAnchor="end">{g.key}</text>
                  : <text className="ridge-label" x={start + B / 2} y={ih + 18} textAnchor="middle">{g.key}</text>)}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function RaincloudControls({ params, setParams }: ControlsProps<RaincloudParams>) {
  return (
    <>
      <ControlGroup title="구성 요소">
        <Toggle label="구름 (반쪽 바이올린)" description="커널 밀도 추정의 위쪽 절반" checked={params.cloud} onChange={(cloud) => setParams({ cloud })} testId="ctl-cloud" />
        <Toggle label="박스 플롯" description="사분위수와 1.5×IQR 수염" checked={params.box} onChange={(box) => setParams({ box })} testId="ctl-box" />
        <Toggle label="비 (개별 관측값)" checked={params.rain} onChange={(rain) => setParams({ rain })} testId="ctl-rain" />
        <Segmented label="방향" value={params.orientation} onChange={(orientation) => setParams({ orientation })} testId="ctl-orient"
          options={[{ value: 'horizontal', label: '가로' }, { value: 'vertical', label: '세로' }]} />
      </ControlGroup>
      <ControlGroup title="밀도">
        <Slider label="대역폭 배율" value={params.bwScale} min={0.2} max={3} step={0.05} onChange={(bwScale) => setParams({ bwScale })} format={(v) => `× ${v.toFixed(2)}`} testId="ctl-bw" />
        <Hint>구름은 각 그룹의 Silverman 대역폭에 이 배율을 곱한 가우스 커널 밀도입니다. 모든 그룹이 같은 밀도 축을 쓰므로 면적이 같습니다.</Hint>
      </ControlGroup>
      <ControlGroup title="관측점">
        <Slider label="지터 폭" value={params.jitter} min={0} max={1} step={0.05} onChange={(jitter) => setParams({ jitter })} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-jitter" />
        <Slider label="점 크기" value={params.size} min={1} max={6} step={0.5} onChange={(size) => setParams({ size })} />
        <Slider label="투명도" value={params.opacity} min={0.1} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} testId="ctl-opacity" />
        <Hint>지터는 값 축과 수직인 방향으로만 흩뜨리므로 값 자체는 바뀌지 않습니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const raincloudModule: VizModule<RaincloudParams> = {
  roles: [
    { key: 'value', label: '값', type: 'number', required: true },
    { key: 'group', label: '그룹', type: 'category', auto: true },
  ],
  datasets: ['groups', 'outliers', 'bimodal', 'skewed'],
  defaultParams: { cloud: true, box: true, rain: true, bwScale: 1, jitter: 0.7, size: 2.6, opacity: 0.6, orientation: 'horizontal' },
  Chart: RaincloudChart,
  Controls: RaincloudControls,
  hint: '빈 곳을 클릭해 값 추가 · 점을 값 축 방향으로 드래그 · 점을 클릭하면 삭제',
}
