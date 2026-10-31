import { contentV5Geo } from './v5Geo'
import { contentV5Stats } from './v5Stats'
import type { VizContent } from './types'

/** Explanations of every chart added in v0.5. */
export const contentV5: Record<string, VizContent> = { ...contentV5Geo, ...contentV5Stats }
