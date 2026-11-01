import * as d3 from 'd3'
import { useMemo, useState } from 'react'
import { ChartMessage } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { schemes } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import {
  accuracy, argmax, classMetrics, confusion, crossValidate, fitTree, kmeans, learningCurve, makeFit, outOfFold, predictAll, shuffled, silhouette, standardize, type Fit, type ModelSpec, type TreeNode,
} from '../../stats/ml'
import { createRng } from '../../lib/random'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, RoleSpec, VizModule } from '../types'
import { HeatGrid, Stage, XYPlot, useStage, type Layer } from './kit'
import { ModelPicker, featLabelRoles, featLabelled, modelDefaults, specName, specOf, xyLabelRoles, xyLabelled, type ModelParams } from './mlShared'
import { columnIndex, toLabel, toNumber } from '../../data/table'

const MIN_ROWS = 8
/** k-means with six seeded restarts, keeping the lowest inertia (a single Lloyd run often lands in a poor local optimum). */
const bestKmeans = (Z: number[][], k: number) => Array.from({ length: 6 }, (_, s) => kmeans(Z, k, s + 1)).reduce((a, b) => (b.inertia < a.inertia ? b : a))
const need = <ChartMessage>2개의 숫자형 특징 열과 클래스(범주형) 열을 선택하세요. 행이 8개 이상, 클래스가 2개 이상 필요합니다.</ChartMessage>
const specKey = (p: ModelParams) => JSON.stringify(specOf(p))

// ─── confusion matrix ───────────────────────────────────────────────────────────────

export interface ConfusionParams extends ModelParams { eval: 'oof' | 'train'; norm: 'count' | 'recall' | 'precision' }

function ConfusionChart({ table, mapping, params, width, height, compact }: ChartProps<ConfusionParams>) {
  const data = useMemo(() => xyLabelled(table, mapping), [table, mapping])
  const key = specKey(params)
  const res = useMemo(() => {
    if (!data || data.X.length < MIN_ROWS || data.classes.length < 2) return null
    const fit = makeFit(JSON.parse(key) as ModelSpec, data.classes.length)
    let pred: number[]
    if (params.eval === 'train') pred = predictAll(fit(data.X, data.y), data.X)
    else pred = outOfFold(fit, data.X, data.y, 5, 1).map((p) => (p ? argmax(p) : -1))
    const keep = data.y.map((_, i) => i).filter((i) => pred[i] >= 0)
    const m = confusion(keep.map((i) => data.y[i]), keep.map((i) => pred[i]), data.classes.length)
    return { m, met: classMetrics(m) }
  }, [data, key, params.eval])
  if (!data || !res) return need
  const k = data.classes.length
  const rowSum = res.m.map((r) => d3.sum(r)), colSum = res.m[0].map((_, j) => d3.sum(res.m.map((r) => r[j])))
  const val = (i: number, j: number) => (params.norm === 'count' ? res.m[i][j] : params.norm === 'recall' ? (rowSum[i] ? res.m[i][j] / rowSum[i] : 0) : colSum[j] ? res.m[i][j] / colSum[j] : 0)
  const values = res.m.map((r, i) => r.map((_, j) => val(i, j)))
  const vmax = params.norm === 'count' ? Math.max(1, ...res.m.flat()) : 1
  const sch = schemes.blues
  return (
    <HeatGrid rows={data.classes} cols={data.classes} values={values} width={width} height={height} compact={compact} square rowTitle="실제 클래스" colTitle="예측 클래스" rightPad={compact ? 6 : 96} bottomPad={44}
      title={`혼동행렬: ${specName(params)}, 정확도 ${pct(res.met.accuracy)}`}
      color={(v) => sch.interpolate(0.08 + (0.92 * v) / vmax)}
      text={(v, i, j) => (params.norm === 'count' ? String(res.m[i][j]) : `${(v * 100).toFixed(0)}%`)}
      mark={(i, j) => i === j}
      tip={(i, j) => <><b>실제 {data.classes[i]} → 예측 {data.classes[j]}</b><br />{res.m[i][j]}건 · 실제 {data.classes[i]}의 {pct(rowSum[i] ? res.m[i][j] / rowSum[i] : 0)}<br />예측 {data.classes[j]}의 {pct(colSum[j] ? res.m[i][j] / colSum[j] : 0)}</>}
      readout={[{ label: '정확도', value: pct(res.met.accuracy) }, { label: '매크로 F1', value: fmt(res.met.macroF1, 3) }, { label: '평가', value: params.eval === 'oof' ? '5겹 교차검증' : '학습 데이터' }]}
      extra={({ cw, ch }) => compact ? null : (
        <g fontSize={11} fill="#374151">
          <text x={k * cw + 8} y={-8} fontSize={10.5} fill="#6b7280">재현율</text>
          {data.classes.map((_, i) => <text key={`r${i}`} x={k * cw + 8} y={i * ch + ch / 2} dy="0.34em">{pct(res.met.recall[i], 0)}</text>)}
          <text x={-4} y={k * ch + 34} fontSize={10.5} fill="#6b7280" textAnchor="end">정밀도</text>
          {data.classes.map((_, j) => <text key={`p${j}`} x={j * cw + cw / 2} y={k * ch + 34} textAnchor="middle">{pct(res.met.precision[j], 0)}</text>)}
        </g>
      )}
    />
  )
}

function ConfusionControls({ params, setParams }: ControlsProps<ConfusionParams>) {
  return (
    <>
      <ModelPicker params={params} setParams={setParams} />
      <ControlGroup title="평가와 표시">
        <Segmented label="평가 데이터" value={params.eval} onChange={(v) => setParams({ eval: v })} testId="ctl-eval" options={[{ value: 'oof', label: '5겹 교차검증' }, { value: 'train', label: '학습 데이터' }]} />
        <Segmented label="셀 값" value={params.norm} onChange={(v) => setParams({ norm: v })} testId="ctl-norm" options={[{ value: 'count', label: '개수' }, { value: 'recall', label: '행 비율' }, { value: 'precision', label: '열 비율' }]} />
        <Hint>행은 실제 클래스, 열은 예측 클래스입니다. 대각선이 맞힌 개수이고 오른쪽 재현율은 행 비율의 대각 성분, 아래 정밀도는 열 비율의 대각 성분입니다. 교차검증은 각 행을 그 행을 보지 않은 모델로 예측해, 학습 데이터로 평가할 때의 낙관적 편향을 줄입니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const confusionModule: VizModule<ConfusionParams> = {
  roles: xyLabelRoles, datasets: ['ml-clusters', 'ml-moons', 'ml-spiral'],
  defaultParams: { ...modelDefaults, model: 'knn', k: 7, eval: 'oof', norm: 'count' },
  Chart: ConfusionChart, Controls: ConfusionControls,
  hint: '모델을 바꾸면 같은 데이터에서 어떤 클래스끼리 헷갈리는지가 달라집니다 · 셀에 올려 개수와 비율 확인',
}

// ─── decision boundary ──────────────────────────────────────────────────────────────

export interface BoundaryParams extends ModelParams { holdout: number; resolution: number; confidence: boolean }

function BoundaryChart({ table, mapping, params, width, height, compact }: ChartProps<BoundaryParams>) {
  const data = useMemo(() => xyLabelled(table, mapping), [table, mapping])
  const key = specKey(params)
  const res = useMemo(() => {
    if (!data || data.X.length < MIN_ROWS || data.classes.length < 2) return null
    const order = shuffled(data.X.length, createRng(11))
    const nTest = Math.round(data.X.length * params.holdout)
    const test = new Set(order.slice(0, nTest))
    const tr = data.X.map((_, i) => i).filter((i) => !test.has(i)), te = [...test]
    const clf = makeFit(JSON.parse(key) as ModelSpec, data.classes.length)(tr.map((i) => data.X[i]), tr.map((i) => data.y[i]))
    const xs = data.X.map((r) => r[0]), ys = data.X.map((r) => r[1])
    const padx = (d3.max(xs)! - d3.min(xs)!) * 0.08 || 1, pady = (d3.max(ys)! - d3.min(ys)!) * 0.08 || 1
    const x0 = d3.min(xs)! - padx, x1 = d3.max(xs)! + padx, y0 = d3.min(ys)! - pady, y1 = d3.max(ys)! + pady
    const n = compact ? 28 : params.resolution
    const k = data.classes.length
    const z: number[] = []
    for (let r = 0; r < n; r++) for (let q = 0; q < n; q++) {
      const p = clf.proba([x0 + ((q + 0.5) / n) * (x1 - x0), y0 + ((r + 0.5) / n) * (y1 - y0)])
      const c = argmax(p)
      z.push(c + Math.min(0.999, Math.max(0, (p[c] - 1 / k) / (1 - 1 / k))))
    }
    const trainAcc = accuracy(clf, tr.map((i) => data.X[i]), tr.map((i) => data.y[i]))
    const testAcc = te.length ? accuracy(clf, te.map((i) => data.X[i]), te.map((i) => data.y[i])) : NaN
    return { tr, te, z, n, x0, x1, y0, y1, trainAcc, testAcc, clf }
  }, [data, key, params.holdout, params.resolution, compact])
  if (!data || !res) return need
  const layers: Layer[] = [
    { kind: 'raster', nx: res.n, ny: res.n, z: res.z, x0: res.x0, x1: res.x1, y0: res.y0, y1: res.y1, opacity: 0.9, color: (v) => { const c = Math.floor(v), conf = params.confidence ? v - c : 0.7; return d3.interpolateRgb('#ffffff', data.color(data.classes[c]))(0.12 + 0.5 * conf) } },
    ...data.classes.map((cl, c): Layer => ({
      kind: 'points', label: cl, color: data.color(cl),
      pts: res.tr.filter((i) => data.y[i] === c).map((i) => ({ x: data.X[i][0], y: data.X[i][1], key: `t${i}`, tip: <><b>{cl}</b> (학습) · 행 {data.rows[i] + 1}<br />({fmt(data.X[i][0])}, {fmt(data.X[i][1])})<br />예측 {data.classes[argmax(res.clf.proba(data.X[i]))]}</> })),
    })),
    ...data.classes.map((cl, c): Layer => ({
      kind: 'points', color: '#ffffff', stroke: data.color(cl), r: compact ? 2.4 : 4.6,
      pts: res.te.filter((i) => data.y[i] === c).map((i) => ({ x: data.X[i][0], y: data.X[i][1], key: `v${i}`, tip: <><b>{cl}</b> (검증) · 행 {data.rows[i] + 1}<br />예측 {data.classes[argmax(res.clf.proba(data.X[i]))]}</> })),
    })),
  ]
  return (
    <XYPlot layers={layers} width={width} height={height} compact={compact} xLabel={roleColumn(mapping, 'x') ?? ''} yLabel={roleColumn(mapping, 'y') ?? ''} title={`결정 경계: ${specName(params)}`} pad={0} grid={false}
      readout={[{ label: '학습 정확도', value: pct(res.trainAcc) }, { label: '검증 정확도', value: Number.isNaN(res.testAcc) ? '–' : pct(res.testAcc) }]}
      note="배경색 = 모델이 예측한 클래스(진할수록 확신), 속이 찬 점 = 학습, 속이 빈 점 = 검증" />
  )
}

function BoundaryControls({ params, setParams }: ControlsProps<BoundaryParams>) {
  return (
    <>
      <ModelPicker params={params} setParams={setParams} />
      <ControlGroup title="표시">
        <Slider label="검증으로 떼어 둘 비율" value={params.holdout} min={0} max={0.5} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(holdout) => setParams({ holdout })} testId="ctl-holdout" />
        <Slider label="배경 해상도" value={params.resolution} min={20} max={70} step={2} onChange={(resolution) => setParams({ resolution })} testId="ctl-res" />
        <Toggle label="확신도를 색 진하기로" checked={params.confidence} onChange={(confidence) => setParams({ confidence })} />
        <Hint>배경은 격자의 각 지점에서 학습된 모델이 실제로 예측한 클래스입니다. 검증 점(속이 빈 점)을 배경과 비교하면 과적합을 눈으로 확인할 수 있습니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const boundaryModule: VizModule<BoundaryParams> = {
  roles: xyLabelRoles, datasets: ['ml-moons', 'ml-clusters', 'ml-spiral'],
  defaultParams: { ...modelDefaults, model: 'knn', k: 5, holdout: 0.25, resolution: 44, confidence: true },
  Chart: BoundaryChart, Controls: BoundaryControls,
  hint: '모델과 하이퍼파라미터를 바꿔 경계가 얼마나 복잡해지는지 보세요 · 속이 빈 점은 학습에 쓰지 않은 검증 데이터',
}

// ─── learning curve ─────────────────────────────────────────────────────────────────

export interface LearningParams extends ModelParams { folds: number; steps: number }

function LearningChart({ table, mapping, params, width, height, compact }: ChartProps<LearningParams>) {
  const data = useMemo(() => xyLabelled(table, mapping), [table, mapping])
  const key = specKey(params)
  const curve = useMemo(() => {
    if (!data || data.X.length < 20 || data.classes.length < 2) return null
    const fracs = Array.from({ length: params.steps }, (_, i) => 0.1 + (0.9 * i) / Math.max(1, params.steps - 1))
    return learningCurve(makeFit(JSON.parse(key) as ModelSpec, data.classes.length), data.X, data.y, fracs, params.folds, 3)
  }, [data, key, params.folds, params.steps])
  if (!data || !curve) return <ChartMessage>2개의 숫자형 특징과 클래스 열이 필요하고 행이 20개 이상이어야 합니다.</ChartMessage>
  const x = curve.map((c) => c.x)
  const last = curve[curve.length - 1]
  return (
    <XYPlot hover width={width} height={height} compact={compact} xLabel="학습에 쓴 표본 수" yLabel="정확도" title={`학습 곡선: ${specName(params)}`} yDomain={[Math.max(0, Math.min(...curve.map((c) => Math.min(c.train, c.valid) - 0.06))), 1.02]} yFormat={(v) => pct(v, 0)}
      layers={[
        { kind: 'band', x, lo: curve.map((c) => c.train - c.trainSd), hi: curve.map((c) => c.train + c.trainSd), color: '#2a8c82' },
        { kind: 'band', x, lo: curve.map((c) => c.valid - c.validSd), hi: curve.map((c) => c.valid + c.validSd), color: '#e07a3f' },
        { kind: 'line', x, y: curve.map((c) => c.train), label: '훈련 점수', color: '#2a8c82' },
        { kind: 'line', x, y: curve.map((c) => c.valid), label: '검증 점수', color: '#e07a3f' },
      ]}
      readout={[{ label: '훈련', value: pct(last.train) }, { label: '검증', value: pct(last.valid) }, { label: '격차', value: pct(last.train - last.valid) }]}
      note="띠 = 교차검증 겹 사이 ±1 표준편차" />
  )
}

function LearningControls({ params, setParams }: ControlsProps<LearningParams>) {
  return (
    <>
      <ModelPicker params={params} setParams={setParams} />
      <ControlGroup title="곡선">
        <Slider label="교차검증 겹 수" value={params.folds} min={2} max={10} onChange={(folds) => setParams({ folds })} testId="ctl-folds" />
        <Slider label="학습 규모 단계 수" value={params.steps} min={3} max={12} onChange={(steps) => setParams({ steps })} testId="ctl-steps" />
        <Hint>각 겹에서 훈련 부분의 앞 m개만으로 모델을 학습해 훈련 점수와 검증 점수를 잽니다. 두 곡선이 벌어져 있으면 분산(과적합), 둘 다 낮게 붙어 있으면 편향(과소적합)을 의심하고, 검증 곡선이 계속 오르고 있다면 데이터를 더 모으면 도움이 됩니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const learningModule: VizModule<LearningParams> = {
  roles: xyLabelRoles, datasets: ['ml-clusters', 'ml-moons', 'ml-spiral'],
  defaultParams: { ...modelDefaults, model: 'tree', depth: 8, minLeaf: 1, folds: 5, steps: 8 },
  Chart: LearningChart, Controls: LearningControls,
  hint: '모델의 복잡도를 바꿔 훈련·검증 곡선 사이의 간격이 어떻게 변하는지 보세요',
}

// ─── validation curve ───────────────────────────────────────────────────────────────

export interface ValidationParams { family: 'knn' | 'tree' | 'logistic' | 'mlp'; folds: number }

const HP: Record<ValidationParams['family'], { label: string; values: number[]; spec: (v: number) => ModelSpec; note: string }> = {
  knn: { label: '이웃 수 k', values: [1, 2, 3, 5, 7, 10, 15, 20, 30, 40], spec: (k) => ({ kind: 'knn', k }), note: 'k가 작을수록 유연(분산 큼), 클수록 단순(편향 큼)' },
  tree: { label: '트리 최대 깊이', values: [1, 2, 3, 4, 5, 6, 8, 10, 12], spec: (d) => ({ kind: 'tree', maxDepth: d, minLeaf: 1 }), note: '깊을수록 유연해져 훈련 데이터를 외웁니다' },
  logistic: { label: '다항 차수', values: [1, 2, 3, 4, 5, 6], spec: (d) => ({ kind: 'logistic', degree: d, l2: 0.001 }), note: '차수가 높을수록 곡선 경계를 만들 수 있습니다' },
  mlp: { label: '은닉 뉴런 수', values: [1, 2, 3, 4, 6, 8, 12, 16, 24], spec: (h) => ({ kind: 'mlp', hidden: h, epochs: 60 }), note: '뉴런이 많을수록 표현력이 큽니다' },
}

function ValidationChart({ table, mapping, params, width, height, compact }: ChartProps<ValidationParams>) {
  const data = useMemo(() => xyLabelled(table, mapping), [table, mapping])
  const hp = HP[params.family]
  const rows = useMemo(() => {
    if (!data || data.X.length < 20 || data.classes.length < 2) return null
    return hp.values.map((v) => ({ v, cv: crossValidate(makeFit(hp.spec(v), data.classes.length), data.X, data.y, params.folds, 5) }))
  }, [data, hp, params.folds])
  if (!data || !rows) return <ChartMessage>2개의 숫자형 특징과 클래스 열이 필요하고 행이 20개 이상이어야 합니다.</ChartMessage>
  const x = rows.map((r) => r.v)
  const best = rows.reduce((b, r) => (r.cv.validMean > b.cv.validMean ? r : b), rows[0])
  return (
    <XYPlot hover width={width} height={height} compact={compact} xLabel={hp.label} yLabel="정확도" title={`검증 곡선: ${hp.label}`} yFormat={(v) => pct(v, 0)} yDomain={[Math.max(0, Math.min(...rows.map((r) => Math.min(r.cv.trainMean, r.cv.validMean))) - 0.08), 1.02]}
      layers={[
        { kind: 'band', x, lo: rows.map((r) => r.cv.trainMean - r.cv.trainSd), hi: rows.map((r) => r.cv.trainMean + r.cv.trainSd), color: '#2a8c82' },
        { kind: 'band', x, lo: rows.map((r) => r.cv.validMean - r.cv.validSd), hi: rows.map((r) => r.cv.validMean + r.cv.validSd), color: '#e07a3f' },
        { kind: 'line', x, y: rows.map((r) => r.cv.trainMean), label: '훈련 점수', color: '#2a8c82' },
        { kind: 'line', x, y: rows.map((r) => r.cv.validMean), label: '검증 점수', color: '#e07a3f' },
        { kind: 'vline', v: best.v, color: '#111827' },
      ]}
      readout={[{ label: '최적', value: `${hp.label} ${best.v}` }, { label: '검증', value: pct(best.cv.validMean) }]}
      note={hp.note} />
  )
}

function ValidationControls({ params, setParams }: ControlsProps<ValidationParams>) {
  return (
    <ControlGroup title="하이퍼파라미터">
      <Segmented label="모델" value={params.family} onChange={(family) => setParams({ family })} testId="ctl-family" options={[{ value: 'knn', label: 'kNN' }, { value: 'tree', label: '트리' }, { value: 'logistic', label: '로지스틱' }, { value: 'mlp', label: '신경망' }]} />
      <Slider label="교차검증 겹 수" value={params.folds} min={2} max={10} onChange={(folds) => setParams({ folds })} testId="ctl-folds" />
      <Hint>하이퍼파라미터 하나만 바꾸며 모델을 다시 학습해 훈련·검증 점수를 비교합니다. 검증 점수가 최고인 지점(검은 선)이 이 데이터에서 균형이 가장 좋은 복잡도입니다. 그 오른쪽에서 훈련 점수만 오르면 과적합입니다.</Hint>
    </ControlGroup>
  )
}

export const validationModule: VizModule<ValidationParams> = {
  roles: xyLabelRoles, datasets: ['ml-clusters', 'ml-moons', 'ml-spiral'],
  defaultParams: { family: 'tree', folds: 5 },
  Chart: ValidationChart, Controls: ValidationControls,
  hint: '모델 종류를 바꾸며 복잡도에 따른 훈련·검증 점수의 갈림길을 찾아보세요',
}

// ─── hyper-parameter landscape ──────────────────────────────────────────────────────

export interface LandscapeParams { family: 'tree' | 'logistic' | 'mlp'; folds: number }

interface Grid { rowLabel: string; colLabel: string; rows: number[]; cols: number[]; fit: (r: number, c: number, k: number) => Fit }
function gridFor(f: LandscapeParams['family']): Grid {
  if (f === 'tree') return { rowLabel: '리프 최소 표본', colLabel: '최대 깊이', rows: [1, 2, 4, 8, 12, 16, 24, 32], cols: [1, 2, 3, 4, 5, 6, 7, 8], fit: (r, c, k) => makeFit({ kind: 'tree', maxDepth: c, minLeaf: r }, k) }
  if (f === 'logistic') return { rowLabel: 'L2 규제 (10^x)', colLabel: '다항 차수', rows: [-4, -3, -2, -1, 0, 1, 2], cols: [1, 2, 3, 4, 5, 6], fit: (r, c, k) => (X, y) => makeFit({ kind: 'logistic', degree: c, l2: 10 ** r }, k)(X, y) }
  return { rowLabel: '학습 epoch', colLabel: '은닉 뉴런 수', rows: [10, 20, 40, 80, 120], cols: [1, 2, 4, 8, 16, 32], fit: (r, c, k) => makeFit({ kind: 'mlp', hidden: c, epochs: r }, k) }
}

function LandscapeChart({ table, mapping, params, width, height, compact }: ChartProps<LandscapeParams>) {
  const data = useMemo(() => xyLabelled(table, mapping), [table, mapping])
  const g = useMemo(() => gridFor(params.family), [params.family])
  const [pick, setPick] = useState<[number, number] | null>(null)
  const z = useMemo(() => {
    if (!data || data.X.length < 20 || data.classes.length < 2) return null
    return g.rows.map((r) => g.cols.map((c) => crossValidate(g.fit(r, c, data.classes.length), data.X, data.y, params.folds, 9).validMean))
  }, [data, g, params.folds])
  if (!data || !z) return <ChartMessage>2개의 숫자형 특징과 클래스 열이 필요하고 행이 20개 이상이어야 합니다.</ChartMessage>
  let bi = 0, bj = 0
  z.forEach((row, i) => row.forEach((v, j) => { if (v > z[bi][bj]) { bi = i; bj = j } }))
  const sel = pick && pick[0] < z.length && pick[1] < z[0].length ? pick : [bi, bj] as [number, number]
  const lo = Math.min(...z.flat()), hi = Math.max(...z.flat())
  return (
    <HeatGrid rows={g.rows.map(String)} cols={g.cols.map(String)} values={z} width={width} height={height} compact={compact} rowTitle={g.rowLabel} colTitle={g.colLabel} title={`하이퍼파라미터 탐색 지형도: ${g.colLabel} × ${g.rowLabel}`}
      color={(v) => schemes.viridis.interpolate(hi > lo ? (v - lo) / (hi - lo) : 0.5)} text={(v) => pct(v, 0)} mark={(i, j) => i === bi && j === bj} selected={sel} onCell={(i, j) => setPick([i, j])}
      tip={(i, j, v) => <><b>{g.colLabel} {g.cols[j]} · {g.rowLabel} {g.rows[i]}</b><br />교차검증 정확도 {pct(v)}{i === bi && j === bj ? ' (최고)' : ''}</>}
      readout={[{ label: '선택 셀', value: pct(z[sel[0]][sel[1]]) }, { label: '최고', value: `${g.cols[bj]} / ${g.rows[bi]} → ${pct(z[bi][bj])}` }]}
      note="검은 테두리 = 격자에서 가장 높은 점수, 셀을 누르면 선택" />
  )
}

function LandscapeControls({ params, setParams }: ControlsProps<LandscapeParams>) {
  return (
    <ControlGroup title="탐색 격자">
      <Segmented label="모델" value={params.family} onChange={(family) => setParams({ family })} testId="ctl-family" options={[{ value: 'tree', label: '트리' }, { value: 'logistic', label: '로지스틱' }, { value: 'mlp', label: '신경망' }]} />
      <Slider label="교차검증 겹 수" value={params.folds} min={2} max={6} onChange={(folds) => setParams({ folds })} testId="ctl-folds" />
      <Hint>두 하이퍼파라미터의 모든 조합을 교차검증으로 평가한 정확도 지형입니다. 완만한 고원이면 설정에 둔감하고, 좁은 봉우리면 우연히 얻은 최고점일 수 있습니다. 격자 탐색은 조합 수만큼 모델을 학습하므로 조금 느립니다.</Hint>
    </ControlGroup>
  )
}

export const landscapeModule: VizModule<LandscapeParams> = {
  roles: xyLabelRoles, datasets: ['ml-moons', 'ml-clusters', 'ml-spiral'],
  defaultParams: { family: 'tree', folds: 3 },
  Chart: LandscapeChart, Controls: LandscapeControls,
  hint: '셀을 눌러 값을 비교하세요 · 모델 종류를 바꾸면 다른 두 하이퍼파라미터의 지형이 나타납니다',
}

// ─── silhouette plot ────────────────────────────────────────────────────────────────

export interface SilhouetteParams { source: 'kmeans' | 'label'; k: number }

const silhouetteRoles: RoleSpec[] = [
  { key: 'label', label: '기존 군집 / 클래스 (선택)', type: 'category', auto: true },
  { key: 'features', label: '특징 열', type: 'number', required: true, multiple: { min: 2, max: 12 } },
]

function SilhouetteChart({ table, mapping, params, width, height, compact }: ChartProps<SilhouetteParams>) {
  const stage = useStage()
  const cols = roleColumns(mapping, 'features'), lab = roleColumn(mapping, 'label')
  const colsKey = cols.join('|')
  const prepared = useMemo(() => {
    const ci = (colsKey ? colsKey.split('|') : []).map((c) => columnIndex(table, c)), li = columnIndex(table, lab)
    const X: number[][] = [], L: string[] = [], rows: number[] = []
    table.rows.forEach((r, row) => { const v = ci.map((i) => toNumber(r[i])); if (v.some((a) => a == null)) return; X.push(v as number[]); L.push(li >= 0 ? toLabel(r[li]) : ''); rows.push(row) })
    return { X, L, rows }
  }, [table, colsKey, lab])
  const useLabels = params.source === 'label' && !!lab
  const res = useMemo(() => {
    if (prepared.X.length < 6) return null
    const Z = standardize(prepared.X).Z
    const names = [...new Set(prepared.L)]
    const labels = useLabels ? prepared.L.map((l) => names.indexOf(l)) : bestKmeans(Z, Math.max(2, Math.min(params.k, Z.length - 1))).labels
    if (new Set(labels).size < 2) return null
    return { sil: silhouette(Z, labels), labels, names: useLabels ? names : [...new Set(labels)].sort((a, b) => a - b).map((k) => `군집 ${k + 1}`) }
  }, [prepared, params.k, useLabels])
  if (!cols.length || !res) return <ChartMessage>특징 열을 2개 이상 고르세요. 군집이 2개 이상이어야 실루엣을 계산할 수 있습니다.</ChartMessage>
  const m = { top: compact ? 8 : 40, right: compact ? 8 : 24, bottom: compact ? 8 : 58, left: compact ? 8 : 78 }
  const iw = width - m.left - m.right, ih = height - m.top - m.bottom
  const ks = res.sil.clusters
  const gap = compact ? 4 : 12
  const unit = Math.max(0.3, (ih - gap * (ks.length - 1)) / Math.max(1, prepared.X.length))
  const lo = Math.min(-0.1, d3.min(res.sil.s)! - 0.05)
  const x = d3.scaleLinear().domain([lo, 1]).range([0, iw])
  const color = d3.scaleOrdinal<number, string>().domain(ks.map((c) => c.k)).range(['#2a8c82', '#e07a3f', '#4c6fb5', '#d4a53a', '#9b5fb4', '#5d9a4a', '#cf4f6a', '#4a9bc4'])
  let yy = 0
  return (
    <Stage stage={stage} width={width} height={height} compact={compact} label={`실루엣 도표: 평균 ${fmt(res.sil.mean, 3)}`}
      readout={[{ label: '평균 실루엣', value: fmt(res.sil.mean, 3) }, { label: '군집 수', value: ks.length }, { label: '음수 비율', value: pct(res.sil.s.filter((v) => v < 0).length / res.sil.s.length) }]}
      note={useLabels ? '기존 열의 값을 군집으로 사용' : `k-평균 (k=${params.k}, 표준화한 특징)`}>
      <g transform={`translate(${m.left},${m.top})`}>
        {!compact && x.ticks(6).map((t) => <g key={t}><line className="grid" x1={x(t)} x2={x(t)} y1={0} y2={ih} stroke="#eef0f2" /><text x={x(t)} y={ih + 18} textAnchor="middle" fontSize={11} fill="#6b7280">{t}</text></g>)}
        {!compact && <text x={iw / 2} y={ih + 38} textAnchor="middle" fontSize={12} fill="#6b7280">실루엣 계수</text>}
        {ks.map((c) => {
          const members = prepared.X.map((_, i) => i).filter((i) => res.labels[i] === c.k).sort((a, b) => res.sil.s[b] - res.sil.s[a])
          const y0 = yy
          yy += members.length * unit + gap
          return (
            <g key={c.k} transform={`translate(0,${y0})`}>
              {members.map((i, r) => (
                <rect key={i} data-testid="sil-bar" x={Math.min(x(0), x(res.sil.s[i]))} y={r * unit} width={Math.abs(x(res.sil.s[i]) - x(0))} height={Math.max(0.4, unit - 0.15)} fill={color(c.k)}
                  onPointerEnter={compact ? undefined : (e) => stage.at(e, <><b>{res.names[c.k] ?? c.k}</b> · 행 {prepared.rows[i] + 1}<br />s = {fmt(res.sil.s[i], 3)}</>)} />
              ))}
              {!compact && <text x={-8} y={(members.length * unit) / 2} dy="0.34em" textAnchor="end" fontSize={11.5} fill="#374151">{res.names[c.k] ?? c.k}<tspan x={-8} dy="1.15em" fontSize={10.5} fill="#6b7280">평균 {fmt(c.mean, 2)}</tspan></text>}
            </g>
          )
        })}
        <line x1={x(res.sil.mean)} x2={x(res.sil.mean)} y1={-4} y2={ih} stroke="#cf4f6a" strokeDasharray="5 4" strokeWidth={1.6} />
        <line x1={x(0)} x2={x(0)} y1={-4} y2={ih} stroke="#111827" strokeWidth={1} />
      </g>
    </Stage>
  )
}

function SilhouetteControls({ params, setParams, mapping }: ControlsProps<SilhouetteParams>) {
  const has = !!roleColumn(mapping, 'label')
  return (
    <ControlGroup title="군집">
      <Segmented label="군집 기준" value={params.source} onChange={(source) => setParams({ source })} testId="ctl-source" options={[{ value: 'kmeans', label: 'k-평균' }, { value: 'label', label: '열의 값' }]} />
      <Slider label="k-평균의 군집 수 k" value={params.k} min={2} max={10} onChange={(k) => setParams({ k })} testId="ctl-k" disabled={params.source === 'label' && has} />
      <Hint>각 관측값의 실루엣 s = (b − a) / max(a, b)입니다. a는 같은 군집 안 평균 거리, b는 가장 가까운 다른 군집까지의 평균 거리입니다. 막대가 길고 군집 사이 폭이 비슷하며 점선(평균)보다 짧은 군집이 적을수록 군집이 잘 나뉜 것입니다. 음수는 다른 군집에 더 가까운 관측값입니다.</Hint>
    </ControlGroup>
  )
}

export const silhouetteModule: VizModule<SilhouetteParams> = {
  roles: silhouetteRoles, datasets: ['ml-highdim', 'ml-clusters', 'ml-swissroll'],
  defaultParams: { source: 'kmeans', k: 4 },
  Chart: SilhouetteChart, Controls: SilhouetteControls,
  hint: 'k를 바꾸며 평균 실루엣(빨간 점선)이 가장 높은 군집 수를 찾아보세요 · 막대에 올리면 관측값별 s',
}

// ─── decision tree ──────────────────────────────────────────────────────────────────

export interface TreeParams { depth: number; minLeaf: number; showCounts: boolean }

function TreeChart({ table, mapping, params, width, height, compact }: ChartProps<TreeParams>) {
  const stage = useStage()
  const data = useMemo(() => featLabelled(table, mapping), [table, mapping])
  const tree = useMemo(() => (data && data.X.length >= MIN_ROWS && data.classes.length >= 2 ? fitTree(data.X, data.y, data.classes.length, params.depth, params.minLeaf) : null), [data, params.depth, params.minLeaf])
  const [sel, setSel] = useState<number | null>(null)
  if (!data || !tree) return need
  const h0 = d3.hierarchy<TreeNode>(tree.root, (n) => (n.left && n.right ? [n.left, n.right] : null))
  const leaves = h0.leaves().length
  const nodeW = compact ? 20 : 112, nodeH = compact ? 12 : 58
  const needW = (leaves - 1) * (nodeW + 14) + nodeW, needH = h0.height * (nodeH + 36) + nodeH
  const margin = compact ? 6 : 16
  const scale = Math.min(1, (width - 2 * margin) / needW, (height - 2 * margin - 40) / needH)
  const root = d3.tree<TreeNode>().nodeSize([nodeW + 14, nodeH + 36]).separation(() => 1)(h0)
  const nodes = root.descendants()
  const xMin = Math.min(...nodes.map((d) => d.x))
  const offX = (width - needW * scale) / 2 - xMin * scale
  const acc = accuracy(tree, data.X, data.y)
  const path = new Set<number>()
  if (sel != null) { const n = nodes.find((d) => d.data.id === sel); n?.ancestors().forEach((a) => path.add(a.data.id)) }
  const name = (j: number) => data.names[j] ?? `특징 ${j + 1}`
  return (
    <Stage stage={stage} width={width} height={height} compact={compact} label={`결정 트리: 리프 ${leaves}개, 학습 정확도 ${pct(acc)}`}
      readout={[{ label: '리프', value: leaves }, { label: '깊이', value: root.height }, { label: '학습 정확도', value: pct(acc) }]} note="노드를 누르면 루트로부터의 경로를 강조">
      <g transform={`translate(${offX},${margin + 24}) scale(${scale})`}>
        {root.links().map((l, i) => {
          const on = path.has(l.target.data.id)
          return <path key={i} d={`M${l.source.x + nodeW / 2},${l.source.y + nodeH}C${l.source.x + nodeW / 2},${(l.source.y + l.target.y + nodeH) / 2} ${l.target.x + nodeW / 2},${(l.source.y + l.target.y + nodeH) / 2} ${l.target.x + nodeW / 2},${l.target.y}`} fill="none" stroke={on ? '#111827' : '#c7ccd1'} strokeWidth={(on ? 2.4 : 1.2) + (compact ? 0 : Math.min(5, (l.target.data.n / tree.root.n) * 8))} strokeOpacity={on ? 1 : 0.7} />
        })}
        {nodes.map((d) => {
          const n = d.data, leaf = !n.left
          const col = data.color(data.classes[n.value] ?? '')
          const tot = n.n || 1
          return (
            <g key={n.id} data-testid="tree-node" transform={`translate(${d.x},${d.y})`} style={{ cursor: 'pointer' }} onClick={() => setSel(sel === n.id ? null : n.id)}
              onPointerEnter={compact ? undefined : (e) => stage.at(e, <><b>{leaf ? `리프: ${data.classes[n.value]}` : `${name(n.feature)} ≤ ${fmt(n.threshold, 3)}`}</b><br />표본 {n.n} · 지니 불순도 {fmt(n.impurity, 3)}<br />{data.classes.map((c, k) => `${c} ${n.counts[k]}`).join(' · ')}</>)}>
              <rect width={nodeW} height={nodeH} rx={compact ? 2 : 7} fill={leaf ? d3.interpolateRgb('#ffffff', col)(0.22) : '#ffffff'} stroke={path.has(n.id) ? '#111827' : leaf ? col : '#aab1b8'} strokeWidth={path.has(n.id) ? 2.4 : 1.3} />
              {!compact && <>
                <text x={nodeW / 2} y={17} textAnchor="middle" fontSize={11} fontWeight={600} fill="#111827">{leaf ? data.classes[n.value] : `${name(n.feature).slice(0, 9)} ≤ ${fmt(n.threshold, 2)}`}</text>
                <text x={nodeW / 2} y={31} textAnchor="middle" fontSize={10} fill="#6b7280">{params.showCounts ? `n=${n.n} · 지니 ${fmt(n.impurity, 2)}` : `n=${n.n}`}</text>
                {data.classes.reduce((acc2, c, k) => { const w = ((n.counts[k] ?? 0) / tot) * (nodeW - 12); acc2.els.push(<rect key={k} x={6 + acc2.x} y={nodeH - 15} width={w} height={8} fill={data.color(c)} />); acc2.x += w; return acc2 }, { x: 0, els: [] as React.ReactElement[] }).els}
              </>}
            </g>
          )
        })}
      </g>
    </Stage>
  )
}

function TreeControls({ params, setParams }: ControlsProps<TreeParams>) {
  return (
    <ControlGroup title="트리">
      <Slider label="최대 깊이" value={params.depth} min={1} max={6} onChange={(depth) => setParams({ depth })} testId="ctl-depth" />
      <Slider label="리프 최소 표본" value={params.minLeaf} min={1} max={30} onChange={(minLeaf) => setParams({ minLeaf })} testId="ctl-minleaf" />
      <Toggle label="지니 불순도 표시" checked={params.showCounts} onChange={(showCounts) => setParams({ showCounts })} />
      <Hint>각 노드는 지니 불순도 1 − Σp²가 가장 크게 줄어드는 ‘특징 ≤ 임계값’ 분할을 모든 후보에서 골라 만든 것입니다. 노드 아래 막대는 그 노드에 도달한 표본의 클래스 구성이며, 리프의 색은 다수 클래스입니다. 깊이를 키우면 훈련 정확도는 오르지만 과적합될 수 있습니다.</Hint>
    </ControlGroup>
  )
}

export const treeModule: VizModule<TreeParams> = {
  roles: featLabelRoles(8), datasets: ['ml-highdim', 'ml-clusters', 'ml-moons'],
  defaultParams: { depth: 3, minLeaf: 5, showCounts: true },
  Chart: TreeChart, Controls: TreeControls,
  hint: '깊이를 늘려 트리가 어떻게 자라는지 보세요 · 노드에 올리면 분할 조건, 누르면 경로 강조',
}

