import type { VizContent } from './types'
import { contentV7Multivar } from './v7Multivar'
import { contentV7MultivarB } from './v7MultivarB'

/** Explanations of every chart added in v0.7. */
export const contentV7: Record<string, VizContent> = { ...contentV7Multivar, ...contentV7MultivarB }
