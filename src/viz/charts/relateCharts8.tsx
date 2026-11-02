import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber } from '../../data/table'
import { categoryColor } from '../../lib/colors'
import { adjacency, louvain } from '../../stats/graph2'
import { arcLength, arcOrder, pivotGraph, substrateLayout, type DynEdge } from '../../stats/relate8'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, RoleSpec, VizModule } from '../types'


// ───────────────────────────── attribute networks ─────────────────────────────

interface AttrNode { id: string; rows: number[]; attrs: Record<string, string | number | null> }
interface AttrNet { nodes: AttrNode[]; edges: { a: number; b: number; w: number; rows: number[] }[] }

/**
 * Edge rows with node attributes: attributes of a node are read from the first row where it is the source (like the group column of the
 * other network charts); nodes that only occur as a target have no attributes.
 */
function readAttrNet(table: ChartProps<unknown>['table'], mapping: ChartProps<unknown>['mapping'], attrs: Record<string, 'text' | 'number'>): AttrNet | null {
  const si = columnIndex(table, roleColumn(mapping, 'source')), ti = columnIndex(table, roleColumn(mapping, 'target')), wi = columnIndex(table, roleColumn(mapping, 'weight'))
  if (si < 0 || ti < 0) return null
  const ai = Object.entries(attrs).map(([k, kind]) => ({ k, kind, i: columnIndex(table, roleColumn(mapping, k)) }))
  const idx = new Map<string, number>()
  const nodes: AttrNode[] = []
  const node = (id: string, row: number) => { let i = idx.get(id); if (i == null) { i = nodes.length; idx.set(id, i); nodes.push({ id, rows: [], attrs: Object.fromEntries(ai.map((a) => [a.k, null])) }) } nodes[i].rows.push(row); return i }
  const edges = new Map<string, { a: number; b: number; w: number; rows: number[] }>()
  table.rows.forEach((r, row) => {
    const s = toLabel(r[si]).trim(), t = toLabel(r[ti]).trim()
    if (!s) return
    const a = node(s, row)
    for (const x of ai) if (x.i >= 0 && nodes[a].attrs[x.k] == null) nodes[a].attrs[x.k] = x.kind === 'number' ? toNumber(r[x.i]) : toLabel(r[x.i]) || null
    if (!t || t === s) return
    const b = node(t, row)
    const w = wi >= 0 ? toNumber(r[wi]) ?? 1 : 1
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    const e = edges.get(key)
    if (e) { e.w += w; e.rows.push(row) } else edges.set(key, { a, b, w, rows: [row] })
  })
  return { nodes, edges: [...edges.values()] }
}

const edgeBase = (): RoleSpec[] => [
  { key: 'source', label: '출발 노드', type: 'category', required: true },
  { key: 'target', label: '도착 노드', type: 'category', required: true },
  { key: 'weight', label: '연결 가중치 (선택)', type: 'number', auto: true, prefer: '가중|weight' },
]

// ───────────────────────────── Semantic Substrates ─────────────────────────────

export interface SubstrateParams { direction: 'rows' | 'columns'; perRegion: boolean; links: 'all' | 'within' | 'between' | 'selected'; minWeight: number; selected: string }

function SubstrateChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<SubstrateParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const net = useMemo(() => readAttrNet(table, mapping, { group: 'text', x: 'number', y: 'number' }), [table, mapping])
  const layout = useMemo(() => (net ? substrateLayout(net.nodes.map((n) => ({ id: n.id, sub: (n.attrs.group as string) || '(속성 없음)', x: n.attrs.x as number | null, y: n.attrs.y as number | null })), width - 8, height - 8, { direction: params.direction, perRegion: params.perRegion, gap: compact ? 6 : 12, pad: compact ? 8 : 18 }) : null), [net, width, height, params.direction, params.perRegion, compact])
  if (!net || !layout || !net.nodes.length) return <ChartMessage>출발·도착 노드와 속성 열(범주, 숫자 2개)을 선택하세요.</ChartMessage>
  const color = categoryColor(layout.regions.map((r) => r.sub))
  const subOf = (i: number) => (net.nodes[i].attrs.group as string) || '(속성 없음)'
  const sel = net.nodes.findIndex((n) => n.id === params.selected)
  const marked = new Set(linked?.rows ?? [])
  const visible = net.edges.filter((e) => {
    if (e.w < params.minWeight) return false
    const same = subOf(e.a) === subOf(e.b)
    if (params.links === 'within') return same
    if (params.links === 'between') return !same
    if (params.links === 'selected') return sel >= 0 && (e.a === sel || e.b === sel)
    return true
  })
  const xName = roleColumn(mapping, 'x') ?? 'x', yName = roleColumn(mapping, 'y') ?? 'y'
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" onPointerLeave={hide}
        aria-label={`Semantic Substrates: 노드 ${net.nodes.length}개를 ${layout.regions.length}개 영역(${layout.regions.map((r) => r.sub).join(', ')})에 속성값으로 배치, 표시한 연결 ${visible.length}개`}>
        <g transform="translate(4,4)">
          {layout.regions.map((r) => (
            <g key={r.sub} data-testid="substrate-region">
              <rect x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0} fill={color(r.sub)} fillOpacity={0.07} stroke={color(r.sub)} strokeOpacity={0.6} rx={4} />
              {!compact && <text x={r.x0 + 8} y={r.y0 + 14} className="radar-axis-label" fill={color(r.sub)}>{r.sub}</text>}
              {!compact && <text x={r.x1 - 6} y={r.y1 - 4} textAnchor="end" className="radar-level">→ {xName}</text>}
            </g>
          ))}
          {visible.map((e, k) => {
            const p = layout.pos.get(net.nodes[e.a].id)!, q = layout.pos.get(net.nodes[e.b].id)!
            const hot = e.a === sel || e.b === sel || e.rows.some((r) => marked.has(r))
            return <line key={k} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={hot ? '#111' : '#7d8791'} strokeWidth={hot ? 1.6 : 0.8} opacity={hot ? 0.9 : sel >= 0 ? 0.12 : 0.35} data-testid="substrate-link" />
          })}
          {net.nodes.map((n, i) => {
            const p = layout.pos.get(n.id)!
            const hot = i === sel || n.rows.some((r) => marked.has(r))
            return (
              <g key={n.id} transform={`translate(${p[0]},${p[1]})`} data-testid="substrate-node" style={{ cursor: compact ? undefined : 'pointer' }}
                onClick={compact ? undefined : () => setParams({ selected: params.selected === n.id ? '' : n.id })}
                onPointerEnter={compact ? undefined : (e) => { linked?.set(n.rows); const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{n.id}</b><br />{subOf(i)}<br />{xName}: {n.attrs.x ?? '—'} · {yName}: {n.attrs.y ?? '—'}</>) }} onPointerLeave={() => { hide(); linked?.set(null) }}>
                <circle r={compact ? 2.6 : 5.5} fill={color(subOf(i))} stroke={hot ? '#111' : '#fff'} strokeWidth={hot ? 2 : 1} />
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function SubstrateControls({ params, setParams }: ControlsProps<SubstrateParams>) {
  return (
    <ControlGroup title="영역과 연결">
      <Segmented label="영역 쌓는 방향" value={params.direction} onChange={(direction) => setParams({ direction })} options={[{ value: 'rows', label: '가로 띠' }, { value: 'columns', label: '세로 띠' }]} testId="ctl-dir" />
      <Toggle label="영역마다 속성 범위를 따로 맞춤" checked={params.perRegion} onChange={(perRegion) => setParams({ perRegion })} testId="ctl-perregion" />
      <Segmented label="보일 연결" value={params.links} onChange={(links) => setParams({ links })} options={[{ value: 'all', label: '모두' }, { value: 'within', label: '영역 안' }, { value: 'between', label: '영역 사이' }, { value: 'selected', label: '선택 노드' }]} testId="ctl-links" />
      <Slider label="연결 가중치 하한" value={params.minWeight} min={0} max={6} step={0.5} onChange={(minWeight) => setParams({ minWeight })} testId="ctl-minw" />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ selected: '' })} data-testid="substrate-clear">선택 해제</button>
      <Hint>노드를 범주(예: 부서)에 따라 미리 정한 영역에 나누고, 영역 안에서는 두 숫자 속성(가로 = 첫째, 세로 = 둘째)으로 위치를 정합니다. 그래서 위치 자체가 속성값이고, 연결은 영역 안과 영역 사이로 나누어 걸러 볼 수 있습니다. 노드를 눌러 그 노드의 연결만 볼 수 있습니다. 원 논문처럼 영역마다 다른 속성을 쓰는 설정(영역별 축 정의)은 제공하지 않고 모든 영역이 같은 두 속성을 씁니다.</Hint>
    </ControlGroup>
  )
}

export const substrateModule: VizModule<SubstrateParams> = {
  roles: [...edgeBase(), { key: 'group', label: '영역을 나누는 속성 (범주)', type: 'category', required: true, auto: true }, { key: 'x', label: '영역 안 가로 위치 (숫자)', type: 'number', required: true, prefer: '경력|x' }, { key: 'y', label: '영역 안 세로 위치 (숫자)', type: 'number', required: true, prefer: '성과|y' }],
  datasets: ['people-network'],
  defaultParams: { direction: 'rows', perRegion: false, links: 'all', minWeight: 0, selected: '' },
  Chart: SubstrateChart,
  Controls: SubstrateControls,
  hint: '노드를 눌러 그 노드의 연결만 보기 · 연결을 영역 안/사이로 걸러 보기',
}

// ───────────────────────────── PivotGraph ─────────────────────────────

export interface PivotParams { directed: boolean; sort: 'count' | 'name'; minLink: number; selected: number }

function PivotChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<PivotParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const net = useMemo(() => readAttrNet(table, mapping, { colAttr: 'text', rowAttr: 'text' }), [table, mapping])
  const pv = useMemo(() => (net ? pivotGraph(net.nodes.map((n) => ({ col: (n.attrs.colAttr as string) || '(없음)', row: (n.attrs.rowAttr as string) || '(없음)' })), net.edges.map((e) => [e.a, e.b] as [number, number]), { directed: params.directed, sort: params.sort }) : null), [net, params.directed, params.sort])
  if (!net || !pv || !pv.cells.length) return <ChartMessage>출발·도착 노드와 가로·세로 속성(범주형 열)을 선택하세요.</ChartMessage>
  const m = compact ? { l: 6, r: 6, t: 6, b: 6 } : { l: 90, r: 30, t: 46, b: 20 }
  const iw = width - m.l - m.r, ih = height - m.t - m.b
  const cw = iw / Math.max(1, pv.cols.length), ch = ih / Math.max(1, pv.rows.length)
  const cx = (c: number) => m.l + (c + 0.5) * cw, cy = (r: number) => m.t + (r + 0.5) * ch
  const maxCount = Math.max(...pv.cells.map((c) => c.count))
  const R = (count: number) => Math.min(cw, ch) * 0.44 * Math.sqrt(count / maxCount)
  const maxLink = Math.max(1, ...pv.links.map((l) => l.count))
  const rowsOfCell = (ci: number) => new Set(pv.cells[ci].nodes.flatMap((i) => net.nodes[i].rows))
  const marked = new Set(linked?.rows ?? [])
  const color = categoryColor(pv.rows)
  const visible = pv.links.filter((l) => l.count >= params.minLink)
  const sel = params.selected
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" onPointerLeave={hide}
        aria-label={`PivotGraph: 노드 ${pv.nodeCount}개를 ${pv.cols.length}×${pv.rows.length} 격자의 ${pv.cells.length}개 칸으로 모으고 간선 ${pv.edgeCount}개를 칸 사이 연결 ${pv.links.length}개로 집계`}>
        <defs><marker id="pv-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0L8,4L0,8z" fill="#7d8791" /></marker></defs>
        {pv.cols.map((c, i) => <g key={c}><line x1={cx(i)} x2={cx(i)} y1={m.t} y2={m.t + ih} stroke="#eef0f2" />{!compact && <text x={cx(i)} y={m.t - 10} textAnchor="middle" className="radar-axis-label">{c}</text>}</g>)}
        {pv.rows.map((r, i) => <g key={r}><line y1={cy(i)} y2={cy(i)} x1={m.l} x2={m.l + iw} stroke="#eef0f2" />{!compact && <text x={m.l - 8} y={cy(i)} dy="0.34em" textAnchor="end" className="radar-axis-label">{r}</text>}</g>)}
        {visible.filter((l) => l.a !== l.b).map((l, k) => {
          const A = pv.cells[l.a], B = pv.cells[l.b]
          const x1 = cx(A.col), y1 = cy(A.row), x2 = cx(B.col), y2 = cy(B.row)
          const d = Math.hypot(x2 - x1, y2 - y1) || 1
          const sx = (x2 - x1) / d, sy = (y2 - y1) / d
          const ra = R(A.count), rb = R(B.count) + (params.directed ? 5 : 0)
          const hot = sel === l.a || sel === l.b || [...rowsOfCell(l.a)].some((r) => marked.has(r)) && [...rowsOfCell(l.b)].some((r) => marked.has(r))
          // opposite directions are bent to different sides so they do not overlap
          const bend = params.directed ? 10 : 0
          const mx = (x1 + x2) / 2 - sy * bend, my = (y1 + y2) / 2 + sx * bend
          return (
            <path key={k} d={`M${x1 + sx * ra},${y1 + sy * ra}Q${mx},${my} ${x2 - sx * rb},${y2 - sy * rb}`} fill="none" stroke={hot ? '#111' : '#7d8791'} strokeWidth={0.8 + (5 * l.count) / maxLink} opacity={sel >= 0 && !hot ? 0.15 : 0.6} markerEnd={params.directed ? 'url(#pv-arrow)' : undefined} data-testid="pivot-link"
              onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{pv.cols[A.col]}·{pv.rows[A.row]} {params.directed ? '→' : '—'} {pv.cols[B.col]}·{pv.rows[B.row]}</b><br />집계한 간선 {l.count}개</>) }} onPointerLeave={hide} />
          )
        })}
        {pv.cells.map((c, i) => {
          const self = pv.links.find((l) => l.a === i && l.b === i)
          const hot = sel === i || [...rowsOfCell(i)].some((r) => marked.has(r))
          return (
            <g key={i} data-testid="pivot-cell" style={{ cursor: compact ? undefined : 'pointer' }} onClick={compact ? undefined : () => setParams({ selected: sel === i ? -1 : i })}
              onPointerEnter={compact ? undefined : (e) => { linked?.set([...rowsOfCell(i)]); const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{pv.cols[c.col]} · {pv.rows[c.row]}</b><br />노드 {c.count}개{self ? ` · 안쪽 간선 ${self.count}개` : ''}<br />{c.nodes.slice(0, 5).map((n) => net.nodes[n].id).join(', ')}{c.count > 5 ? ' …' : ''}</>) }} onPointerLeave={() => { hide(); linked?.set(null) }}>
              <circle cx={cx(c.col)} cy={cy(c.row)} r={R(c.count)} fill={color(pv.rows[c.row])} fillOpacity={0.8} stroke={hot ? '#111' : '#fff'} strokeWidth={hot ? 2.5 : 1} />
              {self && !compact && <circle cx={cx(c.col)} cy={cy(c.row)} r={R(c.count) + 4} fill="none" stroke="#7d8791" strokeWidth={0.8 + (3 * self.count) / maxLink} strokeDasharray="3 2" opacity={0.7} />}
              {!compact && <text x={cx(c.col)} y={cy(c.row)} textAnchor="middle" dy="0.34em" fill="#fff" fontSize={Math.min(13, R(c.count) * 0.9)} style={{ pointerEvents: 'none' }}>{c.count}</text>}
            </g>
          )
        })}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function PivotControls({ params, setParams }: ControlsProps<PivotParams>) {
  return (
    <ControlGroup title="집계">
      <Toggle label="방향 구분 (A→B와 B→A를 따로)" checked={params.directed} onChange={(directed) => setParams({ directed })} testId="ctl-directed" />
      <Segmented label="축 순서" value={params.sort} onChange={(sort) => setParams({ sort })} options={[{ value: 'count', label: '노드 수' }, { value: 'name', label: '이름' }]} testId="ctl-sort" />
      <Slider label="표시할 연결의 최소 간선 수" value={params.minLink} min={1} max={12} onChange={(minLink) => setParams({ minLink })} testId="ctl-minlink" />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ selected: -1 })} data-testid="pivot-clear">선택 해제</button>
      <Hint>두 범주 속성을 가로·세로 축으로 삼아 노드를 격자 칸에 모으고, 칸의 원 크기가 노드 수, 칸 사이 선의 굵기가 그 사이를 잇는 간선 수입니다(점선 고리는 같은 칸 안의 연결). 개별 노드는 사라지고 ‘어떤 속성끼리 연결이 많은가’가 드러납니다. 칸을 누르면 그 칸의 연결이 강조됩니다.</Hint>
    </ControlGroup>
  )
}

export const pivotModule: VizModule<PivotParams> = {
  roles: [...edgeBase(), { key: 'colAttr', label: '가로 속성 (범주)', type: 'category', required: true }, { key: 'rowAttr', label: '세로 속성 (범주)', type: 'category', required: true }],
  datasets: ['people-network'],
  defaultParams: { directed: false, sort: 'name', minLink: 1, selected: -1 },
  Chart: PivotChart,
  Controls: PivotControls,
  hint: '칸을 눌러 그 칸에서 나가는 연결 강조 · 연결 하한으로 큰 흐름만 남기기',
}

// ───────────────────────────── TimeArcs ─────────────────────────────

export interface TimeArcsParams { order: 'optimized' | 'appearance'; bulge: number; t0: number; t1: number; selected: string; labels: boolean }

function TimeArcsChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<TimeArcsParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const model = useMemo(() => {
    const ti = columnIndex(table, roleColumn(mapping, 'time')), ai = columnIndex(table, roleColumn(mapping, 'a')), bi = columnIndex(table, roleColumn(mapping, 'b')), wi = columnIndex(table, roleColumn(mapping, 'weight'))
    if (ti < 0 || ai < 0 || bi < 0) return null
    const ids = new Map<string, number>()
    const names: string[] = []
    const id = (s: string) => { let k = ids.get(s); if (k == null) { k = names.length; ids.set(s, k); names.push(s) } return k }
    const edges: DynEdge[] = []
    table.rows.forEach((r) => {
      const t = toNumber(r[ti]), a = toLabel(r[ai]).trim(), b = toLabel(r[bi]).trim()
      if (t == null || !a || !b || a === b) return
      edges.push({ t, a: id(a), b: id(b), w: wi >= 0 ? Math.max(0, toNumber(r[wi]) ?? 1) || 1 : 1 })
    })
    if (!edges.length) return null
    const n = names.length
    const first = new Array<number>(n).fill(Infinity)
    for (const e of edges) { first[e.a] = Math.min(first[e.a], e.t); first[e.b] = Math.min(first[e.b], e.t) }
    const appearance = [...Array(n).keys()].sort((p, q) => first[p] - first[q] || p - q)
    const best = arcOrder(n, edges)
    const A = adjacency(n, edges.map((e) => ({ a: e.a, b: e.b, w: e.w })))
    const comm = louvain(A, 7)
    const ts = edges.map((e) => e.t)
    return { names, edges, n, appearance, best, comm, tmin: Math.min(...ts), tmax: Math.max(...ts) }
  }, [table, mapping])
  if (!model) return <ChartMessage>시점(숫자), 노드 A·B(범주) 열을 선택하세요.</ChartMessage>
  const order = params.order === 'optimized' ? model.best : model.appearance
  const row = new Map(order.map((v, i) => [v, i]))
  const m = compact ? { l: 4, r: 4, t: 6, b: 6 } : { l: 70, r: 20, t: 24, b: 24 }
  const iw = width - m.l - m.r, ih = height - m.t - m.b
  const t0 = Math.max(model.tmin, params.t0 || model.tmin), t1 = Math.min(model.tmax, params.t1 || model.tmax)
  const x = d3.scaleLinear().domain([t0, Math.max(t0 + 1, t1)]).range([m.l, m.l + iw])
  const y = (v: number) => m.t + ((row.get(v)! + 0.5) / model.n) * ih
  const color = categoryColor([...new Set(model.comm)].map(String))
  const sel = model.names.indexOf(params.selected)
  const shown = model.edges.filter((e) => e.t >= t0 && e.t <= t1)
  const maxW = Math.max(...shown.map((e) => e.w), 1)
  const cost = arcLength(order, model.edges), base = arcLength(model.appearance, model.edges)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" onPointerLeave={hide}
        aria-label={`TimeArcs: 노드 ${model.n}개의 시간별 관계 ${shown.length}개를 노드 행 사이의 호로 표시`}>
        {order.map((v) => <line key={v} x1={m.l} x2={m.l + iw} y1={y(v)} y2={y(v)} stroke={v === sel ? '#111' : '#eceff1'} strokeWidth={v === sel ? 1.4 : 1} />)}
        {shown.map((e, k) => {
          const ya = y(e.a), yb = y(e.b)
          const r = (Math.abs(yb - ya) / 2) * params.bulge
          const same = model.comm[e.a] === model.comm[e.b]
          const hot = sel >= 0 && (e.a === sel || e.b === sel)
          return (
            <path key={k} d={`M${x(e.t)},${Math.min(ya, yb)}A${r * 0.55},${Math.abs(yb - ya) / 2} 0 0 1 ${x(e.t)},${Math.max(ya, yb)}`} fill="none" stroke={hot ? '#111' : same ? color(String(model.comm[e.a])) : '#9aa3ad'} strokeWidth={0.6 + (2 * e.w) / maxW} opacity={sel >= 0 && !hot ? 0.1 : 0.55} data-testid="timearc"
              onPointerEnter={compact ? undefined : (ev) => { const lp = localPoint(svgRef.current!, ev); show(lp.x, lp.y, <><b>{model.names[e.a]} — {model.names[e.b]}</b><br />시점 {e.t} · 가중치 {e.w}</>) }} onPointerLeave={hide} />
          )
        })}
        {order.map((v) => (
          <g key={`l${v}`} style={{ cursor: compact ? undefined : 'pointer' }} onClick={compact ? undefined : () => setParams({ selected: params.selected === model.names[v] ? '' : model.names[v] })} data-testid="timearcs-node">
            <circle cx={m.l - 4} cy={y(v)} r={compact ? 1.8 : 3} fill={color(String(model.comm[v]))} />
            {!compact && params.labels && <text x={m.l - 10} y={y(v)} dy="0.34em" textAnchor="end" className="radar-level" fontWeight={v === sel ? 700 : 400}>{model.names[v]}</text>}
            {!compact && <rect x={0} y={y(v) - ih / model.n / 2} width={m.l} height={ih / model.n} fill="transparent" />}
          </g>
        ))}
        {!compact && (() => { const ticks = x.ticks(8); return ticks.map((t) => <g key={t}><line x1={x(t)} x2={x(t)} y1={m.t + ih} y2={m.t + ih + 4} stroke="#9aa3ad" /><text x={x(t)} y={m.t + ih + 16} textAnchor="middle" className="radar-level">{t}</text></g>) })()}
        {!compact && <text x={m.l} y={12} className="radar-level" data-testid="timearcs-cost">호 길이 합 {Math.round(cost)}{params.order === 'optimized' ? ` (처음 등장 순 ${Math.round(base)})` : ''}</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function TimeArcsControls({ params, setParams, table, mapping }: ControlsProps<TimeArcsParams>) {
  const ti = columnIndex(table, roleColumn(mapping, 'time'))
  const ts = ti >= 0 ? table.rows.map((r) => toNumber(r[ti])).filter((v): v is number => v != null) : [0, 1]
  const lo = Math.min(...ts), hi = Math.max(...ts)
  return (
    <ControlGroup title="시간 배치">
      <Segmented label="노드(행) 순서" value={params.order} onChange={(order) => setParams({ order })} options={[{ value: 'optimized', label: '호 길이 최소화' }, { value: 'appearance', label: '처음 등장 순' }]} testId="ctl-order" />
      <Slider label="호의 부풀림" value={params.bulge} min={0.3} max={1.2} step={0.05} onChange={(bulge) => setParams({ bulge })} format={(v) => v.toFixed(2)} testId="ctl-bulge" />
      <Slider label="시작 시점" value={params.t0 || lo} min={lo} max={hi} onChange={(t0) => setParams({ t0 })} testId="ctl-t0" />
      <Slider label="끝 시점" value={params.t1 || hi} min={lo} max={hi} onChange={(t1) => setParams({ t1 })} testId="ctl-t1" />
      <Toggle label="노드 이름 표시" checked={params.labels} onChange={(labels) => setParams({ labels })} testId="ctl-labels" />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ selected: '', t0: 0, t1: 0 })} data-testid="timearcs-reset">선택·구간 초기화</button>
      <Hint>노드는 가로 줄, 시간은 가로 방향입니다. 어떤 시점에 두 노드가 상호작용하면 그 시점의 세로선 위에서 두 줄을 잇는 호를 그립니다. 호의 색은 같은 공동체(루뱅) 안이면 공동체 색, 공동체를 가로지르면 회색입니다. 서로 자주 연결되는 노드를 가까이 두도록 줄 순서를 정해(근사 최적화) 호가 짧아집니다. 줄 이름을 누르면 그 노드의 호만 강조됩니다.</Hint>
    </ControlGroup>
  )
}

export const timeArcsModule: VizModule<TimeArcsParams> = {
  roles: [
    { key: 'time', label: '시점', type: 'number', required: true, prefer: '시점|time|시간' },
    { key: 'a', label: '노드 A', type: 'category', required: true },
    { key: 'b', label: '노드 B', type: 'category', required: true },
    { key: 'weight', label: '가중치 (선택)', type: 'number', auto: true, prefer: '가중|weight' },
  ],
  datasets: ['dynamic-links'],
  defaultParams: { order: 'optimized', bulge: 0.8, t0: 0, t1: 0, selected: '', labels: true },
  Chart: TimeArcsChart,
  Controls: TimeArcsControls,
  hint: '줄 이름을 눌러 한 노드의 관계 변화를 따라가기 · 구간 슬라이더로 시간 범위 좁히기',
}
