import { describe, expect, it } from 'vitest'
import { attachPoint, blockLayout, confluentTracks, expandPowerGraph, expandTracks, orderBlock, powerGraph, trackCurve, uniqueEdges, type Edge, type Pt } from './graph8'

// K(4,5) between nodes 0-3 and 4-8, a 5-clique on 9-13, plus a few unrelated edges
const planted = (): Edge[] => {
  const e: Edge[] = []
  for (let a = 0; a < 4; a++) for (let b = 4; b < 9; b++) e.push([a, b])
  for (let a = 9; a < 14; a++) for (let b = a + 1; b < 14; b++) e.push([a, b])
  e.push([14, 15], [15, 16], [3, 14])
  return e
}

describe('Power Graph', () => {
  it('compresses planted bicliques and cliques and the expansion restores every original edge', () => {
    const E = planted()
    const pg = powerGraph(17, E)
    expect(pg.original).toBe(E.length)
    expect(pg.compressed).toBeLessThan(pg.original / 3)
    expect(expandPowerGraph(pg)).toEqual(uniqueEdges(E).sort((p, q) => p[0] - q[0] || p[1] - q[1]))
  })
  it('recovers the planted groups', () => {
    const pg = powerGraph(17, planted())
    const sets = pg.groups.map((g) => g.members.join(','))
    expect(sets).toContain('0,1,2,3')
    expect(sets).toContain('4,5,6,7,8')
    expect(pg.groups.find((g) => g.clique)!.members).toEqual([9, 10, 11, 12, 13])
  })
  it('power nodes are disjoint', () => {
    const pg = powerGraph(17, planted())
    const all = pg.groups.flatMap((g) => g.members)
    expect(new Set(all).size).toBe(all.length)
  })
  it('a graph without dense parts is left as ordinary edges', () => {
    const path: Edge[] = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]
    const pg = powerGraph(6, path)
    expect(pg.groups).toHaveLength(0)
    expect(pg.residual).toHaveLength(5)
  })
  it('a higher minimum gain never compresses more', () => {
    const E = planted()
    expect(powerGraph(17, E, 12).compressed).toBeGreaterThanOrEqual(powerGraph(17, E, 3).compressed)
    expect(expandPowerGraph(powerGraph(17, E, 12))).toEqual(expandPowerGraph(powerGraph(17, E, 3)))
  })
})

describe('Confluent Drawing', () => {
  const P: Pt[] = Array.from({ length: 17 }, (_, i) => [(i % 6) * 60, Math.floor(i / 6) * 60] as Pt)
  it('tracks stand for exactly the edges of the decomposed bicliques and cliques', () => {
    const E = planted()
    const pg = powerGraph(17, E)
    const tracks = confluentTracks(pg, P)
    const covered = expandTracks(tracks)
    const residual = new Set(pg.residual.map((e) => e.join()))
    const expected = uniqueEdges(E).filter((e) => !residual.has(e.join())).sort((p, q) => p[0] - q[0] || p[1] - q[1])
    expect(covered).toEqual(expected)
  })
  it('the track curve ends at the junction', () => {
    const d = trackCurve([0, 0], [100, 0], [1, 0])
    expect(d.startsWith('M0,0C')).toBe(true)
    expect(d.endsWith('100,0')).toBe(true)
  })
})

describe('NodeTrix blocks', () => {
  it('orders hubs first', () => {
    expect(orderBlock([0, 1, 2, 3], [[0, 1], [0, 2], [0, 3], [1, 2]])[0]).toBe(0)
  })
  it('places blocks without overlap', () => {
    const sizes = [60, 90, 40, 70]
    const w = [[0, 5, 0, 0], [5, 0, 2, 0], [0, 2, 0, 3], [0, 0, 3, 0]]
    const pos = blockLayout(sizes, w, 800, 500)
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
      const d = Math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1])
      expect(d).toBeGreaterThan((sizes[a] + sizes[b]) / 2)
    }
  })
  it('attaches a link on the facing side at the node row', () => {
    const b = { x: 100, y: 100, size: 80 }
    expect(attachPoint(b, 0, 4, [300, 100])).toEqual([140, 70])
    expect(attachPoint(b, 3, 4, [300, 100])).toEqual([140, 130])
    expect(attachPoint(b, 1, 4, [100, 300])).toEqual([90, 140])
  })
})

describe('group layout', () => {
  it('places every node, keeps members inside their disc and discs apart', async () => {
    const { groupLayout } = await import('./graph8')
    const E = planted()
    const pg = powerGraph(17, E)
    const lay = groupLayout(17, pg, 900, 600)
    expect(lay.pos.every((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]))).toBe(true)
    pg.groups.forEach((g, gi) => g.members.forEach((m) => expect(Math.hypot(lay.pos[m][0] - lay.discs[gi].x, lay.pos[m][1] - lay.discs[gi].y)).toBeLessThanOrEqual(lay.discs[gi].r)))
    for (let a = 0; a < lay.discs.length; a++) for (let b = a + 1; b < lay.discs.length; b++) {
      expect(Math.hypot(lay.discs[a].x - lay.discs[b].x, lay.discs[a].y - lay.discs[b].y)).toBeGreaterThan((lay.discs[a].r + lay.discs[b].r) * 0.95)
    }
  })
})
