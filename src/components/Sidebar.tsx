import { GitCompareArrows, House, LayoutGrid, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { routeHref, type Route } from '../router'
import { catalog, categories, inCategory } from '../viz/catalog'
import { hasModule } from '../viz/charts'
import { categoryIcons } from './icons'

interface Props {
  route: Route
  collapsed: boolean
  onToggle: () => void
  /** Narrow screens: the sidebar is an overlay drawer. */
  drawer: boolean
  open: boolean
  onClose: () => void
}

export function Sidebar({ route, collapsed, onToggle, drawer, open, onClose }: Props) {
  const iconOnly = collapsed && !drawer
  const current = (r: Route) => {
    if (r.page !== route.page) return false
    if (r.page === 'catalog' && route.page === 'catalog') return r.category === route.category
    return true
  }
  const vizCategory = route.page === 'viz' ? catalog.find((v) => v.id === route.id)?.category : undefined
  const item = (r: Route, label: string, Icon: typeof House, extra?: { count?: number; disabled?: boolean; active?: boolean; testId?: string }) => {
    const active = current(r) || extra?.active
    const cls = `nav-item ${active ? 'is-active' : ''} ${extra?.disabled ? 'is-disabled' : ''}`
    const body = (
      <>
        <Icon size={19} aria-hidden="true" strokeWidth={1.8} />
        <span className="nav-label">{label}</span>
        {extra?.count != null && <span className="nav-count nav-label">{extra.disabled ? '준비 중' : extra.count}</span>}
      </>
    )
    if (extra?.disabled) return <span className={cls} aria-disabled="true" title={iconOnly ? `${label} (준비 중)` : undefined} data-tip={iconOnly ? `${label} · 준비 중` : undefined}>{body}</span>
    return (
      <a href={routeHref(r)} className={cls} aria-current={active ? 'page' : undefined} onClick={drawer ? onClose : undefined}
        data-tip={iconOnly ? label : undefined} aria-label={iconOnly ? label : undefined} data-testid={extra?.testId}>
        {body}
      </a>
    )
  }
  return (
    <>
      {drawer && open && <button type="button" className="nav-backdrop" aria-label="메뉴 닫기" tabIndex={-1} onClick={onClose} />}
      <aside id="sidebar" className={`sidebar ${iconOnly ? 'is-collapsed' : ''} ${drawer ? 'is-drawer' : ''} ${open ? 'is-open' : ''}`} aria-label="주 메뉴" inert={drawer && !open} data-testid="sidebar">
        <div className="sidebar-head">
          <a href="#/" className="brand" aria-label="VizLab 홈" onClick={drawer ? onClose : undefined}>
            <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 20 20" width="18" height="18"><rect x="3" y="10" width="3" height="7" rx="1" /><rect x="8.5" y="6" width="3" height="11" rx="1" /><rect x="14" y="3" width="3" height="14" rx="1" /></svg></span>
            <span className="brand-name nav-label">Viz<b>Lab</b></span>
          </a>
          <button type="button" className="icon-btn sidebar-toggle" onClick={drawer ? onClose : onToggle}
            aria-label={drawer ? '메뉴 닫기' : collapsed ? '사이드바 펼치기' : '사이드바 접기'} aria-expanded={drawer ? open : !collapsed} aria-controls="sidebar-nav" data-testid="sidebar-toggle"
            data-tip={iconOnly ? '사이드바 펼치기' : undefined}>
            {drawer ? <X size={18} /> : collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        <nav id="sidebar-nav" className="sidebar-nav" aria-label="페이지">
          {item({ page: 'home' }, '홈', House, { testId: 'nav-home' })}
          {item({ page: 'catalog', category: 'all' }, '시각화 도감', LayoutGrid, { testId: 'nav-catalog' })}
          {item({ page: 'compare' }, '시각화 비교', GitCompareArrows, { testId: 'nav-compare' })}
          <p className="nav-caption nav-label">카테고리</p>
          {categories.map((c) => {
            const count = catalog.filter((v) => inCategory(v, c.id) && hasModule(v.id)).length
            return <div key={c.id}>{item({ page: 'catalog', category: c.id }, c.name, categoryIcons[c.id], { count, disabled: count === 0, active: vizCategory === c.id, testId: `nav-cat-${c.id}` })}</div>
          })}
        </nav>
      </aside>
    </>
  )
}
