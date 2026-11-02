import { contentV10Info } from './v10Info'
import { contentV10Stat } from './v10Stat'
import { contentV10Stat2 } from './v10Stat2'
import { contentV10Tree } from './v10Tree'
import { contentV10Topo } from './v10Topo'
import type { VizContent } from './types'

/** Explanations of the techniques added in v1.0. */
export const contentV10: Record<string, VizContent> = { ...contentV10Info, ...contentV10Topo, ...contentV10Stat, ...contentV10Stat2, ...contentV10Tree }
