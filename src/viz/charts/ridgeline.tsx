import * as d3 from 'd3'
import { useMemo, useRef, useState } from 'react'
import { AxisBottom, ChartMessage, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ColorField, ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { appendRow, templateRow } from '../../data/table'
import { useTween } from '../../hooks/motion'
import { categoryColor } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { extent, mean, median } from '../../stats/descriptive'
import { kde, kdeGrid, silvermanBandwidth, type KernelName } from '../../stats/kde'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { kernelOptions } from './kde'
import { dragDigits, groupedValues, roundTo } from './shared'

export interface RidgelineParams {
  bwScale: number
  kernel: KernelName
  /** Ridge height as a multiple of the spacing between baselines (> 1 overlaps). */
  overlap: number
  maxGroups: number
  order: 'data' | 'mean-asc' | 'mean-desc'
  scale: 'shared' | 'each'
  colorMode: 'palette' | 'gradient' | 'single'
  colors: Record<string, string>
  opacity: number
  median: boolean
}

const GRID = 140

/** Baseline y of ridge i (0 = top) and the pixel height of a full-scale ridge. */
export function ridgeGeometry(count: number, innerHeight: number, overlap: number) {
  const step = innerHeight / Math.max(1, count - 1 + overlap)
  return { step, ridge: step * overlap, baseline: (i: number) => step * overlap + i * step }
}

function RidgelineChart({ table, mapping, params, width, height, compact, onTableChange }: ChartProps<RidgelineParams>) {
  const valueCol = roleColumn(mapping, 'value')
  const groupCol = roleColumn(mapping, 'group')
  const all = useMemo(() => groupedValues(table, valueCol, groupCol), [table, valueCol, groupCol])
  const groups = useMemo(() => {
    const out = [...all]
    if (params.order === 'mean-asc') out.sort((a, b) => mean(a.values) - mean(b.values))
    if (params.order === 'mean-desc') out.sort((a, b) => mean(b.values) - mean(a.values))
    return out.slice(0, Math.max(1, params.maxGroups))
  }, [all, params.order, params.maxGroups])
  const m = margins(compact, compact ? {} : { left: 74, top: 30 })
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const { tip, show, hide } = useTooltip()

  const model = useMemo(() => {
    const values = groups.flatMap((g) => g.values)
    if (!values.length) return null
    const hs = groups.map((g) => silvermanBandwidth(g.values) * params.bwScale)
    const [lo, hi] = extent(values)
    const grid = kdeGrid(lo, hi, 2 * Math.max(...hs), GRID)
    const dens = groups.map((g, i) => kde(g.values, hs[i], params.kernel, grid))
    return { grid, dens, hs, total: values.length }
  }, [groups, params.bwScale, params.kernel])

  const x = d3.scaleLinear().domain(model ? [model.grid[0], model.grid[model.grid.length - 1]] : [0, 1]).range([0, iw])
  const geo = ridgeGeometry(groups.length, ih, params.overlap)
  const globalMax = model ? d3.max(model.dens, (d) => d3.max(d)) || 1 : 1
  const target = useMemo(() => (model ? model.dens.map((d) => {
    const localMax = d3.max(d) || 1
    return d.map((v) => (v / (params.scale === 'shared' ? globalMax : localMax)) * geo.ridge)
  }) : []), [model, params.scale, globalMax, geo.ridge])
  const shown = useTween(target, { snapKey: `${iw}x${ih}|${groups.map((g) => g.key).join()}`, enabled: !compact })

  if (!valueCol || !groupCol) return <ChartMessage>값(숫자형)과 그룹(범주형) 열을 선택하세요.</ChartMessage>
  if (!model) return <ChartMessage>숫자 값이 없습니다.</ChartMessage>
  const palette = categoryColor(all.map((g) => g.key))
  const colorOf = (key: string, i: number) => params.colors[key]
    ?? (params.colorMode === 'single' ? '#2a8c82' : params.colorMode === 'gradient' ? d3.interpolateViridis(0.12 + 0.76 * (groups.length > 1 ? i / (groups.length - 1) : 0.5)) : palette(key))
  const editable = !!onTableChange && !compact

  const groupAt = (py: number) => {
    // A pointer belongs to the ridge whose baseline is the first one at or below it.
    for (let i = 0; i < groups.length; i++) if (py <= geo.baseline(i) + 2) return i
    return groups.length - 1
  }

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} role="img" data-testid="chart-svg"
        aria-label={`릿지라인 플롯: ${groupCol}별 ${valueCol}의 밀도 ${groups.length}개`}
        onPointerMove={compact ? undefined : (e) => {
          const p = localPoint(svgRef.current!, e)
          const px = p.x - m.left
          const py = p.y - m.top
          if (px < 0 || px > iw || py < 0 || py > ih) { hide(); setHover(null); return }
          const gi = groupAt(py)
          setHover(gi)
          const g = groups[gi]
          const k = Math.max(0, Math.min(GRID - 1, Math.round((x.invert(px) - model.grid[0]) / (model.grid[1] - model.grid[0]))))
          show(p.x, p.y, <><b>{g.key}</b> (n = {g.values.length})<br />{valueCol} ≈ {fmt(model.grid[k])}: 밀도 {fmt(model.dens[gi][k], 4)}<br />평균 {fmt(mean(g.values))} · 중앙값 {fmt(median(g.values))}<br />대역폭 h = {fmt(model.hs[gi], 3)}{editable && <><br />클릭하면 이 위치에 값 추가</>}</>)
        }}
        onPointerLeave={() => { hide(); setHover(null) }}
        onPointerUp={editable ? (e) => {
          const p = localPoint(svgRef.current!, e)
          const px = p.x - m.left
          const py = p.y - m.top
          if (px < 0 || px > iw || py < 0 || py > ih) return
          const g = groups[groupAt(py)]
          const value = roundTo(x.invert(px), dragDigits(x.domain()[1] - x.domain()[0]))
          onTableChange!(appendRow(table, { ...templateRow(table), [groupCol]: g.key, [valueCol]: value }))
        } : undefined}>
        <g transform={`translate(${m.left},${m.top})`}>
          <rect width={iw} height={ih} className="plot-bg" fill="transparent" />
          <AxisBottom scale={x} y={ih} grid={ih} label={valueCol} compact={compact} />
          {groups.map((g, i) => {
            const base = geo.baseline(i)
            const h = shown[i] ?? target[i] ?? []
            const pts = model.grid.map((gv, k) => [x(gv), base - (h[k] ?? 0)] as [number, number])
            const c = colorOf(g.key, i)
            const area = d3.area<[number, number]>().curve(d3.curveBasis).x((p) => p[0]).y0(base).y1((p) => p[1])(pts) ?? ''
            const line = d3.line<[number, number]>().curve(d3.curveBasis)(pts) ?? ''
            const md = median(g.values)
            const k = Math.max(0, Math.min(GRID - 1, Math.round((md - model.grid[0]) / (model.grid[1] - model.grid[0]))))
            const faded = hover != null && hover !== i
            return (
              <g key={g.key} className="marks ridge" opacity={faded ? 0.45 : 1} data-group={g.key}>
                <path d={area} fill={c} fillOpacity={params.opacity} data-testid="ridge-area" />
                <path d={line} fill="none" stroke={compact ? c : '#fff'} strokeWidth={compact ? 1 : 1.6} />
                <path d={line} fill="none" stroke={d3.color(c)!.darker(0.8).formatHex()} strokeWidth={1} />
                <line x1={0} x2={iw} y1={base} y2={base} className="ridge-base" />
                {params.median && !compact && <line className="ridge-median" x1={x(md)} x2={x(md)} y1={base} y2={pts[k][1]} />}
                {!compact && <text className="ridge-label" x={-8} y={base} dy="-0.25em" textAnchor="end">{g.key}</text>}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          <Readout items={[{ label: '그룹', value: `${groups.length} / ${all.length}` }, { label: 'n', value: model.total.toLocaleString() }]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function RidgelineControls({ params, setParams, table, mapping }: ControlsProps<RidgelineParams>) {
  const groups = groupedValues(table, roleColumn(mapping, 'value'), roleColumn(mapping, 'group'))
  const palette = categoryColor(groups.map((g) => g.key))
  return (
    <>
      <ControlGroup title="그룹">
        <Slider label="표시할 그룹 수" value={Math.min(params.maxGroups, groups.length)} min={1} max={Math.max(1, groups.length)} onChange={(maxGroups) => setParams({ maxGroups })} testId="ctl-groups" />
        <Select label="그룹 순서" value={params.order} onChange={(order) => setParams({ order })} testId="ctl-order"
          options={[{ value: 'data', label: '데이터 순서' }, { value: 'mean-asc', label: '평균 오름차순' }, { value: 'mean-desc', label: '평균 내림차순' }]} />
      </ControlGroup>
      <ControlGroup title="밀도 추정">
        <Slider label="대역폭 배율" value={params.bwScale} min={0.2} max={3} step={0.05} onChange={(bwScale) => setParams({ bwScale })} format={(v) => `× ${v.toFixed(2)}`} testId="ctl-bw" />
        <Hint>각 그룹의 Silverman 대역폭 h = 0.9·min(σ, IQR/1.34)·n^(−1/5)에 곱합니다.</Hint>
        <Select label="커널 함수" value={params.kernel} onChange={(kernel) => setParams({ kernel })} options={kernelOptions} />
        <Segmented label="높이 기준" value={params.scale} onChange={(scale) => setParams({ scale })} testId="ctl-scale"
          options={[{ value: 'shared', label: '공통 밀도 축' }, { value: 'each', label: '그룹마다 최대 높이' }]} />
      </ControlGroup>
      <ControlGroup title="모양">
        <Slider label="곡선 간 간격 (겹침)" value={params.overlap} min={0.6} max={4} step={0.1} onChange={(overlap) => setParams({ overlap })} format={(v) => `× ${v.toFixed(1)}`} testId="ctl-overlap" />
        <Hint>1보다 크면 곡선이 위쪽 그룹과 겹칩니다. 높이 기준이 ‘공통 밀도 축’일 때만 그룹 사이 높이를 비교할 수 있습니다.</Hint>
        <Slider label="채움 불투명도" value={params.opacity} min={0.2} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} />
        <Toggle label="중앙값 표시" checked={params.median} onChange={(median) => setParams({ median })} />
      </ControlGroup>
      <ControlGroup title="색상">
        <Segmented label="색 지정 방식" value={params.colorMode} onChange={(colorMode) => setParams({ colorMode, colors: {} })} testId="ctl-color"
          options={[{ value: 'palette', label: '그룹별' }, { value: 'gradient', label: '순서 그라데이션' }, { value: 'single', label: '단색' }]} />
        <div className="color-grid">
          {groups.slice(0, params.maxGroups).map((g) => (
            <ColorField key={g.key} label={g.key} value={params.colors[g.key] ?? (params.colorMode === 'single' ? '#2a8c82' : palette(g.key))}
              onChange={(c) => setParams({ colors: { ...params.colors, [g.key]: c } })} />
          ))}
        </div>
      </ControlGroup>
    </>
  )
}

export const ridgelineModule: VizModule<RidgelineParams> = {
  roles: [
    { key: 'value', label: '값', type: 'number', required: true },
    { key: 'group', label: '그룹 (세로로 나열)', type: 'category', required: true },
  ],
  datasets: ['temps', 'groups', 'outliers'],
  defaultParams: { bwScale: 1, kernel: 'gaussian', overlap: 1.8, maxGroups: 12, order: 'data', scale: 'shared', colorMode: 'gradient', colors: {}, opacity: 0.8, median: true },
  Chart: RidgelineChart,
  Controls: RidgelineControls,
  hint: '그룹 영역을 클릭하면 그 위치에 값이 추가되어 해당 곡선이 다시 계산됩니다 · 마우스를 올려 밀도 확인',
}
