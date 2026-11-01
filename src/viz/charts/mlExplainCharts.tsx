import * as d3 from 'd3'
import { useMemo } from 'react'
import { ChartMessage } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { fmt } from '../../lib/format'
import { ale, fitForest, iceCurves, pdpOf, permutationImportance, r2Score, shapExact, shuffled, type Regressor } from '../../stats/ml'
import { createRng } from '../../lib/random'
import { roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { Stage, XYPlot, useStage, type Layer } from './kit'
import { tabular, tabularRoles, type Tabular } from './mlShared'

/** Charts that explain a fitted model: ICE, ALE, SHAP summary / waterfall and permutation importance. The model is a random-forest regressor fitted in the browser. */

export interface ForestParams { trees: number; depth: number }
const forestDefaults: ForestParams = { trees: 20, depth: 5 }
const needTab = <ChartMessage>예측 대상 열과 특징 열을 2개 이상 고르세요. 숫자가 비어 있지 않은 행이 20개 이상 필요합니다.</ChartMessage>

function useForest(data: Tabular | null, p: ForestParams, rows?: number[]) {
  return useMemo(() => {
    if (!data || data.X.length < 20) return null
    const idx = rows ?? data.X.map((_, i) => i)
    return fitForest(idx.map((i) => data.X[i]), idx.map((i) => data.y[i]), { trees: p.trees, maxDepth: p.depth, minLeaf: 3, seed: 1 })
  }, [data, p.trees, p.depth, rows])
}

function ForestControls<P extends ForestParams>({ params, setParams }: { params: P; setParams: (p: Partial<P>) => void }) {
  const set = setParams as (p: Partial<ForestParams>) => void
  return (
    <ControlGroup title="설명할 모델 (랜덤 포레스트)">
      <Slider label="트리 수" value={params.trees} min={5} max={60} step={5} onChange={(trees) => set({ trees })} testId="ctl-trees" />
      <Slider label="최대 깊이" value={params.depth} min={1} max={8} onChange={(depth) => set({ depth })} testId="ctl-forest-depth" />
    </ControlGroup>
  )
}

const featIndex = (names: string[], f: string) => Math.max(0, names.indexOf(f))
const featureOptions = (mapping: ControlsProps<unknown>['mapping']) => roleColumns(mapping, 'features').map((f) => ({ value: f, label: f }))
const evenly = (n: number, k: number) => Array.from({ length: Math.min(n, k) }, (_, i) => Math.round((i * (n - 1)) / Math.max(1, Math.min(n, k) - 1)))

// ─── ICE ────────────────────────────────────────────────────────────────────────────

export interface IceParams extends ForestParams { feature: string; curves: number; centered: boolean; pdp: boolean }

function IceChart({ table, mapping, params, width, height, compact }: ChartProps<IceParams>) {
  const data = useMemo(() => tabular(table, mapping), [table, mapping])
  const model = useForest(data, params)
  const j = data ? featIndex(data.names, params.feature) : 0
  const res = useMemo(() => {
    if (!data || !model) return null
    const grid = d3.range(0, 31).map((i) => d3.quantile(data.X.map((r) => r[j]).sort((a, b) => a - b), i / 30)!)
    const ids = evenly(data.X.length, compact ? 24 : params.curves)
    const curves = iceCurves((x) => model.predict(x), ids.map((i) => data.X[i]), j, grid)
    const centered = curves.map((c) => c.map((v) => v - c[0]))
    const shown = params.centered ? centered : curves
    const pdp = pdpOf(shown)
    const het = d3.mean(grid.map((_, k) => d3.deviation(shown.map((c) => c[k])) ?? 0)) ?? 0
    return { grid, ids, shown, pdp, het }
  }, [data, model, j, params.curves, params.centered, compact])
  if (!data || !model || !res) return needTab
  const name = data.names[j]
  const layers: Layer[] = [
    ...res.shown.map((c, k): Layer => ({ kind: 'line', x: res.grid, y: c, color: '#4c6fb5', width: 1.2, opacity: 0.38, tip: <><b>행 {data.rows[res.ids[k]] + 1}</b><br />관측 {name} = {fmt(data.X[res.ids[k]][j])}<br />관측 예측 {fmt(model.predict(data.X[res.ids[k]]))}</> })),
    ...(params.pdp ? [{ kind: 'line', x: res.grid, y: res.pdp, color: '#111827', width: 3.2, label: '부분 의존(PDP, 평균)' } as Layer] : []),
    { kind: 'points', color: '#e07a3f', r: 3, opacity: 0.9, pts: res.ids.map((i, k) => ({ x: data.X[i][j], y: params.centered ? 0 : model.predict(data.X[i]), key: `o${k}` })) },
  ]
  return (
    <XYPlot layers={layers} width={width} height={height} compact={compact} xLabel={name} yLabel={params.centered ? `예측 변화 (${name} 최소값 기준)` : `예측 ${tabularTarget(mapping)}`} title={`ICE 도표: ${name}`}
      readout={[{ label: '곡선', value: res.ids.length }, { label: '곡선 간 변동', value: fmt(res.het, 1) }]}
      note="한 선 = 한 관측값, 주황 점 = 그 관측값의 실제 위치" />
  )
}
const tabularTarget = (m: ChartProps<unknown>['mapping']) => (typeof m.target === 'string' ? m.target : '')

function IceControls({ params, setParams, mapping }: ControlsProps<IceParams>) {
  const opts = featureOptions(mapping)
  return (
    <>
      <ControlGroup title="ICE">
        <Select label="변화시킬 특징" value={opts.some((o) => o.value === params.feature) ? params.feature : opts[0]?.value ?? ''} options={opts} onChange={(feature) => setParams({ feature })} testId="ctl-feature" />
        <Slider label="그릴 곡선 수" value={params.curves} min={5} max={100} step={5} onChange={(curves) => setParams({ curves })} testId="ctl-curves" />
        <Toggle label="시작점을 0으로 맞춤 (c-ICE)" checked={params.centered} onChange={(centered) => setParams({ centered })} />
        <Toggle label="평균(PDP) 표시" checked={params.pdp} onChange={(pdp) => setParams({ pdp })} />
        <Hint>관측값 하나를 골라 한 특징만 격자 값으로 바꾸고 나머지는 그대로 둔 채 모델 예측을 다시 계산한 곡선입니다. 곡선들이 평행하지 않으면 그 특징의 효과가 다른 특징과의 상호작용에 따라 달라진다는 뜻입니다. 평균(PDP)은 이런 차이를 가려 버립니다.</Hint>
      </ControlGroup>
      <ForestControls params={params} setParams={setParams} />
    </>
  )
}

export const iceModule: VizModule<IceParams> = {
  roles: tabularRoles(6), datasets: ['ml-tabular'], defaultParams: { ...forestDefaults, feature: '', curves: 40, centered: false, pdp: true },
  Chart: IceChart, Controls: IceControls, hint: '선에 올리면 해당 관측값 · 특징을 바꿔 보고 c-ICE로 곡선 모양만 비교하세요',
}

// ─── ALE ────────────────────────────────────────────────────────────────────────────

export interface AleParams extends ForestParams { feature: string; bins: number; showPdp: boolean }

function AleChart({ table, mapping, params, width, height, compact }: ChartProps<AleParams>) {
  const data = useMemo(() => tabular(table, mapping), [table, mapping])
  const model = useForest(data, params)
  const j = data ? featIndex(data.names, params.feature) : 0
  const res = useMemo(() => {
    if (!data || !model) return null
    const f = (x: readonly number[]) => model.predict(x)
    const a = ale(f, data.X, j, params.bins)
    if (a.edges.length < 2) return null
    const pdpCurves = iceCurves(f, evenly(data.X.length, 80).map((i) => data.X[i]), j, a.edges)
    const pdp0 = pdpOf(pdpCurves), m = d3.mean(pdp0) ?? 0
    return { a, pdp: pdp0.map((v) => v - m) }
  }, [data, model, j, params.bins])
  if (!data || !model || !res) return needTab
  const name = data.names[j]
  const all = [...res.a.effect, ...(params.showPdp ? res.pdp : [])]
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1
  const rug = data.X.map((r) => r[j])
  const layers: Layer[] = [
    ...res.a.edges.map((e): Layer => ({ kind: 'vline', v: e, color: '#eef0f2', dash: '0' })),
    ...(params.showPdp ? [{ kind: 'line', x: res.a.edges, y: res.pdp, label: 'PDP (평균 0으로 맞춤)', color: '#9aa1a9', dash: '6 4', width: 2 } as Layer] : []),
    { kind: 'line', x: res.a.edges, y: res.a.effect, label: 'ALE', color: '#2a8c82', width: 3 },
    { kind: 'points', color: '#6b7280', r: 1.6, opacity: 0.35, pts: rug.map((v, k) => ({ x: v, y: lo - span * 0.06, key: `r${k}` })) },
  ]
  return (
    <XYPlot hover layers={layers} width={width} height={height} compact={compact} xLabel={name} yLabel="평균 예측 대비 효과" title={`ALE 도표: ${name}`} yDomain={[lo - span * 0.1, hi + span * 0.08]}
      readout={[{ label: '구간', value: res.a.counts.length }, { label: '효과 범위', value: fmt(hi - lo, 1) }]}
      note="아래 점 = 관측값(러그), 옅은 세로선 = 분위수 구간 경계" />
  )
}

function AleControls({ params, setParams, mapping }: ControlsProps<AleParams>) {
  const opts = featureOptions(mapping)
  return (
    <>
      <ControlGroup title="ALE">
        <Select label="특징" value={opts.some((o) => o.value === params.feature) ? params.feature : opts[0]?.value ?? ''} options={opts} onChange={(feature) => setParams({ feature })} testId="ctl-feature" />
        <Slider label="분위수 구간 수" value={params.bins} min={3} max={30} onChange={(bins) => setParams({ bins })} testId="ctl-bins" />
        <Toggle label="PDP와 비교" checked={params.showPdp} onChange={(showPdp) => setParams({ showPdp })} />
        <Hint>ALE은 실제 데이터가 있는 구간 안에서만 특징을 조금 바꿔 예측이 얼마나 변하는지를 누적한 값입니다. 면적과 방 수처럼 특징끼리 상관이 크면 PDP는 현실에 없는 조합(넓은데 방이 1개)을 예측에 섞지만, ALE은 그러지 않습니다. 두 곡선의 차이가 그 영향입니다.</Hint>
      </ControlGroup>
      <ForestControls params={params} setParams={setParams} />
    </>
  )
}

export const aleModule: VizModule<AleParams> = {
  roles: tabularRoles(6), datasets: ['ml-tabular'], defaultParams: { ...forestDefaults, feature: '', bins: 10, showPdp: true },
  Chart: AleChart, Controls: AleControls, hint: '상관이 큰 특징(면적, 방 수)에서 ALE과 PDP가 어떻게 달라지는지 비교하세요',
}

// ─── SHAP ───────────────────────────────────────────────────────────────────────────

export interface ShapParams extends ForestParams { instances: number; background: number }

function useShap(data: Tabular | null, model: Regressor | null, ids: number[], bg: number) {
  return useMemo(() => {
    if (!data || !model) return null
    const bgIdx = evenly(data.X.length, bg)
    const background = bgIdx.map((i) => data.X[i])
    const f = (x: readonly number[]) => model.predict(x)
    const sh = ids.map((i) => shapExact(f, data.X[i], background))
    return { sh, base: sh[0]?.base ?? 0, err: Math.max(0, ...sh.map((s) => Math.abs(s.phi.reduce((a, b) => a + b, 0) - (s.fx - s.base)))) }
  }, [data, model, ids, bg])
}

function ShapSummaryChart({ table, mapping, params, width, height, compact }: ChartProps<ShapParams>) {
  const stage = useStage()
  const data = useMemo(() => tabular(table, mapping), [table, mapping])
  const model = useForest(data, params)
  const ids = useMemo(() => (data ? evenly(data.X.length, compact ? 25 : params.instances) : []), [data, params.instances, compact])
  const res = useShap(data, model, ids, compact ? 8 : params.background)
  if (!data || !model || !res) return needTab
  const p = data.names.length
  const meanAbs = data.names.map((_, j) => d3.mean(res.sh.map((s) => Math.abs(s.phi[j]))) ?? 0)
  const order = d3.range(p).sort((a, b) => meanAbs[b] - meanAbs[a])
  const m = { top: compact ? 8 : 40, right: compact ? 8 : 36, bottom: compact ? 8 : 60, left: compact ? 8 : 92 }
  const iw = width - m.left - m.right, ih = height - m.top - m.bottom
  const allPhi = res.sh.flatMap((s) => s.phi)
  const ext = Math.max(1e-9, ...allPhi.map(Math.abs))
  const x = d3.scaleLinear().domain([-ext * 1.05, ext * 1.05]).range([0, iw])
  const band = ih / p
  const colorFor = (j: number, v: number) => { const col = data.X.map((r) => r[j]); const lo = d3.min(col)!, hi = d3.max(col)!; return d3.interpolateRdBu(1 - (hi > lo ? (v - lo) / (hi - lo) : 0.5)) }
  return (
    <Stage stage={stage} width={width} height={height} compact={compact} label={`SHAP 요약 도표: ${p}개 특징, 관측값 ${ids.length}개`}
      readout={[{ label: '기준값 E[f]', value: fmt(res.base, 0) }, { label: '합산 오차', value: res.err.toExponential(1) }]} note="점 = 관측값 하나, 색 = 그 특징의 값(파랑 낮음, 빨강 높음)">
      <g transform={`translate(${m.left},${m.top})`}>
        {!compact && x.ticks(6).map((t) => <g key={t}><line x1={x(t)} x2={x(t)} y1={0} y2={ih} stroke={t === 0 ? '#111827' : '#eef0f2'} /><text x={x(t)} y={ih + 18} textAnchor="middle" fontSize={11} fill="#6b7280">{fmt(t, 0)}</text></g>)}
        {!compact && <text x={iw / 2} y={ih + 38} textAnchor="middle" fontSize={12} fill="#6b7280">SHAP 값 (예측에 대한 기여)</text>}
        {order.map((j, r) => {
          const vals = res.sh.map((s, k) => ({ phi: s.phi[j], k }))
          const bins = d3.bin<{ phi: number; k: number }, number>().value((d) => d.phi).domain(x.domain() as [number, number]).thresholds(36)(vals)
          const pos = new Map<number, number>()
          for (const b of bins) b.forEach((d, i) => pos.set(d.k, (i - (b.length - 1) / 2) * Math.min(5.5, (band * 0.84) / Math.max(1, b.length))))
          return (
            <g key={j} transform={`translate(0,${r * band + band / 2})`}>
              {!compact && <line x1={0} x2={iw} y1={band / 2} y2={band / 2} stroke="#f3f4f6" />}
              {!compact && <text x={-8} y={0} dy="0.34em" textAnchor="end" fontSize={12} fill="#111827">{data.names[j]}</text>}
              {vals.map((d) => (
                <circle key={d.k} data-testid="shap-dot" cx={x(d.phi)} cy={pos.get(d.k) ?? 0} r={compact ? 1.8 : 3.4} fill={colorFor(j, data.X[ids[d.k]][j])} fillOpacity={0.85}
                  onPointerEnter={compact ? undefined : (e) => stage.at(e, <><b>행 {data.rows[ids[d.k]] + 1}</b><br />{data.names[j]} = {fmt(data.X[ids[d.k]][j])}<br />SHAP {fmt(d.phi, 1)} (예측 {fmt(res.sh[d.k].fx, 0)})</>)} />
              ))}
            </g>
          )
        })}
      </g>
    </Stage>
  )
}

function ShapSummaryControls({ params, setParams }: ControlsProps<ShapParams>) {
  return (
    <>
      <ControlGroup title="SHAP 계산">
        <Slider label="설명할 관측값 수" value={params.instances} min={10} max={100} step={5} onChange={(instances) => setParams({ instances })} testId="ctl-instances" />
        <Slider label="배경 표본 수" value={params.background} min={5} max={60} step={5} onChange={(background) => setParams({ background })} testId="ctl-background" />
        <Hint>특징이 6개 이하일 때 모든 부분집합 S에 대해 v(S) = 배경 표본에서 나머지 특징을 뽑은 평균 예측을 구해 샤플리 값을 정확히 계산합니다(근사 아님). 따라서 관측값마다 기여도의 합이 (예측 − 기준값)과 정확히 같습니다. 기여도는 ‘이 모델’이 그 특징을 쓰는 방식을 설명할 뿐 인과 효과가 아닙니다.</Hint>
      </ControlGroup>
      <ForestControls params={params} setParams={setParams} />
    </>
  )
}

export const shapSummaryModule: VizModule<ShapParams> = {
  roles: tabularRoles(6), datasets: ['ml-tabular'], defaultParams: { ...forestDefaults, instances: 50, background: 20 },
  Chart: ShapSummaryChart, Controls: ShapSummaryControls, hint: '점에 올려 관측값별 기여도를 확인하세요 · 색은 특징의 값이므로 색과 위치의 관계가 효과의 방향입니다',
}

// ─── SHAP waterfall ─────────────────────────────────────────────────────────────────

export interface WaterfallParams extends ForestParams { row: number; background: number }

function ShapWaterfallChart({ table, mapping, params, width, height, compact }: ChartProps<WaterfallParams>) {
  const stage = useStage()
  const data = useMemo(() => tabular(table, mapping), [table, mapping])
  const model = useForest(data, params)
  const which = data ? Math.max(0, Math.min(data.X.length - 1, params.row)) : 0
  const ids = useMemo(() => [which], [which])
  const res = useShap(data, model, ids, compact ? 8 : params.background)
  if (!data || !model || !res) return needTab
  const s = res.sh[0]
  const order = d3.range(data.names.length).sort((a, b) => Math.abs(s.phi[b]) - Math.abs(s.phi[a]))
  const m = { top: compact ? 8 : 44, right: compact ? 8 : 40, bottom: compact ? 8 : 58, left: compact ? 8 : 150 }
  const iw = width - m.left - m.right, ih = height - m.top - m.bottom
  const steps: { j: number; from: number; to: number }[] = []
  let run = s.base
  for (const j of order) { steps.push({ j, from: run, to: run + s.phi[j] }); run += s.phi[j] }
  const vals = [s.base, s.fx, ...steps.flatMap((t) => [t.from, t.to])]
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.12 || 1
  const x = d3.scaleLinear().domain([lo - pad, hi + pad]).range([0, iw])
  const rowH = ih / (steps.length + 2)
  const bar = Math.min(26, rowH * 0.66)
  const yFor = (r: number) => (r + 0.5) * rowH
  return (
    <Stage stage={stage} width={width} height={height} compact={compact} label={`SHAP 폭포 도표: 행 ${data.rows[which] + 1}, 예측 ${fmt(s.fx, 0)}`}
      readout={[{ label: '기준값 E[f]', value: fmt(s.base, 0) }, { label: '예측 f(x)', value: fmt(s.fx, 0) }, { label: '합산 오차', value: Math.abs(run - s.fx).toExponential(1) }]}
      note={`행 ${data.rows[which] + 1} · 기준값 + 기여도 합 = 예측`}>
      <g transform={`translate(${m.left},${m.top})`}>
        {!compact && x.ticks(6).map((t) => <g key={t}><line x1={x(t)} x2={x(t)} y1={0} y2={ih} stroke="#eef0f2" /><text x={x(t)} y={ih + 18} textAnchor="middle" fontSize={11} fill="#6b7280">{fmt(t, 0)}</text></g>)}
        <g transform={`translate(0,${yFor(0)})`}>
          <rect x={Math.min(x(s.base), x(lo - pad))} y={-bar / 2} width={Math.abs(x(s.base) - x(lo - pad))} height={bar} fill="#9aa1a9" fillOpacity={0.5} />
          {!compact && <text x={-8} dy="0.34em" textAnchor="end" fontSize={12} fill="#111827">기준값 E[f(X)]</text>}
        </g>
        {steps.map((t, r) => {
          const up = t.to >= t.from
          return (
            <g key={t.j} transform={`translate(0,${yFor(r + 1)})`}>
              <line x1={x(t.from)} x2={x(t.from)} y1={-rowH} y2={0} stroke="#c7ccd1" strokeDasharray="2 3" />
              <rect data-testid="waterfall-bar" x={Math.min(x(t.from), x(t.to))} y={-bar / 2} width={Math.max(1, Math.abs(x(t.to) - x(t.from)))} height={bar} fill={up ? '#cf4f6a' : '#4c6fb5'} fillOpacity={0.9}
                onPointerEnter={compact ? undefined : (e) => stage.at(e, <><b>{data.names[t.j]} = {fmt(data.X[which][t.j])}</b><br />기여 {up ? '+' : ''}{fmt(s.phi[t.j], 1)}</>)} />
              {!compact && <text x={-8} dy="0.34em" textAnchor="end" fontSize={12} fill="#111827">{data.names[t.j]} = {fmt(data.X[which][t.j])}</text>}
              {!compact && <text x={Math.max(x(t.from), x(t.to)) + 6} dy="0.34em" fontSize={11.5} fill={up ? '#cf4f6a' : '#4c6fb5'}>{up ? '+' : ''}{fmt(s.phi[t.j], 1)}</text>}
            </g>
          )
        })}
        <g transform={`translate(0,${yFor(steps.length + 1)})`}>
          <line x1={x(s.fx)} x2={x(s.fx)} y1={-rowH} y2={0} stroke="#c7ccd1" strokeDasharray="2 3" />
          <rect x={x(lo - pad)} y={-bar / 2} width={Math.max(1, x(s.fx) - x(lo - pad))} height={bar} fill="#2a8c82" fillOpacity={0.85} />
          {!compact && <text x={-8} dy="0.34em" textAnchor="end" fontSize={12} fontWeight={600} fill="#111827">예측 f(x)</text>}
        </g>
      </g>
    </Stage>
  )
}

function ShapWaterfallControls({ params, setParams, table }: ControlsProps<WaterfallParams>) {
  return (
    <>
      <ControlGroup title="설명할 관측값">
        <Slider label="행 번호" value={Math.min(params.row, Math.max(0, table.rows.length - 1)) + 1} min={1} max={Math.max(1, table.rows.length)} onChange={(v) => setParams({ row: v - 1 })} testId="ctl-row" />
        <Slider label="배경 표본 수" value={params.background} min={5} max={60} step={5} onChange={(background) => setParams({ background })} testId="ctl-background" />
        <Hint>하나의 예측을 ‘기준값(배경 평균 예측)’에서 시작해 특징별 기여도를 차례로 더해 최종 예측에 이르는 과정으로 풀어 보입니다. 위에서부터 영향이 큰 특징 순서이며, 기여도의 합이 (예측 − 기준값)과 정확히 같다는 것이 샤플리 값의 효율성 성질입니다. 순서는 표시를 위한 것일 뿐 값에는 영향이 없습니다.</Hint>
      </ControlGroup>
      <ForestControls params={params} setParams={setParams} />
    </>
  )
}

export const shapWaterfallModule: VizModule<WaterfallParams> = {
  roles: tabularRoles(6), datasets: ['ml-tabular'], defaultParams: { ...forestDefaults, row: 0, background: 30 },
  Chart: ShapWaterfallChart, Controls: ShapWaterfallControls, hint: '행 번호를 바꿔 다른 관측값의 예측이 어떻게 구성되는지 비교하세요',
}

// ─── permutation importance ─────────────────────────────────────────────────────────

export interface PermParams extends ForestParams { repeats: number; eval: 'test' | 'train' }

function PermChart({ table, mapping, params, width, height, compact }: ChartProps<PermParams>) {
  const stage = useStage()
  const data = useMemo(() => tabular(table, mapping), [table, mapping])
  const split = useMemo(() => { if (!data) return null; const o = shuffled(data.X.length, createRng(5)); const nT = Math.round(data.X.length * 0.3); return { test: o.slice(0, nT), train: o.slice(nT) } }, [data])
  const model = useForest(data, params, split?.train)
  const res = useMemo(() => {
    if (!data || !model || !split) return null
    const ids = params.eval === 'test' ? split.test : split.train
    const y = ids.map((i) => data.y[i])
    return permutationImportance((M) => r2Score(y, M.map((x) => model.predict(x))), ids.map((i) => data.X[i]), params.repeats, 3)
  }, [data, model, split, params.eval, params.repeats])
  if (!data || !model || !res) return needTab
  const order = d3.range(data.names.length).sort((a, b) => res.features[b].mean - res.features[a].mean)
  const m = { top: compact ? 8 : 44, right: compact ? 8 : 36, bottom: compact ? 8 : 60, left: compact ? 8 : 96 }
  const iw = width - m.left - m.right, ih = height - m.top - m.bottom
  const ext = Math.max(0.05, ...res.features.map((f) => Math.max(f.mean + f.sd, ...f.drops)))
  const lo = Math.min(0, ...res.features.flatMap((f) => f.drops))
  const x = d3.scaleLinear().domain([lo * 1.1, ext * 1.08]).range([0, iw])
  const band = ih / order.length
  return (
    <Stage stage={stage} width={width} height={height} compact={compact} label={`순열 중요도: ${params.eval === 'test' ? '검증' : '학습'} 데이터 R² ${fmt(res.base, 3)}`}
      readout={[{ label: '기준 R²', value: fmt(res.base, 3) }, { label: '평가 데이터', value: params.eval === 'test' ? '따로 뗀 30%' : '학습 데이터' }]} note="막대 = 반복 평균, 선 = ±1 표준편차, 점 = 각 반복">
      <g transform={`translate(${m.left},${m.top})`}>
        {!compact && x.ticks(6).map((t) => <g key={t}><line x1={x(t)} x2={x(t)} y1={0} y2={ih} stroke={t === 0 ? '#111827' : '#eef0f2'} /><text x={x(t)} y={ih + 18} textAnchor="middle" fontSize={11} fill="#6b7280">{fmt(t, 2)}</text></g>)}
        {!compact && <text x={iw / 2} y={ih + 38} textAnchor="middle" fontSize={12} fill="#6b7280">섞었을 때 R²가 줄어든 정도</text>}
        {order.map((j, r) => {
          const f = res.features[j]
          return (
            <g key={j} transform={`translate(0,${r * band})`}>
              <rect data-testid="perm-bar" x={Math.min(x(0), x(f.mean))} y={band * 0.18} width={Math.abs(x(f.mean) - x(0))} height={band * 0.64} fill={f.mean > 0 ? '#2a8c82' : '#9aa1a9'} fillOpacity={0.85}
                onPointerEnter={compact ? undefined : (e) => stage.at(e, <><b>{data.names[j]}</b><br />R² 감소 {fmt(f.mean, 3)} ± {fmt(f.sd, 3)}</>)} />
              <line x1={x(f.mean - f.sd)} x2={x(f.mean + f.sd)} y1={band / 2} y2={band / 2} stroke="#111827" strokeWidth={1.4} />
              {!compact && f.drops.map((d, k) => <circle key={k} cx={x(d)} cy={band / 2 + ((k % 3) - 1) * 3} r={2} fill="#111827" fillOpacity={0.6} />)}
              {!compact && <text x={-8} y={band / 2} dy="0.34em" textAnchor="end" fontSize={12} fill="#111827">{data.names[j]}</text>}
            </g>
          )
        })}
      </g>
    </Stage>
  )
}

function PermControls({ params, setParams }: ControlsProps<PermParams>) {
  return (
    <>
      <ControlGroup title="순열 중요도">
        <Segmented label="평가 데이터" value={params.eval} onChange={(v) => setParams({ eval: v })} testId="ctl-eval" options={[{ value: 'test', label: '검증 30%' }, { value: 'train', label: '학습 데이터' }]} />
        <Slider label="반복 횟수" value={params.repeats} min={1} max={20} onChange={(repeats) => setParams({ repeats })} testId="ctl-repeats" />
        <Hint>특징 하나의 열만 무작위로 섞어 특징과 정답 사이의 관계를 끊고, 모델의 R²가 얼마나 떨어지는지를 중요도로 삼습니다. 모델은 70%로 학습하고 나머지 30%에서 평가하는 것이 기본입니다. 학습 데이터로 재면 과적합된 특징도 중요해 보일 수 있습니다. 상관이 큰 특징은 서로 대신할 수 있어 중요도가 낮게 나옵니다.</Hint>
      </ControlGroup>
      <ForestControls params={params} setParams={setParams} />
    </>
  )
}

export const permModule: VizModule<PermParams> = {
  roles: tabularRoles(6), datasets: ['ml-tabular'], defaultParams: { ...forestDefaults, repeats: 8, eval: 'test' },
  Chart: PermChart, Controls: PermControls, hint: '검증 데이터와 학습 데이터로 평가했을 때의 중요도 차이를 비교하세요',
}
