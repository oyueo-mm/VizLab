import { columnIndex, toLabel, toNumber, uniqueLabels, type DataTable } from '../../data/table'
import { ControlGroup, Hint, Segmented, Select, Slider } from '../../components/controls'
import { categoryColor } from '../../lib/colors'
import type { ModelSpec } from '../../stats/ml'
import { roleColumn, roleColumns } from '../mapping'
import type { Mapping, RoleSpec } from '../types'

/** Shared pieces of the machine-learning charts: column roles, labelled-matrix extraction and the model picker. */

export const xyLabelRoles: RoleSpec[] = [
  { key: 'x', label: '특징 1 (X축)', type: 'number', required: true },
  { key: 'y', label: '특징 2 (Y축)', type: 'number', required: true },
  { key: 'label', label: '클래스 (정답)', type: 'category', required: true },
]

export const featLabelRoles = (max = 12): RoleSpec[] => [
  { key: 'label', label: '클래스 / 군집 (색)', type: 'category', required: true },
  { key: 'features', label: '특징 열', type: 'number', required: true, multiple: { min: 2, max } },
]

export const tabularRoles = (max = 6): RoleSpec[] => [
  { key: 'target', label: '예측 대상 (숫자)', type: 'number', required: true, prefer: '가격|target|목표' },
  { key: 'features', label: '특징 열', type: 'number', required: true, multiple: { min: 2, max } },
]

export interface Labelled { X: number[][]; y: number[]; classes: string[]; names: string[]; rows: number[]; color: (c: string) => string }

function build(table: DataTable, cols: string[], labelCol: string | null): Labelled {
  const ci = cols.map((c) => columnIndex(table, c))
  const li = columnIndex(table, labelCol)
  const X: number[][] = [], lab: string[] = [], rows: number[] = []
  table.rows.forEach((r, row) => {
    const v = ci.map((i) => (i < 0 ? null : toNumber(r[i])))
    if (v.some((a) => a == null)) return
    const l = li >= 0 ? toLabel(r[li]) : ''
    if (li >= 0 && l === '') return
    X.push(v as number[]); lab.push(l); rows.push(row)
  })
  const classes = uniqueLabels(lab)
  return { X, y: lab.map((l) => classes.indexOf(l)), classes, names: cols, rows, color: categoryColor(classes) }
}

export const xyLabelled = (table: DataTable, mapping: Mapping) => {
  const x = roleColumn(mapping, 'x'), y = roleColumn(mapping, 'y')
  return x && y ? build(table, [x, y], roleColumn(mapping, 'label')) : null
}
export const featLabelled = (table: DataTable, mapping: Mapping) => {
  const f = roleColumns(mapping, 'features')
  return f.length >= 2 ? build(table, f, roleColumn(mapping, 'label')) : null
}

export interface Tabular { X: number[][]; y: number[]; names: string[]; rows: number[] }
export function tabular(table: DataTable, mapping: Mapping): Tabular | null {
  const t = roleColumn(mapping, 'target'), f = roleColumns(mapping, 'features')
  if (!t || f.length < 2) return null
  const ti = columnIndex(table, t), ci = f.map((c) => columnIndex(table, c))
  const X: number[][] = [], y: number[] = [], rows: number[] = []
  table.rows.forEach((r, row) => {
    const tv = toNumber(r[ti]); const v = ci.map((i) => toNumber(r[i]))
    if (tv == null || v.some((a) => a == null)) return
    X.push(v as number[]); y.push(tv); rows.push(row)
  })
  return { X, y, names: f, rows }
}

export interface ModelParams { model: ModelSpec['kind']; k: number; degree: number; l2exp: number; depth: number; minLeaf: number; hidden: number; epochs: number }
export const modelDefaults: ModelParams = { model: 'knn', k: 7, degree: 2, l2exp: -2, depth: 4, minLeaf: 2, hidden: 8, epochs: 60 }

export function specOf(p: ModelParams): ModelSpec {
  switch (p.model) {
    case 'knn': return { kind: 'knn', k: p.k }
    case 'logistic': return { kind: 'logistic', degree: p.degree, l2: 10 ** p.l2exp }
    case 'tree': return { kind: 'tree', maxDepth: p.depth, minLeaf: p.minLeaf }
    case 'nb': return { kind: 'nb' }
    case 'mlp': return { kind: 'mlp', hidden: p.hidden, epochs: p.epochs }
  }
}
export const specName = (p: ModelParams) => ({ knn: `k-최근접 이웃 (k=${p.k})`, logistic: `로지스틱 회귀 (${p.degree}차 다항)`, tree: `결정 트리 (깊이 ${p.depth})`, nb: '가우시안 나이브 베이즈', mlp: `신경망 (은닉 ${p.hidden}, ${p.epochs} epoch)` })[p.model]

const modelOptions = [{ value: 'knn', label: 'k-최근접 이웃' }, { value: 'logistic', label: '로지스틱 회귀 (다항)' }, { value: 'tree', label: '결정 트리' }, { value: 'nb', label: '나이브 베이즈' }, { value: 'mlp', label: '신경망 (MLP)' }] as const

export function ModelPicker<P extends ModelParams>({ params, setParams, skip = [] }: { params: P; setParams: (patch: Partial<P>) => void; skip?: ModelParams['model'][] }) {
  const set = setParams as (p: Partial<ModelParams>) => void
  return (
    <ControlGroup title="분류 모델">
      <Select label="모델" value={params.model} onChange={(model) => set({ model })} testId="ctl-model" options={modelOptions.filter((o) => !skip.includes(o.value)) as unknown as { value: ModelParams['model']; label: string }[]} />
      {params.model === 'knn' && <Slider label="이웃 수 k" value={params.k} min={1} max={40} onChange={(k) => set({ k })} testId="ctl-k" />}
      {params.model === 'logistic' && <><Slider label="다항 차수" value={params.degree} min={1} max={6} onChange={(degree) => set({ degree })} testId="ctl-degree" /><Slider label="L2 규제 (10^x)" value={params.l2exp} min={-4} max={1} step={0.5} onChange={(l2exp) => set({ l2exp })} testId="ctl-l2" /></>}
      {params.model === 'tree' && <><Slider label="최대 깊이" value={params.depth} min={1} max={12} onChange={(depth) => set({ depth })} testId="ctl-depth" /><Slider label="리프 최소 표본" value={params.minLeaf} min={1} max={20} onChange={(minLeaf) => set({ minLeaf })} testId="ctl-minleaf" /></>}
      {params.model === 'mlp' && <><Slider label="은닉 뉴런 수" value={params.hidden} min={1} max={32} onChange={(hidden) => set({ hidden })} testId="ctl-hidden" /><Slider label="학습 epoch" value={params.epochs} min={5} max={200} step={5} onChange={(epochs) => set({ epochs })} testId="ctl-epochs" /></>}
      <Hint>모델은 지금 표의 값으로 브라우저에서 바로 학습합니다. 표를 고치거나 모델을 바꾸면 결과가 다시 계산됩니다.</Hint>
    </ControlGroup>
  )
}

export { Segmented }
