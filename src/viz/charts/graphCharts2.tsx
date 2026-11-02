import * as d3 from 'd3'
import { useMemo, type ReactNode } from 'react'
import { ChartMessage } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import type { DataTable } from '../../data/table'
import { colorAt } from '../../lib/colors'
import { fmt } from '../../lib/format'
import {
  adjacency, adjustedRand, blockDensity, criticalPath, dagLayout, degrees, flowAfterSteps, laplacianSpectrum, louvain, maxFlow, modularity, richClubNormalised,
  type DagLayout, type Edge, type FlowEdge, type LaplacianKind,
} from '../../stats/graph2'
import type { ChartProps, ControlsProps, Mapping, RoleSpec, VizModule } from '../types'
import { Panels, Stage, XYPlot, HeatGrid, useStage, type Layer } from './kit'
import { edgeRoles, edgeRows } from './networkShared'

/** Graph charts: spectral embedding, layered DAG drawing with critical path, maximum flow, rich-club coefficient and a community blockmodel. */

interface G { names: string[]; edges: Edge[]; group: string[]; directed: [number, number, number][] }

/** Nodes and edges from the edge-list roles. `edges` merges parallel edges of the undirected view; `directed` keeps each listed direction (first duration wins). */
function graphOf(table: DataTable, mapping: Mapping): G {
  const rows = edgeRows(table, mapping)
  const index = new Map<string, number>(), names: string[] = [], group: string[] = []
  const node = (s: string, g: string) => { let i = index.get(s); if (i == null) { i = names.length; index.set(s, i); names.push(s); group.push(g) } else if (!group[i] && g) group[i] = g; return i }
  const und = new Map<string, Edge>(), dir = new Map<string, [number, number, number]>()
  for (const r of rows) {
    if (!r.source) continue
    const a = node(r.source, r.group)
    if (!r.target) continue
    const b = node(r.target, '')
    const w = r.weight ?? 1
    if (a === b || !(w > 0)) continue
    const k = a < b ? `${a}-${b}` : `${b}-${a}`
    const e = und.get(k)
    if (e) e.w += w; else und.set(k, { a: Math.min(a, b), b: Math.max(a, b), w })
    if (!dir.has(`${a}>${b}`)) dir.set(`${a}>${b}`, [a, b, w])
  }
  return { names, edges: [...und.values()], group, directed: [...dir.values()] }
}

const undirectedRoles: RoleSpec[] = edgeRoles
const needGraph = <ChartMessage>출발·도착 노드 열을 고르세요. 노드가 3개 이상, 간선이 2개 이상 필요합니다.</ChartMessage>

const textWidth = (s: string, font: number) => [...s].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? font : font * 0.58), 0)
function fitText(s: string, maxW: number, font: number) {
  if (textWidth(s, font) <= maxW) return s
  let out = s
  while (out.length > 1 && textWidth(`${out}…`, font) > maxW) out = out.slice(0, -1)
  return `${out}…`
}

// ─── spectral embedding ─────────────────────────────────────────────────────────────

export interface SpectralParams { kind: LaplacianKind; xi: number; yi: number; color: 'group' | 'louvain' | 'none'; edges: boolean; labels: boolean }


function SpectralChart({ table, mapping, params, width, height, compact }: ChartProps<SpectralParams>) {
  const g = useMemo(() => graphOf(table, mapping), [table, mapping])
  const model = useMemo(() => {
    const n = g.names.length
    if (n < 3 || n > 160 || g.edges.length < 2) return null
    const A = adjacency(n, g.edges)
    return { A, spec: laplacianSpectrum(A, params.kind), comm: louvain(A, 1) }
  }, [g, params.kind])
  if (!model) return g.names.length > 160 ? <ChartMessage>노드가 160개를 넘으면 고유값 분해가 느려 이 화면에서는 계산하지 않습니다.</ChartMessage> : needGraph
  const { spec, comm } = model
  const n = g.names.length
  const xi = Math.max(1, Math.min(n - 1, params.xi)), yi = Math.max(1, Math.min(n - 1, params.yi))
  const hasGroup = new Set(g.group.filter(Boolean)).size >= 2
  const by = params.color === 'group' && hasGroup ? 'group' : params.color === 'none' ? 'none' : 'louvain'
  const cls = g.names.map((_, i) => (by === 'group' ? g.group[i] || '기타' : by === 'louvain' ? `군집 ${comm[i] + 1}` : '노드'))
  const classes = [...new Set(cls)]
  const m = Math.min(10, n - 1)
  let kBest = 2, gapBest = -1
  for (let k = 2; k <= m; k++) { const gap = spec.values[k] - spec.values[k - 1]; if (gap > gapBest) { gapBest = gap; kBest = k } }
  const zero = spec.values.filter((v) => Math.abs(v) < 1e-8).length
  const vx = spec.vectors[xi], vy = spec.vectors[yi]
  const layers: Layer[] = classes.map((c, k) => ({
    kind: 'points', color: by === 'none' ? '#2a8c82' : colorAt(k), r: compact ? 3 : 6, stroke: '#fff', label: by === 'none' ? undefined : c,
    pts: g.names.map((nm, i) => ({ nm, i })).filter(({ i }) => cls[i] === c).map(({ nm, i }) => ({ x: vx[i], y: vy[i], key: nm, tip: <><b>{nm}</b><br />{c}<br />v{xi + 1} = {fmt(vx[i], 3)}, v{yi + 1} = {fmt(vy[i], 3)}</> })),
  }))
  if (params.labels && !compact && n <= 60) g.names.forEach((nm, i) => layers.push({ kind: 'text', x: vx[i], y: vy[i], text: nm, size: 9.5, color: '#4b5563', anchor: 'start' }))
  const embed = (h: number) => (
    <XYPlot hover={false} layers={layers} width={width} height={h} compact={compact} xLabel={`고유벡터 v${xi + 1} (λ = ${fmt(spec.values[xi], 3)})`} yLabel={`고유벡터 v${yi + 1} (λ = ${fmt(spec.values[yi], 3)})`} title={`스펙트럼 임베딩: 노드 ${n}개`} legend={by !== 'none'}
      extra={params.edges && g.edges.length <= 700 ? ({ x, y }) => <g stroke="#9aa1a9" strokeOpacity={0.28} strokeWidth={0.8}>{g.edges.map((e, k) => <line key={k} x1={x(vx[e.a])} y1={y(vy[e.a])} x2={x(vx[e.b])} y2={y(vy[e.b])} />)}</g> : undefined}
      readout={[{ label: '0 고유값(연결 성분)', value: String(zero) }, { label: '고유값 간격이 가장 큰 k', value: String(kBest) }, { label: 'λ₂ (대수적 연결도)', value: fmt(spec.values[1], 4) }]}
      note="고유벡터의 부호는 임의입니다(−v도 같은 고유벡터)" />
  )
  if (compact) return embed(height)
  const sp = (h: number) => (
    <XYPlot hover={false} width={width} height={h} title="라플라시안 고유값 스펙트럼" xLabel="고유값 번호 k" yLabel="λₖ" xTicks={Math.min(10, m + 1)}
      layers={[
        { kind: 'stem', x: Array.from({ length: m + 1 }, (_, k) => k + 1), y: spec.values.slice(0, m + 1), color: '#9aa1a9', dot: true },
        { kind: 'points', color: '#e07a3f', r: 6, stroke: '#fff', label: '선택한 두 고유벡터', pts: [xi, yi].map((k) => ({ x: k + 1, y: spec.values[k] })) },
        { kind: 'vline', v: kBest + 0.5, color: '#4c6fb5', dash: '5 4', label: `고유값 간격 → k = ${kBest}` },
      ]} />
  )
  return <Panels width={width} height={height} parts={[2, 1]}>{[embed, sp]}</Panels>
}

function SpectralControls({ params, setParams }: ControlsProps<SpectralParams>) {
  return (
    <ControlGroup title="스펙트럼 임베딩">
      <Select label="라플라시안" value={params.kind} onChange={(kind) => setParams({ kind })} testId="ctl-laplacian" options={[{ value: 'symmetric', label: '대칭 정규화 L_sym' }, { value: 'randomwalk', label: '확률보행 L_rw' }, { value: 'combinatorial', label: '조합 L = D − A' }]} />
      <Slider label="가로축 고유벡터 번호 (1 = 상수 벡터)" value={params.xi + 1} min={2} max={11} onChange={(v) => setParams({ xi: v - 1 })} testId="ctl-xi" />
      <Slider label="세로축 고유벡터 번호" value={params.yi + 1} min={2} max={11} onChange={(v) => setParams({ yi: v - 1 })} testId="ctl-yi" />
      <Segmented label="색" value={params.color} onChange={(color) => setParams({ color })} testId="ctl-color" options={[{ value: 'group', label: '표의 그룹' }, { value: 'louvain', label: '탐지한 군집' }, { value: 'none', label: '없음' }]} />
      <Toggle label="간선 표시" checked={params.edges} onChange={(edges) => setParams({ edges })} />
      <Toggle label="노드 이름 표시" checked={params.labels} onChange={(labels) => setParams({ labels })} />
      <Hint>그래프 라플라시안 L의 고유벡터를 노드 좌표로 씁니다. 가장 작은 고유값 0의 고유벡터는 (연결 성분마다) 상수라 정보가 없고, 다음 고유벡터(피들러 벡터)부터 군집 구조가 드러납니다. 군집이 k개이면 작은 고유값 k개가 거의 0이고 그 뒤에 큰 간격이 생기므로 아래 스펙트럼의 가장 큰 간격으로 k를 추정합니다. 정규화 라플라시안은 차수가 다른 노드를 공정하게 다루며(L_sym과 L_rw는 같은 고유값을 가집니다), 노드 좌표의 부호는 임의입니다.</Hint>
    </ControlGroup>
  )
}

export const spectralModule: VizModule<SpectralParams> = {
  roles: undirectedRoles, datasets: ['net-communities'], defaultParams: { kind: 'symmetric', xi: 1, yi: 2, color: 'group', edges: true, labels: false },
  Chart: SpectralChart, Controls: SpectralControls, hint: '같은 군집의 노드가 한 점 근처로 모입니다 · 두 번째·세 번째 고유벡터를 바꿔 보세요 · 아래 스펙트럼의 큰 간격이 군집 수입니다',
}

// ─── layered graph drawing (shared by the DAG and flow charts) ──────────────────────

export interface LEdge { a: number; b: number; color: string; width: number; dash?: string; label?: string; halo?: string; tip?: ReactNode }

export function LayeredGraph({ width, height, compact, names, layout, orient, edges, fill, stroke, strokeW, nodeTip, label, readout, note }: {
  width: number; height: number; compact?: boolean; names: string[]; layout: DagLayout; orient: 'LR' | 'TB'; edges: LEdge[]
  fill: (i: number) => string; stroke: (i: number) => string; strokeW: (i: number) => number; nodeTip: (i: number) => ReactNode; label: string
  readout?: { label: string; value: ReactNode }[]; note?: ReactNode
}) {
  const stage = useStage()
  const font = compact ? 7 : 11.5, bh = compact ? 8 : 24, M = compact ? 6 : 20
  const depth = layout.layers.length, maxSize = Math.max(1, ...layout.layers.map((l) => l.length))
  let bw = compact ? 14 : Math.max(34, Math.min(orient === 'TB' ? 168 : 118, Math.max(...names.map((s) => textWidth(s, font))) + 14))
  bw = orient === 'LR' ? Math.min(bw, Math.max(30, (width - 2 * M) / depth - (compact ? 4 : 24))) : Math.min(bw, Math.max(30, (width - 2 * M) / maxSize - 8))
  const P = names.map((_, v) => {
    const l = layout.layer[v], c = layout.x[v]
    if (orient === 'LR') {
      const dx = depth > 1 ? (width - 2 * M - bw) / (depth - 1) : 0, dy = maxSize > 1 ? Math.min(bh + 24, (height - 2 * M - bh) / (maxSize - 1)) : 0
      return { x: M + bw / 2 + l * dx, y: height / 2 + c * dy }
    }
    const dy = depth > 1 ? Math.min(96, (height - 2 * M - bh) / (depth - 1)) : 0, dx = maxSize > 1 ? Math.min(bw + 18, (width - 2 * M - bw) / (maxSize - 1)) : 0
    return { x: width / 2 + c * dx, y: M + bh / 2 + l * dy + (depth > 1 ? Math.max(0, (height - 2 * M - bh - dy * (depth - 1)) / 2) : 0) }
  })
  const pair = new Set(edges.map((e) => `${e.a}>${e.b}`))
  const colors = [...new Set(edges.map((e) => e.color))]
  const geo = (e: LEdge) => {
    const u = P[e.a], v = P[e.b], back = layout.layer[e.a] > layout.layer[e.b], off = pair.has(`${e.b}>${e.a}`) ? (e.a < e.b ? -6 : 6) : 0
    if (layout.layer[e.a] === layout.layer[e.b]) {
      if (orient === 'LR') { const s = v.y > u.y ? 1 : -1, sx = u.x + off, sy = u.y + (s * bh) / 2, ex = v.x + off, ey = v.y - (s * bh) / 2; return { d: `M${sx},${sy} L${ex},${ey}`, mx: (sx + ex) / 2, my: (sy + ey) / 2 } }
      const s = v.x > u.x ? 1 : -1, sx = u.x + (s * bw) / 2, sy = u.y + off, ex = v.x - (s * bw) / 2, ey = v.y + off
      return { d: `M${sx},${sy} L${ex},${ey}`, mx: (sx + ex) / 2, my: (sy + ey) / 2 }
    }
    if (orient === 'LR') {
      const sx = u.x + (back ? -1 : 1) * (bw / 2), ex = v.x + (back ? 1 : -1) * (bw / 2), sy = u.y + off, ey = v.y + off, c = (sx + ex) / 2
      return { d: `M${sx},${sy} C${c},${sy} ${c},${ey} ${ex},${ey}`, mx: (sx + ex) / 2, my: (sy + ey) / 2 }
    }
    const sy = u.y + (back ? -1 : 1) * (bh / 2), ey = v.y + (back ? 1 : -1) * (bh / 2), sx = u.x + off, ex = v.x + off, c = (sy + ey) / 2
    return { d: `M${sx},${sy} C${sx},${c} ${ex},${c} ${ex},${ey}`, mx: (sx + ex) / 2, my: (sy + ey) / 2 }
  }
  return (
    <Stage stage={stage} width={width} height={height} label={label} readout={readout} note={note} compact={compact}>
      <defs>{colors.map((c) => <marker key={c} id={`arw-${c.slice(1)}`} markerWidth={compact ? 5 : 8} markerHeight={compact ? 5 : 8} refX={compact ? 4.5 : 7.4} refY={compact ? 2.5 : 4} orient="auto" markerUnits="userSpaceOnUse"><path d={compact ? 'M0,0 L5,2.5 L0,5 z' : 'M0,0 L8,4 L0,8 z'} fill={c} /></marker>)}</defs>
      {edges.map((e, k) => {
        const { d, mx, my } = geo(e)
        return (
          <g key={k} data-testid="layer-edge">
            {e.halo && <path d={d} fill="none" stroke={e.halo} strokeOpacity={0.35} strokeWidth={e.width + 6} />}
            <path d={d} fill="none" stroke={e.color} strokeWidth={compact ? Math.min(e.width, 1.4) : e.width} strokeDasharray={e.dash} strokeOpacity={0.9} markerEnd={`url(#arw-${e.color.slice(1)})`} />
            {!compact && <path d={d} fill="none" stroke="transparent" strokeWidth={12} onPointerEnter={(ev) => stage.at(ev, e.tip ?? <><b>{names[e.a]} → {names[e.b]}</b></>)} />}
            {!compact && e.label && <text x={mx} y={my} dy="0.34em" textAnchor="middle" fontSize={10} fill="#374151" stroke="#fff" strokeWidth={3} paintOrder="stroke" pointerEvents="none">{e.label}</text>}
          </g>
        )
      })}
      {names.map((nm, v) => (
        <g key={v} data-testid="layer-node" transform={`translate(${P[v].x - bw / 2},${P[v].y - bh / 2})`} onPointerEnter={compact ? undefined : (ev) => stage.at(ev, nodeTip(v))}>
          <rect width={bw} height={bh} rx={5} fill={fill(v)} stroke={stroke(v)} strokeWidth={strokeW(v)} />
          {!compact && <text x={bw / 2} y={bh / 2} dy="0.34em" textAnchor="middle" fontSize={font} fill="#111827" pointerEvents="none">{fitText(nm, bw - 8, font)}</text>}
        </g>
      ))}
    </Stage>
  )
}

// ─── layered DAG with the critical path ─────────────────────────────────────────────

export interface DagParams { orient: 'LR' | 'TB'; sweeps: number; critical: boolean; labels: boolean }

const dagRoles: RoleSpec[] = [
  edgeRoles[0], { ...edgeRoles[1], label: '후행 노드' },
  { key: 'weight', label: '선행 작업 기간 (선택, 비우면 1)', type: 'number', auto: true, prefer: '기간|duration|시간|일|weight|가중' },
  edgeRoles[3],
]

function DagChart({ table, mapping, params, width, height, compact }: ChartProps<DagParams>) {
  const g = useMemo(() => graphOf(table, mapping), [table, mapping])
  const model = useMemo(() => {
    const n = g.names.length
    if (n < 2 || g.directed.length < 1 || n > 120) return null
    const L = dagLayout(n, g.directed.map(([a, b]) => [a, b] as [number, number]), params.sweeps)
    const flipped = new Set(L.reversed.map(([a, b]) => `${a}>${b}`))
    const fwd = g.directed.map(([a, b, w]) => (flipped.has(`${a}>${b}`) ? ([b, a, w] as [number, number, number]) : ([a, b, w] as [number, number, number])))
    return { L, flipped, cpm: criticalPath(n, fwd) }
  }, [g, params.sweeps])
  if (!model) return <ChartMessage>출발·후행 노드 열을 고르세요. 노드 2~120개와 간선 1개 이상이 필요합니다.</ChartMessage>
  const { L, flipped, cpm } = model
  const groups = [...new Set(g.group.filter(Boolean))]
  const crit = (i: number) => params.critical && !!cpm && Math.abs(cpm.slack[i]) < 1e-9
  const edges: LEdge[] = g.directed.map(([a, b, w]) => {
    const rev = flipped.has(`${a}>${b}`)
    const u = rev ? b : a, v = rev ? a : b
    const tight = params.critical && !!cpm && !rev && Math.abs(cpm.slack[u]) < 1e-9 && Math.abs(cpm.slack[v]) < 1e-9 && Math.abs(cpm.es[u] + w - cpm.es[v]) < 1e-9
    return { a, b, color: rev ? '#d64550' : tight ? '#e07a3f' : '#9aa1a9', width: tight ? 3.2 : 1.6, dash: rev ? '5 4' : undefined, label: params.labels && !compact ? fmt(w, 3) : undefined, halo: tight ? '#e07a3f' : undefined,
      tip: <><b>{g.names[a]} → {g.names[b]}</b>{rev ? <><br />순환을 끊으려고 방향을 뒤집어 배치한 간선</> : null}<br />{fmt(w, 3)}{tight ? <><br />임계 경로</> : null}</> }
  })
  return (
    <LayeredGraph width={width} height={height} compact={compact} names={g.names} layout={L} orient={params.orient} edges={edges} label={`층별 방향 그래프: 노드 ${g.names.length}개, 간선 ${g.directed.length}개`}
      fill={(i) => (groups.length ? `${d3.color(colorAt(groups.indexOf(g.group[i])))?.copy({ opacity: 0.22 }) ?? '#e5e7eb'}` : '#eef2f6')} stroke={(i) => (crit(i) ? '#e07a3f' : groups.length ? colorAt(groups.indexOf(g.group[i])) : '#9aa1a9')} strokeW={(i) => (crit(i) ? 2.6 : 1.3)}
      nodeTip={(i) => <><b>{g.names[i]}</b><br />층 {L.layer[i] + 1}{g.group[i] ? ` · ${g.group[i]}` : ''}{cpm ? <><br />가장 이른 시작 {fmt(cpm.es[i], 3)} · 여유 {fmt(cpm.slack[i], 3)}</> : null}</>}
      readout={[{ label: '층 수', value: String(L.layers.length) }, { label: '간선 교차(층 사이 쌍)', value: String(L.crossings) }, { label: '순환을 끊은 간선', value: String(L.reversed.length) }, ...(cpm ? [{ label: '전체 기간(임계 경로 길이)', value: fmt(cpm.length, 4) }] : [])]}
      note={L.reversed.length ? '붉은 점선: 순환을 끊으려고 뒤집은 간선' : params.critical ? '주황: 여유 0인 임계 경로' : undefined} />
  )
}

function DagControls({ params, setParams }: ControlsProps<DagParams>) {
  return (
    <ControlGroup title="층별 배치">
      <Segmented label="방향" value={params.orient} onChange={(orient) => setParams({ orient })} testId="ctl-orient" options={[{ value: 'LR', label: '왼쪽 → 오른쪽' }, { value: 'TB', label: '위 → 아래' }]} />
      <Slider label="교차 줄이기 반복(무게중심 훑기)" value={params.sweeps} min={0} max={24} onChange={(sweeps) => setParams({ sweeps })} testId="ctl-sweeps" />
      <Toggle label="임계 경로 강조" checked={params.critical} onChange={(critical) => setParams({ critical })} />
      <Toggle label="기간 값 표시" checked={params.labels} onChange={(labels) => setParams({ labels })} />
      <Hint>스기야마 방식의 층별 배치입니다. ① 깊이 우선 탐색으로 순환을 만드는 간선을 찾아 뒤집고 ② 가장 긴 경로로 각 노드의 층을 정하고 ③ 층 안의 순서를 이웃 노드 위치의 평균(무게중심)으로 위·아래로 번갈아 정렬하며 교차를 줄입니다. 임계 경로법(CPM)은 가장 이른 시작 ES와 가장 늦은 시작 LS를 구해 여유 LS − ES가 0인 작업의 사슬을 찾습니다. 간선 값은 앞 작업의 기간입니다.</Hint>
    </ControlGroup>
  )
}

export const dagModule: VizModule<DagParams> = {
  roles: dagRoles, datasets: ['dag-release'], defaultParams: { orient: 'LR', sweeps: 8, critical: true, labels: false },
  Chart: DagChart, Controls: DagControls, hint: '선행 관계를 왼쪽에서 오른쪽 층으로 정렬합니다 · 표에 되돌아가는 간선을 넣으면 붉은 점선으로 표시합니다 · 주황 경로는 여유가 없는 작업의 사슬입니다',
}

// ─── maximum flow ───────────────────────────────────────────────────────────────────

export interface FlowParams { src: string; dst: string; step: number; cut: boolean; labels: boolean }

const flowRoles: RoleSpec[] = [
  { key: 'source', label: '출발 노드', type: 'category', required: true },
  { key: 'target', label: '도착 노드', type: 'category', required: true },
  { key: 'weight', label: '용량', type: 'number', required: true, prefer: '용량|capacity|cap' },
]

function flowSetup(table: DataTable, mapping: Mapping, src: string, dst: string) {
  const g = graphOf(table, mapping)
  const n = g.names.length
  if (n < 2 || g.directed.length < 1 || n > 80) return null
  const fe: FlowEdge[] = g.directed.map(([from, to, cap]) => ({ from, to, cap }))
  const hasIn = new Set(fe.map((e) => e.to)), hasOut = new Set(fe.map((e) => e.from))
  const nameIdx = (s: string) => g.names.indexOf(s)
  let s = nameIdx(src), t = nameIdx(dst)
  if (s < 0) s = g.names.findIndex((_, i) => !hasIn.has(i) && hasOut.has(i))
  if (t < 0) t = g.names.map((_, i) => i).reverse().find((i) => !hasOut.has(i) && hasIn.has(i)) ?? -1
  if (s < 0 || t < 0 || s === t) return { g, fe, s: Math.max(0, s), t: Math.max(0, t), res: null }
  return { g, fe, s, t, res: maxFlow(n, fe, s, t) }
}

function FlowChart({ table, mapping, params, width, height, compact }: ChartProps<FlowParams>) {
  const m = useMemo(() => flowSetup(table, mapping, params.src, params.dst), [table, mapping, params.src, params.dst])
  const layout = useMemo(() => {
    if (!m) return null
    const n = m.g.names.length, adj = Array.from({ length: n }, () => [] as number[])
    for (const e of m.fe) adj[e.from].push(e.to)
    // layers = hop distance from the source; the sink gets the last layer, nodes the source cannot reach sit in layer 1
    const hop = new Array<number>(n).fill(-1)
    hop[m.s] = 0
    const q = [m.s]
    while (q.length) { const u = q.shift()!; for (const v of adj[u]) if (hop[v] < 0) { hop[v] = hop[u] + 1; q.push(v) } }
    const others = hop.filter((h, i) => h >= 0 && i !== m.t)
    const last = Math.max(1, ...others) + 1
    const layer = hop.map((h, i) => (i === m.t ? last : h < 0 ? 1 : h))
    return dagLayout(n, m.fe.map((e) => [e.from, e.to] as [number, number]), 8, layer)
  }, [m])
  if (!m || !layout) return <ChartMessage>출발·도착 노드와 용량 열을 고르세요. 노드 2~80개가 필요합니다.</ChartMessage>
  if (!m.res) return <ChartMessage>출발 노드와 도착 노드를 서로 다르게 정하세요(자동으로 정할 수 없는 그래프입니다).</ChartMessage>
  const { g, fe, s, t, res } = m
  const K = res.steps.length, k = Math.max(0, Math.min(K, params.step))
  const now = flowAfterSteps(g.names.length, fe, s, t, k)
  const last = k > 0 ? res.steps[k - 1] : null
  const onPath = new Set<string>()
  if (last) for (let i = 0; i + 1 < last.path.length; i++) { onPath.add(`${last.path[i]}>${last.path[i + 1]}`); onPath.add(`${last.path[i + 1]}>${last.path[i]}`) }
  const final = k === K
  const showCut = params.cut && final
  const cutSet = new Set(res.cutEdges)
  const edges: LEdge[] = fe.map((e, i) => {
    const f = now.flows[i], full = f >= e.cap - 1e-9
    const cutE = showCut && cutSet.has(i)
    return { a: e.from, b: e.to, color: cutE ? '#d64550' : full ? '#e07a3f' : f > 1e-9 ? '#2a8c82' : '#9aa1a9', width: 1.2 + (5 * e.cap) / Math.max(...fe.map((x) => x.cap)), dash: cutE ? '6 4' : undefined,
      label: params.labels && !compact ? `${fmt(f, 3)}/${fmt(e.cap, 3)}` : undefined, halo: onPath.has(`${e.from}>${e.to}`) ? '#4c6fb5' : undefined,
      tip: <><b>{g.names[e.from]} → {g.names[e.to]}</b><br />유량 {fmt(f, 4)} / 용량 {fmt(e.cap, 4)}{full ? <><br />포화(가득 참)</> : null}{cutE ? <><br />최소 절단 간선</> : null}</> }
  })
  const cutCap = res.cutEdges.reduce((a, i) => a + fe[i].cap, 0)
  return (
    <LayeredGraph width={width} height={height} compact={compact} names={g.names} layout={layout} orient="LR" edges={edges} label={`최대 유량 ${fmt(res.value, 4)}: 노드 ${g.names.length}개`}
      fill={(i) => (i === s ? '#cfe9e5' : i === t ? '#fbe3d3' : showCut ? (res.cutSide[i] ? '#e3f2ef' : '#f1f3f5') : '#f6f7f9')} stroke={(i) => (i === s ? '#2a8c82' : i === t ? '#e07a3f' : '#9aa1a9')} strokeW={(i) => (i === s || i === t ? 2.2 : 1.2)}
      nodeTip={(i) => <><b>{g.names[i]}</b>{i === s ? ' (출발)' : i === t ? ' (도착)' : ''}<br />내보내는 유량 {fmt(fe.reduce((a, e, j) => a + (e.from === i ? now.flows[j] : 0), 0), 4)}<br />들어오는 유량 {fmt(fe.reduce((a, e, j) => a + (e.to === i ? now.flows[j] : 0), 0), 4)}</>}
      readout={[{ label: `증가 경로 ${k}/${K}회 뒤 유량`, value: fmt(now.value, 4) }, { label: '최대 유량', value: fmt(res.value, 4) }, { label: '최소 절단 용량', value: fmt(cutCap, 4) }, ...(last ? [{ label: '이번 경로(여유 용량)', value: `${last.path.map((p) => g.names[p]).join('→')} (${fmt(last.bottleneck, 3)})` }] : [])]}
      note={final && params.cut ? '붉은 점선: 최소 절단 · 연한 청록: 출발 쪽' : '파란 후광: 이번에 늘린 경로'} />
  )
}

function FlowControls({ params, setParams, table, mapping }: ControlsProps<FlowParams>) {
  const m = useMemo(() => flowSetup(table, mapping, params.src, params.dst), [table, mapping, params.src, params.dst])
  const names = m?.g.names ?? []
  const K = m?.res?.steps.length ?? 0
  return (
    <ControlGroup title="최대 유량 (에드먼즈–카프)">
      {names.length > 1 && <Select label="출발(공급원)" value={names[m!.s]} onChange={(src) => setParams({ src })} testId="ctl-src" options={names.map((v) => ({ value: v, label: v }))} />}
      {names.length > 1 && <Select label="도착(수요처)" value={names[m!.t]} onChange={(dst) => setParams({ dst })} testId="ctl-dst" options={names.map((v) => ({ value: v, label: v }))} />}
      <Slider label={`증가 경로 단계 (전체 ${K}회)`} value={Math.min(params.step, K)} min={0} max={Math.max(1, K)} onChange={(step) => setParams({ step })} testId="ctl-step" />
      <Toggle label="최소 절단 표시(마지막 단계)" checked={params.cut} onChange={(cut) => setParams({ cut })} />
      <Toggle label="유량/용량 값 표시" checked={params.labels} onChange={(labels) => setParams({ labels })} />
      <Hint>에드먼즈–카프 알고리즘은 남은 용량(잔여 그래프)에서 간선 수가 가장 적은 경로를 너비 우선 탐색으로 찾아 그 경로의 최소 여유만큼 유량을 밀어 넣기를 더 찾을 수 없을 때까지 반복합니다. 이미 흘린 유량을 되돌리는 역방향 간선 덕분에 앞선 선택을 고칠 수 있습니다. 끝났을 때 출발점에서 잔여 용량으로 닿는 노드의 집합과 나머지 사이를 지나는 간선들이 최소 절단이며, 그 용량의 합은 최대 유량과 같습니다(최대 유량–최소 절단 정리).</Hint>
    </ControlGroup>
  )
}

export const flowModule: VizModule<FlowParams> = {
  roles: flowRoles, datasets: ['flow-supply', 'flow-grid'], defaultParams: { src: '', dst: '', step: 999, cut: true, labels: true },
  Chart: FlowChart, Controls: FlowControls, hint: '슬라이더로 증가 경로를 하나씩 따라가 보세요 · 마지막에 붉은 점선이 병목(최소 절단)입니다 · 용량을 줄이면 병목이 옮겨 갑니다',
}

// ─── rich club ──────────────────────────────────────────────────────────────────────

export interface RichClubParams { samples: number; seed: number; minNodes: number; random: boolean }

function RichClubChart({ table, mapping, params, width, height, compact }: ChartProps<RichClubParams>) {
  const g = useMemo(() => graphOf(table, mapping), [table, mapping])
  const rc = useMemo(() => (g.names.length >= 5 && g.edges.length >= 5 && g.names.length <= 400 ? richClubNormalised(g.names.length, g.edges, params.samples, params.seed) : null), [g, params.samples, params.seed])
  if (!rc) return needGraph
  const shown = rc.filter((p) => p.nodes >= params.minNodes && Number.isFinite(p.phi))
  if (shown.length < 2) return <ChartMessage>차수가 큰 노드가 너무 적습니다. 노드 수 하한을 낮추세요.</ChartMessage>
  const ks = shown.map((p) => p.k)
  const deg = degrees(g.names.length, g.edges)
  const ratios = shown.filter((p) => Number.isFinite(p.ratio))
  const peak = ratios.reduce((b, p) => (p.ratio > b.ratio ? p : b), ratios[0] ?? shown[0])
  const top = (h: number) => (
    <XYPlot hover width={width} height={h} compact={compact} title="부자 클럽 계수 φ(k)" xLabel="차수 기준 k (차수가 k보다 큰 노드만)" yLabel="φ(k)" xTicks={8}
      layers={[
        ...(params.random ? [{ kind: 'line', x: ks, y: shown.map((p) => p.random), color: '#9aa1a9', dash: '6 4', width: 2, label: `차수 보존 무작위 평균(${params.samples}회)` } as Layer] : []),
        { kind: 'line', x: ks, y: shown.map((p) => p.phi), color: '#2a8c82', width: 2.6, label: '관측 φ(k)' },
        { kind: 'points', color: '#2a8c82', r: 3, pts: shown.map((p) => ({ x: p.k, y: p.phi, key: String(p.k), tip: <><b>k = {p.k}</b><br />노드 {p.nodes}개 · 간선 {p.edges}개<br />φ = {fmt(p.phi, 3)}{Number.isFinite(p.random) ? <> · 무작위 {fmt(p.random, 3)}</> : null}</> })) },
      ]}
      readout={[{ label: '노드 / 간선', value: `${g.names.length} / ${g.edges.length}` }, { label: '최대 차수', value: String(Math.max(...deg)) }, ...(peak && Number.isFinite(peak.ratio) ? [{ label: '최대 정규화 계수', value: `${fmt(peak.ratio, 3)} (k = ${peak.k})` }] : [])]} />
  )
  if (compact) return top(height)
  const bottom = (h: number) => (
    <XYPlot hover width={width} height={h} title="정규화한 부자 클럽 계수 ρ(k) = φ(k) / φ_무작위(k)" xLabel="차수 기준 k" yLabel="ρ(k)" xTicks={8}
      layers={[
        { kind: 'hline', v: 1, color: '#9aa1a9', dash: '5 4', label: '무작위와 같음 (ρ = 1)' },
        { kind: 'line', x: ratios.map((p) => p.k), y: ratios.map((p) => p.ratio), color: '#e07a3f', width: 2.6, label: 'ρ(k)' },
        { kind: 'points', color: '#e07a3f', r: 3, pts: ratios.map((p) => ({ x: p.k, y: p.ratio, key: String(p.k), tip: <><b>k = {p.k}</b><br />ρ = {fmt(p.ratio, 3)}<br />노드 {p.nodes}개</> })) },
      ]}
      note="ρ > 1이면 허브끼리 우연보다 더 촘촘히 연결(부자 클럽)" />
  )
  return <Panels width={width} height={height} parts={[1, 1]}>{[top, bottom]}</Panels>
}

function RichClubControls({ params, setParams }: ControlsProps<RichClubParams>) {
  return (
    <ControlGroup title="부자 클럽 계수">
      <Slider label="무작위 그래프 개수" value={params.samples} min={3} max={60} onChange={(samples) => setParams({ samples })} testId="ctl-samples" />
      <Slider label="무작위 시드" value={params.seed} min={1} max={50} onChange={(seed) => setParams({ seed })} testId="ctl-seed" />
      <Slider label="노드 수 하한 (이보다 적게 남는 k는 숨김)" value={params.minNodes} min={2} max={20} onChange={(minNodes) => setParams({ minNodes })} testId="ctl-min-nodes" />
      <Toggle label="무작위 기준선 표시" checked={params.random} onChange={(random) => setParams({ random })} />
      <Hint>φ(k)는 차수가 k보다 큰 노드 N_{'>'}k개가 서로 이루는 연결 수를 가능한 최대 연결 수로 나눈 밀도입니다. 허브가 많은 그래프는 차수가 큰 노드끼리 연결될 확률이 원래 높으므로 φ(k)만으로는 부자 클럽을 판단할 수 없고, 각 노드의 차수를 그대로 둔 채 간선 쌍을 맞바꿔(마슬로프–스네펜) 만든 무작위 그래프의 평균과 나눈 ρ(k)로 봅니다. 노드가 적게 남은 큰 k에서는 값이 크게 흔들리니 하한으로 가립니다.</Hint>
    </ControlGroup>
  )
}

export const richClubModule: VizModule<RichClubParams> = {
  roles: undirectedRoles, datasets: ['net-hubs'], defaultParams: { samples: 15, seed: 1, minNodes: 4, random: true },
  Chart: RichClubChart, Controls: RichClubControls, hint: '아래 그림이 1보다 위로 올라가면 허브끼리 우연보다 더 서로 연결되어 있습니다 · 시드를 바꿔 무작위 기준선의 흔들림을 보세요',
}

// ─── community blockmodel ───────────────────────────────────────────────────────────

export interface BlockParams { seed: number; order: 'community' | 'original'; metric: 'density' | 'weight' }

function BlockChart({ table, mapping, params, width, height, compact }: ChartProps<BlockParams>) {
  const g = useMemo(() => graphOf(table, mapping), [table, mapping])
  const m = useMemo(() => {
    const n = g.names.length
    if (n < 4 || n > 120 || g.edges.length < 3) return null
    const A = adjacency(n, g.edges)
    const raw = louvain(A, params.seed)
    // communities by size (largest first) and nodes by degree inside a community
    const size = new Map<number, number>()
    raw.forEach((c) => size.set(c, (size.get(c) ?? 0) + 1))
    const rank = [...size.keys()].sort((a, b) => size.get(b)! - size.get(a)! || a - b)
    const comm = raw.map((c) => rank.indexOf(c))
    const deg = A.map((r) => r.reduce((s, v) => s + v, 0))
    const order = params.order === 'community' ? g.names.map((_, i) => i).sort((a, b) => comm[a] - comm[b] || deg[b] - deg[a] || a - b) : g.names.map((_, i) => i)
    return { A, comm, order, Q: modularity(A, comm), bd: blockDensity(A, comm), deg }
  }, [g, params.seed, params.order])
  if (!m) return <ChartMessage>출발·도착 노드 열을 고르세요. 노드 4~120개와 간선 3개 이상이 필요합니다.</ChartMessage>
  const n = g.names.length, k = m.bd.size.length
  const groups = new Set(g.group.filter(Boolean))
  const ari = groups.size >= 2 ? adjustedRand(m.comm, g.group.map((s) => s || '기타')) : null
  const names = m.order.map((i) => g.names[i])
  const wmax = Math.max(...m.A.flat())
  const vals = m.order.map((i) => m.order.map((j) => (i === j || m.A[i][j] === 0 ? NaN : m.A[i][j])))
  const bounds: number[] = []
  m.order.forEach((v, idx) => { if (idx > 0 && m.comm[v] !== m.comm[m.order[idx - 1]]) bounds.push(idx) })
  const matrix = (h: number) => (
    <HeatGrid rows={names} cols={names} values={vals} width={width} height={h} compact={compact} square title={`군집 순서로 정렬한 인접 행렬: 노드 ${n}개, 군집 ${k}개`} color={(v) => d3.interpolateBlues(0.3 + (0.65 * v) / Math.max(1e-9, wmax))}
      labelEvery={n > 40 ? Math.ceil(n / 30) : 1}
      tip={(i, j, v) => <><b>{names[i]} – {names[j]}</b><br />가중치 {fmt(v, 3)}<br />군집 {m.comm[m.order[i]] + 1} · {m.comm[m.order[j]] + 1}</>}
      extra={params.order === 'community' ? ({ cw, ch }) => <g stroke="#e07a3f" strokeWidth={1.6}>{bounds.map((b) => <g key={b}><line x1={b * cw} x2={b * cw} y1={0} y2={n * ch} /><line y1={b * ch} y2={b * ch} x1={0} x2={n * cw} /></g>)}</g> : undefined}
      readout={[{ label: '탐지한 군집', value: String(k) }, { label: '모듈성 Q', value: fmt(m.Q, 3) }, ...(ari != null ? [{ label: '표의 그룹과 일치도(ARI)', value: fmt(ari, 3) }] : [])]}
      note={params.order === 'community' ? '주황 선: 군집 경계 · 대각선 블록이 진할수록 군집이 뚜렷' : '원래 순서에서는 군집이 흩어져 보입니다'} />
  )
  if (compact) return matrix(height)
  const labels = m.bd.size.map((s, c) => `군집 ${c + 1} (${s})`)
  const vals2 = params.metric === 'density' ? m.bd.density : m.bd.weight
  const vmax = Math.max(1e-9, ...vals2.flat())
  const summary = (h: number) => (
    <HeatGrid rows={labels} cols={labels} values={vals2} width={width} height={h} title="블록 모형: 군집 사이 연결" color={(v) => d3.interpolateOranges(0.12 + (0.8 * v) / vmax)} text={(v) => (params.metric === 'density' ? fmt(v, 2) : fmt(v, 3))}
      tip={(i, j, v) => <><b>{labels[i]} ↔ {labels[j]}</b><br />{params.metric === 'density' ? `연결 밀도 ${fmt(v, 3)} (가능한 쌍 중 연결 비율)` : `연결 가중치 합 ${fmt(v, 3)}`}</>} />
  )
  return <Panels width={width} height={height} parts={[3, 1.3]}>{[matrix, summary]}</Panels>
}

function BlockControls({ params, setParams }: ControlsProps<BlockParams>) {
  return (
    <ControlGroup title="군집 탐지(루뱅)">
      <Slider label="노드 방문 순서 시드" value={params.seed} min={1} max={30} onChange={(seed) => setParams({ seed })} testId="ctl-seed" />
      <Segmented label="행렬 순서" value={params.order} onChange={(order) => setParams({ order })} testId="ctl-order" options={[{ value: 'community', label: '군집별 정렬' }, { value: 'original', label: '표의 순서' }]} />
      <Segmented label="블록 요약" value={params.metric} onChange={(metric) => setParams({ metric })} testId="ctl-metric" options={[{ value: 'density', label: '연결 밀도' }, { value: 'weight', label: '가중치 합' }]} />
      <Hint>루뱅 방법은 모듈성 Q = (1/2m) Σ[Aᵢⱼ − kᵢkⱼ/2m]·δ(cᵢ, cⱼ)이 커지도록 노드를 이웃 군집으로 옮기는 지역 이동을 되풀이하고, 군집을 하나의 노드로 묶어 같은 과정을 다시 합니다. 결과는 방문 순서에 약간 의존하므로 시드를 바꿔 안정성을 확인하세요. 같은 군집의 노드를 이웃하게 정렬한 인접 행렬은 대각선 블록이 진한 블록 모형이 되고, 아래 요약표는 군집 쌍마다 실제 연결 수를 가능한 쌍의 수로 나눈 밀도입니다.</Hint>
    </ControlGroup>
  )
}

export const blockModule: VizModule<BlockParams> = {
  roles: undirectedRoles, datasets: ['net-communities'], defaultParams: { seed: 1, order: 'community', metric: 'density' },
  Chart: BlockChart, Controls: BlockControls, hint: '표의 순서와 군집별 정렬을 번갈아 보면 숨은 블록 구조가 드러납니다 · 시드를 바꿔 군집이 안정적인지 확인하세요',
}
