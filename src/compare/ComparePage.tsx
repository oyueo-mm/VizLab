import { Database, ExternalLink, Link2, Maximize2, Minimize2, Plus, RotateCcw, Shuffle, SlidersHorizontal, Upload, Download, FileJson, X } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { ChartBoundary } from '../components/ChartBoundary'
import { ControlGroup, Hint, Select, Slider, Toggle } from '../components/controls'
import { formatCsv, formatJson, parseCsv, parseJson } from '../data/csv'
import { datasetById, datasets, type DatasetId } from '../data/datasets'
import { invalidDateCells, invalidNumericCells } from '../data/table'
import { useFullscreen } from '../hooks/useFullscreen'
import { useSize } from '../hooks/useSize'
import { DataTableEditor } from '../lab/DataTableEditor'
import { MappingEditor } from '../lab/DataPanel'
import { Related } from '../lab/Related'
import { routeHref, type Route } from '../router'
import { dateFormats, type DateFormat } from '../stats/datetime'
import { categories, vizById } from '../viz/catalog'
import { useVizModule } from '../viz/charts'
import { incompatibilityFromSlots } from '../viz/mapping'
import { needs } from '../viz/needs'
import { compareIssue, MAX_PANES, paneMapping, presetById, presets } from './presets'
import { useCompareState, type CompareActions, type CompareState, type PaneState } from './state'

const FALLBACK_CHARTS = ['histogram', 'kde', 'bar', 'line', 'scatter', 'box']

interface PaneProps {
  index: number
  pane: PaneState
  state: CompareState
  actions: CompareActions
  canRemove: boolean
  linkedRows: number[]
  setLinked: (rows: number[] | null) => void
  openData: () => void
}

function Pane({ index, pane, state, actions, canRemove, linkedRows, setLinked, openData }: PaneProps) {
  const { mod, error } = useVizModule(pane.viz)
  const meta = vizById.get(pane.viz)
  const [chartRef, size] = useSize<HTMLDivElement>()
  const { ref: cardRef, expanded, fallback, toggle } = useFullscreen<HTMLElement>()
  const mapping = useMemo(() => (mod ? paneMapping(mod, state.table, pane.mapping) : {}), [mod, state.table, pane.mapping])
  const params = useMemo(() => ({ ...(mod?.defaultParams ?? {}), ...pane.params }), [mod, pane.params])
  const issue = mod ? compareIssue(mod, state.table, mapping) : null
  const setParams = (patch: Record<string, unknown>) => actions.setParams(index, patch)
  const linked = state.link ? { rows: linkedRows, set: setLinked } : undefined

  return (
    <section ref={cardRef} className={`compare-pane ${fallback ? 'is-expanded' : ''}`} data-testid={`compare-pane-${index}`} data-viz={pane.viz} aria-label={`차트 ${String.fromCharCode(65 + index)}`}>
      <header className="pane-head">
        <span className="pane-letter" aria-hidden="true">{String.fromCharCode(65 + index)}</span>
        <div className="select-wrap pane-select">
          <select value={pane.viz} onChange={(e) => actions.setViz(index, e.target.value)} aria-label={`차트 ${String.fromCharCode(65 + index)} 종류`} data-testid={`pane-select-${index}`}>
            {categories.map((c) => (
              <optgroup key={c.id} label={c.name}>
                {[...vizById.values()].filter((v) => v.category === c.id).map((v) => {
                  // Judged from the static slot table, so every chart is flagged before its code has been loaded.
                  const reason = v.id !== pane.viz && needs[v.id] ? incompatibilityFromSlots(needs[v.id], state.table) : null
                  return <option key={v.id} value={v.id} title={reason ?? undefined}>{v.name}{reason ? ' — 이 데이터와 맞지 않음' : ''}</option>
                })}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="pane-tools">
          <button type="button" className="icon-btn" aria-label="설정 열기" aria-pressed={pane.settings} data-tip="설정" onClick={() => actions.toggleSettings(index)} data-testid={`pane-settings-${index}`}><SlidersHorizontal size={17} /></button>
          <button type="button" className="icon-btn" aria-label={expanded ? '전체 화면 종료' : '전체 화면'} data-tip="전체 화면" onClick={() => void toggle()} data-testid={`pane-fullscreen-${index}`}>{expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
          <a className="icon-btn" href={routeHref({ page: 'viz', id: pane.viz })} aria-label={`${meta?.name ?? ''} 실험실에서 열기`} data-tip="실험실에서 열기" data-testid={`pane-open-${index}`}><ExternalLink size={17} /></a>
          {canRemove && <button type="button" className="icon-btn" aria-label="이 차트 제거" data-tip="제거" onClick={() => actions.removePane(index)} data-testid={`pane-remove-${index}`}><X size={17} /></button>}
        </div>
      </header>
      <div ref={chartRef} className="pane-chart" data-testid={`pane-chart-${index}`}>
        {error ? <div className="chart-message" role="alert"><p>시각화를 불러오지 못했습니다.</p></div>
          : !mod ? <div className="lab-loading" aria-busy="true" />
          : issue ? (
            <div className="chart-message" role="alert" data-testid={`pane-issue-${index}`}>
              <p>이 데이터로는 {meta?.name}을(를) 그릴 수 없습니다.</p>
              <small>{issue}</small>
              <button type="button" className="btn btn-secondary btn-sm" onClick={openData}><Database size={14} aria-hidden="true" />데이터 바꾸기</button>
            </div>
          ) : size.width > 0 && size.height > 0 && (
            <ChartBoundary resetKey={`${state.table.rows.length}|${JSON.stringify(mapping)}|${JSON.stringify(params)}`}>
              <mod.Chart table={state.table} mapping={mapping} params={params} setParams={setParams} width={size.width} height={size.height} onTableChange={(t) => actions.setTable(t)} linked={linked} />
            </ChartBoundary>
          )}
      </div>
      {mod && pane.settings && (
        <div className="pane-settings" data-testid={`pane-panel-${index}`}>
          <ControlGroup title="열 매핑" defaultOpen={false}>
            <MappingEditor roles={mod.roles} table={state.table} mapping={mapping} onChange={(m) => actions.setMapping(index, m)} />
          </ControlGroup>
          {mod.Controls && !issue && <mod.Controls params={params} setParams={setParams} table={state.table} mapping={mapping} setTable={actions.setTable} />}
          <section className="control-group"><p className="control-group-title">관련 시각화</p><Related id={pane.viz} compact /></section>
        </div>
      )}
    </section>
  )
}

function CompareData({ state, actions, onClose }: { state: CompareState; actions: CompareActions; onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const last = useRef<{ text: string; name: string; json: boolean } | null>(null)
  const [fmt, setFmt] = useState<DateFormat>('iso')
  const [ambiguous, setAmbiguous] = useState<string[]>([])
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const def = state.datasetId === 'custom' ? null : datasetById.get(state.datasetId)
  const invalid = invalidNumericCells(state.table)
  const invalidDates = invalidDateCells(state.table)

  const importText = (text: string, name: string, json: boolean, format: DateFormat) => {
    const res = json ? parseJson(text, format) : parseCsv(text, format)
    if (!res.table) { setNotice({ kind: 'error', text: res.error ?? '파일을 읽지 못했습니다.' }); setAmbiguous([]); return }
    actions.loadCustom(res.table, name)
    setAmbiguous(res.ambiguous)
    setNotice({ kind: 'info', text: [`${res.table.rows.length}행 × ${res.table.columns.length}열을 불러왔습니다.`, ...res.warnings].join(' ') })
  }
  const onFile = async (file: File) => {
    if (file.size > 8 * 1024 * 1024) { setNotice({ kind: 'error', text: '8MB보다 큰 파일은 불러올 수 없습니다.' }); return }
    const json = /\.json$/i.test(file.name) || file.type === 'application/json'
    const text = await file.text()
    last.current = { text, name: file.name, json }
    importText(text, file.name, json, fmt)
  }
  const download = (content: string, mime: string, ext: string) => {
    const blob = new Blob([ext === 'csv' ? String.fromCharCode(0xfeff) + content : content], { type: `${mime};charset=utf-8` })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${state.customName?.replace(/\.(csv|json)$/i, '') ?? def?.name ?? 'data'}.${ext}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  return (
    <div className="compare-data" data-testid="compare-data">
      <div className="compare-data-head">
        <b>공유 데이터</b>
        <button type="button" className="icon-btn-xs" aria-label="데이터 편집 닫기" onClick={onClose}><X size={16} /></button>
      </div>
      <Select label="데이터셋" value={state.datasetId} testId="compare-dataset" onChange={(v) => { if (v !== 'custom') { setNotice(null); actions.loadDataset(v as DatasetId) } }}
        options={[...(state.datasetId === 'custom' ? [{ value: 'custom', label: `가져온 데이터: ${state.customName ?? ''}` }] : []), ...datasets.map((d) => ({ value: d.id as string, label: d.name }))]} />
      {def && <p className="dataset-desc">{def.description}</p>}
      {def?.size && (
        <>
          <Slider label={def.size.label} value={state.n} min={def.size.min} max={def.size.max} step={def.size.step} testId="compare-size" onChange={(n) => actions.loadDataset(def.id, state.seed, n)} />
          <div className="seed-row">
            <span>시드 <b data-testid="compare-seed">{state.seed}</b></span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => actions.loadDataset(def.id, (state.seed * 48271 + 11) % 2147483647 || 1, state.n)} data-testid="compare-resample"><Shuffle size={14} aria-hidden="true" />새 표본 뽑기</button>
          </div>
        </>
      )}
      <div className="data-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} data-testid="compare-import"><Upload size={14} aria-hidden="true" />CSV·JSON 가져오기</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => download(formatCsv(state.table), 'text/csv', 'csv')}><Download size={14} aria-hidden="true" />CSV</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => download(formatJson(state.table), 'application/json', 'json')}><FileJson size={14} aria-hidden="true" />JSON</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setNotice(null); actions.restoreData() }} disabled={state.datasetId === 'custom' || !state.edited} data-testid="compare-restore"><RotateCcw size={14} aria-hidden="true" />기본 데이터 복원</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv,.json,application/json" hidden data-testid="compare-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = '' }} />
      </div>
      <Select label="날짜 해석 형식" value={fmt} testId="compare-date-format" options={dateFormats.map((f) => ({ value: f.value, label: `${f.label} — ${f.example}` }))}
        onChange={(v) => { setFmt(v); if (last.current && ambiguous.length) importText(last.current.text, last.current.name, last.current.json, v) }} />
      {notice && <div className={`notice ${notice.kind === 'error' ? 'is-error' : ''}`} role="status">{notice.text}</div>}
      {ambiguous.length > 0 && <div className="notice is-error" role="status">‘{ambiguous.join('’, ‘')}’ 열은 일·월 순서가 모호합니다. 위에서 날짜 형식을 고르세요.</div>}
      {invalid > 0 && <div className="notice is-error" role="status">숫자형 열에 숫자가 아닌 값이 {invalid}개 있습니다.</div>}
      {invalidDates > 0 && <div className="notice is-error" role="status">날짜형 열에 올바르지 않은 날짜가 {invalidDates}개 있습니다.</div>}
      <DataTableEditor table={state.table} onChange={(t) => actions.setTable(t)} dateFormat={fmt} />
      <Hint>여기서 고친 데이터는 아래 모든 차트에 바로 반영됩니다. 데이터는 이 브라우저 안에서만 처리됩니다.</Hint>
    </div>
  )
}

export default function ComparePage({ preset, navigate }: { preset?: string; navigate: (r: Route) => void }) {
  const { state, actions } = useCompareState(preset)
  const [dataOpen, setDataOpen] = useState(false)
  const [linkedRows, setLinkedRows] = useState<number[]>([])
  const seenPreset = useRef(preset)
  const def = state.datasetId === 'custom' ? null : datasetById.get(state.datasetId)

  // A preset link (#/compare/<id>) loads that combination; opening #/compare alone restores the last session.
  useEffect(() => {
    if (preset && preset !== seenPreset.current && presetById.has(preset)) actions.loadPreset(preset)
    seenPreset.current = preset
  }, [preset, actions])
  useEffect(() => { document.title = '시각화 비교 — VizLab' }, [])
  const setLinked = useMemo(() => (rows: number[] | null) => setLinkedRows((prev) => {
    const next = rows ?? []
    return prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next
  }), [])

  const addPane = () => {
    const used = new Set(state.panes.map((p) => p.viz))
    const pool = [...(presetById.get(state.presetId ?? '')?.charts ?? []), ...FALLBACK_CHARTS]
    actions.addPane(pool.find((id) => !used.has(id)) ?? 'histogram')
  }

  return (
    <div className="compare" data-testid="compare">
      <header className="compare-head">
        <div>
          <h1>시각화 비교</h1>
          <p className="compare-sub">하나의 데이터를 여러 방식으로 그려 차이를 봅니다. 데이터는 함께, 설정은 차트마다 따로 바뀝니다.</p>
        </div>
      </header>

      <div className="preset-row" role="group" aria-label="추천 조합">
        {presets.map((p) => (
          <button key={p.id} type="button" className="chip" aria-pressed={state.presetId === p.id} title={p.note} onClick={() => navigate({ page: 'compare', preset: p.id })} data-testid={`preset-${p.id}`}>{p.name}</button>
        ))}
      </div>

      <div className="compare-toolbar" role="toolbar" aria-label="공유 데이터">
        <span className="compare-data-name" data-testid="compare-data-name">
          <Database size={15} aria-hidden="true" />{def?.name ?? `가져온 데이터: ${state.customName ?? ''}`}
          <small>{state.table.rows.length.toLocaleString()}행{state.edited ? ' · 편집됨' : ''}</small>
        </span>
        {def?.size && (
          <label className="compare-size">
            <span>{def.size.label}</span>
            <input type="range" min={def.size.min} max={def.size.max} step={def.size.step} value={state.n} aria-label={def.size.label} data-testid="compare-size-quick" onChange={(e) => actions.loadDataset(def.id, state.seed, Number(e.target.value))} />
            <output>{state.n.toLocaleString()}</output>
          </label>
        )}
        <div className="compare-actions">
          <button type="button" className="btn btn-secondary btn-sm" aria-pressed={dataOpen} onClick={() => setDataOpen(!dataOpen)} data-testid="compare-edit-data"><Database size={14} aria-hidden="true" />데이터 편집</button>
          {def?.size && <button type="button" className="btn btn-secondary btn-sm" onClick={() => actions.loadDataset(def.id, (state.seed * 48271 + 11) % 2147483647 || 1, state.n)} data-testid="compare-new-data"><Shuffle size={14} aria-hidden="true" />새 데이터 생성</button>}
          <button type="button" className="btn btn-secondary btn-sm" onClick={actions.reset} data-testid="compare-reset"><RotateCcw size={14} aria-hidden="true" />초기화</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={addPane} disabled={state.panes.length >= MAX_PANES} data-testid="compare-add"><Plus size={14} aria-hidden="true" />차트 추가</button>
        </div>
        <Toggle label="같은 관측값 함께 강조" checked={state.link} onChange={actions.setLink} testId="compare-link" />
      </div>

      {dataOpen && <CompareData state={state} actions={actions} onClose={() => setDataOpen(false)} />}

      <div className="compare-grid-wrap">
        <div className={`compare-grid panes-${state.panes.length}`} data-testid="compare-grid">
          {state.panes.map((pane, i) => (
            <Fragment key={pane.id}>
              <Pane index={i} pane={pane} state={state} actions={actions} canRemove={state.panes.length > 1} linkedRows={linkedRows} setLinked={setLinked} openData={() => setDataOpen(true)} />
            </Fragment>
          ))}
        </div>
      </div>
      <p className="compare-foot"><Link2 size={14} aria-hidden="true" />같은 표를 쓰므로 한 차트에서 점을 끌어 값을 바꾸면 다른 차트도 함께 바뀝니다. 차트가 이 데이터에 맞지 않으면 이유를 알려 드리며, 데이터를 임의로 바꿔 그리지 않습니다.</p>
    </div>
  )
}
