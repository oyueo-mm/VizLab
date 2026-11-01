import type { DatasetDef } from './datasets'
import { datasetsV6Ml } from './datasetsV6Ml'
import { datasetsV6Field } from './datasetsV6Field'
import { datasetsV6Geo } from './datasetsV6Geo'
import { datasetsV6Sci } from './datasetsV6Sci'
import { datasetsV6Stats } from './datasetsV6Stats'

/** Datasets added in v0.6, grouped by field. */
export const datasetsV6: DatasetDef[] = [...datasetsV6Ml, ...datasetsV6Stats, ...datasetsV6Sci, ...datasetsV6Field, ...datasetsV6Geo]
