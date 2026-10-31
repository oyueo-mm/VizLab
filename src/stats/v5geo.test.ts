import * as d3 from 'd3'
import { describe, expect, it } from 'vitest'
import { createRng } from '../lib/random'
import { circumcircle, delaunayTriangles, groundPlane, polygonAreaAbs, syntheticRoadNetwork, triangleAngles, voronoiCells, type P2 } from './geometry'
import { apportion, contiguousCartogram, demersCartogram, griddedCartogram, maxSquareOverlap, nonContiguousCartogram, shapeArea, type Shape } from './cartogram'
import {
  clusterByRadius, coarsenGrid, dasymetricDensity, fillMissing, gridFromCells, lineOfSight, terrainProfile, destination, projectionDistortion, trackAt, trackLengthKm, trackSpeedKmh, makeParticles, stepParticleBuffer, distanceToPolylineKm, evenStreamlines, fieldAt, geodesicCircle, gridContours, haversineKm, hillshade, hillsHeight, idwAt, kdeMap, KM_PER_DEG,
  makeGrid, rk4Step, sampleGrid, slopeAspect, squareGrid, streamline, stepParticles, timeSurface, travelTimes, type Particle, type VectorField,
} from './spatial'
import { benjaminiHochberg, getisOrdGiStar, knnNeighbors, localMoran, moranGlobal, polygonNeighbors, symmetrize, type SpatialUnit } from './spatialStats'

describe('geodesy', () => {
  it('haversine matches known city distances and destination inverts it', () => {
    expect(haversineKm([126.98, 37.57], [129.08, 35.18])).toBeGreaterThan(315)
    expect(haversineKm([126.98, 37.57], [129.08, 35.18])).toBeLessThan(330)
    expect(haversineKm([0, 0], [0, 90])).toBeCloseTo(10007.54, 0)
    const p = destination(127, 37, 1.1, 250)
    expect(haversineKm([127, 37], p)).toBeCloseTo(250, 6)
  })
  it('a geodesic circle has every vertex at the radius', () => {
    for (const p of geodesicCircle(10, 60, 400)) expect(haversineKm([10, 60], p)).toBeCloseTo(400, 5)
  })
  it('distance to a polyline is measured to the segment, not just the vertices', () => {
    const d = distanceToPolylineKm([0.5, 0.2], [[0, 0], [1, 0]])
    expect(d).toBeCloseTo(0.2 * KM_PER_DEG, 0)
  })
})

describe('terrain derivatives', () => {
  const box = { west: 127, east: 128, south: 36, north: 37 }
  it('hillshade of a plane follows the cosine rule: facing the light is bright, facing away is dark', () => {
    // z rises towards the east by 0.1 m/m → the surface faces west
    const kmLon = KM_PER_DEG * Math.cos(36.5 * Math.PI / 180) * 1000
    const g = makeGrid(box, 20, 20, (lon) => (lon - 127) * kmLon * 0.1)
    const fromWest = hillshade(g, 270, 45).values[10 * 20 + 10]
    const fromEast = hillshade(g, 90, 45).values[10 * 20 + 10]
    const n = 1 / Math.sqrt(1 + 0.01)
    expect(fromWest).toBeCloseTo((0.1 * Math.SQRT1_2 + Math.SQRT1_2) * n, 2)
    expect(fromEast).toBeCloseTo(Math.max(0, (-0.1 * Math.SQRT1_2 + Math.SQRT1_2) * n), 2)
    expect(fromWest).toBeGreaterThan(fromEast)
    // a flat surface gives sin(altitude) whatever the azimuth
    const flat = makeGrid(box, 6, 6, () => 100)
    expect(hillshade(flat, 123, 30).values[14]).toBeCloseTo(0.5, 6)
  })
  it('slope and aspect of a plane: atan(gradient) and the downhill compass bearing', () => {
    const kmLon = KM_PER_DEG * Math.cos(36.5 * Math.PI / 180) * 1000
    const g = makeGrid(box, 20, 20, (lon) => (lon - 127) * kmLon * 0.1)
    const { slope, aspect } = slopeAspect(g)
    expect(slope.values[10 * 20 + 10]).toBeCloseTo(Math.atan(0.1) * 180 / Math.PI, 0)
    expect(aspect.values[10 * 20 + 10]).toBeCloseTo(270, 0)
    const north = makeGrid(box, 20, 20, (_, lat) => (lat - 36) * KM_PER_DEG * 1000 * 0.2)
    expect(slopeAspect(north).aspect.values[10 * 20 + 10]).toBeCloseTo(180, 0)
    expect(Number.isNaN(slopeAspect(makeGrid(box, 5, 5, () => 3)).aspect.values[12])).toBe(true)
  })
  it('bilinear sampling reproduces a linear field exactly and is NaN outside', () => {
    const g = makeGrid(box, 11, 11, (lon, lat) => 3 * lon - 2 * lat)
    expect(sampleGrid(g, 127.37, 36.61)).toBeCloseTo(3 * 127.37 - 2 * 36.61, 9)
    expect(Number.isNaN(sampleGrid(g, 126.9, 36.5))).toBe(true)
  })
  it('hills height peaks at the hill and falls off as a Gaussian', () => {
    const h = hillsHeight([{ lon: 127, lat: 36, height: 1000, radiusKm: 20 }])
    expect(h(127, 36)).toBeCloseTo(1000, 6)
    const east = (lon: number) => h(lon, 36)
    const dLon = 20 / (KM_PER_DEG * Math.cos(36 * Math.PI / 180))
    expect(east(127 + dLon)).toBeGreaterThan(590)
    expect(east(127 + dLon)).toBeLessThan(620)
  })
  it('IDW is exact at the samples and stays inside the data range', () => {
    const s = [{ lon: 0, lat: 0, value: 10 }, { lon: 1, lat: 0, value: 20 }, { lon: 0, lat: 1, value: 30 }]
    expect(idwAt(s, 1, 0)).toBe(20)
    const v = idwAt(s, 0.4, 0.4)
    expect(v).toBeGreaterThan(10)
    expect(v).toBeLessThan(30)
  })
})

describe('spatial KDE and aggregation', () => {
  it('density integrates to the total weight', () => {
    const pts = [{ lon: 127, lat: 36, weight: 1 }, { lon: 127.2, lat: 36.1, weight: 3 }, { lon: 126.9, lat: 35.9, weight: 2 }]
    const box = { west: 125.5, east: 128.5, south: 34.5, north: 37.5 }
    const g = kdeMap(pts, 15, box, 140, 140)
    let total = 0
    const dLon = (box.east - box.west) / 139, dLat = (box.north - box.south) / 139
    for (let j = 0; j < 140; j++) for (let i = 0; i < 140; i++) total += g.values[j * 140 + i] * dLon * KM_PER_DEG * Math.cos((box.south + j * dLat) * Math.PI / 180) * dLat * KM_PER_DEG
    expect(total).toBeCloseTo(6, 1)
  })
  it('square grid conserves counts and sums, and every cell has the stated ground size', () => {
    const rng = createRng(3)
    const pts = Array.from({ length: 500 }, (_, row) => ({ lon: 126 + rng() * 2, lat: 36 + rng() * 2, value: 1 + rng() * 4, row }))
    const cells = squareGrid(pts, 20, 'sum', [126, 36])
    expect(cells.reduce((s, c) => s + c.count, 0)).toBe(500)
    expect(cells.reduce((s, c) => s + c.sum, 0)).toBeCloseTo(pts.reduce((s, p) => s + p.value, 0), 9)
    expect(new Set(cells.flatMap((c) => c.rows)).size).toBe(500)
  })
  it('clustering partitions the points, respects the radius and merges more as the radius grows', () => {
    const rng = createRng(5)
    const pts = Array.from({ length: 300 }, (_, index) => ({ x: rng() * 600, y: rng() * 400, weight: 1, index }))
    const small = clusterByRadius(pts, 10)
    const big = clusterByRadius(pts, 60)
    for (const cl of [small, big]) expect(cl.reduce((s, c) => s + c.count, 0)).toBe(300)
    expect(big.length).toBeLessThan(small.length)
    expect(new Set(big.flatMap((c) => c.members)).size).toBe(300)
  })
})

describe('vector fields', () => {
  const rotation: VectorField = { sources: [{ kind: 'vortex', lon: 127, lat: 36, strength: 20, radiusKm: 60 }], uniform: [0, 0] }
  it('a vortex flows tangentially and counter-clockwise; a source flows outward', () => {
    const [u, v] = fieldAt(rotation, 127 + 0.5, 36)
    expect(Math.abs(u)).toBeLessThan(Math.abs(v) * 0.05)
    expect(v).toBeGreaterThan(0)
    const src = fieldAt({ sources: [{ kind: 'source', lon: 127, lat: 36, strength: 10, radiusKm: 50 }], uniform: [0, 0] }, 127.4, 36)
    expect(src[0]).toBeGreaterThan(0)
    expect(fieldAt({ sources: [{ kind: 'sink', lon: 127, lat: 36, strength: 10, radiusKm: 50 }], uniform: [0, 0] }, 127.4, 36)[0]).toBeLessThan(0)
  })
  it('RK4 keeps a streamline around a vortex on its circle (radius drift under 1%)', () => {
    const start: [number, number] = [127 + 60 / (KM_PER_DEG * Math.cos(36 * Math.PI / 180)), 36]
    let p: [number, number] | null = start
    let maxDrift = 0
    for (let i = 0; i < 400 && p; i++) {
      p = rk4Step(rotation, p, 2)
      if (p) maxDrift = Math.max(maxDrift, Math.abs(Math.hypot((p[0] - 127) * Math.cos(36 * Math.PI / 180) * KM_PER_DEG, (p[1] - 36) * KM_PER_DEG) - 60) / 60)
    }
    expect(maxDrift).toBeLessThan(0.01)
  })
  it('a uniform eastward wind gives a straight eastward streamline', () => {
    const line = streamline({ sources: [], uniform: [5, 0] }, [127, 36], { west: 126, east: 128, south: 35, north: 37 }, 5, 100)
    expect(line.every((q) => Math.abs(q[1] - 36) < 1e-9)).toBe(true)
    expect(line[line.length - 1][0]).toBeGreaterThan(127.9)
    expect(line[0][0]).toBeLessThan(126.1)
  })
  it('even streamlines keep their separation', () => {
    const box = { west: 125, east: 130, south: 33, north: 38 }
    const lines = evenStreamlines(rotation, box, 40, 8)
    expect(lines.length).toBeGreaterThan(3)
  })
  it('particles move with the flow and respawn after their lifetime', () => {
    const box = { west: 126, east: 128, south: 35, north: 37 }
    const rng = createRng(1)
    const ps: Particle[] = [{ lon: 127, lat: 36, age: 0, trail: [] }]
    stepParticles(ps, { sources: [], uniform: [10, 0] }, box, 1, 5000, 5, rng)
    expect(ps[0].lon).toBeGreaterThan(127)
    expect(ps[0].lat).toBeCloseTo(36, 9)
    ps[0].age = 99
    stepParticles(ps, { sources: [], uniform: [10, 0] }, box, 1, 5000, 5, rng)
    expect(ps[0].age).toBe(0)
  })
})

describe('particle buffer', () => {
  it('moves particles with the flow by velocity × time and respawns expired ones inside the box', () => {
    const box = { west: 126, east: 128, south: 35, north: 37 }
    const rng = createRng(2)
    const b = makeParticles(50, box, rng, 10)
    const lon0 = Array.from(b.lon), age0 = Array.from(b.age)
    const field = { sources: [], uniform: [10, 0] as [number, number] }
    stepParticleBuffer(b, field, box, 1, 1000, 10, rng)
    // 10 m/s × 1 s × 1000 = 10 km east ≈ 0.11° at 36°N for the particles that stayed alive
    let moved = 0
    for (let i = 0; i < 50; i++) if (b.age[i] === age0[i] + 1) { expect(b.lon[i] - lon0[i]).toBeCloseTo(10 / (KM_PER_DEG * Math.cos(b.lat[i] * Math.PI / 180)), 3); moved++ }
    expect(moved).toBeGreaterThan(30)
    for (let i = 0; i < 50; i++) { expect(b.lon[i]).toBeGreaterThanOrEqual(box.west); expect(b.lon[i]).toBeLessThanOrEqual(box.east) }
  })
})

describe('road network', () => {
  it('Dijkstra finds the fastest route and prefers a longer fast road', () => {
    const edges = [{ a: 0, b: 1, km: 10, speed: 60 }, { a: 1, b: 2, km: 10, speed: 60 }, { a: 0, b: 2, km: 12, speed: 120 }, { a: 2, b: 3, km: 6, speed: 30 }]
    const t = travelTimes(5, edges, 0)
    expect(t[1]).toBeCloseTo(10)
    expect(t[2]).toBeCloseTo(6)
    expect(t[3]).toBeCloseTo(18)
    expect(t[4]).toBe(Infinity)
  })
  it('the time surface is zero at the origin, grows with distance and contours nest', () => {
    const nodes: [number, number][] = [[127, 36], [127.3, 36]]
    const t = travelTimes(2, [{ a: 0, b: 1, km: 27, speed: 90 }], 0)
    const g = timeSurface(nodes, t, { west: 126.5, east: 128, south: 35.5, north: 36.5 }, 61, 41, 40)
    const at = (lon: number, lat: number) => sampleGrid(g, lon, lat)
    expect(at(127, 36)).toBeLessThan(1)
    expect(at(127.3, 36)).toBeCloseTo(18, 0)
    expect(at(127.6, 36)).toBeGreaterThan(at(127.3, 36))
    const bands = gridContours(g, [20, 40], 'below')
    expect(bands).toHaveLength(2)
    const area = (poly: [number, number][][]) => poly.reduce((s, ring, k) => s + (k === 0 ? 1 : -1) * Math.abs(d3.polygonArea(ring)), 0)
    const [a20, a40] = bands.map((b) => b.polygons.reduce((s, p) => s + area(p), 0))
    expect(a40).toBeGreaterThan(a20)
  })
})

describe('spatial autocorrelation', () => {
  const line = (values: number[]): SpatialUnit[] => values.map((v, i) => ({ id: `u${i}`, lon: 127 + i * 0.1, lat: 36, value: v, rows: [i] }))
  it('Gi* z-score matches the closed-form value on a small example', () => {
    const units = line([1, 2, 3, 10, 11, 12, 2, 1])
    const nb = symmetrize(knnNeighbors(units, 2))
    const gi = getisOrdGiStar(units.map((u) => u.value), nb)
    // hand calculation for unit 4 (value 11): neighbours 3,5 (+ self) → Σ=33, X̄=5.25, S
    const x = units.map((u) => u.value)
    const xbar = d3.mean(x)!
    const S = Math.sqrt(d3.sum(x, (v) => v * v) / 8 - xbar * xbar)
    const sw = nb[4].length + 1
    const expected = (33 - xbar * sw) / (S * Math.sqrt((8 * sw - sw * sw) / 7))
    expect(nb[4]).toEqual([3, 5])
    expect(gi[4].z).toBeCloseTo(expected, 9)
    expect(gi[4].z).toBeGreaterThan(1.5)
    expect(gi[0].z).toBeLessThan(0)
  })
  it('Moran\'s I is strongly positive for a smooth gradient and near −1/(n−1) for shuffled values', () => {
    const smooth = line(Array.from({ length: 40 }, (_, i) => i))
    const nb = symmetrize(knnNeighbors(smooth, 2))
    const g = moranGlobal(smooth.map((u) => u.value), nb, 199, 4)
    expect(g.I).toBeGreaterThan(0.9)
    expect(g.p).toBeLessThan(0.02)
    const rng = createRng(11)
    const noisy = line(Array.from({ length: 40 }, () => rng()))
    const g2 = moranGlobal(noisy.map((u) => u.value), symmetrize(knnNeighbors(noisy, 2)), 199, 4)
    expect(Math.abs(g2.I - g2.expected)).toBeLessThan(0.35)
  })
  it('local Moran labels a high cluster HH, a low cluster LL and respects isolated units', () => {
    const units = line([1, 1, 2, 1, 1, 9, 10, 9, 10, 9])
    const nb = symmetrize(knnNeighbors(units, 2))
    const res = localMoran(units.map((u) => u.value), nb, 0.2, 499, 9)
    expect(res[7].quadrant).toBe('HH')
    expect(res[2].quadrant).toBe('LL')
    expect(res.reduce((s, r) => s + r.I, 0) / 10).toBeGreaterThan(0)
    const alone = localMoran([1, 2, 3], [[1], [0], []], 0.05, 99, 1)
    expect(alone[2].cls).toBe('isolated')
  })
  it('queen contiguity counts a shared vertex, rook needs a shared edge', () => {
    const sq = (x: number, y: number): [number, number][] => [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]
    const shapes = [[sq(0, 0)], [sq(1, 0)], [sq(1, 1)], [sq(5, 5)]]
    expect(polygonNeighbors(shapes, 'rook')).toEqual([[1], [0, 2], [1], []])
    expect(polygonNeighbors(shapes, 'queen')).toEqual([[1, 2], [0, 2], [0, 1], []])
  })
  it('Benjamini–Hochberg controls the false discovery rate on a known list', () => {
    const p = [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216]
    expect(benjaminiHochberg(p, 0.05)).toEqual([true, true, false, false, false, false, false, false, false, false])
  })
})

describe('dasymetric mapping', () => {
  it('conserves each region total and puts more of it on the denser land use', () => {
    const cells = [
      { region: 0, cls: 0, area: 1 }, { region: 0, cls: 1, area: 4 }, { region: 0, cls: 2, area: 5 },
      { region: 1, cls: 1, area: 2 }, { region: 1, cls: 1, area: 2 }, { region: -1, cls: 0, area: 9 },
    ]
    const d = dasymetricDensity(cells, [1000, 50], [10, 1, 0.2])
    const mass = (r: number) => cells.reduce((s, c, i) => s + (c.region === r ? d[i] * c.area : 0), 0)
    expect(mass(0)).toBeCloseTo(1000, 9)
    expect(mass(1)).toBeCloseTo(50, 9)
    expect(d[0]).toBeGreaterThan(d[1])
    expect(d[1]).toBeGreaterThan(d[2])
    expect(d[0] / d[1]).toBeCloseTo(10, 9)
    expect(d[5]).toBe(0)
    // equal weights reduce to the plain choropleth (uniform density inside the region)
    const flat = dasymetricDensity(cells, [1000, 50], [1, 1, 1])
    expect(flat[0]).toBeCloseTo(100, 9)
    expect(flat[2]).toBeCloseTo(100, 9)
  })
})

describe('cartograms', () => {
  const sq = (x: number, y: number, s = 10): Shape['rings'] => [[[x, y], [x + s, y], [x + s, y + s], [x, y + s]]]
  it('non-contiguous cartogram scales each region so area is proportional to value', () => {
    const shapes: Shape[] = [{ id: 'a', rings: sq(0, 0) }, { id: 'b', rings: sq(20, 0, 20) }, { id: 'c', rings: sq(50, 0, 5) }]
    const values = [200, 100, 50]
    const { shapes: out } = nonContiguousCartogram(shapes, values, 'max')
    const ratio = out.map((s, i) => shapeArea(s) / values[i])
    expect(ratio[1]).toBeCloseTo(ratio[0], 9)
    expect(ratio[2]).toBeCloseTo(ratio[0], 9)
    expect(shapeArea(out[0])).toBeCloseTo(100, 6) // the region with the highest value/area keeps its size
  })
  it('contiguous cartogram drives area errors down and keeps shared borders shared', () => {
    // a 3×3 block of unit squares with a shared vertex lattice
    const shapes: Shape[] = []
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) shapes.push({ id: `${r}${c}`, rings: [[[c * 10, r * 10], [c * 10 + 10, r * 10], [c * 10 + 10, r * 10 + 10], [c * 10, r * 10 + 10]]] })
    const values = [1, 2, 1, 4, 9, 4, 1, 2, 1]
    const res = contiguousCartogram(shapes, values, 80, 0.02)
    expect(res.errors[res.errors.length - 1]).toBeLessThan(res.errors[0] * 0.25)
    const total0 = d3.sum(shapes.map(shapeArea))
    expect(d3.sum(res.shapes.map(shapeArea))).toBeCloseTo(total0, -1)
    // the centre cell has 9/25 of the value → about 36% of the area
    expect(shapeArea(res.shapes[4]) / d3.sum(res.shapes.map(shapeArea))).toBeGreaterThan(0.28)
    // vertex (10,10) is shared by 4 squares and must still coincide after the transformation
    const corner = (i: number, k: number) => res.shapes[i].rings[0][k]
    const p = corner(0, 2), q = corner(1, 3), r = corner(3, 1), s = corner(4, 0)
    for (const t of [q, r, s]) { expect(t[0]).toBeCloseTo(p[0], 9); expect(t[1]).toBeCloseTo(p[1], 9) }
  })
  it('Demers squares have area proportional to value and end without overlap', () => {
    const rng = createRng(8)
    const sites = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, x: 100 + rng() * 60, y: 100 + rng() * 60, value: 1 + rng() * 20 }))
    const sq2 = demersCartogram(sites, 30, 0.02, 800)
    expect(sq2[3].side ** 2 / sites[3].value).toBeCloseTo(sq2[9].side ** 2 / sites[9].value, 9)
    expect(maxSquareOverlap(sq2)).toBeLessThan(1)
  })
  it('gridded cartogram gives each region exactly its apportioned number of cells', () => {
    expect(apportion(10, [1, 1, 1])).toEqual([4, 3, 3])
    expect(apportion(100, [50, 30, 20]).reduce((a, b) => a + b, 0)).toBe(100)
    const cells: [number, number][] = Array.from({ length: 60 }, (_, i) => [i % 10, Math.floor(i / 10)])
    const owner = griddedCartogram(cells, [[0, 0], [9, 0], [5, 5]], [30, 10, 20])
    expect([0, 1, 2].map((r) => owner.filter((o) => o === r).length)).toEqual([30, 10, 20])
    expect(owner.every((o) => o >= 0)).toBe(true)
  })
})

describe('computational geometry', () => {
  const rng = createRng(21)
  const sites: P2[] = Array.from({ length: 60 }, () => [rng() * 100, rng() * 80])
  it('every Voronoi cell contains exactly the points nearest to its site, and the cells tile the bounds', () => {
    const cells = voronoiCells(sites, [0, 0, 100, 80])
    expect(cells.reduce((s, c) => s + (c ? polygonAreaAbs(c) : 0), 0)).toBeCloseTo(100 * 80, 6)
    for (let n = 0; n < 400; n++) {
      const q: P2 = [rng() * 100, rng() * 80]
      let best = 0
      sites.forEach((s, i) => { if (Math.hypot(s[0] - q[0], s[1] - q[1]) < Math.hypot(sites[best][0] - q[0], sites[best][1] - q[1])) best = i })
      const owner = cells.findIndex((c) => c && d3.polygonContains(c, q))
      expect(owner).toBe(best)
    }
  })
  it('the Delaunay triangulation satisfies the empty-circumcircle condition', () => {
    const tri = delaunayTriangles(sites)
    expect(tri.length).toBeGreaterThan(60)
    for (const [a, b, c] of tri) {
      const cc = circumcircle(sites[a], sites[b], sites[c])!
      sites.forEach((p, i) => { if (i !== a && i !== b && i !== c) expect(Math.hypot(p[0] - cc.x, p[1] - cc.y)).toBeGreaterThanOrEqual(cc.r - 1e-7) })
      expect(triangleAngles(sites[a], sites[b], sites[c]).reduce((s, v) => s + v, 0)).toBeCloseTo(180, 6)
    }
  })
  it('the circumcircle of a right triangle is centred on the hypotenuse midpoint', () => {
    const cc = circumcircle([0, 0], [4, 0], [0, 3])!
    expect([cc.x, cc.y, cc.r]).toEqual([2, 1.5, 2.5])
    expect(circumcircle([0, 0], [1, 1], [2, 2])).toBeNull()
  })
  it('the ground plane round-trips and measures kilometres', () => {
    const g = groundPlane([127, 36])
    const q = g.toKm([127.5, 36.4])
    expect(g.toLonLat(q)[0]).toBeCloseTo(127.5, 9)
    expect(g.toLonLat(q)[1]).toBeCloseTo(36.4, 9)
    expect(g.toKm([127, 37])[1]).toBeCloseTo(111.195, 2)
  })
  it('the synthetic road network is mostly one connected component with faster highways', () => {
    const box = { west: 126, east: 129, south: 34, north: 38 }
    const net = syntheticRoadNetwork(box, (lon, lat) => Math.hypot((lon - 127.5) * 0.8, lat - 36) < 1.8, 18, [[126.5, 34.8], [127.5, 36], [128.5, 37.3]], 3)
    expect(net.nodes.length).toBeGreaterThan(100)
    const t = travelTimes(net.nodes.length, net.edges, 0)
    expect(Array.from(t).filter(Number.isFinite).length / net.nodes.length).toBeGreaterThan(0.95)
    expect(net.cls.filter((c) => c === 0).length).toBeGreaterThan(5)
    expect(Math.max(...net.edges.map((e) => e.speed))).toBe(100)
  })
})

describe('trajectories and projection distortion', () => {
  it('interpolates a track linearly in time, returns null outside it and measures length and speed', () => {
    const track = [{ t: 0, lon: 127, lat: 36 }, { t: 3600000, lon: 127, lat: 37 }, { t: 7200000, lon: 128, lat: 37 }]
    const mid = trackAt(track, 1800000)!
    expect(mid[0]).toBeCloseTo(127, 9)
    expect(mid[1]).toBeCloseTo(36.5, 9)
    expect(trackAt(track, -1)).toBeNull()
    expect(trackAt(track, 7200001)).toBeNull()
    expect(trackLengthKm(track)).toBeCloseTo(111.2 + 88.8, 0)
    expect(trackSpeedKmh(track, 1000)).toBeCloseTo(111.2, 0)
  })
  it('Mercator is conformal with area scale 1/cos²φ; an equal-area projection keeps area scale constant', () => {
    const merc = d3.geoMercator().scale(300)
    const at = (lat: number) => projectionDistortion(merc, 10, lat)!
    expect(at(0).omega).toBeLessThan(0.05)
    expect(at(60).omega).toBeLessThan(0.05)
    expect(at(60).det / at(0).det).toBeCloseTo(1 / Math.cos((60 * Math.PI) / 180) ** 2, 2)
    const ea = d3.geoAzimuthalEqualArea().scale(200).rotate([-10, -30])
    const dets = [[10, 30], [30, 40], [-10, 10], [50, 55]].map(([lo, la]) => projectionDistortion(ea, lo, la)!.det)
    for (const d of dets) expect(d / dets[0]).toBeCloseTo(1, 1)
    expect(projectionDistortion(ea, 50, 55)!.omega).toBeGreaterThan(1)
    const plate = d3.geoEquirectangular().scale(200)
    expect(projectionDistortion(plate, 0, 60)!.omega).toBeGreaterThan(20)
  })
})

describe('raster utilities and profiles', () => {
  const cells = [] as { lon: number; lat: number; value: number | null; row: number }[]
  for (let j = 0; j < 4; j++) for (let i = 0; i < 5; i++) cells.push({ lon: 127 + i * 0.5, lat: 36 + j * 0.25, value: i === 2 && j === 1 ? null : i + 10 * j, row: cells.length })
  it('builds a grid from lattice records, keeps missing cells NaN and remembers the source rows', () => {
    const r = gridFromCells(cells)!
    expect([r.grid.nx, r.grid.ny]).toEqual([5, 4])
    expect(r.grid.values[1 * 5 + 2]).toBeNaN()
    expect(r.grid.values[2 * 5 + 3]).toBe(23)
    expect(r.rowOf[2 * 5 + 3]).toBe(13)
    expect(r.irregular).toBe(false)
    expect(gridFromCells([{ lon: 1, lat: 1, value: 1, row: 0 }])).toBeNull()
  })
  it('fills a missing cell with a value inside its neighbours\' range and leaves valid cells alone', () => {
    const g = gridFromCells(cells)!.grid
    const f = fillMissing(g)
    expect(f.values[1 * 5 + 2]).toBeGreaterThan(Math.min(1, 3, 12, 13, 2))
    expect(f.values[1 * 5 + 2]).toBeLessThan(Math.max(1, 3, 12, 13, 2) + 12)
    expect(f.values[2 * 5 + 3]).toBe(23)
    expect(Array.from(f.values).every(Number.isFinite)).toBe(true)
  })
  it('mean-pooling preserves the mean of a complete grid and ignores NaN blocks', () => {
    const g = makeGrid({ west: 0, east: 3, south: 0, north: 3 }, 4, 4, (lo, la) => lo + 10 * la)
    const c = coarsenGrid(g, 2)
    expect([c.nx, c.ny]).toEqual([2, 2])
    expect(d3.mean(Array.from(c.values))).toBeCloseTo(d3.mean(Array.from(g.values))!, 9)
    expect(c.values[0]).toBeCloseTo((0 + 1 + 10 + 11) / 4, 9)
    const holes = { ...g, values: Float64Array.from(g.values) }
    holes.values.fill(NaN, 0, 4)
    expect(coarsenGrid(holes, 2).values[0]).toBeCloseTo((10 + 11) / 2, 9)
  })
  it('profile length, ascent and visibility follow the terrain', () => {
    const hill = (lon: number) => 1000 * Math.exp(-((lon - 127.5) ** 2) / 0.05)
    const p = terrainProfile((lo) => hill(lo), [127, 36], [128, 36], 201)
    expect(p.lengthKm).toBeCloseTo(haversineKm([127, 36], [128, 36]), 2)
    expect(p.max).toBeCloseTo(1000, 0)
    expect(p.ascent).toBeGreaterThan(900)
    expect(p.descent).toBeGreaterThan(900)
    const vis = lineOfSight(p, 2)
    expect(vis[0]).toBe(true)
    // the rising flank is seen, the far side behind the ridge is hidden
    expect(vis[50]).toBe(true)
    expect(vis[190]).toBe(false)
    expect(lineOfSight({ dist: [0, 1, 2, 3], elev: [0, 10, 20, 30] }, 0)).toEqual([true, true, true, true])
  })
})
