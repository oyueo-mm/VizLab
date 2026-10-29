import { Search, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { ChartPreview } from '../components/ChartPreview'
import { useStoredState } from '../hooks/storage'
import { routeHref, type Route } from '../router'
import { catalog, categories, categoryById, inCategory, searchCatalog } from '../viz/catalog'
import { modules } from '../viz/charts'
import type { CategoryId } from '../viz/types'

/** Only charts with a working implementation are listed. */
const available = catalog.filter((v) => modules[v.id])

export function Catalog({ category, navigate }: { category: CategoryId | 'all'; navigate: (r: Route) => void }) {
  const [query, setQuery] = useStoredState('catalog:query', '')
  const inputRef = useRef<HTMLInputElement>(null)
  const results = searchCatalog(query, category, available)
  const counts = Object.fromEntries(categories.map((c) => [c.id, searchCatalog(query, c.id, available).length]))
  const title = category === 'all' ? '시각화 도감' : `${categoryById.get(category)?.name} 시각화`

  useEffect(() => { document.title = `${title} — VizLab` }, [title])
  useEffect(() => {
    // "/" focuses search, like many documentation sites.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target as HTMLElement).closest('input, textarea, select')) { e.preventDefault(); inputRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="catalog" data-testid="catalog">
      <header className="catalog-head">
        <h1>{title}</h1>
        <div className="search-box">
          <Search size={18} aria-hidden="true" />
          <input ref={inputRef} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름·영문명·키워드 검색 (예: 분포, density, 이상치)"
            aria-label="시각화 검색" data-testid="catalog-search" />
          {query && <button type="button" className="icon-btn-xs" aria-label="검색어 지우기" onClick={() => { setQuery(''); inputRef.current?.focus() }}><X size={15} /></button>}
        </div>
      </header>
      <div className="filter-chips" role="group" aria-label="카테고리 필터">
        <button type="button" className="chip" aria-pressed={category === 'all'} onClick={() => navigate({ page: 'catalog', category: 'all' })} data-testid="chip-all">
          전체 <span>{searchCatalog(query, 'all', available).length}</span>
        </button>
        {categories.map((c) => {
          const total = available.filter((v) => inCategory(v, c.id)).length
          return (
            <button key={c.id} type="button" className="chip" aria-pressed={category === c.id} disabled={total === 0} title={total === 0 ? '준비 중' : c.description}
              onClick={() => navigate({ page: 'catalog', category: c.id })} data-testid={`chip-${c.id}`}>
              {c.name} <span>{total === 0 ? '준비 중' : counts[c.id]}</span>
            </button>
          )
        })}
      </div>
      {results.length ? (
        <div className="card-grid" data-testid="catalog-grid">
          {results.map((m) => (
            <a key={m.id} href={routeHref({ page: 'viz', id: m.id })} className="viz-card" data-testid={`card-${m.id}`}>
              <ChartPreview id={m.id} />
              <span className="viz-card-name"><b>{m.name}</b><small>{m.nameEn}</small></span>
            </a>
          ))}
        </div>
      ) : (
        <div className="empty-state" data-testid="catalog-empty">
          <p>‘{query}’에 맞는 시각화가 {category === 'all' ? '' : `${categoryById.get(category)?.name} 카테고리에 `}없습니다.</p>
          {category !== 'all' && <button type="button" className="btn btn-secondary" onClick={() => navigate({ page: 'catalog', category: 'all' })}>전체 카테고리에서 찾기</button>}
        </div>
      )}
    </div>
  )
}
