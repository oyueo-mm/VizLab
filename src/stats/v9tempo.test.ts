import { describe, expect, it } from 'vitest'
import { generateDataset } from '../data/datasets'
import { toNumber } from '../data/table'
import { dustStep, dustTarget, gosperCurve, gosperMap, gosperLevelFor, normalizeColumns, type GNode, type Magnet, type Pt } from './multi9'
import { braid, paoh, setStreams, type EventRecord, type HyperEdge, type MembershipRecord } from './tempo9'

describe('PAOHvis', () => {
  const edges: HyperEdge[] = [
    { time: 1, id: 'a', members: ['A', 'B', 'C'] },
    { time: 1, id: 'b', members: ['C', 'B', 'A'] }, // same membership: aggregated with 'a'
    { time: 2, id: 'c', members: ['A', 'D'] },
    { time: 3, id: 'd', members: ['B', 'C', 'D'] },
  ]
  it('keeps every hyperedge membership and merges identical memberships in a time slot', () => {
    const l = paoh(edges, 'first')
    expect(l.columns.length).toBe(3)
    const c1 = l.columns.find((c) => c.time === 1)!
    expect(c1.count).toBe(2)
    expect(c1.ids.sort()).toEqual(['a', 'b'])
    expect(c1.rows.map((r) => l.nodes[r]).sort()).toEqual(['A', 'B', 'C'])
    expect(l.columns.find((c) => c.time === 3)!.rows.map((r) => l.nodes[r]).sort()).toEqual(['B', 'C', 'D'])
  })
  it('time filter keeps only edges in range', () => {
    const l = paoh(edges, 'first', [2, 3])
    expect(l.times).toEqual([2, 3])
    expect(l.nodes.sort()).toEqual(['A', 'B', 'C', 'D'])
    expect(l.columns.length).toBe(2)
  })
  it('barycentre ordering shortens hyperedge lines compared with an interleaved start order', () => {
    // two teams whose members alternate in first-appearance order
    const mk = (id: string, members: string[], time: number): HyperEdge => ({ id, members, time })
    const e: HyperEdge[] = [mk('0', ['x1', 'y1', 'x2', 'y2', 'x3', 'y3'].slice(0, 6), 0), mk('1', ['x1', 'x2', 'x3'], 1), mk('2', ['y1', 'y2', 'y3'], 1), mk('3', ['x1', 'x2'], 2), mk('4', ['y2', 'y3'], 2)]
    const a = paoh(e, 'first'), b = paoh(e, 'barycenter')
    expect(b.span).toBeLessThan(a.span)
  })
})

describe('Set Streams', () => {
  const rec: MembershipRecord[] = [
    { item: 'u1', time: 1, set: 'M' }, { item: 'u1', time: 2, set: 'M' }, { item: 'u1', time: 2, set: 'V' }, { item: 'u1', time: 3, set: 'V' },
    { item: 'u2', time: 1, set: 'V' }, { item: 'u2', time: 3, set: 'V' },
    { item: 'u3', time: 1, set: 'M' }, { item: 'u3', time: 2, set: 'M' }, { item: 'u3', time: 3, set: 'M' },
  ]
  const m = setStreams(rec)
  it('every item is in exactly one combination at every time and counts sum to the item count', () => {
    for (let t = 0; t < m.times.length; t++) expect(m.counts.reduce((a, c) => a + c[t], 0)).toBe(3)
    expect(m.at.length).toBe(3)
  })
  it('flows conserve items: out of a combination = its count at t, into one = its count at t+1', () => {
    m.flows.forEach((fl, t) => {
      m.combos.forEach((_, c) => {
        expect(fl.filter((f) => f.from === c).reduce((a, f) => a + f.n, 0)).toBe(m.counts[c][t])
        expect(fl.filter((f) => f.to === c).reduce((a, f) => a + f.n, 0)).toBe(m.counts[c][t + 1])
      })
      expect(fl.reduce((a, f) => a + f.n, 0)).toBe(3)
    })
  })
  it('follows the same item between different set combinations', () => {
    const name = (c: number) => m.combos[c].sets.map((s) => m.setNames[s]).sort().join('+') || '없음'
    const i = m.items.indexOf('u1')
    expect(m.at[i].map(name)).toEqual(['M', 'M+V', 'V'])
    expect(m.at[m.items.indexOf('u2')].map(name)).toEqual(['V', '없음', 'V'])
  })
  it('time range limits the columns', () => {
    const r = setStreams(rec, [2, 3])
    expect(r.times).toEqual([2, 3])
    expect(r.flows.length).toBe(1)
  })
  it('works on the bundled dataset: flows conserve at every step', () => {
    const t = generateDataset('membership-history', 7, 40)
    const records: MembershipRecord[] = t.rows.map((r) => ({ item: String(r[0]), time: toNumber(r[1]) ?? 0, set: String(r[2]) }))
    const s = setStreams(records)
    s.flows.forEach((fl) => expect(fl.reduce((a, f) => a + f.n, 0)).toBe(s.items.length))
    s.combos.forEach((_, c) => s.flows.forEach((fl, ti) => expect(fl.filter((f) => f.to === c).reduce((a, f) => a + f.n, 0)).toBe(s.counts[c][ti + 1])))
  })
})

describe('Sequence Braiding', () => {
  const mk = (entity: string, group: string, events: string[]): EventRecord[] => events.map((event, order) => ({ entity, order, event, group }))
  const recs = [
    ...mk('p1', 'young', ['접수', '검사', '진단', '치료']),
    ...mk('p2', 'young', ['접수', '검사', '검사', '진단', '치료']), // repeated event
    ...mk('p3', 'old', ['접수', '진단', '치료', '재입원']), // missing event (검사)
    ...mk('p4', 'old', ['접수', '검사', '진단', '치료', '재입원']),
  ]
  const b = braid(recs)
  const typeAt = (si: number) => b.strands[si].path.map((n) => b.nodes[n].type)
  it('every strand keeps the order of its events (repeats collapsed and counted)', () => {
    expect(typeAt(0)).toEqual(['접수', '검사', '진단', '치료'])
    expect(typeAt(1)).toEqual(['접수', '검사', '진단', '치료'])
    expect(b.strands[1].reps).toEqual([1, 2, 1, 1])
    expect(typeAt(2)).toEqual(['접수', '진단', '치료', '재입원'])
  })
  it('forward transitions go to later layers; node visits add up', () => {
    const L = (t: string) => b.nodes.find((n) => n.type === t)!.layer
    expect(L('접수')).toBeLessThan(L('검사')); expect(L('검사')).toBeLessThan(L('진단')); expect(L('진단')).toBeLessThan(L('치료')); expect(L('치료')).toBeLessThan(L('재입원'))
    expect(b.nodes.find((n) => n.type === '접수')!.visits).toBe(4)
    expect(b.nodes.find((n) => n.type === '검사')!.visits).toBe(3)
    expect(b.nodes.find((n) => n.type === '검사')!.repeats).toBe(1)
    expect(b.nodes.reduce((a, n) => a + n.visits, 0)).toBe(b.strands.reduce((a, s) => a + s.path.length, 0))
  })
  it('slots list every strand visit once; grouped sorting keeps attribute groups together', () => {
    b.nodes.forEach((n, i) => expect(b.slots[i].length).toBe(n.visits))
    const g = braid(recs, 'group')
    const first = g.slots[g.nodes.findIndex((n) => n.type === '접수')].map(([s]) => g.strands[s].group)
    expect(first).toEqual(['old', 'old', 'young', 'young'])
  })
  it('sorting by path never has more crossings than sorting by entity order on the bundled data', () => {
    const t = generateDataset('care-braids', 7, 60)
    const r: EventRecord[] = t.rows.map((row) => ({ entity: String(row[0]), order: toNumber(row[1]) ?? 0, event: String(row[2]), group: String(row[3]) }))
    expect(braid(r, 'path').crossings).toBeLessThanOrEqual(braid(r, 'entity').crossings)
  })
})

describe('Dust & Magnet', () => {
  const magnets: Magnet[] = [{ x: 0, y: 0, strength: 1, on: true }, { x: 10, y: 0, strength: 1, on: true }, { x: 5, y: 8, strength: 1, on: true }]
  it('a particle rests at the value-weighted centre of the magnets', () => {
    expect(dustTarget([1, 0, 0], magnets)).toEqual([0, 0])
    expect(dustTarget([1, 1, 0], magnets)).toEqual([5, 0])
    const p = dustTarget([0.2, 0.6, 0.2], magnets)!
    expect(p[0]).toBeCloseTo((0.2 * 0 + 0.6 * 10 + 0.2 * 5) / 1, 6)
    expect(p[1]).toBeCloseTo((0.2 * 8) / 1, 6)
  })
  it('moving a magnet moves the particles with a high value for it, in proportion to the value', () => {
    const before = dustTarget([0.9, 0.3, 0.3], magnets)!, before2 = dustTarget([0.1, 0.3, 0.3], magnets)!
    const moved = magnets.map((m, j) => (j === 0 ? { ...m, x: -6 } : m))
    const after = dustTarget([0.9, 0.3, 0.3], moved)!, after2 = dustTarget([0.1, 0.3, 0.3], moved)!
    expect(before[0] - after[0]).toBeGreaterThan(before2[0] - after2[0])
    expect(before[0] - after[0]).toBeGreaterThan(0)
  })
  it('switching a magnet off or giving it zero strength removes its pull; no pull means no resting position', () => {
    const off = magnets.map((m, j) => (j === 1 ? { ...m, on: false } : m))
    expect(dustTarget([0, 1, 0], off)).toBeNull()
    expect(dustTarget([0.5, 0.5, 0], off)).toEqual([0, 0])
    const strong = magnets.map((m, j) => (j === 1 ? { ...m, strength: 3 } : m))
    expect(dustTarget([0.5, 0.5, 0], strong)![0]).toBeGreaterThan(dustTarget([0.5, 0.5, 0], magnets)![0])
  })
  it('relaxation converges to the resting positions', () => {
    const vals = normalizeColumns([[1, 5, 2], [3, 1, 9], [7, 7, 1], [2, 2, 2]])
    const pos: Pt[] = vals.map(() => [5, 3])
    let m = 1
    for (let i = 0; i < 200 && m > 1e-9; i++) m = dustStep(pos, vals, magnets, 0.3, 0)
    expect(m).toBeLessThan(1e-6)
    vals.forEach((v, i) => { const t = dustTarget(v, magnets)!; expect(pos[i][0]).toBeCloseTo(t[0], 3); expect(pos[i][1]).toBeCloseTo(t[1], 3) })
  })
  it('spreading pushes overlapping particles apart', () => {
    const pos: Pt[] = [[1, 1], [1.05, 1]]
    dustStep(pos, [[0, 0, 0], [0, 0, 0]], magnets, 0.3, 0.5)
    expect(Math.hypot(pos[0][0] - pos[1][0], pos[0][1] - pos[1][1])).toBeGreaterThan(0.05)
  })
})

describe('GosperMap', () => {
  it('the Gosper curve has 7^n steps of unit length on distinct lattice points', () => {
    for (const n of [1, 2, 3]) {
      const c = gosperCurve(n)
      expect(c.length).toBe(7 ** n + 1)
      for (let i = 0; i < c.length - 1; i++) expect(Math.hypot(c[i + 1][0] - c[i][0], c[i + 1][1] - c[i][1])).toBeCloseTo(1, 6)
      expect(new Set(c.map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`)).size).toBe(c.length)
    }
  })
  const tree: GNode = { name: '전체', children: [
    { name: 'A', children: [{ name: 'a1', value: 30 }, { name: 'a2', value: 10 }, { name: 'a3', value: 5 }] },
    { name: 'B', children: [{ name: 'b1', value: 20 }, { name: 'b2', value: 20 }] },
    { name: 'C', value: 15 },
  ] }
  const g = gosperMap(tree, 3)
  it('cells are allocated to leaves in proportion to their values, every leaf gets cells', () => {
    expect(g.cells.length).toBe(343)
    expect(g.leafOf.length).toBe(343)
    const counts = g.leaves.map((l) => l.end - l.start)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(343)
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(1)
    expect(counts[0] / counts[1]).toBeGreaterThan(2.6); expect(counts[0] / counts[1]).toBeLessThan(3.4)
  })
  it('every node of the hierarchy owns a connected set of cells (contiguous run along the curve)', () => {
    const adj = (a: Pt, b: Pt) => Math.abs(Math.hypot(a[0] - b[0], a[1] - b[1]) - 1) < 1e-6
    const prefixes = [['A'], ['B'], ['C'], ['A', 'a1'], ['B', 'b2']]
    for (const pre of prefixes) {
      const idx = g.leafOf.map((li, c) => (pre.every((p, k) => g.leaves[li].path[k] === p) ? c : -1)).filter((c) => c >= 0)
      expect(idx.length).toBeGreaterThan(0)
      const seen = new Set([idx[0]]); const stack = [idx[0]]
      while (stack.length) { const c = stack.pop()!; for (const o of idx) if (!seen.has(o) && adj(g.cells[c], g.cells[o])) { seen.add(o); stack.push(o) } }
      expect(seen.size).toBe(idx.length)
    }
  })
  it('level selection gives each leaf a few cells', () => {
    expect(7 ** gosperLevelFor(8)).toBeGreaterThanOrEqual(32)
    expect(gosperLevelFor(100)).toBeGreaterThanOrEqual(3)
  })
})
