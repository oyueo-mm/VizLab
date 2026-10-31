import * as d3 from 'd3'
import { useMemo } from 'react'
import { ChartMessage, Readout, Tooltip, localPoint } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { MapZoomButtons } from '../../geo/useMapZoom'
import { colorAt, schemes, textOn, type ColorScheme } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { apportion, contiguousCartogram, demersCartogram, griddedCartogram, maxSquareOverlap, nonContiguousCartogram, shapeArea, shapeCentroid, type Pt, type Shape } from '../../stats/cartogram'
import { classBreaks, classIndex } from '../../stats/geo'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { GeoControls, geoDefaults, regionRoles, resolveMap, type GeoParams } from './geoShared'
import { projectedShapes, regionRows, shapePath, useRegionStage } from './regionKit'
import { RampLegend } from './geoKit'

const seq = (Object.keys(schemes) as ColorScheme[]).filter((k) => !schemes[k].diverging).map((k) => ({ value: k, label: schemes[k].name }))
const KEYS = ['value']

/** Shared pieces of the cartogram charts: the projected shapes, per-region values and a density colour scale. */
function useCartogramBase(props: ChartProps<CartoParams>) {
  const { table, mapping, params, width, height, compact } = props
  const st = useRegionStage(table, mapping, params, width, height, compact, KEYS)
  const shapes = useMemo(() => projectedShapes(st.map, st.projection), [st.map, st.projection])
  const values = useMemo(() => st.map.regions.map((r) => st.data.get(r.id)?.values.value ?? null), [st.map, st.data])
  const density = useMemo(() => st.map.regions.map((r, i) => (values[i] != null && r.area > 0 ? values[i]! / r.area : null)), [st.map, values])
  const edges = useMemo(() => classBreaks(density.filter((v): v is number => v != null), 'quantile', 5), [density])
  const scheme = schemes[params.scheme]
  const fillOf = (i: number) => {
    if (params.colorBy === 'region') return colorAt(i)
    const v = density[i]
    return v == null ? '#eef1f0' : scheme.interpolate(0.12 + 0.88 * (edges.length < 2 ? 0.5 : classIndex(v, edges) / Math.max(1, edges.length - 2)))
  }
  return { st, shapes, values, density, edges, scheme, fillOf }
}

export interface CartoParams extends GeoParams { scheme: ColorScheme; colorBy: 'density' | 'region'; morph: number; ghost: boolean; labels: boolean; selected: string }

const cartoRoles = [...regionRoles]
const cartoDefaults = { ...geoDefaults, scheme: 'teal' as ColorScheme, colorBy: 'density' as const, morph: 1, ghost: true, labels: true, selected: '' }

const blend = (a: Shape, b: Shape, t: number): Shape => ({ id: a.id, rings: a.rings.map((ring, ri) => ring.map((p, pi) => [p[0] + (b.rings[ri][pi][0] - p[0]) * t, p[1] + (b.rings[ri][pi][1] - p[1]) * t] as Pt)) })

function CartogramFrame({ props, base, shapesNow, extra, aria, hint, readout }: {
  props: ChartProps<CartoParams>
  base: ReturnType<typeof useCartogramBase>
  shapesNow: (Shape | null)[]
  extra?: React.ReactNode
  aria: string
  hint?: (i: number) => React.ReactNode
  readout: { label: string; value: React.ReactNode }[]
}) {
  const { params, setParams, compact, width, linked } = props
  const { st, shapes, values, density, scheme, fillOf, edges } = base
  const { map, data, svgRef, zoom, tip, show, hide } = st
  const marked = new Set(linked?.rows ?? [])
  const k = zoom.t.k
  if (!roleColumn(props.mapping, 'region') || !roleColumn(props.mapping, 'value')) return <ChartMessage>지역 ID(범주형)와 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!values.some((v) => v != null && v > 0)) return <ChartMessage>지도와 맞는 지역 ID에 0보다 큰 값이 없습니다.<small>ID 열이 {map.title}의 ID와 같은지 확인하세요.</small></ChartMessage>
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={props.width} height={props.height} className="chart-svg map-svg" role="img" data-testid="chart-svg" aria-label={aria} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${zoom.t.x},${zoom.t.y}) scale(${k})`}>
          {params.ghost && !compact && params.morph > 0 && shapes.map((s) => <path key={`g${s.id}`} d={shapePath(s)} fill="none" stroke="#b8c2bf" strokeDasharray="3 3" strokeWidth={0.8} vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
          {map.regions.map((r, i) => {
            const s = shapesNow[i]
            if (!s) return null
            const row = data.get(r.id)
            const on = params.selected === r.id || (row?.rows.some((q) => marked.has(q)) ?? false)
            return (
              <path key={r.id} className="map-region" data-testid="map-region" data-id={r.id} data-area={shapeArea(s).toFixed(1)} d={shapePath(s)} fill={fillOf(i)} fillOpacity={0.92} stroke={on ? '#121816' : '#ffffff'} strokeWidth={on ? 1.8 : 0.7} vectorEffect="non-scaling-stroke"
                onPointerMove={compact ? undefined : (e) => { linked?.set(row?.rows ?? null); const p = localPoint(svgRef.current!, e); show(p.x, p.y, <><b>{r.name}</b> <small>{r.id}</small><br />{roleColumn(props.mapping, 'value')}: {fmt(values[i])}<br />원래 면적당 {density[i] == null ? '–' : fmt(density[i], 4)}{hint?.(i)}</>) }}
                onPointerLeave={() => { hide(); linked?.set(null) }} onClick={compact ? undefined : () => setParams({ selected: params.selected === r.id ? '' : r.id })} />
            )
          })}
          {extra}
        </g>
      </svg>
      {!compact && (<>
        {params.colorBy === 'density' && edges.length > 1 && <RampLegend interpolate={(t) => scheme.interpolate(0.12 + 0.88 * t)} min={fmt(edges[0], 3)} max={fmt(edges[edges.length - 1], 3)} label="원래 면적당 값" />}
        <Readout items={readout} />
        <MapZoomButtons zoom={zoom} k={k} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

function CartoControls<P extends CartoParams>({ params, setParams, table, mapping, children, morph = true }: ControlsProps<P> & { children?: React.ReactNode; morph?: boolean }) {
  const data = useMemo(() => regionRows(table, mapping, KEYS), [table, mapping])
  const resolved = useMemo(() => resolveMap(params, [...data.keys()]), [params, data])
  return (
    <>
      {children}
      <ControlGroup title="표현">
        {morph && <Slider label="원래 지도 → 카토그램 (변형 정도)" value={params.morph} min={0} max={1} step={0.02} onChange={(m) => setParams({ morph: m } as Partial<P>)} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-morph" />}
        <Segmented label="색" value={params.colorBy} onChange={(colorBy) => setParams({ colorBy } as Partial<P>)} testId="ctl-carto-color" options={[{ value: 'density', label: '원래 면적당 값' }, { value: 'region', label: '지역별 색' }]} />
        {params.colorBy === 'density' && <Select label="색상 팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme } as Partial<P>)} options={seq} />}
        <Toggle label="원래 윤곽 (점선)" checked={params.ghost} onChange={(ghost) => setParams({ ghost } as Partial<P>)} />
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams as never} resolved={resolved} /></ControlGroup>
    </>
  )
}

/** Area error of the drawn shapes against value-proportional targets (mean and max of |A/T − 1|, total map area held fixed). */
function areaErrors(shapes: readonly (Shape | null)[], values: readonly (number | null)[]) {
  const v = values.map((x) => (x != null && x > 0 ? x : 0))
  const areas = shapes.map((s) => (s ? shapeArea(s) : 0))
  const totalV = d3.sum(v), totalA = d3.sum(areas)
  const errs = areas.map((a, i) => (v[i] > 0 ? Math.abs(a / ((v[i] / totalV) * totalA) - 1) : NaN)).filter(Number.isFinite)
  return { mean: d3.mean(errs) ?? 0, max: d3.max(errs) ?? 0 }
}

// ─── contiguous cartogram ───────────────────────────────────────────────────────────

export interface ContigParams extends CartoParams { iterations: number }

function ContiguousChart(props: ChartProps<ContigParams>) {
  const base = useCartogramBase(props as ChartProps<CartoParams>)
  const { params } = props
  const result = useMemo(() => contiguousCartogram(base.shapes, base.values, params.iterations, 0.005), [base.shapes, base.values, params.iterations])
  const now = useMemo(() => base.shapes.map((s, i) => blend(s, result.shapes[i], params.morph)), [base.shapes, result, params.morph])
  const errs = useMemo(() => areaErrors(result.shapes, base.values), [result, base.values])
  return <CartogramFrame props={props as ChartProps<CartoParams>} base={base} shapesNow={now} aria={`연속형 카토그램: 반복 ${result.iterations}회, 평균 면적 오차 ${(errs.mean * 100).toFixed(1)}%`}
    readout={[{ label: '반복', value: result.iterations }, { label: '평균 면적 오차', value: `${(errs.mean * 100).toFixed(1)}%` }, { label: '최대 오차', value: `${(errs.max * 100).toFixed(0)}%` }]} />
}

function ContiguousControls(props: ControlsProps<ContigParams>) {
  const { params, setParams } = props
  return (
    <CartoControls {...props}>
      <ControlGroup title="변형 계산">
        <Slider label="최대 반복 횟수" value={params.iterations} min={1} max={80} onChange={(iterations) => setParams({ iterations })} testId="ctl-carto-iter" />
        <Hint>Dougenik 등(1985)의 고무판 방식입니다. 반복할 때마다 값에 비해 큰 지역은 줄이고 작은 지역은 키우는 힘이 지도 전체의 모든 꼭짓점에 작용합니다. 꼭짓점의 이동이 그 위치에만 달려 있어서 이웃한 지역이 계속 붙어 있지만, 반복이 적으면 면적이 값에 아직 덜 맞습니다. 평균 면적 오차가 줄어드는 것을 확인하세요. 모양은 일그러지므로 지역을 알아보기 어려울 수 있습니다.</Hint>
      </ControlGroup>
    </CartoControls>
  )
}

export const contiguousCartogramModule: VizModule<ContigParams> = {
  roles: cartoRoles,
  datasets: ['kr-regions', 'world-regions'],
  defaultParams: { ...cartoDefaults, iterations: 40 },
  Chart: ContiguousChart,
  Controls: ContiguousControls,
  hint: '‘변형 정도’ 슬라이더로 원래 지도에서 카토그램으로 서서히 바꿔 보세요 · 반복 횟수를 늘리면 면적이 값에 가까워집니다',
}

// ─── non-contiguous cartogram ───────────────────────────────────────────────────────

export interface NonContigParams extends CartoParams { reference: 'max' | 'median' }

function NonContiguousChart(props: ChartProps<NonContigParams>) {
  const base = useCartogramBase(props as ChartProps<CartoParams>)
  const { params } = props
  const result = useMemo(() => nonContiguousCartogram(base.shapes, base.values, params.reference), [base.shapes, base.values, params.reference])
  const now = useMemo(() => base.shapes.map((s, i) => blend(s, result.shapes[i], params.morph)), [base.shapes, result, params.morph])
  const target = useMemo(() => base.st.map.regions.map((_, i) => result.scales[i]), [result, base.st.map])
  return <CartogramFrame props={props as ChartProps<CartoParams>} base={base} shapesNow={now} aria={`비연속형 카토그램: 기준 ${params.reference === 'max' ? '최대 밀도' : '중앙 밀도'}`}
    hint={(i) => <><br />크기 배율 ×{fmt(target[i], 3)} (원래 모양 유지)</>}
    readout={[{ label: '기준', value: params.reference === 'max' ? '최대 밀도 지역' : '중앙 밀도 지역' }, { label: '축소 지역', value: target.filter((s) => s > 0 && s < 0.999).length }, { label: '확대 지역', value: target.filter((s) => s > 1.001).length }]} />
}

function NonContiguousControls(props: ControlsProps<NonContigParams>) {
  const { params, setParams } = props
  return (
    <CartoControls {...props}>
      <ControlGroup title="크기 기준">
        <Segmented label="원래 크기로 두는 지역" value={params.reference} onChange={(reference) => setParams({ reference })} testId="ctl-nc-ref" options={[{ value: 'max', label: '최대 밀도' }, { value: 'median', label: '중앙 밀도' }]} />
        <Hint>각 지역은 자기 모양을 그대로 두고 중심점을 기준으로 크기만 줄이거나 늘려, 화면 넓이가 값에 비례하게 합니다. 기준 지역(값/면적이 가장 큰 지역)은 원래 크기를 유지하고 나머지가 그에 맞춰 줄어듭니다. 중앙 밀도를 기준으로 하면 절반은 커져서 서로 겹칠 수 있습니다. 모양이 보존되어 알아보기 쉽지만 지역 사이에 빈틈이 생깁니다.</Hint>
      </ControlGroup>
    </CartoControls>
  )
}

export const nonContiguousCartogramModule: VizModule<NonContigParams> = {
  roles: cartoRoles,
  datasets: ['kr-regions', 'world-regions'],
  defaultParams: { ...cartoDefaults, reference: 'max' },
  Chart: NonContiguousChart,
  Controls: NonContiguousControls,
  hint: '모양은 그대로 두고 값에 맞춰 크기만 바꿉니다 · ‘변형 정도’로 원래 지도와 비교 · 기준 지역을 바꿔 보세요',
}

// ─── Demers cartogram ───────────────────────────────────────────────────────────────

export interface DemersParams extends CartoParams { maxSide: number; pull: number; links: boolean }

function DemersChart(props: ChartProps<DemersParams>) {
  const { params, mapping, width, height, compact, setParams, linked } = props
  const base = useCartogramBase(props as ChartProps<CartoParams>)
  const { st, values, fillOf } = base
  const { map, data, svgRef, zoom, tip, show, hide } = st
  const side = (compact ? 0.5 : 1) * params.maxSide
  const proj = st.projection
  const sites = useMemo(() => map.regions.flatMap((r, i) => { const xy = proj(r.centroid); return values[i] != null && values[i]! > 0 && xy ? [{ id: r.id, i, x: xy[0], y: xy[1], value: values[i]! }] : [] }), [map, values, proj])
  const squares = useMemo(() => demersCartogram(sites, side, params.pull, 500), [sites, side, params.pull])
  const overlap = useMemo(() => maxSquareOverlap(squares), [squares])
  const marked = new Set(linked?.rows ?? [])
  const k = zoom.t.k
  if (!roleColumn(mapping, 'region') || !roleColumn(mapping, 'value')) return <ChartMessage>지역 ID(범주형)와 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!sites.length) return <ChartMessage>지도와 맞는 지역 ID에 0보다 큰 값이 없습니다.</ChartMessage>
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg map-svg" role="img" data-testid="chart-svg" aria-label={`데머스 카토그램: 정사각형 ${squares.length}개, 겹침 ${overlap.toFixed(1)}px`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${zoom.t.x},${zoom.t.y}) scale(${k})`}>
          {params.ghost && !compact && base.shapes.map((s) => <path key={s.id} d={shapePath(s)} fill="#f4f6f5" stroke="#d5dbd9" strokeWidth={0.6} vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
          {params.links && !compact && squares.map((q) => <line key={`l${q.id}`} x1={q.x0} y1={q.y0} x2={q.x} y2={q.y} stroke="#8a9692" strokeWidth={0.7} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
          {squares.map((q, n) => {
            const r = map.byId.get(q.id)!
            const row = data.get(q.id)
            const site = sites[n]
            const fill = fillOf(site.i)
            const on = params.selected === q.id || (row?.rows.some((x) => marked.has(x)) ?? false)
            return (
              <g key={q.id} data-testid="demers-square" data-id={q.id} data-side={q.side.toFixed(2)} onPointerMove={compact ? undefined : (e) => { linked?.set(row?.rows ?? null); const p = localPoint(svgRef.current!, e); show(p.x, p.y, <><b>{r.name}</b><br />{roleColumn(mapping, 'value')}: {fmt(site.value)}<br />변 길이 {q.side.toFixed(1)}px (넓이 ∝ 값)</>) }} onPointerLeave={() => { hide(); linked?.set(null) }} onClick={compact ? undefined : () => setParams({ selected: params.selected === q.id ? '' : q.id })}>
                <rect x={q.x - q.side / 2} y={q.y - q.side / 2} width={q.side} height={q.side} fill={fill} fillOpacity={0.92} stroke={on ? '#121816' : '#ffffff'} strokeWidth={on ? 1.8 : 0.8} vectorEffect="non-scaling-stroke" rx={1.5} />
                {params.labels && !compact && q.side * k > 16 && <text x={q.x} y={q.y} dy="0.35em" textAnchor="middle" fontSize={Math.min(12, q.side * 0.34) } fill={textOn(fill)} pointerEvents="none">{r.name.length > 4 ? r.name.slice(0, 3) : r.name}</text>}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (<>
        <Readout items={[{ label: '정사각형', value: squares.length }, { label: '남은 겹침', value: `${overlap.toFixed(1)}px` }, { label: '최대 변', value: `${side.toFixed(0)}px` }]} />
        <MapZoomButtons zoom={zoom} k={k} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

function DemersControls(props: ControlsProps<DemersParams>) {
  const { params, setParams } = props
  return (
    <CartoControls {...props} morph={false}>
      <ControlGroup title="정사각형">
        <Slider label="가장 큰 정사각형의 한 변" value={params.maxSide} min={16} max={90} onChange={(maxSide) => setParams({ maxSide })} format={(v) => `${v}px`} testId="ctl-demers-side" />
        <Slider label="제자리로 당기는 힘" value={params.pull} min={0} max={0.2} step={0.01} onChange={(pull) => setParams({ pull })} testId="ctl-demers-pull" />
        <Toggle label="이름" checked={params.labels} onChange={(labels) => setParams({ labels })} />
        <Toggle label="원래 위치 연결선" checked={params.links} onChange={(links) => setParams({ links })} />
        <Hint>지역마다 넓이가 값에 비례하는 정사각형을 중심 위치에 놓고, 겹친 것은 겹침이 가장 작은 축으로 밀어 냅니다(작은 정사각형이 더 많이 움직임). 원 대신 정사각형을 쓰는 점이 도를링과 다르며 모서리가 맞닿아 면적을 비교하기 쉽습니다. 제자리로 당기는 힘이 크면 위치는 정확하지만 겹침이 남을 수 있습니다.</Hint>
      </ControlGroup>
    </CartoControls>
  )
}

export const demersModule: VizModule<DemersParams> = {
  roles: cartoRoles,
  datasets: ['kr-regions', 'world-regions'],
  defaultParams: { ...cartoDefaults, colorBy: 'density', maxSide: 56, pull: 0.04, links: false },
  Chart: DemersChart,
  Controls: DemersControls,
  hint: '정사각형의 넓이가 값에 비례합니다 · 한 변의 크기와 제자리 당김을 바꿔 겹침이 어떻게 풀리는지 확인 · 정사각형을 눌러 선택',
}

// ─── gridded cartogram ──────────────────────────────────────────────────────────────

export interface GriddedParams extends CartoParams { cellPx: number }

function GriddedChart(props: ChartProps<GriddedParams>) {
  const { params, mapping, width, height, compact, setParams, linked } = props
  const base = useCartogramBase(props as ChartProps<CartoParams>)
  const { st, shapes, values, fillOf } = base
  const { map, data, svgRef, zoom, tip, show, hide } = st
  const cellPx = compact ? Math.max(params.cellPx, 12) : params.cellPx
  const layout = useMemo(() => {
    // land cells: lattice points that fall inside any region polygon
    const boxes = shapes.map((s) => { const all = s.rings.flat(); return { x0: d3.min(all, (p) => p[0]) ?? 0, x1: d3.max(all, (p) => p[0]) ?? 0, y0: d3.min(all, (p) => p[1]) ?? 0, y1: d3.max(all, (p) => p[1]) ?? 0 } })
    const cells: Pt[] = []
    for (let y = cellPx / 2; y < height; y += cellPx) for (let x = cellPx / 2; x < width; x += cellPx) {
      const inside = shapes.some((s, i) => x >= boxes[i].x0 && x <= boxes[i].x1 && y >= boxes[i].y0 && y <= boxes[i].y1 && s.rings.some((ring) => d3.polygonContains(ring, [x, y])))
      if (inside) cells.push([x, y])
    }
    const live = map.regions.map((_, i) => i).filter((i) => values[i] != null && values[i]! > 0)
    const homes = live.map((i) => shapeCentroid(shapes[i]))
    const owner = griddedCartogram(cells, homes, live.map((i) => values[i]!))
    const quota = apportion(cells.length, live.map((i) => values[i]!))
    // number of separate pieces per region (cells touching by an edge are one piece)
    const key = (p: Pt) => `${Math.round(p[0] / cellPx)},${Math.round(p[1] / cellPx)}`
    const pieces = live.map((_, li) => {
      const set = new Map(cells.filter((_, c) => owner[c] === li).map((p) => [key(p), p]))
      let n = 0
      const seen = new Set<string>()
      for (const k0 of set.keys()) {
        if (seen.has(k0)) continue
        n++
        const stack = [k0]
        seen.add(k0)
        while (stack.length) { const [a, b] = stack.pop()!.split(',').map(Number); for (const nb of [`${a + 1},${b}`, `${a - 1},${b}`, `${a},${b + 1}`, `${a},${b - 1}`]) if (set.has(nb) && !seen.has(nb)) { seen.add(nb); stack.push(nb) } }
      }
      return n
    })
    return { cells, live, owner, quota, pieces, homes }
  }, [shapes, values, map, cellPx, width, height])
  const marked = new Set(linked?.rows ?? [])
  const k = zoom.t.k
  if (!roleColumn(mapping, 'region') || !roleColumn(mapping, 'value')) return <ChartMessage>지역 ID(범주형)와 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!layout.live.length) return <ChartMessage>지도와 맞는 지역 ID에 0보다 큰 값이 없습니다.</ChartMessage>
  const labelPos = layout.live.map((_, li) => { const mine = layout.cells.filter((_, c) => layout.owner[c] === li); return mine.length ? [d3.mean(mine, (p) => p[0])!, d3.mean(mine, (p) => p[1])!] as Pt : null })
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg map-svg" role="img" data-testid="chart-svg" aria-label={`격자형 카토그램: 칸 ${layout.cells.length}개를 ${layout.live.length}개 지역에 배분`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${zoom.t.x},${zoom.t.y}) scale(${k})`}>
          {params.ghost && !compact && shapes.map((s) => <path key={s.id} d={shapePath(s)} fill="none" stroke="#d5dbd9" strokeDasharray="3 3" strokeWidth={0.7} vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
          {layout.cells.map((p, c) => {
            const li = layout.owner[c]
            if (li < 0) return null
            const ri = layout.live[li]
            const r = map.regions[ri]
            const row = data.get(r.id)
            const on = params.selected === r.id || (row?.rows.some((q) => marked.has(q)) ?? false)
            return <rect key={c} className="grid-cell" data-testid="gridded-cell" data-id={r.id} x={p[0] - cellPx / 2} y={p[1] - cellPx / 2} width={cellPx - 0.8} height={cellPx - 0.8} fill={params.colorBy === 'region' ? colorAt(ri) : fillOf(ri)} stroke={on ? '#121816' : 'none'} strokeWidth={1.4} vectorEffect="non-scaling-stroke"
              onPointerMove={compact ? undefined : (e) => { linked?.set(row?.rows ?? null); const q = localPoint(svgRef.current!, e); show(q.x, q.y, <><b>{r.name}</b><br />{roleColumn(mapping, 'value')}: {fmt(values[ri])}<br />칸 {layout.quota[li]}개 · 덩어리 {layout.pieces[li]}개</>) }} onPointerLeave={() => { hide(); linked?.set(null) }} onClick={compact ? undefined : () => setParams({ selected: params.selected === r.id ? '' : r.id })} />
          })}
          {params.labels && !compact && layout.live.map((ri, li) => { const q = labelPos[li]; return q && layout.quota[li] >= 3 ? <text key={ri} x={q[0]} y={q[1]} dy="0.35em" textAnchor="middle" fontSize={Math.min(11, 5 + Math.sqrt(layout.quota[li]) * 1.2)} fill="#111827" stroke="#fff" strokeWidth={2.5} paintOrder="stroke" pointerEvents="none">{map.regions[ri].name.slice(0, 3)}</text> : null })}
        </g>
      </svg>
      {!compact && (<>
        <Readout items={[{ label: '칸', value: layout.cells.length }, { label: '지역', value: layout.live.length }, { label: '평균 덩어리 수', value: fmt(d3.mean(layout.pieces) ?? 0, 2) }]} />
        <MapZoomButtons zoom={zoom} k={k} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

function GriddedControls(props: ControlsProps<GriddedParams>) {
  const { params, setParams } = props
  return (
    <CartoControls {...props} morph={false}>
      <ControlGroup title="격자">
        <Slider label="칸 크기" value={params.cellPx} min={7} max={34} onChange={(cellPx) => setParams({ cellPx })} format={(v) => `${v}px`} testId="ctl-grid-cell" />
        <Toggle label="지역 이름" checked={params.labels} onChange={(labels) => setParams({ labels })} />
        <Hint>지도 안에 들어가는 같은 크기의 칸 전체를 값에 비례해 지역에 나눠 줍니다(최대 잉여법으로 정수 배분). 칸은 지역의 원래 중심에서 가까운 순서로 배정되므로 위치감이 어느 정도 유지되지만, 값이 큰 지역이 이웃 영역으로 번지면서 ‘덩어리’ 수가 1보다 커질 수 있습니다. 칸 하나는 항상 같은 값(전체의 일정 비율)을 뜻해 개수를 세어 비교할 수 있습니다.</Hint>
      </ControlGroup>
    </CartoControls>
  )
}

export const griddedCartogramModule: VizModule<GriddedParams> = {
  roles: cartoRoles,
  datasets: ['kr-regions', 'world-regions'],
  defaultParams: { ...cartoDefaults, colorBy: 'region', cellPx: 16 },
  Chart: GriddedChart,
  Controls: GriddedControls,
  hint: '칸 하나가 같은 값을 뜻합니다 · 칸 크기를 바꾸면 해상도와 덩어리 수가 달라집니다 · 칸을 눌러 지역 선택',
}
