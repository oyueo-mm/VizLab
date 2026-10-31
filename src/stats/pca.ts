/** Eigen-decomposition of a symmetric matrix by cyclic Jacobi rotations. Returns eigenvalues descending; vectors[k] is the k-th eigenvector. */
export function jacobiEigen(matrix: readonly (readonly number[])[]): { values: number[]; vectors: number[][] } {
  const n = matrix.length
  const a = matrix.map((r) => [...r])
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] ** 2
    if (off < 1e-24) break
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < n; k++) {
          const akp = a[k][p]
          const akq = a[k][q]
          a[k][p] = c * akp - s * akq
          a[k][q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k]
          const aqk = a[q][k]
          a[p][k] = c * apk - s * aqk
          a[q][k] = s * apk + c * aqk
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p]
          const vkq = v[k][q]
          v[k][p] = c * vkp - s * vkq
          v[k][q] = s * vkp + c * vkq
        }
      }
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[j][j] - a[i][i])
  const values = order.map((i) => a[i][i])
  const vectors = order.map((i) => {
    const vec = v.map((row) => row[i])
    // Fix the sign so each eigenvector's largest component is positive (eigenvectors are only defined up to sign).
    const big = vec.reduce((m, x) => (Math.abs(x) > Math.abs(m) ? x : m), 0)
    return big < 0 ? vec.map((x) => -x) : vec
  })
  return { values, vectors }
}

export interface PcaOptions { center: boolean; scale: boolean }

export interface PcaResult {
  /** Number of observations n and variables p. */
  n: number
  p: number
  means: number[]
  /** Divisors applied to each column (sample standard deviation when scaling, else 1). */
  scales: number[]
  eigenvalues: number[]
  /** vectors[k][j]: weight of variable j in principal component k (unit length). */
  vectors: number[][]
  /** scores[i][k]: coordinate of observation i on component k. */
  scores: number[][]
  /** Fraction of the total variance carried by each component. */
  explained: number[]
  /** loadings[k][j] = vectors[k][j] · √λₖ. With standardised data this is the correlation between variable j and component k. */
  loadings: number[][]
  /** Columns with zero variance that could not be standardised. */
  constant: number[]
}

/**
 * Principal component analysis of the rows × columns matrix. The covariance (or, when scaling, correlation)
 * matrix uses the n − 1 denominator; its eigenvectors are the principal axes and its eigenvalues the variances of the scores.
 */
export function pca(data: readonly (readonly number[])[], { center, scale }: PcaOptions): PcaResult | null {
  const n = data.length
  const p = data[0]?.length ?? 0
  if (n < 3 || p < 2) return null
  const means = Array.from({ length: p }, (_, j) => (center ? data.reduce((s, r) => s + r[j], 0) / n : 0))
  const sds = Array.from({ length: p }, (_, j) => Math.sqrt(data.reduce((s, r) => s + (r[j] - means[j]) ** 2, 0) / (n - 1)))
  const constant = sds.map((s, j) => (s < 1e-12 ? j : -1)).filter((j) => j >= 0)
  const scales = sds.map((s) => (scale && s >= 1e-12 ? s : 1))
  const x = data.map((r) => r.map((v, j) => (v - means[j]) / scales[j]))
  const cov = Array.from({ length: p }, () => new Array<number>(p).fill(0))
  for (const r of x) for (let i = 0; i < p; i++) for (let j = i; j < p; j++) cov[i][j] += r[i] * r[j]
  for (let i = 0; i < p; i++) for (let j = i; j < p; j++) { cov[i][j] /= n - 1; cov[j][i] = cov[i][j] }
  const { values, vectors } = jacobiEigen(cov)
  const eigenvalues = values.map((v) => Math.max(0, v))
  const total = eigenvalues.reduce((s, v) => s + v, 0) || 1
  const scores = x.map((r) => vectors.map((vec) => vec.reduce((s, w, j) => s + w * r[j], 0)))
  return {
    n, p, means, scales, eigenvalues, vectors, scores,
    explained: eigenvalues.map((v) => v / total),
    loadings: vectors.map((vec, k) => vec.map((w) => w * Math.sqrt(eigenvalues[k]))),
    constant,
  }
}
