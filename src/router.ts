import { useCallback, useEffect, useState } from 'react'
import { categoryById } from './viz/catalog'
import type { CategoryId } from './viz/types'

/** Hash routes survive refresh on static hosting (GitHub Pages has no SPA fallback). */
export type Route =
  | { page: 'home' }
  | { page: 'catalog'; category: CategoryId | 'all' }
  | { page: 'viz'; id: string }

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').split('?')[0]
  const [head, arg] = path.split('/').map((s) => decodeURIComponent(s ?? ''))
  if (head === 'catalog') return { page: 'catalog', category: arg && categoryById.has(arg as CategoryId) ? (arg as CategoryId) : 'all' }
  if (head === 'viz' && arg) return { page: 'viz', id: arg }
  return { page: 'home' }
}

export function routeHref(route: Route) {
  if (route.page === 'catalog') return route.category === 'all' ? '#/catalog' : `#/catalog/${route.category}`
  if (route.page === 'viz') return `#/viz/${encodeURIComponent(route.id)}`
  return '#/'
}

export function useRoute() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const navigate = useCallback((next: Route) => {
    const href = routeHref(next)
    if (window.location.hash !== href) window.location.hash = href
    else setRoute(next)
  }, [])
  return [route, navigate] as const
}
