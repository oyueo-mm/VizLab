import * as d3 from 'd3'
import { createRng } from '../lib/random'
import { KM_PER_DEG, planarKm, type BBox, type LonLat, type RoadEdge } from './spatial'

/** Computational geometry used by the Voronoi map, the Delaunay chart and the synthetic road network. */

export type P2 = [number, number]

/** Voronoi cell polygons of the sites inside `bounds` = [x0, y0, x1, y1] (one polygon per site, possibly empty for coincident sites). */
export function voronoiCells(sites: readonly P2[], bounds: [number, number, number, number]): (P2[] | null)[] {
  if (!sites.length) return []
  const v = d3.Delaunay.from(sites as P2[]).voronoi(bounds)
  return sites.map((_, i) => {
    const c = v.cellPolygon(i) as P2[] | null
    return c ? c.slice(0, -1) : null
  })
}

/** Delaunay triangles as index triples into `points`. */
export function delaunayTriangles(points: readonly P2[]): [number, number, number][] {
  if (points.length < 3) return []
  const t = d3.Delaunay.from(points as P2[]).triangles
  const out: [number, number, number][] = []
  for (let i = 0; i < t.length; i += 3) out.push([t[i], t[i + 1], t[i + 2]])
  return out
}

/** Circumcircle of a triangle (centre and radius); null for a degenerate (collinear) triple. */
export function circumcircle(a: P2, b: P2, c: P2): { x: number; y: number; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
  if (Math.abs(d) < 1e-12) return null
  const a2 = a[0] ** 2 + a[1] ** 2, b2 = b[0] ** 2 + b[1] ** 2, c2 = c[0] ** 2 + c[1] ** 2
  const x = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d
  const y = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d
  return { x, y, r: Math.hypot(a[0] - x, a[1] - y) }
}

/** Interior angles (degrees) of a triangle. */
export function triangleAngles(a: P2, b: P2, c: P2): [number, number, number] {
  const ang = (p: P2, q: P2, r: P2) => {
    const u = [q[0] - p[0], q[1] - p[1]], w = [r[0] - p[0], r[1] - p[1]]
    return (Math.acos(Math.max(-1, Math.min(1, (u[0] * w[0] + u[1] * w[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(w[0], w[1]))))) * 180) / Math.PI
  }
  return [ang(a, b, c), ang(b, c, a), ang(c, a, b)]
}

export const polygonAreaAbs = (poly: readonly P2[]) => Math.abs(d3.polygonArea(poly as P2[]))

// ─── local ground plane ─────────────────────────────────────────────────────────────

/** An equal-distance local plane (km east / north of an origin): used so geometry is computed in ground distance rather than on the screen. */
export function groundPlane(origin: LonLat) {
  const c = Math.cos((origin[1] * Math.PI) / 180)
  return {
    toKm: (p: LonLat): P2 => [(p[0] - origin[0]) * c * KM_PER_DEG, (p[1] - origin[1]) * KM_PER_DEG],
    toLonLat: (q: P2): LonLat => [origin[0] + q[0] / (c * KM_PER_DEG), origin[1] + q[1] / KM_PER_DEG],
  }
}

// ─── synthetic road network ─────────────────────────────────────────────────────────

export interface RoadNetwork { nodes: LonLat[]; edges: RoadEdge[]; /** Road class per edge: 0 highway, 1 main road, 2 local road. */ cls: number[] }

export const ROAD_SPEEDS = [100, 70, 40] as const

/**
 * A synthetic road network over a box: jittered lattice nodes that pass `onLand`, 8-neighbour links, every 4th lattice line promoted to a main
 * road and fastest-by-distance corridors between the `hubs` promoted to highways. It is invented geometry, not a map of real roads.
 */
export function syntheticRoadNetwork(box: BBox, onLand: (lon: number, lat: number) => boolean, spacingKm: number, hubs: readonly LonLat[], seed = 1): RoadNetwork {
  const rng = createRng(seed)
  const midLat = (box.north + box.south) / 2
  const dLat = spacingKm / KM_PER_DEG, dLon = spacingKm / (KM_PER_DEG * Math.cos((midLat * Math.PI) / 180))
  const nx = Math.floor((box.east - box.west) / dLon) + 1, ny = Math.floor((box.north - box.south) / dLat) + 1
  const index = new Map<string, number>()
  const nodes: LonLat[] = []
  const lattice: [number, number][] = []
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const lon = box.west + (i + (rng() - 0.5) * 0.5) * dLon, lat = box.south + (j + (rng() - 0.5) * 0.5) * dLat
    if (!onLand(lon, lat)) continue
    index.set(`${i},${j}`, nodes.length)
    nodes.push([lon, lat])
    lattice.push([i, j])
  }
  const edges: RoadEdge[] = []
  const cls: number[] = []
  const seen = new Set<string>()
  const add = (a: number, b: number, klass: number) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`
    if (seen.has(key)) return
    seen.add(key)
    const km = planarKm(nodes[a], nodes[b])
    edges.push({ a, b, km, speed: ROAD_SPEEDS[klass] })
    cls.push(klass)
  }
  lattice.forEach(([i, j], a) => {
    for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const b = index.get(`${i + di},${j + dj}`)
      if (b == null) continue
      // a link that would cross open sea (midpoint off land) is not built
      const mid: LonLat = [(nodes[a][0] + nodes[b][0]) / 2, (nodes[a][1] + nodes[b][1]) / 2]
      if (!onLand(mid[0], mid[1])) continue
      const straight = di === 0 || dj === 0
      add(a, b, straight && (i % 4 === 0 || j % 4 === 0) ? 1 : 2)
    }
  })
  // highways: shortest paths (by length) between consecutive hubs, upgraded to the highway class
  const nearest = (p: LonLat) => { let best = 0, bd = Infinity; nodes.forEach((n, k) => { const d = planarKm(n, p); if (d < bd) { bd = d; best = k } }); return best }
  const hubNodes = hubs.map(nearest)
  const adj: { to: number; e: number }[][] = nodes.map(() => [])
  edges.forEach((e, k) => { adj[e.a].push({ to: e.b, e: k }); adj[e.b].push({ to: e.a, e: k }) })
  const pathBetween = (s: number, t: number): number[] => {
    const dist = new Float64Array(nodes.length).fill(Infinity)
    const via = new Int32Array(nodes.length).fill(-1)
    dist[s] = 0
    const todo = new Set<number>([s])
    while (todo.size) {
      let u = -1
      for (const k of todo) if (u < 0 || dist[k] < dist[u]) u = k
      todo.delete(u)
      if (u === t) break
      for (const { to, e } of adj[u]) if (dist[u] + edges[e].km < dist[to]) { dist[to] = dist[u] + edges[e].km; via[to] = e; todo.add(to) }
    }
    const out: number[] = []
    let cur = t
    while (cur !== s && via[cur] >= 0) { out.push(via[cur]); const e = edges[via[cur]]; cur = e.a === cur ? e.b : e.a }
    return out
  }
  const order = hubNodes.slice().sort((a, b) => nodes[a][1] - nodes[b][1])
  for (let k = 0; k + 1 < order.length; k++) for (const e of pathBetween(order[k], order[k + 1])) { cls[e] = 0; edges[e].speed = ROAD_SPEEDS[0] }
  return { nodes, edges, cls }
}

/** Index of the node nearest to a point (ground distance). */
export function nearestNode(nodes: readonly LonLat[], p: LonLat): number {
  let best = 0, bd = Infinity
  nodes.forEach((n, k) => { const d = planarKm(n, p); if (d < bd) { bd = d; best = k } })
  return best
}
