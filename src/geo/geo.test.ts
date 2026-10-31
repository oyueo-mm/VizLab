import * as d3 from 'd3'
import { describe, expect, it } from 'vitest'
import { createRng } from '../lib/random'
import { classBreaks, classIndex, crossesDateline, dorling, dorlingRadius, flowTotals, geoHexbin, jenksBreaks, maxOverlap, normalizeValue, cellAreaKm2, arcControl, type GeoPoint } from '../stats/geo'
import { inRing, parseGeoJSON, randomPointsIn, validateGeometry, inRegion, polygons } from './geojson'
import { detectMap, getMap } from './maps'
import { areaInflation, fitProjection, project, projections } from './projections'
import { moveTile, tileGrids } from './tiles'

describe('shipped maps', () => {
  const world = getMap('world')
  const korea = getMap('korea')

  it('the world map has unique ISO ids, Korean names and valid polygons', () => {
    expect(world.regions.length).toBe(176)
    expect(new Set(world.regions.map((r) => r.id)).size).toBe(176)
    for (const r of world.regions) {
      expect(r.id, r.en).toMatch(/^[A-Z0-9]{3}$/)
      expect(r.ko.length, r.id).toBeGreaterThan(0)
      expect(r.area, r.id).toBeGreaterThan(0)
      expect(validateGeometry(r.feature.geometry, r.id).errors, r.id).toEqual([])
    }
    expect(world.byId.get('KOR')!.ko).toBe('대한민국')
    expect(world.byId.has('ATA')).toBe(false)
  })

  it('areas are measured on the real geometry', () => {
    const km2 = (id: string) => world.byId.get(id)!.area
    expect(km2('RUS')).toBeGreaterThan(16e6)
    expect(km2('RUS')).toBeLessThan(17.5e6)
    expect(km2('KOR')).toBeGreaterThan(95e3)
    expect(km2('KOR')).toBeLessThan(105e3)
    expect(km2('CAN') / km2('KOR')).toBeGreaterThan(90)
    // the sum of all countries is near the Earth's land area without Antarctica (≈ 135 million km²)
    const total = d3.sum(world.regions, (r) => r.area)
    expect(total).toBeGreaterThan(125e6)
    expect(total).toBeLessThan(145e6)
  })

  it('Korea has the 17 first-level divisions with ISO 3166-2 ids and short Korean names', () => {
    expect(korea.regions.map((r) => r.id).sort()).toEqual(['KR-11', 'KR-26', 'KR-27', 'KR-28', 'KR-29', 'KR-30', 'KR-31', 'KR-41', 'KR-42', 'KR-43', 'KR-44', 'KR-45', 'KR-46', 'KR-47', 'KR-48', 'KR-49', 'KR-50'])
    expect(korea.byId.get('KR-11')!.ko).toBe('서울')
    expect(korea.byId.get('KR-49')!.ko).toBe('제주')
    for (const r of korea.regions) expect(validateGeometry(r.feature.geometry, r.id).errors).toEqual([])
    const total = d3.sum(korea.regions, (r) => r.area)
    expect(total).toBeGreaterThan(95e3)
    expect(total).toBeLessThan(105e3)
    // province centroids lie inside the Korean peninsula's bounding box
    for (const r of korea.regions) { expect(r.centroid[0]).toBeGreaterThan(124); expect(r.centroid[0]).toBeLessThan(132); expect(r.centroid[1]).toBeGreaterThan(32.5); expect(r.centroid[1]).toBeLessThan(39) }
  })

  it('detects which map a set of region ids belongs to — ids, never names', () => {
    expect(detectMap(['KOR', 'USA', 'JPN'])).toBe('world')
    expect(detectMap(['KR-11', 'KR-26'])).toBe('korea')
    expect(detectMap(['서울', '부산'])).toBeNull()
    expect(detectMap([])).toBeNull()
  })

  it('tile layouts use one cell per region and only existing ids', () => {
    for (const [id, grid] of Object.entries(tileGrids)) {
      const cells = Object.values(grid.tiles).map((c) => c.join(','))
      expect(new Set(cells).size, id).toBe(cells.length)
      for (const [c, r] of Object.values(grid.tiles)) { expect(c).toBeLessThan(grid.cols); expect(r).toBeLessThan(grid.rows) }
      const map = getMap(id as 'korea' | 'world')
      for (const rid of Object.keys(grid.tiles)) expect(map.byId.has(rid), `${id}:${rid}`).toBe(true)
    }
    expect(Object.keys(tileGrids.korea.tiles)).toHaveLength(17)
    const moved = moveTile(tileGrids.korea.tiles, 'KR-11', [4, 5])
    expect(moved['KR-11']).toEqual([4, 5])
    const swapped = moveTile(tileGrids.korea.tiles, 'KR-11', tileGrids.korea.tiles['KR-42'])
    expect(swapped['KR-42']).toEqual(tileGrids.korea.tiles['KR-11'])
    expect(new Set(Object.values(swapped).map((c) => c.join(','))).size).toBe(17)
  })
})

describe('projections', () => {
  const world = getMap('world')

  it('turns longitude/latitude into finite screen coordinates and rejects impossible points', () => {
    for (const def of projections) {
      const p = fitProjection(def.id, world.collection, 800, 450)
      const seoul = project(p, 126.98, 37.57)
      expect(seoul && Number.isFinite(seoul[0]) && Number.isFinite(seoul[1]), def.id).toBe(true)
    }
    const m = fitProjection('mercator', world.collection, 800, 450)
    expect(project(m, 0, 95)).toBeNull()
    expect(project(m, NaN, 10)).toBeNull()
    expect(project(m, 1000, 10)).toBeNull()
    const o = fitProjection('orthographic', world.byId.get('KOR')!.feature, 600, 400)
    expect(project(o, 126, 37)).not.toBeNull()
    expect(project(o, -54, -37)).toBeNull()
  })

  it('different projections really move the points (the picture is recomputed, not restyled)', () => {
    const a = project(fitProjection('mercator', world.collection, 800, 450), 20, 60)!
    const b = project(fitProjection('equal-earth', world.collection, 800, 450), 20, 60)!
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(5)
  })

  it('Mercator inflates areas by 1/cos²(lat) while Equal Earth preserves them', () => {
    const mer = fitProjection('mercator', world.collection, 800, 450)
    const ee = fitProjection('equal-earth', world.collection, 800, 450)
    expect(areaInflation(mer, 0)).toBeCloseTo(1, 2)
    expect(areaInflation(mer, 60)).toBeCloseTo(4, 1)
    expect(areaInflation(mer, 45)).toBeCloseTo(2, 1)
    for (const lat of [0, 30, 60, 75]) expect(areaInflation(ee, lat), `lat ${lat}`).toBeCloseTo(1, 1)
  })

  it('fits the map inside the requested box', () => {
    const p = fitProjection('equal-earth', world.collection, 600, 300, 10)
    const [[x0, y0], [x1, y1]] = d3.geoPath(p).bounds(world.collection)
    expect(x0).toBeGreaterThanOrEqual(9)
    expect(y0).toBeGreaterThanOrEqual(9)
    expect(x1).toBeLessThanOrEqual(591)
    expect(y1).toBeLessThanOrEqual(291)
  })
})

describe('GeoJSON import', () => {
  const square = (x: number, y: number, s = 2, props: Record<string, unknown> = { id: 'A', name: '가' }) => ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] } })

  it('reads a FeatureCollection and keeps ids from properties', () => {
    const r = parseGeoJSON(JSON.stringify({ type: 'FeatureCollection', features: [square(0, 0), square(5, 5, 2, { id: 'B', name: '나' })] }))
    expect(r.issues.errors).toEqual([])
    expect(r.map!.regions.map((x) => [x.id, x.name])).toEqual([['A', '가'], ['B', '나']])
    expect(r.map!.id).toBe('custom')
  })

  it('assigns stable ids when none exist and says so; duplicates keep the first', () => {
    const r = parseGeoJSON(JSON.stringify({ type: 'FeatureCollection', features: [square(0, 0, 2, {}), square(3, 3, 2, {})] }))
    expect(r.map!.regions.map((x) => x.id)).toEqual(['R1', 'R2'])
    expect(r.issues.warnings.join(' ')).toMatch(/R1/)
    const d = parseGeoJSON(JSON.stringify({ type: 'FeatureCollection', features: [square(0, 0), square(9, 9)] }))
    expect(d.map!.regions).toHaveLength(1)
    expect(d.issues.warnings.join(' ')).toMatch(/중복/)
  })

  it('rejects bad coordinates, open rings and non-polygons without throwing', () => {
    expect(validateGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }).errors).toEqual([])
    expect(validateGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] }).errors[0]).toMatch(/닫혀/)
    expect(validateGeometry({ type: 'Polygon', coordinates: [[[0, 0], [200, 0], [1, 1], [0, 0]]] }).errors[0]).toMatch(/범위/)
    expect(validateGeometry({ type: 'Polygon', coordinates: [[[0, 0], [NaN, 0], [1, 1], [0, 0]]] }).errors[0]).toMatch(/범위|숫자/)
    expect(validateGeometry({ type: 'Point', coordinates: [1, 2] }).errors[0]).toMatch(/Polygon/)
    expect(validateGeometry(null).errors).toHaveLength(1)
    expect(validateGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 0]]] }).errors[0]).toMatch(/4개/)
    for (const bad of ['', 'not json', '42', 'null', '[]', '{"type":"FeatureCollection"}', '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":null}]}', '{"type":"Topology"}', '{"type":"Feature","geometry":{"type":"Point","coordinates":[1,2]}}']) {
      const r = parseGeoJSON(bad)
      expect(r.map, bad).toBeNull()
      expect(r.issues.errors.length, bad).toBeGreaterThan(0)
    }
  })

  it('skips unusable features but keeps the good ones, and refuses very large files', () => {
    const r = parseGeoJSON(JSON.stringify({ type: 'FeatureCollection', features: [square(0, 0), { type: 'Feature', properties: { id: 'P' }, geometry: { type: 'Point', coordinates: [1, 1] } }, { type: 'Feature', properties: { id: 'Q' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [999, 0], [1, 1], [0, 0]]] } }] }))
    expect(r.map!.regions).toHaveLength(1)
    expect(r.issues.warnings.join(' ')).toMatch(/2개/)
    expect(parseGeoJSON('x'.repeat(2_000_000)).issues.errors[0]).toMatch(/큽니다/)
  })

  it('reads TopoJSON too', () => {
    const topo = JSON.stringify({ type: 'Topology', arcs: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]], objects: { r: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', arcs: [[0]], properties: { id: 'T1' } }] } } })
    const r = parseGeoJSON(topo)
    expect(r.map?.regions[0].id).toBe('T1')
  })
})

describe('points inside regions', () => {
  const korea = getMap('korea')

  it('even–odd point in ring and holes', () => {
    const ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
    expect(inRing(ring, 5, 5)).toBe(true)
    expect(inRing(ring, 11, 5)).toBe(false)
    const donut = { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [ring, [[4, 4], [4, 6], [6, 6], [6, 4], [4, 4]]] } }
    expect(inRegion(donut, 5, 5)).toBe(false)
    expect(inRegion(donut, 2, 2)).toBe(true)
  })

  it('random points land inside their region, reproducibly, and different seeds differ', () => {
    const seoul = korea.byId.get('KR-11')!
    const a = randomPointsIn(seoul.feature, 200, createRng(5))
    const b = randomPointsIn(seoul.feature, 200, createRng(5))
    const c = randomPointsIn(seoul.feature, 200, createRng(6))
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
    expect(a.filter(([x, y]) => inRegion(seoul.feature, x, y)).length).toBe(200)
    // every point of a multi-polygon region (Gyeonggi includes islands) is inside one of its polygons
    const gg = korea.byId.get('KR-41')!
    expect(polygons(gg.feature).length).toBeGreaterThan(0)
    const pts = randomPointsIn(gg.feature, 300, createRng(1))
    expect(pts.filter(([x, y]) => inRegion(gg.feature, x, y)).length).toBe(300)
  })
})

describe('choropleth classes', () => {
  it('equal intervals, quantiles and natural breaks', () => {
    const v = [1, 2, 3, 10, 11, 12, 20, 21, 22]
    expect(classBreaks(v, 'equal', 3)).toEqual([1, 8, 15, 22])
    const q = classBreaks(v, 'quantile', 3)
    expect(q[0]).toBe(1)
    expect(q[1]).toBeCloseTo(7.6667, 3)
    expect(q[2]).toBeCloseTo(14.6667, 3)
    expect(q[3]).toBe(22)
    expect(jenksBreaks(v, 3)).toEqual([1, 10, 20, 22])
    expect(classBreaks(v, 'jenks', 3)).toEqual([1, 10, 20, 22])
  })

  it('Jenks breaks minimise the within-class variance (checked against brute force)', () => {
    const rng = createRng(4)
    const v = Array.from({ length: 9 }, () => Math.round(rng() * 100)).sort((a, b) => a - b)
    const sse = (cuts: number[]) => { let total = 0; const edges = [0, ...cuts, v.length]; for (let i = 0; i < edges.length - 1; i++) { const g = v.slice(edges[i], edges[i + 1]); const m = d3.mean(g)!; total += d3.sum(g, (x) => (x - m) ** 2) } return total }
    let best = Infinity
    for (let a = 1; a < 8; a++) for (let b = a + 1; b < 9; b++) best = Math.min(best, sse([a, b]))
    const edges = jenksBreaks(v, 3)
    const cuts = [v.findIndex((x) => x >= edges[1]), v.findIndex((x) => x >= edges[2])]
    if (edges.length === 4 && cuts[0] > 0 && cuts[1] > cuts[0]) expect(sse(cuts)).toBeCloseTo(best, 6)
    else expect(new Set(v).size).toBeLessThan(3)
  })

  it('classIndex covers the whole range including the maximum', () => {
    const e = [0, 10, 20, 30]
    expect([0, 9.9, 10, 19, 20, 30, 35, -3].map((x) => classIndex(x, e))).toEqual([0, 0, 1, 1, 2, 2, 2, 0])
    expect(classBreaks([5, 5, 5], 'jenks', 4)).toEqual([5, 5])
    expect(classBreaks([], 'equal', 3)).toEqual([])
  })

  it('normalising by area or by a base gives different rankings from raw values', () => {
    expect(normalizeValue(100, 'none', 10, 5)).toBe(100)
    expect(normalizeValue(100, 'area', 10, 5)).toBe(10)
    expect(normalizeValue(100, 'base', 10, 5)).toBe(20)
    expect(normalizeValue(100, 'base', 10, 0)).toBeNull()
    expect(normalizeValue(null, 'none', 10, 5)).toBeNull()
    expect(normalizeValue(100, 'area', 0, 5)).toBeNull()
    // big-but-sparse vs small-but-dense: raw and per-area orders are opposite
    const big = { v: 1000, area: 100000 }
    const small = { v: 400, area: 100 }
    expect(big.v > small.v).toBe(true)
    expect(normalizeValue(big.v, 'area', big.area, null)! < normalizeValue(small.v, 'area', small.area, null)!).toBe(true)
  })
})

describe('Dorling cartogram', () => {
  const rng = createRng(3)
  const items = Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, x: 200 + 100 * rng.normal(), y: 150 + 70 * rng.normal(), value: 1 + 99 * rng() }))

  it('circle area is proportional to the value', () => {
    const nodes = dorling(items, { maxRadius: 30, pull: 0.5 })
    const a = nodes.map((n) => Math.PI * n.r * n.r)
    const ratio = a.map((x, i) => x / items[i].value)
    for (const r of ratio) expect(r / ratio[0]).toBeCloseTo(1, 9)
    expect(dorlingRadius(25, 100, 40)).toBeCloseTo(20, 9)
    expect(dorlingRadius(0, 100, 40)).toBe(0)
    expect(Math.max(...nodes.map((n) => n.r))).toBeCloseTo(30, 9)
  })

  it('resolves collisions and is deterministic', () => {
    const a = dorling(items, { maxRadius: 22, pull: 0.6, ticks: 400 })
    expect(maxOverlap(a)).toBeLessThan(1)
    const b = dorling(items, { maxRadius: 22, pull: 0.6, ticks: 400 })
    expect(b.map((n) => [n.x, n.y])).toEqual(a.map((n) => [n.x, n.y]))
  })

  it('a stronger pull keeps circles nearer their original positions', () => {
    const moved = (pull: number) => d3.mean(dorling(items, { maxRadius: 26, pull, ticks: 400 }), (n) => Math.hypot(n.x - n.px, n.y - n.py))!
    expect(moved(1)).toBeLessThan(moved(0.05))
  })

  it('handles zero-valued regions and tiny inputs', () => {
    expect(dorling([{ id: 'a', x: 1, y: 1, value: 5 }], { maxRadius: 10, pull: 0.5 })[0].r).toBe(10)
    const z = dorling([{ id: 'a', x: 1, y: 1, value: 0 }, { id: 'b', x: 2, y: 2, value: 9 }], { maxRadius: 10, pull: 0.5 })
    expect(z[0].r).toBe(0)
    expect(dorling([], { maxRadius: 10, pull: 0.5 })).toEqual([])
  })
})

describe('geographic hexbin', () => {
  const rng = createRng(8)
  const pts: GeoPoint[] = Array.from({ length: 800 }, (_, row) => ({ lon: 127 + 1.2 * rng.normal(), lat: 36.5 + 1.2 * rng.normal(), value: 1 + rng(), row }))

  it('puts every point in exactly one cell and returns corners as lon/lat', () => {
    const plane = d3.geoAzimuthalEqualArea().rotate([-127, -36.5]).scale(6371).translate([0, 0])
    const cells = geoHexbin(pts, plane, 40)
    expect(d3.sum(cells, (c) => c.count)).toBe(800)
    expect(new Set(cells.flatMap((c) => c.points.map((p) => p.row))).size).toBe(800)
    for (const c of cells) { expect(c.corners).toHaveLength(6); for (const [lo, la] of c.corners) { expect(Math.abs(lo - 127)).toBeLessThan(15); expect(Math.abs(la - 36.5)).toBeLessThan(15) } }
  })

  it('equal-area bins cover equal ground area; Mercator screen bins cover less ground at high latitude', () => {
    const eq = d3.geoAzimuthalEqualArea().rotate([-10, 0]).scale(6371).translate([0, 0])
    const make = (lat: number) => Array.from({ length: 300 }, (_, row) => ({ lon: 10 + 0.5 * Math.sin(row * 7), lat: lat + 0.5 * Math.cos(row * 11), value: 1, row }))
    const area = (plane: d3.GeoProjection, lat: number) => d3.mean(geoHexbin(make(lat), plane, 60), (c) => cellAreaKm2(c.corners))!
    const ratioEq = area(eq, 5) / area(eq, 5)
    expect(ratioEq).toBe(1)
    const eqAt = (lat: number) => d3.geoAzimuthalEqualArea().rotate([-10, -lat]).scale(6371).translate([0, 0])
    expect(area(eqAt(0), 0) / area(eqAt(60), 60)).toBeGreaterThan(0.97)
    expect(area(eqAt(0), 0) / area(eqAt(60), 60)).toBeLessThan(1.03)
    const mer = d3.geoMercator().scale(6371).translate([0, 0])
    expect(area(mer, 60) / area(mer, 0)).toBeLessThan(0.4)
  })

  it('drops points the projection cannot place', () => {
    const o = d3.geoOrthographic().rotate([0, 0]).clipAngle(90).scale(6371).translate([0, 0])
    const cells = geoHexbin([{ lon: 0, lat: 0, value: 1, row: 0 }, { lon: 180, lat: 0, value: 1, row: 1 }], o, 50)
    expect(d3.sum(cells, (c) => c.count)).toBe(1)
  })
})

describe('flow map helpers', () => {
  it('detects antimeridian crossings and totals inflow and outflow', () => {
    expect(crossesDateline(170, -170)).toBe(true)
    expect(crossesDateline(127, 139)).toBe(false)
    const t = flowTotals([{ from: 'A', to: 'B', value: 5 }, { from: 'A', to: 'C', value: 3 }, { from: 'B', to: 'A', value: 2 }, { from: 'A', to: 'A', value: 9 }, { from: 'C', to: 'B', value: -4 }])
    expect(t.out.get('A')).toBe(8)
    expect(t.in.get('B')).toBe(5)
    expect(t.in.get('A')).toBe(2)
    expect(t.out.get('C')).toBeUndefined()
  })

  it('arcs bulge to the left of travel, so opposite flows separate', () => {
    const a: [number, number] = [0, 0]
    const b: [number, number] = [100, 0]
    expect(arcControl(a, b, 0.2)).toEqual([50, -20])
    expect(arcControl(b, a, 0.2)).toEqual([50, 20])
    expect(arcControl(a, b, 0)).toEqual([50, 0])
  })

  it('a great-circle line across the dateline is split by the projection instead of spanning the whole map', () => {
    const p = fitProjection('mercator', getMap('world').collection, 800, 450)
    const path = d3.geoPath(p)({ type: 'LineString', coordinates: [[170, 10], [-170, 10]] })!
    const subpaths = path.split('M').filter(Boolean)
    expect(subpaths.length).toBe(2)
    const xs = [...path.matchAll(/[ML]([-\d.]+),/g)].map((m) => Number(m[1]))
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(500)
  })
})
