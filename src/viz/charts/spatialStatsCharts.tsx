import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { ChartMessage, Readout, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, StatTable, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, type DataTable } from '../../data/table'
import { project } from '../../geo/projections'
import { polygons } from '../../geo/geojson'
import { MapZoomButtons, useMapZoom } from '../../geo/useMapZoom'
import { fmt } from '../../lib/format'
import { benjaminiHochberg, distanceNeighbors, getisOrdGiStar, knnNeighbors, localMoran, moranGlobal, polygonNeighbors, symmetrize, type LisaClass, type Neighbors, type SpatialUnit, type WeightKind } from '../../stats/spatialStats'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'
import { BaseMap, GeoControls, geoDefaults, resolvePointMap, resolveMap, useProjection, type GeoParams } from './geoShared'

/** Hot spot (Getis–Ord Gi*) and cluster (local Moran) maps over either points or map regions. */

export interface StatsMapParams extends GeoParams { weights: WeightKind; k: number; bandKm: number; alpha: number; fdr: boolean; perms: number; showLinks: boolean; selected: number }

export const spatialRoles = [
  { key: 'region', label: '지역 ID (선택: 지역 단위 분석)', type: 'category' as const, prefer: 'ID|코드|code' },
  { key: 'lat', label: '위도', type: 'number' as const, required: true, prefer: '위도|lat' },
  { key: 'lon', label: '경도', type: 'number' as const, required: true, prefer: '경도|lon|lng' },
  { key: 'value', label: '분석할 값', type: 'number' as const, required: true, prefer: '값|value|GDP|인구' },
]

interface Units { units: SpatialUnit[]; mode: 'points' | 'regions'; regionIndex: Map<string, number>; skipped: number }

/** Analysis units: one per valid row (points) or one per map region that has a value (when region ids are mapped and match a map). */
function readUnits(table: DataTable, mapping: Mapping, params: GeoParams): Units & { resolved: ReturnType<typeof resolveMap> } {
  const ri = columnIndex(table, roleColumn(mapping, 'region'))
  const li = columnIndex(table, roleColumn(mapping, 'lat')), oi = columnIndex(table, roleColumn(mapping, 'lon')), vi = columnIndex(table, roleColumn(mapping, 'value'))
  const ids = ri >= 0 ? table.rows.map((r) => toLabel(r[ri]).trim()).filter(Boolean) : []
  const resolved = ids.length ? resolveMap(params, ids) : null
  const mapHits = resolved ? ids.filter((i) => resolved.map.byId.has(i)).length : 0
  const units: SpatialUnit[] = []
  const regionIndex = new Map<string, number>()
  let skipped = 0
  if (resolved && mapHits > 0) {
    table.rows.forEach((r, row) => {
      const id = toLabel(r[ri]).trim()
      const v = vi >= 0 ? toNumber(r[vi]) : null
      const reg = resolved.map.byId.get(id)
      if (!reg || v == null || regionIndex.has(id)) { skipped++; return }
      regionIndex.set(id, units.length)
      units.push({ id, lon: reg.centroid[0], lat: reg.centroid[1], value: v, rows: [row] })
    })
    return { units, mode: 'regions', regionIndex, skipped, resolved }
  }
  table.rows.forEach((r, row) => {
    const lat = li >= 0 ? toNumber(r[li]) : null, lon = oi >= 0 ? toNumber(r[oi]) : null, v = vi >= 0 ? toNumber(r[vi]) : null
    if (lat == null || lon == null || v == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) { skipped++; return }
    units.push({ id: String(row + 1), lon, lat, value: v, rows: [row] })
  })
  return { units, mode: 'points', regionIndex, skipped, resolved: resolvePointMap(params, units) }
}

function neighborsFor(u: Units & { resolved: ReturnType<typeof resolveMap> }, params: StatsMapParams): Neighbors {
  const { units } = u
  if (params.weights === 'knn') return symmetrize(knnNeighbors(units, params.k))
  if (params.weights === 'distance') return distanceNeighbors(units, params.bandKm)
  if (u.mode !== 'regions') return symmetrize(knnNeighbors(units, params.k))
  const map = u.resolved.map
  const shapes = map.regions.map((r) => polygons(r.feature).map((p) => p[0] as [number, number][]))
  const all = polygonNeighbors(shapes, params.weights === 'rook' ? 'rook' : 'queen')
  const idOfIndex = map.regions.map((r) => r.id)
  return units.map((unit) => {
    const mi = map.regions.findIndex((r) => r.id === unit.id)
    return all[mi].map((j) => u.regionIndex.get(idOfIndex[j])).filter((j): j is number => j != null)
  })
}

function useStatsMap(table: DataTable, mapping: Mapping, params: StatsMapParams) {
  const u = useMemo(() => readUnits(table, mapping, params), [table, mapping, params.map, params.customGeo]) // eslint-disable-line react-hooks/exhaustive-deps
  const nb = useMemo(() => neighborsFor(u, params), [u, params.weights, params.k, params.bandKm]) // eslint-disable-line react-hooks/exhaustive-deps
  return { ...u, nb }
}

const HOT = { hot3: '#b2182b', hot2: '#ef6c4a', hot1: '#fcb69f', cold3: '#2166ac', cold2: '#5b9fd0', cold1: '#b8d6ea', ns: '#d9dedc' }
const LISA_COLOR: Record<LisaClass, string> = { HH: '#d7301f', LL: '#2b6cb0', HL: '#fc9272', LH: '#9ecae1', ns: '#d9dedc', isolated: '#f1f4f3' }
const LISA_NAME: Record<LisaClass, string> = { HH: '높음–높음 (핫스팟)', LL: '낮음–낮음 (콜드스팟)', HL: '높음–낮음 (이상값)', LH: '낮음–높음 (이상값)', ns: '유의하지 않음', isolated: '이웃 없음' }

interface StageItem { color: string; tip: React.ReactNode; strong?: boolean }

/** The map shared by both charts: regions (polygons) or points coloured by the analysis result. */
function StatsStage({ props, data, items, aria, legend, extra, readout }: {
  props: ChartProps<StatsMapParams>
  data: ReturnType<typeof useStatsMap>
  items: StageItem[]
  aria: string
  legend: React.ReactNode
  extra?: React.ReactNode
  readout: { label: string; value: React.ReactNode }[]
}) {
  const { params, setParams, width, height, compact, linked } = props
  const { units, mode, resolved, nb } = data
  const projection = useProjection(resolved.map, params, width, height, resolved.id)
  const svgRef = useRef<SVGSVGElement>(null)
  const zoom = useMapZoom(svgRef, { enabled: !compact, width, height })
  const { tip, show, hide } = useTooltip()
  const k = zoom.t.k
  const xy = useMemo(() => units.map((u) => project(projection, u.lon, u.lat)), [units, projection])
  const paths = useMemo(() => (mode === 'regions' ? new Map(resolved.map.regions.map((r) => [r.id, d3.geoPath(projection)(r.feature) ?? ''])) : null), [mode, resolved.map, projection])
  const marked = new Set(linked?.rows ?? [])
  const links = useMemo(() => {
    if (!params.showLinks || compact || units.length > 400) return []
    const out: [number, number][] = []
    nb.forEach((l, i) => l.forEach((j) => { if (j > i) out.push([i, j]) }))
    return out
  }, [params.showLinks, compact, units.length, nb])
  const showTip = (i: number) => (e: React.PointerEvent) => { linked?.set(units[i].rows); const p = localPoint(svgRef.current!, e); show(p.x, p.y, items[i].tip) }
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg map-svg" role="img" data-testid="chart-svg" aria-label={aria} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${zoom.t.x},${zoom.t.y}) scale(${k})`}>
          {mode === 'points' && <BaseMap map={resolved.map} projection={projection} />}
          {mode === 'regions' && resolved.map.regions.filter((r) => !data.regionIndex.has(r.id)).map((r) => <path key={r.id} className="map-base" d={paths!.get(r.id)} fill="#f6f8f7" stroke="#e1e6e4" strokeWidth={0.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
          {mode === 'regions' && units.map((u, i) => {
            const on = params.selected === i || u.rows.some((r) => marked.has(r))
            return <path key={u.id} className="map-region" data-testid="stat-unit" data-class={items[i].color} d={paths!.get(u.id)} fill={items[i].color} stroke={on ? '#121816' : '#ffffff'} strokeWidth={on ? 2 : 0.7} vectorEffect="non-scaling-stroke" onPointerMove={compact ? undefined : showTip(i)} onPointerLeave={() => { hide(); linked?.set(null) }} onClick={compact ? undefined : () => setParams({ selected: params.selected === i ? -1 : i })} />
          })}
          {links.map(([a, b]) => xy[a] && xy[b] ? <line key={`${a}-${b}`} x1={xy[a]![0]} y1={xy[a]![1]} x2={xy[b]![0]} y2={xy[b]![1]} stroke="#4b5563" strokeOpacity={0.35} strokeWidth={0.8} vectorEffect="non-scaling-stroke" pointerEvents="none" /> : null)}
          {units.map((u, i) => {
            const p = xy[i]
            if (!p) return null
            const on = params.selected === i || u.rows.some((r) => marked.has(r))
            return mode === 'points'
              ? <circle key={u.id} data-testid="stat-unit" data-class={items[i].color} cx={p[0]} cy={p[1]} r={(compact ? 2.6 : items[i].strong ? 6 : 4.2) / k} fill={items[i].color} fillOpacity={0.92} stroke={on ? '#121816' : '#ffffff'} strokeWidth={on ? 2 : 0.8} vectorEffect="non-scaling-stroke" onPointerMove={compact ? undefined : showTip(i)} onPointerLeave={() => { hide(); linked?.set(null) }} onClick={compact ? undefined : () => setParams({ selected: params.selected === i ? -1 : i })} />
              : links.length ? <circle key={u.id} cx={p[0]} cy={p[1]} r={2.4 / k} fill="#111" pointerEvents="none" /> : null
          })}
        </g>
      </svg>
      {!compact && (<>
        {legend}
        <Readout items={readout} />
        {extra}
        <MapZoomButtons zoom={zoom} k={k} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

function StatsControls({ params, setParams, table, mapping, children }: ControlsProps<StatsMapParams> & { children?: React.ReactNode }) {
  const data = useMemo(() => readUnits(table, mapping, params), [table, mapping, params.map, params.customGeo]) // eslint-disable-line react-hooks/exhaustive-deps
  const regions = data.mode === 'regions'
  return (
    <>
      <ControlGroup title="이웃(공간 가중치)">
        <Select label="이웃 정의" value={params.weights} onChange={(weights) => setParams({ weights })} testId="ctl-weights"
          options={[{ value: 'knn', label: '가장 가까운 k개' }, { value: 'distance', label: '거리 안 (km)' }, { value: 'queen', label: '인접 – 퀸 (꼭짓점 공유)', disabled: !regions }, { value: 'rook', label: '인접 – 룩 (경계 공유)', disabled: !regions }]} />
        {params.weights === 'knn' && <Slider label="이웃 수 k" value={params.k} min={2} max={16} onChange={(k) => setParams({ k })} testId="ctl-knn" />}
        {params.weights === 'distance' && <Slider label="거리 경계 (km)" value={params.bandKm} min={10} max={300} step={5} onChange={(bandKm) => setParams({ bandKm })} format={(v) => `${v} km`} testId="ctl-band" />}
        <Toggle label="이웃 연결선" checked={params.showLinks} onChange={(showLinks) => setParams({ showLinks })} />
        <Hint>{regions ? '지역 단위로 분석합니다(지도의 각 지역이 한 단위). 퀸·룩 인접은 경계 꼭짓점 공유로 판정하며 섬은 이웃이 없습니다.' : '점 단위로 분석합니다. 지역 ID 열을 지정하면 지도의 지역을 단위로 분석합니다. 점은 가까운 k개 또는 거리 이내를 이웃으로 삼습니다.'} 이웃을 어떻게 정하느냐에 결과가 달라지므로 한 가지로만 결론짓지 마세요.</Hint>
      </ControlGroup>
      {children}
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams} resolved={data.resolved} /></ControlGroup>
    </>
  )
}

const baseStats = { ...geoDefaults, weights: 'knn' as WeightKind, k: 8, bandKm: 60, alpha: 0.05, fdr: false, perms: 499, showLinks: false, selected: -1 }

// ─── Getis–Ord Gi* ──────────────────────────────────────────────────────────────────

function HotspotChart(props: ChartProps<StatsMapParams>) {
  const { table, mapping, params } = props
  const data = useStatsMap(table, mapping, params)
  const { units, nb } = data
  const gi = useMemo(() => getisOrdGiStar(units.map((u) => u.value), nb), [units, nb])
  const zCrit = useMemo(() => d3.scaleLinear().domain([0.1, 0.05, 0.01]).range([1.645, 1.96, 2.576])(params.alpha), [params.alpha])
  const sig = useMemo(() => (params.fdr ? benjaminiHochberg(gi.map((g) => g.p), params.alpha) : gi.map((g) => g.p <= params.alpha)), [gi, params.fdr, params.alpha])
  const items: StageItem[] = useMemo(() => gi.map((g, i) => {
    let color = HOT.ns
    if (sig[i]) {
      const a = Math.abs(g.z)
      const lvl = params.fdr ? 2 : a >= 2.576 ? 3 : a >= 1.96 ? 2 : 1
      color = g.z > 0 ? [HOT.hot1, HOT.hot2, HOT.hot3][lvl - 1] : [HOT.cold1, HOT.cold2, HOT.cold3][lvl - 1]
    }
    return { color, strong: sig[i], tip: <><b>{data.mode === 'regions' ? (data.resolved.map.byId.get(units[i].id)?.name ?? units[i].id) : `점 ${units[i].id}`}</b><br />값 {fmt(units[i].value)}<br />Gi* z = <b>{g.z.toFixed(2)}</b> (p = {g.p < 0.001 ? '<0.001' : g.p.toFixed(3)})<br />이웃 {nb[i].length}개 · {sig[i] ? (g.z > 0 ? '핫스팟' : '콜드스팟') : '유의하지 않음'}</> }
  }), [gi, sig, units, nb, data.mode, data.resolved.map, params.fdr])
  if (!roleColumn(mapping, 'lat') || !roleColumn(mapping, 'lon') || !roleColumn(mapping, 'value')) return <ChartMessage>위도, 경도, 분석할 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (units.length < 8) return <ChartMessage>분석하려면 유효한 단위가 8개 이상 필요합니다.</ChartMessage>
  const nHot = sig.filter((s, i) => s && gi[i].z > 0).length, nCold = sig.filter((s, i) => s && gi[i].z < 0).length
  const legendItems = params.fdr ? [['핫스팟', HOT.hot2], ['콜드스팟', HOT.cold2], ['유의하지 않음', HOT.ns]] : [['핫스팟 99%', HOT.hot3], ['핫스팟 95%', HOT.hot2], ['핫스팟 90%', HOT.hot1], ['콜드스팟 99%', HOT.cold3], ['콜드스팟 95%', HOT.cold2], ['콜드스팟 90%', HOT.cold1], ['유의하지 않음', HOT.ns]]
  return (
    <StatsStage props={props} data={data} items={items} aria={`핫스팟 지도: 핫스팟 ${nHot}개, 콜드스팟 ${nCold}개`}
      legend={<div className="chart-legend" aria-label="범례">{legendItems.map(([n, c]) => <span key={n} className="legend-item"><span className="legend-swatch" style={{ background: c, borderColor: c }} />{n}</span>)}</div>}
      readout={[{ label: '단위', value: units.length }, { label: '핫스팟', value: nHot }, { label: '콜드스팟', value: nCold }, { label: '기준 |z|', value: params.fdr ? 'FDR' : zCrit.toFixed(2) }]} />
  )
}

function HotspotControls(props: ControlsProps<StatsMapParams>) {
  const { params, setParams } = props
  return (
    <StatsControls {...props}>
      <ControlGroup title="유의성">
        <Segmented label="유의수준 α" value={String(params.alpha)} onChange={(v) => setParams({ alpha: Number(v) })} testId="ctl-alpha" options={[{ value: '0.1', label: '0.10' }, { value: '0.05', label: '0.05' }, { value: '0.01', label: '0.01' }]} />
        <Toggle label="다중검정 보정 (Benjamini–Hochberg FDR)" checked={params.fdr} onChange={(fdr) => setParams({ fdr })} testId="ctl-fdr" />
        <Hint>Gi*는 한 단위와 이웃(자기 자신 포함)의 값 합이 전체 평균에서 기대되는 것보다 높은지(핫스팟, z &gt; 0) 낮은지(콜드스팟)를 z 점수로 계산합니다. 단위마다 검정을 수십~수백 번 하므로 α=0.05만으로 보면 우연한 ‘유의’가 5% 정도 섞입니다. FDR 보정을 켜면 그 비율을 통제합니다. 통계적 유의성은 값이 이웃과 비슷하게 몰려 있다는 뜻이지 원인을 설명하지 않으며, 효과 크기와도 다릅니다.</Hint>
      </ControlGroup>
    </StatsControls>
  )
}

export const hotspotModule: VizModule<StatsMapParams> = {
  roles: spatialRoles,
  datasets: ['spatial-values', 'kr-regions', 'world-regions'],
  defaultParams: baseStats,
  Chart: HotspotChart,
  Controls: HotspotControls,
  hint: '이웃 정의(k·거리·인접)와 유의수준을 바꿔 핫스팟이 어떻게 달라지는지 확인 · FDR 보정을 켜 보세요 · 점이나 지역을 눌러 z 점수 확인',
}

// ─── local Moran's I (LISA) ─────────────────────────────────────────────────────────

function LisaChart(props: ChartProps<StatsMapParams>) {
  const { table, mapping, params, compact } = props
  const data = useStatsMap(table, mapping, params)
  const { units, nb } = data
  const values = useMemo(() => units.map((u) => u.value), [units])
  const lisa = useMemo(() => localMoran(values, nb, params.alpha, params.perms, 7), [values, nb, params.alpha, params.perms])
  const glob = useMemo(() => moranGlobal(values, nb, Math.min(params.perms, 299), 7), [values, nb, params.perms])
  const cnt = useMemo(() => { const m: Record<string, number> = {}; for (const l of lisa) m[l.cls] = (m[l.cls] ?? 0) + 1; return m }, [lisa])
  const items: StageItem[] = useMemo(() => lisa.map((l, i) => ({ color: LISA_COLOR[l.cls], strong: l.cls !== 'ns' && l.cls !== 'isolated', tip: <><b>{data.mode === 'regions' ? (data.resolved.map.byId.get(units[i].id)?.name ?? units[i].id) : `점 ${units[i].id}`}</b><br />값 {fmt(units[i].value)} (z = {l.z.toFixed(2)})<br />이웃 평균 z = {l.lag.toFixed(2)}<br />I = {l.I.toFixed(2)} · 유사 p = {l.p.toFixed(3)}<br />{LISA_NAME[l.cls]}</> })), [lisa, units, data.mode, data.resolved.map])
  if (!roleColumn(mapping, 'lat') || !roleColumn(mapping, 'lon') || !roleColumn(mapping, 'value')) return <ChartMessage>위도, 경도, 분석할 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (units.length < 8) return <ChartMessage>분석하려면 유효한 단위가 8개 이상 필요합니다.</ChartMessage>
  const SW = 150, SP = 22
  const zs = lisa.map((l) => l.z), lags = lisa.map((l) => l.lag)
  const lim = Math.max(2.5, d3.max(zs.map(Math.abs)) ?? 2.5, d3.max(lags.map(Math.abs)) ?? 2.5)
  const sx = d3.scaleLinear().domain([-lim, lim]).range([SP, SW - 6]), sy = d3.scaleLinear().domain([-lim, lim]).range([SW - SP, 6])
  const scatter = !compact && (
    <svg className="moran-scatter" width={SW} height={SW + 16} style={{ position: 'absolute', left: 8, bottom: 30, background: 'rgba(255,255,255,.92)', border: '1px solid var(--line)', borderRadius: 8 }} role="img" aria-label={`모란 산점도: 전역 I = ${glob.I.toFixed(2)}`} data-testid="moran-scatter">
      <line x1={sx(0)} x2={sx(0)} y1={6} y2={SW - SP} stroke="#cfd6d3" /><line x1={SP} x2={SW - 6} y1={sy(0)} y2={sy(0)} stroke="#cfd6d3" />
      <line x1={sx(-lim)} y1={sy(-lim * glob.I)} x2={sx(lim)} y2={sy(lim * glob.I)} stroke="#e07a3f" strokeWidth={1.4} />
      {lisa.map((l, i) => <circle key={i} cx={sx(l.z)} cy={sy(l.lag)} r={2.4} fill={LISA_COLOR[l.cls]} stroke="#fff" strokeWidth={0.5} />)}
      <text x={SW / 2} y={SW + 8} textAnchor="middle" fontSize={9.5} fill="#6b7773">값 z → / 이웃 평균 z ↑</text>
    </svg>
  )
  return (
    <StatsStage props={props} data={data} items={items} aria={`LISA 클러스터 지도: 전역 모란 I ${glob.I.toFixed(2)}`}
      legend={<div className="chart-legend" aria-label="범례">{(['HH', 'LL', 'HL', 'LH', 'ns'] as LisaClass[]).map((c) => <span key={c} className="legend-item"><span className="legend-swatch" style={{ background: LISA_COLOR[c], borderColor: LISA_COLOR[c] }} />{LISA_NAME[c].split(' ')[0]} {cnt[c] ?? 0}</span>)}</div>}
      extra={scatter}
      readout={[{ label: '전역 I', value: glob.I.toFixed(3) }, { label: '유사 p', value: glob.p < 0.001 ? '<0.001' : glob.p.toFixed(3) }, { label: '유의 단위', value: lisa.filter((l) => l.cls !== 'ns' && l.cls !== 'isolated').length }]} />
  )
}

function LisaControls(props: ControlsProps<StatsMapParams>) {
  const { params, setParams } = props
  return (
    <StatsControls {...props}>
      <ControlGroup title="유의성">
        <Segmented label="유의수준 α" value={String(params.alpha)} onChange={(v) => setParams({ alpha: Number(v) })} testId="ctl-alpha" options={[{ value: '0.1', label: '0.10' }, { value: '0.05', label: '0.05' }, { value: '0.01', label: '0.01' }]} />
        <Segmented label="순열 횟수" value={String(params.perms)} onChange={(v) => setParams({ perms: Number(v) })} testId="ctl-perms" options={[{ value: '99', label: '99' }, { value: '499', label: '499' }, { value: '999', label: '999' }]} />
        <Hint>국소 모란 I는 한 단위의 값(z)과 이웃 평균(공간 지연 값)의 곱입니다. 둘 다 높으면 HH(핫스팟), 둘 다 낮으면 LL, 높은데 이웃이 낮으면 HL, 그 반대가 LH입니다. p 값은 이웃에 다른 단위의 값을 무작위로 채우는 조건부 순열로 구한 유사 p 값이며 순열 횟수와 난수에 따라 조금 달라집니다. 다중검정 문제가 있으므로 ‘유의’ 표시를 가설 후보로 보세요.</Hint>
      </ControlGroup>
      <ControlGroup title="모란 산점도 해석" defaultOpen={false}>
        <StatTable rows={[['구분', '뜻'], ['오른쪽 위 (HH)', '높은 값이 높은 이웃과 모임'], ['왼쪽 아래 (LL)', '낮은 값이 낮은 이웃과 모임'], ['오른쪽 아래 (HL)', '높은 값이 낮은 이웃 사이에 섬처럼 있음'], ['왼쪽 위 (LH)', '낮은 값이 높은 이웃 사이에 있음']]} />
        <Hint>주황 선의 기울기가 (행 표준화 가중치에서) 전역 모란 I입니다. 1에 가까울수록 비슷한 값이 모이는 양의 자기상관입니다.</Hint>
      </ControlGroup>
    </StatsControls>
  )
}

export const lisaModule: VizModule<StatsMapParams> = {
  roles: spatialRoles,
  datasets: ['spatial-values', 'kr-regions', 'world-regions'],
  defaultParams: baseStats,
  Chart: LisaChart,
  Controls: LisaControls,
  hint: 'HH·LL 클러스터와 HL·LH 이상값을 확인 · 이웃 정의와 순열 횟수를 바꿔 결과의 안정성 점검 · 왼쪽 아래 모란 산점도의 기울기가 전역 I',
}
