import { describe, expect, it } from 'vitest'
import { buildNetwork } from './network'
import { bioFabric, classicVenn, distanceForOverlap, eulerLayout, exclusiveIntersections, inclusiveCount, jaccard, lensArea, regionAreas } from './sets'

describe('intersections', () => {
  const member = [[true, true, false], [true, false, false], [true, true, true], [false, false, true], [false, false, false], [true, true, false]]
  it('exclusive counts add up to the items in at least one set; inclusive counts include larger combinations', () => {
    const ix = exclusiveIntersections(member, 3)
    expect(ix.reduce((s, x) => s + x.count, 0)).toBe(5)
    expect(ix.find((x) => x.mask === 0b011)?.count).toBe(2)
    expect(ix.find((x) => x.mask === 0b111)?.count).toBe(1)
    expect(inclusiveCount(member, 0b011)).toBe(3) // A∩B also counts the A∩B∩C item
    expect(inclusiveCount(member, 0b001)).toBe(4)
    expect(jaccard(4, 3, 3)).toBeCloseTo(3 / 4, 12)
  })
})

describe('area-proportional layout', () => {
  it('lens area: known values for unit circles', () => {
    expect(lensArea(1, 1, 0)).toBeCloseTo(Math.PI, 12)
    expect(lensArea(1, 1, 2)).toBe(0)
    expect(lensArea(1, 1, 1)).toBeCloseTo((2 * Math.PI) / 3 - Math.sqrt(3) / 2, 12)
    expect(lensArea(2, 0.5, 1)).toBeCloseTo(Math.PI * 0.25, 12) // the small circle lies inside the big one
  })
  it('the centre distance reproduces the requested overlap', () => {
    for (const [r1, r2, a] of [[1, 1, 0.8], [2, 1, 1.5], [1.5, 0.7, 0.3]] as const) expect(lensArea(r1, r2, distanceForOverlap(r1, r2, a))).toBeCloseTo(a, 9)
    expect(distanceForOverlap(1, 1, 0)).toBe(2)
  })
  it('two sets reproduce their sizes and overlap; the region areas follow', () => {
    const c = eulerLayout([40, 25], [[40, 10], [10, 25]])
    const reg = regionAreas(c, 600)
    const area = (mask: number) => reg.find((r) => r.mask === mask)?.area ?? 0
    expect(area(0b01) + area(0b11)).toBeCloseTo(40, 0)
    expect(area(0b10) + area(0b11)).toBeCloseTo(25, 0)
    expect(area(0b11)).toBeCloseTo(10, 0)
  })
  it('three sets: the pairwise overlaps are exact when the circles can be placed', () => {
    // pairwise overlaps taken from a real three-circle configuration, so an exact placement exists
    const truth = [{ x: 0, y: 0, r: 2 }, { x: 2, y: 0, r: 1.5 }, { x: 1, y: 1.6, r: 1.2 }]
    const sizes = truth.map((t) => Math.PI * t.r * t.r)
    const pair = truth.map((a, i) => truth.map((b, j) => (i === j ? sizes[i] : lensArea(a.r, b.r, Math.hypot(a.x - b.x, a.y - b.y)))))
    const c = eulerLayout(sizes, pair)
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(lensArea(c[i].r, c[j].r, Math.hypot(c[i].x - c[j].x, c[i].y - c[j].y))).toBeCloseTo(pair[i][j], 8)
  })
  it('the classical Venn arrangement has all seven regions', () => {
    expect(regionAreas(classicVenn(3), 300).map((r) => r.mask).sort()).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
})

describe('BioFabric', () => {
  const net = buildNetwork([
    { source: 'a', target: 'b', weight: 1, group: '', row: 0 }, { source: 'a', target: 'c', weight: 1, group: '', row: 1 },
    { source: 'b', target: 'd', weight: 1, group: '', row: 2 }, { source: 'e', target: 'f', weight: 1, group: '', row: 3 },
  ])
  it('gives every node one row and every edge one column spanning its endpoints', () => {
    const f = bioFabric(net, 'bfs')
    expect([...f.rows].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(f.edges).toHaveLength(4)
    for (const e of f.edges) { expect(e.top).toBeLessThan(e.bottom); expect(f.rows[e.top]).toBe(e.source); expect(f.rows[e.bottom]).toBe(e.target) }
    // columns are sorted by the upper endpoint
    expect(f.edges.map((e) => e.top)).toEqual([...f.edges.map((e) => e.top)].sort((x, y) => x - y))
  })
  it('breadth-first order keeps neighbours close: a component stays contiguous', () => {
    const f = bioFabric(net, 'bfs')
    const idx = (id: string) => f.rows.indexOf(id)
    const comp1 = ['a', 'b', 'c', 'd'].map(idx).sort((x, y) => x - y)
    expect(comp1[3] - comp1[0]).toBe(3)
  })
})
