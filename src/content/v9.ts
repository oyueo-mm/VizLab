import { contentV9Sets } from './v9Sets'
import { contentV9Sci } from './v9Sci'
import { contentV9Text } from './v9Text'
import { contentV9Time } from './v9Time'
import type { VizContent } from './types'

/** Explanations of the techniques added in v0.9. */
export const contentV9: Record<string, VizContent> = { ...contentV9Sets, ...contentV9Time, ...contentV9Text, ...contentV9Sci }
