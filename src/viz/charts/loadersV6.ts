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
}
