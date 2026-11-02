import { describe, expect, it } from 'vitest'
import { hclust, linkageTree, type ClusterNode } from './cluster'
import {
  curveCell, curveSide, hilbertD2XY, leafOrder, mortonD2XY, parallelSets, polygonArea, tangleCrossings, tokenize, untangle, voronoiPartition, voronoiTreemap, wordCloud,
  wordFrequencies, wordTree, type P2,
} from './struct7'

describe('parallel sets', () => {
  const rows = [
    { cats: ['a', 'x', 'p'], w: 5 }, { cats: ['a', 'y', 'p'], w: 3 }, { cats: ['b', 'x', 'q'], w: 2 }, { cats: ['b', 'y', 'q'], w: 6 }, { cats: ['a', 'x', 'q'], w: 4 },
  ]
  const ps = parallelSets(rows, 3)
  it('every axis spans the full height and segment heights are proportional to totals', () => {
    for (let d = 0; d < 3; d++) {
      const segs = ps.segments.filter((s) => s.dim === d)
      expect(segs.reduce((a, s) => a + (s.y1 - s.y0), 0)).toBeCloseTo(1, 12)
      for (const s of segs) expect(s.y1 - s.y0).toBeCloseTo(s.total / ps.total, 12)
    }
  })
  it('ribbons add up to the segments on both ends, with no overlap inside a segment', () => {
    for (let d = 0; d < 2; d++) {
      for (const s of ps.segments.filter((x) => x.dim === d)) {
        const out = ps.ribbons.filter((r) => r.dim === d && r.a === s.key)
        expect(out.reduce((a, r) => a + (r.ya1 - r.ya0), 0)).toBeCloseTo(s.y1 - s.y0, 12)
        const sorted = [...out].sort((p, q) => p.ya0 - q.ya0)
        for (let i = 1; i < sorted.length; i++) expect(sorted[i].ya0).toBeGreaterThanOrEqual(sorted[i - 1].ya1 - 1e-12)
      }
      for (const s of ps.segments.filter((x) => x.dim === d + 1)) {
        const inn = ps.ribbons.filter((r) => r.dim === d && r.b === s.key)
        expect(inn.reduce((a, r) => a + (r.yb1 - r.yb0), 0)).toBeCloseTo(s.y1 - s.y0, 12)
        for (const r of inn) { expect(r.yb0).toBeGreaterThanOrEqual(s.y0 - 1e-12); expect(r.yb1).toBeLessThanOrEqual(s.y1 + 1e-12) }
      }
    }
  })
  it('a ribbon carries the weight of the records having both categories', () => {
    const r = ps.ribbons.find((x) => x.dim === 0 && x.a === 'a' && x.b === 'x')!
    expect(r.weight).toBe(9)
    expect(r.ya1 - r.ya0).toBeCloseTo(9 / 20, 12)
  })
})

describe('words', () => {
  it('tokenizes Korean with particle removal and drops short words and polite verb endings', () => {
    expect(tokenize('시각화는 데이터를 눈으로 이해하게 합니다')).toEqual(['시각화', '데이터', '눈으로', '이해하게'])
    expect(tokenize('The Chart is good')).toEqual(['the', 'chart', 'is', 'good'])
  })
  it('counts frequencies and sorts them', () => {
    const f = wordFrequencies(['시각화는 시각화로 좋다', '시각화 데이터'])
    expect(f[0]).toEqual({ word: '시각화', count: 3 })
  })
  it('word cloud boxes never overlap, stay inside the frame and larger counts get larger fonts', () => {
    const words = Array.from({ length: 40 }, (_, i) => ({ word: `단어${i}`, count: 40 - i }))
    const { placed } = wordCloud(words, 800, 500, { minSize: 12, maxSize: 52, rotate: true })
    expect(placed.length).toBeGreaterThan(20)
    for (const p of placed) { expect(p.x - p.w / 2).toBeGreaterThanOrEqual(-1e-9); expect(p.x + p.w / 2).toBeLessThanOrEqual(800 + 1e-9); expect(p.y - p.h / 2).toBeGreaterThanOrEqual(-1e-9); expect(p.y + p.h / 2).toBeLessThanOrEqual(500 + 1e-9) }
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j]
      expect(Math.abs(a.x - b.x) * 2 >= a.w + b.w || Math.abs(a.y - b.y) * 2 >= a.h + b.h, `${a.word} ${b.word}`).toBe(true)
    }
    expect(placed[0].size).toBeGreaterThan(placed[placed.length - 1].size)
    expect(wordCloud(words, 800, 500, { minSize: 12, maxSize: 52, rotate: true }).placed).toEqual(placed)
  })
  it('word tree counts the sentences through every node', () => {
    const sents = ['red apple pie', 'red apple tart', 'red cherry pie', 'green apple pie']
    const t = wordTree(sents, 'apple', 3)
    expect(t.occurrences).toBe(3)
    expect(t.right.count).toBe(3)
    expect(t.right.children.find((c) => c.word === 'pie')!.count).toBe(2)
    expect(t.right.children.reduce((s, c) => s + c.count, 0)).toBe(3)
    expect(t.left.children.find((c) => c.word === 'red')!.count).toBe(2)
  })
})

describe('space-filling curves', () => {
  it('the Hilbert curve visits every cell once and consecutive cells are neighbours', () => {
    for (const side of [2, 4, 8, 16]) {
      const seen = new Set<string>()
      let prev: P2 | null = null
      for (let d = 0; d < side * side; d++) {
        const c = hilbertD2XY(side, d)
        seen.add(c.join(','))
        if (prev) expect(Math.abs(c[0] - prev[0]) + Math.abs(c[1] - prev[1])).toBe(1)
        prev = c
      }
      expect(seen.size).toBe(side * side)
    }
  })
  it('Z-order, snake and row orders are bijections; the snake keeps neighbours adjacent', () => {
    const side = 8
    for (const kind of ['zorder', 'snake', 'row', 'hilbert'] as const) {
      const cells = Array.from({ length: side * side }, (_, d) => curveCell(kind, side, d))
      expect(new Set(cells.map((c) => c.join(','))).size).toBe(side * side)
    }
    for (let d = 1; d < side * side; d++) { const a = curveCell('snake', side, d - 1), b = curveCell('snake', side, d); expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])).toBe(1) }
    expect(mortonD2XY(3)).toEqual([1, 1])
    expect(curveSide(100, 'hilbert')).toBe(16)
    expect(curveSide(100, 'row')).toBe(10)
  })
})

describe('Voronoi treemap', () => {
  const square: P2[] = [[0, 0], [100, 0], [100, 100], [0, 100]]
  it('cell areas follow the values within a few percent and tile the polygon', () => {
    const values = [40, 25, 15, 10, 6, 4]
    const { cells, error } = voronoiPartition(values, square, 400, 3, 0.01)
    expect(error).toBeLessThan(0.05)
    const areas = cells.map(polygonArea)
    expect(areas.reduce((a, b) => a + b, 0)).toBeCloseTo(10000, 3)
    const sum = values.reduce((a, b) => a + b, 0)
    areas.forEach((a, i) => expect(Math.abs(a / 10000 - values[i] / sum)).toBeLessThan(0.01))
    for (const c of cells) for (const [x, y] of c) { expect(x).toBeGreaterThanOrEqual(-1e-9); expect(x).toBeLessThanOrEqual(100 + 1e-9); expect(y).toBeGreaterThanOrEqual(-1e-9); expect(y).toBeLessThanOrEqual(100 + 1e-9) }
  })
  it('is deterministic for a seed and recursive cells stay inside their parent', () => {
    const a = voronoiPartition([3, 2, 1], square, 120, 5).cells, b = voronoiPartition([3, 2, 1], square, 120, 5).cells
    expect(a).toEqual(b)
    const tree = { name: 'root', children: [{ name: 'A', children: [{ name: 'a1', value: 6 }, { name: 'a2', value: 4 }] }, { name: 'B', value: 10 }] }
    const cells = voronoiTreemap(tree, square, 2, 200)
    const A = cells.find((c) => c.node.name === 'A')!, a1 = cells.find((c) => c.node.name === 'a1')!
    expect(Math.abs(polygonArea(A.polygon) / 5000 - 1)).toBeLessThan(0.03)
    expect(polygonArea(a1.polygon)).toBeLessThan(polygonArea(A.polygon))
    for (const [x, y] of a1.polygon) expect(A.polygon.some(() => true) && x >= Math.min(...A.polygon.map((p) => p[0])) - 1e-6 && x <= Math.max(...A.polygon.map((p) => p[0])) + 1e-6 && y >= Math.min(...A.polygon.map((p) => p[1])) - 1e-6 && y <= Math.max(...A.polygon.map((p) => p[1])) + 1e-6).toBe(true)
  })
})

describe('tanglegram', () => {
  it('counts crossings as permutation inversions', () => {
    expect(tangleCrossings([0, 1, 2, 3], [0, 1, 2, 3])).toBe(0)
    expect(tangleCrossings([0, 1, 2, 3], [3, 2, 1, 0])).toBe(6)
    expect(tangleCrossings([0, 1, 2], [1, 0, 2])).toBe(1)
  })
  it('flipping children can remove every crossing between two copies of the same tree', () => {
    const pts = [[0, 0], [0.2, 0.1], [5, 5], [5.2, 5.1], [10, 0], [10.1, 0.3]]
    const merges = hclust(pts, 'euclidean', 'average')
    const t = linkageTree(merges, pts.map((_, i) => String(i)))
    const flip = (n: ClusterNode, depth = 0): ClusterNode => ({ ...n, children: n.children ? (depth % 2 === 0 ? [...n.children].reverse() : n.children).map((c) => flip(c, depth + 1)) : undefined })
    const messy = flip(t)
    const res = untangle(t, messy)
    expect(res.before).toBeGreaterThan(0)
    expect(res.after).toBe(0)
    expect(tangleCrossings(leafOrder(res.a), leafOrder(res.b))).toBe(res.after)
    expect([...leafOrder(res.a)].sort()).toEqual([...leafOrder(t)].sort())
  })
  it('never makes the number of crossings worse', () => {
    const pts = Array.from({ length: 14 }, (_, i) => [Math.sin(i * 1.7) * 5, Math.cos(i * 2.3) * 5, (i % 4) * 2])
    const t1 = linkageTree(hclust(pts, 'euclidean', 'single'), pts.map((_, i) => String(i)))
    const t2 = linkageTree(hclust(pts, 'euclidean', 'complete'), pts.map((_, i) => String(i)))
    const r = untangle(t1, t2)
    expect(r.after).toBeLessThanOrEqual(r.before)
  })
})

describe('parallel sets colouring', () => {
  it('splitting ribbons by the colour axis keeps every pair weight and segment total', () => {
    const rows = [{ cats: ['a', 'x', 'p'], w: 5 }, { cats: ['b', 'x', 'p'], w: 2 }, { cats: ['a', 'y', 'q'], w: 3 }, { cats: ['b', 'y', 'q'], w: 4 }]
    const ps = parallelSets(rows, 3, 0, 2)
    const px = ps.ribbons.filter((r) => r.dim === 1 && r.a === 'x')
    expect(px.map((r) => r.color)).toEqual(['p'])
    expect(ps.ribbons.filter((r) => r.dim === 0 && r.b === 'x').reduce((s, r) => s + r.weight, 0)).toBe(7)
    const split = parallelSets(rows, 3, 0, 0).ribbons.filter((r) => r.dim === 1 && r.a === 'x')
    expect(split.map((r) => r.color).sort()).toEqual(['a', 'b'])
    expect(split.reduce((s, r) => s + r.weight, 0)).toBe(7)
  })
})
