import * as d3 from 'd3'
import type { FeatureCollection, Geometry } from 'geojson'

export type ProjectionId = 'mercator' | 'equal-earth' | 'natural-earth' | 'orthographic'

export interface ProjectionDef {
  id: ProjectionId
  name: string
  /** What the projection preserves and what it distorts. */
  note: string
  make: () => d3.GeoProjection
}

export const projections: ProjectionDef[] = [
  { id: 'mercator', name: '메르카토르', note: '각도(모양)를 보존하는 정각 투영입니다. 고위도로 갈수록 면적이 크게 부풀려져 그린란드가 아프리카만큼 커 보입니다.', make: () => d3.geoMercator() },
  { id: 'equal-earth', name: '이퀄 어스', note: '면적을 보존하는 정적 투영입니다. 면적 비교에 알맞지만 모양은 가장자리에서 일그러집니다.', make: () => d3.geoEqualEarth() },
  { id: 'natural-earth', name: '내추럴 어스', note: '면적과 모양의 왜곡을 모두 적당히 나눈 절충 투영입니다. 어느 쪽도 정확히 보존하지는 않습니다.', make: () => d3.geoNaturalEarth1() },
  { id: 'orthographic', name: '정사영 (지구본)', note: '지구본을 한쪽에서 본 모습입니다. 반구만 보이고 가장자리는 심하게 압축됩니다.', make: () => d3.geoOrthographic().clipAngle(90) },
]

export const projectionById = new Map(projections.map((p) => [p.id, p]))

/** Latitudes beyond this are clipped for Mercator, whose y coordinate grows without bound toward the poles. */
export const MERCATOR_LIMIT = 84

/** A projection of the chosen kind fitted to the given geometry inside a width × height box (with padding). */
export function fitProjection(id: ProjectionId, target: FeatureCollection | Geometry | d3.ExtendedFeature, width: number, height: number, padding = 8): d3.GeoProjection {
  const def = projectionById.get(id) ?? projections[0]
  const projection = def.make()
  if (id === 'mercator') projection.clipExtent(null)
  const w = Math.max(10, width)
  const h = Math.max(10, height)
  if (id === 'orthographic') {
    const c = d3.geoCentroid(target as d3.GeoPermissibleObjects)
    projection.rotate([-c[0], -c[1]])
  }
  projection.fitExtent([[padding, padding], [w - padding, h - padding]], target as d3.GeoPermissibleObjects)
  return projection
}

/**
 * Longitude/latitude → screen coordinates, or null when the point cannot be shown: not finite, outside the valid ranges, or on the far
 * side of a globe projection (d3 returns coordinates for those without clipping, so the visibility test is done here).
 */
export function project(projection: d3.GeoProjection, lon: number, lat: number): [number, number] | null {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 360) return null
  const clip = projection.clipAngle()
  if (clip) {
    const [rx, ry] = projection.rotate()
    if (d3.geoDistance([lon, lat], [-rx, -ry]) > (clip * Math.PI) / 180) return null
  }
  const p = projection([lon, lat])
  return p && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? p : null
}

/**
 * How much a projection exaggerates the area of a small patch at `lat`, relative to a patch of the same real size on the equator:
 * (projected area / projected equator area) ÷ (true area / true equator area). 1 = area preserved; Mercator gives 1/cos²(lat).
 */
export function areaInflation(projection: d3.GeoProjection, lat: number, lon = 0): number {
  const d = 0.25
  const patch = (la: number): [number, number][] | null => {
    const q = [[lon - d, la - d], [lon + d, la - d], [lon + d, la + d], [lon - d, la + d]].map((c) => projection(c as [number, number]))
    return q.every(Boolean) ? (q as [number, number][]) : null
  }
  const a = patch(lat)
  const e = patch(0)
  if (!a || !e) return NaN
  const rad = Math.PI / 180
  const trueRatio = (Math.sin((lat + d) * rad) - Math.sin((lat - d) * rad)) / (Math.sin(d * rad) * 2)
  return Math.abs(d3.polygonArea(a) / d3.polygonArea(e)) / trueRatio
}
