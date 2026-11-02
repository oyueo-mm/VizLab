import { catalogV7Multivar } from './catalogV7Multivar'
import { catalogV7Net } from './catalogV7Net'
import { catalogV7Sci } from './catalogV7Sci'
import { catalogV7Struct } from './catalogV7Struct'
import { catalogV7Uncert } from './catalogV7Uncert'
import type { VizMeta } from './types'

/** Every chart added in v0.7 (visualization techniques first). */
export const catalogV7: VizMeta[] = [...catalogV7Multivar, ...catalogV7Uncert, ...catalogV7Struct, ...catalogV7Sci, ...catalogV7Net]
