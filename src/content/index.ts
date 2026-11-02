import { contentLegacy } from './legacy'
import { conceptNotes } from './notes'
import { contentV5 } from './v5'
import { contentV6 } from './v6'
import { contentV7 } from './v7'
import { contentV8 } from './v8'
import type { VizContent } from './types'

export type { Formula, VizContent } from './types'

/**
 * Every explanation in one object. The app does not import this (the lab loads one group at a time through `loader.ts`); tests and tools do.
 */
export const content: Record<string, VizContent> = { ...contentLegacy, ...contentV5, ...contentV6, ...contentV7, ...contentV8 }

for (const [id, note] of Object.entries(conceptNotes)) if (content[id]) content[id] = { ...content[id], note }
