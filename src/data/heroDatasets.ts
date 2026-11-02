import type { DatasetDef, DatasetId } from './datasets'
import { baseDatasets } from './datasetsBase'
import { datasetsV3 } from './datasetsV3'
import { datasetsV4 } from './datasetsV4'
import type { DataTable } from './table'

/**
 * The few datasets the home animation's own stages use. Keeping them apart from `datasets.ts` keeps the other ~200 dataset generators out of the
 * first load (the home page and catalog never need them; labs and the comparison page load them with their own chunks).
 */
const DEFAULT_SEED = 7 // the same default as `generateDataset`
const byId = new Map<DatasetId, DatasetDef>([...baseDatasets, ...datasetsV3, ...datasetsV4].map((d) => [d.id, d]))

export function generateHeroDataset(id: DatasetId, seed = DEFAULT_SEED, n?: number): DataTable {
  const def = byId.get(id)
  if (!def) throw new Error(`홈 애니메이션에 없는 데이터셋: ${id}`)
  const size = def.size ? Math.max(def.size.min, Math.min(def.size.max, n ?? def.size.default)) : 0
  return def.generate(seed, size)
}
