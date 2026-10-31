import { catalogV5Geo } from './catalogV5Geo'
import { catalogV5Sci } from './catalogV5Sci'
import { catalogV5Stats } from './catalogV5Stats'
import type { VizMeta } from './types'

/** Every chart added in v0.5. */
export const catalogV5: VizMeta[] = [...catalogV5Geo, ...catalogV5Stats, ...catalogV5Sci]
