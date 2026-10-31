import { Minus, Plus } from 'lucide-react'
import { useState } from 'react'
import { Hint, NumberField, Select } from '../../components/controls'
import { appendRow, columnIndex, templateRow, toLabel, toNumber, type Cell, type DataTable } from '../../data/table'
import type { EdgeRow, Network } from '../../stats/network'
import { roleColumn } from '../mapping'
import type { Mapping, RoleSpec } from '../types'

export const edgeRoles: RoleSpec[] = [
  { key: 'source', label: '출발 노드', type: 'category', required: true },
  { key: 'target', label: '도착 노드 (비우면 노드만 선언)', type: 'category', required: true },
  { key: 'weight', label: '연결 가중치 (선택)', type: 'number', auto: true },
  { key: 'group', label: '노드 그룹 (출발 노드 기준, 선택)', type: 'category', auto: true },
]

/** Edge rows of the table in the form `buildNetwork` expects. */
export function edgeRows(table: DataTable, mapping: Mapping): EdgeRow[] {
  const si = columnIndex(table, roleColumn(mapping, 'source'))
  const ti = columnIndex(table, roleColumn(mapping, 'target'))
  const wi = columnIndex(table, roleColumn(mapping, 'weight'))
  const gi = columnIndex(table, roleColumn(mapping, 'group'))
  if (si < 0 || ti < 0) return []
  return table.rows.map((r, row) => ({ source: toLabel(r[si]), target: toLabel(r[ti]), weight: wi >= 0 ? toNumber(r[wi]) : null, group: gi >= 0 ? toLabel(r[gi]) : '', row }))
}

/** A short signature of the graph structure; layouts restart only when it changes. */
export const networkKey = (net: Network) => `${net.nodes.map((n) => n.id).join('|')}#${net.links.map((l) => `${l.source}>${l.target}:${l.weight}`).join('|')}`

/** Edits that keep the table a valid edge list: removing a node turns the edges that end at it into plain node declarations, so no other node disappears. */
export function useNetworkEdits(table: DataTable, mapping: Mapping, setTable?: (t: DataTable) => void) {
  const s = roleColumn(mapping, 'source')
  const t = roleColumn(mapping, 'target')
  const w = roleColumn(mapping, 'weight')
  const g = roleColumn(mapping, 'group')
  const si = columnIndex(table, s)
  const ti = columnIndex(table, t)
  const wi = columnIndex(table, w)
  const ok = !!setTable && !!s && !!t
  const addNode = (name: string, group = '') => {
    if (!ok || !name.trim()) return false
    const patch: Record<string, Cell> = { ...templateRow(table), [s!]: name.trim(), [t!]: null }
    if (w) patch[w] = null
    if (g) patch[g] = group
    setTable!(appendRow(table, patch))
    return true
  }
  const removeNode = (name: string) => {
    if (!ok) return
    const rows: Cell[][] = []
    for (const r of table.rows) {
      const from = toLabel(r[si])
      const to = toLabel(r[ti])
      if (from === name) continue
      if (to === name) { const c = r.slice(); c[ti] = null; if (wi >= 0) c[wi] = null; rows.push(c) } else rows.push(r)
    }
    setTable!({ columns: table.columns, rows })
  }
  const addEdge = (a: string, b: string, weight: number) => {
    if (!ok || !a || !b || a === b) return false
    const patch: Record<string, Cell> = { ...templateRow(table), [s!]: a, [t!]: b }
    if (w) patch[w] = weight
    if (g) patch[g] = ''
    setTable!(appendRow(table, patch))
    return true
  }
  const removeEdge = (a: string, b: string) => {
    if (!ok) return
    const rows = table.rows.map((r) => {
      const from = toLabel(r[si])
      const to = toLabel(r[ti])
      if ((from === a && to === b) || (from === b && to === a)) { const c = r.slice(); c[ti] = null; if (wi >= 0) c[wi] = null; return c }
      return r
    })
    setTable!({ columns: table.columns, rows })
  }
  return { ok, addNode, removeNode, addEdge, removeEdge }
}

/** Node / edge lists with add and delete, shared by the network graph and the arc diagram. */
export function NetworkEditor({ net, table, mapping, setTable }: { net: Network; table: DataTable; mapping: Mapping; setTable?: (t: DataTable) => void }) {
  const edits = useNetworkEdits(table, mapping, setTable)
  const [name, setName] = useState('')
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [weight, setWeight] = useState(1)
  const ids = net.nodes.map((n) => n.id)
  const from = ids.includes(a) ? a : ids[0] ?? ''
  const to = ids.includes(b) ? b : ids.find((i) => i !== from) ?? ''
  return (
    <div className="net-editor" data-testid="net-editor">
      <div className="field number-field">
        <label htmlFor="net-node-name">새 노드 이름</label>
        <div className="inline-add">
          <input id="net-node-name" type="text" value={name} data-testid="net-node-name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && edits.addNode(name)) setName('') }} />
          <button type="button" className="btn btn-secondary btn-sm" disabled={!name.trim() || ids.includes(name.trim())} data-testid="net-node-add" onClick={() => { if (edits.addNode(name)) setName('') }}><Plus size={14} aria-hidden="true" />추가</button>
        </div>
      </div>
      <details className="net-list">
        <summary>노드 {ids.length}개 삭제</summary>
        <ul>{net.nodes.map((n) => (
          <li key={n.id}><span>{n.id} <small>연결 {n.degree}</small></span>
            <button type="button" className="icon-btn-xs" aria-label={`${n.id} 노드 삭제`} data-testid="net-node-del" onClick={() => edits.removeNode(n.id)}><Minus size={13} /></button></li>
        ))}</ul>
      </details>
      <div className="field-pair-stack">
        <Select label="간선 출발" value={from} onChange={setA} options={ids.map((i) => ({ value: i, label: i }))} testId="net-edge-from" />
        <Select label="간선 도착" value={to} onChange={setB} options={ids.map((i) => ({ value: i, label: i }))} testId="net-edge-to" />
        <NumberField label="가중치" value={weight} min={0.1} step={0.5} onChange={setWeight} testId="net-edge-weight" />
        <button type="button" className="btn btn-secondary btn-sm" disabled={!from || !to || from === to} data-testid="net-edge-add" onClick={() => edits.addEdge(from, to, weight)}><Plus size={14} aria-hidden="true" />간선 추가</button>
      </div>
      <details className="net-list">
        <summary>간선 {net.links.length}개 삭제</summary>
        <ul>{net.links.slice(0, 80).map((l) => (
          <li key={`${l.source}>${l.target}`}><span>{l.source} – {l.target} <small>가중치 {l.weight}</small></span>
            <button type="button" className="icon-btn-xs" aria-label={`${l.source}–${l.target} 간선 삭제`} data-testid="net-edge-del" onClick={() => edits.removeEdge(l.source, l.target)}><Minus size={13} /></button></li>
        ))}</ul>
      </details>
      {(net.selfLoops > 0 || net.skipped > 0) && <Hint>{net.selfLoops > 0 ? `자기 자신으로 가는 간선 ${net.selfLoops}개는 그리지 않습니다. ` : ''}{net.skipped > 0 ? `출발 노드가 없거나 가중치가 0 이하인 ${net.skipped}행은 제외했습니다.` : ''}</Hint>}
    </div>
  )
}
