import * as d3 from 'd3'
import { useMemo } from 'react'
import { ChartMessage } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber } from '../../data/table'
import { categoryColor } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { cumulativeIncidence, kernelHazard, weibullMle, type TimedEvent } from '../../stats/tsa'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, RoleSpec, VizModule } from '../types'
import { XYPlot, type Layer } from './kit'
import { readSurvival } from './survivalCharts'

/** Hazard-function and competing-risk (cumulative incidence) charts. */

// ─── hazard function ────────────────────────────────────────────────────────────────

export interface HazardParams { bandwidth: number; show: 'smooth' | 'weibull' | 'both' }
const survRoles: RoleSpec[] = [
  { key: 'time', label: '추적 기간', type: 'number', required: true, prefer: '기간|시간|time|duration' },
  { key: 'event', label: '사건 (1 = 발생, 0 = 검열)', type: 'number', required: true, prefer: '사건|event|status' },
  { key: 'group', label: '집단 (선택)', type: 'category', auto: true, prefer: '집단|group|arm|처치' },
]

function HazardChart({ table, mapping, params, width, height, compact }: ChartProps<HazardParams>) {
  const { groups } = useMemo(() => readSurvival(table, mapping, 0.95), [table, mapping])
  const names = groups.map((g) => g.key)
  const color = categoryColor(names)
  const tMax = d3.max(groups, (g) => d3.max(g.subjects, (s) => s.time)) ?? 0
  const res = useMemo(() => {
    if (!groups.length || tMax <= 0) return null
    const b = Math.max(tMax * (params.bandwidth / 100), 1e-6)
    const grid = d3.range(0, 121).map((i) => (tMax * i) / 120)
    return { b, grid, per: groups.map((g) => ({ key: g.key, events: g.curve.events, smooth: kernelHazard(g.subjects.map((s) => s.time), g.subjects.map((s) => s.event), b, grid), weib: weibullMle(g.subjects.map((s) => s.time), g.subjects.map((s) => s.event)) })) }
  }, [groups, tMax, params.bandwidth])
  if (!roleColumn(mapping, 'time') || !roleColumn(mapping, 'event')) return <ChartMessage>추적 기간과 사건(1/0) 열(숫자형)을 선택하세요.</ChartMessage>
  if (!res) return <ChartMessage>유효한 추적 기록이 없습니다.</ChartMessage>
  const layers: Layer[] = []
  for (const g of res.per) {
    if (params.show !== 'weibull') layers.push({ kind: 'line', x: res.grid, y: g.smooth, color: color(g.key), width: 2.6, label: names.length > 1 ? g.key : '커널 평활 위험률' })
    if (params.show !== 'smooth' && g.weib) layers.push({ kind: 'line', x: res.grid, y: res.grid.map((t) => (t <= 0 ? (g.weib!.shape < 1 ? NaN : g.weib!.shape === 1 ? 1 / g.weib!.scale : 0) : (g.weib!.shape / g.weib!.scale) * (t / g.weib!.scale) ** (g.weib!.shape - 1))), color: color(g.key), dash: '6 4', width: 2, label: names.length > 1 ? `${g.key} (와이블)` : '와이블 모형' })
  }
  const shapes = res.per.filter((g) => g.weib).map((g) => `${names.length > 1 ? `${g.key} ` : ''}${fmt(g.weib!.shape, 2)}`).join(' · ')
  return (
    <XYPlot hover layers={layers} width={width} height={height} compact={compact} xLabel="시간" yLabel="위험률 h(t) (단위 시간당)" title="위험함수 추정" yDomain={[0, Math.max(0.001, ...res.per.flatMap((g) => g.smooth), ...(params.show === 'smooth' ? [] : res.per.flatMap((g) => (g.weib ? [g.weib.shape < 1 ? 0 : (g.weib.shape / g.weib.scale) * (tMax / g.weib.scale) ** (g.weib.shape - 1)] : [])))) * 1.12]}
      readout={[{ label: '평활 폭', value: fmt(res.b, 1) }, ...(shapes ? [{ label: '와이블 모양 k', value: shapes }] : [])]} note="평활 폭 안쪽 가장자리는 경계 편향으로 낮게 추정됩니다" />
  )
}

function HazardControls({ params, setParams }: ControlsProps<HazardParams>) {
  return (
    <ControlGroup title="위험함수">
      <Slider label="평활 폭 (추적 기간의 %)" value={params.bandwidth} min={3} max={45} format={(v) => `${v}%`} onChange={(bandwidth) => setParams({ bandwidth })} testId="ctl-bw" />
      <Segmented label="표시" value={params.show} onChange={(show) => setParams({ show })} testId="ctl-show" options={[{ value: 'smooth', label: '비모수' }, { value: 'weibull', label: '와이블' }, { value: 'both', label: '둘 다' }]} />
      <Hint>위험률 h(t)는 ‘t까지 살아남은 사람이 바로 그 순간 사건을 겪을 순간 비율’입니다. Nelson–Aalen 누적위험의 증분(사건 수 / 위험집단 크기)을 Epanechnikov 커널로 매끄럽게 한 비모수 추정과, 검열을 반영한 와이블 최대가능도 추정(h(t) = (k/λ)(t/λ)^(k−1))을 비교합니다. 모양 모수 k가 1보다 작으면 위험이 시간이 지나며 줄고(초기 위험), 1이면 일정, 1보다 크면 증가(마모)합니다. 평활 폭을 줄이면 세부가 보이지만 흔들리고, 키우면 안정되지만 봉우리가 뭉개집니다. 생존 곡선보다 위험의 시간적 모양을 직접 보여 줍니다.</Hint>
    </ControlGroup>
  )
}

export const hazardModule: VizModule<HazardParams> = {
  roles: survRoles, datasets: ['survival-trial'], defaultParams: { bandwidth: 20, show: 'both' },
  Chart: HazardChart, Controls: HazardControls, hint: '평활 폭을 바꿔 위험률 곡선의 흔들림과 편향을 비교하고 와이블 모양 모수 k와 비교하세요',
}

// ─── cumulative incidence ───────────────────────────────────────────────────────────

export interface CifParams { view: 'causes' | 'stacked' | 'groups'; naive: boolean; group: string; cause: number }
const cifRoles: RoleSpec[] = [
  { key: 'time', label: '추적 기간', type: 'number', required: true, prefer: '기간|시간|time' },
  { key: 'cause', label: '종료 사유 (0 = 검열, 1·2… = 원인)', type: 'number', required: true, prefer: '사유|원인|cause|event' },
  { key: 'group', label: '집단 (선택)', type: 'category', auto: true, prefer: '집단|group' },
]

function readCompeting(table: ChartProps<CifParams>['table'], mapping: ChartProps<CifParams>['mapping']) {
  const ti = columnIndex(table, roleColumn(mapping, 'time')), ci = columnIndex(table, roleColumn(mapping, 'cause')), gi = columnIndex(table, roleColumn(mapping, 'group'))
  const by = new Map<string, TimedEvent[]>()
  let K = 0
  if (ti >= 0 && ci >= 0) table.rows.forEach((r) => {
    const t = toNumber(r[ti]), c = toNumber(r[ci])
    if (t == null || c == null || t < 0 || !Number.isInteger(c) || c < 0 || c > 6) return
    K = Math.max(K, c)
    const g = gi >= 0 ? toLabel(r[gi]) || '(빈 값)' : '전체'
    ;(by.get(g) ?? by.set(g, []).get(g)!).push({ time: t, cause: c })
  })
  return { by, K }
}

const stepXY = (times: number[], vals: number[]) => ({ x: [0, ...times], y: [0, ...vals] })

function CifChart({ table, mapping, params, width, height, compact }: ChartProps<CifParams>) {
  const { by, K } = useMemo(() => readCompeting(table, mapping), [table, mapping])
  const names = [...by.keys()]
  const g = names.includes(params.group) ? params.group : names[0]
  const curves = useMemo(() => new Map([...by].map(([k, d]) => [k, d.length ? cumulativeIncidence(d, K) : []])), [by, K])
  if (!roleColumn(mapping, 'time') || !roleColumn(mapping, 'cause')) return <ChartMessage>추적 기간과 종료 사유(0 = 검열, 1·2 = 원인) 열을 선택하세요.</ChartMessage>
  if (K < 1) return <ChartMessage>원인 코드가 1 이상인 사건이 한 건 이상 필요합니다.</ChartMessage>
  const causeColor = (k: number) => ['#cf4f6a', '#4c6fb5', '#d4a53a', '#5d9a4a', '#9b5fb4', '#8a6d4e'][k % 6]
  const steps = curves.get(g) ?? []
  const times = steps.map((s) => s.time)
  const tMax = Math.max(1, ...[...by.values()].flat().map((d) => d.time))
  const common = { width, height, compact, xLabel: '시간', yLabel: '누적 발생 확률', yDomain: [0, 1] as [number, number], xDomain: [0, tMax] as [number, number], yFormat: (v: number) => pct(v, 0) }
  const at = (list: typeof steps, k: number) => (list.length ? list[list.length - 1].cif[k] : 0)
  if (params.view === 'stacked') {
    const lay: Layer[] = []
    let lower = times.map(() => 0)
    for (let k = 0; k < K; k++) {
      const hi = lower.map((v, i) => v + steps[i].cif[k])
      lay.push({ kind: 'band', x: times, lo: lower, hi, color: causeColor(k), opacity: 0.55, label: `원인 ${k + 1}` })
      lower = hi
    }
    lay.push({ kind: 'band', x: times, lo: lower, hi: times.map(() => 1), color: '#d1d5db', opacity: 0.5, label: '사건 없이 생존' })
    return <XYPlot hover={false} layers={lay} title={`누적 발생 확률 (쌓은 영역): ${g}`} {...common} readout={Array.from({ length: K }, (_, k) => ({ label: `원인 ${k + 1} 최종`, value: pct(at(steps, k), 1) }))} note="영역의 합은 항상 1: 원인별 누적 발생 + 사건 없이 생존" />
  }
  if (params.view === 'groups') {
    const k = Math.min(Math.max(0, params.cause - 1), K - 1)
    const gc = categoryColor(names)
    const lay: Layer[] = names.map((n) => { const st = curves.get(n) ?? []; const p = stepXY(st.map((s) => s.time), st.map((s) => s.cif[k])); return { kind: 'line', ...p, color: gc(n), step: true, label: n, width: 2.6 } })
    return <XYPlot hover layers={lay} title={`원인 ${k + 1}의 집단 비교`} {...common} readout={names.map((n) => ({ label: `${n} 최종`, value: pct(at(curves.get(n) ?? [], k), 1) }))} />
  }
  const lay: Layer[] = []
  for (let k = 0; k < K; k++) {
    const p = stepXY(times, steps.map((s) => s.cif[k]))
    lay.push({ kind: 'line', ...p, color: causeColor(k), step: true, width: 2.8, label: `원인 ${k + 1} (경쟁위험 고려)` })
    if (params.naive) lay.push({ kind: 'line', ...stepXY(times, steps.map((s) => s.naive[k])), color: causeColor(k), step: true, dash: '5 4', width: 1.8, label: `원인 ${k + 1}: 1 − KM (과대추정)` })
  }
  const last = steps[steps.length - 1]
  return <XYPlot hover layers={lay} title={`누적 발생 확률: ${g}`} {...common} readout={last ? Array.from({ length: K }, (_, k) => ({ label: `원인 ${k + 1}`, value: `${pct(last.cif[k], 1)}${params.naive ? ` (1−KM ${pct(last.naive[k], 1)})` : ''}` })) : []} note="실선 = 다른 사건이 먼저 일어날 가능성을 반영한 누적 발생" />
}

function CifControls({ params, setParams, table, mapping }: ControlsProps<CifParams>) {
  const { by, K } = readCompeting(table, mapping)
  const names = [...by.keys()]
  return (
    <ControlGroup title="경쟁 위험">
      <Segmented label="보기" value={params.view} onChange={(view) => setParams({ view })} testId="ctl-view" options={[{ value: 'causes', label: '원인별' }, { value: 'stacked', label: '쌓기' }, { value: 'groups', label: '집단 비교' }]} />
      {params.view !== 'groups' && names.length > 1 && <Select label="집단" value={names.includes(params.group) ? params.group : names[0]} onChange={(group) => setParams({ group })} options={names.map((n) => ({ value: n, label: n }))} testId="ctl-group" />}
      {params.view === 'groups' && <Slider label="비교할 원인 번호" value={Math.min(Math.max(1, params.cause), Math.max(1, K))} min={1} max={Math.max(1, K)} onChange={(cause) => setParams({ cause })} testId="ctl-cause" />}
      {params.view === 'causes' && <Toggle label="1 − Kaplan–Meier와 비교" checked={params.naive} onChange={(naive) => setParams({ naive })} />}
      <Hint>한 사람이 여러 원인 중 하나로만 사건을 겪고, 먼저 일어난 사건이 다른 사건을 가리는 경쟁 위험에서는 1 − Kaplan–Meier(다른 원인을 검열로 취급)가 원인별 발생 확률을 과대추정합니다. Aalen–Johansen 추정 CIF_k(t) = Σ S(t_{'{i−1}'}) · d_k,i / n_i는 직전까지 어떤 사건도 겪지 않고 살아남은 확률 S를 곱해 이를 바로잡으며, 모든 원인의 CIF와 S(t)의 합은 항상 1입니다. 집단 비교는 같은 원인의 누적 발생을 집단끼리 비교합니다.</Hint>
    </ControlGroup>
  )
}

export const cifModule: VizModule<CifParams> = {
  roles: cifRoles, datasets: ['competing-risks'], defaultParams: { view: 'causes', naive: true, group: '', cause: 1 },
  Chart: CifChart, Controls: CifControls, hint: '점선(1 − KM)과 실선의 차이가 경쟁 위험을 무시했을 때의 과대추정입니다 · 쌓기 보기에서는 합이 1',
}
