import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Readout, Tooltip, localPoint, margins, useSvgId, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, NumberField, Segmented, Select, Slider, StatTable, Toggle } from '../../components/controls'
import { columnIndex, toNumber, toTime, type DataTable } from '../../data/table'
import { fmt, pct } from '../../lib/format'
import { baseline, bootstrap, bootstrapCi, cusum, ewma, gainCurve, pit, pitHistogram, pitKs, statistic, statLabels, type BootCi, type PitFamily, type StatName } from '../../stats/inference2'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'
import { classifierRoles, scoredRows } from './classifier'
import { paddedDomain } from './shared'

/** Process-monitoring charts (EWMA, CUSUM), the bootstrap distribution, cumulative gain / lift and the PIT histogram. */

const seriesRoles = [
  { key: 'value', label: '측정값', type: 'number' as const, required: true, prefer: '측정|값|value' },
  { key: 'x', label: '시점·순서 (선택)', type: 'date' as const, accept: ['date' as const, 'number' as const], prefer: '시점|time|날짜|date' },
]

function readSeries(table: DataTable, mapping: Mapping) {
  const vi = columnIndex(table, roleColumn(mapping, 'value')), xi = columnIndex(table, roleColumn(mapping, 'x'))
  const date = xi >= 0 && table.columns[xi].type === 'date'
  const pts: { i: number; x: number; v: number; row: number }[] = []
  if (vi < 0) return { pts, date }
  table.rows.forEach((r, row) => {
    const v = toNumber(r[vi])
    if (v == null) return
    const x = xi >= 0 ? (date ? toTime(r[xi] as never) : toNumber(r[xi])) : pts.length + 1
    pts.push({ i: pts.length, x: x ?? pts.length + 1, v, row })
  })
  return { pts, date }
}

// ─── EWMA ───────────────────────────────────────────────────────────────────────────

export interface EwmaParams { lambda: number; L: number; base: number; exact: boolean; shewhart: boolean; showPoints: boolean }

function EwmaChart({ table, mapping, params, width, height, compact, linked }: ChartProps<EwmaParams>) {
  const { pts, date } = useMemo(() => readSeries(table, mapping), [table, mapping])
  const xs = pts.map((p) => p.v)
  const base = useMemo(() => baseline(xs, params.base), [xs.join(','), params.base]) // eslint-disable-line react-hooks/exhaustive-deps
  const res = useMemo(() => ewma(xs, { lambda: params.lambda, L: params.L, mu0: base.mu, sigma0: base.sigma, exact: params.exact }), [xs.join(','), params.lambda, params.L, base, params.exact]) // eslint-disable-line react-hooks/exhaustive-deps
  const shew = useMemo(() => xs.map((v, i) => (i >= 0 && Math.abs(v - base.mu) > 3 * base.sigma ? i : -1)).filter((i) => i >= 0), [xs.join(','), base]) // eslint-disable-line react-hooks/exhaustive-deps
  const m = margins(compact)
  const iw = Math.max(40, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const x = d3.scaleLinear().domain(paddedDomain(pts.map((p) => p.x), 0.02)).range([0, iw])
  const yDom = paddedDomain([...res.ucl, ...res.lcl, ...res.z, ...(params.showPoints || params.shewhart ? xs : [])], 0.05)
  const y = d3.scaleLinear().domain(yDom).range([ih, 0])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const marked = new Set(linked?.rows ?? [])
  if (!roleColumn(mapping, 'value')) return <ChartMessage>측정값(숫자형) 열을 선택하세요.</ChartMessage>
  if (pts.length < 5) return <ChartMessage>EWMA에는 측정값이 5개 이상 필요합니다.</ChartMessage>
  const first = res.signals[0]
  const line = d3.line<number>().x((_, i) => x(pts[i].x)).y((v) => y(v))
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`EWMA 관리도: λ=${params.lambda}, L=${params.L}, 신호 ${res.signals.length}개`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisBottom scale={x} y={ih} grid={ih} label="시점" compact={compact} date={date} />
          <AxisLeft scale={y} x={0} grid={iw} label="측정값 / EWMA" compact={compact} />
          <rect x={0} y={0} width={Math.max(0, x(pts[Math.min(pts.length - 1, params.base - 1)].x))} height={ih} fill="#2a7d74" fillOpacity={0.05} />
          <line x1={0} x2={iw} y1={y(base.mu)} y2={y(base.mu)} stroke="#374151" strokeWidth={1.2} data-testid="center-line" />
          <path d={line(res.ucl) ?? ''} fill="none" stroke="#c0453a" strokeDasharray="5 3" strokeWidth={1.4} data-testid="ewma-ucl" /><path d={line(res.lcl) ?? ''} fill="none" stroke="#c0453a" strokeDasharray="5 3" strokeWidth={1.4} />
          {params.shewhart && [3, -3].map((k) => <line key={k} x1={0} x2={iw} y1={y(base.mu + k * base.sigma)} y2={y(base.mu + k * base.sigma)} stroke="#8a9692" strokeDasharray="2 4" />)}
          {(params.showPoints || params.shewhart) && !compact && pts.map((p) => <circle key={p.i} cx={x(p.x)} cy={y(p.v)} r={2.4} fill={params.shewhart && shew.includes(p.i) ? '#d6573c' : '#aab4b0'} fillOpacity={0.8} pointerEvents="none" />)}
          <path d={line(res.z) ?? ''} fill="none" stroke="#2a7d74" strokeWidth={2} strokeLinejoin="round" data-testid="ewma-line" />
          {res.signals.map((i) => <circle key={`s${i}`} data-testid="ewma-signal" cx={x(pts[i].x)} cy={y(res.z[i])} r={compact ? 2.6 : 5} fill="#d6573c" stroke="#fff" strokeWidth={1.4} />)}
          {!compact && pts.map((p) => <circle key={`h${p.i}`} cx={x(p.x)} cy={y(res.z[p.i])} r={9} fill="transparent" onPointerEnter={(e) => { linked?.set([p.row]); const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>{p.i + 1}번째</b><br />측정값 {fmt(p.v, 3)}<br />EWMA {fmt(res.z[p.i], 3)} (한계 {fmt(res.lcl[p.i], 2)} ~ {fmt(res.ucl[p.i], 2)}){res.signals.includes(p.i) ? <><br /><b>관리한계 이탈</b></> : null}</>) }} onPointerLeave={() => { hide(); linked?.set(null) }} stroke={marked.has(p.row) ? '#121816' : undefined} />)}
        </g>
      </svg>
      {!compact && (<>
        <Readout items={[{ label: '중심 μ₀', value: fmt(base.mu, 3) }, { label: 'σ₀ (MR/1.128)', value: fmt(base.sigma, 3) }, { label: 'EWMA 첫 신호', value: first == null ? '없음' : `${first + 1}번째` }, ...(params.shewhart ? [{ label: '개별 3σ 첫 신호', value: shew[0] == null ? '없음' : `${shew[0] + 1}번째` }] : [])]} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

function EwmaControls({ params, setParams }: ControlsProps<EwmaParams>) {
  return (
    <ControlGroup title="EWMA 설정">
      <Slider label="평활 상수 λ" value={params.lambda} min={0.05} max={1} step={0.01} onChange={(lambda) => setParams({ lambda })} testId="ctl-ewma-lambda" />
      <Slider label="한계 폭 L (σ 배수)" value={params.L} min={1.5} max={4} step={0.1} onChange={(L) => setParams({ L })} testId="ctl-ewma-L" />
      <Slider label="기준선 계산에 쓸 처음 점 수" value={params.base} min={10} max={60} onChange={(base) => setParams({ base })} testId="ctl-ewma-base" />
      <Toggle label="시간에 따라 넓어지는 정확한 한계" checked={params.exact} onChange={(exact) => setParams({ exact })} />
      <Toggle label="개별 값 3σ 한계와 비교" checked={params.shewhart} onChange={(shewhart) => setParams({ shewhart })} testId="ctl-ewma-shew" />
      <Toggle label="개별 측정값 표시" checked={params.showPoints} onChange={(showPoints) => setParams({ showPoints })} />
      <Hint>EWMA는 z_t = λx_t + (1−λ)z_(t−1)로 지난 값을 지수적으로 줄여 가며 평균해, 작은 평균 이동이 쌓여 드러나게 합니다. λ가 작을수록 과거를 오래 기억해 작은 이동에 민감하지만 큰 급변은 늦게 잡고, λ=1이면 개별 값 관리도와 같습니다. 중심과 σ는 처음 점들(초록 영역)에서 이동 범위로 추정합니다. 기준 구간에 이상이 섞이면 한계가 왜곡됩니다.</Hint>
    </ControlGroup>
  )
}

export const ewmaModule: VizModule<EwmaParams> = {
  roles: seriesRoles,
  datasets: ['process-shift', 'process'],
  defaultParams: { lambda: 0.15, L: 2.7, base: 30, exact: true, shewhart: true, showPoints: true },
  Chart: EwmaChart,
  Controls: EwmaControls,
  hint: 'λ를 줄이면 작은 이동에 민감해집니다 · 개별 3σ 한계와 비교해 EWMA가 얼마나 먼저 잡는지 확인 · 점에 포인터를 올리면 한계값',
}

// ─── CUSUM ──────────────────────────────────────────────────────────────────────────

export interface CusumParams { k: number; h: number; base: number; restart: boolean }

function CusumChart({ table, mapping, params, width, height, compact, linked }: ChartProps<CusumParams>) {
  const { pts, date } = useMemo(() => readSeries(table, mapping), [table, mapping])
  const xs = pts.map((p) => p.v)
  const base = useMemo(() => baseline(xs, params.base), [xs.join(','), params.base]) // eslint-disable-line react-hooks/exhaustive-deps
  const res = useMemo(() => cusum(xs, { k: params.k, h: params.h, mu0: base.mu, sigma0: base.sigma, restart: params.restart }), [xs.join(','), params, base]) // eslint-disable-line react-hooks/exhaustive-deps
  const m = margins(compact)
  const iw = Math.max(40, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const x = d3.scaleLinear().domain(paddedDomain(pts.map((p) => p.x), 0.02)).range([0, iw])
  const top = Math.max(params.h * 1.3, d3.max(res.upper) ?? 0, d3.max(res.lower) ?? 0) * 1.05
  const y = d3.scaleLinear().domain([-top, top]).range([ih, 0])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!roleColumn(mapping, 'value')) return <ChartMessage>측정값(숫자형) 열을 선택하세요.</ChartMessage>
  if (pts.length < 5) return <ChartMessage>CUSUM에는 측정값이 5개 이상 필요합니다.</ChartMessage>
  const first = res.signals[0]
  const up = d3.line<number>().x((_, i) => x(pts[i].x)).y((v) => y(v)).curve(d3.curveStepAfter), dn = d3.line<number>().x((_, i) => x(pts[i].x)).y((v) => y(-v)).curve(d3.curveStepAfter)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`CUSUM 관리도: k=${params.k}, h=${params.h}, 신호 ${res.signals.length}개`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisBottom scale={x} y={ih} grid={ih} label="시점" compact={compact} date={date} />
          <AxisLeft scale={y} x={0} grid={iw} label="누적합 (σ 단위, 위 = 상승, 아래 = 하락)" format={(v) => fmt(Math.abs(v), 1)} compact={compact} />
          <line x1={0} x2={iw} y1={y(0)} y2={y(0)} stroke="#374151" strokeWidth={1.2} />
          {[params.h, -params.h].map((v) => <line key={v} x1={0} x2={iw} y1={y(v)} y2={y(v)} stroke="#c0453a" strokeDasharray="5 3" strokeWidth={1.4} data-testid="cusum-limit" />)}
          <path d={up(res.upper) ?? ''} fill="none" stroke="#c0643a" strokeWidth={2} data-testid="cusum-upper" /><path d={dn(res.lower) ?? ''} fill="none" stroke="#2b6cb0" strokeWidth={2} data-testid="cusum-lower" />
          {res.signals.map((s, i) => <circle key={i} data-testid="cusum-signal" cx={x(pts[s.index].x)} cy={y(s.side === 'up' ? res.upper[s.index] : -res.lower[s.index])} r={compact ? 2.6 : 5} fill="#d6573c" stroke="#fff" strokeWidth={1.4} />)}
          {!compact && pts.map((p) => <rect key={p.i} x={x(p.x) - 4} y={0} width={8} height={ih} fill="transparent" onPointerEnter={(e) => { linked?.set([p.row]); const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>{p.i + 1}번째</b><br />측정값 {fmt(p.v, 3)} (z = {fmt((p.v - base.mu) / base.sigma, 2)})<br />C⁺ {fmt(res.upper[p.i], 2)} · C⁻ {fmt(res.lower[p.i], 2)}</>) }} onPointerLeave={() => { hide(); linked?.set(null) }} />)}
        </g>
      </svg>
      {!compact && (<>
        <Readout items={[{ label: '첫 신호', value: first == null ? '없음' : `${first.index + 1}번째 (${first.side === 'up' ? '상승' : '하락'})` }, { label: '신호 수', value: res.signals.length }, { label: 'k / h', value: `${params.k} / ${params.h}` }]} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

function CusumControls({ params, setParams }: ControlsProps<CusumParams>) {
  return (
    <ControlGroup title="CUSUM 설정">
      <Slider label="허용치 k (σ 단위)" value={params.k} min={0.1} max={1.5} step={0.05} onChange={(k) => setParams({ k })} testId="ctl-cusum-k" />
      <Slider label="결정 구간 h (σ 단위)" value={params.h} min={2} max={10} step={0.25} onChange={(h) => setParams({ h })} testId="ctl-cusum-h" />
      <Slider label="기준선 계산에 쓸 처음 점 수" value={params.base} min={10} max={60} onChange={(base) => setParams({ base })} />
      <Toggle label="신호 뒤 누적합 다시 시작" checked={params.restart} onChange={(restart) => setParams({ restart })} />
      <Hint>C⁺는 (표준화한 값 − k)를 0 아래로 내려가지 않게 누적해 평균 상승을, C⁻는 반대 방향을 모읍니다. 목표 이동이 2k(σ 단위)일 때 가장 민감하므로 k는 잡고 싶은 이동의 절반으로 정합니다(0.5σ면 1σ 이동). h를 키우면 오경보는 줄지만 신호가 늦어집니다. 아래쪽 곡선은 하락 누적합을 거울상으로 그린 것입니다.</Hint>
    </ControlGroup>
  )
}

export const cusumModule: VizModule<CusumParams> = {
  roles: seriesRoles,
  datasets: ['process-shift', 'process'],
  defaultParams: { k: 0.5, h: 4, base: 30, restart: true },
  Chart: CusumChart,
  Controls: CusumControls,
  hint: 'k를 바꿔 잡고 싶은 이동의 크기를 정하고 h로 민감도를 조절 · 빨간 점은 결정 구간을 넘은 신호 · 아래쪽은 하락 누적합',
}

// ─── bootstrap distribution ─────────────────────────────────────────────────────────

export interface BootParams { stat: StatName; reps: number; shown: number; level: number; method: BootCi['method']; bins: number; seed: number }

function BootstrapChart({ table, mapping, params, width, height, compact }: ChartProps<BootParams>) {
  const vi = columnIndex(table, roleColumn(mapping, 'value'))
  const data = useMemo(() => (vi < 0 ? [] : table.rows.map((r) => toNumber(r[vi])).filter((v): v is number => v != null)), [table, vi])
  const reps = compact ? Math.min(400, params.reps) : params.reps
  const boot = useMemo(() => (data.length >= 3 ? bootstrap(data, params.stat, reps, params.seed) : []), [data, params.stat, reps, params.seed])
  const shown = boot.slice(0, Math.max(10, Math.min(boot.length, params.shown)))
  const theta = statistic(params.stat, data)
  const ci = useMemo(() => (shown.length >= 20 ? bootstrapCi(data, params.stat, shown, params.level, params.method) : null), [data, params.stat, shown.length, params.level, params.method]) // eslint-disable-line react-hooks/exhaustive-deps
  const m = margins(compact)
  const iw = Math.max(40, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const dom = paddedDomain([...boot, theta], 0.04)
  const x = d3.scaleLinear().domain(dom).range([0, iw])
  const hist = useMemo(() => d3.bin().domain(dom as [number, number]).thresholds(compact ? 14 : params.bins)(shown), [shown, dom, params.bins, compact])
  const y = d3.scaleLinear().domain([0, d3.max(hist, (b) => b.length) ?? 1]).nice().range([ih, 0])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!roleColumn(mapping, 'value')) return <ChartMessage>값(숫자형) 열을 선택하세요.</ChartMessage>
  if (data.length < 3) return <ChartMessage>부트스트랩에는 관측이 3개 이상 필요합니다.</ChartMessage>
  const se = d3.deviation(shown) ?? NaN
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`부트스트랩 분포: ${statLabels[params.stat]}, 재표본 ${shown.length}개`} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisBottom scale={x} y={ih} grid={ih} label={`${statLabels[params.stat]} (재표본)`} compact={compact} />
          <AxisLeft scale={y} x={0} grid={iw} label="재표본 수" compact={compact} />
          {ci && <rect x={x(ci.lo)} y={0} width={Math.max(0, x(ci.hi) - x(ci.lo))} height={ih} fill="#2a7d74" fillOpacity={0.1} data-testid="ci-region" />}
          {hist.map((b, i) => <rect key={i} data-testid="boot-bin" data-count={b.length} x={x(b.x0!) + 0.5} y={y(b.length)} width={Math.max(0, x(b.x1!) - x(b.x0!) - 1)} height={Math.max(0, ih - y(b.length))} fill={ci && (b.x1! < ci.lo || b.x0! > ci.hi) ? '#b9c8c4' : '#2a7d74'} fillOpacity={0.85}
            onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>{fmt(b.x0!, 3)} ~ {fmt(b.x1!, 3)}</b><br />재표본 {b.length}개 ({pct(b.length / shown.length)})</>) }} onPointerLeave={hide} />)}
          <line x1={x(theta)} x2={x(theta)} y1={0} y2={ih} stroke="#e07a3f" strokeWidth={2} data-testid="observed-line" />
          {ci && [ci.lo, ci.hi].map((v, i) => <line key={i} x1={x(v)} x2={x(v)} y1={0} y2={ih} stroke="#c0453a" strokeDasharray="5 3" strokeWidth={1.5} data-testid="ci-line" />)}
        </g>
      </svg>
      {!compact && (<>
        <Readout items={[{ label: statLabels[params.stat], value: fmt(theta, 3) }, { label: '부트스트랩 SE', value: fmt(se, 3) }, ...(ci ? [{ label: `${Math.round(params.level * 100)}% 구간`, value: `[${fmt(ci.lo, 3)}, ${fmt(ci.hi, 3)}]` }] : []), { label: '재표본', value: shown.length }]} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

function BootstrapControls({ params, setParams, table, mapping }: ControlsProps<BootParams>) {
  const vi = columnIndex(table, roleColumn(mapping, 'value'))
  const data = useMemo(() => (vi < 0 ? [] : table.rows.map((r) => toNumber(r[vi])).filter((v): v is number => v != null)), [table, vi])
  const boot = useMemo(() => (data.length >= 3 ? bootstrap(data, params.stat, params.reps, params.seed) : []), [data, params.stat, params.reps, params.seed])
  const shown = boot.slice(0, Math.max(10, Math.min(boot.length, params.shown)))
  const rows = (['percentile', 'bca', 'normal'] as BootCi['method'][]).map((mm) => { const c = shown.length >= 20 ? bootstrapCi(data, params.stat, shown, params.level, mm) : null; return [{ percentile: '백분위', bca: 'BCa', normal: '정규 근사' }[mm], c ? `[${fmt(c.lo, 3)}, ${fmt(c.hi, 3)}]` : '–'] })
  return (
    <>
      <ControlGroup title="재표본">
        <Select label="통계량" value={params.stat} onChange={(stat) => setParams({ stat })} testId="ctl-boot-stat" options={(Object.keys(statLabels) as StatName[]).map((k) => ({ value: k, label: statLabels[k] }))} />
        <Slider label="재표본 총 개수 B" value={params.reps} min={100} max={10000} step={100} onChange={(reps) => setParams({ reps, shown: Math.min(params.shown, reps) })} testId="ctl-boot-reps" />
        <Slider label="그림에 쓰는 재표본 수" value={Math.min(params.shown, params.reps)} min={10} max={params.reps} step={10} onChange={(shown) => setParams({ shown })} testId="ctl-boot-shown" />
        <NumberField label="난수 시드 (바꾸면 새 재표본)" value={params.seed} min={0} step={1} onChange={(seed) => setParams({ seed })} testId="ctl-boot-seed" />
        <Hint>부트스트랩은 원자료에서 같은 크기로 복원 추출한 재표본마다 통계량을 다시 계산해, 그 통계량의 표본 변동을 흉내 냅니다. 재표본 수를 늘리면 분포 모양과 구간이 안정되지만, 원자료 자체가 모집단을 대표하지 못하면 여러 번 해도 편향은 사라지지 않습니다. 관측이 아주 적거나 극단값(최댓값 등)의 통계량에는 알맞지 않습니다.</Hint>
      </ControlGroup>
      <ControlGroup title="신뢰구간">
        <Slider label="신뢰수준" value={Math.round(params.level * 100)} min={80} max={99} onChange={(v) => setParams({ level: v / 100 })} format={(v) => `${v}%`} testId="ctl-boot-level" />
        <Select label="그림에 표시할 구간" value={params.method} onChange={(method) => setParams({ method })} testId="ctl-boot-method" options={[{ value: 'percentile', label: '백분위' }, { value: 'bca', label: 'BCa (편향·가속 보정)' }, { value: 'normal', label: '정규 근사 (±z·SE)' }]} />
        <Slider label="히스토그램 구간 수" value={params.bins} min={10} max={80} onChange={(bins) => setParams({ bins })} />
        <StatTable rows={[['방법', '구간'], ...rows]} />
        <Hint>세 구간이 크게 다르면 통계량의 분포가 비대칭이라는 신호입니다. BCa는 편향과 치우침을 보정하므로 비대칭 통계량에 더 알맞습니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const bootstrapModule: VizModule<BootParams> = {
  roles: [{ key: 'value', label: '값', type: 'number', required: true }],
  datasets: ['skewed', 'normal', 'groups'],
  defaultParams: { stat: 'mean', reps: 2000, shown: 2000, level: 0.95, method: 'percentile', bins: 40, seed: 1 },
  Chart: BootstrapChart,
  Controls: BootstrapControls,
  hint: '통계량을 바꿔 보세요(중앙값·표준편차는 이론식이 없어도 구간을 얻습니다) · 그림에 쓰는 재표본 수를 줄였다 늘려 구간이 안정되는 과정 확인 · 시드를 바꾸면 새 재표본',
}

// ─── cumulative gain & lift ─────────────────────────────────────────────────────────

export interface GainParams { bins: number; mode: 'gain' | 'lift'; perfect: boolean; selected: number }

function GainChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<GainParams>) {
  const { data, badLabels } = useMemo(() => scoredRows(table, mapping), [table, mapping])
  const gc = useMemo(() => (data.length >= 10 ? gainCurve(data, params.bins) : null), [data, params.bins])
  const m = margins(compact)
  const iw = Math.max(40, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!roleColumn(mapping, 'score') || !roleColumn(mapping, 'label')) return <ChartMessage>예측 점수와 실제 레이블(0/1) 열을 선택하세요.</ChartMessage>
  if (!gc) return <ChartMessage>유효한 행이 10개 이상 필요합니다.<small>{badLabels > 0 ? `레이블이 0/1이 아닌 ${badLabels}행이 있습니다.` : ''}</small></ChartMessage>
  const lift = params.mode === 'lift'
  const x = d3.scaleLinear().domain([0, 1]).range([0, iw])
  const maxLift = d3.max(gc.points.slice(1), (p) => p.lift) ?? 1
  const y = lift ? d3.scaleLinear().domain([0, Math.max(2, maxLift * 1.1)]).range([ih, 0]) : d3.scaleLinear().domain([0, 1]).range([ih, 0])
  const pts = gc.points.slice(lift ? 1 : 0)
  const val = (p: (typeof pts)[number]) => (lift ? p.lift : p.gain)
  const line = d3.line<(typeof pts)[number]>().x((p) => x(p.frac)).y((p) => y(val(p)))
  const sel = params.selected >= 1 && params.selected <= params.bins ? gc.points[params.selected] : null
  const bw = x(1 / params.bins) - x(0)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`${lift ? '리프트' : '누적 이득'} 차트: 지니 ${fmt(gc.gini, 2)}`} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisBottom scale={x} y={ih} grid={ih} label="예측 점수 상위 비율 (대상 선택 비율)" format={(v) => `${Math.round(v * 100)}%`} compact={compact} />
          <AxisLeft scale={y} x={0} grid={iw} label={lift ? '리프트 (무작위 대비 배수)' : '포착한 양성 비율 (누적 이득)'} format={lift ? undefined : (v) => `${Math.round(v * 100)}%`} compact={compact} />
          {gc.points.slice(1).map((p, i) => <rect key={i} data-testid="gain-bin" x={x(p.frac) - bw + 1} y={0} width={Math.max(0, bw - 2)} height={ih} fill={params.selected === i + 1 ? '#e07a3f' : '#2a7d74'} fillOpacity={params.selected === i + 1 ? 0.16 : 0.035} style={{ cursor: compact ? 'default' : 'pointer' }}
            onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>상위 {Math.round(p.frac * 100)}%</b><br />양성 {fmt(p.gain * 100, 1)}% 포착<br />리프트 {fmt(p.lift, 2)}배<br />점수 기준 ≥ {fmt(p.threshold, 3)}</>) }} onPointerLeave={hide} onClick={compact ? undefined : () => setParams({ selected: params.selected === i + 1 ? -1 : i + 1 })} />)}
          {lift ? <line x1={0} x2={iw} y1={y(1)} y2={y(1)} stroke="#8a9692" strokeDasharray="5 4" data-testid="baseline" /> : <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="#8a9692" strokeDasharray="5 4" data-testid="baseline" />}
          {params.perfect && (lift
            ? <path d={d3.line<(typeof pts)[number]>().x((p) => x(p.frac)).y((p) => y(p.perfect / p.frac))(pts) ?? ''} fill="none" stroke="#9b5fb4" strokeDasharray="2 4" strokeWidth={1.6} data-testid="perfect-line" />
            : <path d={d3.line<(typeof pts)[number]>().x((p) => x(p.frac)).y((p) => y(p.perfect))(pts) ?? ''} fill="none" stroke="#9b5fb4" strokeDasharray="2 4" strokeWidth={1.6} data-testid="perfect-line" />)}
          <path d={line(pts) ?? ''} fill="none" stroke="#2a7d74" strokeWidth={2.4} strokeLinejoin="round" data-testid="gain-curve" />
          {pts.map((p, i) => <circle key={i} cx={x(p.frac)} cy={y(val(p))} r={compact ? 2 : params.selected === gc.points.indexOf(p) ? 6 : 3.4} fill="#fff" stroke="#2a7d74" strokeWidth={1.8} pointerEvents="none" />)}
        </g>
      </svg>
      {!compact && (<>
        <Readout items={[{ label: '양성 비율', value: pct(gc.prevalence) }, { label: '지니(정확도 비)', value: fmt(gc.gini, 3) }, ...(sel ? [{ label: `상위 ${Math.round(sel.frac * 100)}%`, value: `${fmt(sel.gain * 100, 1)}% 포착 · 리프트 ${fmt(sel.lift, 2)}` }] : [{ label: '맨 위 구간 리프트', value: fmt(gc.points[1].lift, 2) }])]} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

function GainControls({ params, setParams }: ControlsProps<GainParams>) {
  return (
    <ControlGroup title="이득·리프트">
      <Segmented label="보기" value={params.mode} onChange={(mode) => setParams({ mode })} testId="ctl-gain-mode" options={[{ value: 'gain', label: '누적 이득' }, { value: 'lift', label: '리프트' }]} />
      <Slider label="구간 수" value={params.bins} min={5} max={50} step={5} onChange={(bins) => setParams({ bins, selected: -1 })} testId="ctl-gain-bins" />
      <Toggle label="완벽한 모델 (보라 점선)" checked={params.perfect} onChange={(perfect) => setParams({ perfect })} />
      <Hint>점수가 높은 순으로 대상을 고를 때, 선택한 비율(가로)이 전체 양성 중 얼마를 포착하는지(세로)가 누적 이득입니다. 대각선은 무작위 선택이며 곡선이 위로 불룩할수록 좋은 모델입니다. 리프트는 이득을 선택 비율로 나눈 값으로 ‘무작위보다 몇 배 잘 찾는가’입니다. 양성 비율이 낮을수록 맨 위 구간의 리프트가 커지므로 서로 다른 데이터의 리프트를 비교하지 마세요. 구간을 눌러 그 지점을 선택합니다.</Hint>
    </ControlGroup>
  )
}

export const gainLiftModule: VizModule<GainParams> = {
  roles: classifierRoles,
  datasets: ['risk-model', 'scores', 'scores-imbalanced'],
  defaultParams: { bins: 10, mode: 'gain', perfect: true, selected: -1 },
  Chart: GainChart,
  Controls: GainControls,
  hint: '누적 이득과 리프트를 번갈아 보세요 · 구간을 눌러 상위 몇 %를 선택할 때의 성과 확인 · 보라 점선은 가능한 최대 성과',
}

// ─── PIT histogram ──────────────────────────────────────────────────────────────────

export interface PitParams { bins: number; family: PitFamily; band: boolean }

function PitChart({ table, mapping, params, width, height, compact }: ChartProps<PitParams>) {
  const oi = columnIndex(table, roleColumn(mapping, 'obs')), mi = columnIndex(table, roleColumn(mapping, 'mu')), si = columnIndex(table, roleColumn(mapping, 'sd'))
  const values = useMemo(() => {
    const out: number[] = []
    if (oi < 0 || mi < 0 || si < 0) return out
    for (const r of table.rows) { const y = toNumber(r[oi]), mu = toNumber(r[mi]), sd = toNumber(r[si]); if (y != null && mu != null && sd != null && sd > 0) out.push(pit(y, mu, sd, params.family)) }
    return out
  }, [table, oi, mi, si, params.family])
  const hist = useMemo(() => pitHistogram(values, compact ? 10 : params.bins), [values, params.bins, compact])
  const ks = useMemo(() => pitKs(values), [values])
  const m = margins(compact)
  const iw = Math.max(40, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const clip = useSvgId('pit-clip')
  if (!roleColumn(mapping, 'obs') || !roleColumn(mapping, 'mu') || !roleColumn(mapping, 'sd')) return <ChartMessage>관측값, 예측 평균, 예측 표준편차(숫자형) 열을 선택하세요.</ChartMessage>
  if (values.length < 20) return <ChartMessage>표준편차가 0보다 큰 예측이 20개 이상 필요합니다.</ChartMessage>
  const x = d3.scaleLinear().domain([0, 1]).range([0, iw])
  const yMax = Math.max(1.6, (d3.max(hist.bins, (b) => b.density) ?? 1) * 1.1, hist.band[1] * 1.1)
  const y = d3.scaleLinear().domain([0, yMax]).range([ih, 0])
  const mean = d3.mean(values)!, edge = (hist.bins[0].density + hist.bins[hist.bins.length - 1].density) / 2, mid = d3.mean(hist.bins.slice(Math.floor(hist.bins.length * 0.35), Math.ceil(hist.bins.length * 0.65)), (b) => b.density) ?? 1
  const diagnosis = ks < 1.36 / Math.sqrt(values.length) ? '보정 양호 (균일과 구별 안 됨)' : edge > 1.3 && edge > mid * 1.3 ? '과신 (분포가 너무 좁음)' : mid > 1.2 && mid > edge * 1.2 ? '과소신뢰 (분포가 너무 넓음)' : mean < 0.45 ? '예측이 관측보다 높게 편향' : mean > 0.55 ? '예측이 관측보다 낮게 편향' : '균일하지 않음'
  void clip
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`PIT 히스토그램: ${diagnosis}`} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisBottom scale={x} y={ih} grid={ih} label="PIT 값 (예측 분포에서 관측의 누적확률)" compact={compact} />
          <AxisLeft scale={y} x={0} grid={iw} label="밀도 (균일 = 1)" compact={compact} />
          {params.band && !compact && <rect x={0} width={iw} y={y(hist.band[1])} height={Math.max(0, y(hist.band[0]) - y(hist.band[1]))} fill="#2a7d74" fillOpacity={0.1} data-testid="pit-band" />}
          {hist.bins.map((b, i) => <rect key={i} data-testid="pit-bin" data-density={b.density.toFixed(3)} x={x(b.lo) + 0.5} y={y(b.density)} width={Math.max(0, x(b.hi) - x(b.lo) - 1)} height={Math.max(0, ih - y(b.density))} fill={params.band && (b.density < hist.band[0] || b.density > hist.band[1]) ? '#d6573c' : '#2a7d74'} fillOpacity={0.85}
            onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>PIT {fmt(b.lo, 2)} ~ {fmt(b.hi, 2)}</b><br />{b.count}개 · 밀도 {fmt(b.density, 2)}</>) }} onPointerLeave={hide} />)}
          <line x1={0} x2={iw} y1={y(1)} y2={y(1)} stroke="#374151" strokeDasharray="5 4" data-testid="uniform-line" />
        </g>
      </svg>
      {!compact && (<>
        <Readout items={[{ label: '진단', value: diagnosis }, { label: 'KS 거리', value: fmt(ks, 3) }, { label: '평균 PIT', value: fmt(mean, 3) }, { label: '예측', value: values.length }]} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

function PitControls({ params, setParams }: ControlsProps<PitParams>) {
  return (
    <ControlGroup title="PIT 히스토그램">
      <Slider label="구간 수" value={params.bins} min={5} max={40} onChange={(bins) => setParams({ bins })} testId="ctl-pit-bins" />
      <Segmented label="예측 분포 가정" value={params.family} onChange={(family) => setParams({ family })} testId="ctl-pit-family" options={[{ value: 'normal', label: '정규분포' }, { value: 't5', label: '꼬리 두꺼운 t(5)' }]} />
      <Toggle label="95% 허용 띠 (균일일 때)" checked={params.band} onChange={(band) => setParams({ band })} />
      <Hint>PIT는 관측값이 예측 분포의 누적분포함수에서 차지한 위치입니다. 예측 분포가 맞다면 PIT는 0~1에서 균일해 히스토그램이 평평합니다. 양 끝이 높은 U자는 관측이 예측 구간 밖으로 자주 나가는 과신, 가운데가 높은 ∩자는 예측이 너무 넓은 과소신뢰, 한쪽으로 기운 모양은 체계적 편향입니다. 띠는 구간별 개수의 이항 오차 범위이며 균일해도 몇 구간은 벗어날 수 있습니다.</Hint>
    </ControlGroup>
  )
}

export const pitModule: VizModule<PitParams> = {
  roles: [
    { key: 'obs', label: '관측값', type: 'number', required: true, prefer: '관측|obs|actual' },
    { key: 'mu', label: '예측 평균', type: 'number', required: true, prefer: '평균|mean|mu' },
    { key: 'sd', label: '예측 표준편차', type: 'number', required: true, prefer: '표준편차|sd|sigma' },
  ],
  datasets: ['forecast-overconfident', 'forecast-calibrated'],
  defaultParams: { bins: 10, family: 'normal', band: true },
  Chart: PitChart,
  Controls: PitControls,
  hint: '‘과신’ 데이터셋은 U자, ‘잘 맞음’은 평평합니다 · 예측 분포 가정과 구간 수를 바꿔 보세요 · 막대에 포인터를 올리면 개수',
}
