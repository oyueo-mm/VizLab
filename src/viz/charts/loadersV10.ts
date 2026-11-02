import type { VizModule } from '../types'

type Loader = () => Promise<VizModule>

/** Loaders of the visualization techniques added in v1.0 (merged into the registry in `index.ts`). */
export const loadersV10: Record<string, Loader> = {
  zame: () => import('./infoCharts10').then((m) => m.zameModule),
  'excentric-labeling': () => import('./infoCharts10').then((m) => m.excentricModule),
  lineup: () => import('./infoCharts10').then((m) => m.lineUpModule),
  'unit-visualization': () => import('./infoCharts10').then((m) => m.unitModule),
  splatterplot: () => import('./infoCharts10').then((m) => m.splatModule),
  'contour-tree': () => import('./topoCharts10').then((m) => m.contourTreeModule),
  'persistence-diagram': () => import('./topoCharts10').then((m) => m.persistenceModule),
  'topological-landscape': () => import('./topoCharts10').then((m) => m.landscapeModule),
  'probabilistic-isocontour': () => import('./topoCharts10').then((m) => m.probIsoModule),
  'functional-boxplot': () => import('./statCharts10').then((m) => m.fbModule),
  'stem-and-leaf': () => import('./statCharts10').then((m) => m.stemModule),
  'sunflower-plot': () => import('./statCharts10').then((m) => m.sunModule),
  'hanging-rootogram': () => import('./statCharts10').then((m) => m.rootModule),
  'lorenz-curve': () => import('./statCharts10').then((m) => m.lorenzModule),
  'tornado-chart': () => import('./statCharts10').then((m) => m.tornadoModule),
  bagplot: () => import('./statCharts10b').then((m) => m.bagModule),
  'diverging-stacked-bar': () => import('./statCharts10b').then((m) => m.divModule),
  'decision-curve': () => import('./statCharts10b').then((m) => m.dcaModule),
  'contour-boxplot': () => import('./treeCharts10').then((m) => m.cbModule),
  spacetree: () => import('./treeCharts10').then((m) => m.spaceTreeModule),
}
