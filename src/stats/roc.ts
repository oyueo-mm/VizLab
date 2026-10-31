export interface Scored { score: number; label: 0 | 1; row: number }

export interface Confusion { tp: number; fp: number; tn: number; fn: number }

/** A prediction is positive when score ≥ threshold. */
export function confusionAt(data: readonly Scored[], threshold: number): Confusion {
  let tp = 0, fp = 0, tn = 0, fn = 0
  for (const d of data) {
    const pred = d.score >= threshold
    if (d.label === 1) { if (pred) tp++; else fn++ } else if (pred) fp++; else tn++
  }
  return { tp, fp, tn, fn }
}

export const tpr = (c: Confusion) => (c.tp + c.fn ? c.tp / (c.tp + c.fn) : 0)
export const fpr = (c: Confusion) => (c.fp + c.tn ? c.fp / (c.fp + c.tn) : 0)
/** Precision is 1 by convention when nothing is predicted positive. */
export const precision = (c: Confusion) => (c.tp + c.fp ? c.tp / (c.tp + c.fp) : 1)

export interface CurvePoint extends Confusion { threshold: number; tpr: number; fpr: number; precision: number; recall: number }

/** Why the labelled scores cannot form a curve, or null. */
export function curveIssue(data: readonly Scored[]): string | null {
  const pos = data.filter((d) => d.label === 1).length
  if (!data.length) return '예측 점수와 실제 레이블이 있는 행이 없습니다.'
  if (pos === 0) return '양성(1) 표본이 없어 곡선을 그릴 수 없습니다. 실제 레이블에 1이 하나 이상 필요합니다.'
  if (pos === data.length) return '음성(0) 표본이 없어 곡선을 그릴 수 없습니다. 실제 레이블에 0이 하나 이상 필요합니다.'
  return null
}

/**
 * One curve point per distinct score, from the strictest threshold (nothing predicted positive) to the loosest.
 * Tied scores share a single threshold, so a tie produces one diagonal step rather than an arbitrary staircase.
 */
export function curvePoints(data: readonly Scored[]): CurvePoint[] {
  const sorted = [...data].sort((a, b) => b.score - a.score)
  const P = sorted.filter((d) => d.label === 1).length
  const N = sorted.length - P
  const pts: CurvePoint[] = [{ threshold: Infinity, tp: 0, fp: 0, fn: P, tn: N, tpr: 0, fpr: 0, precision: 1, recall: 0 }]
  let tp = 0
  let fp = 0
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].label === 1) tp++
    else fp++
    if (i + 1 < sorted.length && sorted[i + 1].score === sorted[i].score) continue
    const c = { tp, fp, fn: P - tp, tn: N - fp }
    pts.push({ threshold: sorted[i].score, ...c, tpr: tp / P, fpr: N ? fp / N : 0, precision: tp / (tp + fp), recall: tp / P })
  }
  return pts
}

const trapezoid = (xs: readonly number[], ys: readonly number[]) => {
  let a = 0
  for (let i = 1; i < xs.length; i++) a += ((xs[i] - xs[i - 1]) * (ys[i] + ys[i - 1])) / 2
  return a
}

/** Area under the ROC curve by the trapezoid rule over (FPR, TPR). */
export function rocAuc(points: readonly CurvePoint[]) {
  return trapezoid(points.map((p) => p.fpr), points.map((p) => p.tpr))
}

/** The same AUC from ranks: P(score of a random positive > score of a random negative), ties counting ½ (Mann–Whitney U / (P·N)). */
export function aucByRanks(data: readonly Scored[]): number {
  const pos = data.filter((d) => d.label === 1)
  const neg = data.filter((d) => d.label === 0)
  if (!pos.length || !neg.length) return NaN
  let u = 0
  for (const p of pos) for (const n of neg) u += p.score > n.score ? 1 : p.score === n.score ? 0.5 : 0
  return u / (pos.length * neg.length)
}

/**
 * Average precision: AP = Σₖ (Rₖ − Rₖ₋₁) · Pₖ, a step-wise sum over thresholds that does not interpolate between points
 * (the definition used by scikit-learn's average_precision_score).
 */
export function averagePrecision(points: readonly CurvePoint[]) {
  let ap = 0
  for (let i = 1; i < points.length; i++) ap += (points[i].recall - points[i - 1].recall) * points[i].precision
  return ap
}

/** Trapezoid area under the precision–recall curve, starting at (recall 0, precision 1). Linear interpolation between points is optimistic, so it differs from AP. */
export function prAucTrapezoid(points: readonly CurvePoint[]) {
  return trapezoid(points.map((p) => p.recall), points.map((p) => p.precision))
}

/** Share of positives in the data — the precision of a random classifier and the PR baseline. */
export const prevalence = (data: readonly Scored[]) => (data.length ? data.filter((d) => d.label === 1).length / data.length : 0)

/** The curve point reached with the given threshold: the confusion counts at that threshold. */
export function pointAt(data: readonly Scored[], threshold: number): CurvePoint {
  const c = confusionAt(data, threshold)
  return { threshold, ...c, tpr: tpr(c), fpr: fpr(c), precision: precision(c), recall: tpr(c) }
}
