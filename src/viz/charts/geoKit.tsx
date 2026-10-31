import * as d3 from 'd3'
import type { Feature, Polygon } from 'geojson'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { columnIndex, toLabel, toNumber, type DataTable } from '../../data/table'
import { MapZoomButtons, useMapZoom, type MapTransform } from '../../geo/useMapZoom'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { getMap } from '../../geo/maps'
import { hillsHeight, idwAt, makeGrid, padBox, type BBox, type Grid, type Hill } from '../../stats/spatial'
import { roleColumn } from '../mapping'
import type { Mapping, RoleSpec } from '../types'
import { latRole, lonRole, resolvePointMap, useProjection, type GeoParams, type Resolved } from './geoShared'

/** Shared building blocks of the v0.5 map charts: raster painting under an SVG map, and the terrain / interpolated-surface model. */

/** ABGR packed pixel for a Uint32Array view of ImageData. */
export const pack = (r: number, g: number, b: number, a = 255) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0

export function colorRamp(interpolate: (t: number) => string, n = 256): Uint32Array {
  const out = new Uint32Array(n)
  for (let i = 0; i < n; i++) { const c = d3.rgb(interpolate(i / (n - 1))); out[i] = pack(Math.round(c.r), Math.round(c.g), Math.round(c.b)) }
  return out
}

export function packColor(css: string, alpha = 255): number {
  const c = d3.rgb(css)
  return pack(Math.round(c.r), Math.round(c.g), Math.round(c.b), alpha)
}

/**
 * Paints a lon/lat field onto a canvas laid under an SVG map: every pixel is mapped back to longitude/latitude through the projection's inverse
 * and handed to `paint`, which returns a packed color (0 = transparent). The result can be clipped to a shape (e.g. the coastline).
 * Zoom is a CSS transform of the finished bitmap, so panning stays cheap.
 */
export function RasterCanvas({ projection, width, height, paint, clip, t, scale = 1 }: {
  projection: d3.GeoProjection
  width: number
  height: number
  paint: (lon: number, lat: number) => number
  clip?: d3.GeoPermissibleObjects
  t?: MapTransform
  scale?: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv || width < 2 || height < 2) return
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale))
    cv.width = w
    cv.height = h
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const off = document.createElement('canvas')
    off.width = w
    off.height = h
    const octx = off.getContext('2d')
    if (!octx) return
    const img = octx.createImageData(w, h)
    const buf = new Uint32Array(img.data.buffer)
    const inv = projection.invert
    if (inv) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const ll = inv([(x + 0.5) / scale, (y + 0.5) / scale])
        if (ll && Number.isFinite(ll[0]) && Number.isFinite(ll[1]) && Math.abs(ll[1]) <= 90) buf[y * w + x] = paint(ll[0], ll[1])
      }
    }
    octx.putImageData(img, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.save()
    if (clip) {
      ctx.scale(scale, scale)
      ctx.beginPath()
      d3.geoPath(projection, ctx)(clip)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clip()
    }
    ctx.drawImage(off, 0, 0)
    ctx.restore()
  }, [projection, width, height, paint, clip, scale])
  const k = t?.k ?? 1
  return <canvas ref={ref} className="raster-canvas" data-testid="raster-canvas" aria-hidden="true" style={{ width, height, transform: `translate(${t?.x ?? 0}px,${t?.y ?? 0}px) scale(${k})` }} />
}

/** Pixel resolution factor: thumbnails and very large stages are painted at lower resolution. */
export const rasterScale = (width: number, height: number, compact?: boolean) => (compact ? 0.5 : width * height > 520000 ? 0.6 : 1)

/** The box as a d3 polygon (d3-geo wants clockwise exterior rings; a counter-clockwise ring would mean the whole sphere outside the box). */
export const boxFeature = (b: BBox): Feature<Polygon> => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[b.west, b.south], [b.west, b.north], [b.east, b.north], [b.east, b.south], [b.west, b.south]]] } })

// ─── surface model: Gaussian hills or interpolated samples ──────────────────────────

export interface SurfaceParams extends GeoParams {
  /** Grid nodes east–west. */
  gridSize: number
  /** Fractal roughness added to Gaussian hills (metres). */
  roughness: number
  seed: number
  /** IDW distance exponent for sample points. */
  power: number
}

export const surfaceDefaults: SurfaceParams = { map: 'auto', projection: 'auto', customGeo: '', gridSize: 150, roughness: 70, seed: 3, power: 2 }

export const surfaceRoles = (valueLabel = '높이 또는 값'): RoleSpec[] => [
  latRole(),
  lonRole(),
  { key: 'value', label: valueLabel, type: 'number', required: true, prefer: '높이|값|value|height' },
  { key: 'radius', label: '반경 km (있으면 가우시안 언덕)', type: 'number', prefer: '반경|radius' },
]

export interface SurfacePoint { row: number; lat: number; lon: number; value: number; radius: number | null; label: string }

export function readSurfacePoints(table: DataTable, mapping: Mapping): SurfacePoint[] {
  const li = columnIndex(table, roleColumn(mapping, 'lat'))
  const oi = columnIndex(table, roleColumn(mapping, 'lon'))
  const vi = columnIndex(table, roleColumn(mapping, 'value'))
  const ri = columnIndex(table, roleColumn(mapping, 'radius'))
  const ni = table.columns.findIndex((c) => c.type === 'category')
  const out: SurfacePoint[] = []
  if (li < 0 || oi < 0 || vi < 0) return out
  table.rows.forEach((r, row) => {
    const lat = toNumber(r[li]), lon = toNumber(r[oi]), value = toNumber(r[vi])
    if (lat == null || lon == null || value == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return
    const rad = ri >= 0 ? toNumber(r[ri]) : null
    out.push({ row, lat, lon, value, radius: rad != null && rad > 0 ? rad : null, label: ni >= 0 ? toLabel(r[ni]) : '' })
  })
  return out
}

/** The lon/lat box a raster layer covers: the whole Korea map when that map is shown, otherwise the data extent padded by `pad`. */
export function boxFor(resolved: Resolved, points: readonly { lon: number; lat: number }[], pad = 0.12): BBox {
  if (resolved.id === 'korea') { const [[w, s], [e, n]] = d3.geoBounds(getMap('korea').collection); return { west: w, east: e, south: s, north: n } }
  return padBox(points, pad)
}

export interface Surface {
  grid: Grid
  box: BBox
  model: 'hills' | 'idw'
  at: (lon: number, lat: number) => number
  points: SurfacePoint[]
  resolved: Resolved
}

/**
 * The scalar surface behind terrain-style charts. With a radius column the rows are Gaussian hills (a synthetic terrain); without one they are
 * measurement points interpolated by inverse-distance weighting. The grid covers the Korea map when that map is used, otherwise the padded data extent.
 */
export function useSurface(table: DataTable, mapping: Mapping, params: SurfaceParams, compact?: boolean): Surface {
  const points = useMemo(() => readSurfacePoints(table, mapping), [table, mapping])
  const resolved = useMemo(() => resolvePointMap(params, points), [params, points])
  return useMemo(() => {
    if (!points.length) {
      const box = { west: 125, east: 130, south: 33, north: 38 }
      return { grid: makeGrid(box, 2, 2, () => 0), box, model: 'idw' as const, at: () => 0, points, resolved }
    }
    const hillsMode = points.length > 0 && points.every((p) => p.radius != null)
    const maxR = d3.max(points, (p) => p.radius ?? 0) ?? 0
    const box = boxFor(resolved, points, 0.12 + (hillsMode ? maxR / 400 : 0))
    const nx = Math.max(24, Math.round((compact ? 0.5 : 1) * params.gridSize))
    const ny = Math.max(24, Math.round((nx * (box.north - box.south)) / ((box.east - box.west) * Math.cos((((box.north + box.south) / 2) * Math.PI) / 180))))
    let at: (lon: number, lat: number) => number
    if (hillsMode) {
      const hills: Hill[] = points.map((p) => ({ lon: p.lon, lat: p.lat, height: p.value, radiusKm: p.radius! }))
      at = hillsHeight(hills, params.roughness, params.seed)
    } else {
      const samples = points.map((p) => ({ lon: p.lon, lat: p.lat, value: p.value }))
      at = (lon, lat) => idwAt(samples, lon, lat, params.power, 10)
    }
    const grid = makeGrid(box, nx, ny, at)
    return { grid, box, model: hillsMode ? 'hills' as const : 'idw' as const, at, points, resolved }
  }, [points, resolved, params.gridSize, params.roughness, params.seed, params.power, compact])
}

/** Projection fitted to the surface box (so the raster fills the stage) for a given map choice. */
export function useSurfaceProjection(s: Pick<Surface, 'box' | 'resolved'>, params: GeoParams, width: number, height: number) {
  const target = useMemo(() => boxFeature(s.box), [s.box])
  return useProjection(s.resolved.map, params, width, height, s.resolved.id, target as never, 10)
}

export interface StageContext { projection: d3.GeoProjection; k: number; svg: SVGSVGElement | null; t: MapTransform }

/**
 * A zoomable map stage with a raster layer: canvas below, SVG above (outline + whatever `overlay` draws), a hover readout and zoom buttons.
 * `info` turns the position under the pointer into tooltip content.
 */
export function SurfaceStage({ width, height, compact, params, surface, paint, overlay, legend, label, info, drawMap = true, extra, onSvgPointerDown }: {
  width: number
  height: number
  compact?: boolean
  params: GeoParams
  surface: Pick<Surface, 'box' | 'resolved' | 'points'>
  paint: (lon: number, lat: number) => number
  overlay?: (c: StageContext) => ReactNode
  legend?: ReactNode
  label: string
  info?: (lon: number, lat: number) => ReactNode
  drawMap?: boolean
  extra?: ReactNode
  onSvgPointerDown?: (e: React.PointerEvent<SVGSVGElement>, c: StageContext) => void
}) {
  const projection = useSurfaceProjection(surface, params, width, height)
  const svgRef = useRef<SVGSVGElement>(null)
  const zoom = useMapZoom(svgRef, { enabled: !compact, width, height })
  const { tip, show, hide } = useTooltip()
  const clip = surface.resolved.map.collection
  const outline = useMemo(() => d3.geoPath(projection)(clip) ?? '', [projection, clip])
  const ctx: StageContext = { projection, k: zoom.t.k, svg: svgRef.current, t: zoom.t }
  if (!surface.points.length) return <ChartMessage>위도·경도·값 열에 쓸 수 있는 행이 없습니다.</ChartMessage>
  return (
    <div className="chart-root">
      <RasterCanvas projection={projection} width={width} height={height} paint={paint} clip={clip} t={zoom.t} scale={rasterScale(width, height, compact)} />
      <svg ref={svgRef} width={width} height={height} className="chart-svg map-svg" role="img" data-testid="chart-svg" aria-label={label}
        onPointerDown={onSvgPointerDown ? (e) => onSvgPointerDown(e, { ...ctx, svg: svgRef.current }) : undefined}
        onPointerMove={compact || !info ? undefined : (e) => {
          const p = localPoint(svgRef.current!, e)
          const ll = projection.invert?.([(p.x - zoom.t.x) / zoom.t.k, (p.y - zoom.t.y) / zoom.t.k])
          if (!ll || !Number.isFinite(ll[0])) { hide(); return }
          const c = info(ll[0], ll[1])
          if (c) show(p.x, p.y, c); else hide()
        }}
        onPointerLeave={hide}>
        <rect className="map-frame" x={0.5} y={0.5} width={Math.max(0, width - 1)} height={Math.max(0, height - 1)} fill="none" stroke="#e1e6e4" pointerEvents="none" />
        <g transform={`translate(${zoom.t.x},${zoom.t.y}) scale(${zoom.t.k})`}>
          {drawMap && <path className="map-outline" d={outline} fill="none" stroke="#2b3532" strokeOpacity={0.55} strokeWidth={0.8} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
          {overlay?.({ ...ctx, svg: svgRef.current })}
        </g>
      </svg>
      {!compact && (<>{legend}{extra}<MapZoomButtons zoom={zoom} k={zoom.t.k} /><Tooltip tip={tip} width={width} /></>)}
    </div>
  )
}

/** Horizontal color-ramp legend. */
export function RampLegend({ interpolate, min, max, unit = '', label }: { interpolate: (t: number) => string; min: string; max: string; unit?: string; label?: string }) {
  return (
    <div className="color-legend">
      {label && <span>{label}</span>}<span>{min}{unit}</span>
      <span className="color-ramp" style={{ background: `linear-gradient(90deg, ${d3.range(0, 1.01, 0.1).map((v) => interpolate(v)).join(',')})` }} />
      <span>{max}{unit}</span>
    </div>
  )
}

export const hypsometric = d3.interpolateRgbBasis(['#4f8a5b', '#9fb56a', '#e3d18c', '#c9a46a', '#9b7653', '#f1eee8'])

/** Compass dial for the light direction: drag the dot to set azimuth (angle around the dial) and altitude (distance from the rim). */
export function SunDial({ azimuth, altitude, onChange }: { azimuth: number; altitude: number; onChange: (azimuth: number, altitude: number) => void }) {
  const R = 38
  const ref = useRef<SVGSVGElement>(null)
  const set = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect()
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2)
    const az = (((Math.atan2(dx, -dy) * 180) / Math.PI) % 360 + 360) % 360
    const alt = Math.max(5, Math.min(90, 90 * (1 - Math.min(1, Math.hypot(dx, dy) / R))))
    onChange(Math.round(az), Math.round(alt))
  }
  const az = (azimuth * Math.PI) / 180, rad = R * (1 - altitude / 90)
  return (
    <svg ref={ref} className="sun-dial" width={96} height={96} viewBox="-48 -48 96 96" role="img" aria-label={`광원 방위각 ${azimuth}도, 고도각 ${altitude}도`} data-testid="sun-dial"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); set(e) }} onPointerMove={(e) => { if (e.buttons) set(e) }}>
      <circle r={R} fill="#fff" fillOpacity={0.92} stroke="#cfd6d3" />
      <circle r={R / 2} fill="none" stroke="#e1e6e4" />
      <text y={-R - 4} textAnchor="middle" fontSize={10} fill="#6b7773">북</text>
      <line x1={0} y1={0} x2={Math.sin(az) * rad} y2={-Math.cos(az) * rad} stroke="#e8a33d" strokeWidth={1.5} />
      <circle cx={Math.sin(az) * rad} cy={-Math.cos(az) * rad} r={7} fill="#f6c453" stroke="#b07b12" strokeWidth={1.5} data-testid="sun-handle" style={{ cursor: 'grab' }} />
    </svg>
  )
}

export interface DotSpec { x: number; y: number; r: number; color: string; row: number }

/**
 * Draws many dots on a canvas laid over the SVG map (SVG elements become slow past a few thousand). `t` is the map zoom; dots keep their
 * screen size, so only positions are transformed.
 */
export function DotCanvas({ dots, width, height, t, opacity = 0.75 }: { dots: readonly DotSpec[]; width: number; height: number; t: MapTransform; opacity?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const dpr = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)
    cv.width = Math.round(width * dpr)
    cv.height = Math.round(height * dpr)
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.globalAlpha = opacity
    let last = ''
    for (const d of dots) {
      const x = d.x * t.k + t.x, y = d.y * t.k + t.y
      if (x < -6 || y < -6 || x > width + 6 || y > height + 6) continue
      if (d.color !== last) { ctx.fillStyle = d.color; last = d.color }
      ctx.beginPath()
      ctx.arc(x, y, d.r, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [dots, width, height, t, opacity])
  return <canvas ref={ref} className="dot-canvas" data-testid="dot-canvas" aria-hidden="true" style={{ width, height }} />
}
