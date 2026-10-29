import { comparison } from './comparison'
import { distribution } from './distribution'
import { composition, multivariate, timeseries } from './other'
import { relationship } from './relationship'
import type { VizContent } from './types'

export type { Formula, VizContent } from './types'

export const content: Record<string, VizContent> = { ...relationship, ...distribution, ...comparison, ...timeseries, ...composition, ...multivariate }
