import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Readout, Tooltip, localPoint, margins, useSvgId, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { schemes, type SequentialScheme } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { bandwidth2d, contourPolygons, equalThresholds, hdrThresholds, kde2d } from '../../stats/kde2d'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { paddedDomain, pointRows } from './shared'

export interface Kde2dParams {
  /** Multiplier on Scott's bandwidth. */
  bandwidth: number
  levels: number
  levelMode: 'mass' | 'equal'
  display: 'contour' | 'fill' | 'both'
  scheme: SequentialScheme
  points: boolean
  pointOpacity: number
  grid: number
}

const MAX_KDE_POINTS = 4000

function Kde2dChart({ table, mapping, params, width, height, compact, linked }: ChartProps<Kde2dParams>) {
  const xCol = roleColumn(mapping, 'x')
  const yCol = roleColumn(mapping, 'y')
  const all = useMemo(() => pointRows(table, xCol, yCol), [table, xCol, yCol])
  const m = margins(compact)
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const clip = useSvgId('kde2d-clip')
  const levels = compact ? Math.min(5, params.levels) : params.levels

  const model = useMemo(() => {
    if (all.length < 3) return null
    // Very large samples are thinned evenly: the density barely changes, the slider stays responsive.
    const step = Math.ceil(all.length / MAX_KDE_POINTS)
    const used = step > 1 ? all.filter((_, i) => i % step === 0) : all
    const xs = used.map((p) => p.x)
    const ys = used.map((p) => p.y)
    const [bx, by] = bandwidth2d(xs, ys)
    const hx = bx * params.bandwidth
    const hy = by * params.bandwidth
    const res = compact ? 44 : params.grid
    const density = kde2d(xs, ys, hx, hy, res, res, { x: d3.extent(all, (p) => p.x) as [number, number], y: d3.extent(all, (p) => p.y) as [number, number] })
    const masses = d3.range(1, levels + 1).map((i) => 1 - i / (levels + 1))
    const thresholds = params.levelMode === 'mass' ? hdrThresholds(density, masses) : equalThresholds(density, levels)
    const sorted = Float64Array.from(density.values).sort()
    const cum = new Float64Array(sorted.length)
    let acc = 0
    for (let i = sorted.length - 1; i >= 0; i--) { acc += sorted[i]; cum[i] = acc }
    return { density, thresholds, polygons: contourPolygons(density, thresholds), sorted, cum, used: used.length, hx, hy }
  }, [all, params.bandwidth, params.grid, params.levelMode, levels, compact])

  if (!xCol || !yCol) return <ChartMessage>X축과 Y축 숫자형 열을 선택하세요.</ChartMessage>
  if (!model) return <ChartMessage>2차원 밀도를 추정하려면 유효한 점이 3개 이상 필요합니다.</ChartMessage>

  const { density: d, polygons } = model
  const x = d3.scaleLinear().domain(paddedDomain(all.map((p) => p.x), 0.06)).range([0, iw])
  const y = d3.scaleLinear().domain(paddedDomain(all.map((p) => p.y), 0.06)).range([ih, 0])
  const color = schemes[params.scheme].interpolate
  const levelColor = (i: number) => color(0.18 + 0.82 * (levels > 1 ? (levels - 1 - i) / (levels - 1) : 1))
  // Contour coordinates are grid indexes with sample (i, j) at (i + .5, j + .5).
  const path = d3.geoPath(d3.geoTransform({ point(gx, gy) { this.stream.point(x(d.x0 + (gx - 0.5) * d.dx), y(d.y0 + (gy - 0.5) * d.dy)) } }))
  const fill = params.display !== 'contour'
  const lines = params.display !== 'fill'
  const markedRows = new Set(linked?.rows ?? [])
  const dotR = compact ? 1.3 : 2.6

  const densityAt = (px: number, py: number) => {
    const gx = Math.round((x.invert(px) - d.x0) / d.dx)
    const gy = Math.round((y.invert(py) - d.y0) / d.dy)
    return gx < 0 || gy < 0 || gx >= d.nx || gy >= d.ny ? 0 : d.values[gy * d.nx + gx]
  }
  // Probability mass of the region at least as dense as the pointer: the highest-density-region level.
  const massAbove = (f: number) => {
    const i = d3.bisectLeft(model.sorted as unknown as number[], f)
    return i >= model.cum.length ? 0 : model.cum[i] / model.cum[0]
  }

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`2차원 KDE: ${xCol}와 ${yCol}의 결합 분포`}
        onPointerMove={compact ? undefined : (e) => {
          const p = localPoint(svgRef.current!, e)
          const px = p.x - m.left
          const py = p.y - m.top
          if (px < 0 || py < 0 || px > iw || py > ih) { hide(); return }
          const f = densityAt(px, py)
          let near = -1
          let best = 12 * 12
          for (const q of all) { const d2 = (x(q.x) - px) ** 2 + (y(q.y) - py) ** 2; if (d2 < best) { best = d2; near = q.i } }
          linked?.set(near >= 0 ? [near] : null)
          show(p.x, p.y, <><b>({fmt(x.invert(px))}, {fmt(y.invert(py))})</b><br />밀도 f̂ = {f.toExponential(2)}<br />이 위치를 지나는 등고선 안쪽 확률: {pct(massAbove(f), 0)}</>)
        }} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <defs><clipPath id={clip}><rect width={iw} height={ih} /></clipPath></defs>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisBottom scale={x} y={ih} label={xCol} compact={compact} />
          <AxisLeft scale={y} x={0} grid={iw} label={yCol} compact={compact} />
          <g clipPath={`url(#${clip})`}>
            {fill && polygons.map((poly, i) => <path key={`f${i}`} className="kde2d-fill" d={path(poly) ?? ''} fill={levelColor(i)} fillOpacity={params.display === 'both' ? 0.55 : 0.85} data-testid="kde2d-level" />)}
            {lines && polygons.map((poly, i) => <path key={`l${i}`} className="kde2d-line" d={path(poly) ?? ''} fill="none" stroke={fill ? '#ffffff' : levelColor(i)} strokeWidth={compact ? 1 : 1.6} data-testid={fill ? undefined : 'kde2d-level'} />)}
            {params.points && all.map((p) => (
              <circle key={p.i} cx={x(p.x)} cy={y(p.y)} r={markedRows.has(p.i) ? dotR + 2.5 : dotR} fill={markedRows.has(p.i) ? '#e07a3f' : '#121816'}
                fillOpacity={markedRows.has(p.i) ? 1 : compact ? 0.5 : params.pointOpacity} stroke={markedRows.has(p.i) ? '#fff' : 'none'} strokeWidth={1.5} />
            ))}
          </g>
        </g>
      </svg>
      {!compact && (
        <>
          <div className="color-legend" aria-label="등고선 범례">
            <span>{params.levelMode === 'mass' ? '바깥' : '낮은 밀도'}</span>
            <span className="color-ramp" style={{ background: `linear-gradient(90deg, ${d3.range(0, 1.01, 0.1).map((v) => color(0.18 + 0.82 * v)).join(',')})` }} />
            <span>{params.levelMode === 'mass' ? '안쪽 (밀집)' : '높은 밀도'}</span>
          </div>
          <Readout items={[{ label: 'n', value: all.length.toLocaleString() }, { label: 'hₓ', value: fmt(model.hx) }, { label: 'h_y', value: fmt(model.hy) }]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function Kde2dControls({ params, setParams }: ControlsProps<Kde2dParams>) {
  return (
    <>
      <ControlGroup title="밀도 추정">
        <Slider label="대역폭 배율" value={params.bandwidth} min={0.3} max={3} step={0.05} onChange={(bandwidth) => setParams({ bandwidth })} format={(v) => `×${v.toFixed(2)}`} testId="ctl-bandwidth" />
        <Hint>기준은 Scott 규칙 h = σ·n^(−1/6)(축마다 따로)입니다. 작게 하면 점마다 작은 봉우리가 생기고, 크게 하면 구조가 뭉개집니다.</Hint>
      </ControlGroup>
      <ControlGroup title="표현">
        <Segmented label="표시" value={params.display} onChange={(display) => setParams({ display })} testId="ctl-display"
          options={[{ value: 'contour', label: '등고선' }, { value: 'fill', label: '채우기' }, { value: 'both', label: '둘 다' }]} />
        <Slider label="등고선 단계 수" value={params.levels} min={3} max={12} onChange={(levels) => setParams({ levels })} testId="ctl-levels" />
        <Select label="단계 기준" value={params.levelMode} onChange={(levelMode) => setParams({ levelMode })} testId="ctl-level-mode"
          options={[{ value: 'mass', label: '확률 질량 (안쪽 영역 비율)' }, { value: 'equal', label: '같은 밀도 간격' }]} />
        <Select label="색상 스케일" value={params.scheme} onChange={(scheme) => setParams({ scheme })} testId="ctl-scheme"
          options={(Object.keys(schemes) as (keyof typeof schemes)[]).filter((k) => !schemes[k].diverging).map((k) => ({ value: k as SequentialScheme, label: schemes[k].name }))} />
        <Toggle label="원본 산점도 겹치기" checked={params.points} onChange={(points) => setParams({ points })} testId="ctl-points" />
        <Slider label="점 불투명도" value={params.pointOpacity} min={0.1} max={1} step={0.05} onChange={(pointOpacity) => setParams({ pointOpacity })} disabled={!params.points} format={(v) => v.toFixed(2)} />
      </ControlGroup>
      <ControlGroup title="고급 설정" defaultOpen={false}>
        <Slider label="격자 해상도" value={params.grid} min={30} max={120} step={10} onChange={(grid) => setParams({ grid })} format={(v) => `${v}×${v}`} />
        <Hint>‘확률 질량’ 기준에서 한 등고선 안쪽에는 그 비율만큼의 확률이 들어 있습니다. 같은 밀도 간격은 봉우리가 높은 곳에 선이 몰립니다. 점이 4,000개를 넘으면 고르게 솎아 밀도를 계산합니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const kde2dModule: VizModule<Kde2dParams> = {
  roles: [
    { key: 'x', label: 'X축', type: 'number', required: true },
    { key: 'y', label: 'Y축', type: 'number', required: true },
  ],
  datasets: ['pos-corr', 'dense', 'cars', 'neg-corr'],
  defaultParams: { bandwidth: 1, levels: 6, levelMode: 'mass', display: 'both', scheme: 'viridis', points: true, pointOpacity: 0.35, grid: 80 },
  Chart: Kde2dChart,
  Controls: Kde2dControls,
  hint: '대역폭과 등고선 단계를 바꿔 보세요 · 마우스를 올리면 그 위치의 밀도 확인',
}
