import { describe, expect, it } from 'vitest'
import { domainColor, julia, makeNewtonFast, makePoly, mandelbrot, mandelbrotArea, newtonBasin, polyRoots, rational, type Complex } from './fractal'

describe('Mandelbrot and Julia sets', () => {
  it('known points: 0, −2 and 0.25 are inside, 1 escapes at the third step, large |c| escapes immediately', () => {
    expect(mandelbrot(0, 0, 200)).toBe(-1)
    expect(mandelbrot(-2, 0, 200)).toBe(-1)
    expect(mandelbrot(0.25, 0, 300)).toBe(-1)
    expect(mandelbrot(1, 0, 50)).toBeGreaterThan(2)
    expect(mandelbrot(1, 0, 50)).toBeLessThan(5)
    expect(mandelbrot(3, 3, 50)).toBeLessThan(2)
    expect(mandelbrot(-0.12, 0.74, 200)).toBe(-1) // inside the period-3 bulb... near the boundary region of a satellite
  })
  it('the escape time grows without bound towards the boundary (c = 0.26 escapes late, 0.4 early)', () => {
    expect(mandelbrot(0.26, 0, 5000)).toBeGreaterThan(mandelbrot(0.3, 0, 5000))
    expect(mandelbrot(0.3, 0, 5000)).toBeGreaterThan(mandelbrot(0.5, 0, 5000))
  })
  it('the set is symmetric about the real axis and its area is close to 1.5066', () => {
    expect(mandelbrot(-0.7, 0.3, 120)).toBeCloseTo(mandelbrot(-0.7, -0.3, 120), 12)
    expect(mandelbrotArea(320, 200)).toBeGreaterThan(1.48)
    expect(mandelbrotArea(320, 200)).toBeLessThan(1.62)
  })
  it('the power-3 set is accepted too and is symmetric under c → −c rotation by 2π/(p−1)', () => {
    expect(mandelbrot(0, 0, 100, 3)).toBe(-1)
    expect(mandelbrot(2, 0, 100, 3)).toBeGreaterThan(0)
    expect(Math.sign(mandelbrot(0.3, 0.1, 100, 3))).toBe(Math.sign(mandelbrot(-0.3, -0.1, 100, 3)))
  })
  it('Julia set of c = 0 is the closed unit disc; c = −1 keeps the origin (period-2 cycle) bounded', () => {
    expect(julia(0.5, 0.5, 0, 0, 200)).toBe(-1)
    expect(julia(1.2, 0, 0, 0, 200)).toBeGreaterThan(0)
    expect(julia(0, 0, -1, 0, 300)).toBe(-1)
    expect(julia(0.3, 0.2, -0.8, 0.156, 100)).toBeCloseTo(julia(-0.3, -0.2, -0.8, 0.156, 100), 12)
  })
})

describe('Newton basins', () => {
  const cube: Complex[] = [[-1, 0], [0, 0], [0, 0], [1, 0]]
  it('Durand–Kerner finds the cube roots of unity and the roots of a quadratic', () => {
    const r = polyRoots(cube).sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]))
    expect(r.every(([x, y]) => Math.abs(Math.hypot(x, y) - 1) < 1e-9)).toBe(true)
    expect(r.map(([x, y]) => Math.round((Math.atan2(y, x) * 180) / Math.PI))).toEqual([-120, 0, 120])
    const q = polyRoots([[2, 0], [-3, 0], [1, 0]]).map((v) => v[0]).sort()
    expect(q[0]).toBeCloseTo(1, 9); expect(q[1]).toBeCloseTo(2, 9)
  })
  it('points near a root converge to it in few steps, and rotating a start by 120° rotates the root', () => {
    const p = makePoly(cube)
    const a = newtonBasin([1.3, 0.1], p, 60)
    expect(p.roots[a.root][0]).toBeCloseTo(1, 6)
    expect(a.iter).toBeLessThan(10)
    const c = Math.cos((2 * Math.PI) / 3), s = Math.sin((2 * Math.PI) / 3)
    const z0: Complex = [0.7, 0.4]
    const rot: Complex = [z0[0] * c - z0[1] * s, z0[0] * s + z0[1] * c]
    const r1 = p.roots[newtonBasin(z0, p, 60).root], r2 = p.roots[newtonBasin(rot, p, 60).root]
    expect(r2[0]).toBeCloseTo(r1[0] * c - r1[1] * s, 5)
    expect(r2[1]).toBeCloseTo(r1[0] * s + r1[1] * c, 5)
  })
  it('the allocation-free version agrees with the reference implementation on a grid', () => {
    const p = makePoly([[2, 0], [-2, 0], [0, 0], [1, 0]])
    const fast = makeNewtonFast(p)
    for (let i = 0; i < 25; i++) for (let j = 0; j < 25; j++) { const z: Complex = [-2 + i * 0.16, -2 + j * 0.16]; const a = newtonBasin(z, p, 50), b = fast(z[0], z[1], 50, 1); expect(b.root).toBe(a.root); expect(b.iter).toBe(a.iter) }
  })
  it('the basin boundary is fractal: a tiny window around the origin-adjacent boundary contains all three roots', () => {
    const p = makePoly(cube)
    const seen = new Set<number>()
    for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) seen.add(newtonBasin([-0.05 + i * 0.0025, -0.05 + j * 0.0025], p, 80).root)
    expect(seen.size).toBeGreaterThanOrEqual(3)
  })
})

describe('domain colouring', () => {
  it('a rational function vanishes at its zeros and blows up at its poles', () => {
    const zeros: Complex[] = [[1, 0], [-1, 0]], poles: Complex[] = [[0, 1]]
    expect(Math.hypot(...rational([1, 0], zeros, poles))).toBe(0)
    expect(Math.hypot(...rational([0.001, 1], zeros, poles))).toBeGreaterThan(900)
    const w = rational([2, 0], zeros, poles)
    expect(w[0]).toBeCloseTo(6 / 5, 12) // (2−1)(2+1)/(2−i) = 3(2+i)/5
    expect(w[1]).toBeCloseTo(3 / 5, 12)
  })
  it('hue encodes the argument: positive reals and negative reals map to opposite hues, |w| sets the lightness band', () => {
    const [r1, , b1] = domainColor([1, 0], { modulus: false, phase: false })
    const [r2, , b2] = domainColor([-1, 0], { modulus: false, phase: false })
    expect(r1).toBeGreaterThan(b1)
    expect(b2 + r2).toBeGreaterThan(0)
    expect(domainColor([1e-30, 0])).toEqual([0, 0, 0])
    expect(domainColor([1e30, 0])).toEqual([255, 255, 255])
  })
})
