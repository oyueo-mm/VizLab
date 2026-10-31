import * as d3 from 'd3'
import { useCallback, useMemo, useRef, useState } from 'react'
import { ChartMessage, Readout, localPoint, margins, AxisBottom, AxisLeft } from '../../components/chart/primitives'
import { ControlGroup, Hint, NumberField, Segmented, Select, Slider, StatTable, Toggle } from '../../components/controls'
import { columnIndex, toNumber, updateRow, type DataTable } from '../../data/table'
import { getMap } from '../../geo/maps'
import { inPolygon, polygons } from '../../geo/geojson'
import { project } from '../../geo/projections'
import { schemes, type ColorScheme } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { KOREA_HILLS } from '../../data/datasetsV5Geo'
import { LAND_CLASSES, cellAreaKm2At, coarsenGrid, dasymetricDensity, fillMissing, gridExtent, gridFromCells, hillshade, hillsHeight, lineOfSight, makeGrid, sampleGrid, syntheticLandUse, terrainProfile, type LandCell, type LonLat } from '../../stats/spatial'
import { classBreaks, classIndex } from '../../stats/geo'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'
import { boxFor, colorRamp, hypsometric, pack, packColor, RampLegend, SurfaceStage, readSurfacePoints, surfaceDefaults, surfaceRoles, useSurface, type SurfaceParams } from './geoKit'
import { GeoControls, geoDefaults, latRole, lonRole, resolvePointMap, type GeoParams } from './geoShared'

const round4 = (v: number) => Math.round(v * 1e4) / 1e4
const seq = (Object.keys(schemes) as ColorScheme[]).filter((k) => !schemes[k].diverging).map((k) => ({ value: k, label: schemes[k].name }))

// ─── raster map ─────────────────────────────────────────────────────────────────────

export interface RasterParams extends GeoParams { interp: 'nearest' | 'bilinear'; missing: 'transparent' | 'fill' | 'zero'; classes: number; method: 'equal' | 'quantile'; coarsen: number; scheme: ColorScheme; opacity: number; cells: boolean }

function useRaster(table: DataTable, mapping: Mapping, params: RasterParams) {
  const base = useMemo(() => {
    const li = columnIndex(table, roleColumn(mapping, 'lat')), oi = columnIndex(table, roleColumn(mapping, 'lon')), vi = columnIndex(table, roleColumn(mapping, 'value'))
    if (li < 0 || oi < 0 || vi < 0) return null
    const cells: { lon: number; lat: number; value: number | null; row: number }[] = []
    table.rows.forEach((r, row) => { const lat = toNumber(r[li]), lon = toNumber(r[oi]); if (lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) cells.push({ lon, lat, value: toNumber(r[vi]), row }) })
    return gridFromCells(cells)
  }, [table, mapping])
  const grid = useMemo(() => {
    if (!base) return null
    let g = base.grid
    if (params.coarsen > 1) g = coarsenGrid(g, params.coarsen)
    if (params.missing === 'fill') g = fillMissing(g)
    else if (params.missing === 'zero') g = { ...g, values: Float64Array.from(g.values, (v) => (Number.isFinite(v) ? v : 0)) }
    return g
  }, [base, params.coarsen, params.missing])
  return { base, grid }
}

function RasterMapChart({ table, mapping, params, width, height, compact, onTableChange }: ChartProps<RasterParams>) {
  const { base, grid } = useRaster(table, mapping, params)
  const pts = useMemo(() => (base ? [{ lon: base.grid.west, lat: base.grid.south }, { lon: base.grid.east, lat: base.grid.north }] : []), [base])
  const resolved = useMemo(() => resolvePointMap(params, pts), [params, pts])
  const box = useMemo(() => {
    if (!grid) return { west: 0, east: 1, south: 0, north: 1 }
    const hx = (grid.east - grid.west) / (grid.nx - 1) / 2, hy = (grid.north - grid.south) / (grid.ny - 1) / 2
    return { west: grid.west - hx, east: grid.east + hx, south: grid.south - hy, north: grid.north + hy }
  }, [grid])
  const stats = useMemo(() => {
    if (!grid) return null
    const vals = Array.from(grid.values).filter(Number.isFinite)
    const edges = params.classes > 0 ? classBreaks(vals, params.method, params.classes) : []
    return { lo: d3.min(vals) ?? 0, hi: d3.max(vals) ?? 1, n: vals.length, edges }
  }, [grid, params.classes, params.method])
  const scheme = schemes[params.scheme]
  const ramp = useMemo(() => colorRamp(scheme.interpolate), [scheme])
  const classColors = useMemo(() => (stats && stats.edges.length > 1 ? Array.from({ length: stats.edges.length - 1 }, (_, i) => packColor(scheme.interpolate(0.12 + 0.88 * (i / Math.max(1, stats.edges.length - 2))))) : []), [stats, scheme])
  const paint = useCallback((lon: number, lat: number) => {
    if (!grid || !stats) return 0
    if (lon < box.west || lon > box.east || lat < box.south || lat > box.north) return 0
    const fi = ((lon - grid.west) / (grid.east - grid.west)) * (grid.nx - 1), fj = ((lat - grid.south) / (grid.north - grid.south)) * (grid.ny - 1)
    let v: number
    if (params.interp === 'nearest') {
      const i = Math.max(0, Math.min(grid.nx - 1, Math.round(fi))), j = Math.max(0, Math.min(grid.ny - 1, Math.round(fj)))
      v = grid.values[j * grid.nx + i]
    } else v = sampleGrid(grid, Math.max(grid.west, Math.min(grid.east, lon)), Math.max(grid.south, Math.min(grid.north, lat)))
    if (!Number.isFinite(v)) return 0
    const c = classColors.length ? classColors[Math.min(classColors.length - 1, classIndex(v, stats.edges))] : ramp[Math.max(0, Math.min(255, Math.round(((v - stats.lo) / (stats.hi - stats.lo || 1)) * 255)))]
    return (c & 0x00ffffff) | (Math.round(255 * params.opacity) << 24)
  }, [grid, stats, box, params.interp, params.opacity, classColors, ramp])
  const [edit, setEdit] = useState<{ row: number; x: number; y: number; lon: number; lat: number } | null>(null)
  const [draft, setDraft] = useState('')
  const down = useRef<{ x: number; y: number } | null>(null)
  if (!roleColumn(mapping, 'lat') || !roleColumn(mapping, 'lon') || !roleColumn(mapping, 'value')) return <ChartMessage>위도, 경도, 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!base || !grid || !stats) return <ChartMessage>규칙적인 격자 좌표가 있는 행이 필요합니다.<small>경도와 위도가 각각 2가지 이상의 서로 다른 값으로 일정한 간격에 놓여야 합니다.</small></ChartMessage>
  const surface = { box, resolved, points: [{ row: 0, lat: 0, lon: 0, value: 0, radius: null, label: '' }] }
  const cellAt = (lon: number, lat: number) => {
    const g = base.grid
    const i = Math.round(((lon - g.west) / (g.east - g.west)) * (g.nx - 1)), j = Math.round(((lat - g.south) / (g.north - g.south)) * (g.ny - 1))
    return i >= 0 && j >= 0 && i < g.nx && j < g.ny ? { i, j, row: base.rowOf[j * g.nx + i], v: base.grid.values[j * g.nx + i] } : null
  }
  const editable = !!onTableChange && !compact
  return (
    <>
      <SurfaceStage width={width} height={height} compact={compact} params={params} surface={surface} paint={paint} label={`래스터 지도: ${grid.nx}×${grid.ny}칸, 유효 ${stats.n}칸`}
        onSvgPointerDown={(e) => { down.current = { x: e.clientX, y: e.clientY } }}
        info={(lon, lat) => { const c = params.coarsen > 1 ? null : cellAt(lon, lat); const v = params.interp === 'nearest' ? (params.coarsen > 1 ? null : c?.v) : sampleGrid(grid, lon, lat); return <>{v != null && Number.isFinite(v) ? <>값 <b>{fmt(v)}</b></> : '값 없음 (결측)'}{editable && c && c.row >= 0 ? <><br />클릭해 값 편집</> : null}</> }}
        overlay={({ projection, k, svg, t }) => (
          <g>
            <rect x={-5000} y={-5000} width={10000} height={10000} fill="transparent" data-testid="raster-hit" onPointerUp={(e) => {
              const d = down.current; down.current = null
              if (!editable || params.coarsen > 1 || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || !svg) return
              const r = svg.getBoundingClientRect()
              const g = projection.invert?.([(e.clientX - r.left - t.x) / t.k, (e.clientY - r.top - t.y) / t.k])
              const c = g && cellAt(g[0], g[1])
              if (c && c.row >= 0) { setEdit({ row: c.row, x: e.clientX - r.left, y: e.clientY - r.top, lon: g![0], lat: g![1] }); setDraft(Number.isFinite(c.v) ? String(c.v) : '') }
            }} />
            {params.cells && !compact && k >= 2 && grid.nx * grid.ny <= 6000 && (
              <path d={Array.from({ length: grid.nx * grid.ny }, (_, n) => { const i = n % grid.nx, j = Math.floor(n / grid.nx); const dx = (grid.east - grid.west) / (grid.nx - 1) / 2, dy = (grid.north - grid.south) / (grid.ny - 1) / 2; const lon = grid.west + (i * (grid.east - grid.west)) / (grid.nx - 1), lat = grid.south + (j * (grid.north - grid.south)) / (grid.ny - 1); const a = project(projection, lon - dx, lat - dy), b = project(projection, lon + dx, lat + dy); return a && b ? `M${a[0].toFixed(1)},${a[1].toFixed(1)}H${b[0].toFixed(1)}V${b[1].toFixed(1)}H${a[0].toFixed(1)}Z` : '' }).join('')} fill="none" stroke="#111" strokeOpacity={0.25} strokeWidth={0.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            )}
          </g>
        )}
        legend={!compact && (stats.edges.length > 1
          ? <div className="chart-legend" aria-label="범례">{stats.edges.slice(0, -1).map((e, i) => <span key={i} className="legend-item"><span className="legend-swatch" style={{ background: scheme.interpolate(0.12 + 0.88 * (i / Math.max(1, stats.edges.length - 2))), borderColor: 'transparent' }} />{fmt(e, 3)}–{fmt(stats.edges[i + 1], 3)}</span>)}</div>
          : <RampLegend interpolate={scheme.interpolate} min={fmt(stats.lo)} max={fmt(stats.hi)} label="값" />)}
        extra={<Readout items={[{ label: '격자', value: `${grid.nx}×${grid.ny}` }, { label: '유효 칸', value: `${stats.n} / ${grid.nx * grid.ny}` }, { label: '범위', value: `${fmt(stats.lo)}–${fmt(stats.hi)}` }]} />} />
      {edit && !compact && (
        <form className="cell-popover" style={{ left: Math.min(width - 200, edit.x), top: edit.y + 10 }} onSubmit={(e) => { e.preventDefault(); const v = draft.trim() === '' ? null : Number(draft.replace(/,/g, '')); if (draft.trim() !== '' && !Number.isFinite(v)) return; onTableChange!(updateRow(table, edit.row, { [roleColumn(mapping, 'value')!]: v })); setEdit(null) }}>
          <label>{edit.lat.toFixed(2)}°N {edit.lon.toFixed(2)}°E 값</label>
          <input autoFocus type="text" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="셀 값" data-testid="raster-input" onKeyDown={(e) => { if (e.key === 'Escape') setEdit(null) }} placeholder="비우면 결측" />
          <button type="submit" className="btn btn-primary btn-sm">적용</button>
        </form>
      )}
    </>
  )
}

function RasterControls({ params, setParams, table, mapping }: ControlsProps<RasterParams>) {
  const { base } = useRaster(table, mapping, params)
  const pts = useMemo(() => (base ? [{ lon: base.grid.west, lat: base.grid.south }, { lon: base.grid.east, lat: base.grid.north }] : []), [base])
  const resolved = useMemo(() => resolvePointMap(params, pts), [params, pts])
  return (
    <>
      <ControlGroup title="래스터">
        <Segmented label="보간 (칸 사이)" value={params.interp} onChange={(interp) => setParams({ interp })} testId="ctl-raster-interp" options={[{ value: 'nearest', label: '최근접(칸 그대로)' }, { value: 'bilinear', label: '쌍선형(부드럽게)' }]} />
        <Hint>{params.interp === 'nearest' ? '각 칸을 한 색으로 칠해 원자료의 해상도를 그대로 보여 줍니다.' : '칸 중심 값 사이를 선형으로 이어 부드럽게 보이게 합니다. 보기에는 좋지만 칸 사이의 값은 관측이 아니라 추정입니다. 결측이 이웃하면 그 주변은 비웁니다.'}</Hint>
        <Slider label="해상도 낮추기 (블록 평균)" value={params.coarsen} min={1} max={6} onChange={(coarsen) => setParams({ coarsen })} format={(v) => (v === 1 ? '원본' : `${v}×${v} 평균`)} testId="ctl-raster-coarsen" />
        <Select label="결측값 처리" value={params.missing} onChange={(missing) => setParams({ missing })} testId="ctl-raster-missing" options={[{ value: 'transparent', label: '비워 둠 (투명)' }, { value: 'fill', label: '이웃으로 채움 (IDW)' }, { value: 'zero', label: '0으로 취급' }]} />
        {params.missing === 'zero' && <Hint>결측을 0으로 두면 실제 0과 구별되지 않고 평균·색 범위가 왜곡됩니다. 가능하면 결측은 비워 두세요.</Hint>}
        {params.missing === 'fill' && <Hint>채운 값은 가장 가까운 유효 칸 6개의 역거리 가중 평균인 추정치입니다. 관측으로 읽지 마세요.</Hint>}
      </ControlGroup>
      <ControlGroup title="색">
        <Select label="계급 구분" value={String(params.classes)} onChange={(v) => setParams({ classes: Number(v) })} testId="ctl-raster-classes" options={[{ value: '0', label: '연속 (구분 없음)' }, ...[3, 4, 5, 6, 7, 8].map((n) => ({ value: String(n), label: `${n}개 계급` }))]} />
        {params.classes > 0 && <Segmented label="계급 나누기" value={params.method} onChange={(method) => setParams({ method })} options={[{ value: 'equal', label: '등간격' }, { value: 'quantile', label: '분위수' }]} />}
        <Select label="팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={seq} />
        <Slider label="불투명도" value={params.opacity} min={0.3} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} />
        <Toggle label="셀 경계 (확대 시)" checked={params.cells} onChange={(cells) => setParams({ cells })} />
        <Hint>칸을 클릭하면 값을 고칠 수 있습니다(해상도를 낮추지 않았을 때).</Hint>
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams} resolved={resolved} /></ControlGroup>
    </>
  )
}

export const rasterMapModule: VizModule<RasterParams> = {
  roles: [latRole(), lonRole(), { key: 'value', label: '값', type: 'number', required: true, prefer: '값|value' }],
  datasets: ['raster-grid'],
  defaultParams: { ...geoDefaults, interp: 'nearest', missing: 'transparent', classes: 0, method: 'quantile', coarsen: 1, scheme: 'ylorrd', opacity: 0.92, cells: true },
  Chart: RasterMapChart,
  Controls: RasterControls,
  hint: '칸을 클릭해 값 편집 · 보간·해상도·결측 처리를 바꿔 같은 격자가 어떻게 달라 보이는지 비교 · 계급 구분으로 연속 색과 비교',
}

// ─── terrain profile ────────────────────────────────────────────────────────────────

export interface ProfileParams extends SurfaceParams { a: LonLat; b: LonLat; samples: number; fit: boolean; exag: number; eye: number; los: boolean; azimuth: number; altitude: number }

function ProfileChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<ProfileParams>) {
  const s = useSurface(table, mapping, params, compact)
  const shade = useMemo(() => hillshade(s.grid, params.azimuth, params.altitude, 3), [s.grid, params.azimuth, params.altitude])
  const [lo, hi] = useMemo(() => gridExtent(s.grid), [s.grid])
  const ramp = useMemo(() => colorRamp(hypsometric), [])
  const mapH = compact ? height : Math.round(height * 0.58)
  const prof = useMemo(() => terrainProfile(s.at, params.a, params.b, params.samples), [s.at, params.a, params.b, params.samples])
  const vis = useMemo(() => lineOfSight(prof, params.eye), [prof, params.eye])
  const paint = useCallback((lon: number, lat: number) => {
    const sh = sampleGrid(shade, lon, lat), h = sampleGrid(s.grid, lon, lat)
    if (!Number.isFinite(sh)) return 0
    const c = ramp[Math.max(0, Math.min(255, Math.round(((h - lo) / (hi - lo || 1)) * 255)))]
    const k = 0.25 + 0.75 * sh
    return pack(Math.round((c & 255) * k), Math.round(((c >>> 8) & 255) * k), Math.round(((c >>> 16) & 255) * k))
  }, [shade, s.grid, ramp, lo, hi])
  const drag = useRef<'a' | 'b' | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  if (!s.points.length) return <ChartMessage>위도·경도·높이(숫자형) 열에 쓸 수 있는 행이 없습니다.</ChartMessage>
  // profile panel geometry
  const pm = margins(compact, { top: 14, bottom: 40, left: 58, right: 18 })
  const pw = Math.max(40, width - pm.left - pm.right), ph = Math.max(40, height - mapH - pm.top - pm.bottom)
  const x = d3.scaleLinear().domain([0, prof.lengthKm]).range([0, pw])
  let yDomain: [number, number] = [Math.max(0, prof.min - (prof.max - prof.min) * 0.05), prof.max + (prof.max - prof.min) * 0.08 + 1]
  if (!params.fit) {
    // true proportions × exaggeration: pixels per metre vertically = (pixels per km horizontally / 1000) × exag
    const perM = (pw / Math.max(1e-9, prof.lengthKm) / 1000) * params.exag
    yDomain = [yDomain[0], yDomain[0] + ph / perM]
  }
  const y = d3.scaleLinear().domain(yDomain).range([ph, 0])
  const area = d3.area<number>().x((_, i) => x(prof.dist[i])).y0(ph).y1((_, i) => y(Math.min(prof.elev[i], yDomain[1]))).defined((_, i) => Number.isFinite(prof.elev[i]))
  const line = d3.line<number>().x((_, i) => x(prof.dist[i])).y((_, i) => y(Math.min(prof.elev[i], yDomain[1]))).defined((_, i) => Number.isFinite(prof.elev[i]))
  const idx = d3.range(prof.dist.length)
  const move = (e: React.PointerEvent, ctx: { projection: d3.GeoProjection; t: { x: number; y: number; k: number }; svg: SVGSVGElement | null }) => {
    if (!drag.current || !ctx.svg) return
    const r = ctx.svg.getBoundingClientRect()
    const g = ctx.projection.invert?.([(e.clientX - r.left - ctx.t.x) / ctx.t.k, (e.clientY - r.top - ctx.t.y) / ctx.t.k])
    if (g && Number.isFinite(g[0])) setParams(drag.current === 'a' ? { a: [round4(g[0]), round4(g[1])] } : { b: [round4(g[0]), round4(g[1])] })
  }
  const cur = hover != null ? { i: hover, ...{ d: prof.dist[hover], z: prof.elev[hover] } } : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width, height }}>
      <div style={{ height: mapH, position: 'relative' }}>
        <SurfaceStage width={width} height={mapH} compact={compact} params={params} surface={s} paint={paint} label="지형 단면도의 지도: 두 지점을 잇는 선"
          overlay={(c) => {
            const pa = project(c.projection, params.a[0], params.a[1]), pb = project(c.projection, params.b[0], params.b[1])
            if (!pa || !pb) return null
            const hp = hover != null ? project(c.projection, prof.points[hover][0], prof.points[hover][1]) : null
            return (
              <g onPointerMove={(e) => move(e, c)} onPointerUp={() => { drag.current = null }}>
                <line x1={pa[0]} y1={pa[1]} x2={pb[0]} y2={pb[1]} stroke="#e07a3f" strokeWidth={2.2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                {params.los && !compact && prof.points.map((p, i) => { const q = project(c.projection, p[0], p[1]); return q && !vis[i] && i % 3 === 0 ? <circle key={i} cx={q[0]} cy={q[1]} r={1.8 / c.k} fill="#111" fillOpacity={0.55} pointerEvents="none" /> : null })}
                {hp && <circle cx={hp[0]} cy={hp[1]} r={5 / c.k} fill="#fff" stroke="#121816" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
                {([['a', pa, 'A'], ['b', pb, 'B']] as const).map(([key, p, name]) => (
                  <g key={key} data-nodrag="" data-testid={`profile-${key}`} transform={`translate(${p[0]},${p[1]}) scale(${1 / c.k})`} style={{ cursor: compact ? 'default' : 'grab' }}
                    onPointerDown={compact ? undefined : (e) => { e.stopPropagation(); (c.svg as Element).setPointerCapture(e.pointerId); drag.current = key }}>
                    <circle r={10} fill="#e07a3f" stroke="#fff" strokeWidth={2} /><text textAnchor="middle" dy="0.35em" fontSize={11} fontWeight={700} fill="#fff" pointerEvents="none">{name}</text>
                  </g>
                ))}
              </g>
            )
          }}
          info={(lon, lat) => { const h = s.at(lon, lat); return Number.isFinite(h) ? <>높이 <b>{fmt(h, 0)}</b></> : null }} />
      </div>
      <svg width={width} height={height - mapH} className="chart-svg" role="img" data-testid="profile-svg" aria-label={`지형 단면도: 길이 ${prof.lengthKm.toFixed(0)} km, 최고 ${fmt(prof.max, 0)}`} style={{ overflow: 'visible' }}
        onPointerMove={compact ? undefined : (e) => { const l = localPoint(e.currentTarget, e); const d = x.invert(l.x - pm.left); const i = d3.bisectCenter(prof.dist, d); setHover(l.x >= pm.left && l.x <= pm.left + pw ? i : null) }} onPointerLeave={() => setHover(null)}>
        <g transform={`translate(${pm.left},${pm.top})`}>
          <AxisBottom scale={x} y={ph} grid={ph} label="A로부터의 거리 (km)" compact={compact} ticks={6} />
          <AxisLeft scale={y} x={0} grid={pw} label="높이 (m)" compact={compact} ticks={4} />
          <path d={area(idx) ?? ''} fill="#a9bf86" fillOpacity={0.55} data-testid="profile-area" />
          <path d={line(idx) ?? ''} fill="none" stroke="#4f6b3a" strokeWidth={1.6} />
          {params.los && !compact && idx.map((i) => (i > 0 && Number.isFinite(prof.elev[i]) && !vis[i]) ? <rect key={i} x={x(prof.dist[i]) - 1} y={y(Math.min(prof.elev[i], yDomain[1]))} width={2} height={Math.max(0, ph - y(Math.min(prof.elev[i], yDomain[1])))} fill="#111" fillOpacity={0.28} /> : null)}
          {params.los && !compact && Number.isFinite(prof.elev[0]) && <line x1={0} x2={0} y1={y(prof.elev[0])} y2={y(Math.min(yDomain[1], prof.elev[0] + params.eye))} stroke="#e07a3f" strokeWidth={3} />}
          {cur && Number.isFinite(cur.z) && <g pointerEvents="none"><line x1={x(cur.d)} x2={x(cur.d)} y1={0} y2={ph} stroke="#121816" strokeDasharray="3 3" /><circle cx={x(cur.d)} cy={y(Math.min(cur.z, yDomain[1]))} r={4} fill="#fff" stroke="#121816" strokeWidth={2} /><text x={Math.min(pw - 4, x(cur.d) + 6)} y={12} fontSize={11} fill="#111827" stroke="#fff" strokeWidth={3} paintOrder="stroke">{cur.d.toFixed(1)} km · {fmt(cur.z, 0)} m{params.los && !vis[cur.i] ? ' · A에서 안 보임' : ''}</text></g>}
        </g>
      </svg>
      {!compact && <Readout items={[{ label: '길이', value: `${prof.lengthKm.toFixed(1)} km` }, { label: '누적 상승', value: `${fmt(prof.ascent, 0)} m` }, { label: '누적 하강', value: `${fmt(prof.descent, 0)} m` }, { label: '최대 경사', value: `${prof.maxSlopeDeg.toFixed(1)}°` }]} />}
    </div>
  )
}

function ProfileControls(props: ControlsProps<ProfileParams>) {
  const { params, setParams, table, mapping } = props
  const pts = useMemo(() => readSurfacePoints(table, mapping), [table, mapping])
  const resolved = useMemo(() => resolvePointMap(params, pts), [params, pts])
  return (
    <>
      <ControlGroup title="단면 경로">
        <Hint>지도 위의 A, B 표지를 끌어 단면 경로를 옮깁니다. 경로는 위경도 직선을 따라 표본점을 찍어 표면의 높이를 읽은 것입니다.</Hint>
        <NumberField label="A 위도" value={params.a[1]} step={0.05} onChange={(v) => setParams({ a: [params.a[0], v] })} />
        <NumberField label="A 경도" value={params.a[0]} step={0.05} onChange={(v) => setParams({ a: [v, params.a[1]] })} />
        <NumberField label="B 위도" value={params.b[1]} step={0.05} onChange={(v) => setParams({ b: [params.b[0], v] })} />
        <NumberField label="B 경도" value={params.b[0]} step={0.05} onChange={(v) => setParams({ b: [v, params.b[1]] })} />
        <Slider label="표본점 수" value={params.samples} min={40} max={500} step={10} onChange={(samples) => setParams({ samples })} />
      </ControlGroup>
      <ControlGroup title="단면도">
        <Toggle label="높이 범위에 맞춤" checked={params.fit} onChange={(fit) => setParams({ fit })} testId="ctl-profile-fit" />
        {!params.fit && <Slider label="수직 과장 (가로 대비)" value={params.exag} min={1} max={40} onChange={(exag) => setParams({ exag })} format={(v) => `${v}×`} testId="ctl-profile-exag" />}
        <Hint>{params.fit ? '높이가 그래프를 꽉 채우도록 늘렸습니다. 이때 경사는 실제보다 훨씬 가파르게 보입니다.' : '가로·세로 비율을 실제 비율에 수직 과장만큼 곱해 그립니다. 1×이면 실제 경사이며 대부분의 산은 거의 평평해 보입니다.'}</Hint>
        <Toggle label="가시선 (A에서 보이는 구간)" checked={params.los} onChange={(los) => setParams({ los })} testId="ctl-los" />
        {params.los && <Slider label="A에서 눈높이 (m)" value={params.eye} min={0} max={100} onChange={(eye) => setParams({ eye })} format={(v) => `${v} m`} />}
        {params.los && <Hint>A에서 각 지점으로 가는 시선의 고각이 그보다 가까운 지점들의 최대 고각 이상일 때 보입니다. 지구 곡률과 대기 굴절은 무시합니다.</Hint>}
      </ControlGroup>
      <ControlGroup title="표면 모델" defaultOpen={false}>
        <Slider label="격자 해상도" value={params.gridSize} min={40} max={220} step={10} onChange={(gridSize) => setParams({ gridSize })} />
        <Slider label="거칠기 (m)" value={params.roughness} min={0} max={250} step={5} onChange={(roughness) => setParams({ roughness })} />
        <GeoControls params={params} setParams={setParams} resolved={resolved} />
      </ControlGroup>
    </>
  )
}

export const terrainProfileModule: VizModule<ProfileParams> = {
  roles: surfaceRoles('높이 (m)'),
  datasets: ['terrain-hills', 'temp-stations'],
  defaultParams: { ...surfaceDefaults, a: [126.8, 35.2], b: [129.1, 37.6], samples: 220, fit: true, exag: 10, eye: 2, los: false, azimuth: 315, altitude: 40 },
  Chart: ProfileChart,
  Controls: ProfileControls,
  hint: '지도의 A·B 표지를 끌어 단면 경로를 바꾸세요 · 단면도 위에 포인터를 올리면 지도에 위치 표시 · 가시선과 수직 과장 조절',
}

// ─── dasymetric map ─────────────────────────────────────────────────────────────────

export interface DasyParams extends GeoParams { mode: 'dasymetric' | 'choropleth' | 'landuse'; wUrban: number; wFarm: number; wForest: number; scheme: ColorScheme; log: boolean; seed: number; res: number }

function DasymetricChart({ table, mapping, params, width, height, compact }: ChartProps<DasyParams>) {
  const ri = columnIndex(table, roleColumn(mapping, 'region')), vi = columnIndex(table, roleColumn(mapping, 'value'))
  const map = useMemo(() => getMap('korea'), [])
  const totals = useMemo(() => {
    const t = map.regions.map(() => null as number | null)
    if (ri < 0 || vi < 0) return t
    for (const r of table.rows) { const id = String(r[ri] ?? '').trim(), v = toNumber(r[vi]); const k = map.regions.findIndex((x) => x.id === id); if (k >= 0 && v != null) t[k] = (t[k] ?? 0) + v }
    return t
  }, [table, ri, vi, map])
  const resolved = useMemo(() => ({ map, id: 'korea' as const, note: null }), [map])
  const box = useMemo(() => boxFor(resolved, [], 0), [resolved])
  const nx = compact ? 70 : params.res
  const ny = Math.round((nx * (box.north - box.south)) / ((box.east - box.west) * Math.cos((((box.north + box.south) / 2) * Math.PI) / 180)))
  // cells: which region each lattice point lies in, its land-use class and ground area (a synthetic land-use model, see the description)
  const model = useMemo(() => {
    const rings = map.regions.map((r) => polygons(r.feature))
    const boxes = rings.map((polys) => { const all = polys.flatMap((p) => p[0]); return { w: d3.min(all, (c) => c[0])!, e: d3.max(all, (c) => c[0])!, s: d3.min(all, (c) => c[1])!, n: d3.max(all, (c) => c[1])! } })
    const land = syntheticLandUse(map.regions.map((r) => r.centroid), hillsHeight(KOREA_HILLS), params.seed)
    const g = makeGrid(box, nx, ny, () => 0)
    const cells: LandCell[] = []
    const cls = new Int8Array(nx * ny).fill(-1)
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const lon = g.west + (i / (nx - 1)) * (g.east - g.west), lat = g.south + (j / (ny - 1)) * (g.north - g.south)
      let region = -1
      for (let r = 0; r < rings.length && region < 0; r++) {
        const b = boxes[r]
        if (lon < b.w || lon > b.e || lat < b.s || lat > b.n) continue
        if (rings[r].some((poly) => inPolygon(poly, lon, lat))) region = r
      }
      const c = region >= 0 ? land(lon, lat) : -1
      cls[j * nx + i] = c
      cells.push({ region, cls: Math.max(0, c), area: region >= 0 ? cellAreaKm2At(g, j) : 0 })
    }
    return { g, cells, cls }
  }, [map, box, nx, ny, params.seed])
  const weights = useMemo(() => [params.wUrban, params.wFarm, params.wForest], [params.wUrban, params.wFarm, params.wForest])
  const density = useMemo(() => {
    const w = params.mode === 'choropleth' ? [1, 1, 1] : weights
    return dasymetricDensity(model.cells, totals, w)
  }, [model, totals, weights, params.mode])
  const mass = useMemo(() => { const m = new Float64Array(totals.length); model.cells.forEach((c, k) => { if (c.region >= 0) m[c.region] += density[k] * c.area }); return m }, [model, density, totals])
  const vmax = useMemo(() => d3.max(density) ?? 1, [density])
  const scheme = schemes[params.scheme]
  const ramp = useMemo(() => colorRamp(scheme.interpolate), [scheme])
  const classPack = useMemo(() => [packColor('#d6573c'), packColor('#e3c46a'), packColor('#4f8a5b')], [])
  const paint = useCallback((lon: number, lat: number) => {
    const g = model.g
    const i = Math.round(((lon - g.west) / (g.east - g.west)) * (g.nx - 1)), j = Math.round(((lat - g.south) / (g.north - g.south)) * (g.ny - 1))
    if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return 0
    const k = j * g.nx + i
    if (model.cells[k].region < 0) return 0
    if (params.mode === 'landuse') return classPack[model.cells[k].cls] | (0xdd << 24)
    if (totals[model.cells[k].region] == null) return packColor('#e6ebe9')
    const v = density[k]
    const t = params.log ? Math.log1p(v) / Math.log1p(vmax) : Math.sqrt(v / vmax)
    return ramp[Math.max(0, Math.min(255, Math.round(t * 255)))]
  }, [model, density, totals, vmax, ramp, params.mode, params.log, classPack])
  if (!roleColumn(mapping, 'region') || !roleColumn(mapping, 'value')) return <ChartMessage>지역 ID(KR-11 등 시도 ID)와 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!totals.some((t) => t != null)) return <ChartMessage>대한민국 시도 ID(KR-11 등)에 맞는 값이 없습니다.<small>이 도구의 합성 토지 이용 모형은 한국 시도 지도에만 쓸 수 있습니다.</small></ChartMessage>
  const surface = { box, resolved, points: [{ row: 0, lat: 0, lon: 0, value: 0, radius: null, label: '' }] }
  const classCount = [0, 0, 0]
  model.cells.forEach((c) => { if (c.region >= 0) classCount[c.cls]++ })
  const totalMass = d3.sum(Array.from(mass)), totalIn = d3.sum(totals.map((t) => t ?? 0))
  return (
    <SurfaceStage width={width} height={height} compact={compact} params={{ ...params, map: 'korea' }} surface={surface} paint={paint} label={`다지메트릭 지도: ${params.mode === 'dasymetric' ? '토지 이용 가중 재배분' : params.mode === 'choropleth' ? '지역 내 균일' : '합성 토지 이용'}`}
      info={(lon, lat) => {
        const g = model.g
        const i = Math.round(((lon - g.west) / (g.east - g.west)) * (g.nx - 1)), j = Math.round(((lat - g.south) / (g.north - g.south)) * (g.ny - 1))
        if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return null
        const k = j * g.nx + i, c = model.cells[k]
        if (c.region < 0) return null
        return <><b>{map.regions[c.region].name}</b> · {LAND_CLASSES[c.cls]}<br />지역 값 {fmt(totals[c.region])}<br />이 칸 밀도 {fmt(density[k], 2)} /km²</>
      }}
      legend={!compact && (params.mode === 'landuse'
        ? <div className="chart-legend" aria-label="범례">{LAND_CLASSES.map((n, i) => <span key={n} className="legend-item"><span className="legend-swatch" style={{ background: ['#d6573c', '#e3c46a', '#4f8a5b'][i] }} />{n} {classCount[i]}칸</span>)}</div>
        : <RampLegend interpolate={scheme.interpolate} min="0" max={`${fmt(vmax, 1)}/km²`} label="밀도" />)}
      extra={<Readout items={[{ label: '칸', value: `${nx}×${ny}` }, { label: '총량 보존', value: Math.abs(totalMass - totalIn) < 1e-6 * Math.max(1, totalIn) ? '✓' : '✗' }, { label: '최대 밀도', value: `${fmt(vmax, 1)}/km²` }]} />} />
  )
}

function DasymetricControls({ params, setParams }: ControlsProps<DasyParams>) {
  const resolved = useMemo(() => ({ map: getMap('korea'), id: 'korea' as const, note: null }), [])
  return (
    <>
      <ControlGroup title="재배분">
        <Segmented label="보기" value={params.mode} onChange={(mode) => setParams({ mode })} testId="ctl-dasy-mode" options={[{ value: 'dasymetric', label: '다지메트릭' }, { value: 'choropleth', label: '지역 균일' }, { value: 'landuse', label: '토지 이용' }]} />
        <Slider label="도시 가중치" value={params.wUrban} min={1} max={30} step={0.5} onChange={(wUrban) => setParams({ wUrban })} testId="ctl-w-urban" />
        <Slider label="농경지 가중치" value={params.wFarm} min={0} max={10} step={0.5} onChange={(wFarm) => setParams({ wFarm })} testId="ctl-w-farm" />
        <Slider label="산림 가중치" value={params.wForest} min={0} max={5} step={0.1} onChange={(wForest) => setParams({ wForest })} testId="ctl-w-forest" />
        <Hint>지역의 총량(예: 인구)을 같은 지역 안의 칸에 ‘토지 이용 가중치 × 칸 면적’에 비례해 나눠 줍니다. 합계는 지역마다 정확히 보존되고, 도시로 분류된 칸에 값이 몰립니다. 가중치는 가정이며 바꾸면 결과가 달라집니다 — 같은 가중치가 모든 지역에 적용됩니다. 토지 이용 래스터는 도시 중심·지형으로 만든 합성 모형으로 실제 토지 피복이 아닙니다. 지역 균일은 코로플레스와 같은 가정(지역 안에서 고른 분포)입니다.</Hint>
      </ControlGroup>
      <ControlGroup title="표현">
        <Select label="팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={seq} />
        <Toggle label="로그 색 눈금 (끄면 제곱근)" checked={params.log} onChange={(log) => setParams({ log })} />
        <Slider label="격자 해상도" value={params.res} min={60} max={200} step={10} onChange={(res) => setParams({ res })} />
        <NumberField label="토지 이용 난수 시드" value={params.seed} min={0} step={1} onChange={(seed) => setParams({ seed })} />
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams} resolved={resolved} /><StatTable rows={[['가정', '값'], ['도시 : 농경지 : 산림', `${params.wUrban} : ${params.wFarm} : ${params.wForest}`]]} /></ControlGroup>
    </>
  )
}

export const dasymetricModule: VizModule<DasyParams> = {
  roles: [{ key: 'region', label: '지역 ID (KR-11 등)', type: 'category', required: true, prefer: 'ID|코드|code' }, { key: 'value', label: '재배분할 총량 (예: 인구)', type: 'number', required: true, prefer: '인구|값|value' }],
  datasets: ['kr-regions'],
  defaultParams: { ...geoDefaults, map: 'korea', mode: 'dasymetric', wUrban: 12, wFarm: 2, wForest: 0.4, scheme: 'ylorrd', log: false, seed: 5, res: 120 },
  Chart: DasymetricChart,
  Controls: DasymetricControls,
  hint: '‘다지메트릭’과 ‘지역 균일’을 번갈아 보며 같은 지역 총량이 어떻게 달리 퍼지는지 확인 · 가중치를 바꿔 가정의 영향 점검',
}

