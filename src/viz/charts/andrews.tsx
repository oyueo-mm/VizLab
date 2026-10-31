import * as d3 from 'd3'
import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useRef } from 'react'
import { ChartMessage, Legend, Readout, Tooltip, localPoint, margins, toggleIn, useTooltip } from '../../components/chart/primitives'
import { AxisLeft } from '../../components/chart/primitives'
import { ControlGroup, Hint, Slider, Toggle } from '../../components/controls'
import { appendRow, columnIndex, removeRows, templateRow, toLabel, toNumber } from '../../data/table'
import { categoryColor } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { andrewsCurve, andrewsGrid, andrewsTerm } from '../../stats/andrews'
import { mean, standardDeviation } from '../../stats/descriptive'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'

export interface AndrewsParams {
  standardize: boolean
  opacity: number
  width: number
  /** Table row of the emphasised observation, or -1. */
  pinned: number
  showMean: boolean
  maxCurves: number
  hidden: string[]
}

const GRID = andrewsGrid(121)

function rowsOf(table: ChartProps<AndrewsParams>['table'], mapping: ChartProps<AndrewsParams>['mapping'], standardize: boolean) {
  const vars = roleColumns(mapping, 'vars').filter((v) => columnIndex(table, v) >= 0)
  const idx = vars.map((v) => columnIndex(table, v))
  const gi = columnIndex(table, roleColumn(mapping, 'group'))
  const raw: { row: number; x: number[]; group: string }[] = []
  table.rows.forEach((r, row) => {
    const x = idx.map((c) => toNumber(r[c]))
    if (x.some((v) => v == null)) return
    raw.push({ row, x: x as number[], group: gi >= 0 ? toLabel(r[gi]) : '' })
  })
  // Standardising puts every variable on the same footing; otherwise the largest-scale variable dominates the curve shape.
  const stats = vars.map((_, j) => ({ m: mean(raw.map((r) => r.x[j])), s: standardDeviation(raw.map((r) => r.x[j])) || 1 }))
  const items = raw.map((r) => ({ ...r, x: standardize ? r.x.map((v, j) => (v - stats[j].m) / stats[j].s) : r.x }))
  return { vars, items }
}

function AndrewsChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<AndrewsParams>) {
  const groupCol = roleColumn(mapping, 'group')
  const { vars, items } = useMemo(() => rowsOf(table, mapping, params.standardize), [table, mapping, params.standardize])
  const keys = useMemo(() => [...new Set(items.map((i) => i.group))], [items])
  const color = useMemo(() => categoryColor(keys), [keys])
  const visible = useMemo(() => items.filter((i) => !params.hidden.includes(i.group)), [items, params.hidden])
  // Draw an evenly spaced subset when there are very many observations; the pinned one is always kept.
  const shown = useMemo(() => {
    const cap = compact ? 60 : params.maxCurves
    if (visible.length <= cap) return visible
    const stride = visible.length / cap
    const pick = Array.from({ length: cap }, (_, i) => visible[Math.floor(i * stride)])
    const pin = visible.find((v) => v.row === params.pinned)
    return pin && !pick.includes(pin) ? [...pick, pin] : pick
  }, [visible, params.maxCurves, params.pinned, compact])
  const curves = useMemo(() => shown.map((s) => ({ ...s, y: andrewsCurve(s.x, GRID) })), [shown])
  const means = useMemo(() => keys.filter((k) => !params.hidden.includes(k)).map((k) => {
    const g = visible.filter((v) => v.group === k)
    const mx = vars.map((_, j) => mean(g.map((v) => v.x[j])))
    return { key: k, y: andrewsCurve(mx, GRID) }
  }), [keys, visible, vars, params.hidden])
  const m = margins(compact, compact ? {} : { right: 20, bottom: 56 })
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const { tip, show, hide } = useTooltip()

  if (vars.length < 2) return <ChartMessage>변수(숫자형 열)를 2개 이상 선택하세요.</ChartMessage>
  if (!items.length) return <ChartMessage>값이 모두 있는 관측값이 없습니다.</ChartMessage>
  const all = curves.flatMap((c) => c.y)
  const lim = Math.max(1e-6, d3.max(all.map(Math.abs)) ?? 1) * 1.08
  const x = d3.scaleLinear().domain([-Math.PI, Math.PI]).range([0, iw])
  const y = d3.scaleLinear().domain([-lim, lim]).range([ih, 0]).nice()
  const line = d3.line<number>().x((_, i) => x(GRID[i])).y((v) => y(v))
  const pinned = params.pinned
  const ticks = [-Math.PI, -Math.PI / 2, 0, Math.PI / 2, Math.PI]
  const tickText = ['−π', '−π/2', '0', 'π/2', 'π']

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`앤드루스 곡선: 관측값 ${items.length}개, 변수 ${vars.length}개`} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisLeft scale={y} x={0} grid={iw} label={compact ? undefined : 'f(t)'} compact={compact} />
          {!compact && (
            <g transform={`translate(0,${ih})`} className="axis" aria-hidden="true">
              <line className="domain" x1={0} x2={iw} />
              {ticks.map((t, i) => <g key={t} transform={`translate(${x(t)},0)`}><line y2={5} /><text y={18} textAnchor="middle">{tickText[i]}</text></g>)}
              <text className="axis-label" x={iw / 2} y={42} textAnchor="middle">t (라디안)</text>
            </g>
          )}
          {curves.map((c) => {
            const on = pinned === c.row
            const dim = pinned >= 0 && !on
            return (
              <path key={c.row} className="andrews-curve" data-testid="andrews-curve" d={line(c.y) ?? ''} fill="none" stroke={on ? '#121816' : color(c.group)}
                strokeWidth={on ? 3 : compact ? 1 : params.width} strokeOpacity={on ? 1 : dim ? params.opacity * 0.25 : compact ? 0.5 : params.opacity}
                onPointerEnter={compact ? undefined : (e) => {
                  const lp = localPoint(svgRef.current!, e)
                  show(lp.x, lp.y, <><b>{groupCol ? `${c.group} · ` : ''}{c.row + 1}번째 행</b>{vars.map((v, j) => <span key={v}><br />{v}: {fmt(c.x[j], 2)}{params.standardize ? ' (z)' : ''}</span>)}<br />클릭해 강조</>)
                }} onPointerLeave={hide}
                onClick={compact ? undefined : () => setParams({ pinned: on ? -1 : c.row })} />
            )
          })}
          {params.showMean && !compact && means.map((mm) => <path key={mm.key} d={line(mm.y) ?? ''} fill="none" stroke={color(mm.key)} strokeWidth={3.2} strokeDasharray="7 4" data-testid="andrews-mean" aria-hidden="true" />)}
        </g>
      </svg>
      {!compact && (
        <>
          {groupCol && <Legend items={keys.map((k) => ({ key: k, color: color(k) }))} hidden={params.hidden} title={groupCol} onToggle={(k) => setParams({ hidden: toggleIn(params.hidden, k) })} />}
          <Readout items={[{ label: '곡선', value: `${curves.length}${curves.length < visible.length ? ` / ${visible.length}` : ''}` }, { label: '변수', value: vars.length }]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function AndrewsControls({ params, setParams, table, mapping, setTable }: ControlsProps<AndrewsParams>) {
  const vars = roleColumns(mapping, 'vars')
  const add = () => { if (setTable) { setTable(appendRow(table, templateRow(table))); setParams({ pinned: table.rows.length }) } }
  return (
    <>
      <ControlGroup title="변환">
        <Toggle label="변수 표준화" description="각 변수를 평균 0, 표준편차 1로 맞춥니다" checked={params.standardize} onChange={(standardize) => setParams({ standardize })} testId="ctl-standardize" />
        <Hint>변수의 순서가 곡선 모양을 결정합니다 — 앞쪽 변수일수록 낮은 주파수 항에 들어갑니다. 순서는 데이터 탭의 ‘열 매핑’에서 바꿀 수 있습니다.</Hint>
        <ol className="andrews-terms">{vars.map((v, j) => <li key={v}><b>{v}</b> → {andrewsTerm(j)}</li>)}</ol>
      </ControlGroup>
      <ControlGroup title="표현">
        <Slider label="선 불투명도" value={params.opacity} min={0.1} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} testId="ctl-opacity" />
        <Slider label="선 굵기" value={params.width} min={0.5} max={3} step={0.25} onChange={(w) => setParams({ width: w })} />
        <Toggle label="그룹 평균 곡선" description="그룹 평균 관측값을 같은 식에 넣은 곡선" checked={params.showMean} onChange={(showMean) => setParams({ showMean })} testId="ctl-mean" />
        <Slider label="최대 곡선 수" value={params.maxCurves} min={20} max={600} step={20} onChange={(maxCurves) => setParams({ maxCurves })} />
      </ControlGroup>
      <ControlGroup title="관측값">
        <div className="data-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={add} data-testid="andrews-add"><Plus size={14} aria-hidden="true" />관측값 추가</button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={params.pinned < 0 || params.pinned >= table.rows.length} onClick={() => { setTable?.(removeRows(table, [params.pinned])); setParams({ pinned: -1 }) }} data-testid="andrews-delete"><Trash2 size={14} aria-hidden="true" />강조한 관측값 삭제</button>
        </div>
        <Hint>곡선을 클릭하면 강조되고 나머지는 흐려집니다. 새 관측값은 평균값으로 시작하니 데이터 탭에서 값을 바꿔 보세요.</Hint>
      </ControlGroup>
    </>
  )
}

export const andrewsModule: VizModule<AndrewsParams> = {
  roles: [
    { key: 'vars', label: '변수 (순서 중요)', type: 'number', required: true, multiple: { min: 2, max: 8 } },
    { key: 'group', label: '그룹 (색, 선택)', type: 'category', auto: true },
  ],
  datasets: ['flowers', 'pca-students', 'cars'],
  defaultParams: { standardize: true, opacity: 0.5, width: 1.3, pinned: -1, showMean: true, maxCurves: 300, hidden: [] },
  Chart: AndrewsChart,
  Controls: AndrewsControls,
  hint: '곡선을 클릭해 한 관측값만 강조 · 같은 그룹의 곡선이 모이는지 확인 · 범례로 그룹 숨기기',
}
