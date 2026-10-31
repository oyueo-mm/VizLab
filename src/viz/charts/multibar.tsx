import * as d3 from 'd3'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { AxisLeft, BandAxis, ChartMessage, Legend, Tooltip, localPoint, margins, toggleIn, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, StatTable, Toggle } from '../../components/controls'
import { categoryColor } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { updateRow } from '../../data/table'
import { useTween } from '../../hooks/motion'
import { aggregate } from '../../stats/descriptive'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { aggOptions, type BarParams } from './bar'
import { stackCrossTab } from '../../stats/stack'
import { crossTab, dragDigits, roundTo } from './shared'

export interface MultiBarParams {
  agg: BarParams['agg']
  swap: boolean
  sort: 'none' | 'desc' | 'asc' | 'share'
  /** 100% bar: group whose share orders the categories (empty = data order). */
  shareOf: string
  labels: boolean
  hidden: string[]
  /** grouped only */
  innerPad: number
  /** stacked only */
  mode: 'stack' | 'normalize'
  order: 'none' | 'ascending' | 'descending' | 'insideOut'
  totals: boolean
}

const defaults: MultiBarParams = { agg: 'sum', swap: false, sort: 'none', labels: false, hidden: [], innerPad: 0.08, mode: 'stack', order: 'none', totals: true, shareOf: '' }

export { stackCrossTab }

function MultiBarChart({ table, mapping, params, setParams, width, height, compact, onTableChange, stacked }: ChartProps<MultiBarParams> & { stacked?: boolean }) {
  const c1 = roleColumn(mapping, 'category')
  const c2 = roleColumn(mapping, 'group')
  const catCol = params.swap ? c2 : c1
  const groupCol = params.swap ? c1 : c2
  const valueCol = roleColumn(mapping, 'value')
  const tab = useMemo(() => crossTab(table, catCol, groupCol, valueCol, (v) => aggregate(v, params.agg)), [table, catCol, groupCol, valueCol, params.agg])
  const color = useMemo(() => categoryColor(tab.groups), [tab.groups])
  const visible = tab.groups.filter((g) => !params.hidden.includes(g))
  const total = (c: string) => d3.sum(visible, (g) => tab.value(c, g))
  const cats = useMemo(() => {
    const out = [...tab.cats]
    if (params.sort === 'desc') out.sort((a, b) => total(b) - total(a))
    if (params.sort === 'asc') out.sort((a, b) => total(a) - total(b))
    if (params.sort === 'share' && tab.groups.includes(params.shareOf)) out.sort((a, b) => (total(b) ? tab.value(b, params.shareOf) / total(b) : 0) - (total(a) ? tab.value(a, params.shareOf) / total(a) : 0))
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, params.sort, params.shareOf, visible.join()])
  const m = margins(compact)
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ row: number; domain: [number, number] } | null>(null)
  const [dragging, setDragging] = useState(false)
  const { tip, show, hide } = useTooltip()

  const x0 = d3.scaleBand().domain(cats).range([0, iw]).paddingInner(0.2).paddingOuter(0.1)
  const x1 = d3.scaleBand().domain(visible).range([0, x0.bandwidth()]).padding(params.innerPad)
  const series = useMemo(() => (stacked ? stackCrossTab(cats, visible, tab.value, params.mode, params.order) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stacked, cats, visible.join(), tab, params.mode, params.order])
  const maxVal = stacked
    ? params.mode === 'normalize' ? 1 : d3.max(series, (s) => d3.max(s, (d) => d[1])) ?? 1
    : d3.max(cats, (c) => d3.max(visible, (g) => tab.value(c, g))) ?? 1
  const minVal = stacked ? 0 : Math.min(0, d3.min(cats, (c) => d3.min(visible, (g) => tab.value(c, g))) ?? 0)
  const y = d3.scaleLinear().domain(drag.current?.domain ?? [minVal, maxVal || 1]).range([ih, 0])
  if (!drag.current) y.nice()

  // One [y0, y1] pair per (category, group) in a stable order (category-major, all groups) for tweening.
  const geometry = useMemo(() => cats.map((c, ci) => tab.groups.map((g) => {
    if (!visible.includes(g)) return [y(0), y(0)]
    if (stacked) {
      const s = series.find((ss) => ss.key === g)
      const d = s?.[ci]
      return d ? [y(d[0]), y(d[1])] : [y(0), y(0)]
    }
    return [y(0), y(tab.value(c, g))]
  })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [cats, tab, series, visible.join(), stacked, ih, y.domain()[0], y.domain()[1]])
  const shown = useTween(geometry, { snapKey: `${iw}x${ih}${cats.join()}${params.swap}`, enabled: !compact && !dragging })

  if (!c1 || !c2 || !valueCol) return <ChartMessage>범주, 그룹, 값 열을 모두 선택하세요.</ChartMessage>
  if (!cats.length) return <ChartMessage>그릴 범주가 없습니다.</ChartMessage>
  const editable = !!onTableChange && !compact && !stacked && params.agg !== 'count'
  const digits = dragDigits(y.domain()[1] - y.domain()[0])

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!editable) return
    const t = (e.target as Element).closest('[data-key]')
    if (!t) return
    const [c, g] = t.getAttribute('data-key')!.split('\u0001')
    const rows = tab.rows(c, g)
    if (rows.length !== 1) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { row: rows[0], domain: y.domain() as [number, number] }
    setDragging(true)
    hide()
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return
    const p = localPoint(svgRef.current!, e)
    onTableChange!(updateRow(table, drag.current.row, { [valueCol]: roundTo(Math.max(0, y.invert(p.y - m.top)), digits) }), true)
  }
  const onUp = () => {
    if (!drag.current) return
    drag.current = null
    setDragging(false)
    onTableChange!(table, false)
  }

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} role="img" data-testid="chart-svg"
        aria-label={`${stacked ? '누적' : '그룹'} 막대그래프: ${catCol}별, ${groupCol}로 구분한 ${valueCol}`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisLeft scale={y} x={0} grid={iw} label={stacked && params.mode === 'normalize' ? '비율' : valueCol} compact={compact} format={stacked && params.mode === 'normalize' ? (v) => pct(v, 0) : undefined} />
          {cats.map((c, ci) => (
            <g key={c} transform={`translate(${x0(c) ?? 0},0)`} className="marks">
              {tab.groups.map((g, gi) => {
                if (!visible.includes(g)) return null
                const [ya, yb] = shown[ci]?.[gi] ?? geometry[ci][gi]
                const v = tab.value(c, g)
                const bx = stacked ? 0 : x1(g) ?? 0
                const bw = stacked ? x0.bandwidth() : x1.bandwidth()
                const top = Math.min(ya, yb)
                const h = Math.abs(yb - ya)
                const share = total(c) ? v / total(c) : 0
                return (
                  <g key={g}>
                    <rect className={`mark-bar ${editable && tab.rows(c, g).length === 1 ? 'is-draggable' : ''}`} data-key={`${c}\u0001${g}`} x={bx} width={bw} y={top} height={h}
                      fill={color(g)} stroke={stacked ? '#fff' : 'none'} strokeWidth={stacked ? 1 : 0}
                      onPointerEnter={compact ? undefined : (e) => {
                        if (drag.current) return
                        const lp = localPoint(svgRef.current!, e)
                        show(lp.x, lp.y, <><b>{c} · {g}</b><br />{valueCol}: {fmt(v)}<br />{c} 안 비율: {pct(share)}</>)
                      }} onPointerLeave={hide} />
                    {params.labels && !compact && h > 14 && bw > 22 && (
                      <text className="bar-label inside" x={bx + bw / 2} y={stacked ? top + h / 2 : top - 5} dy={stacked ? '0.35em' : 0} textAnchor="middle">
                        {stacked && params.mode === 'normalize' ? pct(share, 0) : fmt(v)}
                      </text>
                    )}
                  </g>
                )
              })}
              {stacked && params.totals && params.mode === 'stack' && !compact && (
                <text className="bar-label" x={x0.bandwidth() / 2} y={y(total(c)) - 6} textAnchor="middle">{fmt(total(c))}</text>
              )}
            </g>
          ))}
          <BandAxis scale={x0} orient="bottom" offset={ih} label={catCol ?? undefined} compact={compact} />
        </g>
      </svg>
      {!compact && (
        <>
          <Legend items={tab.groups.map((g) => ({ key: g, color: color(g) }))} hidden={params.hidden} title={groupCol ?? undefined} onToggle={(k) => setParams({ hidden: toggleIn(params.hidden, k) })} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function SharedControls({ params, setParams, stacked }: ControlsProps<MultiBarParams> & { stacked?: boolean }) {
  return (
    <>
      <ControlGroup title="구성">
        <Toggle label="범주와 그룹 바꾸기" description="가로축 범주와 색 구분 그룹의 역할을 맞바꿉니다" checked={params.swap} onChange={(swap) => setParams({ swap, hidden: [] })} testId="ctl-swap" />
        <Select label="집계" value={params.agg} onChange={(agg) => setParams({ agg })} options={aggOptions} />
        <Select label="범주 정렬" value={params.sort} onChange={(sort) => setParams({ sort })} testId="ctl-sort"
          options={[{ value: 'none', label: '데이터 순서' }, { value: 'desc', label: '합계 내림차순' }, { value: 'asc', label: '합계 오름차순' }]} />
      </ControlGroup>
      {stacked ? (
        <ControlGroup title="쌓기">
          <Segmented label="표현" value={params.mode} onChange={(mode) => setParams({ mode })} testId="ctl-mode"
            options={[{ value: 'stack', label: '실제 값' }, { value: 'normalize', label: '100% 비율' }]} />
          <Select label="쌓는 순서" value={params.order} onChange={(order) => setParams({ order })} testId="ctl-order"
            options={[{ value: 'none', label: '데이터 순서' }, { value: 'ascending', label: '작은 그룹 아래' }, { value: 'descending', label: '큰 그룹 아래' }, { value: 'insideOut', label: '안쪽에서 바깥으로' }]} />
          <Hint>맨 아래 그룹만 공통 기준선에서 시작합니다. 위쪽 조각은 길이를 비교하기 어려우니 중요한 그룹을 아래에 두세요.</Hint>
          <Toggle label="합계 표시" checked={params.totals} onChange={(totals) => setParams({ totals })} />
        </ControlGroup>
      ) : (
        <ControlGroup title="간격">
          <Slider label="그룹 내 막대 간격" value={params.innerPad} min={0} max={0.5} step={0.02} onChange={(innerPad) => setParams({ innerPad })} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-pad" />
          <Hint>막대 위쪽 끝을 드래그하면 해당 셀의 값을 바꿀 수 있습니다.</Hint>
        </ControlGroup>
      )}
      <ControlGroup title="표시">
        <Toggle label="값 레이블" checked={params.labels} onChange={(labels) => setParams({ labels })} testId="ctl-labels" />
        <Hint>범례 항목을 클릭하면 그 그룹을 숨기거나 다시 표시합니다.</Hint>
      </ControlGroup>
    </>
  )
}

const roles = [
  { key: 'category', label: '범주 (가로축)', type: 'category' as const, required: true },
  { key: 'group', label: '그룹 (색상)', type: 'category' as const, required: true },
  { key: 'value', label: '값', type: 'number' as const, required: true },
]

export const groupedBarModule: VizModule<MultiBarParams> = {
  roles,
  datasets: ['categorical', 'budget'],
  defaultParams: defaults,
  Chart: (p) => <MultiBarChart {...p} />,
  Controls: (p) => <SharedControls {...p} />,
  hint: '막대 끝을 드래그해 값 수정 · 범례를 클릭해 그룹 숨기기',
}

export const stackedBarModule: VizModule<MultiBarParams> = {
  roles,
  datasets: ['categorical', 'budget'],
  defaultParams: { ...defaults, labels: true },
  Chart: (p) => <MultiBarChart {...p} stacked />,
  Controls: (p) => <SharedControls {...p} stacked />,
  hint: '범례를 클릭해 그룹을 빼면 나머지가 다시 쌓입니다 · 막대에 마우스를 올려 비율 확인',
}

// ─── 100% stacked bar ────────────────────────────────────────────────────────

function Stacked100Controls({ params, setParams, table, mapping }: ControlsProps<MultiBarParams>) {
  const c1 = roleColumn(mapping, 'category')
  const c2 = roleColumn(mapping, 'group')
  const catCol = params.swap ? c2 : c1
  const groupCol = params.swap ? c1 : c2
  const tab = crossTab(table, catCol, groupCol, roleColumn(mapping, 'value'), (v) => aggregate(v, params.agg))
  const share = (c: string, g: string) => {
    const t = d3.sum(tab.groups, (k) => tab.value(c, k))
    return t ? tab.value(c, g) / t : 0
  }
  return (
    <>
      <ControlGroup title="비율 계산">
        <Segmented label="축 기준" value={params.mode} onChange={(mode) => setParams({ mode })} testId="ctl-mode"
          options={[{ value: 'normalize', label: '백분율 (100%)' }, { value: 'stack', label: '절댓값' }]} />
        <Hint>{params.mode === 'normalize' ? '막대마다 합계로 나눠 높이를 모두 100%로 맞춥니다. 범주 사이의 구성 비교에는 좋지만 전체 크기 정보는 사라집니다.' : '같은 데이터를 실제 값으로 쌓은 모습입니다. 합계가 다른 범주의 크기를 함께 볼 수 있습니다.'}</Hint>
        <Select label="집계" value={params.agg} onChange={(agg) => setParams({ agg })} options={aggOptions} />
        <Toggle label="범주와 그룹 바꾸기" checked={params.swap} onChange={(swap) => setParams({ swap, hidden: [], shareOf: '' })} testId="ctl-swap" />
      </ControlGroup>
      <ControlGroup title="정렬">
        <Select label="범주 정렬" value={params.sort === 'share' ? 'share' : 'none'} onChange={(v) => setParams({ sort: v === 'share' ? 'share' : 'none', shareOf: v === 'share' && !params.shareOf ? tab.groups[0] ?? '' : params.shareOf })} testId="ctl-sort"
          options={[{ value: 'none', label: '데이터 순서' }, { value: 'share', label: '선택한 그룹의 비율 순' }]} />
        {params.sort === 'share' && (
          <Select label="기준 그룹" value={params.shareOf} onChange={(shareOf) => setParams({ shareOf })} testId="ctl-share-of"
            options={tab.groups.map((g) => ({ value: g, label: g }))} />
        )}
        <Select label="쌓는 순서" value={params.order} onChange={(order) => setParams({ order })}
          options={[{ value: 'none', label: '데이터 순서' }, { value: 'ascending', label: '작은 그룹 아래' }, { value: 'descending', label: '큰 그룹 아래' }]} />
        <Toggle label="비율 레이블" checked={params.labels} onChange={(labels) => setParams({ labels })} testId="ctl-labels" />
      </ControlGroup>
      <ControlGroup title="비율 표" defaultOpen={false}>
        <StatTable rows={[[catCol ?? '', ...tab.groups], ...tab.cats.map((c) => [c, ...tab.groups.map((g) => pct(share(c, g), 1))])]} />
        <Hint>각 칸은 그 범주 합계에서 그룹이 차지하는 비율이며, 한 행의 합은 항상 100%입니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const stacked100Module: VizModule<MultiBarParams> = {
  roles,
  datasets: ['categorical', 'budget'],
  defaultParams: { ...defaults, mode: 'normalize', labels: true },
  Chart: (p) => <MultiBarChart {...p} stacked />,
  Controls: (p) => <Stacked100Controls {...p} />,
  hint: '막대 조각에 마우스를 올려 비율 확인 · 범례로 그룹을 빼면 남은 그룹이 다시 100%가 됩니다',
}
