import { describe, expect, it } from 'vitest'
import { buildCube, continuousParallel, continuousScatterplot, nodeSlice, projectTime, splatStripe, timeSlice, type Field2 } from './dyn11'
import { autocorrelation, curlAt, rectangularCartogram, spotNoise, streamRibbon, touches, travelCartogram, travelTimes } from './field11'
import { hasse, hasseOrder, hintonSide, lcl, moistLapse, nomogram, parcelPath, piperPercents, piperPoints, dryAdiabat, KAPPA, skillStats, stiffRows, targetPoint, taylorPoint, toMeq } from './model11'
import { bspline, bundlePath, cactusTree, historyFlow, pythagoras, weightOf } from './tree11'

describe('Hinton / Taylor / Target', () => {
  it('Hinton: the area is proportional to |v|', () => {
    expect(hintonSide(4, 4) ** 2 / hintonSide(1, 4) ** 2).toBeCloseTo(4)
    expect(hintonSide(-2, 4)).toBe(hintonSide(2, 4))
  })
  const obs = [1, 2, 3, 4, 5, 6, 7, 8], mod = [1.5, 2.2, 2.9, 4.4, 5.1, 6.3, 6.8, 8.4]
  it('Taylor: the law of cosines holds, E′² = σm² + σo² − 2σmσo·r', () => {
    const s = skillStats(obs, mod)
    expect(s.crmsd ** 2).toBeCloseTo(s.sdMod ** 2 + s.sdObs ** 2 - 2 * s.sdMod * s.sdObs * s.r, 9)
    const p = taylorPoint(s)
    expect(p.radius * Math.cos(p.angle)).toBeCloseTo(s.sdMod * s.r, 9)
  })
  it('Target: bias² + E′² = RMSD², and a biased perfect-pattern model sits on the vertical axis', () => {
    const s = skillStats(obs, mod.map((v) => v + 2))
    expect(s.bias ** 2 + s.crmsd ** 2).toBeCloseTo(s.rmsd ** 2, 9)
    const shifted = skillStats(obs, obs.map((v) => v + 3))
    const t = targetPoint(shifted)
    expect(t.x).toBeCloseTo(0, 9)
    expect(t.y).toBeCloseTo(3 / shifted.sdObs, 9)
  })
})

describe('nomogram', () => {
  const vars = [{ name: 'a', min: 0, max: 10, beta: 0.4 }, { name: 'b', min: 20, max: 80, beta: -0.05 }, { name: 'c', min: 0, max: 1, beta: 1.2 }]
  it('the longest axis spans 100 points and the points reproduce the linear predictor', () => {
    const nm = nomogram(vars, -1)
    expect(Math.max(...nm.scales.map((s) => s.range))).toBeCloseTo(100)
    const x = [6, 50, 1]
    const total = nm.scales.reduce((s, v, i) => s + v.points(x[i]), 0)
    const lp = -1 + 0.4 * 6 - 0.05 * 50 + 1.2 * 1
    expect(nm.linearPredictor(total)).toBeCloseTo(lp, 9)
    expect(nm.probability(total)).toBeCloseTo(1 / (1 + Math.exp(-lp)), 9)
    expect(nm.pointsForProbability(nm.probability(total))).toBeCloseTo(total, 6)
  })
})

describe('water chemistry', () => {
  const mg = { Ca: 60, Mg: 12, Na: 30, K: 4, HCO3: 200, SO4: 40, Cl: 35 }
  it('Piper: group percentages sum to 100 and the points follow their corners', () => {
    const p = piperPercents(toMeq(mg))
    expect(p.Ca + p.Mg + p.NaK).toBeCloseTo(100)
    expect(p.HCO3 + p.SO4 + p.Cl).toBeCloseTo(100)
    const pure = piperPoints({ Ca: 100, Mg: 0, NaK: 0, HCO3: 100, SO4: 0, Cl: 0 })
    expect(pure.cation).toEqual([0, 0])
    expect(pure.anion).toEqual([1.5, 0])
    const left = piperPoints({ Ca: 100, Mg: 0, NaK: 0, HCO3: 100, SO4: 0, Cl: 0 }).diamond
    const right = piperPoints({ Ca: 0, Mg: 0, NaK: 100, HCO3: 0, SO4: 0, Cl: 100 }).diamond
    expect(left[0]).toBeLessThan(right[0])
    expect(piperPoints({ Ca: 0, Mg: 0, NaK: 100, HCO3: 100, SO4: 0, Cl: 0 }).diamond[1]).toBeLessThan(left[1])
  })
  it('Stiff: rows carry the equivalents of the ion pairs', () => {
    const m = toMeq(mg)
    const r = stiffRows(m)
    expect(r[1].left).toBeCloseTo(m.Ca)
    expect(r[1].right).toBeCloseTo(m.HCO3)
    expect(r[0].left).toBeCloseTo(m.Na + m.K)
  })
})

describe('Skew-T', () => {
  it('the LCL lies below the surface dewpoint line and near 125 m per °C of dewpoint depression', () => {
    const l = lcl(25, 15, 1000)
    expect(l.p).toBeGreaterThan(840)
    expect(l.p).toBeLessThan(900)
    expect(l.tK - 273.15).toBeLessThan(25)
    expect(l.tK - 273.15).toBeGreaterThan(15 - 5)
  })
  it('the moist adiabat cools more slowly than the dry one and parcel temperatures decrease with height', () => {
    const dry = (KAPPA * 293.15) / 1000
    expect(moistLapse(293.15, 1000)).toBeLessThan(dry)
    const pp = parcelPath(25, 15, 1000)
    for (let i = 1; i < pp.path.length; i++) expect(pp.path[i].t).toBeLessThan(pp.path[i - 1].t + 1e-9)
    expect(dryAdiabat(20, 1000)).toBeCloseTo(20, 9)
  })
})

describe('Hasse diagram', () => {
  const div = [[1, 2], [1, 3], [2, 4], [2, 6], [3, 6], [4, 12], [6, 12], [1, 4], [1, 12], [2, 12], [3, 12], [1, 6]].map(([a, b]) => [String(a), String(b)] as [string, string])
  it('keeps only the covering relations of the divisibility order and layers by chain length', () => {
    const h = hasse(div)
    expect(h.cyclic).toBe(false)
    expect(h.covers.length).toBe(7)
    expect(h.level.get('1')).toBe(0)
    expect(h.level.get('12')).toBe(3)
    expect(h.minimal).toEqual(['1'])
    expect(h.maximal).toEqual(['12'])
    expect(hasseOrder(h).flat().sort()).toEqual([...h.elements].sort())
  })
  it('detects a cycle (antisymmetry violated)', () => {
    expect(hasse([['a', 'b'], ['b', 'c'], ['c', 'a']]).cyclic).toBe(true)
  })
})

describe('trees', () => {
  const bin = { name: 'r', children: [{ name: 'a', value: 1 }, { name: 'b', value: 1 }] }
  it('Pythagoras: two equal children give the classical tree (c₁² + c₂² = c²) with the chord chain spanning the top edge', () => {
    const ns = pythagoras(bin, 1)
    expect(ns.length).toBe(3)
    expect(ns[1].side).toBeCloseTo(Math.SQRT1_2, 6)
    expect(ns[2].side).toBeCloseTo(Math.SQRT1_2, 6)
    const root = ns[0]
    const kidA = ns[1], kidB = ns[2]
    expect(kidA.corners[0][0]).toBeCloseTo(root.corners[3][0], 6)
    expect(kidA.corners[0][1]).toBeCloseTo(root.corners[3][1], 6)
    expect(kidB.corners[1][0]).toBeCloseTo(root.corners[2][0], 6)
    expect(kidA.corners[1][0]).toBeCloseTo(kidB.corners[0][0], 6)
    // the children stand above the top edge of the parent
    expect(kidA.corners[3][1]).toBeGreaterThan(1)
  })
  it('Pythagoras: n-ary children are chained corner to corner and heavier children are bigger', () => {
    const t = { name: 'r', children: [{ name: 'a', value: 4 }, { name: 'b', value: 1 }, { name: 'c', value: 1 }, { name: 'd', value: 2 }] }
    const ns = pythagoras(t, 1)
    const kids = ns.filter((n) => n.depth === 1)
    expect(kids.length).toBe(4)
    for (let i = 0; i + 1 < kids.length; i++) { expect(kids[i].corners[1][0]).toBeCloseTo(kids[i + 1].corners[0][0], 6); expect(kids[i].corners[1][1]).toBeCloseTo(kids[i + 1].corners[0][1], 6) }
    expect(kids[0].corners[0][0]).toBeCloseTo(ns[0].corners[3][0], 6)
    expect(kids[3].corners[1][0]).toBeCloseTo(ns[0].corners[2][0], 6)
    expect(kids[0].side).toBeGreaterThan(kids[1].side)
    expect(weightOf(t)).toBe(8)
  })
  const tree = { name: 'root', children: [{ name: 'g1', children: [{ name: 'a', value: 2 }, { name: 'b', value: 1 }] }, { name: 'g2', children: [{ name: 'c', value: 3 }, { name: 'd', value: 1 }] }] }
  it('CactusTree: circle area ∝ subtree weight and children touch their parent', () => {
    const ns = cactusTree(tree)
    expect(ns.length).toBe(7)
    const root = ns[0], g1 = ns.find((n) => n.name === 'g1')!
    expect((g1.r / root.r) ** 2).toBeCloseTo(g1.weight / root.weight, 6)
    expect(Math.hypot(g1.x - root.x, g1.y - root.y)).toBeCloseTo(root.r + g1.r, 6)
  })
  it('hierarchical edge bundling: the path runs through the lowest common ancestor and β = 0 is the straight line', () => {
    const ns = cactusTree(tree)
    const a = ns.findIndex((n) => n.name === 'a'), c = ns.findIndex((n) => n.name === 'c')
    const path = bundlePath(ns, a, c, 1)
    expect(path.length).toBe(5)
    expect(path[2][0]).toBeCloseTo(ns[0].x, 9)
    expect(path[2][1]).toBeCloseTo(ns[0].y, 9)
    const straight = bundlePath(ns, a, c, 0)
    for (const p of straight) expect((p[0] - straight[0][0]) * (straight[4][1] - straight[0][1]) - (p[1] - straight[0][1]) * (straight[4][0] - straight[0][0])).toBeCloseTo(0, 6)
    const curve = bspline(path, 6)
    expect(curve[0][0]).toBeCloseTo(path[0][0], 9)
    expect(curve[0][1]).toBeCloseTo(path[0][1], 9)
    expect(curve[curve.length - 1]).toEqual(path[4])
  })
  it('History Flow: heights add up, shared segments get ribbons, new and deleted segments are counted', () => {
    const revs = [
      { version: 1, seg: 'A', author: 'x', length: 3, order: 0 }, { version: 1, seg: 'B', author: 'x', length: 2, order: 1 },
      { version: 2, seg: 'A', author: 'x', length: 3, order: 0 }, { version: 2, seg: 'N', author: 'y', length: 4, order: 1 }, { version: 2, seg: 'B', author: 'x', length: 2, order: 2 },
      { version: 3, seg: 'B', author: 'x', length: 2, order: 0 }, { version: 3, seg: 'N', author: 'y', length: 4, order: 1 },
    ]
    const f = historyFlow(revs)
    expect(f.height).toBe(9)
    expect(f.ribbons.length).toBe(4) // A, B (v1→v2) and B, N (v2→v3)
    expect(f.deleted).toBe(1) // A is gone in v3
    expect(f.inserted).toBe(1) // N
    expect(f.ribbons.filter((r) => r.moved).length).toBeGreaterThan(0)
    expect(f.authors).toEqual(['x', 'y'])
  })
})

describe('dynamic networks', () => {
  const edges = [{ t: 1, a: 'a', b: 'b', w: 2 }, { t: 1, a: 'b', b: 'c', w: 1 }, { t: 2, a: 'a', b: 'c', w: 3 }, { t: 2, a: 'a', b: 'b', w: 1 }]
  it('Matrix Cube: symmetric slices with the right shapes; the time projection keeps the total weight', () => {
    const c = buildCube(edges)
    expect(c.n).toBe(3)
    expect(c.times).toEqual([1, 2])
    const s = timeSlice(c, 0)
    expect(s.length).toBe(9)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(s[i * 3 + j]).toBe(s[j * 3 + i])
    expect(nodeSlice(c, 0).length).toBe(3 * 2)
    const total = edges.reduce((x, e) => x + e.w, 0)
    expect([...projectTime(c)].reduce((x, y) => x + y, 0)).toBeCloseTo(2 * total)
    expect(nodeSlice(c, 0)[1 * 2 + 0]).toBe(2) // node a – b at time 1
  })
  it('Parallel Edge Splatting: every column of a stripe sums to the total edge weight', () => {
    const d = splatStripe([{ i: 0, j: 3, w: 2 }, { i: 2, j: 1, w: 0.5 }], 4, 9, 16)
    for (let c = 0; c < 9; c++) { let s = 0; for (let r = 0; r < 16; r++) s += d[r * 9 + c]; expect(s).toBeCloseTo(2.5, 5) }
  })
})

describe('continuous scatterplot / parallel coordinates', () => {
  const N = 9
  const mk = (fn: (x: number, y: number) => number[]): Field2 => {
    const k = fn(0, 0).length
    const attr = Array.from({ length: k }, () => new Float64Array(N * N))
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) fn(x, y).forEach((v, a) => { attr[a][y * N + x] = v })
    return { nx: N, ny: N, attr }
  }
  it('an identity field has density 1 everywhere and the mass is the spatial area', () => {
    const f = mk((x, y) => [x, y])
    const s = continuousScatterplot(f, 0, 1, 16, 16)
    expect(Math.abs(s.mass - (N - 1) ** 2) / (N - 1) ** 2).toBeLessThan(0.06)
    for (const v of s.density) expect(Math.abs(v - 1)).toBeLessThan(0.25)
  })
  it('a field that stretches x by two halves the density and keeps the mass', () => {
    const f = mk((x, y) => [2 * x, y])
    const s = continuousScatterplot(f, 0, 1, 32, 16)
    expect(Math.abs(s.mass - (N - 1) ** 2) / (N - 1) ** 2).toBeLessThan(0.06)
    for (const v of s.density) expect(Math.abs(v - 0.5)).toBeLessThan(0.15)
  })
  it('a field that folds onto itself adds the densities of both preimages', () => {
    const f = mk((x, y) => [Math.abs(x - 4), y])
    const s = continuousScatterplot(f, 0, 1, 8, 8)
    for (const v of s.density) expect(Math.abs(v - 2)).toBeLessThan(0.5)
  })
  it('continuous parallel coordinates: every column carries the total mass, and p = q puts it on the diagonal', () => {
    const f = mk((x, y) => [x + y, x - y, x])
    const d = continuousParallel(f, 0, 1, 7, 24, 3)
    for (let c = 0; c < 7; c++) { let s = 0; for (let r = 0; r < 24; r++) s += d.density[r * 7 + c]; expect(s).toBeCloseTo(d.mass, 3) }
    const same = continuousParallel(f, 2, 2, 5, 20, 3)
    for (let c = 0; c < 5; c++) { const rowsum = Array.from({ length: 20 }, (_, r) => same.density[r * 5 + c]); const tot = rowsum.reduce((x, y) => x + y, 0); expect(Math.max(...rowsum)).toBeGreaterThan(0); expect(tot).toBeCloseTo(same.mass, 3) }
    // identical axes: the line is horizontal, so the row of the mass does not change from the first to the last column
    const profile = (c: number) => Array.from({ length: 20 }, (_, r) => same.density[r * 5 + c])
    expect(profile(0)).toEqual(profile(4).map((v, i) => (Math.abs(v - profile(0)[i]) < 1e-5 ? profile(0)[i] : v)))
  })
})

describe('spot noise, ribbons, cartograms', () => {
  it('spot noise is reproducible and stretches along the flow', () => {
    const a = spotNoise(() => [1, 0], 96, 96, 700, 3, 2, 5)
    const b = spotNoise(() => [1, 0], 96, 96, 700, 3, 2, 5)
    expect(Array.from(a.tex.slice(0, 50))).toEqual(Array.from(b.tex.slice(0, 50)))
    expect(autocorrelation(a, 4, 0)).toBeGreaterThan(autocorrelation(a, 0, 4) + 0.15)
    const c = spotNoise(() => [0, 1], 96, 96, 700, 3, 2, 5)
    expect(autocorrelation(c, 0, 4)).toBeGreaterThan(autocorrelation(c, 4, 0) + 0.15)
  })
  it('curl of a rigid rotation is 2Ω along the axis', () => {
    const c = curlAt((p) => [-p[1], p[0], 0], [0.3, 0.2, 0.1])
    expect(c[2]).toBeCloseTo(2, 6)
    expect(c[0]).toBeCloseTo(0, 6)
  })
  it('a stream ribbon twists with half the vorticity along the tangent (helical flow) and stays perpendicular to the streamline', () => {
    const vec = (p: [number, number, number]): [number, number, number] => [-p[1], p[0], 1]
    const rb = streamRibbon(vec, [1, 0, 0], 120, 0.02, 0.2)
    const last = rb.twist[rb.twist.length - 1]
    // dθ/dt = ½ ω·T / |v| · |v| = ½ · 2 · Tz·|v|/|v|…: with ω = (0,0,2), T_z = 1/√2 at r = 1, θ = Tz · t
    const t = (rb.axis.length - 1) * 0.02
    expect(last).toBeGreaterThan(0.5 * t)
    expect(last).toBeLessThan(1.1 * t)
    for (let i = 1; i + 1 < rb.axis.length; i++) {
      const T = [rb.axis[i + 1][0] - rb.axis[i - 1][0], rb.axis[i + 1][1] - rb.axis[i - 1][1], rb.axis[i + 1][2] - rb.axis[i - 1][2]]
      const l = Math.hypot(...T)
      expect(Math.abs((T[0] * rb.side[i][0] + T[1] * rb.side[i][1] + T[2] * rb.side[i][2]) / l)).toBeLessThan(1e-6)
    }
  })
  it('rectangular cartogram: areas are exactly proportional to the values and the rectangles tile the frame', () => {
    const regions = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, x: (i % 4) + 0.1 * (i % 3), y: Math.floor(i / 4), value: 1 + (i * 7) % 5 }))
    const nb: [string, string][] = []
    for (let i = 0; i < 12; i++) { if (i % 4 < 3) nb.push([`r${i}`, `r${i + 1}`]); if (i < 8) nb.push([`r${i}`, `r${i + 4}`]) }
    const cg = rectangularCartogram(regions, nb, 1.6, 40, 3)
    const total = regions.reduce((s, r) => s + r.value, 0)
    for (const r of cg.rects) expect((r.w * r.h) / 1.6).toBeCloseTo(regions.find((q) => q.id === r.id)!.value / total, 9)
    expect(cg.rects.reduce((s, r) => s + r.w * r.h, 0)).toBeCloseTo(1.6, 9)
    for (let i = 0; i < cg.rects.length; i++) for (let j = i + 1; j < cg.rects.length; j++) {
      const a = cg.rects[i], b = cg.rects[j]
      expect(Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-9 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-9).toBe(false)
    }
    expect(cg.adjacencyKept).toBeGreaterThan(cg.adjacencyTotal * 0.4)
    expect(touches({ id: 'a', x: 0, y: 0, w: 1, h: 1, value: 1 }, { id: 'b', x: 1, y: 0.2, w: 1, h: 1, value: 1 })).toBe(true)
  })
  it('travel-time cartogram: shortest times, bearings kept, distances proportional to the time', () => {
    const nodes = [{ id: 'o', x: 0, y: 0 }, { id: 'a', x: 10, y: 0 }, { id: 'b', x: 0, y: 10 }, { id: 'c', x: 10, y: 10 }]
    const edges = [{ a: 'o', b: 'a', minutes: 5 }, { a: 'a', b: 'c', minutes: 5 }, { a: 'o', b: 'b', minutes: 40 }, { a: 'b', b: 'c', minutes: 50 }]
    const t = travelTimes(nodes, edges, 'o')
    expect(t.get('c')).toBe(10)
    expect(t.get('b')).toBe(40)
    const full = travelCartogram(nodes, t, 'o', 1)
    const d = (id: string) => Math.hypot(...(full.pos.get(id) as [number, number]))
    expect(d('c') / d('a')).toBeCloseTo(10 / 5, 6)
    expect(d('b') / d('a')).toBeCloseTo(40 / 5, 6)
    const pa = full.pos.get('b')!
    expect(pa[0]).toBeCloseTo(0, 9)
    expect(travelCartogram(nodes, t, 'o', 0).pos.get('c')).toEqual([10, 10])
  })
})

import { adjacencyFromRings } from './field11'
describe('map adjacency', () => {
  it('regions sharing a border are neighbours, a distant one is not', () => {
    const sq = (x: number, y: number) => [[[x, y], [x + 10, y], [x + 10, y + 10], [x, y + 10]] as [number, number][]]
    const pairs = adjacencyFromRings([{ id: 'a', rings: sq(0, 0) }, { id: 'b', rings: sq(10, 0) }, { id: 'c', rings: sq(100, 100) }], 1)
    expect(pairs).toEqual([['a', 'b']])
  })
})
