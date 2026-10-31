import { Menu } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { useStoredState } from './hooks/storage'
import { useMediaQuery } from './hooks/useMediaQuery'
import { Catalog } from './pages/Catalog'
import { Home } from './pages/Home'
import { routeHref, useRoute } from './router'
import { vizById } from './viz/catalog'
import { hasModule } from './viz/charts'

// The lab (panels, data editor, chart modules) loads on first visit to a chart.
const LabPage = lazy(() => import('./lab/LabPage'))

export default function App() {
  const [route, navigate] = useRoute()
  const [collapsed, setCollapsed] = useStoredState('ui:sidebar-collapsed', false)
  const drawer = useMediaQuery('(max-width: 760px)')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const main = useRef<HTMLElement>(null)
  const known = route.page !== 'viz' || (vizById.has(route.id) && hasModule(route.id))
  const lab = route.page === 'viz' && known

  useEffect(() => {
    if (route.page === 'home') document.title = 'VizLab — 인터랙티브 데이터 시각화 백과사전'
    main.current?.scrollTo?.({ top: 0 })
    setDrawerOpen(false)
  }, [route])
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  return (
    <div className={`app-shell ${collapsed && !drawer ? 'nav-collapsed' : ''} ${lab ? 'is-lab' : ''} ${drawer ? 'is-narrow' : ''}`}>
      <a href="#main" className="skip-link" onClick={(e) => { e.preventDefault(); main.current?.focus() }}>본문으로 건너뛰기</a>
      <Sidebar route={route} collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} drawer={drawer} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <div className="app-main">
        {drawer && (
          <header className="mobile-bar">
            <button type="button" className="icon-btn" aria-label="메뉴 열기" aria-expanded={drawerOpen} aria-controls="sidebar" onClick={() => setDrawerOpen(true)} data-testid="mobile-menu"><Menu size={20} /></button>
            <a href="#/" className="mobile-brand">Viz<b>Lab</b></a>
          </header>
        )}
        <main id="main" ref={main} tabIndex={-1} className="page" inert={drawer && drawerOpen}>
          {route.page === 'home' && <Home />}
          {route.page === 'catalog' && <Catalog category={route.category} navigate={navigate} />}
          {route.page === 'viz' && (known
            ? <Suspense fallback={<div className="lab-loading" aria-busy="true" />}><LabPage key={route.id} id={route.id} /></Suspense>
            : (
              <div className="empty-state" data-testid="not-found">
                <p>‘{route.id}’ 시각화를 찾을 수 없습니다.</p>
                <a className="btn btn-secondary" href={routeHref({ page: 'catalog', category: 'all' })}>시각화 도감으로</a>
              </div>
            ))}
        </main>
      </div>
    </div>
  )
}
