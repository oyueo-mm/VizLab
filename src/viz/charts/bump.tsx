import * as d3 from 'd3'
import { useMemo, useRef, useState } from 'react'
import { AxisBottom, ChartMessage, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { useTween } from '../../hooks/motion'
import { categoryColor } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { rankValues, type TieMethod } from '../../stats/rank'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { isDateColumn, pointRows, xFormat } from './shared'

export interface BumpParams {
  tie: TieMethod
  direction: 'high' | 'low'
  curve: 'bump' | 'linear' | 'monotone'
  highlight: string
  dot: number
  labels: boolean
  rankLabels: boolean
}

export interface BumpModel {
  times: number[]
  keys: string[]
  /** value[key][t] (null where the series has no observation). */
  values: (number | null)[][]
  /** rank[key][t], 1 = best; null where missing. */
  ranks: (number | null)[][]
}

/** Ranks every series at each time point. Duplicate (series, time) observations are summed. */
export function bumpModel(pts: { x: number; y: number; group: string }[], tie: TieMethod, direction: 'high' | 'low'): BumpModel {
  const times = [...new Set(pts.map((p) => p.x))].sort((a, b) => a - b)
  const keys = [...new Set(pts.map((p) => p.group))]
  const values = keys.map(() => times.map(() => null as number | null))
  for (const p of pts) {
    const ki = keys.indexOf(p.group)
    const ti = times.indexOf(p.x)
    values[ki][ti] = (values[ki][ti] ?? 0) + p.y
  }
  const ranks = keys.map(() => times.map(() => null as number | null))
  times.forEach((_, ti) => {
    const r = rankValues(values.map((v) => v[ti]), tie, direction === 'high')
    r.forEach((rk, ki) => { ranks[ki][ti] = rk })
  })
  return { times, keys, values, ranks }
}

/**
 * Vertical pixel offsets that fan out series sharing a rank at the same time point, so tied lines and
 * dots stay visible. Ranks are unchanged; only the drawn position moves (at most 90 % of one rank step).
 */
export function tieOffsets(ranks: (number | null)[][], dot: number, step: number) {
  const out = ranks.map((r) => r.map(() => 0))
  const times = ranks[0]?.length ?? 0
  for (let ti = 0; ti < times; ti++) {
    const groups = new Map<number, number[]>()
    ranks.forEach((r, ki) => { const v = r[ti]; if (v != null) groups.set(v, [...(groups.get(v) ?? []), ki]) })
    for (const members of groups.values()) {
      if (members.length < 2) continue
      const spacing = Math.min(2.1 * dot, (0.9 * step) / (members.length - 1))
      members.forEach((ki, i) => { out[ki][ti] = (i - (members.length - 1) / 2) * spacing })
    }
  }
  return out
}

function BumpChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<BumpParams>) {
  const xCol = roleColumn(mapping, 'x')
  const isDate = isDateColumn(table, xCol)
  const fx = xFormat(isDate)
  const yCol = roleColumn(mapping, 'y')
  const sCol = roleColumn(mapping, 'series')
  const pts = useMemo(() => pointRows(table, xCol, yCol, sCol), [table, xCol, yCol, sCol])
  const model = useMemo(() => bumpModel(pts, params.tie, params.direction), [pts, params.tie, params.direction])
  const color = useMemo(() => categoryColor(model.keys), [model.keys])
  const m = margins(compact, compact ? {} : { left: 96, right: 96, top: 28 })
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<string | null>(null)
  const { tip, show, hide } = useTooltip()
  const maxRank = Math.max(1, ...model.ranks.flat().map((r) => r ?? 0))
  const x = d3.scaleLinear().domain(model.times.length > 1 ? [model.times[0], model.times[model.times.length - 1]] : [0, 1]).range([0, iw])
  const px = (t: number) => (model.times.length > 1 ? x(t) : iw / 2)
  const y = d3.scaleLinear().domain([1, Math.max(2, maxRank)]).range([12, ih - 12])
  const offsets = useMemo(() => tieOffsets(model.ranks, params.dot, ih / Math.max(1, maxRank)), [model, params.dot, ih, maxRank])
  const target = useMemo(() => model.ranks.map((r, ki) => r.map((v, ti) => (v == null ? null : y(v) + offsets[ki][ti]))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, offsets, ih])
  // The tween interpolates numbers only; missing observations are carried as -1 and skipped when drawing.
  const flat = useMemo(() => target.map((r) => r.map((v) => (v == null ? -1 : v))), [target])
  const shown = useTween(flat, { snapKey: `${iw}x${ih}${model.keys.length}${model.times.length}`, enabled: !compact })

  if (!xCol || !yCol || !sCol) return <ChartMessage>시점(날짜 또는 숫자), 값, 계열 열을 모두 선택하세요.</ChartMessage>
  if (!pts.length || model.keys.length < 2) return <ChartMessage>순위를 매기려면 계열이 2개 이상 필요합니다.</ChartMessage>
  const curve = params.curve === 'bump' ? d3.curveBumpX : params.curve === 'monotone' ? d3.curveMonotoneX : d3.curveLinear
  const active = hover ?? (params.highlight || null)
  const lastIdx = (r: (number | null)[]) => { for (let i = r.length - 1; i >= 0; i--) if (r[i] != null) return i; return -1 }
  const firstIdx = (r: (number | null)[]) => r.findIndex((v) => v != null)
  const tied = model.times.filter((_, ti) => { const rs = model.ranks.map((r) => r[ti]).filter((v): v is number => v != null); return new Set(rs).size < rs.length }).length

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg"
        aria-label={`범프 차트: ${model.keys.length}개 ${sCol}의 ${xCol}에 따른 ${yCol} 순위 변화`} onPointerLeave={() => { hide(); setHover(null) }}>
        <g transform={`translate(${m.left},${m.top})`}>
          {!compact && model.times.map((t) => <line key={t} className="grid" x1={px(t)} x2={px(t)} y1={0} y2={ih} stroke="#eef1f0" />)}
          {!compact && <AxisBottom scale={model.times.length > 1 ? x : d3.scaleLinear().domain([0, 1]).range([0, iw])} y={ih} label={xCol} ticks={Math.min(10, model.times.length)} format={isDate ? undefined : (v) => fmt(v)} date={isDate} />}
          {model.keys.map((k, ki) => {
            const ys = shown[ki] ?? flat[ki]
            const segs: [number, number][][] = []
            let cur: [number, number][] = []
            model.times.forEach((t, ti) => {
              if (ys[ti] == null || ys[ti] < 0) { if (cur.length) segs.push(cur); cur = [] } else cur.push([px(t), ys[ti]])
            })
            if (cur.length) segs.push(cur)
            const c = color(k)
            const dim = active != null && active !== k
            const line = d3.line<[number, number]>().curve(curve)
            const fi = firstIdx(model.ranks[ki])
            const li = lastIdx(model.ranks[ki])
            return (
              <g key={k} className="marks bump-series" opacity={dim ? 0.18 : 1} data-testid="bump-series"
                onPointerEnter={() => setHover(k)} onClick={compact ? undefined : () => setParams({ highlight: params.highlight === k ? '' : k })}>
                {segs.map((s, i) => <path key={i} d={line(s) ?? ''} fill="none" stroke={c} strokeWidth={compact ? 2 : active === k ? 5 : 3.2} strokeLinecap="round" />)}
                {!compact && model.times.map((t, ti) => {
                  const r = model.ranks[ki][ti]
                  const yy = ys[ti]
                  if (r == null || yy == null || yy < 0) return null
                  return (
                    <g key={t}>
                      <circle cx={px(t)} cy={yy} r={params.dot} fill="#fff" stroke={c} strokeWidth={2.4}
                        onPointerEnter={(e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{k}</b> · {xCol} {fx(t)}<br />순위 {fmt(r, 1)}위<br />{yCol}: {fmt(model.values[ki][ti])}</>) }} onPointerLeave={hide} />
                      {params.rankLabels && params.dot >= 8 && <text className="bump-rank" x={px(t)} y={yy} dy="0.35em" textAnchor="middle">{Number.isInteger(r) ? r : r.toFixed(1)}</text>}
                    </g>
                  )
                })}
                {compact && model.times.map((t, ti) => (ys[ti] != null && ys[ti] >= 0 ? <circle key={t} cx={px(t)} cy={ys[ti]} r={2.5} fill={c} /> : null))}
                {params.labels && !compact && fi >= 0 && (
                  <>
                    <text className="bump-label" x={px(model.times[fi]) - params.dot - 8} y={ys[fi]} dy="0.35em" textAnchor="end">{k}</text>
                    <text className="bump-label" x={px(model.times[li]) + params.dot + 8} y={ys[li]} dy="0.35em">{k}</text>
                  </>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          <Readout items={[{ label: '계열', value: model.keys.length }, { label: '시점', value: model.times.length }, ...(tied ? [{ label: '동률 시점', value: tied }] : [])]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function BumpControls({ params, setParams, table, mapping }: ControlsProps<BumpParams>) {
  const pts = pointRows(table, roleColumn(mapping, 'x'), roleColumn(mapping, 'y'), roleColumn(mapping, 'series'))
  const keys = [...new Set(pts.map((p) => p.group))]
  return (
    <>
      <ControlGroup title="순위 계산">
        <Segmented label="순위 기준" value={params.direction} onChange={(direction) => setParams({ direction })} testId="ctl-direction"
          options={[{ value: 'high', label: '큰 값이 1위' }, { value: 'low', label: '작은 값이 1위' }]} />
        <Select label="동률 처리" value={params.tie} onChange={(tie) => setParams({ tie })} testId="ctl-tie"
          options={[{ value: 'min', label: '공동 순위 (1, 2, 2, 4)' }, { value: 'dense', label: '조밀 순위 (1, 2, 2, 3)' }, { value: 'average', label: '평균 순위 (1, 2.5, 2.5, 4)' }, { value: 'first', label: '데이터 순서로 구분 (1, 2, 3, 4)' }]} />
        <Hint>값이 같은 계열의 순위를 어떻게 매길지 정합니다. 시점마다 따로 순위를 매기므로 값 하나를 고치면 다른 계열의 순위도 바뀝니다. 공동 순위인 점은 겹치지 않게 위아래로 나란히 그려지며 순위 숫자는 그대로입니다.</Hint>
      </ControlGroup>
      <ControlGroup title="강조·모양">
        <Select label="강조할 계열" value={params.highlight} onChange={(highlight) => setParams({ highlight })} testId="ctl-highlight"
          options={[{ value: '', label: '없음 (선을 클릭해도 강조)' }, ...keys.map((k) => ({ value: k, label: k }))]} />
        <Segmented label="선 모양" value={params.curve} onChange={(curve) => setParams({ curve })} testId="ctl-curve"
          options={[{ value: 'bump', label: '범프' }, { value: 'monotone', label: '곡선' }, { value: 'linear', label: '직선' }]} />
        <Slider label="점 크기" value={params.dot} min={3} max={14} step={0.5} onChange={(dot) => setParams({ dot })} />
        <Toggle label="순위 숫자" checked={params.rankLabels} onChange={(rankLabels) => setParams({ rankLabels })} />
        <Toggle label="양쪽 계열 이름" checked={params.labels} onChange={(labels) => setParams({ labels })} />
      </ControlGroup>
    </>
  )
}

export const bumpModule: VizModule<BumpParams> = {
  roles: [
    { key: 'x', label: '시점 (날짜 또는 숫자)', type: 'date', accept: ['date', 'number'], required: true },
    { key: 'y', label: '값 (순위의 기준)', type: 'number', required: true },
    { key: 'series', label: '계열', type: 'category', required: true },
  ],
  datasets: ['league', 'streams', 'timeseries'],
  defaultParams: { tie: 'min', direction: 'high', curve: 'bump', highlight: '', dot: 9, labels: true, rankLabels: true },
  Chart: BumpChart,
  Controls: BumpControls,
  hint: '선을 클릭해 계열 강조 · 점에 마우스를 올려 순위와 값 확인 · 데이터 탭에서 값·시점을 고치면 순위가 다시 계산됩니다',
}
