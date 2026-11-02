import { useCallback, useEffect, useState } from 'react'
import { categoryById, dataKindById } from './viz/catalog'
import { encodingById, type EncodingId } from './viz/encodings'
import { kindById, type VizKind } from './viz/kinds'
import type { CategoryId, DataKind } from './viz/types'

/** Hash routes survive refresh on static hosting (GitHub Pages has no SPA fallback). */
export type Route =
  | { page: 'home' }
  | { page: 'catalog'; category: CategoryId | 'all'; q?: string; kinds?: DataKind[]; sub?: string; kind?: VizKind; encoding?: EncodingId }
  | { page: 'compare'; preset?: string }
  | { page: 'viz'; id: string }

export function parseHash(hash: string): Route {
  const [rawPath, rawQuery = ''] = hash.replace(/^#\/?/, '').split('?')
  const [head, arg] = rawPath.split('/').map((s) => decodeURIComponent(s ?? ''))
  if (head === 'catalog') {
    const params = new URLSearchParams(rawQuery)
    const kinds = (params.get('t') ?? '').split(',').filter((k): k is DataKind => dataKindById.has(k as DataKind))
    const q = params.get('q') ?? ''
    const sub = params.get('s') ?? ''
    const kindParam = params.get('k') ?? ''
    const kind = kindById.has(kindParam as VizKind) ? (kindParam as VizKind) : undefined
    const encParam = params.get('e') ?? ''
    const encoding = encodingById.has(encParam as EncodingId) ? (encParam as EncodingId) : undefined
    // q / kinds are only present when set, so plain catalog URLs parse exactly as in v0.2.
    return { page: 'catalog', category: arg && categoryById.has(arg as CategoryId) ? (arg as CategoryId) : 'all', ...(q ? { q } : {}), ...(kinds.length ? { kinds: [...new Set(kinds)] } : {}), ...(sub ? { sub } : {}), ...(kind ? { kind } : {}), ...(encoding ? { encoding } : {}) }
  }
  if (head === 'compare') return { page: 'compare', preset: arg || undefined }
  if (head === 'viz' && arg) return { page: 'viz', id: arg }
  return { page: 'home' }
}

export function routeHref(route: Route) {
  if (route.page === 'catalog') {
    const params = new URLSearchParams()
    if (route.q?.trim()) params.set('q', route.q)
    if (route.kinds?.length) params.set('t', route.kinds.join(','))
    if (route.sub) params.set('s', route.sub)
    if (route.kind) params.set('k', route.kind)
    if (route.encoding) params.set('e', route.encoding)
    const query = params.toString()
    return `${route.category === 'all' ? '#/catalog' : `#/catalog/${route.category}`}${query ? `?${query}` : ''}`
  }
  if (route.page === 'compare') return route.preset ? `#/compare/${encodeURIComponent(route.preset)}` : '#/compare'
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
  /** `replace` rewrites the current history entry (used while typing a search) so Back still leaves the page. */
  const navigate = useCallback((next: Route, options?: { replace?: boolean }) => {
    const href = routeHref(next)
    if (options?.replace) {
      window.history.replaceState(null, '', href)
      setRoute(parseHash(href))
    } else if (window.location.hash !== href) {
      window.location.hash = href
      // Update the state now rather than waiting for the hashchange event, so a handler that runs right after sees the new route.
      setRoute(parseHash(href))
    } else setRoute(next)
  }, [])
  return [route, navigate] as const
}
