import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { ChartMessage, Legend, Readout, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Select, Slider, Toggle } from '../../components/controls'
import { MapZoomButtons, useMapZoom } from '../../geo/useMapZoom'
import { categoryColor } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { bundlePath, treeFromPaths, type PathTree } from '../../stats/graphs'
import { buildNetwork } from '../../stats/network'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { edgeRoles, edgeRows } from './networkShared'

export interface BundlingParams {
  /** Bundling strength β: 0 draws straight lines, 1 follows the hierarchy path exactly. */
  tension: number
  separator: '/' | '.' | '::'
  labels: boolean
  linkOpacity: number
  selected: string
}

const SEPS = [{ value: '/', label: '/ (슬래시)' }, { value: '.', label: '. (점)' }, { value: '::', label: ':: (이중 콜론)' }] as const

/** The hierarchy of node paths: inner nodes are path prefixes, leaves are the nodes themselves. */
export function buildBundling(ids: readonly string[], sep: string) {
  const tree = treeFromPaths(ids, sep)
  const root = d3.hierarchy<PathTree>(tree)
  const key = (n: d3.HierarchyNode<PathTree>) => n.ancestors().reverse().slice(1).map((a) => a.data.name).join(sep)
  const leafKeys = new Set(root.leaves().map(key))
  const missing = ids.filter((id) => !leafKeys.has(id))
  return { root, key, missing }
}

function BundlingChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<BundlingParams>) {
  const rows = useMemo(() => edgeRows(table, mapping), [table, mapping])
  const net = useMemo(() => buildNetwork(rows, { directed: true }), [rows])
  const svgRef = useRef<SVGSVGElement>(null)
  const zoom = useMapZoom(svgRef, { enabled: !compact, width, height, maxK: 12 })
  const { tip, show, hide } = useTooltip()
  const marked = new Set(linked?.rows ?? [])
  const ids = useMemo(() => net.nodes.map((n) => n.id), [net])
  const b = useMemo(() => buildBundling(ids, params.separator), [ids, params.separator])
  const labelPx = compact ? 0 : Math.min(130, Math.max(60, (d3.max(b.root.leaves(), (l) => l.data.name.length) ?? 6) * 6.6 + 10))
  const R = Math.max(40, Math.min(width, height) / 2 - labelPx - (compact ? 4 : 12))
  const laid = useMemo(() => d3.cluster<PathTree>().size([2 * Math.PI, R])(b.root.copy()), [b.root, R])
  const paths = useMemo(() => net.links.map((l) => ({ link: l, path: bundlePath(laid, l.source, l.target, b.key) })), [net.links, laid, b])
  const leafMap = useMemo(() => new Map(laid.leaves().map((l) => [b.key(l), l])), [laid, b])
  const groupOf = (id: string) => id.split(params.separator)[0]
  const tops = useMemo(() => [...new Set(ids.map(groupOf))], [ids, params.separator]) // eslint-disable-line react-hooks/exhaustive-deps
  const color = useMemo(() => categoryColor(tops), [tops])
  const line = d3.lineRadial<d3.HierarchyPointNode<PathTree>>().curve(d3.curveBundle.beta(params.tension)).radius((d) => d.y).angle((d) => d.x)
  const wmax = d3.max(net.links, (l) => l.weight) || 1
  const sel = params.selected
  const k = zoom.t.k

  if (!roleColumn(mapping, 'source') || !roleColumn(mapping, 'target')) return <ChartMessage>출발·도착 노드(범주형) 열을 선택하세요.</ChartMessage>
  if (!net.links.length) return <ChartMessage>연결이 없습니다.</ChartMessage>
  const drawn = paths.filter((p) => p.path)
  const out = new Set(sel ? net.links.filter((l) => l.source === sel).map((l) => l.target) : [])
  const inn = new Set(sel ? net.links.filter((l) => l.target === sel).map((l) => l.source) : [])
  const nodeRows = (id: string) => net.nodes.find((n) => n.id === id)?.rows ?? []

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg map-svg" role="img" data-testid="chart-svg" aria-label={`계층형 에지 번들링: 노드 ${leafMap.size}개, 연결 ${drawn.length}개`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${zoom.t.x + (k * width) / 2},${zoom.t.y + (k * height) / 2}) scale(${k})`}>
          {drawn.map(({ link, path }) => {
            const on = !!sel && (link.source === sel || link.target === sel)
            const mk = link.rows.some((r) => marked.has(r))
            const stroke = on ? (link.source === sel ? '#e07a3f' : '#2f6fb3') : mk ? '#e07a3f' : color(groupOf(link.source))
            return (
              <path key={`${link.source}>${link.target}`} data-testid="bundle-edge" data-source={link.source} data-target={link.target} d={line(path as d3.HierarchyPointNode<PathTree>[]) ?? ''} fill="none" stroke={stroke} strokeOpacity={sel && !on ? 0.05 : on || mk ? 0.95 : params.linkOpacity} strokeWidth={Math.max(0.5, (compact ? 1 : 2) * (link.weight / wmax) + 0.3)} vectorEffect="non-scaling-stroke"
                onPointerEnter={compact ? undefined : (e) => { linked?.set(link.rows); const p = localPoint(svgRef.current!, e); show(p.x, p.y, <><b>{link.source} → {link.target}</b><br />가중치 {fmt(link.weight)}<br /><small>계층 경로 {path!.length}단계를 거쳐 묶임</small></>) }} onPointerLeave={() => { hide(); linked?.set(null) }} />
            )
          })}
          {[...leafMap.entries()].map(([id, l]) => {
            const [x, y] = [Math.cos(l.x - Math.PI / 2) * l.y, Math.sin(l.x - Math.PI / 2) * l.y]
            const on = sel === id
            const rel = out.has(id) ? '#e07a3f' : inn.has(id) ? '#2f6fb3' : null
            const flip = l.x >= Math.PI
            const deg = (l.x * 180) / Math.PI - 90
            const dim = !!sel && !on && !rel
            return (
              <g key={id} data-testid="bundle-node" data-id={id} style={{ cursor: compact ? undefined : 'pointer' }}
                onClick={compact ? undefined : () => setParams({ selected: on ? '' : id })}
                onPointerEnter={compact ? undefined : (e) => { linked?.set(nodeRows(id)); const p = localPoint(svgRef.current!, e); const o = net.links.filter((q) => q.source === id).length; const i = net.links.filter((q) => q.target === id).length; show(p.x, p.y, <><b>{id}</b><br />나가는 연결 {o} · 들어오는 연결 {i}</>) }} onPointerLeave={() => { hide(); linked?.set(null) }}>
                <circle cx={x} cy={y} r={on ? 5 : compact ? 1.8 : 3.4 / Math.sqrt(k)} fill={color(groupOf(id))} stroke={rel ?? (on ? '#121816' : '#ffffff')} strokeWidth={on || rel ? 2 : 0.8} vectorEffect="non-scaling-stroke" />
                {params.labels && !compact && <text transform={`rotate(${deg}) translate(${l.y + 8},0)${flip ? ' rotate(180)' : ''}`} textAnchor={flip ? 'end' : 'start'} dy="0.32em" fontSize={11 / Math.sqrt(k)} fill={rel ?? '#121816'} fillOpacity={dim ? 0.3 : 1} fontWeight={on || rel ? 700 : 400}>{id.split(params.separator).slice(-1)[0]}</text>}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          <Legend items={tops.map((t) => ({ key: t, color: color(t) }))} title="최상위 묶음" />
          {sel && <Legend items={[{ key: `${sel}에서 나감`, color: '#e07a3f' }, { key: `${sel}(으)로 들어옴`, color: '#2f6fb3' }]} />}
          <Readout items={[{ label: '노드', value: leafMap.size }, { label: '연결', value: drawn.length }, { label: '묶음', value: b.root.children?.length ?? 0 }]} />
          <MapZoomButtons zoom={zoom} k={k} />
          {b.missing.length > 0 && <p className="chart-warning" role="status">{b.missing.slice(0, 3).join(', ')}{b.missing.length > 3 ? ` 외 ${b.missing.length - 3}개` : ''}은(는) 다른 노드의 상위 경로라서 계층의 잎이 될 수 없어 연결을 그리지 않았습니다.</p>}
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function BundlingControls({ params, setParams, table, mapping }: ControlsProps<BundlingParams>) {
  const rows = useMemo(() => edgeRows(table, mapping), [table, mapping])
  const net = useMemo(() => buildNetwork(rows, { directed: true }), [rows])
  const b = useMemo(() => buildBundling(net.nodes.map((n) => n.id), params.separator), [net, params.separator])
  const flat = b.root.leaves().every((l) => l.depth <= 1)
  return (
    <>
      <ControlGroup title="묶음">
        <Slider label="번들 강도 β" value={params.tension} min={0} max={1} step={0.05} onChange={(tension) => setParams({ tension })} format={(v) => v.toFixed(2)} testId="ctl-bundle-beta" />
        <Hint>0이면 연결이 직선입니다. 값이 커질수록 연결선이 계층의 경로(출발 노드 → 공통 조상 → 도착 노드)를 따라 휘어 같은 묶음끼리 한 다발로 모입니다. 선이 다발로 모이는 것은 계층 구조 덕분이며, 계층이 실제 관계를 반영하지 않으면 그림이 오해를 줍니다.</Hint>
        <Select label="경로 구분자" value={params.separator} onChange={(separator) => setParams({ separator })} testId="ctl-bundle-sep" options={SEPS.map((s) => ({ value: s.value, label: s.label }))} />
        {flat && <Hint>노드 이름에 구분자({params.separator})가 없어 계층이 한 단계뿐입니다. 이 경우 번들링은 효과가 없습니다. ‘패키지/모듈’처럼 경로로 된 이름을 쓰세요.</Hint>}
        <Slider label="연결선 불투명도" value={params.linkOpacity} min={0.05} max={1} step={0.05} onChange={(linkOpacity) => setParams({ linkOpacity })} format={(v) => v.toFixed(2)} />
        <Toggle label="노드 이름 표시" checked={params.labels} onChange={(labels) => setParams({ labels })} />
        <Hint>노드를 클릭하면 나가는 연결(주황)과 들어오는 연결(파랑)이 강조됩니다. 휠·드래그·핀치로 확대와 이동이 가능합니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const edgeBundlingModule: VizModule<BundlingParams> = {
  roles: edgeRoles.filter((r) => r.key !== 'group').map((r) => (r.key === 'source' ? { ...r, label: '출발 노드 (경로: 패키지/모듈)' } : r.key === 'target' ? { ...r, label: '도착 노드 (경로)' } : r)),
  datasets: ['modules'],
  defaultParams: { tension: 0.85, separator: '/', labels: true, linkOpacity: 0.45, selected: '' },
  Chart: BundlingChart,
  Controls: BundlingControls,
  hint: '노드를 클릭해 나가는(주황)·들어오는(파랑) 연결 강조 · 번들 강도 슬라이더로 직선↔계층 경로 · 휠·핀치로 확대',
}
