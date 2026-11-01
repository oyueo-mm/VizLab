import { describe, expect, it } from 'vitest'
import { adjacency, adjustedRand, blockDensity, criticalPath, components, dagLayout, degrees, flowAfterSteps, laplacianSpectrum, louvain, maxFlow, modularity, rewire, richClub, richClubNormalised, type Edge } from './graph2'

const path = (n: number): Edge[] => Array.from({ length: n - 1 }, (_, i) => ({ a: i, b: i + 1, w: 1 }))
const complete = (n: number): Edge[] => { const e: Edge[] = []; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) e.push({ a: i, b: j, w: 1 }); return e }

describe('Laplacian spectrum', () => {
  it('a path graph has eigenvalues 2 − 2cos(kπ/n) and a monotone Fiedler vector', () => {
    const n = 8
    const s = laplacianSpectrum(adjacency(n, path(n)), 'combinatorial')
    s.values.forEach((v, k) => expect(v).toBeCloseTo(2 - 2 * Math.cos((k * Math.PI) / n), 8))
    const f = s.vectors[1]
    const sign = Math.sign(f[n - 1] - f[0])
    for (let i = 1; i < n; i++) expect(Math.sign(f[i] - f[i - 1])).toBe(sign)
  })
  it('the number of zero eigenvalues equals the number of connected components and the normalised spectrum lies in [0, 2]', () => {
    const e: Edge[] = [...complete(4), ...complete(3).map((x) => ({ ...x, a: x.a + 4, b: x.b + 4 }))]
    const s = laplacianSpectrum(adjacency(7, e), 'symmetric')
    expect(s.values.filter((v) => Math.abs(v) < 1e-8).length).toBe(2)
    expect(components(7, e).filter((c, i, a) => a.indexOf(c) === i).length).toBe(2)
    for (const v of s.values) { expect(v).toBeGreaterThan(-1e-9); expect(v).toBeLessThan(2 + 1e-9) }
    expect(laplacianSpectrum(adjacency(5, complete(5)), 'combinatorial').values[1]).toBeCloseTo(5, 9)
  })
})

describe('layered DAG layout', () => {
  it('every edge points to a deeper layer, cycles are detected and crossings are not worse after sweeping', () => {
    const edges: [number, number][] = [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [1, 4], [2, 5], [5, 4]]
    const L = dagLayout(6, edges)
    for (const [u, v] of edges) expect(L.layer[v]).toBeGreaterThan(L.layer[u])
    expect(L.reversed.length).toBe(0)
    expect(L.layers.flat().sort()).toEqual([0, 1, 2, 3, 4, 5])
    const cyc = dagLayout(3, [[0, 1], [1, 2], [2, 0]])
    expect(cyc.reversed.length).toBe(1)
    const crossed = dagLayout(4, [[0, 2], [1, 3]], 0)
    const solved = dagLayout(4, [[0, 3], [1, 2], [0, 2]], 8)
    expect(solved.crossings).toBeLessThanOrEqual(dagLayout(4, [[0, 3], [1, 2], [0, 2]], 0).crossings)
    expect(crossed.crossings).toBe(0)
  })
})

describe('maximum flow', () => {
  // CLRS figure 26.6: max flow 23
  const edges = [[0, 1, 16], [0, 2, 13], [1, 2, 10], [2, 1, 4], [1, 3, 12], [3, 2, 9], [2, 4, 14], [4, 3, 7], [3, 5, 20], [4, 5, 4]].map(([from, to, cap]) => ({ from, to, cap }))
  it('finds the textbook value 23 and the min cut has the same capacity (max-flow min-cut)', () => {
    const r = maxFlow(6, edges, 0, 5)
    expect(r.value).toBe(23)
    expect(r.cutEdges.reduce((s, i) => s + edges[i].cap, 0)).toBe(23)
    expect(r.cutSide[0]).toBe(true); expect(r.cutSide[5]).toBe(false)
  })
  it('flows respect capacities and conservation, and replaying k augmentations reaches the full value at the end', () => {
    const r = maxFlow(6, edges, 0, 5)
    r.flows.forEach((f, i) => { expect(f).toBeGreaterThanOrEqual(-1e-9); expect(f).toBeLessThanOrEqual(edges[i].cap + 1e-9) })
    for (const v of [1, 2, 3, 4]) { const inn = edges.reduce((s, e, i) => s + (e.to === v ? r.flows[i] : 0), 0), out = edges.reduce((s, e, i) => s + (e.from === v ? r.flows[i] : 0), 0); expect(inn).toBeCloseTo(out, 9) }
    const total = flowAfterSteps(6, edges, 0, 5, r.steps.length)
    expect(total.value).toBe(23)
    expect(flowAfterSteps(6, edges, 0, 5, 1).value).toBeLessThan(23)
    for (const st of r.steps) expect(st.path[0]).toBe(0)
  })
})

describe('rich club and rewiring', () => {
  it('a complete graph has φ = 1 at every k below its degree and rewiring preserves every degree', () => {
    const rc = richClub(6, complete(6))
    expect(rc[0].phi).toBeCloseTo(1, 12)
    expect(rc[4].phi).toBeCloseTo(1, 12)
    expect(Number.isNaN(rc[5].phi)).toBe(true)
    const e: Edge[] = [...complete(5), ...path(10).map((x) => ({ ...x, a: x.a + 5, b: x.b + 5 })), { a: 4, b: 5, w: 1 }]
    const r = rewire(15, e, 300, 3)
    expect(degrees(15, r)).toEqual(degrees(15, e))
    expect(new Set(r.map((x) => `${Math.min(x.a, x.b)}-${Math.max(x.a, x.b)}`)).size).toBe(r.length)
  })
  it('a hub-clique attached to sparse periphery has a normalised rich-club coefficient above 1', () => {
    const e: Edge[] = [...complete(6)]
    for (let i = 6; i < 40; i++) e.push({ a: i, b: i % 6, w: 1 }, { a: i, b: 6 + ((i - 5) % 34), w: 1 })
    const norm = richClubNormalised(40, e, 8, 4)
    const mid = norm.filter((p) => p.k >= 4 && Number.isFinite(p.ratio))
    expect(mid.length).toBeGreaterThan(0)
    expect(Math.max(...mid.map((p) => p.ratio))).toBeGreaterThan(1.1)
  })
})

describe('Louvain communities', () => {
  it('splits two cliques joined by one edge into two communities with the hand-computed modularity', () => {
    const e: Edge[] = [...complete(5), ...complete(5).map((x) => ({ ...x, a: x.a + 5, b: x.b + 5 })), { a: 0, b: 5, w: 1 }]
    const A = adjacency(10, e)
    const c = louvain(A, 2)
    expect(new Set(c).size).toBe(2)
    expect(new Set(c.slice(0, 5)).size).toBe(1)
    expect(c[0]).not.toBe(c[5])
    // m = 21 edges; each clique has 10 internal edges and total degree 21 → Q = 2·(10/21 − (21/42)²)
    expect(modularity(A, c)).toBeCloseTo(2 * (10 / 21 - 0.25), 12)
    expect(modularity(A, new Array(10).fill(0))).toBeCloseTo(0, 12)
    const b = blockDensity(A, c)
    expect(b.size).toEqual([5, 5])
    expect(b.density[c[0]][c[0]]).toBe(1)
    expect(b.density[c[0]][c[5]]).toBeCloseTo(1 / 25, 12)
  })
})

describe('critical path method and partition agreement', () => {
  it('computes earliest/latest starts, slack and project length on a small network', () => {
    // A→B (3), A→C (2), B→D (4), C→D (6): the longest chain is A–C–D (8); B has 2 days of slack
    const r = criticalPath(4, [[0, 1, 3], [0, 2, 2], [1, 3, 4], [2, 3, 6]])!
    expect(r.length).toBe(8)
    expect(r.es).toEqual([0, 3, 2, 8])
    expect(r.slack).toEqual([0, 1, 0, 0])
    expect(criticalPath(2, [[0, 1, 1], [1, 0, 1]])).toBeNull()
  })
  it('adjusted Rand index is 1 for relabelled identical partitions and near 0 for unrelated ones', () => {
    expect(adjustedRand([0, 0, 1, 1, 2, 2], ['x', 'x', 'y', 'y', 'z', 'z'])).toBeCloseTo(1, 12)
    expect(adjustedRand([0, 0, 0, 1, 1, 1], [0, 1, 0, 1, 0, 1])).toBeLessThan(0.1)
    // hand value: a = {0,0,1,1}, b = {0,0,0,1}: sij=1, sa=2, sb=3, exp=3·... = (2·3)/6 = 1, max = 2.5 → (1−1)/(2.5−1) = 0
    expect(adjustedRand([0, 0, 1, 1], [0, 0, 0, 1])).toBeCloseTo(0, 12)
  })
})

describe('layered layout with a given layering', () => {
  it('keeps the supplied layers (even with cycles) and reports no reversed edges', () => {
    const L = dagLayout(4, [[0, 1], [1, 2], [2, 1], [2, 3], [0, 2]], 6, [0, 1, 1, 2])
    expect(L.layer).toEqual([0, 1, 1, 2])
    expect(L.reversed).toEqual([])
    expect(L.layers.map((l) => l.length)).toEqual([1, 2, 1])
  })
})
