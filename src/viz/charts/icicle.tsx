import * as d3 from 'd3'
import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, NumberField, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { appendRow, removeRows, templateRow, type DataTable } from '../../data/table'
import { colorAt, textOn } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { buildTree, rowsUnder, type TreeNode } from '../../stats/hierarchy'
import { findNode, icicleLayout, type IcicleNode } from '../../stats/icicle'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { Crumbs } from './hierShared'

export interface IcicleParams {
  orientation: 'horizontal' | 'vertical'
  maxDepth: number
  focus: string[]
  color: 'branch' | 'depth'
  sort: 'value' | 'none'
  labels: boolean
  padding: number
}

function colorFor(n: IcicleNode, tops: readonly string[], mode: IcicleParams['color'], topName: string) {
  if (mode === 'depth') return d3.interpolateYlGnBu(0.25 + 0.14 * Math.min(5, n.depth))
  const base = colorAt(Math.max(0, tops.indexOf(topName)))
  return d3.interpolateRgb(base, '#ffffff')(Math.min(0.55, Math.max(0, n.depth - 1) * 0.16))
}

function IcicleChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<IcicleParams>) {
  const levels = roleColumns(mapping, 'levels')
  const valueCol = roleColumn(mapping, 'value')
  const { tree, skipped } = useMemo(() => buildTree(table, levels, valueCol), [table, levels.join('\u0000'), valueCol]) // eslint-disable-line react-hooks/exhaustive-deps
  const focus = useMemo(() => findNode(tree, params.focus).path, [tree, params.focus])
  const nodes = useMemo(() => icicleLayout(tree, focus, compact ? 4 : params.maxDepth, params.sort), [tree, focus, params.maxDepth, params.sort, compact])
  const tops = useMemo(() => (tree.children ?? []).map((c) => c.name), [tree])
  const svgRef = useRef<SVGSVGElement>(null)
  const { tip, show, hide } = useTooltip()
  const horizontal = params.orientation === 'horizontal'

  if (!levels.length || !valueCol) return <ChartMessage>계층 수준(범주형)과 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!nodes.length || !nodes[0].value) return <ChartMessage>0보다 큰 값을 가진 항목이 없습니다.</ChartMessage>
  const crumbH = compact ? 0 : 34
  const W = width
  const H = Math.max(10, height - crumbH)
  const root = nodes[0]
  const pad = compact ? 0.5 : params.padding / 2
  const rectOf = (n: IcicleNode) => {
    // a: along the value axis, d: along the depth axis.
    const aLen = horizontal ? H : W
    const dLen = horizontal ? W : H
    const a0 = n.a0 * aLen
    const a1 = n.a1 * aLen
    const d0 = n.d0 * dLen
    const d1 = n.d1 * dLen
    return horizontal ? { x: d0 + pad, y: a0 + pad, w: Math.max(0, d1 - d0 - 2 * pad), h: Math.max(0, a1 - a0 - 2 * pad) } : { x: a0 + pad, y: d0 + pad, w: Math.max(0, a1 - a0 - 2 * pad), h: Math.max(0, d1 - d0 - 2 * pad) }
  }
  return (
    <div className="treemap-root">
      {!compact && <Crumbs path={focus} onNavigate={(path) => setParams({ focus: path })} />}
      <svg ref={svgRef} width={W} height={H} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`아이시클 차트: ${levels.join(' › ')}`} onPointerLeave={hide}>
        {nodes.map((n) => {
          const r = rectOf(n)
          if (r.w < 0.5 || r.h < 0.5) return null
          const fill = n.depth === 0 && focus.length === 0 ? '#e6e9e8' : colorFor(n, tops, params.color, n.path[0] ?? '')
          const zoomable = n.hasChildren && !compact
          const canShow = params.labels && !compact && r.w > 34 && r.h > 16
          const vertical = !horizontal && r.w < 30 && r.h > 50
          return (
            <g key={n.path.join('\u0000') || '__root'} className="icicle-node" data-testid="icicle-node" data-depth={n.depth}>
              <rect className={zoomable ? 'is-zoomable' : ''} x={r.x} y={r.y} width={r.w} height={r.h} rx={2} fill={fill}
                onClick={zoomable && n.path.length > focus.length ? () => setParams({ focus: n.path }) : undefined}
                onPointerMove={compact ? undefined : (e) => {
                  const p = localPoint(svgRef.current!, e)
                  show(p.x, p.y, <><b>{n.path.length ? n.path.join(' › ') : tree.name}</b><br />{valueCol}: {fmt(n.value)}<br />{pct(root.value ? n.value / root.value : 0)} (현재 보기 기준){zoomable && n.path.length > focus.length ? <><br />클릭해 확대</> : null}</>)
                }} />
              {canShow && !vertical && <text className="tm-label" x={r.x + 6} y={r.y + 14} fill={textOn(fill)} pointerEvents="none">{r.w < 70 ? n.name.slice(0, Math.max(1, Math.floor(r.w / 8))) : n.name}</text>}
              {canShow && !vertical && r.h > 32 && r.w > 52 && <text className="tm-value" x={r.x + 6} y={r.y + 28} fill={textOn(fill)} pointerEvents="none">{fmt(n.value)}</text>}
              {canShow && vertical && <text className="tm-label" transform={`translate(${r.x + r.w / 2 + 4},${r.y + 6}) rotate(90)`} fill={textOn(fill)} pointerEvents="none">{n.name}</text>}
            </g>
          )
        })}
      </svg>
      {!compact && <Tooltip tip={tip} width={W} />}
      {!compact && skipped > 0 && <p className="chart-footnote" style={{ top: 'auto', bottom: 2, left: 8 }}>값이 없거나 0 이하인 {skipped}행은 제외했습니다.</p>}
    </div>
  )
}

/** Every node as a labelled option (path with depth indentation). */
function flatten(tree: TreeNode, path: string[] = []): { path: string[]; node: TreeNode }[] {
  return [{ path, node: tree }, ...(tree.children ?? []).flatMap((c) => flatten(c, [...path, c.name]))]
}

function IcicleControls({ params, setParams, table, mapping, setTable }: ControlsProps<IcicleParams>) {
  const levels = roleColumns(mapping, 'levels')
  const valueCol = roleColumn(mapping, 'value')
  const { tree } = useMemo(() => buildTree(table, levels, valueCol), [table, levels.join('\u0000'), valueCol]) // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => flatten(tree), [tree])
  const [parent, setParent] = useState('')
  const [name, setName] = useState('')
  const [value, setValue] = useState(10)
  const selected = all.find((n) => n.path.join('\u0000') === parent) ?? all[0]
  const maxPossible = levels.length
  const label = (p: string[]) => (p.length ? `${'　'.repeat(p.length - 1)}${p[p.length - 1]}` : '전체')

  const addChild = () => {
    const nm = name.trim()
    if (!setTable || !nm || !valueCol || selected.path.length >= levels.length || selected.node.children?.some((c) => c.name === nm)) return
    // The new node becomes a leaf; levels below it repeat its name so the row still has a value at every level.
    const patch: Record<string, string | number> = { [valueCol]: value }
    levels.forEach((l, i) => { patch[l] = i < selected.path.length ? selected.path[i] : nm })
    setTable(appendRow(table, { ...templateRow(table), ...patch }))
    setName('')
  }
  const removeNode = () => {
    if (!setTable || !selected.path.length) return
    setTable(removeRows(table, rowsUnder(table as DataTable, levels, selected.path)))
    setParent('')
    if (params.focus.length) setParams({ focus: [] })
  }
  return (
    <>
      <ControlGroup title="보기">
        <Segmented label="방향" value={params.orientation} onChange={(orientation) => setParams({ orientation })} testId="ctl-orient" options={[{ value: 'horizontal', label: '가로' }, { value: 'vertical', label: '세로' }]} />
        <Slider label="표시 깊이" value={Math.min(params.maxDepth, Math.max(1, maxPossible))} min={1} max={Math.max(1, maxPossible)} onChange={(maxDepth) => setParams({ maxDepth })} format={(v) => `${v}단계`} testId="ctl-depth" />
        <Select label="색상" value={params.color} onChange={(color) => setParams({ color })} options={[{ value: 'branch', label: '최상위 가지별' }, { value: 'depth', label: '깊이별' }]} />
        <Select label="정렬" value={params.sort} onChange={(sort) => setParams({ sort })} options={[{ value: 'value', label: '값 큰 순' }, { value: 'none', label: '데이터 순서' }]} />
        <Toggle label="이름 표시" checked={params.labels} onChange={(labels) => setParams({ labels })} />
        <Slider label="띠 사이 간격" value={params.padding} min={0} max={6} step={0.5} onChange={(padding) => setParams({ padding })} format={(v) => `${v}px`} />
        <Hint>띠를 클릭하면 그 가지가 전체 길이로 확대되고, 위쪽 경로로 돌아갈 수 있습니다. 선버스트·트리맵과 같은 계층 계산을 씁니다.</Hint>
      </ControlGroup>
      <ControlGroup title="노드 추가·삭제" defaultOpen={false}>
        <Select label="대상 노드" value={selected.path.join('\u0000')} onChange={setParent} testId="icicle-target"
          options={all.map((n) => ({ value: n.path.join('\u0000'), label: label(n.path) }))} />
        <div className="field number-field"><label htmlFor="icicle-name">새 하위 노드 이름</label>
          <input id="icicle-name" type="text" value={name} data-testid="icicle-name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addChild() }} /></div>
        <NumberField label="값" value={value} onChange={setValue} min={0} testId="icicle-value" />
        <div className="data-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={addChild} disabled={!name.trim() || selected.path.length >= levels.length} data-testid="icicle-add"><Plus size={14} aria-hidden="true" />하위 노드 추가</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={removeNode} disabled={!selected.path.length} data-testid="icicle-delete"><Trash2 size={14} aria-hidden="true" />노드 삭제</button>
        </div>
        <Hint>삭제하면 그 노드 아래의 모든 행이 함께 지워집니다. 가장 안쪽 수준의 노드는 하위 노드를 가질 수 없습니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const icicleModule: VizModule<IcicleParams> = {
  roles: [
    { key: 'levels', label: '계층 수준 (바깥 → 안쪽)', type: 'category', required: true, multiple: { min: 1, max: 4 } },
    { key: 'value', label: '값 (길이)', type: 'number', required: true },
  ],
  datasets: ['budget', 'folders', 'categorical', 'votes'],
  defaultParams: { orientation: 'horizontal', maxDepth: 4, focus: [], color: 'branch', sort: 'value', labels: true, padding: 2 },
  Chart: IcicleChart,
  Controls: IcicleControls,
  hint: '띠를 클릭해 그 가지를 확대 · 위쪽 경로로 돌아가기 · 마우스를 올려 값과 비율 확인',
}

