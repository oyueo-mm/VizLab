import { describe, expect, it } from 'vitest'
import { bubbleSet, countCrossings, defaultBubble, kelp, lineSets, pathLength, radialSets, rainbowBoxes, routeAround, shortestPath, spanningTree, type Pt } from './sets8'

// two clusters of members (A) far apart with a block of non-members between them, plus noise elsewhere
const pts: Pt[] = [
  [40, 60], [60, 80], [50, 40], // 0-2 members (left)
  [260, 60], [280, 90], [250, 30], // 3-5 members (right)
  [150, 60], [165, 75], [150, 90], // 6-8 non-members in between
  [150, 200], [60, 200], // 9-10 non-members below
]
const member = pts.map((_, i) => i < 6)

describe('spanning tree and routing', () => {
  it('connects n points with n-1 edges', () => {
    const t = spanningTree([0, 1, 2, 3, 4, 5], pts)
    expect(t).toHaveLength(5)
  })
  it('routes around an obstacle on the line', () => {
    const route = routeAround([0, 0], [100, 0], [{ x: 50, y: 0, r: 10 }], 4)
    expect(route.length).toBeGreaterThan(2)
    for (let i = 1; i < route.length - 1; i++) expect(Math.hypot(route[i][0] - 50, route[i][1])).toBeGreaterThanOrEqual(10)
    expect(routeAround([0, 0], [100, 0], [{ x: 50, y: 40, r: 10 }], 4)).toHaveLength(2)
  })
})

describe('Bubble Sets', () => {
  it('a lone member produces a circle of about the item radius', () => {
    const one = bubbleSet([[100, 100]], [true], 200, 200, { ...defaultBubble, cell: 2 })
    expect(one.rings).toHaveLength(1)
    const rs = one.rings[0].map((p) => Math.hypot(p[0] - 100, p[1] - 100))
    const mean = rs.reduce((a, b) => a + b, 0) / rs.length
    expect(mean).toBeGreaterThan(defaultBubble.r0 * 0.8)
    expect(mean).toBeLessThan(defaultBubble.r0 * 1.3)
  })
  it('covers every member and joins the two clusters while keeping non-members out', () => {
    const r = bubbleSet(pts, member, 320, 240)
    expect(r.coveredMembers).toBe(r.members)
    expect(r.leakedOthers).toBe(0)
    expect(r.links.length).toBe(5)
  })
  it('more avoidance never leaks more non-members', () => {
    const lo = bubbleSet(pts, member, 320, 240, { ...defaultBubble, avoid: 0 })
    const hi = bubbleSet(pts, member, 320, 240, { ...defaultBubble, avoid: 1.2 })
    expect(hi.leakedOthers).toBeLessThanOrEqual(lo.leakedOthers)
  })
  it('an empty set has no region', () => {
    expect(bubbleSet(pts, pts.map(() => false), 320, 240).rings).toHaveLength(0)
  })
})

describe('LineSets', () => {
  it('shortest path visits every point once and is not longer than the input order', () => {
    const idx = [0, 1, 2, 3, 4, 5]
    const p = shortestPath(idx, pts)
    expect([...p].sort()).toEqual(idx)
    expect(pathLength(p, pts)).toBeLessThanOrEqual(pathLength([0, 3, 1, 4, 2, 5], pts))
  })
  it('separates lines of sets that share an item', () => {
    const m = [[true, true, true, false], [false, true, true, true]]
    const four: Pt[] = [[0, 0], [50, 0], [100, 0], [150, 0]]
    const ls = lineSets(four, m, 6)
    const a = ls.sets[0].line, b = ls.sets[1].line
    // shared items 1 and 2 are displaced in opposite directions
    expect(ls.sets[0].order).toHaveLength(3)
    const ia = ls.sets[0].order.indexOf(1), ib = ls.sets[1].order.indexOf(1)
    expect(Math.abs(a[ia][1] - b[ib][1])).toBeCloseTo(6, 5)
  })
  it('counts crossings of two polylines', () => {
    expect(countCrossings([[[0, 0], [10, 10]], [[0, 10], [10, 0]]])).toBe(1)
    expect(countCrossings([[[0, 0], [10, 0]], [[0, 5], [10, 5]]])).toBe(0)
  })
})

describe('Kelp Diagram', () => {
  it('covers all members and fusion fills empty triangles without leaking non-members', () => {
    const k0 = kelp(pts, member, 320, 240)
    expect(k0.coveredMembers).toBe(k0.members)
    expect(k0.leakedOthers).toBe(0)
    const area = (r: ReturnType<typeof kelp>) => r.rings.reduce((s, ring) => s + Math.abs(ring.reduce((a, p, i) => a + (ring[(i + 1) % ring.length][0] - p[0]) * (ring[(i + 1) % ring.length][1] + p[1]), 0) / 2), 0)
    const k1 = kelp(pts, member, 320, 240, { radius: 16, waist: 0.35, avoid: 0.9, fusion: 1, cell: 5 })
    expect(area(k1)).toBeGreaterThanOrEqual(area(k0))
    expect(k1.leakedOthers).toBe(0)
  })
})

describe('Rainbow Boxes', () => {
  const m = [
    [true, true, false, false, true, false],
    [false, true, true, false, false, false],
    [false, false, false, true, true, true],
  ]
  it('orders elements so that every box is one run when that is possible', () => {
    // a consecutive-ones ordering exists for these sets
    const lay = rainbowBoxes([[true, true, false, false], [false, true, true, false], [false, false, true, true]], 4)
    expect(lay.fragments).toBe(3)
    expect([...lay.order].sort()).toEqual([0, 1, 2, 3])
  })
  it('never has fewer fragments than non-empty sets and never more than the identity order', () => {
    const lay = rainbowBoxes(m, 6)
    expect(lay.fragments).toBeGreaterThanOrEqual(3)
    const identity = m.reduce((n, row) => n + row.reduce((c, v, i) => c + (v && !row[i - 1] ? 1 : 0), 0), 0)
    expect(lay.fragments).toBeLessThanOrEqual(identity)
  })
  it('puts sets with disjoint column extents in the same lane', () => {
    const lay = rainbowBoxes([[true, true, false, false], [false, false, true, true]], 4)
    expect(lay.lanes).toBe(1)
  })
})

describe('Radial Sets', () => {
  const m = [[true, true, true, false], [false, true, true, true], [false, false, true, false]]
  it('sector angles are proportional to set sizes and fill the circle', () => {
    const r = radialSets(m, 4, 0.1)
    const total = r.sectors.reduce((s, x) => s + (x.a1 - x.a0), 0) + 0.1 * 3
    expect(total).toBeCloseTo(2 * Math.PI, 8)
    expect((r.sectors[0].a1 - r.sectors[0].a0) / (r.sectors[2].a1 - r.sectors[2].a0)).toBeCloseTo(3, 8)
  })
  it('groups elements by degree and sizes overlap bands by shared elements', () => {
    const r = radialSets(m, 4)
    // set 0 has elements 0 (degree 1), 1 (degree 2), 2 (degree 3)
    expect(r.arcs.filter((a) => a.set === 0).map((a) => [a.degree, a.count])).toEqual([[1, 1], [2, 1], [3, 1]])
    expect(r.links.find((l) => l.a === 0 && l.b === 1)!.count).toBe(2)
    expect(r.maxDegree).toBe(3)
  })
})
