import type { DatasetDef } from './datasets'
import { datasetsV5Geo } from './datasetsV5Geo'
import { datasetsV5Sci } from './datasetsV5Sci'
import { datasetsV5Stats } from './datasetsV5Stats'

/** Datasets added in v0.5, grouped by field. */
export const datasetsV5: DatasetDef[] = [...datasetsV5Geo, ...datasetsV5Stats, ...datasetsV5Sci]
