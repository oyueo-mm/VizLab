import * as d3 from 'd3'
import { describe, expect, it } from 'vitest'
import { generateDataset } from '../../data/datasets'
import { buildTree } from '../../stats/hierarchy'
import { createRng } from '../../lib/random'
import { mean } from '../../stats/descriptive'
import { hclust, linkageTree } from '../../stats/cluster'
import { bumpModel, tieOffsets } from './bump'
import { dayValues } from './calendar'
import { placeTree } from './dendrogram'
import { pairRows, sortPairs } from './dumbbell'
import { makeRoot, resolvePath } from './hierShared'
import { packGeometry } from './pack'
import { qqLine, qqPoints } from './qq'
import { ridgeGeometry } from './ridgeline'
import { spreadLabels } from './slope'
import { sunburstGeometry } from './sunburst'
import { swarmOffsets } from './beeswarm'
import { cellPosition } from './waffle'
import { waterfallSteps } from './waterfall'
import { orderSeries } from './layers'

describe('Q-Q plot', () => {
  it('pairs sorted sample values with increasing theoretical quantiles', () => {
    const pts = qqPoints([5, 1, 3, 2, 4], [0, 1, 2, 3, 4], 'normal', 3 / 8)
    expect(pts.map((p) => p.sample)).toEqual([1, 2, 3, 4, 5])
    expect(pts.map((p) => p.row)).toEqual([1, 3, 2, 4, 0])
    expect(pts[2].theory).toBeCloseTo(0, 9)
    expect(pts[0].theory).toBeCloseTo(-pts[4].theory, 9)
    expect(pts[0].theory).toBeCloseTo(-1.1800, 2)
    for (let i = 1; i < pts.length; i++) expect(pts[i].theory).toBeGreaterThan(pts[i - 1].theory)
  })

  it('recovers location and scale of a normal sample on the reference line', () => {
    const r = createRng(8)
    const values = Array.from({ length: 2000 }, () => r.normal(50, 10))
    const pts = qqPoints(values, values.map((_, i) => i), 'normal', 0.5)
    const robust = qqLine(pts, 'normal', 'robust')!
    const fit = qqLine(pts, 'normal', 'fit')!
    for (const l of [robust, fit]) { expect(l.intercept).toBeCloseTo(50, 0); expect(l.slope).toBeCloseTo(10, 0) }
  })

  it('curves away from the line for a skewed sample (convex for right skew)', () => {
    const r = createRng(2)
    const values = Array.from({ length: 800 }, () => Math.exp(r.normal(0, 0.8)))
    const pts = qqPoints(values, values.map((_, i) => i), 'normal', 0.5)
    const line = qqLine(pts, 'normal', 'robust')!
    const resid = (p: { theory: number; sample: number }) => p.sample - (line.intercept + line.slope * p.theory)
    expect(resid(pts[pts.length - 1])).toBeGreaterThan(0)
    expect(resid(pts[0])).toBeGreaterThan(0)
    expect(Math.abs(resid(pts[400]))).toBeLessThan(resid(pts[pts.length - 1]))
  })

  it('works against the exponential and uniform references', () => {
    const r = createRng(4)
    const exp = Array.from({ length: 1500 }, () => -Math.log(1 - r()) * 3)
    const line = qqLine(qqPoints(exp, exp.map((_, i) => i), 'exponential', 0.5), 'exponential', 'fit')!
    expect(line.slope).toBeCloseTo(3, 0)
    expect(line.intercept).toBeCloseTo(0, 0)
    expect(qqLine([], 'normal', 'fit')).toBeNull()
  })
})

describe('swarm layout', () => {
  it('adds the gap to the collision distance', () => {
    const ys = Array.from({ length: 40 }, () => 100)
    const off = swarmOffsets(ys, 3, 2, 200, false)
    for (let i = 0; i < ys.length; i++) for (let j = i + 1; j < ys.length; j++) expect(Math.abs(off[i] - off[j])).toBeGreaterThanOrEqual(8 - 1e-6)
  })
})

describe('bump chart ranks', () => {
  it('ranks every time point separately and handles ties', () => {
    const pts = [
      { x: 1, y: 10, group: 'a' }, { x: 1, y: 20, group: 'b' }, { x: 1, y: 20, group: 'c' },
      { x: 2, y: 5, group: 'a' }, { x: 2, y: 1, group: 'b' }, { x: 2, y: 7, group: 'c' },
    ]
    const m = bumpModel(pts, 'min', 'high')
    expect(m.keys).toEqual(['a', 'b', 'c'])
    expect(m.times).toEqual([1, 2])
    expect(m.ranks).toEqual([[3, 2], [1, 3], [1, 1]])
    expect(bumpModel(pts, 'average', 'high').ranks[1][0]).toBe(1.5)
    expect(bumpModel(pts, 'min', 'low').ranks[0]).toEqual([1, 2])
  })

  it('every league round assigns each team a rank between 1 and 8', () => {
    const t = generateDataset('league', 7, 14)
    const pts = t.rows.map((r) => ({ x: r[0] as number, y: r[2] as number, group: r[1] as string }))
    const m = bumpModel(pts, 'min', 'high')
    expect(m.keys.length).toBe(8)
    expect(m.times.length).toBe(14)
    m.times.forEach((_, ti) => {
      const ranks = m.ranks.map((r) => r[ti]!)
      expect(Math.min(...ranks)).toBe(1)
      expect(Math.max(...ranks)).toBeLessThanOrEqual(8)
      // competition ranking: the best team's rank is 1 and every rank equals 1 + #teams with more points
      m.keys.forEach((_, ki) => expect(m.ranks[ki][ti]).toBe(1 + m.values.filter((v) => v[ti]! > m.values[ki][ti]!).length))
    })
  })

  it('skips missing observations instead of ranking them', () => {
    const m = bumpModel([{ x: 1, y: 3, group: 'a' }, { x: 1, y: 9, group: 'b' }, { x: 2, y: 4, group: 'a' }], 'min', 'high')
    expect(m.ranks).toEqual([[2, 1], [1, null]])
  })
})

describe('bump tie fan-out', () => {
  it('spreads tied series symmetrically without changing untied ones', () => {
    // time 1: all four tie at rank 1; time 2: one series alone at 1, three tie at 2; a missing value is skipped
    const off = tieOffsets([[1, 1], [1, 2], [1, 2], [1, 2]], 9, 80)
    expect(off.map((r) => r[0])).toEqual([-28.35, -9.45, 9.45, 28.35].map((v) => expect.closeTo(v, 6)))
    expect(off.map((r) => r[1])).toEqual([0, -18.9, 0, 18.9].map((v) => expect.closeTo(v, 6)))
    expect(tieOffsets([[1], [null], [2]], 9, 80)).toEqual([[0], [0], [0]])
  })

  it('never spreads a tie wider than one rank step', () => {
    const many = Array.from({ length: 8 }, () => [1])
    const off = tieOffsets(many, 9, 80).map((r) => r[0])
    expect(Math.max(...off) - Math.min(...off)).toBeLessThanOrEqual(72 + 1e-9)
  })
})

describe('dumbbell / slope data', () => {
  const t = generateDataset('before-after')
  it('reads item rows with their difference and sorts them', () => {
    const rows = pairRows(t, '팀', '작년', '올해')
    expect(rows.length).toBe(8)
    expect(rows[0]).toMatchObject({ name: '기획', a: 62, b: 71, diff: 9 })
    expect(sortPairs(rows, 'diff-desc')[0].name).toBe('고객지원')
    expect(sortPairs(rows, 'diff-asc')[0].name).toBe('디자인')
    expect(sortPairs(rows, 'start')[0].a).toBe(75)
    expect(pairRows(t, '팀', '작년', null)).toEqual([])
  })

  it('spreads colliding labels apart without reordering them', () => {
    const out = spreadLabels([100, 101, 102, 140], 15, 0, 300)
    for (let i = 1; i < out.length; i++) expect(out[i] - out[i - 1]).toBeGreaterThanOrEqual(15 - 1e-6)
    expect(out[0]).toBeLessThan(out[1])
    expect(out[3]).toBeGreaterThanOrEqual(140 - 1)
    const edge = spreadLabels([0, 1, 2], 15, 0, 300)
    expect(Math.min(...edge)).toBeGreaterThanOrEqual(0)
  })
})

describe('waterfall', () => {
  it('accumulates deltas from the start value', () => {
    const steps = waterfallSteps([{ label: 'a', delta: 10, row: 0 }, { label: 'b', delta: -4, row: 1 }, { label: 'c', delta: 2, row: 2 }], 100, '시작', true, '끝')
    expect(steps.map((s) => [s.kind, s.from, s.to])).toEqual([['start', 0, 100], ['delta', 100, 110], ['delta', 110, 106], ['delta', 106, 108], ['total', 0, 108]])
  })

  it('totals the cash-flow dataset', () => {
    const t = generateDataset('cashflow')
    const items = t.rows.map((r, row) => ({ label: r[0] as string, delta: r[1] as number, row }))
    const steps = waterfallSteps(items, 0, '', true, '순이익')
    expect(steps[steps.length - 1].to).toBe(d3.sum(items, (i) => i.delta))
    expect(steps[steps.length - 1].to).toBe(420 - 185 - 96 - 38 - 22 + 17 - 9 - 21)
    steps.slice(0, -1).forEach((s, i) => { if (i) expect(s.from).toBe(steps[i - 1].to) })
  })
})

describe('waffle grid', () => {
  it('fills cells from the bottom-left, row by row or column by column', () => {
    expect(cellPosition(0, 10, 10, 'row')).toEqual([0, 9])
    expect(cellPosition(9, 10, 10, 'row')).toEqual([9, 9])
    expect(cellPosition(10, 10, 10, 'row')).toEqual([0, 8])
    expect(cellPosition(0, 10, 10, 'column')).toEqual([0, 9])
    expect(cellPosition(10, 10, 10, 'column')).toEqual([1, 9])
    const seen = new Set(Array.from({ length: 50 }, (_, i) => cellPosition(i, 5, 10, 'row').join()))
    expect(seen.size).toBe(50)
  })
})

describe('calendar data', () => {
  it('aggregates duplicate dates and counts unreadable rows', () => {
    const t = { columns: [{ name: 'd', type: 'category' as const }, { name: 'v', type: 'number' as const }], rows: [['2024-02-29', 3], ['2024-02-29', 5], ['2023-02-29', 7], ['x', 1], ['2023-01-01', null], ['2023-01-02', 4]] }
    const sum = dayValues(t, 'd', 'v', 'sum')
    expect(sum.days.get('2024-02-29')).toEqual({ value: 8, rows: [0, 1] })
    expect(dayValues(t, 'd', 'v', 'mean').days.get('2024-02-29')!.value).toBe(4)
    expect(dayValues(t, 'd', 'v', 'max').days.get('2024-02-29')!.value).toBe(5)
    expect(sum.years).toEqual([2023, 2024])
    expect(sum.invalid).toBe(3)
    expect(sum.days.has('2023-02-29')).toBe(false)
  })

  it('reads two full years including the leap day', () => {
    const { days, years } = dayValues(generateDataset('daily', 7), '날짜', '걸음 수', 'sum')
    expect(years).toEqual([2023, 2024])
    expect([...days.keys()].filter((k) => k.startsWith('2024')).length).toBeLessThanOrEqual(366)
    expect([...days.keys()].filter((k) => k.startsWith('2023')).length).toBeLessThanOrEqual(365)
  })
})

describe('ridgeline and layers', () => {
  it('spaces the baselines evenly and leaves room for the first ridge', () => {
    const g = ridgeGeometry(5, 400, 2)
    expect(g.baseline(0)).toBeCloseTo(g.ridge, 9)
    expect(g.baseline(4)).toBeCloseTo(400, 9)
    expect(g.baseline(1) - g.baseline(0)).toBeCloseTo(g.step, 9)
    expect(g.ridge).toBeCloseTo(g.step * 2, 9)
  })

  it('orders series by a user list and keeps the rest in data order', () => {
    const s = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }]
    expect(orderSeries(s, ['c', 'a']).map((x) => x.key)).toEqual(['c', 'a', 'b', 'd'])
    expect(orderSeries(s, []).map((x) => x.key)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('sunburst and circle-packing zoom geometry', () => {
  const tree = buildTree(generateDataset('budget'), ['부문', '부서', '항목'], '예산').tree
  const sb = () => { const r = makeRoot(tree); d3.partition<any>().size([1, r.height + 1])(r); return r as d3.HierarchyRectangularNode<any> }

  it('whole-tree view: first ring covers the full circle and nothing is hidden within the ring limit', () => {
    const root = sb()
    const items = sunburstGeometry(root, root, 3, 40, 200)
    const ring1 = items.filter((i) => i.node.depth === 1)
    expect(d3.sum(ring1, (i) => i.geo[1] - i.geo[0])).toBeCloseTo(2 * Math.PI, 9)
    expect(items.every((i) => i.visible)).toBe(true)
    expect(items.filter((i) => i.node.depth === 1).every((i) => i.geo[2] === 40)).toBe(true)
  })

  it('zooming into a node makes its children fill the circle and hides everything else', () => {
    const root = sb()
    const focus = resolvePath(root, ['영업']) as d3.HierarchyRectangularNode<any>
    const items = sunburstGeometry(root, focus, 2, 40, 200)
    const kids = items.filter((i) => i.node.parent === focus)
    expect(d3.sum(kids, (i) => i.geo[1] - i.geo[0])).toBeCloseTo(2 * Math.PI, 9)
    expect(kids.every((i) => i.visible && i.geo[2] === 40)).toBe(true)
    expect(items.filter((i) => i.node.depth === 1 && i.node !== focus).every((i) => !i.visible)).toBe(true)
    const grand = items.filter((i) => i.node.parent?.parent === focus)
    expect(grand.every((i) => i.visible && i.geo[2] > 40)).toBe(true)
    // children keep their value proportions inside the new full circle
    kids.forEach((i) => expect((i.geo[1] - i.geo[0]) / (2 * Math.PI)).toBeCloseTo(i.node.value! / focus.value!, 9))
  })

  it('pack zoom scales the focused circle to fill the square and shrinks hidden branches out of view', () => {
    const r = makeRoot(tree)
    d3.pack<any>().size([500, 500]).padding(3)(r)
    const root = r as d3.HierarchyCircularNode<any>
    const nodes = root.descendants()
    const focus = resolvePath(root, ['마케팅']) as d3.HierarchyCircularNode<any>
    const items = packGeometry(nodes, focus, 500, 3)
    const f = items.find((i) => i.node === focus)!
    expect(f.geo[0]).toBeCloseTo(250, 6)
    expect(f.geo[1]).toBeCloseTo(250, 6)
    expect(f.geo[2]).toBeCloseTo(250, 6)
    expect(items.filter((i) => i.node.ancestors().includes(focus)).every((i) => i.visible)).toBe(true)
    const other = items.find((i) => i.node.data.name === '영업')!
    expect(other.visible).toBe(false)
    // leaf area ratios survive the zoom
    const leaves = items.filter((i) => i.node.ancestors().includes(focus) && !i.node.children)
    const k = leaves[0].geo[2] ** 2 / leaves[0].node.value!
    leaves.forEach((l) => expect(l.geo[2] ** 2 / l.node.value!).toBeCloseTo(k, 6))
  })
})

describe('dendrogram layout', () => {
  const labels = ['a', 'b', 'c', 'd', 'e']
  const tree = linkageTree(hclust([[0], [1], [5], [6], [20]], 'euclidean', 'average'), labels)

  it('gives every leaf its own slot and puts parents between their children', () => {
    const { placed, slots } = placeTree(tree, new Set())
    expect(slots).toBe(5)
    const walk = (p: typeof placed) => {
      if (!p.children.length) return
      expect(p.pos).toBeCloseTo(mean(p.children.map((c) => c.pos)), 9)
      p.children.forEach((c) => { expect(c.h).toBeLessThanOrEqual(p.h); walk(c) })
    }
    walk(placed)
  })

  it('folds a collapsed subtree into one slot at its own height', () => {
    const inner = tree.children!.find((c) => c.size === 4)!
    const { placed, slots } = placeTree(tree, new Set([inner.id]))
    expect(slots).toBe(2)
    const folded = placed.children.find((c) => c.folded)!
    expect(folded.h).toBe(inner.height)
    expect(folded.node.size).toBe(4)
  })
})
