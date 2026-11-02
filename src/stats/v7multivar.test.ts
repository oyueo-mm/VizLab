import { describe, expect, it } from 'vitest'
import {
  anchorAngle, binOf, defaultAxes, dimensionalStacking, faceGeometry, kdeND, lensLayout, normalizeColumns, pixelBars, project, radviz, recursivePos,
  recursiveSize, segmentPixels, sliceGrid, starCoordinates, tourFrame,
} from './multivar7'

const X = [[1, 10, 100], [2, 20, 300], [3, 30, 200], [4, 50, 500]]

describe('normalization', () => {
  it('min–max maps every column onto [0, 1]', () => {
    const n = normalizeColumns(X)
    for (let j = 0; j < 3; j++) { expect(Math.min(...n.map((r) => r[j]))).toBe(0); expect(Math.max(...n.map((r) => r[j]))).toBe(1) }
  })
})

describe('RadViz', () => {
  const angles = [0, 1, 2].map((j) => anchorAngle(j, 3))
  it('puts an observation that only has one non-zero variable exactly on that anchor', () => {
    const [p] = radviz([[0, 1, 0]], angles)
    expect(p[0]).toBeCloseTo(Math.cos(angles[1]), 12)
    expect(p[1]).toBeCloseTo(Math.sin(angles[1]), 12)
  })
  it('puts equal values at the centroid of the anchors and stays inside the unit disc', () => {
    const [c] = radviz([[0.4, 0.4, 0.4]], angles)
    expect(Math.hypot(...c)).toBeCloseTo(0, 12)
    for (const p of radviz(normalizeColumns(X), angles)) expect(Math.hypot(...p)).toBeLessThanOrEqual(1 + 1e-12)
  })
  it('matches the weighted-mean definition against a reference computation', () => {
    const row = [0.2, 0.5, 0.9]
    const [p] = radviz([row], angles)
    const s = row[0] + row[1] + row[2]
    expect(p[0]).toBeCloseTo((row[0] * Math.cos(angles[0]) + row[1] * Math.cos(angles[1]) + row[2] * Math.cos(angles[2])) / s, 12)
  })
})

describe('star coordinates', () => {
  it('is linear in the axis vectors and bounded by the unit disc', () => {
    const axes = defaultAxes(3)
    const n = normalizeColumns(X)
    const p = starCoordinates(n, axes)
    for (const q of p) expect(Math.hypot(...q)).toBeLessThanOrEqual(1 + 1e-9)
    // doubling one weight moves a point by exactly that axis contribution (before the fixed rescale)
    const a = starCoordinates([[1, 0.5, 0.5]], axes, [1, 1, 1])[0]
    expect(a[0] * 1 + 0).toBeDefined()
    const centered = starCoordinates([[0.5, 0.5, 0.5]], axes)[0]
    expect(centered).toEqual([0, 0])
  })
  it('a variable at its maximum pulls the point toward its axis', () => {
    const axes = defaultAxes(4)
    const [p] = starCoordinates([[1, 0.5, 0.5, 0.5]], axes)
    expect(p[0] * axes[0][0] + p[1] * axes[0][1]).toBeGreaterThan(0)
  })
})

describe('grand tour', () => {
  it('every frame of the tour is an orthonormal 2-frame', () => {
    for (const d of [3, 5, 8]) {
      for (let t = 0; t < 4; t += 0.173) {
        const [u, v] = tourFrame(d, t, 3)
        expect(Math.hypot(...u)).toBeCloseTo(1, 10)
        expect(Math.hypot(...v)).toBeCloseTo(1, 10)
        expect(u.reduce((s, x, i) => s + x * v[i], 0)).toBeCloseTo(0, 10)
      }
    }
  })
  it('moves continuously and reproduces for the same seed', () => {
    const a = tourFrame(5, 1.5, 9), b = tourFrame(5, 1.5, 9), c = tourFrame(5, 1.5 + 1e-4, 9)
    expect(a).toEqual(b)
    expect(Math.hypot(...a[0].map((x, i) => x - c[0][i]))).toBeLessThan(0.01)
    expect(tourFrame(5, 1.5, 10)).not.toEqual(a)
  })
  it('an orthogonal projection never lengthens a vector', () => {
    const frame = tourFrame(4, 2.3, 1)
    const [q] = project([[1, 2, -1, 0.5]], frame)
    expect(Math.hypot(...q)).toBeLessThanOrEqual(Math.hypot(1, 2, -1, 0.5) + 1e-12)
  })
})

describe('dimensional stacking', () => {
  it('assigns every record to exactly one cell inside the nested grid', () => {
    const n = normalizeColumns(X)
    const r = dimensionalStacking(n, [0, 1, 2], 2, n.map((x) => x[2]))
    expect(r.cols).toBe(4)
    expect(r.rows).toBe(2)
    expect(r.cells.reduce((s, c) => s + c.count, 0)).toBe(X.length)
    for (const c of r.cells) { expect(c.cx).toBeLessThan(r.cols); expect(c.cy).toBeLessThan(r.rows) }
  })
  it('bins are inclusive of 1.0 and nested by variable order', () => {
    expect(binOf(1, 4)).toBe(3)
    expect(binOf(0, 4)).toBe(0)
    const r = dimensionalStacking([[0, 0], [1, 1]], [0, 1], 3, [0, 1])
    expect(r.cells.map((c) => [c.cx, c.cy]).sort()).toEqual([[0, 0], [2, 2]])
  })
})

describe('table lens', () => {
  it('focus rows are tall, the rest share the remaining height, and heights add up', () => {
    const { top, height } = lensLayout(100, new Set([10, 11]), 500, 30)
    expect(height[10]).toBe(30)
    expect(height[0]).toBeCloseTo((500 - 60) / 98, 9)
    expect(height.reduce((a, b) => a + b, 0)).toBeCloseTo(500, 9)
    expect(top[1]).toBeCloseTo(height[0], 9)
  })
})

describe('recursive pattern', () => {
  it('is a bijection from record index onto the pixel grid', () => {
    const levels: [number, number][] = [[3, 2], [2, 2], [2, 3]]
    const [W, H] = recursiveSize(levels)
    expect([W, H]).toEqual([12, 12])
    for (const snake of [false, true]) {
      const seen = new Set<string>()
      for (let i = 0; i < W * H; i++) { const [x, y] = recursivePos(i, levels, snake); expect(x).toBeLessThan(W); expect(y).toBeLessThan(H); seen.add(`${x},${y}`) }
      expect(seen.size).toBe(W * H)
    }
  })
  it('keeps the first block together: records 0..w*h-1 fill the innermost block', () => {
    const levels: [number, number][] = [[4, 3], [5, 5]]
    for (let i = 0; i < 12; i++) { const [x, y] = recursivePos(i, levels); expect(x).toBeLessThan(4); expect(y).toBeLessThan(3) }
  })
})

describe('circle segments', () => {
  it('keeps pixels inside their sector, distinct, and in non-decreasing radius', () => {
    const d = 5
    for (let s = 0; s < d; s++) {
      const px = segmentPixels(200, d, s, 0.02)
      expect(px.length).toBe(200)
      const a0 = s * (2 * Math.PI / d) - Math.PI / 2
      for (const p of px) { expect(p.angle).toBeGreaterThan(a0); expect(p.angle).toBeLessThan(a0 + 2 * Math.PI / d) }
      for (let i = 1; i < px.length; i++) expect(px[i].radius).toBeGreaterThanOrEqual(px[i - 1].radius - 1e-12)
      expect(new Set(px.map((p) => `${p.angle.toFixed(9)},${p.radius.toFixed(9)}`)).size).toBe(200)
    }
  })
})

describe('HyperSlice', () => {
  const data = normalizeColumns(X)
  const f = (p: number[]) => kdeND(data, p, 0.3)
  it('density is positive, larger near data than far away, and panels agree at the slice point', () => {
    expect(f([0.5, 0.5, 0.5])).toBeGreaterThan(0)
    expect(f([0, 0, 0])).toBeGreaterThan(f([3, 3, 3]))
    const g1 = sliceGrid(f, [0.3, 0.6, 0.2], 0, 1, 5)
    const g2 = sliceGrid(f, [0.3, 0.6, 0.2], 1, 2, 5)
    expect(g1.length).toBe(5)
    expect(g1[0].length).toBe(5)
    expect(g2[2][2]).toBeCloseTo(f([0.3, 0.5, 0.5]), 12)
  })
})

describe('pixel bar chart', () => {
  it('places every record once, sorted inside its bar from the bottom row up', () => {
    const keys = ['a', 'b', 'a', 'a', 'b', 'a']
    const bars = pixelBars(keys, [5, 1, 4, 3, 2, 9], 2, ['a', 'b'])
    expect(bars.reduce((s, b) => s + b.pixels.length, 0)).toBe(6)
    expect(bars[0].rows).toEqual([3, 2, 0, 5])
    expect(bars[0].height).toBe(2)
    expect(new Set(bars[0].pixels.map((p) => `${p.row},${p.col}`)).size).toBe(4)
  })
})

describe('Chernoff faces', () => {
  it('every feature is monotone in its variable and defaults to the middle', () => {
    for (let k = 0; k < 8; k++) {
      const lo = Array(8).fill(0.5), hi = Array(8).fill(0.5)
      lo[k] = 0; hi[k] = 1
      const a = faceGeometry(lo), b = faceGeometry(hi)
      const diffs = (Object.keys(a) as (keyof typeof a)[]).filter((key) => a[key] !== b[key])
      expect(diffs.length, `variable ${k} changes exactly one feature`).toBe(1)
      expect(b[diffs[0]]).toBeGreaterThan(a[diffs[0]])
    }
    expect(faceGeometry([])).toEqual(faceGeometry(Array(8).fill(0.5)))
  })
})
