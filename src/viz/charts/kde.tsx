import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Legend, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { categoryColor } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { useTween } from '../../hooks/motion'
import { extent } from '../../stats/descriptive'
import { binValues } from '../../stats/histogram'
import { kde, kdeGrid, kernelReach, kernels, scottBandwidth, silvermanBandwidth, type KernelName } from '../../stats/kde'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { addValueAt, Rug } from './distShared'
import { groupedValues, type ValueGroup, markedValues, rowsNear } from './shared'

export interface KdeParams {
  bwMode: 'silverman' | 'scott' | 'manual'
  /** Manual bandwidth as a fraction of the data range (so the slider works for any unit). */
  bwFrac: number
  kernel: KernelName
  showKernels: boolean
  showHist: boolean
  showRug: boolean
  fill: boolean
}

export const kernelOptions: { value: KernelName; label: string }[] = [
  { value: 'gaussian', label: '가우시안' },
  { value: 'epanechnikov', label: '에파네치니코프' },
  { value: 'triangular', label: '삼각' },
  { value: 'uniform', label: '균등(사각)' },
]

export function bandwidthFor(values: number[], mode: KdeParams['bwMode'], frac: number, span: number) {
  if (mode === 'silverman') return silvermanBandwidth(values)
  if (mode === 'scott') return scottBandwidth(values)
  return Math.max(1e-9, frac * span)
}

const dataSpan = (groups: ValueGroup[]) => {
  const [lo, hi] = extent(groups.flatMap((g) => g.values))
  return hi > lo ? hi - lo : 1
}

function KdeChart({ table, mapping, params, width, height, compact, onTableChange, linked }: ChartProps<KdeParams>) {
  const valueCol = roleColumn(mapping, 'value')
  const groupCol = roleColumn(mapping, 'group')
  const groups = useMemo(() => groupedValues(table, valueCol, groupCol), [table, valueCol, groupCol])
  const color = useMemo(() => (groupCol ? categoryColor(groups.map((g) => g.key)) : () => '#2a8c82'), [groups, groupCol])
  const m = margins(compact)
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const { tip, show, hide } = useTooltip()

  const model = useMemo(() => {
    const all = groups.flatMap((g) => g.values)
    if (!all.length) return null
    const span = dataSpan(groups)
    const bws = groups.map((g) => bandwidthFor(g.values, params.bwMode, params.bwFrac, span))
    const reach = kernelReach[params.kernel] * Math.max(...bws)
    const [lo, hi] = extent(all)
    const grid = kdeGrid(lo, hi, Math.min(reach, span * 0.6), 200)
    const curves = groups.map((g, k) => ({ key: g.key, h: bws[k], ys: kde(g.values, bws[k], params.kernel, grid) }))
    // Trapezoid rule over the grid: should be ≈ 1 whenever the grid covers the kernel support.
    const area = curves.map((c) => d3.sum(c.ys.slice(1), (v, i) => ((v + c.ys[i]) / 2) * (grid[i + 1] - grid[i])))
    return { all, grid, curves, area, span }
  }, [groups, params.bwMode, params.bwFrac, params.kernel])

  const x = useMemo(() => d3.scaleLinear().domain(model ? [model.grid[0], model.grid[model.grid.length - 1]] : [0, 1]).range([0, iw]), [model, iw])
  const hist = useMemo(() => {
    if (!params.showHist || !model) return null
    const edges = d3.ticks(model.grid[0], model.grid[model.grid.length - 1], 24)
    return binValues(model.all, edges).bins
  }, [params.showHist, model])
  const yMax = Math.max(d3.max(model?.curves ?? [], (c) => d3.max(c.ys)) ?? 0, hist ? d3.max(hist, (b) => b.density) ?? 0 : 0)
  const y = d3.scaleLinear().domain([0, yMax * 1.08 || 1]).range([ih, 0]).nice()
  const target = useMemo(() => (model ? model.curves.map((c) => c.ys.map((v) => y(v))) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, ih, y.domain()[1]])
  const shown = useTween(target, { snapKey: `${iw}x${ih}`, enabled: !compact })

  if (!valueCol) return <ChartMessage>값으로 사용할 숫자형 열을 선택하세요.</ChartMessage>
  if (!model) return <ChartMessage>숫자 값이 없습니다.</ChartMessage>

  const editable = !!onTableChange && !compact
  const grid = model.grid
  const single = groups.length === 1 ? groups[0] : null
  const K = kernels[params.kernel]
  const bumps = params.showKernels && single && single.values.length <= 150 && !compact
    ? single.values.map((v) => {
      const h = model.curves[0].h
      const n = single.values.length
      const pts = grid.filter((gx) => Math.abs(gx - v) <= kernelReach[params.kernel] * h).map((gx) => [gx, K((gx - v) / h) / (n * h)] as [number, number])
      return { v, pts }
    })
    : []

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} role="img" data-testid="chart-svg"
        aria-label={`KDE 플롯: ${valueCol}, 대역폭 ${fmt(model.curves[0].h, 3)}`}
        onPointerUp={(e) => { if (editable) { const t = addValueAt(e, svgRef.current!, m, iw, ih, x, table, valueCol, groupCol, groups[0]?.key); if (t) onTableChange!(t) } }}
        onPointerMove={compact ? undefined : (e) => {
          const lp = localPoint(svgRef.current!, e)
          const gx = x.invert(lp.x - m.left)
          if (gx < grid[0] || gx > grid[grid.length - 1]) { hide(); return }
          const i = Math.round(((gx - grid[0]) / (grid[grid.length - 1] - grid[0])) * (grid.length - 1))
          // The observations that feed the density at this position: those within one bandwidth.
          linked?.set(rowsNear(groups, gx, model.curves[0].h))
          show(lp.x, lp.y, <>{valueCol} = {fmt(grid[i])}<br />{model.curves.map((c) => <span key={c.key}>{groupCol ? `${c.key}: ` : 'f̂(x) = '}{fmt(c.ys[i], 4)}<br /></span>)}</>)
        }}
        onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${m.left},${m.top})`}>
          <rect width={iw} height={ih} className="plot-bg" fill="transparent" />
          <AxisLeft scale={y} x={0} grid={iw} label="밀도" compact={compact} format={(v) => fmt(v, 3)} />
          {hist && hist.map((b, i) => <rect key={i} className="hist-ghost" x={x(b.x0) + 0.5} width={Math.max(0, x(b.x1) - x(b.x0) - 1)} y={y(b.density)} height={ih - y(b.density)} />)}
          {bumps.map((b, i) => <path key={i} className="kernel-bump" d={d3.line().x((p) => x(p[0])).y((p) => y(p[1]))(b.pts) ?? ''} />)}
          {model.curves.map((c, k) => {
            const ys = shown[k] ?? target[k]
            const line = d3.line<number>().x((_, i) => x(grid[i])).y((v) => v)(ys) ?? ''
            const area = d3.area<number>().x((_, i) => x(grid[i])).y0(ih).y1((v) => v)(ys) ?? ''
            return (
              <g key={c.key} className="marks">
                {params.fill && <path d={area} fill={color(c.key)} fillOpacity={groups.length > 1 ? 0.18 : 0.22} />}
                <path className="kde-curve" d={line} stroke={color(c.key)} data-testid={`kde-curve-${k}`} />
              </g>
            )
          })}
          <AxisBottom scale={x} y={ih} label={valueCol} compact={compact} />
          {params.showRug && !compact && <Rug groups={groups} x={x} y={ih} color={color} editable={editable} table={table} onTableChange={onTableChange} />}
          {markedValues(groups, linked?.rows ?? []).slice(0, 400).map((q) => {
            const k = Math.max(0, model.curves.findIndex((c) => c.key === q.key))
            const gi = Math.max(0, Math.min(grid.length - 1, Math.round(((q.v - grid[0]) / (grid[grid.length - 1] - grid[0])) * (grid.length - 1))))
            return <circle key={q.row} cx={x(q.v)} cy={y(model.curves[k].ys[gi])} r={4} fill="#e07a3f" stroke="#fff" strokeWidth={1.5} pointerEvents="none" data-testid="linked-mark" />
          })}
        </g>
      </svg>
      {!compact && (
        <>
          {groupCol && <Legend items={groups.map((g) => ({ key: g.key, color: color(g.key) }))} title={groupCol} />}
          <Readout items={[
            { label: 'n', value: model.all.length },
            { label: '대역폭 h', value: groups.length === 1 ? fmt(model.curves[0].h, 3) : model.curves.map((c) => fmt(c.h, 2)).join(' / ') },
            { label: '곡선 아래 넓이', value: fmt(model.area[0], 3) },
          ]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function KdeControls({ params, setParams, table, mapping }: ControlsProps<KdeParams>) {
  const groups = groupedValues(table, roleColumn(mapping, 'value'), roleColumn(mapping, 'group'))
  const all = groups.flatMap((g) => g.values)
  const span = groups.length ? dataSpan(groups) : 1
  const current = all.length ? bandwidthFor(all, params.bwMode, params.bwFrac, span) : 0
  return (
    <>
      <ControlGroup title="대역폭 (Bandwidth)">
        <Segmented label="결정 방식" value={params.bwMode} testId="ctl-bwmode"
          onChange={(bwMode) => setParams(bwMode === 'manual' ? { bwMode, bwFrac: Math.min(0.5, Math.max(0.005, current / span)) } : { bwMode })}
          options={[{ value: 'silverman', label: 'Silverman' }, { value: 'scott', label: 'Scott' }, { value: 'manual', label: '직접' }]} />
        <Slider label="대역폭 h" value={params.bwMode === 'manual' ? params.bwFrac : Math.min(0.5, current / span)} min={0.005} max={0.5} step={0.005}
          onChange={(bwFrac) => setParams({ bwFrac, bwMode: 'manual' })} format={() => fmt(params.bwMode === 'manual' ? params.bwFrac * span : current, 3)} testId="ctl-bw" />
        <Hint>h가 작으면 곡선이 들쭉날쭉해지고(과소평활), 크면 봉우리가 뭉개집니다(과대평활).</Hint>
      </ControlGroup>
      <ControlGroup title="커널">
        <Select label="커널 함수" value={params.kernel} onChange={(kernel) => setParams({ kernel })} options={kernelOptions} testId="ctl-kernel" />
        <Toggle label="개별 커널 표시" description="각 관측값에 얹힌 K((x−xᵢ)/h)/(nh) (그룹이 없고 150개 이하일 때)" checked={params.showKernels} onChange={(showKernels) => setParams({ showKernels })} testId="ctl-kernels" />
      </ControlGroup>
      <ControlGroup title="표시">
        <Toggle label="곡선 아래 채우기" checked={params.fill} onChange={(fill) => setParams({ fill })} />
        <Toggle label="밀도 히스토그램 겹치기" checked={params.showHist} onChange={(showHist) => setParams({ showHist })} />
        <Toggle label="관측값 러그" description="눈금을 클릭하면 삭제" checked={params.showRug} onChange={(showRug) => setParams({ showRug })} />
      </ControlGroup>
    </>
  )
}

export const kdeModule: VizModule<KdeParams> = {
  roles: [
    { key: 'value', label: '값', type: 'number', required: true },
    { key: 'group', label: '그룹', type: 'category' },
  ],
  datasets: ['bimodal', 'normal', 'skewed', 'uniform', 'groups', 'outliers'],
  defaultParams: { bwMode: 'silverman', bwFrac: 0.05, kernel: 'gaussian', showKernels: false, showHist: false, showRug: true, fill: true },
  Chart: KdeChart,
  Controls: KdeControls,
  hint: '그래프를 클릭해 관측값 추가 · 러그 눈금 클릭으로 삭제 · 곡선 위에서 밀도 값 확인',
}
