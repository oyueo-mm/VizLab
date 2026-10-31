import * as d3 from 'd3'
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import type { GeoMap, Region } from './maps'

export interface GeoIssues { errors: string[]; warnings: string[] }

const R = 6371.0088

/** True for a finite [lon, lat] inside the valid ranges. */
export const validPosition = (p: unknown): p is Position => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90

function checkRing(ring: unknown, where: string, issues: GeoIssues): boolean {
  if (!Array.isArray(ring) || ring.length < 4) { issues.errors.push(`${where}: 링의 꼭짓점이 4개 미만입니다.`); return false }
  if (!ring.every(validPosition)) { issues.errors.push(`${where}: 경도(−180~180)·위도(−90~90) 범위를 벗어나거나 숫자가 아닌 좌표가 있습니다.`); return false }
  const a = ring[0] as Position
  const b = ring[ring.length - 1] as Position
  if (a[0] !== b[0] || a[1] !== b[1]) { issues.errors.push(`${where}: 링이 닫혀 있지 않습니다(첫 점과 마지막 점이 달라야 하지 않음).`); return false }
  return true
}

/** Structural check of a polygonal geometry; every problem is reported, nothing throws. */
export function validateGeometry(g: unknown, where = '도형'): GeoIssues {
  const issues: GeoIssues = { errors: [], warnings: [] }
  if (!g || typeof g !== 'object') { issues.errors.push(`${where}: 도형이 없습니다.`); return issues }
  const geom = g as { type?: string; coordinates?: unknown }
  if (geom.type === 'Polygon') {
    if (!Array.isArray(geom.coordinates) || !geom.coordinates.length) issues.errors.push(`${where}: Polygon에 좌표가 없습니다.`)
    else geom.coordinates.forEach((r, i) => checkRing(r, `${where} 링 ${i + 1}`, issues))
  } else if (geom.type === 'MultiPolygon') {
    if (!Array.isArray(geom.coordinates) || !geom.coordinates.length) issues.errors.push(`${where}: MultiPolygon에 좌표가 없습니다.`)
    else geom.coordinates.forEach((poly, pi) => { if (!Array.isArray(poly) || !poly.length) issues.errors.push(`${where} 다각형 ${pi + 1}: 좌표가 없습니다.`); else poly.forEach((r, i) => checkRing(r, `${where} 다각형 ${pi + 1} 링 ${i + 1}`, issues)) })
  } else issues.errors.push(`${where}: 지역 지도에는 Polygon 또는 MultiPolygon이 필요합니다(받은 형식: ${String(geom.type)}).`)
  return issues
}

const ID_KEYS = ['id', 'ID', 'iso_a3', 'ISO_A3', 'adm0_a3', 'ADM0_A3', 'iso_3166_2', 'code', 'CODE', 'cd', 'adm_cd']
const NAME_KEYS = ['ko', 'name_ko', 'NAME_KO', 'name', 'NAME', 'en', 'name_en', 'NAME_EN', 'adm_nm', 'nm']

const pick = (props: Record<string, unknown> | null | undefined, keys: string[]) => {
  for (const k of keys) { const v = props?.[k]; if (v != null && String(v).trim() !== '') return String(v).trim() }
  return ''
}

/**
 * Reads a GeoJSON (Feature, FeatureCollection) or TopoJSON file into a map of polygonal regions. Features that are not polygons or are
 * malformed are skipped and counted; the result is null (with the reasons) only when nothing usable remains. Ids come from a property
 * such as `id`, `iso_a3` or `code`; when missing, a stable `R1`, `R2`… is assigned and reported — names are never used to match data.
 */
export function parseGeoJSON(text: string, maxBytes = 1_500_000): { map: GeoMap | null; issues: GeoIssues } {
  const issues: GeoIssues = { errors: [], warnings: [] }
  if (text.length > maxBytes) { issues.errors.push(`파일이 너무 큽니다(${Math.round(maxBytes / 1000)}KB 이하만 불러옵니다).`); return { map: null, issues } }
  let data: any
  try { data = JSON.parse(text) } catch { issues.errors.push('JSON 형식이 올바르지 않습니다.'); return { map: null, issues } }
  let features: Feature[] = []
  try {
    if (data?.type === 'Topology') {
      const t = data as Topology
      const name = Object.keys(t.objects ?? {})[0]
      if (!name) throw new Error('empty')
      const f = feature(t, t.objects[name] as GeometryCollection) as unknown as FeatureCollection | Feature
      features = f.type === 'FeatureCollection' ? f.features : [f]
    } else if (data?.type === 'FeatureCollection' && Array.isArray(data.features)) features = data.features
    else if (data?.type === 'Feature') features = [data]
    else if (data?.type === 'Polygon' || data?.type === 'MultiPolygon') features = [{ type: 'Feature', geometry: data, properties: {} }]
    else issues.errors.push('GeoJSON(FeatureCollection·Feature·Polygon·MultiPolygon) 또는 TopoJSON이 아닙니다.')
  } catch { issues.errors.push('TopoJSON을 읽지 못했습니다.') }
  if (issues.errors.length) return { map: null, issues }

  const regions: Region[] = []
  const seen = new Set<string>()
  let skipped = 0
  let assigned = 0
  features.forEach((f, i) => {
    const g = validateGeometry(f?.geometry, `${i + 1}번째 지역`)
    if (g.errors.length) { skipped++; if (issues.errors.length < 4) issues.errors.push(...g.errors.slice(0, 1)); return }
    let id = pick(f.properties as Record<string, unknown>, ID_KEYS)
    if (!id) { id = `R${i + 1}`; assigned++ }
    if (seen.has(id)) { skipped++; issues.warnings.push(`중복된 지역 ID ‘${id}’는 첫 번째만 사용합니다.`); return }
    seen.add(id)
    const name = pick(f.properties as Record<string, unknown>, NAME_KEYS) || id
    const ft = f as Feature<Polygon | MultiPolygon>
    regions.push({ id, en: name, ko: name, name, feature: ft, centroid: d3.geoCentroid(ft) as [number, number], area: Math.round(d3.geoArea(ft) * R * R) })
  })
  if (skipped) issues.warnings.push(`사용할 수 없는 지역 ${skipped}개를 건너뛰었습니다.`)
  if (assigned) issues.warnings.push(`ID 속성이 없는 지역 ${assigned}개에 R1, R2… 번호를 붙였습니다. 데이터의 지역 ID 열에 같은 번호를 쓰세요.`)
  if (!regions.length) { if (!issues.errors.length) issues.errors.push('쓸 수 있는 다각형 지역이 없습니다.'); return { map: null, issues } }
  return { map: { id: 'custom', title: '가져온 지도', regions, byId: new Map(regions.map((r) => [r.id, r])), collection: { type: 'FeatureCollection', features: regions.map((r) => r.feature) }, source: '사용자가 가져온 GeoJSON' }, issues }
}

// ─── geometry helpers ───────────────────────────────────────────────────────

/** Point in a single ring by the even–odd rule (planar, in lon/lat). */
export function inRing(ring: readonly Position[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function polygons(f: Feature<Polygon | MultiPolygon>): Position[][][] {
  return f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
}

/** Point in a polygon with holes: inside the outer ring and outside every hole. */
export const inPolygon = (poly: readonly Position[][], x: number, y: number) => inRing(poly[0], x, y) && !poly.slice(1).some((h) => inRing(h, x, y))

export const inRegion = (f: Feature<Polygon | MultiPolygon>, x: number, y: number) => polygons(f).some((p) => inPolygon(p, x, y))

/** Planar signed area of a lon/lat ring in square degrees (used only to weight polygons of the same region against each other). */
const ringArea = (ring: readonly Position[]) => Math.abs(d3.polygonArea(ring as [number, number][]))
export const polygonWeight = (poly: readonly Position[][]) => ringArea(poly[0]) - poly.slice(1).reduce((s, h) => s + ringArea(h), 0)

/** Longitude/latitude bounding box [[w, s], [e, n]] of a feature. */
export const bounds = (f: Feature) => d3.geoBounds(f) as [[number, number], [number, number]]

/**
 * Seeded random points inside a region. Each point picks a polygon in proportion to its area, then a uniform point in that polygon's
 * bounding box until one falls inside (rejection sampling). The points are synthetic: they say how much, not where exactly.
 */
export function randomPointsIn(f: Feature<Polygon | MultiPolygon>, count: number, rng: () => number): [number, number][] {
  const polys = polygons(f).map((p) => ({ p, w: Math.max(1e-9, polygonWeight(p)) }))
  const total = polys.reduce((s, q) => s + q.w, 0)
  const boxes = polys.map(({ p }) => {
    const xs = p[0].map((q) => q[0])
    const ys = p[0].map((q) => q[1])
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const
  })
  const out: [number, number][] = []
  for (let k = 0; k < count; k++) {
    let u = rng() * total
    let i = 0
    while (i < polys.length - 1 && u > polys[i].w) { u -= polys[i].w; i++ }
    const [x0, y0, x1, y1] = boxes[i]
    for (let tries = 0; tries < 200; tries++) {
      const x = x0 + (x1 - x0) * rng()
      const y = y0 + (y1 - y0) * rng()
      if (inPolygon(polys[i].p, x, y)) { out.push([x, y]); break }
      if (tries === 199) out.push(d3.geoCentroid(f) as [number, number])
    }
  }
  return out
}
