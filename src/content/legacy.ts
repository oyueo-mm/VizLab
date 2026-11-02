import { comparison } from './comparison'
import { comparisonV2, compositionV2 } from './comparisonV2'
import { distribution } from './distribution'
import { distributionV2 } from './distributionV2'
import { composition, multivariate, timeseries } from './other'
import { relationship } from './relationship'
import { hierarchyV2, timeseriesV2, uncertaintyV2 } from './timeHierarchyV2'
import { contentV3 } from './v3'
import { contentV4 } from './v4'
import type { VizContent } from './types'

/** Explanations of the charts of v0.1–v0.4 (one lazily loaded group). */
export const contentLegacy: Record<string, VizContent> = {
  ...relationship, ...distribution, ...comparison, ...timeseries, ...composition, ...multivariate,
  ...distributionV2, ...comparisonV2, ...compositionV2, ...timeseriesV2, ...hierarchyV2, ...uncertaintyV2,
  ...contentV3, ...contentV4,
}
