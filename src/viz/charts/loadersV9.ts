import type { VizModule } from '../types'

type Loader = () => Promise<VizModule>

/** Loaders of the visualization techniques added in v0.9 (merged into the registry in `index.ts`). */
export const loadersV9: Record<string, Loader> = {
  // sets
  metrosets: () => import('./setCharts9').then((m) => m.metroSetsModule),
  mosaicsets: () => import('./setCharts9').then((m) => m.mosaicSetsModule),
  infocrystal: () => import('./setCharts9').then((m) => m.infoCrystalModule),
  // dynamic relations, sequences, multivariate, hierarchy
  paohvis: () => import('./tempoCharts9').then((m) => m.paohModule),
  'set-streams': () => import('./tempoCharts9').then((m) => m.setStreamsModule),
  'sequence-braiding': () => import('./tempoCharts9').then((m) => m.braidModule),
  'dust-magnet': () => import('./multiCharts9').then((m) => m.dustMagnetModule),
  'gosper-map': () => import('./multiCharts9').then((m) => m.gosperMapModule),
  // text, geographic flow, focus+context, scientific visualization
  wordstream: () => import('./textCharts9').then((m) => m.wordStreamModule),
  tilebars: () => import('./textCharts9').then((m) => m.tileBarsModule),
  'od-maps': () => import('./geoFocusCharts9').then((m) => m.odMapModule),
  'perspective-wall': () => import('./geoFocusCharts9').then((m) => m.wallModule),
  ibfv: () => import('./sciCharts9').then((m) => m.ibfvModule),
  hyperstreamlines: () => import('./sciCharts9').then((m) => m.hyperModule),
  'fiber-surfaces': () => import('./sciCharts9').then((m) => m.fiberModule),
}
