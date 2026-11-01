import { describe, expect, it } from 'vitest'
import { createRng } from '../lib/random'
import {
  ale, classMetrics, conditionalP, confusion, crossValidate, findAB, fitForest, fitKnn, fitLogistic, fitTree, growTree, iceCurves, kmeans, learningCurve, lossSurface, makeFit, mlpClassifier,
  mlpForward, mlpLoss, mlpParams, mlpWithParams, pairwiseSq, pdpOf, permutationImportance, r2Score, selfAttention, shapExact, silhouette, trainMlp, treeNodes, trustworthiness, tsne, umap, accuracy,
  type Matrix,
} from './ml'

/** Two Gaussian blobs and a third far away; labels 0..2. */
function blobs(n: number, seed: number, sep = 4): { X: Matrix; y: number[] } {
  const r = createRng(seed)
  const centers = [[0, 0], [sep, 0], [sep / 2, sep]]
  const X: Matrix = [], y: number[] = []
  for (let i = 0; i < n; i++) { const c = i % 3; X.push([centers[c][0] + r.normal(0, 0.6), centers[c][1] + r.normal(0, 0.6)]); y.push(c) }
  return { X, y }
}

describe('classification metrics', () => {
  it('confusion matrix, precision, recall and F1 follow the definitions', () => {
    const actual = [0, 0, 0, 0, 1, 1, 1, 2, 2, 2]
    const pred = [0, 0, 1, 0, 1, 1, 2, 2, 2, 0]
    const m = confusion(actual, pred, 3)
    expect(m).toEqual([[3, 1, 0], [0, 2, 1], [1, 0, 2]])
    const s = classMetrics(m)
    expect(s.accuracy).toBeCloseTo(0.7, 12)
    expect(s.precision[0]).toBeCloseTo(3 / 4, 12)
    expect(s.recall[0]).toBeCloseTo(3 / 4, 12)
    expect(s.precision[2]).toBeCloseTo(2 / 3, 12)
    expect(s.recall[1]).toBeCloseTo(2 / 3, 12)
    expect(s.f1[1]).toBeCloseTo((2 * (2 / 3) * (2 / 3)) / (4 / 3), 12)
    expect(s.support).toEqual([4, 3, 3])
  })
})

describe('classifiers', () => {
  const { X, y } = blobs(150, 3)
  it('every model separates well-separated blobs and returns probabilities that sum to 1', () => {
    for (const spec of [{ kind: 'knn', k: 5 }, { kind: 'logistic', degree: 1, l2: 0.01 }, { kind: 'tree', maxDepth: 4, minLeaf: 2 }, { kind: 'nb' }, { kind: 'mlp', hidden: 8, epochs: 60 }] as const) {
      const c = makeFit(spec, 3)(X, y)
      expect(accuracy(c, X, y), spec.kind).toBeGreaterThan(0.9)
      const p = c.proba([1, 1])
      expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
    }
  })
  it('a deep tree memorises the data, a depth-1 stump does not', () => {
    expect(accuracy(fitTree(X, y, 3, 20, 1), X, y)).toBe(1)
    expect(accuracy(fitTree(X, y, 3, 1, 1), X, y)).toBeLessThan(0.75)
  })
  it('the tree splits reduce impurity and the root counts match the data', () => {
    const root = growTree(X, y, 3, { maxDepth: 3, minLeaf: 2 })
    expect(root.counts.reduce((a, b) => a + b, 0)).toBe(150)
    expect(root.impurity).toBeCloseTo(1 - 3 * (1 / 3) ** 2, 9)
    for (const n of treeNodes(root)) if (n.left && n.right) expect((n.left.n * n.left.impurity + n.right.n * n.right.impurity) / n.n).toBeLessThan(n.impurity)
  })
  it('1-NN reproduces its own training labels and logistic regression on a linearly separable pair is exact', () => {
    expect(accuracy(fitKnn(X, y, 1, 3), X, y)).toBe(1)
    const sep: Matrix = [[-2, 0], [-1, 0.3], [1, -0.2], [2, 0.1]]
    expect(accuracy(fitLogistic(sep, [0, 0, 1, 1], 2, { epochs: 400 }), sep, [0, 0, 1, 1])).toBe(1)
  })
  it('overlapping classes cannot be perfectly cross-validated while separated ones can', () => {
    const easy = crossValidate(makeFit({ kind: 'knn', k: 5 }, 3), X, y, 5, 1)
    const hard = blobs(150, 3, 0.6)
    const cv = crossValidate(makeFit({ kind: 'knn', k: 5 }, 3), hard.X, hard.y, 5, 1)
    expect(easy.validMean).toBeGreaterThan(0.95)
    expect(cv.validMean).toBeLessThan(0.7)
  })
  it('the learning curve training score starts high and validation score does not decrease overall', () => {
    const h = blobs(120, 5, 1.6)
    const curve = learningCurve(makeFit({ kind: 'tree', maxDepth: 12, minLeaf: 1 }, 3), h.X, h.y, [0.15, 0.4, 0.7, 1], 5, 2)
    expect(curve[0].train).toBeGreaterThan(0.95)
    expect(curve[3].valid).toBeGreaterThanOrEqual(curve[0].valid - 0.05)
    expect(curve[3].train).toBeGreaterThanOrEqual(curve[3].valid)
  })
})

describe('MLP', () => {
  const { X, y } = blobs(120, 2)
  it('training lowers the loss and the gradient steps are consistent with the parameter vector', () => {
    const r = trainMlp(X, y, 3, { hidden: [8], act: 'tanh', lr: 0.05, epochs: 40, seed: 4 })
    expect(r.history[r.history.length - 1].loss).toBeLessThan(r.history[0].loss * 0.5)
    expect(r.history[r.history.length - 1].acc).toBeGreaterThan(0.9)
    const back = mlpWithParams(r.model, mlpParams(r.model))
    expect(mlpLoss(back, X, y)).toBeCloseTo(mlpLoss(r.model, X, y), 12)
    expect(mlpForward(r.model, X[0]).out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
    expect(mlpClassifier(r.model).k).toBe(3)
  })
  it('numerical gradient of the loss agrees with the direction SGD moves in (loss decreases along −∇)', () => {
    const r = trainMlp(X, y, 3, { hidden: [5], act: 'relu', lr: 0.02, epochs: 5, seed: 1 })
    const theta = mlpParams(r.model)
    const f = (t: number[]) => mlpLoss(mlpWithParams(r.model, t), X, y)
    const g = theta.map((_, i) => { const h = 1e-5; const a = theta.slice(), b = theta.slice(); a[i] += h; b[i] -= h; return (f(a) - f(b)) / (2 * h) })
    const norm = Math.hypot(...g)
    const step = theta.map((t, i) => t - (0.01 * g[i]) / norm)
    expect(f(step)).toBeLessThan(f(theta))
  })
  it('the loss surface has the trained loss at its centre', () => {
    const r = trainMlp(X, y, 3, { hidden: [4], act: 'tanh', lr: 0.05, epochs: 15, seed: 4 })
    const s = lossSurface(r.model, X, y, 1, 5, 1)
    expect(s.z[2][2]).toBeCloseTo(mlpLoss(r.model, X, y), 12)
    expect(Math.max(...s.z.flat())).toBeGreaterThan(s.z[2][2])
  })
})

describe('silhouette and k-means', () => {
  it('matches the hand-computed value for two 1-D clusters', () => {
    const X: Matrix = [[0], [1], [10], [11]]
    const r = silhouette(X, [0, 0, 1, 1])
    expect(r.s[0]).toBeCloseTo((10.5 - 1) / 10.5, 12)
    expect(r.s[1]).toBeCloseTo((9.5 - 1) / 9.5, 12)
    expect(r.clusters.map((c) => c.size)).toEqual([2, 2])
  })
  it('k-means finds the 3 blobs and the mean silhouette is highest at the true k', () => {
    const { X } = blobs(150, 9)
    const score = (k: number) => silhouette(X, kmeans(X, k, 1).labels).mean
    expect(score(3)).toBeGreaterThan(score(2))
    expect(score(3)).toBeGreaterThan(score(6))
    expect(score(3)).toBeGreaterThan(0.6)
  })
})

describe('interpretation methods', () => {
  const r = createRng(11)
  const X: Matrix = Array.from({ length: 200 }, () => [r.normal(), r.normal(), r.normal()])
  const linear = (x: readonly number[]) => 2 * x[0] - 3 * x[1] + 0.5
  it('ALE of a linear feature has that feature\'s slope and is centred', () => {
    const a = ale(linear, X, 0, 10)
    for (let k = 1; k < a.edges.length; k++) expect((a.effect[k] - a.effect[k - 1]) / (a.edges[k] - a.edges[k - 1])).toBeCloseTo(2, 9)
    const n = a.counts.reduce((s, c) => s + c, 0)
    expect(a.counts.reduce((s, c, k) => s + (c * (a.effect[k] + a.effect[k + 1])) / 2, 0) / n).toBeCloseTo(0, 9)
  })
  it('ICE curves of an additive function are parallel and the PDP is their mean', () => {
    const grid = [-1, 0, 1]
    const curves = iceCurves(linear, X.slice(0, 20), 0, grid)
    for (const c of curves) { expect(c[2] - c[1]).toBeCloseTo(2, 12); expect(c[1] - c[0]).toBeCloseTo(2, 12) }
    expect(pdpOf(curves)[2] - pdpOf(curves)[0]).toBeCloseTo(4, 12)
  })
  it('exact Shapley values add up to f(x) − E[f] and equal the linear closed form βj (xj − E xj)', () => {
    const bg = X.slice(0, 60)
    const x = [1.2, -0.7, 0.4]
    const s = shapExact(linear, x, bg)
    expect(s.phi.reduce((a, b) => a + b, 0)).toBeCloseTo(s.fx - s.base, 10)
    const mu = [0, 1, 2].map((j) => bg.reduce((a, b) => a + b[j], 0) / bg.length)
    expect(s.phi[0]).toBeCloseTo(2 * (x[0] - mu[0]), 10)
    expect(s.phi[1]).toBeCloseTo(-3 * (x[1] - mu[1]), 10)
    expect(s.phi[2]).toBeCloseTo(0, 10)
  })
  it('Shapley values of a nonlinear model still sum to the prediction gap', () => {
    const y = X.map((x) => x[0] * x[1] + Math.sin(x[2]))
    const f = fitForest(X, y, { trees: 10, maxDepth: 4, seed: 3 })
    const s = shapExact((x) => f.predict(x), [0.5, 1, -0.3], X.slice(0, 30))
    expect(s.phi.reduce((a, b) => a + b, 0)).toBeCloseTo(s.fx - s.base, 9)
  })
  it('permutation importance ranks the informative feature first and a noise feature near zero', () => {
    const y = X.map((x) => 3 * x[0] + 0.2 * x[1])
    const f = fitForest(X, y, { trees: 20, maxDepth: 5, seed: 2 })
    const imp = permutationImportance((M) => r2Score(y, M.map((x) => f.predict(x))), X, 5, 1)
    expect(imp.features[0].mean).toBeGreaterThan(imp.features[1].mean)
    expect(imp.features[0].mean).toBeGreaterThan(0.5)
    expect(Math.abs(imp.features[2].mean)).toBeLessThan(0.1)
  })
})

describe('embeddings', () => {
  function highDim(seed: number) {
    const rg = createRng(seed)
    const X: Matrix = [], y: number[] = []
    for (let i = 0; i < 90; i++) { const c = i % 3; X.push(Array.from({ length: 8 }, (_, j) => (j % 3 === c ? 5 : 0) + rg.normal(0, 0.8))); y.push(c) }
    return { X, y }
  }
  it('every row of P has the requested perplexity (2^H = perplexity)', () => {
    const { X } = highDim(1)
    const { entropy, P } = conditionalP(pairwiseSq(X), 15)
    for (const h of entropy.slice(0, 20)) expect(Math.exp(h)).toBeCloseTo(15, 3)
    expect(P[0].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
    expect(P[0][0]).toBe(0)
  })
  it('t-SNE lowers the KL divergence and separates the clusters in 2-D', () => {
    const { X, y } = highDim(2)
    const r = tsne(X, { perplexity: 15, iters: 300, seed: 1 })
    expect(r.klHistory[r.klHistory.length - 1].kl).toBeLessThan(r.klHistory[0].kl)
    expect(r.kl).toBeLessThan(1)
    expect(accuracy(fitKnn(r.Y, y, 5, 3), r.Y, y)).toBeGreaterThan(0.95)
    expect(trustworthiness(X, r.Y, 5)).toBeGreaterThan(0.9)
  })
  it('UMAP curve fit reproduces the reference constants for min_dist = 0.1 (umap-learn: a = 1.577, b = 0.895)', () => {
    const { a, b } = findAB(0.1)
    expect(a).toBeCloseTo(1.577, 2)
    expect(b).toBeCloseTo(0.895, 2)
  })
  it('UMAP keeps neighbourhoods and separates the clusters', () => {
    const { X, y } = highDim(3)
    const r = umap(X, { nNeighbors: 10, minDist: 0.1, epochs: 200, seed: 1 })
    expect(r.graph.length).toBeGreaterThan(X.length)
    for (const e of r.graph) { expect(e.w).toBeGreaterThan(0); expect(e.w).toBeLessThanOrEqual(1 + 1e-9) }
    expect(accuracy(fitKnn(r.Y, y, 5, 3), r.Y, y)).toBeGreaterThan(0.95)
    expect(trustworthiness(X, r.Y, 5)).toBeGreaterThan(0.9)
  })
  it('trustworthiness is 1 for an identity embedding', () => {
    const { X } = highDim(4)
    expect(trustworthiness(X, X, 5)).toBeCloseTo(1, 12)
  })
})

describe('attention', () => {
  const tokens = ['나는', '오늘', '학교에', '갔다', '나는', 'pad']
  const base = { layers: 2, heads: 3, dModel: 16, causal: false, pad: [false, false, false, false, false, true], temperature: 1, seed: 5 }
  it('rows are probability distributions and padded keys receive zero weight', () => {
    const { maps } = selfAttention(tokens, base)
    expect(maps.length).toBe(2)
    expect(maps[0].length).toBe(3)
    for (const L of maps) for (const H of L) for (const row of H) { expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9); expect(row[5]).toBe(0) }
  })
  it('a causal mask zeroes the upper triangle and a low temperature sharpens the distribution', () => {
    const c = selfAttention(tokens, { ...base, causal: true, pad: base.pad.map(() => false) })
    c.maps[0][0].forEach((row, i) => row.forEach((v, j) => { if (j > i) expect(v).toBe(0) }))
    expect(c.maps[0][0][0][0]).toBeCloseTo(1, 9)
    const hot = selfAttention(tokens, { ...base, temperature: 0.2 }).maps[0][0], flat = selfAttention(tokens, { ...base, temperature: 5 }).maps[0][0]
    expect(Math.max(...hot[1])).toBeGreaterThan(Math.max(...flat[1]))
  })
})
