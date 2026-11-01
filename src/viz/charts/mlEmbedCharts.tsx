import { useDeferredValue, useMemo } from 'react'
import { ChartMessage } from '../../components/chart/primitives'
import { ControlGroup, Hint, Slider, Toggle } from '../../components/controls'
import { fmt } from '../../lib/format'
import { standardize, trustworthiness, tsne, umap } from '../../stats/ml'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { XYPlot, type Layer } from './kit'
import { featLabelRoles, featLabelled } from './mlShared'

const needFeat = <ChartMessage>특징 열 2개 이상과 클래스(색) 열을 선택하세요. 행은 8개 이상이어야 합니다.</ChartMessage>
const MAX_ROWS = 400

function prepare(data: ReturnType<typeof featLabelled>, std: boolean) {
  if (!data || data.X.length < 8) return null
  const n = Math.min(MAX_ROWS, data.X.length)
  const X = data.X.slice(0, n)
  return { X: std ? standardize(X).Z : X, n }
}

function scatterLayers(data: NonNullable<ReturnType<typeof featLabelled>>, Y: number[][], extraTip?: (i: number) => string): Layer[] {
  return data.classes.map((c, k): Layer => ({
    kind: 'points', label: c, color: data.color(c),
    pts: Y.map((p, i) => ({ p, i })).filter(({ i }) => data.y[i] === k).map(({ p, i }) => ({ x: p[0], y: p[1], key: `p${i}`, tip: <><b>{c}</b> · 행 {data.rows[i] + 1}{extraTip ? <><br />{extraTip(i)}</> : null}</> })),
  }))
}

// ─── t-SNE ──────────────────────────────────────────────────────────────────────────

export interface TsneParams { perplexity: number; iterations: number; learningRate: number; seed: number; standardize: boolean }

function TsneChart({ table, mapping, params, width, height, compact }: ChartProps<TsneParams>) {
  const data = useMemo(() => featLabelled(table, mapping), [table, mapping])
  const p = useDeferredValue(params)
  const res = useMemo(() => {
    const prep = prepare(data, p.standardize)
    if (!data || !prep) return null
    const r = tsne(prep.X, { perplexity: Math.min(p.perplexity, (prep.n - 1) / 3), iters: compact ? Math.min(150, p.iterations) : p.iterations, lr: p.learningRate, seed: p.seed })
    return { ...r, n: prep.n, trust: trustworthiness(prep.X, r.Y, Math.min(10, prep.n - 2)) }
  }, [data, p.perplexity, p.iterations, p.learningRate, p.seed, p.standardize, compact])
  if (!data || !res) return needFeat
  return (
    <XYPlot layers={scatterLayers(data, res.Y)} width={width} height={height} compact={compact} xLabel="t-SNE 1" yLabel="t-SNE 2" title={`t-SNE 임베딩: 퍼플렉서티 ${p.perplexity}`} grid={false}
      xFormat={() => ''} yFormat={() => ''}
      readout={[{ label: 'KL(P‖Q)', value: fmt(res.kl, 3) }, { label: '신뢰도(k=10)', value: fmt(res.trust, 3) }, { label: '점', value: res.n }]}
      note="축의 값과 군집 사이의 거리·군집 크기는 해석하지 않습니다 (이웃 관계만 의미가 있음)" />
  )
}

function TsneControls({ params, setParams }: ControlsProps<TsneParams>) {
  return (
    <ControlGroup title="t-SNE">
      <Slider label="퍼플렉서티" value={params.perplexity} min={2} max={60} onChange={(perplexity) => setParams({ perplexity })} testId="ctl-perplexity" />
      <Slider label="반복 횟수" value={params.iterations} min={100} max={800} step={50} onChange={(iterations) => setParams({ iterations })} testId="ctl-iterations" />
      <Slider label="학습률" value={params.learningRate} min={10} max={500} step={10} onChange={(learningRate) => setParams({ learningRate })} testId="ctl-lr" />
      <Slider label="초기화 시드" value={params.seed} min={1} max={30} onChange={(seed) => setParams({ seed })} testId="ctl-seed" />
      <Toggle label="특징을 표준화" checked={params.standardize} onChange={(standardize) => setParams({ standardize })} />
      <Hint>모든 점 쌍의 거리에서 가우시안 유사도 p(j|i)를 만들되 각 점의 폭을 이분법으로 조절해 엔트로피가 log(퍼플렉서티)가 되게 하고, 2차원에서는 스튜던트 t(자유도 1) 유사도 q를 둔 뒤 KL(P‖Q)를 경사하강(모멘텀·적응 이득·초기 과장 포함)으로 줄입니다. 퍼플렉서티는 ‘유효 이웃 수’로, 너무 작으면 군집이 쪼개지고 너무 크면 구조가 뭉개집니다. 점이 400개를 넘으면 앞의 400개만 사용합니다.</Hint>
    </ControlGroup>
  )
}

export const tsneModule: VizModule<TsneParams> = {
  roles: featLabelRoles(12), datasets: ['ml-highdim', 'ml-swissroll'], defaultParams: { perplexity: 20, iterations: 400, learningRate: 100, seed: 1, standardize: true },
  Chart: TsneChart, Controls: TsneControls, hint: '퍼플렉서티와 시드를 바꿔도 변하지 않는 구조만 믿으세요 · 점에 올리면 원래 행',
}

// ─── UMAP ───────────────────────────────────────────────────────────────────────────

export interface UmapParams { neighbors: number; minDist: number; epochs: number; seed: number; standardize: boolean; edges: boolean }

function UmapChart({ table, mapping, params, width, height, compact }: ChartProps<UmapParams>) {
  const data = useMemo(() => featLabelled(table, mapping), [table, mapping])
  const p = useDeferredValue(params)
  const res = useMemo(() => {
    const prep = prepare(data, p.standardize)
    if (!data || !prep) return null
    const r = umap(prep.X, { nNeighbors: Math.min(p.neighbors, prep.n - 2), minDist: p.minDist, epochs: compact ? 80 : p.epochs, seed: p.seed })
    return { ...r, n: prep.n, trust: trustworthiness(prep.X, r.Y, Math.min(10, prep.n - 2)) }
  }, [data, p.neighbors, p.minDist, p.epochs, p.seed, p.standardize, compact])
  if (!data || !res) return needFeat
  return (
    <XYPlot layers={scatterLayers(data, res.Y)} width={width} height={height} compact={compact} xLabel="UMAP 1" yLabel="UMAP 2" title={`UMAP 임베딩: 이웃 ${p.neighbors}, 최소 거리 ${p.minDist}`} grid={false}
      xFormat={() => ''} yFormat={() => ''}
      extra={({ x, y }) => (p.edges && !compact ? (
        <g stroke="#6b7280" strokeLinecap="round">{res.graph.filter((e) => e.w > 0.25).map((e, k) => <line key={k} x1={x(res.Y[e.i][0])} y1={y(res.Y[e.i][1])} x2={x(res.Y[e.j][0])} y2={y(res.Y[e.j][1])} strokeOpacity={0.08 + 0.3 * e.w} strokeWidth={0.6 + e.w} />)}</g>
      ) : null)}
      readout={[{ label: 'a, b', value: `${fmt(res.a, 2)}, ${fmt(res.b, 2)}` }, { label: '신뢰도(k=10)', value: fmt(res.trust, 3) }, { label: '그래프 간선', value: res.graph.length }]}
      note="축의 값은 의미가 없습니다 · 군집 사이의 거리는 t-SNE처럼 조심해서 해석" />
  )
}

function UmapControls({ params, setParams }: ControlsProps<UmapParams>) {
  return (
    <ControlGroup title="UMAP">
      <Slider label="이웃 수 n_neighbors" value={params.neighbors} min={3} max={50} onChange={(neighbors) => setParams({ neighbors })} testId="ctl-neighbors" />
      <Slider label="최소 거리 min_dist" value={params.minDist} min={0.01} max={0.99} step={0.01} onChange={(minDist) => setParams({ minDist })} testId="ctl-mindist" />
      <Slider label="최적화 epoch" value={params.epochs} min={50} max={500} step={25} onChange={(epochs) => setParams({ epochs })} testId="ctl-epochs" />
      <Slider label="시드" value={params.seed} min={1} max={30} onChange={(seed) => setParams({ seed })} testId="ctl-seed" />
      <Toggle label="특징을 표준화" checked={params.standardize} onChange={(standardize) => setParams({ standardize })} />
      <Toggle label="근접 그래프의 간선 표시" checked={params.edges} onChange={(edges) => setParams({ edges })} />
      <Hint>원래 공간의 정확한 k-최근접 이웃에서, 가장 가까운 이웃까지의 거리(ρ)를 뺀 거리로 소속 강도 exp(−(d−ρ)/σ)를 만들고 σ는 합이 log₂k가 되도록 정합니다. 두 방향의 강도를 a+b−ab로 합쳐 가중 그래프를 만든 뒤, 2차원 배치가 1/(1+a·d²ᵇ) 형태의 유사도로 이 그래프를 재현하도록 인력·반발(음성 표본)로 최적화합니다. 초기 배치는 PCA입니다. 최소 거리를 줄이면 점이 더 빽빽이 뭉칩니다.</Hint>
    </ControlGroup>
  )
}

export const umapModule: VizModule<UmapParams> = {
  roles: featLabelRoles(12), datasets: ['ml-highdim', 'ml-swissroll'], defaultParams: { neighbors: 15, minDist: 0.1, epochs: 200, seed: 1, standardize: true, edges: false },
  Chart: UmapChart, Controls: UmapControls, hint: '이웃 수는 지역 구조와 전역 구조 사이의 균형을, 최소 거리는 점이 뭉치는 정도를 정합니다',
}
