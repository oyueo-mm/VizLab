import { createRng } from '../lib/random'
import { jacobiEigen } from './pca'

/** Graph algorithms: Laplacian spectra, layered DAG drawing, maximum flow, rich-club coefficient and Louvain communities. */

export interface Edge { a: number; b: number; w: number }

export function adjacency(n: number, edges: readonly Edge[]): number[][] {
  const A = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (const e of edges) if (e.a !== e.b) { A[e.a][e.b] += e.w; A[e.b][e.a] += e.w }
  return A
}

export type LaplacianKind = 'combinatorial' | 'symmetric' | 'randomwalk'

/** Eigen-decomposition of the graph Laplacian (ascending eigenvalues). The random-walk Laplacian shares the spectrum of the symmetric one; its eigenvectors are D^(−1/2)·v. */
export function laplacianSpectrum(A: readonly (readonly number[])[], kind: LaplacianKind) {
  const n = A.length
  const deg = A.map((r) => r.reduce((s, v) => s + v, 0))
  const L = A.map((r, i) => r.map((v, j) => {
    if (kind === 'combinatorial') return i === j ? deg[i] : -v
    const d = Math.sqrt(deg[i] * deg[j])
    return i === j ? (deg[i] > 0 ? 1 : 0) : d > 0 ? -v / d : 0
  }))
  const e = jacobiEigen(L)
  const order = e.values.map((_, i) => i).sort((p, q) => e.values[p] - e.values[q])
  const values = order.map((i) => e.values[i])
  const vectors = order.map((i) => e.vectors[i].map((v, k) => (kind === 'randomwalk' ? (deg[k] > 0 ? v / Math.sqrt(deg[k]) : 0) : v)))
  return { values, vectors, deg, n }
}

/** Connected components (labels) of an undirected graph. */
export function components(n: number, edges: readonly Edge[]): number[] {
  const comp = new Array<number>(n).fill(-1)
  const adj = Array.from({ length: n }, () => [] as number[])
  for (const e of edges) { adj[e.a].push(e.b); adj[e.b].push(e.a) }
  let c = 0
  for (let i = 0; i < n; i++) { if (comp[i] >= 0) continue; const st = [i]; comp[i] = c; while (st.length) { const u = st.pop()!; for (const v of adj[u]) if (comp[v] < 0) { comp[v] = c; st.push(v) } } c++ }
  return comp
}

// ─── layered drawing of directed graphs ─────────────────────────────────────────────

export interface DagLayout { layer: number[]; order: number[]; reversed: [number, number][]; layers: number[][]; crossings: number; x: number[] }

/** Sugiyama-style layered layout: cycles are broken by reversing back edges found in a DFS, nodes get the longest-path layer, orders within layers are improved by barycentre sweeps, and the number of edge crossings is reported. */
export function dagLayout(n: number, edges: readonly [number, number][], sweeps = 8, fixedLayer?: readonly number[]): DagLayout {
  const out = Array.from({ length: n }, () => [] as number[])
  for (const [u, v] of edges) if (u !== v) out[u].push(v)
  const state = new Array<number>(n).fill(0)
  const reversed: [number, number][] = []
  const dag: [number, number][] = []
  const dfs = (u: number) => {
    state[u] = 1
    for (const v of out[u]) {
      if (state[v] === 1) reversed.push([u, v])
      else { dag.push([u, v]); if (state[v] === 0) dfs(v) }
    }
    state[u] = 2
  }
  for (let i = 0; i < n; i++) if (state[i] === 0) dfs(i)
  // with a given layering (e.g. hop distance from a source) edges are oriented by layer and edges inside one layer are ignored for ordering
  const all: [number, number][] = fixedLayer
    ? edges.filter(([u, v]) => fixedLayer[u] !== fixedLayer[v]).map(([u, v]) => (fixedLayer[u] < fixedLayer[v] ? [u, v] : [v, u]) as [number, number])
    : [...dag, ...reversed.map(([u, v]) => [v, u] as [number, number])]
  // longest-path layering
  const layer = new Array<number>(n).fill(0)
  const preds = Array.from({ length: n }, () => [] as number[]), succ = Array.from({ length: n }, () => [] as number[])
  const indeg = new Array<number>(n).fill(0)
  for (const [u, v] of all) { preds[v].push(u); succ[u].push(v); indeg[v]++ }
  const queue = Array.from({ length: n }, (_, i) => i).filter((i) => indeg[i] === 0)
  if (fixedLayer) fixedLayer.forEach((l, i) => { layer[i] = l })
  else while (queue.length) { const u = queue.shift()!; for (const v of succ[u]) { layer[v] = Math.max(layer[v], layer[u] + 1); if (--indeg[v] === 0) queue.push(v) } }
  const depth = Math.max(0, ...layer)
  const layers: number[][] = Array.from({ length: depth + 1 }, () => [])
  for (let i = 0; i < n; i++) layers[layer[i]].push(i)
  const pos = new Array<number>(n).fill(0)
  const setPos = () => layers.forEach((l) => l.forEach((v, i) => { pos[v] = i }))
  setPos()
  // edges spanning several layers are routed through virtual nodes only for the crossing count (pairs between consecutive layers)
  const crossingsOf = () => {
    let c = 0
    for (let l = 0; l < depth; l++) {
      const es = all.filter(([u, v]) => layer[u] <= l && layer[v] > l)
      const key = (u: number, v: number) => [layer[u] === l ? pos[u] : pos[u] + (layer[u] < l ? 0 : 0), layer[v] === l + 1 ? pos[v] : pos[v]] as const
      for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) { const a = key(...es[i]), b = key(...es[j]); if ((a[0] - b[0]) * (a[1] - b[1]) < 0) c++ }
    }
    return c
  }
  let best = crossingsOf(), bestOrder = layers.map((l) => [...l])
  for (let s = 0; s < sweeps; s++) {
    const down = s % 2 === 0
    const range = down ? Array.from({ length: depth }, (_, i) => i + 1) : Array.from({ length: depth }, (_, i) => depth - 1 - i)
    for (const l of range) {
      const nb = down ? preds : succ
      const bc = (v: number) => { const ns = nb[v]; return ns.length ? ns.reduce((a, u) => a + pos[u], 0) / ns.length : pos[v] }
      layers[l].sort((p, q) => bc(p) - bc(q) || p - q)
      layers[l].forEach((v, i) => { pos[v] = i })
    }
    const c = crossingsOf()
    if (c < best) { best = c; bestOrder = layers.map((l) => [...l]) }
  }
  bestOrder.forEach((l, li) => { layers[li] = l; l.forEach((v, i) => { pos[v] = i }) })
  const x = pos.map((p, v) => p - (layers[layer[v]].length - 1) / 2)
  return { layer, order: pos, reversed: fixedLayer ? [] : reversed, layers, crossings: best, x }
}

// ─── maximum flow (Edmonds–Karp) ────────────────────────────────────────────────────

export interface FlowEdge { from: number; to: number; cap: number }
export interface FlowStep { path: number[]; bottleneck: number; flowAfter: number }

/** Edmonds–Karp: repeatedly augment along a shortest residual path. Returns the augmenting paths, the final edge flows, the max-flow value and the minimum cut (source side of the cut). */
export function maxFlow(n: number, edges: readonly FlowEdge[], s: number, t: number) {
  type R = { to: number; cap: number; rev: number; edge: number; fwd: boolean }
  const g: R[][] = Array.from({ length: n }, () => [])
  edges.forEach((e, i) => { g[e.from].push({ to: e.to, cap: e.cap, rev: g[e.to].length, edge: i, fwd: true }); g[e.to].push({ to: e.from, cap: 0, rev: g[e.from].length - 1, edge: i, fwd: false }) })
  const steps: FlowStep[] = []
  let flow = 0
  for (;;) {
    const prev = new Array<[number, number] | null>(n).fill(null)
    const seen = new Array<boolean>(n).fill(false)
    seen[s] = true
    const q = [s]
    while (q.length && !seen[t]) { const u = q.shift()!; g[u].forEach((r, k) => { if (r.cap > 1e-12 && !seen[r.to]) { seen[r.to] = true; prev[r.to] = [u, k]; q.push(r.to) } }) }
    if (!seen[t]) break
    let b = Infinity
    for (let v = t; v !== s;) { const [u, k] = prev[v]!; b = Math.min(b, g[u][k].cap); v = u }
    const path = [t]
    for (let v = t; v !== s;) { const [u, k] = prev[v]!; g[u][k].cap -= b; g[v][g[u][k].rev].cap += b; v = u; path.push(v) }
    flow += b
    steps.push({ path: path.reverse(), bottleneck: b, flowAfter: flow })
  }
  const flows = edges.map((e, i) => { const r = g[e.from].find((x) => x.edge === i && x.fwd)!; return e.cap - r.cap })
  const seen = new Array<boolean>(n).fill(false)
  seen[s] = true
  const q = [s]
  while (q.length) { const u = q.shift()!; for (const r of g[u]) if (r.cap > 1e-12 && !seen[r.to]) { seen[r.to] = true; q.push(r.to) } }
  return { value: flow, steps, flows, cutSide: seen, cutEdges: edges.map((_, i) => i).filter((i) => seen[edges[i].from] && !seen[edges[i].to]) }
}

/** Flow on every edge after the first `k` augmentations (for step-by-step replays). */
export function flowAfterSteps(n: number, edges: readonly FlowEdge[], s: number, t: number, k: number) {
  const full = maxFlow(n, edges, s, t)
  const flows = new Array<number>(edges.length).fill(0)
  // replay: re-run the augmentations on a fresh residual graph, stopping after k paths
  const resid = edges.map((e) => ({ ...e, flow: 0 }))
  for (const st of full.steps.slice(0, k)) {
    for (let i = 0; i + 1 < st.path.length; i++) {
      const u = st.path[i], v = st.path[i + 1]
      const fe = resid.find((e) => e.from === u && e.to === v && e.cap - e.flow >= st.bottleneck - 1e-9)
      if (fe) fe.flow += st.bottleneck
      else { const be = resid.find((e) => e.from === v && e.to === u && e.flow >= st.bottleneck - 1e-9); if (be) be.flow -= st.bottleneck }
    }
  }
  resid.forEach((e, i) => { flows[i] = e.flow })
  return { flows, value: full.steps.slice(0, k).reduce((a, s) => a + s.bottleneck, 0) }
}

// ─── rich club ──────────────────────────────────────────────────────────────────────

export function degrees(n: number, edges: readonly Edge[]) { const d = new Array<number>(n).fill(0); for (const e of edges) if (e.a !== e.b) { d[e.a]++; d[e.b]++ } return d }

/** φ(k) = 2 E_{>k} / (N_{>k}(N_{>k} − 1)): the density among nodes whose degree exceeds k. Returns NaN when fewer than two nodes remain. */
export function richClub(n: number, edges: readonly Edge[]): { k: number; phi: number; nodes: number; edges: number }[] {
  const d = degrees(n, edges)
  const out: { k: number; phi: number; nodes: number; edges: number }[] = []
  for (let k = 0; k <= Math.max(...d); k++) {
    const inside = new Set(d.map((v, i) => [v, i] as const).filter(([v]) => v > k).map(([, i]) => i))
    const m = edges.filter((e) => e.a !== e.b && inside.has(e.a) && inside.has(e.b)).length
    out.push({ k, nodes: inside.size, edges: m, phi: inside.size >= 2 ? (2 * m) / (inside.size * (inside.size - 1)) : NaN })
  }
  return out
}

/** Degree-preserving randomisation by double edge swaps (Maslov & Sneppen). */
export function rewire(n: number, edges: readonly Edge[], swaps: number, seed: number): Edge[] {
  const rng = createRng(seed)
  const E = edges.filter((e) => e.a !== e.b).map((e) => ({ ...e }))
  const key = (a: number, b: number) => (a < b ? a * n + b : b * n + a)
  const have = new Set(E.map((e) => key(e.a, e.b)))
  for (let s = 0; s < swaps; s++) {
    const i = Math.floor(rng() * E.length), j = Math.floor(rng() * E.length)
    if (i === j) continue
    const [a, b] = [E[i].a, E[i].b], [c, d] = rng() < 0.5 ? [E[j].a, E[j].b] : [E[j].b, E[j].a]
    if (a === d || c === b || have.has(key(a, d)) || have.has(key(c, b))) continue
    have.delete(key(a, b)); have.delete(key(c, d)); have.add(key(a, d)); have.add(key(c, b))
    E[i] = { a, b: d, w: E[i].w }; E[j] = { a: c, b, w: E[j].w }
  }
  return E
}

/** Normalised rich-club coefficient φ(k)/φ_rand(k) with the random baseline averaged over `samples` degree-preserving rewirings. */
export function richClubNormalised(n: number, edges: readonly Edge[], samples: number, seed: number) {
  const obs = richClub(n, edges)
  const acc = obs.map(() => ({ s: 0, c: 0 }))
  for (let r = 0; r < samples; r++) richClub(n, rewire(n, edges, edges.length * 10, seed + r)).forEach((p, i) => { if (Number.isFinite(p.phi) && i < acc.length) { acc[i].s += p.phi; acc[i].c++ } })
  return obs.map((p, i) => { const rnd = acc[i].c ? acc[i].s / acc[i].c : NaN; return { ...p, random: rnd, ratio: rnd > 0 ? p.phi / rnd : NaN } })
}

// ─── communities ────────────────────────────────────────────────────────────────────

export const modularity = (A: readonly (readonly number[])[], comm: readonly number[]) => {
  const n = A.length
  const deg = A.map((r) => r.reduce((s, v) => s + v, 0)), m2 = deg.reduce((s, v) => s + v, 0)
  if (m2 === 0) return 0
  let q = 0
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (comm[i] === comm[j]) q += A[i][j] - (deg[i] * deg[j]) / m2
  return q / m2
}

/** Louvain method: greedy local moves that maximise modularity gain, then aggregation of communities into super-nodes, repeated until no gain. */
export function louvain(A0: readonly (readonly number[])[], seed = 1): number[] {
  const n0 = A0.length
  let membership = Array.from({ length: n0 }, (_, i) => i)
  let A = A0.map((r) => [...r])
  const rng = createRng(seed)
  for (let level = 0; level < 10; level++) {
    const n = A.length
    const deg = A.map((r) => r.reduce((s, v) => s + v, 0)), m2 = deg.reduce((s, v) => s + v, 0)
    if (m2 === 0) break
    const comm = Array.from({ length: n }, (_, i) => i)
    const tot = [...deg]
    let moved = true, rounds = 0
    while (moved && rounds++ < 50) {
      moved = false
      const order = Array.from({ length: n }, (_, i) => i)
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
      for (const i of order) {
        const links = new Map<number, number>()
        for (let j = 0; j < n; j++) if (j !== i && A[i][j] > 0) links.set(comm[j], (links.get(comm[j]) ?? 0) + A[i][j])
        const old = comm[i]
        tot[old] -= deg[i]
        let bestC = old, bestGain = (links.get(old) ?? 0) - (tot[old] * deg[i]) / m2
        for (const [c, k] of links) { const gain = k - (tot[c] * deg[i]) / m2; if (gain > bestGain + 1e-12) { bestGain = gain; bestC = c } }
        tot[bestC] += deg[i]
        if (bestC !== old) { comm[i] = bestC; moved = true }
      }
    }
    const ids = [...new Set(comm)]
    if (ids.length === n) break
    const index = new Map(ids.map((c, k) => [c, k]))
    membership = membership.map((c) => index.get(comm[c])!)
    const B = Array.from({ length: ids.length }, () => new Array<number>(ids.length).fill(0))
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) B[index.get(comm[i])!][index.get(comm[j])!] += A[i][j]
    A = B
  }
  const ids = [...new Set(membership)]
  return membership.map((c) => ids.indexOf(c))
}

/** Edge density within and between communities: block[i][j] = observed edge weight / possible pairs. */
export function blockDensity(A: readonly (readonly number[])[], comm: readonly number[]) {
  const k = Math.max(-1, ...comm) + 1
  const size = new Array<number>(k).fill(0)
  comm.forEach((c) => size[c]++)
  const w = Array.from({ length: k }, () => new Array<number>(k).fill(0))
  for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) { w[comm[i]][comm[j]] += A[i][j]; if (comm[i] !== comm[j]) w[comm[j]][comm[i]] += A[i][j] }
  return { size, weight: w, density: w.map((r, a) => r.map((v, b) => { const pairs = a === b ? (size[a] * (size[a] - 1)) / 2 : size[a] * size[b]; return pairs > 0 ? v / pairs : 0 })) }
}

// ─── critical path method ───────────────────────────────────────────────────────────

/** CPM on a DAG with edge durations (the duration of the task an edge leaves): earliest start, latest start, slack and the project length. Edges must already point forward (no cycles). */
export function criticalPath(n: number, edges: readonly [number, number, number][]) {
  const succ = Array.from({ length: n }, () => [] as [number, number][]), indeg = new Array<number>(n).fill(0)
  for (const [u, v, w] of edges) { succ[u].push([v, w]); indeg[v]++ }
  const order: number[] = []
  const q = Array.from({ length: n }, (_, i) => i).filter((i) => indeg[i] === 0)
  const deg = [...indeg]
  while (q.length) { const u = q.shift()!; order.push(u); for (const [v] of succ[u]) if (--deg[v] === 0) q.push(v) }
  if (order.length < n) return null
  const es = new Array<number>(n).fill(0)
  for (const u of order) for (const [v, w] of succ[u]) es[v] = Math.max(es[v], es[u] + w)
  const length = Math.max(0, ...es)
  const ls = new Array<number>(n).fill(length)
  for (const u of [...order].reverse()) for (const [v, w] of succ[u]) ls[u] = Math.min(ls[u], ls[v] - w)
  const slack = es.map((e, i) => ls[i] - e)
  return { es, ls, slack, length, order }
}

// ─── comparing partitions ───────────────────────────────────────────────────────────

/** Adjusted Rand index between two labelings (1 = identical partitions, ≈0 = chance agreement). */
export function adjustedRand(a: readonly (string | number)[], b: readonly (string | number)[]): number {
  const n = a.length
  if (n < 2) return 1
  const cell = new Map<string, number>(), ra = new Map<string | number, number>(), rb = new Map<string | number, number>()
  for (let i = 0; i < n; i++) { const k = `${a[i]}\u0001${b[i]}`; cell.set(k, (cell.get(k) ?? 0) + 1); ra.set(a[i], (ra.get(a[i]) ?? 0) + 1); rb.set(b[i], (rb.get(b[i]) ?? 0) + 1) }
  const c2 = (x: number) => (x * (x - 1)) / 2
  const sij = [...cell.values()].reduce((s, v) => s + c2(v), 0), sa = [...ra.values()].reduce((s, v) => s + c2(v), 0), sb = [...rb.values()].reduce((s, v) => s + c2(v), 0)
  const exp = (sa * sb) / c2(n), max = (sa + sb) / 2
  return max === exp ? 1 : (sij - exp) / (max - exp)
}
