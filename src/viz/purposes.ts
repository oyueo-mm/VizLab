/**
 * Analysis purposes and abbreviations that a search can match in addition to names and keywords. A reader often knows the question ("where is the
 * bottleneck?", "which points are outliers?") before the chart name; each purpose lists the charts that answer it.
 */
export interface Purpose { label: string; terms: string[]; ids: string[] }

export const purposes: Purpose[] = [
  { label: '군집 찾기', terms: ['군집', '클러스터', '그룹 찾기', 'cluster', 'clustering', 'community'], ids: ['spectral-embedding', 'community-blockmodel', 'silhouette-plot', 'tsne', 'umap', 'dendrogram', 'network', 'adjacency', 'dot-density', 'kde2d'] },
  { label: '병목 찾기', terms: ['병목', '막히는 곳', '지연', 'bottleneck', 'critical path'], ids: ['max-flow', 'process-map', 'queue-simulation', 'dag-layout', 'sankey'] },
  { label: '이상치·이상 징후 찾기', terms: ['이상치', '이상 징후', '아웃라이어', 'outlier', 'anomaly'], ids: ['box', 'control', 'violin', 'qq', 'moran-scatterplot', 'permutation-importance', 'order-flow-footprint'] },
  { label: '모델 성능 평가', terms: ['모델 평가', '분류 성능', '과적합', '성능 비교', 'model evaluation', 'overfitting'], ids: ['confusion-matrix', 'learning-curve', 'validation-curve', 'hyperparam-landscape', 'decision-boundary', 'calibration', 'roc', 'pr'] },
  { label: '모델 해석·설명', terms: ['모델 해석', '왜 그렇게 예측', '변수 영향', '설명 가능', 'explainability', 'xai', 'interpretability'], ids: ['shap-summary', 'shap-waterfall', 'ice-plot', 'ale-plot', 'permutation-importance', 'attention-map', 'decision-tree', 'partial-dependence'] },
  { label: '차원 축소·시각적 탐색', terms: ['차원 축소', '고차원', '임베딩', 'dimensionality reduction', 'embedding', 'manifold'], ids: ['tsne', 'umap', 'spectral-embedding', 'pca-biplot'] },
  { label: '주기·계절성·자기상관 보기', terms: ['주기', '계절성', '자기상관', '시차', 'seasonality', 'autocorrelation', 'lag'], ids: ['acf-plot', 'pacf-plot', 'ccf-plot', 'stl', 'seasonal-subseries', 'lag-plot', 'calendar', 'spiral-plot'] },
  { label: '위험·신뢰성 분석', terms: ['위험', '리스크', '고장', '수명', '안전성', 'risk', 'reliability', 'failure', 'safety'], ids: ['weibull-plot', 'fault-tree', 'tolerance-stackup', 'var-es-distribution', 'risk-contribution', 'hazard-plot', 'kaplan-meier', 'cumulative-incidence', 'return-level'] },
  { label: '불확실성·사후분포 점검', terms: ['불확실성', '사후분포', '수렴 진단', '베이지안', 'uncertainty', 'posterior', 'convergence', 'bayesian'], ids: ['mcmc-trace', 'mcmc-rank', 'prior-posterior', 'posterior-predictive', 'sbc-rank', 'joint-distribution'] },
  { label: '공간 보간·공간 자기상관', terms: ['공간 보간', '공간 자기상관', '크리깅', 'kriging', 'spatial autocorrelation', 'geostatistics'], ids: ['kriging-map', 'semivariogram', 'directional-variogram', 'moran-scatterplot', 'density-ratio-map', 'space-time-kde'] },
  { label: '포트폴리오·옵션 분석', terms: ['포트폴리오', '자산 배분', '옵션', '변동성', 'portfolio', 'options', 'volatility'], ids: ['efficient-frontier', 'risk-return-scatter', 'iv-smile', 'iv-surface', 'risk-contribution', 'yield-surface'] },
  { label: '단백질·분자 구조 보기', terms: ['단백질', '분자', '결정', '구조', 'protein', 'molecule', 'crystal'], ids: ['contact-map', 'ramachandran', 'molecule-viewer', 'crystal-lattice', 'msa-logo'] },
  { label: '유전자·서열 해석', terms: ['유전자 집합', '경로 분석', '서열 보존', 'pathway', 'gene set', 'conservation'], ids: ['gsea-running-sum', 'msa-logo', 'volcano', 'manhattan'] },
  { label: '텍스트·말뭉치 분석', terms: ['텍스트', '말뭉치', '단어', '언어', 'text mining', 'corpus', 'nlp'], ids: ['collocation-matrix', 'lexical-dispersion', 'zipf-plot', 'attention-map'] },
  { label: '프랙탈·복소 함수·혼돈', terms: ['프랙탈', '복소수', '혼돈', '카오스', 'fractal', 'chaos', 'complex'], ids: ['mandelbrot-set', 'julia-set', 'newton-fractal', 'domain-coloring', 'strange-attractor', 'poincare-section'] },
  { label: '3차원 필드 보기', terms: ['3차원', '입체', '부피', '등면', 'isosurface', 'volume', '3d field'], ids: ['isosurface', 'volume-rendering', 'vector-field-3d', 'tensor-glyph'] },
  { label: '흐름·경로 보기', terms: ['흐름', '경로', '이동', 'flow', 'path', 'workflow'], ids: ['max-flow', 'process-map', 'dag-layout', 'sankey', 'alluvial', 'od-matrix-map', 'flow-map'] },
]

/** Short names people type instead of the full chart name. */
export const abbreviations: Record<string, string[]> = {
  'acf-plot': ['acf'], 'pacf-plot': ['pacf'], 'ccf-plot': ['ccf'], stl: ['stl decomposition'], tsne: ['tsne', 't sne'], umap: ['umap'], 'shap-summary': ['shap'], 'shap-waterfall': ['shap'],
  'ice-plot': ['ice'], 'ale-plot': ['ale'], 'gsea-running-sum': ['gsea', 'nes'], 'process-map': ['dfg', 'process mining'], 'dag-layout': ['dag', 'cpm'], 'max-flow': ['maxflow', 'mincut'],
  'efficient-frontier': ['mpt', 'cml'], 'var-es-distribution': ['var', 'es', 'cvar'], 'iv-smile': ['iv'], 'iv-surface': ['iv', 'svi'], 'event-study-car': ['car', 'abnormal return'],
  'msa-logo': ['msa', 'logo'], 'contact-map': ['cmap'], 'collocation-matrix': ['pmi', 'collocation'], 'lexical-dispersion': ['dp', 'kwic'], 'zipf-plot': ['zipf'], 'weibull-plot': ['weibull', 'b10'],
  'fault-tree': ['fta', 'mocus'], 'tolerance-stackup': ['rss', 'cpk'], 'queue-simulation': ['mmc', 'erlang'], 'moran-scatterplot': ['lisa', 'moran'], 'kriging-map': ['ok', 'idw'],
}

const byId = new Map<string, string[]>()
for (const p of purposes) for (const id of p.ids) byId.set(id, [...(byId.get(id) ?? []), p.label, ...p.terms])
for (const [id, a] of Object.entries(abbreviations)) byId.set(id, [...(byId.get(id) ?? []), ...a])

/** Extra search terms of a chart: the purposes it answers (with their synonyms) and its abbreviations. */
export const purposeTerms = (id: string): readonly string[] => byId.get(id) ?? []
