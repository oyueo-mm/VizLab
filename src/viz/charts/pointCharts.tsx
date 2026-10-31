import * as d3 from 'd3'
import { Trash2 } from 'lucide-react'
import { useCallback, useMemo, useRef, useState, type PointerEvent } from 'react'
import { ChartMessage, Legend, Readout, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { appendRow, removeRows, templateRow, updateRow } from '../../data/table'
import { project } from '../../geo/projections'
import { MapZoomButtons, useMapZoom } from '../../geo/useMapZoom'
import { categoryColor, schemes, type ColorScheme } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { clusterByRadius, kdeMap, KM_PER_DEG, sampleGrid, squareCorners, squareGrid, type GridAgg, type WeightedPoint } from '../../stats/spatial'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { BaseMap, GeoControls, geoDefaults, latRole, lonRole, readPoints, resolvePointMap, useProjection, type GeoParams } from './geoShared'
import { boxFor, colorRamp, DotCanvas, RampLegend, SurfaceStage, type DotSpec, type SurfaceParams } from './geoKit'

const round4 = (v: number) => Math.round(v * 1e4) / 1e4
const seqSchemes = (Object.keys(schemes) as ColorScheme[]).filter((k) => !schemes[k].diverging)
const schemeOptions = seqSchemes.map((k) => ({ value: k, label: schemes[k].name }))

/** Shared set-up of a zoomable point map: parsed points, the map to draw, its projection, zoom and tooltip. */
function usePointStage(table: ChartProps<GeoParams>['table'], mapping: ChartProps<GeoParams>['mapping'], params: GeoParams, width: number, height: number, compact: boolean | undefined) {
  const { pts, skipped } = useMemo(() => readPoints(table, mapping, { lat: 'lat', lon: 'lon', value: 'value', label: 'label', group: 'group' }), [table, mapping])
  const resolved = useMemo(() => resolvePointMap(params, pts), [params, pts])
  const projection = useProjection(resolved.map, params, width, height, resolved.id)
  const svgRef = useRef<SVGSVGElement>(null)
  const zoom = useMapZoom(svgRef, { enabled: !compact, width, height })
  const tip = useTooltip()
  const placed = useMemo(() => pts.map((p) => ({ p, xy: project(projection, p.lon, p.lat) })).filter((q): q is { p: (typeof pts)[number]; xy: [number, number] } => !!q.xy), [pts, projection])
  return { pts, skipped, resolved, projection, svgRef, zoom, ...tip, placed }
}

// ─── point map ──────────────────────────────────────────────────────────────────────

export interface PointMapParams extends GeoParams { size: number; opacity: number; colorBy: 'single' | 'value' | 'group'; scheme: ColorScheme; labels: boolean; showMap: boolean; selected: number }
const CANVAS_FROM = 3000

function PointMapChart({ table, mapping, params, setParams, width, height, compact, onTableChange, linked }: ChartProps<PointMapParams>) {
  const st = usePointStage(table, mapping, params, width, height, compact)
  const { pts, placed, projection, svgRef, zoom, tip: tooltip, show, hide } = st
  const drag = useRef<number | null>(null)
  const [brush, setBrush] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const groups = useMemo(() => [...new Set(pts.map((p) => p.group))].filter(Boolean), [pts])
  const gcolor = useMemo(() => categoryColor(groups), [groups])
  const scheme = schemes[params.scheme]
  const [lo, hi] = d3.extent(pts, (p) => p.value ?? NaN) as [number, number]
  const colorOf = (p: (typeof pts)[number]) => (params.colorBy === 'value' && p.value != null && hi > lo ? scheme.interpolate(0.15 + 0.85 * ((p.value - lo) / (hi - lo))) : params.colorBy === 'group' && p.group ? gcolor(p.group) : '#2a7d74')
  const marked = new Set(linked?.rows ?? [])
  const editable = !!onTableChange && !compact && pts.length <= CANVAS_FROM
  const k = zoom.t.k
  const canvasMode = pts.length > CANVAS_FROM
  const r = compact ? Math.max(1, params.size * 0.45) : params.size
  const tree = useMemo(() => (canvasMode ? d3.quadtree<{ p: (typeof placed)[number]['p']; xy: [number, number] }>().x((d) => d.xy[0]).y((d) => d.xy[1]).addAll(placed) : null), [canvasMode, placed])
  const dots: DotSpec[] = useMemo(() => (canvasMode ? placed.map(({ p, xy }) => ({ x: xy[0], y: xy[1], r, color: colorOf(p), row: p.row })) : []), [canvasMode, placed, r, params.colorBy, params.scheme, groups]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!roleColumn(mapping, 'lat') || !roleColumn(mapping, 'lon')) return <ChartMessage>위도와 경도(숫자형) 열을 선택하세요.</ChartMessage>
  if (!pts.length) return <ChartMessage>위도(−90~90)와 경도(−180~180)가 올바른 행이 없습니다.</ChartMessage>

  const local = (e: { clientX: number; clientY: number }) => { const p = localPoint(svgRef.current!, e); return { x: p.x, y: p.y, mx: (p.x - zoom.t.x) / k, my: (p.y - zoom.t.y) / k } }
  const toGeo = (e: PointerEvent | React.MouseEvent) => { const l = local(e); return projection.invert?.([l.mx, l.my]) ?? null }
  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!e.shiftKey || compact) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const l = local(e)
    setBrush({ x0: l.x, y0: l.y, x1: l.x, y1: l.y })
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (brush) { const l = local(e); setBrush({ ...brush, x1: l.x, y1: l.y }); return }
    if (drag.current != null) {
      const g = toGeo(e)
      if (g && Number.isFinite(g[0]) && Number.isFinite(g[1])) onTableChange!(updateRow(table, drag.current, { [roleColumn(mapping, 'lat')!]: round4(g[1]), [roleColumn(mapping, 'lon')!]: round4(g[0]) }), true)
      return
    }
    if (canvasMode && tree && !compact) {
      const l = local(e)
      const hit = tree.find(l.mx, l.my, 8 / k)
      if (hit) show(l.x, l.y, <><b>{hit.p.label || `행 ${hit.p.row + 1}`}</b><br />{fmt(hit.p.lat, 3)}°, {fmt(hit.p.lon, 3)}°{hit.p.value != null ? <><br />값 {fmt(hit.p.value)}</> : null}</>)
      else hide()
    }
  }
  const onUp = () => {
    if (brush) {
      const x0 = Math.min(brush.x0, brush.x1), x1 = Math.max(brush.x0, brush.x1), y0 = Math.min(brush.y0, brush.y1), y1 = Math.max(brush.y0, brush.y1)
      setPicked(new Set(placed.filter(({ xy }) => { const sx = xy[0] * k + zoom.t.x, sy = xy[1] * k + zoom.t.y; return sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1 }).map(({ p }) => p.row)))
      setBrush(null)
    }
    if (drag.current != null) { drag.current = null; onTableChange!(table, false) }
  }
  const onDbl = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!editable || (e.target as Element).closest('[data-nodrag]')) return
    const g = toGeo(e)
    if (!g || !Number.isFinite(g[0])) return
    onTableChange!(appendRow(table, { ...templateRow(table), [roleColumn(mapping, 'lat')!]: round4(g[1]), [roleColumn(mapping, 'lon')!]: round4(g[0]) }))
    setParams({ selected: table.rows.length })
  }
  const sel = placed.filter(({ p }) => picked.has(p.row))
  const selVals = sel.map(({ p }) => p.value).filter((v): v is number => v != null)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg map-svg" role="img" data-testid="chart-svg" tabIndex={editable ? 0 : undefined} aria-label={`위치 점 지도: ${pts.length}개 위치`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={onDbl} onPointerLeave={() => { hide(); linked?.set(null) }}
        onKeyDown={(e) => { if (editable && params.selected >= 0 && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); onTableChange!(removeRows(table, [params.selected])); setParams({ selected: -1 }) } }}>
        <g transform={`translate(${zoom.t.x},${zoom.t.y}) scale(${k})`}>
          {params.showMap && <BaseMap map={st.resolved.map} projection={projection} />}
          {!canvasMode && placed.map(({ p, xy }) => {
            const on = params.selected === p.row || marked.has(p.row) || picked.has(p.row)
            return (
              <g key={p.row}>
                <circle data-testid="map-point" data-row={p.row} data-nodrag={editable ? '' : undefined} className={editable ? 'is-draggable' : ''} cx={xy[0]} cy={xy[1]} r={(on ? r + 1.5 : r) / k}
                  fill={colorOf(p)} fillOpacity={params.opacity} stroke={on ? '#121816' : '#ffffff'} strokeWidth={on ? 1.8 : 0.8} vectorEffect="non-scaling-stroke"
                  onPointerDown={editable ? (e) => { if (e.shiftKey) return; e.stopPropagation(); ;(svgRef.current as Element).setPointerCapture(e.pointerId); drag.current = p.row; setParams({ selected: p.row }); hide() } : undefined}
                  onPointerEnter={compact ? undefined : (e) => {
                    if (drag.current != null) return
                    linked?.set([p.row])
                    const lp = localPoint(svgRef.current!, e)
                    show(lp.x, lp.y, <><b>{p.label || `행 ${p.row + 1}`}</b><br />{fmt(p.lat, 3)}°, {fmt(p.lon, 3)}°{p.value != null ? <><br />{roleColumn(mapping, 'value')}: {fmt(p.value)}</> : null}{p.group ? <><br />{p.group}</> : null}{editable ? <><br />드래그해 위치 이동</> : null}</>)
                  }} onPointerLeave={() => { hide(); linked?.set(null) }} />
                {params.labels && !compact && p.label && <text className="net-label" x={xy[0] + (r + 3) / k} y={xy[1]} dy="0.32em" fontSize={11 / k} pointerEvents="none">{p.label}</text>}
              </g>
            )
          })}
        </g>
        {brush && <rect x={Math.min(brush.x0, brush.x1)} y={Math.min(brush.y0, brush.y1)} width={Math.abs(brush.x1 - brush.x0)} height={Math.abs(brush.y1 - brush.y0)} fill="#e07a3f" fillOpacity={0.12} stroke="#e07a3f" strokeDasharray="4 3" pointerEvents="none" data-testid="brush" />}
      </svg>
      {canvasMode && <DotCanvas dots={dots} width={width} height={height} t={zoom.t} opacity={params.opacity} />}
      {!compact && (
        <>
          {params.colorBy === 'group' && groups.length > 0 && <Legend items={groups.map((g) => ({ key: g, color: gcolor(g) }))} title={roleColumn(mapping, 'group') ?? ''} />}
          {params.colorBy === 'value' && hi > lo && <RampLegend interpolate={(t) => scheme.interpolate(0.15 + 0.85 * t)} min={fmt(lo)} max={fmt(hi)} />}
          <Readout items={[{ label: '점', value: pts.length.toLocaleString() }, ...(picked.size ? [{ label: '선택', value: `${sel.length}개${selVals.length ? ` · 합 ${fmt(d3.sum(selVals))} · 평균 ${fmt(d3.mean(selVals))}` : ''}` }] : []), ...(canvasMode ? [{ label: '렌더링', value: 'Canvas' }] : [])]} />
          <MapZoomButtons zoom={zoom} k={k} />
          {st.skipped > 0 && <p className="chart-warning" role="status">좌표가 없거나 범위를 벗어난 {st.skipped}행은 그리지 않았습니다.</p>}
          {editable && params.selected >= 0 && params.selected < table.rows.length && (
            <div className="chart-actions" style={{ bottom: 'auto', top: 44, right: 8 }}><span>행 {params.selected + 1} 선택</span><button type="button" onClick={() => { onTableChange!(removeRows(table, [params.selected])); setParams({ selected: -1 }) }} data-testid="point-delete"><Trash2 size={14} aria-hidden="true" />삭제</button></div>
          )}
          <Tooltip tip={tooltip} width={width} />
        </>
      )}
    </div>
  )
}

function PointMapControls({ params, setParams, table, mapping }: ControlsProps<PointMapParams>) {
  const { pts } = useMemo(() => readPoints(table, mapping, { lat: 'lat', lon: 'lon' }), [table, mapping])
  const resolved = useMemo(() => resolvePointMap(params, pts), [params, pts])
  return (
    <>
      <ControlGroup title="점">
        <Slider label="점 크기 (반지름)" value={params.size} min={1} max={14} step={0.5} onChange={(size) => setParams({ size })} format={(v) => `${v}px`} testId="ctl-point-size" />
        <Slider label="불투명도" value={params.opacity} min={0.15} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} />
        <Segmented label="색 기준" value={params.colorBy} onChange={(colorBy) => setParams({ colorBy })} testId="ctl-point-color" options={[{ value: 'single', label: '단색' }, { value: 'value', label: '값' }, { value: 'group', label: '그룹' }]} />
        {params.colorBy === 'value' && <Select label="값 팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={schemeOptions} />}
        <Toggle label="이름 표시" checked={params.labels} onChange={(labels) => setParams({ labels })} />
        <Toggle label="배경 지도" checked={params.showMap} onChange={(showMap) => setParams({ showMap })} />
      </ControlGroup>
      <ControlGroup title="편집·선택" defaultOpen={false}>
        <Hint>점을 끌어 위치를 옮기고, 빈 곳을 더블클릭하면 점이 추가됩니다. 선택한 점은 Delete 키로 지웁니다. Shift를 누른 채 끌면 사각형 영역을 선택해 개수와 합계를 봅니다. 점이 {CANVAS_FROM.toLocaleString()}개를 넘으면 Canvas로 그리며 이때는 편집을 끕니다.</Hint>
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams} resolved={resolved} /></ControlGroup>
    </>
  )
}

const pointRoles = [
  latRole(), lonRole(),
  { key: 'value', label: '값 (선택)', type: 'number' as const, prefer: '값|value' },
  { key: 'label', label: '이름 (선택)', type: 'category' as const, auto: true, prefer: '지역|이름|name' },
  { key: 'group', label: '그룹 (색, 선택)', type: 'category' as const },
]

export const pointMapModule: VizModule<PointMapParams> = {
  roles: pointRoles,
  datasets: ['geo-points', 'kr-regions'],
  defaultParams: { ...geoDefaults, size: 3, opacity: 0.7, colorBy: 'value', scheme: 'viridis', labels: false, showMap: true, selected: -1 },
  Chart: PointMapChart,
  Controls: PointMapControls,
  hint: '점을 끌어 이동 · 빈 곳 더블클릭으로 추가 · Shift+드래그로 영역 선택 · 점이 많으면 자동으로 Canvas로 그림',
}

// ─── square grid map ────────────────────────────────────────────────────────────────

export interface SquareGridParams extends GeoParams { cellKm: number; agg: GridAgg; scheme: ColorScheme; showPoints: boolean; opacity: number }

function SquareGridChart({ table, mapping, params, width, height, compact, linked }: ChartProps<SquareGridParams>) {
  const st = usePointStage(table, mapping, params, width, height, compact)
  const { pts, projection, svgRef, zoom, tip: tooltip, show, hide } = st
  const origin: [number, number] = useMemo(() => [d3.min(pts, (p) => p.lon) ?? 0, d3.min(pts, (p) => p.lat) ?? 0], [pts])
  const cellKm = compact ? params.cellKm * 1.8 : params.cellKm
  const cells = useMemo(() => squareGrid(pts.map((p) => ({ lon: p.lon, lat: p.lat, value: p.value ?? 1, row: p.row })), cellKm, params.agg, origin), [pts, cellKm, params.agg, origin])
  const drawn = useMemo(() => cells.map((c) => {
    const ring = squareCorners(c, cellKm, origin).map(([lo, la]) => project(projection, lo, la))
    return { c, d: ring.every(Boolean) ? `M${(ring as [number, number][]).map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('L')}Z` : null }
  }).filter((x) => x.d), [cells, cellKm, origin, projection])
  const vmax = d3.max(cells, (c) => c.value) ?? 1
  const scheme = schemes[params.scheme]
  const marked = new Set(linked?.rows ?? [])
  const k = zoom.t.k
  const aggLabel = { count: '개수', sum: '합계', mean: '평균', max: '최댓값' }[params.agg]
  if (!roleColumn(mapping, 'lat') || !roleColumn(mapping, 'lon')) return <ChartMessage>위도와 경도(숫자형) 열을 선택하세요.</ChartMessage>
  if (!pts.length) return <ChartMessage>위도(−90~90)와 경도(−180~180)가 올바른 행이 없습니다.</ChartMessage>
  if (params.agg !== 'count' && !roleColumn(mapping, 'value')) return <ChartMessage>합계·평균·최댓값에는 ‘값’ 열이 필요합니다. 열을 선택하거나 개수를 고르세요.</ChartMessage>
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg map-svg" role="img" data-testid="chart-svg" aria-label={`사각 격자 집계 지도: 점 ${pts.length}개를 ${cells.length}칸에 집계`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${zoom.t.x},${zoom.t.y}) scale(${k})`}>
          <BaseMap map={st.resolved.map} projection={projection} />
          {drawn.map(({ c, d }) => {
            const on = c.rows.some((r) => marked.has(r))
            return (
              <path key={`${c.ix},${c.iy}`} className="mark-hex" data-testid="grid-cell" data-count={c.count} d={d!} fill={scheme.interpolate(0.1 + 0.9 * (vmax > 0 ? c.value / vmax : 0))} fillOpacity={params.opacity}
                stroke={on ? '#e07a3f' : '#ffffff'} strokeWidth={on ? 2 : 0.5} vectorEffect="non-scaling-stroke"
                onPointerEnter={compact ? undefined : (e) => { linked?.set(c.rows); const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{aggLabel} {fmt(c.value)}</b><br />점 {c.count}개{params.agg !== 'count' ? <> · 합계 {fmt(c.sum)}</> : null}<br />칸 크기 {fmt(cellKm, 1)} × {fmt(cellKm, 1)} km</>) }}
                onPointerLeave={() => { hide(); linked?.set(null) }} />
            )
          })}
          {params.showPoints && !compact && st.placed.slice(0, 4000).map(({ p, xy }) => <circle key={p.row} cx={xy[0]} cy={xy[1]} r={1.1 / k} fill="#121816" fillOpacity={0.5} pointerEvents="none" />)}
        </g>
      </svg>
      {!compact && (<>
        <RampLegend interpolate={(t) => scheme.interpolate(0.1 + 0.9 * t)} min="0" max={fmt(vmax, 3)} label={aggLabel} />
        <Readout items={[{ label: '점', value: pts.length.toLocaleString() }, { label: '칸', value: cells.length }, { label: '칸 크기', value: `${fmt(cellKm, 1)} km` }]} />
        <MapZoomButtons zoom={zoom} k={k} />
        <Tooltip tip={tooltip} width={width} />
      </>)}
    </div>
  )
}

function SquareGridControls({ params, setParams, table, mapping }: ControlsProps<SquareGridParams>) {
  const { pts } = useMemo(() => readPoints(table, mapping, { lat: 'lat', lon: 'lon' }), [table, mapping])
  const resolved = useMemo(() => resolvePointMap(params, pts), [params, pts])
  return (
    <>
      <ControlGroup title="집계">
        <Slider label="칸 한 변 (땅 위 km)" value={params.cellKm} min={3} max={120} onChange={(cellKm) => setParams({ cellKm })} format={(v) => `${v} km`} testId="ctl-cell-km" />
        <Select label="집계 함수" value={params.agg} onChange={(agg) => setParams({ agg })} testId="ctl-grid-agg" options={[{ value: 'count', label: '점 개수' }, { value: 'sum', label: '값 합계' }, { value: 'mean', label: '값 평균' }, { value: 'max', label: '값 최댓값' }]} />
        <Hint>칸은 각 점을 지나는 평면(동서·남북 거리 km)에서 나누므로 모든 칸의 땅 면적이 같습니다. 칸 크기를 바꾸면 같은 점도 다른 패턴이 되는데(수정 가능 면적 단위 문제, MAUP) 하나의 크기만 믿지 마세요. 평균은 점이 1~2개뿐인 칸에서 불안정합니다.</Hint>
      </ControlGroup>
      <ControlGroup title="표현">
        <Select label="색상 팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={schemeOptions} />
        <Slider label="칸 불투명도" value={params.opacity} min={0.3} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} />
        <Toggle label="원본 위치 표시" checked={params.showPoints} onChange={(showPoints) => setParams({ showPoints })} />
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams} resolved={resolved} /></ControlGroup>
    </>
  )
}

export const squareGridModule: VizModule<SquareGridParams> = {
  roles: [latRole(), lonRole(), { key: 'value', label: '값 (선택)', type: 'number', prefer: '값|value' }],
  datasets: ['geo-points', 'kr-regions'],
  defaultParams: { ...geoDefaults, cellKm: 25, agg: 'count', scheme: 'teal', showPoints: false, opacity: 0.88 },
  Chart: SquareGridChart,
  Controls: SquareGridControls,
  hint: '칸 크기와 집계 함수를 바꿔 같은 점이 어떻게 달리 보이는지 비교 · 칸에 포인터를 올리면 개수와 합계',
}

// ─── spike map ──────────────────────────────────────────────────────────────────────

export interface SpikeParams extends GeoParams { maxHeight: number; width: number; opacity: number; scheme: ColorScheme; colorBy: 'single' | 'value'; showMap: boolean; labels: boolean }

function SpikeChart({ table, mapping, params, width, height, compact, linked }: ChartProps<SpikeParams>) {
  const st = usePointStage(table, mapping, params, width, height, compact)
  const { pts, placed, projection, svgRef, zoom, tip: tooltip, show, hide } = st
  const vmax = d3.max(pts, (p) => p.value ?? 0) ?? 0
  const H = compact ? params.maxHeight * 0.5 : params.maxHeight
  const W = compact ? params.width * 0.6 : params.width
  const scheme = schemes[params.scheme]
  const marked = new Set(linked?.rows ?? [])
  const k = zoom.t.k
  if (!roleColumn(mapping, 'lat') || !roleColumn(mapping, 'lon') || !roleColumn(mapping, 'value')) return <ChartMessage>위도, 경도, 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!placed.some(({ p }) => (p.value ?? 0) > 0)) return <ChartMessage>0보다 큰 값이 있는 위치가 없습니다.</ChartMessage>
  // northern spikes first, so spikes standing in front (south) overlap those behind them
  const sorted = [...placed].filter(({ p }) => (p.value ?? 0) > 0).sort((a, b) => a.xy[1] - b.xy[1])
  const ref = [vmax / 4, vmax / 2, vmax]
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg map-svg" role="img" data-testid="chart-svg" aria-label={`스파이크 지도: ${sorted.length}개 위치`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${zoom.t.x},${zoom.t.y}) scale(${k})`}>
          {params.showMap && <BaseMap map={st.resolved.map} projection={projection} />}
          {sorted.map(({ p, xy }) => {
            const h = (H * (p.value ?? 0)) / vmax
            const on = marked.has(p.row)
            return (
              <g key={p.row}>
                <path data-testid="spike" data-row={p.row} data-h={h.toFixed(2)} d={`M${xy[0] - W / 2 / k},${xy[1]}L${xy[0]},${xy[1] - h / k}L${xy[0] + W / 2 / k},${xy[1]}Z`}
                  fill={params.colorBy === 'value' ? scheme.interpolate(0.25 + 0.75 * ((p.value ?? 0) / vmax)) : '#d6573c'} fillOpacity={params.opacity} stroke={on ? '#121816' : '#7a2d1c'} strokeWidth={on ? 1.8 : 0.7} strokeLinejoin="round" vectorEffect="non-scaling-stroke"
                  onPointerEnter={compact ? undefined : (e) => { linked?.set([p.row]); const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{p.label || `행 ${p.row + 1}`}</b><br />값 {fmt(p.value)}<br />스파이크 높이 {h.toFixed(0)}px</>) }}
                  onPointerLeave={() => { hide(); linked?.set(null) }} />
                {params.labels && !compact && p.label && h > 22 && <text className="net-label" x={xy[0]} y={xy[1] - h / k - 4 / k} textAnchor="middle" fontSize={10 / k} pointerEvents="none">{p.label}</text>}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (<>
        <svg className="size-legend-svg" width={110} height={H + 24} aria-label="높이 범례" style={{ position: 'absolute', left: 8, bottom: 8 }}>
          {ref.map((v, i) => { const h = (H * v) / vmax; const x = 16 + i * 32; return <g key={v}><path d={`M${x - W / 2},${H + 6}L${x},${H + 6 - h}L${x + W / 2},${H + 6}Z`} fill="#d6573c" fillOpacity={0.6} stroke="#7a2d1c" strokeWidth={0.7} /><text x={x} y={H + 20} textAnchor="middle" className="bar-label">{fmt(v, 1)}</text></g> })}
        </svg>
        <Readout items={[{ label: '위치', value: sorted.length }, { label: '최댓값', value: fmt(vmax) }]} />
        <MapZoomButtons zoom={zoom} k={k} />
        <Tooltip tip={tooltip} width={width} />
      </>)}
    </div>
  )
}

function SpikeControls({ params, setParams, table, mapping }: ControlsProps<SpikeParams>) {
  const { pts } = useMemo(() => readPoints(table, mapping, { lat: 'lat', lon: 'lon' }), [table, mapping])
  const resolved = useMemo(() => resolvePointMap(params, pts), [params, pts])
  return (
    <>
      <ControlGroup title="스파이크">
        <Slider label="최대 높이" value={params.maxHeight} min={20} max={220} step={5} onChange={(maxHeight) => setParams({ maxHeight })} format={(v) => `${v}px`} testId="ctl-spike-h" />
        <Slider label="밑변 너비" value={params.width} min={2} max={24} onChange={(width) => setParams({ width })} format={(v) => `${v}px`} />
        <Slider label="불투명도" value={params.opacity} min={0.2} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} />
        <Segmented label="색 기준" value={params.colorBy} onChange={(colorBy) => setParams({ colorBy })} options={[{ value: 'single', label: '단색' }, { value: 'value', label: '값' }]} />
        {params.colorBy === 'value' && <Select label="값 팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={schemeOptions} />}
        <Toggle label="이름 표시 (큰 스파이크)" checked={params.labels} onChange={(labels) => setParams({ labels })} />
        <Toggle label="배경 지도" checked={params.showMap} onChange={(showMap) => setParams({ showMap })} />
        <Hint>높이가 값에 정확히 비례합니다(밑변은 고정). 원의 넓이보다 길이가 비교하기 쉽고 좁은 선이라 밀집한 도시도 겹침이 덜하지만, 앞쪽(남쪽) 스파이크가 뒤쪽을 가릴 수 있습니다.</Hint>
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams} resolved={resolved} /></ControlGroup>
    </>
  )
}

export const spikeMapModule: VizModule<SpikeParams> = {
  roles: [{ key: 'value', label: '값 (스파이크 높이)', type: 'number', required: true, prefer: '값|value|인구|population' }, latRole(), lonRole(), { key: 'label', label: '이름 (선택)', type: 'category', auto: true, prefer: '지역|국가|이름|name' }],
  datasets: ['kr-regions', 'world-regions', 'geo-points'],
  defaultParams: { ...geoDefaults, maxHeight: 110, width: 8, opacity: 0.75, scheme: 'ylorrd', colorBy: 'single', showMap: true, labels: false },
  Chart: SpikeChart,
  Controls: SpikeControls,
  hint: '최대 높이와 밑변 너비를 바꿔 보세요 · 스파이크에 포인터를 올리면 값 · 휠·드래그로 확대와 이동',
}

// ─── cluster map ────────────────────────────────────────────────────────────────────

export interface ClusterParams extends GeoParams { radius: number; showMap: boolean; useWeight: boolean }
const clusterColor = (n: number) => (n < 10 ? '#6fae5e' : n < 50 ? '#e0b43a' : n < 200 ? '#e07a3f' : '#c04a3a')

function ClusterChart({ table, mapping, params, width, height, compact, linked }: ChartProps<ClusterParams>) {
  const st = usePointStage(table, mapping, params, width, height, compact)
  const { pts, placed, projection, svgRef, zoom, tip: tooltip, show, hide } = st
  const kq = Math.round(zoom.t.k * 20) / 20
  const radius = compact ? params.radius * 0.8 : params.radius
  const clusters = useMemo(() => clusterByRadius(placed.map(({ p, xy }, index) => ({ x: xy[0] * kq, y: xy[1] * kq, weight: params.useWeight && p.value != null && p.value > 0 ? p.value : 1, index })), radius), [placed, kq, radius, params.useWeight])
  // cluster that held each point one zoom step earlier, to animate a split from the parent's position
  const prev = useRef<{ k: number; where: Map<number, { x: number; y: number; n: number }> }>({ k: kq, where: new Map() })
  const origins = useMemo(() => {
    const p = prev.current
    const out = new Map<string, { dx: number; dy: number }>()
    if (p.k !== kq && p.where.size) for (const c of clusters) {
      const parent = p.where.get(c.members[0])
      if (parent && parent.n > c.count) out.set(c.id, { dx: (parent.x - c.x) / kq, dy: (parent.y - c.y) / kq })
    }
    return out
  }, [clusters, kq])
  const where = useMemo(() => { const m = new Map<number, { x: number; y: number; n: number }>(); for (const c of clusters) for (const i of c.members) m.set(i, { x: c.x, y: c.y, n: c.count }); return m }, [clusters])
  prev.current = { k: kq, where }
  const marked = new Set(linked?.rows ?? [])
  const k = zoom.t.k
  if (!roleColumn(mapping, 'lat') || !roleColumn(mapping, 'lon')) return <ChartMessage>위도와 경도(숫자형) 열을 선택하세요.</ChartMessage>
  if (!pts.length) return <ChartMessage>위도(−90~90)와 경도(−180~180)가 올바른 행이 없습니다.</ChartMessage>
  const rowsOf = (members: number[]) => members.map((i) => placed[i].p.row)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg map-svg" role="img" data-testid="chart-svg" aria-label={`클러스터 마커 지도: 점 ${pts.length}개가 마커 ${clusters.length}개로 묶임`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${zoom.t.x},${zoom.t.y}) scale(${k})`}>
          {params.showMap && <BaseMap map={st.resolved.map} projection={projection} />}
          {clusters.map((c) => {
            const o = origins.get(c.id)
            const single = c.count === 1
            const r = single ? 4.5 : Math.min(30, 10 + 3.2 * Math.sqrt(c.count))
            const rows = rowsOf(c.members)
            const on = rows.some((rw) => marked.has(rw))
            return (
              <g key={c.id} className="cluster-mark" data-testid="cluster" data-count={c.count} style={o ? ({ '--dx': `${o.dx}px`, '--dy': `${o.dy}px` } as React.CSSProperties) : undefined}
                onPointerEnter={compact ? undefined : (e) => { linked?.set(rows); const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, single ? <><b>{placed[c.members[0]].p.label || `행 ${rows[0] + 1}`}</b><br />{fmt(placed[c.members[0]].p.lat, 3)}°, {fmt(placed[c.members[0]].p.lon, 3)}°</> : <><b>{c.count}개 묶음</b><br />클릭하면 확대해 풀어 봅니다</>) }}
                onPointerLeave={() => { hide(); linked?.set(null) }}
                onClick={compact || single ? undefined : () => { const cx = c.x / kq, cy = c.y / kq; zoom.to(cx, cy, Math.min(60, k * 2.4)) }}>
                <circle cx={c.x / kq} cy={c.y / kq} r={(on ? r + 2 : r) / k} fill={single ? '#2a7d74' : clusterColor(c.count)} fillOpacity={single ? 0.85 : 0.82} stroke={on ? '#121816' : '#ffffff'} strokeWidth={on ? 2 : 1.4} vectorEffect="non-scaling-stroke" style={{ cursor: single ? 'default' : 'pointer' }} />
                {!single && !compact && <text x={c.x / kq} y={c.y / kq} dy="0.35em" textAnchor="middle" fontSize={12 / k} fontWeight={700} fill="#fff" pointerEvents="none">{params.useWeight ? fmt(c.weight, 0) : c.count}</text>}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (<>
        <Readout items={[{ label: '점', value: pts.length.toLocaleString() }, { label: '마커', value: clusters.length }, { label: '확대', value: `${zoom.t.k.toFixed(1)}×` }]} />
        <MapZoomButtons zoom={zoom} k={k} />
        <Tooltip tip={tooltip} width={width} />
      </>)}
    </div>
  )
}

function ClusterControls({ params, setParams, table, mapping }: ControlsProps<ClusterParams>) {
  const { pts } = useMemo(() => readPoints(table, mapping, { lat: 'lat', lon: 'lon' }), [table, mapping])
  const resolved = useMemo(() => resolvePointMap(params, pts), [params, pts])
  return (
    <>
      <ControlGroup title="묶기">
        <Slider label="묶는 반경 (화면 px)" value={params.radius} min={14} max={110} onChange={(radius) => setParams({ radius })} format={(v) => `${v}px`} testId="ctl-cluster-radius" />
        <Toggle label="값으로 가중 (표시 숫자 = 값 합계)" checked={params.useWeight} onChange={(useWeight) => setParams({ useWeight })} />
        <Toggle label="배경 지도" checked={params.showMap} onChange={(showMap) => setParams({ showMap })} />
        <Hint>화면 위에서 가까운 점끼리 묶습니다. 지도를 확대하면 같은 거리가 화면에서 멀어지므로 묶음이 풀리고, 축소하면 다시 합쳐집니다. 묶음을 클릭하면 그 위치로 확대합니다. 묶음 위치는 구성원의 가중 평균이라 실제 점 위치가 아닙니다.</Hint>
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams} resolved={resolved} /></ControlGroup>
    </>
  )
}

export const clusterMapModule: VizModule<ClusterParams> = {
  roles: [latRole(), lonRole(), { key: 'value', label: '값 (선택, 가중치)', type: 'number', prefer: '값|value' }, { key: 'label', label: '이름 (선택)', type: 'category', auto: true, prefer: '지역|이름|name' }],
  datasets: ['geo-points', 'kr-regions'],
  defaultParams: { ...geoDefaults, radius: 46, showMap: true, useWeight: false },
  Chart: ClusterChart,
  Controls: ClusterControls,
  hint: '휠로 확대·축소하면 묶음이 풀리고 합쳐집니다 · 묶음을 클릭하면 그 위치로 확대 · 묶는 반경 조절',
}

// ─── spatial KDE heatmap ────────────────────────────────────────────────────────────

export interface KdeMapParams extends SurfaceParams { auto: boolean; bandwidth: number; scheme: ColorScheme; floor: number; ceiling: number; opacity: number; showPoints: boolean }

/** Normal-reference bandwidth in km from the ground spread of the points: 1.06·σ·n^(−1/5), σ the mean of the east and north standard deviations. */
export function autoBandwidthKm(pts: readonly { lon: number; lat: number }[]): number {
  if (pts.length < 2) return 10
  const lat0 = d3.mean(pts, (p) => p.lat) ?? 0
  const sx = d3.deviation(pts, (p) => p.lon * Math.cos((lat0 * Math.PI) / 180) * KM_PER_DEG) ?? 1
  const sy = d3.deviation(pts, (p) => p.lat * KM_PER_DEG) ?? 1
  return Math.max(1, 1.06 * ((sx + sy) / 2) * pts.length ** -0.2)
}

function KdeMapChart({ table, mapping, params, width, height, compact }: ChartProps<KdeMapParams>) {
  const { pts } = useMemo(() => readPoints(table, mapping, { lat: 'lat', lon: 'lon', value: 'weight' }), [table, mapping])
  const resolved = useMemo(() => resolvePointMap(params, pts), [params, pts])
  const box = useMemo(() => (pts.length ? boxFor(resolved, pts, 0.15) : { west: 125, east: 130, south: 33, north: 38 }), [resolved, pts])
  const bw = params.auto ? autoBandwidthKm(pts) : params.bandwidth
  const weighted: WeightedPoint[] = useMemo(() => {
    const w = pts.map((p) => ({ lon: p.lon, lat: p.lat, weight: roleColumn(mapping, 'weight') ? Math.max(0, p.value ?? 0) : 1 }))
    if (w.length <= 2500) return w
    // many points: pre-bin on a grid much finer than the bandwidth, so the kernel sum stays cheap and nearly unchanged
    const cell = bw / 4
    const cosM = Math.cos((((box.north + box.south) / 2) * Math.PI) / 180)
    const bins = new Map<string, { lon: number; lat: number; weight: number }>()
    for (const p of w) {
      const key = `${Math.floor((p.lon * cosM * KM_PER_DEG) / cell)},${Math.floor((p.lat * KM_PER_DEG) / cell)}`
      const b = bins.get(key)
      if (b) { const tot = b.weight + p.weight; b.lon = (b.lon * b.weight + p.lon * p.weight) / (tot || 1); b.lat = (b.lat * b.weight + p.lat * p.weight) / (tot || 1); b.weight = tot } else bins.set(key, { ...p })
    }
    return [...bins.values()]
  }, [pts, mapping, bw, box])
  const nx = compact ? 70 : params.gridSize
  const ny = Math.max(20, Math.round((nx * (box.north - box.south)) / ((box.east - box.west) * Math.cos((((box.north + box.south) / 2) * Math.PI) / 180))))
  const grid = useMemo(() => kdeMap(weighted, bw, box, nx, ny), [weighted, bw, box, nx, ny])
  const vmax = useMemo(() => d3.max(grid.values) ?? 1, [grid])
  const scheme = schemes[params.scheme]
  const ramp = useMemo(() => colorRamp(scheme.interpolate), [scheme])
  const lo = vmax * params.floor, hi = vmax * params.ceiling
  const paint = useCallback((lon: number, lat: number) => {
    const v = sampleGrid(grid, lon, lat)
    if (!Number.isFinite(v) || v <= lo) return 0
    const t = Math.min(1, (v - lo) / (hi - lo || 1))
    const c = ramp[Math.round(t * 255)]
    const a = Math.round(255 * params.opacity * Math.min(1, 0.25 + t * 1.5))
    return (c & 0x00ffffff) | (a << 24)
  }, [grid, lo, hi, ramp, params.opacity])
  const stageSurface = useMemo(() => ({ grid, box, model: 'idw' as const, at: (lo2: number, la2: number) => sampleGrid(grid, lo2, la2), points: pts.map((p) => ({ row: p.row, lat: p.lat, lon: p.lon, value: p.value ?? 1, radius: null, label: p.label })), resolved }), [grid, box, pts, resolved])
  if (!roleColumn(mapping, 'lat') || !roleColumn(mapping, 'lon')) return <ChartMessage>위도와 경도(숫자형) 열을 선택하세요.</ChartMessage>
  if (!pts.length) return <ChartMessage>위도(−90~90)와 경도(−180~180)가 올바른 행이 없습니다.</ChartMessage>
  const total = d3.sum(weighted, (p) => p.weight)
  return (
    <SurfaceStage width={width} height={height} compact={compact} params={params} surface={stageSurface} paint={paint} label={`공간 KDE 히트맵: 점 ${pts.length}개, 대역폭 ${fmt(bw, 1)} km`}
      info={(lon, lat) => { const v = sampleGrid(grid, lon, lat); return Number.isFinite(v) ? <>밀도 <b>{v.toPrecision(3)}</b> /km²</> : null }}
      overlay={({ projection, k }) => params.showPoints && !compact ? pts.slice(0, 3000).map((p) => { const xy = project(projection, p.lon, p.lat); return xy ? <circle key={p.row} cx={xy[0]} cy={xy[1]} r={1.2 / k} fill="#111" fillOpacity={0.45} pointerEvents="none" /> : null }) : null}
      legend={!compact && <RampLegend interpolate={scheme.interpolate} min="낮음" max={`${vmax.toPrecision(2)}/km²`} label="밀도" />}
      extra={<Readout items={[{ label: '대역폭', value: `${fmt(bw, 1)} km` }, { label: '가중치 합', value: fmt(total, 1) }, { label: '최대 밀도', value: `${vmax.toPrecision(3)}/km²` }]} />} />
  )
}

function KdeMapControls({ params, setParams, table, mapping }: ControlsProps<KdeMapParams>) {
  const { pts } = useMemo(() => readPoints(table, mapping, { lat: 'lat', lon: 'lon' }), [table, mapping])
  const resolved = useMemo(() => resolvePointMap(params, pts), [params, pts])
  const auto = useMemo(() => autoBandwidthKm(pts), [pts])
  return (
    <>
      <ControlGroup title="밀도 추정">
        <Toggle label="대역폭 자동 (정규 참조 규칙)" checked={params.auto} onChange={(a) => setParams({ auto: a })} testId="ctl-kde-auto" />
        <Slider label={`대역폭 h (km)${params.auto ? ` — 자동 ${fmt(auto, 1)} km` : ''}`} value={params.auto ? auto : params.bandwidth} min={2} max={120} step={1} disabled={params.auto} onChange={(bandwidth) => setParams({ bandwidth })} format={(v) => `${fmt(v, 1)} km`} testId="ctl-kde-bw" />
        <Hint>각 점에 반지름 h의 가우시안 언덕을 올리고 모두 더합니다. h가 작으면 점 하나하나가 튀고, 크면 모든 것이 한 덩어리로 뭉개집니다. 값은 ‘km²당 가중치’ 밀도이며 전체를 적분하면 가중치의 합과 같습니다. 거리는 지도 화면이 아니라 땅 위 km로 잽니다.</Hint>
        <Slider label="격자 해상도" value={params.gridSize} min={60} max={260} step={10} onChange={(gridSize) => setParams({ gridSize })} />
      </ControlGroup>
      <ControlGroup title="색 범위">
        <Select label="색상 팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={schemeOptions} />
        <Slider label="이 밀도 이하는 투명 (최댓값 대비)" value={params.floor} min={0} max={0.6} step={0.02} onChange={(floor) => setParams({ floor })} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-kde-floor" />
        <Slider label="이 밀도에서 최고 색 (최댓값 대비)" value={params.ceiling} min={0.3} max={1} step={0.05} onChange={(ceiling) => setParams({ ceiling })} format={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="불투명도" value={params.opacity} min={0.3} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} />
        <Toggle label="원본 위치 표시" checked={params.showPoints} onChange={(showPoints) => setParams({ showPoints })} />
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams} resolved={resolved} /></ControlGroup>
    </>
  )
}

export const kdeMapModule: VizModule<KdeMapParams> = {
  roles: [latRole(), lonRole(), { key: 'weight', label: '가중치 (선택)', type: 'number', prefer: '값|가중|weight|value' }],
  datasets: ['geo-points', 'kr-regions'],
  defaultParams: { ...geoDefaults, gridSize: 150, roughness: 0, seed: 1, power: 2, auto: true, bandwidth: 25, scheme: 'ylorrd', floor: 0.05, ceiling: 1, opacity: 0.85, showPoints: false },
  Chart: KdeMapChart,
  Controls: KdeMapControls,
  hint: '대역폭(h)을 키우거나 줄여 점 하나하나와 큰 덩어리 사이를 오가 보세요 · 지도 위 포인터로 밀도 확인',
}

