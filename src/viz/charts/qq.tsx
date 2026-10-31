import * as d3 from 'd3'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Legend, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, StatTable, Toggle } from '../../components/controls'
import { appendRow, removeRows, templateRow, updateRow } from '../../data/table'
import { categoryColor } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { mean, pearson, quantileSorted, sortNumbers, standardDeviation } from '../../stats/descriptive'
import { plottingPositions, standardQuantile, type ReferenceDist } from '../../stats/distributions'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { dragDigits, groupedValues, paddedDomain, roundTo } from './shared'

export interface QqParams {
  dist: ReferenceDist
  /** Plotting-position constant a in (i − a)/(n + 1 − 2a). */
  position: 'blom' | 'hazen' | 'weibull'
  line: 'robust' | 'fit' | 'none'
  standardize: boolean
  size: number
}

const A = { blom: 3 / 8, hazen: 1 / 2, weibull: 0 }

export interface QqPoint { row: number; sample: number; theory: number; p: number }

/** Sorted sample paired with the theoretical quantile F⁻¹(pᵢ) of the standard reference distribution. */
export function qqPoints(values: readonly number[], rows: readonly number[], dist: ReferenceDist, a: number): QqPoint[] {
  const order = values.map((v, i) => [v, rows[i]] as const).sort((p, q) => p[0] - q[0] || p[1] - q[1])
  const ps = plottingPositions(order.length, a)
  return order.map(([v, row], i) => ({ row, sample: v, theory: standardQuantile(dist, ps[i]), p: ps[i] }))
}

/**
 * Reference line through the quartile pairs (like R's qqline) or the least-squares line of sample on theory.
 * Returns y = intercept + slope·x in the plot's (theory, sample) coordinates.
 */
export function qqLine(pts: readonly QqPoint[], dist: ReferenceDist, kind: 'robust' | 'fit') {
  if (pts.length < 2) return null
  if (kind === 'robust') {
    const ys = pts.map((p) => p.sample)
    const y1 = quantileSorted(ys, 0.25)
    const y3 = quantileSorted(ys, 0.75)
    const x1 = standardQuantile(dist, 0.25)
    const x3 = standardQuantile(dist, 0.75)
    const slope = (y3 - y1) / (x3 - x1)
    return { slope, intercept: y1 - slope * x1 }
  }
  const xs = pts.map((p) => p.theory)
  const ys = pts.map((p) => p.sample)
  const mx = mean(xs)
  const my = mean(ys)
  const sxx = d3.sum(xs, (x) => (x - mx) ** 2)
  const slope = sxx > 0 ? d3.sum(xs, (x, i) => (x - mx) * (ys[i] - my)) / sxx : NaN
  return { slope, intercept: my - slope * mx }
}

const distLabel: Record<ReferenceDist, string> = { normal: '정규분포', uniform: '균등분포', exponential: '지수분포' }

function QqChart({ table, mapping, params, width, height, compact, onTableChange }: ChartProps<QqParams>) {
  const valueCol = roleColumn(mapping, 'value')
  const groupCol = roleColumn(mapping, 'group')
  const groups = useMemo(() => groupedValues(table, valueCol, groupCol), [table, valueCol, groupCol])
  const color = useMemo(() => categoryColor(groups.map((g) => g.key)), [groups])
  const m = margins(compact)
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ row: number; moved: boolean; domain: [number, number] } | null>(null)
  const [dragging, setDragging] = useState(false)
  const { tip, show, hide } = useTooltip()

  const series = useMemo(() => groups.map((g) => {
    // Standardizing puts every group on the (value − mean)/sd scale so shape differences stand out.
    const mu = mean(g.values)
    const sd = standardDeviation(g.values)
    const vals = params.standardize ? g.values.map((v) => (sd > 0 ? (v - mu) / sd : 0)) : g.values
    const pts = qqPoints(vals, g.rows, params.dist, A[params.position])
    return { key: g.key, pts, line: params.line === 'none' ? null : qqLine(pts, params.dist, params.line), ppcc: pearson(pts.map((p) => p.theory), pts.map((p) => p.sample)), mu, sd, raw: g.values }
  }), [groups, params])

  const allPts = series.flatMap((s) => s.pts)
  const xDomain = paddedDomain(allPts.map((p) => p.theory), 0.06)
  const yDomain = drag.current?.domain ?? paddedDomain([...allPts.map((p) => p.sample), ...series.flatMap((s) => (s.line ? xDomain.map((x) => s.line!.intercept + s.line!.slope * x) : []))].filter(Number.isFinite), 0.04)
  const x = d3.scaleLinear().domain(xDomain).range([0, iw])
  const y = d3.scaleLinear().domain(yDomain).range([ih, 0])

  if (!valueCol) return <ChartMessage>값으로 사용할 숫자형 열을 선택하세요.</ChartMessage>
  if (!allPts.length) return <ChartMessage>숫자 값이 없습니다.</ChartMessage>
  if (series.every((s) => s.pts.length < 3)) return <ChartMessage>Q-Q 플롯은 그룹마다 값이 3개 이상 필요합니다.</ChartMessage>
  const editable = !!onTableChange && !compact && !params.standardize
  const digits = dragDigits(y.domain()[1] - y.domain()[0])
  const r = compact ? 1.6 : params.size

  const valueAt = (e: PointerEvent) => roundTo(y.invert(localPoint(svgRef.current!, e).y - m.top), digits)
  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!editable) return
    const t = (e.target as Element).closest('[data-row]')
    if (!t) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { row: Number(t.getAttribute('data-row')), moved: false, domain: y.domain() as [number, number] }
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
    if (p.x < m.left || p.x > m.left + iw || p.y < m.top || p.y > m.top + ih) return
    const base = templateRow(table)
    if (groupCol && groups[0]) base[groupCol] = groups[0].key
    onTableChange!(appendRow(table, { ...base, [valueCol]: valueAt(e) }))
  }
  const first = series[0]

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} role="img" data-testid="chart-svg"
        aria-label={`Q-Q 플롯: ${valueCol}의 표본 분위수와 ${distLabel[params.dist]} 이론 분위수`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <rect width={iw} height={ih} className="plot-bg" fill="transparent" />
          <AxisBottom scale={x} y={ih} grid={ih} label={`${distLabel[params.dist]} 이론 분위수`} compact={compact} />
          <AxisLeft scale={y} x={0} grid={iw} label={params.standardize ? `${valueCol} (표준화)` : `${valueCol} 표본 분위수`} compact={compact} />
          {series.map((s) => {
            const c = color(s.key)
            return (
              <g key={s.key} className="marks">
                {s.line && Number.isFinite(s.line.slope) && (
                  <line className="qq-line" data-testid="qq-line" x1={x(xDomain[0])} x2={x(xDomain[1])} y1={y(s.line.intercept + s.line.slope * xDomain[0])} y2={y(s.line.intercept + s.line.slope * xDomain[1])} stroke={groups.length > 1 ? c : '#c4602a'} />
                )}
                {s.pts.map((p) => (
                  <circle key={p.row} data-row={p.row} className="mark-point qq-point" cx={x(p.theory)} cy={y(p.sample)} r={r} fill={c} fillOpacity={0.7}
                    onPointerEnter={compact ? undefined : (e) => {
                      if (drag.current) return
                      const lp = localPoint(svgRef.current!, e)
                      show(lp.x, lp.y, <><b>{s.key || valueCol}</b><br />누적확률 p = {fmt(p.p, 3)}<br />이론 분위수 {fmt(p.theory, 3)}<br />표본 분위수 {fmt(p.sample, 3)}{editable && <><br />드래그: 값 변경 · 클릭: 삭제</>}</>)
                    }} onPointerLeave={hide} />
                ))}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          {groupCol && <Legend items={series.map((s) => ({ key: s.key, color: color(s.key) }))} title={groupCol} />}
          <Readout items={[{ label: 'n', value: allPts.length.toLocaleString() }, ...(series.length === 1 ? [{ label: '상관 r', value: fmt(first.ppcc, 4) }] : [])]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
      {!compact && params.line !== 'none' && first?.line && series.length === 1 && Number.isFinite(first.line.slope) && (
        <p className="chart-footnote">기준선: 표본 = {fmt(first.line.intercept, 3)} + {fmt(first.line.slope, 3)} × 이론 분위수
          {params.dist === 'normal' && <> (절편 ≈ 위치 μ, 기울기 ≈ 척도 σ)</>}
        </p>
      )}
    </div>
  )
}

function QqControls({ params, setParams, table, mapping }: ControlsProps<QqParams>) {
  const valueCol = roleColumn(mapping, 'value')
  const groups = groupedValues(table, valueCol, roleColumn(mapping, 'group'))
  const g = groups[0]
  // Show how the first few quantile pairs are computed so the construction can be checked by hand.
  const pts = g ? qqPoints(params.standardize ? g.values.map((v) => (v - mean(g.values)) / (standardDeviation(g.values) || 1)) : g.values, g.rows, params.dist, A[params.position]) : []
  const picks = pts.length > 5 ? [0, 1, Math.floor(pts.length / 2), pts.length - 2, pts.length - 1] : pts.map((_, i) => i)
  return (
    <>
      <ControlGroup title="기준 분포">
        <Select label="이론 분포" value={params.dist} onChange={(dist) => setParams({ dist })} testId="ctl-dist"
          options={[{ value: 'normal', label: '정규분포 N(0, 1)' }, { value: 'uniform', label: '균등분포 U(0, 1)' }, { value: 'exponential', label: '지수분포 Exp(1)' }]} />
        <Select label="플로팅 위치" value={params.position} onChange={(position) => setParams({ position })} testId="ctl-position"
          options={[{ value: 'blom', label: 'Blom (i − 3/8)/(n + 1/4)' }, { value: 'hazen', label: 'Hazen (i − 1/2)/n' }, { value: 'weibull', label: 'Weibull i/(n + 1)' }]} />
        <Hint>i번째로 작은 값을 누적확률 pᵢ에 놓고 기준 분포의 분위수 F⁻¹(pᵢ)와 짝지읍니다. 점이 직선 위에 놓이면 표본이 (위치·척도가 달라도) 그 분포의 모양을 따릅니다.</Hint>
        <Toggle label="표본 표준화" description="(값 − 평균)/표준편차로 바꿔 모양만 비교" checked={params.standardize} onChange={(standardize) => setParams({ standardize })} testId="ctl-standardize" />
      </ControlGroup>
      <ControlGroup title="기준선">
        <Segmented label="선 종류" value={params.line} onChange={(line) => setParams({ line })} testId="ctl-line"
          options={[{ value: 'robust', label: '사분위수 선' }, { value: 'fit', label: '최소제곱 선' }, { value: 'none', label: '없음' }]} />
        <Slider label="점 크기" value={params.size} min={1.5} max={7} step={0.5} onChange={(size) => setParams({ size })} />
      </ControlGroup>
      {pts.length > 0 && (
        <ControlGroup title="분위수 계산 확인">
          <StatTable rows={[['순위 i', 'pᵢ', '이론', '표본'], ...picks.map((k) => [`${k + 1}/${pts.length}`, fmt(pts[k].p, 3), fmt(pts[k].theory, 3), fmt(pts[k].sample, 3)])]} />
          <Hint>{g.key !== '전체' ? `‘${g.key}’ 그룹의 ` : ''}정렬한 표본 중 일부입니다. 표본 수는 데이터 탭의 크기 슬라이더로 바꿀 수 있고, 정렬 후 값은 {fmt(sortNumbers(g.values)[0])}부터 {fmt(sortNumbers(g.values)[g.values.length - 1])}까지입니다.</Hint>
        </ControlGroup>
      )}
    </>
  )
}

export const qqModule: VizModule<QqParams> = {
  roles: [
    { key: 'value', label: '값', type: 'number', required: true },
    { key: 'group', label: '그룹 (선택)', type: 'category' },
  ],
  datasets: ['normal', 'skewed', 'bimodal', 'uniform', 'groups'],
  defaultParams: { dist: 'normal', position: 'blom', line: 'robust', standardize: false, size: 3.5 },
  Chart: QqChart,
  Controls: QqControls,
  hint: '점이 직선에서 벗어나는 방향으로 분포의 꼬리·치우침을 읽습니다 · 빈 곳 클릭: 값 추가 · 점 드래그: 값 변경',
}
