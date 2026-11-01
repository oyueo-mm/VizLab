import * as d3 from 'd3'
import { useMemo, useRef, useState } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, localPoint } from '../../components/chart/primitives'
import { ControlGroup, Hint, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber } from '../../data/table'
import { categoryColor } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { kde, silvermanBandwidth } from '../../stats/kde'
import { gevLMoments, gevQuantile, gringorten, mutualInformation, pearsonR, returnLevel, returnLevelBand, spearmanR } from '../../stats/tsa'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, RoleSpec, VizModule } from '../types'
import { Stage, XYPlot, useStage, type Layer } from './kit'

/** Joint-distribution plot with linked marginals and an extreme-value return-level plot. */

// ─── joint distribution ─────────────────────────────────────────────────────────────

export interface JointParams { bins: number; density: boolean; groups: boolean }
const jointRoles: RoleSpec[] = [
  { key: 'x', label: 'X 변수', type: 'number', required: true },
  { key: 'y', label: 'Y 변수', type: 'number', required: true },
  { key: 'group', label: '군집 (색, 선택)', type: 'category', auto: true },
]

type Box = [number, number, number, number]

function JointChart({ table, mapping, params, width, height, compact, linked }: ChartProps<JointParams>) {
  const stage = useStage()
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const data = useMemo(() => {
    const xi = columnIndex(table, roleColumn(mapping, 'x')), yi = columnIndex(table, roleColumn(mapping, 'y')), gi = columnIndex(table, roleColumn(mapping, 'group'))
    const pts: { x: number; y: number; g: string; row: number }[] = []
    if (xi >= 0 && yi >= 0) table.rows.forEach((r, row) => { const x = toNumber(r[xi]), y = toNumber(r[yi]); if (x != null && y != null) pts.push({ x, y, g: gi >= 0 ? toLabel(r[gi]) : '', row }) })
    return pts
  }, [table, mapping])
  const groups = useMemo(() => [...new Set(data.map((p) => p.g))].filter(Boolean), [data])
  const color = categoryColor(groups)
  if (data.length < 8) return <ChartMessage>X, Y 숫자 열을 고르세요. 관측이 8개 이상 필요합니다.</ChartMessage>
  const mTop = compact ? 6 : 44, mLeft = compact ? 6 : 58, mBottom = compact ? 6 : 46, mRight = compact ? 6 : 16
  const gap = compact ? 0 : 74
  const iw = Math.max(40, width - mLeft - mRight - gap), ih = Math.max(40, height - mTop - mBottom - gap)
  const xe = d3.extent(data, (p) => p.x) as [number, number], ye = d3.extent(data, (p) => p.y) as [number, number]
  const px = (xe[1] - xe[0]) * 0.05 || 1, py = (ye[1] - ye[0]) * 0.05 || 1
  const sx = d3.scaleLinear().domain([xe[0] - px, xe[1] + px]).range([0, iw]), sy = d3.scaleLinear().domain([ye[0] - py, ye[1] + py]).range([ih, 0])
  const marked = new Set(linked?.rows ?? [])
  const inBox = (p: { x: number; y: number }, b: Box) => p.x >= Math.min(b[0], b[2]) && p.x <= Math.max(b[0], b[2]) && p.y >= Math.min(b[1], b[3]) && p.y <= Math.max(b[1], b[3])
  const sel = box ? data.filter((p) => inBox(p, box)) : marked.size ? data.filter((p) => marked.has(p.row)) : []
  const hasSel = sel.length > 0
  const hist = (v: number[], dom: [number, number]) => d3.bin().domain(dom).thresholds(params.bins)(v)
  const hx = hist(data.map((p) => p.x), sx.domain() as [number, number]), hy = hist(data.map((p) => p.y), sy.domain() as [number, number])
  const hxs = hist(sel.map((p) => p.x), sx.domain() as [number, number]), hys = hist(sel.map((p) => p.y), sy.domain() as [number, number])
  const topMax = Math.max(1, ...hx.map((b) => b.length)), rightMax = Math.max(1, ...hy.map((b) => b.length))
  const gridX = d3.range(0, 100).map((i) => sx.domain()[0] + ((sx.domain()[1] - sx.domain()[0]) * i) / 99), gridY = d3.range(0, 100).map((i) => sy.domain()[0] + ((sy.domain()[1] - sy.domain()[0]) * i) / 99)
  const kx = params.density ? kde(data.map((p) => p.x), silvermanBandwidth(data.map((p) => p.x)), 'gaussian', gridX) : [], ky = params.density ? kde(data.map((p) => p.y), silvermanBandwidth(data.map((p) => p.y)), 'gaussian', gridY) : []
  const kxMax = Math.max(1e-12, ...kx), kyMax = Math.max(1e-12, ...ky)
  const xs = data.map((p) => p.x), ys = data.map((p) => p.y)
  const r = pearsonR(xs, ys), rho = spearmanR(xs, ys), mi = mutualInformation(xs, ys, 8)
  const rSel = sel.length >= 5 ? pearsonR(sel.map((p) => p.x), sel.map((p) => p.y)) : null
  const toData = (e: React.PointerEvent) => { const l = localPoint(stage.svgRef.current!, e); return { x: sx.invert(l.x - mLeft), y: sy.invert(l.y - mTop - gap) } }
  const commit = (b: Box | null) => { setBox(b); linked?.set(b ? data.filter((p) => inBox(p, b)).map((p) => p.row) : null) }
  const topH = gap - 6
  const barW = (b: d3.Bin<number, number>) => Math.max(1, sx(b.x1 ?? 0) - sx(b.x0 ?? 0) - 1)
  return (
    <Stage stage={stage} width={width} height={height} compact={compact} label={`결합분포: 점 ${data.length}개`}
      readout={[{ label: 'Pearson r', value: fmt(r, 2) }, { label: 'Spearman ρ', value: fmt(rho, 2) }, { label: '상호정보(nats)', value: fmt(mi, 2) }, ...(hasSel ? [{ label: '선택', value: `${sel.length}점${rSel != null ? ` · r ${fmt(rSel, 2)}` : ''}` }] : [])]}
      note="산점도를 끌어 영역을 고르면 주변분포에 그 영역의 분포(진한 막대)가 겹칩니다 · 빈 곳을 누르면 해제">
      {!compact && (
        <>
          <g transform={`translate(${mLeft},${mTop})`} data-testid="joint-top">
            {hx.map((b, i) => <rect key={i} x={sx(b.x0 ?? 0)} width={barW(b)} y={topH - (b.length / topMax) * topH} height={(b.length / topMax) * topH} fill="#cfd8d6" />)}
            {hasSel && hxs.map((b, i) => <rect key={`s${i}`} x={sx(b.x0 ?? 0)} width={barW(b)} y={topH - (b.length / topMax) * topH} height={(b.length / topMax) * topH} fill="#2a8c82" />)}
            {params.density && <path d={d3.line<number>().x((_, i) => sx(gridX[i])).y((v) => topH - (v / kxMax) * topH * 0.92)(kx) ?? ''} fill="none" stroke="#111827" strokeWidth={1.4} />}
          </g>
          <g transform={`translate(${mLeft + iw + 6},${mTop + gap})`} data-testid="joint-right">
            {hy.map((b, i) => <rect key={i} y={sy(b.x1 ?? 0)} height={Math.max(1, sy(b.x0 ?? 0) - sy(b.x1 ?? 0) - 1)} x={0} width={(b.length / rightMax) * (gap - 8)} fill="#cfd8d6" />)}
            {hasSel && hys.map((b, i) => <rect key={`s${i}`} y={sy(b.x1 ?? 0)} height={Math.max(1, sy(b.x0 ?? 0) - sy(b.x1 ?? 0) - 1)} x={0} width={(b.length / rightMax) * (gap - 8)} fill="#2a8c82" />)}
            {params.density && <path d={d3.line<number>().y((_, i) => sy(gridY[i])).x((v) => (v / kyMax) * (gap - 8) * 0.92)(ky) ?? ''} fill="none" stroke="#111827" strokeWidth={1.4} />}
          </g>
        </>
      )}
      <g transform={`translate(${mLeft},${mTop + gap})`}>
        <AxisBottom scale={sx} y={ih} grid={compact ? 0 : ih} label={roleColumn(mapping, 'x') ?? ''} compact={compact} />
        <AxisLeft scale={sy} x={0} grid={compact ? 0 : iw} label={roleColumn(mapping, 'y') ?? ''} compact={compact} />
        <rect data-testid="joint-area" x={0} y={0} width={iw} height={ih} fill="transparent" stroke="#e5e7eb" style={{ cursor: compact ? undefined : 'crosshair', touchAction: 'none' }}
          onPointerDown={compact ? undefined : (e) => { (e.target as Element).setPointerCapture(e.pointerId); const d = toData(e); drag.current = { x: d.x, y: d.y, moved: false } }}
          onPointerMove={compact ? undefined : (e) => { if (!drag.current) return; const d = toData(e); drag.current.moved = true; setBox([drag.current.x, drag.current.y, d.x, d.y]) }}
          onPointerUp={compact ? undefined : (e) => { if (!drag.current) return; const d = toData(e); const moved = drag.current.moved && (Math.abs(sx(d.x) - sx(drag.current.x)) > 4 || Math.abs(sy(d.y) - sy(drag.current.y)) > 4); commit(moved ? [drag.current.x, drag.current.y, d.x, d.y] : null); drag.current = null }} />
        {data.map((p) => {
          const on = hasSel && (box ? inBox(p, box) : marked.has(p.row))
          return <circle key={p.row} data-testid="joint-point" data-selected={on ? 1 : 0} cx={sx(p.x)} cy={sy(p.y)} r={compact ? 2 : on ? 4.2 : 3.4} fill={params.groups && groups.length ? color(p.g) : '#4c6fb5'} fillOpacity={hasSel ? (on ? 0.95 : 0.18) : 0.7} stroke={on ? '#111827' : 'none'} strokeWidth={0.8} pointerEvents="none" />
        })}
        {box && <rect data-testid="joint-brush" x={sx(Math.min(box[0], box[2]))} y={sy(Math.max(box[1], box[3]))} width={Math.abs(sx(box[2]) - sx(box[0]))} height={Math.abs(sy(box[3]) - sy(box[1]))} fill="#2a8c82" fillOpacity={0.1} stroke="#2a8c82" strokeDasharray="4 3" pointerEvents="none" />}
      </g>
    </Stage>
  )
}

function JointControls({ params, setParams }: ControlsProps<JointParams>) {
  return (
    <ControlGroup title="결합·주변분포">
      <Slider label="히스토그램 구간 수" value={params.bins} min={6} max={40} onChange={(bins) => setParams({ bins })} testId="ctl-bins" />
      <Toggle label="주변 밀도 곡선 (KDE)" checked={params.density} onChange={(density) => setParams({ density })} />
      <Toggle label="군집 색" checked={params.groups} onChange={(groups) => setParams({ groups })} />
      <Hint>가운데는 두 변수의 결합분포(산점도), 위와 오른쪽은 각 변수의 주변분포입니다. 산점도에서 영역을 끌어 고르면 그 영역에 속한 점만의 주변분포가 진한 막대로 겹쳐, 한 변수의 값에 조건을 걸었을 때 다른 변수의 분포가 어떻게 바뀌는지(조건부분포) 볼 수 있습니다. Pearson r은 선형 관계, Spearman ρ는 단조 관계만 재고, 상호정보량은 모양과 상관없는 모든 의존성을 잽니다. 군집마다 다른 관계가 섞이면 r이 낮아도 상호정보량은 큽니다.</Hint>
    </ControlGroup>
  )
}

export const jointModule: VizModule<JointParams> = {
  roles: jointRoles, datasets: ['joint-demo', 'pos-corr'], defaultParams: { bins: 18, density: true, groups: true },
  Chart: JointChart, Controls: JointControls, hint: '산점도를 끌어 영역을 선택하면 주변분포에 그 영역의 분포가 겹칩니다 · 비교 실험실에서는 다른 차트와 연동',
}

// ─── extreme-value return levels ────────────────────────────────────────────────────

export interface ReturnParams { level: number; reps: number; maxPeriod: number; gumbel: boolean }
const returnRoles: RoleSpec[] = [{ key: 'value', label: '연(블록) 최댓값', type: 'number', required: true, prefer: '최대|max|값' }]

function ReturnChart({ table, mapping, params, width, height, compact }: ChartProps<ReturnParams>) {
  const x = useMemo(() => {
    const vi = columnIndex(table, roleColumn(mapping, 'value'))
    return vi < 0 ? [] : table.rows.map((r) => toNumber(r[vi])).filter((v): v is number => v != null)
  }, [table, mapping])
  const res = useMemo(() => {
    const g = gevLMoments(x)
    if (!g) return null
    const T = d3.range(0, 70).map((i) => 1.1 * (params.maxPeriod / 1.1) ** (i / 69))
    const band = returnLevelBand(x, T, compact ? 40 : params.reps, params.level, 5)
    const s = [...x].sort((a, b) => a - b), n = s.length
    const l2 = (2 * s.reduce((a, v, i) => a + (i / (n - 1)) * v, 0)) / n - s.reduce((a, v) => a + v, 0) / n
    const gum = { scale: l2 / Math.LN2, loc: s.reduce((a, v) => a + v, 0) / n - 0.5772156649 * (l2 / Math.LN2), k: 0 }
    return { g, T, fit: T.map((t) => returnLevel(g, t)), band, gum, emp: gringorten(n).map((F, i) => ({ T: 1 / (1 - F), v: s[i] })) }
  }, [x, params.maxPeriod, params.reps, params.level, compact])
  if (!res) return <ChartMessage>연 최댓값 열을 선택하세요. 관측이 8개 이상 필요합니다.</ChartMessage>
  const xi = -res.g.k
  const r100 = returnLevel(res.g, 100)
  const i100 = res.T.findIndex((t) => t >= 100)
  const b100 = res.band[i100 >= 0 ? i100 : res.band.length - 1]
  const layers: Layer[] = [
    { kind: 'band', x: res.T, lo: res.band.map((b) => b.lo), hi: res.band.map((b) => b.hi), color: '#2a8c82', opacity: 0.16, label: `${Math.round(params.level * 100)}% 부트스트랩 구간` },
    ...(params.gumbel ? [{ kind: 'line', x: res.T, y: res.T.map((t) => gevQuantile(res.gum, 1 - 1 / t)), color: '#9aa1a9', dash: '6 4', width: 2, label: 'Gumbel(ξ = 0) 적합' } as Layer] : []),
    { kind: 'line', x: res.T, y: res.fit, color: '#2a8c82', width: 3, label: 'GEV 적합' },
    { kind: 'points', color: '#e07a3f', r: 4, label: '관측 연 최댓값', pts: res.emp.map((p, i) => ({ x: p.T, y: p.v, key: String(i), tip: <><b>재현기간 {fmt(p.T, 1)}년</b><br />관측 최댓값 {fmt(p.v)}<br />GEV 적합 {fmt(returnLevel(res.g, p.T))}</> })) },
  ]
  return (
    <XYPlot hover={false} layers={layers} width={width} height={height} compact={compact} xScale="log" xTicks={5} xDomain={[1.1, params.maxPeriod]} xLabel="재현기간 T (년, 로그 눈금)" yLabel="재현수준" title={`극단값 재현수준 도표: ξ = ${fmt(xi, 2)}`}
      xFormat={(v) => String(Math.round(v))}
      readout={[{ label: '꼬리 ξ', value: fmt(xi, 2) }, { label: '100년 재현수준', value: `${fmt(r100, 0)} (${fmt(b100.lo, 0)}~${fmt(b100.hi, 0)})` }]} note="ξ > 0 두꺼운 꼬리 · ξ = 0 Gumbel · ξ < 0 상한 있음" />
  )
}

function ReturnControls({ params, setParams }: ControlsProps<ReturnParams>) {
  return (
    <ControlGroup title="재현수준">
      <Slider label="최대 재현기간 (년)" value={params.maxPeriod} min={20} max={1000} step={10} onChange={(maxPeriod) => setParams({ maxPeriod })} testId="ctl-maxperiod" />
      <Slider label="부트스트랩 반복" value={params.reps} min={50} max={500} step={50} onChange={(reps) => setParams({ reps })} testId="ctl-reps" />
      <Slider label="구간 신뢰수준" value={params.level} min={0.8} max={0.99} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(level) => setParams({ level })} testId="ctl-level" />
      <Toggle label="Gumbel(ξ = 0) 적합과 비교" checked={params.gumbel} onChange={(gumbel) => setParams({ gumbel })} />
      <Hint>해마다의 최댓값(블록 최대)이 일반화 극단값(GEV) 분포를 따른다는 가정(Fisher–Tippett–Gnedenko 정리)으로 위치·척도·꼬리 모양을 L-적률법(Hosking 등, 1985)으로 추정합니다. 재현수준 x_T는 T년에 한 번 넘을 것으로 기대되는 값, 즉 연 최댓값 분포의 1 − 1/T 분위수입니다. 점은 Gringorten 도시 위치로 계산한 경험적 재현기간이고, 띠는 자료를 복원추출해 다시 적합한 부트스트랩 구간입니다. 자료 길이보다 훨씬 긴 재현기간(예: 60년 자료로 500년)은 외삽이며 불확실성이 매우 큽니다.</Hint>
    </ControlGroup>
  )
}

export const returnLevelModule: VizModule<ReturnParams> = {
  roles: returnRoles, datasets: ['extreme-annual'], defaultParams: { level: 0.9, reps: 200, maxPeriod: 500, gumbel: true },
  Chart: ReturnChart, Controls: ReturnControls, hint: '표본 길이를 늘리고 줄여 100년 재현수준 구간이 얼마나 달라지는지 보세요 · 데이터 점이 곡선에서 벗어나면 적합이 나쁩니다',
}
