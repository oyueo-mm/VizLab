import * as d3 from 'd3'
import { useMemo } from 'react'
import { ChartMessage } from '../../components/chart/primitives'
import { ControlGroup, Hint, NumberField, Segmented, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, toTime, type DataTable } from '../../data/table'
import { colorAt } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { directlyFollows, faultTree, mmcStats, runQueue, toleranceStack, weibullCdf, weibullFit, type Gate, type TolItem } from '../../stats/applied'
import { dagLayout } from '../../stats/graph2'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, RoleSpec, VizModule } from '../types'
import { Panels, Stage, XYPlot, useStage, type Layer } from './kit'
import { LayeredGraph, type LEdge } from './graphCharts2'

/** Industrial-engineering charts: Weibull probability plot, tolerance stack-up, queue simulation, process map and fault tree (all example data are synthetic). */

const col = (table: DataTable, mapping: Mapping, key: string) => columnIndex(table, roleColumn(mapping, key))

// ─── Weibull probability plot ───────────────────────────────────────────────────────

export interface WeibullParams { method: 'rry' | 'rrx' | 'mle'; mission: number; line: boolean }

const weibullRoles: RoleSpec[] = [
  { key: 'time', label: '수명(시간·횟수)', type: 'number', required: true, prefer: '수명|시간|time|life' },
  { key: 'status', label: '상태 (고장/중단, 선택)', type: 'category', auto: true, prefer: '상태|status|censor|중도' },
]
const isFailure = (s: string) => /고장|fail|^f$|^1$|^y/i.test(s.trim())

function WeibullChart({ table, mapping, params, width, height, compact }: ChartProps<WeibullParams>) {
  const fit = useMemo(() => {
    const ti = col(table, mapping, 'time'), si = col(table, mapping, 'status')
    if (ti < 0) return null
    const t: number[] = [], f: boolean[] = []
    for (const r of table.rows) { const v = toNumber(r[ti]); if (v != null && v > 0) { t.push(v); f.push(si < 0 ? true : isFailure(toLabel(r[si]))) } }
    return { t, f, fit: weibullFit(t, f, params.method) }
  }, [table, mapping, params.method])
  if (!fit || !fit.fit) return <ChartMessage>수명 열(양수)을 고르세요. 고장이 2건 이상 필요합니다.</ChartMessage>
  const { fit: w, t, f } = fit
  const nF = f.filter(Boolean).length
  const tmin = Math.min(...t) * 0.6, tmax = Math.max(...t) * 1.6
  const yOf = (time: number) => w.beta * Math.log(time / w.eta)
  const cdfTicks = [0.01, 0.05, 0.1, 0.2, 0.368, 0.632, 0.9, 0.99]
  const yDom: [number, number] = [Math.min(-4.6, ...w.points.map((p) => p.y)) - 0.3, Math.max(1.6, ...w.points.map((p) => p.y)) + 0.3]
  const layers: Layer[] = [
    ...(params.line ? [{ kind: 'line', x: [tmin, tmax], y: [yOf(tmin), yOf(tmax)], color: '#e07a3f', width: 2.4, label: `와이블 직선 (β = ${fmt(w.beta, 3)})` } as Layer] : []),
    { kind: 'hline', v: 0, color: '#9aa1a9', dash: '5 4', label: '63.2% (t = η)' },
    { kind: 'vline', v: w.b10, color: '#4c6fb5', dash: '4 4', label: `B10 수명 ${fmt(w.b10, 4)}` },
    { kind: 'points', color: '#2a8c82', r: 5, stroke: '#fff', label: `고장 ${nF}건`, pts: w.points.map((p) => ({ x: p.t, y: p.y, key: String(p.t), tip: <><b>{fmt(p.t, 4)}</b><br />조정 순위 {fmt(p.rank, 3)}<br />누적 고장률 F = {pct(p.F, 1)}</> })) },
  ]
  const plot = (h: number) => (
    <XYPlot hover={false} layers={layers} width={width} height={h} compact={compact} xScale="log" xLabel="수명 t (로그 눈금)" yLabel="누적 고장 확률 F(t)" title={`와이블 확률지: β = ${fmt(w.beta, 3)}, η = ${fmt(w.eta, 4)}`}
      yDomain={yDom} yFormat={(v) => { const F = 1 - Math.exp(-Math.exp(v)); const near = cdfTicks.find((c) => Math.abs(Math.log(-Math.log(1 - c)) - v) < 0.12); return near ? pct(near, near < 0.1 ? 0 : 1) : pct(F, F < 0.1 ? 1 : 0) }}
      readout={[{ label: '형상 β', value: fmt(w.beta, 3) }, { label: '척도 η', value: fmt(w.eta, 4) }, { label: w.method === 'mle' ? '추정 방식' : 'R²', value: w.method === 'mle' ? '최대가능도' : fmt(w.r2, 4) }, { label: 'B10 수명', value: fmt(w.b10, 4) }, { label: '평균 수명', value: fmt(w.mean, 4) }, { label: '중단(중도절단)', value: String(f.length - nF) }]}
      note={w.beta < 0.95 ? 'β < 1: 초기 고장(영아 사망형)' : w.beta > 1.05 ? 'β > 1: 마모 고장(시간이 갈수록 고장이 늘어남)' : 'β ≈ 1: 우발 고장(지수 분포)'} />
  )
  if (compact) return plot(height)
  const grid = Array.from({ length: 80 }, (_, i) => tmin + ((tmax - tmin) * i) / 79)
  const rel = (h: number) => (
    <XYPlot hover width={width} height={h} title="신뢰도 R(t) = exp(−(t/η)^β)" xLabel="수명 t" yLabel="신뢰도" yDomain={[0, 1]} yFormat={(v) => pct(v, 0)}
      layers={[{ kind: 'line', x: grid, y: grid.map((x) => 1 - weibullCdf(x, w.beta, w.eta)), color: '#2a8c82', width: 2.4, label: 'R(t)' }, { kind: 'vline', v: params.mission, color: '#e11d48', dash: '5 4', label: `임무 시간 → R = ${pct(1 - weibullCdf(params.mission, w.beta, w.eta), 1)}` }]} />
  )
  return <Panels width={width} height={height} parts={[3, 1.3]}>{[plot, rel]}</Panels>
}

function WeibullControls({ params, setParams }: ControlsProps<WeibullParams>) {
  return (
    <ControlGroup title="와이블 신뢰성">
      <Segmented label="추정 방법" value={params.method} onChange={(method) => setParams({ method })} testId="ctl-method" options={[{ value: 'rry', label: '순위회귀 (Y on X)' }, { value: 'rrx', label: '순위회귀 (X on Y)' }, { value: 'mle', label: '최대가능도' }]} />
      <NumberField label="임무 시간 (신뢰도를 읽을 시점)" value={params.mission} min={1} step={50} onChange={(mission) => setParams({ mission })} testId="ctl-mission" />
      <Toggle label="적합 직선 표시" checked={params.line} onChange={(line) => setParams({ line })} />
      <Hint>와이블 분포 F(t) = 1 − exp(−(t/η)^β)는 ln(−ln(1−F)) = β ln t − β ln η로 직선이 됩니다. 관측 수명을 순서대로 놓고 중단된 개체는 존슨 조정 순위로 반영한 뒤 베르나르 중앙 순위 F = (순위 − 0.3)/(n + 0.4)로 누적 고장 확률을 정해 점을 찍고, 직선의 기울기가 형상 β, t = η일 때 F = 63.2%입니다. 최대가능도는 중도절단을 그대로 반영해 β를 수치로 풉니다. 고장이 매우 적으면 추정이 불안정합니다.</Hint>
    </ControlGroup>
  )
}

export const weibullModule: VizModule<WeibullParams> = {
  roles: weibullRoles, datasets: ['life-wearout', 'life-early'], defaultParams: { method: 'rry', mission: 600, line: true },
  Chart: WeibullChart, Controls: WeibullControls, hint: '점이 직선 위에 놓이면 와이블 분포가 잘 맞습니다 · 추정 방법을 바꿔 β가 얼마나 달라지는지 보세요 · 상태 열의 중단 값은 중도절단으로 처리합니다',
}

// ─── tolerance stack-up ─────────────────────────────────────────────────────────────

export interface StackParams { n: number; cp: number; spec: boolean; lsl: number; usl: number; seed: number }

const stackRoles: RoleSpec[] = [
  { key: 'part', label: '부품', type: 'category', required: true },
  { key: 'nominal', label: '공칭 치수', type: 'number', required: true, prefer: '공칭|nominal' },
  { key: 'plus', label: '상한 공차 (+)', type: 'number', required: true, prefer: '상한|plus|\\+' },
  { key: 'minus', label: '하한 공차 (−)', type: 'number', required: true, prefer: '하한|minus' },
  { key: 'dist', label: '분포 (normal / uniform / triangular)', type: 'category', auto: true, prefer: '분포|dist' },
  { key: 'dir', label: '방향 (+1 / −1)', type: 'number', auto: true, prefer: '방향|dir|sign' },
]

function itemsOf(table: DataTable, mapping: Mapping): TolItem[] {
  const [pi, ni, ui, li, di, ri] = ['part', 'nominal', 'plus', 'minus', 'dist', 'dir'].map((k) => col(table, mapping, k))
  const out: TolItem[] = []
  for (const r of table.rows) {
    const nominal = toNumber(r[ni]), plus = toNumber(r[ui]), minus = toNumber(r[li])
    if (nominal == null || plus == null || minus == null || plus < 0 || minus < 0) continue
    const dRaw = di >= 0 ? toLabel(r[di]).toLowerCase() : 'normal', dr = ri >= 0 ? toNumber(r[ri]) : 1
    out.push({ name: toLabel(r[pi]), nominal, plus, minus, dist: dRaw.startsWith('u') ? 'uniform' : dRaw.startsWith('t') ? 'triangular' : 'normal', dir: dr != null && dr < 0 ? -1 : 1 })
  }
  return out
}

function StackChart({ table, mapping, params, width, height, compact }: ChartProps<StackParams>) {
  const items = useMemo(() => itemsOf(table, mapping), [table, mapping])
  const r = useMemo(() => (items.length >= 2 ? toleranceStack(items, { n: params.n, seed: params.seed, cp: params.cp, lsl: params.spec ? params.lsl : null, usl: params.spec ? params.usl : null }) : null), [items, params.n, params.seed, params.cp, params.spec, params.lsl, params.usl])
  if (!r) return <ChartMessage>부품을 2개 이상 입력하고 공칭·상한·하한 공차 열을 고르세요.</ChartMessage>
  const centres = r.hist.map((_, i) => r.lo + (i + 0.5) * r.width)
  const layers: Layer[] = [
    { kind: 'bars', x: centres, y: r.hist.map((c) => c / params.n / r.width), w: r.width * 0.96, color: '#9ab8b4', label: `몬테카를로 ${params.n.toLocaleString('ko-KR')}회` },
    { kind: 'vline', v: r.worstLo, color: '#d64550', dash: '6 4', label: `최악 경우 ${fmt(r.worstLo, 3)} ~ ${fmt(r.worstHi, 3)}` }, { kind: 'vline', v: r.worstHi, color: '#d64550', dash: '6 4' },
    { kind: 'vline', v: r.rssLo, color: '#4c6fb5', dash: '2 3', label: `RSS ±3σ ${fmt(r.rssLo, 3)} ~ ${fmt(r.rssHi, 3)}` }, { kind: 'vline', v: r.rssHi, color: '#4c6fb5', dash: '2 3' },
    ...(params.spec ? [{ kind: 'vline', v: params.lsl, color: '#111827', width: 2, label: '규격 하한·상한' } as Layer, { kind: 'vline', v: params.usl, color: '#111827', width: 2 } as Layer] : []),
  ]
  const plot = (h: number) => (
    <XYPlot hover={false} layers={layers} width={width} height={h} compact={compact} xLabel="조립 틈새(누적 치수)" xDomain={[Math.min(r.lo, r.worstLo, params.spec ? params.lsl : Infinity) - r.width * 3, Math.max(r.hi, r.worstHi, params.spec ? params.usl : -Infinity) + r.width * 3]} title={`공차 누적: 공칭 ${fmt(r.nominal, 4)}`} yFormat={(v) => fmt(v, 2)}
      readout={[{ label: '공칭 틈새', value: fmt(r.nominal, 4) }, { label: '시뮬레이션 σ', value: fmt(r.sd, 4) }, { label: 'RSS σ', value: fmt(r.rssSd, 4) }, ...(params.spec ? [{ label: '규격 밖 비율(시뮬레이션)', value: pct(r.outside, 2) }, { label: '규격 밖(정규 근사)', value: pct(r.analyticOutside, 2) }, { label: 'Cpk', value: fmt(r.cpk, 3) }] : [])]} />
  )
  if (compact) return plot(height)
  const share = (h: number) => <ShareBars width={width} height={h} items={items} share={r.share} />
  return <Panels width={width} height={height} parts={[3, 1.2]}>{[plot, share]}</Panels>
}

function ShareBars({ width, height, items, share }: { width: number; height: number; items: TolItem[]; share: number[] }) {
  const stage = useStage()
  const left = 96, iw = width - left - 60, rh = Math.min(24, (height - 24) / items.length)
  return (
    <Stage stage={stage} width={width} height={height} label="부품별 분산 기여도">
      <text x={left} y={14} fontSize={11.5} fill="#6b7280">부품별 틈새 분산 기여도</text>
      <g transform="translate(0,22)">{items.map((it, i) => (
        <g key={i} transform={`translate(0,${i * (rh + 3)})`} onPointerEnter={(e) => stage.at(e, <><b>{it.name}</b><br />분산 기여 {pct(share[i], 1)}<br />공차 +{fmt(it.plus, 3)} / −{fmt(it.minus, 3)} · {it.dist}</>)}>
          <text x={left - 8} y={rh / 2} dy="0.34em" textAnchor="end" fontSize={11.5} fill="#374151">{it.name.length > 9 ? `${it.name.slice(0, 8)}…` : it.name}</text>
          <rect data-testid="share-bar" x={left} width={Math.max(1, share[i] * iw)} height={rh} fill={colorAt(i)} fillOpacity={0.9} rx={3} />
          <text x={left + share[i] * iw + 6} y={rh / 2} dy="0.34em" fontSize={11} fill="#374151">{pct(share[i], 0)}</text>
        </g>
      ))}</g>
    </Stage>
  )
}

function StackControls({ params, setParams }: ControlsProps<StackParams>) {
  return (
    <ControlGroup title="공차 누적 해석">
      <Slider label="몬테카를로 횟수" value={params.n} min={2000} max={60000} step={2000} onChange={(n) => setParams({ n })} testId="ctl-n" />
      <Slider label="공정능력 Cp (정규 부품 σ = 공차/3Cp)" value={params.cp} min={0.67} max={2} step={0.01} onChange={(cp) => setParams({ cp })} testId="ctl-cp" />
      <Toggle label="규격 한계 사용" checked={params.spec} onChange={(spec) => setParams({ spec })} />
      <NumberField label="규격 하한" value={params.lsl} step={0.05} onChange={(lsl) => setParams({ lsl })} testId="ctl-lsl" />
      <NumberField label="규격 상한" value={params.usl} step={0.05} onChange={(usl) => setParams({ usl })} testId="ctl-usl" />
      <Slider label="난수 시드" value={params.seed} min={1} max={50} onChange={(seed) => setParams({ seed })} />
      <Hint>조립 틈새 G = Σ dᵢ·xᵢ (dᵢ = ±1). 최악 경우는 모든 부품이 한꺼번에 공차 끝에 있다고 보고 공차 절반폭을 더하며(Σ tᵢ), RSS(제곱합 제곱근)는 부품이 독립이라고 보고 표준편차 σ_G = √Σ σᵢ²로 ±3σ를 잡습니다. σᵢ는 정규 tᵢ/(3Cp), 균등 tᵢ/√3, 삼각 tᵢ/√6입니다. 몬테카를로는 부품마다 분포에서 뽑아 틈새 분포와 규격 밖 비율을 직접 셉니다. 비대칭 공차는 중심을 (+ − −)/2만큼 옮깁니다.</Hint>
    </ControlGroup>
  )
}

export const stackModule: VizModule<StackParams> = {
  roles: stackRoles, datasets: ['stack-gearbox'], defaultParams: { n: 20000, cp: 1, spec: true, lsl: 0.1, usl: 0.9, seed: 1 },
  Chart: StackChart, Controls: StackControls, hint: '붉은 점선(최악 경우)은 넓고 파란 점선(RSS)은 좁습니다 · 공차를 줄이거나 Cp를 바꿔 규격 밖 비율을 보세요 · 표에서 부품 공차를 직접 고칠 수 있습니다',
}

// ─── queue simulation ───────────────────────────────────────────────────────────────

export interface QueueParams { servers: number; lanes: boolean }

const queueRoles: RoleSpec[] = [
  { key: 'arrive', label: '도착 시각', type: 'number', required: true, prefer: '도착|arriv' },
  { key: 'service', label: '처리 시간', type: 'number', required: true, prefer: '처리|서비스|service' },
]

function QueueChart({ table, mapping, params, width, height, compact }: ChartProps<QueueParams>) {
  const model = useMemo(() => {
    const ai = col(table, mapping, 'arrive'), si = col(table, mapping, 'service')
    if (ai < 0 || si < 0) return null
    const rows = table.rows.map((r) => [toNumber(r[ai]), toNumber(r[si])] as const).filter((p): p is readonly [number, number] => p[0] != null && p[1] != null && p[1] >= 0).sort((a, b) => a[0] - b[0])
    if (rows.length < 5) return null
    const arrive = rows.map((p) => p[0]), service = rows.map((p) => p[1])
    const run = runQueue(arrive, service, params.servers)
    const gaps = arrive.slice(1).map((a, i) => a - arrive[i]), lam = 1 / (gaps.reduce((a, b) => a + b, 0) / gaps.length), mu = 1 / (service.reduce((a, b) => a + b, 0) / service.length)
    return { run, lam, mu, analytic: mmcStats(lam, mu, params.servers) }
  }, [table, mapping, params.servers])
  if (!model) return <ChartMessage>도착 시각과 처리 시간 열을 고르세요(5건 이상).</ChartMessage>
  const { run, analytic: a } = model
  const stepX: number[] = [], qY: number[] = [], sY: number[] = []
  for (const s of run.steps) { stepX.push(s.t); qY.push(s.inQueue); sY.push(s.inService) }
  const top = (h: number) => (
    <XYPlot hover={false} width={width} height={h} compact={compact} title={`창구 ${params.servers}개 대기행렬`} xLabel="시각" yLabel="사람 수"
      layers={[{ kind: 'line', x: stepX, y: qY, color: '#e07a3f', width: 2, step: true, label: '대기 중' }, { kind: 'line', x: stepX, y: sY, color: '#2a8c82', width: 1.6, step: true, label: '처리 중' }]}
      readout={[{ label: '관측 평균 대기', value: fmt(run.meanWait, 3) }, { label: '대기한 고객 비율', value: pct(run.pWait, 1) }, { label: '창구 이용률', value: pct(run.utilisation, 1) }, { label: 'M/M/c 이론 평균 대기', value: a.stable ? fmt(a.wq, 3) : '불안정(ρ ≥ 1)' }, { label: '이론 대기 확률(얼랭 C)', value: a.stable ? pct(a.pWait, 1) : '100%' }]} />
  )
  if (compact) return top(height)
  const lanes = (h: number) => <QueueLanes width={width} height={h} run={run} c={params.servers} />
  return params.lanes ? <Panels width={width} height={height} parts={[2, 1.4]}>{[top, lanes]}</Panels> : top(height)
}

function QueueLanes({ width, height, run, c }: { width: number; height: number; run: ReturnType<typeof runQueue>; c: number }) {
  const stage = useStage()
  const left = 56, x = d3.scaleLinear().domain([Math.min(...run.arrive), Math.max(...run.end)]).range([left, width - 18])
  const rh = Math.max(8, Math.min(26, (height - 34) / c)), wmax = Math.max(1e-9, ...run.wait)
  const color = d3.scaleSequential(d3.interpolateOranges).domain([0, wmax])
  return (
    <Stage stage={stage} width={width} height={height} label="창구별 서비스 시간표">
      {Array.from({ length: c }, (_, k) => <text key={k} x={left - 8} y={8 + k * (rh + 3) + rh / 2} dy="0.34em" textAnchor="end" fontSize={11} fill="#374151">창구 {k + 1}</text>)}
      {run.start.map((st, i) => (
        <rect key={i} data-testid="service-block" x={x(st)} y={8 + run.server[i] * (rh + 3)} width={Math.max(1, x(run.end[i]) - x(st))} height={rh} fill={color(run.wait[i])} stroke="#fff" strokeWidth={0.5}
          onPointerEnter={(e) => stage.at(e, <><b>고객 {i + 1}</b><br />도착 {fmt(run.arrive[i], 3)} · 시작 {fmt(st, 3)}<br />대기 {fmt(run.wait[i], 3)} · 처리 {fmt(run.end[i] - st, 3)}</>)} />
      ))}
      <g transform={`translate(0,${8 + c * (rh + 3) + 4})`}>{x.ticks(8).map((t) => <g key={t} transform={`translate(${x(t)},0)`}><line y2={4} stroke="#9aa1a9" /><text y={16} textAnchor="middle" fontSize={10.5} fill="#6b7280">{t}</text></g>)}</g>
    </Stage>
  )
}

function QueueControls({ params, setParams }: ControlsProps<QueueParams>) {
  return (
    <ControlGroup title="대기행렬 (FCFS)">
      <Slider label="창구(서버) 수 c" value={params.servers} min={1} max={8} onChange={(servers) => setParams({ servers })} testId="ctl-servers" />
      <Toggle label="창구별 서비스 시간표" checked={params.lanes} onChange={(lanes) => setParams({ lanes })} />
      <Hint>표의 도착 시각과 처리 시간을 그대로 먼저 온 고객부터 비어 있는 창구에 배정해 대기 시간을 계산합니다(실제 기록 위의 G/G/c 시뮬레이션). 비교용으로 평균 도착률 λ와 서비스율 μ를 추정해 M/M/c 이론값 — 이용률 ρ = λ/(cμ), 얼랭 C 대기 확률 P_w, 평균 대기 W_q = P_w/(cμ − λ) — 을 함께 보입니다. 이론은 도착이 포아송, 서비스가 지수분포이고 정상 상태라고 가정하므로 점심시간처럼 몰리는 구간이 있는 기록과는 차이가 납니다. ρ ≥ 1이면 대기열이 끝없이 늘어납니다.</Hint>
    </ControlGroup>
  )
}

export const queueModule: VizModule<QueueParams> = {
  roles: queueRoles, datasets: ['queue-orders'], defaultParams: { servers: 3, lanes: true },
  Chart: QueueChart, Controls: QueueControls, hint: '창구 수를 1→2→3으로 바꾸면 대기열이 어떻게 줄어드는지 보입니다 · 주황이 진할수록 오래 기다린 고객입니다 · 이론값과 관측값의 차이를 비교하세요',
}

// ─── process map ────────────────────────────────────────────────────────────────────

export interface ProcessParams { minShare: number; metric: 'count' | 'time'; orient: 'LR' | 'TB' }

const processRoles: RoleSpec[] = [
  { key: 'case', label: '사례(건) ID', type: 'category', required: true, prefer: '건|case|id|주문' },
  { key: 'activity', label: '활동', type: 'category', required: true, prefer: '활동|activity|단계' },
  { key: 'time', label: '시각', type: 'number', accept: ['date'], required: true, prefer: '시각|시간|time|date' },
]

function ProcessChart({ table, mapping, params, width, height, compact }: ChartProps<ProcessParams>) {
  const log = useMemo(() => {
    const [ci, ai, ti] = ['case', 'activity', 'time'].map((k) => col(table, mapping, k))
    if (ci < 0 || ai < 0 || ti < 0) return null
    const ev = table.rows.map((r) => ({ caseId: toLabel(r[ci]), activity: toLabel(r[ai]), time: toNumber(r[ti]) ?? toTime(r[ti]) })).filter((e): e is { caseId: string; activity: string; time: number } => !!e.caseId && !!e.activity && e.time != null)
    return ev.length >= 4 ? directlyFollows(ev) : null
  }, [table, mapping])
  const model = useMemo(() => {
    if (!log) return null
    const names = log.activities.map((a) => a.name), idx = new Map(names.map((n, i) => [n, i]))
    const keep = log.edges.filter((e) => e.count >= (params.minShare / 100) * log.cases)
    const layout = names.length >= 2 && keep.length ? dagLayout(names.length, keep.map((e) => [idx.get(e.a)!, idx.get(e.b)!] as [number, number]), 8) : null
    return { names, idx, keep, layout }
  }, [log, params.minShare])
  if (!log || !model || !model.layout || model.names.length > 60) return <ChartMessage>사례·활동·시각 열을 고르세요. 이벤트가 4건 이상이고 활동이 2~60개여야 합니다.</ChartMessage>
  const { names, idx, keep, layout } = model
  const cmax = Math.max(...keep.map((e) => e.count)), amax = Math.max(...log.activities.map((a) => a.count))
  const tmax = Math.max(1e-9, ...keep.map((e) => e.mean))
  const edges: LEdge[] = keep.map((e) => ({ a: idx.get(e.a)!, b: idx.get(e.b)!, color: params.metric === 'time' ? d3.interpolateOranges(0.35 + (0.6 * e.mean) / tmax) : '#6b86a8', width: 1 + (5 * e.count) / cmax, label: params.metric === 'count' ? String(e.count) : `${fmt(e.mean, 3)}`,
    tip: <><b>{e.a} → {e.b}</b><br />{e.count}번 · 평균 대기 {fmt(e.mean, 3)}</> }))
  const act = new Map(log.activities.map((a) => [a.name, a.count]))
  const graph = (h: number) => (
    <LayeredGraph width={width} height={h} compact={compact} names={names} layout={layout} orient={params.orient} edges={edges} label={`프로세스 맵: 활동 ${names.length}개, 연결 ${keep.length}개`}
      fill={(i) => d3.interpolateBlues(0.08 + (0.4 * (act.get(names[i]) ?? 0)) / amax)} stroke={(i) => (log.starts.has(names[i]) ? '#2a8c82' : log.ends.has(names[i]) ? '#e07a3f' : '#9aa1a9')} strokeW={(i) => (log.starts.has(names[i]) || log.ends.has(names[i]) ? 2.2 : 1.2)}
      nodeTip={(i) => <><b>{names[i]}</b><br />발생 {act.get(names[i])}회{log.starts.has(names[i]) ? <><br />시작 활동 {log.starts.get(names[i])}건</> : null}{log.ends.has(names[i]) ? <><br />마지막 활동 {log.ends.get(names[i])}건</> : null}</>}
      readout={[{ label: '사례 수', value: String(log.cases) }, { label: '경로 변형', value: String(log.variants.length) }, { label: '가장 흔한 경로 비율', value: pct(log.variants[0].count / log.cases, 0) }]} note={`선 굵기 = 횟수 · 숫자 = ${params.metric === 'count' ? '횟수' : '평균 대기'} · 초록 테두리 시작, 주황 테두리 끝`} />
  )
  if (compact) return graph(height)
  const variants = (h: number) => (
    <div style={{ height: h, overflow: 'auto', padding: '4px 12px', fontSize: 12.5, color: '#374151' }} data-testid="variants">
      <b>상위 경로 변형</b>
      <ol style={{ margin: '4px 0 0', paddingLeft: 18 }}>{log.variants.slice(0, 6).map((v) => <li key={v.path}>{v.path} <span style={{ color: '#6b7280' }}>— {v.count}건 ({pct(v.count / log.cases, 0)})</span></li>)}</ol>
    </div>
  )
  return <Panels width={width} height={height} parts={[3.2, 1]}>{[graph, variants]}</Panels>
}

function ProcessControls({ params, setParams }: ControlsProps<ProcessParams>) {
  return (
    <ControlGroup title="프로세스 마이닝">
      <Slider label="드문 연결 숨기기 (전체 사례 대비 %)" value={params.minShare} min={0} max={50} onChange={(minShare) => setParams({ minShare })} testId="ctl-min-share" />
      <Segmented label="연결 숫자" value={params.metric} onChange={(metric) => setParams({ metric })} testId="ctl-metric" options={[{ value: 'count', label: '횟수' }, { value: 'time', label: '평균 대기' }]} />
      <Segmented label="방향" value={params.orient} onChange={(orient) => setParams({ orient })} options={[{ value: 'LR', label: '가로' }, { value: 'TB', label: '세로' }]} />
      <Hint>이벤트 로그를 사례별로 시각순으로 정렬한 뒤 바로 이어서 일어난 활동 쌍(a → b, directly-follows)을 세어 지도를 만듭니다. 연결의 평균 대기는 두 이벤트 사이 시간의 평균이며 병목 후보를 보여 줍니다. 되돌아가는 연결(재작업·반복)은 층별 배치에서 뒤집어 그려집니다. 드문 연결을 숨기면 주 경로가 보이지만 정보가 사라지므로 변형 목록과 함께 읽으세요.</Hint>
    </ControlGroup>
  )
}

export const processModule: VizModule<ProcessParams> = {
  roles: processRoles, datasets: ['log-orders'], defaultParams: { minShare: 3, metric: 'count', orient: 'LR' },
  Chart: ProcessChart, Controls: ProcessControls, hint: '굵은 선이 주된 처리 경로입니다 · 숫자를 평균 대기로 바꾸면 병목(주황)이 보입니다 · 드문 연결 숨기기를 올려 보세요',
}

// ─── fault tree ─────────────────────────────────────────────────────────────────────

export interface TreeParams { cut: number; showProb: boolean }

const treeRoles: RoleSpec[] = [
  { key: 'parent', label: '상위 사건(게이트)', type: 'category', required: true, prefer: '상위|parent' },
  { key: 'child', label: '하위 사건', type: 'category', required: true, prefer: '하위|child' },
  { key: 'gate', label: '게이트 유형 (AND / OR / k/n)', type: 'category', auto: true, prefer: '게이트|gate' },
  { key: 'p', label: '고장 확률 (기본 사건)', type: 'number', auto: true, prefer: '확률|prob' },
]

function treeOf(table: DataTable, mapping: Mapping) {
  const [pi, ci, gi, qi] = ['parent', 'child', 'gate', 'p'].map((k) => col(table, mapping, k))
  if (pi < 0 || ci < 0) return null
  const gates = new Map<string, Gate>(), p: Record<string, number> = {}
  for (const r of table.rows) {
    const a = toLabel(r[pi]), b = toLabel(r[ci])
    if (!a || !b || a === b) continue
    let g = gates.get(a)
    if (!g) {
      const raw = gi >= 0 ? toLabel(r[gi]).trim().toUpperCase() : 'OR', m = /^(\d+)\s*\/\s*\d+$/.exec(raw)
      g = { name: a, kind: m ? 'KOFN' : raw === 'AND' ? 'AND' : 'OR', inputs: [], k: m ? Number(m[1]) : undefined }
      gates.set(a, g)
    }
    g.inputs.push(b)
    const v = qi >= 0 ? toNumber(r[qi]) : null
    if (v != null) p[b] = Math.min(1, Math.max(0, v))
  }
  const list = [...gates.values()], children = new Set(list.flatMap((g) => g.inputs))
  const tops = list.filter((g) => !children.has(g.name))
  return tops.length === 1 ? { gates: list, p, top: tops[0].name } : null
}

function TreeChart({ table, mapping, params, width, height, compact }: ChartProps<TreeParams>) {
  const m = useMemo(() => treeOf(table, mapping), [table, mapping])
  const res = useMemo(() => (m ? faultTree(m.gates, m.p, m.top) : null), [m])
  if (!m || !res) return <ChartMessage>상위·하위 사건 열을 고르세요. 최상위 사건이 하나여야 하고 기본 사건은 18개 이하여야 합니다.</ChartMessage>
  const gateMap = new Map(m.gates.map((g) => [g.name, g]))
  const names = [...new Set([...m.gates.flatMap((g) => [g.name, ...g.inputs])])]
  const idx = new Map(names.map((n, i) => [n, i]))
  const edges0: [number, number][] = m.gates.flatMap((g) => g.inputs.map((c) => [idx.get(g.name)!, idx.get(c)!] as [number, number]))
  const layout = dagLayout(names.length, edges0, 8)
  const cut = res.cuts[Math.min(res.cuts.length - 1, params.cut)]
  const inCut = new Set(cut?.events ?? [])
  const bir = new Map(res.birnbaum.map((b) => [b.name, b]))
  const label = (n: string) => { const g = gateMap.get(n); const tag = g ? (g.kind === 'KOFN' ? `${g.k}/${g.inputs.length}` : g.kind) : ''; return g ? `[${tag}] ${n}` : params.showProb && m.p[n] != null ? `${n} (${m.p[n]})` : n }
  const edges: LEdge[] = edges0.map(([a, b]) => ({ a, b, color: inCut.has(names[b]) ? '#e07a3f' : '#9aa1a9', width: inCut.has(names[b]) ? 2.6 : 1.4 }))
  return (
    <LayeredGraph width={width} height={height} compact={compact} names={names.map(label)} layout={layout} orient="TB" edges={edges} label={`고장 수목: 최상위 확률 ${fmt(res.topP, 4)}`}
      fill={(i) => (gateMap.has(names[i]) ? '#eef2f6' : inCut.has(names[i]) ? '#fbe3d3' : '#fff')} stroke={(i) => (names[i] === m.top ? '#d64550' : inCut.has(names[i]) ? '#e07a3f' : '#9aa1a9')} strokeW={(i) => (names[i] === m.top ? 2.4 : 1.3)}
      nodeTip={(i) => { const b = bir.get(names[i]); return <><b>{names[i]}</b>{m.p[names[i]] != null ? <><br />고장 확률 {m.p[names[i]]}</> : null}{b ? <><br />버른바움 중요도 {fmt(b.birnbaum, 4)}<br />위험 기여도 {pct(b.criticality, 1)}</> : null}</> }}
      readout={[{ label: '최상위 사건 확률', value: fmt(res.topP, 5) }, { label: '최소 절단 집합', value: String(res.cuts.length) }, ...(cut ? [{ label: `선택한 절단 집합 #${Math.min(res.cuts.length - 1, params.cut) + 1}`, value: `${cut.events.join(' + ')} (${fmt(cut.p, 4)})` }] : [])]} note="주황: 선택한 최소 절단 집합 · 붉은 테두리: 최상위 사건" />
  )
}

function TreeControls({ params, setParams, table, mapping }: ControlsProps<TreeParams>) {
  const m = useMemo(() => treeOf(table, mapping), [table, mapping])
  const res = useMemo(() => (m ? faultTree(m.gates, m.p, m.top) : null), [m])
  return (
    <ControlGroup title="고장 수목 분석">
      <Slider label={`최소 절단 집합 선택 (확률 높은 순, 전체 ${res?.cuts.length ?? 0}개)`} value={Math.min(params.cut, Math.max(0, (res?.cuts.length ?? 1) - 1))} min={0} max={Math.max(1, (res?.cuts.length ?? 1) - 1)} onChange={(cut) => setParams({ cut })} testId="ctl-cut" />
      <Toggle label="기본 사건 확률 표시" checked={params.showProb} onChange={(showProb) => setParams({ showProb })} />
      <Hint>고장 수목은 최상위 사건이 일어나는 원인을 AND(모두 고장), OR(하나라도 고장), k/n(n개 중 k개 이상 고장) 게이트로 아래로 풀어 쓴 그림입니다. 기본 사건이 서로 독립일 때 모든 기본 사건 상태(2ⁿ가지)에서 최상위 사건이 일어나는지 확인해 정확한 확률을 구합니다. 최소 절단 집합은 더 줄이면 최상위 사건이 일어나지 않는 가장 작은 고장 조합이고, 버른바움 중요도 ∂P/∂pᵢ는 한 사건의 확률이 최상위 확률에 주는 민감도입니다. 상위 확률이 가장 큰 절단 집합부터 대책을 세우는 것이 효과적입니다.</Hint>
    </ControlGroup>
  )
}

export const treeModule: VizModule<TreeParams> = {
  roles: treeRoles, datasets: ['tree-pump'], defaultParams: { cut: 0, showProb: true },
  Chart: TreeChart, Controls: TreeControls, hint: '슬라이더로 최소 절단 집합을 바꿔 가며 어느 고장 조합이 위험한지 보세요 · 표에서 확률을 고치면 최상위 확률이 바로 바뀝니다 · 노드에 마우스를 올리면 중요도가 보입니다',
}

