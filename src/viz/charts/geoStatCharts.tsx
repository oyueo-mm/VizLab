import * as d3 from 'd3'
import { useMemo, useState } from 'react'
import { ChartMessage } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { schemes } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { colorAt } from '../../lib/colors'
import { densityRatio, empiricalVariogram, fitRange, fitVariogram, gammaOf, krige, localKm, moranScatter, stDensity, timeDensity, type Pt, type STEvent, type VarioFit, type VarioModel } from '../../stats/geostat'
import { makeGrid, sampleGrid, type BBox, type Grid } from '../../stats/spatial'
import { distanceNeighbors, knnNeighbors, moranGlobal, symmetrize, type SpatialUnit } from '../../stats/spatialStats'
import { columnIndex, toLabel, toNumber } from '../../data/table'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, RoleSpec, VizModule } from '../types'
import { RampLegend, SurfaceStage, boxFor, colorRamp, pack, type SurfacePoint } from './geoKit'
import { BaseMap, GeoControls, geoDefaults, latRole, lonRole, readPoints, resolvePointMap, useProjection, type GeoParams } from './geoShared'
import { HeatGrid, XYPlot, type Layer } from './kit'
import { flowMapModule } from './flowMap'
import type { DataTable } from '../../data/table'

/** Geostatistics and spatial-analysis charts: Moran scatterplot, semivariograms, kriging, space-time density, OD matrix map and case–control density ratio. */

const valueRoles: RoleSpec[] = [latRole(), lonRole(), { key: 'value', label: '값', type: 'number', required: true, prefer: '값|value' }]
const needPts = <ChartMessage>위도·경도·값 열을 선택하세요. 유효한 점이 8개 이상 필요합니다.</ChartMessage>

function geoPoints(table: DataTable, mapping: Mapping) {
  const { pts } = readPoints(table, mapping, { lat: 'lat', lon: 'lon', value: 'value' })
  return pts.filter((p) => p.value != null).map((p) => ({ ...p, value: p.value as number }))
}
function localPts(table: DataTable, mapping: Mapping) {
  const g = geoPoints(table, mapping)
  const km = localKm(g)
  return { g, pts: g.map((p) => { const [x, y] = km.to(p.lon, p.lat); return { x, y, v: p.value } as Pt }), km }
}

// ─── Moran scatterplot ──────────────────────────────────────────────────────────────

export interface MoranScatterParams { weights: 'knn' | 'distance'; k: number; bandKm: number; perms: number }

function MoranScatterChart({ table, mapping, params, width, height, compact }: ChartProps<MoranScatterParams>) {
  const g = useMemo(() => geoPoints(table, mapping), [table, mapping])
  const res = useMemo(() => {
    if (g.length < 8) return null
    const units: SpatialUnit[] = g.map((p) => ({ id: String(p.row), lon: p.lon, lat: p.lat, value: p.value, rows: [p.row] }))
    const nb = params.weights === 'knn' ? symmetrize(knnNeighbors(units, params.k)) : distanceNeighbors(units, params.bandKm)
    const values = g.map((p) => p.value)
    const sc = moranScatter(values, nb)
    return { sc, moran: moranGlobal(values, nb, compact ? 0 : params.perms, 3), isolated: nb.filter((l) => !l.length).length }
  }, [g, params.weights, params.k, params.bandKm, params.perms, compact])
  if (!res) return needPts
  const { sc } = res
  const ok = sc.z.map((_, i) => i).filter((i) => Number.isFinite(sc.lag[i]))
  const quad = (i: number) => (sc.z[i] >= 0 ? (sc.lag[i] >= 0 ? 'HH' : 'HL') : sc.lag[i] >= 0 ? 'LH' : 'LL')
  const names: Record<string, [string, string]> = { HH: ['높음-높음 (HH)', '#cf4f6a'], LL: ['낮음-낮음 (LL)', '#4c6fb5'], HL: ['높음-낮음 (HL)', '#e0a43f'], LH: ['낮음-높음 (LH)', '#7ab2c7'] }
  const lim = Math.max(2.5, ...ok.map((i) => Math.abs(sc.z[i])), ...ok.map((i) => Math.abs(sc.lag[i]))) * 1.05
  const layers: Layer[] = [
    { kind: 'vline', v: 0, color: '#9aa1a9', dash: '0' }, { kind: 'hline', v: 0, color: '#9aa1a9', dash: '0' },
    { kind: 'line', x: [-lim, lim], y: [-lim * sc.slope, lim * sc.slope], color: '#111827', width: 2.2, label: `기울기 = Moran's I (${fmt(sc.slope, 2)})` },
    ...(['HH', 'LL', 'HL', 'LH'] as const).map((q): Layer => ({ kind: 'points', label: names[q][0], color: names[q][1], r: compact ? 2 : 3.6, opacity: 0.8, pts: ok.filter((i) => quad(i) === q).map((i) => ({ x: sc.z[i], y: sc.lag[i], key: String(i), tip: <><b>행 {g[i].row + 1}</b> · {q}<br />값 {fmt(g[i].value)} (z = {fmt(sc.z[i], 2)})<br />이웃 평균 z = {fmt(sc.lag[i], 2)}</> })) })),
  ]
  const counts = Object.fromEntries((['HH', 'LL', 'HL', 'LH'] as const).map((q) => [q, ok.filter((i) => quad(i) === q).length]))
  return (
    <XYPlot hover={false} layers={layers} width={width} height={height} compact={compact} xDomain={[-lim, lim]} yDomain={[-lim, lim]} equal xLabel="표준화한 값 z" yLabel="이웃 평균 Wz (공간 지연)" title={`Moran 산점도: I = ${fmt(sc.slope, 3)}`}
      readout={[{ label: "Moran's I", value: fmt(res.moran.I, 3) }, { label: '기댓값 E[I]', value: fmt(res.moran.expected, 3) }, ...(Number.isFinite(res.moran.p) ? [{ label: '순열 p', value: fmt(res.moran.p, 3) }] : []), { label: 'HH·LL', value: `${counts.HH}·${counts.LL}` }]}
      note="오른쪽 위·왼쪽 아래 점이 많을수록 양의 공간 자기상관" />
  )
}

function MoranScatterControls({ params, setParams }: ControlsProps<MoranScatterParams>) {
  return (
    <ControlGroup title="이웃 정의">
      <Segmented label="공간 가중치" value={params.weights} onChange={(weights) => setParams({ weights })} testId="ctl-weights" options={[{ value: 'knn', label: 'k-최근접' }, { value: 'distance', label: '거리 대역' }]} />
      {params.weights === 'knn' ? <Slider label="이웃 수 k" value={params.k} min={2} max={15} onChange={(k) => setParams({ k })} testId="ctl-k" /> : <Slider label="거리 대역 (km)" value={params.bandKm} min={20} max={300} step={10} onChange={(bandKm) => setParams({ bandKm })} testId="ctl-band" />}
      <Slider label="순열 횟수 (p값)" value={params.perms} min={0} max={999} step={99} onChange={(perms) => setParams({ perms })} testId="ctl-perms" />
      <Hint>가로축은 표준화한 값 z, 세로축은 이웃들의 평균 z(공간 지연 Wz)입니다. 점들을 지나는 회귀선의 기울기가 전역 Moran의 I와 같습니다(행 표준화 가중치). 오른쪽 위(HH)와 왼쪽 아래(LL)는 비슷한 값끼리 모인 곳, 왼쪽 위(LH)와 오른쪽 아래(HL)는 이웃과 다른 값을 가진 이상 위치입니다. 유의성은 값을 무작위로 섞어 I의 분포를 만든 순열 검정으로 구합니다. 이웃 정의에 따라 결과가 달라지므로 여러 값으로 확인하세요.</Hint>
    </ControlGroup>
  )
}

export const moranScatterModule: VizModule<MoranScatterParams> = {
  roles: valueRoles, datasets: ['spatial-values', 'geo-field-iso'], defaultParams: { weights: 'knn', k: 6, bandKm: 80, perms: 199 },
  Chart: MoranScatterChart, Controls: MoranScatterControls, hint: '점에 올려 위치의 값과 이웃 평균을 확인하세요 · 이웃 정의(k, 거리)를 바꿔 I가 얼마나 달라지는지 보세요',
}

// ─── semivariogram ──────────────────────────────────────────────────────────────────

export interface VariogramParams { bins: number; maxKm: number; model: 'auto' | VarioModel; showAll: boolean }
const MODEL_NAMES: Record<VarioModel, string> = { spherical: '구형(spherical)', exponential: '지수(exponential)', gaussian: '가우스(gaussian)' }
const MODEL_COLORS: Record<VarioModel, string> = { spherical: '#2a8c82', exponential: '#e07a3f', gaussian: '#4c6fb5' }

function VariogramChart({ table, mapping, params, width, height, compact }: ChartProps<VariogramParams>) {
  const { pts } = useMemo(() => localPts(table, mapping), [table, mapping])
  const res = useMemo(() => {
    if (pts.length < 10) return null
    const maxDist = params.maxKm > 0 ? params.maxKm : undefined
    const bins = empiricalVariogram(pts, { bins: params.bins, maxDist })
    const fits = (['spherical', 'exponential', 'gaussian'] as VarioModel[]).map((m) => fitVariogram(bins, m)).filter((f): f is VarioFit => !!f)
    const best = params.model === 'auto' ? fits.reduce((a, b) => (b.ssr < a.ssr ? b : a), fits[0]) : fits.find((f) => f.model === params.model) ?? fits[0]
    return { bins, fits, best }
  }, [pts, params.bins, params.maxKm, params.model])
  if (!res || !res.best) return needPts
  const { bins, fits, best } = res
  const hmax = Math.max(...bins.map((b) => b.h)) * 1.05
  const hs = d3.range(0, 81).map((i) => (hmax * i) / 80)
  const total = best.nugget + best.psill
  const ratio = total > 0 ? best.nugget / total : 0
  const layers: Layer[] = [
    ...(params.showAll ? fits.filter((f) => f !== best).map((f): Layer => ({ kind: 'line', x: hs, y: hs.map((h) => gammaOf(f, h)), color: MODEL_COLORS[f.model], width: 1.4, dash: '5 4', opacity: 0.7, label: MODEL_NAMES[f.model] })) : []),
    { kind: 'line', x: hs, y: hs.map((h) => gammaOf(best, h)), color: MODEL_COLORS[best.model], width: 3, label: `${MODEL_NAMES[best.model]} 적합` },
    { kind: 'hline', v: total, color: '#9aa1a9' }, { kind: 'vline', v: best.range, color: '#9aa1a9' },
    { kind: 'points', color: '#111827', r: 4, label: '경험적 반분산', pts: bins.map((b, i) => ({ x: b.h, y: b.gamma, r: compact ? 2.5 : 3 + Math.min(4, Math.sqrt(b.n) / 12), key: String(i), tip: <><b>거리 {fmt(b.h, 1)} km</b><br />γ = {fmt(b.gamma, 2)}<br />쌍 {b.n}개</> })) },
  ]
  return (
    <XYPlot layers={layers} width={width} height={height} compact={compact} xDomain={[0, hmax]} yDomain={[0, Math.max(...bins.map((b) => b.gamma), total) * 1.15]} xLabel="거리 h (km)" yLabel="반분산 γ(h)" title={`경험적 반분산도: ${MODEL_NAMES[best.model]}`}
      readout={[{ label: '너깃 c₀', value: fmt(best.nugget, 2) }, { label: '부분 문턱 c', value: fmt(best.psill, 2) }, { label: '범위 a', value: `${fmt(best.range, 0)} km` }, { label: '너깃 비율', value: pct(ratio, 0) }]}
      note={ratio < 0.25 ? '너깃 비율 25% 미만: 강한 공간 의존성' : ratio < 0.75 ? '너깃 비율 25~75%: 중간 의존성' : '너깃 비율 75% 초과: 약한 공간 의존성'} />
  )
}

function VariogramControls({ params, setParams }: ControlsProps<VariogramParams>) {
  return (
    <ControlGroup title="반분산도">
      <Slider label="거리 구간 수" value={params.bins} min={6} max={30} onChange={(bins) => setParams({ bins })} testId="ctl-bins" />
      <Slider label="최대 거리 (km, 0 = 자동)" value={params.maxKm} min={0} max={400} step={10} onChange={(maxKm) => setParams({ maxKm })} testId="ctl-maxkm" />
      <Select label="적합 모형" value={params.model} onChange={(model) => setParams({ model })} testId="ctl-model" options={[{ value: 'auto', label: '자동 (오차 최소)' }, { value: 'spherical', label: '구형' }, { value: 'exponential', label: '지수' }, { value: 'gaussian', label: '가우스' }]} />
      <Toggle label="다른 모형도 겹쳐 보기" checked={params.showAll} onChange={(showAll) => setParams({ showAll })} />
      <Hint>모든 점 쌍에서 거리 h 구간별로 γ(h) = ½·평균[(z_i − z_j)²]를 계산한 것이 경험적 반분산입니다. 가까운 점끼리 값이 비슷하면 γ가 작다가 거리가 늘수록 커져 문턱(sill)에서 평평해집니다. 모형(구형·지수·가우스)은 Cressie 가중(쌍 수 / 모형 γ²) 최소제곱으로 너깃(거리 0 근처의 잡음), 부분 문턱, 범위를 맞춥니다. 범위는 점들이 더 이상 닮지 않게 되는 거리로 크리깅 이웃 반경의 기준이며, 점 사이 거리는 평균 위도에서의 평면 근사(km)입니다.</Hint>
    </ControlGroup>
  )
}

export const variogramModule: VizModule<VariogramParams> = {
  roles: valueRoles, datasets: ['geo-field-iso', 'geo-field-aniso', 'spatial-values'], defaultParams: { bins: 14, maxKm: 0, model: 'auto', showAll: true },
  Chart: VariogramChart, Controls: VariogramControls, hint: '점은 거리 구간별 반분산(크기 = 쌍 수) · 모형 선택과 구간 수를 바꿔 너깃·범위가 안정적인지 확인하세요',
}

// ─── directional variogram ──────────────────────────────────────────────────────────

export interface DirVarioParams { bins: number; tolerance: number; maxKm: number; mode: 'curves' | 'map' }
const DIRS = [0, 45, 90, 135]

function DirectionalChart({ table, mapping, params, width, height, compact }: ChartProps<DirVarioParams>) {
  const { pts } = useMemo(() => localPts(table, mapping), [table, mapping])
  const res = useMemo(() => {
    if (pts.length < 20) return null
    const all: number[] = []
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) all.push(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y))
    all.sort((a, b) => a - b)
    const maxDist = params.maxKm > 0 ? params.maxKm : all[Math.floor(all.length * 0.35)]
    const omni = empiricalVariogram(pts, { bins: params.bins, maxDist })
    const omniFit = fitVariogram(omni, 'exponential')
    const dirs = DIRS.map((d) => { const b = empiricalVariogram(pts, { bins: params.bins, maxDist, direction: d, tolerance: params.tolerance }); return { d, bins: b, fit: omniFit ? fitRange(b, 'exponential', omniFit.nugget, omniFit.psill) : fitVariogram(b, 'exponential') } })
    // variogram map: mean semivariance of pairs binned by their separation vector
    const nm = 15
    const sum = new Float64Array(nm * nm), cnt = new Float64Array(nm * nm)
    for (let i = 0; i < pts.length; i++) for (let j = 0; j < pts.length; j++) {
      if (i === j) continue
      const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y
      const a = Math.floor(((dx + maxDist) / (2 * maxDist)) * nm), b = Math.floor(((dy + maxDist) / (2 * maxDist)) * nm)
      if (a < 0 || b < 0 || a >= nm || b >= nm) continue
      sum[b * nm + a] += 0.5 * (pts[i].v - pts[j].v) ** 2; cnt[b * nm + a]++
    }
    return { maxDist, omni, dirs, map: Array.from(sum, (s, i) => (cnt[i] >= 3 ? s / cnt[i] : NaN)), nm }
  }, [pts, params.bins, params.tolerance, params.maxKm])
  if (!res) return <ChartMessage>위도·경도·값 열을 선택하세요. 점이 20개 이상 필요합니다.</ChartMessage>
  const ranges = res.dirs.map((d) => d.fit?.range ?? NaN).filter(Number.isFinite)
  const aniso = ranges.length ? Math.max(...ranges) / Math.min(...ranges) : NaN
  const major = res.dirs.reduce((b, d) => ((d.fit?.range ?? 0) > (b.fit?.range ?? 0) ? d : b), res.dirs[0])
  const readout = [{ label: '이방성 비 (최대/최소 범위)', value: Number.isFinite(aniso) ? fmt(aniso, 2) : '–' }, { label: '긴 축', value: major.fit ? `${major.d}° (${fmt(major.fit.range, 0)} km)` : '–' }]
  if (params.mode === 'map') {
    const v = res.map.filter(Number.isFinite), lo = Math.min(...v), hi = Math.max(...v)
    return (
      <XYPlot layers={[{ kind: 'raster', nx: res.nm, ny: res.nm, z: res.map, x0: -res.maxDist, x1: res.maxDist, y0: -res.maxDist, y1: res.maxDist, color: (t) => schemes.viridis.interpolate(hi > lo ? (t - lo) / (hi - lo) : 0.5) }, { kind: 'points', color: '#fff', stroke: '#111827', r: 4, pts: [{ x: 0, y: 0 }] }]}
        width={width} height={height} compact={compact} equal square xDomain={[-res.maxDist, res.maxDist]} yDomain={[-res.maxDist, res.maxDist]} grid={false} pad={0} xLabel="동서 간격 (km)" yLabel="남북 간격 (km)" title="분산도 지도: 분리 벡터별 반분산" readout={readout}
        note="어두운(낮은) 방향 = 값이 오래 닮는 방향, 밝은 영역 = 빨리 달라지는 방향" />
    )
  }
  const hs = d3.range(0, 61).map((i) => (res.maxDist * 1.02 * i) / 60)
  const layers: Layer[] = [
    ...res.dirs.flatMap((d, i): Layer[] => (d.fit ? [{ kind: 'line', x: hs, y: hs.map((h) => gammaOf(d.fit!, h)), color: colorAt(i), width: 1.4, dash: '5 4', opacity: 0.65 }] : [])),
    ...res.dirs.map((d, i): Layer => ({ kind: 'points', color: colorAt(i), r: compact ? 2.5 : 4, label: `${d.d}° 방향${d.fit ? ` (범위 ${fmt(d.fit.range, 0)} km)` : ''}`, pts: d.bins.map((b, k) => ({ x: b.h, y: b.gamma, key: `${d.d}-${k}`, tip: <><b>{d.d}° 방향, {fmt(b.h, 0)} km</b><br />γ = {fmt(b.gamma, 2)} · 쌍 {b.n}</> })) })),
    { kind: 'line', x: res.omni.map((b) => b.h), y: res.omni.map((b) => b.gamma), color: '#111827', width: 2.6, label: '모든 방향' },
  ]
  return (
    <XYPlot layers={layers} width={width} height={height} compact={compact} xDomain={[0, res.maxDist * 1.02]} xLabel="거리 h (km)" yLabel="반분산 γ(h)" title={`방향별 반분산도 (허용 ±${params.tolerance}°)`} readout={readout}
      note="방향은 북쪽 기준 시계 방향의 축(0° = 남북, 90° = 동서), 점선 = 지수 모형 (너깃·문턱은 모든 방향 값으로 고정, 범위만 방향별로 적합)" />
  )
}

function DirectionalControls({ params, setParams }: ControlsProps<DirVarioParams>) {
  return (
    <ControlGroup title="방향별 분산도">
      <Segmented label="표시" value={params.mode} onChange={(mode) => setParams({ mode })} testId="ctl-mode" options={[{ value: 'curves', label: '방향별 곡선' }, { value: 'map', label: '분산도 지도' }]} />
      <Slider label="각도 허용 오차 (±°)" value={params.tolerance} min={10} max={45} step={2.5} onChange={(tolerance) => setParams({ tolerance })} testId="ctl-tol" />
      <Slider label="거리 구간 수" value={params.bins} min={6} max={20} onChange={(bins) => setParams({ bins })} testId="ctl-bins" />
      <Slider label="최대 거리 (km, 0 = 자동)" value={params.maxKm} min={0} max={400} step={10} onChange={(maxKm) => setParams({ maxKm })} testId="ctl-maxkm" />
      <Hint>공간 상관이 방향에 따라 다르면(이방성) 한 방향의 분산도로는 구조를 놓칩니다. 이 도표는 분리 벡터가 선택한 축 ±허용 오차 이내인 점 쌍만 모아 4개 방향(0°, 45°, 90°, 135°)의 분산도를 따로 그리고, 범위의 비를 이방성 비로 보고합니다. 분산도 지도는 모든 분리 벡터(Δx, Δy)별 반분산을 2차원으로 칠해, 어두운 영역의 모양(타원)이 상관이 이어지는 방향을 직접 보여줍니다. 방향이 정해지면 크리깅의 거리를 그 방향으로 늘려 계산하는 이방성 크리깅이 가능합니다.</Hint>
    </ControlGroup>
  )
}

export const directionalModule: VizModule<DirVarioParams> = {
  roles: valueRoles, datasets: ['geo-field-aniso', 'geo-field-iso'], defaultParams: { bins: 10, tolerance: 22.5, maxKm: 0, mode: 'curves' },
  Chart: DirectionalChart, Controls: DirectionalControls, hint: '이방성 데이터에서 45° 방향의 범위가 135° 방향보다 훨씬 길게 나옵니다 · 분산도 지도로 방향을 직접 확인하세요',
}

// ─── kriging map ────────────────────────────────────────────────────────────────────

export interface KrigingParams extends GeoParams { model: 'auto' | VarioModel; k: number; show: 'pred' | 'sd'; gridSize: number; points: boolean }

function KrigingChart({ table, mapping, params, width, height, compact }: ChartProps<KrigingParams>) {
  const { g, pts, km } = useMemo(() => localPts(table, mapping), [table, mapping])
  const resolved = useMemo(() => resolvePointMap(params, g), [params, g])
  const surface = useMemo(() => {
    if (g.length < 10) return null
    const box = boxFor(resolved, g, 0.1)
    const bins = empiricalVariogram(pts, { bins: 14 })
    const fits = (['spherical', 'exponential', 'gaussian'] as VarioModel[]).map((m) => fitVariogram(bins, m)).filter((f): f is VarioFit => !!f)
    const fit = params.model === 'auto' ? fits.reduce((a, b) => (b.ssr < a.ssr ? b : a), fits[0]) : fits.find((f) => f.model === params.model) ?? fits[0]
    if (!fit) return null
    const nx = Math.max(24, Math.round((compact ? 0.4 : 1) * params.gridSize))
    const ny = Math.max(24, Math.round((nx * (box.north - box.south)) / ((box.east - box.west) * Math.cos((((box.north + box.south) / 2) * Math.PI) / 180))))
    const cache = new Map<string, { pred: number; variance: number }>()
    const at = (lon: number, lat: number) => { const [x, y] = km.to(lon, lat); const key = `${x.toFixed(2)}|${y.toFixed(2)}`; let r = cache.get(key); if (!r) { r = krige(pts, fit, x, y, params.k); cache.set(key, r) } return r }
    const pred = makeGrid(box, nx, ny, (lon, lat) => at(lon, lat).pred), sd = makeGrid(box, nx, ny, (lon, lat) => Math.sqrt(at(lon, lat).variance))
    const points: SurfacePoint[] = g.map((p) => ({ row: p.row, lat: p.lat, lon: p.lon, value: p.value, radius: null, label: '' }))
    return { box, fit, pred, sd, points }
  }, [g, pts, km, resolved, params.model, params.k, params.gridSize, compact])
  if (!surface) return needPts
  const grid: Grid = params.show === 'pred' ? surface.pred : surface.sd
  const vals = Array.from(grid.values).filter(Number.isFinite)
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const interp = params.show === 'pred' ? schemes.viridis.interpolate : schemes.ylorrd.interpolate
  const ramp = colorRamp(interp)
  const paint = (lon: number, lat: number) => { const v = sampleGrid(grid, lon, lat); return Number.isFinite(v) ? ramp[Math.max(0, Math.min(255, Math.round(((v - lo) / (hi - lo || 1)) * 255)))] : 0 }
  const range = d3.extent(g, (p) => p.value) as [number, number]
  return (
    <SurfaceStage width={width} height={height} compact={compact} params={params} surface={{ box: surface.box, resolved, points: surface.points }} paint={paint} label={`크리깅 지도: ${MODEL_NAMES[surface.fit.model]}`}
      info={(lon, lat) => { const p = sampleGrid(surface.pred, lon, lat), s = sampleGrid(surface.sd, lon, lat); return Number.isFinite(p) ? <>예측 <b>{fmt(p, 2)}</b> ± {fmt(s, 2)}<br />{lat.toFixed(2)}°N {lon.toFixed(2)}°E</> : null }}
      overlay={({ projection, k }) => params.points && !compact ? surface.points.map((p) => { const xy = projection([p.lon, p.lat]); return xy ? <circle key={p.row} cx={xy[0]} cy={xy[1]} r={3.2 / k} fill={schemes.viridis.interpolate((p.value - range[0]) / (range[1] - range[0] || 1))} stroke="#fff" strokeWidth={1 / k} pointerEvents="none" /> : null }) : null}
      legend={!compact && <RampLegend interpolate={interp} min={fmt(lo, 1)} max={fmt(hi, 1)} label={params.show === 'pred' ? '예측값' : '크리깅 표준오차'} />}
      extra={!compact && <dl className="chart-readout">{[['모형', MODEL_NAMES[surface.fit.model].split('(')[0]], ['범위', `${fmt(surface.fit.range, 0)} km`], ['너깃', fmt(surface.fit.nugget, 1)], ['문턱', fmt(surface.fit.nugget + surface.fit.psill, 1)]].map(([a, b]) => <div key={a}><dt>{a}</dt><dd>{b}</dd></div>)}</dl>} />
  )
}

function KrigingControls({ params, setParams, table, mapping }: ControlsProps<KrigingParams>) {
  const g = useMemo(() => geoPoints(table, mapping), [table, mapping])
  const resolved = useMemo(() => resolvePointMap(params, g), [params, g])
  return (
    <>
      <ControlGroup title="크리깅">
        <Segmented label="표시" value={params.show} onChange={(show) => setParams({ show })} testId="ctl-show" options={[{ value: 'pred', label: '예측값' }, { value: 'sd', label: '불확실성(표준오차)' }]} />
        <Select label="분산도 모형" value={params.model} onChange={(model) => setParams({ model })} testId="ctl-model" options={[{ value: 'auto', label: '자동 (오차 최소)' }, { value: 'spherical', label: '구형' }, { value: 'exponential', label: '지수' }, { value: 'gaussian', label: '가우스' }]} />
        <Slider label="이웃 표본 수 k" value={params.k} min={4} max={24} onChange={(k) => setParams({ k })} testId="ctl-k" />
        <Slider label="격자 해상도" value={params.gridSize} min={40} max={110} step={10} onChange={(gridSize) => setParams({ gridSize })} testId="ctl-grid" />
        <Toggle label="측정 지점 표시" checked={params.points} onChange={(points) => setParams({ points })} />
        <Hint>측정점에서 반분산도를 모형으로 맞추고, 격자의 각 지점에서 가까운 k개 표본의 가중 평균으로 값을 예측합니다(보통 크리깅). 가중치는 ‘표본 간 분산도 행렬’과 ‘표본–예측점 분산도 벡터’로 이루어진 연립방정식 [Γ 1; 1ᵀ 0][w; μ] = [γ₀; 1]을 풀어 구하며 합이 1입니다. 같은 식에서 예측의 분산(크리깅 분산 = Σwγ₀ + μ)이 함께 나오므로, IDW와 달리 ‘얼마나 믿을 수 있는지’를 지도로 볼 수 있습니다: 측정점에서는 0, 멀어지면 문턱 수준으로 커집니다. 모형이 틀렸거나 비정상(추세)이면 불확실성이 과소 평가됩니다.</Hint>
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams} resolved={resolved} /></ControlGroup>
    </>
  )
}

export const krigingModule: VizModule<KrigingParams> = {
  roles: valueRoles, datasets: ['geo-field-iso', 'geo-field-aniso', 'spatial-values'], defaultParams: { ...geoDefaults, model: 'auto', k: 12, show: 'pred', gridSize: 70, points: true },
  Chart: KrigingChart, Controls: KrigingControls, hint: '표시를 ‘불확실성’으로 바꾸면 측정점에서 멀수록 오차가 커지는 것이 보입니다 · 지도 위를 움직이면 예측값과 표준오차',
}

// ─── space-time kernel density ──────────────────────────────────────────────────────

export interface STKdeParams extends GeoParams { time: number; hsKm: number; htDays: number; events: boolean }
const stRoles: RoleSpec[] = [latRole(), lonRole(), { key: 'time', label: '시간 (일 등 숫자)', type: 'number', required: true, prefer: '일|시간|time|day|발생' }]

function SpaceTimeChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<STKdeParams>) {
  const data = useMemo(() => {
    const li = columnIndex(table, roleColumn(mapping, 'lat')), oi = columnIndex(table, roleColumn(mapping, 'lon')), ti = columnIndex(table, roleColumn(mapping, 'time'))
    const out: { lat: number; lon: number; t: number; row: number }[] = []
    if (li >= 0 && oi >= 0 && ti >= 0) table.rows.forEach((r, row) => { const lat = toNumber(r[li]), lon = toNumber(r[oi]), t = toNumber(r[ti]); if (lat != null && lon != null && t != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) out.push({ lat, lon, t, row }) })
    return out
  }, [table, mapping])
  const km = useMemo(() => localKm(data), [data])
  const events = useMemo<STEvent[]>(() => data.map((d) => { const [x, y] = km.to(d.lon, d.lat); return { x, y, t: d.t } }), [data, km])
  const resolved = useMemo(() => resolvePointMap(params, data), [params, data])
  const model = useMemo(() => {
    if (data.length < 10) return null
    const box = boxFor(resolved, data, 0.1)
    const t0 = Math.min(...data.map((d) => d.t)), t1 = Math.max(...data.map((d) => d.t))
    const nx = compact ? 36 : 64
    const ny = Math.max(20, Math.round((nx * (box.north - box.south)) / ((box.east - box.west) * Math.cos((((box.north + box.south) / 2) * Math.PI) / 180))))
    const at = (t: number, bx: BBox, mx: number, my: number) => makeGrid(bx, mx, my, (lon, lat) => { const [x, y] = km.to(lon, lat); return stDensity(events, params.hsKm, params.htDays, x, y, t) })
    // one common colour scale: the largest density seen over eight evenly spaced times (coarse grid)
    let peak = 0
    for (let i = 0; i < 8; i++) { const gr = at(t0 + ((t1 - t0) * i) / 7, box, 26, 30); for (const v of gr.values) peak = Math.max(peak, v) }
    return { box, t0, t1, nx, ny, peak: peak || 1, at }
  }, [data, resolved, km, events, params.hsKm, params.htDays, compact])
  const t = model ? model.t0 + params.time * (model.t1 - model.t0) : 0
  const grid = useMemo(() => (model ? model.at(t, model.box, model.nx, model.ny) : null), [model, t])
  if (!model || !grid) return <ChartMessage>위도·경도·시간(숫자) 열을 선택하세요. 사건이 10개 이상 필요합니다.</ChartMessage>
  const ramp = colorRamp(schemes.ylorrd.interpolate)
  const paint = (lon: number, lat: number) => { const v = sampleGrid(grid, lon, lat); return Number.isFinite(v) ? (v / model.peak < 0.02 ? 0 : ramp[Math.max(0, Math.min(255, Math.round((v / model.peak) * 255)))]) : 0 }
  let top = 0, tj = 0
  grid.values.forEach((v, i) => { if (v > top) { top = v; tj = i } })
  const hot = { lon: model.box.west + ((tj % model.nx) / (model.nx - 1)) * (model.box.east - model.box.west), lat: model.box.south + (Math.floor(tj / model.nx) / (model.ny - 1)) * (model.box.north - model.box.south) }
  const near = data.filter((d) => Math.abs(d.t - t) <= params.htDays)
  const ts = d3.range(0, 80).map((i) => model.t0 + ((model.t1 - model.t0) * i) / 79)
  const lam = ts.map((x) => timeDensity(events, params.htDays, x))
  const lmax = Math.max(...lam, 1e-9)
  const sw = Math.min(300, width - 40)
  const points: SurfacePoint[] = data.map((d) => ({ row: d.row, lat: d.lat, lon: d.lon, value: d.t, radius: null, label: '' }))
  return (
    <SurfaceStage width={width} height={height} compact={compact} params={params} surface={{ box: model.box, resolved, points }} paint={paint} label={`시공간 커널 밀도: ${fmt(t, 1)}일`}
      info={(lon, lat) => { const [x, y] = km.to(lon, lat); const v = stDensity(events, params.hsKm, params.htDays, x, y, t); return <>밀도 <b>{(v * 1e4).toFixed(2)}</b> (×10⁻⁴ /km²/일)<br />{lat.toFixed(2)}°N {lon.toFixed(2)}°E</> }}
      overlay={({ projection, k }) => params.events && !compact ? near.map((d) => { const xy = projection([d.lon, d.lat]); return xy ? <circle key={d.row} cx={xy[0]} cy={xy[1]} r={2.4 / k} fill="#111827" fillOpacity={0.55 * (1 - Math.abs(d.t - t) / (params.htDays * 1.05))} pointerEvents="none" /> : null }) : null}
      legend={!compact && <RampLegend interpolate={schemes.ylorrd.interpolate} min="0" max="최대 밀도" label="시공간 밀도 (같은 눈금)" />}
      extra={!compact && (
        <>
          <dl className="chart-readout"><div><dt>시점</dt><dd>{fmt(t, 1)}일</dd></div><div><dt>창 안 사건</dt><dd>{near.length}</dd></div><div><dt>핫스팟</dt><dd>{hot.lat.toFixed(2)}°N {hot.lon.toFixed(2)}°E</dd></div></dl>
          <svg width={sw} height={56} style={{ position: 'absolute', left: 14, bottom: 46, background: 'rgba(255,255,255,.9)', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'ew-resize', zIndex: 2 }} data-testid="st-strip"
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setParams({ time: Math.max(0, Math.min(1, (e.clientX - r.left - 8) / (sw - 16))) }) }}>
            <path d={`M8,48 ${lam.map((v, i) => `L${8 + (i / 79) * (sw - 16)},${48 - (v / lmax) * 34}`).join(' ')} L${sw - 8},48 Z`} fill="#e07a3f" fillOpacity={0.35} stroke="#e07a3f" />
            <line x1={8 + params.time * (sw - 16)} x2={8 + params.time * (sw - 16)} y1={6} y2={50} stroke="#111827" strokeWidth={2} />
            <text x={8} y={12} fontSize={10} fill="#374151">시간 분포 (눌러서 이동)</text>
          </svg>
        </>
      )} />
  )
}

function SpaceTimeControls({ params, setParams, table, mapping }: ControlsProps<STKdeParams>) {
  const g = useMemo(() => { const { pts } = readPoints(table, mapping, { lat: 'lat', lon: 'lon' }); return pts }, [table, mapping])
  const resolved = useMemo(() => resolvePointMap(params, g), [params, g])
  return (
    <>
      <ControlGroup title="시공간 밀도">
        <Slider label="시점 (전체 기간의 비율)" value={params.time} min={0} max={1} step={0.01} onChange={(time) => setParams({ time })} testId="ctl-time" format={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="공간 대역폭 hₛ (km)" value={params.hsKm} min={10} max={80} step={5} onChange={(hsKm) => setParams({ hsKm })} testId="ctl-hs" />
        <Slider label="시간 대역폭 hₜ (일)" value={params.htDays} min={1} max={20} onChange={(htDays) => setParams({ htDays })} testId="ctl-ht" />
        <Toggle label="시간 창 안의 사건 표시" checked={params.events} onChange={(events) => setParams({ events })} />
        <Hint>f(x, y, t) = (1/n) Σ K_hs(‖s − s_i‖) · K_ht(t − t_i)로 위치와 시간을 곱 커널(2차원 가우스 × 1차원 가우스)로 동시에 평활합니다. 모든 시점이 같은 색 눈금을 쓰므로 시간을 움직이면 핫스팟의 세기와 위치가 변하는 것을 비교할 수 있습니다. 공간만 보는 커널 밀도(‘핫스팟 지도’)는 시간을 모두 합쳐 이동하는 군집을 한곳에 뭉개지만, 시공간 밀도는 군집이 언제 어디에 있었는지를 분리합니다. 대역폭이 크면 부드럽지만 이동이 흐려집니다.</Hint>
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams} resolved={resolved} /></ControlGroup>
    </>
  )
}

export const spaceTimeModule: VizModule<STKdeParams> = {
  roles: stRoles, datasets: ['events-spacetime'], defaultParams: { ...geoDefaults, time: 0.1, hsKm: 35, htDays: 6, events: true },
  Chart: SpaceTimeChart, Controls: SpaceTimeControls, hint: '시점을 움직이면 핫스팟이 서울에서 대전·부산 쪽으로 이동합니다 · 아래 작은 그래프를 눌러 시점 이동 · 대역폭으로 평활 정도 조절',
}

// ─── OD matrix map ──────────────────────────────────────────────────────────────────

export interface OdParams extends GeoParams { minShare: number; curve: number; norm: 'count' | 'row'; hot: string }

function OdChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<OdParams>) {
  const data = useMemo(() => {
    const ix = (k: string) => columnIndex(table, roleColumn(mapping, k))
    const [fi, ti, vi, la0, lo0, la1, lo1] = ['from', 'to', 'value', 'lat0', 'lon0', 'lat1', 'lon1'].map(ix)
    const flows: { from: string; to: string; v: number; a: [number, number]; b: [number, number] }[] = []
    if ([fi, ti, vi, la0, lo0, la1, lo1].every((i) => i >= 0)) table.rows.forEach((r) => {
      const v = toNumber(r[vi]), c = [la0, lo0, la1, lo1].map((i) => toNumber(r[i]))
      if (v != null && v > 0 && c.every((x) => x != null)) flows.push({ from: toLabel(r[fi]), to: toLabel(r[ti]), v, a: [c[1]!, c[0]!], b: [c[3]!, c[2]!] })
    })
    return flows
  }, [table, mapping])
  const [selected, setSelected] = useState<[string, string] | null>(null)
  const matrix = useMemo(() => {
    const out = new Map<string, number>(), outSum = new Map<string, number>(), inSum = new Map<string, number>(), loc = new Map<string, [number, number]>()
    for (const f of data) { out.set(`${f.from}→${f.to}`, (out.get(`${f.from}→${f.to}`) ?? 0) + f.v); outSum.set(f.from, (outSum.get(f.from) ?? 0) + f.v); inSum.set(f.to, (inSum.get(f.to) ?? 0) + f.v); loc.set(f.from, f.a); loc.set(f.to, f.b) }
    const places = [...new Set(data.flatMap((f) => [f.from, f.to]))]
    const rows = [...places].sort((a, b) => (outSum.get(b) ?? 0) - (outSum.get(a) ?? 0)), cols = [...places].sort((a, b) => (inSum.get(b) ?? 0) - (inSum.get(a) ?? 0))
    return { out, outSum, inSum, loc, rows, cols }
  }, [data])
  const endpoints = useMemo(() => [...matrix.loc.values()].map(([lon, lat]) => ({ lon, lat })), [matrix])
  const resolved = useMemo(() => resolvePointMap(params, endpoints), [params, endpoints])
  const mapW = compact ? width : Math.floor(width * 0.56), matW = width - mapW
  const projection = useProjection(resolved.map, params, mapW, height, resolved.id)
  if (!data.length) return <ChartMessage>출발·도착 이름, 값, 출발·도착 좌표 열을 선택하세요.</ChartMessage>
  const total = data.reduce((s, f) => s + f.v, 0), vmax = Math.max(...data.map((f) => f.v))
  const values = matrix.rows.map((r) => matrix.cols.map((c) => { const v = matrix.out.get(`${r}→${c}`); return v == null ? NaN : params.norm === 'row' ? v / (matrix.outSum.get(r) || 1) : v }))
  const vmaxM = Math.max(...values.flat().filter(Number.isFinite), 1e-9)
  const hotKey = selected ? `${selected[0]}→${selected[1]}` : ''
  const top = [...data].sort((a, b) => b.v - a.v)[0]
  const recip = (() => { let s = 0; for (const [k, v] of matrix.out) { const [a, b] = k.split('→'); s += Math.min(v, matrix.out.get(`${b}→${a}`) ?? 0) } return s / total })()
  const net = matrix.rows.map((p) => ({ p, n: (matrix.inSum.get(p) ?? 0) - (matrix.outSum.get(p) ?? 0) })).sort((a, b) => b.n - a.n)[0]
  const map = (
    <svg width={mapW} height={height} className="chart-svg map-svg" role="img" data-testid="chart-svg" aria-label="출발지-도착지 흐름 지도">
      <BaseMap map={resolved.map} projection={projection} />
      <g>
        {[...data].filter((f) => f.v / vmax >= params.minShare).sort((a, b) => a.v - b.v).map((f, i) => {
          const p = projection(f.a), q = projection(f.b)
          if (!p || !q) return null
          const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2, dx = q[0] - p[0], dy = q[1] - p[1]
          const on = hotKey === `${f.from}→${f.to}`
          return <path key={i} data-testid="od-arc" d={`M${p[0]},${p[1]}Q${mx - dy * params.curve},${my + dx * params.curve} ${q[0]},${q[1]}`} fill="none" stroke={on ? '#e11d48' : '#2f6fb3'} strokeOpacity={hotKey && !on ? 0.12 : 0.55} strokeWidth={Math.max(0.6, (f.v / vmax) * (compact ? 4 : 9))} strokeLinecap="round" onPointerEnter={() => setSelected([f.from, f.to])} />
        })}
        {!compact && [...matrix.loc].map(([n, [lo, la]]) => { const p = projection([lo, la]); return p ? <g key={n} transform={`translate(${p[0]},${p[1]})`} pointerEvents="none"><circle r={3.5} fill="#111827" /><text x={6} y={-4} fontSize={10.5} fill="#111827" stroke="#fff" strokeWidth={2.4} paintOrder="stroke">{n}</text></g> : null })}
      </g>
    </svg>
  )
  if (compact) return <div className="chart-root">{map}</div>
  return (
    <div style={{ width, height, display: 'flex' }}>
      <div style={{ width: matW, height, position: 'relative' }}>
        <HeatGrid rows={matrix.rows} cols={matrix.cols} values={values} width={matW} height={height} rowTitle="출발" colTitle="도착" title="출발지–도착지 이동 행렬" rightPad={8} bottomPad={44}
          color={(v) => schemes.blues.interpolate(0.08 + 0.92 * Math.sqrt(v / vmaxM))} text={(v) => (params.norm === 'row' ? `${Math.round(v * 100)}` : v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v)))}
          selected={selected ? [matrix.rows.indexOf(selected[0]), matrix.cols.indexOf(selected[1])] : null} onCell={(i, j) => setSelected([matrix.rows[i], matrix.cols[j]])} labelEvery={Math.ceil(matrix.rows.length / 16)}
          tip={(i, j, v) => { setSelected([matrix.rows[i], matrix.cols[j]]); return <><b>{matrix.rows[i]} → {matrix.cols[j]}</b><br />{params.norm === 'row' ? `${fmt(v * 100, 1)}% (출발지의 유출 중)` : fmt(v, 0)}</> }} />
      </div>
      <div style={{ width: mapW, height, position: 'relative' }}>
        {map}
        <dl className="chart-readout" style={{ maxWidth: '90%' }}><div><dt>총 이동</dt><dd>{fmt(total, 0)}</dd></div><div><dt>최대 흐름</dt><dd>{top.from}→{top.to}</dd></div><div><dt>상호성</dt><dd>{pct(recip, 0)}</dd></div>{net && <div><dt>순유입 1위</dt><dd>{net.p}</dd></div>}</dl>
        {selected && <button type="button" className="btn btn-secondary btn-sm" style={{ position: 'absolute', left: 8, bottom: 8 }} onClick={() => { setSelected(null); setParams({ hot: '' }) }}>선택 해제</button>}
      </div>
    </div>
  )
}

function OdControls({ params, setParams, table, mapping }: ControlsProps<OdParams>) {
  const pts = useMemo(() => { const { pts } = readPoints(table, mapping, { lat: 'lat0', lon: 'lon0' }); return pts }, [table, mapping])
  const resolved = useMemo(() => resolvePointMap(params, pts), [params, pts])
  return (
    <>
      <ControlGroup title="흐름과 행렬">
        <Segmented label="행렬 값" value={params.norm} onChange={(norm) => setParams({ norm })} testId="ctl-norm" options={[{ value: 'count', label: '이동량' }, { value: 'row', label: '출발지 내 비율' }]} />
        <Slider label="작은 흐름 숨기기 (최대 대비)" value={params.minShare} min={0} max={0.5} step={0.02} onChange={(minShare) => setParams({ minShare })} testId="ctl-minshare" format={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="호의 휘어짐" value={params.curve} min={0} max={0.4} step={0.02} onChange={(curve) => setParams({ curve })} testId="ctl-curve" />
        <Hint>왼쪽은 OD(출발–도착) 행렬로 행은 출발지(유출이 큰 순), 열은 도착지(유입이 큰 순)입니다. 오른쪽 지도는 같은 흐름을 호로 그린 것으로, 행렬의 칸이나 호에 올리면 서로 강조됩니다. 지도만 보면 호가 겹쳐 값을 읽기 어렵고, 행렬만 보면 위치를 알기 어렵다는 점을 서로 보완합니다. 상호성은 두 지역 사이의 양방향 이동 중 겹치는 양(Σmin(f_ij, f_ji))의 비율이며, 순유입 1위는 (유입 − 유출)이 가장 큰 지역입니다. 표시된 값은 표에 있는 흐름뿐이며 흐름이 없는 칸은 비어 있습니다.</Hint>
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams} resolved={resolved} /></ControlGroup>
    </>
  )
}

export const odModule: VizModule<OdParams> = {
  roles: flowMapModule.roles, datasets: ['kr-flows', 'world-flows'], defaultParams: { ...geoDefaults, minShare: 0, curve: 0.18, norm: 'count', hot: '' },
  Chart: OdChart, Controls: OdControls, hint: '행렬의 칸이나 지도의 호에 올리면 서로 연동되어 강조됩니다 · 행렬 값을 비율로 바꿔 출발지별 목적지 구성을 비교하세요',
}

// ─── case–control density ratio ─────────────────────────────────────────────────────

export interface RatioParams extends GeoParams { bandKm: number; sig: boolean; caseGroup: string; points: boolean }
const ratioRoles: RoleSpec[] = [latRole(), lonRole(), { key: 'group', label: '집단 (환자·대조군 2개)', type: 'category', required: true, prefer: '집단|group|구분' }]

function RatioChart({ table, mapping, params, width, height, compact }: ChartProps<RatioParams>) {
  const { pts } = useMemo(() => readPoints(table, mapping, { lat: 'lat', lon: 'lon', group: 'group' }), [table, mapping])
  const groups = useMemo(() => [...new Set(pts.map((p) => p.group))].filter(Boolean), [pts])
  const caseName = groups.includes(params.caseGroup) ? params.caseGroup : groups.find((g) => /환자|case|양성|1/i.test(g)) ?? groups[0]
  const km = useMemo(() => localKm(pts), [pts])
  const resolved = useMemo(() => resolvePointMap(params, pts), [params, pts])
  const model = useMemo(() => {
    if (groups.length < 2 || pts.length < 20) return null
    const loc = pts.map((p) => { const [x, y] = km.to(p.lon, p.lat); return { x, y, g: p.group, lon: p.lon, lat: p.lat } })
    const cases = loc.filter((p) => p.g === caseName), controls = loc.filter((p) => p.g !== caseName)
    if (cases.length < 5 || controls.length < 5) return null
    const box = boxFor(resolved, pts, 0.08)
    // a regular lon/lat lattice is also a regular lattice in the local km frame (the mapping is affine)
    const lattice = (nx: number) => {
      const ny = Math.max(16, Math.round((nx * (box.north - box.south)) / ((box.east - box.west) * Math.cos((((box.north + box.south) / 2) * Math.PI) / 180))))
      const lons = d3.range(nx).map((i) => box.west + ((box.east - box.west) * i) / (nx - 1)), lats = d3.range(ny).map((j) => box.south + ((box.north - box.south) * j) / (ny - 1))
      return { nx, ny, gx: lons.map((lon) => km.to(lon, lats[0])[0]), gy: lats.map((lat) => km.to(lons[0], lat)[1]) }
    }
    const asGrid = (l: { nx: number; ny: number }, values: number[]): Grid => ({ nx: l.nx, ny: l.ny, west: box.west, east: box.east, south: box.south, north: box.north, values: Float64Array.from(values) })
    const fine = lattice(compact ? 28 : 56)
    const ratioGrid = asGrid(fine, densityRatio(cases, controls, params.bandKm, fine.gx, fine.gy, 0).logRatio)
    let pGrid: Grid | null = null
    if (params.sig && !compact) { const c = lattice(26); pGrid = asGrid(c, densityRatio(cases, controls, params.bandKm, c.gx, c.gy, 29, 7).p) }
    return { box, ratioGrid, pGrid, nCases: cases.length, nControls: controls.length }
  }, [pts, groups.length, caseName, km, resolved, params.bandKm, params.sig, compact])
  if (!model) return <ChartMessage>위도·경도와 서로 다른 두 집단(예: 환자·대조군)이 있는 열을 선택하세요. 각 집단에 5개 이상 필요합니다.</ChartMessage>
  const vals = Array.from(model.ratioGrid.values).filter((v) => Number.isFinite(v) && Math.abs(v) < 8)
  const lim = Math.max(0.5, Math.min(3, d3.quantile(vals.map(Math.abs).sort((a, b) => a - b), 0.97) ?? 1))
  const ramp = colorRamp((t) => d3.interpolateRdBu(1 - t))
  const paint = (lon: number, lat: number) => {
    const v = sampleGrid(model.ratioGrid, lon, lat)
    if (!Number.isFinite(v)) return 0
    const c = ramp[Math.max(0, Math.min(255, Math.round(((Math.max(-lim, Math.min(lim, v)) + lim) / (2 * lim)) * 255)))]
    if (!model.pGrid) return c
    const p = sampleGrid(model.pGrid, lon, lat)
    if (Number.isFinite(p) && p <= 0.1) return c
    // not significant: wash out towards white
    const r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255
    return pack(Math.round(r * 0.35 + 255 * 0.65), Math.round(g * 0.35 + 255 * 0.65), Math.round(b * 0.35 + 255 * 0.65))
  }
  const points: SurfacePoint[] = pts.map((p) => ({ row: p.row, lat: p.lat, lon: p.lon, value: p.group === caseName ? 1 : 0, radius: null, label: p.group }))
  return (
    <SurfaceStage width={width} height={height} compact={compact} params={params} surface={{ box: model.box, resolved, points }} paint={paint} label={`밀도비 지도: ${caseName} 대 대조군의 로그 상대 위험`}
      info={(lon, lat) => { const v = sampleGrid(model.ratioGrid, lon, lat); return Number.isFinite(v) ? <>로그 밀도비 <b>{fmt(v, 2)}</b> (상대 위험 {fmt(Math.exp(v), 2)}배)<br />{lat.toFixed(2)}°N {lon.toFixed(2)}°E</> : null }}
      overlay={({ projection, k }) => params.points && !compact ? points.map((p) => { const xy = projection([p.lon, p.lat]); return xy ? <circle key={p.row} cx={xy[0]} cy={xy[1]} r={1.8 / k} fill={p.value ? '#7f1d1d' : '#1e3a8a'} fillOpacity={0.55} pointerEvents="none" /> : null }) : null}
      legend={!compact && <RampLegend interpolate={(t) => d3.interpolateRdBu(1 - t)} min={`${fmt(Math.exp(-lim), 2)}배`} max={`${fmt(Math.exp(lim), 2)}배`} label={`상대 위험 (빨강 = ${caseName} 과밀)`} />}
      extra={!compact && <dl className="chart-readout"><div><dt>{caseName}</dt><dd>{model.nCases}</dd></div><div><dt>대조군</dt><dd>{model.nControls}</dd></div><div><dt>대역폭</dt><dd>{params.bandKm} km</dd></div>{params.sig && <div><dt>유의성</dt><dd>순열 29회, p ≤ 0.1만 진하게</dd></div>}</dl>} />
  )
}

function RatioControls({ params, setParams, table, mapping }: ControlsProps<RatioParams>) {
  const { pts } = useMemo(() => readPoints(table, mapping, { lat: 'lat', lon: 'lon', group: 'group' }), [table, mapping])
  const groups = [...new Set(pts.map((p) => p.group))].filter(Boolean)
  const resolved = useMemo(() => resolvePointMap(params, pts), [params, pts])
  return (
    <>
      <ControlGroup title="밀도비">
        {groups.length > 1 && <Select label="관심 집단(분자)" value={groups.includes(params.caseGroup) ? params.caseGroup : groups.find((g) => /환자|case|양성/i.test(g)) ?? groups[0]} onChange={(caseGroup) => setParams({ caseGroup })} options={groups.map((g) => ({ value: g, label: g }))} testId="ctl-case" />}
        <Slider label="커널 대역폭 (km)" value={params.bandKm} min={10} max={80} step={5} onChange={(bandKm) => setParams({ bandKm })} testId="ctl-band" />
        <Toggle label="유의하지 않은 곳을 흐리게 (순열 검정)" checked={params.sig} onChange={(sig) => setParams({ sig })} testId="ctl-sig" />
        <Toggle label="점 표시" checked={params.points} onChange={(points) => setParams({ points })} />
        <Hint>환자(관심 집단)와 대조군의 위치를 각각 같은 대역폭의 2차원 커널로 평활한 밀도의 비 log(f_환자 / f_대조군)를 지도로 그립니다(Kelsall & Diggle, 1995). 단순 환자 밀도 지도는 인구가 많은 곳에서 언제나 높지만, 대조군으로 나누면 ‘인구 분포를 고려한 상대 위험’이 남습니다. 빨강은 대조군보다 환자가 몰린 곳, 파랑은 적은 곳입니다. 각 집단의 밀도를 따로 정규화하므로 한 곳이 매우 높으면 나머지 지역은 상대적으로 낮게 나옵니다. 순열 검정은 집단 표지를 무작위로 섞어 지점별 p값을 구하고 p ≤ 0.1이 아닌 곳을 흐리게 합니다(다중 비교는 보정하지 않음).</Hint>
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams} resolved={resolved} /></ControlGroup>
    </>
  )
}

export const ratioModule: VizModule<RatioParams> = {
  roles: ratioRoles, datasets: ['case-control'], defaultParams: { ...geoDefaults, bandKm: 30, sig: false, caseGroup: '', points: true },
  Chart: RatioChart, Controls: RatioControls, hint: '순열 검정을 켜 우연히 생긴 패턴을 흐리게 하세요 · 대역폭을 바꿔 군집의 크기를 비교하세요',
}

