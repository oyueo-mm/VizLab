import type { VizContent } from './types'
import { contentV7Multivar } from './v7Multivar'
import { contentV7MultivarB } from './v7MultivarB'
import { contentV7Sci } from './v7Sci'
import { contentV7Struct } from './v7Struct'
import { contentV7Uncert } from './v7Uncert'

/** Explanations of every chart added in v0.7. */
export const contentV7: Record<string, VizContent> = { ...contentV7Multivar, ...contentV7MultivarB, ...contentV7Uncert, ...contentV7Struct, ...contentV7Sci }
