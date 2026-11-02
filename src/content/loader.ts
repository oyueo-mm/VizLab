import { catalogV5 } from '../viz/catalogV5'
import { catalogV6 } from '../viz/catalogV6'
import { catalogV7 } from '../viz/catalogV7'
import { catalogV8 } from '../viz/catalogV8'
import { catalogV8Net } from '../viz/catalogV8Net'
import { catalogV8Rel } from '../viz/catalogV8Rel'
import { catalogV8Sci } from '../viz/catalogV8Sci'
import { catalogV9 } from '../viz/catalogV9'
import { conceptNotes } from './notes'
import type { VizContent } from './types'

/** Explanations are split by the version that introduced the chart; a lab loads only the group that holds its own text. */
export type ContentGroup = 'legacy' | 'v5' | 'v6' | 'v7' | 'v8' | 'v9'

const ids = (list: readonly { id: string }[]) => new Set(list.map((m) => m.id))
const groups: [ContentGroup, Set<string>][] = [
  ['v5', ids(catalogV5)], ['v6', ids(catalogV6)], ['v7', ids(catalogV7)], ['v8', ids([...catalogV8, ...catalogV8Net, ...catalogV8Rel, ...catalogV8Sci])], ['v9', ids(catalogV9)],
]

/** The group of explanations that holds chart `id` (charts that no newer catalog lists belong to the original v0.1–v0.4 group). */
export const contentGroupOf = (id: string): ContentGroup => groups.find(([, set]) => set.has(id))?.[0] ?? 'legacy'

const importers: Record<ContentGroup, () => Promise<Record<string, VizContent>>> = {
  legacy: () => import('./legacy').then((m) => m.contentLegacy),
  v5: () => import('./v5').then((m) => m.contentV5),
  v6: () => import('./v6').then((m) => m.contentV6),
  v7: () => import('./v7').then((m) => m.contentV7),
  v8: () => import('./v8').then((m) => m.contentV8),
  v9: () => import('./v9').then((m) => m.contentV9),
}

const cache = new Map<ContentGroup, Promise<Record<string, VizContent>>>()

/** Loads the explanation of a chart (undefined when there is none). A failed load is not cached, so opening the section again retries it. */
export async function loadContent(id: string): Promise<VizContent | undefined> {
  const g = contentGroupOf(id)
  let p = cache.get(g)
  if (!p) {
    p = importers[g]()
    cache.set(g, p)
    p.catch(() => cache.delete(g))
  }
  const c = (await p)[id]
  return c && conceptNotes[id] ? { ...c, note: conceptNotes[id] } : c
}
