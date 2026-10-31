import * as d3 from 'd3'
import { Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Hint, Select } from '../../components/controls'
import { columnIndex, toLabel, toNumber, type DataTable } from '../../data/table'
import { parseGeoJSON } from '../../geo/geojson'
import { detectMap, getMap, mapOptions, type GeoMap, type MapId } from '../../geo/maps'
import { fitProjection, projectionById, projections, type ProjectionId } from '../../geo/projections'
import { roleColumn } from '../mapping'
import type { Mapping, RoleSpec } from '../types'

export interface GeoParams {
  /** 'auto' picks the shipped map whose region ids match the data. */
  map: 'auto' | 'world' | 'korea' | 'custom'
  projection: 'auto' | ProjectionId
  /** Text of an imported GeoJSON/TopoJSON (kept so the map survives a reload). */
  customGeo: string
}

export const geoDefaults: GeoParams = { map: 'auto', projection: 'auto', customGeo: '' }

export const regionRoles: RoleSpec[] = [
  { key: 'region', label: '지역 ID (예: KOR, KR-11)', type: 'category', required: true, prefer: 'ID|코드|code' },
  { key: 'value', label: '값', type: 'number', required: true },
]

/** The parsed custom map for an imported text; parsed once per distinct text. */
const customCache = new Map<string, ReturnType<typeof parseGeoJSON>>()
export function customMap(text: string) {
  let r = customCache.get(text)
  if (!r) { r = parseGeoJSON(text); customCache.set(text, r); if (customCache.size > 4) customCache.delete(customCache.keys().next().value!) }
  return r
}

export interface Resolved { map: GeoMap; id: MapId; note: string | null }

/** The map to draw: the one chosen, or (auto) the one whose ids cover the data, falling back to the world map with a note. */
export function resolveMap(params: GeoParams, ids: readonly string[]): Resolved {
  if (params.map === 'custom' && params.customGeo) {
    const r = customMap(params.customGeo)
    if (r.map) return { map: r.map, id: 'custom', note: null }
  }
  if (params.map === 'world' || params.map === 'korea') return { map: getMap(params.map), id: params.map, note: null }
  const found = detectMap(ids)
  if (found) return { map: getMap(found), id: found, note: null }
  return { map: getMap('world'), id: 'world', note: ids.length ? '지역 ID가 어느 지도와도 맞지 않습니다. ID 열(예: KOR, KR-11)을 확인하세요.' : null }
}

export const defaultProjection = (id: MapId): ProjectionId => (id === 'world' ? 'equal-earth' : 'mercator')

/** Projection fitted to the map (or to a given target) inside the box. */
export function useProjection(map: GeoMap, params: GeoParams, width: number, height: number, mapId: MapId, target?: d3.GeoPermissibleObjects, pad = 8) {
  const pid = params.projection === 'auto' ? defaultProjection(mapId) : params.projection
  return useMemo(() => fitProjection(pid, (target ?? map.collection) as never, width, height, pad), [pid, map, target, width, height, pad])
}

export interface RegionDatum { id: string; value: number | null; base: number | null; rows: number[]; label: string }

/** Table rows keyed by region id (never by name). Later rows for the same id are summed; unreadable values stay null. */
export function regionData(table: DataTable, mapping: Mapping, baseRole = 'base') {
  const ri = columnIndex(table, roleColumn(mapping, 'region'))
  const vi = columnIndex(table, roleColumn(mapping, 'value'))
  const bi = columnIndex(table, roleColumn(mapping, baseRole))
  const li = columnIndex(table, roleColumn(mapping, 'label'))
  const byId = new Map<string, RegionDatum>()
  table.rows.forEach((r, row) => {
    const id = ri >= 0 ? toLabel(r[ri]).trim() : ''
    if (!id) return
    const v = vi >= 0 ? toNumber(r[vi]) : null
    const b = bi >= 0 ? toNumber(r[bi]) : null
    const cur = byId.get(id)
    if (cur) { cur.rows.push(row); if (v != null) cur.value = (cur.value ?? 0) + v; if (b != null) cur.base = (cur.base ?? 0) + b }
    else byId.set(id, { id, value: v, base: b, rows: [row], label: li >= 0 ? toLabel(r[li]) : '' })
  })
  return byId
}

/** Shared selects for the map, its projection and importing a GeoJSON file. */
export function GeoControls({ params, setParams, resolved, unmatched }: { params: GeoParams; setParams: (p: Partial<GeoParams>) => void; resolved: Resolved; unmatched?: number }) {
  const file = useRef<HTMLInputElement>(null)
  const [issue, setIssue] = useState<string | null>(null)
  const proj = projectionById.get(params.projection === 'auto' ? defaultProjection(resolved.id) : params.projection)
  const onFile = async (f: File) => {
    const text = await f.text()
    const r = customMap(text)
    if (!r.map) { setIssue(r.issues.errors[0] ?? '지도를 읽지 못했습니다.'); return }
    setIssue(r.issues.warnings.join(' ') || `${r.map.regions.length}개 지역을 불러왔습니다.`)
    setParams({ map: 'custom', customGeo: text })
  }
  return (
    <>
      <Select label="지도" value={params.map} onChange={(map) => setParams({ map })} testId="ctl-map"
        options={[{ value: 'auto', label: `자동 (${resolved.map.title})` }, ...mapOptions, ...(params.customGeo ? [{ value: 'custom' as const, label: '가져온 지도' }] : [])]} />
      <Select label="투영법" value={params.projection} onChange={(projection) => setParams({ projection })} testId="ctl-projection"
        options={[{ value: 'auto', label: `자동 (${proj?.name ?? ''})` }, ...projections.map((p) => ({ value: p.id as ProjectionId, label: p.name }))]} />
      {proj && <Hint>{proj.note}</Hint>}
      <div className="data-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => file.current?.click()} data-testid="geojson-import"><Upload size={14} aria-hidden="true" />GeoJSON 가져오기</button>
        <input ref={file} type="file" accept=".json,.geojson,.topojson,application/json,application/geo+json" hidden data-testid="geojson-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = '' }} />
      </div>
      {issue && <Hint>{issue}</Hint>}
      {resolved.note && <Hint>{resolved.note}</Hint>}
      {!!unmatched && <Hint>지도에 없는 지역 ID가 {unmatched}개 있어 그리지 않았습니다.</Hint>}
      <Hint>출처: {resolved.map.source}. 경계는 학습용으로 단순화한 것이며 공식 경계와 다를 수 있습니다.</Hint>
    </>
  )
}

/** Hatch pattern for regions without data; add inside <defs>. */
export function HatchDefs({ id }: { id: string }) {
  return <pattern id={id} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#f3f5f4" /><line x1="0" y1="0" x2="0" y2="5" stroke="#cdd4d1" strokeWidth="1.4" /></pattern>
}

const KOREA_BOX = { w: 124, e: 132, s: 32.5, n: 39 }

/** For point data: the Korea map when every point lies on or near the peninsula, otherwise the world map (unless the user chose). */
export function resolvePointMap(params: GeoParams, pts: readonly { lon: number; lat: number }[]): Resolved {
  if (params.map === 'world' || params.map === 'korea' || (params.map === 'custom' && params.customGeo)) return resolveMap(params, [])
  const inKorea = pts.length > 0 && pts.every((p) => p.lon >= KOREA_BOX.w && p.lon <= KOREA_BOX.e && p.lat >= KOREA_BOX.s && p.lat <= KOREA_BOX.n)
  return { map: getMap(inKorea ? 'korea' : 'world'), id: inKorea ? 'korea' : 'world', note: null }
}

/** Reads latitude/longitude (and optional value / label) columns into points; rows with a missing or impossible coordinate are skipped and counted. */
export function readPoints(table: DataTable, mapping: Mapping, keys: { lat: string; lon: string; value?: string; label?: string; group?: string }) {
  const li = columnIndex(table, roleColumn(mapping, keys.lat))
  const oi = columnIndex(table, roleColumn(mapping, keys.lon))
  const vi = keys.value ? columnIndex(table, roleColumn(mapping, keys.value)) : -1
  const ni = keys.label ? columnIndex(table, roleColumn(mapping, keys.label)) : -1
  const gi = keys.group ? columnIndex(table, roleColumn(mapping, keys.group)) : -1
  const pts: { row: number; lat: number; lon: number; value: number | null; label: string; group: string }[] = []
  let skipped = 0
  if (li >= 0 && oi >= 0) table.rows.forEach((r, row) => {
    const lat = toNumber(r[li])
    const lon = toNumber(r[oi])
    if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) { skipped++; return }
    pts.push({ row, lat, lon, value: vi >= 0 ? toNumber(r[vi]) : null, label: ni >= 0 ? toLabel(r[ni]) : '', group: gi >= 0 ? toLabel(r[gi]) : '' })
  })
  return { pts, skipped }
}

export const latRole = (extra: Partial<RoleSpec> = {}): RoleSpec => ({ key: 'lat', label: '위도', type: 'number', required: true, prefer: '위도|lat', ...extra })
export const lonRole = (extra: Partial<RoleSpec> = {}): RoleSpec => ({ key: 'lon', label: '경도', type: 'number', required: true, prefer: '경도|lon|lng', ...extra })

/** The shared base map: every region as a light polygon (for charts whose data are points or lines). */
export function BaseMap({ map, projection, fill = '#f1f4f3', stroke = '#d5dbd9' }: { map: GeoMap; projection: d3.GeoProjection; fill?: string; stroke?: string }) {
  const d = useMemo(() => d3.geoPath(projection)(map.collection) ?? '', [map, projection])
  return <path className="map-base" d={d} fill={fill} stroke={stroke} strokeWidth={0.6} vectorEffect="non-scaling-stroke" pointerEvents="none" />
}
