import * as d3 from 'd3'

/** Spatial engine shared by the v0.5 map charts: geodesy, raster grids, terrain derivatives, interpolation, vector fields and streamlines. */

export const R_KM = 6371.0088
const RAD = Math.PI / 180
/** Kilometres per degree of latitude on the mean sphere. */
export const KM_PER_DEG = R_KM * RAD

// ─── geodesy ────────────────────────────────────────────────────────────────────────

export type LonLat = [number, number]

/** Great-circle (haversine) distance in km. */
export function haversineKm(a: readonly [number, number], b: readonly [number, number]): number {
  const dLat = (b[1] - a[1]) * RAD
  const dLon = (b[0] - a[0]) * RAD
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Equirectangular approximation (fast, accurate for short distances away from the poles). */
export function planarKm(a: readonly [number, number], b: readonly [number, number]): number {
  const mid = ((a[1] + b[1]) / 2) * RAD
  return Math.hypot((b[0] - a[0]) * Math.cos(mid), b[1] - a[1]) * KM_PER_DEG
}

/** Point reached from (lon, lat) after `km` along an initial compass bearing (radians, clockwise from north). */
export function destination(lon: number, lat: number, bearing: number, km: number): LonLat {
  const d = km / R_KM
  const φ1 = lat * RAD
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(bearing))
  const λ = lon * RAD + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2))
  return [((((λ / RAD + 180) % 360) + 360) % 360) - 180, φ2 / RAD]
}

/** Closed ring of points exactly `km` from the centre along the sphere. */
export function geodesicCircle(lon: number, lat: number, km: number, steps = 72): LonLat[] {
  const ring = Array.from({ length: steps }, (_, i) => destination(lon, lat, (i / steps) * 2 * Math.PI, km))
  return [...ring, ring[0]]
}

/** Shortest haversine distance from a point to a polyline (km), measured to the segments, not just the vertices. */
export function distanceToPolylineKm(p: LonLat, line: readonly LonLat[], metric: 'haversine' | 'planar' = 'haversine'): number {
  if (line.length === 1) return metric === 'haversine' ? haversineKm(p, line[0]) : planarKm(p, line[0])
  const dist = metric === 'haversine' ? haversineKm : planarKm
  let best = Infinity
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]
    const b = line[i + 1]
    // project onto the segment in a local equirectangular frame, then measure the true distance to the foot point
    const c = Math.cos(((a[1] + b[1]) / 2) * RAD)
    const ax = a[0] * c, bx = b[0] * c, px = p[0] * c
    const dx = bx - ax, dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (p[1] - a[1]) * dy) / len2)) : 0
    best = Math.min(best, dist(p, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]))
  }
  return best
}

// ─── raster grids ───────────────────────────────────────────────────────────────────

/** Regular lon/lat grid whose nodes sit on the bounding box edges. Row 0 is the southern edge; NaN marks missing values. */
export interface Grid { nx: number; ny: number; west: number; east: number; south: number; north: number; values: Float64Array }

export interface BBox { west: number; east: number; south: number; north: number }

export const gridLon = (g: Grid, i: number) => g.west + (i * (g.east - g.west)) / (g.nx - 1)
export const gridLat = (g: Grid, j: number) => g.south + (j * (g.north - g.south)) / (g.ny - 1)

export function makeGrid(box: BBox, nx: number, ny: number, fn: (lon: number, lat: number) => number): Grid {
  const g: Grid = { nx, ny, ...box, values: new Float64Array(nx * ny) }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) g.values[j * nx + i] = fn(gridLon(g, i), gridLat(g, j))
  return g
}

/** Bilinear sample; NaN outside the grid or when a corner is missing. */
export function sampleGrid(g: Grid, lon: number, lat: number): number {
  const fx = ((lon - g.west) / (g.east - g.west)) * (g.nx - 1)
  const fy = ((lat - g.south) / (g.north - g.south)) * (g.ny - 1)
  if (!(fx >= 0 && fy >= 0 && fx <= g.nx - 1 && fy <= g.ny - 1)) return NaN
  const i = Math.min(g.nx - 2, Math.floor(fx))
  const j = Math.min(g.ny - 2, Math.floor(fy))
  const tx = fx - i, ty = fy - j
  const v = g.values
  const a = v[j * g.nx + i], b = v[j * g.nx + i + 1], c = v[(j + 1) * g.nx + i], d = v[(j + 1) * g.nx + i + 1]
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
}

export function gridExtent(g: Grid): [number, number] {
  let lo = Infinity, hi = -Infinity
  for (const v of g.values) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v }
  return lo <= hi ? [lo, hi] : [0, 1]
}

/** Cell size in metres at grid row j (east–west spacing shrinks with latitude). */
function cellMetres(g: Grid, j: number): [number, number] {
  const dLon = (g.east - g.west) / (g.nx - 1)
  const dLat = (g.north - g.south) / (g.ny - 1)
  return [dLon * KM_PER_DEG * 1000 * Math.cos(gridLat(g, j) * RAD), dLat * KM_PER_DEG * 1000]
}

/** Terrain gradient (∂z/∂east, ∂z/∂north), metres per metre, by Horn's 3×3 weighting (one-sided at the edges). NaN where undefined. */
export function gradientAt(g: Grid, i: number, j: number): [number, number] {
  const at = (ii: number, jj: number) => g.values[Math.max(0, Math.min(g.ny - 1, jj)) * g.nx + Math.max(0, Math.min(g.nx - 1, ii))]
  const i0 = Math.max(0, i - 1), i1 = Math.min(g.nx - 1, i + 1)
  const j0 = Math.max(0, j - 1), j1 = Math.min(g.ny - 1, j + 1)
  const [dx, dy] = cellMetres(g, j)
  const dzdx = (at(i1, j + 1) + 2 * at(i1, j) + at(i1, j - 1) - at(i0, j + 1) - 2 * at(i0, j) - at(i0, j - 1)) / (8 * dx * ((i1 - i0) / 2))
  const dzdy = (at(i + 1, j1) + 2 * at(i, j1) + at(i - 1, j1) - at(i + 1, j0) - 2 * at(i, j0) - at(i - 1, j0)) / (8 * dy * ((j1 - j0) / 2))
  return [dzdx, dzdy]
}

/**
 * Hillshade in [0, 1]: the cosine of the angle between the surface normal and the direction to the light.
 * `azimuth` is the compass bearing of the light (clockwise from north), `altitude` its angle above the horizon, both in degrees.
 */
export function hillshade(dem: Grid, azimuth: number, altitude: number, zFactor = 1): Grid {
  const az = azimuth * RAD, alt = altitude * RAD
  const L = [Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt)]
  const out: Grid = { ...dem, values: new Float64Array(dem.values.length) }
  for (let j = 0; j < dem.ny; j++) for (let i = 0; i < dem.nx; i++) {
    const [zx, zy] = gradientAt(dem, i, j)
    const gx = zx * zFactor, gy = zy * zFactor
    const norm = Math.sqrt(1 + gx * gx + gy * gy)
    out.values[j * dem.nx + i] = Math.max(0, (-gx * L[0] - gy * L[1] + L[2]) / norm)
  }
  return out
}

/** Slope in degrees (0 = flat) and compass aspect in degrees (direction the surface faces downhill; NaN where flat). */
export function slopeAspect(dem: Grid, zFactor = 1): { slope: Grid; aspect: Grid } {
  const slope: Grid = { ...dem, values: new Float64Array(dem.values.length) }
  const aspect: Grid = { ...dem, values: new Float64Array(dem.values.length) }
  for (let j = 0; j < dem.ny; j++) for (let i = 0; i < dem.nx; i++) {
    const [zx, zy] = gradientAt(dem, i, j)
    const gx = zx * zFactor, gy = zy * zFactor
    const k = j * dem.nx + i
    slope.values[k] = Math.atan(Math.hypot(gx, gy)) / RAD
    aspect.values[k] = Math.hypot(gx, gy) < 1e-9 ? NaN : (((Math.atan2(-gx, -gy) / RAD) % 360) + 360) % 360
  }
  return { slope, aspect }
}

// ─── terrain & surfaces ─────────────────────────────────────────────────────────────

export interface Hill { lon: number; lat: number; height: number; radiusKm: number }

/** Smooth seeded value noise in [0, 1) (bicubic-smoothstep interpolation of lattice hashes). */
export function valueNoise(seed: number) {
  const hash = (x: number, y: number) => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed | 0, 1442695041)) | 0
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }
  const s = (t: number) => t * t * (3 - 2 * t)
  return (x: number, y: number) => {
    const x0 = Math.floor(x), y0 = Math.floor(y)
    const tx = s(x - x0), ty = s(y - y0)
    const a = hash(x0, y0), b = hash(x0 + 1, y0), c = hash(x0, y0 + 1), d = hash(x0 + 1, y0 + 1)
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
  }
}

/** Fractal (fBm) noise in roughly [−0.5, 0.5]. */
export function fbm(seed: number, octaves = 4) {
  const n = valueNoise(seed)
  return (x: number, y: number) => {
    let amp = 1, freq = 1, sum = 0, norm = 0
    for (let o = 0; o < octaves; o++) { sum += amp * (n(x * freq, y * freq) - 0.5); norm += amp; amp *= 0.5; freq *= 2 }
    return sum / norm
  }
}

/** Height at (lon, lat) of a sum of Gaussian hills (distance on the sphere), plus optional fractal roughness (metres of amplitude). */
export function hillsHeight(hills: readonly Hill[], roughness = 0, seed = 1) {
  const noise = roughness > 0 ? fbm(seed, 4) : null
  return (lon: number, lat: number) => {
    let z = 0
    for (const h of hills) {
      const d = planarKm([lon, lat], [h.lon, h.lat])
      z += h.height * Math.exp(-(d * d) / (2 * h.radiusKm * h.radiusKm))
    }
    return Math.max(0, z + (noise ? roughness * noise(lon * 9, lat * 9) * 2 * (0.35 + Math.min(1, z / 600)) : 0))
  }
}

/** Inverse-distance-weighted estimate at (lon, lat) from sample points (k nearest, exponent `power`). Exact at sample locations. */
export function idwAt(samples: readonly { lon: number; lat: number; value: number }[], lon: number, lat: number, power = 2, k = 8): number {
  if (!samples.length) return NaN
  const near: { d: number; v: number }[] = []
  for (const s of samples) {
    const d = planarKm([lon, lat], [s.lon, s.lat])
    if (d < 1e-9) return s.value
    near.push({ d, v: s.value })
  }
  near.sort((a, b) => a.d - b.d)
  let num = 0, den = 0
  for (const n of near.slice(0, k)) { const w = 1 / n.d ** power; num += w * n.v; den += w }
  return num / den
}

/** Bounding box of the points, padded by a fraction of its span. */
export function padBox(points: readonly { lon: number; lat: number }[], pad = 0.08, minSpan = 0.5): BBox {
  const [w0, e0] = d3.extent(points, (p) => p.lon) as [number, number]
  const [s0, n0] = d3.extent(points, (p) => p.lat) as [number, number]
  const dx = Math.max(minSpan, e0 - w0) * pad, dy = Math.max(minSpan, n0 - s0) * pad
  const cx = (w0 + e0) / 2, cy = (s0 + n0) / 2
  const hw = Math.max(minSpan, e0 - w0) / 2 + dx, hh = Math.max(minSpan, n0 - s0) / 2 + dy
  return { west: Math.max(-180, cx - hw), east: Math.min(180, cx + hw), south: Math.max(-90, cy - hh), north: Math.min(90, cy + hh) }
}

// ─── kernel density on the map ──────────────────────────────────────────────────────

export interface WeightedPoint { lon: number; lat: number; weight: number }

/**
 * Gaussian kernel density on a lon/lat grid, in weight per km². Distances are measured on the ground (equirectangular km), so the density of
 * a point cloud integrates to its total weight over the plane: Σ density × cell area ≈ Σ weight when the grid covers the kernel tails.
 */
export function kdeMap(points: readonly WeightedPoint[], bandwidthKm: number, box: BBox, nx: number, ny: number): Grid {
  const g: Grid = { nx, ny, ...box, values: new Float64Array(nx * ny) }
  const h2 = bandwidthKm * bandwidthKm
  const norm = 1 / (2 * Math.PI * h2)
  const cut = (4 * bandwidthKm) ** 2
  for (let j = 0; j < ny; j++) {
    const lat = gridLat(g, j)
    const cosLat = Math.cos(lat * RAD)
    for (let i = 0; i < nx; i++) {
      const lon = gridLon(g, i)
      let sum = 0
      for (const p of points) {
        const dx = (p.lon - lon) * cosLat * KM_PER_DEG, dy = (p.lat - lat) * KM_PER_DEG
        const d2 = dx * dx + dy * dy
        if (d2 < cut) sum += p.weight * Math.exp(-d2 / (2 * h2))
      }
      g.values[j * nx + i] = sum * norm
    }
  }
  return g
}

/** Area of one grid cell (km²) at row j. */
export function cellAreaKm2At(g: Grid, j: number): number {
  const [dx, dy] = cellMetres(g, j)
  return (dx * dy) / 1e6
}

// ─── aggregation: square grid & clustering ──────────────────────────────────────────

export type GridAgg = 'count' | 'sum' | 'mean' | 'max'

export interface SquareCell { ix: number; iy: number; count: number; sum: number; max: number; rows: number[]; value: number }

/**
 * Bins points into square cells of `cellKm` on a local equal-distance plane (x = east km, y = north km from the origin latitude),
 * so every cell has the same ground size whatever the map projection.
 */
export function squareGrid(points: readonly { lon: number; lat: number; value: number; row: number }[], cellKm: number, agg: GridAgg, origin: LonLat): SquareCell[] {
  const cosO = Math.cos(origin[1] * RAD)
  const cells = new Map<string, SquareCell>()
  for (const p of points) {
    const x = (p.lon - origin[0]) * cosO * KM_PER_DEG
    const y = (p.lat - origin[1]) * KM_PER_DEG
    const ix = Math.floor(x / cellKm), iy = Math.floor(y / cellKm)
    const key = `${ix},${iy}`
    let c = cells.get(key)
    if (!c) { c = { ix, iy, count: 0, sum: 0, max: -Infinity, rows: [], value: 0 }; cells.set(key, c) }
    c.count++; c.sum += p.value; c.max = Math.max(c.max, p.value); c.rows.push(p.row)
  }
  for (const c of cells.values()) c.value = agg === 'count' ? c.count : agg === 'sum' ? c.sum : agg === 'mean' ? c.sum / c.count : c.max
  return [...cells.values()]
}

/** Lon/lat corners of a square cell produced by `squareGrid` (closed ring). */
export function squareCorners(c: Pick<SquareCell, 'ix' | 'iy'>, cellKm: number, origin: LonLat): LonLat[] {
  const cosO = Math.cos(origin[1] * RAD)
  const pt = (ix: number, iy: number): LonLat => [origin[0] + (ix * cellKm) / (cosO * KM_PER_DEG), origin[1] + (iy * cellKm) / KM_PER_DEG]
  return [pt(c.ix, c.iy), pt(c.ix + 1, c.iy), pt(c.ix + 1, c.iy + 1), pt(c.ix, c.iy + 1), pt(c.ix, c.iy)]
}

export interface Cluster { id: string; x: number; y: number; weight: number; count: number; members: number[] }

/**
 * Greedy radius clustering on screen coordinates: points are visited in order, each one not yet taken gathers every untaken point within
 * `radius` pixels and the cluster sits at their weighted centroid. Deterministic for a given point order.
 */
export function clusterByRadius(points: readonly { x: number; y: number; weight: number; index: number }[], radius: number): Cluster[] {
  const cell = Math.max(1e-6, radius)
  const buckets = new Map<string, number[]>()
  points.forEach((p, k) => {
    const key = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`
    ;(buckets.get(key) ?? buckets.set(key, []).get(key)!).push(k)
  })
  const taken = new Uint8Array(points.length)
  const out: Cluster[] = []
  points.forEach((p, k) => {
    if (taken[k]) return
    const bx = Math.floor(p.x / cell), by = Math.floor(p.y / cell)
    const group: number[] = []
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const m of buckets.get(`${bx + dx},${by + dy}`) ?? []) {
        if (!taken[m] && Math.hypot(points[m].x - p.x, points[m].y - p.y) <= radius) group.push(m)
      }
    }
    let w = 0, sx = 0, sy = 0
    for (const m of group) { taken[m] = 1; const q = points[m]; w += q.weight; sx += q.x * q.weight; sy += q.y * q.weight }
    out.push({ id: `c${group.map((m) => points[m].index).sort((a, b) => a - b)[0]}:${group.length}`, x: w > 0 ? sx / w : p.x, y: w > 0 ? sy / w : p.y, weight: w, count: group.length, members: group.map((m) => points[m].index) })
  })
  return out
}

// ─── vector fields & streamlines ────────────────────────────────────────────────────

export interface FieldSource { kind: 'vortex' | 'source' | 'sink'; lon: number; lat: number; strength: number; radiusKm: number }

export interface VectorField { sources: FieldSource[]; /** Uniform background wind (m/s, east and north components). */ uniform: [number, number] }

/**
 * Velocity (u east, v north, m/s) of a synthetic field: a uniform flow plus smooth vortices, sources and sinks of the form
 * Γ·a·(−dy, dx)/(r²+a²) (vortex, counter-clockwise for Γ > 0) and Γ·a·(dx, dy)/(r²+a²) (source; a sink is a source with Γ < 0).
 */
export function fieldAt(field: VectorField, lon: number, lat: number): [number, number] {
  let u = field.uniform[0], v = field.uniform[1]
  for (const s of field.sources) {
    const dx = (lon - s.lon) * Math.cos(lat * RAD) * KM_PER_DEG
    const dy = (lat - s.lat) * KM_PER_DEG
    const a = s.radiusKm
    const k = (s.kind === 'sink' ? -s.strength : s.strength) * a / (dx * dx + dy * dy + a * a)
    if (s.kind === 'vortex') { u += -dy * k; v += dx * k } else { u += dx * k; v += dy * k }
  }
  return [u, v]
}

export const speedOf = (f: readonly [number, number]) => Math.hypot(f[0], f[1])

/** Divergence and curl (1/s × 1e5) of the field at a point by central differences over ±`stepKm`. */
export function divergenceCurl(field: VectorField, lon: number, lat: number, stepKm = 5): { div: number; curl: number } {
  const dLat = stepKm / KM_PER_DEG
  const dLon = stepKm / (KM_PER_DEG * Math.cos(lat * RAD))
  const e = fieldAt(field, lon + dLon, lat), w = fieldAt(field, lon - dLon, lat), n = fieldAt(field, lon, lat + dLat), s = fieldAt(field, lon, lat - dLat)
  const m = stepKm * 1000 * 2
  return { div: ((e[0] - w[0]) / m + (n[1] - s[1]) / m) * 1e5, curl: ((e[1] - w[1]) / m - (n[0] - s[0]) / m) * 1e5 }
}

/** One RK4 step of length `stepKm` along the (normalised) flow direction. Returns null where the flow stalls. */
export function rk4Step(field: VectorField, p: LonLat, stepKm: number, dir: 1 | -1 = 1): LonLat | null {
  const unit = (q: LonLat): [number, number] | null => {
    const [u, v] = fieldAt(field, q[0], q[1])
    const s = Math.hypot(u, v)
    if (s < 1e-9) return null
    // metres/second → degrees per unit arc length
    return [(dir * u) / s / (KM_PER_DEG * Math.cos(q[1] * RAD)), (dir * v) / s / KM_PER_DEG]
  }
  const k1 = unit(p); if (!k1) return null
  const k2 = unit([p[0] + (k1[0] * stepKm) / 2, p[1] + (k1[1] * stepKm) / 2]); if (!k2) return null
  const k3 = unit([p[0] + (k2[0] * stepKm) / 2, p[1] + (k2[1] * stepKm) / 2]); if (!k3) return null
  const k4 = unit([p[0] + k3[0] * stepKm, p[1] + k3[1] * stepKm]); if (!k4) return null
  return [p[0] + (stepKm / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]), p[1] + (stepKm / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])]
}

const inBox = (p: LonLat, b: BBox) => p[0] >= b.west && p[0] <= b.east && p[1] >= b.south && p[1] <= b.north

/** Single streamline through `seed`, integrated both ways until it leaves the box, stalls or reaches `maxSteps`. */
export function streamline(field: VectorField, seed: LonLat, box: BBox, stepKm: number, maxSteps = 200): LonLat[] {
  const trace = (dir: 1 | -1) => {
    const pts: LonLat[] = []
    let p = seed
    for (let i = 0; i < maxSteps; i++) {
      const q = rk4Step(field, p, stepKm, dir)
      if (!q || !inBox(q, box)) break
      pts.push(q)
      p = q
    }
    return pts
  }
  return [...trace(-1).reverse(), seed, ...trace(1)]
}

/**
 * Evenly spaced streamlines (Jobard–Lefer): seeds are tried in raster order, a line is kept only if it starts at least `sepKm` from every
 * kept line, and integration stops when it comes closer than `0.5·sepKm` to another line (or its own earlier part). The result fills the
 * map with roughly uniform line density instead of piling lines up near sources.
 */
export function evenStreamlines(field: VectorField, box: BBox, sepKm: number, stepKm: number, maxSteps = 160, extraSeeds: readonly LonLat[] = []): LonLat[][] {
  const midLat = (box.north + box.south) / 2
  const cx = sepKm / (KM_PER_DEG * Math.cos(midLat * RAD)), cy = sepKm / KM_PER_DEG
  const occ = new Map<string, LonLat[]>()
  const key = (p: LonLat) => `${Math.floor((p[0] - box.west) / cx)},${Math.floor((p[1] - box.south) / cy)}`
  const near = (p: LonLat, minKm: number, skip?: Set<LonLat>) => {
    const kx = Math.floor((p[0] - box.west) / cx), ky = Math.floor((p[1] - box.south) / cy)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const q of occ.get(`${kx + dx},${ky + dy}`) ?? []) if (!skip?.has(q) && planarKm(p, q) < minKm) return true
    }
    return false
  }
  const lines: LonLat[][] = []
  const add = (line: LonLat[]) => { for (const q of line) (occ.get(key(q)) ?? occ.set(key(q), []).get(key(q))!).push(q) }
  const grow = (seed: LonLat): LonLat[] => {
    const own = new Set<LonLat>()
    const trace = (dir: 1 | -1) => {
      const pts: LonLat[] = []
      let p = seed
      for (let i = 0; i < maxSteps; i++) {
        const q = rk4Step(field, p, stepKm, dir)
        if (!q || !inBox(q, box) || near(q, sepKm * 0.5, own)) break
        pts.push(q)
        // the last few own points are never "too close" to themselves
        if (pts.length > 4) own.add(pts[pts.length - 5])
        p = q
      }
      return pts
    }
    return [...trace(-1).reverse(), seed, ...trace(1)]
  }
  const seeds: LonLat[] = [...extraSeeds]
  for (let y = box.south + cy / 2; y < box.north; y += cy) for (let x = box.west + cx / 2; x < box.east; x += cx) seeds.push([x, y])
  for (const s of seeds) {
    if (!inBox(s, box) || near(s, sepKm)) continue
    const line = grow(s)
    if (line.length < 4) continue
    lines.push(line)
    add(line)
  }
  return lines
}

/**
 * Particles advected through the field in lon/lat space: each step moves a particle by velocity × dt × speedUp (m/s × s → km). A particle that
 * leaves the box or outlives `maxAge` steps respawns at a random place.
 */
export interface Particle { lon: number; lat: number; age: number; trail: LonLat[] }

export function stepParticles(particles: Particle[], field: VectorField, box: BBox, dtSeconds: number, speedUp: number, maxAge: number, rng: () => number, trailLength = 6): void {
  for (const p of particles) {
    const [u, v] = fieldAt(field, p.lon, p.lat)
    const dist = speedUp * dtSeconds / 1000
    p.trail.push([p.lon, p.lat])
    if (p.trail.length > trailLength) p.trail.shift()
    p.lon += (u * dist) / (KM_PER_DEG * Math.cos(p.lat * RAD))
    p.lat += (v * dist) / KM_PER_DEG
    p.age++
    if (p.age > maxAge || !inBox([p.lon, p.lat], box)) {
      p.lon = box.west + rng() * (box.east - box.west)
      p.lat = box.south + rng() * (box.north - box.south)
      p.age = 0
      p.trail = []
    }
  }
}

// ─── isochrones on a road network ───────────────────────────────────────────────────

export interface RoadEdge { a: number; b: number; km: number; speed: number }

/** Dijkstra from `source` over an undirected edge list; returns the travel time in minutes to every node (Infinity if unreachable). */
export function travelTimes(nodeCount: number, edges: readonly RoadEdge[], source: number): Float64Array {
  const adj: { to: number; min: number }[][] = Array.from({ length: nodeCount }, () => [])
  for (const e of edges) { const m = (e.km / e.speed) * 60; adj[e.a].push({ to: e.b, min: m }); adj[e.b].push({ to: e.a, min: m }) }
  const dist = new Float64Array(nodeCount).fill(Infinity)
  dist[source] = 0
  // binary heap of [time, node]
  const heap: [number, number][] = [[0, source]]
  const push = (x: [number, number]) => { heap.push(x); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p } }
  const pop = () => {
    const top = heap[0]; const last = heap.pop()!
    if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m } }
    return top
  }
  while (heap.length) {
    const [t, u] = pop()
    if (t > dist[u]) continue
    for (const { to, min } of adj[u]) if (t + min < dist[to]) { dist[to] = t + min; push([dist[to], to]) }
  }
  return dist
}

/**
 * Travel-time surface: at each grid point the best of "drive to a network node, then continue off-network at `offKmh`".
 * Nodes farther than `maxSnapKm` are ignored, so the surface cannot jump across the sea.
 */
export function timeSurface(nodes: readonly LonLat[], times: ArrayLike<number>, box: BBox, nx: number, ny: number, offKmh: number, maxSnapKm = 60): Grid {
  const g: Grid = { nx, ny, ...box, values: new Float64Array(nx * ny).fill(Infinity) }
  const cellLon = (box.east - box.west) / (nx - 1), cellLat = (box.north - box.south) / (ny - 1)
  nodes.forEach((n, k) => {
    const t = times[k]
    if (!Number.isFinite(t)) return
    const rLat = maxSnapKm / KM_PER_DEG, rLon = maxSnapKm / (KM_PER_DEG * Math.cos(n[1] * RAD))
    const i0 = Math.max(0, Math.floor((n[0] - rLon - box.west) / cellLon)), i1 = Math.min(nx - 1, Math.ceil((n[0] + rLon - box.west) / cellLon))
    const j0 = Math.max(0, Math.floor((n[1] - rLat - box.south) / cellLat)), j1 = Math.min(ny - 1, Math.ceil((n[1] + rLat - box.south) / cellLat))
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = planarKm(n, [gridLon(g, i), gridLat(g, j)])
      if (d > maxSnapKm) continue
      const tt = t + (d / offKmh) * 60
      if (tt < g.values[j * nx + i]) g.values[j * nx + i] = tt
    }
  })
  for (let k = 0; k < g.values.length; k++) if (!Number.isFinite(g.values[k])) g.values[k] = NaN
  return g
}

/**
 * Contour polygons of a grid, as lon/lat rings. `above` encloses the cells with value ≥ threshold (elevation bands); `below` encloses value ≤ threshold
 * (isochrones: everything reachable within the time). Missing cells are never inside.
 */
export function gridContours(g: Grid, thresholds: readonly number[], side: 'above' | 'below' = 'above'): { value: number; polygons: LonLat[][][] }[] {
  const sign = side === 'above' ? 1 : -1
  const values = Array.from(g.values, (v) => (Number.isFinite(v) ? sign * v : -1e12))
  const gen = d3.contours().size([g.nx, g.ny]).thresholds(thresholds.map((t) => sign * t))
  // d3-contour puts node (i, j) at (i + 0.5, j + 0.5) and closes polygons along the outer edge half a cell beyond the nodes; clamp that back to the grid.
  const cl = (v: number, n: number) => Math.max(0, Math.min(n - 1, v))
  const toLonLat = (c: number[]): LonLat => [g.west + (cl(c[0] - 0.5, g.nx) / (g.nx - 1)) * (g.east - g.west), g.south + (cl(c[1] - 0.5, g.ny) / (g.ny - 1)) * (g.north - g.south)]
  return gen(values).map((m) => ({ value: sign * m.value, polygons: m.coordinates.map((poly) => poly.map((ring) => ring.map(toLonLat))) })).sort((a, b) => a.value - b.value)
}

/**
 * Isolines (contour lines) of a grid: the outline of each level's region with the stretches that merely follow the grid's outer edge removed,
 * so only real contours remain. Returns, for every level, a list of open or closed polylines in lon/lat.
 */
export function gridIsolines(g: Grid, levels: readonly number[]): { value: number; lines: LonLat[][] }[] {
  const eps = 1e-9
  const onEdge = (p: LonLat) => Math.abs(p[0] - g.west) < eps || Math.abs(p[0] - g.east) < eps || Math.abs(p[1] - g.south) < eps || Math.abs(p[1] - g.north) < eps
  return gridContours(g, levels).map(({ value, polygons }) => {
    const lines: LonLat[][] = []
    for (const poly of polygons) for (const ring of poly) {
      let run: LonLat[] = []
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length]
        if (onEdge(p) && onEdge(q) && (Math.abs(p[0] - q[0]) < eps || Math.abs(p[1] - q[1]) < eps)) { if (run.length > 1) lines.push(run); run = [] } else { if (!run.length) run.push(p); run.push(q) }
      }
      if (run.length > 1) lines.push(run)
    }
    return { value, lines }
  })
}

/** A "nice" step (1, 2 or 5 × 10ⁿ) giving roughly `count` intervals over [lo, hi]. */
export function niceInterval(lo: number, hi: number, count = 10): number {
  const raw = (hi - lo) / count
  if (!(raw > 0)) return 1
  const p = 10 ** Math.floor(Math.log10(raw))
  const f = raw / p
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p
}

/** Levels at every multiple of `interval` strictly inside (lo, hi). */
export function contourLevels(lo: number, hi: number, interval: number): number[] {
  if (!(interval > 0)) return []
  const out: number[] = []
  for (let v = Math.ceil(lo / interval) * interval; v <= hi && out.length < 400; v += interval) if (v > lo) out.push(Math.round(v / interval) * interval)
  return out
}

/** Structure-of-arrays particle state for the animated flow map (no per-frame allocation). */
export interface ParticleBuffer { lon: Float32Array; lat: Float32Array; age: Uint16Array; speed: Float32Array }

export function makeParticles(n: number, box: BBox, rng: () => number, maxAge: number): ParticleBuffer {
  const b: ParticleBuffer = { lon: new Float32Array(n), lat: new Float32Array(n), age: new Uint16Array(n), speed: new Float32Array(n) }
  for (let i = 0; i < n; i++) { b.lon[i] = box.west + rng() * (box.east - box.west); b.lat[i] = box.south + rng() * (box.north - box.south); b.age[i] = Math.floor(rng() * maxAge) }
  return b
}

/** Advances every particle by velocity × dt × speedUp (m/s × s → km) and respawns the ones that left the box or reached `maxAge`. */
export function stepParticleBuffer(b: ParticleBuffer, field: VectorField, box: BBox, dtSeconds: number, speedUp: number, maxAge: number, rng: () => number): void {
  const km = (dtSeconds * speedUp) / 1000
  for (let i = 0; i < b.lon.length; i++) {
    const [u, v] = fieldAt(field, b.lon[i], b.lat[i])
    b.speed[i] = Math.hypot(u, v)
    b.lon[i] += (u * km) / (KM_PER_DEG * Math.cos(b.lat[i] * RAD))
    b.lat[i] += (v * km) / KM_PER_DEG
    b.age[i]++
    if (b.age[i] > maxAge || b.lon[i] < box.west || b.lon[i] > box.east || b.lat[i] < box.south || b.lat[i] > box.north) {
      b.lon[i] = box.west + rng() * (box.east - box.west)
      b.lat[i] = box.south + rng() * (box.north - box.south)
      b.age[i] = 0
    }
  }
}

// ─── dasymetric mapping ─────────────────────────────────────────────────────────────

export interface LandCell { /** Index of the region the cell lies in (−1 = outside every region). */ region: number; /** Land-use class index. */ cls: number; /** Ground area in km². */ area: number }

/**
 * Dasymetric redistribution: each region's total is spread over its cells in proportion to (class weight × cell area), so dense land uses carry
 * more of the total. Returns the density (total per km²) of every cell. The mass of each region is conserved: Σ density × area = total.
 */
export function dasymetricDensity(cells: readonly LandCell[], totals: readonly (number | null)[], weights: readonly number[]): Float64Array {
  const denom = new Float64Array(totals.length)
  for (const c of cells) if (c.region >= 0) denom[c.region] += (weights[c.cls] ?? 0) * c.area
  const out = new Float64Array(cells.length)
  cells.forEach((c, i) => {
    const t = c.region >= 0 ? totals[c.region] : null
    if (t != null && denom[c.region] > 0) out[i] = (t * (weights[c.cls] ?? 0)) / denom[c.region]
  })
  return out
}

export const LAND_CLASSES = ['도시', '농경지', '산림'] as const

/**
 * A synthetic land-use model (not observed land cover): cities are urban cores of ~`coreKm`, high ground is forest, the rest is mostly farmland.
 * Deterministic for a seed.
 */
export function syntheticLandUse(cities: readonly LonLat[], elevation: (lon: number, lat: number) => number, seed = 5, coreKm = 16) {
  const n1 = fbm(seed, 3), n2 = fbm(seed + 17, 3)
  return (lon: number, lat: number): number => {
    let u = 0
    for (const c of cities) { const d = planarKm([lon, lat], c); u = Math.max(u, Math.exp(-(d * d) / (2 * coreKm * coreKm))) }
    if (u + 0.35 * (n1(lon * 14, lat * 14) - 0.5) > 0.42) return 0
    const e = elevation(lon, lat)
    if (e > 220 + 380 * (n2(lon * 9, lat * 9) - 0.5)) return 2
    return n1(lon * 6 + 3, lat * 6 + 3) > 0.42 ? 1 : 2
  }
}

// ─── trajectories ───────────────────────────────────────────────────────────────────

export interface TrackPoint { t: number; lon: number; lat: number }

/** Position at time t by linear interpolation between the two surrounding records (the track must be sorted by time); null outside its span. */
export function trackAt(track: readonly TrackPoint[], t: number): LonLat | null {
  if (!track.length || t < track[0].t || t > track[track.length - 1].t) return null
  let lo = 0, hi = track.length - 1
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (track[mid].t <= t) lo = mid; else hi = mid }
  const a = track[lo], b = track[hi]
  const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t)
  return [a.lon + (b.lon - a.lon) * f, a.lat + (b.lat - a.lat) * f]
}

/** Path length in km (great-circle between consecutive records). */
export function trackLengthKm(track: readonly TrackPoint[]): number {
  let km = 0
  for (let i = 1; i < track.length; i++) km += haversineKm([track[i - 1].lon, track[i - 1].lat], [track[i].lon, track[i].lat])
  return km
}

/** Speed in km/h of the segment that contains time t (0 outside the track). */
export function trackSpeedKmh(track: readonly TrackPoint[], t: number): number {
  for (let i = 1; i < track.length; i++) {
    if (t >= track[i - 1].t && t <= track[i].t) {
      const hours = (track[i].t - track[i - 1].t) / 3600000
      return hours > 0 ? haversineKm([track[i - 1].lon, track[i - 1].lat], [track[i].lon, track[i].lat]) / hours : 0
    }
  }
  return 0
}

// ─── map-projection distortion ──────────────────────────────────────────────────────

/**
 * Local distortion of a projection at (lon, lat), from the Jacobian of the map from ground km (east, north) to screen pixels:
 * `det` is the area scale in px²/km², `omega` the maximum angular distortion in degrees (0 for conformal projections), s1 ≥ s2 the principal scales (px/km).
 */
export function projectionDistortion(projection: d3.GeoProjection, lon: number, lat: number, stepKm = 1): { det: number; omega: number; s1: number; s2: number } | null {
  const c = projection([lon, lat])
  const e = projection(destination(lon, lat, Math.PI / 2, stepKm))
  const n = projection(destination(lon, lat, 0, stepKm))
  if (!c || !e || !n || ![...c, ...e, ...n].every(Number.isFinite)) return null
  const a = (e[0] - c[0]) / stepKm, b = (n[0] - c[0]) / stepKm, cc = (e[1] - c[1]) / stepKm, d = (n[1] - c[1]) / stepKm
  const det = Math.abs(a * d - b * cc)
  // singular values of [[a, b], [cc, d]]
  const E = a * a + cc * cc, F = a * b + cc * d, G = b * b + d * d
  const tr = E + G, disc = Math.sqrt(Math.max(0, (E - G) ** 2 + 4 * F * F))
  const s1 = Math.sqrt((tr + disc) / 2), s2 = Math.sqrt(Math.max(0, (tr - disc) / 2))
  return { det, s1, s2, omega: s1 + s2 > 0 ? (2 * Math.asin(Math.min(1, (s1 - s2) / (s1 + s2))) * 180) / Math.PI : 0 }
}

// ─── raster utilities & profiles ────────────────────────────────────────────────────

/**
 * Builds a grid from scattered cell records that sit on a regular lon/lat lattice: the sorted distinct longitudes and latitudes (rounded to 1e-4°)
 * define the columns and rows, and every record lands in its cell. Cells without a record stay NaN. `rowOf[cell]` gives the source row (−1 if none).
 */
export function gridFromCells(cells: readonly { lon: number; lat: number; value: number | null; row: number }[]): { grid: Grid; rowOf: Int32Array; irregular: boolean } | null {
  if (!cells.length) return null
  const key = (v: number) => Math.round(v * 1e4)
  const lons = [...new Set(cells.map((c) => key(c.lon)))].sort((a, b) => a - b)
  const lats = [...new Set(cells.map((c) => key(c.lat)))].sort((a, b) => a - b)
  if (lons.length < 2 || lats.length < 2) return null
  const stepOf = (v: number[]) => Math.min(...v.slice(1).map((x, i) => x - v[i]))
  const dx = stepOf(lons), dy = stepOf(lats)
  const nx = Math.round((lons[lons.length - 1] - lons[0]) / dx) + 1, ny = Math.round((lats[lats.length - 1] - lats[0]) / dy) + 1
  if (nx * ny > 400000) return null
  const grid: Grid = { nx, ny, west: lons[0] / 1e4, east: lons[lons.length - 1] / 1e4, south: lats[0] / 1e4, north: lats[lats.length - 1] / 1e4, values: new Float64Array(nx * ny).fill(NaN) }
  const rowOf = new Int32Array(nx * ny).fill(-1)
  let irregular = false
  for (const c of cells) {
    const fi = (key(c.lon) - lons[0]) / dx, fj = (key(c.lat) - lats[0]) / dy
    const i = Math.round(fi), j = Math.round(fj)
    if (Math.abs(fi - i) > 0.2 || Math.abs(fj - j) > 0.2) irregular = true
    if (i < 0 || j < 0 || i >= nx || j >= ny) continue
    rowOf[j * nx + i] = c.row
    if (c.value != null && Number.isFinite(c.value)) grid.values[j * nx + i] = c.value
  }
  return { grid, rowOf, irregular }
}

/** Fills missing (NaN) cells with the inverse-distance-weighted mean of the `k` nearest valid cells (distance in cell units). */
export function fillMissing(g: Grid, k = 6): Grid {
  const valid: [number, number, number][] = []
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) { const v = g.values[j * g.nx + i]; if (Number.isFinite(v)) valid.push([i, j, v]) }
  const out: Grid = { ...g, values: Float64Array.from(g.values) }
  if (!valid.length) return out
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    if (Number.isFinite(g.values[j * g.nx + i])) continue
    const near = valid.map(([a, b, v]) => ({ d: Math.hypot(a - i, b - j), v })).sort((p, q) => p.d - q.d).slice(0, k)
    let num = 0, den = 0
    for (const n of near) { const w = 1 / (n.d * n.d); num += w * n.v; den += w }
    out.values[j * g.nx + i] = num / den
  }
  return out
}

/** Mean-pools a grid by an integer factor (blocks of f × f cells; NaN cells are ignored, an all-NaN block stays NaN). Coarser cells = lower resolution. */
export function coarsenGrid(g: Grid, f: number): Grid {
  if (f <= 1) return g
  const nx = Math.ceil(g.nx / f), ny = Math.ceil(g.ny / f)
  const out: Grid = { nx, ny, west: g.west, east: g.east, south: g.south, north: g.north, values: new Float64Array(nx * ny).fill(NaN) }
  const dLon = (g.east - g.west) / (g.nx - 1), dLat = (g.north - g.south) / (g.ny - 1)
  // block centres: the mean of the covered node positions
  const lastCol = (nx - 1) * f, lastRow = (ny - 1) * f
  out.west = g.west + ((Math.min(f, g.nx) - 1) / 2) * dLon
  out.east = g.west + (lastCol + (Math.min(f, g.nx - lastCol) - 1) / 2) * dLon
  out.south = g.south + ((Math.min(f, g.ny) - 1) / 2) * dLat
  out.north = g.south + (lastRow + (Math.min(f, g.ny - lastRow) - 1) / 2) * dLat
  for (let J = 0; J < ny; J++) for (let I = 0; I < nx; I++) {
    let s = 0, n = 0
    for (let j = J * f; j < Math.min(g.ny, (J + 1) * f); j++) for (let i = I * f; i < Math.min(g.nx, (I + 1) * f); i++) { const v = g.values[j * g.nx + i]; if (Number.isFinite(v)) { s += v; n++ } }
    if (n) out.values[J * nx + I] = s / n
  }
  return out
}

export interface Profile { dist: number[]; elev: number[]; points: LonLat[]; lengthKm: number; ascent: number; descent: number; maxSlopeDeg: number; min: number; max: number }

/** Elevation profile along the straight lon/lat line from a to b, sampled at `n` equally spaced points with great-circle distances. */
export function terrainProfile(at: (lon: number, lat: number) => number, a: LonLat, b: LonLat, n = 200): Profile {
  const points: LonLat[] = Array.from({ length: n }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / (n - 1), a[1] + ((b[1] - a[1]) * i) / (n - 1)])
  const elev = points.map((p) => at(p[0], p[1]))
  const dist: number[] = [0]
  for (let i = 1; i < n; i++) dist.push(dist[i - 1] + haversineKm(points[i - 1], points[i]))
  let ascent = 0, descent = 0, maxSlope = 0
  for (let i = 1; i < n; i++) {
    const dz = elev[i] - elev[i - 1]
    if (Number.isFinite(dz)) { if (dz > 0) ascent += dz; else descent -= dz }
    const run = (dist[i] - dist[i - 1]) * 1000
    if (run > 0 && Number.isFinite(dz)) maxSlope = Math.max(maxSlope, (Math.atan(Math.abs(dz) / run) * 180) / Math.PI)
  }
  const fin = elev.filter(Number.isFinite)
  return { dist, elev, points, lengthKm: dist[n - 1], ascent, descent, maxSlopeDeg: maxSlope, min: Math.min(...fin), max: Math.max(...fin) }
}

/** Which profile samples are visible from the first one, standing `eyeHeight` m above the ground: a point is visible when its elevation angle is not below that of every nearer point. */
export function lineOfSight(profile: Pick<Profile, 'dist' | 'elev'>, eyeHeight: number): boolean[] {
  const z0 = profile.elev[0] + eyeHeight
  const vis: boolean[] = [true]
  let best = -Infinity
  for (let i = 1; i < profile.dist.length; i++) {
    const ang = (profile.elev[i] - z0) / ((profile.dist[i] - profile.dist[0]) * 1000)
    vis.push(ang >= best)
    if (ang > best) best = ang
  }
  return vis
}
