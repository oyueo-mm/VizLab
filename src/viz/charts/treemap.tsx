import * as d3 from 'd3'
import { ChevronRight } from 'lucide-react'
import { useMemo, useRef } from 'react'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Select, Slider, Toggle } from '../../components/controls'
import { colorAt, textOn } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { columnIndex, toLabel, toNumber, type DataTable } from '../../data/table'
import { useTween } from '../../hooks/motion'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'

export interface TreemapParams {
  tile: 'squarify' | 'binary' | 'slice' | 'dice' | 'sliceDice'
  padding: number
  labels: boolean
  focus: string[]
}

export interface TreeNode { name: string; value?: number; children?: TreeNode[] }

const tiles = { squarify: d3.treemapSquarify, binary: d3.treemapBinary, slice: d3.treemapSlice, dice: d3.treemapDice, sliceDice: d3.treemapSliceDice }

/** Builds a nested tree from level columns (outer → inner), summing positive values of identical paths. */
export function buildTree(table: DataTable, levels: string[], valueCol: string | null): { tree: TreeNode; skipped: number } {
  const li = levels.map((l) => columnIndex(table, l))
  const vi = columnIndex(table, valueCol)
  const root: TreeNode = { name: '전체', children: [] }
  let skipped = 0
  for (const r of table.rows) {
    const v = vi >= 0 ? toNumber(r[vi]) : 1
    if (v == null || v <= 0) { skipped++; continue }
    let node = root
    li.forEach((ci, depth) => {
      const name = toLabel(r[ci]) || '(빈 값)'
      node.children ??= []
      let child = node.children.find((c) => c.name === name)
      if (!child) {
        child = depth === li.length - 1 ? { name, value: 0 } : { name, children: [] }
        node.children.push(child)
      }
      node = child
    })
    node.value = (node.value ?? 0) + v
  }
  return { tree: root, skipped }
}

function TreemapChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<TreemapParams>) {
  const levels = roleColumns(mapping, 'levels')
  const valueCol = roleColumn(mapping, 'value')
  const { tree, skipped } = useMemo(() => buildTree(table, levels, valueCol), [table, levels, valueCol])
  const svgRef = useRef<SVGSVGElement>(null)
  const { tip, show, hide } = useTooltip()
  const crumbH = compact ? 0 : 34
  const h = Math.max(10, height - crumbH)

  const { nodes, focusNode, total } = useMemo(() => {
    const root = d3.hierarchy<TreeNode>(tree).sum((d) => d.value ?? 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    // Resolve the zoom path; ignore stale entries (e.g. after the data changed).
    let focus = root
    for (const name of params.focus) {
      const next = focus.children?.find((c) => c.data.name === name)
      if (!next) break
      focus = next
    }
    const sub = d3.hierarchy<TreeNode>(focus.data).sum((d) => d.value ?? 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    d3.treemap<TreeNode>().tile(tiles[params.tile]).size([width, h]).paddingInner(params.padding).paddingOuter(params.padding)
      .paddingTop((d) => (d.depth > 0 && d.children && !compact ? 18 : params.padding)).round(true)(sub)
    return { nodes: sub.descendants().filter((d) => d.depth > 0) as d3.HierarchyRectangularNode<TreeNode>[], focusNode: focus, total: root.value ?? 0 }
  }, [tree, params.focus, params.tile, params.padding, width, h, compact])

  const pathOf = (d: d3.HierarchyNode<TreeNode>) => d.ancestors().reverse().slice(1).map((a) => a.data.name)
  const focusDepth = focusNode.depth
  const topName = (d: d3.HierarchyNode<TreeNode>) => (focusDepth > 0 ? params.focus[0] : d.ancestors().reverse()[1]?.data.name ?? d.data.name)
  const tops = (tree.children ?? []).map((c) => c.name)
  const colorOf = (d: d3.HierarchyNode<TreeNode>) => {
    const base = colorAt(Math.max(0, tops.indexOf(topName(d))))
    return d.children ? base : d3.interpolateRgb(base, '#ffffff')(0.12 + 0.12 * ((d.parent?.children?.indexOf(d) ?? 0) % 3))
  }
  const keyOf = (d: d3.HierarchyNode<TreeNode>) => pathOf(d).join('/')
  const target = useMemo(() => nodes.map((d) => [d.x0, d.y0, d.x1, d.y1]), [nodes])
  const shown = useTween(target, { snapKey: `${width}x${h}${params.focus.join('/')}`, enabled: !compact })

  if (!levels.length || !valueCol) return <ChartMessage>계층 수준(범주형 열)과 값 열을 선택하세요.</ChartMessage>
  if (!nodes.length) return <ChartMessage>양수 값이 있는 항목이 없습니다.</ChartMessage>

  return (
    <div className="chart-root treemap-root">
      {!compact && (
        <nav className="treemap-crumbs" aria-label="계층 위치">
          <button type="button" onClick={() => setParams({ focus: [] })} aria-current={params.focus.length === 0 ? 'page' : undefined}>전체</button>
          {params.focus.slice(0, focusDepth).map((name, i) => (
            <span key={i}><ChevronRight size={14} aria-hidden="true" /><button type="button" onClick={() => setParams({ focus: params.focus.slice(0, i + 1) })}>{name}</button></span>
          ))}
          {skipped > 0 && <span className="crumb-note">0 이하·빈 값 {skipped}행 제외</span>}
        </nav>
      )}
      <svg ref={svgRef} width={width} height={h} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`트리맵: ${levels.join(' › ')}별 ${valueCol}`} onPointerLeave={hide}>
        {nodes.map((d, i) => {
          const [x0, y0, x1, y1] = shown[i] ?? target[i]
          const w = Math.max(0, x1 - x0)
          const hh = Math.max(0, y1 - y0)
          const fill = colorOf(d)
          const leaf = !d.children
          const canZoom = !!d.children && !compact
          return (
            <g key={keyOf(d)} transform={`translate(${x0},${y0})`} className={`marks ${canZoom ? 'is-zoomable' : ''}`}
              onClick={canZoom ? (e) => { e.stopPropagation(); setParams({ focus: [...params.focus.slice(0, focusDepth), ...pathOf(d)] }) } : undefined}>
              <rect className={leaf ? 'tm-leaf' : 'tm-group'} width={w} height={hh} fill={leaf ? fill : d3.color(fill)!.copy({ opacity: 0.16 }).toString()} stroke={leaf ? '#fff' : fill} data-testid={leaf ? 'treemap-leaf' : undefined}
                onPointerMove={compact ? undefined : (e) => {
                  e.stopPropagation()
                  const lp = localPoint(svgRef.current!, e)
                  show(lp.x, lp.y + crumbH, <><b>{[...params.focus.slice(0, focusDepth), ...pathOf(d)].join(' › ')}</b><br />{valueCol}: {fmt(d.value)}<br />전체의 {pct((d.value ?? 0) / total)} · 상위의 {pct((d.value ?? 0) / (d.parent?.value || 1))}{d.children ? <><br />클릭하면 확대</> : null}</>)
                }} />
              {!compact && params.labels && !leaf && w > 40 && <text className="tm-group-label" x={5} y={13} fill={d3.color(fill)!.darker(1.2).formatHex()}>{d.data.name}</text>}
              {!compact && params.labels && leaf && w > 34 && hh > 26 && (
                <text className="tm-label" x={5} y={15} fill={textOn(fill)}>
                  {d.data.name}<tspan x={5} dy={15} className="tm-value">{fmt(d.value)}</tspan>
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function TreemapControls({ params, setParams }: ControlsProps<TreemapParams>) {
  return (
    <>
      <ControlGroup title="배치 알고리즘">
        <Select label="타일링" value={params.tile} onChange={(tile) => setParams({ tile })} testId="ctl-tile"
          options={[
            { value: 'squarify', label: 'Squarify (정사각형에 가깝게)' }, { value: 'binary', label: 'Binary (이진 분할)' },
            { value: 'slice', label: 'Slice (가로로 자르기)' }, { value: 'dice', label: 'Dice (세로로 자르기)' }, { value: 'sliceDice', label: 'Slice-and-dice (번갈아)' },
          ]} />
        <Hint>Squarify는 가로세로 비가 1에 가까워 넓이 비교가 쉽고, Slice·Dice는 순서를 유지하지만 가늘고 긴 사각형이 생깁니다.</Hint>
        <Slider label="여백" value={params.padding} min={0} max={8} onChange={(padding) => setParams({ padding })} format={(v) => `${v}px`} testId="ctl-padding" />
        <Toggle label="레이블" checked={params.labels} onChange={(labels) => setParams({ labels })} />
      </ControlGroup>
      <Hint>상위 그룹을 클릭하면 그 안으로 확대되고, 위쪽 경로를 눌러 돌아갑니다. 계층 순서는 데이터 탭 ‘계층 수준’에서 바꿉니다.</Hint>
    </>
  )
}

export const treemapModule: VizModule<TreemapParams> = {
  roles: [
    { key: 'levels', label: '계층 수준 (바깥 → 안쪽)', type: 'category', required: true, multiple: { min: 1, max: 4 } },
    { key: 'value', label: '값 (넓이)', type: 'number', required: true },
  ],
  datasets: ['budget', 'categorical', 'votes'],
  defaultParams: { tile: 'squarify', padding: 2, labels: true, focus: [] },
  Chart: TreemapChart,
  Controls: TreemapControls,
  hint: '상위 그룹을 클릭해 확대 · 위쪽 경로로 돌아가기 · 마우스를 올려 비율 확인',
}
