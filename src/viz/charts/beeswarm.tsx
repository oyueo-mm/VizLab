import * as d3 from 'd3'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { AxisLeft, BandAxis, ChartMessage, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { removeRows } from '../../data/table'
import { useTween } from '../../hooks/motion'
import { categoryColor } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { dodge } from '../../stats/layout'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { addToBand, moveValue } from './groupShared'
import { groupedValues, paddedDomain } from './shared'

export interface BeeswarmParams {
  size: number
  gap: number
  opacity: number
  oneSided: boolean
  showMean: boolean
  seed: number
}

/** Swarm offsets for one group: positions are pixel coordinates along the value axis. */
export function swarmOffsets(valuePx: readonly number[], radius: number, gap: number, maxOffset: number, oneSided: boolean) {
  return dodge(valuePx, radius + gap / 2, maxOffset, oneSided)
}

function BeeswarmChart({ table, mapping, params, width, height, compact, onTableChange }: ChartProps<BeeswarmParams>) {
  const valueCol = roleColumn(mapping, 'value')
  const groupCol = roleColumn(mapping, 'group')
  const groups = useMemo(() => groupedValues(table, valueCol, groupCol), [table, valueCol, groupCol])
  const color = useMemo(() => categoryColor(groups.map((g) => g.key)), [groups])
  const m = margins(compact)
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ row: number; moved: boolean; domain: [number, number] } | null>(null)
  const [dragging, setDragging] = useState(false)
  const { tip, show, hide } = useTooltip()
  const all = groups.flatMap((g) => g.values)
  const y = d3.scaleLinear().domain(drag.current?.domain ?? paddedDomain(all, 0.06)).range([ih, 0])
  if (!drag.current) y.nice()
  const x = d3.scaleBand().domain(groups.map((g) => g.key)).range([0, iw]).padding(0.15)
  const r = compact ? Math.max(1.2, params.size * 0.5) : params.size
  const half = x.bandwidth() / 2

  const positions = useMemo(() => groups.map((g) => {
    const cx = (x(g.key) ?? 0) + half
    const ys = g.values.map((v) => y(v))
    const off = swarmOffsets(ys, r, params.gap, half, params.oneSided)
    return ys.map((py, k) => [cx + off[k] - (params.oneSided ? half * 0.9 : 0), py])
  }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [groups, r, params.gap, params.oneSided, iw, ih, y.domain()[0], y.domain()[1]])
  const shown = useTween(positions, { snapKey: `${iw}x${ih}`, enabled: !compact && !dragging && all.length <= 800 })

  if (!valueCol) return <ChartMessage>값으로 사용할 숫자형 열을 선택하세요.</ChartMessage>
  if (!all.length) return <ChartMessage>숫자 값이 없습니다.</ChartMessage>
  const editable = !!onTableChange && !compact
  // Points that had to be clipped to the band edge may overlap; count them so the user is told.
  const clipped = positions.reduce((s, g, gi) => s + g.filter((_, k) => Math.abs(g[k][0] - ((x(groups[gi].key) ?? 0) + half) + (params.oneSided ? half * 0.9 : 0)) >= half - 1e-6).length, 0)

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!editable) return
    const t = (e.target as Element).closest('[data-row]')
    if (!t) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { row: Number(t.getAttribute('data-row')), moved: false, domain: y.domain() as [number, number] }
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    if (!d.moved) { d.moved = true; setDragging(true); hide() }
    onTableChange!(moveValue(e, svgRef.current!, m, y, table, d.row, valueCol), true)
  }
  const onUp = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    drag.current = null
    if (dragging) { setDragging(false); onTableChange!(table, false) }
    if (!editable) return
    if (d && !d.moved) { onTableChange!(removeRows(table, [d.row])); return }
    if (!d) { const t = addToBand(e, svgRef.current!, m, ih, x, y, table, valueCol, groupCol); if (t) onTableChange!(t) }
  }

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} role="img" data-testid="chart-svg"
        aria-label={`스웜 플롯: ${valueCol}, ${all.length}개 관측`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <rect width={iw} height={ih} className="plot-bg" fill="transparent" />
          <AxisLeft scale={y} x={0} grid={iw} label={valueCol} compact={compact} />
          {groups.map((g, gi) => {
            const c = color(g.key)
            const mu = d3.mean(g.values)!
            const cx = (x(g.key) ?? 0) + half
            return (
              <g key={g.key} className="marks">
                {g.values.map((v, k) => {
                  const p = shown[gi]?.[k] ?? positions[gi][k]
                  return (
                    <circle key={g.rows[k]} data-row={g.rows[k]} className="mark-point swarm-dot" cx={p[0]} cy={p[1]} r={r} fill={c} fillOpacity={params.opacity} stroke="#fff" strokeWidth={0.6}
                      onPointerEnter={compact ? undefined : (e) => {
                        if (drag.current) return
                        const lp = localPoint(svgRef.current!, e)
                        show(lp.x, lp.y, <><b>{g.key}</b><br />{valueCol}: {fmt(v)}{editable && <><br />드래그: 값 변경 · 클릭: 삭제</>}</>)
                      }} onPointerLeave={hide} />
                  )
                })}
                {params.showMean && !compact && <line className="mean-line" x1={cx - half * 0.7} x2={cx + half * 0.7} y1={y(mu)} y2={y(mu)} />}
              </g>
            )
          })}
          <BandAxis scale={x} orient="bottom" offset={ih} label={groupCol ?? undefined} compact={compact} />
        </g>
      </svg>
      {!compact && (
        <>
          <Readout items={[{ label: 'n', value: all.length.toLocaleString() }, ...(clipped ? [{ label: '폭 한계로 겹침', value: clipped }] : [])]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function BeeswarmControls({ params, setParams }: ControlsProps<BeeswarmParams>) {
  return (
    <>
      <ControlGroup title="점 배치">
        <Slider label="점 크기" value={params.size} min={1.5} max={9} step={0.5} onChange={(size) => setParams({ size })} testId="ctl-size" />
        <Slider label="점 간격" value={params.gap} min={0} max={8} step={0.5} onChange={(gap) => setParams({ gap })} format={(v) => `${v}px`} testId="ctl-gap" />
        <Segmented label="배치 방식" value={params.oneSided ? 'one' : 'both'} onChange={(v) => setParams({ oneSided: v === 'one' })} testId="ctl-side"
          options={[{ value: 'both', label: '양쪽으로' }, { value: 'one', label: '한쪽으로 (점 그래프)' }]} />
        <Hint>각 점은 자신의 값(세로 위치)을 그대로 두고, 이미 놓인 점과 겹치지 않는 가장 가까운 가로 자리를 찾습니다. 지터와 달리 무작위가 아니며 같은 데이터는 항상 같은 배치가 됩니다.</Hint>
      </ControlGroup>
      <ControlGroup title="표시">
        <Slider label="투명도" value={params.opacity} min={0.2} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} />
        <Toggle label="평균선" checked={params.showMean} onChange={(showMean) => setParams({ showMean })} />
      </ControlGroup>
    </>
  )
}

export const beeswarmModule: VizModule<BeeswarmParams> = {
  roles: [
    { key: 'value', label: '값', type: 'number', required: true },
    { key: 'group', label: '그룹', type: 'category', auto: true },
  ],
  datasets: ['groups', 'outliers', 'bimodal', 'normal'],
  defaultParams: { size: 3.5, gap: 0.5, opacity: 0.85, oneSided: false, showMean: true, seed: 1 },
  Chart: BeeswarmChart,
  Controls: BeeswarmControls,
  hint: '빈 곳을 클릭해 값 추가 · 점을 위아래로 드래그해 값 변경(배치가 즉시 다시 계산됨) · 점을 클릭하면 삭제',
}
