import * as d3 from 'd3'
import { RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { ChartMessage, Legend, Readout, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Select, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, toTime, type DataTable } from '../../data/table'
import { polygons } from '../../geo/geojson'
import { categoryColor, schemes, type ColorScheme } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { formatTime } from '../../stats/datetime'
import { groundPlane } from '../../stats/geometry'
import { gridExtent, hillshade, KM_PER_DEG, sampleGrid } from '../../stats/spatial'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'
import { colorRamp, hypsometric, readSurfacePoints, surfaceDefaults, surfaceRoles, useSurface, type SurfaceParams } from './geoKit'
import { GeoControls, geoDefaults, latRole, lonRole, resolveMap, resolvePointMap, type GeoParams } from './geoShared'
import { boxEdges, drawQuads, isBackEdge, makeProjector, useOrbit, type Quad, type V3, type View3 } from './scene3d'
import { projectedShapes, regionRows, useRegionStage } from './regionKit'

/** 3D maps drawn with the in-house orbit camera: terrain mesh, prism (extruded region) map and the space-time cube. */

type ViewParams = { yaw: number; pitch: number; zoom: number }
const viewOf = (p: ViewParams): View3 => ({ yaw: p.yaw, pitch: p.pitch, zoom: p.zoom })
const seq = (Object.keys(schemes) as ColorScheme[]).filter((k) => !schemes[k].diverging).map((k) => ({ value: k, label: schemes[k].name }))

function ViewControls<P extends ViewParams>({ params, setParams }: { params: P; setParams: (p: Partial<P>) => void }) {
  return (
    <ControlGroup title="시점">
      <Slider label="회전 (방위)" value={params.yaw} min={-180} max={180} onChange={(yaw) => setParams({ yaw } as Partial<P>)} format={(v) => `${v}°`} testId="ctl-yaw" />
      <Slider label="기울기 (고도)" value={params.pitch} min={5} max={89} onChange={(pitch) => setParams({ pitch } as Partial<P>)} format={(v) => `${v}°`} testId="ctl-pitch" />
      <Slider label="확대" value={params.zoom} min={0.5} max={3} step={0.05} onChange={(zoom) => setParams({ zoom } as Partial<P>)} format={(v) => `${v.toFixed(2)}×`} testId="ctl-zoom3d" />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ yaw: -30, pitch: 38, zoom: 1 } as unknown as Partial<P>)} data-testid="view-reset"><RotateCcw size={14} aria-hidden="true" />시점 초기화</button>
      <Hint>화면을 끌어 돌리고, 휠로 확대합니다. 방향키로 조금씩 돌릴 수 있고 +/−로 확대·축소합니다.</Hint>
    </ControlGroup>
  )
}

/** Cube wireframe plus labelled corners, drawn in SVG above the 3D canvas. */
function Frame3D({ proj, box, labels }: { proj: ReturnType<typeof makeProjector>; box: { x: [number, number]; y: [number, number]; z: [number, number] }; labels?: { at: V3; text: string; anchor?: 'start' | 'middle' | 'end' }[] }) {
  const edges = boxEdges(box)
  const centre = proj([(box.x[0] + box.x[1]) / 2, (box.y[0] + box.y[1]) / 2, (box.z[0] + box.z[1]) / 2]).depth
  return (
    <g pointerEvents="none" aria-hidden="true">
      {edges.map(([a, b], i) => { const pa = proj(a), pb = proj(b); const back = isBackEdge(proj, a, b, centre); return <line key={i} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke={back ? '#d5dbd9' : '#8a9692'} strokeWidth={back ? 0.8 : 1.2} strokeDasharray={back ? '3 3' : undefined} /> })}
      {labels?.map((l) => { const p = proj(l.at); return <text key={l.text} x={p.x} y={p.y} fontSize={11} fill="#4b5563" textAnchor={l.anchor ?? 'middle'} stroke="#fff" strokeWidth={3} paintOrder="stroke">{l.text}</text> })}
    </g>
  )
}

const canvasFor = (ref: React.RefObject<HTMLCanvasElement | null>, width: number, height: number) => {
  const cv = ref.current
  if (!cv) return null
  const dpr = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)
  cv.width = Math.round(width * dpr)
  cv.height = Math.round(height * dpr)
  const ctx = cv.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  return ctx
}

// ─── 3D terrain ─────────────────────────────────────────────────────────────────────

export interface Terrain3dParams extends SurfaceParams, ViewParams { mesh: number; exag: number; tint: boolean; wire: boolean; azimuth: number; altitude: number }

function Terrain3dChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<Terrain3dParams>) {
  const s = useSurface(table, mapping, params, compact)
  const cvRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  useOrbit(boxRef, viewOf(params), (v) => setParams(v), !compact)
  const [lo, hi] = useMemo(() => gridExtent(s.grid), [s.grid])
  const shade = useMemo(() => hillshade(s.grid, params.azimuth, params.altitude, params.exag / 3), [s.grid, params.azimuth, params.altitude, params.exag])
  const ramp = useMemo(() => colorRamp(hypsometric), [])
  const geo = useMemo(() => {
    const { west, east, south, north } = s.box
    const lat0 = (south + north) / 2
    const W = (east - west) * Math.cos((lat0 * Math.PI) / 180) * KM_PER_DEG, H = (north - south) * KM_PER_DEG
    const L = Math.max(W, H) / 2
    return { west, east, south, north, w: W / L / 2, h: H / L / 2, L }
  }, [s.box])
  const m = compact ? Math.max(16, Math.round(params.mesh * 0.4)) : params.mesh
  const zUnit = (v: number) => (((v - lo) / 1000) * params.exag) / geo.L
  const zTop = zUnit(hi)
  const view = viewOf(params)
  const proj = useMemo(() => makeProjector(view, width, height), [view.yaw, view.pitch, view.zoom, width, height]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const ctx = canvasFor(cvRef, width, height)
    if (!ctx || !s.points.length) return
    const nx = m, ny = Math.max(8, Math.round((m * geo.h) / geo.w))
    // land mask: the map's polygons rasterised once onto an nx × ny bitmap, so the mesh takes the shape of the coastline instead of a rectangle
    const mask = (() => {
      const cv = document.createElement('canvas')
      cv.width = nx; cv.height = ny
      const c2 = cv.getContext('2d')
      if (!c2) return null
      const tr = d3.geoTransform({ point(lo: number, la: number) { this.stream.point(((lo - geo.west) / (geo.east - geo.west)) * (nx - 1), ((geo.north - la) / (geo.north - geo.south)) * (ny - 1)) } })
      c2.fillStyle = '#000'
      c2.beginPath()
      d3.geoPath(tr, c2)(s.resolved.map.collection)
      c2.fill()
      const data = c2.getImageData(0, 0, nx, ny).data
      return (i: number, j: number) => data[(((ny - 1 - j) * nx) + i) * 4 + 3] > 40
    })()
    const P: V3[][] = [], C: string[][] = []
    for (let j = 0; j < ny; j++) { P.push([]); C.push([]) }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const lon = geo.west + (i / (nx - 1)) * (geo.east - geo.west), lat = geo.south + (j / (ny - 1)) * (geo.north - geo.south)
      const h = sampleGrid(s.grid, lon, lat)
      const sh = sampleGrid(shade, lon, lat)
      P[j].push([-geo.w + (i / (nx - 1)) * 2 * geo.w, -geo.h + (j / (ny - 1)) * 2 * geo.h, zUnit(Number.isFinite(h) ? h : lo)])
      const base = params.tint ? d3.rgb(d3.color(hypsometric((Math.max(lo, Math.min(hi, h)) - lo) / (hi - lo || 1)))!) : d3.rgb(235, 238, 237)
      const k = 0.25 + 0.75 * (Number.isFinite(sh) ? sh : 0.5)
      C[j].push(`rgb(${Math.round(base.r * k)},${Math.round(base.g * k)},${Math.round(base.b * k)})`)
    }
    void ramp
    const quads: Quad[] = []
    for (let j = 0; j + 1 < ny; j++) for (let i = 0; i + 1 < nx; i++) {
      if (mask && !(mask(i, j) || mask(i + 1, j) || mask(i, j + 1) || mask(i + 1, j + 1))) continue
      const a = proj(P[j][i]), b = proj(P[j][i + 1]), c = proj(P[j + 1][i + 1]), d = proj(P[j + 1][i])
      quads.push({ pts: [[a.x, a.y], [b.x, b.y], [c.x, c.y], [d.x, d.y]], depth: (a.depth + b.depth + c.depth + d.depth) / 4, fill: C[j][i], stroke: params.wire ? 'rgba(30,40,38,.35)' : C[j][i] })
    }
    drawQuads(ctx, quads, params.wire ? 0.5 : 0.7)
  }, [s.grid, shade, proj, m, params.tint, params.wire, params.exag, width, height]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!s.points.length) return <ChartMessage>위도·경도·높이(숫자형) 열에 쓸 수 있는 행이 없습니다.</ChartMessage>
  const box = { x: [-geo.w, geo.w] as [number, number], y: [-geo.h, geo.h] as [number, number], z: [0, Math.max(0.05, zTop)] as [number, number] }
  return (
    <div className="chart-root">
      <div ref={boxRef} className="orbit-box" tabIndex={compact ? -1 : 0} style={{ width, height }} aria-label="3차원 지형: 끌어서 회전, 휠로 확대">
        <canvas ref={cvRef} className="canvas3d" data-testid="canvas3d" style={{ width, height }} aria-hidden="true" />
        <svg width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`3차원 지형 지도: 방위 ${params.yaw}도, 기울기 ${params.pitch}도`} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          <Frame3D proj={proj} box={box} labels={compact ? [] : [{ at: [-geo.w, -geo.h, 0], text: `${s.box.west.toFixed(1)}°E ${s.box.south.toFixed(1)}°N`, anchor: 'end' }, { at: [geo.w, geo.h, 0], text: `${s.box.east.toFixed(1)}°E ${s.box.north.toFixed(1)}°N`, anchor: 'start' }, { at: [geo.w, -geo.h, zTop], text: `${fmt(hi, 0)}`, anchor: 'start' }, { at: [geo.w, -geo.h, 0], text: `${fmt(lo, 0)}`, anchor: 'start' }]} />
        </svg>
      </div>
      {!compact && <Readout items={[{ label: '메시', value: `${m}×${Math.round((m * geo.h) / geo.w)}` }, { label: '수직 과장', value: `${params.exag}×` }, { label: '높이', value: `${fmt(lo, 0)}–${fmt(hi, 0)}` }]} />}
    </div>
  )
}

function Terrain3dControls(props: ControlsProps<Terrain3dParams>) {
  const { params, setParams, table, mapping } = props
  const pts = useMemo(() => readSurfacePoints(table, mapping), [table, mapping])
  const resolved = useMemo(() => resolvePointMap(params, pts), [params, pts])
  return (
    <>
      <ViewControls params={params} setParams={setParams} />
      <ControlGroup title="지형">
        <Slider label="수직 과장" value={params.exag} min={1} max={80} onChange={(exag) => setParams({ exag })} format={(v) => `${v}×`} testId="ctl-exag" />
        <Slider label="메시 해상도 (가로 칸)" value={params.mesh} min={20} max={130} step={5} onChange={(mesh) => setParams({ mesh })} testId="ctl-mesh" />
        <Toggle label="높이 색" checked={params.tint} onChange={(tint) => setParams({ tint })} />
        <Toggle label="격자선" checked={params.wire} onChange={(wire) => setParams({ wire })} />
        <Slider label="광원 방위각" value={params.azimuth} min={0} max={359} onChange={(azimuth) => setParams({ azimuth })} format={(v) => `${v}°`} />
        <Hint>고도 격자를 사각형 조각으로 나누어 높이만큼 띄우고, 먼 조각부터 그리는 화가 알고리즘으로 가려짐을 처리합니다. 수직 과장은 시각 효과일 뿐 실제 경사가 아닙니다. 합성 지형(가우시안 언덕 모형)이므로 실제 지형이 아닙니다.</Hint>
      </ControlGroup>
      <ControlGroup title="표면 모델" defaultOpen={false}>
        <Slider label="격자 해상도" value={params.gridSize} min={40} max={200} step={10} onChange={(gridSize) => setParams({ gridSize })} />
        <Slider label="거칠기 (m)" value={params.roughness} min={0} max={250} step={5} onChange={(roughness) => setParams({ roughness })} />
        <GeoControls params={params} setParams={setParams} resolved={resolved} />
      </ControlGroup>
    </>
  )
}

export const terrain3dModule: VizModule<Terrain3dParams> = {
  roles: surfaceRoles('높이 (m)'),
  datasets: ['terrain-hills', 'temp-stations'],
  defaultParams: { ...surfaceDefaults, gridSize: 120, yaw: -28, pitch: 42, zoom: 1.15, mesh: 70, exag: 22, tint: true, wire: false, azimuth: 315, altitude: 40 },
  Chart: Terrain3dChart,
  Controls: Terrain3dControls,
  hint: '끌어서 회전 · 휠로 확대 · 수직 과장과 메시 해상도 조절 · 관측점 데이터셋에서는 보간한 표면(예: 기온)을 입체로 봅니다',
}

// ─── prism map ──────────────────────────────────────────────────────────────────────

export interface PrismParams extends GeoParams, ViewParams { heightScale: number; scheme: ColorScheme; colorBy: 'value' | 'single'; walls: boolean; selected: string }

function PrismChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<PrismParams>) {
  const st = useRegionStage(table, mapping, params, width, height, compact, KEY_VALUE, undefined, false)
  const { data, map, projection } = st
  const cvRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const { tip, show, hide } = useTooltip()
  useOrbit(boxRef, viewOf(params), (v) => setParams(v), !compact)
  const shapes = useMemo(() => projectedShapes(map, projection), [map, projection])
  const values = useMemo(() => map.regions.map((r) => data.get(r.id)?.values.value ?? null), [map, data])
  const vmax = d3.max(values.filter((v): v is number => v != null)) ?? 0
  const scheme = schemes[params.scheme]
  const S = Math.min(width, height) / 2
  const norm = (p: [number, number]): [number, number] => [(p[0] - width / 2) / S, -(p[1] - height / 2) / S]
  const view = viewOf(params)
  const proj = useMemo(() => makeProjector(view, width, height, 0.42), [view.yaw, view.pitch, view.zoom, width, height]) // eslint-disable-line react-hooks/exhaustive-deps
  const tops = useRef<{ id: string; path: Path2D; depth: number }[]>([])
  const H = (compact ? 0.6 : 1) * params.heightScale
  useEffect(() => {
    const ctx = canvasFor(cvRef, width, height)
    if (!ctx) return
    const groups: { depth: number; quads: Quad[]; top: Quad | null; id: string }[] = []
    shapes.forEach((sh, ri) => {
      const v = values[ri]
      const h = v != null && vmax > 0 && v > 0 ? (v / vmax) * H : 0
      const t = vmax > 0 && v != null ? v / vmax : 0
      const fill = v == null ? '#e9eeec' : params.colorBy === 'value' ? scheme.interpolate(0.15 + 0.8 * t) : '#5fa8a0'
      const quads: Quad[] = []
      let top: Quad | null = null
      let depthSum = 0, n = 0
      for (const ring of sh.rings) {
        if (ring.length < 4) continue
        const w = ring.map((p) => norm(p))
        const top3 = w.map(([x, y]) => proj([x, y, h]))
        const cd = d3.mean(top3, (p) => p.depth)!
        depthSum += cd; n++
        if (params.walls && h > 0.004 && w.length < 4000) {
          const sx = d3.mean(w, (p) => p[0])!, sy = d3.mean(w, (p) => p[1])!
          void sx; void sy
          for (let i = 0; i < w.length; i++) {
            const a = w[i], b = w[(i + 1) % w.length]
            const pa = proj([a[0], a[1], 0]), pb = proj([b[0], b[1], 0]), qa = top3[i], qb = top3[(i + 1) % w.length]
            // wall brightness from its direction against a fixed light (north-west)
            const nx = b[1] - a[1], ny = -(b[0] - a[0])
            const l = Math.hypot(nx, ny) || 1
            const lit = 0.55 + 0.35 * ((nx / l) * -0.6 + (ny / l) * 0.8)
            const c = d3.color(fill)!.darker(1.3 - lit)
            quads.push({ pts: [[pa.x, pa.y], [pb.x, pb.y], [qb.x, qb.y], [qa.x, qa.y]], depth: (pa.depth + pb.depth) / 2, fill: c.formatRgb(), stroke: c.formatRgb() })
          }
        }
        top = { pts: top3.map((p) => [p.x, p.y]), depth: cd, fill, stroke: 'rgba(255,255,255,.9)' }
        if (top) quads.push({ ...top, depth: -1e9 })
      }
      if (quads.length) groups.push({ depth: n ? depthSum / n : 0, quads, top, id: sh.id })
    })
    groups.sort((a, b) => b.depth - a.depth)
    const hit: typeof tops.current = []
    for (const g of groups) {
      // walls far to near, tops last (they carry depth -1e9 so they sort after every wall)
      g.quads.sort((a, b) => b.depth - a.depth)
      drawQuads(ctx, g.quads.slice(), 0.6)
      const rings = g.quads.filter((q) => q.depth === -1e9)
      const path = new Path2D()
      for (const q of rings) { path.moveTo(q.pts[0][0], q.pts[0][1]); for (let i = 1; i < q.pts.length; i++) path.lineTo(q.pts[i][0], q.pts[i][1]); path.closePath() }
      hit.push({ id: g.id, path, depth: g.depth })
    }
    tops.current = hit.reverse()
  }, [shapes, values, vmax, proj, H, params.colorBy, params.walls, scheme, width, height]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!roleColumn(mapping, 'region') || !roleColumn(mapping, 'value')) return <ChartMessage>지역 ID(범주형)와 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!vmax) return <ChartMessage>지도와 맞는 지역 ID에 0보다 큰 값이 없습니다.<small>ID 열이 {map.title}의 ID와 같은지 확인하세요.</small></ChartMessage>
  const box = { x: [-width / 2 / S, width / 2 / S] as [number, number], y: [-height / 2 / S, height / 2 / S] as [number, number], z: [0, H] as [number, number] }
  return (
    <div className="chart-root">
      <div ref={boxRef} className="orbit-box" tabIndex={compact ? -1 : 0} style={{ width, height }} aria-label="프리즘 지도: 끌어서 회전, 휠로 확대"
        onPointerMove={compact ? undefined : (e) => {
          if (e.buttons) { hide(); return }
          const l = localPoint(boxRef.current!, e)
          const ctx = cvRef.current?.getContext('2d')
          const dpr = cvRef.current ? cvRef.current.width / width : 1
          const hitRegion = ctx ? tops.current.find((t) => ctx.isPointInPath(t.path, l.x * dpr, l.y * dpr)) : undefined
          const r = hitRegion ? map.byId.get(hitRegion.id) : undefined
          if (r) show(l.x, l.y, <><b>{r.name}</b><br />{roleColumn(mapping, 'value')}: {fmt(data.get(r.id)?.values.value)}</>); else hide()
        }} onPointerLeave={hide}>
        <canvas ref={cvRef} className="canvas3d" data-testid="canvas3d" style={{ width, height }} aria-hidden="true" />
        <svg width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`프리즘 지도: ${map.title}, 최대 ${fmt(vmax)}`} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          <Frame3D proj={proj} box={{ ...box, z: [0, H] }} />
        </svg>
      </div>
      {!compact && (<>
        <div className="color-legend"><span>0</span><span className="color-ramp" style={{ background: `linear-gradient(90deg, ${d3.range(0, 1.01, 0.1).map((v) => scheme.interpolate(0.15 + 0.8 * v)).join(',')})` }} /><span>{fmt(vmax)}</span></div>
        <Readout items={[{ label: '지역', value: values.filter((v) => v != null).length }, { label: '최대', value: fmt(vmax) }, { label: '높이 배율', value: `${params.heightScale}` }]} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

const KEY_VALUE = ['value']

function PrismControls({ params, setParams, table, mapping }: ControlsProps<PrismParams>) {
  return (
    <>
      <ViewControls params={params} setParams={setParams} />
      <ControlGroup title="높이와 색">
        <Slider label="높이 배율" value={params.heightScale} min={0.2} max={2.5} step={0.1} onChange={(heightScale) => setParams({ heightScale })} testId="ctl-prism-h" />
        <Select label="색 기준" value={params.colorBy} onChange={(colorBy) => setParams({ colorBy })} options={[{ value: 'value', label: '값 (높이와 같음)' }, { value: 'single', label: '단색' }]} />
        {params.colorBy === 'value' && <Select label="팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={seq} />}
        <Toggle label="옆면 그리기" checked={params.walls} onChange={(walls) => setParams({ walls })} />
        <Hint>지역 모양을 값에 비례하는 높이로 솟아오르게 한 지도입니다. 가까이 있는 높은 지역이 뒤쪽 지역을 가리므로 시점을 돌려 확인하세요. 입체는 값의 정확한 비교에는 불리하니 정확한 값은 지역에 포인터를 올려 읽으세요. 절댓값을 쓰면 인구가 많은 지역이 항상 높아집니다.</Hint>
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><PrismMapControls params={params} setParams={setParams} table={table} mapping={mapping} /></ControlGroup>
    </>
  )
}

function PrismMapControls({ params, setParams, table, mapping }: { params: PrismParams; setParams: (p: Partial<PrismParams>) => void; table: DataTable; mapping: Mapping }) {
  const data = useMemo(() => regionRows(table, mapping, KEY_VALUE), [table, mapping])
  const resolved = useMemo(() => resolveFromIds(params, data), [params, data])
  return <GeoControls params={params} setParams={setParams} resolved={resolved} />
}

const resolveFromIds = (params: GeoParams, data: Map<string, unknown>) => resolveMap(params, [...data.keys()])

export const prismMapModule: VizModule<PrismParams> = {
  roles: [{ key: 'region', label: '지역 ID (예: KOR, KR-11)', type: 'category', required: true, prefer: 'ID|코드|code' }, { key: 'value', label: '값 (높이)', type: 'number', required: true }],
  datasets: ['kr-regions', 'world-regions'],
  defaultParams: { ...geoDefaults, yaw: -22, pitch: 48, zoom: 1.05, heightScale: 0.5, scheme: 'ylorrd', colorBy: 'value', walls: true, selected: '' },
  Chart: PrismChart,
  Controls: PrismControls,
  hint: '끌어서 회전 · 휠로 확대 · 지역에 포인터를 올려 값 확인 · 높이 배율과 시점을 바꿔 가려진 지역 확인',
}

// ─── space-time cube ────────────────────────────────────────────────────────────────

export interface CubeParams extends GeoParams, ViewParams { tFrom: number; tTo: number; stretch: number; showLines: boolean; showDrops: boolean; showFloor: boolean; colorBy: 'entity' | 'time' }

function readCube(table: DataTable, mapping: Mapping) {
  const ei = columnIndex(table, roleColumn(mapping, 'entity')), ti = columnIndex(table, roleColumn(mapping, 'time')), li = columnIndex(table, roleColumn(mapping, 'lat')), oi = columnIndex(table, roleColumn(mapping, 'lon'))
  const pts: { row: number; t: number; lat: number; lon: number; entity: string }[] = []
  let skipped = 0
  if (ti < 0 || li < 0 || oi < 0) return { pts, skipped }
  const dateCol = table.columns[ti]?.type === 'date'
  table.rows.forEach((r, row) => {
    const t = dateCol ? toTime(r[ti] as never) : toNumber(r[ti]), lat = toNumber(r[li]), lon = toNumber(r[oi])
    if (t == null || lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) { skipped++; return }
    pts.push({ row, t, lat, lon, entity: ei >= 0 ? toLabel(r[ei]) : '' })
  })
  return { pts, skipped }
}

function CubeChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<CubeParams>) {
  const { pts, skipped } = useMemo(() => readCube(table, mapping), [table, mapping])
  const resolved = useMemo(() => resolvePointMap(params, pts), [params, pts])
  const boxRef = useRef<HTMLDivElement>(null)
  const { tip, show, hide } = useTooltip()
  useOrbit(boxRef, viewOf(params), (v) => setParams(v), !compact)
  const dateCol = table.columns.find((c) => c.name === roleColumn(mapping, 'time'))?.type === 'date'
  const [t0, t1] = useMemo(() => d3.extent(pts, (p) => p.t) as [number, number], [pts])
  const geo = useMemo(() => {
    if (!pts.length) return null
    const [w, e] = d3.extent(pts, (p) => p.lon) as [number, number], [s, n] = d3.extent(pts, (p) => p.lat) as [number, number]
    const origin: [number, number] = [(w + e) / 2, (s + n) / 2]
    const g = groundPlane(origin)
    const a = g.toKm([w, s]), b = g.toKm([e, n])
    const L = Math.max(b[0] - a[0], b[1] - a[1], 20) / 2 * 1.15
    return { g, L, hw: Math.max(0.2, (b[0] - a[0]) / 2 / L), hh: Math.max(0.2, (b[1] - a[1]) / 2 / L), origin }
  }, [pts])
  const entities = useMemo(() => [...new Set(pts.map((p) => p.entity))].filter(Boolean), [pts])
  const ecolor = categoryColor(entities)
  const view = viewOf(params)
  const proj = useMemo(() => makeProjector(view, width, height, 0.4), [view.yaw, view.pitch, view.zoom, width, height]) // eslint-disable-line react-hooks/exhaustive-deps
  const ta = t0 + params.tFrom * (t1 - t0), tb = t0 + params.tTo * (t1 - t0)
  const Zh = params.stretch
  const place = (p: { t: number; lat: number; lon: number }): V3 => { const [x, y] = geo!.g.toKm([p.lon, p.lat]); return [x / geo!.L, y / geo!.L, ((p.t - t0) / (t1 - t0 || 1)) * Zh] }
  const outline = useMemo(() => {
    if (!geo || !params.showFloor) return []
    const [w, e] = d3.extent(pts, (p) => p.lon) as [number, number], [s, n] = d3.extent(pts, (p) => p.lat) as [number, number]
    const padLon = (e - w) * 0.6 + 0.3, padLat = (n - s) * 0.6 + 0.3
    const rings: V3[][] = []
    for (const r of resolved.map.regions) for (const poly of polygons(r.feature)) {
      const ring = poly[0]
      const near = ring.some((c) => c[0] > w - padLon && c[0] < e + padLon && c[1] > s - padLat && c[1] < n + padLat)
      if (!near || ring.length < 4) continue
      rings.push(ring.filter((_, i) => i % (ring.length > 400 ? 3 : 1) === 0).map((c) => { const [x, y] = geo.g.toKm([c[0], c[1]]); return [x / geo.L, y / geo.L, 0] as V3 }))
    }
    return rings
  }, [geo, params.showFloor, resolved.map, pts])
  const clampBox = (v: number, h: number) => Math.max(-h, Math.min(h, v))
  if (!roleColumn(mapping, 'time') || !roleColumn(mapping, 'lat') || !roleColumn(mapping, 'lon')) return <ChartMessage>시각(날짜형 또는 숫자형), 위도, 경도 열을 선택하세요.</ChartMessage>
  if (pts.length < 2 || !geo) return <ChartMessage>시각과 좌표가 올바른 행이 2개 이상 필요합니다.</ChartMessage>
  const shown = pts.filter((p) => p.t >= ta && p.t <= tb)
  const tcolor = (t: number) => schemes.viridis.interpolate((t - t0) / (t1 - t0 || 1))
  const colorOf = (p: (typeof pts)[number]) => (params.colorBy === 'time' || !p.entity ? tcolor(p.t) : ecolor(p.entity))
  const drawn = shown.map((p) => ({ p, q: proj(place(p)) })).sort((a, b) => b.q.depth - a.q.depth)
  const byEntity = d3.group(shown, (p) => p.entity)
  const box = { x: [-geo.hw, geo.hw] as [number, number], y: [-geo.hh, geo.hh] as [number, number], z: [0, Zh] as [number, number] }
  void clampBox
  const fmtT = (t: number) => (dateCol ? formatTime(t) : fmt(t))
  return (
    <div className="chart-root">
      <div ref={boxRef} className="orbit-box" tabIndex={compact ? -1 : 0} style={{ width, height }} aria-label="시공간 큐브: 끌어서 회전, 휠로 확대">
        <svg width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`시공간 큐브: 점 ${shown.length}개, 시간 ${fmtT(ta)}–${fmtT(tb)}`} onPointerLeave={hide}>
          <Frame3D proj={proj} box={box} labels={compact ? [] : [{ at: [geo.hw, -geo.hh, 0], text: fmtT(t0), anchor: 'start' }, { at: [geo.hw, -geo.hh, Zh], text: fmtT(t1), anchor: 'start' }]} />
          {outline.map((ring, i) => <path key={i} d={d3.line()(ring.map((v) => { const q = proj(v); return [q.x, q.y] as [number, number] })) ?? ''} fill="none" stroke="#9aa7a3" strokeWidth={0.8} pointerEvents="none" />)}
          {params.showLines && [...byEntity].map(([name, list]) => <path key={name || 'all'} d={d3.line()(list.slice().sort((a, b) => a.t - b.t).map((p) => { const q = proj(place(p)); return [q.x, q.y] as [number, number] })) ?? ''} fill="none" stroke={name ? ecolor(name) : '#6b7280'} strokeOpacity={0.55} strokeWidth={1.2} pointerEvents="none" />)}
          {params.showDrops && !compact && drawn.slice(0, 600).map(({ p, q }) => { const f = proj([...place(p).slice(0, 2), 0] as V3); return <line key={`d${p.row}`} x1={q.x} y1={q.y} x2={f.x} y2={f.y} stroke="#b8c2bf" strokeWidth={0.6} pointerEvents="none" /> })}
          {drawn.map(({ p, q }) => (
            <circle key={p.row} data-testid="cube-point" data-row={p.row} cx={q.x} cy={q.y} r={compact ? 1.8 : 3.4} fill={colorOf(p)} fillOpacity={0.9} stroke="#fff" strokeWidth={0.7}
              onPointerEnter={compact ? undefined : (e) => { const l = localPoint(boxRef.current!, e); show(l.x, l.y, <><b>{p.entity || `행 ${p.row + 1}`}</b><br />{fmtT(p.t)}<br />{fmt(p.lat, 3)}°N {fmt(p.lon, 3)}°E</>) }} onPointerLeave={hide} />
          ))}
        </svg>
      </div>
      {!compact && (<>
        {params.colorBy === 'entity' && entities.length > 0 && <Legend items={entities.map((e) => ({ key: e, color: ecolor(e) }))} />}
        <Readout items={[{ label: '점', value: `${shown.length} / ${pts.length}` }, { label: '시간', value: `${fmtT(ta)} – ${fmtT(tb)}` }]} />
        {skipped > 0 && <p className="chart-warning" role="status">시각·좌표가 올바르지 않은 {skipped}행은 제외했습니다.</p>}
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

function CubeControls({ params, setParams, table, mapping }: ControlsProps<CubeParams>) {
  const { pts } = useMemo(() => readCube(table, mapping), [table, mapping])
  const resolved = useMemo(() => resolvePointMap(params, pts), [params, pts])
  return (
    <>
      <ViewControls params={params} setParams={setParams} />
      <ControlGroup title="시간 범위와 표현">
        <Slider label="시작" value={params.tFrom} min={0} max={1} step={0.01} onChange={(tFrom) => setParams({ tFrom: Math.min(tFrom, params.tTo - 0.02) })} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-cube-from" />
        <Slider label="끝" value={params.tTo} min={0} max={1} step={0.01} onChange={(tTo) => setParams({ tTo: Math.max(tTo, params.tFrom + 0.02) })} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-cube-to" />
        <Slider label="시간축 길이" value={params.stretch} min={0.4} max={2} step={0.1} onChange={(stretch) => setParams({ stretch })} testId="ctl-cube-stretch" />
        <Select label="색" value={params.colorBy} onChange={(colorBy) => setParams({ colorBy })} options={[{ value: 'entity', label: '개체' }, { value: 'time', label: '시간' }]} />
        <Toggle label="개체별 경로선" checked={params.showLines} onChange={(showLines) => setParams({ showLines })} />
        <Toggle label="바닥으로 내린 선" checked={params.showDrops} onChange={(showDrops) => setParams({ showDrops })} />
        <Toggle label="바닥 지도" checked={params.showFloor} onChange={(showFloor) => setParams({ showFloor })} />
        <Hint>가로·세로 평면이 지도(땅 위 km), 세로축이 시간입니다. 한 곳에 오래 머문 개체는 수직 선이 되고, 빨리 움직인 개체는 눕습니다. 시간 범위 슬라이더로 일부 기간만 보세요. 입체이므로 점이 겹쳐 보이면 시점을 돌려 확인하세요. 예제는 합성 이동 기록입니다.</Hint>
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams} resolved={resolved} /></ControlGroup>
    </>
  )
}

export const spaceTimeCubeModule: VizModule<CubeParams> = {
  roles: [{ key: 'entity', label: '개체 (선택)', type: 'category', auto: true, prefer: '개체|id|name' }, { key: 'time', label: '시각', type: 'date', accept: ['date', 'number'], required: true, prefer: '시각|time' }, latRole(), lonRole()],
  datasets: ['gps-tracks'],
  defaultParams: { ...geoDefaults, yaw: -35, pitch: 32, zoom: 1.05, tFrom: 0, tTo: 1, stretch: 1.1, showLines: true, showDrops: false, showFloor: true, colorBy: 'entity' },
  Chart: CubeChart,
  Controls: CubeControls,
  hint: '끌어서 큐브를 돌려 보세요 · 시간 범위 슬라이더로 구간 선택 · 세로축이 시간이라 한 곳에 머문 개체는 수직으로 서 있습니다',
}

