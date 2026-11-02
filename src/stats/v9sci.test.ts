import { describe, expect, it } from 'vitest'
import { generateDataset } from '../data/datasets'
import { toNumber } from '../data/table'
import { fiberSurface, distToPolygon, field2FromRows, hyperstreamline, hypertube, ibfvStep, makeNoise, tensorFieldFromRows, type Pt } from './field9'
import { focusInverse, focusMap, type FocusSpec } from './focus9'
import { odCellPos, odModel, type OdRow } from './geo9'
import { countTerm, edgeAt, fontFor, parseQuery, tileBars, tileStarts, wordStream, type WordRow } from './text9'
import { gridFromRows } from './field3d'

describe('WordStream', () => {
  const t = generateDataset('topic-words', 7, 8)
  const rows: WordRow[] = t.rows.map((r) => ({ time: toNumber(r[0])!, topic: String(r[1]), word: String(r[2]), freq: toNumber(r[3])! }))
  const L = wordStream(rows, 900, 420, { topWords: 4, minSize: 9, maxSize: 26 })
  it('topic band thickness follows the topic total at each time', () => {
    L.topics.forEach((_, k) => L.times.forEach((_, i) => expect(L.bottom[k][i] - L.top[k][i]).toBeCloseTo(L.totals[k][i] * L.unit, 6)))
    L.times.forEach((_, i) => { for (let k = 1; k < L.topics.length; k++) expect(L.top[k][i]).toBeCloseTo(L.bottom[k - 1][i], 6) })
  })
  it('placed words lie inside their topic band and do not overlap', () => {
    expect(L.words.length).toBeGreaterThan(20)
    for (const w of L.words) for (const x of [w.x - w.w / 2, w.x, w.x + w.w / 2]) {
      expect(edgeAt(L.xs, L.top[w.topic], x)).toBeLessThanOrEqual(w.y - w.h / 2 + 1e-6)
      expect(edgeAt(L.xs, L.bottom[w.topic], x)).toBeGreaterThanOrEqual(w.y + w.h / 2 - 1e-6)
    }
    for (let i = 0; i < L.words.length; i++) for (let j = i + 1; j < L.words.length; j++) {
      const a = L.words[i], b = L.words[j]
      expect(Math.abs(a.x - b.x) * 2 >= a.w + b.w || Math.abs(a.y - b.y) * 2 >= a.h + b.h).toBe(true)
    }
  })
  it('font size grows with frequency; at most topWords per topic and time', () => {
    expect(fontFor(10, 100, 9, 26)).toBeLessThan(fontFor(50, 100, 9, 26))
    const cnt = new Map<string, number>()
    for (const w of L.words) cnt.set(`${w.topic}|${w.time}`, (cnt.get(`${w.topic}|${w.time}`) ?? 0) + 1)
    expect(Math.max(...cnt.values())).toBeLessThanOrEqual(4)
  })
  it('the time range restricts the slots', () => {
    const r = wordStream(rows, 900, 420, { topWords: 3, minSize: 9, maxSize: 24, range: [3, 5] })
    expect(r.times).toEqual([3, 4, 5])
  })
})

describe('TileBars', () => {
  const sents = ['지도 위에 값을 칠한다', '지도는 면적을 왜곡한다', '네트워크 노드를 잇는다', '네트워크 간선은 많다', '시간 축을 따라 본다', '시간 간격이 다르다']
  it('counts term occurrences exactly, with alternatives', () => {
    expect(countTerm('지도 지도 맵', ['지도'])).toBe(2)
    expect(countTerm('지도 지도 맵', ['지도', '맵'])).toBe(3)
    const groups = parseQuery('지도|맵, 네트워크')
    expect(groups.map((g) => g.terms)).toEqual([['지도', '맵'], ['네트워크']])
    const [d] = tileBars([{ name: 'a', sentences: sents }], groups, 'fixed', 2)
    expect(d.tiles).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 4, end: 6 }])
    expect(d.counts[0]).toEqual([2, 0, 0]); expect(d.counts[1]).toEqual([0, 2, 0])
    expect(d.hits).toBe(4)
    expect(d.together).toBe(0)
  })
  it('fixed tiles partition the sentences without gaps', () => {
    const s = tileStarts(sents, 'fixed', 4)
    expect(s).toEqual([0, 4])
  })
  it('topic tiling finds the boundary where the vocabulary changes', () => {
    const doc = ['지도 투영 왜곡 면적', '지도 투영 면적 비교', '지도 투영 왜곡 색', '지도 면적 왜곡 색', '네트워크 노드 간선 군집', '네트워크 노드 군집 밀도', '네트워크 간선 군집 밀도', '네트워크 노드 간선 밀도']
    const starts = tileStarts(doc, 'topic', 3)
    expect(starts[0]).toBe(0)
    expect(starts).toContain(4)
  })
  it('works on the bundled documents', () => {
    const t = generateDataset('search-docs', 7, 20)
    const docs = new Map<string, string[]>()
    t.rows.forEach((r) => docs.set(String(r[0]), [...(docs.get(String(r[0])) ?? []), String(r[1])]))
    const bars = tileBars([...docs].map(([name, sentences]) => ({ name, sentences })), parseQuery('지도, 네트워크, 시간'), 'fixed', 4)
    expect(bars.length).toBe(5)
    for (const b of bars) expect(b.tiles[b.tiles.length - 1].end).toBe(b.sentences.length)
  })
})

describe('IBFV', () => {
  const rows = (u: number, v: number) => { const r = []; for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) r.push({ x: i, y: j, u, v }); return r }
  const w = 40, h = 40
  it('advects an impulse along the flow: right for +u, up (smaller image y) for +v', () => {
    const f = field2FromRows(rows(1, 0))!
    const img = new Float32Array(w * h); img[20 * w + 10] = 1
    const out = ibfvStep(img, w, h, f, new Float32Array(w * h), 2, 0)
    let best = 0, bx = 0
    for (let x = 0; x < w; x++) if (out[20 * w + x] > best) { best = out[20 * w + x]; bx = x }
    expect(bx).toBe(12)
    const f2 = field2FromRows(rows(0, 1))!
    const img2 = new Float32Array(w * h); img2[20 * w + 10] = 1
    const o2 = ibfvStep(img2, w, h, f2, new Float32Array(w * h), 2, 0)
    let by = 0; best = 0
    for (let y = 0; y < h; y++) if (o2[y * w + 10] > best) { best = o2[y * w + 10]; by = y }
    expect(by).toBe(18)
  })
  it('a zero field leaves the image unchanged apart from the noise blend', () => {
    const f = field2FromRows(rows(0, 0))!
    const noise = makeNoise(w, h, 6, 3), img = makeNoise(w, h, 6, 9)
    const out = ibfvStep(img, w, h, f, noise, 2, 0.25)
    for (let i = 0; i < out.length; i += 37) expect(out[i]).toBeCloseTo(0.75 * img[i] + 0.25 * noise[i], 5)
  })
  it('streaks form along the flow: correlation along > across', () => {
    const f = field2FromRows(rows(1, 0))!
    let img: Float32Array = new Float32Array(w * h)
    const hold = 8 // a noise texture is held for several steps so that advection can stretch it into streaks
    const tex = (k: number) => makeNoise(w, h, 5, 100 + k)
    for (let s = 0; s < 80; s++) img = ibfvStep(img, w, h, f, tex(Math.floor(s / hold)), 1, 0.12)
    const corr = (dx: number, dy: number) => {
      let a = 0, b = 0, c = 0
      const mean = img.reduce((x, y) => x + y, 0) / img.length
      for (let y = 2; y < h - 6; y++) for (let x = 6; x < w - 6; x++) { const p = img[y * w + x] - mean, q = img[(y + dy) * w + x + dx] - mean; a += p * q; b += p * p; c += q * q }
      return a / Math.sqrt(b * c)
    }
    expect(corr(4, 0)).toBeGreaterThan(corr(0, 4) + 0.1)
  })
})

describe('Hyperstreamlines', () => {
  const t = generateDataset('tensor-twist', 7, 11)
  const rows = t.rows.map((r) => ({ x: toNumber(r[0])!, y: toNumber(r[1])!, z: toNumber(r[2])!, t: [3, 4, 5, 6, 7, 8].map((c) => toNumber(r[c])!) }))
  const f = tensorFieldFromRows(rows)!
  const line = hyperstreamline(f, [1, 0, 0], 0, 0.05, 160)
  it('follows the major eigenvector and keeps eigenvalues ordered', () => {
    expect(line.length).toBeGreaterThan(60)
    for (const s of line) { expect(s.values[0]).toBeGreaterThanOrEqual(s.values[1]); expect(s.values[1]).toBeGreaterThanOrEqual(s.values[2]) }
    for (let i = 0; i < line.length - 1; i++) {
      const d = [line[i + 1].p[0] - line[i].p[0], line[i + 1].p[1] - line[i].p[1], line[i + 1].p[2] - line[i].p[2]]
      const l = Math.hypot(...d), v = line[i].vectors[0]
      expect(Math.abs((d[0] * v[0] + d[1] * v[1] + d[2] * v[2]) / l)).toBeGreaterThan(0.98)
    }
  })
  it('circles the z axis: the radius stays near its start while the angle advances', () => {
    const r0 = Math.hypot(line[0].p[0], line[0].p[1])
    for (const s of line) expect(Math.abs(Math.hypot(s.p[0], s.p[1]) - r0) / r0).toBeLessThan(0.12)
    const a0 = Math.atan2(line[0].p[1], line[0].p[0]), a1 = Math.atan2(line[line.length - 1].p[1], line[line.length - 1].p[0])
    expect(a0).not.toBeCloseTo(a1, 1)
  })
  it('the cross-section ellipse has axes in the ratio of the two other eigenvalues', () => {
    const tube = hypertube(line, 0.1, 12)
    expect(tube.rings.length).toBe(line.length)
    line.forEach((s, i) => { expect(tube.axes[i][0] / tube.axes[i][1]).toBeCloseTo(s.values[1] / s.values[2], 4) })
    // ring points lie in the plane perpendicular to the tangent
    const ring = tube.rings[10], c = line[10]
    for (const p of ring) { const d = [p[0] - c.p[0], p[1] - c.p[1], p[2] - c.p[2]], v = c.vectors[0]; expect(Math.abs(d[0] * v[0] + d[1] * v[1] + d[2] * v[2])).toBeLessThan(1e-6) }
  })
  it('tracing the minor eigenvector gives a different curve', () => {
    const other = hyperstreamline(f, [1, 0, 0], 2, 0.05, 40)
    expect(other.length).toBeGreaterThan(5)
    expect(Math.hypot(other[other.length - 1].p[0] - line[line.length - 1].p[0], other[other.length - 1].p[1] - line[line.length - 1].p[1])).toBeGreaterThan(0.1)
  })
})

describe('Fiber surfaces', () => {
  const n = 9
  const mk = (fn: (x: number, y: number, z: number) => number) => {
    const rows: { x: number; y: number; z: number; v: number }[] = []
    for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = -1 + (2 * i) / (n - 1), y = -1 + (2 * j) / (n - 1), z = -1 + (2 * k) / (n - 1); rows.push({ x, y, z, v: fn(x, y, z) }) }
    return gridFromRows(rows)!
  }
  const f1 = mk((x) => x), f2 = mk((_x, y) => y)
  const square: Pt[] = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]
  it('every vertex lies on the polygon boundary in range space', () => {
    const m = fiberSurface(f1, f2, square)
    expect(m.tris.length).toBeGreaterThan(20)
    for (const r of m.range) expect(distToPolygon(r, square)).toBeLessThan(1e-9)
  })
  it('for f1 = x, f2 = y the fiber of a square is the prism with |x|=0.5 or |y|=0.5', () => {
    const m = fiberSurface(f1, f2, square)
    for (const v of m.verts) { expect(Math.max(Math.abs(v[0]), Math.abs(v[1]))).toBeCloseTo(0.5, 6); expect(Math.abs(v[0])).toBeLessThanOrEqual(0.5 + 1e-9); expect(Math.abs(v[1])).toBeLessThanOrEqual(0.5 + 1e-9) }
    // it spans the whole z extent
    expect(Math.min(...m.verts.map((v) => v[2]))).toBeCloseTo(-1, 6); expect(Math.max(...m.verts.map((v) => v[2]))).toBeCloseTo(1, 6)
  })
  it('a larger polygon gives a surface farther from the centre and a polygon outside the data gives none', () => {
    const big: Pt[] = square.map(([a, b]) => [a * 1.6, b * 1.6])
    const m = fiberSurface(f1, f2, big)
    expect(Math.max(...m.verts.map((v) => Math.max(Math.abs(v[0]), Math.abs(v[1]))))).toBeCloseTo(0.8, 6)
    const far: Pt[] = square.map(([a, b]) => [a + 5, b + 5])
    expect(fiberSurface(f1, f2, far).tris.length).toBe(0)
  })
  it('works with the bundled bivariate volume', () => {
    const t = generateDataset('bivariate-volume', 7, 12)
    const rows = t.rows.map((r) => ({ x: toNumber(r[0])!, y: toNumber(r[1])!, z: toNumber(r[2])! }))
    const g1 = gridFromRows(t.rows.map((r, i) => ({ ...rows[i], v: toNumber(r[3])! })))!, g2 = gridFromRows(t.rows.map((r, i) => ({ ...rows[i], v: toNumber(r[4])! })))!
    const poly: Pt[] = [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]]
    const m = fiberSurface(g1, g2, poly)
    expect(m.tris.length).toBeGreaterThan(0)
    for (const r of m.range) expect(distToPolygon(r, poly)).toBeLessThan(1e-9)
  })
})

describe('Perspective Wall and Bifocal', () => {
  const spec = (mode: 'wall' | 'bifocal', angle = 55): FocusSpec => ({ mode, lo: 0, hi: 1000, focus: 400, half: 80, width: 900, panel: 0.5, angle })
  for (const mode of ['wall', 'bifocal'] as const) {
    it(`${mode}: monotone, inside the screen, invertible`, () => {
      const s = spec(mode)
      let prev = -Infinity
      for (let x = 0; x <= 1000; x += 5) { const m = focusMap(s, x); expect(m.sx).toBeGreaterThan(prev); prev = m.sx; expect(m.sx).toBeGreaterThanOrEqual(-1); expect(m.sx).toBeLessThanOrEqual(901) }
      for (const x of [20, 250, 390, 400, 450, 700, 980]) expect(focusInverse(s, focusMap(s, x).sx)).toBeCloseTo(x, 3)
    })
    it(`${mode}: the detail panel is linear with scale 1 and continuous at the hinge`, () => {
      const s = spec(mode)
      const a = focusMap(s, 400), b = focusMap(s, 440), c = focusMap(s, 480)
      expect(b.sx - a.sx).toBeCloseTo(c.sx - b.sx, 6)
      expect(a.scale).toBe(1)
      const inner = focusMap(s, 400 + 80), outer = focusMap(s, 400 + 80 + 1e-6)
      expect(Math.abs(inner.sx - outer.sx)).toBeLessThan(1e-3)
      expect(focusMap(s, 400).sx).toBeCloseTo(450, 6)
    })
  }
  it('the wall shrinks the context the further it is from the focus; the bifocal context is uniform', () => {
    const w = spec('wall')
    expect(focusMap(w, 600).scale).toBeLessThan(1); expect(focusMap(w, 900).scale).toBeLessThan(focusMap(w, 600).scale)
    const b = spec('bifocal')
    const d1 = focusMap(b, 600).sx - focusMap(b, 590).sx, d2 = focusMap(b, 900).sx - focusMap(b, 890).sx
    expect(d1).toBeCloseTo(d2, 6)
    expect(d1).toBeLessThan(focusMap(b, 410).sx - focusMap(b, 400).sx)
  })
  it('moving the focus moves the magnified region', () => {
    const a = { ...spec('wall'), focus: 200 }, b = { ...spec('wall'), focus: 700 }
    expect(focusMap(a, 200).sx).toBeCloseTo(450, 6); expect(focusMap(b, 700).sx).toBeCloseTo(450, 6)
    expect(focusMap(a, 700).sx).toBeGreaterThan(450)
  })
})

describe('OD maps', () => {
  const t = generateDataset('grid-flows', 7, 5)
  const rows: OdRow[] = t.rows.map((r) => ({ origin: String(r[0]), dest: String(r[1]), ox: toNumber(r[2])!, oy: toNumber(r[3])!, dx: toNumber(r[4])!, dy: toNumber(r[5])!, flow: toNumber(r[6])! }))
  const m = odModel(rows)!
  it('keeps every origin–destination flow and the totals', () => {
    expect(m.regions.length).toBe(5 * 4)
    const total = rows.reduce((a, r) => a + r.flow, 0)
    expect(m.out.reduce((a, b) => a + b, 0)).toBe(total); expect(m.inn.reduce((a, b) => a + b, 0)).toBe(total)
    rows.slice(0, 30).forEach((r) => expect(m.flow[m.regions.indexOf(r.origin)][m.regions.indexOf(r.dest)]).toBe(r.flow))
  })
  it('lays the cells out so that every (origin, destination) pair has its own position and the inner grid repeats the map', () => {
    const seen = new Set<string>()
    for (let o = 0; o < m.regions.length; o++) for (let d = 0; d < m.regions.length; d++) { const p = odCellPos(m, o, d); seen.add(`${p.x},${p.y}`) }
    expect(seen.size).toBe(m.regions.length ** 2)
    // destination d keeps the same offset inside every origin cell
    const a = odCellPos(m, 0, 7), b = odCellPos(m, 3, 7)
    expect(a.x % m.cols).toBe(b.x % m.cols); expect(a.y % m.rows).toBe(b.y % m.rows)
  })
})
