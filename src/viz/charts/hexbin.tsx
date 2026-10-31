import * as d3 from 'd3'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Readout, Tooltip, localPoint, margins, useSvgId, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { schemes, type SequentialScheme } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { createRng } from '../../lib/random'
import type { Cell } from '../../data/table'
import { hexagonPath, hexbin } from '../../stats/hexbin'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { dragDigits, paddedDomain, pointRows, roundTo } from './shared'

export interface HexbinParams {
  radius: number
  scheme: SequentialScheme
  scale: 'linear' | 'log'
  showPoints: boolean
  spray: number
}

function HexbinChart({ table, mapping, params, width, height, compact, onTableChange, linked }: ChartProps<HexbinParams>) {
  const xCol = roleColumn(mapping, 'x')
  const yCol = roleColumn(mapping, 'y')
  const pts = useMemo(() => pointRows(table, xCol, yCol), [table, xCol, yCol])
  const m = margins(compact)
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<string | null>(null)
  const linkedSet = useMemo(() => new Set(linked?.rows ?? []), [linked?.rows])
  const { tip, show, hide } = useTooltip()
  const clipId = useSvgId('hex-clip')
  const x = useMemo(() => d3.scaleLinear().domain(paddedDomain(pts.map((p) => p.x), 0.03)).range([0, iw]), [pts, iw])
  const y = useMemo(() => d3.scaleLinear().domain(paddedDomain(pts.map((p) => p.y), 0.03)).range([ih, 0]), [pts, ih])
  const radius = compact ? Math.max(3, params.radius * 0.45) : params.radius
  // Binning happens in pixel space so the hexagons are regular on screen.
  const bins = useMemo(() => hexbin(pts, (p) => x(p.x), (p) => y(p.y), radius), [pts, x, y, radius])
  const maxCount = d3.max(bins, (b) => b.points.length) ?? 1
  const t = params.scale === 'log'
    ? d3.scaleLog().domain([1, Math.max(2, maxCount)]).range([0.08, 1])
    : d3.scaleLinear().domain([0, maxCount]).range([0.08, 1])
  const fill = (count: number) => schemes[params.scheme].interpolate(t(Math.max(1, count)))
  const hex = hexagonPath(radius)

  if (!xCol || !yCol) return <ChartMessage>X축과 Y축에 사용할 숫자형 열을 선택하세요.</ChartMessage>
  if (!pts.length) return <ChartMessage>그릴 수 있는 숫자 쌍이 없습니다.</ChartMessage>

  const editable = !!onTableChange && !compact
  const onClick = (e: PointerEvent<SVGSVGElement>) => {
    if (!editable) return
    const p = localPoint(svgRef.current!, e)
    const cx = x.invert(p.x - m.left)
    const cy = y.invert(p.y - m.top)
    if (p.x < m.left || p.y < m.top || p.x > m.left + iw || p.y > m.top + ih) return
    // "Spray" a small Gaussian cloud around the click to watch the local density respond.
    const rng = createRng(Date.now() & 0xffff)
    const sx = (x.domain()[1] - x.domain()[0]) * 0.025
    const sy = (y.domain()[1] - y.domain()[0]) * 0.025
    const dx = dragDigits(x.domain()[1] - x.domain()[0])
    const dy = dragDigits(y.domain()[1] - y.domain()[0])
    const xi = table.columns.findIndex((c) => c.name === xCol)
    const yi = table.columns.findIndex((c) => c.name === yCol)
    const extra: Cell[][] = Array.from({ length: params.spray }, () => {
      const row: Cell[] = table.columns.map(() => null)
      row[xi] = roundTo(rng.normal(cx, sx), dx)
      row[yi] = roundTo(rng.normal(cy, sy), dy)
      return row
    })
    onTableChange!({ columns: table.columns, rows: [...table.rows, ...extra] })
  }

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} role="img"
        aria-label={`헥스빈 플롯: ${pts.length}개 점을 ${bins.length}개 육각형에 집계`} onPointerUp={onClick} onPointerLeave={() => { hide(); setHover(null) }} data-testid="chart-svg">
        <defs><clipPath id={clipId}><rect width={iw} height={ih} /></clipPath></defs>
        <g transform={`translate(${m.left},${m.top})`}>
          <rect width={iw} height={ih} className="plot-bg" fill="transparent" />
          <g clipPath={`url(#${clipId})`}>
            {bins.map((b) => {
              const key = `${b.x.toFixed(1)},${b.y.toFixed(1)}`
              return (
                <path key={key} className="mark-hex" d={hex} transform={`translate(${b.x},${b.y})`} fill={fill(b.points.length)}
                  stroke={hover === key || b.points.some((q) => linkedSet.has(q.i)) ? (hover === key ? '#111827' : '#e07a3f') : '#ffffff'} strokeWidth={hover === key || b.points.some((q) => linkedSet.has(q.i)) ? 1.8 : 0.5} data-count={b.points.length}
                  onPointerEnter={compact ? undefined : (e) => {
                    setHover(key)
                    linked?.set(b.points.map((q) => q.i))
                    const lp = localPoint(svgRef.current!, e)
                    show(lp.x, lp.y, <><b>{b.points.length}개</b><br />중심 {xCol} ≈ {fmt(x.invert(b.x))}<br />중심 {yCol} ≈ {fmt(y.invert(b.y))}</>)
                  }} onPointerLeave={() => linked?.set(null)} />
              )
            })}
            {params.showPoints && !compact && pts.slice(0, 5000).map((p) => <circle key={p.i} cx={x(p.x)} cy={y(p.y)} r={1.2} className="hex-point" />)}
          </g>
          <AxisBottom scale={x} y={ih} label={xCol} compact={compact} />
          <AxisLeft scale={y} x={0} label={yCol} compact={compact} />
        </g>
      </svg>
      {!compact && (
        <>
          <div className="color-legend" aria-label="색상 범례">
            <span>개수</span>
            <span className="color-ramp" style={{ background: `linear-gradient(90deg, ${d3.range(0, 1.01, 0.1).map((v) => schemes[params.scheme].interpolate(0.08 + 0.92 * v)).join(',')})` }} />
            <span>1 – {maxCount}{params.scale === 'log' ? ' (로그)' : ''}</span>
          </div>
          <Readout items={[{ label: '점', value: pts.length.toLocaleString() }, { label: '육각형', value: bins.length }, { label: '최대 개수', value: maxCount }]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function HexbinControls({ params, setParams }: ControlsProps<HexbinParams>) {
  return (
    <>
      <ControlGroup title="격자">
        <Slider label="육각형 반지름" value={params.radius} min={4} max={40} onChange={(radius) => setParams({ radius })} format={(v) => `${v}px`} testId="ctl-radius" />
        <Hint>칸이 작으면 세밀하지만 잡음이 많고, 크면 매끄럽지만 구조가 뭉개집니다.</Hint>
      </ControlGroup>
      <ControlGroup title="색상">
        <Select label="색상 스케일" value={params.scheme} onChange={(scheme) => setParams({ scheme })} testId="ctl-scheme"
          options={(['viridis', 'teal', 'blues', 'magma', 'ylorrd'] as const).map((s) => ({ value: s, label: schemes[s].name }))} />
        <Segmented label="개수 → 색 변환" value={params.scale} onChange={(scale) => setParams({ scale })} testId="ctl-scale"
          options={[{ value: 'linear', label: '선형' }, { value: 'log', label: '로그' }]} />
        <Hint>개수 차이가 매우 클 때 로그 변환을 쓰면 밀도가 낮은 영역의 구조도 보입니다.</Hint>
        <Toggle label="원본 점 겹쳐 보기" checked={params.showPoints} onChange={(showPoints) => setParams({ showPoints })} testId="ctl-points" />
      </ControlGroup>
      <ControlGroup title="직접 조작">
        <Slider label="클릭 시 추가할 점" value={params.spray} min={5} max={200} step={5} onChange={(spray) => setParams({ spray })} format={(v) => `${v}개`} />
      </ControlGroup>
    </>
  )
}

export const hexbinModule: VizModule<HexbinParams> = {
  roles: [
    { key: 'x', label: 'X축', type: 'number', required: true },
    { key: 'y', label: 'Y축', type: 'number', required: true },
  ],
  datasets: ['dense', 'pos-corr', 'neg-corr', 'flowers'],
  defaultParams: { radius: 14, scheme: 'viridis', scale: 'linear', showPoints: false, spray: 40 },
  Chart: HexbinChart,
  Controls: HexbinControls,
  hint: '그래프를 클릭하면 그 주변에 점 무리가 추가되어 칸의 개수가 바뀝니다',
}
