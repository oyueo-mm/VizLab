import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Legend, Readout, Tooltip, localPoint, margins, useSvgId, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, NumberField, Segmented, Select, Slider, StatTable, Toggle } from '../../components/controls'
import { columnIndex, toNumber, updateRow, type DataTable } from '../../data/table'
import { colorAt } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { coefIntervals, diagnostics, fitForest, lowess, ols, partialDependence, polyRows, type Diagnostics, type OlsFit } from '../../stats/regression'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, RoleSpec, VizModule } from '../types'
import { paddedDomain } from './shared'

/** Regression diagnostics (residuals, scale–location, influence), coefficient comparison and partial dependence. */

const roles = (min: number, max = 6): RoleSpec[] => [
  { key: 'y', label: '응답 변수 y', type: 'number', required: true, prefer: '점수|매출|연비|가격|y' },
  { key: 'x', label: '설명 변수 x', type: 'number', required: true, multiple: { min, max } },
]

interface RegData { names: string[]; X: number[][]; y: number[]; rows: number[]; yName: string }

export function readRegression(table: DataTable, mapping: Mapping): RegData {
  const yCol = roleColumn(mapping, 'y'), xCols = roleColumns(mapping, 'x')
  const yi = columnIndex(table, yCol), xi = xCols.map((c) => columnIndex(table, c))
  const out: RegData = { names: xCols, X: [], y: [], rows: [], yName: yCol ?? 'y' }
  if (yi < 0 || xi.some((i) => i < 0) || !xi.length) return out
  table.rows.forEach((r, row) => {
    const y = toNumber(r[yi]), xs = xi.map((i) => toNumber(r[i]))
    if (y == null || xs.some((v) => v == null)) return
    out.y.push(y); out.X.push(xs as number[]); out.rows.push(row)
  })
  return out
}

export interface DiagParams { degree: number; mode: 'ols' | 'manual'; a: number; b: number; axis: number; smooth: boolean; band: boolean; selected: number }
const diagDefaults: DiagParams = { degree: 1, mode: 'ols', a: 0, b: 1, axis: -1, smooth: true, band: true, selected: -1 }

function designOf(data: RegData, params: DiagParams): number[][] {
  // one predictor: polynomial of the chosen degree; several: the predictors as they are
  return data.names.length === 1 ? polyRows(data.X.map((r) => r[0]), params.degree) : data.X
}

/** Fits (or uses the manual line) and returns the fit together with its diagnostics. */
function useDiag(data: RegData, params: DiagParams): { fit: OlsFit | null; diag: Diagnostics | null; fitted: number[]; resid: number[]; manual: boolean } {
  return useMemo(() => {
    const manual = params.mode === 'manual' && data.names.length === 1
    const fit = data.y.length > 2 ? ols(designOf(data, params), data.y) : null
    if (manual) {
      const fitted = data.X.map((r) => params.a + params.b * r[0])
      return { fit, diag: fit ? diagnostics(fit) : null, fitted, resid: data.y.map((v, i) => v - fitted[i]), manual }
    }
    return { fit, diag: fit ? diagnostics(fit) : null, fitted: fit?.fitted ?? [], resid: fit?.residuals ?? [], manual }
  }, [data, params])
}

function DiagControls({ params, setParams, table, mapping, children }: ControlsProps<DiagParams> & { children?: React.ReactNode }) {
  const data = useMemo(() => readRegression(table, mapping), [table, mapping])
  const fit = useMemo(() => (data.y.length > 2 ? ols(designOf(data, params), data.y) : null), [data, params])
  const single = data.names.length === 1
  return (
    <>
      <ControlGroup title="회귀 모델">
        {single ? (
          <>
            <Segmented label="적합 방식" value={params.mode} onChange={(mode) => setParams({ mode })} testId="ctl-reg-mode" options={[{ value: 'ols', label: '최소제곱 적합' }, { value: 'manual', label: '직선 직접 지정' }]} />
            {params.mode === 'ols'
              ? <Slider label="다항식 차수" value={params.degree} min={1} max={4} onChange={(degree) => setParams({ degree })} testId="ctl-reg-degree" />
              : (<>
                <Slider label="절편 a" value={params.a} min={-100} max={100} step={0.5} onChange={(a) => setParams({ a })} testId="ctl-reg-a" />
                <Slider label="기울기 b" value={params.b} min={-10} max={10} step={0.05} onChange={(b) => setParams({ b })} testId="ctl-reg-b" />
                {fit && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ a: +fit.beta[0].toFixed(2), b: +fit.beta[1].toFixed(3) })}>최소제곱 값으로 맞추기</button>}
              </>)}
          </>
        ) : <Hint>설명 변수가 {data.names.length}개라 다중 회귀(선형)로 적합합니다. 변수를 하나만 선택하면 다항식 차수와 직선 직접 지정을 쓸 수 있습니다.</Hint>}
        <Toggle label="LOWESS 평활선" checked={params.smooth} onChange={(smooth) => setParams({ smooth })} testId="ctl-reg-smooth" />
        {children}
      </ControlGroup>
      {fit && (
        <ControlGroup title="적합 결과">
          <StatTable rows={[['항목', '값'], ['R²', fmt(fit.r2, 3)], ['잔차 표준오차', fmt(fit.sigma, 3)], ['자유도', fit.df], ...fit.beta.map((b, i) => [i === 0 ? '절편' : single && params.degree > 1 ? `x^${i}` : data.names[i - 1] ?? `x${i}`, `${fmt(b, 3)} (SE ${fmt(fit.se[i], 3)})`])]} />
          <Hint>잔차 그래프는 모델이 설명하지 못한 부분을 보여 줍니다. 모델이 알맞다면 잔차는 0 주위에 무작위로 흩어지고 곡선·부채꼴·한쪽 쏠림 같은 패턴이 없어야 합니다.</Hint>
        </ControlGroup>
      )}
    </>
  )
}

interface DPoint { i: number; x: number; y: number; row: number; flag: boolean; r?: number }

function DiagFrame({ width, height, compact, pts, xLabel, yLabel, refs, smooth, bandY, aria, onPick, selected, tipOf, linked, extra, vRefs, vlabel }: {
  width: number
  height: number
  compact?: boolean
  pts: DPoint[]
  xLabel: string
  yLabel: string
  refs: { y: number; dash?: boolean; label?: string }[]
  smooth?: { x: number; y: number }[]
  bandY?: [number, number]
  aria: string
  onPick?: (i: number) => void
  selected: number
  tipOf: (p: DPoint) => React.ReactNode
  linked?: ChartProps<DiagParams>['linked']
  extra?: React.ReactNode
  vRefs?: { x: number }[]
  vlabel?: (p: DPoint) => string | null
}) {
  const m = margins(compact, { right: 24 })
  const iw = Math.max(40, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const dx = paddedDomain([...pts.map((p) => p.x), ...(vRefs?.map((v) => v.x) ?? [])]), dy = paddedDomain([...pts.map((p) => p.y), ...refs.map((r) => r.y), ...(bandY ?? [])])
  const x = d3.scaleLinear().domain(dx).range([0, iw]), y = d3.scaleLinear().domain(dy).range([ih, 0])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const clip = useSvgId('diag-clip')
  const marked = new Set(linked?.rows ?? [])
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={aria} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <defs><clipPath id={clip}><rect x={-4} y={-4} width={iw + 8} height={ih + 8} /></clipPath></defs>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisBottom scale={x} y={ih} grid={ih} label={xLabel} compact={compact} />
          <AxisLeft scale={y} x={0} grid={iw} label={yLabel} compact={compact} />
          <g clipPath={`url(#${clip})`}>
            {bandY && <rect x={0} width={iw} y={y(bandY[1])} height={Math.max(0, y(bandY[0]) - y(bandY[1]))} fill="#2a7d74" fillOpacity={0.07} />}
            {refs.map((r, i) => <line key={i} x1={0} x2={iw} y1={y(r.y)} y2={y(r.y)} stroke={r.dash ? '#8a9692' : '#374151'} strokeDasharray={r.dash ? '5 4' : undefined} strokeWidth={r.dash ? 1 : 1.3} data-testid="ref-line" />)}
            {vRefs?.map((v, i) => <line key={`v${i}`} x1={x(v.x)} x2={x(v.x)} y1={0} y2={ih} stroke="#8a9692" strokeDasharray="5 4" />)}
            {smooth && <path d={d3.line<{ x: number; y: number }>().x((p) => x(p.x)).y((p) => y(p.y))(smooth) ?? ''} fill="none" stroke="#e07a3f" strokeWidth={2} data-testid="smooth-line" />}
            {pts.map((p) => {
              const on = selected === p.i || marked.has(p.row)
              const rr = (p.r ?? (compact ? 2.4 : 4.2))
              return <circle key={p.i} className={onPick ? 'mark-point is-pickable' : 'mark-point'} data-testid="diag-point" data-row={p.row} data-flag={p.flag ? '1' : '0'} cx={x(p.x)} cy={y(p.y)} r={on ? rr + 1.8 : rr} fill={p.flag ? '#d6573c' : '#2a7d74'} fillOpacity={p.flag ? 0.9 : 0.62} stroke={on ? '#121816' : '#ffffff'} strokeWidth={on ? 2 : 0.8}
                onPointerEnter={compact ? undefined : (e) => { linked?.set([p.row]); const l = localPoint(svgRef.current!, e); show(l.x, l.y, tipOf(p)) }} onPointerLeave={() => { hide(); linked?.set(null) }} onClick={onPick && !compact ? () => onPick(p.i) : undefined} />
            })}
            {!compact && vlabel && pts.map((p) => { const t = vlabel(p); return t ? <text key={`l${p.i}`} x={x(p.x) + 7} y={y(p.y) - 6} fontSize={10.5} fill="#7a2d1c" stroke="#fff" strokeWidth={3} paintOrder="stroke" pointerEvents="none">{t}</text> : null })}
          </g>
        </g>
      </svg>
      {!compact && <>{extra}<Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

// ─── residual plot ──────────────────────────────────────────────────────────────────

function ResidualChart({ table, mapping, params, setParams, width, height, compact, onTableChange, linked }: ChartProps<DiagParams>) {
  const data = useMemo(() => readRegression(table, mapping), [table, mapping])
  const { fit, diag, fitted, resid, manual } = useDiag(data, params)
  const axisIdx = params.axis >= 0 && params.axis < data.names.length ? params.axis : -1
  const pts: DPoint[] = useMemo(() => data.rows.map((row, i) => ({ i, row, x: axisIdx >= 0 ? data.X[i][axisIdx] : fitted[i], y: resid[i], flag: diag ? Math.abs(diag.standardized[i]) > 2 : false })), [data, fitted, resid, axisIdx, diag])
  const sm = useMemo(() => {
    if (!params.smooth || pts.length < 8) return undefined
    const order = pts.map((p) => p.x).map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0])
    const ys = lowess(order.map((o) => o[0]), order.map((o) => resid[o[1]]))
    return order.map((o, k) => ({ x: o[0], y: ys[k] }))
  }, [params.smooth, pts, resid])
  const drag = useRef<{ i: number; y0: number; r0: number } | null>(null)
  if (!roleColumn(mapping, 'y') || !roleColumns(mapping, 'x').length) return <ChartMessage>응답 변수 y와 설명 변수 x(숫자형)를 선택하세요.</ChartMessage>
  if (!fit) return <ChartMessage>회귀를 적합하려면 유효한 행이 설명 변수 수보다 많아야 하고 설명 변수들이 서로 독립이어야 합니다.</ChartMessage>
  const s = fit.sigma
  const editable = !!onTableChange && !compact
  return (
    <div style={{ width, height, position: 'relative' }}
      onPointerMove={(e) => {
        if (!drag.current || !editable) return
        // moving a point vertically changes the observed response by the same amount, so the fit is recomputed
        const svg = (e.currentTarget as HTMLElement).querySelector('svg')!
        const rect = svg.getBoundingClientRect()
        const m = margins(compact, { right: 24 })
        const ih = Math.max(40, height - m.top - m.bottom)
        const dy = paddedDomain([...pts.map((p) => p.y), 0])
        const scale = d3.scaleLinear().domain(dy).range([ih, 0])
        const target = scale.invert(e.clientY - rect.top - m.top)
        const yi = columnIndex(table, roleColumn(mapping, 'y'))
        const row = data.rows[drag.current.i]
        const next = Math.round((data.y[drag.current.i] + (target - drag.current.r0)) * 100) / 100
        onTableChange!(updateRow(table, row, { [table.columns[yi].name]: next }), true)
      }}
      onPointerUp={() => { if (drag.current) { drag.current = null; onTableChange!(table, false) } }}>
      <DiagFrame width={width} height={height} compact={compact} pts={pts} xLabel={axisIdx >= 0 ? data.names[axisIdx] : '적합값 (예측)'} yLabel="잔차 (관측 − 예측)" refs={[{ y: 0 }]} smooth={sm} bandY={params.band ? [-2 * s, 2 * s] : undefined}
        aria={`잔차 플롯: 관측 ${pts.length}개, 잔차 표준오차 ${fmt(s, 2)}`} selected={params.selected} onPick={editable ? (i) => setParams({ selected: params.selected === i ? -1 : i }) : undefined} linked={linked}
        tipOf={(p) => <><b>행 {p.row + 1}</b><br />관측 {fmt(data.y[p.i])} · 예측 {fmt(fitted[p.i])}<br />잔차 {fmt(p.y, 2)} (표준화 {fmt(diag!.standardized[p.i], 2)}){editable ? <><br />누르고 세로로 끌면 y가 바뀝니다</> : null}</>}
        extra={<Readout items={[{ label: manual ? '직선' : '모델', value: manual ? `y = ${fmt(params.a)} + ${fmt(params.b)}x` : params.degree > 1 && data.names.length === 1 ? `${params.degree}차 다항식` : '선형' }, { label: 'R²', value: fmt(fit.r2, 3) }, { label: '|표준화 잔차|>2', value: pts.filter((p) => p.flag).length }, { label: '잔차 SE', value: fmt(s, 2) }]} />} />
      {editable && <DragLayer pts={pts} width={width} height={height} compact={compact} drag={drag} />}
    </div>
  )
}

/** Transparent hit targets over the residual points that start a vertical drag (kept apart so the plot itself stays a plain chart). */
function DragLayer({ pts, width, height, compact, drag }: { pts: DPoint[]; width: number; height: number; compact?: boolean; drag: React.MutableRefObject<{ i: number; y0: number; r0: number } | null> }) {
  const m = margins(compact, { right: 24 })
  const iw = Math.max(40, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const dx = paddedDomain(pts.map((p) => p.x)), dy = paddedDomain([...pts.map((p) => p.y), 0])
  const x = d3.scaleLinear().domain(dx).range([0, iw]), y = d3.scaleLinear().domain(dy).range([ih, 0])
  return (
    <svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 0 }} aria-hidden="true">
      <g transform={`translate(${m.left},${m.top})`}>
        {pts.map((p) => <circle key={p.i} data-testid="drag-handle" cx={x(p.x)} cy={y(p.y)} r={9} fill="transparent" style={{ cursor: 'ns-resize' }} onPointerDown={(e) => { e.preventDefault(); (e.currentTarget as Element).setPointerCapture(e.pointerId); drag.current = { i: p.i, y0: y(p.y), r0: p.y } }} />)}
      </g>
    </svg>
  )
}

function ResidualControls(props: ControlsProps<DiagParams>) {
  const { params, setParams, table, mapping } = props
  const data = useMemo(() => readRegression(table, mapping), [table, mapping])
  return (
    <DiagControls {...props}>
      <Select label="가로축" value={String(params.axis)} onChange={(v) => setParams({ axis: Number(v) })} testId="ctl-reg-axis" options={[{ value: '-1', label: '적합값' }, ...data.names.map((n, i) => ({ value: String(i), label: n }))]} />
      <Toggle label="±2 잔차 표준오차 띠" checked={params.band} onChange={(band) => setParams({ band })} />
      <Hint>점을 누르고 위아래로 끌면 그 관측의 응답 y가 바뀌고 모델이 다시 적합됩니다. 큰 이상값은 선을 끌어당겨 다른 점의 잔차까지 바꿉니다.</Hint>
    </DiagControls>
  )
}

export const residualModule: VizModule<DiagParams> = {
  roles: roles(1),
  datasets: ['regression-demo', 'pos-corr', 'cars'],
  defaultParams: { ...diagDefaults, axis: -1 },
  Chart: ResidualChart,
  Controls: ResidualControls,
  hint: '점을 누르고 위아래로 끌어 데이터를 바꾸면 회귀와 잔차가 다시 계산됩니다 · 변수를 하나만 고르면 다항식 차수·직선 직접 지정 사용 가능',
}

// ─── scale–location ─────────────────────────────────────────────────────────────────

function ScaleLocationChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<DiagParams>) {
  const data = useMemo(() => readRegression(table, mapping), [table, mapping])
  const { fit, diag, fitted } = useDiag(data, params)
  const pts: DPoint[] = useMemo(() => data.rows.map((row, i) => ({ i, row, x: fitted[i], y: diag ? Math.sqrt(Math.abs(diag.standardized[i])) : 0, flag: diag ? Math.abs(diag.standardized[i]) > 2 : false })), [data, fitted, diag])
  const sm = useMemo(() => {
    if (!params.smooth || pts.length < 8) return undefined
    const order = pts.map((p, i) => [p.x, i] as const).sort((a, b) => a[0] - b[0])
    const ys = lowess(order.map((o) => o[0]), order.map((o) => pts[o[1]].y))
    return order.map((o, k) => ({ x: o[0], y: ys[k] }))
  }, [params.smooth, pts])
  if (!roleColumn(mapping, 'y') || !roleColumns(mapping, 'x').length) return <ChartMessage>응답 변수 y와 설명 변수 x(숫자형)를 선택하세요.</ChartMessage>
  if (!fit || !diag) return <ChartMessage>회귀를 적합할 수 없습니다. 유효한 행과 독립적인 설명 변수가 필요합니다.</ChartMessage>
  // slope of the smoothed line is a quick read of heteroscedasticity: |corr(fitted, sqrt|r|)| near 0 means a constant spread
  const corr = (() => { const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y); const mx = d3.mean(xs)!, my = d3.mean(ys)!; const num = d3.sum(xs, (v, i) => (v - mx) * (ys[i] - my)); const den = Math.sqrt(d3.sum(xs, (v) => (v - mx) ** 2) * d3.sum(ys, (v) => (v - my) ** 2)); return den ? num / den : NaN })()
  return (
    <DiagFrame width={width} height={height} compact={compact} pts={pts} xLabel="적합값 (예측)" yLabel="√|표준화 잔차|" refs={[{ y: Math.sqrt(0.7979), dash: true }]} smooth={sm} aria={`Scale–Location 플롯: 퍼짐과 적합값의 상관 ${fmt(corr, 2)}`} selected={params.selected} linked={linked}
      onPick={(i) => setParams({ selected: params.selected === i ? -1 : i })}
      tipOf={(p) => <><b>행 {p.row + 1}</b><br />적합값 {fmt(p.x)}<br />표준화 잔차 {fmt(diag.standardized[p.i], 2)}</>}
      extra={<Readout items={[{ label: '퍼짐–적합값 상관', value: fmt(corr, 2) }, { label: '이분산 의심', value: Math.abs(corr) > 0.3 ? '있음' : '낮음' }, { label: '관측', value: pts.length }]} />} />
  )
}

function ScaleLocationControls(props: ControlsProps<DiagParams>) {
  return (
    <DiagControls {...props}>
      <Hint>세로축은 표준화 잔차 크기의 제곱근입니다. 점선은 정규 오차일 때 √|N(0,1)|의 기대값(≈0.82)입니다. 평활선이 수평이면 오차의 퍼짐이 일정(등분산)하고, 오른쪽으로 오를수록 커지면 이분산입니다. 주황색 선의 기울기가 뚜렷하면 가중 회귀나 변환을 고려하세요.</Hint>
    </DiagControls>
  )
}

export const scaleLocationModule: VizModule<DiagParams> = {
  roles: roles(1),
  datasets: ['regression-demo', 'pos-corr', 'cars'],
  defaultParams: { ...diagDefaults },
  Chart: ScaleLocationChart,
  Controls: ScaleLocationControls,
  hint: '주황 평활선이 수평이면 오차의 퍼짐이 일정합니다 · 적합값이 커질수록 올라가면 이분산 · 점을 눌러 선택',
}

// ─── influence plot ─────────────────────────────────────────────────────────────────

function InfluenceChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<DiagParams>) {
  const data = useMemo(() => readRegression(table, mapping), [table, mapping])
  const { fit, diag } = useDiag(data, { ...params, mode: 'ols' })
  const cmax = d3.max(diag?.cooks ?? []) ?? 1
  const pts: DPoint[] = useMemo(() => data.rows.map((row, i) => ({ i, row, x: diag?.hat[i] ?? 0, y: diag?.studentized[i] ?? 0, r: (compact ? 2.5 : 3.5) + (compact ? 6 : 16) * Math.sqrt((diag?.cooks[i] ?? 0) / (cmax || 1)), flag: !!diag && (diag.cooks[i] > diag.cookLimit || diag.hat[i] > diag.hatLimit * 1.5 || Math.abs(diag.studentized[i]) > 3) })), [data, diag, cmax, compact])
  const alt = useMemo(() => {
    if (params.selected < 0 || !fit || params.selected >= data.y.length) return null
    const keep = data.y.map((_, i) => i).filter((i) => i !== params.selected)
    const d = designOf(data, params)
    return ols(keep.map((i) => d[i]), keep.map((i) => data.y[i]))
  }, [data, params, fit])
  if (!roleColumn(mapping, 'y') || !roleColumns(mapping, 'x').length) return <ChartMessage>응답 변수 y와 설명 변수 x(숫자형)를 선택하세요.</ChartMessage>
  if (!fit || !diag) return <ChartMessage>회귀를 적합할 수 없습니다. 유효한 행과 독립적인 설명 변수가 필요합니다.</ChartMessage>
  const flagged = pts.filter((p) => p.flag).length
  return (
    <DiagFrame width={width} height={height} compact={compact} pts={pts} xLabel={`레버리지 (영향 지렛대, 기준 2p/n = ${fmt(diag.hatLimit, 3)})`} yLabel="스튜던트화 잔차" refs={[{ y: 0 }, { y: 2, dash: true }, { y: -2, dash: true }]} vRefs={[{ x: diag.hatLimit }]} aria={`영향력 플롯: 영향력 큰 관측 ${flagged}개`} selected={params.selected} linked={linked}
      onPick={(i) => setParams({ selected: params.selected === i ? -1 : i })}
      vlabel={(p) => (p.flag ? String(p.row + 1) : null)}
      tipOf={(p) => <><b>행 {p.row + 1}</b><br />레버리지 {fmt(diag.hat[p.i], 3)} · 스튜던트화 잔차 {fmt(diag.studentized[p.i], 2)}<br />쿡의 거리 {fmt(diag.cooks[p.i], 3)}{diag.cooks[p.i] > diag.cookLimit ? ' (기준 4/n 초과)' : ''}</>}
      extra={<>
        <Readout items={[{ label: '영향력 큰 점', value: flagged }, { label: '최대 쿡의 거리', value: fmt(cmax, 3) }, { label: 'p', value: fit.p }, { label: 'n', value: fit.n }]} />
        {alt && fit.beta.length >= 2 && <p className="chart-note" role="status" data-testid="influence-note">행 {data.rows[params.selected] + 1}을 빼면 {data.names.length === 1 && params.degree === 1 ? '기울기' : '첫 계수'} {fmt(fit.beta[1], 3)} → <b>{fmt(alt.beta[1], 3)}</b></p>}
      </>} />
  )
}

function InfluenceControls(props: ControlsProps<DiagParams>) {
  const { params, setParams } = props
  return (
    <DiagControls {...props}>
      <Hint>가로축은 설명 변수가 평균에서 멀어 모델을 끌어당기는 정도(레버리지), 세로축은 그 점의 잔차(스튜던트화), 원의 크기는 쿡의 거리(점을 뺐을 때 모든 예측이 바뀌는 정도)입니다. 오른쪽에 있으면서 위·아래로도 벗어난 큰 원이 영향력 큰 점입니다. 기준(레버리지 2p/n, 쿡 4/n, |잔차| 3)은 경험칙이며 판정이 아닙니다. 점을 누르면 그 점을 뺀 계수와 비교합니다.</Hint>
      {params.selected >= 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ selected: -1 })}>선택 해제</button>}
    </DiagControls>
  )
}

export const influenceModule: VizModule<DiagParams> = {
  roles: roles(1),
  datasets: ['regression-demo', 'pos-corr', 'cars'],
  defaultParams: { ...diagDefaults, smooth: false },
  Chart: InfluenceChart,
  Controls: InfluenceControls,
  hint: '큰 원(쿡의 거리)이 오른쪽(레버리지)에 있으면 영향력이 큰 점 · 점을 눌러 그 점을 뺀 계수와 비교',
}

// ─── coefficient plot ───────────────────────────────────────────────────────────────

export interface CoefParams { level: number; standardize: boolean; intercept: boolean; hidden: number[] }

function CoefChart({ table, mapping, params, width, height, compact }: ChartProps<CoefParams>) {
  const data = useMemo(() => readRegression(table, mapping), [table, mapping])
  const p = data.names.length
  const models = useMemo(() => {
    if (data.y.length < p + 3 || p < 1) return []
    const sd = (a: number[]) => d3.deviation(a) || 1
    const ys = params.standardize ? data.y.map((v) => (v - d3.mean(data.y)!) / sd(data.y)) : data.y
    const cols = data.names.map((_, j) => data.X.map((r) => r[j]))
    const Xs = params.standardize ? data.X.map((r) => r.map((v, j) => (v - d3.mean(cols[j])!) / sd(cols[j]))) : data.X
    return Array.from({ length: p }, (_, k) => {
      const fit = ols(Xs.map((r) => r.slice(0, k + 1)), ys)
      return fit ? { k, fit, ci: coefIntervals(fit, params.level), names: data.names.slice(0, k + 1) } : null
    }).filter((m): m is NonNullable<typeof m> => !!m)
  }, [data, p, params.standardize, params.level])
  const m = margins(compact, { left: compact ? 10 : 120, right: 24 })
  const iw = Math.max(40, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const labels = [...(params.intercept ? ['절편'] : []), ...data.names]
  const lo = d3.min(models.flatMap((md) => md.ci.map((c, i) => ((i === 0 && !params.intercept) ? NaN : c[0])))) ?? -1, hi = d3.max(models.flatMap((md) => md.ci.map((c, i) => ((i === 0 && !params.intercept) ? NaN : c[1])))) ?? 1
  const x = d3.scaleLinear().domain(paddedDomain([lo, hi, 0], 0.08)).range([0, iw])
  const yb = d3.scaleBand<string>().domain(labels).range([0, ih]).padding(0.25)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const shown = models.filter((md) => !params.hidden.includes(md.k))
  if (!roleColumn(mapping, 'y') || p < 2) return <ChartMessage>응답 변수 y와 설명 변수 x(숫자형) 2개 이상을 선택하세요.</ChartMessage>
  if (!models.length) return <ChartMessage>회귀를 적합할 수 없습니다. 유효한 행이 더 필요하거나 설명 변수가 서로 독립이 아닙니다.</ChartMessage>
  const off = (k: number) => ((k - (models.length - 1) / 2) / models.length) * yb.bandwidth()
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`회귀 계수 플롯: 모델 ${models.length}개, 신뢰수준 ${Math.round(params.level * 100)}%`} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisBottom scale={x} y={ih} grid={ih} label={params.standardize ? '표준화 계수' : '계수 추정값'} compact={compact} />
          {!compact && labels.map((l) => <text key={l} className="axis" x={-8} y={(yb(l) ?? 0) + yb.bandwidth() / 2} dy="0.32em" textAnchor="end" fontSize={12} fill="#374151">{l}</text>)}
          <line x1={x(0)} x2={x(0)} y1={0} y2={ih} stroke="#374151" strokeWidth={1.2} data-testid="zero-line" />
          {shown.map((md) => md.ci.map((c, i) => {
            const label = params.intercept ? (i === 0 ? '절편' : md.names[i - 1]) : md.names[i - 1]
            if (!label) return null
            const yc = (yb(label) ?? 0) + yb.bandwidth() / 2 + off(md.k)
            const est = md.fit.beta[i]
            const sig = c[0] > 0 || c[1] < 0
            return (
              <g key={`${md.k}-${i}`} data-testid="coef" data-model={md.k} data-sig={sig ? '1' : '0'} onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>모델 {md.k + 1}: {label}</b><br />추정 {fmt(est, 3)}<br />{Math.round(params.level * 100)}% 구간 [{fmt(c[0], 3)}, {fmt(c[1], 3)}]<br />{sig ? '구간이 0을 포함하지 않음' : '구간이 0을 포함'}</>) }} onPointerLeave={hide}>
                <line x1={x(c[0])} x2={x(c[1])} y1={yc} y2={yc} stroke={colorAt(md.k)} strokeWidth={2.4} strokeLinecap="round" />
                <circle cx={x(est)} cy={yc} r={compact ? 2.6 : 4.8} fill={sig ? colorAt(md.k) : '#ffffff'} stroke={colorAt(md.k)} strokeWidth={2} />
              </g>
            )
          }))}
        </g>
      </svg>
      {!compact && (<>
        <Legend items={models.map((md) => ({ key: `모델 ${md.k + 1} (변수 ${md.k + 1}개, R² ${fmt(md.fit.r2, 2)})`, color: colorAt(md.k) }))} hidden={params.hidden.map((k) => `모델 ${k + 1} (변수 ${k + 1}개, R² ${fmt(models[k]?.fit.r2, 2)})`)} />
        <Readout items={[{ label: '신뢰수준', value: `${Math.round(params.level * 100)}%` }, { label: '관측', value: data.y.length }]} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

function CoefControls({ params, setParams, table, mapping }: ControlsProps<CoefParams>) {
  const data = useMemo(() => readRegression(table, mapping), [table, mapping])
  return (
    <>
      <ControlGroup title="계수 비교">
        <Slider label="신뢰수준" value={Math.round(params.level * 100)} min={80} max={99} onChange={(v) => setParams({ level: v / 100 })} format={(v) => `${v}%`} testId="ctl-coef-level" />
        <Toggle label="표준화 계수 (단위 제거)" checked={params.standardize} onChange={(standardize) => setParams({ standardize })} testId="ctl-coef-std" />
        <Toggle label="절편 표시" checked={params.intercept} onChange={(intercept) => setParams({ intercept })} />
        <Hint>모델 1은 첫 설명 변수만, 모델 2는 첫 두 변수를, … 마지막 모델은 선택한 모든 변수를 넣은 회귀입니다. 변수를 더하면 기존 계수가 얼마나 바뀌는지(교란·공선성) 볼 수 있습니다. 속이 빈 점은 신뢰구간이 0을 포함해 ‘0과 구별되지 않음’을 뜻하며, 구간이 0을 포함하지 않는 것이 효과가 크다는 뜻은 아닙니다. 서로 다른 단위의 계수를 비교하려면 표준화하세요.</Hint>
        <p className="control-hint">설명 변수 {data.names.length}개: {data.names.join(', ')}</p>
      </ControlGroup>
    </>
  )
}

export const coefficientModule: VizModule<CoefParams> = {
  roles: roles(2),
  datasets: ['regression-demo', 'cars'],
  defaultParams: { level: 0.95, standardize: false, intercept: false, hidden: [] },
  Chart: CoefChart,
  Controls: CoefControls,
  hint: '변수를 하나씩 더한 모델의 계수와 신뢰구간을 비교 · 표준화로 단위를 맞추기 · 신뢰수준 조절',
}

// ─── partial dependence ─────────────────────────────────────────────────────────────

export interface PdpParams { feature: number; trees: number; depth: number; ice: boolean; linear: boolean; seed: number }

function PdpChart({ table, mapping, params, width, height, compact }: ChartProps<PdpParams>) {
  const data = useMemo(() => readRegression(table, mapping), [table, mapping])
  const j = Math.min(Math.max(0, params.feature), Math.max(0, data.names.length - 1))
  const model = useMemo(() => (data.y.length >= 12 && data.names.length >= 1 ? fitForest(data.X, data.y, { trees: compact ? 12 : params.trees, depth: params.depth, seed: params.seed }) : null), [data, params.trees, params.depth, params.seed, compact])
  const col = useMemo(() => data.X.map((r) => r[j]), [data, j])
  const grid = useMemo(() => { if (!col.length) return []; const s = [...col].sort(d3.ascending); const a = d3.quantile(s, 0.02)!, b = d3.quantile(s, 0.98)!; return d3.range(0, 41).map((i) => a + ((b - a) * i) / 40) }, [col])
  const iceRows = useMemo(() => (params.ice ? d3.range(0, data.y.length, Math.max(1, Math.floor(data.y.length / 30))) : []), [params.ice, data.y.length])
  const { pdp, ice } = useMemo(() => (model && grid.length ? partialDependence(model, data.X, j, grid, iceRows) : { pdp: [], ice: [] as number[][] }), [model, data, j, grid, iceRows])
  const r2 = useMemo(() => { if (!model) return NaN; const m = d3.mean(data.y)!; const ssr = d3.sum(data.X, (r, i) => (model.predict(r) - data.y[i]) ** 2); const sst = d3.sum(data.y, (v) => (v - m) ** 2); return 1 - ssr / sst }, [model, data])
  const lin = useMemo(() => { const f = ols(data.X, data.y); if (!f) return null; const means = data.names.map((_, k) => d3.mean(data.X.map((r) => r[k]))!); return grid.map((g) => f.beta[0] + f.beta.slice(1).reduce((s, b, k) => s + b * (k === j ? g : means[k]), 0)) }, [data, grid, j])
  const m = margins(compact)
  const iw = Math.max(40, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const all = [...pdp, ...ice.flat(), ...(params.linear && lin ? lin : [])]
  const x = d3.scaleLinear().domain(grid.length ? [grid[0], grid[grid.length - 1]] : [0, 1]).range([0, iw])
  const y = d3.scaleLinear().domain(paddedDomain(all.length ? all : [0, 1])).range([ih, 0])
  const line = d3.line<number>().x((_, i) => x(grid[i])).y((v) => y(v))
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!roleColumn(mapping, 'y') || data.names.length < 2) return <ChartMessage>응답 변수 y와 설명 변수 x(숫자형) 2개 이상을 선택하세요.</ChartMessage>
  if (!model) return <ChartMessage>모델을 학습하려면 유효한 행이 12개 이상 필요합니다.</ChartMessage>
  const rng = d3.extent(pdp) as [number, number]
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`부분 의존도 플롯: ${data.names[j]}에 따른 평균 예측, 변화폭 ${fmt(rng[1] - rng[0], 2)}`} onPointerLeave={hide}
        onPointerMove={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); const g = x.invert(l.x - m.left); const i = d3.bisectCenter(grid, g); if (l.x >= m.left && l.x <= m.left + iw && pdp[i] != null) show(l.x, l.y, <><b>{data.names[j]} = {fmt(grid[i])}</b><br />평균 예측 {fmt(pdp[i], 2)}{lin ? <><br />선형 모델 {fmt(lin[i], 2)}</> : null}</>); else hide() }}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisBottom scale={x} y={ih} grid={ih} label={data.names[j]} compact={compact} />
          <AxisLeft scale={y} x={0} grid={iw} label={`평균 예측 ${data.yName}`} compact={compact} />
          {ice.map((c, i) => <path key={i} d={line(c) ?? ''} fill="none" stroke="#2a7d74" strokeOpacity={0.18} strokeWidth={1} pointerEvents="none" data-testid="ice-line" />)}
          {params.linear && lin && <path d={line(lin) ?? ''} fill="none" stroke="#8a9692" strokeDasharray="5 4" strokeWidth={1.6} data-testid="linear-line" />}
          <path d={line(pdp) ?? ''} fill="none" stroke="#e07a3f" strokeWidth={3} strokeLinejoin="round" data-testid="pdp-line" />
          {!compact && col.map((v, i) => <line key={i} x1={x(Math.max(grid[0], Math.min(grid[grid.length - 1], v)))} x2={x(Math.max(grid[0], Math.min(grid[grid.length - 1], v)))} y1={ih} y2={ih - 7} stroke="#6b7773" strokeOpacity={0.4} />)}
        </g>
      </svg>
      {!compact && (<>
        <Readout items={[{ label: '변수', value: data.names[j] }, { label: '변화폭', value: fmt(rng[1] - rng[0], 2) }, { label: '학습 R²', value: fmt(r2, 3) }, { label: '나무', value: params.trees }]} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

function PdpControls({ params, setParams, table, mapping }: ControlsProps<PdpParams>) {
  const data = useMemo(() => readRegression(table, mapping), [table, mapping])
  return (
    <>
      <ControlGroup title="관심 변수">
        <Select label="의존도를 볼 변수" value={String(Math.min(params.feature, Math.max(0, data.names.length - 1)))} onChange={(v) => setParams({ feature: Number(v) })} testId="ctl-pdp-feature" options={data.names.map((n, i) => ({ value: String(i), label: n }))} />
        <Toggle label="개별 조건부 기대(ICE) 곡선" checked={params.ice} onChange={(ice) => setParams({ ice })} testId="ctl-pdp-ice" />
        <Toggle label="선형 회귀 비교선" checked={params.linear} onChange={(linear) => setParams({ linear })} />
        <Hint>부분 의존도는 한 변수를 구간별로 고정해 모든 관측에 대입하고 나머지는 그대로 둔 채 모델 예측을 평균한 것입니다. 주황선이 변수의 평균적인 영향이고, 옅은 선은 관측마다의 곡선(ICE)입니다. 곡선들이 평행하지 않으면 다른 변수와의 상호작용이 있다는 뜻입니다. 이 그림은 모델의 행동이지 인과 효과가 아니며, 변수들이 서로 상관되면 데이터에 없는 조합을 평가하게 됩니다.</Hint>
      </ControlGroup>
      <ControlGroup title="모델 (랜덤 포레스트)" defaultOpen={false}>
        <Slider label="나무 수" value={params.trees} min={5} max={100} step={5} onChange={(trees) => setParams({ trees })} testId="ctl-pdp-trees" />
        <Slider label="나무 깊이" value={params.depth} min={1} max={8} onChange={(depth) => setParams({ depth })} testId="ctl-pdp-depth" />
        <NumberField label="난수 시드" value={params.seed} min={0} step={1} onChange={(seed) => setParams({ seed })} />
        <Hint>실제로 부트스트랩 표본마다 회귀 나무를 키워 평균을 낸 모델이며 설정에 따라 곡선이 달라집니다. 나무가 너무 깊으면 과적합합니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const pdpModule: VizModule<PdpParams> = {
  roles: roles(2),
  datasets: ['regression-demo', 'cars'],
  defaultParams: { feature: 0, trees: 40, depth: 4, ice: true, linear: true, seed: 3 },
  Chart: PdpChart,
  Controls: PdpControls,
  hint: '관심 변수를 바꿔 모델이 학습한 영향의 모양을 보세요 · 옅은 선(ICE)이 평행하지 않으면 상호작용 · 선형 회귀선과 비교',
}
