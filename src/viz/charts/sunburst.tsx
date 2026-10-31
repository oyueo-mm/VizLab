import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { ChartMessage, Readout, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { useTween } from '../../hooks/motion'
import { fmt, pct } from '../../lib/format'
import { buildTree } from '../../stats/hierarchy'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { branchColor, Crumbs, makeRoot, pathOf, resolvePath, type HNode } from './hierShared'

export interface SunburstParams {
  levels: number
  hole: number
  pad: number
  labels: boolean
  color: 'branch' | 'depth' | 'single'
  focus: string[]
  selected: string[]
}

const TAU = Math.PI * 2

/**
 * Angle/radius of every node when `focus` fills the circle. Ancestors of the focus collapse to the
 * centre and nodes deeper than `levels` rings collapse to the outer edge (they fade out), so the
 * same node list can be tweened between any two focus states.
 */
export function sunburstGeometry(root: d3.HierarchyRectangularNode<any>, focus: d3.HierarchyRectangularNode<any>, levels: number, hole: number, radius: number) {
  const ringW = (radius - hole) / levels
  const span = focus.x1 - focus.x0 || 1
  return root.descendants().filter((d) => d.depth > 0).map((d) => {
    const rel = d.depth - focus.depth
    const a0 = Math.max(0, Math.min(1, (d.x0 - focus.x0) / span)) * TAU
    const a1 = Math.max(0, Math.min(1, (d.x1 - focus.x0) / span)) * TAU
    const k = Math.max(1, Math.min(levels + 1, rel))
    const visible = rel >= 1 && rel <= levels && a1 > a0
    return { node: d, visible, geo: [a0, a1, hole + (k - 1) * ringW, hole + k * ringW] as [number, number, number, number] }
  })
}

function SunburstChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<SunburstParams>) {
  const levelCols = roleColumns(mapping, 'levels')
  const valueCol = roleColumn(mapping, 'value')
  const { tree, skipped } = useMemo(() => buildTree(table, levelCols, valueCol), [table, levelCols, valueCol])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const crumbH = compact ? 0 : 34
  const h = Math.max(10, height - crumbH)
  const R = Math.max(20, Math.min(width, h) / 2 - (compact ? 3 : 8))
  const hole = R * params.hole
  const model = useMemo(() => {
    const root = makeRoot(tree)
    d3.partition<any>().size([1, root.height + 1])(root)
    const r = root as d3.HierarchyRectangularNode<any>
    const focus = resolvePath(root, params.focus) as d3.HierarchyRectangularNode<any>
    return { root: r, focus, total: root.value ?? 0 }
  }, [tree, params.focus])
  const levels = Math.max(1, Math.min(params.levels, model.root.height))
  const items = useMemo(() => sunburstGeometry(model.root, model.focus, levels, hole, R), [model, levels, hole, R])
  const target = useMemo(() => items.map((i) => i.geo), [items])
  const shown = useTween(target, { snapKey: `${width}x${h}${levels}`, enabled: !compact, duration: 520 })
  const tops = (tree.children ?? []).map((c) => c.name)
  const selected = resolvePath(model.root, params.selected)
  const info = params.selected.length ? selected : model.focus

  if (!levelCols.length || !valueCol) return <ChartMessage>계층 수준(범주형 열)과 값 열을 선택하세요.</ChartMessage>
  if (!model.total) return <ChartMessage>양수 값이 있는 항목이 없습니다.</ChartMessage>
  const focusPath = pathOf(model.focus)
  const arc = d3.arc<[number, number, number, number]>().startAngle((g) => g[0]).endAngle((g) => g[1]).innerRadius((g) => g[2]).outerRadius((g) => g[3] - 1)
    .padAngle(params.pad).padRadius(R / 2)
  const isSel = (d: HNode) => params.selected.length > 0 && pathOf(d).join('/') === params.selected.join('/')

  return (
    <div className="chart-root treemap-root">
      {!compact && <Crumbs path={focusPath} onNavigate={(focus) => setParams({ focus, selected: focus })} />}
      <svg ref={svgRef} width={width} height={h} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`선버스트 차트: ${levelCols.join(' › ')}별 ${valueCol}`} onPointerLeave={hide}>
        <g transform={`translate(${width / 2},${h / 2})`}>
          {items.map((it, i) => {
            const g = shown[i] ?? target[i]
            const d = it.node
            const fill = branchColor(d, tops, params.color)
            const [a0, a1, r0, r1] = g
            const mid = (a0 + a1) / 2
            const rm = (r0 + r1) / 2
            const arcLen = (a1 - a0) * rm
            const deg = (mid * 180) / Math.PI - 90
            const flip = mid > Math.PI
            return (
              <g key={pathOf(d).join('/')} className={`marks sb-node ${d.children ? 'is-zoomable' : ''}`} opacity={it.visible ? 1 : 0} style={{ pointerEvents: it.visible ? 'auto' : 'none' }}>
                <path className="sb-arc" data-testid={it.visible ? 'sb-arc' : undefined} d={arc(g) ?? ''} fill={fill} stroke={isSel(d) ? '#111827' : '#fff'} strokeWidth={isSel(d) ? 2 : 0.8}
                  onClick={compact ? undefined : () => setParams({ selected: pathOf(d), ...(d.children ? { focus: pathOf(d) } : {}) })}
                  onPointerMove={compact ? undefined : (e) => {
                    const lp = localPoint(svgRef.current!, e)
                    show(lp.x, lp.y + crumbH, <><b>{pathOf(d).join(' › ')}</b><br />{valueCol}: {fmt(d.value)}<br />전체의 {pct((d.value ?? 0) / model.total)}{d.parent && d.parent !== model.root && <> · 상위의 {pct((d.value ?? 0) / (d.parent.value || 1))}</>}<br />중심각 {fmt(((a1 - a0) * 180) / Math.PI, 1)}°{d.children ? <><br />클릭하면 확대</> : null}</>)
                  }} />
                {params.labels && !compact && it.visible && arcLen > 26 && r1 - r0 > 18 && (
                  <text className="sb-label" transform={`rotate(${deg}) translate(${rm},0) rotate(${flip ? 180 : 0})`} textAnchor="middle" dy="0.35em" fill={d3.hsl(fill).l > 0.6 ? '#111827' : '#fff'} pointerEvents="none">
                    {d.data.name.length > Math.max(2, Math.floor(arcLen / 7)) ? `${d.data.name.slice(0, Math.max(1, Math.floor(arcLen / 7) - 1))}…` : d.data.name}
                  </text>
                )}
              </g>
            )
          })}
          <g className="sb-center" onClick={compact || !params.focus.length ? undefined : () => setParams({ focus: params.focus.slice(0, -1), selected: params.focus.slice(0, -1) })} style={{ cursor: params.focus.length ? 'pointer' : 'default' }}>
            <circle r={Math.max(0, hole - 2)} fill="#fff" stroke="#e5e9e8" data-testid="sb-center" />
            {!compact && hole > 28 && (
              <text textAnchor="middle" className="sb-center-text">
                <tspan x={0} dy="-0.4em" className="sb-center-name">{info.depth === 0 ? '전체' : info.data.name}</tspan>
                <tspan x={0} dy="1.4em">{fmt(info.value)} · {pct((info.value ?? 0) / model.total)}</tspan>
                {params.focus.length > 0 && <tspan x={0} dy="1.4em" className="sb-center-hint">클릭: 한 단계 위로</tspan>}
              </text>
            )}
          </g>
        </g>
      </svg>
      {!compact && (
        <>
          <Readout items={[{ label: '전체', value: fmt(model.total) }, { label: '깊이', value: model.root.height }, ...(skipped ? [{ label: '제외한 행', value: skipped }] : [])]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function SunburstControls({ params, setParams, mapping }: ControlsProps<SunburstParams>) {
  const depth = roleColumns(mapping, 'levels').length
  return (
    <>
      <ControlGroup title="계층 표시">
        <Slider label="한 번에 보이는 고리 수" value={Math.min(params.levels, Math.max(1, depth))} min={1} max={Math.max(1, depth)} onChange={(levels) => setParams({ levels })} testId="ctl-levels" />
        <Slider label="가운데 구멍 크기" value={params.hole} min={0.12} max={0.5} step={0.02} onChange={(hole) => setParams({ hole })} format={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="조각 사이 간격" value={params.pad} min={0} max={0.03} step={0.002} onChange={(pad) => setParams({ pad })} format={(v) => `${(v * 1000).toFixed(0)}‰`} />
        <Toggle label="레이블" checked={params.labels} onChange={(labels) => setParams({ labels })} />
        <Segmented label="색 지정" value={params.color} onChange={(color) => setParams({ color })} testId="ctl-color"
          options={[{ value: 'branch', label: '가지별' }, { value: 'depth', label: '깊이별' }, { value: 'single', label: '단색' }]} />
      </ControlGroup>
      <Hint>부채꼴을 클릭하면 선택하고, 하위 항목이 있으면 그 안으로 확대합니다. 가운데 원이나 위쪽 경로를 눌러 돌아갑니다. 각도는 항목 값이 상위 합계에서 차지하는 비율 × 360°입니다.</Hint>
    </>
  )
}

export const sunburstModule: VizModule<SunburstParams> = {
  roles: [
    { key: 'levels', label: '계층 수준 (바깥 → 안쪽)', type: 'category', required: true, multiple: { min: 1, max: 4 } },
    { key: 'value', label: '값 (각도)', type: 'number', required: true },
  ],
  datasets: ['budget', 'categorical'],
  defaultParams: { levels: 3, hole: 0.26, pad: 0.004, labels: true, color: 'branch', focus: [], selected: [] },
  Chart: SunburstChart,
  Controls: SunburstControls,
  hint: '부채꼴을 클릭해 선택·확대 · 가운데를 눌러 위로 · 데이터 탭에서 항목 값을 바꾸면 각도가 즉시 갱신됩니다',
}
