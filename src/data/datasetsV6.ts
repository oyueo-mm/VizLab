import type { DatasetDef } from './datasets'
import { datasetsV6Ml } from './datasetsV6Ml'
import { datasetsV6Stats } from './datasetsV6Stats'

/** Datasets added in v0.6, grouped by field. */
export const datasetsV6: DatasetDef[] = [...datasetsV6Ml, ...datasetsV6Stats]
