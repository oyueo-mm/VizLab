import { Minus, Plus } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { ChartMessage, Legend, Readout, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, NumberField, Segmented, Slider, Toggle } from '../../components/controls'
import { appendRow, columnIndex, removeRows, setCell, templateRow, toLabel, toNumber, type DataTable } from '../../data/table'
import { categoryColor } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { buildAlluvial, stageTotals, type Alluvial, type FlowRow } from '../../stats/alluvial'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'

export interface AlluvialParams {
  order: 'data' | 'size'
  nodePad: number
  nodeWidth: number
  opacity: number
  labels: boolean
  /** Highlighted node key (stage\0category) or link id, '' for none. */
  focus: string
  /** Ribbon colour: the category it starts from, or the category it ends in. */
  colorBy: 'source' | 'target'
}

const KEYS = ['fromStage', 'toStage', 'from', 'to', 'value'] as const

export function flowRows(table: DataTable, mapping: Mapping): FlowRow[] {
  const idx = KEYS.map((k) => columnIndex(table, roleColumn(mapping, k)))
  if (idx.some((i) => i < 0)) return []
  return table.rows.map((r, row) => ({ fromStage: toLabel(r[idx[0]]), toStage: toLabel(r[idx[1]]), from: toLabel(r[idx[2]]), to: toLabel(r[idx[3]]), value: toNumber(r[idx[4]]) ?? 0, row }))
}

function ribbon(x0: number, y0: number, x1: number, y1: number, w: number) {
  const mx = (x0 + x1) / 2
  return `M${x0},${y0}C${mx},${y0} ${mx},${y1} ${x1},${y1}L${x1},${y1 + w}C${mx},${y1 + w} ${mx},${y0 + w} ${x0},${y0 + w}Z`
}

function AlluvialChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<AlluvialParams>) {
  const rows = useMemo(() => flowRows(table, mapping), [table, mapping])
  const labelRoom = compact ? 0 : width < 520 ? 44 : 72
  const padX = compact ? 6 : 12
  const top = compact ? 6 : width < 520 ? 92 : 56
  const bottom = compact ? 6 : 14
  const iw = Math.max(40, width - padX * 2 - labelRoom)
  const ih = Math.max(40, height - top - bottom)
  const graph = useMemo<Alluvial>(() => buildAlluvial(rows, { width: iw, height: ih, nodeWidth: compact ? 6 : params.nodeWidth, nodePad: compact ? 4 : params.nodePad, order: params.order }), [rows, iw, ih, params.nodeWidth, params.nodePad, params.order, compact])
  const cats = useMemo(() => [...new Set(graph.nodes.map((n) => n.name))], [graph])
  const color = useMemo(() => categoryColor(cats), [cats])
  const svgRef = useRef<SVGSVGElement>(null)
  const { tip, show, hide } = useTooltip()
  const [hover, setHover] = useState('')

  if (KEYS.some((k) => !roleColumn(mapping, k))) return <ChartMessage>시작·끝 단계, 시작·끝 범주(범주형)와 인원(숫자형) 열을 선택하세요.</ChartMessage>
  if (!graph.links.length) {
    return <ChartMessage><p>그릴 흐름이 없습니다.</p>{graph.issues.slice(0, 2).map((i) => <small key={i}>{i}</small>)}</ChartMessage>
  }
  const focus = hover || params.focus
  const isNodeFocus = focus && !focus.includes('\u0001')
  const nodeByKey = new Map(graph.nodes.map((n) => [n.key, n]))
  const touches = (l: Alluvial['links'][number]) => !focus || (isNodeFocus ? l.source === focus || l.target === focus : l.id === focus)
  const totals = stageTotals(graph)
  const ox = padX

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`올루비얼 다이어그램: ${graph.stages.join(' → ')}`} onPointerLeave={() => { hide(); setHover('') }}>
        <g transform={`translate(${ox},${top})`}>
          {!compact && graph.stages.map((s, i) => {
            const nx = graph.nodes.find((n) => n.stage === i)
            return nx ? <text key={s} className="axis-label" x={nx.x0 + (params.nodeWidth) / 2} y={-10} textAnchor={i === 0 ? 'start' : i === graph.stages.length - 1 ? 'end' : 'middle'}>{s}</text> : null
          })}
          {graph.links.map((l) => {
            const s = nodeByKey.get(l.source)!
            const t = nodeByKey.get(l.target)!
            const base = params.colorBy === 'source' ? l.fromName : l.toName
            return (
              <path key={l.id} className="alluvial-link" data-testid="alluvial-link" data-from={l.fromName} data-to={l.toName} data-value={l.value} d={ribbon(s.x1, l.sy, t.x0, l.ty, Math.max(0.5, l.width))} fill={color(base)}
                fillOpacity={touches(l) ? (focus ? 0.8 : params.opacity) : 0.06}
                onPointerEnter={compact ? undefined : (e) => {
                  setHover(l.id)
                  const lp = localPoint(svgRef.current!, e)
                  show(lp.x, lp.y, <><b>{l.fromName} → {l.toName}</b><br />{s.stageName} → {t.stageName}<br />{fmt(l.value, 0)} ({pct(l.value / Math.max(1, s.outflow))} of {l.fromName} 출발)</>)
                }} onPointerLeave={() => { setHover(''); hide() }}
                onClick={compact ? undefined : () => setParams({ focus: params.focus === l.id ? '' : l.id })} />
            )
          })}
          {graph.nodes.map((n) => {
            const diff = n.stage > 0 && n.stage < graph.stages.length - 1 && Math.abs(n.inflow - n.outflow) > 1e-9
            return (
              <g key={n.key} className="alluvial-node">
                <rect data-testid="alluvial-node" data-name={n.name} data-stage={n.stageName} x={n.x0} y={n.y0} width={n.x1 - n.x0} height={Math.max(1, n.y1 - n.y0)} rx={1.5} fill={color(n.name)} stroke={focus === n.key ? '#121816' : diff ? '#b4233a' : 'none'} strokeWidth={focus === n.key ? 2 : 1.2}
                  style={{ cursor: compact ? undefined : 'pointer' }}
                  onPointerEnter={compact ? undefined : (e) => {
                    setHover(n.key)
                    const lp = localPoint(svgRef.current!, e)
                    show(lp.x, lp.y, <><b>{n.stageName} · {n.name}</b><br />들어옴 {fmt(n.inflow, 0)} · 나감 {fmt(n.outflow, 0)}{diff ? <><br />들어온 양과 나간 양이 다릅니다</> : null}</>)
                  }} onPointerLeave={() => { setHover(''); hide() }}
                  onClick={compact ? undefined : () => setParams({ focus: params.focus === n.key ? '' : n.key })} />
                {params.labels && !compact && (n.y1 - n.y0) >= 12 && (
                  <text className="sankey-label" x={n.stage === graph.stages.length - 1 ? n.x1 + 5 : n.stage === 0 ? n.x1 + 5 : n.x1 + 5} y={(n.y0 + n.y1) / 2} dy="0.35em" pointerEvents="none">{n.name} {fmt(Math.max(n.inflow, n.outflow), 0)}</text>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          <Legend items={cats.map((c) => ({ key: c, color: color(c) }))} />
          <Readout items={[{ label: '단계', value: graph.stages.length }, { label: '단계별 합계', value: [...new Set(totals.map((t) => fmt(t, 0)))].join(' / ') }]} />
          {(graph.issues.length > 0 || graph.imbalanced.length > 0) && (
            <p className="chart-warning" role="status" data-testid="alluvial-warning">
              {graph.imbalanced.length > 0 ? `중간 단계 ${graph.imbalanced.length}개 노드에서 들어온 양과 나간 양이 다릅니다(빨간 테두리). ` : ''}{graph.issues[0] ?? ''}
            </p>
          )}
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function AlluvialControls({ params, setParams, table, mapping, setTable }: ControlsProps<AlluvialParams>) {
  const rows = useMemo(() => flowRows(table, mapping), [table, mapping])
  const graph = useMemo(() => buildAlluvial(rows, { width: 600, height: 300, nodeWidth: 12, nodePad: 8, order: 'data' }), [rows])
  const cols = KEYS.map((k) => roleColumn(mapping, k))
  const idx = cols.map((c) => columnIndex(table, c))
  const [newGroup, setNewGroup] = useState('')
  const ready = !!setTable && idx.every((i) => i >= 0)
  const lastStage = graph.stages[graph.stages.length - 1]
  const firstStage = graph.stages[0]

  const addStage = () => {
    if (!ready || !lastStage) return
    const name = `단계 ${graph.stages.length + 1}`
    let next = table
    // Everyone stays in their category, so the new stage starts out as a copy of the last one (totals are conserved).
    for (const nd of graph.nodes.filter((n) => n.stageName === lastStage)) {
      const total = Math.max(nd.inflow, nd.outflow)
      if (total > 0) next = appendRow(next, { ...templateRow(table), [cols[0]!]: lastStage, [cols[1]!]: name, [cols[2]!]: nd.name, [cols[3]!]: nd.name, [cols[4]!]: total })
    }
    setTable!(next)
  }
  const removeEnd = (which: 'first' | 'last') => {
    if (!ready || graph.stages.length <= 2) return
    const stage = which === 'last' ? lastStage : firstStage
    setTable!(removeRows(table, table.rows.map((r, i) => ((which === 'last' ? toLabel(r[idx[1]]) : toLabel(r[idx[0]])) === stage ? i : -1)).filter((i) => i >= 0)))
  }
  const addGroup = () => {
    const nm = newGroup.trim()
    if (!ready || !nm || cats.includes(nm)) return
    let next = table
    for (let s = 0; s < graph.stages.length - 1; s++) next = appendRow(next, { ...templateRow(table), [cols[0]!]: graph.stages[s], [cols[1]!]: graph.stages[s + 1], [cols[2]!]: nm, [cols[3]!]: nm, [cols[4]!]: 10 })
    setTable!(next)
    setNewGroup('')
  }
  const cats = [...new Set(graph.nodes.map((n) => n.name))]
  const removeGroup = (nm: string) => {
    if (!ready) return
    setTable!(removeRows(table, table.rows.map((r, i) => (toLabel(r[idx[2]]) === nm || toLabel(r[idx[3]]) === nm ? i : -1)).filter((i) => i >= 0)))
  }
  const flows = graph.links
  const setFlow = (rowsOf: number[], value: number) => {
    if (!ready) return
    // Merged duplicates: put the whole value on the first row and zero the others.
    let next = table
    rowsOf.forEach((r, k) => { next = setCell(next, r, cols[4]!, k === 0 ? Math.max(0, value) : 0) })
    setTable!(next)
  }
  return (
    <>
      <ControlGroup title="표시">
        <Segmented label="리본 색" value={params.colorBy} onChange={(colorBy) => setParams({ colorBy })} testId="ctl-color" options={[{ value: 'source', label: '출발 범주' }, { value: 'target', label: '도착 범주' }]} />
        <Segmented label="노드 순서" value={params.order} onChange={(order) => setParams({ order })} testId="ctl-order" options={[{ value: 'data', label: '데이터 순서' }, { value: 'size', label: '크기순' }]} />
        <Slider label="노드 간격" value={params.nodePad} min={2} max={30} onChange={(nodePad) => setParams({ nodePad })} format={(v) => `${v}px`} testId="ctl-pad" />
        <Slider label="노드 폭" value={params.nodeWidth} min={6} max={30} onChange={(nodeWidth) => setParams({ nodeWidth })} format={(v) => `${v}px`} />
        <Slider label="리본 불투명도" value={params.opacity} min={0.15} max={0.9} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} />
        <Toggle label="노드 이름과 크기" checked={params.labels} onChange={(labels) => setParams({ labels })} />
        <Hint>노드나 리본을 클릭하면 그 흐름만 강조됩니다. 같은 대상이 단계마다 어느 범주로 옮겨 가는지(구성 변화)가 핵심이며, 모든 열이 같은 크기 척도를 씁니다.</Hint>
      </ControlGroup>
      <ControlGroup title="단계·집단" defaultOpen={false}>
        <div className="data-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={addStage} disabled={!ready} data-testid="alluvial-add-stage"><Plus size={14} aria-hidden="true" />단계 추가</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeEnd('last')} disabled={!ready || graph.stages.length <= 2} data-testid="alluvial-del-stage"><Minus size={14} aria-hidden="true" />마지막 단계 삭제</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeEnd('first')} disabled={!ready || graph.stages.length <= 2}><Minus size={14} aria-hidden="true" />첫 단계 삭제</button>
        </div>
        <Hint>새 단계는 마지막 단계를 그대로 이어받아 시작합니다. 흐름 크기를 바꿔 이동을 만드세요.</Hint>
        <div className="field number-field"><label htmlFor="al-group">새 집단 이름</label>
          <div className="inline-add"><input id="al-group" type="text" value={newGroup} data-testid="alluvial-group-name" onChange={(e) => setNewGroup(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addGroup() }} />
            <button type="button" className="btn btn-secondary btn-sm" onClick={addGroup} disabled={!ready || !newGroup.trim() || cats.includes(newGroup.trim())} data-testid="alluvial-add-group"><Plus size={14} aria-hidden="true" />추가</button></div></div>
        <ul className="cat-chips-list">{cats.map((c) => <li key={c}>{c}<button type="button" className="icon-btn-xs" aria-label={`${c} 집단 삭제`} disabled={cats.length <= 1} onClick={() => removeGroup(c)}><Minus size={12} /></button></li>)}</ul>
      </ControlGroup>
      <ControlGroup title={`흐름 편집 (${flows.length})`} defaultOpen={false}>
        <div className="flow-list" data-testid="alluvial-flows">
          {flows.slice(0, 60).map((l) => (
            <NumberField key={l.id} label={`${graph.nodes.find((n) => n.key === l.source)?.stageName} ${l.fromName} → ${l.toName}`} value={l.value} min={0} onChange={(v) => setFlow(l.rows, v)} testId="alluvial-flow-input" />
          ))}
        </div>
        {flows.length > 60 && <Hint>처음 60개만 표시합니다. 나머지는 데이터 탭에서 편집하세요.</Hint>}
        <Hint>값을 0으로 하면 그 흐름이 사라집니다. 중간 단계에서 들어온 양과 나간 양이 다르면 차트에 경고가 표시됩니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const alluvialModule: VizModule<AlluvialParams> = {
  roles: [
    { key: 'fromStage', label: '시작 단계', type: 'category', required: true },
    { key: 'toStage', label: '끝 단계', type: 'category', required: true },
    { key: 'from', label: '시작 범주', type: 'category', required: true },
    { key: 'to', label: '끝 범주', type: 'category', required: true },
    { key: 'value', label: '인원·양', type: 'number', required: true },
  ],
  datasets: ['stage-flow'],
  defaultParams: { order: 'data', nodePad: 12, nodeWidth: 14, opacity: 0.45, labels: true, focus: '', colorBy: 'source' },
  Chart: AlluvialChart,
  Controls: AlluvialControls,
  hint: '노드나 리본을 클릭해 그 흐름만 강조 · 단계·집단·흐름 크기를 편집해 구성 변화를 실험',
}
