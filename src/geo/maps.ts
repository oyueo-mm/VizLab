import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import koreaTopo from './data/korea.topo.json'
import worldTopo from './data/world.topo.json'

export type MapId = 'world' | 'korea' | 'custom'

/** One region of a map: a country or a province, with the attributes shipped in the data. */
export interface Region {
  /** Stable id: ISO 3166-1 alpha-3 for countries (USA), ISO 3166-2 for Korean provinces (KR-11). Never the display name. */
  id: string
  en: string
  ko: string
  /** Display name in Korean (falls back to the English name for imported maps). */
  name: string
  feature: Feature<Polygon | MultiPolygon>
  /** [longitude, latitude] of the geographic centroid. */
  centroid: [number, number]
  /** Land area in km², measured on the original geometry. */
  area: number
  continent?: string
  /** Natural Earth population estimate (persons) and GDP (millions of US dollars) for the world map. */
  pop?: number
  gdp?: number
}

export interface GeoMap {
  id: MapId
  title: string
  regions: Region[]
  byId: Map<string, Region>
  collection: FeatureCollection<Polygon | MultiPolygon>
  /** Where the data comes from. */
  source: string
}

type Props = { id: string; en: string; ko?: string; full?: string; continent?: string; pop?: number; gdp?: number; area: number; c: [number, number] }

function build(id: MapId, title: string, topo: unknown, object: string, source: string): GeoMap {
  const t = topo as Topology
  const fc = feature(t, t.objects[object] as GeometryCollection) as unknown as FeatureCollection<Polygon | MultiPolygon, Props>
  const regions: Region[] = fc.features.map((f) => {
    const p = f.properties
    return { id: p.id, en: p.en, ko: p.ko ?? p.en, name: p.ko ?? p.en, feature: f as Feature<Polygon | MultiPolygon>, centroid: p.c, area: p.area, continent: p.continent, pop: p.pop, gdp: p.gdp }
  })
  return { id, title, regions, byId: new Map(regions.map((r) => [r.id, r])), collection: { type: 'FeatureCollection', features: regions.map((r) => r.feature) }, source }
}

let world: GeoMap | undefined
let korea: GeoMap | undefined

/** The two maps that ship with VizLab (Natural Earth, public domain). */
export function getMap(id: 'world' | 'korea'): GeoMap {
  if (id === 'world') return (world ??= build('world', '세계 국가', worldTopo, 'countries', 'Natural Earth 1:110m 국가 경계 (퍼블릭 도메인)'))
  return (korea ??= build('korea', '대한민국 시도', koreaTopo, 'provinces', 'Natural Earth 1:10m 행정구역(admin-1), 단순화 (퍼블릭 도메인)'))
}

export const mapOptions: { value: 'world' | 'korea'; label: string }[] = [
  { value: 'world', label: '세계 국가' },
  { value: 'korea', label: '대한민국 시도' },
]

/** The shipped map whose region ids cover most of the given ids (null if none matches at all). */
export function detectMap(ids: readonly string[]): 'world' | 'korea' | null {
  const clean = ids.map((s) => s.trim()).filter(Boolean)
  if (!clean.length) return null
  const score = (m: GeoMap) => clean.filter((i) => m.byId.has(i)).length
  const w = score(getMap('world'))
  const k = score(getMap('korea'))
  if (!w && !k) return null
  return k > w ? 'korea' : 'world'
}
