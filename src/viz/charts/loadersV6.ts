import type { VizModule } from '../types'

type Loader = () => Promise<VizModule>

/** Loaders of the charts added in v0.6 (merged into the registry in `index.ts`). */
export const loadersV6: Record<string, Loader> = {
  // machine learning
  'confusion-matrix': () => import('./mlCharts').then((m) => m.confusionModule),
  'decision-boundary': () => import('./mlCharts').then((m) => m.boundaryModule),
  'learning-curve': () => import('./mlCharts').then((m) => m.learningModule),
  'validation-curve': () => import('./mlCharts').then((m) => m.validationModule),
  'hyperparam-landscape': () => import('./mlCharts').then((m) => m.landscapeModule),
  'silhouette-plot': () => import('./mlCharts').then((m) => m.silhouetteModule),
  'decision-tree': () => import('./mlCharts').then((m) => m.treeModule),
  'ice-plot': () => import('./mlExplainCharts').then((m) => m.iceModule),
  'ale-plot': () => import('./mlExplainCharts').then((m) => m.aleModule),
  'shap-summary': () => import('./mlExplainCharts').then((m) => m.shapSummaryModule),
  'shap-waterfall': () => import('./mlExplainCharts').then((m) => m.shapWaterfallModule),
  'permutation-importance': () => import('./mlExplainCharts').then((m) => m.permModule),
  'nn-training': () => import('./mlNeuralCharts').then((m) => m.nnTrainingModule),
  'loss-landscape': () => import('./mlNeuralCharts').then((m) => m.lossLandscapeModule),
  'attention-map': () => import('./mlNeuralCharts').then((m) => m.attentionModule),
  'activation-flow': () => import('./mlNeuralCharts').then((m) => m.activationModule),
  tsne: () => import('./mlEmbedCharts').then((m) => m.tsneModule),
  umap: () => import('./mlEmbedCharts').then((m) => m.umapModule),
  // time series, Bayesian, survival, extreme values
  'acf-plot': () => import('./tsCharts').then((m) => m.acfModule),
  'pacf-plot': () => import('./tsCharts').then((m) => m.pacfModule),
  'ccf-plot': () => import('./tsCharts').then((m) => m.ccfModule),
  stl: () => import('./tsCharts').then((m) => m.stlModule),
  'seasonal-subseries': () => import('./tsCharts').then((m) => m.subseriesModule),
  'lag-plot': () => import('./tsCharts').then((m) => m.lagModule),
  'mcmc-trace': () => import('./bayesCharts').then((m) => m.traceModule),
  'mcmc-rank': () => import('./bayesCharts').then((m) => m.rankModule),
  'prior-posterior': () => import('./bayesCharts').then((m) => m.priorModule),
  'posterior-predictive': () => import('./bayesCharts').then((m) => m.ppcModule),
  'sbc-rank': () => import('./bayesCharts').then((m) => m.sbcModule),
  'hazard-plot': () => import('./survivalExtraCharts').then((m) => m.hazardModule),
  'cumulative-incidence': () => import('./survivalExtraCharts').then((m) => m.cifModule),
  'joint-distribution': () => import('./distCharts').then((m) => m.jointModule),
  'return-level': () => import('./distCharts').then((m) => m.returnLevelModule),
  // physics, chemistry, mathematics
  'mandelbrot-set': () => import('./fractalCharts').then((m) => m.mandelbrotModule),
  'julia-set': () => import('./fractalCharts').then((m) => m.juliaModule),
  'newton-fractal': () => import('./fractalCharts').then((m) => m.newtonModule),
  'domain-coloring': () => import('./fractalCharts').then((m) => m.domainModule),
  'strange-attractor': () => import('./dynamicsCharts').then((m) => m.attractorModule),
  'poincare-section': () => import('./dynamicsCharts').then((m) => m.poincareModule),
  'radial-distribution': () => import('./condensedCharts').then((m) => m.rdfModule),
  'band-structure': () => import('./condensedCharts').then((m) => m.bandModule),
  'density-of-states': () => import('./condensedCharts').then((m) => m.dosModule),
  'phase-diagram': () => import('./condensedCharts').then((m) => m.phaseModule),
}
