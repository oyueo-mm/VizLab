import type { VizModule } from '../types'
import { barModule } from './bar'
import { boxModule } from './box'
import { ecdfModule } from './ecdf'
import { heatmapModule } from './heatmap'
import { hexbinModule } from './hexbin'
import { histogramModule } from './histogram'
import { kdeModule } from './kde'
import { areaModule, lineModule } from './line'
import { groupedBarModule, stackedBarModule } from './multibar'
import { pairplotModule } from './pairplot'
import { parallelModule } from './parallel'
import { pieModule } from './pie'
import { radarModule } from './radar'
import { bubbleModule, scatterModule } from './scatter'
import { stripModule } from './strip'
import { treemapModule } from './treemap'
import { violinModule } from './violin'

/** Chart implementations keyed by catalog id. A catalog entry without a module is never shown as available. */
export const modules: Record<string, VizModule> = {
  scatter: scatterModule,
  bubble: bubbleModule,
  hexbin: hexbinModule,
  pairplot: pairplotModule,
  histogram: histogramModule,
  kde: kdeModule,
  ecdf: ecdfModule,
  box: boxModule,
  violin: violinModule,
  strip: stripModule,
  bar: barModule,
  'grouped-bar': groupedBarModule,
  'stacked-bar': stackedBarModule,
  line: lineModule,
  area: areaModule,
  pie: pieModule,
  treemap: treemapModule,
  heatmap: heatmapModule,
  parallel: parallelModule,
  radar: radarModule,
}
