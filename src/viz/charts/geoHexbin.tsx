import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { ChartMessage, Readout, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { MapZoomButtons, useMapZoom } from '../../geo/useMapZoom'
import { project } from '../../geo/projections'
import { schemes, type ColorScheme } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { cellAreaKm2, geoHexbin, type GeoPoint } from '../../stats/geo'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { BaseMap, GeoControls, geoDefaults, latRole, lonRole, readPoints, resolvePointMap, useProjection, type GeoParams } from './geoShared'

export interface GeoHexParams extends GeoParams {
  /** Hexagon radius in km on the ground. */
  size: number
  binning: 'screen' | 'equal-area'
  agg: 'count' | 'sum' | 'mean'
  scheme: ColorScheme
  showPoints: boolean
  showMap: boolean
  opacity: number
}

const KM_PER_DEG = 111.195

function GeoHexChart({ table, mapping, params, width, height, compact, linked }: ChartProps<GeoHexParams>) {
  const { pts } = useMemo(() => readPoints(table, mapping, { lat: 'lat', lon: 'lon', value: 'value' }), [table, mapping])
  const resolved = useMemo(() => resolvePointMap(params, pts), [params, pts])
  const projection = useProjection(resolved.map, params, width, height, resolved.id)
  const svgRef = useRef<SVGSVGElement>(null)
  const zoom = useMapZoom(svgRef, { enabled: !compact, width, height })
  const { tip, show, hide } = useTooltip()
  const clon = d3.mean(pts, (p) => p.lon) ?? 0
  const clat = d3.mean(pts, (p) => p.lat) ?? 0
  const geoPts: GeoPoint[] = useMemo(() => pts.map((p) => ({ lon: p.lon, lat: p.lat, value: p.value ?? 1, row: p.row })), [pts])

  // Hexagons are binned either on the screen (regular on the map but unequal in ground area) or in an equal-area plane (equal ground area, distorted on screen).
  const bins = useMemo(() => {
    const km = compact ? params.size * 1.8 : params.size
    if (params.binning === 'equal-area') {
      const plane = d3.geoAzimuthalEqualArea().rotate([-clon, -clat]).scale(6371.0088).translate([0, 0])
      return geoHexbin(geoPts, plane, km)
    }
    const a = projection([clon, clat])
    const b = projection([clon + 0.1, clat])
    const pxPerKm = a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) / (0.1 * KM_PER_DEG * Math.cos((clat * Math.PI) / 180)) : 1
    return geoHexbin(geoPts, projection, km * pxPerKm)
  }, [geoPts, projection, params.size, params.binning, clon, clat, compact])
  const valueOf = (b: (typeof bins)[number]) => (params.agg === 'count' ? b.count : params.agg === 'sum' ? b.sum : b.sum / b.count)
  const vals = bins.map(valueOf)
  const vmax = d3.max(vals) ?? 1
  const scheme = schemes[params.scheme]
  const cells = useMemo(() => bins.map((b) => {
    const ring = b.corners.map(([lo, la]) => project(projection, lo, la))
    return { b, d: ring.every(Boolean) ? `M${(ring as [number, number][]).map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('L')}Z` : null, area: cellAreaKm2(b.corners) }
  }).filter((c) => c.d), [bins, projection])
  const marked = new Set(linked?.rows ?? [])
  const k = zoom.t.k

  if (!roleColumn(mapping, 'lat') || !roleColumn(mapping, 'lon')) return <ChartMessage>위도와 경도(숫자형) 열을 선택하세요.</ChartMessage>
  if (!pts.length) return <ChartMessage>위도(−90~90)와 경도(−180~180)가 올바른 행이 없습니다.</ChartMessage>
  if (params.agg !== 'count' && !roleColumn(mapping, 'value')) return <ChartMessage>합계·평균에는 ‘값’ 열이 필요합니다. 열을 선택하거나 개수를 고르세요.</ChartMessage>
  const areas = cells.map((c) => c.area)
  const t = (v: number) => scheme.interpolate(0.1 + 0.9 * (vmax > 0 ? v / vmax : 0))

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg map-svg" role="img" data-testid="chart-svg" aria-label={`지리적 헥스빈 지도: 점 ${pts.length}개를 육각형 ${cells.length}칸에 집계`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${zoom.t.x},${zoom.t.y}) scale(${k})`}>
          {params.showMap && <BaseMap map={resolved.map} projection={projection} />}
          {cells.map(({ b, d, area }, i) => (
            <path key={i} className="mark-hex" data-testid="geo-hex" data-count={b.count} d={d!} fill={t(valueOf(b))} fillOpacity={params.opacity} stroke={b.points.some((p) => marked.has(p.row)) ? '#e07a3f' : '#ffffff'} strokeWidth={b.points.some((p) => marked.has(p.row)) ? 2 : 0.6} vectorEffect="non-scaling-stroke"
              onPointerEnter={compact ? undefined : (e) => { linked?.set(b.points.map((p) => p.row)); const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{b.count}개</b>{params.agg !== 'count' && <><br />합계 {fmt(b.sum)} · 평균 {fmt(b.sum / b.count)}</>}<br />셀의 땅 면적 약 {fmt(area, 0)} km²</>) }}
              onPointerLeave={() => { hide(); linked?.set(null) }} />
          ))}
          {params.showPoints && !compact && pts.slice(0, 4000).map((p) => { const xy = project(projection, p.lon, p.lat); return xy ? <circle key={p.row} cx={xy[0]} cy={xy[1]} r={1.1 / k} fill="#121816" fillOpacity={0.5} pointerEvents="none" /> : null })}
        </g>
      </svg>
      {!compact && (
        <>
          <div className="color-legend"><span>{params.agg === 'count' ? '개수' : params.agg === 'sum' ? '합계' : '평균'} 0</span><span className="color-ramp" style={{ background: `linear-gradient(90deg, ${d3.range(0, 1.01, 0.1).map((v) => scheme.interpolate(0.1 + 0.9 * v)).join(',')})` }} /><span>{fmt(vmax, 3)}</span></div>
          <Readout items={[{ label: '점', value: pts.length.toLocaleString() }, { label: '칸', value: cells.length }, { label: '칸 면적', value: areas.length ? `${fmt(d3.min(areas)!, 0)}–${fmt(d3.max(areas)!, 0)} km²` : '–' }]} />
          <MapZoomButtons zoom={zoom} k={k} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function GeoHexControls({ params, setParams, table, mapping }: ControlsProps<GeoHexParams>) {
  const { pts } = useMemo(() => readPoints(table, mapping, { lat: 'lat', lon: 'lon' }), [table, mapping])
  const resolved = useMemo(() => resolvePointMap(params, pts), [params, pts])
  return (
    <>
      <ControlGroup title="집계">
        <Slider label="육각형 반지름 (땅 위 km)" value={params.size} min={3} max={150} onChange={(size) => setParams({ size })} format={(v) => `${v} km`} testId="ctl-hex-size" />
        <Segmented label="집계 평면" value={params.binning} onChange={(binning) => setParams({ binning })} testId="ctl-binning" options={[{ value: 'screen', label: '화면(투영 후)' }, { value: 'equal-area', label: '등적 평면' }]} />
        <Hint>{params.binning === 'screen' ? '지도 투영으로 평면에 옮긴 뒤 그 평면에서 육각형으로 모읍니다. 칸이 화면에서는 모두 같지만, 메르카토르 같은 투영에서는 고위도 칸이 실제로는 더 좁은 땅입니다 — 같은 개수라도 밀도가 다릅니다.' : '면적을 보존하는 방위 등적 투영 위에서 모읍니다. 모든 칸이 같은 땅 면적을 덮으므로 개수를 공정하게 비교할 수 있고, 그 칸을 지도 투영으로 옮기면 모양이 일그러져 보일 수 있습니다.'}</Hint>
        <Select label="칸의 값" value={params.agg} onChange={(agg) => setParams({ agg })} testId="ctl-agg" options={[{ value: 'count', label: '점 개수' }, { value: 'sum', label: '값 합계' }, { value: 'mean', label: '값 평균' }]} />
      </ControlGroup>
      <ControlGroup title="표현">
        <Select label="색상 팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={(Object.keys(schemes) as ColorScheme[]).filter((k) => !schemes[k].diverging).map((k) => ({ value: k, label: schemes[k].name }))} />
        <Slider label="칸 불투명도" value={params.opacity} min={0.3} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} />
        <Toggle label="원본 위치 표시" checked={params.showPoints} onChange={(showPoints) => setParams({ showPoints })} testId="ctl-points" />
        <Toggle label="배경 지도" checked={params.showMap} onChange={(showMap) => setParams({ showMap })} />
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams} resolved={resolved} /></ControlGroup>
    </>
  )
}

export const geoHexbinModule: VizModule<GeoHexParams> = {
  roles: [latRole(), lonRole(), { key: 'value', label: '값 (선택)', type: 'number', prefer: '값|value' }],
  datasets: ['geo-points', 'kr-regions'],
  defaultParams: { ...geoDefaults, size: 28, binning: 'equal-area', agg: 'count', scheme: 'viridis', showPoints: false, showMap: true, opacity: 0.85 },
  Chart: GeoHexChart,
  Controls: GeoHexControls,
  hint: '집계 평면을 ‘화면’과 ‘등적’으로 바꿔 칸 면적이 같은지 비교 · 육각형 크기 조절 · 휠·드래그로 확대와 이동',
}
