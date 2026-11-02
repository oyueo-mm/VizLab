import { describe, expect, it } from 'vitest'
import { generateDataset } from '../data/datasets'
import { toNumber } from '../data/table'
import { criticalPoints, field2FromRows, sampleField2, separatrices, tangentCurve } from './field9'
import { mapTrixOrder, odModel, type OdRow } from './geo9'
import { setNet, setNetMaskAt } from './sets9'
import { seesoft, type CodeLine } from './text9'

const gridField = (fn: (x: number, y: number) => [number, number], n = 21, lim = 2) => {
  const rows = []
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = -lim + (2 * lim * i) / (n - 1), y = -lim + (2 * lim * j) / (n - 1); const [u, v] = fn(x, y); rows.push({ x, y, u, v }) }
  return field2FromRows(rows)!
}

describe('Vector field topology', () => {
  it('finds and classifies the textbook critical points', () => {
    const cases: [string, (x: number, y: number) => [number, number], string][] = [
      ['saddle', (x, y) => [x, -y], 'saddle'],
      ['source', (x, y) => [x, y], 'source'],
      ['sink', (x, y) => [-x, -y], 'sink'],
      ['centre', (x, y) => [-y, x], 'center'],
      ['spiral sink', (x, y) => [-x - y, x - y], 'attracting-focus'],
      ['spiral source', (x, y) => [x - y, x + y], 'repelling-focus'],
    ]
    for (const [name, fn, kind] of cases) {
      const p = criticalPoints(gridField(fn, 21, 2 + 1e-3))
      expect(p.length, name).toBe(1)
      expect(p[0].kind, name).toBe(kind)
      expect(Math.hypot(p[0].x, p[0].y), name).toBeLessThan(1e-6)
    }
  })
  it('locates an off-centre zero exactly', () => {
    const p = criticalPoints(gridField((x, y) => [x - 0.37, y + 0.81]))
    expect(p.length).toBe(1)
    expect(p[0].x).toBeCloseTo(0.37, 6); expect(p[0].y).toBeCloseTo(-0.81, 6)
  })
  it('the saddle of (x, −y) has separatrices along the axes: out along x, in along y', () => {
    const f = gridField((x, y) => [x, -y])
    const s = criticalPoints(f)[0]
    const sep = separatrices(f, s, 0.05)
    expect(sep.length).toBe(4)
    const ends = sep.map((c) => c[c.length - 1])
    // unstable branches run along ±x, stable ones come in along ±y (traced backwards)
    const alongX = ends.filter((e) => Math.abs(e[1]) < 0.05 && Math.abs(e[0]) > 1)
    const alongY = ends.filter((e) => Math.abs(e[0]) < 0.05 && Math.abs(e[1]) > 1)
    expect(alongX.length).toBe(2); expect(alongY.length).toBe(2)
  })
  it('tangent curves follow the field: a circle of the vortex keeps its radius', () => {
    const f = gridField((x, y) => [-y, x], 41)
    const c = tangentCurve(f, [1, 0], 1, 0.05, 200)
    for (const p of c) expect(Math.abs(Math.hypot(p[0], p[1]) - 1)).toBeLessThan(0.01)
    expect(sampleField2(f, 1, 0)[1]).toBeCloseTo(1, 6)
  })
  it('the bundled field has a source or sink and a saddle', () => {
    const t = generateDataset('flow-2d', 7, 40)
    const f = field2FromRows(t.rows.map((r) => ({ x: toNumber(r[0])!, y: toNumber(r[1])!, u: toNumber(r[2])!, v: toNumber(r[3])! })))!
    const kinds = criticalPoints(f).map((p) => p.kind)
    expect(kinds).toContain('saddle')
    expect(kinds.some((k) => k !== 'saddle')).toBe(true)
  })
})

describe('SetNet', () => {
  const t = generateDataset('club-network', 7, 24)
  const names = t.rows.map((r) => String(r[0]))
  const member = [1, 2, 3].map((c) => t.rows.map((r) => (toNumber(r[c]) ?? 0) > 0))
  const edges: [number, number][] = []
  t.rows.forEach((r, i) => String(r[4]).split(';').filter(Boolean).forEach((n) => { const j = names.indexOf(n); if (j > i) edges.push([i, j]) }))
  const m = setNet(member, names.length, edges, 5)
  it('keeps every node, every edge and every membership', () => {
    expect(m.pos.length).toBe(names.length)
    expect(edges.length).toBeGreaterThan(10)
    expect(m.edges).toEqual(edges)
    m.mask.forEach((mask, i) => member.forEach((s, si) => expect(!!(mask & (1 << si))).toBe(s[i])))
  })
  it('places every node whose zone exists inside exactly its own sets\' circles', () => {
    m.pos.forEach((p, i) => {
      const at = setNetMaskAt(m, p)
      const empty = !m.mask.some((x, j) => x === m.mask[i] && setNetMaskAt(m, m.pos[j]) === m.mask[i])
      if (!empty) expect(at).toBe(m.mask[i])
    })
    expect(m.violations).toBeLessThanOrEqual(3)
  })
  it('sets that share nodes overlap and circles stay inside the unit square', () => {
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
      const shares = member[a].some((v, i) => v && member[b][i])
      const d = Math.hypot(m.centers[a][0] - m.centers[b][0], m.centers[a][1] - m.centers[b][1])
      if (shares) expect(d).toBeLessThan(m.radii[a] + m.radii[b])
    }
    m.centers.forEach((c, i) => { expect(c[0] - m.radii[i]).toBeGreaterThanOrEqual(-1e-6); expect(c[0] + m.radii[i]).toBeLessThanOrEqual(1 + 1e-6) })
  })
  it('connected nodes end up closer than random pairs', () => {
    const d = (a: number, b: number) => Math.hypot(m.pos[a][0] - m.pos[b][0], m.pos[a][1] - m.pos[b][1])
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    const linked = mean(edges.map(([a, b]) => d(a, b)))
    const all: number[] = []
    for (let a = 0; a < names.length; a++) for (let b = a + 1; b < names.length; b++) all.push(d(a, b))
    expect(linked).toBeLessThan(mean(all))
  })
})

describe('Seesoft', () => {
  const t = generateDataset('code-lines', 7, 100)
  const lines: CodeLine[] = t.rows.map((r) => ({ file: String(r[0]), line: toNumber(r[1])!, length: toNumber(r[2])!, indent: toNumber(r[3])!, author: String(r[4]), age: toNumber(r[5])!, kind: String(r[6]), text: String(r[7]) }))
  it('every line of every file lies in exactly one band, in order', () => {
    const cols = seesoft(lines, 400)
    expect(cols.length).toBe(4)
    for (const c of cols) {
      const covered = c.bands.flatMap((b) => Array.from({ length: b.to - b.from }, (_, k) => b.from + k))
      expect(covered).toEqual(c.lines.map((_, i) => i))
      for (let i = 1; i < c.bands.length; i++) expect(c.bands[i].y).toBeGreaterThan(c.bands[i - 1].y)
    }
  })
  it('lines are grouped only when there are more lines than pixels', () => {
    const sparse = seesoft(lines, 400)
    expect(sparse[0].bands.length).toBe(sparse[0].lines.length)
    const dense = seesoft(lines, 25)
    expect(dense[0].bands.length).toBeLessThan(dense[0].lines.length)
    expect(dense[0].bands[0].to - dense[0].bands[0].from).toBeGreaterThan(1)
  })
  it('the bundled files differ in length', () => {
    const cols = seesoft(lines, 400)
    expect(Math.max(...cols.map((c) => c.lines.length))).toBeGreaterThan(Math.min(...cols.map((c) => c.lines.length)) * 2)
  })
})

describe('MapTrix order', () => {
  const t = generateDataset('grid-flows', 7, 5)
  const rows: OdRow[] = t.rows.map((r) => ({ origin: String(r[0]), dest: String(r[1]), ox: toNumber(r[2])!, oy: toNumber(r[3])!, dx: toNumber(r[4])!, dy: toNumber(r[5])!, flow: toNumber(r[6])! }))
  const m = odModel(rows)!
  const o = mapTrixOrder(m)
  it('rows and columns are permutations ordered by map position', () => {
    const n = m.regions.length
    expect([...o.rows].sort((a, b) => a - b)).toEqual([...Array(n).keys()])
    expect([...o.cols].sort((a, b) => a - b)).toEqual([...Array(n).keys()])
    for (let i = 1; i < n; i++) { expect(m.grid[o.rows[i]][1]).toBeGreaterThanOrEqual(m.grid[o.rows[i - 1]][1]); expect(m.grid[o.cols[i]][0]).toBeGreaterThanOrEqual(m.grid[o.cols[i - 1]][0]) }
  })
})
