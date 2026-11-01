import * as d3 from 'd3'
import { useMemo } from 'react'
import { ChartMessage } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { fmt, pct } from '../../lib/format'
import { initMlp, lossSurface, mlpForward, mlpLoss, standardize, trainMlp, selfAttention, type Activation } from '../../stats/ml'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, RoleSpec, VizModule } from '../types'
import { columnIndex, toLabel, toNumber } from '../../data/table'
import { HeatGrid, Stage, XYPlot, useStage, type Layer } from './kit'
import { xyLabelRoles, xyLabelled } from './mlShared'
import { schemes } from '../../lib/colors'

const needXY = <ChartMessage>2개의 숫자형 특징과 클래스 열이 필요합니다. 행이 20개 이상이고 클래스가 2개 이상이어야 합니다.</ChartMessage>

const actOptions = [{ value: 'relu', label: 'ReLU' }, { value: 'tanh', label: 'tanh' }, { value: 'sigmoid', label: '시그모이드' }] as { value: Activation; label: string }[]

// ─── neural-network training curves ─────────────────────────────────────────────────

export interface NnParams { hidden: number; layers: number; act: Activation; lr: number; epochs: number; schedule: 'constant' | 'step' | 'cosine'; l2: number }

function useTrained(data: ReturnType<typeof xyLabelled>, p: NnParams, valFraction = 0.2) {
  return useMemo(() => {
    if (!data || data.X.length < 20 || data.classes.length < 2) return null
    const { Z } = standardize(data.X)
    return trainMlp(Z, data.y, data.classes.length, { hidden: Array(p.layers).fill(p.hidden), act: p.act, lr: p.lr, epochs: p.epochs, seed: 4, schedule: p.schedule, l2: p.l2, valFraction })
  }, [data, p.hidden, p.layers, p.act, p.lr, p.epochs, p.schedule, p.l2, valFraction])
}

function NnChart({ table, mapping, params, width, height, compact }: ChartProps<NnParams>) {
  const data = useMemo(() => xyLabelled(table, mapping), [table, mapping])
  const run = useTrained(data, params)
  if (!data || !run) return needXY
  const h = run.history
  const x = h.map((e) => e.epoch)
  const bestEpoch = h.reduce((b, e) => (e.valLoss < b.valLoss ? e : b), h[1] ?? h[0])
  const last = h[h.length - 1]
  const title = `신경망 학습 곡선: 은닉 ${params.layers}층 × ${params.hidden}, ${params.epochs} epoch`
  const lossLayers: Layer[] = [
    { kind: 'line', x, y: h.map((e) => e.loss), label: '훈련 손실', color: '#2a8c82' },
    { kind: 'line', x, y: h.map((e) => e.valLoss), label: '검증 손실', color: '#e07a3f' },
    { kind: 'vline', v: bestEpoch.epoch, color: '#9aa1a9' },
  ]
  if (compact) return <XYPlot layers={lossLayers} width={width} height={height} compact title={title} />
  const h1 = Math.floor(height * 0.43), h2 = Math.floor(height * 0.37), h3 = height - h1 - h2
  const small = { top: 6, bottom: 28 }
  return (
    <div style={{ width, height }} data-testid="nn-stack">
      <div style={{ height: h1, position: 'relative' }}>
        <XYPlot hover layers={lossLayers} width={width} height={h1} xLabel="" yLabel="교차엔트로피 손실" title={title} margin={{ bottom: 22 }}
          readout={[{ label: '최종 훈련 손실', value: fmt(last.loss, 3) }, { label: '최종 검증 손실', value: fmt(last.valLoss, 3) }, { label: '검증 최저', value: `epoch ${bestEpoch.epoch}` }]} />
      </div>
      <div style={{ height: h2, position: 'relative' }}>
        <XYPlot hover layers={[
          { kind: 'line', x, y: h.map((e) => e.acc), label: '훈련 정확도', color: '#2a8c82' },
          { kind: 'line', x, y: h.map((e) => e.valAcc), label: '검증 정확도', color: '#e07a3f' },
        ]} width={width} height={h2} xLabel="" yLabel="정확도" title="정확도" yFormat={(v) => pct(v, 0)} yDomain={[Math.max(0, Math.min(...h.map((e) => Math.min(e.acc, e.valAcc))) - 0.05), 1.02]} margin={{ top: 14, bottom: 22 }} />
      </div>
      <div style={{ height: h3, position: 'relative' }}>
        <XYPlot hover layers={[{ kind: 'line', x, y: h.map((e) => e.lr), label: '학습률', color: '#4c6fb5', step: true }]} width={width} height={h3} xLabel="epoch" yLabel="학습률" title="학습률" yDomain={[0, Math.max(...h.map((e) => e.lr)) * 1.25]} margin={{ top: 8, bottom: small.bottom + 18 }} />
      </div>
    </div>
  )
}

function NnControls({ params, setParams }: ControlsProps<NnParams>) {
  return (
    <ControlGroup title="신경망과 학습">
      <Slider label="은닉층 수" value={params.layers} min={1} max={3} onChange={(layers) => setParams({ layers })} testId="ctl-layers" />
      <Slider label="층당 뉴런 수" value={params.hidden} min={2} max={32} onChange={(hidden) => setParams({ hidden })} testId="ctl-hidden" />
      <Select label="활성화 함수" value={params.act} options={actOptions} onChange={(act) => setParams({ act })} testId="ctl-act" />
      <Slider label="학습률" value={params.lr} min={0.005} max={0.5} step={0.005} onChange={(lr) => setParams({ lr })} testId="ctl-lr" />
      <Slider label="epoch" value={params.epochs} min={5} max={200} step={5} onChange={(epochs) => setParams({ epochs })} testId="ctl-epochs" />
      <Segmented label="학습률 스케줄" value={params.schedule} onChange={(schedule) => setParams({ schedule })} testId="ctl-schedule" options={[{ value: 'constant', label: '고정' }, { value: 'step', label: '계단' }, { value: 'cosine', label: '코사인' }]} />
      <Slider label="가중치 감쇠 (L2)" value={params.l2} min={0} max={0.05} step={0.001} onChange={(l2) => setParams({ l2 })} testId="ctl-l2" />
      <Hint>표의 점을 표준화해 80%로 미니배치 SGD(모멘텀 0.9)로 학습하고, 나머지 20%는 학습에 쓰지 않고 검증 손실·정확도만 잽니다. 훈련 손실은 계속 내려가는데 검증 손실이 다시 오르면 과적합이며, 회색 세로선이 검증 손실이 가장 낮았던 epoch(조기 종료 지점)입니다.</Hint>
    </ControlGroup>
  )
}

export const nnTrainingModule: VizModule<NnParams> = {
  roles: xyLabelRoles, datasets: ['ml-clusters', 'ml-moons', 'ml-spiral'], defaultParams: { hidden: 12, layers: 1, act: 'tanh', lr: 0.05, epochs: 80, schedule: 'constant', l2: 0 },
  Chart: NnChart, Controls: NnControls, hint: '학습률·층 수·스케줄을 바꿔 훈련/검증 곡선이 어떻게 달라지는지 보세요 · 선 위에 올리면 epoch별 값',
}

// ─── loss landscape ─────────────────────────────────────────────────────────────────

export interface LandscapeNnParams { hidden: number; act: Activation; epochs: number; extent: number; resolution: number; seed: number; log: boolean }

const gridPath = (poly: number[][][], px: (i: number) => number, py: (j: number) => number) => poly.map((ring) => `M${ring.map(([i, j]) => `${px(i)},${py(j)}`).join('L')}Z`).join('')

function LossLandscapeChart({ table, mapping, params, width, height, compact }: ChartProps<LandscapeNnParams>) {
  const data = useMemo(() => xyLabelled(table, mapping), [table, mapping])
  const res = useMemo(() => {
    if (!data || data.X.length < 20 || data.classes.length < 2) return null
    const { Z } = standardize(data.X)
    const run = trainMlp(Z, data.y, data.classes.length, { hidden: [params.hidden], act: params.act, lr: 0.05, epochs: params.epochs, seed: 4, valFraction: 0 })
    const n = compact ? 13 : params.resolution
    const s = lossSurface(run.model, Z, data.y, params.extent, n, params.seed)
    return { run, n, grid: s.grid, z: s.z, centre: mlpLoss(run.model, Z, data.y) }
  }, [data, params.hidden, params.act, params.epochs, params.extent, params.resolution, params.seed, compact])
  if (!data || !res) return needXY
  const flat = res.z.flat()
  const val = (v: number) => (params.log ? Math.log10(Math.max(v, 1e-6)) : v)
  const vals = flat.map(val)
  const lo = d3.min(vals)!, hi = d3.quantile([...vals].sort((a, b) => a - b), 0.97)!
  const e = params.extent
  const n = res.n
  const thresholds = d3.ticks(lo, hi, 9)
  const contours = d3.contours().size([n, n]).thresholds(thresholds)(vals)
  const edgeMean = d3.mean([...res.z[0], ...res.z[n - 1], ...res.z.map((r) => r[0]), ...res.z.map((r) => r[n - 1])])!
  return (
    <XYPlot width={width} height={height} compact={compact} xLabel="방향 1 (무작위, 가중치 규모로 정규화)" yLabel="방향 2" equal square title={`손실 지형: 학습된 해 주변, 반폭 ${e}`} grid={false} pad={0} xDomain={[-e, e]} yDomain={[-e, e]}
      layers={[
        { kind: 'raster', nx: n, ny: n, z: vals, x0: -e - e / (n - 1), x1: e + e / (n - 1), y0: -e - e / (n - 1), y1: e + e / (n - 1), color: (v) => schemes.viridis.interpolate(1 - Math.min(1, Math.max(0, (v - lo) / (hi - lo || 1)))) },
        { kind: 'points', color: '#ffffff', stroke: '#111827', r: 6, pts: [{ x: 0, y: 0, tip: <><b>학습된 해</b><br />손실 {fmt(res.centre, 4)}</> }] },
      ]}
      extra={({ x, y }) => compact ? null : (
        <g fill="none" stroke="#ffffff" strokeOpacity={0.55} strokeWidth={0.8} pointerEvents="none">
          {contours.map((c, k) => <path key={k} d={c.coordinates.map((poly) => gridPath(poly as number[][][], (i) => x(-e - e / (n - 1) + ((i) / n) * (2 * e + (2 * e) / (n - 1))), (j) => y(-e - e / (n - 1) + ((j) / n) * (2 * e + (2 * e) / (n - 1))))).join('')} />)}
        </g>
      )}
      readout={[{ label: '중심 손실', value: fmt(res.centre, 4) }, { label: '격자 최소', value: fmt(Math.min(...flat), 4) }, { label: '가장자리 평균', value: fmt(edgeMean, 3) }]}
      note={`밝은 영역 = 손실이 낮음${params.log ? ' (로그 색 눈금)' : ''} · 흰 선 = 등손실선 · 흰 점 = 학습된 가중치`} />
  )
}

function LossLandscapeControls({ params, setParams }: ControlsProps<LandscapeNnParams>) {
  return (
    <>
      <ControlGroup title="지형">
        <Slider label="가중치 이동 범위" value={params.extent} min={0.1} max={3} step={0.1} onChange={(extent) => setParams({ extent })} testId="ctl-extent" />
        <Slider label="격자 해상도" value={params.resolution} min={15} max={45} step={2} onChange={(resolution) => setParams({ resolution })} testId="ctl-res" />
        <Slider label="방향 시드" value={params.seed} min={1} max={20} onChange={(seed) => setParams({ seed })} testId="ctl-seed" />
        <Toggle label="손실을 로그 눈금으로" checked={params.log} onChange={(log) => setParams({ log })} />
      </ControlGroup>
      <ControlGroup title="학습된 모델">
        <Slider label="은닉 뉴런 수" value={params.hidden} min={1} max={16} onChange={(hidden) => setParams({ hidden })} testId="ctl-hidden" />
        <Select label="활성화 함수" value={params.act} options={actOptions} onChange={(act) => setParams({ act })} testId="ctl-act" />
        <Slider label="학습 epoch" value={params.epochs} min={5} max={120} step={5} onChange={(epochs) => setParams({ epochs })} testId="ctl-epochs" />
        <Hint>실제로 학습한 신경망의 가중치 θ*를 중심에 두고, 무작위 두 방향 d₁, d₂(각 뉴런의 가중치 크기에 맞춰 정규화)로 θ* + a·d₁ + b·d₂를 만들어 전체 데이터의 손실을 격자마다 계산합니다. 격자의 모든 값이 새로 계산된 손실입니다. 2차원 단면이므로 고차원 손실 곡면의 일부만 보여 주며, 방향 시드에 따라 모양이 달라집니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const lossLandscapeModule: VizModule<LandscapeNnParams> = {
  roles: xyLabelRoles, datasets: ['ml-moons', 'ml-clusters', 'ml-spiral'], defaultParams: { hidden: 4, act: 'tanh', epochs: 60, extent: 1, resolution: 27, seed: 1, log: true },
  Chart: LossLandscapeChart, Controls: LossLandscapeControls, hint: '방향 시드와 이동 범위를 바꿔 학습된 해 주변이 평평한지 가파른지 비교하세요',
}

// ─── attention map ──────────────────────────────────────────────────────────────────

export interface AttentionParams { layers: number; heads: number; layer: number; head: number; causal: boolean; usePad: boolean; temperature: number; seed: number }

const attentionRoles: RoleSpec[] = [
  { key: 'token', label: '토큰', type: 'category', required: true },
  { key: 'pad', label: '패딩 표시 (1 = 가림, 선택)', type: 'number', auto: true, prefer: '패딩|pad|mask' },
]

function AttentionChart({ table, mapping, params, width, height, compact }: ChartProps<AttentionParams>) {
  const toks = useMemo(() => {
    const ti = columnIndex(table, roleColumn(mapping, 'token')), pi = columnIndex(table, roleColumn(mapping, 'pad'))
    const out: { t: string; pad: boolean }[] = []
    if (ti < 0) return out
    table.rows.forEach((r) => { const t = toLabel(r[ti]); if (t) out.push({ t, pad: pi >= 0 && (toNumber(r[pi]) ?? 0) > 0 }) })
    return out.slice(0, 40)
  }, [table, mapping])
  const res = useMemo(() => (toks.length < 2 ? null : selfAttention(toks.map((x) => x.t), { layers: params.layers, heads: params.heads, dModel: 16, causal: params.causal, pad: toks.map((x) => params.usePad && x.pad), temperature: params.temperature, seed: params.seed })), [toks, params.layers, params.heads, params.causal, params.usePad, params.temperature, params.seed])
  if (!res) return <ChartMessage>토큰 열을 고르세요. 토큰이 2개 이상 필요합니다.</ChartMessage>
  const L = Math.min(params.layer, params.layers - 1), H = Math.min(params.head, params.heads - 1)
  const names = toks.map((x) => x.t)
  const A = res.maps[L][H]
  const sch = schemes.blues
  const entropy = d3.mean(A.map((row) => -d3.sum(row.map((w) => (w > 0 ? w * Math.log2(w) : 0))))) ?? 0
  const masked = toks.filter((x) => params.usePad && x.pad).length
  const thumbH = compact ? 0 : 92
  const mainH = height - thumbH
  return (
    <div style={{ width, height }}>
      <div style={{ height: mainH, position: 'relative' }}>
        <HeatGrid rows={names} cols={names} values={A} width={width} height={mainH} compact={compact} rowTitle="질의(Query) 토큰" colTitle="키(Key) 토큰" title={`어텐션 지도: 층 ${L + 1}, 헤드 ${H + 1}`}
          color={(v) => sch.interpolate(0.05 + 0.95 * Math.min(1, v * 1.4))} text={(v) => (v > 0.005 ? v.toFixed(2) : '')}
          tip={(i, j, v) => <><b>“{names[i]}” → “{names[j]}”</b><br />가중치 {fmt(v, 4)}<br />행 합 = {fmt(d3.sum(A[i]), 3)}</>}
          readout={[{ label: '층/헤드', value: `${L + 1}/${H + 1}` }, { label: '평균 엔트로피', value: `${fmt(entropy, 2)} bit` }, { label: '가려진 키', value: masked }]}
          note="학습되지 않은 무작위 초기화 가중치의 어텐션입니다 (구조 시연용)" />
      </div>
      {!compact && (
        <div style={{ height: thumbH, display: 'flex', gap: 6, padding: '4px 8px 0', overflowX: 'auto' }} data-testid="attention-heads">
          {res.maps[L].map((m, h) => (
            <div key={h} style={{ flex: '0 0 84px', height: thumbH - 8, position: 'relative', border: h === H ? '2px solid #111827' : '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' }} title={`헤드 ${h + 1}`}>
              <HeatGrid rows={names} cols={names} values={m} width={80} height={thumbH - 12} compact title={`헤드 ${h + 1}`} color={(v) => sch.interpolate(0.05 + 0.95 * Math.min(1, v * 1.4))} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AttentionControls({ params, setParams }: ControlsProps<AttentionParams>) {
  return (
    <>
      <ControlGroup title="보기">
        <Slider label="층" value={Math.min(params.layer, params.layers - 1) + 1} min={1} max={params.layers} onChange={(v) => setParams({ layer: v - 1 })} testId="ctl-layer" />
        <Slider label="헤드" value={Math.min(params.head, params.heads - 1) + 1} min={1} max={params.heads} onChange={(v) => setParams({ head: v - 1 })} testId="ctl-head" />
      </ControlGroup>
      <ControlGroup title="모델 구성">
        <Slider label="층 수" value={params.layers} min={1} max={4} onChange={(layers) => setParams({ layers })} testId="ctl-layers" />
        <Slider label="헤드 수" value={params.heads} min={1} max={6} onChange={(heads) => setParams({ heads })} testId="ctl-heads" />
        <Slider label="온도 (소프트맥스 나누기)" value={params.temperature} min={0.2} max={4} step={0.1} onChange={(temperature) => setParams({ temperature })} testId="ctl-temp" />
        <Slider label="가중치 시드" value={params.seed} min={1} max={30} onChange={(seed) => setParams({ seed })} testId="ctl-seed" />
        <Toggle label="인과 마스크 (미래 토큰 가림)" checked={params.causal} onChange={(causal) => setParams({ causal })} />
        <Toggle label="패딩 토큰 가림" checked={params.usePad} onChange={(usePad) => setParams({ usePad })} />
        <Hint>토큰 임베딩(글자 해시로 정한 고정 벡터 + 사인 위치 인코딩)에 층마다 무작위 Q·K·V 투영을 곱해 softmax(QKᵀ/(√d_k·온도))를 계산하고, 마스크된 키의 점수는 −∞로 두어 가중치가 정확히 0이 됩니다. 이 모델은 학습되지 않았으므로 지도는 ‘어텐션 계산 과정’을 보여 주는 것이지 언어적 의미를 해석한 것이 아닙니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const attentionModule: VizModule<AttentionParams> = {
  roles: attentionRoles, datasets: ['ml-tokens'], defaultParams: { layers: 2, heads: 4, layer: 0, head: 0, causal: false, usePad: true, temperature: 1, seed: 7 },
  Chart: AttentionChart, Controls: AttentionControls, hint: '인과 마스크와 패딩 가림을 켜고 끄며 가중치가 0이 되는 영역을 확인하세요 · 아래 작은 지도를 눌러 헤드를 비교',
}

// ─── activation distributions and signal flow ───────────────────────────────────────

export interface ActivationParams { layers: number; hidden: number; act: Activation; epochs: number; sample: number; stage: 'trained' | 'init' }

function ActivationChart({ table, mapping, params, width, height, compact }: ChartProps<ActivationParams>) {
  const stage = useStage()
  const data = useMemo(() => xyLabelled(table, mapping), [table, mapping])
  const res = useMemo(() => {
    if (!data || data.X.length < 20 || data.classes.length < 2) return null
    const { Z } = standardize(data.X)
    const hidden = Array(params.layers).fill(params.hidden)
    const k = data.classes.length
    const run = trainMlp(Z, data.y, k, { hidden, act: params.act, lr: 0.05, epochs: params.epochs, seed: 4, valFraction: 0 })
    const init = initMlp(Z[0].length, hidden, k, params.act, 4 + 17)
    const acts = (m: typeof init) => { const per: number[][] = Array.from({ length: params.layers }, () => []); const dead = new Array<number>(params.layers).fill(0); const seen = Array.from({ length: params.layers }, () => new Array<boolean>(params.hidden).fill(false)); Z.forEach((z) => { const f = mlpForward(m, z); for (let l = 0; l < params.layers; l++) f.post[l + 1].forEach((v, u) => { per[l].push(v); if (Math.abs(v) > 1e-6) seen[l][u] = true }) }); seen.forEach((s, l) => { dead[l] = s.filter((b) => !b).length / s.length }); return { per, dead } }
    return { Z, run, init, trained: acts(run.model), initial: acts(init) }
  }, [data, params.layers, params.hidden, params.act, params.epochs])
  if (!data || !res) return needXY
  const net = params.stage === 'trained' ? res.run.model : res.init
  const si = Math.min(params.sample, res.Z.length - 1)
  const pass = mlpForward(net, res.Z[si])
  const layerSizes = net.sizes
  const diagW = compact ? width : Math.max(220, width * 0.5)
  const histW = width - diagW
  const dm = { top: compact ? 8 : 52, bottom: compact ? 8 : 52 }
  const dh = height - dm.top - dm.bottom
  const colX = (l: number) => 34 + (l * (diagW - 68)) / Math.max(1, layerSizes.length - 1)
  const shown = (l: number) => Math.min(layerSizes[l], 10)
  const nodeY = (l: number, u: number) => dm.top + ((u + 0.5) / shown(l)) * dh
  const actColor = (v: number) => params.act === 'relu' ? d3.interpolateGreens(Math.min(1, v / 2)) : params.act === 'sigmoid' ? d3.interpolateGreens(v) : d3.interpolateRdBu(0.5 - v / 2)
  const range: [number, number] = params.act === 'relu' ? [0, 4] : params.act === 'sigmoid' ? [0, 1] : [-1, 1]
  const bins = (vs: number[]) => d3.bin().domain(range).thresholds(24)(vs.map((v) => Math.min(range[1] - 1e-9, Math.max(range[0], v))))
  const lh = (dh - 8 * (params.layers - 1)) / params.layers
  const hx = d3.scaleLinear().domain(range).range([diagW + 14, width - 16])
  const cls = data.classes[data.y[si]]
  return (
    <Stage stage={stage} width={width} height={height} compact={compact} label={`신호 흐름: ${params.layers}개 은닉층, 관측값 ${si + 1}`}
      readout={[{ label: '관측값', value: `${si + 1} (${cls})` }, { label: '예측', value: `${data.classes[pass.out.indexOf(Math.max(...pass.out))]} ${pct(Math.max(...pass.out), 0)}` }, { label: params.act === 'relu' ? '죽은 뉴런(마지막 은닉층)' : '포화 뉴런 없음 표시 생략', value: params.act === 'relu' ? pct((params.stage === 'trained' ? res.trained : res.initial).dead[params.layers - 1], 0) : '–' }]}
      note="왼쪽 = 선택한 관측값의 신호, 오른쪽 = 은닉층 활성화 분포 (회색 학습 전, 초록 학습 후)">
      <g>
        {layerSizes.slice(1).map((_, l0) => {
          const l = l0 + 1
          return Array.from({ length: shown(l) }, (_, u) => Array.from({ length: shown(l - 1) }, (_, v) => {
            const w = net.W[l - 1][u][v], s = Math.abs(w * pass.post[l - 1][v])
            return <line key={`${l}-${u}-${v}`} x1={colX(l - 1)} y1={nodeY(l - 1, v)} x2={colX(l)} y2={nodeY(l, u)} stroke={w * pass.post[l - 1][v] >= 0 ? '#cf4f6a' : '#4c6fb5'} strokeOpacity={Math.min(0.75, 0.05 + s * 0.5)} strokeWidth={Math.min(3, 0.3 + s * 1.6)} />
          }))
        })}
        {layerSizes.map((_n, l) => Array.from({ length: shown(l) }, (_, u) => {
          const v = pass.post[l][u]
          const out = l === layerSizes.length - 1
          return <circle key={`${l}-${u}`} data-testid="neuron" cx={colX(l)} cy={nodeY(l, u)} r={compact ? 3 : Math.min(11, (dh / shown(l)) * 0.38)} fill={l === 0 ? '#e5e7eb' : out ? d3.interpolateGreens(v) : actColor(v)} stroke={out && u === data.y[si] ? '#111827' : '#6b7280'} strokeWidth={out && u === data.y[si] ? 2.2 : 0.8}
            onPointerEnter={compact ? undefined : (e) => stage.at(e, <><b>{l === 0 ? `입력 ${u + 1}` : out ? `출력 ${data.classes[u]}` : `은닉 ${l}층 · 뉴런 ${u + 1}`}</b><br />값 {fmt(v, 3)}</>)} />
        }))}
        {!compact && layerSizes.map((n, l) => <text key={l} x={colX(l)} y={dm.top - 14} textAnchor="middle" fontSize={11} fill="#6b7280">{l === 0 ? '입력' : l === layerSizes.length - 1 ? '출력' : `은닉 ${l}`}{n > 10 ? ` (${n})` : ''}</text>)}
        {!compact && Array.from({ length: params.layers }, (_, l) => {
          const y0 = dm.top + l * (lh + 8)
          const b0 = bins(res.initial.per[l]), b1 = bins(res.trained.per[l])
          const top = Math.max(1, ...b0.map((b) => b.length), ...b1.map((b) => b.length))
          const yy = d3.scaleLinear().domain([0, top]).range([y0 + lh, y0])
          const area = (bs: d3.Bin<number, number>[]) => d3.area<d3.Bin<number, number>>().x((b) => hx(((b.x0 ?? 0) + (b.x1 ?? 0)) / 2)).y0(y0 + lh).y1((b) => yy(b.length)).curve(d3.curveMonotoneX)(bs) ?? ''
          return (
            <g key={l}>
              <rect x={diagW + 14} y={y0} width={histW - 30} height={lh} fill="#fafafa" stroke="#eef0f2" />
              <path d={area(b0)} fill="#9aa1a9" fillOpacity={0.45} /><path d={area(b1)} fill="#2a8c82" fillOpacity={0.5} stroke="#2a8c82" />
              <text x={width - 22} y={y0 + 14} textAnchor="end" fontSize={11} fill="#374151">은닉 {l + 1}층 · 죽은 뉴런 {pct(res.initial.dead[l], 0)} → {pct(res.trained.dead[l], 0)}</text>
            </g>
          )
        })}
        {!compact && <g fontSize={10.5} fill="#6b7280">{hx.ticks(4).map((t) => <text key={t} x={hx(t)} y={height - dm.bottom + 14} textAnchor="middle">{t}</text>)}</g>}
      </g>
    </Stage>
  )
}

function ActivationControls({ params, setParams, table }: ControlsProps<ActivationParams>) {
  return (
    <ControlGroup title="신경망">
      <Slider label="은닉층 수" value={params.layers} min={1} max={4} onChange={(layers) => setParams({ layers })} testId="ctl-layers" />
      <Slider label="층당 뉴런 수" value={params.hidden} min={2} max={32} onChange={(hidden) => setParams({ hidden })} testId="ctl-hidden" />
      <Select label="활성화 함수" value={params.act} options={actOptions} onChange={(act) => setParams({ act })} testId="ctl-act" />
      <Slider label="학습 epoch" value={params.epochs} min={0} max={150} step={5} onChange={(epochs) => setParams({ epochs })} testId="ctl-epochs" />
      <Slider label="따라갈 관측값" value={Math.min(params.sample, Math.max(0, table.rows.length - 1)) + 1} min={1} max={Math.max(1, table.rows.length)} onChange={(v) => setParams({ sample: v - 1 })} testId="ctl-sample" />
      <Segmented label="그림에 쓸 가중치" value={params.stage} onChange={(stage) => setParams({ stage })} testId="ctl-stage" options={[{ value: 'trained', label: '학습 후' }, { value: 'init', label: '학습 전' }]} />
      <Hint>같은 신경망의 학습 전(무작위 He 초기화)과 학습 후 가중치로 모든 관측값을 흘려 은닉층 활성화를 실제로 계산합니다. 왼쪽 그림의 선 굵기는 가중치×입력 신호의 크기, 빨강은 흥분성·파랑은 억제성 기여입니다. ReLU에서 어떤 관측값에도 반응하지 않는 ‘죽은 뉴런’이 학습 중 늘어나는지, tanh에서 값이 ±1에 쏠려 포화되는지 확인할 수 있습니다.</Hint>
    </ControlGroup>
  )
}

export const activationModule: VizModule<ActivationParams> = {
  roles: xyLabelRoles, datasets: ['ml-moons', 'ml-clusters', 'ml-spiral'], defaultParams: { layers: 3, hidden: 8, act: 'relu', epochs: 60, sample: 0, stage: 'trained' },
  Chart: ActivationChart, Controls: ActivationControls, hint: '학습 전후의 활성화 분포를 비교하고, 관측값을 바꿔 신호가 층을 지나는 모습을 따라가 보세요',
}
