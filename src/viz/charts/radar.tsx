import * as d3 from 'd3'
import { Eye, EyeOff, Plus, X } from 'lucide-react'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { ChartMessage, Tooltip, localPoint, toggleIn, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, NumberField, Segmented, Slider } from '../../components/controls'
import { categoryColor } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { appendRow, columnIndex, removeRows, toLabel, toNumber, updateRow, type Cell } from '../../data/table'
import { useTween } from '../../hooks/motion'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { dragDigits, roundTo } from './shared'

export interface RadarParams {
  range: 'auto' | 'manual'
  min: number
  max: number
  levels: number
  grid: 'polygon' | 'circle'
  fill: number
  hidden: string[]
}

/** Polar position of value v on axis k of n (axis 0 points straight up, clockwise). */
export function radarPoint(k: number, n: number, radius: number) {
  const a = (2 * Math.PI * k) / n - Math.PI / 2
  return [Math.cos(a) * radius, Math.sin(a) * radius] as [number, number]
}

function RadarChart({ table, mapping, params, setParams, width, height, compact, onTableChange }: ChartProps<RadarParams>) {
  const labelCol = roleColumn(mapping, 'label')
  const axes = roleColumns(mapping, 'axes')
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ row: number; axis: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const { tip, show, hide } = useTooltip()
  const series = useMemo(() => {
    const li = columnIndex(table, labelCol)
    const ai = axes.map((a) => columnIndex(table, a))
    return table.rows.map((r, i) => ({ i, key: li >= 0 ? toLabel(r[li]) || `행 ${i + 1}` : `행 ${i + 1}`, v: ai.map((k) => toNumber(r[k])) }))
  }, [table, labelCol, axes])
  const color = useMemo(() => categoryColor(series.map((s) => s.key)), [series])
  const all = series.flatMap((s) => s.v).filter((v): v is number => v != null)
  const autoMax = d3.max(all) ?? 1
  const domain: [number, number] = params.range === 'manual'
    ? [params.min, params.max > params.min ? params.max : params.min + 1]
    : [Math.min(0, d3.min(all) ?? 0), d3.scaleLinear().domain([0, autoMax || 1]).nice(params.levels).domain()[1]]
  const R = Math.max(10, Math.min(width, height) / 2 - (compact ? 6 : 64))
  const r = d3.scaleLinear().domain(domain).range([0, R]).clamp(true)
  const n = axes.length
  const target = useMemo(() => series.map((s) => s.v.map((v, k) => radarPoint(k, n, r(v ?? domain[0])))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, n, R, domain[0], domain[1]])
  const shown = useTween(target, { enabled: !compact && !dragging, snapKey: `${R}` })

  if (n < 3) return <ChartMessage>레이더 차트에는 숫자형 축이 3개 이상 필요합니다.</ChartMessage>
  if (!series.length) return <ChartMessage>계열(행)이 없습니다. 아래 버튼으로 계열을 추가하세요.</ChartMessage>
  const editable = !!onTableChange && !compact
  const cx = width / 2
  const cy = height / 2 + (compact ? 0 : 6)
  const levels = d3.range(1, params.levels + 1).map((l) => domain[0] + ((domain[1] - domain[0]) * l) / params.levels)

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!editable) return
    const t = (e.target as Element).closest('[data-vertex]')
    if (!t) return
    const [row, axis] = t.getAttribute('data-vertex')!.split(':').map(Number)
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { row, axis }
    setDragging(true)
    hide()
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    const lp = localPoint(svgRef.current!, e)
    // Project the pointer onto the axis direction to get a radius along it.
    const [ux, uy] = radarPoint(d.axis, n, 1)
    const proj = Math.max(0, Math.min(R, (lp.x - cx) * ux + (lp.y - cy) * uy))
    onTableChange!(updateRow(table, d.row, { [axes[d.axis]]: roundTo(r.invert(proj), dragDigits(domain[1] - domain[0])) }), true)
  }
  const onUp = () => {
    if (!drag.current) return
    drag.current = null
    setDragging(false)
    onTableChange!(table, false)
  }
  const addSeries = () => {
    const base: Record<string, Cell> = {}
    const mid = roundTo((domain[0] + domain[1]) / 2, dragDigits(domain[1] - domain[0]))
    axes.forEach((a) => { base[a] = mid })
    if (labelCol) base[labelCol] = `계열 ${table.rows.length + 1}`
    onTableChange!(appendRow(table, base))
  }

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} role="img" data-testid="chart-svg"
        aria-label={`레이더 차트: ${axes.join(', ')} 축, ${series.length}개 계열`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={hide}>
        <g transform={`translate(${cx},${cy})`}>
          <g className="radar-grid" aria-hidden="true">
            {levels.map((lv) => params.grid === 'circle'
              ? <circle key={lv} r={r(lv)} />
              : <polygon key={lv} points={d3.range(n).map((k) => radarPoint(k, n, r(lv)).join(',')).join(' ')} />)}
            {axes.map((a, k) => {
              const [x2, y2] = radarPoint(k, n, R)
              const [lx, ly] = radarPoint(k, n, R + 18)
              return (
                <g key={a}>
                  <line x2={x2} y2={y2} />
                  {!compact && <text className="radar-axis-label" x={lx} y={ly} dy="0.35em" textAnchor={Math.abs(lx) < 4 ? 'middle' : lx > 0 ? 'start' : 'end'}>{a}</text>}
                </g>
              )
            })}
            {!compact && levels.map((lv) => <text key={`t${lv}`} className="radar-level" x={4} y={-r(lv)} dy="-0.2em">{fmt(lv, 1)}</text>)}
          </g>
          {series.map((s, si) => {
            if (params.hidden.includes(s.key)) return null
            const pts = shown[si] ?? target[si]
            if (!pts || pts.length !== n) return null
            const c = color(s.key)
            return (
              <g key={s.i} className="marks">
                <polygon className="radar-shape" points={pts.map((p) => p.join(',')).join(' ')} fill={c} fillOpacity={params.fill} stroke={c} data-testid="radar-shape" />
                {!compact && pts.map((p, k) => (
                  <circle key={k} data-vertex={`${s.i}:${k}`} className={`radar-vertex ${editable ? 'is-draggable' : ''}`} cx={p[0]} cy={p[1]} r={4.5} fill="#fff" stroke={c}
                    onPointerEnter={(e) => {
                      if (drag.current) return
                      const lp = localPoint(svgRef.current!, e)
                      show(lp.x, lp.y, <><b>{s.key}</b><br />{axes[k]}: {fmt(s.v[k])}{editable && <><br />축 방향으로 드래그해 수정</>}</>)
                    }} onPointerLeave={hide} />
                ))}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          <div className="chart-legend radar-legend" aria-label="계열">
            {series.map((s) => {
              const off = params.hidden.includes(s.key)
              return (
                <span key={s.i} className={`legend-item ${off ? 'is-off' : ''}`}>
                  <span className="legend-swatch" style={{ background: off ? 'transparent' : color(s.key), borderColor: color(s.key) }} />
                  {s.key}
                  <button type="button" className="icon-btn-xs" aria-label={`${s.key} ${off ? '표시' : '숨기기'}`} onClick={() => setParams({ hidden: toggleIn(params.hidden, s.key) })}>{off ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                  {editable && <button type="button" className="icon-btn-xs" aria-label={`${s.key} 삭제`} data-testid="radar-delete" onClick={() => onTableChange!(removeRows(table, [s.i]))}><X size={13} /></button>}
                </span>
              )
            })}
            {editable && <button type="button" className="legend-add" onClick={addSeries} data-testid="radar-add"><Plus size={14} aria-hidden="true" />계열 추가</button>}
          </div>
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function RadarControls({ params, setParams, table, mapping }: ControlsProps<RadarParams>) {
  const axes = roleColumns(mapping, 'axes')
  const vals = table.rows.flatMap((r) => axes.map((a) => toNumber(r[columnIndex(table, a)]))).filter((v): v is number => v != null)
  return (
    <>
      <ControlGroup title="축 범위">
        <Segmented label="범위" value={params.range} testId="ctl-range"
          onChange={(range) => setParams(range === 'manual' ? { range, min: Math.min(0, d3.min(vals) ?? 0), max: Math.ceil(d3.max(vals) ?? 100) } : { range })}
          options={[{ value: 'auto', label: '자동 (0부터)' }, { value: 'manual', label: '직접 지정' }]} />
        {params.range === 'manual' && (
          <div className="field-pair">
            <NumberField label="중심값" value={params.min} onChange={(min) => setParams({ min })} testId="ctl-min" />
            <NumberField label="바깥값" value={params.max} onChange={(max) => setParams({ max })} testId="ctl-max" />
          </div>
        )}
        <Hint>중심을 0이 아닌 값으로 올리면 작은 차이가 크게 과장됩니다. 모든 축이 같은 범위를 공유하므로 단위가 같은 변수끼리 비교해야 합니다.</Hint>
      </ControlGroup>
      <ControlGroup title="모양">
        <Slider label="눈금 단계" value={params.levels} min={2} max={10} onChange={(levels) => setParams({ levels })} testId="ctl-levels" />
        <Segmented label="격자 모양" value={params.grid} onChange={(grid) => setParams({ grid })} options={[{ value: 'polygon', label: '다각형' }, { value: 'circle', label: '원' }]} />
        <Slider label="채움 불투명도" value={params.fill} min={0} max={0.8} step={0.05} onChange={(fill) => setParams({ fill })} format={(v) => v.toFixed(2)} />
      </ControlGroup>
    </>
  )
}

export const radarModule: VizModule<RadarParams> = {
  roles: [
    { key: 'label', label: '계열 이름', type: 'category', auto: true },
    { key: 'axes', label: '축 (숫자형 변수)', type: 'number', required: true, multiple: { min: 3, max: 12 } },
  ],
  datasets: ['players', 'activity', 'cars'],
  defaultParams: { range: 'auto', min: 0, max: 100, levels: 5, grid: 'polygon', fill: 0.2, hidden: [] },
  Chart: RadarChart,
  Controls: RadarControls,
  hint: '꼭짓점을 축 방향으로 드래그해 값 수정 · 아래 범례에서 계열 추가·숨기기·삭제',
}
