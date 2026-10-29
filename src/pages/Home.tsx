import { ArrowRight } from 'lucide-react'
import { ChartPreview } from '../components/ChartPreview'
import { categoryIcons } from '../components/icons'
import { routeHref } from '../router'
import { catalog, categories, inCategory, vizById } from '../viz/catalog'
import { modules } from '../viz/charts'
import { HeroDemo } from './HeroDemo'

const featured = ['scatter', 'histogram', 'violin', 'stacked-bar', 'heatmap', 'treemap']

export function Home() {
  return (
    <div className="home" data-testid="home">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <h1 id="hero-title">VizLab</h1>
          <p className="hero-sub">인터랙티브 데이터 시각화 백과사전</p>
          <a href={routeHref({ page: 'catalog', category: 'all' })} className="btn btn-primary btn-lg" data-testid="hero-cta">
            시각화 둘러보기<ArrowRight size={18} aria-hidden="true" />
          </a>
        </div>
        <HeroDemo />
      </section>

      <section className="home-section" aria-labelledby="featured-title">
        <h2 id="featured-title">대표 시각화</h2>
        <div className="card-grid is-featured">
          {featured.filter((id) => modules[id]).map((id) => {
            const m = vizById.get(id)!
            return (
              <a key={id} href={routeHref({ page: 'viz', id })} className="viz-card" data-testid={`featured-${id}`}>
                <ChartPreview id={id} />
                <span className="viz-card-name"><b>{m.name}</b><small>{m.nameEn}</small></span>
              </a>
            )
          })}
        </div>
      </section>

      <section className="home-section" aria-labelledby="category-title">
        <h2 id="category-title">카테고리별 탐색</h2>
        <div className="category-grid">
          {categories.map((c) => {
            const items = catalog.filter((v) => inCategory(v, c.id) && modules[v.id])
            const Icon = categoryIcons[c.id]
            const inner = (
              <>
                <span className="category-icon"><Icon size={20} aria-hidden="true" strokeWidth={1.8} /></span>
                <span className="category-text"><b>{c.name}</b><small>{items.length ? items.slice(0, 3).map((v) => v.name).join(' · ') + (items.length > 3 ? ' 외' : '') : '준비 중'}</small></span>
              </>
            )
            return items.length
              ? <a key={c.id} href={routeHref({ page: 'catalog', category: c.id })} className="category-tile" data-testid={`home-cat-${c.id}`}>{inner}</a>
              : <span key={c.id} className="category-tile is-disabled" aria-disabled="true">{inner}</span>
          })}
        </div>
      </section>
    </div>
  )
}
