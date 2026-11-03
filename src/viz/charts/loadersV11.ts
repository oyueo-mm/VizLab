import type { VizModule } from '../types'

type Loader = () => Promise<VizModule>

/** Loaders of the visualization techniques added in v1.1 (merged into the registry in `index.ts`). */
export const loadersV11: Record<string, Loader> = {
  'hinton-diagram': () => import('./modelCharts11').then((m) => m.hintonModule),
  'taylor-diagram': () => import('./modelCharts11').then((m) => m.taylorModule),
  'target-diagram': () => import('./modelCharts11').then((m) => m.targetModule),
  nomogram: () => import('./modelCharts11').then((m) => m.nomogramModule),
  'piper-diagram': () => import('./modelCharts11').then((m) => m.piperModule),
  'stiff-diagram': () => import('./modelCharts11').then((m) => m.stiffModule),
  'skew-t': () => import('./modelCharts11').then((m) => m.skewTModule),
  'hasse-diagram': () => import('./modelCharts11').then((m) => m.hasseModule),
  'pythagoras-tree': () => import('./treeCharts11').then((m) => m.pythModule),
  'cactus-tree': () => import('./treeCharts11').then((m) => m.cactusModule),
  'history-flow': () => import('./treeCharts11').then((m) => m.flowModule),
  'matrix-cube': () => import('./dynCharts11').then((m) => m.cubeModule),
  'parallel-edge-splatting': () => import('./dynCharts11').then((m) => m.pesModule),
  'continuous-scatterplot': () => import('./dynCharts11').then((m) => m.csModule),
  'continuous-parallel-coordinates': () => import('./dynCharts11').then((m) => m.cpcModule),
  'spot-noise': () => import('./fieldCharts11').then((m) => m.spotModule),
  'stream-ribbons': () => import('./fieldCharts11').then((m) => m.ribbonModule),
  'rectangular-cartogram': () => import('./fieldCharts11').then((m) => m.rectCartoModule),
  'travel-time-cartogram': () => import('./fieldCharts11').then((m) => m.travelModule),
  'ring-map': () => import('./fieldCharts11').then((m) => m.ringMapModule),
}
