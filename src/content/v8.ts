import { contentV8Net } from './v8Net'
import { contentV8Rel } from './v8Rel'
import { contentV8Sci } from './v8Sci'
import { contentV8Sets } from './v8Sets'
import type { VizContent } from './types'

/** Explanations of the techniques added in v0.8. */
export const contentV8: Record<string, VizContent> = { ...contentV8Sets, ...contentV8Net, ...contentV8Sci, ...contentV8Rel }
