import { ArrowDown, ArrowUp, Download, RotateCcw, Shuffle, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { ControlGroup, Hint, Select, Slider } from '../components/controls'
import { parseCsv, formatCsv } from '../data/csv'
import { datasets, datasetById, generateDataset, type DatasetId } from '../data/datasets'
import { invalidNumericCells, type DataTable } from '../data/table'
import { incompatibility, mappingErrors } from '../viz/mapping'
import type { Mapping, RoleSpec, VizModule } from '../viz/types'
import { DataTableEditor } from './DataTableEditor'
import type { LabActions, LabState } from './state'

/** Compatibility is checked against each dataset's default sample, which has the same columns. */
const sampleCache = new Map<DatasetId, DataTable>()
const sample = (id: DatasetId) => {
  let t = sampleCache.get(id)
  if (!t) { t = generateDataset(id, 1, datasetById.get(id)?.size?.min); sampleCache.set(id, t) }
  return t
}

function MappingEditor({ roles, table, mapping, onChange }: { roles: RoleSpec[]; table: DataTable; mapping: Mapping; onChange: (m: Mapping) => void }) {
  return (
    <div className="mapping-editor" data-testid="mapping-editor">
      {roles.map((role) => {
        const cols = table.columns.filter((c) => c.type === role.type).map((c) => c.name)
        const typeName = role.type === 'number' ? '숫자형' : '범주형'
        if (role.multiple) {
          const chosen = (Array.isArray(mapping[role.key]) ? mapping[role.key] : []) as string[]
          const order = [...chosen.filter((c) => cols.includes(c)), ...cols.filter((c) => !chosen.includes(c))]
          const toggle = (name: string) => onChange({ ...mapping, [role.key]: chosen.includes(name) ? chosen.filter((c) => c !== name) : order.filter((c) => c === name || chosen.includes(c)) })
          const move = (name: string, dir: -1 | 1) => {
            const list = chosen.filter((c) => cols.includes(c))
            const i = list.indexOf(name)
            const j = i + dir
            if (i < 0 || j < 0 || j >= list.length) return
            ;[list[i], list[j]] = [list[j], list[i]]
            onChange({ ...mapping, [role.key]: list })
          }
          const atMax = role.multiple.max != null && chosen.length >= role.multiple.max
          return (
            <fieldset key={role.key} className="field multi-role">
              <legend>{role.label} <small>{typeName} {role.multiple.min}개 이상{role.multiple.max ? `, 최대 ${role.multiple.max}개` : ''}</small></legend>
              {order.length === 0 && <p className="control-hint">{typeName} 열이 없습니다.</p>}
              <ul>
                {order.map((name) => {
                  const on = chosen.includes(name)
                  return (
                    <li key={name} className={on ? 'is-on' : ''}>
                      <label><input type="checkbox" checked={on} disabled={!on && atMax} onChange={() => toggle(name)} data-testid={`role-${role.key}-${name}`} />{name}</label>
                      {on && <>
                        <button type="button" className="icon-btn-xs" aria-label={`${name} 위로`} onClick={() => move(name, -1)}><ArrowUp size={13} /></button>
                        <button type="button" className="icon-btn-xs" aria-label={`${name} 아래로`} onClick={() => move(name, 1)}><ArrowDown size={13} /></button>
                      </>}
                    </li>
                  )
                })}
              </ul>
            </fieldset>
          )
        }
        const value = typeof mapping[role.key] === 'string' ? (mapping[role.key] as string) : ''
        return (
          <Select key={role.key} label={`${role.label}${role.required ? '' : ' (선택)'}`} value={value} testId={`role-${role.key}`}
            onChange={(v) => onChange({ ...mapping, [role.key]: v || null })}
            options={[...(role.required && value ? [] : [{ value: '', label: role.required ? '열 선택…' : '사용 안 함' }]), ...cols.map((c) => ({ value: c, label: c }))]} />
        )
      })}
    </div>
  )
}

export function DataPanel({ mod, state, actions }: { mod: VizModule; state: LabState; actions: LabActions }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const def = state.datasetId === 'custom' ? null : datasetById.get(state.datasetId)
  const preferred = mod.datasets
  const ordered = [...preferred, ...datasets.map((d) => d.id).filter((id) => !preferred.includes(id))]
  const options = ordered.map((id) => {
    const reason = incompatibility(mod.roles, sample(id))
    const d = datasetById.get(id)!
    return { value: id as string, label: reason ? `${d.name} — 사용할 수 없음` : d.name, disabled: !!reason, title: reason ?? d.description }
  })
  if (state.datasetId === 'custom') options.unshift({ value: 'custom', label: `가져온 데이터: ${state.customName ?? 'CSV'}`, disabled: false, title: '' })
  const incompatible = ordered.filter((id) => incompatibility(mod.roles, sample(id)))
  const errors = mappingErrors(mod.roles, state.table, state.mapping)
  const invalid = invalidNumericCells(state.table)

  const onFile = async (file: File) => {
    if (file.size > 8 * 1024 * 1024) { setNotice({ kind: 'error', text: '8MB보다 큰 파일은 불러올 수 없습니다.' }); return }
    const res = parseCsv(await file.text())
    if (!res.table) { setNotice({ kind: 'error', text: res.error ?? 'CSV를 읽지 못했습니다.' }); return }
    const reason = incompatibility(mod.roles, res.table)
    actions.loadCustom(res.table, file.name)
    const info = [`${res.table.rows.length}행 × ${res.table.columns.length}열을 불러왔습니다.`, ...res.warnings]
    if (reason) info.push(`이 시각화에 맞지 않습니다: ${reason}`)
    setNotice({ kind: reason ? 'error' : 'info', text: info.join(' ') })
  }
  const exportCsv = () => {
    const blob = new Blob([String.fromCharCode(0xfeff) + formatCsv(state.table)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${state.customName?.replace(/\.csv$/i, '') ?? def?.name ?? 'data'}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  return (
    <div className="data-panel">
      <ControlGroup title="데이터셋">
        <Select label="데이터셋" value={state.datasetId} options={options} testId="dataset-select"
          onChange={(v) => { if (v !== 'custom') { setNotice(null); actions.loadDataset(v as DatasetId) } }} />
        {def && <p className="dataset-desc">{def.description}</p>}
        {incompatible.length > 0 && (
          <details className="incompat">
            <summary>사용할 수 없는 데이터셋 {incompatible.length}개</summary>
            <ul>{incompatible.map((id) => <li key={id}><b>{datasetById.get(id)!.name}</b>: {incompatibility(mod.roles, sample(id))}</li>)}</ul>
          </details>
        )}
        {def?.size && (
          <>
            <Slider label={def.size.label} value={state.n} min={def.size.min} max={def.size.max} step={def.size.step} testId="dataset-size"
              onChange={(n) => actions.loadDataset(def.id, state.seed, n)} />
            <div className="seed-row">
              <span>시드 <b data-testid="seed-value">{state.seed}</b></span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => actions.loadDataset(def.id, (state.seed * 48271 + 11) % 2147483647 || 1, state.n)} data-testid="resample">
                <Shuffle size={14} aria-hidden="true" />새 표본 뽑기
              </button>
            </div>
            <Hint>같은 시드는 언제나 같은 표본을 만듭니다.</Hint>
          </>
        )}
      </ControlGroup>
      <ControlGroup title="열 매핑">
        <MappingEditor roles={mod.roles} table={state.table} mapping={state.mapping} onChange={actions.setMapping} />
        {errors.length > 0 && <div className="notice is-error" role="alert">{errors.map((e) => <p key={e}>{e}</p>)}</div>}
      </ControlGroup>
      <ControlGroup title={`데이터 편집 (${state.table.rows.length}행)`}>
        <div className="data-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} data-testid="csv-import"><Upload size={14} aria-hidden="true" />CSV 가져오기</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={exportCsv} data-testid="csv-export"><Download size={14} aria-hidden="true" />CSV 내보내기</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setNotice(null); actions.restoreData() }} disabled={state.datasetId === 'custom' || !state.edited} data-testid="restore-data"><RotateCcw size={14} aria-hidden="true" />기본 데이터 복원</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden data-testid="csv-file"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = '' }} />
        </div>
        {notice && <div className={`notice ${notice.kind === 'error' ? 'is-error' : ''}`} role="status">{notice.text}</div>}
        {invalid > 0 && <div className="notice is-error" role="status">숫자형 열에 숫자가 아닌 값이 {invalid}개 있습니다. 해당 칸(빨간색)은 그래프에서 제외됩니다.</div>}
        <DataTableEditor table={state.table} onChange={(t) => actions.setTable(t)} />
        <Hint>데이터는 브라우저 안에서만 처리되며 서버로 전송되지 않습니다. 열 머리글의 형식 표시를 누르면 숫자형·범주형을 바꿀 수 있습니다.</Hint>
      </ControlGroup>
    </div>
  )
}
