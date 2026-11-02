import type { VizModule } from '../types'

type Loader = () => Promise<VizModule>

/** Loaders of the visualization techniques added in v0.8 (merged into the registry in `index.ts`). */
export const loadersV8: Record<string, Loader> = {
  // sets
  'bubble-sets': () => import('./setCharts8').then((m) => m.bubbleSetsModule),
  linesets: () => import('./setCharts8').then((m) => m.lineSetsModule),
  'kelp-diagram': () => import('./setCharts8').then((m) => m.kelpModule),
  'rainbow-boxes': () => import('./setCharts8').then((m) => m.rainbowBoxesModule),
  'radial-sets': () => import('./setCharts8').then((m) => m.radialSetsModule),
}
