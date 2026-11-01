import { describe, expect, it } from 'vitest'
import { createRng } from '../lib/random'
import { FLOWS, R_GAS, bandPath, bandsAt, dos, eutectic, fccLattice, integrate, leverRule, liquidusX, ljMonteCarlo, lyapunov, poincareSection, rdf, rk4Step, type V3 } from './physics'

const defaults = (id: keyof typeof FLOWS) => FLOWS[id].params.map((p) => p.def)

describe('chaotic flows', () => {
  it('the Lorenz fixed points have zero derivative and RK4 is fourth-order accurate', () => {
    const p = defaults('lorenz')
    const c = Math.sqrt(p[2] * (p[1] - 1))
    const d = FLOWS.lorenz.f(p, [c, c, p[1] - 1])
    expect(Math.hypot(...d)).toBeLessThan(1e-12)
    const f = (s: V3) => FLOWS.lorenz.f(p, s)
    const T = 0.4
    const run = (dt: number) => { let s: V3 = [1, 1, 1]; for (let i = 0; i < T / dt; i++) s = rk4Step(f, s, dt); return s }
    const ref = run(0.0005), e1 = Math.hypot(...run(0.02).map((v, i) => v - ref[i])), e2 = Math.hypot(...run(0.01).map((v, i) => v - ref[i]))
    expect(e1 / e2).toBeGreaterThan(12)
    expect(e1 / e2).toBeLessThan(20)
  })
  it('the Lorenz attractor stays bounded and its largest Lyapunov exponent is ≈ 0.9', () => {
    const p = defaults('lorenz')
    const tr = integrate(FLOWS.lorenz, p, FLOWS.lorenz.start, 0.005, 20000, 4000)
    expect(Math.max(...tr.map((s) => Math.hypot(...s)))).toBeLessThan(80)
    const l = lyapunov(FLOWS.lorenz, p, FLOWS.lorenz.start, 0.005, 120000)
    expect(l).toBeGreaterThan(0.75)
    expect(l).toBeLessThan(1.05)
  })
  it('a non-chaotic parameter set has a non-positive exponent (Rössler with c = 2.5 is a limit cycle)', () => {
    const l = lyapunov(FLOWS.rossler, [0.2, 0.2, 2.5], FLOWS.rossler.start, 0.02, 40000)
    expect(l).toBeLessThan(0.02)
    expect(lyapunov(FLOWS.rossler, defaults('rossler'), FLOWS.rossler.start, 0.02, 60000)).toBeGreaterThan(0.03)
  })
  it('the Poincaré section of a circle at x = 0 has one point per turn at the right place', () => {
    const circle: V3[] = Array.from({ length: 2001 }, (_, i) => [Math.cos(i * 0.01 + 0.3), Math.sin(i * 0.01 + 0.3), 0.5])
    const s = poincareSection(circle, 0, 0, 1)
    const turns = (2000 * 0.01) / (2 * Math.PI)
    expect(s.length).toBeGreaterThanOrEqual(Math.floor(turns))
    for (const q of s) { expect(Math.abs(q.u + 1)).toBeLessThan(1e-3); expect(q.v).toBeCloseTo(0.5, 12) } // x decreasing through 0 happens at y = −1 for direction +1? (see below)
  })
  it('the Rössler section x = 0 collects points on a thin curve (return map is single-valued)', () => {
    const tr = integrate(FLOWS.rossler, defaults('rossler'), FLOWS.rossler.start, 0.01, 200000, 20000)
    const s = poincareSection(tr, 0, 0, 1)
    expect(s.length).toBeGreaterThan(200)
    const z = s.map((q) => q.v)
    // consecutive-return map z_{n+1} = F(z_n): sort by z_n and check it is nearly a function (low variation of neighbours)
    const pairs = z.slice(0, -1).map((v, i) => [v, z[i + 1]] as const).sort((a, b) => a[0] - b[0])
    const jumps = pairs.slice(1).map((q, i) => Math.abs(q[1] - pairs[i][1]))
    jumps.sort((a, b) => a - b)
    expect(jumps[Math.floor(jumps.length * 0.9)]).toBeLessThan(0.6)
  })
})

describe('radial distribution function', () => {
  it('an ideal gas has g(r) ≈ 1', () => {
    const rng = createRng(3), L = 10
    const pos: V3[] = Array.from({ length: 900 }, () => [rng() * L, rng() * L, rng() * L])
    const g = rdf(pos, L, 0.25, 5)
    const mid = g.g.slice(6)
    expect(mid.reduce((a, b) => a + b, 0) / mid.length).toBeCloseTo(1, 1)
    expect(g.density).toBeCloseTo(0.9, 6)
  })
  it('an fcc crystal has its first peak at a/√2 and 12 nearest neighbours', () => {
    const a = 1.6, { pos, box } = fccLattice(4, a)
    const g = rdf(pos, box, 0.02, 3)
    const peak = g.g.reduce((best, v, i) => (v > g.g[best] ? i : best), 0)
    expect(g.r[peak]).toBeCloseTo(a / Math.SQRT2, 1)
    const before = g.coordination[g.r.findIndex((r) => r > a / Math.SQRT2 + 0.05)]
    expect(before).toBeCloseTo(12, 0)
  })
  it('a Lennard-Jones liquid shows the correlation hole (g ≈ 0 below σ) and a first peak near 1.1σ', () => {
    const { pos, box } = ljMonteCarlo(108, 0.8, 1.2, 60, 5)
    const g = rdf(pos, box, 0.05, 2.6)
    expect(Math.max(...g.g.filter((_, i) => g.r[i] < 0.8))).toBeLessThan(0.05)
    const peak = g.g.reduce((best, v, i) => (v > g.g[best] ? i : best), 0)
    expect(g.r[peak]).toBeGreaterThan(1.0)
    expect(g.r[peak]).toBeLessThan(1.3)
    expect(g.g[peak]).toBeGreaterThan(1.5)
  })
})

describe('tight-binding bands and density of states', () => {
  const p = { eps: 0, t1: 1, t2: 0.6, delta: 0 }
  it('the chain band is ε − 2t cos k with width 4t', () => {
    expect(bandsAt('chain', p, 0, 0)[0]).toBeCloseTo(-2, 12)
    expect(bandsAt('chain', p, 0.5, 0)[0]).toBeCloseTo(2, 12)
    expect(bandsAt('chain', p, 0.25, 0)[0]).toBeCloseTo(0, 12)
  })
  it('the SSH chain has a gap 2|t1 − t2| at the zone boundary and graphene closes its gap at K', () => {
    const e = bandsAt('ssh', p, 0.5, 0)
    expect(e[1] - e[0]).toBeCloseTo(2 * Math.abs(p.t1 - p.t2), 12)
    const k = bandsAt('graphene', p, 2 / 3, 1 / 3)
    expect(k[1] - k[0]).toBeLessThan(1e-12)
    const g = bandsAt('graphene', p, 0, 0)
    expect(g[1]).toBeCloseTo(3 * p.t1, 12)
    expect(bandsAt('graphene', { ...p, delta: 0.4 }, 2 / 3, 1 / 3)[1]).toBeCloseTo(0.4, 9)
  })
  it('band paths visit the high-symmetry points and produce the right number of bands', () => {
    const path = bandPath('graphene', p, 40)
    expect(path.bands.length).toBe(path.k.length)
    expect(path.bands[0].length).toBe(2)
    expect(path.k[path.k.length - 1]).toBeCloseTo(3, 12)
  })
  it('the density of states integrates to the number of bands and reproduces the 1/√ band-edge singularity of the chain', () => {
    const E = Array.from({ length: 401 }, (_, i) => -4 + (8 * i) / 400)
    const d = dos('chain', p, E, 0.05, 3000)
    expect(d.reduce((a, v) => a + v, 0) * (8 / 400)).toBeCloseTo(1, 2)
    const exact = (e: number) => 1 / (Math.PI * Math.sqrt(4 - e * e))
    expect(d[200]).toBeCloseTo(exact(0), 1)
    expect(d[Math.round((1.9 + 4) * 50)]).toBeGreaterThan(d[200] * 1.8)
    const sq = dos('square', p, E, 0.1, 10, 100)
    expect(sq.reduce((a, v) => a + v, 0) * (8 / 400)).toBeCloseTo(1, 1)
    expect(Math.max(...sq)).toBe(sq[200]) // van Hove peak at the band centre
    const ss = dos('ssh', p, E, 0.05, 3000)
    expect(ss.reduce((a, v) => a + v, 0) * (8 / 400)).toBeCloseTo(2, 1)
    expect(ss[200]).toBeLessThan(1e-3) // the gap
  })
})

describe('binary eutectic phase diagram', () => {
  const a = { name: 'A', tm: 1000, hf: R_GAS * 1000 }
  it('two identical components meet at T = Tm/(1 + ln 2) and x = ½; the liquidus equals 1 at Tm', () => {
    const e = eutectic(a, { ...a, name: 'B' })!
    expect(e.T).toBeCloseTo(1000 / (1 + Math.LN2), 6)
    expect(e.xB).toBeCloseTo(0.5, 6)
    expect(liquidusX(a, 1000)).toBe(1)
    expect(liquidusX(a, 800)).toBeLessThan(1)
  })
  it('the eutectic lies below both melting points and satisfies x_A + x_B = 1; Bi–Cd lands near the real 413 K', () => {
    const bi = { name: 'Bi', tm: 544.5, hf: 11100 }, cd = { name: 'Cd', tm: 594.2, hf: 6190 }
    const e = eutectic(bi, cd)!
    expect(e.T).toBeLessThan(544.5)
    expect(liquidusX(bi, e.T) + liquidusX(cd, e.T)).toBeCloseTo(1, 9)
    expect(e.T).toBeGreaterThan(395)
    expect(e.T).toBeLessThan(440)
  })
  it('the lever rule fractions sum to one and reduce to the liquidus composition on the boundary', () => {
    const b = { ...a, name: 'B', tm: 900, hf: R_GAS * 900 }
    const e = eutectic(a, b)!
    const T = (a.tm + e.T) / 2
    const x0 = 0.5 * (1 - liquidusX(a, T)) // inside the A + liquid region
    const r = leverRule(a, b, x0, T)!
    expect(r.phases).toBe('고상 A + 액상')
    expect(r.liquid + r.solidA + r.solidB).toBeCloseTo(1, 12)
    expect(r.liquid).toBeCloseTo(x0 / (1 - liquidusX(a, T)), 12)
    expect(leverRule(a, b, 0.5, e.T - 10)!.phases).toBe('고상 A + 고상 B')
    expect(leverRule(a, b, 0.5, 1200)!.phases).toBe('액상 (L)')
  })
})
