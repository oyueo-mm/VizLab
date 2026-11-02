import { baseDatasets } from './datasetsBase'
import { datasetsV3 } from './datasetsV3'
import { datasetsV4 } from './datasetsV4'
import { datasetsV5 } from './datasetsV5'
import { datasetsV6 } from './datasetsV6'
import type { DatasetIdV6 } from './datasetIdsV6'
import type { DatasetIdV7 } from './datasetIdsV7'
import type { DatasetIdV8 } from './datasetIdsV8'
import type { DatasetIdV9 } from './datasetIdsV9'
import { datasetsV7 } from './datasetsV7'
import { datasetsV7b } from './datasetsV7b'
import { datasetsV8 } from './datasetsV8'
import { datasetsV8b } from './datasetsV8b'
import { datasetsV9 } from './datasetsV9'
import type { DataTable } from './table'

export type DatasetId =
  | 'normal' | 'uniform' | 'bimodal' | 'skewed' | 'groups' | 'outliers'
  | 'pos-corr' | 'neg-corr' | 'dense' | 'timeseries' | 'categorical' | 'votes'
  | 'flowers' | 'cars' | 'players' | 'budget' | 'activity'
  | 'temps' | 'before-after' | 'cashflow' | 'streams' | 'league' | 'daily' | 'energy' | 'migration' | 'nutrition'
  | 'visits-dated' | 'sensors' | 'ohlc' | 'forecast' | 'pca-students' | 'pyramid' | 'defects' | 'kpi' | 'stage-flow' | 'network' | 'folders'
  | 'scores' | 'scores-imbalanced' | 'survey' | 'trajectory' | 'big-groups' | 'inventory'
  | 'kr-regions' | 'world-regions' | 'kr-flows' | 'world-flows' | 'geo-points' | 'studies' | 'studies-biased' | 'paired' | 'risk-model' | 'process' | 'process-counts'
  | 'conversion' | 'process-flow' | 'projects' | 'market' | 'profile' | 'affiliations' | 'modules'
  | 'terrain-hills' | 'temp-stations' | 'raster-grid' | 'wind-sources' | 'gps-tracks' | 'spatial-values' | 'kr-indicators' | 'kr-composition' | 'world-continents' | 'buffer-features' | 'tissot-grid'
  | 'regression-demo' | 'survival-trial' | 'process-shift' | 'forecast-overconfident' | 'forecast-calibrated'
  | 'surface-grid' | 'signal-chirp' | 'rp-series' | 'phase-seeds' | 'bifurcation-marks' | 'wind-obs' | 'soil-texture' | 'polar-curves' | 'points-2d' | 'hourly-visits' | 'yield-curves' | 'order-book' | 'spike-trials' | 'event-log' | 'lifelines' | 'kanban'
  | 'de-genes' | 'gwas-synth' | 'binding-sites' | 'coverage-synth' | 'microbiome-dist' | 'expression-matrix' | 'species-dist' | 'set-members'
  | DatasetIdV6
  | DatasetIdV7
  | DatasetIdV8
  | DatasetIdV9

export interface DatasetSize { min: number; max: number; default: number; step: number; label: string }

export interface DatasetDef {
  id: DatasetId
  name: string
  description: string
  /** Generated datasets can be resampled with a seed and size; fixed ones ignore both. */
  size?: DatasetSize
  generate: (seed: number, n: number) => DataTable
}

export const datasets: DatasetDef[] = [
  ...baseDatasets,
  ...datasetsV3,
  ...datasetsV4,
  ...datasetsV5,
  ...datasetsV6,
  ...datasetsV7,
  ...datasetsV7b,
  ...datasetsV8,
  ...datasetsV8b,
  ...datasetsV9,
]

export const datasetById = new Map(datasets.map((d) => [d.id, d]))
export const DEFAULT_SEED = 7

export function generateDataset(id: DatasetId, seed = DEFAULT_SEED, n?: number): DataTable {
  const def = datasetById.get(id)
  if (!def) throw new Error(`알 수 없는 데이터셋: ${id}`)
  const size = def.size ? Math.max(def.size.min, Math.min(def.size.max, n ?? def.size.default)) : 0
  return def.generate(seed, size)
}
