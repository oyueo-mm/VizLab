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
  // distribution and uncertainty
  'quantile-dotplot': () => import('./uncertCharts7').then((m) => m.quantileModule),
  hops: () => import('./uncertCharts7').then((m) => m.hopModule),
  'gradient-plot': () => import('./uncertCharts7').then((m) => m.gradientModule),
  'wilkinson-dotplot': () => import('./uncertCharts7').then((m) => m.wilkinsonModule),
  punchcard: () => import('./uncertCharts7').then((m) => m.punchModule),
  // sets, hierarchy, text, pixel curves
  'parallel-sets': () => import('./structCharts7').then((m) => m.psModule),
  'word-cloud': () => import('./structCharts7').then((m) => m.cloudModule),
  'word-tree': () => import('./structCharts7').then((m) => m.wordTreeModule),
  'space-filling-curve': () => import('./structCharts7').then((m) => m.curveModule),
  'voronoi-treemap': () => import('./structCharts7').then((m) => m.vtModule),
  tanglegram: () => import('./structCharts7').then((m) => m.tangleModule),
  // temporal
  'time-curves': () => import('./timeCharts7').then((m) => m.timeCurveModule),
  'marey-chart': () => import('./timeCharts7').then((m) => m.mareyModule),
  lifelines: () => import('./timeCharts7').then((m) => m.lifelinesModule),
  // science and geospatial
  'line-integral-convolution': () => import('./sciCharts7').then((m) => m.licModule),
  'globe-3d': () => import('./sciCharts7').then((m) => m.globeModule),
  'multi-planar-reconstruction': () => import('./sciCharts7').then((m) => m.mprModule),
}
