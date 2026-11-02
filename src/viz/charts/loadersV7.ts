import type { VizModule } from '../types'

type Loader = () => Promise<VizModule>

/** Loaders of the visualization techniques added in v0.7 (merged into the registry in `index.ts`). */
export const loadersV7: Record<string, Loader> = {
  // multivariate / high-dimensional
  radviz: () => import('./multivarCharts7').then((m) => m.radvizModule),
  'star-coordinates': () => import('./multivarCharts7').then((m) => m.starModule),
  'grand-tour': () => import('./multivarCharts7').then((m) => m.tourModule),
  'dimensional-stacking': () => import('./multivarCharts7b').then((m) => m.stackModule),
  'table-lens': () => import('./multivarCharts7b').then((m) => m.lensModule),
  'recursive-pattern': () => import('./multivarCharts7b').then((m) => m.recursiveModule),
  'circle-segments': () => import('./multivarCharts7b').then((m) => m.segmentsModule),
  hyperslice: () => import('./multivarCharts7b').then((m) => m.hyperSliceModule),
  'pixel-bar-chart': () => import('./multivarCharts7b').then((m) => m.pixelBarModule),
  'chernoff-faces': () => import('./multivarCharts7b').then((m) => m.faceModule),
}
