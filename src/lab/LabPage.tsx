import { Database, Maximize2, Minimize2, MousePointerClick, PanelRightClose, PanelRightOpen, Redo2, RotateCcw, SlidersHorizontal, Undo2, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { ChartBoundary } from '../components/ChartBoundary'
import { useStoredState } from '../hooks/storage'
import { useFullscreen } from '../hooks/useFullscreen'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useSize } from '../hooks/useSize'
import { routeHref } from '../router'
import { categoryById, vizById } from '../viz/catalog'
import { useVizModule } from '../viz/charts'
import { mappingErrors } from '../viz/mapping'
import type { VizModule } from '../viz/types'
import { DataPanel } from './DataPanel'
import { Related } from './Related'
import { useLabState } from './state'

type Tab = 'settings' | 'data'

// KaTeX is only needed once the details section is opened.
const Details = lazy(() => import('./Details'))

/** Loads the chart implementation, then shows the lab. */
export default function LabPage({ id }: { id: string }) {
  const { mod, error } = useVizModule(id)
  if (error) return <div className="empty-state" role="alert"><p>시각화를 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 새로고침하세요.</p></div>
  if (!mod) return <div className="lab-loading" aria-busy="true" data-testid="lab-loading" />
  return <Lab id={id} mod={mod} />
}

function Lab({ id, mod }: { id: string; mod: VizModule }) {
  const meta = vizById.get(id)!
  const { state, actions, canUndo, canRedo } = useLabState(id, mod)
  const [panelOpen, setPanelOpen] = useStoredState('ui:panel-open', true)
  const [tab, setTab] = useStoredState<Tab>('ui:panel-tab', 'settings')
  const [wide, setWide] = useState(false)
  const [detailsOpen, setDetailsOpen] = useStoredState('ui:details-open', false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [canvasRef, size] = useSize<HTMLDivElement>()
  const { ref: stageRef, expanded, fallback, toggle } = useFullscreen<HTMLDivElement>()
  const errors = mappingErrors(mod.roles, state.table, state.mapping)
  const narrow = useMediaQuery('(max-width: 900px)')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable]')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) actions.redo(); else actions.undo() }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); actions.redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [actions])

  useEffect(() => { document.title = `${meta.name} (${meta.nameEn}) — VizLab` }, [meta])

  const Controls = mod.Controls
  const showPanel = narrow ? sheetOpen : panelOpen
  const openTab = (t: Tab) => { setTab(t); if (narrow) setSheetOpen(true); else setPanelOpen(true) }

  return (
    <div className={`lab ${detailsOpen ? 'details-open' : ''}`} data-testid="lab" data-viz={id}>
      <header className="lab-header">
        <div className="lab-title">
          <p className="lab-crumb"><a href={routeHref({ page: 'catalog', category: meta.category })}>{categoryById.get(meta.category)?.name}</a></p>
          <h1>{meta.name} <span className="lab-en">{meta.nameEn}</span></h1>
          <p className="lab-summary">{meta.summary}</p>
        </div>
        <div className="lab-actions" role="toolbar" aria-label="실험 도구">
          <button type="button" className="icon-btn" onClick={actions.undo} disabled={!canUndo} aria-label="실행 취소 (Ctrl+Z)" data-tip="실행 취소" data-testid="undo"><Undo2 size={18} /></button>
          <button type="button" className="icon-btn" onClick={actions.redo} disabled={!canRedo} aria-label="다시 실행 (Ctrl+Shift+Z)" data-tip="다시 실행" data-testid="redo"><Redo2 size={18} /></button>
          <button type="button" className="btn btn-secondary" onClick={actions.reset} data-testid="reset"><RotateCcw size={16} aria-hidden="true" />초기화</button>
          <button type="button" className="icon-btn" onClick={() => void toggle()} aria-label={expanded ? '전체 화면 종료' : '전체 화면'} data-tip={expanded ? '전체 화면 종료' : '전체 화면'} data-testid="fullscreen">
            {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          {!narrow && (
            <button type="button" className="icon-btn" onClick={() => setPanelOpen(!panelOpen)} aria-label={panelOpen ? '설정 패널 접기' : '설정 패널 펼치기'} aria-expanded={panelOpen} aria-controls="settings-panel"
              data-tip={panelOpen ? '패널 접기' : '패널 펼치기'} data-testid="panel-toggle">
              {panelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
            </button>
          )}
        </div>
      </header>

      <div className={`lab-body ${showPanel && !narrow ? 'has-panel' : ''} ${wide ? 'is-wide' : ''}`}>
        <div ref={stageRef} className={`lab-stage ${fallback ? 'is-expanded' : ''}`}>
          {mod.hint && (
            <p className="stage-hint"><MousePointerClick size={15} aria-hidden="true" />{mod.hint}</p>
          )}
          <div ref={canvasRef} className="lab-canvas" data-testid="lab-canvas">
            {errors.length > 0 ? (
              <div className="chart-message" role="alert">
                {errors.map((e) => <p key={e}>{e}</p>)}
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => openTab('data')}><Database size={14} aria-hidden="true" />데이터 설정 열기</button>
              </div>
            ) : size.width > 0 && size.height > 0 && (
              <ChartBoundary resetKey={`${state.table.rows.length}|${JSON.stringify(state.mapping)}|${JSON.stringify(state.params)}`}>
                <mod.Chart table={state.table} mapping={state.mapping} params={state.params} setParams={actions.setParams} width={size.width} height={size.height} onTableChange={actions.setTable} />
              </ChartBoundary>
            )}
          </div>
          {expanded && <button type="button" className="icon-btn stage-exit" onClick={() => void toggle()} aria-label="전체 화면 종료" data-testid="fullscreen-exit"><X size={18} /></button>}
          {narrow && (
            <div className="mobile-tools">
              <button type="button" className="btn btn-secondary" onClick={() => openTab('settings')} data-testid="open-settings"><SlidersHorizontal size={16} aria-hidden="true" />설정</button>
              <button type="button" className="btn btn-secondary" onClick={() => openTab('data')} data-testid="open-data"><Database size={16} aria-hidden="true" />데이터</button>
            </div>
          )}
        </div>

        {narrow && sheetOpen && <button type="button" className="sheet-backdrop" aria-label="설정 닫기" tabIndex={-1} onClick={() => setSheetOpen(false)} />}
        <aside id="settings-panel" className={`settings-panel ${narrow ? 'is-sheet' : ''} ${showPanel ? 'is-open' : ''}`} aria-label="설정 패널" hidden={!showPanel} data-testid="settings-panel">
          <div className="panel-tabs" role="tablist" aria-label="패널 탭">
            <button type="button" role="tab" id="tab-settings" aria-selected={tab === 'settings'} aria-controls="tabpanel" onClick={() => setTab('settings')} data-testid="tab-settings"><SlidersHorizontal size={15} aria-hidden="true" />설정</button>
            <button type="button" role="tab" id="tab-data" aria-selected={tab === 'data'} aria-controls="tabpanel" onClick={() => setTab('data')} data-testid="tab-data"><Database size={15} aria-hidden="true" />데이터</button>
            {!narrow && tab === 'data' && (
              <button type="button" className="panel-wide" onClick={() => setWide(!wide)} aria-pressed={wide}>{wide ? '좁게' : '넓게'}</button>
            )}
            {narrow && <button type="button" className="icon-btn-xs panel-close" aria-label="설정 닫기" data-testid="sheet-close" onClick={() => setSheetOpen(false)}><X size={16} /></button>}
          </div>
          <div id="tabpanel" role="tabpanel" aria-labelledby={tab === 'settings' ? 'tab-settings' : 'tab-data'} className="panel-body">
            {tab === 'settings' ? (
              <>
                {Controls && errors.length === 0 ? <Controls params={state.params} setParams={actions.setParams} table={state.table} mapping={state.mapping} setTable={actions.setTable} /> : <p className="control-hint">데이터 매핑을 먼저 완료하세요.</p>}
                <section className="control-group">
                  <p className="control-group-title">관련 시각화</p>
                  <Related id={id} compact />
                </section>
              </>
            ) : (
              <DataPanel mod={mod} state={state} actions={actions} />
            )}
          </div>
        </aside>
      </div>

      <Suspense fallback={<div className="lab-details" />}>
        <Details id={id} open={detailsOpen} onToggle={() => setDetailsOpen(!detailsOpen)} />
      </Suspense>
    </div>
  )
}
