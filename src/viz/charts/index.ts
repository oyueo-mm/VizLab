import { useEffect, useState } from 'react'
import type { VizModule } from '../types'

type Loader = () => Promise<VizModule>

/**
 * Chart implementations keyed by catalog id, loaded on demand so the first screen does not ship
 * every chart. A catalog entry without a loader is never shown as available.
 */
const loaders: Record<string, Loader> = {
  scatter: () => import('./scatter').then((m) => m.scatterModule),
  bubble: () => import('./scatter').then((m) => m.bubbleModule),
  hexbin: () => import('./hexbin').then((m) => m.hexbinModule),
  pairplot: () => import('./pairplot').then((m) => m.pairplotModule),
  histogram: () => import('./histogram').then((m) => m.histogramModule),
  kde: () => import('./kde').then((m) => m.kdeModule),
  ecdf: () => import('./ecdf').then((m) => m.ecdfModule),
  box: () => import('./box').then((m) => m.boxModule),
  violin: () => import('./violin').then((m) => m.violinModule),
  strip: () => import('./strip').then((m) => m.stripModule),
  bar: () => import('./bar').then((m) => m.barModule),
  'grouped-bar': () => import('./multibar').then((m) => m.groupedBarModule),
  'stacked-bar': () => import('./multibar').then((m) => m.stackedBarModule),
  line: () => import('./line').then((m) => m.lineModule),
  area: () => import('./line').then((m) => m.areaModule),
  pie: () => import('./pie').then((m) => m.pieModule),
  treemap: () => import('./treemap').then((m) => m.treemapModule),
  heatmap: () => import('./heatmap').then((m) => m.heatmapModule),
  parallel: () => import('./parallel').then((m) => m.parallelModule),
  radar: () => import('./radar').then((m) => m.radarModule),
  // v0.2
  ridgeline: () => import('./ridgeline').then((m) => m.ridgelineModule),
  raincloud: () => import('./raincloud').then((m) => m.raincloudModule),
  beeswarm: () => import('./beeswarm').then((m) => m.beeswarmModule),
  qq: () => import('./qq').then((m) => m.qqModule),
  lollipop: () => import('./lollipop').then((m) => m.lollipopModule),
  dumbbell: () => import('./dumbbell').then((m) => m.dumbbellModule),
  slope: () => import('./slope').then((m) => m.slopeModule),
  waterfall: () => import('./waterfall').then((m) => m.waterfallModule),
  'stacked-bar-100': () => import('./multibar').then((m) => m.stacked100Module),
  waffle: () => import('./waffle').then((m) => m.waffleModule),
  'stacked-area': () => import('./stackedArea').then((m) => m.stackedAreaModule),
  streamgraph: () => import('./streamgraph').then((m) => m.streamgraphModule),
  bump: () => import('./bump').then((m) => m.bumpModule),
  calendar: () => import('./calendar').then((m) => m.calendarModule),
  sunburst: () => import('./sunburst').then((m) => m.sunburstModule),
  pack: () => import('./pack').then((m) => m.packModule),
  sankey: () => import('./sankey').then((m) => m.sankeyModule),
  chord: () => import('./chord').then((m) => m.chordModule),
  dendrogram: () => import('./dendrogram').then((m) => m.dendrogramModule),
  ci: () => import('./ci').then((m) => m.ciModule),
  // v0.3
  kde2d: () => import('./kde2d').then((m) => m.kde2dModule),
  pp: () => import('./pp').then((m) => m.ppModule),
  'letter-value': () => import('./letterValue').then((m) => m.letterValueModule),
  'connected-scatter': () => import('./connectedScatter').then((m) => m.connectedScatterModule),
  'pca-biplot': () => import('./pcaBiplot').then((m) => m.pcaBiplotModule),
  andrews: () => import('./andrews').then((m) => m.andrewsModule),
  pyramid: () => import('./pyramid').then((m) => m.pyramidModule),
  pareto: () => import('./pareto').then((m) => m.paretoModule),
  bullet: () => import('./bullet').then((m) => m.bulletModule),
  step: () => import('./step').then((m) => m.stepModule),
  candlestick: () => import('./candlestick').then((m) => m.candlestickModule),
  horizon: () => import('./horizon').then((m) => m.horizonModule),
  mosaic: () => import('./mosaic').then((m) => m.mosaicModule),
  icicle: () => import('./icicle').then((m) => m.icicleModule),
  network: () => import('./network').then((m) => m.networkModule),
  arc: () => import('./arc').then((m) => m.arcModule),
  alluvial: () => import('./alluvial').then((m) => m.alluvialModule),
  roc: () => import('./roc').then((m) => m.rocModule),
  pr: () => import('./pr').then((m) => m.prModule),
  fan: () => import('./fan').then((m) => m.fanModule),
  // v0.4
  choropleth: () => import('./choropleth').then((m) => m.choroplethModule),
  'symbol-map': () => import('./symbolMap').then((m) => m.symbolMapModule),
  'dot-density': () => import('./dotDensity').then((m) => m.dotDensityModule),
  'flow-map': () => import('./flowMap').then((m) => m.flowMapModule),
  'tile-grid': () => import('./tileGrid').then((m) => m.tileGridModule),
  dorling: () => import('./dorling').then((m) => m.dorlingModule),
  forest: () => import('./forest').then((m) => m.forestModule),
  'funnel-plot': () => import('./funnelPlot').then((m) => m.funnelPlotModule),
  'bland-altman': () => import('./blandAltman').then((m) => m.blandAltmanModule),
  calibration: () => import('./calibration').then((m) => m.calibrationModule),
  control: () => import('./control').then((m) => m.controlModule),
  gantt: () => import('./gantt').then((m) => m.ganttModule),
  funnel: () => import('./funnelChart').then((m) => m.funnelChartModule),
  marimekko: () => import('./marimekko').then((m) => m.marimekkoModule),
  flame: () => import('./flame').then((m) => m.flameModule),
  adjacency: () => import('./adjacency').then((m) => m.adjacencyModule),
  bipartite: () => import('./bipartite').then((m) => m.bipartiteModule),
  hive: () => import('./hive').then((m) => m.hiveModule),
  'edge-bundling': () => import('./edgeBundling').then((m) => m.edgeBundlingModule),
  'geo-hexbin': () => import('./geoHexbin').then((m) => m.geoHexbinModule),
  // v0.5
  'point-map': () => import('./pointCharts').then((m) => m.pointMapModule),
  'kde-map': () => import('./pointCharts').then((m) => m.kdeMapModule),
  'square-grid': () => import('./pointCharts').then((m) => m.squareGridModule),
  'cluster-map': () => import('./pointCharts').then((m) => m.clusterMapModule),
  'spike-map': () => import('./pointCharts').then((m) => m.spikeMapModule),
  isoline: () => import('./surfaceCharts').then((m) => m.isolineModule),
  hillshade: () => import('./surfaceCharts').then((m) => m.hillshadeModule),
  'slope-aspect': () => import('./surfaceCharts').then((m) => m.slopeAspectModule),
  'vector-field': () => import('./vectorCharts').then((m) => m.vectorFieldModule),
  streamline: () => import('./vectorCharts').then((m) => m.streamlineModule),
  'particle-flow': () => import('./vectorCharts').then((m) => m.particleFlowModule),
  bivariate: () => import('./thematicCharts').then((m) => m.bivariateModule),
  chorochromatic: () => import('./thematicCharts').then((m) => m.chorochromaticModule),
  'vba-map': () => import('./thematicCharts').then((m) => m.vbaModule),
  'glyph-map': () => import('./thematicCharts').then((m) => m.glyphMapModule),
  'cartogram-contiguous': () => import('./cartogramCharts').then((m) => m.contiguousCartogramModule),
  'cartogram-noncontiguous': () => import('./cartogramCharts').then((m) => m.nonContiguousCartogramModule),
  demers: () => import('./cartogramCharts').then((m) => m.demersModule),
  'gridded-cartogram': () => import('./cartogramCharts').then((m) => m.griddedCartogramModule),
  'voronoi-map': () => import('./mapAnalysisCharts').then((m) => m.voronoiMapModule),
  isochrone: () => import('./mapAnalysisCharts').then((m) => m.isochroneModule),
  'buffer-map': () => import('./mapAnalysisCharts').then((m) => m.bufferMapModule),
  trajectory: () => import('./mapAnalysisCharts').then((m) => m.trajectoryModule),
  tissot: () => import('./mapAnalysisCharts').then((m) => m.tissotModule),
  hotspot: () => import('./spatialStatsCharts').then((m) => m.hotspotModule),
  'raster-map': () => import('./rasterCharts').then((m) => m.rasterMapModule),
  'terrain-profile': () => import('./rasterCharts').then((m) => m.terrainProfileModule),
  dasymetric: () => import('./rasterCharts').then((m) => m.dasymetricModule),
  'terrain-3d': () => import('./geo3dCharts').then((m) => m.terrain3dModule),
  'prism-map': () => import('./geo3dCharts').then((m) => m.prismMapModule),
  'space-time-cube': () => import('./geo3dCharts').then((m) => m.spaceTimeCubeModule),
  'residual-plot': () => import('./regressionCharts').then((m) => m.residualModule),
  'scale-location': () => import('./regressionCharts').then((m) => m.scaleLocationModule),
  'influence-plot': () => import('./regressionCharts').then((m) => m.influenceModule),
  'coefficient-plot': () => import('./regressionCharts').then((m) => m.coefficientModule),
  'partial-dependence': () => import('./regressionCharts').then((m) => m.pdpModule),
  'kaplan-meier': () => import('./survivalCharts').then((m) => m.kaplanMeierModule),
  'nelson-aalen': () => import('./survivalCharts').then((m) => m.nelsonAalenModule),
  bootstrap: () => import('./modelCharts').then((m) => m.bootstrapModule),
  ewma: () => import('./modelCharts').then((m) => m.ewmaModule),
  cusum: () => import('./modelCharts').then((m) => m.cusumModule),
  'lift-gain': () => import('./modelCharts').then((m) => m.gainLiftModule),
  'pit-histogram': () => import('./modelCharts').then((m) => m.pitModule),
  'surface-3d': () => import('./scienceCharts').then((m) => m.surface3dModule),
  'scatter-3d': () => import('./scienceCharts').then((m) => m.scatter3dModule),
  'phase-portrait': () => import('./scienceCharts').then((m) => m.phasePortraitModule),
  bifurcation: () => import('./scienceCharts').then((m) => m.bifurcationModule),
  spectrogram: () => import('./scienceCharts').then((m) => m.spectrogramModule),
  scalogram: () => import('./scienceCharts').then((m) => m.scalogramModule),
  'recurrence-plot': () => import('./scienceCharts').then((m) => m.recurrenceModule),
  ternary: () => import('./polarCharts').then((m) => m.ternaryModule),
  'wind-rose': () => import('./polarCharts').then((m) => m.windRoseModule),
  'polar-plot': () => import('./polarCharts').then((m) => m.polarModule),
  'polar-heatmap': () => import('./polarCharts').then((m) => m.polarHeatmapModule),
  delaunay: () => import('./polarCharts').then((m) => m.delaunayModule),
  renko: () => import('./financeCharts').then((m) => m.renkoModule),
  'heikin-ashi': () => import('./financeCharts').then((m) => m.heikinAshiModule),
  kagi: () => import('./financeCharts').then((m) => m.kagiModule),
  'point-figure': () => import('./financeCharts').then((m) => m.pointFigureModule),
  equivolume: () => import('./financeCharts').then((m) => m.equivolumeModule),
  'volume-profile': () => import('./financeCharts').then((m) => m.volumeProfileModule),
  'line-break': () => import('./financeCharts').then((m) => m.lineBreakModule),
  drawdown: () => import('./financeCharts').then((m) => m.drawdownModule),
  'yield-curve': () => import('./financeCharts').then((m) => m.yieldCurveModule),
  'order-book': () => import('./financeCharts').then((m) => m.orderBookModule),
  pictogram: () => import('./specialCharts').then((m) => m.pictogramModule),
  'nightingale-rose': () => import('./specialCharts').then((m) => m.nightingaleModule),
  'radial-bar': () => import('./specialCharts').then((m) => m.radialBarModule),
  'event-raster': () => import('./specialCharts').then((m) => m.eventRasterModule),
  'barcode-plot': () => import('./specialCharts').then((m) => m.barcodeModule),
  lexis: () => import('./specialCharts').then((m) => m.lexisModule),
  'cumulative-flow': () => import('./specialCharts').then((m) => m.cfdModule),
  'spiral-plot': () => import('./specialCharts').then((m) => m.spiralModule),
  volcano: () => import('./bioCharts').then((m) => m.volcanoModule),
  'ma-plot': () => import('./bioCharts').then((m) => m.maModule),
  manhattan: () => import('./bioCharts').then((m) => m.manhattanModule),
  'sequence-logo': () => import('./bioCharts').then((m) => m.sequenceLogoModule),
  coverage: () => import('./bioCharts').then((m) => m.coverageModule),
  pcoa: () => import('./bioCharts').then((m) => m.pcoaModule),
  'phylogenetic-tree': () => import('./bioCharts').then((m) => m.phyloModule),
  'clustered-heatmap': () => import('./bioCharts').then((m) => m.clusterHeatModule),
  lisa: () => import('./spatialStatsCharts').then((m) => m.lisaModule),
}

export const hasModule = (id: string) => Object.prototype.hasOwnProperty.call(loaders, id)
export const moduleIds = Object.keys(loaders)

const loaded = new Map<string, VizModule>()
const pending = new Map<string, Promise<VizModule>>()

export const getLoadedModule = (id: string) => loaded.get(id)

export function loadModule(id: string): Promise<VizModule> {
  const done = loaded.get(id)
  if (done) return Promise.resolve(done)
  let p = pending.get(id)
  if (!p) {
    const loader = loaders[id]
    if (!loader) return Promise.reject(new Error(`알 수 없는 시각화: ${id}`))
    p = loader().then((mod) => { loaded.set(id, mod); pending.delete(id); return mod }, (err) => { pending.delete(id); throw err })
    pending.set(id, p)
  }
  return p
}

/** Every implementation, keyed by id (tests and tooling). */
export async function loadAllModules() {
  const entries = await Promise.all(moduleIds.map(async (id) => [id, await loadModule(id)] as const))
  return Object.fromEntries(entries) as Record<string, VizModule>
}

/** The module for `id` once it has loaded (null while loading or when `enabled` is false). */
export function useVizModule(id: string, enabled = true) {
  const [state, setState] = useState<{ id: string; mod: VizModule | null; error: Error | null }>(() => ({ id, mod: loaded.get(id) ?? null, error: null }))
  const current = state.id === id ? state : { id, mod: loaded.get(id) ?? null, error: null }
  useEffect(() => {
    if (!enabled || loaded.has(id)) {
      if (loaded.has(id)) setState((s) => (s.id === id && s.mod ? s : { id, mod: loaded.get(id)!, error: null }))
      return
    }
    let alive = true
    loadModule(id).then((mod) => { if (alive) setState({ id, mod, error: null }) }, (error: Error) => { if (alive) setState({ id, mod: null, error }) })
    return () => { alive = false }
  }, [id, enabled])
  return current
}
