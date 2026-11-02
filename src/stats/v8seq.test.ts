import { describe, expect, it } from 'vitest'
import { arcLength, arcOrder, pivotGraph, substrateLayout, type DynEdge } from './relate8'
import { arcPoint, parallelTags, phraseNet, textArc } from './text8'
import { assignLanes, flowstrates, lifeFlow, lifeFlowLayout, matchesPattern, type Seq } from './tempo8'

describe('Semantic Substrates', () => {
  const nodes = [
    { id: 'a', sub: 'X', x: 0, y: 0 }, { id: 'b', sub: 'X', x: 10, y: 5 }, { id: 'c', sub: 'Y', x: 3, y: 9 }, { id: 'd', sub: 'Y', x: null, y: 2 },
  ]
  it('puts every node inside its region and keeps the attribute order', () => {
    const lay = substrateLayout(nodes, 400, 300, { direction: 'rows', perRegion: false })
    for (const n of nodes) {
      const r = lay.regions.find((r) => r.sub === n.sub)!
      const [x, y] = lay.pos.get(n.id)!
      expect(x).toBeGreaterThanOrEqual(r.x0); expect(x).toBeLessThanOrEqual(r.x1)
      expect(y).toBeGreaterThanOrEqual(r.y0); expect(y).toBeLessThanOrEqual(r.y1)
    }
    expect(lay.pos.get('a')![0]).toBeLessThan(lay.pos.get('b')![0])
    // larger y attribute is higher on screen (smaller pixel y)
    expect(lay.pos.get('b')![1]).toBeLessThan(lay.pos.get('a')![1])
  })
  it('regions do not overlap and a missing value sits in the middle of the axis', () => {
    const lay = substrateLayout(nodes, 400, 300, { direction: 'rows', perRegion: false })
    expect(lay.regions[0].y1).toBeLessThanOrEqual(lay.regions[1].y0)
    const r = lay.regions[1]
    expect(lay.pos.get('d')![0]).toBeCloseTo((r.x0 + r.x1) / 2, 6)
  })
  it('per-region scaling stretches each region to its own range', () => {
    const lay = substrateLayout(nodes, 400, 300, { direction: 'columns', perRegion: true, pad: 10 })
    const r = lay.regions[0]
    expect(lay.pos.get('a')![0]).toBeCloseTo(r.x0 + 10, 6)
    expect(lay.pos.get('b')![0]).toBeCloseTo(r.x1 - 10, 6)
  })
})

describe('PivotGraph', () => {
  const nodes = [{ col: 'A', row: 'p' }, { col: 'A', row: 'p' }, { col: 'A', row: 'q' }, { col: 'B', row: 'q' }]
  const edges: [number, number][] = [[0, 1], [0, 2], [1, 2], [2, 3], [3, 0]]
  it('keeps node and edge totals', () => {
    const p = pivotGraph(nodes, edges, { directed: false, sort: 'name' })
    expect(p.cells.reduce((s, c) => s + c.count, 0)).toBe(4)
    expect(p.links.reduce((s, l) => s + l.count, 0)).toBe(5)
    expect(p.cols).toEqual(['A', 'B']); expect(p.rows).toEqual(['p', 'q'])
  })
  it('aggregates by cell and separates directions when directed', () => {
    const und = pivotGraph(nodes, edges, { directed: false, sort: 'name' })
    const dir = pivotGraph(nodes, edges, { directed: true, sort: 'name' })
    expect(dir.links.length).toBeGreaterThanOrEqual(und.links.length)
    // the two edges between cell (A,q) and cell (B,q)... (2→3 and 3→0) are different cell pairs; (0,1),(0,2),(1,2) share cells
    const self = und.links.find((l) => l.a === l.b)
    expect(self!.count).toBe(1)
  })
  it('sorts axes by node count when asked', () => {
    const p = pivotGraph([{ col: 'x', row: 'a' }, { col: 'y', row: 'a' }, { col: 'y', row: 'a' }], [], { directed: false, sort: 'count' })
    expect(p.cols).toEqual(['y', 'x'])
  })
})

describe('TimeArcs order', () => {
  const E: DynEdge[] = []
  // two tight groups {0,1,2} and {3,4,5} with one weak bridge, nodes numbered so that the identity order mixes them
  const grp = [[0, 2, 4], [1, 3, 5]]
  grp.forEach((g, gi) => { for (let t = 0; t < 4; t++) for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) E.push({ t, a: g[i], b: g[j], w: 3 }); void gi })
  E.push({ t: 5, a: 4, b: 1, w: 0.5 })
  it('shortens the arcs compared with the first-appearance order and groups the clusters', () => {
    const order = arcOrder(6, E)
    expect([...order].sort()).toEqual([0, 1, 2, 3, 4, 5])
    expect(arcLength(order, E)).toBeLessThanOrEqual(arcLength([0, 1, 2, 3, 4, 5], E))
    const pos = new Map(order.map((v, i) => [v, i]))
    const spread = (g: number[]) => Math.max(...g.map((v) => pos.get(v)!)) - Math.min(...g.map((v) => pos.get(v)!))
    expect(spread([0, 2, 4])).toBe(2); expect(spread([1, 3, 5])).toBe(2)
  })
})

describe('LifeFlow', () => {
  const S = (id: string, ev: [string, number][]): Seq => ({ id, events: ev.map(([type, t]) => ({ type, t })) })
  const seqs = [
    S('1', [['접수', 0], ['검사', 2], ['치료', 5]]), S('2', [['접수', 0], ['검사', 4], ['치료', 9]]), S('3', [['접수', 1], ['검사', 3]]),
    S('4', [['접수', 0], ['치료', 7]]), S('5', [['검사', 0], ['치료', 2]]),
  ]
  const nodes = lifeFlow(seqs)
  it('conserves counts: a node count equals its children plus the records that end there', () => {
    for (const n of nodes) expect(n.count).toBe(n.children.reduce((s, c) => s + nodes[c].count, 0) + n.ended)
    expect(nodes[0].count).toBe(5)
  })
  it('merges equal prefixes and averages the gap to the previous event', () => {
    const first = nodes[nodes[0].children.find((c) => nodes[c].type === '접수')!]
    expect(first.count).toBe(4)
    const check = nodes[first.children.find((c) => nodes[c].type === '검사')!]
    expect(check.count).toBe(3)
    expect(check.meanGap).toBeCloseTo((2 + 4 + 2) / 3, 9)
  })
  it('searches ordered patterns', () => {
    expect(seqs.filter((s) => matchesPattern(s, ['접수', '치료'])).map((s) => s.id)).toEqual(['1', '2', '4'])
    expect(matchesPattern(seqs[4], ['치료', '검사'])).toBe(false)
    expect(matchesPattern(seqs[0], [])).toBe(true)
  })
  it('lays out bands whose heights are proportional to the counts and that do not overlap vertically among leaves', () => {
    const lay = lifeFlowLayout(nodes, 800, 400)
    const u = (lay[1].y1 - lay[1].y0) / nodes[1].count
    for (const n of nodes) if (n.id && !n.children.length) expect(lay[n.id].y1 - lay[n.id].y0).toBeCloseTo(n.count * u, 6)
    for (const n of nodes) if (n.id) expect(lay[n.id].x0).toBeGreaterThanOrEqual(lay[n.parent].x0)
  })
})

describe('Flowstrates', () => {
  const pos = new Map<string, [number, number]>([['A', [0, 10]], ['B', [0, 50]], ['X', [100, 30]], ['Y', [100, 80]]])
  const rows = [
    { o: 'A', d: 'X', t: 1, v: 5 }, { o: 'A', d: 'X', t: 2, v: 7 }, { o: 'B', d: 'Y', t: 1, v: 1 }, { o: 'B', d: 'X', t: 2, v: 9 }, { o: 'A', d: 'X', t: 2, v: 1 },
  ]
  it('builds one row per pair with the series over time and keeps the total', () => {
    const f = flowstrates(rows, 'origin', pos)
    expect(f.times).toEqual([1, 2])
    expect(f.links).toHaveLength(3)
    expect(f.links.reduce((s, l) => s + l.total, 0)).toBe(23)
    expect(f.links.find((l) => l.o === 'A')!.series).toEqual([5, 8])
    expect(f.max).toBe(9)
  })
  it('orders rows by origin position, destination position or total', () => {
    expect(flowstrates(rows, 'origin', pos).links.map((l) => `${l.o}${l.d}`)).toEqual(['AX', 'BX', 'BY'])
    expect(flowstrates(rows, 'dest', pos).links.map((l) => `${l.o}${l.d}`)).toEqual(['AX', 'BX', 'BY'])
    expect(flowstrates(rows, 'total', pos).links[0].total).toBe(13)
  })
})

describe('TimeSets lanes', () => {
  it('uses another lane only when labels would overlap', () => {
    const r = assignLanes([0, 5, 100, 102], [20, 20, 20, 20], 4)
    expect(r.lane).toEqual([0, 1, 0, 1])
    expect(r.lanes).toBe(2)
    expect(assignLanes([0, 50, 100], [20, 20, 20], 4).lanes).toBe(1)
  })
})

describe('TextArc', () => {
  const S = ['시각화는 데이터를 보여줍니다', '지도는 위치를 보여줍니다', '네트워크는 관계를 보여줍니다', '시각화는 관계를 설명합니다']
  it('puts a word at the centroid of its occurrences when relaxation is off', () => {
    const w = textArc(S, { minCount: 2, maxWords: 20, relax: 0 })
    const word = w.find((x) => x.word === '시각화')!
    const pts = word.occ.map((i) => arcPoint(i, S.length))
    expect(word.x).toBeCloseTo((pts[0][0] + pts[1][0]) / 2, 9)
    expect(word.y).toBeCloseTo((pts[0][1] + pts[1][1]) / 2, 9)
    expect(word.count).toBe(2)
  })
  it('keeps only words that occur often enough and stays inside the circle', () => {
    const w = textArc(S, { minCount: 2, maxWords: 20, relax: 40 })
    expect(w.every((x) => x.count >= 2)).toBe(true)
    expect(w.every((x) => Math.hypot(x.x, x.y) <= 1)).toBe(true)
  })
  it('places sentences clockwise from 12 o\'clock', () => {
    expect(arcPoint(0, 4)[1]).toBeCloseTo(-1, 9)
    expect(arcPoint(1, 4)[0]).toBeCloseTo(1, 9)
  })
})

describe('Parallel Tag Clouds', () => {
  const groups = [{ name: 'A', texts: ['지도는 위치를 보여줍니다', '지도는 면적을 왜곡합니다'] }, { name: 'B', texts: ['네트워크는 관계를 보여줍니다', '지도는 관계를 설명합니다'] }]
  it('ranks by frequency and links a word that appears in adjacent columns', () => {
    const r = parallelTags(groups, { top: 5, metric: 'count' })
    expect(r.columns[0].words[0].word).toBe('지도')
    expect(r.links.some((l) => l.word === '지도')).toBe(true)
  })
  it('distinct scoring puts words that are specific to a group above shared words', () => {
    const r = parallelTags(groups, { top: 5, metric: 'distinct' })
    const a = r.columns[0].words
    const shared = a.find((w) => w.word === '지도')!
    const own = a.find((w) => w.word === '면적')!
    expect(own.score / own.count).toBeGreaterThan(shared.score / shared.count)
  })
})

describe('Phrase Net', () => {
  const S = ['막대와 선은 비교에 쓰입니다', '막대와 선을 함께 씁니다', '지도와 표를 쓴다', '데이터의 관계를 본다', '데이터의 관계는 중요합니다']
  it('counts pairs matching the "X와/과 Y" pattern', () => {
    const r = phraseNet(S, 'and', { minCount: 1 })
    expect(r.edges.find((e) => e.a === '막대' && e.b === '선')!.count).toBe(2)
    expect(r.edges.find((e) => e.a === '지도')!.b).toBe('표')
  })
  it('the minimum count filters edges and other patterns find other pairs', () => {
    expect(phraseNet(S, 'and', { minCount: 2 }).edges).toHaveLength(1)
    const of = phraseNet(S, 'of', { minCount: 2 })
    expect(of.edges).toEqual([{ a: '데이터', b: '관계', count: 2 }])
  })
})
