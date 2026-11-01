import { describe, expect, it } from 'vitest'
import { createRng } from '../lib/random'
import { densityRatio, empiricalVariogram, fitRange, fitVariogram, gammaOf, krige, localKm, moranScatter, simulateField, stDensity, timeDensity, type Pt, type STEvent } from './geostat'
import { knnNeighbors, moranGlobal } from './spatialStats'

const grid = (n: number, step: number, f: (x: number, y: number) => number): Pt[] => { const out: Pt[] = []; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push({ x: i * step, y: j * step, v: f(i * step, j * step) }); return out }

describe('semivariogram', () => {
  it('a linear ramp has γ(h) = h²/2 and an unrelated field has a flat variogram at the variance', () => {
    const line: Pt[] = Array.from({ length: 30 }, (_, i) => ({ x: i, y: 0, v: i }))
    const bins = empiricalVariogram(line, { bins: 8, maxDist: 16 })
    for (const b of bins) expect(b.gamma).toBeCloseTo((b.h * b.h) / 2, 0)
    const rng = createRng(2)
    const noise: Pt[] = Array.from({ length: 300 }, () => ({ x: rng() * 100, y: rng() * 100, v: rng.normal(0, 2) }))
    const nb = empiricalVariogram(noise, { bins: 8, maxDist: 40 })
    for (const b of nb) { expect(b.gamma).toBeGreaterThan(2.5); expect(b.gamma).toBeLessThan(5.5) }
  })
  it('the fit recovers the parameters of an exact spherical model and a Gaussian-field sample gives a sensible range', () => {
    const truth = { model: 'spherical' as const, nugget: 0.3, psill: 1.2, range: 40, ssr: 0 }
    const bins = Array.from({ length: 20 }, (_, i) => ({ h: 3 + i * 3, gamma: gammaOf(truth, 3 + i * 3), n: 100 }))
    const fit = fitVariogram(bins, 'spherical')!
    expect(fit.range).toBeCloseTo(40, 0)
    expect(fit.nugget).toBeCloseTo(0.3, 1)
    expect(fit.psill).toBeCloseTo(1.2, 1)
    expect(gammaOf(fit, 0)).toBe(0)
    expect(gammaOf(fit, 1000)).toBeCloseTo(1.5, 1)
    const coords: [number, number][] = Array.from({ length: 220 }, () => { const r = createRng(0); void r; return [0, 0] })
    const rng = createRng(5)
    for (let i = 0; i < coords.length; i++) coords[i] = [rng() * 300, rng() * 300]
    const z = simulateField(coords, { sill: 1, nugget: 0.05, range: 90, seed: 3 })
    const est = fitVariogram(empiricalVariogram(coords.map(([x, y], i) => ({ x, y, v: z[i] })), { bins: 14, maxDist: 150 }), 'exponential')!
    expect(est.range).toBeGreaterThan(40)
    expect(est.range).toBeLessThan(220)
  })
  it('directional variograms of an anisotropic field have a longer range along the long axis', () => {
    const rng = createRng(11)
    const coords: [number, number][] = Array.from({ length: 330 }, () => [rng() * 300, rng() * 300])
    const z = simulateField(coords, { sill: 1, nugget: 0.02, range: 160, ratio: 0.25, angle: 45, seed: 4 })
    const pts = coords.map(([x, y], i) => ({ x, y, v: z[i] }))
    const along = fitVariogram(empiricalVariogram(pts, { bins: 12, maxDist: 150, direction: 45, tolerance: 25 }), 'exponential')!
    const across = fitVariogram(empiricalVariogram(pts, { bins: 12, maxDist: 150, direction: 135, tolerance: 25 }), 'exponential')!
    expect(along.range / across.range).toBeGreaterThan(1.5)
    // holding nugget and sill fixed at the omnidirectional values keeps the ordering
    const omni = fitVariogram(empiricalVariogram(pts, { bins: 12, maxDist: 150 }), 'exponential')!
    const a2 = fitRange(empiricalVariogram(pts, { bins: 12, maxDist: 150, direction: 45, tolerance: 25 }), 'exponential', omni.nugget, omni.psill)!
    const c2 = fitRange(empiricalVariogram(pts, { bins: 12, maxDist: 150, direction: 135, tolerance: 25 }), 'exponential', omni.nugget, omni.psill)!
    expect(a2.range).toBeGreaterThan(c2.range * 1.5)
  })
})

describe('ordinary kriging', () => {
  const fit = { model: 'exponential' as const, nugget: 0, psill: 1, range: 60, ssr: 0 }
  it('interpolates the samples exactly and predicts a constant field as that constant with ~0 variance', () => {
    const pts = grid(5, 20, () => 7)
    expect(krige(pts, fit, 40, 40).pred).toBeCloseTo(7, 9)
    expect(krige(pts, fit, 33, 27).pred).toBeCloseTo(7, 9)
    expect(krige(pts, fit, 33, 27).variance).toBeGreaterThanOrEqual(0)
    const rough = grid(5, 20, (x, y) => x * 0.1 + Math.sin(y / 10))
    expect(krige(rough, fit, 40, 60).pred).toBeCloseTo(rough.find((p) => p.x === 40 && p.y === 60)!.v, 9)
    expect(krige(rough, fit, 40, 60).variance).toBe(0)
  })
  it('recovers a smooth field between samples and the variance grows away from the data', () => {
    const f = (x: number, y: number) => Math.sin(x / 40) + Math.cos(y / 50)
    const pts = grid(9, 12, f)
    const mid = krige(pts, fit, 54, 54, 16), far = krige(pts, fit, 200, 200, 16)
    expect(Math.abs(mid.pred - f(54, 54))).toBeLessThan(0.05)
    expect(far.variance).toBeGreaterThan(mid.variance)
    expect(far.variance).toBeLessThanOrEqual(2 * fit.psill + 1e-6)
  })
  it('weights sum to one: shifting all values by c shifts every prediction by c', () => {
    const rng = createRng(8)
    const pts: Pt[] = Array.from({ length: 40 }, () => ({ x: rng() * 100, y: rng() * 100, v: rng.normal() }))
    const a = krige(pts, fit, 47, 53), b = krige(pts.map((p) => ({ ...p, v: p.v + 10 })), fit, 47, 53)
    expect(b.pred - a.pred).toBeCloseTo(10, 9)
    expect(b.variance).toBeCloseTo(a.variance, 9)
  })
})

describe('space-time density and case–control ratio', () => {
  it('the product-kernel density integrates to one over space and time', () => {
    const ev: STEvent[] = [{ x: 0, y: 0, t: 5 }, { x: 10, y: 5, t: 8 }, { x: -6, y: 8, t: 2 }]
    let s = 0
    const d = 1
    for (let t = -10; t <= 20; t += d) for (let x = -40; x <= 40; x += 2) for (let y = -40; y <= 40; y += 2) s += stDensity(ev, 5, 2, x, y, t) * 4 * d
    expect(s).toBeCloseTo(1, 1)
    expect(stDensity(ev, 5, 2, 0, 0, 5)).toBeGreaterThan(stDensity(ev, 5, 2, 0, 0, 12))
    let tm = 0
    for (let t = -20; t <= 30; t += 0.25) tm += timeDensity(ev, 2, t) * 0.25
    expect(tm).toBeCloseTo(1, 2)
  })
  it('the log density ratio is positive where cases cluster (with a small permutation p-value), negative elsewhere, and ≈ 0 for identical samples', () => {
    const rng = createRng(6)
    const controls = Array.from({ length: 150 }, () => ({ x: rng() * 100, y: rng() * 100 }))
    const cases = [...Array.from({ length: 70 }, () => ({ x: rng.normal(30, 6), y: rng.normal(30, 6) })), ...Array.from({ length: 40 }, () => ({ x: rng() * 100, y: rng() * 100 }))]
    const gx = [30, 80], gy = [30, 80]
    const r = densityRatio(cases, controls, 12, gx, gy, 59, 3)
    expect(r.logRatio[0]).toBeGreaterThan(1)
    expect(r.p[0]).toBeLessThan(0.1)
    // densities are normalised per group, so the rest of the map necessarily shows a (significant) deficit of cases
    expect(r.logRatio[3]).toBeLessThan(0)
    const same = densityRatio(controls, controls, 12, gx, gy)
    for (const v of same.logRatio) expect(v).toBeCloseTo(0, 9)
  })
})

describe('Moran scatterplot', () => {
  it('the regression slope of the spatial lag on the standardised value equals global Moran\'s I', () => {
    const rng = createRng(3)
    const units = Array.from({ length: 80 }, (_, i) => { const lon = 127 + rng() * 2, lat = 36 + rng() * 2; return { id: String(i), lon, lat, value: 3 * Math.sin(lon * 5) + 2 * Math.cos(lat * 4) + rng.normal(0, 0.5), rows: [i] } })
    const nb = knnNeighbors(units, 5)
    const sc = moranScatter(units.map((u) => u.value), nb)
    const I = moranGlobal(units.map((u) => u.value), nb, 0).I
    expect(sc.slope).toBeCloseTo(I, 9)
    const loc = localKm(units)
    const [x, y] = loc.to(units[0].lon, units[0].lat)
    const [lon, lat] = loc.from(x, y)
    expect(lon).toBeCloseTo(units[0].lon, 9)
    expect(lat).toBeCloseTo(units[0].lat, 9)
  })
})
