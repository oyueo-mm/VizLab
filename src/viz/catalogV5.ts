import { catalogV5Bio } from './catalogV5Bio'
import { catalogV5Fin } from './catalogV5Fin'
import { catalogV5Geo } from './catalogV5Geo'
import { catalogV5Sci } from './catalogV5Sci'
import { catalogV5Special } from './catalogV5Special'
import { catalogV5Stats } from './catalogV5Stats'
import type { VizMeta } from './types'

/** Every chart added in v0.5. */
export const catalogV5: VizMeta[] = [...catalogV5Geo, ...catalogV5Stats, ...catalogV5Sci, ...catalogV5Fin, ...catalogV5Special, ...catalogV5Bio]
