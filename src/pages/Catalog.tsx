import { ListFilter, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ChartPreview } from '../components/ChartPreview'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { routeHref, type Route } from '../router'
import { catalog, categories, categoryById, dataKinds, inCategory, searchCatalog, subcategories } from '../viz/catalog'
import { hasModule } from '../viz/charts'
import type { CategoryId, DataKind } from '../viz/types'

/** Only charts with a working implementation are listed. */
const available = catalog.filter((v) => hasModule(v.id))

interface Props {
  category: CategoryId | 'all'
  query: string
  kinds: DataKind[]
  /** Sub-category of the chosen category ('' = all). */
  sub: string
  navigate: (r: Route, options?: { replace?: boolean }) => void
}

export function Catalog({ category, query, kinds, sub, navigate }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const narrow = useMediaQuery('(max-width: 760px)')
  const [filtersOpen, setFiltersOpen] = useState(false)
  // Category, data type and search text are independent filters; all three live in the URL so Back, reload and shared links restore them.
  const go = (patch: Partial<{ category: CategoryId | 'all'; q: string; kinds: DataKind[]; sub: string }>, replace = false) =>
    navigate({ page: 'catalog', category: patch.category ?? category, q: patch.q ?? query, kinds: patch.kinds ?? kinds, sub: patch.category !== undefined && patch.category !== category ? '' : patch.sub ?? sub }, { replace })
  const subs = category === 'all' ? undefined : subcategories[category]
  const activeSub = subs?.some((x) => x.id === sub) ? sub : ''
  const results = searchCatalog(query, category, available, kinds, activeSub)
  const categoryCount = (c: CategoryId | 'all') => searchCatalog(query, c, available, kinds).length
  const subCount = (id: string) => searchCatalog(query, category, available, kinds, id).length
  const kindCount = (k: DataKind) => searchCatalog(query, category, available, [k]).length
  const title = category === 'all' ? '시각화 도감' : `${categoryById.get(category)?.name} 시각화`
  const active = (category !== 'all' ? 1 : 0) + (activeSub ? 1 : 0) + kinds.length + (query.trim() ? 1 : 0)
  const kindNames = kinds.map((k) => dataKinds.find((d) => d.id === k)?.name).filter(Boolean).join('·')

  useEffect(() => { document.title = `${title} — VizLab` }, [title])
  useEffect(() => {
    // "/" focuses search, like many documentation sites.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target as HTMLElement).closest('input, textarea, select')) { e.preventDefault(); inputRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toggleKind = (k: DataKind) => go({ kinds: kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k] })
  const showFilters = !narrow || filtersOpen

  return (
    <div className="catalog" data-testid="catalog">
      <header className="catalog-head">
        <h1>{title}</h1>
        <div className="search-box">
          <Search size={18} aria-hidden="true" />
          <input ref={inputRef} type="search" value={query} onChange={(e) => go({ q: e.target.value }, true)} placeholder="이름·영문명·키워드 검색 (예: 분포, density, 이상치)"
            aria-label="시각화 검색" data-testid="catalog-search" />
          {query && <button type="button" className="icon-btn-xs" aria-label="검색어 지우기" onClick={() => { go({ q: '' }, true); inputRef.current?.focus() }}><X size={15} /></button>}
        </div>
      </header>
      {narrow && (
        <button type="button" className="btn btn-secondary btn-sm filter-toggle" aria-expanded={filtersOpen} aria-controls="catalog-filters" onClick={() => setFiltersOpen(!filtersOpen)} data-testid="filter-toggle">
          <ListFilter size={15} aria-hidden="true" />필터{active > 0 && <b className="filter-count">{active}</b>}
        </button>
      )}
      <div id="catalog-filters" className="filter-groups" hidden={!showFilters}>
        <div className="filter-chips" role="group" aria-label="카테고리 필터">
          <button type="button" className="chip" aria-pressed={category === 'all'} onClick={() => go({ category: 'all' })} data-testid="chip-all">
            전체 <span>{categoryCount('all')}</span>
          </button>
          {categories.map((c) => {
            const total = available.filter((v) => inCategory(v, c.id)).length
            return (
              <button key={c.id} type="button" className="chip" aria-pressed={category === c.id} disabled={total === 0} title={total === 0 ? '준비 중' : c.description}
                onClick={() => go({ category: c.id })} data-testid={`chip-${c.id}`}>
                {c.name} <span>{total === 0 ? '준비 중' : categoryCount(c.id)}</span>
              </button>
            )
          })}
        </div>
        {subs && (
          <div className="filter-chips filter-subs" role="group" aria-label="하위 분류 필터" data-testid="sub-filters">
            <span className="filter-label">하위 분류</span>
            <button type="button" className="chip" aria-pressed={!activeSub} onClick={() => go({ sub: '' })} data-testid="sub-all">전체 <span>{categoryCount(category)}</span></button>
            {subs.map((x) => (
              <button key={x.id} type="button" className="chip" aria-pressed={activeSub === x.id} disabled={subCount(x.id) === 0 && activeSub !== x.id} onClick={() => go({ sub: x.id })} data-testid={`sub-${x.id}`}>
                {x.name} <span>{subCount(x.id)}</span>
              </button>
            ))}
          </div>
        )}
        <div className="filter-chips filter-kinds" role="group" aria-label="데이터 유형 필터">
          <span className="filter-label">데이터 유형</span>
          {dataKinds.map((k) => (
            <button key={k.id} type="button" className="chip" aria-pressed={kinds.includes(k.id)} title={k.description} onClick={() => toggleKind(k.id)} data-testid={`kind-${k.id}`}>
              {k.name} <span>{kindCount(k.id)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="result-bar" role="status" aria-live="polite">
        <span data-testid="result-count"><b>{results.length}</b>개 시각화{active > 0 && <small>{[category !== 'all' && categoryById.get(category)?.name, activeSub && subs?.find((x) => x.id === activeSub)?.name, kindNames, query.trim() && `‘${query.trim()}’`].filter(Boolean).join(' · ')}</small>}</span>
        {active > 0 && <button type="button" className="link-btn" onClick={() => navigate({ page: 'catalog', category: 'all', q: '', kinds: [], sub: '' })} data-testid="filter-reset"><X size={13} aria-hidden="true" />필터 초기화</button>}
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
          <p>조건에 맞는 시각화가 없습니다.</p>
          <button type="button" className="btn btn-secondary" onClick={() => navigate({ page: 'catalog', category: 'all', q: '', kinds: [] })} data-testid="empty-reset">필터 초기화</button>
        </div>
      )}
    </div>
  )
}
