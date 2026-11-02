import type { VizMeta } from './types'

/**
 * Visual-encoding principle of a catalog entry (v0.8), independent of its category and of its kind (technique / specialized / analysis /
 * application). Every entry has one main principle - the one that carries the picture's message - and optional secondary principles.
 * docs/v08-encodings.md gives the reasoning and the boundary cases.
 */
export type EncodingId = 'position' | 'length' | 'area' | 'color' | 'glyph' | 'connection' | 'flow' | 'partition' | 'pixel' | 'multivariate' | 'projection' | 'focus' | 'temporal' | 'texture' | 'spatial3d' | 'composite'

export const encodingDefs: { id: EncodingId; name: string; description: string }[] = [
  { id: 'position', name: '위치', description: '값을 평면 위 위치(좌표)로 나타냄' },
  { id: 'length', name: '길이', description: '값을 막대·선분의 길이로 나타냄' },
  { id: 'area', name: '면적', description: '값을 면의 넓이·각도·점의 크기로 나타냄' },
  { id: 'color', name: '색상', description: '값을 색·명도로 나타냄(히트맵, 코로플레스 등)' },
  { id: 'glyph', name: '글리프', description: '여러 속성을 한 기호의 모양으로 나타냄' },
  { id: 'connection', name: '연결', description: '개체 사이 관계를 선·호·행렬 칸으로 나타냄' },
  { id: 'flow', name: '흐름', description: '양이 이동·분기·합류하는 흐름을 나타냄' },
  { id: 'partition', name: '공간 분할', description: '화면을 값이나 구조에 따라 나누어 채움' },
  { id: 'pixel', name: '픽셀', description: '레코드 하나를 픽셀 하나에 대응시킴' },
  { id: 'multivariate', name: '다변량 매핑', description: '여러 변수를 축·배치 규칙으로 한 화면에 사상' },
  { id: 'projection', name: '투영·좌표 변환', description: '좌표계·투영·왜곡 변환으로 데이터를 다시 배치' },
  { id: 'focus', name: 'Focus+Context', description: '관심 영역을 확대·강조하면서 주변 맥락을 유지' },
  { id: 'temporal', name: '시간·애니메이션', description: '시간 자체를 배치하거나 애니메이션으로 표현' },
  { id: 'texture', name: '텍스처', description: '질감·밀도 패턴으로 값을 나타냄' },
  { id: 'spatial3d', name: '3D 공간', description: '3차원 공간에서 시점을 돌려 보는 표현' },
  { id: 'composite', name: '복합 표현', description: '서로 다른 인코딩을 결합한 구조' },
]

export const encodingById = new Map(encodingDefs.map((e) => [e.id, e]))

const ids = (s: string) => s.split(/\s+/).filter(Boolean)

const MAIN: Record<EncodingId, string> = {
  position: `bootstrap scatter pairplot connected-scatter strip beeswarm qq pp ecdf kde line step bump acf-plot pacf-plot ccf-plot lag-plot stl seasonal-subseries dumbbell slope
ci forest bland-altman calibration control funnel-plot residual-plot scale-location influence-plot coefficient-plot partial-dependence kaplan-meier nelson-aalen ewma cusum
roc pr lift-gain mcmc-trace prior-posterior posterior-predictive mcmc-rank sbc-rank hazard-plot cumulative-incidence return-level quantile-dotplot wilkinson-dotplot
dot-density point-map isoline isochrone trajectory moran-scatterplot semivariogram directional-variogram terrain-profile
event-raster barcode-plot lexis bifurcation radial-distribution band-structure density-of-states kagi yield-curve efficient-frontier risk-return-scatter iv-smile event-study-car var-es-distribution
volcano ma-plot manhattan gsea-running-sum ramachandran learning-curve validation-curve ice-plot ale-plot weibull-plot lexical-dispersion zipf-plot rich-club marey-chart`,
  length: `pit-histogram histogram bar grouped-bar stacked-bar lollipop waterfall pyramid pareto bullet stacked-bar-100 upset linear-set-diagram spike-map gantt radial-bar volume-profile risk-contribution
silhouette-plot shap-waterfall permutation-importance tolerance-stackup`,
  area: `fan bubble violin ridgeline pie waffle area stacked-area streamgraph punchcard symbol-map dorling vba-map buffer-map funnel nightingale-rose cumulative-flow wind-rose equivolume drawdown order-book coverage
venn bubble-sets kelp-diagram rainbow-boxes radial-sets word-cloud`,
  color: `kde2d heatmap calendar horizon kde-map hillshade slope-aspect bivariate chorochromatic choropleth hotspot lisa raster-map dasymetric kriging-map density-ratio-map
spectrogram scalogram recurrence-plot polar-heatmap mandelbrot-set julia-set newton-fractal domain-coloring order-flow-footprint order-book-heatmap clustered-heatmap contact-map confusion-matrix decision-boundary
hyperparam-landscape attention-map community-blockmodel collocation-matrix gradient-plot`,
  glyph: `box letter-value candlestick chernoff-faces vector-field glyph-map pictogram tensor-glyph renko heikin-ashi point-figure line-break sequence-logo msa-logo`,
  connection: `nodetrix power-graph confluent-drawing chord dendrogram network arc tanglegram od-matrix-map adjacency edge-bundling bipartite hive hypergraph biofabric radial-tree dag-layout force-directed-edge-bundling linesets phylogenetic-tree decision-tree
process-map fault-tree word-tree lifelines`,
  flow: `sankey alluvial parallel-sets flow-map streamline max-flow phase-portrait activation-flow storyline-chart`,
  partition: `hexbin treemap mosaic sunburst pack icicle voronoi-treemap geo-hexbin tile-grid square-grid cluster-map gridded-cartogram voronoi-map marimekko flame delaunay phase-diagram dimensional-stacking`,
  pixel: `pixel-bar-chart recursive-pattern circle-segments space-filling-curve`,
  multivariate: `parallel radar andrews hyperslice`,
  projection: `pca-biplot radviz star-coordinates grand-tour cartogram-contiguous cartogram-noncontiguous demers tissot globe-3d spiral-plot ternary polar-plot poincare-section multi-planar-reconstruction pcoa tsne umap spectral-embedding time-curves`,
  focus: `table-lens hyperbolic-tree`,
  temporal: `hops particle-flow nn-training queue-simulation`,
  texture: `line-integral-convolution`,
  spatial3d: `cone-tree stream-surface streamtube terrain-3d prism-map space-time-cube space-time-kde surface-3d scatter-3d strange-attractor isosurface volume-rendering vector-field-3d molecule-viewer crystal-lattice iv-surface yield-surface loss-landscape`,
  composite: `raincloud joint-distribution shap-summary`,
}

/** Secondary principles; entries that are drawn with a second encoding that is part of the technique. */
const SECOND_LIST: Record<string, string> = {
  position: 'bubble heatmap parallel hive biofabric linesets bubble-sets tsne umap pca-biplot hops gradient-plot dorling streamline',
  color: 'hexbin tile-grid recursive-pattern circle-segments space-filling-curve pixel-bar-chart dimensional-stacking hyperslice terrain-3d voronoi-map isosurface',
  multivariate: 'pairplot parallel-sets radviz star-coordinates dimensional-stacking chernoff-faces pca-biplot',
  temporal: 'connected-scatter streamgraph stacked-area line area candlestick calendar horizon storyline-chart lifelines marey-chart time-curves lexis event-raster gantt grand-tour space-time-cube',
  area: 'treemap sunburst pack icicle mosaic marimekko voronoi-treemap cartogram-contiguous cartogram-noncontiguous demers',
  connection: 'sankey alluvial parallel-sets flow-map storyline-chart time-curves clustered-heatmap bubble-sets kelp-diagram radial-sets upset spectral-embedding',
  flow: 'chord streamgraph line-integral-convolution vector-field particle-flow force-directed-edge-bundling',
  glyph: 'radar molecule-viewer',
  partition: 'rainbow-boxes venn choropleth',
  projection: 'andrews radial-sets hyperbolic-tree',
  length: 'table-lens pixel-bar-chart',
  spatial3d: 'globe-3d',
}

const SECOND = new Map<string, EncodingId[]>()
for (const [enc, list] of Object.entries(SECOND_LIST)) for (const id of ids(list)) SECOND.set(id, [...(SECOND.get(id) ?? []), enc as EncodingId])

export const encodingsOf = (id: string): { main: EncodingId; also: EncodingId[] } => ({ main: mainOf.get(id) ?? 'composite', also: SECOND.get(id) ?? [] })

const mainOf = new Map<string, EncodingId>()
for (const [enc, list] of Object.entries(MAIN)) for (const id of ids(list)) mainOf.set(id, enc as EncodingId)

/** True when the entry uses principle `e` as its main or as a secondary principle. */
export const hasEncoding = (meta: Pick<VizMeta, 'id'>, e: EncodingId) => {
  const x = encodingsOf(meta.id)
  return x.main === e || x.also.includes(e)
}

export const encodingTotals = (list: readonly Pick<VizMeta, 'id'>[]): Record<EncodingId, number> => {
  const t = Object.fromEntries(encodingDefs.map((d) => [d.id, 0])) as Record<EncodingId, number>
  for (const m of list) t[encodingsOf(m.id).main]++
  return t
}
