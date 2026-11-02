import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { categoryColor } from '../../lib/colors'
import { adjacency, louvain } from '../../stats/graph2'
import { attachPoint, blockLayout, confluentTracks, expandPowerGraph, groupLayout, orderBlock, powerGraph, trackCurve, type Edge, type Pt } from '../../stats/graph8'
import { buildNetwork, type Network } from '../../stats/network'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { edgeRoles, edgeRows } from './networkShared'

const ACCENT = '#2a8c82'

/** Nodes (in network order), distinct undirected edges as index pairs and the table rows behind every edge. */
function useGraph(table: ChartProps<unknown>['table'], mapping: ChartProps<unknown>['mapping']) {
  return useMemo(() => {
    const net: Network = buildNetwork(edgeRows(table, mapping))
    const idx = new Map(net.nodes.map((n, i) => [n.id, i]))
    const edges: Edge[] = net.links.map((l) => [idx.get(l.source)!, idx.get(l.target)!] as Edge).map(([a, b]) => (a < b ? [a, b] : [b, a]) as Edge)
    const rowsOf = new Map<string, number[]>()
    net.links.forEach((l, k) => rowsOf.set(`${edges[k][0]}|${edges[k][1]}`, l.rows))
    return { net, idx, edges, rowsOf }
  }, [table, mapping])
}

/** Spacing of members inside a group: larger canvases and fewer nodes give bigger drawings. */
const spacingFor = (w: number, h: number, compact: boolean | undefined, n: number) => (compact ? 12 : Math.max(18, Math.min(44, Math.min(w, h) / (6 + Math.sqrt(n)))))

const pairKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`)

// ───────────────────────────── Power Graph ─────────────────────────────

export interface PowerParams { minGain: number; original: boolean; selected: number }

function PowerChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<PowerParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const g = useGraph(table, mapping)
  const n = g.net.nodes.length
  const pg = useMemo(() => powerGraph(n, g.edges, params.minGain), [g.edges, n, params.minGain])
  const lay = useMemo(() => (n ? groupLayout(n, pg, width, height, spacingFor(width, height, compact, n)) : null), [pg, n, width, height, compact])
  if (!n || !lay) return <ChartMessage>출발·도착 노드 열을 선택하세요.</ChartMessage>
  const color = categoryColor(pg.groups.map((_, i) => String(i)))
  const groupOf = new Map<number, number>()
  pg.groups.forEach((gr, gi) => gr.members.forEach((m) => groupOf.set(m, gi)))
  const sel = params.selected
  const selEdges = sel >= 0 && pg.powerEdges[sel] ? expandPowerGraph({ groups: pg.groups, powerEdges: [pg.powerEdges[sel]], residual: [] }) : []
  const selSet = new Set(selEdges.map(([a, b]) => pairKey(a, b)))
  const marked = new Set<number>(linked?.rows ?? [])
  const clip = (a: { x: number; y: number; r: number }, b: { x: number; y: number }): Pt => {
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1
    return [a.x + ((b.x - a.x) / d) * a.r, a.y + ((b.y - a.y) / d) * a.r]
  }
  const ratio = pg.original ? 1 - pg.compressed / pg.original : 0
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Power Graph: 노드 ${n}개, 원본 간선 ${pg.original}개를 power 노드 ${pg.groups.length}개와 연결 ${pg.compressed}개로 표현`} onPointerLeave={hide}>
        {pg.groups.map((gr, gi) => {
          const d = lay.discs[gi]
          return (
            <g key={gi} data-testid="power-node">
              <circle cx={d.x} cy={d.y} r={d.r} fill={color(String(gi))} fillOpacity={0.12} stroke={color(String(gi))} strokeWidth={1.4} strokeDasharray={gr.clique ? '5 3' : undefined} />
              {!compact && gr.clique && <text x={d.x} y={d.y - d.r - 4} textAnchor="middle" className="radar-level">완전 연결 {gr.members.length}</text>}
            </g>
          )
        })}
        {/* original edges restored (every pair the power edges stand for), light */}
        {params.original && !compact && expandPowerGraph(pg).map(([a, b]) => (
          <line key={`o${a}-${b}`} x1={lay.pos[a][0]} y1={lay.pos[a][1]} x2={lay.pos[b][0]} y2={lay.pos[b][1]} stroke="#b0b7bf" strokeWidth={0.8} opacity={selSet.has(pairKey(a, b)) ? 1 : 0.55} data-testid="power-original" />
        ))}
        {pg.residual.map(([a, b]) => <line key={`r${a}-${b}`} x1={lay.pos[a][0]} y1={lay.pos[a][1]} x2={lay.pos[b][0]} y2={lay.pos[b][1]} stroke="#7d8791" strokeWidth={compact ? 0.8 : 1.2} data-testid="power-residual" />)}
        {pg.powerEdges.filter((e) => e.a !== e.b).map((e, k) => {
          const A = lay.discs[e.a], B = lay.discs[e.b]
          const p = clip(A, B), q = clip(B, A)
          const on = sel === pg.powerEdges.indexOf(e)
          return (
            <g key={k} style={{ cursor: compact ? undefined : 'pointer' }} onClick={compact ? undefined : () => setParams({ selected: on ? -1 : pg.powerEdges.indexOf(e) })}
              onPointerEnter={compact ? undefined : (ev) => { const lp = localPoint(svgRef.current!, ev); show(lp.x, lp.y, <><b>power 간선</b><br />{pg.groups[e.a].members.length} × {pg.groups[e.b].members.length} = 원본 간선 {pg.groups[e.a].members.length * pg.groups[e.b].members.length}개를 1개로<br />눌러서 원본 간선 복원</>) }} onPointerLeave={hide}>
              <line x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke="transparent" strokeWidth={12} />
              <line x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={on ? '#111' : ACCENT} strokeWidth={on ? 3.4 : 2.6} data-testid="power-edge" />
            </g>
          )
        })}
        {sel >= 0 && !compact && selEdges.map(([a, b]) => <line key={`s${a}-${b}`} x1={lay.pos[a][0]} y1={lay.pos[a][1]} x2={lay.pos[b][0]} y2={lay.pos[b][1]} stroke="#111" strokeWidth={1} opacity={0.75} data-testid="power-restored" />)}
        {g.net.nodes.map((nd, i) => {
          const hot = nd.rows.some((r) => marked.has(r)) || (g.net.links.some((l) => (l.source === nd.id || l.target === nd.id) && l.rows.some((r) => marked.has(r))))
          return (
            <g key={nd.id} transform={`translate(${lay.pos[i][0]},${lay.pos[i][1]})`} data-testid="power-member"
              onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{nd.id}</b><br />연결 {nd.degree}개{groupOf.has(i) ? ` · power 노드 ${groupOf.get(i)! + 1}` : ''}</>) }} onPointerLeave={hide}>
              <circle r={compact ? 2.6 : 5.5} fill={groupOf.has(i) ? color(String(groupOf.get(i))) : '#fff'} stroke={hot ? '#111' : groupOf.has(i) ? '#fff' : '#7d8791'} strokeWidth={hot ? 2 : 1.2} />
              {!compact && n <= 48 && <text y={-9} textAnchor="middle" className="radar-level" style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}>{nd.id}</text>}
            </g>
          )
        })}
        {!compact && <text x={10} y={16} className="radar-level" data-testid="power-stats">원본 간선 {pg.original}개 → 표현 {pg.compressed}개 (power 간선 {pg.powerEdges.length} + 일반 간선 {pg.residual.length}) · {Math.round(ratio * 100)}% 감소</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function PowerControls({ params, setParams }: ControlsProps<PowerParams>) {
  return (
    <ControlGroup title="압축">
      <Slider label="최소 절감 간선 수 (클수록 큰 구조만 묶음)" value={params.minGain} min={2} max={20} onChange={(minGain) => setParams({ minGain, selected: -1 })} testId="ctl-mingain" />
      <Toggle label="원본 간선 복원 표시" checked={params.original} onChange={(original) => setParams({ original })} testId="ctl-original" />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ selected: -1 })} data-testid="power-clear">선택 해제</button>
      <Hint>서로 같은 이웃을 공유하는 노드를 둥근 power 노드로 묶고, 두 power 노드 사이의 굵은 선 하나가 ‘양쪽 구성원이 모두 연결됨’을 뜻합니다(완전 이분 구조). 점선 원은 구성원이 서로 모두 연결된 완전 그래프(clique)입니다. power 간선을 누르면 그것이 대신하는 원본 간선이 복원됩니다. 이 구현은 power 노드가 서로 겹치거나 포함하지 않는 평평한 형태입니다.</Hint>
    </ControlGroup>
  )
}

export const powerGraphModule: VizModule<PowerParams> = {
  roles: edgeRoles,
  datasets: ['dense-modules', 'net-communities', 'network'],
  defaultParams: { minGain: 3, original: false, selected: -1 },
  Chart: PowerChart,
  Controls: PowerControls,
  hint: '굵은 power 간선을 눌러 원본 간선을 복원 · 최소 절감 값을 올리면 큰 구조만 묶습니다',
}

// ───────────────────────────── Confluent Drawing ─────────────────────────────

export interface ConfluentParams { minGain: number; trunk: number; original: boolean; selected: number }

function ConfluentChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<ConfluentParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const g = useGraph(table, mapping)
  const n = g.net.nodes.length
  const pg = useMemo(() => powerGraph(n, g.edges, params.minGain), [g.edges, n, params.minGain])
  const lay = useMemo(() => (n ? groupLayout(n, pg, width, height, spacingFor(width, height, compact, n)) : null), [pg, n, width, height, compact])
  const tracks = useMemo(() => (lay ? confluentTracks(pg, lay.pos, params.trunk) : []), [pg, lay, params.trunk])
  if (!n || !lay) return <ChartMessage>출발·도착 노드 열을 선택하세요.</ChartMessage>
  const color = categoryColor(tracks.map((_, i) => String(i)))
  const sel = params.selected
  // nodes reached from the selected node through tracks
  const reached = new Set<number>()
  const hotTrack = new Set<number>()
  if (sel >= 0) tracks.forEach((t, k) => {
    if (t.clique ? t.from.includes(sel) : t.from.includes(sel) || t.to.includes(sel)) {
      hotTrack.add(k)
      const others = t.clique ? t.from : t.from.includes(sel) ? t.to : t.from
      others.forEach((o) => reached.add(o))
    }
  })
  g.edges.forEach(([a, b]) => { if (a === sel) reached.add(b); if (b === sel) reached.add(a) })
  const resSet = pg.residual
  const marked = new Set<number>(linked?.rows ?? [])
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Confluent Drawing: 노드 ${n}개, 간선 ${pg.original}개를 합류 경로 ${tracks.length}개와 일반 간선 ${resSet.length}개로 표현`} onPointerLeave={hide}>
        {params.original && !compact && g.edges.map(([a, b]) => <line key={`o${a}-${b}`} x1={lay.pos[a][0]} y1={lay.pos[a][1]} x2={lay.pos[b][0]} y2={lay.pos[b][1]} stroke="#d4d9de" strokeWidth={0.7} data-testid="confluent-original" />)}
        {resSet.map(([a, b]) => <line key={`r${a}-${b}`} x1={lay.pos[a][0]} y1={lay.pos[a][1]} x2={lay.pos[b][0]} y2={lay.pos[b][1]} stroke="#7d8791" strokeWidth={compact ? 0.8 : 1.2} />)}
        {tracks.map((t, k) => {
          const c = color(String(k))
          const dim = sel >= 0 && !hotTrack.has(k)
          const sw = compact ? 0.9 : 1.6
          if (t.clique) {
            const hub = t.junctions[0]
            return (
              <g key={k} opacity={dim ? 0.2 : 1} data-testid="confluent-track">
                {t.from.map((m) => <path key={m} d={`M${lay.pos[m][0]},${lay.pos[m][1]}Q${(lay.pos[m][0] + hub[0]) / 2},${(lay.pos[m][1] + hub[1]) / 2} ${hub[0]},${hub[1]}`} fill="none" stroke={c} strokeWidth={sw} />)}
                <circle cx={hub[0]} cy={hub[1]} r={compact ? 2 : 4} fill={c} />
              </g>
            )
          }
          const [ja, jb] = t.junctions
          const dx = jb[0] - ja[0], dy = jb[1] - ja[1]
          const L = Math.hypot(dx, dy) || 1
          const dir: Pt = [dx / L, dy / L]
          return (
            <g key={k} opacity={dim ? 0.2 : 1} data-testid="confluent-track" style={{ cursor: compact ? undefined : 'default' }}
              onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>합류 경로</b><br />{t.from.length} × {t.to.length} = 간선 {t.from.length * t.to.length}개가 한 줄기를 공유</>) }} onPointerLeave={hide}>
              {t.from.map((m) => <path key={`a${m}`} d={trackCurve(lay.pos[m], ja, dir)} fill="none" stroke={c} strokeWidth={sw} />)}
              {t.to.map((m) => <path key={`b${m}`} d={trackCurve(lay.pos[m], jb, [-dir[0], -dir[1]])} fill="none" stroke={c} strokeWidth={sw} />)}
              <line x1={ja[0]} y1={ja[1]} x2={jb[0]} y2={jb[1]} stroke={c} strokeWidth={compact ? 2 : 3 + Math.min(4, Math.sqrt(t.from.length * t.to.length) / 2)} strokeLinecap="round" data-testid="confluent-trunk" />
            </g>
          )
        })}
        {g.net.nodes.map((nd, i) => {
          const hot = i === sel || reached.has(i) || g.net.links.some((l) => (l.source === nd.id || l.target === nd.id) && l.rows.some((r) => marked.has(r)))
          return (
            <g key={nd.id} transform={`translate(${lay.pos[i][0]},${lay.pos[i][1]})`} data-testid="confluent-node" style={{ cursor: compact ? undefined : 'pointer' }}
              onClick={compact ? undefined : () => setParams({ selected: sel === i ? -1 : i })}
              onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{nd.id}</b><br />연결 {nd.degree}개<br />눌러서 닿는 노드 강조</>) }} onPointerLeave={hide}>
              <circle r={compact ? 2.8 : 6} fill={i === sel ? '#111' : hot ? ACCENT : '#fff'} stroke={hot || i === sel ? '#111' : '#5f6b76'} strokeWidth={1.3} />
              {!compact && n <= 48 && <text y={-10} textAnchor="middle" className="radar-level" style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}>{nd.id}</text>}
            </g>
          )
        })}
        {!compact && <text x={10} y={16} className="radar-level" data-testid="confluent-stats">간선 {pg.original}개 → 합류 경로 {tracks.length}개 + 일반 간선 {resSet.length}개{sel >= 0 ? ` · ${g.net.nodes[sel].id}에서 닿는 노드 ${reached.size}개` : ''}</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function ConfluentControls({ params, setParams }: ControlsProps<ConfluentParams>) {
  return (
    <ControlGroup title="합류 경로">
      <Slider label="최소 절감 간선 수" value={params.minGain} min={2} max={20} onChange={(minGain) => setParams({ minGain, selected: -1 })} testId="ctl-mingain" />
      <Slider label="공유 줄기 길이" value={params.trunk} min={0.1} max={0.6} step={0.05} onChange={(trunk) => setParams({ trunk })} format={(v) => v.toFixed(2)} testId="ctl-trunk" />
      <Toggle label="묶기 전 직선 간선을 연하게 겹쳐 보기" checked={params.original} onChange={(original) => setParams({ original })} testId="ctl-original" />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ selected: -1 })} data-testid="confluent-clear">선택 해제</button>
      <Hint>같은 이웃을 공유하는 노드들이 한 줄기(굵은 선)로 합쳐졌다가 다시 갈라집니다. 부드러운 곡선을 따라가면 실제로 연결된 노드에 도착하므로 연결 관계가 그대로 보존됩니다. 노드를 누르면 그 노드에서 줄기를 거쳐 닿는 노드가 강조됩니다. 줄기 구조는 Power Graph와 같은 평평한 이분·완전그래프 분해에서 얻으며, 모든 그래프를 합류 그림으로 그릴 수 있는 것은 아닙니다.</Hint>
    </ControlGroup>
  )
}

export const confluentModule: VizModule<ConfluentParams> = {
  roles: edgeRoles,
  datasets: ['dense-modules', 'net-communities', 'network'],
  defaultParams: { minGain: 3, trunk: 0.3, original: false, selected: -1 },
  Chart: ConfluentChart,
  Controls: ConfluentControls,
  hint: '노드를 눌러 줄기를 거쳐 닿는 노드를 확인 · 직선 간선과 겹쳐 비교',
}

// ───────────────────────────── NodeTrix ─────────────────────────────

export interface NodeTrixParams { source: 'louvain' | 'group'; cell: number; collapsed: number[]; minSize: number; selected: string }

function NodeTrixChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<NodeTrixParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const g = useGraph(table, mapping)
  const n = g.net.nodes.length
  const model = useMemo(() => {
    if (!n) return null
    let comm: number[]
    const A = adjacency(n, g.edges.map(([a, b]) => ({ a, b, w: 1 })))
    const names = g.net.nodes.map((x) => x.group)
    if (params.source === 'group' && names.some((x) => x)) {
      const ids = [...new Set(names)]
      comm = names.map((x) => ids.indexOf(x))
    } else comm = louvain(A, 7)
    const ids = [...new Set(comm)]
    const groups = ids.map((c) => ({ id: c, members: orderBlock(comm.flatMap((cc, i) => (cc === c ? [i] : [])), g.edges) }))
    const commIdx = new Map(ids.map((c, i) => [c, i]))
    const of = comm.map((c) => commIdx.get(c)!)
    const weight = groups.map(() => groups.map(() => 0))
    for (const [a, b] of g.edges) if (of[a] !== of[b]) { weight[of[a]][of[b]]++; weight[of[b]][of[a]]++ }
    return { groups, of, weight }
  }, [g, n, params.source])
  // the matrices must fit the pane: shrink the cell so the blocks cover at most ~30% of it
  const sumSq = model ? model.groups.reduce((s, gr) => s + (gr.members.length >= params.minSize ? gr.members.length ** 2 : 0), 0) : 1
  const cell = compact ? 6 : Math.max(4, Math.min(params.cell, Math.floor(Math.sqrt((0.3 * width * height) / Math.max(1, sumSq)))))
  const [moved, setMoved] = useState<Record<string, Pt>>({})
  const drag = useRef<{ g: number; dx: number; dy: number } | null>(null)
  const layout = useMemo(() => {
    if (!model) return null
    const asNode = (gi: number) => params.collapsed.includes(gi) || model.groups[gi].members.length < params.minSize
    const sizes = model.groups.map((gr, gi) => (asNode(gi) ? 2 * (Math.sqrt(gr.members.length) * (compact ? 3 : 6) + (compact ? 3 : 7)) : gr.members.length * cell))
    const pos = blockLayout(sizes, model.weight, width, height, 250)
    return { sizes, pos, asNode }
  }, [model, params.collapsed, params.minSize, cell, width, height, compact])
  if (!n || !model || !layout) return <ChartMessage>출발·도착 노드 열을 선택하세요.</ChartMessage>
  const color = categoryColor(model.groups.map((_, i) => String(i)))
  const at = (gi: number): Pt => moved[`${gi}|${model.groups.length}|${n}`] ?? layout.pos[gi]
  const blocks = model.groups.map((gr, gi) => ({ group: gi, members: gr.members, x: at(gi)[0], y: at(gi)[1], size: layout.sizes[gi] }))
  const indexIn = (gi: number, v: number) => model.groups[gi].members.indexOf(v)
  const marked = new Set<number>(linked?.rows ?? [])
  const rowsOf = (a: number, b: number) => g.rowsOf.get(pairKey(a, b)) ?? []
  const endpoint = (v: number, toward: Pt): Pt => {
    const gi = model.of[v]
    const bl = blocks[gi]
    if (layout.asNode(gi)) {
      const d = Math.hypot(toward[0] - bl.x, toward[1] - bl.y) || 1
      return [bl.x + ((toward[0] - bl.x) / d) * (bl.size / 2), bl.y + ((toward[1] - bl.y) / d) * (bl.size / 2)]
    }
    return attachPoint(bl, indexIn(gi, v), bl.members.length, toward)
  }
  const inter = g.edges.filter(([a, b]) => model.of[a] !== model.of[b])
  const onDown = (gi: number, e: PointerEvent<SVGGElement>) => {
    if (compact) return
    const p = localPoint(svgRef.current!, e)
    svgRef.current!.setPointerCapture(e.pointerId)
    drag.current = { g: gi, dx: blocks[gi].x - p.x, dy: blocks[gi].y - p.y }
    hide()
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    const p = localPoint(svgRef.current!, e)
    setMoved((m) => ({ ...m, [`${d.g}|${model.groups.length}|${n}`]: [p.x + d.dx, p.y + d.dy] }))
  }
  const toggleCollapse = (gi: number) => setParams({ collapsed: params.collapsed.includes(gi) ? params.collapsed.filter((x) => x !== gi) : [...params.collapsed, gi] })
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" style={{ touchAction: 'none' }} onPointerMove={onMove} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onPointerLeave={hide}
        aria-label={`NodeTrix: 노드 ${n}개, 공동체 ${model.groups.length}개(행렬 ${model.groups.filter((_, i) => !layout.asNode(i)).length}개), 공동체 사이 간선 ${inter.length}개`}>
        {inter.map(([a, b]) => {
          const ca: Pt = [blocks[model.of[a]].x, blocks[model.of[a]].y], cb: Pt = [blocks[model.of[b]].x, blocks[model.of[b]].y]
          const p = endpoint(a, cb), q = endpoint(b, ca)
          const rows = rowsOf(a, b)
          const hot = rows.some((r) => marked.has(r)) || params.selected === g.net.nodes[a].id || params.selected === g.net.nodes[b].id
          return <line key={`${a}-${b}`} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={hot ? '#111' : '#8d96a0'} strokeWidth={hot ? 1.8 : 0.9} opacity={hot ? 1 : 0.7} data-testid="nodetrix-link" />
        })}
        {blocks.map((bl) => {
          const gi = bl.group
          const members = bl.members
          const x0 = bl.x - bl.size / 2, y0 = bl.y - bl.size / 2
          if (layout.asNode(gi)) {
            return (
              <g key={gi} data-testid="nodetrix-node" style={{ cursor: compact ? undefined : 'grab' }} onPointerDown={(e) => onDown(gi, e)} onDoubleClick={compact ? undefined : () => { if (members.length >= params.minSize) toggleCollapse(gi) }}
                onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>공동체 {gi + 1}</b><br />노드 {members.length}개: {members.slice(0, 6).map((m) => g.net.nodes[m].id).join(', ')}{members.length > 6 ? ' …' : ''}<br />{members.length >= params.minSize ? '두 번 눌러 행렬로 펼치기' : ''}</>) }} onPointerLeave={hide}>
                <circle cx={bl.x} cy={bl.y} r={bl.size / 2} fill={color(String(gi))} fillOpacity={0.28} stroke={color(String(gi))} strokeWidth={1.6} />
                {!compact && <text x={bl.x} y={bl.y} textAnchor="middle" dy="0.34em" className="radar-axis-label" style={{ pointerEvents: 'none' }}>{members.length === 1 ? g.net.nodes[members[0]].id : members.length}</text>}
              </g>
            )
          }
          return (
            <g key={gi} data-testid="nodetrix-matrix">
              <rect x={x0} y={y0} width={bl.size} height={bl.size} fill="#fff" stroke={color(String(gi))} strokeWidth={1.5} />
              {members.map((_, k) => <line key={`h${k}`} x1={x0} x2={x0 + bl.size} y1={y0 + k * cell} y2={y0 + k * cell} stroke="#eef0f2" strokeWidth={0.5} />)}
              {members.flatMap((u, i) => members.map((v, j) => {
                if (u === v) return null
                const key = pairKey(u, v)
                const has = g.rowsOf.has(key)
                if (!has) return null
                const rows = g.rowsOf.get(key)!
                const hot = rows.some((r) => marked.has(r)) || params.selected === `${g.net.nodes[u].id}|${g.net.nodes[v].id}` || params.selected === `${g.net.nodes[v].id}|${g.net.nodes[u].id}`
                return (
                  <rect key={`${i}-${j}`} x={x0 + j * cell + 0.5} y={y0 + i * cell + 0.5} width={cell - 1} height={cell - 1} fill={hot ? '#111' : color(String(gi))} fillOpacity={hot ? 1 : 0.85} data-testid="nodetrix-cell" style={{ cursor: compact ? undefined : 'pointer' }}
                    onClick={compact ? undefined : () => { setParams({ selected: `${g.net.nodes[u].id}|${g.net.nodes[v].id}` }); linked?.set(rows) }}
                    onPointerEnter={compact ? undefined : (e) => { linked?.set(rows); const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{g.net.nodes[u].id} — {g.net.nodes[v].id}</b><br />같은 공동체 안 연결</>) }} onPointerLeave={() => { hide(); linked?.set(null) }} />
                )
              }))}
              {!compact && cell >= 9 && members.map((m, k) => <text key={m} x={x0 - 3} y={y0 + (k + 0.5) * cell} dy="0.34em" textAnchor="end" fontSize={Math.min(10, cell - 1)} fill="#5f6b76" style={{ pointerEvents: 'none' }}>{g.net.nodes[m].id}</text>)}
              {/* header bar: grab to move, double-click to collapse */}
              <g style={{ cursor: compact ? undefined : 'grab' }} onPointerDown={(e) => onDown(gi, e)} onDoubleClick={compact ? undefined : () => toggleCollapse(gi)}
                onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>공동체 {gi + 1}</b> (노드 {members.length}개)<br />끌어서 이동 · 두 번 눌러 접기</>) }} onPointerLeave={hide}>
                <rect x={x0} y={y0 - 9} width={bl.size} height={9} fill={color(String(gi))} fillOpacity={0.8} data-testid="nodetrix-header" />
              </g>
            </g>
          )
        })}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function NodeTrixControls({ params, setParams }: ControlsProps<NodeTrixParams>) {
  return (
    <ControlGroup title="혼합 배치">
      <Segmented label="공동체 기준" value={params.source} onChange={(source) => setParams({ source, collapsed: [] })} options={[{ value: 'louvain', label: '자동 탐지 (루뱅)' }, { value: 'group', label: '그룹 열' }]} testId="ctl-source" />
      <Slider label="칸 크기 (px)" value={params.cell} min={8} max={26} onChange={(cell) => setParams({ cell })} testId="ctl-cell" />
      <Slider label="행렬로 그릴 최소 노드 수" value={params.minSize} min={2} max={8} onChange={(minSize) => setParams({ minSize })} testId="ctl-minsize" />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ collapsed: [], selected: '' })} data-testid="nodetrix-reset">모두 펼치기·선택 해제</button>
      <Hint>밀집한 공동체는 인접 행렬로, 공동체 사이의 연결은 선으로 그립니다. 선은 두 노드의 행(또는 열) 위치에서 행렬 가장자리로 이어집니다. 행렬 머리띠를 끌면 옮기고 두 번 누르면 하나의 노드로 접히며, 접힌 원을 두 번 누르면 다시 펼쳐집니다. 칸을 누르면 그 연결이 강조되고 비교 실험실에서는 다른 그래프에서도 같은 간선이 강조됩니다. 행렬 안 노드 순서는 공동체 안의 연결 수(허브 우선)입니다.</Hint>
    </ControlGroup>
  )
}

export const nodeTrixModule: VizModule<NodeTrixParams> = {
  roles: edgeRoles,
  datasets: ['net-communities', 'dense-modules', 'network'],
  defaultParams: { source: 'louvain', cell: 14, collapsed: [], minSize: 3, selected: '' },
  Chart: NodeTrixChart,
  Controls: NodeTrixControls,
  hint: '머리띠를 끌어 행렬 이동 · 두 번 눌러 접기/펼치기 · 칸을 눌러 연결 선택',
}
