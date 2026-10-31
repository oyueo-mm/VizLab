/** Cartogram algorithms on planar (projected) coordinates. */

export type Pt = [number, number]
export interface Shape { id: string; /** Outer rings of the polygon parts. */ rings: Pt[][] }

export const ringArea = (ring: readonly Pt[]) => {
  let a = 0
  for (let i = 0, n = ring.length; i < n; i++) { const p = ring[i], q = ring[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1] }
  return Math.abs(a) / 2
}

export const shapeArea = (s: Shape) => s.rings.reduce((a, r) => a + ringArea(r), 0)

/** Area-weighted centroid of a shape's rings. */
export function shapeCentroid(s: Shape): Pt {
  let A = 0, cx = 0, cy = 0
  for (const ring of s.rings) {
    let a = 0, x = 0, y = 0
    for (let i = 0, n = ring.length; i < n; i++) {
      const p = ring[i], q = ring[(i + 1) % n]
      const c = p[0] * q[1] - q[0] * p[1]
      a += c; x += (p[0] + q[0]) * c; y += (p[1] + q[1]) * c
    }
    if (Math.abs(a) < 1e-12) continue
    A += Math.abs(a) / 2
    cx += (x / (3 * a)) * (Math.abs(a) / 2)
    cy += (y / (3 * a)) * (Math.abs(a) / 2)
  }
  return A > 0 ? [cx / A, cy / A] : s.rings[0]?.[0] ?? [0, 0]
}

const transform = (s: Shape, f: (p: Pt) => Pt): Shape => ({ id: s.id, rings: s.rings.map((r) => r.map(f)) })

/**
 * Non-contiguous (Olson) cartogram: every region keeps its shape and is scaled about its own centroid so that its area is proportional to
 * its value. `reference` chooses which region stays at its true size: the one with the largest value-to-area ratio (nothing grows beyond
 * its true size) or the median ratio.
 */
export function nonContiguousCartogram(shapes: readonly Shape[], values: readonly (number | null)[], reference: 'max' | 'median' = 'max'): { shapes: Shape[]; scales: number[] } {
  const areas = shapes.map(shapeArea)
  const ratios = shapes.map((_, i) => (values[i] != null && values[i]! > 0 && areas[i] > 0 ? values[i]! / areas[i] : NaN))
  const finite = ratios.filter(Number.isFinite).sort((a, b) => a - b)
  const ref = !finite.length ? 1 : reference === 'max' ? finite[finite.length - 1] : finite[Math.floor(finite.length / 2)]
  const scales = ratios.map((r) => (Number.isFinite(r) ? Math.sqrt(r / ref) : 0))
  return {
    scales,
    shapes: shapes.map((s, i) => {
      const c = shapeCentroid(s)
      return transform(s, (p) => [c[0] + (p[0] - c[0]) * scales[i], c[1] + (p[1] - c[1]) * scales[i]])
    }),
  }
}

export interface ContiguousResult { shapes: Shape[]; /** Mean |area / target − 1| after each iteration. */ errors: number[]; iterations: number }

/**
 * Contiguous (rubber-sheet) cartogram by Dougenik, Chrisman & Niemeyer (1985). Each pass treats every region as a circle with the region's
 * current area and pushes every vertex of the map away from (or towards) every centroid with a force that depends on how much that
 * region has to grow or shrink. A vertex's displacement depends only on its own position, so shared borders move together and the regions stay
 * adjacent. Targets keep the total map area fixed.
 */
export function contiguousCartogram(shapes: readonly Shape[], values: readonly (number | null)[], maxIterations = 60, tolerance = 0.01): ContiguousResult {
  const vals = values.map((v) => (v != null && v > 0 ? v : 0))
  const positive = vals.filter((v) => v > 0)
  const floor = positive.length ? 0.02 * (positive.reduce((a, b) => a + b, 0) / positive.length) : 1
  const eff = vals.map((v) => Math.max(v, floor))
  const sumV = eff.reduce((a, b) => a + b, 0)
  let cur = shapes.map((s) => ({ id: s.id, rings: s.rings.map((r) => r.map((p) => [p[0], p[1]] as Pt)) }))
  const total = cur.reduce((a, s) => a + shapeArea(s), 0)
  const target = eff.map((v) => (v / sumV) * total)
  const errors: number[] = []
  let it = 0
  for (; it < maxIterations; it++) {
    const areas = cur.map(shapeArea)
    const err = areas.reduce((s, a, i) => s + Math.abs(a / target[i] - 1), 0) / areas.length
    errors.push(err)
    if (err < tolerance) break
    const cents = cur.map(shapeCentroid)
    const radius = areas.map((a) => Math.sqrt(a / Math.PI))
    const mass = areas.map((a, i) => Math.sqrt(target[i] / Math.PI) - Math.sqrt(a / Math.PI))
    const sizeError = areas.reduce((s, a, i) => s + Math.max(a, target[i]) / Math.max(1e-12, Math.min(a, target[i])), 0) / areas.length
    const reduction = 1 / (sizeError + 1)
    cur = cur.map((s) => transform(s, (p) => {
      let dx = 0, dy = 0
      for (let j = 0; j < cents.length; j++) {
        const vx = p[0] - cents[j][0], vy = p[1] - cents[j][1]
        const d = Math.hypot(vx, vy)
        if (d < 1e-12) continue
        const f = d > radius[j] ? (mass[j] * radius[j]) / d : mass[j] * (d / radius[j]) ** 2 * (4 - (3 * d) / radius[j])
        const k = (f * reduction) / d
        dx += vx * k; dy += vy * k
      }
      return [p[0] + dx, p[1] + dy]
    }))
  }
  return { shapes: cur, errors, iterations: it }
}

export interface Square { id: string; x: number; y: number; side: number; /** Original (centroid) position. */ x0: number; y0: number }

/**
 * Demers cartogram: each region becomes a square of area proportional to its value, centred on the region's centroid; overlapping squares are
 * pushed apart along the axis of least overlap (the smaller square moves more) while a spring pulls each back towards its home position.
 */
export function demersCartogram(sites: readonly { id: string; x: number; y: number; value: number }[], maxSide: number, pull = 0.04, iterations = 400): Square[] {
  const vmax = Math.max(...sites.map((s) => s.value), 1e-12)
  const sq: Square[] = sites.map((s) => ({ id: s.id, x: s.x, y: s.y, x0: s.x, y0: s.y, side: s.value > 0 ? maxSide * Math.sqrt(s.value / vmax) : 0 }))
  for (let it = 0; it < iterations; it++) {
    let moved = 0
    for (let i = 0; i < sq.length; i++) for (let j = i + 1; j < sq.length; j++) {
      const a = sq[i], b = sq[j]
      const need = (a.side + b.side) / 2 + 0.5
      const dx = b.x - a.x, dy = b.y - a.y
      const ox = need - Math.abs(dx), oy = need - Math.abs(dy)
      if (ox <= 0 || oy <= 0) continue
      const wa = b.side / (a.side + b.side || 1), wb = 1 - wa
      if (ox < oy) { const s = dx >= 0 ? 1 : -1; a.x -= s * ox * wa; b.x += s * ox * wb; moved += ox } else { const s = dy >= 0 ? 1 : -1; a.y -= s * oy * wa; b.y += s * oy * wb; moved += oy }
    }
    for (const s of sq) { s.x += (s.x0 - s.x) * pull; s.y += (s.y0 - s.y) * pull }
    if (moved < 1e-3) break
  }
  // the spring and the push balance with a little overlap left; finish with pure separation
  for (let it = 0; it < 300; it++) {
    let moved = 0
    for (let i = 0; i < sq.length; i++) for (let j = i + 1; j < sq.length; j++) {
      const a = sq[i], b = sq[j]
      const need = (a.side + b.side) / 2 + 0.5
      const dx = b.x - a.x, dy = b.y - a.y
      const ox = need - Math.abs(dx), oy = need - Math.abs(dy)
      if (ox <= 0 || oy <= 0) continue
      const wa = b.side / (a.side + b.side || 1), wb = 1 - wa
      if (ox < oy) { const s = dx >= 0 ? 1 : -1; a.x -= s * ox * wa; b.x += s * ox * wb; moved += ox } else { const s = dy >= 0 ? 1 : -1; a.y -= s * oy * wa; b.y += s * oy * wb; moved += oy }
    }
    if (moved < 1e-6) break
  }
  return sq
}

/** Largest overlap between any two squares (0 when none overlap). */
export function maxSquareOverlap(sq: readonly Square[]): number {
  let m = 0
  for (let i = 0; i < sq.length; i++) for (let j = i + 1; j < sq.length; j++) {
    const need = (sq[i].side + sq[j].side) / 2
    m = Math.max(m, Math.min(need - Math.abs(sq[i].x - sq[j].x), need - Math.abs(sq[i].y - sq[j].y)))
  }
  return Math.max(0, m)
}

/** Largest-remainder rounding of `total` into integers proportional to `weights`. */
export function apportion(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0)
  if (!(sum > 0) || total <= 0) return weights.map(() => 0)
  const raw = weights.map((w) => (Math.max(0, w) / sum) * total)
  const out = raw.map(Math.floor)
  let left = total - out.reduce((a, b) => a + b, 0)
  raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i).forEach(({ i }) => { if (left > 0) { out[i]++; left-- } })
  return out
}

/**
 * Gridded cartogram: the map's land cells are redistributed so every region owns a number of cells proportional to its value. Cells are
 * handed out nearest-first (all cell–region distances sorted, a cell goes to the closest region that still has capacity), which keeps each
 * region close to where it really is. Returns the owner index of every cell (−1 for none).
 */
export function griddedCartogram(cells: readonly Pt[], homes: readonly Pt[], values: readonly number[]): number[] {
  const quota = apportion(cells.length, values)
  const pairs: { c: number; r: number; d: number }[] = []
  cells.forEach((p, c) => homes.forEach((h, r) => { if (quota[r] > 0) pairs.push({ c, r, d: Math.hypot(p[0] - h[0], p[1] - h[1]) }) }))
  pairs.sort((a, b) => a.d - b.d || a.c - b.c || a.r - b.r)
  const owner = cells.map(() => -1)
  const left = quota.slice()
  for (const { c, r } of pairs) if (owner[c] < 0 && left[r] > 0) { owner[c] = r; left[r]-- }
  return owner
}
