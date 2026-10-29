import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { AxisLeft, BandAxis, ChartMessage, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider } from '../../components/controls'
import { categoryColor } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { removeRows } from '../../data/table'
import { useTween } from '../../hooks/motion'
import { boxStats } from '../../stats/boxplot'
import { extent } from '../../stats/descriptive'
import { kde, kdeGrid, silvermanBandwidth, type KernelName } from '../../stats/kde'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { addToBand, jitter } from './groupShared'
import { kernelOptions } from './kde'
import { groupedValues, paddedDomain } from './shared'

export interface ViolinParams {
  /** Multiplier applied to each group's Silverman bandwidth. */
  bwScale: number
  kernel: KernelName
  scale: 'area' | 'width' | 'count'
  inner: 'box' | 'quartiles' | 'points' | 'none'
  cut: boolean
}

function ViolinChart({ table, mapping, params, width, height, compact, onTableChange }: ChartProps<ViolinParams>) {
  const valueCol = roleColumn(mapping, 'value')
  const groupCol = roleColumn(mapping, 'group')
  const groups = useMemo(() => groupedValues(table, valueCol, groupCol), [table, valueCol, groupCol])
  const color = useMemo(() => categoryColor(groups.map((g) => g.key)), [groups])
  const m = margins(compact)
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const { tip, show, hide } = useTooltip()

  const model = useMemo(() => {
    const all = groups.flatMap((g) => g.values)
    if (!all.length) return null
    const shapes = groups.map((g) => {
      const h = silvermanBandwidth(g.values) * params.bwScale
      const [lo, hi] = extent(g.values)
      // `cut`: stop at the data range; otherwise extend 2h past it so the tails close smoothly.
      const grid = kdeGrid(lo, hi, params.cut ? 0 : 2 * h, 90)
      return { key: g.key, h, grid, dens: kde(g.values, h, params.kernel, grid), n: g.values.length, box: boxStats(g.values)! }
    })
    const ext = extent(shapes.flatMap((s) => [s.grid[0], s.grid[s.grid.length - 1]]))
    return { shapes, ext, total: all.length }
  }, [groups, params.bwScale, params.kernel, params.cut])

  const y = d3.scaleLinear().domain(model ? paddedDomain(model.ext, 0.02) : [0, 1]).range([ih, 0]).nice()
  const x = d3.scaleBand().domain(groups.map((g) => g.key)).range([0, iw]).paddingInner(0.2).paddingOuter(0.15)
  const half = x.bandwidth() / 2
  // Width scaling: area → same max density scale for all (equal areas); width → each violin fills the band; count → area ∝ n.
  const widths = useMemo(() => {
    if (!model) return []
    const globalMax = d3.max(model.shapes, (s) => d3.max(s.dens)) || 1
    const maxN = d3.max(model.shapes, (s) => s.n) || 1
    const maxCountDens = d3.max(model.shapes, (s) => (d3.max(s.dens) ?? 0) * s.n) || 1
    return model.shapes.map((s) => {
      const localMax = d3.max(s.dens) || 1
      return s.dens.map((d) => {
        if (params.scale === 'width') return (d / localMax) * half
        if (params.scale === 'count') return ((d * s.n) / maxCountDens) * half
        return (d / globalMax) * half
      })
    }).map((w, i) => ({ w, n: model.shapes[i].n, maxN }))
  }, [model, params.scale, half])
  const target = useMemo(() => widths.map((w) => w.w), [widths])
  const shown = useTween(target, { snapKey: `${iw}x${ih}`, enabled: !compact })

  if (!valueCol) return <ChartMessage>값으로 사용할 숫자형 열을 선택하세요.</ChartMessage>
  if (!model) return <ChartMessage>숫자 값이 없습니다.</ChartMessage>
  const editable = !!onTableChange && !compact

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} role="img" data-testid="chart-svg"
        aria-label={`바이올린 플롯: ${valueCol}`} onPointerLeave={hide}
        onPointerUp={(e) => { if (editable) { const t = addToBand(e, svgRef.current!, m, ih, x, y, table, valueCol, groupCol); if (t) onTableChange!(t) } }}>
        <g transform={`translate(${m.left},${m.top})`}>
          <rect width={iw} height={ih} className="plot-bg" fill="transparent" />
          <AxisLeft scale={y} x={0} grid={iw} label={valueCol} compact={compact} />
          {model.shapes.map((s, gi) => {
            const cx = (x(s.key) ?? 0) + half
            const w = shown[gi] ?? target[gi]
            const pts = s.grid.map((g, i) => [y(g), w[i] ?? 0] as [number, number])
            const path = d3.area<[number, number]>().curve(d3.curveCatmullRom).y((p) => p[0]).x0((p) => cx - p[1]).x1((p) => cx + p[1])(pts) ?? ''
            const c = color(s.key)
            const g = groups[gi]
            return (
              <g key={s.key} className="marks">
                <path className="violin" d={path} fill={c} fillOpacity={0.3} stroke={c} data-testid="violin-shape"
                  onPointerEnter={compact ? undefined : (e) => {
                    const lp = localPoint(svgRef.current!, e)
                    show(lp.x, lp.y, <><b>{s.key}</b> (n = {s.n})<br />대역폭 h = {fmt(s.h, 3)}<br />중앙값 {fmt(s.box.median)} · IQR {fmt(s.box.iqr)}</>)
                  }} onPointerLeave={hide} />
                {params.inner === 'box' && (
                  <g className="violin-box">
                    <line x1={cx} x2={cx} y1={y(s.box.whiskerLow)} y2={y(s.box.whiskerHigh)} />
                    <rect x={cx - 4} width={8} y={y(s.box.q3)} height={Math.max(1, y(s.box.q1) - y(s.box.q3))} />
                    <circle cx={cx} cy={y(s.box.median)} r={3} />
                  </g>
                )}
                {params.inner === 'quartiles' && [s.box.q1, s.box.median, s.box.q3].map((q, k) => {
                  const i = d3.bisectLeft(s.grid, q)
                  const hw = w[Math.min(i, w.length - 1)] ?? 0
                  return <line key={k} className={k === 1 ? 'violin-median' : 'violin-quartile'} x1={cx - hw} x2={cx + hw} y1={y(q)} y2={y(q)} />
                })}
                {params.inner === 'points' && !compact && g.values.map((v, k) => (
                  <circle key={g.rows[k]} className="box-point" cx={cx + jitter(g.rows[k]) * half * 0.5} cy={y(v)} r={2.2} fill={c}
                    onPointerUp={editable ? (e) => { e.stopPropagation(); onTableChange!(removeRows(table, [g.rows[k]])) } : undefined}><title>{fmt(v)}</title></circle>
                ))}
              </g>
            )
          })}
          <BandAxis scale={x} orient="bottom" offset={ih} label={groupCol ?? undefined} compact={compact} />
        </g>
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function ViolinControls({ params, setParams }: ControlsProps<ViolinParams>) {
  return (
    <>
      <ControlGroup title="밀도 추정">
        <Slider label="대역폭 배율" value={params.bwScale} min={0.2} max={3} step={0.05} onChange={(bwScale) => setParams({ bwScale })} format={(v) => `× ${v.toFixed(2)}`} testId="ctl-bw" />
        <Hint>각 그룹의 Silverman 대역폭에 곱하는 값입니다. 1보다 작으면 세부 굴곡이, 크면 전체 윤곽만 남습니다.</Hint>
        <Select label="커널 함수" value={params.kernel} onChange={(kernel) => setParams({ kernel })} options={kernelOptions} />
        <Segmented label="꼬리 처리" value={params.cut ? 'cut' : 'extend'} onChange={(v) => setParams({ cut: v === 'cut' })}
          options={[{ value: 'extend', label: '2h만큼 연장' }, { value: 'cut', label: '데이터 범위에서 자르기' }]} />
      </ControlGroup>
      <ControlGroup title="모양">
        <Segmented label="너비 기준" value={params.scale} onChange={(scale) => setParams({ scale })} testId="ctl-scale"
          options={[{ value: 'area', label: '같은 면적' }, { value: 'width', label: '같은 최대 너비' }, { value: 'count', label: '표본 수 비례' }]} />
        <Select label="안쪽 표시" value={params.inner} onChange={(inner) => setParams({ inner })} testId="ctl-inner"
          options={[{ value: 'box', label: '미니 박스 플롯' }, { value: 'quartiles', label: '사분위선' }, { value: 'points', label: '관측값 점' }, { value: 'none', label: '없음' }]} />
      </ControlGroup>
    </>
  )
}

export const violinModule: VizModule<ViolinParams> = {
  roles: [
    { key: 'value', label: '값', type: 'number', required: true },
    { key: 'group', label: '그룹', type: 'category', auto: true },
  ],
  datasets: ['groups', 'outliers', 'bimodal', 'normal', 'skewed'],
  defaultParams: { bwScale: 1, kernel: 'gaussian', scale: 'area', inner: 'box', cut: false },
  Chart: ViolinChart,
  Controls: ViolinControls,
  hint: '그룹 영역을 클릭하면 그 높이에 값이 추가되어 밀도 모양이 바뀝니다',
}
