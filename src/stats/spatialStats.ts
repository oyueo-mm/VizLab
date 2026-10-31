import { createRng } from '../lib/random'
import { erfc } from './distributions'
import { planarKm, type LonLat } from './spatial'

/** Spatial weights and spatial autocorrelation: global / local Moran's I (permutation p-values) and Getis–Ord Gi*. */

export interface SpatialUnit { id: string; lon: number; lat: number; value: number; rows: number[] }

/** Neighbour lists: `nb[i]` holds the indices of the units that count as neighbours of unit i (never i itself). */
export type Neighbors = number[][]

export type WeightKind = 'knn' | 'distance' | 'queen' | 'rook'

export function knnNeighbors(units: readonly SpatialUnit[], k: number): Neighbors {
  return units.map((u, i) => units
    .map((v, j) => ({ j, d: i === j ? Infinity : planarKm([u.lon, u.lat], [v.lon, v.lat]) }))
    .sort((a, b) => a.d - b.d || a.j - b.j)
    .slice(0, Math.min(k, units.length - 1))
    .map((x) => x.j))
}

export function distanceNeighbors(units: readonly SpatialUnit[], km: number): Neighbors {
  return units.map((u, i) => units.reduce<number[]>((acc, v, j) => { if (i !== j && planarKm([u.lon, u.lat], [v.lon, v.lat]) <= km) acc.push(j); return acc }, []))
}

/**
 * Contiguity from polygon rings (arrays of [lon, lat]): queen = the regions share at least one vertex, rook = they share an edge
 * (two or more vertices). TopoJSON decoding gives shared borders identical coordinates, which is what makes the vertex test valid.
 */
export function polygonNeighbors(shapes: readonly (readonly (readonly LonLat[])[])[], kind: 'queen' | 'rook'): Neighbors {
  const owners = new Map<string, Set<number>>()
  shapes.forEach((rings, i) => rings.forEach((ring) => ring.forEach((p) => {
    const key = `${p[0].toFixed(4)},${p[1].toFixed(4)}`
    ;(owners.get(key) ?? owners.set(key, new Set()).get(key)!).add(i)
  })))
  const shared = shapes.map(() => new Map<number, number>())
  for (const set of owners.values()) {
    if (set.size < 2) continue
    const list = [...set]
    for (const a of list) for (const b of list) if (a !== b) shared[a].set(b, (shared[a].get(b) ?? 0) + 1)
  }
  const need = kind === 'queen' ? 1 : 2
  return shared.map((m) => [...m].filter(([, c]) => c >= need).map(([j]) => j).sort((a, b) => a - b))
}

/** Makes the neighbour relation symmetric (i ~ j if either lists the other), as distance and contiguity weights are. */
export function symmetrize(nb: Neighbors): Neighbors {
  const sets = nb.map((l) => new Set(l))
  nb.forEach((l, i) => l.forEach((j) => sets[j].add(i)))
  return sets.map((s) => [...s].sort((a, b) => a - b))
}

export const mean = (v: readonly number[]) => v.reduce((a, b) => a + b, 0) / (v.length || 1)
const popSd = (v: readonly number[]) => { const m = mean(v); return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length || 1)) }

export const normalTwoSidedP = (z: number) => (Number.isFinite(z) ? erfc(Math.abs(z) / Math.SQRT2) : NaN)

/** Global Moran's I with row-standardised weights and a permutation p-value (two-sided). */
export function moranGlobal(values: readonly number[], nb: Neighbors, perms = 499, seed = 1) {
  const n = values.length
  const m = mean(values)
  const z = values.map((v) => v - m)
  const denom = z.reduce((s, x) => s + x * x, 0)
  const stat = (zz: readonly number[]) => {
    let num = 0, s0 = 0
    nb.forEach((l, i) => { if (!l.length) return; for (const j of l) { num += (1 / l.length) * zz[i] * zz[j]; s0 += 1 / l.length } })
    return s0 > 0 && denom > 0 ? (n / s0) * (num / denom) : NaN
  }
  const I = stat(z)
  const expected = -1 / (n - 1)
  if (!Number.isFinite(I)) return { I, expected, p: NaN, z: NaN, perms: 0 }
  const rng = createRng(seed)
  const sims: number[] = []
  const shuffled = z.slice()
  for (let p = 0; p < perms; p++) {
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]] }
    sims.push(stat(shuffled))
  }
  const mu = mean(sims), sd = popSd(sims)
  const extreme = sims.filter((s) => Math.abs(s - mu) >= Math.abs(I - mu)).length
  return { I, expected, p: (extreme + 1) / (perms + 1), z: sd > 0 ? (I - mu) / sd : NaN, perms }
}

export type LisaClass = 'HH' | 'LL' | 'HL' | 'LH' | 'ns' | 'isolated'

export interface LocalMoran { z: number; lag: number; I: number; p: number; cls: LisaClass; quadrant: Exclude<LisaClass, 'ns' | 'isolated'> | 'isolated' }

/**
 * Local Moran's I (Anselin 1995) with row-standardised weights: I_i = z_i · Σ_j w_ij z_j, z the standardised value.
 * The pseudo p-value comes from conditional permutation: z_i is held fixed while the other values are redrawn over i's neighbours.
 */
export function localMoran(values: readonly number[], nb: Neighbors, alpha = 0.05, perms = 499, seed = 1): LocalMoran[] {
  const n = values.length
  const m = mean(values), sd = popSd(values)
  const z = values.map((v) => (sd > 0 ? (v - m) / sd : 0))
  const rng = createRng(seed)
  return values.map((_, i) => {
    const l = nb[i]
    if (!l.length || sd === 0) return { z: z[i], lag: 0, I: 0, p: 1, cls: 'isolated', quadrant: 'isolated' }
    const lag = l.reduce((s, j) => s + z[j], 0) / l.length
    const I = z[i] * lag
    const pool: number[] = []
    for (let j = 0; j < n; j++) if (j !== i) pool.push(z[j])
    let extreme = 0
    const k = l.length
    for (let p = 0; p < perms; p++) {
      // partial Fisher–Yates: draw k distinct values for the neighbours
      let s = 0
      for (let t = 0; t < k; t++) { const r = t + Math.floor(rng() * (pool.length - t)); [pool[t], pool[r]] = [pool[r], pool[t]]; s += pool[t] }
      if (Math.abs(z[i] * (s / k)) >= Math.abs(I) - 1e-12) extreme++
    }
    const pv = (extreme + 1) / (perms + 1)
    const quadrant = z[i] >= 0 ? (lag >= 0 ? 'HH' : 'HL') : lag >= 0 ? 'LH' : 'LL'
    return { z: z[i], lag, I, p: pv, quadrant, cls: pv <= alpha ? quadrant : 'ns' }
  })
}

export interface GiStar { z: number; p: number }

/**
 * Getis–Ord Gi* z-scores with binary weights that include the unit itself (w_ii = 1):
 * z = (Σ_j w_ij x_j − X̄ Σ_j w_ij) / (S · √[(n Σ_j w_ij² − (Σ_j w_ij)²) / (n − 1)]), S² = Σx²/n − X̄².
 */
export function getisOrdGiStar(values: readonly number[], nb: Neighbors): GiStar[] {
  const n = values.length
  const xbar = mean(values)
  const s = Math.sqrt(values.reduce((a, x) => a + x * x, 0) / n - xbar * xbar)
  return values.map((x, i) => {
    const group = [i, ...nb[i]]
    const sw = group.length
    const num = group.reduce((a, j) => a + values[j], 0) - xbar * sw
    const den = s * Math.sqrt((n * sw - sw * sw) / (n - 1))
    const z = den > 0 ? num / den : 0
    void x
    return { z, p: normalTwoSidedP(z) }
  })
}

/** Benjamini–Hochberg: which p-values stay significant when the false discovery rate is held at `alpha`. */
export function benjaminiHochberg(p: readonly number[], alpha: number): boolean[] {
  const order = p.map((v, i) => ({ v, i })).filter((x) => Number.isFinite(x.v)).sort((a, b) => a.v - b.v)
  let cut = -1
  order.forEach((x, k) => { if (x.v <= ((k + 1) / order.length) * alpha) cut = k })
  const out = p.map(() => false)
  for (let k = 0; k <= cut; k++) out[order[k].i] = true
  return out
}
