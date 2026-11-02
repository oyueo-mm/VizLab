import { describe, expect, it } from 'vitest'
import { createRng } from '../lib/random'
import { bundleEdges, edgeCompatibility, hyperbolicDistance, hyperbolicLayout, linearDiagram, mobius, polylineLength, rotate, storyCrossings, storylineLayout, type Cx, type Edge2 } from './net7'

const tree = { name: 'root', children: [{ name: 'A', children: [{ name: 'a1' }, { name: 'a2' }, { name: 'a3', children: [{ name: 'a31' }, { name: 'a32' }] }] }, { name: 'B', children: [{ name: 'b1' }, { name: 'b2' }] }, { name: 'C' }] }

describe('hyperbolic tree', () => {
  const nodes = hyperbolicLayout(tree, 1.2)
  it('keeps every node inside the unit disc and puts depth k at hyperbolic distance k·δ from the root', () => {
    for (const n of nodes) {
      expect(Math.hypot(...n.z)).toBeLessThan(1)
      expect(hyperbolicDistance([0, 0], n.z)).toBeCloseTo(n.depth * 1.2, 9)
    }
  })
  it('children occupy the angular wedge of their parent', () => {
    const A = nodes.find((n) => n.name === 'A')!, a2 = nodes.find((n) => n.name === 'a2')!
    expect(a2.theta).toBeGreaterThan(A.theta - 2 * Math.PI * (A.leaves / nodes[0].leaves) / 2 - 1e-9)
    expect(nodes[0].leaves).toBe(7)
  })
  it('the Möbius map sends the focus to the origin and preserves hyperbolic distances (an isometry)', () => {
    const a = nodes.find((n) => n.name === 'a3')!.z
    const m = mobius(a, a)
    expect(Math.hypot(...m)).toBeCloseTo(0, 12)
    for (let i = 1; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const d0 = hyperbolicDistance(nodes[i].z, nodes[j].z)
      const d1 = hyperbolicDistance(mobius(nodes[i].z, a), mobius(nodes[j].z, a))
      expect(d1).toBeCloseTo(d0, 8)
    }
    for (const n of nodes) expect(Math.hypot(...mobius(n.z, a))).toBeLessThan(1)
  })
  it('rotation keeps distances; points near the rim shrink: equal hyperbolic steps map to ever smaller Euclidean steps', () => {
    const p: Cx = [0.3, 0.2], q: Cx = [-0.4, 0.1]
    expect(hyperbolicDistance(rotate(p, 1.1), rotate(q, 1.1))).toBeCloseTo(hyperbolicDistance(p, q), 10)
    const r = (rho: number) => Math.tanh(rho / 2)
    expect(r(2) - r(1)).toBeGreaterThan(r(3) - r(2))
    expect(r(3) - r(2)).toBeGreaterThan(r(4) - r(3))
  })
})

describe('linear set diagram', () => {
  const member = [[true, false, false], [true, true, false], [true, true, false], [false, true, true], [false, false, true], [true, false, true], [true, true, true], [false, false, false]]
  const ld = linearDiagram(member, 'size')
  it('column widths add up to one and each set row is the union of the columns that contain it', () => {
    expect(ld.columns.reduce((s, c) => s + (c.x1 - c.x0), 0)).toBeCloseTo(1, 12)
    for (let j = 0; j < 3; j++) {
      const width = ld.columns.filter((c) => c.sets.includes(j)).reduce((s, c) => s + (c.x1 - c.x0), 0)
      expect(width * ld.total).toBeCloseTo(ld.setSizes[j], 9)
    }
    expect(ld.setSizes).toEqual([5, 4, 4])
  })
  it('a column is one exact membership pattern: its width is the Venn-region size', () => {
    const ab = ld.columns.find((c) => c.sets.join() === '0,1')!
    expect(ab.count).toBe(2)
    expect(ld.columns.find((c) => c.sets.length === 0)!.count).toBe(1)
    expect(ld.columns.every((c, i) => i === 0 || c.x0 >= ld.columns[i - 1].x1 - 1e-12)).toBe(true)
  })
  it('sorting by degree puts low-degree patterns first', () => {
    const deg = linearDiagram(member, 'degree').columns.map((c) => c.sets.length)
    expect(deg).toEqual([...deg].sort((a, b) => a - b))
  })
})

describe('force-directed edge bundling', () => {
  const rng = createRng(3)
  const edges: Edge2[] = [
    ...Array.from({ length: 14 }, () => ({ x0: rng() * 0.1, y0: 0.05 + rng() * 0.1, x1: 0.9 + rng() * 0.1, y1: 0.05 + rng() * 0.1 })),
    ...Array.from({ length: 10 }, () => ({ x0: rng() * 0.1, y0: 0.85 + rng() * 0.1, x1: 0.9 + rng() * 0.1, y1: 0.85 + rng() * 0.1 })),
  ]
  it('compatibility is 1 for the same edge, symmetric, and low for crossing perpendicular edges', () => {
    const e = edges[0]
    expect(edgeCompatibility(e, e)).toBeCloseTo(1, 9)
    expect(edgeCompatibility(edges[0], edges[1])).toBeCloseTo(edgeCompatibility(edges[1], edges[0]), 12)
    expect(edgeCompatibility({ x0: 0, y0: 0, x1: 1, y1: 0 }, { x0: 0.5, y0: -0.5, x1: 0.5, y1: 0.5 })).toBeLessThan(0.05)
    expect(edgeCompatibility(edges[0], edges[1])).toBeGreaterThan(edgeCompatibility(edges[0], edges[20]))
  })
  const lines = bundleEdges(edges, { cycles: 5, iterations: 40 })
  it('keeps the end points fixed and returns one polyline per edge', () => {
    expect(lines.length).toBe(edges.length)
    lines.forEach((l, i) => { expect(l[0]).toEqual([edges[i].x0, edges[i].y0]); expect(l[l.length - 1]).toEqual([edges[i].x1, edges[i].y1]); expect(l.length).toBeGreaterThan(8) })
  })
  it('bundles: compatible edges end up much closer in the middle than the straight edges, and no edge becomes shorter than straight', () => {
    const midGap = (ls: [number, number][][], a: number, b: number) => { const m = (l: [number, number][]) => l[Math.floor(l.length / 2)]; return Math.hypot(m(ls[a])[0] - m(ls[b])[0], m(ls[a])[1] - m(ls[b])[1]) }
    const straight = edges.map((e) => [[e.x0, e.y0], [e.x1, e.y1]] as [number, number][])
    let before = 0, after = 0
    for (let a = 0; a < 14; a++) for (let b = a + 1; b < 14; b++) { before += Math.hypot((edges[a].y0 + edges[a].y1) / 2 - (edges[b].y0 + edges[b].y1) / 2, 0); after += midGap(lines, a, b) }
    expect(straight.length).toBe(edges.length)
    expect(after).toBeLessThan(0.8 * before)
    lines.forEach((l, i) => expect(polylineLength(l)).toBeGreaterThanOrEqual(Math.hypot(edges[i].x1 - edges[i].x0, edges[i].y1 - edges[i].y0) - 1e-9))
  })
  it('does not merge the two corridors: edges of the upper and lower groups stay apart', () => {
    const m = (l: [number, number][]) => l[Math.floor(l.length / 2)]
    expect(Math.abs(m(lines[0])[1] - m(lines[20])[1])).toBeGreaterThan(0.2)
  })
})

describe('storyline layout', () => {
  const ev = [
    ...['A', 'B', 'C'].map((e) => ({ entity: e, t: 1, session: 's1' })), { entity: 'D', t: 1, session: 's2' }, { entity: 'E', t: 1, session: 's2' },
    ...['A', 'D'].map((e) => ({ entity: e, t: 2, session: 's3' })), ...['B', 'C', 'E'].map((e) => ({ entity: e, t: 2, session: 's4' })),
    ...['A', 'B', 'C', 'D', 'E'].map((e) => ({ entity: e, t: 3, session: 's5' })),
  ]
  const lay = storylineLayout(ev)
  it('puts members of a session on adjacent rows and keeps rows distinct within a time step', () => {
    for (const t of lay.times) {
      const at = lay.points.filter((p) => p.t === t)
      expect(new Set(at.map((p) => p.y)).size).toBe(at.length)
      const sessions = new Set(at.map((p) => p.session))
      for (const s of sessions) {
        const ys = at.filter((p) => p.session === s).map((p) => p.y).sort((a, b) => a - b)
        for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeCloseTo(1, 9)
      }
    }
    expect(lay.points.length).toBe(ev.length)
  })
  it('keeps crossings low and reports exactly the number of swapped pairs', () => {
    expect(lay.crossings).toBeLessThanOrEqual(3)
    expect(lay.crossings).toBe(storyCrossings(lay.points, lay.times))
    // a reversed order between two steps counts every pair once
    const two = [{ entity: 'x', t: 1, y: 0, session: 'a' }, { entity: 'y', t: 1, y: 1, session: 'a' }, { entity: 'x', t: 2, y: 1, session: 'a' }, { entity: 'y', t: 2, y: 0, session: 'a' }]
    expect(storyCrossings(two, [1, 2])).toBe(1)
  })
})
