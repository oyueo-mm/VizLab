import { ChartPreview } from '../components/ChartPreview'
import { routeHref } from '../router'
import { vizById } from '../viz/catalog'
import { hasModule } from '../viz/charts'

export function Related({ id, compact }: { id: string; compact?: boolean }) {
  const meta = vizById.get(id)
  const related = (meta?.related ?? []).filter((r) => hasModule(r) && vizById.has(r))
  if (!related.length) return null
  return (
    <div className={`related ${compact ? 'is-compact' : ''}`}>
      {related.map((r) => {
        const m = vizById.get(r)!
        return (
          <a key={r} href={routeHref({ page: 'viz', id: r })} className="related-card" data-testid={`related-${r}`}>
            {!compact && <ChartPreview id={r} />}
            <span><b>{m.name}</b><small>{m.nameEn}</small></span>
          </a>
        )
      })}
    </div>
  )
}
