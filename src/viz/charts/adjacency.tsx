import * as d3 from 'd3'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChartMessage, Legend, Readout, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Toggle } from '../../components/controls'
import { appendRow, columnIndex, templateRow, toLabel, updateRow, type Cell, type DataTable } from '../../data/table'
import { categoryColor, schemes, type ColorScheme } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { adjacencyMatrix, orderNodes, type MatrixOrder } from '../../stats/graphs'
import { buildNetwork } from '../../stats/network'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'
import { edgeRoles, edgeRows } from './networkShared'

export interface AdjacencyParams {
  order: MatrixOrder
  directed: boolean
  color: 'weight' | 'binary'
  scheme: ColorScheme
  labels: boolean
  /** Highlighted node id (its row and column). */
  selected: string
}

const ORDERS: { value: MatrixOrder; label: string; hint: string }[] = [
  { value: 'data', label: '입력 순서', hint: '데이터에 처음 나온 순서입니다.' },
  { value: 'name', label: '이름순', hint: '이름 가나다순입니다. 구조와 무관하게 정해지므로 덩어리가 잘 보이지 않을 수 있습니다.' },
  { value: 'degree', label: '연결 수순', hint: '연결이 많은 노드부터 놓습니다. 허브가 왼쪽 위에 모입니다.' },
  { value: 'group', label: '그룹순', hint: '같은 그룹을 이웃하게 놓아 그룹 안의 블록이 대각선 위에 생깁니다.' },
  { value: 'cluster', label: '군집순', hint: '연결 성분을 묶고 이웃하는 노드끼리 가깝게 두어 밀집 블록이 대각선 근처에 모이게 합니다. 휴리스틱이라 최적 순서는 아닙니다.' },
]

/** Sets the weight of the edge a→b (either direction when undirected). 0 removes it; a missing edge is appended. Duplicate rows for the same edge are blanked. */
export function setEdgeWeight(table: DataTable, mapping: Mapping, a: string, b: string, w: number, directed: boolean): DataTable {
  const si = columnIndex(table, roleColumn(mapping, 'source'))
  const ti = columnIndex(table, roleColumn(mapping, 'target'))
  const sc = roleColumn(mapping, 'source')!; const tc = roleColumn(mapping, 'target')!; const wc = roleColumn(mapping, 'weight')
  const hits = table.rows.map((r, i) => ({ r, i })).filter(({ r }) => { const f = toLabel(r[si]); const t = toLabel(r[ti]); return (f === a && t === b) || (!directed && f === b && t === a) })
  let next = table
  if (w <= 0) {
    for (const { i } of hits) next = updateRow(next, i, { [tc]: null, ...(wc ? { [wc]: null } : {}) })
    return next
  }
  if (!hits.length) return appendRow(next, { ...templateRow(table), [sc]: a, [tc]: b, ...(wc ? { [wc]: w } : {}) } as Record<string, Cell>)
  hits.forEach(({ i }, k) => { next = k === 0 ? (wc ? updateRow(next, i, { [wc]: w }) : next) : updateRow(next, i, { [tc]: null, ...(wc ? { [wc]: null } : {}) }) })
  return next
}

function AdjacencyChart({ table, mapping, params, setParams, width, height, compact, onTableChange, linked }: ChartProps<AdjacencyParams>) {
  const rows = useMemo(() => edgeRows(table, mapping), [table, mapping])
  const net = useMemo(() => buildNetwork(rows, { directed: params.directed }), [rows, params.directed])
  const nodes = useMemo(() => orderNodes(net, params.order), [net, params.order])
  const mat = useMemo(() => adjacencyMatrix(net, nodes.map((n) => n.id), params.directed), [net, nodes, params.directed])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<{ i: number; j: number } | null>(null)
  const [edit, setEdit] = useState<{ a: string; b: string; x: number; y: number } | null>(null)
  const [draft, setDraft] = useState('')
  useEffect(() => { setEdit(null) }, [table])
  const n = nodes.length
  const groups = useMemo(() => [...new Set(nodes.map((n) => n.group).filter(Boolean))], [nodes])
  const gcolor = useMemo(() => categoryColor(groups), [groups])
  const scheme = schemes[params.scheme]
  const wmax = d3.max(mat.flat()) || 1
  const marked = new Set(linked?.rows ?? [])
  const editable = !!onTableChange && !compact
  const labelPx = compact || !params.labels ? 0 : Math.min(120, Math.max(56, d3.max(nodes, (x) => x.id.length)! * 6.4 + 10))
  const strip = compact ? 0 : groups.length ? 8 : 0
  // On a phone the group legend and readout wrap onto a second row; start the matrix below them.
  const topPad = compact ? 0 : width < 520 ? 44 : 0
  const side = Math.max(30, Math.min(width - labelPx - strip - 8, height - labelPx - strip - 8 - topPad))
  const cell = side / Math.max(1, n)
  const ox = Math.max(4, (width - side - labelPx - strip) / 2) + labelPx + strip
  const oy = (compact ? 4 : 6) + labelPx + strip + topPad
  const idx = new Map(nodes.map((x, i) => [x.id, i]))
  const linkAt = useMemo(() => { const m = new Map<string, (typeof net.links)[number]>(); for (const l of net.links) { m.set(`${l.source}\u0000${l.target}`, l); if (!params.directed) m.set(`${l.target}\u0000${l.source}`, l) } return m }, [net, params.directed])

  if (!roleColumn(mapping, 'source') || !roleColumn(mapping, 'target')) return <ChartMessage>출발·도착 노드(범주형) 열을 선택하세요.</ChartMessage>
  if (n < 2) return <ChartMessage>노드가 2개 이상 필요합니다.</ChartMessage>

  const sel = params.selected && idx.has(params.selected) ? idx.get(params.selected)! : -1
  const showAllCells = n <= 40 && !compact
  const cells: { i: number; j: number; w: number }[] = []
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (mat[i][j] > 0) cells.push({ i, j, w: mat[i][j] })
  const colorOf = (w: number) => (params.color === 'binary' ? scheme.interpolate(0.85) : scheme.interpolate(0.18 + 0.82 * (w / wmax)))
  const commit = () => {
    if (!edit) return
    const v = Number(draft.replace(/,/g, ''))
    if (draft.trim() === '' || !Number.isFinite(v) || v < 0) return
    onTableChange!(setEdgeWeight(table, mapping, edit.a, edit.b, v, params.directed))
    setEdit(null)
  }
  const fontPx = Math.max(8, Math.min(12, cell * 0.8))
  const bounds: number[] = []
  if (params.order === 'group' || params.order === 'cluster') nodes.forEach((x, i) => { if (i > 0 && (params.order === 'group' ? x.group !== nodes[i - 1].group : x.component !== nodes[i - 1].component)) bounds.push(i) })

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`인접 행렬: 노드 ${n}개, 연결 ${net.links.length}개`} onPointerLeave={() => { setHover(null); hide(); linked?.set(null) }}>
        <g transform={`translate(${ox},${oy})`}>
          <rect x={0} y={0} width={side} height={side} fill="#fbfcfb" stroke="#dfe5e3" />
          {showAllCells && d3.range(n + 1).map((k) => <g key={k} aria-hidden="true"><line x1={k * cell} x2={k * cell} y1={0} y2={side} stroke="#eef1f0" /><line y1={k * cell} y2={k * cell} x1={0} x2={side} stroke="#eef1f0" /></g>)}
          {(hover || sel >= 0) && <g aria-hidden="true">
            {[hover?.i ?? sel, sel].filter((v, k, a) => v >= 0 && a.indexOf(v) === k).map((i) => <rect key={`r${i}`} x={0} y={i * cell} width={side} height={cell} fill="#e07a3f" fillOpacity={0.13} />)}
            {[hover?.j ?? sel, sel].filter((v, k, a) => v >= 0 && a.indexOf(v) === k).map((j) => <rect key={`c${j}`} x={j * cell} y={0} width={cell} height={side} fill="#e07a3f" fillOpacity={0.13} />)}
          </g>}
          {bounds.map((b) => <g key={b} aria-hidden="true"><line x1={b * cell} x2={b * cell} y1={0} y2={side} stroke="#9aa6a2" strokeDasharray="3 3" /><line y1={b * cell} y2={b * cell} x1={0} x2={side} stroke="#9aa6a2" strokeDasharray="3 3" /></g>)}
          {cells.map(({ i, j, w }) => {
            const l = linkAt.get(`${nodes[i].id}\u0000${nodes[j].id}`)
            const on = !!l && l.rows.some((r) => marked.has(r))
            return (
              <rect key={`${i}-${j}`} data-testid="adj-cell" data-row={nodes[i].id} data-col={nodes[j].id} data-weight={w} x={j * cell + 0.5} y={i * cell + 0.5} width={Math.max(0.5, cell - 1)} height={Math.max(0.5, cell - 1)} fill={colorOf(w)} stroke={on ? '#121816' : 'none'} strokeWidth={on ? 2 : 0}
                onPointerEnter={compact ? undefined : (e) => { setHover({ i, j }); linked?.set(l?.rows ?? null); const p = localPoint(svgRef.current!, e); show(p.x, p.y, <><b>{nodes[i].id}{params.directed ? ' → ' : ' – '}{nodes[j].id}</b><br />가중치 {fmt(w)}{editable ? <><br />클릭해 값 수정</> : null}</>) }}
                onPointerLeave={() => { setHover(null); hide(); linked?.set(null) }} />
            )
          })}
          {/* interaction layer: every cell, so empty cells can be created and rows highlighted */}
          {!compact && (n <= 80 || editable) && d3.range(n).flatMap((i) => d3.range(n).map((j) => (
            i === j && !params.directed ? null :
            <rect key={`h${i}-${j}`} data-testid="adj-hit" x={j * cell} y={i * cell} width={cell} height={cell} fill="transparent" style={{ cursor: editable ? 'pointer' : undefined }}
              onPointerEnter={(e) => { if (mat[i][j] > 0) return; setHover({ i, j }); const p = localPoint(svgRef.current!, e); show(p.x, p.y, <><b>{nodes[i].id}{params.directed ? ' → ' : ' – '}{nodes[j].id}</b><br />연결 없음{editable ? <><br />클릭해 연결 추가</> : null}</>) }}
              onPointerLeave={() => { setHover(null); hide() }}
              onClick={editable && i !== j ? (e) => { const p = localPoint(svgRef.current!, e); setEdit({ a: nodes[i].id, b: nodes[j].id, x: p.x, y: p.y }); setDraft(mat[i][j] > 0 ? String(mat[i][j]) : '1') } : undefined} />
          )))}
          {Array.from({ length: n }, (_, i) => <rect key={`d${i}`} x={i * cell} y={i * cell} width={cell} height={cell} fill={params.directed ? 'none' : '#eef1f0'} pointerEvents="none" />)}
        </g>
        {!compact && params.labels && nodes.map((x, i) => (
          <g key={x.id} data-testid="adj-label" data-id={x.id} style={{ cursor: 'pointer' }} onClick={() => setParams({ selected: params.selected === x.id ? '' : x.id })}
            onPointerEnter={() => { setHover({ i, j: i }); linked?.set(x.rows) }} onPointerLeave={() => { setHover(null); linked?.set(null) }}>
            <text x={ox - strip - 5} y={oy + (i + 0.5) * cell} dy="0.34em" textAnchor="end" fontSize={fontPx} fontWeight={sel === i ? 700 : 400}>{x.id.length > 16 ? `${x.id.slice(0, 15)}…` : x.id}</text>
            <text transform={`translate(${ox + (i + 0.5) * cell},${oy - strip - 5}) rotate(-60)`} fontSize={fontPx} fontWeight={sel === i ? 700 : 400}>{x.id.length > 16 ? `${x.id.slice(0, 15)}…` : x.id}</text>
          </g>
        ))}
        {strip > 0 && nodes.map((x, i) => <g key={`s${x.id}`} aria-hidden="true"><rect x={ox - strip} y={oy + i * cell} width={strip - 2} height={cell} fill={x.group ? gcolor(x.group) : '#e5e9e8'} /><rect x={ox + i * cell} y={oy - strip} width={cell} height={strip - 2} fill={x.group ? gcolor(x.group) : '#e5e9e8'} /></g>)}
      </svg>
      {!compact && (
        <>
          {groups.length > 0 && <Legend items={groups.map((g) => ({ key: g, color: gcolor(g) }))} />}
          <Readout items={[{ label: '노드', value: n }, { label: '연결', value: net.links.length }, { label: '밀도', value: `${fmt((net.links.length / (params.directed ? n * (n - 1) : (n * (n - 1)) / 2)) * 100, 1)}%` }]} />
          {n > 80 && <p className="chart-warning" role="status">노드가 많아 라벨과 칸 상호작용을 줄였습니다. 확대해서 보려면 노드를 줄이거나 그룹 필터를 쓰세요.</p>}
          <Tooltip tip={tip} width={width} />
          {edit && (
            <form className="cell-popover" style={{ left: Math.min(width - 210, edit.x), top: edit.y + 10 }} onSubmit={(e) => { e.preventDefault(); commit() }}>
              <label>{edit.a}{params.directed ? ' → ' : ' – '}{edit.b} 가중치 (0이면 삭제)</label>
              <input autoFocus type="text" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="가중치" data-testid="adj-input" onKeyDown={(e) => { if (e.key === 'Escape') setEdit(null) }} />
              <button type="submit" className="btn btn-primary btn-sm">적용</button>
            </form>
          )}
        </>
      )}
    </div>
  )
}

function AdjacencyControls({ params, setParams, table, mapping }: ControlsProps<AdjacencyParams>) {
  const rows = useMemo(() => edgeRows(table, mapping), [table, mapping])
  const net = useMemo(() => buildNetwork(rows, { directed: params.directed }), [rows, params.directed])
  const order = ORDERS.find((o) => o.value === params.order)
  return (
    <>
      <ControlGroup title="행렬">
        <Segmented label="방향" value={params.directed ? 'directed' : 'undirected'} onChange={(v) => setParams({ directed: v === 'directed' })} testId="ctl-adj-directed" options={[{ value: 'undirected', label: '무방향' }, { value: 'directed', label: '방향 있음' }]} />
        <Hint>{params.directed ? '행이 출발, 열이 도착입니다. A→B와 B→A는 다른 칸이라 행렬이 대칭이 아닙니다.' : 'A–B와 B–A를 같은 연결로 보므로 행렬이 대각선에 대해 대칭입니다.'}</Hint>
        <Select label="노드 순서" value={params.order} onChange={(order) => setParams({ order })} testId="ctl-adj-order" options={ORDERS.map((o) => ({ value: o.value, label: o.label }))} />
        {order && <Hint>{order.hint} 순서가 바뀌어도 데이터는 같습니다. 순서에 따라 블록 구조가 보이거나 가려집니다.</Hint>}
        <Segmented label="칸 색" value={params.color} onChange={(color) => setParams({ color })} options={[{ value: 'weight', label: '가중치' }, { value: 'binary', label: '있음/없음' }]} />
        <Select label="팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={(Object.keys(schemes) as ColorScheme[]).filter((k) => !schemes[k].diverging).map((k) => ({ value: k, label: schemes[k].name }))} />
        <Toggle label="노드 이름 표시" checked={params.labels} onChange={(labels) => setParams({ labels })} />
        <Hint>칸을 클릭하면 가중치를 고치거나(0은 삭제) 없는 연결을 만들 수 있습니다. 이름을 클릭하면 그 노드의 행과 열이 강조되고, 네트워크 그래프와 함께 보면 같은 노드가 서로 연결되어 강조됩니다. 노드 {net.nodes.length}개가 많아지면 노드 링크 그림은 엉키지만 행렬은 읽을 수 있습니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const adjacencyModule: VizModule<AdjacencyParams> = {
  roles: edgeRoles,
  datasets: ['network', 'modules', 'energy'],
  defaultParams: { order: 'cluster', directed: false, color: 'weight', scheme: 'teal', labels: true, selected: '' },
  Chart: AdjacencyChart,
  Controls: AdjacencyControls,
  hint: '칸을 클릭해 연결 추가·가중치 수정(0은 삭제) · 노드 순서를 바꿔 블록 구조 찾기 · 이름을 클릭해 행·열 강조',
}
