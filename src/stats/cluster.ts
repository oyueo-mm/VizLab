/**
 * Agglomerative hierarchical clustering with Lance–Williams updates.
 * Output follows SciPy's linkage convention: leaves are 0…n−1, the k-th merge creates cluster n+k,
 * and `height` is the linkage distance at which the two clusters were joined.
 */

export type Metric = 'euclidean' | 'manhattan'
export type Linkage = 'single' | 'complete' | 'average' | 'ward'

export interface Merge { a: number; b: number; height: number; size: number }

export function distance(p: readonly number[], q: readonly number[], metric: Metric) {
  let s = 0
  for (let i = 0; i < p.length; i++) {
    const d = p[i] - q[i]
    s += metric === 'manhattan' ? Math.abs(d) : d * d
  }
  return metric === 'manhattan' ? s : Math.sqrt(s)
}

export function hclust(points: readonly (readonly number[])[], metric: Metric = 'euclidean', linkage: Linkage = 'average'): Merge[] {
  const n = points.length
  if (n < 2) return []
  // Ward works on squared Euclidean distances (Lance–Williams form) and reports their square root.
  const ward = linkage === 'ward'
  const D: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const d = distance(points[i], points[j], ward ? 'euclidean' : metric)
      D[i][j] = D[j][i] = ward ? d * d : d
    }
  const active = new Set(Array.from({ length: n }, (_, i) => i))
  const size = new Array<number>(n).fill(1)
  const label = Array.from({ length: n }, (_, i) => i)
  const merges: Merge[] = []
  for (let step = 0; step < n - 1; step++) {
    let bi = -1
    let bj = -1
    let best = Infinity
    for (const i of active)
      for (const j of active) {
        if (j <= i) continue
        // ties resolve to the lowest index pair, which keeps the result deterministic
        if (D[i][j] < best) { best = D[i][j]; bi = i; bj = j }
      }
    const ni = size[bi]
    const nj = size[bj]
    for (const k of active) {
      if (k === bi || k === bj) continue
      const dik = D[bi][k]
      const djk = D[bj][k]
      let v: number
      if (linkage === 'single') v = Math.min(dik, djk)
      else if (linkage === 'complete') v = Math.max(dik, djk)
      else if (linkage === 'average') v = (ni * dik + nj * djk) / (ni + nj)
      else {
        const nk = size[k]
        v = ((ni + nk) * dik + (nj + nk) * djk - nk * best) / (ni + nj + nk)
      }
      D[bi][k] = D[k][bi] = v
    }
    const a = label[bi]
    const b = label[bj]
    merges.push({ a: Math.min(a, b), b: Math.max(a, b), height: ward ? Math.sqrt(Math.max(0, best)) : best, size: ni + nj })
    active.delete(bj)
    size[bi] = ni + nj
    label[bi] = n + step
  }
  return merges
}

export interface ClusterNode {
  /** Leaf index (< n) or merge id (≥ n). */
  id: number
  height: number
  size: number
  label?: string
  children?: ClusterNode[]
}

/** Nested tree from a linkage (root = last merge). */
export function linkageTree(merges: readonly Merge[], labels: readonly string[]): ClusterNode {
  const n = labels.length
  if (n === 1 || !merges.length) return { id: 0, height: 0, size: 1, label: labels[0] }
  const nodes = new Map<number, ClusterNode>()
  labels.forEach((l, i) => nodes.set(i, { id: i, height: 0, size: 1, label: l }))
  merges.forEach((m, k) => nodes.set(n + k, { id: n + k, height: m.height, size: m.size, children: [nodes.get(m.a)!, nodes.get(m.b)!] }))
  return nodes.get(n + merges.length - 1)!
}

/** Flat cluster ids (0-based, in leaf order of first appearance) when the tree is cut at height h. */
export function cutTree(merges: readonly Merge[], n: number, h: number): number[] {
  const parent = Array.from({ length: 2 * n - 1 }, (_, i) => i)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  merges.forEach((m, k) => {
    if (m.height <= h) { parent[find(m.a)] = n + k; parent[find(m.b)] = n + k }
  })
  const ids = new Map<number, number>()
  return Array.from({ length: n }, (_, i) => {
    const r = find(i)
    if (!ids.has(r)) ids.set(r, ids.size)
    return ids.get(r)!
  })
}

/** Number of clusters obtained by cutting at height h. */
export const clusterCount = (merges: readonly Merge[], n: number, h: number) => n - merges.filter((m) => m.height <= h).length

/** Column-wise z-scores (columns with zero spread become 0). */
export function standardizeColumns(rows: readonly (readonly number[])[]): number[][] {
  if (!rows.length) return []
  const d = rows[0].length
  const means = Array.from({ length: d }, (_, j) => rows.reduce((s, r) => s + r[j], 0) / rows.length)
  const sds = Array.from({ length: d }, (_, j) => Math.sqrt(rows.reduce((s, r) => s + (r[j] - means[j]) ** 2, 0) / Math.max(1, rows.length - 1)))
  return rows.map((r) => r.map((v, j) => (sds[j] > 0 ? (v - means[j]) / sds[j] : 0)))
}
