import * as d3 from 'd3'
import { useCallback, useMemo } from 'react'
import { Readout } from '../../components/chart/primitives'
import { ControlGroup, Hint, NumberField, Segmented, Select, Slider, StatTable, Toggle } from '../../components/controls'
import { schemes, type ColorScheme } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { contourLevels, gridExtent, gridIsolines, gridContours, hillshade, niceInterval, sampleGrid, slopeAspect } from '../../stats/spatial'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { colorRamp, hypsometric, pack, RampLegend, SunDial, SurfaceStage, readSurfacePoints, surfaceDefaults, surfaceRoles, useSurface, type SurfaceParams } from './geoKit'
import { GeoControls, resolvePointMap } from './geoShared'
import { useSvgId } from '../../components/chart/primitives'

/** Terrain-style charts that share one scalar surface: hillshade, slope / aspect and isolines. */

function SurfaceControls({ params, setParams, table, mapping, children }: ControlsProps<SurfaceParams> & { children?: React.ReactNode }) {
  const pts = useMemo(() => readSurfacePoints(table, mapping), [table, mapping])
  const resolved = useMemo(() => resolvePointMap(params, pts), [params, pts])
  const hills = pts.length > 0 && pts.every((p) => p.radius != null)
  return (
    <>
      {children}
      <ControlGroup title="표면 모델" defaultOpen={false}>
        <Hint>{hills ? '‘반경’ 열이 있어 각 행을 가우시안 언덕(높이·반경 km)으로 보고 지형을 합성합니다. 실측 고도 자료(DEM)가 아닙니다.' : '‘반경’ 열이 없어 각 행을 관측점으로 보고 역거리 가중(IDW)으로 표면을 보간합니다. 관측점 사이의 값은 추정입니다.'}</Hint>
        <Slider label="격자 해상도 (가로 노드 수)" value={params.gridSize} min={40} max={260} step={10} onChange={(gridSize) => setParams({ gridSize })} testId="ctl-grid" />
        {hills ? (
          <>
            <Slider label="거칠기 (m)" value={params.roughness} min={0} max={250} step={5} onChange={(roughness) => setParams({ roughness })} testId="ctl-rough" />
            <NumberField label="거칠기 난수 시드" value={params.seed} step={1} min={0} onChange={(seed) => setParams({ seed })} />
          </>
        ) : <Slider label="IDW 거리 지수" value={params.power} min={1} max={5} step={0.5} onChange={(power) => setParams({ power })} />}
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams} resolved={resolved} /></ControlGroup>
    </>
  )
}

// ─── hillshade ──────────────────────────────────────────────────────────────────────

export interface HillshadeParams extends SurfaceParams { azimuth: number; altitude: number; zFactor: number; tint: boolean; showPoints: boolean }

function HillshadeChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<HillshadeParams>) {
  const s = useSurface(table, mapping, params, compact)
  const shade = useMemo(() => hillshade(s.grid, params.azimuth, params.altitude, params.zFactor), [s.grid, params.azimuth, params.altitude, params.zFactor])
  const [lo, hi] = useMemo(() => gridExtent(s.grid), [s.grid])
  const ramp = useMemo(() => colorRamp(hypsometric), [])
  const paint = useCallback((lon: number, lat: number) => {
    const sh = sampleGrid(shade, lon, lat)
    if (!Number.isFinite(sh)) return 0
    const h = sampleGrid(s.grid, lon, lat)
    // hillshade in grey, optionally multiplied with a hypsometric tint
    const base = params.tint ? ramp[Math.max(0, Math.min(255, Math.round(((h - lo) / (hi - lo || 1)) * 255)))] : pack(255, 255, 255)
    const k = 0.18 + 0.82 * sh
    return pack(Math.round((base & 255) * k), Math.round(((base >>> 8) & 255) * k), Math.round(((base >>> 16) & 255) * k))
  }, [shade, s.grid, params.tint, ramp, lo, hi])
  const sun = !compact && <div className="stage-corner"><SunDial azimuth={params.azimuth} altitude={params.altitude} onChange={(azimuth, altitude) => setParams({ azimuth, altitude })} /></div>
  return (
    <SurfaceStage width={width} height={height} compact={compact} params={params} surface={s} paint={paint} label={`음영기복도: 광원 방위각 ${params.azimuth}도, 고도각 ${params.altitude}도`}
      info={(lon, lat) => { const h = s.at(lon, lat); return Number.isFinite(h) ? <>높이 <b>{fmt(h, 0)}</b><br />{lat.toFixed(2)}°N {lon.toFixed(2)}°E</> : null }}
      overlay={({ projection, k }) => params.showPoints && !compact ? s.points.map((p) => { const xy = projection([p.lon, p.lat]); return xy ? <circle key={p.row} cx={xy[0]} cy={xy[1]} r={2.6 / k} fill="#fff" stroke="#111" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" /> : null }) : null}
      legend={!compact && <RampLegend interpolate={hypsometric} min={fmt(lo, 0)} max={fmt(hi, 0)} label={params.tint ? '높이' : undefined} />}
      extra={<>{sun}<Readout items={[{ label: '광원', value: `${params.azimuth}° / ${params.altitude}°` }, { label: '수직 과장', value: `${params.zFactor}×` }, { label: s.model === 'hills' ? '언덕' : '관측점', value: s.points.length }]} /></>} />
  )
}

function HillshadeControls(props: ControlsProps<HillshadeParams>) {
  const { params, setParams } = props
  return (
    <SurfaceControls {...props}>
      <ControlGroup title="광원">
        <Slider label="방위각 (북=0°, 시계 방향)" value={params.azimuth} min={0} max={359} onChange={(azimuth) => setParams({ azimuth })} format={(v) => `${v}°`} testId="ctl-azimuth" />
        <Slider label="고도각 (지평선=0°)" value={params.altitude} min={5} max={90} onChange={(altitude) => setParams({ altitude })} format={(v) => `${v}°`} testId="ctl-altitude" />
        <Hint>빛이 오는 쪽을 향한 면은 밝고 반대쪽 면은 어둡습니다. 지도 위 태양 다이얼의 점을 끌어도 같은 값이 바뀝니다. 관례인 북서쪽(315°)에서 비추면 요철이 볼록하게 읽힙니다 — 남쪽에서 비추면 산이 움푹한 곳으로 보이는 착시가 생깁니다.</Hint>
      </ControlGroup>
      <ControlGroup title="표현">
        <Slider label="수직 과장" value={params.zFactor} min={0.5} max={12} step={0.5} onChange={(zFactor) => setParams({ zFactor })} format={(v) => `${v}×`} testId="ctl-zfactor" />
        <Toggle label="높이에 따른 색 입히기" checked={params.tint} onChange={(tint) => setParams({ tint })} testId="ctl-tint" />
        <Toggle label="원자료 위치 표시" checked={params.showPoints} onChange={(showPoints) => setParams({ showPoints })} />
      </ControlGroup>
    </SurfaceControls>
  )
}

export const hillshadeModule: VizModule<HillshadeParams> = {
  roles: surfaceRoles('높이 (m)'),
  datasets: ['terrain-hills', 'temp-stations'],
  defaultParams: { ...surfaceDefaults, azimuth: 315, altitude: 40, zFactor: 4, tint: true, showPoints: false },
  Chart: HillshadeChart,
  Controls: HillshadeControls,
  hint: '태양 다이얼의 점을 끌어 광원 방향을 바꿔 보세요 · 수직 과장으로 요철 강조 · 휠·드래그로 확대와 이동',
}

// ─── slope & aspect ─────────────────────────────────────────────────────────────────

export interface SlopeParams extends SurfaceParams { mode: 'slope' | 'aspect'; zFactor: number; scheme: ColorScheme; flatBelow: number }

/** Mean slope, share of cells steeper than 15° and the share of non-flat cells facing each of the eight compass directions. */
export function slopeStats(slope: ArrayLike<number>, aspect: ArrayLike<number>, flatBelow: number) {
  const bins = new Array(8).fill(0)
  let steep = 0, n = 0, sum = 0
  for (let k = 0; k < slope.length; k++) {
    const sl = slope[k]
    if (!Number.isFinite(sl)) continue
    n++; sum += sl
    if (sl > 15) steep++
    const a = aspect[k]
    if (sl >= flatBelow && Number.isFinite(a)) bins[Math.floor(((a + 22.5) % 360) / 45)]++
  }
  const tot = d3.sum(bins) || 1
  return { mean: n ? sum / n : 0, steep: n ? steep / n : 0, bins: bins.map((b) => b / tot) }
}

const ASPECT_NAMES = ['북', '북동', '동', '남동', '남', '남서', '서', '북서']
const aspectColor = (deg: number) => d3.interpolateRainbow((((deg % 360) + 360) % 360) / 360)

function SlopeChart({ table, mapping, params, width, height, compact }: ChartProps<SlopeParams>) {
  const s = useSurface(table, mapping, params, compact)
  const { slope, aspect } = useMemo(() => slopeAspect(s.grid, params.zFactor), [s.grid, params.zFactor])
  const slopeMax = useMemo(() => d3.quantile(Array.from(slope.values).filter(Number.isFinite).sort(d3.ascending), 0.98) ?? 1, [slope])
  const scheme = schemes[params.scheme]
  const slopeRamp = useMemo(() => colorRamp(scheme.interpolate), [scheme])
  const aspectRamp = useMemo(() => colorRamp(aspectColor), [])
  const stats = useMemo(() => slopeStats(slope.values, aspect.values, params.flatBelow), [slope, aspect, params.flatBelow])
  const paint = useCallback((lon: number, lat: number) => {
    const sl = sampleGrid(slope, lon, lat)
    if (!Number.isFinite(sl)) return 0
    if (params.mode === 'slope') return slopeRamp[Math.max(0, Math.min(255, Math.round((sl / slopeMax) * 255)))]
    if (sl < params.flatBelow) return pack(236, 239, 238)
    // aspect is circular: interpolate its sine and cosine, never the angle (359° and 1° are neighbours)
    const nearest = (g: typeof aspect) => g.values[Math.round(((lat - g.south) / (g.north - g.south)) * (g.ny - 1)) * g.nx + Math.round(((lon - g.west) / (g.east - g.west)) * (g.nx - 1))]
    const a = nearest(aspect)
    if (!Number.isFinite(a)) return pack(236, 239, 238)
    return aspectRamp[Math.round(((((a % 360) + 360) % 360) / 360) * 255)]
  }, [slope, aspect, params.mode, params.flatBelow, slopeRamp, aspectRamp, slopeMax])
  return (
    <SurfaceStage width={width} height={height} compact={compact} params={params} surface={s} paint={paint} label={params.mode === 'slope' ? '경사도 지도' : '사면향 지도'}
      info={(lon, lat) => {
        const sl = sampleGrid(slope, lon, lat)
        if (!Number.isFinite(sl)) return null
        const a = aspect.values[Math.round(((lat - aspect.south) / (aspect.north - aspect.south)) * (aspect.ny - 1)) * aspect.nx + Math.round(((lon - aspect.west) / (aspect.east - aspect.west)) * (aspect.nx - 1))]
        return <>경사 <b>{sl.toFixed(1)}°</b><br />사면향 {Number.isFinite(a) ? `${ASPECT_NAMES[Math.floor(((a + 22.5) % 360) / 45)]} (${a.toFixed(0)}°)` : '평탄'}</>
      }}
      legend={!compact && (params.mode === 'slope'
        ? <RampLegend interpolate={scheme.interpolate} min="0" max={fmt(slopeMax, 1)} unit="°" label="경사" />
        : <div className="color-legend"><span>사면향</span>{ASPECT_NAMES.map((n, i) => <span key={n} className="aspect-chip" style={{ background: aspectColor(i * 45) }} title={n}>{n}</span>)}</div>)}
      extra={<Readout items={[{ label: '평균 경사', value: `${stats.mean.toFixed(1)}°` }, { label: '15° 초과', value: `${(stats.steep * 100).toFixed(1)}%` }]} />} />
  )
}

function SlopeControls(props: ControlsProps<SlopeParams>) {
  const { params, setParams, table, mapping } = props
  // the panel's distribution comes from a coarse copy of the surface, so it stays cheap and independent of the chart's resolution
  const coarse = useSurface(table, mapping, { ...params, gridSize: 70 }, false)
  const stats = useMemo(() => {
    const sa = slopeAspect(coarse.grid, params.zFactor)
    return slopeStats(sa.slope.values, sa.aspect.values, params.flatBelow)
  }, [coarse.grid, params.zFactor, params.flatBelow])
  return (
    <SurfaceControls {...props}>
      <ControlGroup title="표현">
        <Segmented label="보기" value={params.mode} onChange={(mode) => setParams({ mode })} testId="ctl-slope-mode" options={[{ value: 'slope', label: '경사도' }, { value: 'aspect', label: '사면향' }]} />
        <Slider label="수직 과장" value={params.zFactor} min={0.5} max={6} step={0.5} onChange={(zFactor) => setParams({ zFactor })} format={(v) => `${v}×`} />
        {params.mode === 'slope'
          ? <Select label="색상 팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={(Object.keys(schemes) as ColorScheme[]).filter((k) => !schemes[k].diverging).map((k) => ({ value: k, label: schemes[k].name }))} />
          : <Slider label="평탄으로 보는 경사 (미만)" value={params.flatBelow} min={0} max={10} step={0.5} onChange={(flatBelow) => setParams({ flatBelow })} format={(v) => `${v}°`} testId="ctl-flat" />}
        <Hint>{params.mode === 'slope' ? '경사는 표면이 수평에서 기울어진 각도 atan(√(∂z/∂x² + ∂z/∂y²))입니다. 색 범위는 상위 2%를 잘라 낸 값까지입니다.' : '사면향은 경사면이 내려가는 쪽의 나침반 방위입니다. 방위는 원이라 359°와 1°가 이웃이므로 색도 한 바퀴 돌아 이어지는 색상환을 씁니다. 평탄한 곳은 방위가 정의되지 않아 회색으로 둡니다.'}</Hint>
      </ControlGroup>
      <ControlGroup title="사면향 분포">
        <StatTable rows={[['방위', '면적 비율'], ...ASPECT_NAMES.map((n, i) => [n, `${(stats.bins[i] * 100).toFixed(1)}%`])]} />
        <Hint>격자 전체(바다 포함)에서 경사가 평탄 기준 이상인 칸 가운데 각 방위를 향한 칸의 비율입니다.</Hint>
      </ControlGroup>
    </SurfaceControls>
  )
}

export const slopeAspectModule: VizModule<SlopeParams> = {
  roles: surfaceRoles('높이 (m)'),
  datasets: ['terrain-hills', 'temp-stations'],
  defaultParams: { ...surfaceDefaults, mode: 'slope', zFactor: 1, scheme: 'ylorrd', flatBelow: 2 },
  Chart: SlopeChart,
  Controls: SlopeControls,
  hint: '경사도와 사면향을 바꿔 보세요 · 지도 위에 포인터를 올리면 그 지점의 경사와 방향 · 수직 과장으로 경사 강조',
}

// ─── isolines ───────────────────────────────────────────────────────────────────────

export interface IsolineParams extends SurfaceParams { mode: 'lines' | 'bands'; interval: number; auto: boolean; index: number; scheme: ColorScheme; underlay: boolean }

function IsolineChart({ table, mapping, params, width, height, compact }: ChartProps<IsolineParams>) {
  const s = useSurface(table, mapping, params, compact)
  const [lo, hi] = useMemo(() => gridExtent(s.grid), [s.grid])
  const interval = params.auto ? niceInterval(lo, hi, compact ? 6 : 10) : params.interval
  const levels = useMemo(() => contourLevels(lo, hi, interval), [lo, hi, interval])
  const scheme = params.mode === 'bands' || params.underlay ? schemes[params.scheme] : null
  const clipId = useSvgId('iso-clip')
  const lines = useMemo(() => (params.mode === 'lines' ? gridIsolines(s.grid, levels) : []), [s.grid, levels, params.mode])
  const bands = useMemo(() => (params.mode === 'bands' ? gridContours(s.grid, levels) : []), [s.grid, levels, params.mode])
  const ramp = useMemo(() => colorRamp((schemes[params.scheme]).interpolate), [params.scheme])
  const paint = useCallback((lon: number, lat: number) => {
    if (params.mode !== 'lines' || !params.underlay) return 0
    const h = sampleGrid(s.grid, lon, lat)
    return Number.isFinite(h) ? (ramp[Math.max(0, Math.min(255, Math.round(((h - lo) / (hi - lo || 1)) * 255)))] & 0x00ffffff) | (150 << 24) : 0
  }, [params.mode, params.underlay, s.grid, ramp, lo, hi])
  const color = (v: number) => (scheme ?? schemes.teal).interpolate(0.12 + 0.82 * ((v - lo) / (hi - lo || 1)))
  return (
    <SurfaceStage width={width} height={height} compact={compact} params={params} surface={s} paint={paint} label={`등치선 지도: 간격 ${fmt(interval)}, 등치선 ${levels.length}개`}
      info={(lon, lat) => { const h = s.at(lon, lat); return Number.isFinite(h) ? <>값 <b>{fmt(h, 1)}</b></> : null }}
      overlay={({ projection, k }) => {
        const path = d3.geoPath(projection)
        return (
          <g>
            <defs><clipPath id={clipId}><path d={path(s.resolved.map.collection) ?? ''} /></clipPath></defs>
            <g clipPath={`url(#${clipId})`} data-testid="iso-layer">
              {bands.map((b) => <path key={b.value} className="iso-band" d={path({ type: 'MultiPolygon', coordinates: b.polygons } as never) ?? ''} fill={color(b.value)} fillOpacity={0.85} />)}
              {lines.map((l) => {
                const major = params.index > 0 && Math.round(l.value / interval) % params.index === 0
                return <path key={l.value} className="iso-line" data-level={l.value} d={path({ type: 'MultiLineString', coordinates: l.lines } as never) ?? ''} fill="none" stroke={major ? '#3b2f24' : '#8a6d4e'} strokeWidth={major ? 1.5 : 0.8} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              })}
            </g>
            {!compact && lines.length > 0 && params.index > 0 && lines.filter((l) => Math.round(l.value / interval) % params.index === 0).map((l) => {
              const longest = l.lines.reduce((a, b) => (b.length > a.length ? b : a), l.lines[0] ?? [])
              const mid = longest[Math.floor(longest.length / 2)]
              const xy = mid && projection(mid)
              return xy ? <text key={`t${l.value}`} x={xy[0]} y={xy[1]} fontSize={10 / k} textAnchor="middle" fill="#3b2f24" stroke="#fff" strokeWidth={3 / k} paintOrder="stroke" pointerEvents="none">{fmt(l.value, 0)}</text> : null
            })}
          </g>
        )
      }}
      legend={!compact && <RampLegend interpolate={(scheme ?? schemes.teal).interpolate} min={fmt(lo, 0)} max={fmt(hi, 0)} label="값" />}
      extra={<Readout items={[{ label: '간격', value: fmt(interval) }, { label: '등치선', value: levels.length }, { label: '범위', value: `${fmt(lo, 0)}–${fmt(hi, 0)}` }]} />} />
  )
}

function IsolineControls(props: ControlsProps<IsolineParams>) {
  const { params, setParams } = props
  return (
    <SurfaceControls {...props}>
      <ControlGroup title="등치선">
        <Segmented label="표현" value={params.mode} onChange={(mode) => setParams({ mode })} testId="ctl-iso-mode" options={[{ value: 'lines', label: '등치선' }, { value: 'bands', label: '등치대(색 채움)' }]} />
        <Toggle label="간격 자동" checked={params.auto} onChange={(auto) => setParams({ auto })} testId="ctl-iso-auto" />
        {!params.auto && <Slider label="간격" value={params.interval} min={1} max={500} step={1} onChange={(interval) => setParams({ interval })} testId="ctl-interval" />}
        {params.mode === 'lines' && <Slider label="계곡선(굵은 선) 주기" value={params.index} min={0} max={10} onChange={(index) => setParams({ index })} format={(v) => (v ? `${v}번째마다` : '없음')} />}
        <Hint>등치선은 값이 같은 지점을 이은 선입니다. 선이 촘촘할수록 값이 급하게 변하고, 선이 서로 만나지 않는 것은 한 지점이 두 값을 가질 수 없기 때문입니다. 등치대는 두 등치선 사이를 같은 색으로 채워 구간을 보여 줍니다.</Hint>
      </ControlGroup>
      <ControlGroup title="색상">
        <Select label="팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={(Object.keys(schemes) as ColorScheme[]).filter((k) => !schemes[k].diverging).map((k) => ({ value: k, label: schemes[k].name }))} />
        {params.mode === 'lines' && <Toggle label="높이 색 배경" checked={params.underlay} onChange={(underlay) => setParams({ underlay })} />}
      </ControlGroup>
    </SurfaceControls>
  )
}

export const isolineModule: VizModule<IsolineParams> = {
  roles: surfaceRoles('높이 또는 값'),
  datasets: ['terrain-hills', 'temp-stations'],
  defaultParams: { ...surfaceDefaults, mode: 'lines', interval: 200, auto: true, index: 5, scheme: 'teal', underlay: true },
  Chart: IsolineChart,
  Controls: IsolineControls,
  hint: '간격을 바꾸거나 등치대로 전환해 보세요 · 선이 촘촘한 곳이 가파른 곳 · 관측점 데이터셋에서는 보간 결과의 등치선',
}
