import type { VizContent } from './types'
import { contentV6Ml } from './v6Ml'
import { contentV6Sci } from './v6Sci'
import { contentV6Stats } from './v6Stats'

/** Explanations of every chart added in v0.6. */
export const contentV6: Record<string, VizContent> = { ...contentV6Ml, ...contentV6Stats, ...contentV6Sci }
