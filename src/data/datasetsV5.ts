import type { DatasetDef } from './datasets'
import { datasetsV5Bio } from './datasetsV5Bio'
import { datasetsV5Fin } from './datasetsV5Fin'
import { datasetsV5Geo } from './datasetsV5Geo'
import { datasetsV5Misc } from './datasetsV5Misc'
import { datasetsV5Sci } from './datasetsV5Sci'
import { datasetsV5Stats } from './datasetsV5Stats'

/** Datasets added in v0.5, grouped by field. */
export const datasetsV5: DatasetDef[] = [...datasetsV5Geo, ...datasetsV5Stats, ...datasetsV5Sci, ...datasetsV5Fin, ...datasetsV5Misc, ...datasetsV5Bio]
