import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { normalizeDate } from '../data/csv'
import { appendRow, removeRows, templateRow, toNumber, toTime, type Cell, type ColumnType, type DataTable } from '../data/table'
import type { DateFormat } from '../stats/datetime'

const PAGE = 50

function CellInput({ value, type, onCommit, label, dateFormat }: { value: Cell; type: ColumnType; onCommit: (v: Cell) => void; label: string; dateFormat: DateFormat }) {
  const text = value == null ? '' : String(value)
  const [draft, setDraft] = useState<string | null>(null)
  const cancelled = useRef(false)
  const shown = draft ?? text
  const invalid = shown.trim() !== '' && ((type === 'number' && toNumber(shown) === null) || (type === 'date' && normalizeDate(shown, dateFormat) === null && toTime(shown) === null))
  const commit = () => {
    if (cancelled.current) { cancelled.current = false; setDraft(null); return }
    if (draft == null) return
    const t = draft.trim()
    setDraft(null)
    if (t === text) return
    // Numeric columns keep unparseable text so it stays visible (and flagged) instead of silently vanishing.
    onCommit(t === '' ? null : type === 'number' && toNumber(t) !== null ? Number(t.replace(/,/g, '')) : type === 'date' ? normalizeDate(t, dateFormat) ?? t : t)
  }
  return (
    <input className={`cell-input ${type === 'number' ? 'is-num' : ''} ${invalid ? 'is-invalid' : ''}`} value={shown} aria-label={label} aria-invalid={invalid || undefined}
      inputMode={type === 'number' ? 'decimal' : 'text'} placeholder={type === 'date' ? '2024-03-15' : undefined} title={invalid && type === 'date' ? '날짜 형식이 맞지 않거나 존재하지 않는 날짜입니다. 예: 2024-03-15' : undefined}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => {
        // Blur performs the commit; committing here too would apply the edit twice (two undo steps).
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') { cancelled.current = true; (e.target as HTMLInputElement).blur() }
      }} />
  )
}

export function DataTableEditor({ table, onChange, dateFormat = 'iso' }: { table: DataTable; onChange: (t: DataTable) => void; dateFormat?: DateFormat }) {
  const pages = Math.max(1, Math.ceil(table.rows.length / PAGE))
  const [page, setPage] = useState(0)
  useEffect(() => { if (page >= pages) setPage(pages - 1) }, [page, pages])
  const start = page * PAGE
  const rows = table.rows.slice(start, start + PAGE)

  const setCellAt = (r: number, c: number, v: Cell) => {
    const next = table.rows.slice()
    next[r] = next[r].slice()
    next[r][c] = v
    onChange({ columns: table.columns, rows: next })
  }
  const toggleType = (c: number) => {
    const col = table.columns[c]
    const type: ColumnType = col.type === 'number' ? 'category' : col.type === 'category' ? 'date' : 'number'
    const columns = table.columns.map((x, i) => (i === c ? { ...x, type } : x))
    // Values that do not fit the new type stay as text, flagged in red, instead of being dropped or guessed.
    const convert = (v: Cell): Cell => (type === 'number' ? (toNumber(v) ?? String(v)) : type === 'date' ? (normalizeDate(String(v), dateFormat) ?? String(v)) : String(v))
    const next = table.rows.map((r) => r.map((v, i) => (i !== c || v == null ? v : convert(v))))
    onChange({ columns, rows: next })
  }

  return (
    <div className="table-editor">
      <div className="table-scroll" data-testid="data-table">
        <table>
          <thead>
            <tr>
              <th className="row-num" scope="col">#</th>
              {table.columns.map((c, i) => (
                <th key={c.name} scope="col">
                  <span className="col-name" title={c.name}>{c.name}</span>
                  <button type="button" className={`type-badge is-${c.type}`} onClick={() => toggleType(i)} title="클릭하면 숫자형 → 범주형 → 날짜형 순으로 전환" aria-label={`${c.name} 열 형식: ${c.type === 'number' ? '숫자형' : c.type === 'date' ? '날짜형' : '범주형'}. 클릭하면 전환`}>
                    {c.type === 'number' ? '숫자' : c.type === 'date' ? '날짜' : '범주'}
                  </button>
                </th>
              ))}
              <th className="row-del" scope="col"><span className="sr-only">삭제</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, k) => {
              const ri = start + k
              return (
                <tr key={ri}>
                  <td className="row-num">{ri + 1}</td>
                  {table.columns.map((c, ci) => (
                    <td key={c.name}><CellInput value={r[ci]} type={c.type} dateFormat={dateFormat} label={`${ri + 1}행 ${c.name}`} onCommit={(v) => setCellAt(ri, ci, v)} /></td>
                  ))}
                  <td className="row-del">
                    <button type="button" className="icon-btn-xs" aria-label={`${ri + 1}행 삭제`} onClick={() => onChange(removeRows(table, [ri]))} data-testid="row-delete"><X size={13} /></button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="table-foot">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => { onChange(appendRow(table, templateRow(table))); setPage(Math.floor(table.rows.length / PAGE)) }} data-testid="row-add">
          <Plus size={14} aria-hidden="true" />행 추가
        </button>
        {pages > 1 && (
          <div className="pager" aria-label="표 페이지">
            <button type="button" className="icon-btn-xs" aria-label="이전 페이지" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft size={15} /></button>
            <span>{start + 1}–{Math.min(table.rows.length, start + PAGE)} / {table.rows.length}</span>
            <button type="button" className="icon-btn-xs" aria-label="다음 페이지" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}><ChevronRight size={15} /></button>
          </div>
        )}
      </div>
    </div>
  )
}
