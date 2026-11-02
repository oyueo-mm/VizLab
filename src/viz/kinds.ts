import type { VizMeta } from './types'

/**
 * Nature of a catalog entry, independent of its category (v0.7). The main kind answers "what is this entry mainly?":
 * - technique: a way of mapping data to marks / layout that carries over to many data sets and domains.
 * - specialized: a chart form of a field with its own data structure and reading conventions (ROC, forest plot, candlestick…).
 * - analysis: the output of a specific algorithm, model or mathematical object (t-SNE, Mandelbrot set, kriging…).
 * - application: an existing technique applied to a particular domain object.
 * `kindAlso` lists secondary kinds of entries whose main kind is not the only fair description. Entries not listed in `techniques`,
 * `analyses` or `applications` are specialized charts; docs/v07-classification.md gives the reasoning.
 */
export type VizKind = 'technique' | 'specialized' | 'analysis' | 'application'

export const kindDefs: { id: VizKind; name: string; description: string }[] = [
  { id: 'technique', name: '시각화 방법론', description: '데이터를 위치·길이·면적·색·연결 등에 대응시키는 독립적인 표현 원리' },
  { id: 'specialized', name: '전문 도표', description: '특정 분야·목적을 위해 굳어진 도표 형식' },
  { id: 'analysis', name: '분석·계산 결과', description: '특정 알고리즘·모델·수학적 대상의 실행 결과를 그린 것' },
  { id: 'application', name: '응용 예제', description: '기존 표현 방법을 특정 분야의 대상에 적용한 사례' },
]

export const kindById = new Map(kindDefs.map((k) => [k.id, k]))

const ids = (s: string) => s.split(/\s+/).filter(Boolean)

const techniques = new Set(ids(`
scatter bubble hexbin pairplot histogram kde ecdf box violin strip bar grouped-bar stacked-bar line area pie treemap heatmap parallel radar
ridgeline raincloud beeswarm lollipop dumbbell slope waterfall stacked-bar-100 waffle stacked-area streamgraph bump calendar sunburst pack sankey
chord dendrogram ci kde2d letter-value connected-scatter andrews pyramid bullet step horizon mosaic icicle network arc alluvial fan
choropleth symbol-map dot-density geo-hexbin flow-map tile-grid dorling adjacency edge-bundling bipartite hive point-map kde-map square-grid
cluster-map spike-map isoline hillshade vector-field streamline particle-flow bivariate chorochromatic vba-map glyph-map cartogram-contiguous
cartogram-noncontiguous demers gridded-cartogram voronoi-map raster-map terrain-3d prism-map space-time-cube dasymetric surface-3d scatter-3d
ternary polar-plot polar-heatmap pictogram nightingale-rose radial-bar event-raster barcode-plot lexis spiral-plot venn upset hypergraph
biofabric radial-tree isosurface volume-rendering vector-field-3d tensor-glyph domain-coloring spectrogram scalogram clustered-heatmap
`))

const analyses = new Set(ids(`
tsne umap decision-boundary decision-tree hyperparam-landscape loss-landscape attention-map activation-flow nn-training silhouette-plot
mandelbrot-set julia-set newton-fractal strange-attractor poincare-section bifurcation phase-portrait radial-distribution band-structure
density-of-states phase-diagram kriging-map semivariogram directional-variogram moran-scatterplot hotspot lisa space-time-kde density-ratio-map
isochrone buffer-map spectral-embedding community-blockmodel max-flow rich-club efficient-frontier iv-smile iv-surface yield-surface
var-es-distribution risk-contribution event-study-car queue-simulation pcoa delaunay recurrence-plot bootstrap ale-plot ice-plot shap-summary
shap-waterfall permutation-importance stl
`))

const applications = new Set(ids(`
trajectory od-matrix-map risk-return-scatter molecule-viewer crystal-lattice tolerance-stackup order-book-heatmap terrain-profile
`))

/** Entries whose main kind is specialized or analysis but which are also independent techniques (or the reverse). */
export const kindAlso: Record<string, VizKind[]> = {
  candlestick: ['technique'], horizon: ['specialized'], 'pca-biplot': ['technique'], 'tsne': ['technique'], 'umap': ['technique'],
  heatmap: ['specialized'], 'domain-coloring': ['analysis'], 'mandelbrot-set': ['technique'], 'julia-set': ['technique'], 'newton-fractal': ['technique'],
  ternary: ['specialized'], 'wind-rose': ['technique'], 'gantt': ['technique'], 'flame': ['technique'], roc: ['technique'], 'sequence-logo': ['technique'],
  'phylogenetic-tree': ['technique'], 'manhattan': ['technique'], 'kaplan-meier': ['technique'], 'spiral-plot': ['specialized'], 'volume-rendering': ['analysis'],
  'qq': ['technique'], 'hive': ['specialized'], 'lexis': ['specialized'], 'streamline': ['analysis'], 'vector-field': ['analysis'],
  'marey-chart': ['technique'], tanglegram: ['technique'], 'multi-planar-reconstruction': ['specialized'], lifelines: ['specialized'], punchcard: ['specialized'],
}

export function kindOf(id: string): VizKind {
  if (techniques.has(id)) return 'technique'
  if (analyses.has(id)) return 'analysis'
  if (applications.has(id)) return 'application'
  return extraKinds[id] ?? 'specialized'
}

/** Main kind of entries added after v0.6 (registered next to their catalog files). */
export const extraKinds: Record<string, VizKind> = {
  ...Object.fromEntries(ids(`
radviz star-coordinates grand-tour dimensional-stacking table-lens recursive-pattern circle-segments hyperslice pixel-bar-chart chernoff-faces
quantile-dotplot hops gradient-plot wilkinson-dotplot punchcard parallel-sets word-cloud word-tree space-filling-curve voronoi-treemap time-curves
lifelines line-integral-convolution globe-3d multi-planar-reconstruction hyperbolic-tree linear-set-diagram force-directed-edge-bundling storyline-chart
bubble-sets linesets kelp-diagram rainbow-boxes radial-sets nodetrix power-graph confluent-drawing cone-tree stream-surface streamtube semantic-substrates pivot-graph timearcs lifeflow timesets flowstrates textarc parallel-tag-clouds phrase-net
metrosets mosaicsets infocrystal
metrosets mosaicsets infocrystal
paohvis set-streams sequence-braiding dust-magnet gosper-map
wordstream tilebars od-maps perspective-wall ibfv hyperstreamlines fiber-surfaces
vector-field-topology maptrix seesoft setnet
zame excentric-labeling lineup unit-visualization splatterplot contour-tree persistence-diagram topological-landscape probabilistic-isocontour functional-boxplot
bagplot diverging-stacked-bar decision-curve
`).map((id) => [id, 'technique' as VizKind])),
  // forms with their own field conventions: specialized charts that are also independent techniques (see kindAlso)
  'marey-chart': 'specialized', tanglegram: 'specialized',
}

export const kindsAlsoOf = (id: string): VizKind[] => kindAlso[id] ?? []

/** True when the entry is of kind `k` as its main kind or as a secondary kind. */
export const hasKind = (meta: Pick<VizMeta, 'id'>, k: VizKind) => kindOf(meta.id) === k || kindsAlsoOf(meta.id).includes(k)

/** Totals count each entry once, by main kind; the secondary kinds only widen the catalog filter. */
export function kindTotals(list: readonly Pick<VizMeta, 'id'>[]): Record<VizKind, number> {
  const t: Record<VizKind, number> = { technique: 0, specialized: 0, analysis: 0, application: 0 }
  for (const m of list) t[kindOf(m.id)]++
  return t
}

/**
 * Technique ↔ result links. Each pair makes the two entries show each other under "related" (merged into `related` of the catalog);
 * the left side is the representation, the right side the computed result that is drawn with it.
 */
export const techniqueResultLinks: [string, string[]][] = [
  ['scatter', ['pca-biplot', 'tsne', 'umap']],
  ['scatter-3d', ['strange-attractor']],
  ['heatmap', ['confusion-matrix', 'contact-map', 'attention-map']],
  ['domain-coloring', ['mandelbrot-set', 'julia-set', 'newton-fractal']],
  ['choropleth', ['hotspot', 'lisa']],
  ['isoline', ['kriging-map']],
  ['radviz', ['tsne', 'umap']],
  ['grand-tour', ['pca-biplot', 'umap']],
  ['hops', ['bootstrap', 'mcmc-trace']],
  ['quantile-dotplot', ['prior-posterior', 'return-level']],
  ['line-integral-convolution', ['vector-field', 'streamline', 'particle-flow']],
  ['globe-3d', ['tissot', 'choropleth']],
  ['multi-planar-reconstruction', ['isosurface', 'volume-rendering']],
  ['force-directed-edge-bundling', ['od-matrix-map', 'flow-map']],
  ['time-curves', ['strange-attractor', 'recurrence-plot']],
  ['space-filling-curve', ['calendar']],
]
