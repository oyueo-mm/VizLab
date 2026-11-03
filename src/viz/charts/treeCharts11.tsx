import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber } from '../../data/table'
import { colorAt } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { buildTree } from '../../stats/hierarchy'
import { bspline, bundlePath, cactusTree, historyFlow, pythagoras, type Revision, type TreeIn } from '../../stats/tree11'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'

// ───────────────────────────── Generalized Pythagoras tree ─────────────────────────────

export interface PythParams { maxDepth: number; color: 'branch' | 'depth'; selected: string }

function PythChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<PythParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const levels = roleColumns(mapping, 'levels')
  const tree = useMemo(() => (levels.length ? (buildTree(table, levels, roleColumn(mapping, 'value')).tree as TreeIn) : null), [table, mapping, levels.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  const nodes = useMemo(() => (tree ? pythagoras(tree, 1, params.maxDepth) : []), [tree, params.maxDepth])
  if (!tree || nodes.length < 2) return <ChartMessage>계층 수준 열을 하나 이상 고르세요(값 열은 선택, 양수).</ChartMessage>
  const xs = nodes.flatMap((n) => n.corners.map((c) => c[0])), ys = nodes.flatMap((n) => n.corners.map((c) => c[1]))
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const pad = compact ? 4 : 14
  const k = Math.min((width - 2 * pad) / (x1 - x0), (height - 2 * pad) / (y1 - y0))
  const ox = (width - (x1 - x0) * k) / 2 - x0 * k, oy = height - (height - (y1 - y0) * k) / 2 + y0 * k
  const P = (c: [number, number]) => `${ox + c[0] * k},${oy - c[1] * k}`
  const top = (n: (typeof nodes)[number]) => n.path[1] ?? n.name
  const branches = [...new Set(nodes.filter((n) => n.depth === 1).map((n) => n.name))]
  const maxD = Math.max(...nodes.map((n) => n.depth))
  const fill = (n: (typeof nodes)[number]) => (n.depth === 0 ? '#9aa6a6' : params.color === 'depth' ? d3.interpolateYlGnBu(0.25 + (0.65 * n.depth) / Math.max(1, maxD)) : d3.color(colorAt(branches.indexOf(top(n))))!.brighter(Math.max(0, (n.depth - 1) * 0.22)).formatHex())
  const sel = params.selected
  const inSel = (n: (typeof nodes)[number]) => !sel || n.path.join('/').startsWith(sel)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`일반화 피타고라스 트리: 노드 ${nodes.length}개`} onPointerLeave={hide}>
        {nodes.map((n) => {
          const key = n.path.join('/')
          return <polygon key={key} points={n.corners.map(P).join(' ')} fill={fill(n)} fillOpacity={inSel(n) ? 0.92 : 0.18} stroke="#fff" strokeWidth={0.6} data-testid="pyth-node" data-depth={n.depth} data-side={n.side.toFixed(5)} style={{ cursor: 'pointer' }}
            onClick={() => setParams({ selected: sel === key ? '' : key })}
            onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{n.name}</b><br />깊이 {n.depth} · 가중치 {fmt(n.weight, 4)}<br />변의 길이 {fmt(n.side, 3)} (루트 = 1)</>) }} onPointerLeave={hide} />
        })}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function PythControls({ params, setParams }: ControlsProps<PythParams>) {
  return (
    <ControlGroup title="피타고라스 트리">
      <Slider label="그릴 깊이" value={params.maxDepth} min={1} max={8} onChange={(maxDepth) => setParams({ maxDepth })} testId="ctl-pdepth" />
      <Toggle label="깊이로 색칠(끄면 가지별 색)" checked={params.color === 'depth'} onChange={(on) => setParams({ color: on ? 'depth' : 'branch' })} testId="ctl-pcolor" />
      <Hint>노드가 정사각형이고 자식 정사각형들이 부모 윗변 위의 반원(탈레스 원) 안 현 위에 세워집니다. 현의 길이는 자식 가중치의 제곱근에 비례하고, 현들이 이어져 부모의 윗변 양 끝을 잇습니다. 자식이 둘이고 같은 무게이면 고전적 피타고라스 나무(c₁² + c₂² = c²)가 됩니다. 정사각형의 크기가 가중치(잎의 값 합)를 나타내며 무거운 가지일수록 크게 뻗습니다. 노드를 누르면 그 가지만 강조됩니다. 부모가 자식 가중치 합의 면적을 정확히 갖는 것은 아니고(면적 보존은 이진 균등 분기일 때만), 가지가 서로 겹칠 수 있습니다.</Hint>
    </ControlGroup>
  )
}

export const pythModule: VizModule<PythParams> = {
  roles: [
    { key: 'levels', label: '계층 수준 (바깥 → 안쪽)', type: 'category', required: true, multiple: { min: 1, max: 4 } },
    { key: 'value', label: '값 (선택)', type: 'number', auto: true, prefer: '금액|인원|값|value' },
  ],
  datasets: ['budget', 'org-tree'],
  defaultParams: { maxDepth: 6, color: 'branch', selected: '' },
  Chart: PythChart,
  Controls: PythControls,
  hint: '가지를 눌러 그 부분만 강조합니다 · 정사각형이 클수록 가중치가 큽니다',
}

// ───────────────────────────── CactusTree ─────────────────────────────

export interface CactusParams { beta: number; links: boolean; selected: string }

function CactusChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<CactusParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const levels = roleColumns(mapping, 'levels')
  const tcol = roleColumn(mapping, 'target')
  const data = useMemo(() => {
    if (!levels.length || !tcol) return null
    const { tree } = buildTree(table, levels, null)
    const nodes = cactusTree(tree as TreeIn, 0.8)
    const li = columnIndex(table, levels[levels.length - 1]), ti = columnIndex(table, tcol)
    const byLeaf = new Map(nodes.map((n, i) => [n.name, i]))
    const links: { a: number; b: number; row: number }[] = []
    table.rows.forEach((r, row) => { const a = byLeaf.get(toLabel(r[li])), b = byLeaf.get(toLabel(r[ti])); if (a != null && b != null && a !== b && nodes[a].leaf && nodes[b].leaf) links.push({ a, b, row }) })
    return { nodes, links }
  }, [table, levels.join('|'), tcol]) // eslint-disable-line react-hooks/exhaustive-deps
  const linkedSet = useMemo(() => new Set(linked?.rows ?? []), [linked?.rows])
  if (!data || data.nodes.length < 3) return <ChartMessage>계층 수준 열과 연결 대상 열(담당자 이름)을 고르세요.</ChartMessage>
  const { nodes, links } = data
  const xs = nodes.flatMap((n) => [n.x - n.r, n.x + n.r]), ys = nodes.flatMap((n) => [n.y - n.r, n.y + n.r])
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const pad = compact ? 4 : 16
  const k = Math.min((width - 2 * pad) / (x1 - x0), (height - 2 * pad) / (y1 - y0))
  const X = (v: number) => (width - (x1 - x0) * k) / 2 + (v - x0) * k, Y = (v: number) => (height - (y1 - y0) * k) / 2 + (v - y0) * k
  const sel = params.selected ? nodes.findIndex((n) => n.path.join('/') === params.selected) : -1
  const top = (i: number) => nodes[i].path[1] ?? nodes[i].name
  const branches = [...new Set(nodes.filter((n) => n.depth === 1).map((n) => n.name))]
  const touches = (l: { a: number; b: number }) => sel < 0 || l.a === sel || l.b === sel || nodes[l.a].path.join('/').startsWith(params.selected) || nodes[l.b].path.join('/').startsWith(params.selected)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`캑터스트리: 노드 ${nodes.length}개, 연결 ${links.length}개`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        {nodes.map((n, i) => (
          <circle key={i} cx={X(n.x)} cy={Y(n.y)} r={n.r * k} fill={n.depth === 0 ? '#eef2f2' : d3.color(colorAt(branches.indexOf(top(i))))!.brighter(Math.max(0, 0.45 * (n.depth - 1))).formatHex()} fillOpacity={n.leaf ? 0.9 : 0.3} stroke={i === sel ? '#111827' : '#fff'} strokeWidth={i === sel ? 2 : 0.8} data-testid="cactus-node" data-depth={n.depth} data-leaf={n.leaf} style={{ cursor: 'pointer' }}
            onClick={() => setParams({ selected: i === sel ? '' : n.path.join('/') })}
            onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{n.name}</b><br />{n.path.slice(1).join(' › ')}<br />가중치 {fmt(n.weight, 3)}{n.leaf ? ` · 연결 ${links.filter((l) => l.a === i || l.b === i).length}개` : ''}</>) }} onPointerLeave={hide} />
        ))}
        {params.links && links.map((l, i) => {
          const curve = bspline(bundlePath(nodes, l.a, l.b, params.beta), 6)
          const on = linkedSet.has(l.row)
          const dim = !touches(l)
          return <path key={i} d={'M' + curve.map((p) => `${X(p[0])},${Y(p[1])}`).join('L')} fill="none" stroke={on ? '#111827' : '#d4452f'} strokeOpacity={on ? 1 : dim ? 0.05 : 0.38} strokeWidth={on ? 2.4 : 1.2} data-testid="cactus-link"
            onPointerEnter={compact ? undefined : () => linked?.set([l.row])} onPointerLeave={() => linked?.set(null)} />
        })}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function CactusControls({ params, setParams }: ControlsProps<CactusParams>) {
  return (
    <ControlGroup title="캑터스트리">
      <Slider label="묶음 강도 β (0 = 직선, 1 = 트리 경로)" value={params.beta} min={0} max={1} step={0.05} onChange={(beta) => setParams({ beta })} format={(v) => v.toFixed(2)} testId="ctl-beta" />
      <Toggle label="계층 밖 연결 표시" checked={params.links} onChange={(links) => setParams({ links })} testId="ctl-clinks" />
      <Hint>각 노드가 원이고 원의 면적이 하위 가중치의 합에 비례합니다. 자식 원은 부모 원의 둘레에 접해 놓이고 부모에서 바깥쪽으로 열린 각도 안에 배치되어, 가지가 선인장처럼 갈라집니다. 담당자 사이의 연결선은 두 노드의 최저 공통 조상을 거치는 트리 경로를 B-스플라인으로 휘게(계층적 간선 묶음, β로 직선과 섞음) 그려 같은 부문 안의 연결은 짧게, 부문 사이의 연결은 루트 쪽으로 묶이게 합니다. 노드를 누르면 그 가지에 닿는 연결만 진하게 남습니다. 원 논문의 정확한 배치 규칙은 원문을 읽지 못해 둘레 접촉·각도 배분 방식으로 구현했고 원이 서로 겹칠 수 있습니다.</Hint>
    </ControlGroup>
  )
}

export const cactusModule: VizModule<CactusParams> = {
  roles: [
    { key: 'levels', label: '계층 수준 (바깥 → 안쪽, 마지막은 연결의 출발)', type: 'category', required: true, multiple: { min: 2, max: 3 } },
    { key: 'target', label: '연결 대상 (마지막 수준의 이름)', type: 'category', required: true, prefer: '연결|target' },
  ],
  datasets: ['org-links'],
  defaultParams: { beta: 0.85, links: true, selected: '' },
  Chart: CactusChart,
  Controls: CactusControls,
  hint: 'β를 바꿔 묶음 정도를 조절합니다 · 노드를 눌러 그 가지의 연결만 강조',
}

// ───────────────────────────── History Flow ─────────────────────────────

export interface FlowParams { moves: boolean; selected: string }

function FlowChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<FlowParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const revs = useMemo<Revision[] | null>(() => {
    const vi = columnIndex(table, roleColumn(mapping, 'version')), si = columnIndex(table, roleColumn(mapping, 'seg')), ai = columnIndex(table, roleColumn(mapping, 'author')), li = columnIndex(table, roleColumn(mapping, 'length')), oi = columnIndex(table, roleColumn(mapping, 'order'))
    if (vi < 0 || si < 0 || ai < 0 || li < 0 || oi < 0) return null
    const out: Revision[] = []
    for (const r of table.rows) { const v = toNumber(r[vi]), l = toNumber(r[li]), o = toNumber(r[oi]); if (v != null && l != null && l > 0 && o != null) out.push({ version: v, seg: toLabel(r[si]), author: toLabel(r[ai]), length: l, order: o }) }
    return out.length ? out : null
  }, [table, mapping])
  const flow = useMemo(() => (revs ? historyFlow(revs) : null), [revs])
  if (!flow || flow.versions.length < 2) return <ChartMessage>버전, 구간, 저자, 길이, 순서 열을 고르세요(버전이 2개 이상).</ChartMessage>
  const padX = compact ? 6 : 36, padY = compact ? 6 : 30
  const colW = Math.max(4, Math.min(22, ((width - 2 * padX) / flow.versions.length) * 0.32))
  const xOf = (v: number) => padX + (flow.versions.indexOf(v) * (width - 2 * padX - colW)) / Math.max(1, flow.versions.length - 1)
  const sy = (h: number) => (h / flow.height) * (height - 2 * padY)
  const sel = params.selected
  const col = (a: string) => colorAt(flow.authors.indexOf(a))
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`히스토리 플로: 버전 ${flow.versions.length}개, 저자 ${flow.authors.length}명`} onPointerLeave={hide}>
        {flow.ribbons.map((r, i) => {
          const xa = xOf(r.from) + colW, xb = xOf(r.to), mx = (xa + xb) / 2
          const ya0 = padY + sy(r.y0a), ya1 = padY + sy(r.y1a), yb0 = padY + sy(r.y0b), yb1 = padY + sy(r.y1b)
          return <path key={i} d={`M${xa},${ya0}C${mx},${ya0} ${mx},${yb0} ${xb},${yb0}L${xb},${yb1}C${mx},${yb1} ${mx},${ya1} ${xa},${ya1}Z`} fill={col(r.author)} fillOpacity={sel ? (r.seg === sel ? 0.7 : 0.08) : params.moves && r.moved ? 0.55 : 0.28} stroke={params.moves && r.moved ? '#111827' : 'none'} strokeWidth={0.6} data-testid="flow-ribbon" data-moved={r.moved} />
        })}
        {flow.rects.map((r, i) => (
          <rect key={i} x={xOf(r.version)} y={padY + sy(r.y0)} width={colW} height={Math.max(1, sy(r.y1 - r.y0) - 0.6)} fill={col(r.author)} fillOpacity={sel && r.seg !== sel ? 0.25 : 1} stroke={r.status === 'new' && r.version !== flow.versions[0] ? '#111827' : 'none'} strokeWidth={1.4} data-testid="flow-seg" data-status={r.status} style={{ cursor: 'pointer' }}
            onClick={() => setParams({ selected: sel === r.seg ? '' : r.seg })}
            onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{r.seg}</b> · 버전 {r.version}<br />저자 {r.author} · 길이 {fmt(r.y1 - r.y0, 3)}<br />{r.status === 'new' ? (r.version === flow.versions[0] ? '첫 버전의 구간' : '이 버전에서 삽입됨') : r.status === 'moved' ? '순서가 바뀜(이동)' : '유지됨'}</>) }} onPointerLeave={hide} />
        ))}
        {!compact && flow.versions.map((v) => <text key={v} x={xOf(v) + colW / 2} y={height - 10} textAnchor="middle" fontSize={10} fill="#6b7280">v{v}</text>)}
        {!compact && flow.authors.map((a, i) => <g key={a}><rect x={width - 90} y={8 + i * 16} width={10} height={10} fill={col(a)} /><text x={width - 76} y={17 + i * 16} fontSize={10} fill="#374151">{a}</text></g>)}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
      {!compact && <p className="chart-note" role="note" style={{ left: 'auto', right: 8, bottom: 2 }} data-testid="flow-readout">삽입 {flow.inserted}개 · 삭제 {flow.deleted}개 · 리본 {flow.ribbons.length}개</p>}
    </div>
  )
}

function FlowControls({ params, setParams }: ControlsProps<FlowParams>) {
  return (
    <ControlGroup title="히스토리 플로">
      <Toggle label="이동한 구간 강조(테두리)" checked={params.moves} onChange={(moves) => setParams({ moves })} testId="ctl-moves" />
      <Hint>문서의 버전마다 세로 막대 하나를 세우고 구간(문단)을 문서 순서대로 쌓습니다. 구간의 높이는 길이, 색은 마지막으로 쓴 저자입니다. 같은 구간 ID는 이웃한 버전 사이를 같은 색의 띠로 이어 어떤 부분이 살아남았는지 보이고, 띠가 끊기는 곳이 삭제, 띠 없이 새로 나타난 막대(검은 테두리)가 삽입, 띠가 위아래로 어긋나는 곳이 이동입니다. 구간을 누르면 그 구간의 계보만 진하게 남습니다. 원 논문의 텍스트 조각 추적(문장 단위 비교)이 아니라 구간 ID가 주어진 자료를 그리는 구조 보존 단순화입니다.</Hint>
    </ControlGroup>
  )
}

export const flowModule: VizModule<FlowParams> = {
  roles: [
    { key: 'version', label: '버전 (숫자)', type: 'number', required: true, prefer: '버전|version' },
    { key: 'seg', label: '구간 ID', type: 'category', required: true, prefer: '구간|seg' },
    { key: 'author', label: '저자', type: 'category', required: true, prefer: '저자|author' },
    { key: 'length', label: '길이', type: 'number', required: true, prefer: '길이|length' },
    { key: 'order', label: '문서 안 순서', type: 'number', required: true, prefer: '순서|order' },
  ],
  datasets: ['doc-revisions'],
  defaultParams: { moves: true, selected: '' },
  Chart: FlowChart,
  Controls: FlowControls,
  hint: '구간을 눌러 그 구간의 계보를 따라갑니다 · 검은 테두리는 그 버전에서 삽입된 구간',
}
