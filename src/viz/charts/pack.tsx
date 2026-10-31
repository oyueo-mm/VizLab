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

export interface PackParams {
  padding: number
  labels: boolean
  color: 'branch' | 'depth' | 'single'
  levels: number
  focus: string[]
  selected: string[]
}

/** Pixel circle of every node when `focus` fills a square of side `size`. */
export function packGeometry(nodes: d3.HierarchyCircularNode<any>[], focus: d3.HierarchyCircularNode<any>, size: number, levels: number) {
  const k = size / (focus.r * 2)
  return nodes.map((d) => {
    const rel = d.depth - focus.depth
    const inside = d === focus || d.ancestors().includes(focus)
    return { node: d, visible: inside && rel <= levels, geo: [(d.x - focus.x) * k + size / 2, (d.y - focus.y) * k + size / 2, d.r * k] as [number, number, number] }
  })
}

function PackChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<PackParams>) {
  const levelCols = roleColumns(mapping, 'levels')
  const valueCol = roleColumn(mapping, 'value')
  const { tree, skipped } = useMemo(() => buildTree(table, levelCols, valueCol), [table, levelCols, valueCol])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const crumbH = compact ? 0 : 34
  const h = Math.max(10, height - crumbH)
  const size = Math.max(20, Math.min(width, h) - (compact ? 4 : 10))
  const model = useMemo(() => {
    const root = makeRoot(tree)
    d3.pack<any>().size([size, size]).padding(params.padding)(root)
    const r = root as d3.HierarchyCircularNode<any>
    return { root: r, nodes: r.descendants(), focus: resolvePath(root, params.focus) as d3.HierarchyCircularNode<any>, total: root.value ?? 0 }
  }, [tree, size, params.padding, params.focus])
  const levels = Math.max(1, Math.min(params.levels, model.root.height))
  const items = useMemo(() => packGeometry(model.nodes, model.focus, size, levels), [model, size, levels])
  const target = useMemo(() => items.map((i) => i.geo), [items])
  const shown = useTween(target, { snapKey: `${width}x${h}`, enabled: !compact, duration: 520 })
  const tops = (tree.children ?? []).map((c) => c.name)

  if (!levelCols.length || !valueCol) return <ChartMessage>계층 수준(범주형 열)과 값 열을 선택하세요.</ChartMessage>
  if (!model.total) return <ChartMessage>양수 값이 있는 항목이 없습니다.</ChartMessage>
  const isSel = (d: HNode) => params.selected.length > 0 && pathOf(d).join('/') === params.selected.join('/')

  return (
    <div className="chart-root treemap-root">
      {!compact && <Crumbs path={pathOf(model.focus)} onNavigate={(focus) => setParams({ focus, selected: focus })} />}
      <svg ref={svgRef} width={width} height={h} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`원 패킹: ${levelCols.join(' › ')}별 ${valueCol}`} onPointerLeave={hide}
        onClick={compact || !params.focus.length ? undefined : () => setParams({ focus: params.focus.slice(0, -1), selected: params.focus.slice(0, -1) })}>
        <g transform={`translate(${(width - size) / 2},${(h - size) / 2})`}>
          {items.map((it, i) => {
            const [cx, cy, r] = shown[i] ?? target[i]
            const d = it.node
            const isRoot = d.depth === 0
            const leaf = !d.children
            const fill = isRoot ? '#f6f8f7' : branchColor(d, tops, params.color)
            const canZoom = !leaf && !compact && d !== model.focus
            return (
              <g key={pathOf(d).join('/') || 'root'} className={`marks pack-node ${canZoom ? 'is-zoomable' : ''}`} opacity={it.visible ? 1 : 0} style={{ pointerEvents: it.visible ? 'auto' : 'none' }}>
                <circle className={leaf ? 'pack-leaf' : 'pack-group'} data-testid={leaf && it.visible ? 'pack-leaf' : undefined} cx={cx} cy={cy} r={Math.max(0, r)}
                  fill={leaf ? fill : d3.color(fill)!.copy({ opacity: isRoot ? 1 : 0.28 }).toString()} stroke={isSel(d) ? '#111827' : leaf ? '#fff' : d3.color(fill)!.darker(0.4).formatHex()} strokeWidth={isSel(d) ? 2.4 : 1}
                  onClick={compact ? undefined : (e) => {
                    e.stopPropagation()
                    if (isRoot) return
                    setParams({ selected: pathOf(d), ...(!leaf && d !== model.focus ? { focus: pathOf(d) } : {}) })
                  }}
                  onPointerMove={compact || isRoot ? undefined : (e) => {
                    e.stopPropagation()
                    const lp = localPoint(svgRef.current!, e)
                    show(lp.x, lp.y + crumbH, <><b>{pathOf(d).join(' › ')}</b><br />{valueCol}: {fmt(d.value)}<br />전체의 {pct((d.value ?? 0) / model.total)}{canZoom && <><br />클릭하면 확대</>}</>)
                  }} />
                {params.labels && !compact && it.visible && !isRoot && leaf && r > 16 && (
                  <text className="pack-label" x={cx} y={cy} textAnchor="middle" dy={r > 28 ? '-0.1em' : '0.35em'} fill={d3.hsl(fill).l > 0.6 ? '#111827' : '#fff'} pointerEvents="none">
                    {d.data.name.length > Math.max(2, Math.floor(r / 4.2)) ? `${d.data.name.slice(0, Math.max(1, Math.floor(r / 4.2) - 1))}…` : d.data.name}
                    {r > 28 && <tspan x={cx} dy="1.25em" className="tm-value">{fmt(d.value)}</tspan>}
                  </text>
                )}
                {params.labels && !compact && it.visible && !isRoot && !leaf && r > 30 && (
                  <text className="pack-group-label" x={cx} y={cy - r + 13} textAnchor="middle" pointerEvents="none">{d.data.name}</text>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          <Readout items={[{ label: '전체', value: fmt(model.total) }, { label: '노드', value: model.nodes.length - 1 }, ...(skipped ? [{ label: '제외한 행', value: skipped }] : [])]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function PackControls({ params, setParams, mapping }: ControlsProps<PackParams>) {
  const depth = roleColumns(mapping, 'levels').length
  return (
    <>
      <ControlGroup title="배치">
        <Slider label="원 사이 간격" value={params.padding} min={0} max={14} step={1} onChange={(padding) => setParams({ padding })} format={(v) => `${v}px`} testId="ctl-padding" />
        <Slider label="한 번에 보이는 계층 수" value={Math.min(params.levels, Math.max(1, depth))} min={1} max={Math.max(1, depth)} onChange={(levels) => setParams({ levels })} testId="ctl-levels" />
        <Toggle label="레이블" checked={params.labels} onChange={(labels) => setParams({ labels })} />
        <Segmented label="색 지정" value={params.color} onChange={(color) => setParams({ color })} testId="ctl-color"
          options={[{ value: 'branch', label: '가지별' }, { value: 'depth', label: '깊이별' }, { value: 'single', label: '단색' }]} />
      </ControlGroup>
      <Hint>가장 안쪽 원(잎)의 넓이가 값에 비례하고, 바깥 원은 그 안의 원들을 감쌉니다. 바깥 원의 넓이는 합계보다 커서 직접 비교하기 어렵습니다. 원을 클릭해 확대하고, 빈 곳을 눌러 한 단계 위로 돌아갑니다.</Hint>
    </>
  )
}

export const packModule: VizModule<PackParams> = {
  roles: [
    { key: 'levels', label: '계층 수준 (바깥 → 안쪽)', type: 'category', required: true, multiple: { min: 1, max: 4 } },
    { key: 'value', label: '값 (넓이)', type: 'number', required: true },
  ],
  datasets: ['budget', 'categorical'],
  defaultParams: { padding: 4, labels: true, color: 'branch', levels: 3, focus: [], selected: [] },
  Chart: PackChart,
  Controls: PackControls,
  hint: '원을 클릭해 확대·선택 · 빈 곳이나 위쪽 경로로 돌아가기 · 데이터 탭에서 값을 바꾸면 배치가 다시 계산됩니다',
}
