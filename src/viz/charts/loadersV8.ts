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
  // three-dimensional
  'cone-tree': () => import('./coneTree8').then((m) => m.coneTreeModule),
  'stream-surface': () => import('./fieldCharts8').then((m) => m.streamSurfaceModule),
  streamtube: () => import('./fieldCharts8').then((m) => m.streamtubeModule),
  // attribute networks, sequences, flows, text
  'semantic-substrates': () => import('./relateCharts8').then((m) => m.substrateModule),
  'pivot-graph': () => import('./relateCharts8').then((m) => m.pivotModule),
  timearcs: () => import('./relateCharts8').then((m) => m.timeArcsModule),
  lifeflow: () => import('./seqCharts8').then((m) => m.lifeFlowModule),
  timesets: () => import('./seqCharts8').then((m) => m.timeSetsModule),
  flowstrates: () => import('./seqCharts8').then((m) => m.flowstratesModule),
  textarc: () => import('./textCharts8').then((m) => m.textArcModule),
  'parallel-tag-clouds': () => import('./textCharts8').then((m) => m.parallelTagModule),
  'phrase-net': () => import('./textCharts8').then((m) => m.phraseNetModule),
  // networks
  nodetrix: () => import('./graphCharts8').then((m) => m.nodeTrixModule),
  'power-graph': () => import('./graphCharts8').then((m) => m.powerGraphModule),
  'confluent-drawing': () => import('./graphCharts8').then((m) => m.confluentModule),
}
