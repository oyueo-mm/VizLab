import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Legend, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { categoryColor } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { useTween } from '../../hooks/motion'
import { binValues, equalEdges, suggestBinCount, type BinRule, type HistogramNorm } from '../../stats/histogram'
import { kde, kdeGrid, silvermanBandwidth } from '../../stats/kde'
import { extent } from '../../stats/descriptive'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { addValueAt, Rug } from './distShared'
import { groupedValues, markedValues } from './shared'

export interface HistogramParams {
  rule: 'custom' | BinRule
  bins: number
  offset: number
  norm: HistogramNorm
  layout: 'overlay' | 'stack'
  showKde: boolean
  showRug: boolean
}

const normLabel: Record<HistogramNorm, string> = { count: '개수', density: '밀도', relative: '상대도수' }

/** Shared bin layout for all groups so their bars line up. */
export function histogramLayout(values: number[], params: Pick<HistogramParams, 'rule' | 'bins' | 'offset'>) {
  const k = params.rule === 'custom' ? params.bins : suggestBinCount(values, params.rule)
  let [lo, hi] = extent(values)
  if (!values.length) { lo = 0; hi = 1 }
  if (lo === hi) { lo -= 0.5; hi += 0.5 }
  const width = (hi - lo) / k
  const edges = equalEdges(lo - params.offset * width, width, k + (params.offset > 0 ? 1 : 0))
  return { k, width, edges }
}

function HistogramChart({ table, mapping, params, width, height, compact, onTableChange, linked }: ChartProps<HistogramParams>) {
  const valueCol = roleColumn(mapping, 'value')
  const groupCol = roleColumn(mapping, 'group')
  const groups = useMemo(() => groupedValues(table, valueCol, groupCol), [table, valueCol, groupCol])
  const all = useMemo(() => groups.flatMap((g) => g.values), [groups])
  const color = useMemo(() => (groupCol ? categoryColor(groups.map((g) => g.key)) : () => '#2a8c82'), [groups, groupCol])
  const m = margins(compact)
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const { tip, show, hide } = useTooltip()

  const layout = useMemo(() => histogramLayout(all, params), [all, params])
  const marks = useMemo(() => markedValues(groups, linked?.rows ?? []), [groups, linked?.rows])
  const perGroup = useMemo(() => groups.map((g) => {
    const { bins } = binValues(g.values, layout.edges)
    // Normalise each group by its own n so densities stay comparable (each integrates to 1).
    return { key: g.key, bins }
  }), [groups, layout])
  const value = (b: { count: number; density: number; relative: number }) => b[params.norm]
  const stacked = params.layout === 'stack' && groups.length > 1
  const yMax = useMemo(() => {
    if (stacked) return d3.max(layout.edges.slice(0, -1).map((_, i) => d3.sum(perGroup, (g) => value(g.bins[i])))) ?? 1
    return d3.max(perGroup, (g) => d3.max(g.bins, value)) ?? 1
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perGroup, stacked, params.norm, layout])
  const x = d3.scaleLinear().domain([layout.edges[0], layout.edges[layout.edges.length - 1]]).range([0, iw])
  const kdeCurves = useMemo(() => {
    if (!params.showKde) return []
    const grid = kdeGrid(layout.edges[0], layout.edges[layout.edges.length - 1], 0, 120)
    return groups.map((g) => {
      const d = kde(g.values, silvermanBandwidth(g.values), 'gaussian', grid)
      // Convert the density to the histogram's scale: count = n·w·f, relative = w·f.
      const factor = params.norm === 'count' ? g.values.length * layout.width : params.norm === 'relative' ? layout.width : 1
      return { key: g.key, pts: grid.map((gx, i) => [gx, d[i] * factor] as [number, number]) }
    })
  }, [params.showKde, params.norm, groups, layout])
  const kdeMax = d3.max(kdeCurves, (c) => d3.max(c.pts, (p) => p[1])) ?? 0
  const y = d3.scaleLinear().domain([0, Math.max(yMax, stacked ? 0 : kdeMax) * 1.06 || 1]).range([ih, 0]).nice()

  const geometry = useMemo(() => {
    const out: number[][] = []
    const base = layout.edges.slice(0, -1).map(() => 0)
    perGroup.forEach((g) => {
      out.push(g.bins.map((b, i) => {
        const v = value(b)
        const y0 = stacked ? base[i] : 0
        if (stacked) base[i] += v
        return [y(y0 + v), y(y0)]
      }).flat())
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perGroup, stacked, params.norm, ih, y.domain()[1]])
  const shown = useTween(geometry, { snapKey: `${iw}x${ih}`, enabled: !compact })

  if (!valueCol) return <ChartMessage>값으로 사용할 숫자형 열을 선택하세요.</ChartMessage>
  if (!all.length) return <ChartMessage>숫자 값이 없습니다. 데이터 탭에서 값을 입력하세요.</ChartMessage>

  const editable = !!onTableChange && !compact
  const n = all.length
  const opacity = groups.length > 1 && !stacked ? 0.5 : 0.85
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} role="img" data-testid="chart-svg"
        aria-label={`히스토그램: ${valueCol}, 구간 ${layout.edges.length - 1}개, ${n}개 관측`}
        onPointerUp={(e) => { if (editable) { const t = addValueAt(e, svgRef.current!, m, iw, ih, x, table, valueCol, groupCol, groups[0]?.key); if (t) onTableChange!(t) } }}
        onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <rect width={iw} height={ih} className="plot-bg" fill="transparent" />
          <AxisLeft scale={y} x={0} grid={iw} label={normLabel[params.norm]} compact={compact} format={params.norm === 'count' ? undefined : (v) => fmt(v, 3)} />
          {perGroup.map((g, gi) => (
            <g key={g.key} className="marks">
              {g.bins.map((b, i) => {
                const yTop = shown[gi]?.[i * 2] ?? geometry[gi][i * 2]
                const yBottom = shown[gi]?.[i * 2 + 1] ?? geometry[gi][i * 2 + 1]
                const last = i === g.bins.length - 1
                const inBin = (v: number) => v >= b.x0 && (v < b.x1 || (last && v <= b.x1))
                const marked = marks.some((q) => q.key === g.key && inBin(q.v))
                return (
                  <rect key={i} className="mark-bar" stroke={marked ? '#e07a3f' : undefined} strokeWidth={marked ? 2.5 : undefined} x={x(b.x0) + 0.5} width={Math.max(0, x(b.x1) - x(b.x0) - 1)} y={Math.min(yTop, yBottom)} height={Math.abs(yBottom - yTop)}
                    fill={color(g.key)} fillOpacity={opacity} data-count={b.count}
                    onPointerEnter={compact ? undefined : (e) => {
                      const src = groups[gi]
                      linked?.set(src.rows.filter((_, k) => inBin(src.values[k])))
                      const lp = localPoint(svgRef.current!, e)
                      show(lp.x, lp.y, <>{groupCol && <><b>{g.key}</b><br /></>}구간 [{fmt(b.x0)}, {fmt(b.x1)}{i === g.bins.length - 1 ? ']' : ')'}<br />개수 {b.count} · 상대도수 {pct(b.relative)}<br />밀도 {fmt(b.density, 4)}</>)
                    }} onPointerLeave={() => { hide(); linked?.set(null) }} />
                )
              })}
            </g>
          ))}
          {kdeCurves.map((c) => (
            <path key={c.key} className="kde-line" d={d3.line().x((p) => x(p[0])).y((p) => y(p[1]))(c.pts) ?? ''} stroke={groupCol ? d3.color(color(c.key))!.darker(0.6).formatHex() : '#1f2937'} />
          ))}
          {!compact && (
            <g className="bin-edges" transform={`translate(0,${ih})`} aria-hidden="true">
              {layout.edges.map((e, i) => <line key={i} x1={x(e)} x2={x(e)} y1={0} y2={4} />)}
            </g>
          )}
          <AxisBottom scale={x} y={ih} label={valueCol} compact={compact} />
          {params.showRug && !compact && <Rug groups={groups} x={x} y={ih} color={color} editable={editable} table={table} onTableChange={onTableChange} />}
        </g>
      </svg>
      {!compact && (
        <>
          {groupCol && <Legend items={groups.map((g) => ({ key: g.key, color: color(g.key) }))} title={groupCol} />}
          <Readout items={[
            { label: 'n', value: n },
            { label: '구간 수', value: layout.edges.length - 1 },
            { label: '구간 폭', value: fmt(layout.width, 3) },
          ]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function HistogramControls({ params, setParams, table, mapping }: ControlsProps<HistogramParams>) {
  const groups = groupedValues(table, roleColumn(mapping, 'value'), null)
  const values = groups[0]?.values ?? []
  const suggestion = (rule: BinRule) => (values.length ? suggestBinCount(values, rule) : 0)
  return (
    <>
      <ControlGroup title="구간(Bin)">
        <Select label="구간 수 결정 규칙" value={params.rule} onChange={(rule) => setParams({ rule, bins: rule === 'custom' ? params.bins : suggestion(rule) })} testId="ctl-rule"
          options={[
            { value: 'custom', label: '직접 지정' },
            { value: 'sturges', label: `Sturges (${suggestion('sturges')}개)` },
            { value: 'sqrt', label: `제곱근 √n (${suggestion('sqrt')}개)` },
            { value: 'scott', label: `Scott (${suggestion('scott')}개)` },
            { value: 'fd', label: `Freedman–Diaconis (${suggestion('fd')}개)` },
          ]} />
        <Slider label="구간 개수" value={params.rule === 'custom' ? params.bins : suggestion(params.rule)} min={1} max={80} onChange={(bins) => setParams({ bins, rule: 'custom' })} testId="ctl-bins" />
        <Slider label="경계 이동" value={params.offset} min={0} max={0.95} step={0.05} onChange={(offset) => setParams({ offset })} format={(v) => `${Math.round(v * 100)}% 폭`} testId="ctl-offset" />
        <Hint>구간 폭은 그대로 두고 경계만 옮겨도 모양이 달라집니다. 히스토그램이 구간 설정에 민감하다는 뜻입니다.</Hint>
      </ControlGroup>
      <ControlGroup title="세로축">
        <Segmented label="표현" value={params.norm} onChange={(norm) => setParams({ norm })} testId="ctl-norm"
          options={[{ value: 'count', label: '개수' }, { value: 'relative', label: '상대도수' }, { value: 'density', label: '밀도' }]} />
        <Hint>밀도 = 개수 ÷ (n × 구간 폭). 막대 넓이의 합이 1이 되어 확률밀도 곡선과 비교할 수 있습니다.</Hint>
        {mapping.group && <Segmented label="그룹 배치" value={params.layout} onChange={(layout) => setParams({ layout })} options={[{ value: 'overlay', label: '겹치기' }, { value: 'stack', label: '쌓기' }]} />}
      </ControlGroup>
      <ControlGroup title="겹쳐 그리기">
        <Toggle label="KDE 곡선" checked={params.showKde} onChange={(showKde) => setParams({ showKde })} testId="ctl-kde" />
        <Toggle label="관측값 러그" description="눈금을 클릭하면 그 관측값이 삭제됩니다" checked={params.showRug} onChange={(showRug) => setParams({ showRug })} />
      </ControlGroup>
    </>
  )
}

export const histogramModule: VizModule<HistogramParams> = {
  roles: [
    { key: 'value', label: '값', type: 'number', required: true },
    { key: 'group', label: '그룹', type: 'category' },
  ],
  datasets: ['normal', 'bimodal', 'skewed', 'uniform', 'groups', 'outliers'],
  defaultParams: { rule: 'custom', bins: 16, offset: 0, norm: 'count', layout: 'overlay', showKde: false, showRug: true },
  Chart: HistogramChart,
  Controls: HistogramControls,
  hint: '그래프를 클릭하면 그 위치에 관측값이 추가됩니다 · 아래 러그 눈금을 클릭하면 삭제',
}
