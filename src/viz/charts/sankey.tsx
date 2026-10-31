import { sankeyLinkHorizontal } from 'd3-sankey'
import { Plus } from 'lucide-react'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { ChartMessage, Readout, Tooltip, localPoint, useSvgId, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, NumberField, Segmented, Select, Slider, StatTable, Toggle } from '../../components/controls'
import { appendRow, columnIndex, templateRow, toLabel, toNumber, type DataTable } from '../../data/table'
import { categoryColor } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { collectFlows, findCycle, flowBalance, sankeyLayout, type FlowEdge, type SankeyAlign } from '../../stats/sankey'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'

export interface SankeyParams {
  nodeWidth: number
  nodePadding: number
  align: SankeyAlign
  linkColor: 'source' | 'target' | 'gradient' | 'gray'
  linkOpacity: number
  labels: boolean
  /** Vertical nudges (px) the user dragged nodes by. */
  offsets: Record<string, number>
}

function readFlows(table: DataTable, sCol: string | null, tCol: string | null, vCol: string | null) {
  const si = columnIndex(table, sCol)
  const ti = columnIndex(table, tCol)
  const vi = columnIndex(table, vCol)
  if (si < 0 || ti < 0 || vi < 0) return { edges: [] as FlowEdge[], selfLoops: 0, invalid: 0 }
  return collectFlows(table.rows.map((r, row) => ({ source: toLabel(r[si]), target: toLabel(r[ti]), value: toNumber(r[vi]), row })))
}

function SankeyChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<SankeyParams>) {
  const sCol = roleColumn(mapping, 'source')
  const tCol = roleColumn(mapping, 'target')
  const vCol = roleColumn(mapping, 'value')
  const { edges, selfLoops, invalid } = useMemo(() => readFlows(table, sCol, tCol, vCol), [table, sCol, tCol, vCol])
  const cycle = useMemo(() => findCycle(edges), [edges])
  const m = compact ? { l: 4, r: 4, t: 4, b: 4 } : { l: 12, r: 110, t: 14, b: 14 }
  const iw = Math.max(20, width - m.l - m.r)
  const ih = Math.max(20, height - m.t - m.b)
  const layout = useMemo(() => (edges.length && !cycle ? sankeyLayout(edges, { width: iw, height: ih, nodeWidth: compact ? 8 : params.nodeWidth, nodePadding: compact ? 4 : params.nodePadding, align: params.align }) : null),
    [edges, cycle, iw, ih, compact, params.nodeWidth, params.nodePadding, params.align])
  const color = useMemo(() => categoryColor(layout ? layout.graph.nodes.map((n) => n.name) : []), [layout])
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ name: string; y: number; base: number } | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const { tip, show, hide } = useTooltip()
  const gid = useSvgId('sk')
  const balance = useMemo(() => flowBalance(edges), [edges])

  if (!sCol || !tCol || !vCol) return <ChartMessage>출발, 도착, 양 열을 선택하세요.</ChartMessage>
  if (cycle) return <ChartMessage><p><b>순환 구조</b>가 있어 생키 배치를 계산할 수 없습니다.</p><p>{cycle.join(' → ')}</p><small>d3-sankey는 순환이 없는 흐름만 배치합니다. 이 고리의 연결 하나를 삭제하거나 방향을 바꾸세요.</small></ChartMessage>
  if (!layout) return <ChartMessage>양수 값이 있는 연결이 없습니다.{(selfLoops || invalid) > 0 && ` (자기 자신으로의 연결 ${selfLoops}행, 읽지 못한 행 ${invalid}행 제외)`}</ChartMessage>

  const { nodes, links } = layout.graph
  const dy = (n: { name: string; y0?: number; y1?: number }) => {
    const raw = params.offsets[n.name] ?? 0
    // keep the node inside the plot
    return Math.max(-(n.y0 ?? 0), Math.min(ih - (n.y1 ?? 0), raw))
  }
  const path = sankeyLinkHorizontal()
  const unbalanced = nodes.filter((n) => { const b = balance.get(n.name)!; return b.in > 0 && b.out > 0 && Math.abs(b.in - b.out) > 1e-9 })
  const touching = (l: (typeof links)[number]) => hover != null && ((l.source as any).name === hover || (l.target as any).name === hover)
  const editable = !compact

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    const t = (e.target as Element).closest('[data-node]')
    if (!t || !editable) return
    const name = t.getAttribute('data-node')!
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { name, y: localPoint(svgRef.current!, e).y, base: params.offsets[name] ?? 0 }
    hide()
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return
    setParams({ offsets: { ...params.offsets, [drag.current.name]: drag.current.base + localPoint(svgRef.current!, e).y - drag.current.y } })
  }
  const onUp = () => { drag.current = null }

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`생키 다이어그램: 노드 ${nodes.length}개, 흐름 ${links.length}개`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => { hide(); setHover(null) }}>
        <defs>
          {params.linkColor === 'gradient' && links.map((l, i) => (
            <linearGradient key={i} id={`${gid}-${i}`} gradientUnits="userSpaceOnUse" x1={(l.source as any).x1} x2={(l.target as any).x0}>
              <stop offset="0" stopColor={color((l.source as any).name)} /><stop offset="1" stopColor={color((l.target as any).name)} />
            </linearGradient>
          ))}
        </defs>
        <g transform={`translate(${m.l},${m.t})`}>
          <g fill="none">
            {links.map((l, i) => {
              const s = l.source as any
              const t = l.target as any
              const shifted = { ...l, y0: (l.y0 ?? 0) + dy(s), y1: (l.y1 ?? 0) + dy(t) }
              const stroke = params.linkColor === 'gradient' ? `url(#${gid}-${i})` : params.linkColor === 'source' ? color(s.name) : params.linkColor === 'target' ? color(t.name) : '#9aa3a0'
              return (
                <path key={i} className="sankey-link" data-testid="sankey-link" d={path(shifted as any) ?? ''} stroke={stroke} strokeWidth={Math.max(1, l.width ?? 0)}
                  strokeOpacity={hover == null ? params.linkOpacity : touching(l) ? Math.min(0.9, params.linkOpacity + 0.3) : params.linkOpacity * 0.25}
                  onPointerMove={compact ? undefined : (e) => {
                    const lp = localPoint(svgRef.current!, e)
                    const total = balance.get(s.name)!.out
                    show(lp.x, lp.y, <><b>{s.name} → {t.name}</b><br />{vCol}: {fmt(l.value)}<br />{s.name} 유출의 {pct(l.value / total)}</>)
                  }} onPointerLeave={hide} />
              )
            })}
          </g>
          {nodes.map((n) => {
            const b = balance.get(n.name)!
            const off = dy(n)
            const w = (n.x1 ?? 0) - (n.x0 ?? 0)
            const left = (n.x0 ?? 0) < iw / 2
            return (
              <g key={n.name} className="marks" transform={`translate(0,${off})`}>
                <rect className={`sankey-node ${editable ? 'is-draggable' : ''}`} data-node={n.name} data-testid="sankey-node" x={n.x0} y={n.y0} width={w} height={Math.max(1, (n.y1 ?? 0) - (n.y0 ?? 0))} fill={color(n.name)}
                  onPointerEnter={() => setHover(n.name)} onPointerLeave={() => setHover(null)}
                  onPointerMove={compact ? undefined : (e) => {
                    if (drag.current) return
                    const lp = localPoint(svgRef.current!, e)
                    show(lp.x, lp.y, <><b>{n.name}</b><br />들어오는 양: {fmt(b.in)}<br />나가는 양: {fmt(b.out)}{b.in > 0 && b.out > 0 && Math.abs(b.in - b.out) > 1e-9 && <><br />차이 {fmt(b.out - b.in)} (보존되지 않음)</>}<br />드래그해 위치 조절</>)
                  }} />
                {params.labels && !compact && (
                  <text className="sankey-label" x={left ? (n.x1 ?? 0) + 6 : (n.x0 ?? 0) - 6} y={((n.y0 ?? 0) + (n.y1 ?? 0)) / 2} dy="0.35em" textAnchor={left ? 'start' : 'end'} pointerEvents="none">
                    {n.name} <tspan className="tm-value">{fmt(n.value)}</tspan>
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          <Readout items={[{ label: '노드', value: nodes.length }, { label: '흐름', value: links.length }, ...(unbalanced.length ? [{ label: '보존 안 됨', value: `${unbalanced.length}개` }] : []), ...(selfLoops ? [{ label: '자기 연결 제외', value: selfLoops }] : [])]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function AddFlow({ table, mapping, setTable }: { table: DataTable; mapping: ControlsProps<SankeyParams>['mapping']; setTable?: (t: DataTable) => void }) {
  const [src, setSrc] = useState('')
  const [dst, setDst] = useState('')
  const [val, setVal] = useState(10)
  const sCol = roleColumn(mapping, 'source')
  const tCol = roleColumn(mapping, 'target')
  const vCol = roleColumn(mapping, 'value')
  if (!sCol || !tCol || !vCol || !setTable) return null
  const ok = src.trim() && dst.trim() && src.trim() !== dst.trim() && val > 0
  return (
    <form className="add-flow" onSubmit={(e) => { e.preventDefault(); if (ok) { setTable(appendRow(table, { ...templateRow(table), [sCol]: src.trim(), [tCol]: dst.trim(), [vCol]: val })); setSrc(''); setDst('') } }}>
      <div className="field"><label htmlFor="af-src">출발 노드</label><input id="af-src" className="text-input" value={src} onChange={(e) => setSrc(e.target.value)} list="af-nodes" data-testid="add-source" /></div>
      <div className="field"><label htmlFor="af-dst">도착 노드</label><input id="af-dst" className="text-input" value={dst} onChange={(e) => setDst(e.target.value)} list="af-nodes" data-testid="add-target" /></div>
      <datalist id="af-nodes">{[...new Set(table.rows.flatMap((r) => [toLabel(r[columnIndex(table, sCol)]), toLabel(r[columnIndex(table, tCol)])]))].filter(Boolean).map((n) => <option key={n} value={n} />)}</datalist>
      <NumberField label="양" value={val} min={0} onChange={setVal} testId="add-value" />
      <button type="submit" className="btn btn-secondary btn-sm" disabled={!ok} data-testid="add-flow"><Plus size={14} aria-hidden="true" />연결 추가</button>
    </form>
  )
}

function SankeyControls({ params, setParams, table, mapping, setTable }: ControlsProps<SankeyParams>) {
  const { edges, selfLoops } = readFlows(table, roleColumn(mapping, 'source'), roleColumn(mapping, 'target'), roleColumn(mapping, 'value'))
  const cycle = findCycle(edges)
  const bal = [...flowBalance(edges)]
  return (
    <>
      <ControlGroup title="배치">
        <Select label="노드 정렬" value={params.align} onChange={(align) => setParams({ align })} testId="ctl-align"
          options={[{ value: 'justify', label: '양끝 맞춤 (justify)' }, { value: 'left', label: '왼쪽' }, { value: 'right', label: '오른쪽' }, { value: 'center', label: '가운데' }]} />
        <Slider label="노드 너비" value={params.nodeWidth} min={4} max={36} onChange={(nodeWidth) => setParams({ nodeWidth })} format={(v) => `${v}px`} testId="ctl-nodewidth" />
        <Slider label="노드 사이 간격" value={params.nodePadding} min={2} max={40} onChange={(nodePadding) => setParams({ nodePadding })} format={(v) => `${v}px`} testId="ctl-padding" />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ offsets: {} })} disabled={!Object.keys(params.offsets).length}>드래그한 위치 되돌리기</button>
        <Hint>노드를 위아래로 드래그해 위치를 조절하면 연결 띠가 따라 움직입니다 (띠의 두께는 값에 의해서만 정해집니다).</Hint>
      </ControlGroup>
      <ControlGroup title="연결선">
        <Segmented label="색" value={params.linkColor} onChange={(linkColor) => setParams({ linkColor })} testId="ctl-linkcolor"
          options={[{ value: 'source', label: '출발' }, { value: 'target', label: '도착' }, { value: 'gradient', label: '그라데이션' }, { value: 'gray', label: '회색' }]} />
        <Slider label="불투명도" value={params.linkOpacity} min={0.1} max={0.9} step={0.05} onChange={(linkOpacity) => setParams({ linkOpacity })} format={(v) => v.toFixed(2)} />
        <Toggle label="레이블" checked={params.labels} onChange={(labels) => setParams({ labels })} />
      </ControlGroup>
      <ControlGroup title="연결 추가·편집">
        <AddFlow table={table} mapping={mapping} setTable={setTable} />
        <Hint>연결 삭제와 양 수정은 데이터 탭에서 합니다. 같은 출발·도착 쌍은 합산됩니다.</Hint>
        {cycle && <div className="notice is-error" role="alert">순환 구조: {cycle.join(' → ')}</div>}
        {selfLoops > 0 && <div className="notice is-error" role="status">자기 자신으로 가는 연결 {selfLoops}행은 그려지지 않습니다.</div>}
      </ControlGroup>
      <ControlGroup title="흐름 보존 확인" defaultOpen={false}>
        <StatTable rows={[['노드', '들어옴', '나감', '차이'], ...bal.map(([n, b]) => [n, fmt(b.in), fmt(b.out), b.in > 0 && b.out > 0 ? fmt(b.out - b.in) : '–'])]} />
        <Hint>중간 노드는 들어온 양과 나간 양이 같아야 흐름이 보존됩니다. 시작·끝 노드는 한쪽만 있어 차이를 비교하지 않습니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const sankeyModule: VizModule<SankeyParams> = {
  roles: [
    { key: 'source', label: '출발 노드', type: 'category', required: true },
    { key: 'target', label: '도착 노드', type: 'category', required: true },
    { key: 'value', label: '흐름의 양', type: 'number', required: true },
  ],
  datasets: ['energy'],
  defaultParams: { nodeWidth: 16, nodePadding: 14, align: 'justify', linkColor: 'gradient', linkOpacity: 0.45, labels: true, offsets: {} },
  Chart: SankeyChart,
  Controls: SankeyControls,
  hint: '노드를 위아래로 드래그해 위치 조절 · 노드에 마우스를 올려 연결된 흐름 강조 · 순환 연결은 그릴 수 없습니다',
}

