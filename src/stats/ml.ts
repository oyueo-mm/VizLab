import { createRng, type Rng } from '../lib/random'
import { jacobiEigen } from './pca'

/** Machine-learning engine: classifiers, trees, a small MLP, model evaluation, interpretation (ICE / ALE / Shapley / permutation) and embeddings (t-SNE, UMAP). */

export type Matrix = number[][]

export const argmax = (a: readonly number[]) => { let b = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i; return b }
const sum = (a: readonly number[]) => { let s = 0; for (const v of a) s += v; return s }
const mean = (a: readonly number[]) => (a.length ? sum(a) / a.length : 0)
const sd = (a: readonly number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(sum(a.map((v) => (v - m) ** 2)) / (a.length - 1)) }
const sq = (a: readonly number[], b: readonly number[]) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return s }

export function shuffled(n: number, rng: Rng): number[] {
  const a = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

export function standardize(X: Matrix) {
  const p = X[0]?.length ?? 0
  const mu = Array.from({ length: p }, (_, j) => mean(X.map((r) => r[j])))
  const sg = Array.from({ length: p }, (_, j) => sd(X.map((r) => r[j])) || 1)
  return { mu, sg, Z: X.map((r) => r.map((v, j) => (v - mu[j]) / sg[j])) }
}

// ─── metrics ────────────────────────────────────────────────────────────────────────

/** Rows are actual classes, columns predicted classes. */
export function confusion(actual: readonly number[], predicted: readonly number[], k: number): number[][] {
  const m = Array.from({ length: k }, () => new Array<number>(k).fill(0))
  actual.forEach((a, i) => { const p = predicted[i]; if (a >= 0 && a < k && p >= 0 && p < k) m[a][p]++ })
  return m
}

export interface ClassMetrics { precision: number[]; recall: number[]; f1: number[]; support: number[]; accuracy: number; macroF1: number; macroPrecision: number; macroRecall: number }

export function classMetrics(m: readonly (readonly number[])[]): ClassMetrics {
  const k = m.length
  const total = sum(m.map((r) => sum(r)))
  const support = m.map((r) => sum(r))
  const predicted = Array.from({ length: k }, (_, j) => sum(m.map((r) => r[j])))
  const precision = m.map((_, i) => (predicted[i] ? m[i][i] / predicted[i] : 0))
  const recall = m.map((_, i) => (support[i] ? m[i][i] / support[i] : 0))
  const f1 = precision.map((p, i) => (p + recall[i] ? (2 * p * recall[i]) / (p + recall[i]) : 0))
  return { precision, recall, f1, support, accuracy: total ? sum(m.map((r, i) => r[i])) / total : 0, macroF1: mean(f1), macroPrecision: mean(precision), macroRecall: mean(recall) }
}

// ─── classifiers ────────────────────────────────────────────────────────────────────

export interface Classifier { k: number; proba(x: readonly number[]): number[] }
export type Fit = (X: Matrix, y: readonly number[]) => Classifier

export const predictAll = (c: Classifier, X: Matrix) => X.map((x) => argmax(c.proba(x)))
export const accuracy = (c: Classifier, X: Matrix, y: readonly number[]) => (X.length ? predictAll(c, X).filter((p, i) => p === y[i]).length / X.length : 0)

export function fitKnn(X: Matrix, y: readonly number[], k: number, nClass: number): Classifier {
  const kk = Math.max(1, Math.min(k, X.length))
  return {
    k: nClass,
    proba(x) {
      const d = X.map((r, i) => [sq(r, x), i] as const).sort((a, b) => a[0] - b[0]).slice(0, kk)
      const out = new Array<number>(nClass).fill(0)
      for (const [, i] of d) out[y[i]] += 1 / kk
      return out
    },
  }
}

export function fitGaussianNB(X: Matrix, y: readonly number[], nClass: number): Classifier {
  const p = X[0]?.length ?? 0
  const stats = Array.from({ length: nClass }, (_, c) => {
    const rows = X.filter((_, i) => y[i] === c)
    return { prior: (rows.length + 1) / (X.length + nClass), mu: Array.from({ length: p }, (_, j) => mean(rows.map((r) => r[j]))), v: Array.from({ length: p }, (_, j) => Math.max(1e-6, sd(rows.map((r) => r[j])) ** 2 || 1e-6)) }
  })
  return {
    k: nClass,
    proba(x) {
      const ll = stats.map((s) => Math.log(s.prior) + sum(x.map((xv, j) => -0.5 * Math.log(2 * Math.PI * s.v[j]) - (xv - s.mu[j]) ** 2 / (2 * s.v[j]))))
      const mx = Math.max(...ll)
      const e = ll.map((l) => Math.exp(l - mx))
      const z = sum(e)
      return e.map((v) => v / z)
    },
  }
}

/** All monomials of the inputs up to `degree` (without the constant). */
export function polyFeatures(x: readonly number[], degree: number): number[] {
  const out: number[] = [...x]
  let prev: { v: number; last: number }[] = x.map((v, i) => ({ v, last: i }))
  for (let d = 2; d <= degree; d++) {
    const next: { v: number; last: number }[] = []
    for (const t of prev) for (let i = t.last; i < x.length; i++) next.push({ v: t.v * x[i], last: i })
    out.push(...next.map((t) => t.v))
    prev = next
  }
  return out
}

export function softmax(z: readonly number[]): number[] {
  const mx = Math.max(...z)
  const e = z.map((v) => Math.exp(v - mx))
  const s = sum(e)
  return e.map((v) => v / s)
}

export interface LogisticOptions { degree?: number; l2?: number; epochs?: number; lr?: number }

/** Multinomial logistic regression on standardized polynomial features, full-batch gradient descent with L2 on the weights. */
export function fitLogistic(X: Matrix, y: readonly number[], nClass: number, { degree = 1, l2 = 0.01, epochs = 300, lr = 0.5 }: LogisticOptions = {}): Classifier {
  const F0 = X.map((r) => polyFeatures(r, degree))
  const { mu, sg, Z } = standardize(F0.length ? F0 : [[]])
  const d = F0[0]?.length ?? 0
  const n = X.length
  const W = Array.from({ length: nClass }, () => new Array<number>(d + 1).fill(0))
  for (let e = 0; e < epochs && n > 0; e++) {
    const g = W.map((w) => new Array<number>(w.length).fill(0))
    for (let i = 0; i < n; i++) {
      const p = softmax(W.map((w) => w[d] + sum(Z[i].map((v, j) => v * w[j]))))
      for (let c = 0; c < nClass; c++) { const r = p[c] - (y[i] === c ? 1 : 0); for (let j = 0; j < d; j++) g[c][j] += (r * Z[i][j]) / n; g[c][d] += r / n }
    }
    for (let c = 0; c < nClass; c++) for (let j = 0; j <= d; j++) W[c][j] -= lr * (g[c][j] + (j < d ? l2 * W[c][j] : 0))
  }
  return {
    k: nClass,
    proba(x) {
      const f = polyFeatures(x, degree).map((v, j) => (v - mu[j]) / sg[j])
      return softmax(W.map((w) => w[d] + sum(f.map((v, j) => v * w[j]))))
    },
  }
}

// ─── trees ──────────────────────────────────────────────────────────────────────────

export interface TreeNode {
  id: number; depth: number; n: number
  /** Class counts (classification) – empty for regression. */
  counts: number[]
  /** Gini impurity (classification) or variance (regression). */
  impurity: number
  /** Predicted class (classification) or mean (regression). */
  value: number
  feature: number; threshold: number
  left?: TreeNode; right?: TreeNode
}

export interface TreeOptions { maxDepth: number; minLeaf: number; /** Number of candidate features per split (random forest); all when omitted. */ mtry?: number; rng?: Rng }

const gini = (counts: readonly number[], n: number) => (n ? 1 - sum(counts.map((c) => (c / n) ** 2)) : 0)

/** CART: Gini impurity for class targets (`nClass > 0`), variance for numeric targets (`nClass = 0`). */
export function growTree(X: Matrix, y: readonly number[], nClass: number, opts: TreeOptions, rows?: number[]): TreeNode {
  const p = X[0]?.length ?? 0
  let counter = 0
  const build = (idx: number[], depth: number): TreeNode => {
    const n = idx.length
    const counts = nClass ? idx.reduce((a, i) => { a[y[i]]++; return a }, new Array<number>(nClass).fill(0)) : []
    const mu = nClass ? 0 : mean(idx.map((i) => y[i]))
    const impurity = nClass ? gini(counts, n) : mean(idx.map((i) => (y[i] - mu) ** 2))
    const node: TreeNode = { id: counter++, depth, n, counts, impurity, value: nClass ? argmax(counts) : mu, feature: -1, threshold: 0 }
    if (depth >= opts.maxDepth || n < 2 * opts.minLeaf || impurity < 1e-12) return node
    let feats = Array.from({ length: p }, (_, j) => j)
    if (opts.mtry && opts.mtry < p && opts.rng) feats = shuffled(p, opts.rng).slice(0, opts.mtry)
    let best = { gain: 1e-12, f: -1, t: 0 }
    for (const f of feats) {
      const order = idx.slice().sort((a, b) => X[a][f] - X[b][f])
      const lc = new Array<number>(nClass).fill(0)
      let ls = 0, lss = 0
      const ts = sum(order.map((i) => y[i])), tss = sum(order.map((i) => y[i] ** 2))
      for (let s = 0; s < n - 1; s++) {
        const i = order[s]
        if (nClass) lc[y[i]]++; else { ls += y[i]; lss += y[i] ** 2 }
        const nl = s + 1, nr = n - nl
        if (nl < opts.minLeaf || nr < opts.minLeaf || X[order[s + 1]][f] === X[i][f]) continue
        let child: number
        if (nClass) child = (nl * gini(lc, nl) + nr * gini(counts.map((c, k) => c - lc[k]), nr)) / n
        else child = (lss - ls ** 2 / nl + (tss - lss) - (ts - ls) ** 2 / nr) / n
        const gain = impurity - child
        if (gain > best.gain) best = { gain, f, t: (X[i][f] + X[order[s + 1]][f]) / 2 }
      }
    }
    if (best.f < 0) return node
    node.feature = best.f
    node.threshold = best.t
    node.left = build(idx.filter((i) => X[i][best.f] <= best.t), depth + 1)
    node.right = build(idx.filter((i) => X[i][best.f] > best.t), depth + 1)
    return node
  }
  return build(rows ?? X.map((_, i) => i), 0)
}

export function treeLeaf(root: TreeNode, x: readonly number[]): TreeNode {
  let n = root
  while (n.left && n.right) n = x[n.feature] <= n.threshold ? n.left : n.right
  return n
}

export const treeNodes = (root: TreeNode): TreeNode[] => (root.left && root.right ? [root, ...treeNodes(root.left), ...treeNodes(root.right)] : [root])

export function fitTree(X: Matrix, y: readonly number[], nClass: number, maxDepth: number, minLeaf = 1): Classifier & { root: TreeNode } {
  const root = growTree(X, y, nClass, { maxDepth, minLeaf })
  return {
    k: nClass, root,
    proba(x) { const l = treeLeaf(root, x); const n = l.n || 1; return l.counts.map((c) => c / n) },
  }
}

export interface Regressor { predict(x: readonly number[]): number }

/** Random forest regressor: bootstrap samples and a random feature subset at every split. */
export function fitForest(X: Matrix, y: readonly number[], { trees = 25, maxDepth = 5, minLeaf = 3, seed = 1 }: { trees?: number; maxDepth?: number; minLeaf?: number; seed?: number } = {}): Regressor {
  const rng = createRng(seed)
  const p = X[0]?.length ?? 0
  const mtry = Math.max(1, Math.round(p / 2))
  const roots = Array.from({ length: trees }, () => growTree(X, y, 0, { maxDepth, minLeaf, mtry, rng }, Array.from({ length: X.length }, () => Math.floor(rng() * X.length))))
  return { predict: (x) => mean(roots.map((r) => treeLeaf(r, x).value)) }
}

// ─── multilayer perceptron ──────────────────────────────────────────────────────────

export type Activation = 'relu' | 'tanh' | 'sigmoid'
const act = (a: Activation, z: number) => (a === 'relu' ? Math.max(0, z) : a === 'tanh' ? Math.tanh(z) : 1 / (1 + Math.exp(-z)))
const dact = (a: Activation, z: number, o: number) => (a === 'relu' ? (z > 0 ? 1 : 0) : a === 'tanh' ? 1 - o * o : o * (1 - o))

export interface Mlp { sizes: number[]; W: number[][][]; b: number[][]; act: Activation }

export function initMlp(inputs: number, hidden: readonly number[], outputs: number, a: Activation, seed: number): Mlp {
  const rng = createRng(seed)
  const sizes = [inputs, ...hidden, outputs]
  const W = sizes.slice(1).map((n, l) => Array.from({ length: n }, () => Array.from({ length: sizes[l] }, () => rng.normal(0, Math.sqrt((a === 'relu' ? 2 : 1) / sizes[l])))))
  const b = sizes.slice(1).map((n) => new Array<number>(n).fill(0))
  return { sizes, W, b, act: a }
}

export interface MlpPass { pre: number[][]; post: number[][]; out: number[] }

export function mlpForward(m: Mlp, x: readonly number[]): MlpPass {
  const pre: number[][] = [], post: number[][] = [x.slice()]
  let cur: number[] = x.slice()
  for (let l = 0; l < m.W.length; l++) {
    const z = m.W[l].map((w, i) => m.b[l][i] + sum(w.map((v, j) => v * cur[j])))
    pre.push(z)
    cur = l === m.W.length - 1 ? softmax(z) : z.map((v) => act(m.act, v))
    post.push(cur)
  }
  return { pre, post, out: cur }
}

export const mlpLoss = (m: Mlp, X: Matrix, y: readonly number[]) => (X.length ? sum(X.map((x, i) => -Math.log(Math.max(1e-12, mlpForward(m, x).out[y[i]])))) / X.length : 0)
export const mlpAccuracy = (m: Mlp, X: Matrix, y: readonly number[]) => (X.length ? X.filter((x, i) => argmax(mlpForward(m, x).out) === y[i]).length / X.length : 0)

export const mlpParams = (m: Mlp): number[] => m.W.flatMap((L, l) => [...L.flat(), ...m.b[l]])
export function mlpWithParams(m: Mlp, theta: readonly number[]): Mlp {
  let o = 0
  const W: number[][][] = [], b: number[][] = []
  m.W.forEach((L, l) => { W.push(L.map((row) => row.map(() => theta[o++]))); b.push(m.b[l].map(() => theta[o++])) })
  return { ...m, W, b }
}

export interface EpochLog { epoch: number; loss: number; acc: number; valLoss: number; valAcc: number; lr: number }
export interface MlpTrainOptions { hidden: number[]; act: Activation; lr: number; epochs: number; batch?: number; seed: number; l2?: number; schedule?: 'constant' | 'step' | 'cosine'; valFraction?: number }

/** Mini-batch SGD with momentum 0.9 on softmax cross-entropy. The last `valFraction` of a seeded shuffle is held out and never used for updates. */
export function trainMlp(X: Matrix, y: readonly number[], nClass: number, o: MlpTrainOptions) {
  const rng = createRng(o.seed)
  const order = shuffled(X.length, rng)
  const nVal = Math.floor(X.length * (o.valFraction ?? 0.2))
  const val = order.slice(0, nVal), tr = order.slice(nVal)
  const Xt = tr.map((i) => X[i]), yt = tr.map((i) => y[i]), Xv = val.map((i) => X[i]), yv = val.map((i) => y[i])
  let m = initMlp(X[0]?.length ?? 0, o.hidden, nClass, o.act, o.seed + 17)
  const vel = m.W.map((L) => L.map((r) => r.map(() => 0))), velB = m.b.map((r) => r.map(() => 0))
  const history: EpochLog[] = []
  const batch = o.batch ?? 32
  const log = (epoch: number, lr: number) => history.push({ epoch, loss: mlpLoss(m, Xt, yt), acc: mlpAccuracy(m, Xt, yt), valLoss: Xv.length ? mlpLoss(m, Xv, yv) : NaN, valAcc: Xv.length ? mlpAccuracy(m, Xv, yv) : NaN, lr })
  log(0, o.lr)
  for (let e = 1; e <= o.epochs; e++) {
    const lr = o.schedule === 'step' ? o.lr * 0.5 ** Math.floor((e - 1) / Math.max(1, o.epochs / 3)) : o.schedule === 'cosine' ? (o.lr * (1 + Math.cos((Math.PI * (e - 1)) / o.epochs))) / 2 + o.lr * 0.01 : o.lr
    const perm = shuffled(Xt.length, rng)
    for (let s = 0; s < perm.length; s += batch) {
      const ids = perm.slice(s, s + batch)
      const gW = m.W.map((L) => L.map((r) => r.map(() => 0))), gB = m.b.map((r) => r.map(() => 0))
      for (const i of ids) {
        const f = mlpForward(m, Xt[i])
        let delta = f.out.map((p, c) => p - (yt[i] === c ? 1 : 0))
        for (let l = m.W.length - 1; l >= 0; l--) {
          const prev = f.post[l]
          for (let a = 0; a < delta.length; a++) { gB[l][a] += delta[a]; for (let b = 0; b < prev.length; b++) gW[l][a][b] += delta[a] * prev[b] }
          if (l > 0) delta = prev.map((_, b) => sum(delta.map((d, a) => d * m.W[l][a][b])) * dact(m.act, f.pre[l - 1][b], prev[b]))
        }
      }
      const scale = 1 / ids.length
      for (let l = 0; l < m.W.length; l++) {
        for (let a = 0; a < m.W[l].length; a++) {
          velB[l][a] = 0.9 * velB[l][a] - lr * gB[l][a] * scale
          m.b[l][a] += velB[l][a]
          for (let b = 0; b < m.W[l][a].length; b++) { vel[l][a][b] = 0.9 * vel[l][a][b] - lr * (gW[l][a][b] * scale + (o.l2 ?? 0) * m.W[l][a][b]); m.W[l][a][b] += vel[l][a][b] }
        }
      }
    }
    log(e, lr)
  }
  m = { ...m }
  return { model: m, history, train: tr, val }
}

export function mlpClassifier(m: Mlp): Classifier { return { k: m.sizes[m.sizes.length - 1], proba: (x) => mlpForward(m, x).out } }

/** Loss on a 2-D slice through the trained weights, θ* + a·d₁ + b·d₂, with filter-normalised random directions (Li et al., 2018). */
export function lossSurface(m: Mlp, X: Matrix, y: readonly number[], extent: number, n: number, seed: number) {
  const rng = createRng(seed)
  const theta = mlpParams(m)
  const dir = () => {
    const d = mlpWithParams(m, theta.map(() => rng.normal()))
    // scale every neuron's incoming weights so the direction has the same norm as the trained weights
    d.W.forEach((L, l) => L.forEach((row, i) => { const nw = Math.hypot(...row) || 1, nt = Math.hypot(...m.W[l][i]); for (let j = 0; j < row.length; j++) row[j] *= nt / nw })); d.b.forEach((r) => r.fill(0))
    return mlpParams(d)
  }
  const d1 = dir(), d2 = dir()
  const grid = Array.from({ length: n }, (_, i) => -extent + (2 * extent * i) / (n - 1))
  const z = grid.map((b) => grid.map((a) => mlpLoss(mlpWithParams(m, theta.map((t, k) => t + a * d1[k] + b * d2[k])), X, y)))
  return { grid, z }
}

// ─── model specs, cross-validation, curves ──────────────────────────────────────────

export type ModelSpec =
  | { kind: 'knn'; k: number }
  | { kind: 'logistic'; degree: number; l2: number }
  | { kind: 'tree'; maxDepth: number; minLeaf: number }
  | { kind: 'nb' }
  | { kind: 'mlp'; hidden: number; epochs: number }

export function makeFit(spec: ModelSpec, nClass: number): Fit {
  switch (spec.kind) {
    case 'knn': return (X, y) => fitKnn(X, y, spec.k, nClass)
    case 'logistic': return (X, y) => fitLogistic(X, y, nClass, { degree: spec.degree, l2: spec.l2, epochs: 160 })
    case 'tree': return (X, y) => fitTree(X, y, nClass, spec.maxDepth, spec.minLeaf)
    case 'nb': return (X, y) => fitGaussianNB(X, y, nClass)
    case 'mlp': return (X, y) => { const { Z, mu, sg } = standardize(X); const r = trainMlp(Z, y, nClass, { hidden: [spec.hidden], act: 'tanh', lr: 0.05, epochs: spec.epochs, seed: 3, valFraction: 0 }); const c = mlpClassifier(r.model); return { k: nClass, proba: (x) => c.proba(x.map((v, j) => (v - mu[j]) / sg[j])) } }
  }
}

/** Stratified k-fold assignment: fold index per row. */
export function stratifiedFolds(y: readonly number[], folds: number, seed: number): number[] {
  const rng = createRng(seed)
  const fold = new Array<number>(y.length).fill(0)
  const byClass = new Map<number, number[]>()
  y.forEach((c, i) => byClass.set(c, [...(byClass.get(c) ?? []), i]))
  let off = 0
  for (const idx of byClass.values()) { const o = shuffled(idx.length, rng); o.forEach((k, pos) => { fold[idx[k]] = (pos + off) % folds }); off += idx.length }
  return fold
}

export function crossValidate(fit: Fit, X: Matrix, y: readonly number[], folds: number, seed: number) {
  const f = stratifiedFolds(y, folds, seed)
  const train: number[] = [], valid: number[] = []
  for (let k = 0; k < folds; k++) {
    const tr = X.map((_, i) => i).filter((i) => f[i] !== k), te = X.map((_, i) => i).filter((i) => f[i] === k)
    if (!tr.length || !te.length) continue
    const c = fit(tr.map((i) => X[i]), tr.map((i) => y[i]))
    train.push(accuracy(c, tr.map((i) => X[i]), tr.map((i) => y[i])))
    valid.push(accuracy(c, te.map((i) => X[i]), te.map((i) => y[i])))
  }
  return { train, valid, trainMean: mean(train), validMean: mean(valid), trainSd: sd(train), validSd: sd(valid) }
}

export interface CurvePoint { x: number; train: number; trainSd: number; valid: number; validSd: number }

/** Accuracy against the number of training rows: each fold is trained on the first m rows of a seeded shuffle of its training part. */
export function learningCurve(fit: Fit, X: Matrix, y: readonly number[], fractions: readonly number[], folds: number, seed: number): CurvePoint[] {
  const f = stratifiedFolds(y, folds, seed)
  const rng = createRng(seed + 1)
  return fractions.map((frac) => {
    const tr: number[] = [], va: number[] = []
    let size = 0
    for (let k = 0; k < folds; k++) {
      const trainIdx = shuffled(X.length, rng).filter((i) => f[i] !== k)
      const testIdx = X.map((_, i) => i).filter((i) => f[i] === k)
      const m = Math.max(2, Math.round(frac * trainIdx.length))
      const use = trainIdx.slice(0, m)
      size = m
      if (!testIdx.length) continue
      const c = fit(use.map((i) => X[i]), use.map((i) => y[i]))
      tr.push(accuracy(c, use.map((i) => X[i]), use.map((i) => y[i])))
      va.push(accuracy(c, testIdx.map((i) => X[i]), testIdx.map((i) => y[i])))
    }
    return { x: size, train: mean(tr), trainSd: sd(tr), valid: mean(va), validSd: sd(va) }
  })
}

// ─── clustering and silhouettes ─────────────────────────────────────────────────────

export function kmeans(X: Matrix, k: number, seed: number, iters = 60) {
  const rng = createRng(seed)
  const n = X.length
  if (!n) return { labels: [] as number[], centers: [] as number[][], inertia: 0 }
  // k-means++ seeding
  const centers = [X[Math.floor(rng() * n)].slice()]
  while (centers.length < Math.min(k, n)) {
    const d = X.map((x) => Math.min(...centers.map((c) => sq(x, c))))
    const tot = sum(d)
    let r = rng() * tot, pick = n - 1
    for (let i = 0; i < n; i++) { r -= d[i]; if (r <= 0) { pick = i; break } }
    centers.push(X[pick].slice())
  }
  let labels = new Array<number>(n).fill(0)
  for (let it = 0; it < iters; it++) {
    const next = X.map((x) => argmax(centers.map((c) => -sq(x, c))))
    const changed = next.some((l, i) => l !== labels[i])
    labels = next
    centers.forEach((c, ci) => { const rows = X.filter((_, i) => labels[i] === ci); if (rows.length) for (let j = 0; j < c.length; j++) c[j] = mean(rows.map((r) => r[j])) })
    if (!changed && it > 0) break
  }
  return { labels, centers, inertia: sum(X.map((x, i) => sq(x, centers[labels[i]]))) }
}

/** Silhouette s(i) = (b − a) / max(a, b); a = mean distance to the own cluster, b = smallest mean distance to another cluster. Singleton clusters get 0. */
export function silhouette(X: Matrix, labels: readonly number[]) {
  const ks = [...new Set(labels)].sort((a, b) => a - b)
  const idx = new Map(ks.map((k) => [k, X.map((_, i) => i).filter((i) => labels[i] === k)]))
  const s = X.map((x, i) => {
    const own = idx.get(labels[i])!
    if (own.length < 2) return 0
    const a = sum(own.filter((j) => j !== i).map((j) => Math.sqrt(sq(x, X[j])))) / (own.length - 1)
    let b = Infinity
    for (const k of ks) if (k !== labels[i]) b = Math.min(b, mean(idx.get(k)!.map((j) => Math.sqrt(sq(x, X[j])))))
    if (!Number.isFinite(b)) return 0
    return a === b ? 0 : (b - a) / Math.max(a, b)
  })
  return { s, mean: mean(s), clusters: ks.map((k) => ({ k, mean: mean(idx.get(k)!.map((i) => s[i])), size: idx.get(k)!.length })) }
}

// ─── interpretation ─────────────────────────────────────────────────────────────────

export type PredictFn = (x: readonly number[]) => number

const withFeature = (x: readonly number[], j: number, v: number) => { const c = x.slice(); c[j] = v; return c }

/** ICE: one curve per observation, varying feature j over `grid` while the other features stay as observed. PDP is their mean. */
export const iceCurves = (f: PredictFn, X: Matrix, j: number, grid: readonly number[]) => X.map((x) => grid.map((g) => f(withFeature(x, j, g))))
export const pdpOf = (curves: number[][]) => (curves.length ? curves[0].map((_, k) => mean(curves.map((c) => c[k]))) : [])

/** Accumulated Local Effects (Apley & Zhao, 2020): quantile bins, mean prediction difference across each bin, accumulated and centred. */
export function ale(f: PredictFn, X: Matrix, j: number, bins: number) {
  const xs = X.map((r) => r[j]).sort((a, b) => a - b)
  const n = xs.length
  if (n < 2) return { edges: [] as number[], effect: [] as number[], counts: [] as number[] }
  const edges = [xs[0]]
  for (let k = 1; k <= bins; k++) { const e = xs[Math.min(n - 1, Math.round((k * (n - 1)) / bins))]; if (e > edges[edges.length - 1]) edges.push(e) }
  if (edges.length < 2) return { edges, effect: [0], counts: [n] }
  const K = edges.length - 1
  const bin = (v: number) => { for (let k = 1; k <= K; k++) if (v <= edges[k]) return k - 1; return K - 1 }
  const sumD = new Array<number>(K).fill(0), counts = new Array<number>(K).fill(0)
  for (const x of X) { const k = bin(x[j]); sumD[k] += f(withFeature(x, j, edges[k + 1])) - f(withFeature(x, j, edges[k])); counts[k]++ }
  const g = [0]
  for (let k = 0; k < K; k++) g.push(g[k] + (counts[k] ? sumD[k] / counts[k] : 0))
  const centre = sum(counts.map((c, k) => (c * (g[k] + g[k + 1])) / 2)) / n
  return { edges, effect: g.map((v) => v - centre), counts }
}

/** Exact interventional Shapley values for a function of p features: v(S) = mean over the background of f(x_S, b_rest). Costs 2^p · |background| evaluations. */
export function shapExact(f: PredictFn, x: readonly number[], background: Matrix) {
  const p = x.length
  const masks = 1 << p
  const v = new Array<number>(masks)
  for (let m = 0; m < masks; m++) v[m] = mean(background.map((b) => f(x.map((xv, j) => (m & (1 << j) ? xv : b[j])))))
  const fact = [1]
  for (let i = 1; i <= p; i++) fact.push(fact[i - 1] * i)
  const phi = new Array<number>(p).fill(0)
  for (let j = 0; j < p; j++) {
    for (let m = 0; m < masks; m++) {
      if (m & (1 << j)) continue
      let size = 0
      for (let t = m; t; t &= t - 1) size++
      phi[j] += (fact[size] * fact[p - size - 1]) / fact[p] * (v[m | (1 << j)] - v[m])
    }
  }
  return { phi, base: v[0], fx: v[masks - 1] }
}

/** Drop in a score (higher is better) when one feature column is shuffled, averaged over repeats. */
export function permutationImportance(score: (X: Matrix) => number, X: Matrix, repeats: number, seed: number) {
  const rng = createRng(seed)
  const base = score(X)
  const p = X[0]?.length ?? 0
  return {
    base,
    features: Array.from({ length: p }, (_, j) => {
      const drops = Array.from({ length: repeats }, () => {
        const perm = shuffled(X.length, rng)
        return base - score(X.map((r, i) => withFeature(r, j, X[perm[i]][j])))
      })
      return { mean: mean(drops), sd: sd(drops), drops }
    }),
  }
}

export const r2Score = (y: readonly number[], pred: readonly number[]) => { const m = mean(y); const ss = sum(y.map((v) => (v - m) ** 2)); return ss ? 1 - sum(y.map((v, i) => (v - pred[i]) ** 2)) / ss : 0 }

// ─── embeddings ─────────────────────────────────────────────────────────────────────

export const pairwiseSq = (X: Matrix) => X.map((a) => X.map((b) => sq(a, b)))

/** Gaussian conditional probabilities p_{j|i} whose entropy matches log(perplexity); the bandwidth of every row is found by bisection. */
export function conditionalP(D: number[][], perplexity: number) {
  const n = D.length
  const target = Math.log(Math.max(1.01, Math.min(perplexity, n - 1)))
  const P = D.map(() => new Array<number>(n).fill(0)), beta = new Array<number>(n).fill(1), entropy = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) {
    let lo = 0, hi = Infinity, b = 1
    for (let it = 0; it < 60; it++) {
      let z = 0
      const row = new Array<number>(n).fill(0)
      let dm = Infinity
      for (let j = 0; j < n; j++) if (j !== i) dm = Math.min(dm, D[i][j])
      for (let j = 0; j < n; j++) if (j !== i) { row[j] = Math.exp(-(D[i][j] - dm) * b); z += row[j] }
      let h = 0
      for (let j = 0; j < n; j++) if (j !== i) { row[j] /= z; h -= row[j] > 1e-300 ? row[j] * Math.log(row[j]) : 0 }
      P[i] = row
      entropy[i] = h
      if (Math.abs(h - target) < 1e-6) break
      if (h > target) { lo = b; b = hi === Infinity ? b * 2 : (b + hi) / 2 } else { hi = b; b = (b + lo) / 2 }
    }
    beta[i] = b
  }
  return { P, beta, entropy }
}

export interface TsneResult { Y: number[][]; kl: number; klHistory: { iter: number; kl: number }[] }

/** Exact t-SNE (van der Maaten & Hinton, 2008): symmetric P, Student-t Q, early exaggeration, momentum and adaptive gains. */
export function tsne(X: Matrix, { perplexity = 30, iters = 400, seed = 1, lr = 100, exaggeration = 12 }: { perplexity?: number; iters?: number; seed?: number; lr?: number; exaggeration?: number } = {}): TsneResult {
  const n = X.length
  if (n < 3) return { Y: X.map((_, i) => [i, 0]), kl: 0, klHistory: [] }
  const rng = createRng(seed)
  const { P: C } = conditionalP(pairwiseSq(X), perplexity)
  const P = C.map((r, i) => r.map((v, j) => Math.max((v + C[j][i]) / (2 * n), 1e-12)))
  const Y = Array.from({ length: n }, () => [rng.normal(0, 1e-2), rng.normal(0, 1e-2)])
  const vel = Y.map(() => [0, 0]), gains = Y.map(() => [1, 1])
  const stopLying = Math.min(250, Math.floor(iters * 0.4))
  const klHistory: { iter: number; kl: number }[] = []
  const klOf = (num: number[][], Z: number) => { let kl = 0; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) kl += P[i][j] * Math.log(P[i][j] / Math.max(num[i][j] / Z, 1e-12)); return kl }
  let kl = 0
  for (let it = 0; it < iters; it++) {
    const num = Y.map((a) => Y.map((b) => 1 / (1 + (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)))
    let Z = 0
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) Z += num[i][j]
    const ex = it < stopLying ? exaggeration : 1
    const grad = Y.map(() => [0, 0])
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j) continue
      const m = (ex * P[i][j] - num[i][j] / Z) * num[i][j]
      grad[i][0] += 4 * m * (Y[i][0] - Y[j][0]); grad[i][1] += 4 * m * (Y[i][1] - Y[j][1])
    }
    const mom = it < stopLying ? 0.5 : 0.8
    for (let i = 0; i < n; i++) for (let d = 0; d < 2; d++) {
      gains[i][d] = Math.sign(grad[i][d]) !== Math.sign(vel[i][d]) ? gains[i][d] + 0.2 : Math.max(0.01, gains[i][d] * 0.8)
      vel[i][d] = mom * vel[i][d] - lr * gains[i][d] * grad[i][d]
      Y[i][d] += vel[i][d]
    }
    const cx = mean(Y.map((r) => r[0])), cy = mean(Y.map((r) => r[1]))
    for (const r of Y) { r[0] -= cx; r[1] -= cy }
    if (it % 25 === 0 || it === iters - 1) { kl = klOf(num, Z); if (it >= stopLying || it === 0) klHistory.push({ iter: it, kl }) }
  }
  return { Y, kl, klHistory }
}

/** Fits 1/(1 + a·x^(2b)) to the UMAP target membership curve (1 up to minDist, then exp(−(x − minDist)/spread)) by Gauss–Newton. */
export function findAB(minDist: number, spread = 1): { a: number; b: number } {
  const xs = Array.from({ length: 300 }, (_, i) => ((i + 1) / 300) * spread * 3)
  const target = xs.map((x) => (x <= minDist ? 1 : Math.exp(-(x - minDist) / spread)))
  let a = 1.5, b = 0.9
  const f = (x: number, a_: number, b_: number) => 1 / (1 + a_ * x ** (2 * b_))
  const cost = (a_: number, b_: number) => sum(xs.map((x, i) => (f(x, a_, b_) - target[i]) ** 2))
  for (let it = 0; it < 100; it++) {
    let jaa = 0, jab = 0, jbb = 0, ga = 0, gb = 0
    xs.forEach((x, i) => {
      const u = x ** (2 * b), fv = 1 / (1 + a * u), r = fv - target[i]
      const da = -u * fv * fv, db = -a * u * 2 * Math.log(x) * fv * fv
      jaa += da * da; jab += da * db; jbb += db * db; ga += da * r; gb += db * r
    })
    const det = (jaa + 1e-9) * (jbb + 1e-9) - jab * jab
    if (!Number.isFinite(det) || Math.abs(det) < 1e-18) break
    let step = 1
    const da = (-(jbb + 1e-9) * ga + jab * gb) / det, db = (jab * ga - (jaa + 1e-9) * gb) / det
    const c0 = cost(a, b)
    while (step > 1e-4 && (!(a + step * da > 0) || !(b + step * db > 0) || cost(a + step * da, b + step * db) > c0)) step /= 2
    if (step <= 1e-4) break
    a += step * da; b += step * db
  }
  return { a, b }
}

export interface UmapResult { Y: number[][]; a: number; b: number; graph: { i: number; j: number; w: number }[]; sigma: number[]; rho: number[] }

/** UMAP (McInnes et al., 2018): fuzzy simplicial set from exact k-NN with smooth distances, fuzzy union, PCA initialisation and SGD with negative sampling. */
export function umap(X: Matrix, { nNeighbors = 15, minDist = 0.1, epochs = 200, seed = 1 }: { nNeighbors?: number; minDist?: number; epochs?: number; seed?: number } = {}): UmapResult {
  const n = X.length
  const { a, b } = findAB(minDist)
  if (n < 4) return { Y: X.map((_, i) => [i, 0]), a, b, graph: [], sigma: [], rho: [] }
  const rng = createRng(seed)
  const k = Math.max(2, Math.min(nNeighbors, n - 1))
  const D = pairwiseSq(X).map((r) => r.map(Math.sqrt))
  const nbr = D.map((r, i) => r.map((d, j) => [d, j] as const).filter(([, j]) => j !== i).sort((p, q) => p[0] - q[0]).slice(0, k))
  const rho = nbr.map((l) => l.find(([d]) => d > 0)?.[0] ?? 0)
  const target = Math.log2(k)
  const sigma = nbr.map((l, i) => {
    let lo = 0, hi = Infinity, s = 1
    for (let it = 0; it < 64; it++) {
      const tot = sum(l.map(([d]) => Math.exp(-Math.max(0, d - rho[i]) / s)))
      if (Math.abs(tot - target) < 1e-5) break
      if (tot > target) { hi = s; s = (lo + hi) / 2 } else { lo = s; s = hi === Infinity ? s * 2 : (s + hi) / 2 }
    }
    return Math.max(s, 1e-3 * mean(l.map(([d]) => d)))
  })
  const W = new Map<number, number>()
  nbr.forEach((l, i) => l.forEach(([d, j]) => { const w = Math.exp(-Math.max(0, d - rho[i]) / sigma[i]); W.set(i * n + j, w) }))
  const edges = new Map<number, { i: number; j: number; w: number }>()
  for (const [key, w] of W) {
    const i = Math.floor(key / n), j = key % n
    const lo = Math.min(i, j), hi = Math.max(i, j), id = lo * n + hi
    if (edges.has(id)) continue
    const w2 = W.get(j * n + i) ?? 0
    edges.set(id, { i: lo, j: hi, w: w + w2 - w * w2 })
  }
  const graph = [...edges.values()]
  // PCA initialisation, scaled to a 10-unit box as in the reference implementation
  const mu = X[0].map((_, j) => mean(X.map((r) => r[j])))
  const cov = X[0].map((_, p) => X[0].map((_, q) => sum(X.map((r) => (r[p] - mu[p]) * (r[q] - mu[q]))) / n))
  const eig = jacobiEigen(cov).vectors
  const init = X.map((r) => [0, 1].map((c) => sum(r.map((v, j) => (v - mu[j]) * (eig[c]?.[j] ?? 0)))))
  const ext = Math.max(1e-9, ...init.flatMap((r) => r.map(Math.abs)))
  const Y = init.map((r) => r.map((v) => (v / ext) * 10 + rng.normal(0, 1e-2)))
  const wmax = Math.max(...graph.map((e) => e.w))
  const clip = (v: number) => Math.max(-4, Math.min(4, v))
  for (let ep = 0; ep < epochs; ep++) {
    const alpha = 1 - ep / epochs
    for (const e of graph) {
      if (rng() > e.w / wmax) continue
      const yi = Y[e.i], yj = Y[e.j]
      const d2 = (yi[0] - yj[0]) ** 2 + (yi[1] - yj[1]) ** 2
      if (d2 > 0) {
        const g = (-2 * a * b * d2 ** (b - 1)) / (1 + a * d2 ** b)
        for (let c = 0; c < 2; c++) { const gr = clip(g * (yi[c] - yj[c])); yi[c] += alpha * gr; yj[c] -= alpha * gr }
      }
      for (let s = 0; s < 5; s++) {
        const o = Math.floor(rng() * n)
        if (o === e.i) continue
        const yo = Y[o]
        const dd = (yi[0] - yo[0]) ** 2 + (yi[1] - yo[1]) ** 2
        const g = dd > 0 ? (2 * b) / ((0.001 + dd) * (1 + a * dd ** b)) : 0
        for (let c = 0; c < 2; c++) yi[c] += alpha * (g > 0 ? clip(g * (yi[c] - yo[c])) : 4)
      }
    }
  }
  return { Y, a, b, graph, sigma, rho }
}

/** Trustworthiness T(k) (Venna & Kaski): penalises points that are among the k nearest neighbours in the embedding but not in the original space. 1 is perfect. */
export function trustworthiness(X: Matrix, Y: Matrix, k: number): number {
  const n = X.length
  if (n <= k + 1) return 1
  const rankIn = (M: Matrix) => M.map((a, i) => { const order = M.map((b, j) => [sq(a, b), j] as const).filter(([, j]) => j !== i).sort((p, q) => p[0] - q[0]).map(([, j]) => j); const r = new Array<number>(n).fill(0); order.forEach((j, pos) => { r[j] = pos + 1 }); return { order, r } })
  const A = rankIn(X), B = rankIn(Y)
  let pen = 0
  for (let i = 0; i < n; i++) for (const j of B[i].order.slice(0, k)) if (A[i].r[j] > k) pen += A[i].r[j] - k
  return 1 - (2 / (n * k * (2 * n - 3 * k - 1))) * pen
}

// ─── attention ──────────────────────────────────────────────────────────────────────

export interface AttentionOptions { layers: number; heads: number; dModel: number; causal: boolean; pad: readonly boolean[]; temperature: number; seed: number }

const hashSeed = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }

/** Multi-head scaled dot-product attention with residual + layer norm over *randomly initialised, untrained* projections. Masked scores are −∞ before the softmax. */
export function selfAttention(tokens: readonly string[], o: AttentionOptions) {
  const n = tokens.length, d = o.dModel, dk = Math.max(2, Math.floor(d / o.heads))
  let H: number[][] = tokens.map((t, i) => {
    const r = createRng(hashSeed(t))
    return Array.from({ length: d }, (_, c) => r.normal() * 0.7 + (c % 2 ? Math.cos(i / 10000 ** ((c - 1) / d)) : Math.sin(i / 10000 ** (c / d))))
  })
  const rng = createRng(o.seed)
  const proj = (rows: number, cols: number) => Array.from({ length: rows }, () => Array.from({ length: cols }, () => rng.normal(0, 1 / Math.sqrt(rows))))
  const mat = (X: number[][], W: number[][]) => X.map((r) => W[0].map((_, c) => sum(r.map((v, k) => v * W[k][c]))))
  const maps: number[][][][] = []
  for (let l = 0; l < o.layers; l++) {
    const layerMaps: number[][][] = []
    const outs: number[][][] = []
    for (let h = 0; h < o.heads; h++) {
      const Q = mat(H, proj(d, dk)), K = mat(H, proj(d, dk)), V = mat(H, proj(d, dk))
      const A = Q.map((q, i) => {
        const scores = K.map((k, j) => (o.pad[j] || (o.causal && j > i) ? -Infinity : sum(q.map((v, c) => v * k[c])) / (Math.sqrt(dk) * o.temperature)))
        if (scores.every((s) => s === -Infinity)) return scores.map(() => 0)
        return softmax(scores.map((s) => (s === -Infinity ? -1e30 : s))).map((v, j) => (scores[j] === -Infinity ? 0 : v))
      })
      layerMaps.push(A)
      outs.push(A.map((row) => V[0].map((_, c) => sum(row.map((w, j) => w * V[j][c])))))
    }
    maps.push(layerMaps)
    const Wo = proj(dk * o.heads, d)
    const cat = H.map((_, i) => outs.flatMap((oh) => oh[i]))
    const upd = mat(cat, Wo)
    H = H.map((r, i) => { const z = r.map((v, c) => v + upd[i][c]); const m = mean(z), s = Math.sqrt(mean(z.map((v) => (v - m) ** 2)) + 1e-5); return z.map((v) => (v - m) / s) })
  }
  return { maps, n }
}

/** Out-of-fold class predictions: every row is predicted by a model that never saw it (stratified k-fold). */
export function outOfFold(fit: Fit, X: Matrix, y: readonly number[], folds: number, seed: number): number[][] {
  const f = stratifiedFolds(y, folds, seed)
  const out = new Array<number[]>(X.length)
  for (let k = 0; k < folds; k++) {
    const tr = X.map((_, i) => i).filter((i) => f[i] !== k)
    const te = X.map((_, i) => i).filter((i) => f[i] === k)
    if (!tr.length) continue
    const c = fit(tr.map((i) => X[i]), tr.map((i) => y[i]))
    for (const i of te) out[i] = c.proba(X[i])
  }
  return out
}
