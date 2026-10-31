import * as d3 from 'd3'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { ChartMessage, Legend, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { categoryColor, colorAt } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { buildNetwork, type NetNode } from '../../stats/network'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { edgeRoles, edgeRows, NetworkEditor } from './networkShared'

export interface ArcParams {
  order: 'data' | 'group' | 'degree' | 'name' | 'custom'
  custom: string[]
  /** Multiplier on the arc height (1 = semicircle). */
  height: number
  widthScale: number
  split: boolean
  labels: boolean
  /** Highlighted node, or ''. */
  focus: string
  nodeSize: number
}

/** Node order for the baseline; `custom` entries come first (in that order) and missing nodes follow in data order. */
export function orderNodes(nodes: readonly NetNode[], order: ArcParams['order'], custom: readonly string[]): NetNode[] {
  const list = [...nodes]
  if (order === 'name') list.sort((a, b) => a.id.localeCompare(b.id, 'ko'))
  else if (order === 'degree') list.sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id, 'ko'))
  else if (order === 'group') list.sort((a, b) => a.group.localeCompare(b.group, 'ko') || a.component - b.component)
  else if (order === 'custom') {
    const pos = new Map(custom.map((id, i) => [id, i]))
    list.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9))
  }
  return list
}

function ArcChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<ArcParams>) {
  const net = useMemo(() => buildNetwork(edgeRows(table, mapping)), [table, mapping])
  const ordered = useMemo(() => orderNodes(net.nodes, params.order, params.custom), [net, params.order, params.custom])
  const groups = useMemo(() => [...new Set(net.nodes.map((n) => n.group).filter(Boolean))], [net])
  const color = useMemo(() => categoryColor(groups), [groups])
  const m = margins(compact, compact ? { top: 6, bottom: 8, left: 10, right: 10 } : { top: 20, bottom: 70, left: 28, right: 28 })
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<string | null>(null)
  const { tip, show, hide } = useTooltip()

  if (!edgeRoles.filter((r) => r.required).every((r) => typeof mapping[r.key] === 'string')) return <ChartMessage>출발 노드와 도착 노드(범주형) 열을 선택하세요.</ChartMessage>
  if (!ordered.length) return <ChartMessage>노드가 없습니다.</ChartMessage>
  const n = ordered.length
  const x = d3.scalePoint<string>().domain(ordered.map((o) => o.id)).range([0, iw]).padding(0.4)
  const idx = new Map(ordered.map((o, i) => [o.id, i]))
  const wmax = Math.max(1, ...net.links.map((l) => l.weight))
  const nodeOf = new Map(net.nodes.map((nd) => [nd.id, nd]))
  const sameGroup = (a: string, b: string) => !!nodeOf.get(a)?.group && nodeOf.get(a)!.group === nodeOf.get(b)!.group
  // With the split option, links inside a group arch upward and links between groups hang below the line.
  const down = (l: (typeof net.links)[number]) => params.split && !sameGroup(l.source, l.target)
  const span = (l: (typeof net.links)[number]) => Math.abs((x(l.source) ?? 0) - (x(l.target) ?? 0))
  const maxUp = Math.max(1, ...net.links.filter((l) => !down(l)).map((l) => span(l) / 2))
  const maxDown = Math.max(1, ...net.links.filter(down).map((l) => span(l) / 2))
  const hasDown = net.links.some(down)
  const baseY = hasDown ? ih * 0.5 : ih * 0.88
  // Shrink the arcs only when they would leave the plot.
  const kUp = Math.min(params.height, (baseY - 4) / maxUp)
  const kDown = Math.min(params.height, (ih - baseY - 4) / maxDown)
  const r = compact ? 2.5 : params.nodeSize
  const focus = hover || params.focus
  const lw = (l: (typeof net.links)[number]) => (compact ? 0.8 : 0.8 + 4.2 * params.widthScale * Math.sqrt(l.weight / wmax))
  const nodeColor = (nd: NetNode) => (groups.length ? (nd.group ? color(nd.group) : '#9aa3a0') : colorAt(nd.component))
  const ranked = [...net.links].sort((a, b) => b.weight - a.weight)

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`아크 다이어그램: 노드 ${n}개, 연결 ${net.links.length}개`} onPointerLeave={() => { hide(); setHover(null) }}>
        <g transform={`translate(${m.left},${m.top})`}>
          <line x1={0} x2={iw} y1={baseY} y2={baseY} stroke="#cfd6d3" />
          {ranked.map((l) => {
            const xa = x(l.source) ?? 0
            const xb = x(l.target) ?? 0
            const d = Math.abs(xb - xa) / 2
            const k = down(l) ? kDown : kUp
            const sweep = down(l) ? (xa < xb ? 0 : 1) : xa < xb ? 1 : 0
            const on = !focus || l.source === focus || l.target === focus
            const c = sameGroup(l.source, l.target) ? color(nodeOf.get(l.source)!.group) : params.split ? '#8a9692' : '#5b6763'
            return (
              <path key={`${l.source}>${l.target}`} className="arc-link" data-testid="arc-link" d={`M${xa},${baseY}A${d},${d * k} 0 0 ${sweep} ${xb},${baseY}`} fill="none" stroke={c} strokeWidth={lw(l)} strokeOpacity={on ? (focus ? 0.9 : 0.5) : 0.07}
                onPointerEnter={compact ? undefined : (e) => {
                  const lp = localPoint(svgRef.current!, e)
                  show(lp.x, lp.y, <><b>{l.source} – {l.target}</b><br />가중치 {fmt(l.weight)}<br />순서 간격 {Math.abs((idx.get(l.source) ?? 0) - (idx.get(l.target) ?? 0))}칸</>)
                }} onPointerLeave={hide} />
            )
          })}
          {ordered.map((nd) => {
            const nx = x(nd.id) ?? 0
            const on = !focus || nd.id === focus || net.links.some((l) => (l.source === focus && l.target === nd.id) || (l.target === focus && l.source === nd.id))
            return (
              <g key={nd.id} className="arc-node" opacity={on ? 1 : 0.25}>
                <circle cx={nx} cy={baseY} r={r} fill={nodeColor(nd)} stroke={focus === nd.id ? '#121816' : '#fff'} strokeWidth={focus === nd.id ? 2.5 : 1.2} data-testid="arc-node" data-node={nd.id} style={{ cursor: compact ? undefined : 'pointer' }}
                  onPointerEnter={compact ? undefined : () => setHover(nd.id)} onPointerLeave={() => setHover(null)} onClick={compact ? undefined : () => setParams({ focus: params.focus === nd.id ? '' : nd.id })} />
                {params.labels && !compact && n <= 60 && <text className="net-label" transform={`translate(${nx},${baseY + r + 8}) rotate(${n > 14 ? 60 : 0})`} textAnchor={n > 14 ? 'start' : 'middle'} dy="0.8em" pointerEvents="none">{nd.id}</text>}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          {groups.length > 0 && <Legend items={groups.map((g) => ({ key: g, color: color(g) }))} title="그룹" />}
          <Readout items={[{ label: '노드', value: n }, { label: '연결', value: net.links.length }, ...(focus ? [{ label: '선택', value: focus }] : [])]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function ArcControls({ params, setParams, table, mapping, setTable }: ControlsProps<ArcParams>) {
  const net = useMemo(() => buildNetwork(edgeRows(table, mapping)), [table, mapping])
  const list = useMemo(() => orderNodes(net.nodes, params.order, params.custom).map((nd) => nd.id), [net, params.order, params.custom])
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= list.length) return
    const next = [...list]
    ;[next[i], next[j]] = [next[j], next[i]]
    setParams({ order: 'custom', custom: next })
  }
  return (
    <>
      <ControlGroup title="노드 순서">
        <Select label="정렬 기준" value={params.order} onChange={(order) => setParams({ order, custom: order === 'custom' ? list : params.custom })} testId="ctl-order"
          options={[{ value: 'data', label: '데이터 순서' }, { value: 'group', label: '그룹별' }, { value: 'degree', label: '연결 많은 순' }, { value: 'name', label: '이름순' }, { value: 'custom', label: '직접 지정' }]} />
        <Hint>순서가 곧 레이아웃입니다. 연결된 노드를 가까이 놓을수록 호가 짧아지고 겹침이 줄어듭니다.</Hint>
        <div className="order-list" data-testid="arc-order">
          <ul>{list.slice(0, 40).map((id, i) => (
            <li key={id}><button type="button" aria-pressed={params.focus === id} onClick={() => setParams({ focus: params.focus === id ? '' : id })} title="강조">{id}</button>
              <span>
                <button type="button" className="icon-btn-xs" aria-label={`${id} 앞으로`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={13} /></button>
                <button type="button" className="icon-btn-xs" aria-label={`${id} 뒤로`} disabled={i === list.length - 1} onClick={() => move(i, 1)}><ArrowDown size={13} /></button>
              </span></li>
          ))}</ul>
        </div>
      </ControlGroup>
      <ControlGroup title="호 모양">
        <Slider label="호의 높이" value={params.height} min={0.2} max={1.4} step={0.05} onChange={(height) => setParams({ height })} format={(v) => `×${v.toFixed(2)}`} testId="ctl-height" />
        <Slider label="호의 굵기" value={params.widthScale} min={0.3} max={2} step={0.1} onChange={(widthScale) => setParams({ widthScale })} format={(v) => `×${v.toFixed(1)}`} testId="ctl-width" />
        <Segmented label="호 위치" value={params.split ? 'split' : 'above'} onChange={(v) => setParams({ split: v === 'split' })} testId="ctl-split" options={[{ value: 'above', label: '모두 위' }, { value: 'split', label: '그룹 안=위, 사이=아래' }]} />
        <Slider label="노드 크기" value={params.nodeSize} min={3} max={12} step={0.5} onChange={(nodeSize) => setParams({ nodeSize })} />
        <Toggle label="노드 이름" checked={params.labels} onChange={(labels) => setParams({ labels })} />
      </ControlGroup>
      <ControlGroup title="노드·연결 편집" defaultOpen={false}>
        <NetworkEditor net={net} table={table} mapping={mapping} setTable={setTable} />
      </ControlGroup>
    </>
  )
}

export const arcModule: VizModule<ArcParams> = {
  roles: edgeRoles,
  datasets: ['network', 'energy'],
  defaultParams: { order: 'group', custom: [], height: 1, widthScale: 1, split: false, labels: true, focus: '', nodeSize: 6 },
  Chart: ArcChart,
  Controls: ArcControls,
  hint: '노드를 클릭해 연결 강조 · 순서를 바꿔 호가 짧아지는 배치 찾기 · 호에 마우스를 올려 가중치 확인',
}
