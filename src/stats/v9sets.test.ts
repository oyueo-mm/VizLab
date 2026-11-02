import { describe, expect, it } from 'vitest'
import { createRng } from '../lib/random'
import { crystalPreset, crystalResult, gridNeighbours, infoCrystal, metroSets, mosaicSets, octDirection, octilinearRoute } from './sets9'

function randomSets(nSets: number, n: number, seed: number): boolean[][] {
  const r = createRng(seed)
  return Array.from({ length: nSets }, () => Array.from({ length: n }, () => r() < 0.35))
}

describe('MetroSets', () => {
  const member = randomSets(4, 24, 3)
  const m = metroSets(member, 24, { share: 0.2, seed: 5 })
  it('each line visits exactly the items of its set, once', () => {
    member.forEach((set, s) => {
      const want = set.map((v, i) => (v ? i : -1)).filter((i) => i >= 0).sort((a, b) => a - b)
      expect([...m.lines[s]].sort((a, b) => a - b)).toEqual(want)
    })
  })
  it('a station exists exactly for the items that belong to a set; transfers are the multi-set items', () => {
    for (let i = 0; i < 24; i++) expect(m.pos[i] != null).toBe(member.some((s) => s[i]))
    const multi = [...Array(24).keys()].filter((i) => member.filter((s) => s[i]).length >= 2)
    expect([...m.transfers].sort((a, b) => a - b)).toEqual(multi)
  })
  it('stations occupy distinct grid cells and every route segment is octilinear', () => {
    const cells = m.pos.filter(Boolean).map((p) => p!.join())
    expect(new Set(cells).size).toBe(cells.length)
    for (const e of m.edges) for (let k = 0; k < e.pts.length - 1; k++) expect(octDirection(e.pts[k], e.pts[k + 1])).toBeGreaterThanOrEqual(0)
  })
  it('routes end on the stations and use at most one bend', () => {
    for (const e of m.edges) {
      expect(e.pts[0]).toEqual(m.pos[e.a]); expect(e.pts[e.pts.length - 1]).toEqual(m.pos[e.b]); expect(e.pts.length).toBeLessThanOrEqual(3)
    }
    expect(octilinearRoute([0, 0], [5, 2], true)).toEqual([[0, 0], [2, 2], [5, 2]])
    expect(octilinearRoute([0, 0], [5, 2], false)).toEqual([[0, 0], [3, 0], [5, 2]])
  })
  it('lowering the sharing weight never uses more distinct support edges', () => {
    const lo = metroSets(member, 24, { share: 0.05, seed: 5 }), hi = metroSets(member, 24, { share: 1, seed: 5 })
    expect(lo.edges.length).toBeLessThanOrEqual(hi.edges.length)
  })
})

describe('MosaicSets', () => {
  const member = randomSets(4, 30, 11)
  for (const kind of ['square', 'hex'] as const) {
    it(`${kind}: every item gets its own cell and membership is untouched`, () => {
      const l = mosaicSets(member, 30, kind, 1)
      expect(new Set(l.cellOf).size).toBe(30)
      l.cellOf.forEach((c, i) => expect(l.itemAt[c]).toBe(i))
      expect(l.cols * l.rows).toBeGreaterThanOrEqual(30)
    })
    it(`${kind}: optimisation does not worsen the starting layout`, () => {
      const l = mosaicSets(member, 30, kind, 1)
      expect(l.cost).toBeLessThanOrEqual(l.initialCost + 1e-9)
    })
  }
  it('a nested (laminar) set system can be made contiguous', () => {
    const items = 16
    const nested = [Array.from({ length: items }, (_, i) => i < 8), Array.from({ length: items }, (_, i) => i < 4), Array.from({ length: items }, (_, i) => i >= 8 && i < 12), Array.from({ length: items }, () => true)]
    const l = mosaicSets(nested, items, 'square', 2, 8000)
    expect(l.components).toEqual([1, 1, 1, 1])
  })
  it('hex neighbours are symmetric and numbered six inside the grid', () => {
    const cols = 6, rows = 6
    for (let c = 0; c < cols * rows; c++) for (const n of gridNeighbours('hex', cols, rows, c)) expect(gridNeighbours('hex', cols, rows, n)).toContain(c)
    expect(gridNeighbours('hex', cols, rows, 2 * cols + 2).length).toBe(6)
    expect(gridNeighbours('square', cols, rows, 2 * cols + 2).length).toBe(4)
  })
})

describe('InfoCrystal', () => {
  // three criteria over 6 documents
  const match = [[true, true, false, false, true, false], [false, true, true, false, true, false], [false, false, true, true, false, false]]
  const c = infoCrystal(match, 6)
  it('counts every combination exactly and keeps documents that match nothing outside', () => {
    expect(c.icons.length).toBe(7)
    const by = (mask: number) => c.icons.find((i) => i.mask === mask)!.count
    expect(by(0b001)).toBe(1) // A only: doc0
    expect(by(0b011)).toBe(2) // A&B not C: docs 1, 4
    expect(by(0b110)).toBe(1) // B&C not A: doc 2
    expect(by(0b100)).toBe(1) // C only: doc3
    expect(c.outside).toEqual([5])
    expect(c.icons.reduce((a, i) => a + i.count, 0) + c.outside.length).toBe(6)
  })
  it('AND / OR presets give the Boolean results', () => {
    const k = 3
    expect(crystalResult(c.icons, crystalPreset(k, 'and'))).toEqual([])
    expect(crystalResult(c.icons, crystalPreset(k, 'or'))).toEqual([0, 1, 2, 3, 4])
    expect(crystalResult(c.icons, crystalPreset(k, 'one'))).toEqual([0, 3])
    expect(crystalResult(c.icons, crystalPreset(k, 'multi'))).toEqual([1, 2, 4])
  })
  it('the more criteria an icon combines, the nearer the centre; icons never coincide (k=4)', () => {
    const m4 = Array.from({ length: 4 }, () => [true, false])
    const c4 = infoCrystal(m4, 2)
    const rad = (d: number) => c4.icons.filter((i) => i.degree === d).map((i) => Math.hypot(i.x, i.y))
    expect(Math.max(...rad(2))).toBeLessThan(Math.min(...rad(1)))
    expect(Math.max(...rad(3))).toBeLessThan(Math.min(...rad(2)) + 1e-9)
    const keys = c4.icons.map((i) => `${i.x.toFixed(3)},${i.y.toFixed(3)}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
