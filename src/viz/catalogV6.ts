import { catalogV6Ml } from './catalogV6Ml'
import { catalogV6Sci } from './catalogV6Sci'
import { catalogV6Stats } from './catalogV6Stats'
import type { VizMeta } from './types'

/** Every chart added in v0.6. */
export const catalogV6: VizMeta[] = [...catalogV6Ml, ...catalogV6Stats, ...catalogV6Sci]
