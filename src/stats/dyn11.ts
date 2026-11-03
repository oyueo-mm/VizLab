// ───────────────────────────── Matrix Cube ─────────────────────────────

export interface Cube { nodes: string[]; times: number[]; /** weights, indexed [t][i][j] as t·N² + i·N + j; symmetric in i, j */ w: Float32Array; n: number }

export interface DynEdge { t: number; a: string; b: string; w: number }

/** Dynamic network as a space-time cube of adjacency matrices (Bach, Pietriga & Fekete 2014). Edges are undirected, repeated edges add their weights. */
export function buildCube(edges: readonly DynEdge[], order?: readonly string[]): Cube {
  const nodes = order ? [...order] : [...new Set(edges.flatMap((e) => [e.a, e.b]))].sort()
  const times = [...new Set(edges.map((e) => e.t))].sort((x, y) => x - y)
  const n = nodes.length
  const ni = new Map(nodes.map((v, i) => [v, i])), ti = new Map(times.map((v, i) => [v, i]))
  const w = new Float32Array(times.length * n * n)
  for (const e of edges) {
    const i = ni.get(e.a), j = ni.get(e.b), t = ti.get(e.t)
    if (i == null || j == null || t == null) continue
    w[t * n * n + i * n + j] += e.w
    if (i !== j) w[t * n * n + j * n + i] += e.w
  }
  return { nodes, times, w, n }
}

/** The adjacency matrix of one time step (a cut orthogonal to the time axis). */
export function timeSlice(c: Cube, t: number): Float32Array { return c.w.slice(t * c.n * c.n, (t + 1) * c.n * c.n) }

/** The cut orthogonal to a node axis: rows = the other node j, columns = time; the connection history of node i. */
export function nodeSlice(c: Cube, i: number): Float32Array {
  const out = new Float32Array(c.n * c.times.length)
  for (let t = 0; t < c.times.length; t++) for (let j = 0; j < c.n; j++) out[j * c.times.length + t] = c.w[t * c.n * c.n + i * c.n + j]
  return out
}

/** Projection along the time axis: the aggregate matrix (sum of all slices). */
export function projectTime(c: Cube): Float32Array {
  const out = new Float32Array(c.n * c.n)
  for (let t = 0; t < c.times.length; t++) for (let k = 0; k < c.n * c.n; k++) out[k] += c.w[t * c.n * c.n + k]
  return out
}

// ───────────────────────────── Parallel Edge Splatting ─────────────────────────────

/**
 * Density field of the edges of one time step (Burch et al. 2011): the stripe has the source nodes on its left border and the target nodes on its right
 * border (both ordered the same way); an edge (i → j) is the straight line from (0, y_i) to (1, y_j). Every column of the stripe is one sample along the line;
 * the edge weight is split between the two nearest rows, so every column of a stripe sums to the total weight of the edges.
 */
export function splatStripe(edges: readonly { i: number; j: number; w: number }[], nNodes: number, cols: number, rows: number): Float32Array {
  const d = new Float32Array(cols * rows)
  const y = (k: number) => ((k + 0.5) / nNodes) * rows - 0.5
  for (const e of edges) {
    const y0 = y(e.i), y1 = y(e.j)
    for (let c = 0; c < cols; c++) {
      const u = cols === 1 ? 0 : c / (cols - 1)
      const yy = Math.max(0, Math.min(rows - 1, y0 + (y1 - y0) * u))
      const r = Math.floor(yy), f = yy - r
      d[r * cols + c] += e.w * (1 - f)
      if (r + 1 < rows) d[(r + 1) * cols + c] += e.w * f
      else d[r * cols + c] += e.w * f
    }
  }
  return d
}

// ───────────────────────────── Continuous scatterplot / parallel coordinates ─────────────────────────────

export interface Field2 { nx: number; ny: number; /** attribute values, attr[a][y·nx + x] */ attr: Float64Array[] }

export interface MappedTri { a: [number, number]; b: [number, number]; c: [number, number]; /** spatial area of the source triangle */ areaS: number }

/** The two triangles of every grid cell (unit spacing) mapped into the attribute plane (p, q) by linear interpolation. */
export function mapTriangles(f: Field2, p: number, q: number): MappedTri[] {
  const out: MappedTri[] = []
  const P = f.attr[p], Q = f.attr[q]
  const at = (x: number, y: number): [number, number] => [P[y * f.nx + x], Q[y * f.nx + x]]
  for (let y = 0; y + 1 < f.ny; y++) for (let x = 0; x + 1 < f.nx; x++) {
    const v00 = at(x, y), v10 = at(x + 1, y), v01 = at(x, y + 1), v11 = at(x + 1, y + 1)
    out.push({ a: v00, b: v10, c: v11, areaS: 0.5 }, { a: v00, b: v11, c: v01, areaS: 0.5 })
  }
  return out
}

export interface Scatter2D { cols: number; rows: number; density: Float32Array; xr: [number, number]; yr: [number, number]; mass: number; skipped: number }

const triArea = (a: [number, number], b: [number, number], c: [number, number]) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2

/**
 * Continuous scatterplot (Bachthaler & Weiskopf 2008) of two attributes of a piecewise-linear field: each spatial triangle maps to a triangle of the
 * attribute plane with constant density (spatial area ÷ mapped area) there; the densities of overlapping preimages add. Degenerate (zero-area) images carry
 * their mass on a line and are counted in `skipped` instead of being drawn. Mass: Σ density · pixel area ≈ total spatial area.
 */
export function continuousScatterplot(f: Field2, p: number, q: number, cols: number, rows: number, range?: { x: [number, number]; y: [number, number] }): Scatter2D {
  const tris = mapTriangles(f, p, q)
  const ext = (k: number) => { let lo = Infinity, hi = -Infinity; for (const v of f.attr[k]) { if (v < lo) lo = v; if (v > hi) hi = v } return [lo, hi] as [number, number] }
  const xr = range?.x ?? ext(p), yr = range?.y ?? ext(q)
  const dx = (xr[1] - xr[0]) / cols || 1, dy = (yr[1] - yr[0]) / rows || 1
  const density = new Float32Array(cols * rows)
  let skipped = 0
  const SS = 3
  for (const t of tris) {
    const A = triArea(t.a, t.b, t.c)
    if (A < 1e-12) { skipped++; continue }
    const dens = t.areaS / A
    const minx = Math.min(t.a[0], t.b[0], t.c[0]), maxx = Math.max(t.a[0], t.b[0], t.c[0]), miny = Math.min(t.a[1], t.b[1], t.c[1]), maxy = Math.max(t.a[1], t.b[1], t.c[1])
    const c0 = Math.max(0, Math.floor((minx - xr[0]) / dx)), c1 = Math.min(cols - 1, Math.floor((maxx - xr[0]) / dx))
    const r0 = Math.max(0, Math.floor((miny - yr[0]) / dy)), r1 = Math.min(rows - 1, Math.floor((maxy - yr[0]) / dy))
    const det = (t.b[0] - t.a[0]) * (t.c[1] - t.a[1]) - (t.c[0] - t.a[0]) * (t.b[1] - t.a[1])
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      let cover = 0
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        // the offsets keep the sample points off the shared diagonals, where both triangles would claim them
        const px = xr[0] + (c + (sx + 0.5) / SS + 0.0137) * dx, py = yr[0] + (r + (sy + 0.5) / SS + 0.0291) * dy
        const l1 = ((px - t.a[0]) * (t.c[1] - t.a[1]) - (t.c[0] - t.a[0]) * (py - t.a[1])) / det
        const l2 = ((t.b[0] - t.a[0]) * (py - t.a[1]) - (px - t.a[0]) * (t.b[1] - t.a[1])) / det
        if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) cover++
      }
      density[r * cols + c] += (dens * cover) / (SS * SS)
    }
  }
  let mass = 0
  for (const v of density) mass += v * dx * dy
  return { cols, rows, density, xr, yr, mass, skipped }
}

export interface ParallelDensity { cols: number; rows: number; density: Float32Array; lo: number; hi: number; mass: number }

/**
 * Continuous parallel coordinates (Heinrich & Weiskopf 2009) between two neighbouring axes: by the point-line duality every point (x, y) of the continuous
 * scatterplot becomes the line from (axis 1, x) to (axis 2, y); the density of the scatterplot is spread along these lines. The preimage triangles are
 * sampled with a barycentric grid (`samples` per edge) and each sample draws its line with the weight of its share of the spatial area, so every column
 * of the result sums to the total area.
 */
export function continuousParallel(f: Field2, p: number, q: number, cols: number, rows: number, samples = 4, range?: [number, number]): ParallelDensity {
  const tris = mapTriangles(f, p, q)
  let lo = Infinity, hi = -Infinity
  if (range) [lo, hi] = range
  else for (const k of [p, q]) for (const v of f.attr[k]) { if (v < lo) lo = v; if (v > hi) hi = v }
  const d = new Float32Array(cols * rows)
  const row = (v: number) => Math.max(0, Math.min(rows - 1, ((v - lo) / (hi - lo || 1)) * (rows - 1)))
  const pts: [number, number, number][] = []
  for (let i = 0; i <= samples; i++) for (let j = 0; j <= samples - i; j++) pts.push([i / samples, j / samples, 1 - i / samples - j / samples])
  let mass = 0
  for (const t of tris) {
    const w = t.areaS / pts.length
    for (const [l1, l2, l3] of pts) {
      const x = l1 * t.a[0] + l2 * t.b[0] + l3 * t.c[0], y = l1 * t.a[1] + l2 * t.b[1] + l3 * t.c[1]
      const y0 = row(x), y1 = row(y)
      for (let c = 0; c < cols; c++) {
        const u = cols === 1 ? 0 : c / (cols - 1)
        const yy = y0 + (y1 - y0) * u, r = Math.floor(yy), fr = yy - r
        d[r * cols + c] += w * (1 - fr)
        d[Math.min(rows - 1, r + 1) * cols + c] += w * fr
      }
    }
    mass += t.areaS
  }
  return { cols, rows, density: d, lo, hi, mass }
}
