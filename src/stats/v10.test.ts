import { describe, expect, it } from 'vitest'
import { createRng } from '../lib/random'
import { excentricLabels, lineUp, splatter, unitLayout, zameBlocks, zameBuild, zameRefine, type UnitRecord } from './info10'
import { crossingProbability, contourTree, landscapeHeights, landscapeHills, mergeTree, neighbours, persistence, simplifyContourTree, type Grid2 } from './topo10'
import { functionalBoxplot, lorenz, modifiedBandDepth, poissonPmf, rootogram, stemLeaf, sunflower, tornado } from './stat10'

/** Sum of Gaussian hills on a grid (the bumps are well separated so that the topology is known). */
const hills = (nx: number, ny: number, bumps: [number, number, number, number][]): Grid2 => {
  const v = new Float64Array(nx * ny)
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = bumps.reduce((a, [cx, cy, h, s]) => a + h * Math.exp(-((i - cx) ** 2 + (j - cy) ** 2) / (2 * s * s)), 0)
  return { nx, ny, v }
}
const localExtrema = (g: Grid2) => {
  let mx = 0, mn = 0
  for (let k = 0; k < g.nx * g.ny; k++) {
    const nb = neighbours(g, k)
    const gt = (a: number, b: number) => g.v[a] > g.v[b] || (g.v[a] === g.v[b] && a > b)
    if (nb.every((u) => gt(k, u))) mx++
    if (nb.every((u) => gt(u, k))) mn++
  }
  return { mx, mn }
}

describe('ZAME aggregated matrix', () => {
  const r = createRng(4)
  const n = 60
  const edges: [number, number][] = []
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (r() < (Math.floor(i / 20) === Math.floor(j / 20) ? 0.35 : 0.02)) edges.push([i, j])
  const m = zameBuild(n, edges)
  it('the leaf order is a permutation and every cluster is a contiguous range', () => {
    expect([...m.order].sort((a, b) => a - b)).toEqual([...Array(n).keys()])
    m.nodes.forEach((nd) => { if (nd.children.length) { expect(nd.children.reduce((a, c) => a + m.nodes[c].hi - m.nodes[c].lo, 0)).toBe(nd.hi - nd.lo); expect(m.nodes[nd.children[0]].lo).toBe(nd.lo) } })
  })
  it('aggregation conserves the edges at every resolution and the full expansion is the adjacency matrix', () => {
    let f = [...m.nodes[m.root].children]
    for (const cells of [3, 8, 20, 60]) {
      f = zameRefine(m, f, cells)
      const blocks = zameBlocks(m, f)
      expect(blocks.reduce((a, b) => a + b.sum, 0)).toBe(edges.length)
    }
    expect(f.length).toBe(n)
    const full = zameBlocks(m, f)
    expect(full.filter((b) => b.sum > 0 && b.a !== b.b).length).toBe(edges.length)
    expect(Math.max(...full.map((b) => b.density))).toBe(1)
  })
  it('dense communities show up as dense blocks on the diagonal', () => {
    const f = zameRefine(m, [...m.nodes[m.root].children], 3)
    const blocks = zameBlocks(m, f)
    const diag = blocks.filter((b) => b.a === b.b).reduce((a, b) => a + b.density, 0) / f.length
    const off = blocks.filter((b) => b.a !== b.b).reduce((a, b) => a + b.density, 0) / Math.max(1, blocks.filter((b) => b.a !== b.b).length)
    expect(diag).toBeGreaterThan(off * 3)
  })
})

describe('Excentric labeling', () => {
  const r = createRng(2)
  const items = Array.from({ length: 80 }, (_, i) => ({ index: i, x: r() * 400, y: r() * 300, text: `점 ${i}` }))
  const opts = { maxLabels: 10, labelH: 14, labelW: (t: string) => t.length * 7, gap: 14, bounds: [400, 300] as [number, number] }
  const res = excentricLabels(items, [200, 150], 70, opts)
  it('labels only the objects inside the circle, at most maxLabels of them, nearest first', () => {
    expect(res.placed.length).toBeLessThanOrEqual(10)
    expect(res.inside.every((p) => Math.hypot(p.x - 200, p.y - 150) <= 70)).toBe(true)
    expect(res.placed.length + res.hidden).toBe(res.inside.length)
  })
  it('label boxes do not overlap and lie beside the circle', () => {
    for (let i = 0; i < res.placed.length; i++) for (let j = i + 1; j < res.placed.length; j++) {
      const a = res.placed[i].box, b = res.placed[j].box
      expect(a[0] + a[2] <= b[0] + 1e-9 || b[0] + b[2] <= a[0] + 1e-9 || a[1] + a[3] <= b[1] + 1e-9 || b[1] + b[3] <= a[1] + 1e-9).toBe(true)
    }
    for (const p of res.placed) { if (p.side === 'right') expect(p.box[0]).toBeGreaterThanOrEqual(200 + 70); else expect(p.box[0] + p.box[2]).toBeLessThanOrEqual(200 - 70) }
  })
  it('each column is ordered by the objects\' heights so that leader lines keep their order', () => {
    for (const side of ['left', 'right'] as const) { const col = res.placed.filter((p) => p.side === side); for (let i = 1; i < col.length; i++) { expect(col[i].box[1]).toBeGreaterThan(col[i - 1].box[1]); expect(col[i].y).toBeGreaterThanOrEqual(col[i - 1].y) } }
  })
  it('no objects near the cursor gives no labels', () => { expect(excentricLabels(items, [-500, -500], 30, opts).placed.length).toBe(0) })
})

describe('LineUp', () => {
  const values = [[90, 10, 5], [60, 80, 4], [30, 50, 1], [75, 20, 3]]
  it('the score is the weighted mean of scaled columns and the parts add up to it', () => {
    const rows = lineUp(values, [{ name: 'a', weight: 2, invert: false }, { name: 'b', weight: 1, invert: false }, { name: 'c', weight: 1, invert: true }])
    for (const r of rows) expect(r.parts.reduce((a, b) => a + b, 0)).toBeCloseTo(r.score, 12)
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4])
    expect(rows.every((r, i) => i === 0 || rows[i - 1].score >= r.score)).toBe(true)
  })
  it('changing a weight changes the ranking; a zero weight removes the column', () => {
    const cols = [{ name: 'a', weight: 1, invert: false }, { name: 'b', weight: 0, invert: false }]
    expect(lineUp(values, cols)[0].index).toBe(0)
    expect(lineUp(values, [{ name: 'a', weight: 0, invert: false }, { name: 'b', weight: 1, invert: false }])[0].index).toBe(1)
    expect(lineUp(values, cols, 1)[0].index).toBe(1) // sorted by column b
  })
})

describe('Unit visualization', () => {
  const recs: UnitRecord[] = Array.from({ length: 90 }, (_, i) => ({ id: i, cats: [['가', '나', '다'][i % 3], ['A', 'B'][i % 2]], value: (i * 37) % 100 }))
  for (const leaf of ['grid', 'dodge', 'pack', 'jitter'] as const) {
    it(`${leaf}: one mark per record, every mark inside its cell`, () => {
      const l = unitLayout(recs, 2, leaf, 600, 400)
      expect(new Set(l.marks.map((m) => m.id)).size).toBe(90)
      for (const m of l.marks) { const c = l.cells[m.cell]; expect(m.x - m.r).toBeGreaterThanOrEqual(c.x - 1e-6); expect(m.x + m.r).toBeLessThanOrEqual(c.x + c.w + 1e-6); expect(m.y - m.r).toBeGreaterThanOrEqual(c.y - 1e-6); expect(m.y + m.r).toBeLessThanOrEqual(c.y + c.h + 1e-6) }
    })
  }
  it('grid and pack units do not overlap; cell sizes follow the record counts', () => {
    for (const leaf of ['grid', 'pack'] as const) {
      const l = unitLayout(recs, 2, leaf, 600, 400)
      for (let i = 0; i < l.marks.length; i++) for (let j = i + 1; j < l.marks.length; j++) { const a = l.marks[i], b = l.marks[j]; expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r - 1e-6) }
    }
    const l = unitLayout(recs, 1, 'grid', 600, 400)
    expect(l.cells.length).toBe(3); expect(l.cells.reduce((a, c) => a + c.count, 0)).toBe(90)
    const uneven = unitLayout([...recs, ...recs.filter((r) => r.cats[0] === '가').map((r) => ({ ...r, id: r.id + 1000 }))], 1, 'grid', 600, 400)
    expect(uneven.cells.find((c) => c.key === '/가')!.w).toBeGreaterThan(uneven.cells.find((c) => c.key === '/나')!.w)
  })
})

describe('Splatterplot', () => {
  const r = createRng(9)
  const pts: [number, number][] = Array.from({ length: 400 }, () => [r.normal(0, 1), r.normal(0, 1)] as [number, number])
  pts.push([6, 6], [-6, 5])
  const s = splatter(pts, [-8, 8], [-8, 8], { grid: 80, bandwidth: 0.05, coverage: 0.9 })
  it('the contour holds about the requested share of the points and the far outliers stay outside', () => {
    const share = s.inside.filter(Boolean).length / pts.length
    expect(share).toBeGreaterThan(0.85); expect(share).toBeLessThan(0.97)
    expect(s.inside[400]).toBe(false); expect(s.inside[401]).toBe(false)
    expect(s.rings.length).toBeGreaterThan(0)
  })
})

describe('Topology: persistence and contour tree', () => {
  const g = hills(41, 41, [[10, 10, 1, 4], [30, 28, 0.6, 4], [32, 8, 0.35, 3]])
  const ex = localExtrema(g)
  it('persistence pairs: one per maximum and minimum, the essential component lives longest', () => {
    const p = persistence(g)
    expect(p.filter((x) => x.kind === 'max').length).toBe(ex.mx)
    expect(p.filter((x) => x.kind === 'min').length).toBe(ex.mn)
    const maxes = p.filter((x) => x.kind === 'max').sort((a, b) => b.birth - b.death - (a.birth - a.death))
    expect(maxes[0].saddle).toBe(-1)
    expect(maxes[0].birth).toBeCloseTo(1, 1)
    // the second hill dies at a saddle lower than its peak and higher than the valley floor
    const second = maxes.find((x) => Math.abs(x.birth - 0.6) < 0.05)!
    expect(second.death).toBeLessThan(second.birth); expect(second.death).toBeGreaterThan(g.v[sortedMin(g)])
    expect(p.every((x) => (x.kind === 'max' ? x.birth >= x.death : x.birth <= x.death))).toBe(true)
  })
  it('contour tree: n−1 arcs in the augmented tree become a tree on the critical vertices with the right leaves', () => {
    const t = contourTree(g)
    expect(t.arcs.length).toBe(t.nodes.length - 1)
    expect(t.nodes.filter((x) => x.type === 'max').length).toBe(ex.mx)
    expect(t.nodes.filter((x) => x.type === 'min').length).toBe(ex.mn)
    // the tree is connected: every node reachable from the first one
    const adj = new Map<number, number[]>()
    for (const a of t.arcs) { adj.set(a.a, [...(adj.get(a.a) ?? []), a.b]); adj.set(a.b, [...(adj.get(a.b) ?? []), a.a]) }
    const seen = new Set([t.nodes[0].v]); const st = [t.nodes[0].v]
    while (st.length) for (const u of adj.get(st.pop()!) ?? []) if (!seen.has(u)) { seen.add(u); st.push(u) }
    expect(seen.size).toBe(t.nodes.length)
  })
  it('simplification removes the low-persistence leaves and keeps the tall hills', () => {
    const t = contourTree(g)
    const s = simplifyContourTree(t, g, 0.5)
    expect(s.nodes.length).toBeLessThan(t.nodes.length)
    expect(s.arcs.length).toBe(s.nodes.length - 1)
    expect(s.nodes.some((x) => x.type === 'max' && Math.abs(g.v[x.v] - 1) < 0.05)).toBe(true)
  })
  it('the join tree has one root and every other vertex has a parent below it', () => {
    const j = mergeTree(g, 'join')
    expect([...j.parent].filter((p) => p < 0).length).toBe(1)
    for (let v = 0; v < j.parent.length; v++) if (j.parent[v] >= 0) expect(g.v[j.parent[v]] <= g.v[v] + 1e-12).toBe(true)
  })
  it('landscape: one hill per maximum, hill volumes add up to the vertices, peaks reach their persistence', () => {
    const h = landscapeHills(g)
    expect(h.length).toBe(ex.mx)
    expect(h.reduce((a, x) => a + x.volume, 0)).toBe(g.nx * g.ny)
    const top = h.find((x) => x.parent < 0)!
    expect(top.rise).toBeCloseTo(Math.max(...g.v) - Math.min(...g.v), 6)
    const { h: z } = landscapeHeights(h, 61)
    expect(Math.max(...z)).toBeGreaterThan(0)
  })
})

describe('Probabilistic isocontours', () => {
  const g: Grid2 = { nx: 12, ny: 12, v: Float64Array.from({ length: 144 }, (_, k) => (k % 12) / 11) } // ramp in x
  const sigma = new Float64Array(144).fill(0.1)
  it('the crossing probability peaks where the mean field crosses the level', () => {
    const p = crossingProbability(g, sigma, 0.5, 200, 3)
    const col = (i: number) => p[5 * 11 + i]
    expect(col(5)).toBeGreaterThan(0.8)
    expect(col(0)).toBeLessThan(0.02); expect(col(10)).toBeLessThan(0.02)
  })
  it('without noise the probability is exactly 0 or 1', () => {
    const p = crossingProbability(g, new Float64Array(144), 0.5, 5, 3)
    expect([...new Set(p)].sort()).toEqual([0, 1])
  })
})

const sortedMin = (g: Grid2) => g.v.indexOf(Math.min(...g.v))

describe('Statistical forms', () => {
  it('functional boxplot: the central curve is the median, a shifted curve is the outlier, the band holds the central half', () => {
    const base = (a: number) => Array.from({ length: 30 }, (_, t) => a + Math.sin(t / 5))
    const curves = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2].map(base)
    curves.push(base(9))
    const f = functionalBoxplot(curves)
    expect(f.outliers).toEqual([9])
    expect(Math.abs(f.median - 4)).toBeLessThanOrEqual(1)
    expect(f.central.length).toBe(5)
    f.central.forEach((i) => curves[i].forEach((v, t) => { expect(v).toBeGreaterThanOrEqual(f.lower[t] - 1e-12); expect(v).toBeLessThanOrEqual(f.upper[t] + 1e-12) }))
    expect(modifiedBandDepth(curves).every((d) => d >= 0 && d <= 1)).toBe(true)
  })
  it('stem-and-leaf: every value is recovered from its stem and leaf', () => {
    const v = [12, 15, 21, 21, 38, 45, 47, 59, 60, 61, 61, 99]
    const { rows } = stemLeaf(v, 1, false)
    const back = rows.flatMap((r) => r.leaves.map((l) => r.stem * 10 + l)).sort((a, b) => a - b)
    expect(back).toEqual(v)
    expect(rows.find((r) => r.stem === 2)!.leaves).toEqual([1, 1])
    const split = stemLeaf(v, 1, true)
    expect(split.rows.length).toBe(rows.length * 2)
    expect(split.rows.flatMap((r) => r.leaves).length).toBe(v.length)
  })
  it('sunflower: the petal counts add up to the number of observations', () => {
    const r = createRng(1)
    const pts = Array.from({ length: 200 }, () => [Math.floor(r() * 8), Math.floor(r() * 8)] as [number, number])
    const s = sunflower(pts, [0, 8], [0, 8], [8, 8])
    expect(s.reduce((a, c) => a + c.n, 0)).toBe(200)
    expect(Math.max(...s.map((c) => c.n))).toBeGreaterThan(2)
  })
  it('hanging rootogram: a perfect fit ends every bar on zero', () => {
    const exp = poissonPmf(2, 8).map((p) => p * 100)
    const bars = rootogram(exp, exp)
    bars.forEach((b) => expect(b.bottom).toBeCloseTo(0, 12))
    expect(rootogram([10], [4])[0].bottom).toBeLessThan(0)
    expect(poissonPmf(2, 40).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
  })
  it('Lorenz curve and Gini: equality gives 0, one holder gives (n−1)/n', () => {
    expect(lorenz([5, 5, 5, 5]).gini).toBeCloseTo(0, 12)
    expect(lorenz([0, 0, 0, 10]).gini).toBeCloseTo(0.75, 12)
    const l = lorenz([1, 2, 3, 10])
    expect(l.points[l.points.length - 1]).toEqual([1, 1])
    l.points.forEach(([x, y]) => expect(y).toBeLessThanOrEqual(x + 1e-12))
  })
  it('tornado: bars sorted by swing, deviations measured from the base case', () => {
    const t = tornado(100, [{ name: 'a', low: 90, high: 105 }, { name: 'b', low: 60, high: 140 }, { name: 'c', low: 98, high: 101 }])
    expect(t.map((x) => x.name)).toEqual(['b', 'a', 'c'])
    expect(t[0].dLow).toBe(-40); expect(t[0].dHigh).toBe(40)
  })
})

import { bagplot, decisionCurve, divergingBars, halfspaceDepth } from './stat10b'

describe('bagplot / diverging bars / decision curve', () => {
  const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [5, 5]]
  it('halfspace depth: the centre is deepest and a corner has depth 1', () => {
    const d = halfspaceDepth(square)
    expect(d[4]).toBe(Math.max(...d))
    expect(d[0]).toBe(1)
  })
  it('bagplot flags a far point as an outlier and keeps the cloud inside the fence', () => {
    const pts: [number, number][] = []
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) pts.push([i, j])
    pts.push([60, 60])
    const bp = bagplot(pts, 3)
    expect(bp.outliers).toEqual([64])
    expect(bp.center[0]).toBeGreaterThan(2.5)
    expect(bp.center[0]).toBeLessThan(5)
  })
  it('diverging bars: the segments chain, the neutral level straddles zero and shares sum to 100', () => {
    const [b] = divergingBars([{ name: 'a', counts: [10, 20, 40, 20, 10] }])
    expect(b.shares.reduce((x, y) => x + y, 0)).toBeCloseTo(100)
    expect(b.starts[2]).toBeCloseTo(-b.shares[2] / 2)
    expect(b.starts[2] + b.shares[2] / 2).toBeCloseTo(0)
    expect(b.negative).toBeCloseTo(30)
    expect(b.positive).toBeCloseTo(30)
  })
  it('decision curve: matches the hand-computed net benefit', () => {
    // 4 patients, outcomes 1,1,0,0, risks .9,.4,.6,.1 at t = .5: act on {.9,.6} -> TP 1, FP 1 -> 1/4 - 1/4 * 1 = 0
    const [p] = decisionCurve([1, 1, 0, 0], [0.9, 0.4, 0.6, 0.1], [0.5])
    expect(p.model).toBeCloseTo(0)
    expect(p.all).toBeCloseTo(0.5 - 0.5 * 1)
    const [q] = decisionCurve([1, 1, 0, 0], [0.9, 0.8, 0.2, 0.1], [0.5])
    expect(q.model).toBeCloseTo(0.5)
  })
})
