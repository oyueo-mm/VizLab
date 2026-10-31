import { describe, expect, it } from 'vitest'
import { attractor, classifyLinear, linearField, lyapunov, maps1d, periodOf, phaseSystems, rk4, trajectory } from './dynamics'
import { cwt, dominantFrequency, embed, fft, nextPow2, recurrencePlot, stft, windowFn } from './signal'

const sine = (n: number, f: number, amp = 1, phase = 0) => Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * f * i + phase))

describe('FFT, STFT and wavelets', () => {
  it('the FFT matches the direct DFT, inverts back, and satisfies Parseval', () => {
    const n = 16
    const x = Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1) + i / 10)
    const re = Float64Array.from(x), im = new Float64Array(n)
    fft(re, im)
    for (const k of [0, 1, 5, 8]) {
      let dr = 0, di = 0
      for (let t = 0; t < n; t++) { dr += x[t] * Math.cos((2 * Math.PI * k * t) / n); di -= x[t] * Math.sin((2 * Math.PI * k * t) / n) }
      expect(re[k]).toBeCloseTo(dr, 9)
      expect(im[k]).toBeCloseTo(di, 9)
    }
    const e1 = x.reduce((a, v) => a + v * v, 0), e2 = Array.from(re).reduce((a, v, k) => a + v * v + im[k] * im[k], 0) / n
    expect(e2).toBeCloseTo(e1, 8)
    fft(re, im, true)
    x.forEach((v, i) => expect(re[i]).toBeCloseTo(v, 9))
    expect(nextPow2(100)).toBe(128)
  })
  it('windows have the textbook shape', () => {
    const h = windowFn('hann', 9)
    expect(h[0]).toBeCloseTo(0, 12)
    expect(h[4]).toBeCloseTo(1, 12)
    expect(windowFn('rect', 4)).toEqual(Float64Array.from([1, 1, 1, 1]))
    expect(windowFn('hamming', 5)[0]).toBeCloseTo(0.08, 12)
  })
  it('the spectrogram of a sine peaks at its frequency in every frame, and follows a chirp upward', () => {
    const f = 0.125
    const sp = stft(sine(1024, f), 128, 64)
    for (const frame of sp.mag) {
      const k = frame.indexOf(Math.max(...frame))
      expect(sp.freqs[k]).toBeCloseTo(f, 2)
    }
    expect(Math.max(...sp.mag[3])).toBeCloseTo(1, 1) // amplitude 1 under the Hann window correction
    const chirp = Array.from({ length: 2048 }, (_, i) => Math.sin(2 * Math.PI * (0.02 * i + (0.1 * i * i) / 2048)))
    const sc = stft(chirp, 128, 128)
    const peak = (fr: Float64Array) => sc.freqs[fr.indexOf(Math.max(...fr))]
    expect(peak(sc.mag[sc.mag.length - 1])).toBeGreaterThan(peak(sc.mag[0]) + 0.05)
    expect(dominantFrequency(sine(512, 0.0625))).toBeCloseTo(0.0625, 3)
  })
  it('the scalogram of a sine concentrates at the matching pseudo-frequency', () => {
    const x = sine(512, 0.1)
    const freqs = [0.03, 0.05, 0.08, 0.1, 0.13, 0.2, 0.3]
    const sg = cwt(x, freqs)
    const mid = sg.mag.map((row) => row[256])
    expect(freqs[mid.indexOf(Math.max(...mid))]).toBe(0.1)
  })
  it('a recurrence plot is symmetric with a full main diagonal; a periodic series gives long diagonals, noise does not', () => {
    const per = recurrencePlot(sine(200, 1 / 20), 2, 5, 0.12)
    for (let i = 0; i < per.n; i++) { expect(per.r[i * per.n + i]).toBe(1); for (const j of [0, 7, 33]) expect(per.r[i * per.n + j]).toBe(per.r[j * per.n + i]) }
    // a sample 20 steps later is the same phase of the cycle
    expect(per.r[10 * per.n + 30]).toBe(1)
    expect(per.determinism).toBeGreaterThan(0.6)
    let seed = 7
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    const noise = recurrencePlot(Array.from({ length: 200 }, rnd), 2, 1, 0.12)
    expect(noise.determinism).toBeLessThan(per.determinism - 0.2)
    expect(embed([1, 2, 3, 4, 5], 2, 2)).toEqual([[1, 3], [2, 4], [3, 5]])
  })
})

describe('dynamical systems', () => {
  it('RK4 conserves the pendulum energy and the Lotka–Volterra invariant over long runs, and halves its error per step doubling by 16×', () => {
    const pend = phaseSystems.find((s) => s.id === 'pendulum')!
    const p0 = { damping: 0 }
    const H = pend.invariant!(p0)
    const tr = trajectory(pend.field(p0), [1.2, 0], 0.01, 5000)
    expect(Math.max(...tr.map((p) => Math.abs(H(p[0], p[1]) - H(1.2, 0))))).toBeLessThan(1e-7)
    const lv = phaseSystems.find((s) => s.id === 'lotka-volterra')!
    const q = { a: 1, c: 1 }
    const I = lv.invariant!(q)
    const tl = trajectory(lv.field(q), [1.5, 1], 0.01, 4000)
    expect(Math.max(...tl.map((p) => Math.abs(I(p[0], p[1]) - I(1.5, 1))))).toBeLessThan(1e-6)
    const f = (x: number) => [x, 0] as [number, number]
    const exact = Math.exp(1)
    const e1 = Math.abs(rk4Run(f, 0.1) - exact), e2 = Math.abs(rk4Run(f, 0.05) - exact)
    expect(e1 / e2).toBeGreaterThan(14)
  })
  it('the damped pendulum spirals to the origin and the van der Pol oscillator reaches its limit cycle from inside and outside', () => {
    const pend = phaseSystems.find((s) => s.id === 'pendulum')!
    const end = trajectory(pend.field({ damping: 0.4 }), [2, 0], 0.02, 3000).pop()!
    expect(Math.hypot(end[0], end[1])).toBeLessThan(0.05)
    const vdp = phaseSystems.find((s) => s.id === 'van-der-pol')!
    const amp = (p0: [number, number]) => Math.max(...trajectory(vdp.field({ mu: 1 }), p0, 0.01, 12000).slice(-4000).map((p) => Math.abs(p[0])))
    expect(amp([0.1, 0])).toBeCloseTo(amp([4, 4]), 1)
    expect(amp([0.1, 0])).toBeGreaterThan(1.9)
  })
  it('linear systems are classified by trace and determinant and the field has the stated eigenvalues', () => {
    expect(classifyLinear(-1, 2)).toMatch(/안정한 나선/)
    expect(classifyLinear(3, 1)).toMatch(/불안정 마디/)
    expect(classifyLinear(0, 1)).toMatch(/중심/)
    expect(classifyLinear(1, -2)).toMatch(/안장/)
    const f = linearField(-3, 2) // eigenvalues −1 and −2
    const [vx] = f(1, 0), [, vy] = f(0, 1)
    expect(vx).toBeCloseTo(-1, 9)
    expect(vy).toBeCloseTo(-2, 9)
  })
  it('the logistic map has the textbook behaviour: fixed point, period 2, period 4, chaos with λ(4) = ln 2', () => {
    expect(periodOf(attractor('logistic', 2.8, 800, 64))).toBe(1)
    expect(attractor('logistic', 2.8, 800, 1)[0]).toBeCloseTo(1 - 1 / 2.8, 6)
    expect(periodOf(attractor('logistic', 3.2, 800, 64))).toBe(2)
    expect(periodOf(attractor('logistic', 3.5, 800, 64))).toBe(4)
    expect(periodOf(attractor('logistic', 3.9, 800, 64))).toBeGreaterThan(20)
    expect(lyapunov('logistic', 4, 200, 20000)).toBeCloseTo(Math.log(2), 1)
    expect(lyapunov('logistic', 3.2)).toBeLessThan(0)
    expect(lyapunov('logistic', 3.9)).toBeGreaterThan(0)
    expect(maps1d.tent.f(2, 0.3)).toBeCloseTo(0.6, 12)
  })
})

function rk4Run(f: (x: number) => [number, number], dt: number): number {
  let p: [number, number] = [1, 0]
  for (let i = 0; i < Math.round(1 / dt); i++) p = rk4((x) => [x, 0], p, dt)
  void f
  return p[0]
}
