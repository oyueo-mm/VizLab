import { createRng } from '../lib/random'

/** Physics engine: 3-D chaotic flows with Poincaré sections, radial distribution functions, tight-binding bands and density of states, and binary eutectic phase diagrams. */

// ─── chaotic flows ──────────────────────────────────────────────────────────────────

export type V3 = [number, number, number]
export type FlowId = 'lorenz' | 'rossler' | 'thomas' | 'aizawa'

export interface FlowDef {
  name: string
  /** Parameter names exactly as they appear in the data table, with defaults. */
  params: { key: string; def: number }[]
  f: (p: readonly number[], s: V3) => V3
  start: V3
  dt: number
  /** Typical half-size of the attractor, used to fit it in a view. */
  extent: V3
  center: V3
}

export const FLOWS: Record<FlowId, FlowDef> = {
  lorenz: {
    name: '로렌츠 계', params: [{ key: 'Lorenz σ', def: 10 }, { key: 'Lorenz ρ', def: 28 }, { key: 'Lorenz β', def: 8 / 3 }],
    f: (p, [x, y, z]) => [p[0] * (y - x), x * (p[1] - z) - y, x * y - p[2] * z], start: [1, 1, 1], dt: 0.005, extent: [22, 28, 26], center: [0, 0, 25],
  },
  rossler: {
    name: '뢰슬러 계', params: [{ key: 'Rössler a', def: 0.2 }, { key: 'Rössler b', def: 0.2 }, { key: 'Rössler c', def: 5.7 }],
    f: (p, [x, y, z]) => [-y - z, x + p[0] * y, p[1] + z * (x - p[2])], start: [1, 1, 0], dt: 0.02, extent: [12, 12, 14], center: [0, 0, 12],
  },
  thomas: {
    name: '토마스 순환 대칭 계', params: [{ key: 'Thomas b', def: 0.208 }],
    f: (p, [x, y, z]) => [Math.sin(y) - p[0] * x, Math.sin(z) - p[0] * y, Math.sin(x) - p[0] * z], start: [0.1, 0, 0.2], dt: 0.05, extent: [4.5, 4.5, 4.5], center: [0, 0, 0],
  },
  aizawa: {
    name: '아이자와 계', params: [{ key: 'Aizawa a', def: 0.95 }, { key: 'Aizawa b', def: 0.7 }, { key: 'Aizawa c', def: 0.6 }, { key: 'Aizawa d', def: 3.5 }, { key: 'Aizawa e', def: 0.25 }, { key: 'Aizawa f', def: 0.1 }],
    f: (p, [x, y, z]) => [(z - p[1]) * x - p[3] * y, p[3] * x + (z - p[1]) * y, p[2] + p[0] * z - (z ** 3) / 3 - (x * x + y * y) * (1 + p[4] * z) + p[5] * z * x ** 3], start: [0.1, 0, 0], dt: 0.01, extent: [1.6, 1.6, 1.6], center: [0, 0, 0.2],
  },
}

/** Classical fourth-order Runge–Kutta step. */
export function rk4Step(f: (s: V3) => V3, s: V3, dt: number): V3 {
  const k1 = f(s)
  const k2 = f([s[0] + (dt / 2) * k1[0], s[1] + (dt / 2) * k1[1], s[2] + (dt / 2) * k1[2]])
  const k3 = f([s[0] + (dt / 2) * k2[0], s[1] + (dt / 2) * k2[1], s[2] + (dt / 2) * k2[2]])
  const k4 = f([s[0] + dt * k3[0], s[1] + dt * k3[1], s[2] + dt * k3[2]])
  return [s[0] + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]), s[1] + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]), s[2] + (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2])]
}

/** Trajectory sampled every step after discarding `skip` transient steps. */
export function integrate(flow: FlowDef, p: readonly number[], x0: V3, dt: number, steps: number, skip = 0): V3[] {
  const f = (s: V3) => flow.f(p, s)
  let s = x0
  for (let i = 0; i < skip; i++) s = rk4Step(f, s, dt)
  const out: V3[] = [s]
  for (let i = 0; i < steps; i++) { s = rk4Step(f, s, dt); out.push(s) }
  return out
}

/** Largest Lyapunov exponent by the Benettin two-trajectory method with periodic renormalisation. */
export function lyapunov(flow: FlowDef, p: readonly number[], x0: V3, dt: number, steps: number, skip = 2000): number {
  const f = (s: V3) => flow.f(p, s)
  let a = x0
  for (let i = 0; i < skip; i++) a = rk4Step(f, a, dt)
  const d0 = 1e-8
  let b: V3 = [a[0] + d0, a[1], a[2]]
  let sum = 0
  const every = 10
  for (let i = 0; i < steps; i += every) {
    for (let k = 0; k < every; k++) { a = rk4Step(f, a, dt); b = rk4Step(f, b, dt) }
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || d0
    sum += Math.log(d / d0)
    b = [a[0] + ((b[0] - a[0]) * d0) / d, a[1] + ((b[1] - a[1]) * d0) / d, a[2] + ((b[2] - a[2]) * d0) / d]
  }
  return sum / (steps * dt)
}

/** Points where the trajectory crosses the plane coordinate[axis] = level in the given direction (linear interpolation between samples). Returns the other two coordinates and the crossing time index. */
export function poincareSection(traj: readonly V3[], axis: 0 | 1 | 2, level: number, direction: 1 | -1 | 0 = 1): { u: number; v: number; t: number }[] {
  const others = [0, 1, 2].filter((k) => k !== axis) as [number, number]
  const out: { u: number; v: number; t: number }[] = []
  for (let i = 1; i < traj.length; i++) {
    const a = traj[i - 1][axis] - level, b = traj[i][axis] - level
    if (a === b || a * b > 0 || (a === 0 && b === 0)) continue
    const up = b > a
    if ((direction === 1 && !up) || (direction === -1 && up)) continue
    const w = a / (a - b)
    out.push({ u: traj[i - 1][others[0]] + w * (traj[i][others[0]] - traj[i - 1][others[0]]), v: traj[i - 1][others[1]] + w * (traj[i][others[1]] - traj[i - 1][others[1]]), t: i - 1 + w })
  }
  return out
}

// ─── structure: radial distribution function ───────────────────────────────────────

export function fccLattice(cells: number, a: number): { pos: V3[]; box: number } {
  const basis: V3[] = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]]
  const pos: V3[] = []
  for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) for (let k = 0; k < cells; k++) for (const b of basis) pos.push([(i + b[0]) * a, (j + b[1]) * a, (k + b[2]) * a])
  return { pos, box: cells * a }
}

/** Hard-sphere-like liquid: Metropolis Monte Carlo of a Lennard-Jones fluid (σ = 1, ε = 1) in a periodic cube, started from a lattice. */
export function ljMonteCarlo(n: number, density: number, temperature: number, sweeps: number, seed: number): { pos: V3[]; box: number } {
  const cells = Math.ceil((n / 4) ** (1 / 3))
  const box = (n / density) ** (1 / 3)
  const a = box / cells
  const { pos: all } = fccLattice(cells, a)
  const pos = all.slice(0, n).map((p) => [...p] as V3)
  const rng = createRng(seed)
  const rc = Math.min(2.5, box / 2)
  const lj = (r2: number) => { if (r2 > rc * rc) return 0; const i6 = 1 / r2 ** 3; return 4 * (i6 * i6 - i6) }
  const d2 = (p: V3, q: V3) => { let s = 0; for (let k = 0; k < 3; k++) { let d = p[k] - q[k]; d -= box * Math.round(d / box); s += d * d } return s }
  const step = 0.12 * Math.min(1, 0.9 / Math.cbrt(density))
  for (let sw = 0; sw < sweeps; sw++) {
    for (let m = 0; m < pos.length; m++) {
      const i = Math.floor(rng() * pos.length)
      const old = pos[i]
      const trial: V3 = [old[0] + (rng() - 0.5) * 2 * step, old[1] + (rng() - 0.5) * 2 * step, old[2] + (rng() - 0.5) * 2 * step]
      let dE = 0
      for (let j = 0; j < pos.length; j++) if (j !== i) dE += lj(d2(trial, pos[j])) - lj(d2(old, pos[j]))
      if (dE <= 0 || rng() < Math.exp(-dE / temperature)) pos[i] = [(trial[0] + box) % box, (trial[1] + box) % box, (trial[2] + box) % box]
    }
  }
  return { pos, box }
}

export interface Rdf { r: number[]; g: number[]; /** Running coordination number n(r) = 4πρ ∫ g r² dr. */ coordination: number[]; density: number }

/** Radial distribution function with periodic minimum-image distances: g(r) = 2·V·count(r, r+dr) / (N² · 4π r² dr). */
export function rdf(pos: readonly V3[], box: number, dr: number, rmax: number): Rdf {
  const n = pos.length
  const nb = Math.max(1, Math.floor(Math.min(rmax, box / 2) / dr))
  const hist = new Array<number>(nb).fill(0)
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    let s = 0
    for (let k = 0; k < 3; k++) { let d = pos[i][k] - pos[j][k]; d -= box * Math.round(d / box); s += d * d }
    const b = Math.floor(Math.sqrt(s) / dr)
    if (b < nb) hist[b] += 2
  }
  const rho = n / box ** 3
  const r = hist.map((_, b) => (b + 0.5) * dr)
  const g = hist.map((c, b) => c / (n * rho * ((4 / 3) * Math.PI * (((b + 1) * dr) ** 3 - (b * dr) ** 3))))
  let acc = 0
  const coordination = g.map((v, b) => { acc += 4 * Math.PI * rho * v * r[b] ** 2 * dr; return acc })
  return { r, g, coordination, density: rho }
}

// ─── tight-binding bands and density of states ──────────────────────────────────────

export type LatticeId = 'chain' | 'ssh' | 'square' | 'graphene'
export interface TbParams { eps: number; t1: number; t2: number; delta: number }

/** Energies of every band at fractional reciprocal coordinates (u, v) in [0, 1). */
export function bandsAt(model: LatticeId, p: TbParams, u: number, v: number): number[] {
  const tau = 2 * Math.PI
  switch (model) {
    case 'chain': return [p.eps - 2 * p.t1 * Math.cos(tau * u)]
    case 'ssh': {
      // two sites per cell, hoppings t1 (inside the cell) and t2 (between cells), on-site ±Δ
      const re = p.t1 + p.t2 * Math.cos(tau * u), im = p.t2 * Math.sin(tau * u)
      const e = Math.sqrt(p.delta * p.delta + re * re + im * im)
      return [p.eps - e, p.eps + e]
    }
    case 'square': return [p.eps - 2 * p.t1 * (Math.cos(tau * u) + Math.cos(tau * v))]
    case 'graphene': {
      const re = 1 + Math.cos(tau * u) + Math.cos(tau * v), im = Math.sin(tau * u) + Math.sin(tau * v)
      const e = Math.sqrt(p.delta * p.delta + p.t1 * p.t1 * (re * re + im * im))
      return [p.eps - e, p.eps + e]
    }
  }
}

export const HIGH_SYMMETRY: Record<LatticeId, { labels: string[]; points: [number, number][] }> = {
  chain: { labels: ['−π/a', 'Γ', 'π/a'], points: [[-0.5, 0], [0, 0], [0.5, 0]] },
  ssh: { labels: ['−π', 'Γ', 'π'], points: [[-0.5, 0], [0, 0], [0.5, 0]] },
  square: { labels: ['Γ', 'X', 'M', 'Γ'], points: [[0, 0], [0.5, 0], [0.5, 0.5], [0, 0]] },
  graphene: { labels: ['Γ', 'M', 'K', 'Γ'], points: [[0, 0], [0.5, 0], [2 / 3, 1 / 3], [0, 0]] },
}

/** Band energies along the piecewise-linear path through the high-symmetry points; x is the cumulative path length in segment units. */
export function bandPath(model: LatticeId, p: TbParams, perSegment = 60) {
  const pts = HIGH_SYMMETRY[model].points
  const ks: number[] = [], bands: number[][] = []
  for (let s = 0; s < pts.length - 1; s++) {
    for (let i = 0; i < perSegment + (s === pts.length - 2 ? 1 : 0); i++) {
      const w = i / perSegment
      ks.push(s + w)
      bands.push(bandsAt(model, p, pts[s][0] + w * (pts[s + 1][0] - pts[s][0]), pts[s][1] + w * (pts[s + 1][1] - pts[s][1])))
    }
  }
  return { k: ks, bands }
}

/** Density of states per cell with Gaussian broadening σ, averaged on a uniform k-mesh (1-D models use `n1` points, 2-D models `n2 × n2`). */
export function dos(model: LatticeId, p: TbParams, energies: readonly number[], sigma: number, n1 = 1500, n2 = 120) {
  const is2d = model === 'square' || model === 'graphene'
  const all: number[] = []
  if (is2d) for (let i = 0; i < n2; i++) for (let j = 0; j < n2; j++) all.push(...bandsAt(model, p, i / n2, j / n2))
  else for (let i = 0; i < n1; i++) all.push(...bandsAt(model, p, i / n1, 0))
  const nk = is2d ? n2 * n2 : n1
  const norm = 1 / (nk * sigma * Math.sqrt(2 * Math.PI))
  return energies.map((e) => { let s = 0; for (const x of all) { const z = (e - x) / sigma; if (Math.abs(z) < 6) s += Math.exp(-0.5 * z * z) } return s * norm })
}

// ─── binary phase diagram ───────────────────────────────────────────────────────────

export const R_GAS = 8.314462618

export interface Component { name: string; tm: number; /** J/mol */ hf: number }

/** Liquidus composition of component c at temperature T: ln x = −(ΔH/R)(1/T − 1/T_m) (ideal liquid, pure solid: Schröder–van Laar). */
export const liquidusX = (c: Component, T: number) => Math.min(1, Math.exp(-(c.hf / R_GAS) * (1 / T - 1 / c.tm)))

/** Eutectic point of two components with pure solid phases: x_A(T) + x_B(T) = 1, solved by bisection. */
export function eutectic(a: Component, b: Component): { T: number; xB: number } | null {
  const hiT = Math.min(a.tm, b.tm)
  let lo = 0.2 * hiT, hi = hiT
  const g = (T: number) => liquidusX(a, T) + liquidusX(b, T) - 1
  if (g(lo) * g(hi) > 0) return null
  for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (g(lo) * g(mid) <= 0) hi = mid; else lo = mid }
  const T = (lo + hi) / 2
  return { T, xB: liquidusX(b, T) }
}

/** Phase state at overall B-fraction x0 and temperature T: which phases coexist and their fractions by the lever rule. */
export function leverRule(a: Component, b: Component, x0: number, T: number) {
  const e = eutectic(a, b)
  if (!e) return null
  const xAliq = 1 - liquidusX(a, T), xBliq = liquidusX(b, T)
  if (T >= Math.max(a.tm, b.tm) || (T > e.T && x0 >= 1 - liquidusX(a, T) && x0 <= liquidusX(b, T))) return { phases: '액상 (L)', liquid: 1, solidA: 0, solidB: 0, xL: x0 }
  if (T <= e.T) {
    // below the eutectic temperature everything is solid: A + B, fraction by the lever rule on the pure ends
    return { phases: '고상 A + 고상 B', liquid: 0, solidA: 1 - x0, solidB: x0, xL: NaN }
  }
  if (x0 < xAliq) {
    const xL = xAliq
    return { phases: '고상 A + 액상', liquid: Math.min(1, x0 / xL), solidA: 1 - Math.min(1, x0 / xL), solidB: 0, xL }
  }
  const xL = xBliq
  return { phases: '고상 B + 액상', liquid: Math.min(1, (1 - x0) / (1 - xL)), solidA: 0, solidB: 1 - Math.min(1, (1 - x0) / (1 - xL)), xL }
}
