import { jacobiEigen } from './pca'

/** Bioinformatics computations. All example data in VizLab are synthetic; nothing here touches real patient or genome records. */

// ─── PCoA (classical multidimensional scaling) ──────────────────────────────────────

export interface Pcoa { coords: number[][]; eigenvalues: number[]; /** Share of the total positive inertia explained by each axis. */ explained: number[]; /** Sum of the negative eigenvalues' magnitudes relative to the positive ones (0 for a Euclidean distance matrix). */ negativeShare: number }

/** Classical PCoA: double-centre −½D², eigen-decompose and scale the leading eigenvectors by √λ. `axes` coordinates are returned. */
export function pcoa(D: readonly (readonly number[])[], axes = 3): Pcoa | null {
  const n = D.length
  if (n < 3 || D.some((r) => r.length !== n)) return null
  const A = D.map((r) => r.map((d) => -0.5 * d * d))
  const rowMean = A.map((r) => r.reduce((a, b) => a + b, 0) / n)
  const total = rowMean.reduce((a, b) => a + b, 0) / n
  const B = A.map((r, i) => r.map((v, j) => v - rowMean[i] - rowMean[j] + total))
  const { values, vectors } = jacobiEigen(B)
  const pos = values.filter((v) => v > 1e-10)
  const sumPos = pos.reduce((a, b) => a + b, 0)
  const sumNeg = values.filter((v) => v < -1e-10).reduce((a, b) => a - b, 0)
  const k = Math.min(axes, pos.length)
  const coords = Array.from({ length: n }, (_, i) => Array.from({ length: k }, (_, a) => vectors[a][i] * Math.sqrt(values[a])))
  return { coords, eigenvalues: values, explained: values.slice(0, k).map((v) => (sumPos > 0 ? v / sumPos : 0)), negativeShare: sumPos > 0 ? sumNeg / sumPos : 0 }
}

// ─── phylogenetic trees ─────────────────────────────────────────────────────────────

export interface PhyloNode { id: number; name?: string; /** Length of the branch to the parent. */ length: number; children: PhyloNode[] }

/** UPGMA: average-linkage agglomeration; every leaf ends at the same distance from the root (a molecular-clock assumption). */
export function upgma(D: readonly (readonly number[])[], names: readonly string[]): PhyloNode {
  const n = names.length
  let id = n
  const nodes: { node: PhyloNode; height: number; size: number }[] = names.map((nm, i) => ({ node: { id: i, name: nm, length: 0, children: [] }, height: 0, size: 1 }))
  let d = D.map((r) => [...r])
  let alive = nodes.map((_, i) => i)
  while (alive.length > 1) {
    let bi = alive[0], bj = alive[1], best = Infinity
    for (const i of alive) for (const j of alive) if (i < j && d[i][j] < best) { best = d[i][j]; bi = i; bj = j }
    const h = best / 2
    const a = nodes[bi], b = nodes[bj]
    a.node.length = h - a.height
    b.node.length = h - b.height
    const merged = { node: { id: id++, length: 0, children: [a.node, b.node] } as PhyloNode, height: h, size: a.size + b.size }
    const idx = nodes.length
    nodes.push(merged)
    d = d.map((r) => [...r, 0])
    d.push(new Array(d[0].length + 1).fill(0))
    for (const k of alive) {
      if (k === bi || k === bj) continue
      const v = (a.size * d[bi][k] + b.size * d[bj][k]) / (a.size + b.size)
      d[idx][k] = d[k][idx] = v
    }
    alive = alive.filter((k) => k !== bi && k !== bj).concat(idx)
  }
  return nodes[alive[0]].node
}

/** Neighbour joining (Saitou & Nei): builds an unrooted tree (returned rooted at the last join) with additive branch lengths; exact for additive distances. */
export function neighborJoining(D: readonly (readonly number[])[], names: readonly string[]): PhyloNode {
  let id = names.length
  const nodes = new Map<number, PhyloNode>(names.map((nm, i) => [i, { id: i, name: nm, length: 0, children: [] }]))
  const dist = new Map<string, number>()
  const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`)
  names.forEach((_, i) => names.forEach((__, j) => { if (i < j) dist.set(key(i, j), D[i][j]) }))
  let active = names.map((_, i) => i)
  const dd = (a: number, b: number) => dist.get(key(a, b))!
  while (active.length > 3) {
    const r = new Map(active.map((i) => [i, active.reduce((s, j) => s + (j === i ? 0 : dd(i, j)), 0)]))
    const n = active.length
    let bi = active[0], bj = active[1], best = Infinity
    for (const i of active) for (const j of active) if (i < j) { const q = (n - 2) * dd(i, j) - r.get(i)! - r.get(j)!; if (q < best) { best = q; bi = i; bj = j } }
    const dij = dd(bi, bj)
    const li = dij / 2 + (r.get(bi)! - r.get(bj)!) / (2 * (n - 2)), lj = dij - li
    const u = id++
    const ni = nodes.get(bi)!, nj = nodes.get(bj)!
    ni.length = li; nj.length = lj
    nodes.set(u, { id: u, length: 0, children: [ni, nj] })
    for (const k of active) if (k !== bi && k !== bj) dist.set(key(u, k), (dd(bi, k) + dd(bj, k) - dij) / 2)
    active = active.filter((k) => k !== bi && k !== bj).concat(u)
  }
  // the last three nodes join at a central node
  const [a, b, c] = active
  const dab = dd(a, b), dac = dd(a, c), dbc = dd(b, c)
  const la = (dab + dac - dbc) / 2, lb = (dab + dbc - dac) / 2, lc = (dac + dbc - dab) / 2
  const na = nodes.get(a)!, nb = nodes.get(b)!, nc = nodes.get(c)!
  na.length = la; nb.length = lb; nc.length = lc
  return { id, length: 0, children: [na, nb, nc] }
}

/** Leaves of a tree in left-to-right order. */
export const leaves = (t: PhyloNode): PhyloNode[] => (t.children.length ? t.children.flatMap(leaves) : [t])

/** Distance between two leaves through the tree (sum of branch lengths along the path). */
export function pathDistance(root: PhyloNode, a: string, b: string): number {
  const find = (t: PhyloNode, name: string, acc: PhyloNode[]): PhyloNode[] | null => {
    const here = [...acc, t]
    if (!t.children.length) return t.name === name ? here : null
    for (const c of t.children) { const r = find(c, name, here); if (r) return r }
    return null
  }
  const pa = find(root, a, []), pb = find(root, b, [])
  if (!pa || !pb) return NaN
  let k = 0
  while (k < pa.length && k < pb.length && pa[k] === pb[k]) k++
  return pa.slice(k).reduce((s, n) => s + n.length, 0) + pb.slice(k).reduce((s, n) => s + n.length, 0)
}

// ─── sequence logo ──────────────────────────────────────────────────────────────────

export interface LogoColumn { counts: Record<string, number>; n: number; /** Information content in bits after the small-sample correction. */ bits: number; freqs: Record<string, number> }

/** Position frequency matrix and information content of aligned sequences. `alphabet` size A gives the maximum log2(A) bits per column. */
export function sequenceLogo(seqs: readonly string[], alphabet: readonly string[], smallSample = true): LogoColumn[] {
  const len = Math.min(...seqs.map((s) => s.length))
  const A = alphabet.length
  const cols: LogoColumn[] = []
  for (let i = 0; i < len; i++) {
    const counts: Record<string, number> = Object.fromEntries(alphabet.map((a) => [a, 0]))
    let n = 0
    for (const s of seqs) { const ch = s[i].toUpperCase(); if (ch in counts) { counts[ch]++; n++ } }
    const freqs = Object.fromEntries(alphabet.map((a) => [a, n ? counts[a] / n : 0]))
    const H = -alphabet.reduce((s, a) => s + (freqs[a] > 0 ? freqs[a] * Math.log2(freqs[a]) : 0), 0)
    // Schneider's small-sample correction e(n) = (A − 1) / (2 ln2 · n)
    const e = smallSample && n > 0 ? (A - 1) / (2 * Math.LN2 * n) : 0
    cols.push({ counts, n, bits: Math.max(0, Math.log2(A) - (H + e)), freqs })
  }
  return cols
}

// ─── coverage ───────────────────────────────────────────────────────────────────────

/** Centred running mean of a depth series with window `w` (odd windows are exact; edges use the available samples). */
export function runningMean(y: readonly number[], w: number): number[] {
  const h = Math.floor(w / 2)
  return y.map((_, i) => { let s = 0, n = 0; for (let k = Math.max(0, i - h); k <= Math.min(y.length - 1, i + h); k++) { s += y[k]; n++ } return s / n })
}

/** Stretches of at least `minLen` consecutive positions whose depth is below `threshold`. Returns [first index, last index]. */
export function lowCoverageRegions(depth: readonly number[], threshold: number, minLen: number): [number, number][] {
  const out: [number, number][] = []
  let start = -1
  depth.forEach((d, i) => {
    if (d < threshold) { if (start < 0) start = i } else if (start >= 0) { if (i - start >= minLen) out.push([start, i - 1]); start = -1 }
  })
  if (start >= 0 && depth.length - start >= minLen) out.push([start, depth.length - 1])
  return out
}

// ─── genome-wide layout (Manhattan plot) ────────────────────────────────────────────

/** Chromosome offsets on one continuous axis: chromosome i starts at the sum of the previous lengths plus a fixed gap. */
export function chromosomeOffsets(lengths: readonly number[], gap: number): number[] {
  const out: number[] = []
  let acc = 0
  for (const l of lengths) { out.push(acc); acc += l + gap }
  return out
}

/** Genomic inflation factor λ = median(χ²₁ statistics) / 0.4549, from p-values (1 = no inflation). */
export function inflationFactor(p: readonly number[]): number {
  const stats = p.filter((v) => v > 0 && v <= 1).map((v) => chiSquare1Quantile(1 - v)).sort((a, b) => a - b)
  if (!stats.length) return NaN
  const mid = Math.floor(stats.length / 2)
  const med = stats.length % 2 ? stats[mid] : (stats[mid - 1] + stats[mid]) / 2
  return med / 0.4549364
}

/** Quantile of the χ² distribution with 1 df: q = z²(1 − (1−p)/2) with z the standard normal quantile. */
function chiSquare1Quantile(p: number): number {
  const z = normalInv(1 - (1 - p) / 2)
  return z * z
}

function normalInv(p: number): number {
  // Acklam's rational approximation (relative error < 1.15e-9)
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239], b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783], d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  if (p <= 0) return -Infinity
  if (p >= 1) return Infinity
  if (p < 0.02425) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1) }
  if (p > 1 - 0.02425) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1) }
  const q = p - 0.5, r = q * q
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}
