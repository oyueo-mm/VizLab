import * as d3 from 'd3'
import { Pause, Play } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChartMessage, Legend, Readout, Tooltip, localPoint, useSvgId, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, NumberField, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, toTime, updateRow, type DataTable } from '../../data/table'
import { useReducedMotion } from '../../hooks/motion'
import { getMap } from '../../geo/maps'
import { inRegion } from '../../geo/geojson'
import { project } from '../../geo/projections'
import { MapZoomButtons, useMapZoom } from '../../geo/useMapZoom'
import { categoryColor, colorAt, schemes, type ColorScheme } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { formatTime } from '../../stats/datetime'
import { groundPlane, nearestNode, ROAD_SPEEDS, syntheticRoadNetwork, voronoiCells, type P2 } from '../../stats/geometry'
import { distanceToPolylineKm, gridContours, haversineKm, makeGrid, planarKm, projectionDistortion, timeSurface, trackAt, trackLengthKm, trackSpeedKmh, travelTimes, geodesicCircle, KM_PER_DEG, type BBox, type LonLat, type TrackPoint } from '../../stats/spatial'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'
import { BaseMap, GeoControls, geoDefaults, latRole, lonRole, readPoints, resolvePointMap, useProjection, type GeoParams } from './geoShared'
import { boxFor } from './geoKit'

const round4 = (v: number) => Math.round(v * 1e4) / 1e4
const seq = (Object.keys(schemes) as ColorScheme[]).filter((k) => !schemes[k].diverging).map((k) => ({ value: k, label: schemes[k].name }))

function useMapBase(table: DataTable, mapping: Mapping, params: GeoParams, width: number, height: number, compact: boolean | undefined, keys: { value?: string; label?: string; group?: string } = {}) {
  const { pts, skipped } = useMemo(() => readPoints(table, mapping, { lat: 'lat', lon: 'lon', ...keys }), [table, mapping]) // eslint-disable-line react-hooks/exhaustive-deps
  const resolved = useMemo(() => resolvePointMap(params, pts), [params, pts])
  const projection = useProjection(resolved.map, params, width, height, resolved.id)
  const svgRef = useRef<SVGSVGElement>(null)
  const zoom = useMapZoom(svgRef, { enabled: !compact, width, height })
  const tip = useTooltip()
  const outline = useMemo(() => d3.geoPath(projection)(resolved.map.collection) ?? '', [projection, resolved.map])
  return { pts, skipped, resolved, projection, svgRef, zoom, outline, ...tip }
}

// ─── Voronoi map ────────────────────────────────────────────────────────────────────

export interface VoronoiParams extends GeoParams { space: 'ground' | 'screen'; colorBy: 'value' | 'index'; scheme: ColorScheme; showSites: boolean; showDelaunay: boolean; clip: boolean; opacity: number; selected: number }

function VoronoiChart({ table, mapping, params, setParams, width, height, compact, onTableChange, linked }: ChartProps<VoronoiParams>) {
  const b = useMapBase(table, mapping, params, width, height, compact, { value: 'value', label: 'label' })
  const { pts, projection, svgRef, zoom, tip, show, hide, resolved } = b
  const clipId = useSvgId('vor-clip')
  const drag = useRef<number | null>(null)
  const sites = useMemo(() => pts.map((p) => ({ p, xy: project(projection, p.lon, p.lat) })).filter((q): q is { p: (typeof pts)[number]; xy: [number, number] } => !!q.xy), [pts, projection])
  const spread = useMemo(() => { if (!pts.length) return 0; const [w, e] = d3.extent(pts, (p) => p.lon) as [number, number], [so, n] = d3.extent(pts, (p) => p.lat) as [number, number]; return Math.max(e - w, n - so) }, [pts])
  const ground = params.space === 'ground' && spread < 25
  const cells = useMemo(() => {
    if (sites.length < 2) return [] as { cell: P2[] | null; areaKm2: number | null }[]
    if (ground) {
      const origin: LonLat = [d3.mean(sites, (s) => s.p.lon)!, d3.mean(sites, (s) => s.p.lat)!]
      const g = groundPlane(origin)
      const km = sites.map((s) => g.toKm([s.p.lon, s.p.lat]))
      const R = 1200
      const poly = voronoiCells(km, [-R, -R, R, R])
      return poly.map((cell) => ({ cell: cell ? cell.map((q) => { const ll = g.toLonLat(q); const xy = project(projection, ll[0], ll[1]); return (xy ?? [NaN, NaN]) as P2 }) : null, areaKm2: cell ? Math.abs(d3.polygonArea(cell)) : null }))
    }
    return voronoiCells(sites.map((s) => s.xy), [-width, -height, 2 * width, 2 * height]).map((cell) => ({ cell, areaKm2: null }))
  }, [sites, ground, projection, width, height])
  const tris = useMemo(() => (params.showDelaunay && sites.length >= 3 ? d3.Delaunay.from(sites.map((s) => s.xy)).render() : ''), [params.showDelaunay, sites])
  const scheme = schemes[params.scheme]
  const [lo, hi] = d3.extent(pts, (p) => p.value ?? NaN) as [number, number]
  const fillOf = (i: number) => (params.colorBy === 'value' && sites[i].p.value != null && hi > lo ? scheme.interpolate(0.12 + 0.82 * ((sites[i].p.value! - lo) / (hi - lo))) : colorAt(i))
  const editable = !!onTableChange && !compact
  const marked = new Set(linked?.rows ?? [])
  const k = zoom.t.k
  if (!roleColumn(mapping, 'lat') || !roleColumn(mapping, 'lon')) return <ChartMessage>위도와 경도(숫자형) 열을 선택하세요.</ChartMessage>
  if (sites.length < 2) return <ChartMessage>보로노이 분할에는 위치가 2개 이상 필요합니다.</ChartMessage>
  const toGeo = (e: React.PointerEvent) => { const l = localPoint(svgRef.current!, e); return projection.invert?.([(l.x - zoom.t.x) / k, (l.y - zoom.t.y) / k]) ?? null }
  const pathOf = (cell: P2[]) => (cell.some((q) => !Number.isFinite(q[0])) ? '' : `M${cell.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('L')}Z`)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg map-svg" role="img" data-testid="chart-svg" aria-label={`보로노이 지도: 위치 ${sites.length}개의 가장 가까운 영역`} onPointerLeave={() => { hide(); linked?.set(null) }}
        onPointerMove={(e) => { if (drag.current == null) return; const g = toGeo(e); if (g && Number.isFinite(g[0])) onTableChange!(updateRow(table, drag.current, { [roleColumn(mapping, 'lat')!]: round4(g[1]), [roleColumn(mapping, 'lon')!]: round4(g[0]) }), true) }}
        onPointerUp={() => { if (drag.current != null) { drag.current = null; onTableChange!(table, false) } }}>
        <defs><clipPath id={clipId}><path d={b.outline} /></clipPath></defs>
        <g transform={`translate(${zoom.t.x},${zoom.t.y}) scale(${k})`}>
          <BaseMap map={resolved.map} projection={projection} />
          <g clipPath={params.clip ? `url(#${clipId})` : undefined} data-testid="voronoi-cells">
            {cells.map((c, i) => c.cell ? (
              <path key={sites[i].p.row} className="vor-cell" data-testid="voronoi-cell" data-row={sites[i].p.row} d={pathOf(c.cell)} fill={fillOf(i)} fillOpacity={params.opacity} stroke={params.selected === sites[i].p.row || marked.has(sites[i].p.row) ? '#121816' : '#ffffff'} strokeWidth={params.selected === sites[i].p.row || marked.has(sites[i].p.row) ? 2 : 0.9} vectorEffect="non-scaling-stroke"
                onPointerMove={compact ? undefined : (e) => { linked?.set([sites[i].p.row]); const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>{sites[i].p.label || `위치 ${sites[i].p.row + 1}`}</b>{sites[i].p.value != null ? <><br />값 {fmt(sites[i].p.value)}</> : null}<br />{c.areaKm2 != null ? <>셀 넓이 약 {fmt(c.areaKm2, 0)} km² (경계 셀은 계산 범위까지)</> : '화면 평면에서 계산'}</>) }} onPointerLeave={() => { hide(); linked?.set(null) }} onClick={compact ? undefined : () => setParams({ selected: params.selected === sites[i].p.row ? -1 : sites[i].p.row })} />
            ) : null)}
          </g>
          {tris && <path d={tris} fill="none" stroke="#111" strokeOpacity={0.35} strokeWidth={0.8} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
          {(params.showSites || editable) && sites.map(({ p, xy }) => (
            <circle key={p.row} data-testid="voronoi-site" data-row={p.row} data-nodrag={editable ? '' : undefined} className={editable ? 'is-draggable' : ''} cx={xy[0]} cy={xy[1]} r={(compact ? 2 : 4.5) / k} fill="#121816" stroke="#fff" strokeWidth={1.4} vectorEffect="non-scaling-stroke"
              onPointerDown={editable ? (e) => { e.stopPropagation(); (svgRef.current as Element).setPointerCapture(e.pointerId); drag.current = p.row; setParams({ selected: p.row }); hide() } : undefined} />
          ))}
        </g>
      </svg>
      {!compact && (<>
        {params.colorBy === 'index' ? null : hi > lo && <div className="color-legend"><span>{fmt(lo)}</span><span className="color-ramp" style={{ background: `linear-gradient(90deg, ${d3.range(0, 1.01, 0.1).map((v) => scheme.interpolate(0.12 + 0.82 * v)).join(',')})` }} /><span>{fmt(hi)}</span></div>}
        <Readout items={[{ label: '위치', value: sites.length }, { label: '계산 평면', value: ground ? '땅 위 거리(km)' : '화면' }]} />
        <MapZoomButtons zoom={zoom} k={k} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

function VoronoiControls({ params, setParams, table, mapping }: ControlsProps<VoronoiParams>) {
  const { pts } = useMemo(() => readPoints(table, mapping, { lat: 'lat', lon: 'lon' }), [table, mapping])
  const resolved = useMemo(() => resolvePointMap(params, pts), [params, pts])
  return (
    <>
      <ControlGroup title="분할">
        <Segmented label="계산 평면" value={params.space} onChange={(space) => setParams({ space })} testId="ctl-vor-space" options={[{ value: 'ground', label: '땅 위 거리' }, { value: 'screen', label: '화면 평면' }]} />
        <Hint>보로노이 셀은 ‘그 위치가 다른 어떤 기준점보다 가까운’ 공간입니다. ‘땅 위 거리’는 위도·경도를 km 평면으로 옮겨 계산하므로 투영의 왜곡에 영향받지 않고, ‘화면 평면’은 지도 위 픽셀 거리로 계산해 메르카토르처럼 고위도가 늘어나는 투영에서는 실제 거리와 달라집니다. 기준점을 끌면 분할이 즉시 다시 계산됩니다.</Hint>
        <Toggle label="해안선으로 자르기" checked={params.clip} onChange={(clip) => setParams({ clip })} />
        <Toggle label="들로네 삼각형 겹치기" checked={params.showDelaunay} onChange={(showDelaunay) => setParams({ showDelaunay })} testId="ctl-delaunay" />
        <Toggle label="기준점 표시" checked={params.showSites} onChange={(showSites) => setParams({ showSites })} />
      </ControlGroup>
      <ControlGroup title="색">
        <Segmented label="색 기준" value={params.colorBy} onChange={(colorBy) => setParams({ colorBy })} options={[{ value: 'value', label: '값' }, { value: 'index', label: '구별 색' }]} />
        {params.colorBy === 'value' && <Select label="팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={seq} />}
        <Slider label="불투명도" value={params.opacity} min={0.3} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} />
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams} resolved={resolved} /></ControlGroup>
    </>
  )
}

export const voronoiMapModule: VizModule<VoronoiParams> = {
  roles: [latRole(), lonRole(), { key: 'value', label: '값 (선택, 색)', type: 'number', prefer: '값|value' }, { key: 'label', label: '이름 (선택)', type: 'category', auto: true, prefer: '이름|지역|name' }],
  datasets: ['temp-stations', 'kr-regions'],
  defaultParams: { ...geoDefaults, space: 'ground', colorBy: 'value', scheme: 'teal', showSites: true, showDelaunay: false, clip: true, opacity: 0.85, selected: -1 },
  Chart: VoronoiChart,
  Controls: VoronoiControls,
  hint: '기준점을 끌면 보로노이 분할이 다시 계산됩니다 · 들로네 삼각형을 겹쳐 보세요 · 계산 평면을 바꿔 투영 왜곡의 영향을 비교',
}

// ─── isochrone map ──────────────────────────────────────────────────────────────────

export interface IsoParams extends GeoParams { origin: LonLat; highway: number; local: number; offKmh: number; bands: number; step: number; seed: number; showRoads: boolean; scheme: ColorScheme }

const HUB_NAMES = [['서울', 126.98, 37.57], ['대전', 127.38, 36.35], ['대구', 128.6, 35.87], ['부산', 129.08, 35.18], ['광주', 126.85, 35.16], ['강릉', 128.9, 37.75]] as const

function IsochroneChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<IsoParams>) {
  const { pts } = useMemo(() => readPoints(table, mapping, { lat: 'lat', lon: 'lon', value: 'value', label: 'label' }), [table, mapping])
  const resolved = useMemo(() => resolvePointMap({ ...params, map: 'korea' }, pts), [params, pts])
  const projection = useProjection(resolved.map, { ...params, map: 'korea' }, width, height, 'korea')
  const svgRef = useRef<SVGSVGElement>(null)
  const zoom = useMapZoom(svgRef, { enabled: !compact, width, height })
  const { tip, show, hide } = useTooltip()
  const clipId = useSvgId('iso-clip')
  const map = getMap('korea')
  const box = useMemo(() => boxFor({ ...resolved, id: 'korea' }, [], 0), [resolved])
  const onLand = useMemo(() => {
    const cache = new Map<string, boolean>()
    return (lon: number, lat: number) => { const key = `${lon.toFixed(3)},${lat.toFixed(3)}`; let v = cache.get(key); if (v === undefined) { v = map.regions.some((r) => inRegion(r.feature, lon, lat)); cache.set(key, v) } return v }
  }, [map])
  const net = useMemo(() => syntheticRoadNetwork(box, onLand, compact ? 22 : 15, HUB_NAMES.map((h) => [h[1], h[2]] as LonLat), params.seed), [box, onLand, compact, params.seed])
  const edges = useMemo(() => net.edges.map((e, i) => ({ ...e, speed: net.cls[i] === 0 ? params.highway : net.cls[i] === 1 ? (params.highway + params.local) / 2 : params.local })), [net, params.highway, params.local])
  const origin = useMemo(() => nearestNode(net.nodes, params.origin), [net.nodes, params.origin])
  const times = useMemo(() => travelTimes(net.nodes.length, edges, origin), [net.nodes.length, edges, origin])
  const surface = useMemo(() => timeSurface(net.nodes, times, box, compact ? 70 : 120, compact ? 90 : 160, params.offKmh, 45), [net.nodes, times, box, params.offKmh, compact])
  const thresholds = useMemo(() => Array.from({ length: params.bands }, (_, i) => (i + 1) * params.step), [params.bands, params.step])
  const bands = useMemo(() => gridContours(surface, thresholds, 'below'), [surface, thresholds])
  const scheme = schemes[params.scheme]
  const outline = useMemo(() => d3.geoPath(projection)(map.collection) ?? '', [projection, map])
  const roadPaths = useMemo(() => {
    if (!params.showRoads || compact) return null
    const g: string[] = ['', '', '']
    net.edges.forEach((e, i) => { const a = project(projection, ...net.nodes[e.a]), c = project(projection, ...net.nodes[e.b]); if (a && c) g[net.cls[i]] += `M${a[0].toFixed(1)},${a[1].toFixed(1)}L${c[0].toFixed(1)},${c[1].toFixed(1)}` })
    return g
  }, [params.showRoads, compact, net, projection])
  const reach = useMemo(() => thresholds.map((t) => times.reduce((n, v) => n + (v <= t ? 1 : 0), 0)), [times, thresholds])
  const k = zoom.t.k
  const o = project(projection, ...net.nodes[origin])
  const down = useRef<{ x: number; y: number } | null>(null)
  const pathGen = d3.geoPath(projection)
  const color = (i: number) => scheme.interpolate(0.9 - 0.75 * (i / Math.max(1, params.bands - 1)))
  const maxT = thresholds[thresholds.length - 1]
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg map-svg" role="img" data-testid="chart-svg" aria-label={`등시간선 지도: 출발지에서 ${thresholds.join('·')}분 이내`}
        onPointerDown={(e) => { down.current = { x: e.clientX, y: e.clientY } }}
        onPointerUp={(e) => {
          const d = down.current; down.current = null
          if (compact || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return
          const l = localPoint(svgRef.current!, e)
          const g = projection.invert?.([(l.x - zoom.t.x) / k, (l.y - zoom.t.y) / k])
          if (g && onLand(g[0], g[1])) setParams({ origin: [round4(g[0]), round4(g[1])] })
        }}
        onPointerMove={compact ? undefined : (e) => {
          const l = localPoint(svgRef.current!, e)
          const g = projection.invert?.([(l.x - zoom.t.x) / k, (l.y - zoom.t.y) / k])
          if (!g) { hide(); return }
          const t = surfaceTime(surface, g[0], g[1])
          if (Number.isFinite(t)) show(l.x, l.y, <>출발지에서 약 <b>{fmt(t, 0)}분</b><br />클릭하면 출발지 이동</>); else hide()
        }}
        onPointerLeave={hide}>
        <defs><clipPath id={clipId}><path d={outline} /></clipPath></defs>
        <g transform={`translate(${zoom.t.x},${zoom.t.y}) scale(${k})`}>
          <path d={outline} fill="#f1f4f3" stroke="#d5dbd9" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
          <g clipPath={`url(#${clipId})`} data-testid="iso-bands">
            {[...bands].reverse().map((b) => {
              const i = thresholds.indexOf(b.value)
              return <path key={b.value} data-testid="iso-band" data-minutes={b.value} d={pathGen({ type: 'MultiPolygon', coordinates: b.polygons } as never) ?? ''} fill={color(i)} fillOpacity={0.78} stroke="#ffffff" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            })}
          </g>
          {roadPaths && <g pointerEvents="none" fill="none">{[2, 1, 0].map((c) => <path key={c} d={roadPaths[c]} stroke={c === 0 ? '#7a2d1c' : c === 1 ? '#6b7280' : '#aab4b0'} strokeWidth={c === 0 ? 1.6 : c === 1 ? 0.9 : 0.4} strokeOpacity={0.8} vectorEffect="non-scaling-stroke" />)}</g>}
          {o && <circle cx={o[0]} cy={o[1]} r={6 / k} fill="#e07a3f" stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" data-testid="iso-origin" pointerEvents="none" />}
        </g>
      </svg>
      {!compact && (<>
        <Legend items={thresholds.map((t, i) => ({ key: `${t}분 이내 (${reach[i]}곳)`, color: color(i) }))} title="이동 시간" />
        <Readout items={[{ label: '노드', value: net.nodes.length }, { label: '도로', value: net.edges.length }, { label: '최대', value: `${maxT}분` }]} />
        <p className="chart-note" role="note">합성 도로망입니다. 실제 도로가 아니며 실제 이동 시간이 아닙니다.</p>
        <MapZoomButtons zoom={zoom} k={k} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

function surfaceTime(g: ReturnType<typeof timeSurface>, lon: number, lat: number) {
  const i = Math.round(((lon - g.west) / (g.east - g.west)) * (g.nx - 1)), j = Math.round(((lat - g.south) / (g.north - g.south)) * (g.ny - 1))
  return i >= 0 && j >= 0 && i < g.nx && j < g.ny ? g.values[j * g.nx + i] : NaN
}

function IsochroneControls({ params, setParams }: ControlsProps<IsoParams>) {
  return (
    <>
      <ControlGroup title="이동 시간">
        <Slider label="구간 수" value={params.bands} min={1} max={8} onChange={(bands) => setParams({ bands })} testId="ctl-iso-bands" />
        <Slider label="구간 간격 (분)" value={params.step} min={10} max={120} step={5} onChange={(step) => setParams({ step })} format={(v) => `${v}분`} testId="ctl-iso-step" />
        <Select label="색상 팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={seq} />
        <Toggle label="도로망 표시" checked={params.showRoads} onChange={(showRoads) => setParams({ showRoads })} />
        <Hint>지도를 클릭하면 가장 가까운 도로망 노드가 출발지가 됩니다. 등시간선은 다익스트라로 구한 각 노드까지의 최단 이동 시간 위에, ‘노드까지 간 뒤 도로 밖에서 걷거나 달리는’ 시간을 더한 면을 같은 시간으로 이은 것입니다. 이 도로망은 지도 위에 만든 합성 격자와 고속도로 가상 노선이며 실제 도로·신호·혼잡을 반영하지 않습니다.</Hint>
      </ControlGroup>
      <ControlGroup title="속도 (km/h)">
        <Slider label="고속 노선" value={params.highway} min={40} max={140} step={5} onChange={(highway) => setParams({ highway })} format={(v) => `${v}`} testId="ctl-iso-highway" />
        <Slider label="일반 도로" value={params.local} min={15} max={80} step={5} onChange={(local) => setParams({ local })} format={(v) => `${v}`} testId="ctl-iso-local" />
        <Slider label="도로 밖 이동" value={params.offKmh} min={4} max={60} step={2} onChange={(offKmh) => setParams({ offKmh })} format={(v) => `${v}`} />
        <NumberField label="도로망 난수 시드" value={params.seed} min={0} step={1} onChange={(seed) => setParams({ seed })} />
      </ControlGroup>
    </>
  )
}

export const isochroneModule: VizModule<IsoParams> = {
  roles: [latRole(), lonRole(), { key: 'value', label: '값 (선택)', type: 'number', prefer: '값|value' }, { key: 'label', label: '이름 (선택)', type: 'category', auto: true, prefer: '이름|지역|name' }],
  datasets: ['kr-regions'],
  defaultParams: { ...geoDefaults, map: 'korea', origin: [126.98, 37.57], highway: 100, local: 45, offKmh: 25, bands: 4, step: 30, seed: 3, showRoads: true, scheme: 'ylorrd' },
  Chart: IsochroneChart,
  Controls: IsochroneControls,
  hint: '지도를 클릭해 출발지 이동 · 구간 간격과 도로 속도를 바꿔 도달 범위가 어떻게 변하는지 확인 · 합성 도로망입니다',
}

// ─── buffer map ─────────────────────────────────────────────────────────────────────

export interface BufferParams extends GeoParams { radius: number; rings: number; unit: 'km' | 'mi'; metric: 'haversine' | 'planar' | 'screen'; dissolve: boolean; selected: number }
interface Feature { name: string; vertices: { row: number; lon: number; lat: number }[] }

export function readFeatures(table: DataTable, mapping: Mapping): Feature[] {
  const ni = columnIndex(table, roleColumn(mapping, 'name')), li = columnIndex(table, roleColumn(mapping, 'lat')), oi = columnIndex(table, roleColumn(mapping, 'lon'))
  const by = new Map<string, Feature>()
  if (li < 0 || oi < 0) return []
  table.rows.forEach((r, row) => {
    const lat = toNumber(r[li]), lon = toNumber(r[oi])
    if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return
    const name = ni >= 0 ? toLabel(r[ni]) || `행 ${row + 1}` : `행 ${row + 1}`
    const f = by.get(name) ?? { name, vertices: [] }
    f.vertices.push({ row, lon, lat })
    by.set(name, f)
  })
  return [...by.values()]
}

const KM_PER_MI = 1.609344

function BufferChart({ table, mapping, params, setParams, width, height, compact, onTableChange }: ChartProps<BufferParams>) {
  const features = useMemo(() => readFeatures(table, mapping), [table, mapping])
  const allPts = useMemo(() => features.flatMap((f) => f.vertices), [features])
  const resolved = useMemo(() => resolvePointMap(params, allPts), [params, allPts])
  const projection = useProjection(resolved.map, params, width, height, resolved.id)
  const svgRef = useRef<SVGSVGElement>(null)
  const zoom = useMapZoom(svgRef, { enabled: !compact, width, height })
  const { tip, show, hide } = useTooltip()
  const drag = useRef<number | null>(null)
  const radiusKm = params.radius * (params.unit === 'mi' ? KM_PER_MI : 1)
  const box: BBox = useMemo(() => {
    const ex = allPts.length ? { w: d3.min(allPts, (p) => p.lon)!, e: d3.max(allPts, (p) => p.lon)!, s: d3.min(allPts, (p) => p.lat)!, n: d3.max(allPts, (p) => p.lat)! } : { w: 126, e: 129, s: 34, n: 38 }
    const pad = (radiusKm * params.rings) / KM_PER_DEG + 0.4
    const padLon = pad / Math.cos((((ex.s + ex.n) / 2) * Math.PI) / 180)
    return { west: Math.max(-180, ex.w - padLon), east: Math.min(180, ex.e + padLon), south: Math.max(-89, ex.s - pad), north: Math.min(89, ex.n + pad) }
  }, [allPts, radiusKm, params.rings])
  // pixels per km at the map centre, so the screen metric can measure in pixels
  const pxPerKm = useMemo(() => { const cx = (box.west + box.east) / 2, cy = (box.south + box.north) / 2; const a = projection([cx, cy]), c = projection([cx + 1 / (KM_PER_DEG * Math.cos((cy * Math.PI) / 180)), cy]); return a && c ? Math.hypot(c[0] - a[0], c[1] - a[1]) : 1 }, [projection, box])
  const nx = compact ? 70 : 150
  const ny = Math.max(30, Math.round((nx * (box.north - box.south)) / ((box.east - box.west) * Math.cos((((box.north + box.south) / 2) * Math.PI) / 180))))
  const rings = useMemo(() => {
    if (!features.length) return []
    const thresholds = Array.from({ length: params.rings }, (_, i) => radiusKm * (i + 1))
    const dist = (f: Feature, lon: number, lat: number) => {
      const line: LonLat[] = f.vertices.map((v) => [v.lon, v.lat])
      if (params.metric === 'screen') {
        const p = projection([lon, lat]); if (!p) return Infinity
        const pl = line.map((q) => projection(q) ?? [NaN, NaN])
        let best = Infinity
        for (let i = 0; i < Math.max(1, pl.length - 1); i++) { const a = pl[i], b = pl[Math.min(i + 1, pl.length - 1)]; const dx = b[0] - a[0], dy = b[1] - a[1]; const l2 = dx * dx + dy * dy; const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0; best = Math.min(best, Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t))) }
        return best / pxPerKm
      }
      return distanceToPolylineKm([lon, lat], line, params.metric)
    }
    const perFeature = params.dissolve ? [features] : features.map((f) => [f])
    return perFeature.flatMap((group, gi) => {
      const g = makeGrid(box, nx, ny, (lon, lat) => Math.min(...group.map((f) => dist(f, lon, lat))))
      return gridContours(g, thresholds, 'below').map((c) => ({ key: `${gi}-${c.value}`, value: c.value, polygons: c.polygons, group: gi }))
    })
  }, [features, params.rings, params.metric, params.dissolve, radiusKm, box, nx, ny, projection, pxPerKm])
  const pathGen = d3.geoPath(projection)
  const ringArea = (r: { polygons: LonLat[][][] }) => r.polygons.reduce((s, poly) => s + d3.geoArea({ type: 'Polygon', coordinates: poly.map((rg) => [...rg].reverse()) } as never) * 6371.0088 ** 2, 0)
  const outerArea = useMemo(() => { const last = rings.filter((r) => r.value === radiusKm * params.rings); return d3.sum(last, ringArea) }, [rings]) // eslint-disable-line react-hooks/exhaustive-deps
  const color = categoryColor(features.map((f) => f.name))
  const k = zoom.t.k
  const editable = !!onTableChange && !compact
  if (!roleColumn(mapping, 'lat') || !roleColumn(mapping, 'lon')) return <ChartMessage>위도와 경도(숫자형) 열을 선택하세요.</ChartMessage>
  if (!features.length) return <ChartMessage>좌표가 올바른 행이 없습니다.</ChartMessage>
  const toGeo = (e: React.PointerEvent) => { const l = localPoint(svgRef.current!, e); return projection.invert?.([(l.x - zoom.t.x) / k, (l.y - zoom.t.y) / k]) ?? null }
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg map-svg" role="img" data-testid="chart-svg" aria-label={`버퍼 지도: 반경 ${params.radius}${params.unit}, ${params.rings}겹`} onPointerLeave={hide}
        onPointerMove={(e) => { if (drag.current == null) return; const g = toGeo(e); if (g && Number.isFinite(g[0])) onTableChange!(updateRow(table, drag.current, { [roleColumn(mapping, 'lat')!]: round4(g[1]), [roleColumn(mapping, 'lon')!]: round4(g[0]) }), true) }}
        onPointerUp={() => { if (drag.current != null) { drag.current = null; onTableChange!(table, false) } }}>
        <g transform={`translate(${zoom.t.x},${zoom.t.y}) scale(${k})`}>
          <BaseMap map={resolved.map} projection={projection} />
          {[...rings].sort((a, b) => b.value - a.value).map((r) => {
            const i = Math.round(r.value / radiusKm) - 1
            return <path key={r.key} data-testid="buffer-ring" data-radius={r.value.toFixed(2)} d={pathGen({ type: 'MultiPolygon', coordinates: r.polygons } as never) ?? ''} fill={params.dissolve ? '#2a7d74' : color(features[r.group]?.name ?? '')} fillOpacity={0.14 + 0.16 * (1 - i / Math.max(1, params.rings))} stroke={params.dissolve ? '#2a7d74' : color(features[r.group]?.name ?? '')} strokeOpacity={0.9} strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          })}
          {features.map((f, fi) => {
            const pts = f.vertices.map((v) => project(projection, v.lon, v.lat)).filter((q): q is [number, number] => !!q)
            return (
              <g key={f.name}>
                {pts.length > 1 && <path d={d3.line()(pts) ?? ''} fill="none" stroke={color(f.name)} strokeWidth={2.2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" pointerEvents="none" />}
                {f.vertices.map((v, vi) => { const q = pts[vi]; return q ? <circle key={v.row} data-testid="buffer-vertex" data-row={v.row} data-nodrag={editable ? '' : undefined} className={editable ? 'is-draggable' : ''} cx={q[0]} cy={q[1]} r={(pts.length > 1 ? 4 : 6) / k} fill={color(f.name)} stroke={params.selected === v.row ? '#121816' : '#fff'} strokeWidth={2} vectorEffect="non-scaling-stroke"
                  onPointerDown={editable ? (e) => { e.stopPropagation(); (svgRef.current as Element).setPointerCapture(e.pointerId); drag.current = v.row; setParams({ selected: v.row }); hide() } : undefined}
                  onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>{f.name}</b> {pts.length > 1 ? `(꼭짓점 ${vi + 1})` : ''}<br />{fmt(v.lat, 3)}°, {fmt(v.lon, 3)}°{editable ? <><br />드래그해 이동</> : null}</>) }} onPointerLeave={hide} /> : null })}
                {fi < 0 && null}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (<>
        <Readout items={[{ label: '반경', value: `${params.radius} ${params.unit} (${fmt(radiusKm, 1)} km)` }, { label: '바깥 겹 넓이', value: `${fmt(outerArea, 0)} km²` }, { label: '거리 계산', value: { haversine: '구면(하버사인)', planar: '평면 근사', screen: '화면 거리' }[params.metric] }]} />
        <MapZoomButtons zoom={zoom} k={k} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

function BufferControls({ params, setParams, table, mapping }: ControlsProps<BufferParams>) {
  const pts = useMemo(() => readFeatures(table, mapping).flatMap((f) => f.vertices), [table, mapping])
  const resolved = useMemo(() => resolvePointMap(params, pts), [params, pts])
  return (
    <>
      <ControlGroup title="거리권">
        <Slider label="반경" value={params.radius} min={5} max={150} step={5} onChange={(radius) => setParams({ radius })} format={(v) => `${v} ${params.unit}`} testId="ctl-buffer-radius" />
        <Segmented label="단위" value={params.unit} onChange={(unit) => setParams({ unit })} testId="ctl-buffer-unit" options={[{ value: 'km', label: 'km' }, { value: 'mi', label: '마일' }]} />
        <Slider label="겹 수 (같은 간격)" value={params.rings} min={1} max={5} onChange={(rings) => setParams({ rings })} testId="ctl-buffer-rings" />
        <Select label="거리 계산" value={params.metric} onChange={(metric) => setParams({ metric })} testId="ctl-buffer-metric" options={[{ value: 'haversine', label: '구면 거리 (하버사인)' }, { value: 'planar', label: '평면 근사 (등장방형)' }, { value: 'screen', label: '화면(투영) 거리' }]} />
        <Toggle label="시설을 합쳐 하나로 (디졸브)" checked={params.dissolve} onChange={(dissolve) => setParams({ dissolve })} testId="ctl-dissolve" />
        <Hint>버퍼는 점이나 선에서 일정 거리 이내인 모든 곳입니다. 각 지점의 시설까지 거리를 격자로 계산해 그 값의 등치선을 버퍼 경계로 삼으므로, 선의 버퍼도 끝이 둥근 ‘캡슐’ 모양으로 정확히 나옵니다. ‘화면 거리’는 지도 위의 픽셀 거리라 고위도에서 늘어나는 메르카토르에서는 실제보다 작은 원이 됩니다. 점이나 꼭짓점을 끌어 옮길 수 있습니다.</Hint>
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams} resolved={resolved} /></ControlGroup>
    </>
  )
}

export const bufferMapModule: VizModule<BufferParams> = {
  roles: [{ key: 'name', label: '시설 이름 (같은 이름은 한 선)', type: 'category', required: true, prefer: '이름|name' }, latRole(), lonRole()],
  datasets: ['buffer-features'],
  defaultParams: { ...geoDefaults, radius: 30, rings: 2, unit: 'km', metric: 'haversine', dissolve: false, selected: -1 },
  Chart: BufferChart,
  Controls: BufferControls,
  hint: '점·꼭짓점을 끌어 시설을 옮기고 반경·단위·거리 계산법을 바꿔 보세요 · 같은 이름이 여러 행이면 선(캡슐 모양 버퍼)',
}

// ─── trajectories ───────────────────────────────────────────────────────────────────

export interface TrajParams extends GeoParams { t: number; playing: boolean; rate: number; trailMin: number; showPaths: boolean; colorBy: 'entity' | 'speed' }

function readTracks(table: DataTable, mapping: Mapping) {
  const ei = columnIndex(table, roleColumn(mapping, 'entity')), ti = columnIndex(table, roleColumn(mapping, 'time')), li = columnIndex(table, roleColumn(mapping, 'lat')), oi = columnIndex(table, roleColumn(mapping, 'lon'))
  const by = new Map<string, TrackPoint[]>()
  if ([ei, ti, li, oi].some((i) => i < 0)) return { tracks: [] as { name: string; pts: TrackPoint[] }[], skipped: 0 }
  let skipped = 0
  for (const r of table.rows) {
    const t = toTime(r[ti] as never), lat = toNumber(r[li]), lon = toNumber(r[oi]), name = toLabel(r[ei])
    if (t == null || lat == null || lon == null || !name || Math.abs(lat) > 90 || Math.abs(lon) > 180) { skipped++; continue }
    ;(by.get(name) ?? by.set(name, []).get(name)!).push({ t, lon, lat })
  }
  return { tracks: [...by].map(([name, pts]) => ({ name, pts: pts.sort((a, b) => a.t - b.t) })).filter((x) => x.pts.length >= 2), skipped }
}

function TrajectoryChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<TrajParams>) {
  const { tracks, skipped } = useMemo(() => readTracks(table, mapping), [table, mapping])
  const all = useMemo(() => tracks.flatMap((t) => t.pts), [tracks])
  const resolved = useMemo(() => resolvePointMap(params, all), [params, all])
  const projection = useProjection(resolved.map, params, width, height, resolved.id)
  const svgRef = useRef<SVGSVGElement>(null)
  const zoom = useMapZoom(svgRef, { enabled: !compact, width, height })
  const reduced = useReducedMotion()
  const [visible, setVisible] = useState(true)
  const wrap = useRef<HTMLDivElement>(null)
  const [t0, t1] = useMemo(() => [d3.min(tracks, (t) => t.pts[0].t) ?? 0, d3.max(tracks, (t) => t.pts[t.pts.length - 1].t) ?? 1], [tracks])
  const now = t0 + params.t * (t1 - t0)
  const color = categoryColor(tracks.map((t) => t.name))
  const speedMax = useMemo(() => d3.max(tracks.flatMap((t) => t.pts.slice(1).map((p, i) => { const h = (p.t - t.pts[i].t) / 3600000; return h > 0 ? haversineKm([t.pts[i].lon, t.pts[i].lat], [p.lon, p.lat]) / h : 0 }))) ?? 1, [tracks])
  const speedScale = schemes.ylorrd
  const running = params.playing && visible && !reduced && !compact
  useEffect(() => {
    const el = wrap.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((es) => setVisible(es[es.length - 1]?.isIntersecting ?? true))
    io.observe(el)
    return () => io.disconnect()
  }, [])
  const tRef = useRef(params.t)
  tRef.current = params.t
  // single animation loop: advances the time fraction at `rate` track-spans per minute of wall time
  useEffect(() => {
    if (!running || t1 <= t0) return
    let raf = 0, last = performance.now()
    const loop = (nowMs: number) => {
      const dt = nowMs - last
      last = nowMs
      const next = tRef.current + (dt / 60000) * params.rate
      setParams({ t: next >= 1 ? 0 : next })
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [running, params.rate, t0, t1]) // eslint-disable-line react-hooks/exhaustive-deps
  const k = zoom.t.k
  const place = useCallback((p: LonLat) => project(projection, p[0], p[1]), [projection])
  if (!roleColumn(mapping, 'entity') || !roleColumn(mapping, 'time') || !roleColumn(mapping, 'lat') || !roleColumn(mapping, 'lon')) return <ChartMessage>개체, 시각(날짜형), 위도, 경도 열을 선택하세요.</ChartMessage>
  if (!tracks.length) return <ChartMessage>기록이 2개 이상인 개체가 없습니다.</ChartMessage>
  const trailMs = params.trailMin * 60000
  return (
    <div className="chart-root" ref={wrap}>
      <svg ref={svgRef} width={width} height={height} className="chart-svg map-svg" role="img" data-testid="chart-svg" aria-label={`이동 궤적 지도: 개체 ${tracks.length}개, 시각 ${formatTime(now)}`}>
        <g transform={`translate(${zoom.t.x},${zoom.t.y}) scale(${k})`}>
          <BaseMap map={resolved.map} projection={projection} />
          {tracks.map((tr) => {
            const full = tr.pts.map((p) => place([p.lon, p.lat])).filter((q): q is [number, number] => !!q)
            const here = tr.pts.filter((p) => p.t >= now - trailMs && p.t <= now)
            const cur = trackAt(tr.pts, now)
            const trail = [...(trailMs > 0 && cur ? [] : []), ...here.map((p) => place([p.lon, p.lat])), ...(cur ? [place(cur)] : [])].filter((q): q is [number, number] => !!q)
            const sp = cur ? trackSpeedKmh(tr.pts, now) : 0
            const col = params.colorBy === 'speed' ? speedScale.interpolate(0.15 + 0.85 * Math.min(1, sp / speedMax)) : color(tr.name)
            const q = cur ? place(cur) : null
            return (
              <g key={tr.name} data-testid="track" data-name={tr.name}>
                {params.showPaths && <path d={d3.line()(full) ?? ''} fill="none" stroke={color(tr.name)} strokeOpacity={0.22} strokeWidth={1.2} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
                {trail.length > 1 && <path d={d3.line()(trail) ?? ''} fill="none" stroke={col} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
                {q && <circle data-testid="track-head" cx={q[0]} cy={q[1]} r={5.5 / k} fill={col} stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (<>
        <Legend items={tracks.map((t) => ({ key: `${t.name} · ${fmt(trackLengthKm(t.pts), 0)} km`, color: color(t.name) }))} />
        <div className="traj-bar" data-testid="traj-bar">
          <button type="button" className="icon-btn" aria-label={params.playing ? '일시정지' : '재생'} aria-pressed={params.playing} onClick={() => setParams({ playing: !params.playing })} data-testid="traj-play">{params.playing ? <Pause size={17} /> : <Play size={17} />}</button>
          <input type="range" min={0} max={1} step={0.001} value={params.t} aria-label="시간" onChange={(e) => setParams({ t: Number(e.target.value), playing: false })} data-testid="traj-slider" />
          <output data-testid="traj-time">{formatTime(now)}</output>
        </div>
        <Readout items={[{ label: '개체', value: tracks.length }, { label: '상태', value: reduced ? '정지 (모션 줄이기)' : running ? '재생 중' : '정지' }]} />
        {skipped > 0 && <p className="chart-warning" role="status">시각·좌표가 올바르지 않은 {skipped}행은 제외했습니다.</p>}
        <MapZoomButtons zoom={zoom} k={k} />
      </>)}
    </div>
  )
}

function TrajectoryControls({ params, setParams, table, mapping }: ControlsProps<TrajParams>) {
  const { tracks } = useMemo(() => readTracks(table, mapping), [table, mapping])
  const resolved = useMemo(() => resolvePointMap(params, tracks.flatMap((t) => t.pts)), [params, tracks])
  const stats = tracks.map((t) => [t.name, `${fmt(trackLengthKm(t.pts), 0)} km`, `${fmt(trackLengthKm(t.pts) / Math.max(1e-9, (t.pts[t.pts.length - 1].t - t.pts[0].t) / 3600000), 1)} km/h`])
  return (
    <>
      <ControlGroup title="재생">
        <Toggle label="재생" checked={params.playing} onChange={(playing) => setParams({ playing })} testId="ctl-traj-play" />
        <Slider label="재생 속도 (전체 구간/분)" value={params.rate} min={0.1} max={4} step={0.1} onChange={(rate) => setParams({ rate })} format={(v) => `${v}×`} testId="ctl-traj-rate" />
        <Slider label="꼬리 길이 (분)" value={params.trailMin} min={0} max={240} step={5} onChange={(trailMin) => setParams({ trailMin })} format={(v) => `${v}분`} testId="ctl-traj-trail" />
        <Segmented label="색" value={params.colorBy} onChange={(colorBy) => setParams({ colorBy })} options={[{ value: 'entity', label: '개체' }, { value: 'speed', label: '속력' }]} />
        <Toggle label="전체 경로 (희미하게)" checked={params.showPaths} onChange={(showPaths) => setParams({ showPaths })} />
        <Hint>위치는 기록된 두 시점 사이를 직선으로 이어 계산한 값입니다(실제 이동 경로는 그 사이에서 다를 수 있음). 속력은 기록 구간의 거리를 시간으로 나눈 km/h이며 기록 간격이 클수록 짧은 급가속을 놓칩니다. 화면 밖이거나 ‘동작 줄이기’ 설정이면 재생하지 않습니다.</Hint>
      </ControlGroup>
      {stats.length > 0 && <ControlGroup title="개체별 요약"><table className="stat-table"><thead><tr><th scope="col">개체</th><th scope="col">이동 거리</th><th scope="col">평균 속력</th></tr></thead><tbody>{stats.map((r) => <tr key={r[0]}><th scope="row">{r[0]}</th><td>{r[1]}</td><td>{r[2]}</td></tr>)}</tbody></table></ControlGroup>}
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams} resolved={resolved} /></ControlGroup>
    </>
  )
}

export const trajectoryModule: VizModule<TrajParams> = {
  roles: [{ key: 'entity', label: '개체', type: 'category', required: true, prefer: '개체|id|name' }, { key: 'time', label: '시각', type: 'date', required: true, prefer: '시각|time' }, latRole(), lonRole()],
  datasets: ['gps-tracks'],
  defaultParams: { ...geoDefaults, t: 0.35, playing: true, rate: 0.8, trailMin: 90, showPaths: true, colorBy: 'entity' },
  Chart: TrajectoryChart,
  Controls: TrajectoryControls,
  hint: '재생 버튼과 시간 슬라이더로 이동을 따라가 보세요 · 꼬리 길이와 재생 속도 조절 · 속력으로 색칠',
}

// ─── Tissot's indicatrix ────────────────────────────────────────────────────────────

type TissotProj = 'mercator' | 'equirectangular' | 'equal-earth' | 'natural-earth' | 'azimuthal-equal-area' | 'stereographic' | 'conic-equal-area'
const TISSOT: Record<TissotProj, { name: string; note: string; make: () => d3.GeoProjection }> = {
  mercator: { name: '메르카토르', note: '정각(각도 보존) 투영: 지시도는 항상 원이지만 고위도로 갈수록 크게 부풀어 면적이 왜곡됩니다.', make: () => d3.geoMercator() },
  equirectangular: { name: '등장방형 (플레이트 카레)', note: '경위도를 그대로 직교 좌표로 쓰는 투영: 적도에서만 원이고, 고위도에서는 가로로 늘어난 타원이 됩니다.', make: () => d3.geoEquirectangular() },
  'equal-earth': { name: '이퀄 어스', note: '정적(면적 보존) 투영: 면적은 모두 같지만 가장자리로 갈수록 타원으로 일그러져 모양이 왜곡됩니다.', make: () => d3.geoEqualEarth() },
  'natural-earth': { name: '내추럴 어스', note: '절충 투영: 면적과 모양 모두 조금씩 왜곡합니다.', make: () => d3.geoNaturalEarth1() },
  'azimuthal-equal-area': { name: '방위 정적 (램버트)', note: '중심에서 멀어질수록 모양이 늘어나지만 면적은 보존합니다.', make: () => d3.geoAzimuthalEqualArea() },
  stereographic: { name: '평사 (스테레오그래픽)', note: '정각 투영: 지시도는 원이지만 중심에서 멀어질수록 크게 부풀어 오릅니다.', make: () => d3.geoStereographic().clipAngle(120) },
  'conic-equal-area': { name: '알버스 원뿔 정적', note: '두 표준 위도 사이에서 왜곡이 작은 정적 원뿔 투영입니다.', make: () => d3.geoConicEqualArea().parallels([20, 50]) },
}

export interface TissotParams { projection: TissotProj; colorBy: 'area' | 'angle'; showMap: boolean; showGraticule: boolean; center: number }

function TissotChart({ table, mapping, params, width, height, compact }: ChartProps<TissotParams>) {
  const li = columnIndex(table, roleColumn(mapping, 'lat')), oi = columnIndex(table, roleColumn(mapping, 'lon')), ri = columnIndex(table, roleColumn(mapping, 'radius'))
  const circles = useMemo(() => {
    const out: { row: number; lat: number; lon: number; km: number }[] = []
    if (li < 0 || oi < 0 || ri < 0) return out
    table.rows.forEach((r, row) => { const lat = toNumber(r[li]), lon = toNumber(r[oi]), km = toNumber(r[ri]); if (lat != null && lon != null && km != null && km > 0 && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) out.push({ row, lat, lon, km }) })
    return out
  }, [table, li, oi, ri])
  const def = TISSOT[params.projection]
  const projection = useMemo(() => {
    const p = def.make()
    if (params.projection === 'conic-equal-area') p.rotate([-params.center, 0])
    else if (params.projection !== 'stereographic' && params.projection !== 'azimuthal-equal-area') p.rotate([-params.center, 0])
    else p.rotate([-params.center, -30])
    p.fitExtent([[10, 10], [width - 10, height - 10]], { type: 'Sphere' } as never)
    return p
  }, [def, params.projection, params.center, width, height])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const world = useMemo(() => getMap('world'), [])
  const rows = useMemo(() => circles.map((c) => {
    const ring = geodesicCircle(c.lon, c.lat, c.km, 48).map(([lo, la]) => project(projection, lo, la))
    const m = projectionDistortion(projection, c.lon, c.lat)
    return { c, d: ring.every(Boolean) ? `M${(ring as [number, number][]).map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('L')}Z` : null, m }
  }).filter((x) => x.d && x.m), [circles, projection])
  const dets = rows.map((r) => r.m!.det).sort(d3.ascending)
  const ref = dets.length ? d3.quantile(dets, 0.5)! : 1
  const pathGen = d3.geoPath(projection)
  const graticule = useMemo(() => d3.geoGraticule10(), [])
  const aMax = Math.max(2, d3.max(rows, (r) => r.m!.det / ref) ?? 1), oMax = Math.max(10, d3.max(rows, (r) => r.m!.omega) ?? 10)
  const fillOf = (r: (typeof rows)[number]) => (params.colorBy === 'area' ? d3.interpolateRdBu(1 - Math.min(1, Math.max(0, 0.5 + 0.5 * Math.log2(r.m!.det / ref) / Math.log2(Math.max(2, aMax))))) : d3.interpolateYlOrRd(Math.min(1, r.m!.omega / oMax)))
  if (!circles.length) return <ChartMessage>위도, 경도, 반경(km) 열을 선택하세요. 유효한 행이 없습니다.</ChartMessage>
  const maxArea = d3.max(rows, (r) => r.m!.det / ref) ?? 1, minArea = d3.min(rows, (r) => r.m!.det / ref) ?? 1
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`티소 지시도: ${def.name}, 면적 배율 ${minArea.toFixed(2)}–${maxArea.toFixed(2)}`} onPointerLeave={hide}>
        <path d={pathGen({ type: 'Sphere' }) ?? ''} fill="#fbfcfc" stroke="#cfd6d3" />
        {params.showGraticule && <path d={pathGen(graticule) ?? ''} fill="none" stroke="#e4e9e7" strokeWidth={0.7} />}
        {params.showMap && <path d={pathGen(world.collection) ?? ''} fill="#eef1f0" stroke="#cdd5d2" strokeWidth={0.5} />}
        {rows.map((r) => (
          <path key={r.c.row} data-testid="tissot-circle" data-area={(r.m!.det / ref).toFixed(3)} data-omega={r.m!.omega.toFixed(2)} d={r.d!} fill={fillOf(r)} fillOpacity={0.72} stroke="#374151" strokeWidth={0.8}
            onPointerMove={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>{fmt(r.c.lat, 0)}°, {fmt(r.c.lon, 0)}°</b><br />면적 배율 <b>{(r.m!.det / ref).toFixed(2)}×</b> (중앙값 대비)<br />최대 각 왜곡 {r.m!.omega.toFixed(1)}°<br />주축 척도 {r.m!.s1.toFixed(3)} / {r.m!.s2.toFixed(3)} px/km</>) }} onPointerLeave={hide} />
        ))}
      </svg>
      {!compact && (<>
        <Readout items={[{ label: '투영', value: def.name }, { label: '면적 배율', value: `${minArea.toFixed(2)} – ${maxArea.toFixed(2)}×` }, { label: '최대 각 왜곡', value: `${(d3.max(rows, (r) => r.m!.omega) ?? 0).toFixed(1)}°` }]} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

function TissotControls({ params, setParams }: ControlsProps<TissotParams>) {
  const def = TISSOT[params.projection]
  return (
    <>
      <ControlGroup title="투영법">
        <Select label="투영법" value={params.projection} onChange={(projection) => setParams({ projection })} testId="ctl-tissot-proj" options={(Object.keys(TISSOT) as TissotProj[]).map((k) => ({ value: k, label: TISSOT[k].name }))} />
        <Hint>{def.note}</Hint>
        <Slider label="중심 경도" value={params.center} min={-180} max={180} step={5} onChange={(center) => setParams({ center })} format={(v) => `${v}°`} testId="ctl-tissot-center" />
        <Segmented label="색" value={params.colorBy} onChange={(colorBy) => setParams({ colorBy })} testId="ctl-tissot-color" options={[{ value: 'area', label: '면적 배율' }, { value: 'angle', label: '각 왜곡' }]} />
        <Toggle label="대륙 윤곽" checked={params.showMap} onChange={(showMap) => setParams({ showMap })} />
        <Toggle label="경위선" checked={params.showGraticule} onChange={(showGraticule) => setParams({ showGraticule })} />
      </ControlGroup>
      <ControlGroup title="읽는 법" defaultOpen={false}>
        <Hint>지구 위에서는 모든 원의 반지름(600 km)이 같습니다. 지도에서 원이 커지면 면적이 부풀었다는 뜻이고(정적 투영은 모두 같은 넓이), 타원이 되면 모양이 일그러졌다는 뜻입니다(정각 투영은 항상 원). 면적 배율은 지시도 중앙값 대비이고, 각 왜곡은 한 점에서 길이 척도의 최댓값과 최솟값의 차이로 계산한 최대 각도 변화입니다. 어떤 투영도 면적·모양·거리를 모두 보존하지 못합니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const tissotModule: VizModule<TissotParams> = {
  roles: [latRole(), lonRole(), { key: 'radius', label: '반경 (km)', type: 'number', required: true, prefer: '반경|radius' }],
  datasets: ['tissot-grid'],
  defaultParams: { projection: 'mercator', colorBy: 'area', showMap: true, showGraticule: true, center: 0 },
  Chart: TissotChart,
  Controls: TissotControls,
  hint: '투영법을 바꿔 같은 크기의 원이 어떻게 부풀고 일그러지는지 확인 · 중심 경도를 돌려 보세요 · 원에 포인터를 올리면 배율과 왜곡',
}

void planarKm
void ROAD_SPEEDS
