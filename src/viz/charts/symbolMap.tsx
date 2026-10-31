import * as d3 from 'd3'
import { Trash2 } from 'lucide-react'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { ChartMessage, Legend, Readout, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { appendRow, removeRows, templateRow, updateRow } from '../../data/table'
import { MapZoomButtons, useMapZoom } from '../../geo/useMapZoom'
import { project } from '../../geo/projections'
import { categoryColor, schemes, type ColorScheme } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { BaseMap, GeoControls, geoDefaults, latRole, lonRole, readPoints, resolvePointMap, useProjection, type GeoParams } from './geoShared'

export interface SymbolParams extends GeoParams {
  sizeMode: 'area' | 'radius'
  maxRadius: number
  opacity: number
  colorBy: 'single' | 'value' | 'group'
  scheme: ColorScheme
  labels: boolean
  showMap: boolean
  selected: number
}

function SymbolChart({ table, mapping, params, setParams, width, height, compact, onTableChange, linked }: ChartProps<SymbolParams>) {
  const { pts, skipped } = useMemo(() => readPoints(table, mapping, { lat: 'lat', lon: 'lon', value: 'value', label: 'label', group: 'group' }), [table, mapping])
  const resolved = useMemo(() => resolvePointMap(params, pts), [params, pts])
  const projection = useProjection(resolved.map, params, width, height, resolved.id)
  const svgRef = useRef<SVGSVGElement>(null)
  const zoom = useMapZoom(svgRef, { enabled: !compact, width, height })
  const { tip, show, hide } = useTooltip()
  const drag = useRef<number | null>(null)
  const [, setDragging] = useState(false)
  const placed = useMemo(() => pts.map((p) => ({ p, xy: project(projection, p.lon, p.lat) })).filter((q): q is { p: (typeof pts)[number]; xy: [number, number] } => !!q.xy), [pts, projection])
  const vmax = d3.max(pts, (p) => Math.abs(p.value ?? 0)) ?? 0
  const R = compact ? params.maxRadius * 0.4 : params.maxRadius
  // Area encoding: r = R·√(v / vmax), so the circle's area is proportional to the value. Radius encoding (r ∝ v) exaggerates differences.
  const radius = (v: number | null) => (v == null || !(v > 0) || vmax <= 0 ? 0 : params.sizeMode === 'area' ? R * Math.sqrt(v / vmax) : (R * v) / vmax)
  const groups = useMemo(() => [...new Set(pts.map((p) => p.group))].filter(Boolean), [pts])
  const gcolor = useMemo(() => categoryColor(groups), [groups])
  const scheme = schemes[params.scheme]
  const [lo, hi] = d3.extent(pts, (p) => p.value ?? NaN) as [number, number]
  const colorOf = (p: (typeof pts)[number]) => (params.colorBy === 'value' && p.value != null && hi > lo ? scheme.interpolate(0.2 + 0.8 * ((p.value - lo) / (hi - lo))) : params.colorBy === 'group' && p.group ? gcolor(p.group) : '#e07a3f')
  const marked = new Set(linked?.rows ?? [])
  const editable = !!onTableChange && !compact
  const k = zoom.t.k

  if (!roleColumn(mapping, 'lat') || !roleColumn(mapping, 'lon') || !roleColumn(mapping, 'value')) return <ChartMessage>값, 위도, 경도(숫자형) 열을 선택하세요.</ChartMessage>
  if (!pts.length) return <ChartMessage>위도(−90~90)와 경도(−180~180)가 올바른 행이 없습니다.</ChartMessage>

  const toGeo = (e: PointerEvent) => {
    const p = localPoint(svgRef.current!, e)
    return projection.invert?.([(p.x - zoom.t.x) / k, (p.y - zoom.t.y) / k]) ?? null
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (drag.current == null) return
    const g = toGeo(e)
    if (!g || !Number.isFinite(g[0]) || !Number.isFinite(g[1])) return
    onTableChange!(updateRow(table, drag.current, { [roleColumn(mapping, 'lat')!]: Math.round(g[1] * 1e4) / 1e4, [roleColumn(mapping, 'lon')!]: Math.round(g[0] * 1e4) / 1e4 }), true)
  }
  const onUp = () => { if (drag.current != null) { drag.current = null; setDragging(false); onTableChange!(table, false) } }
  const onDblClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!editable || (e.target as Element).closest('[data-nodrag]')) return
    const g = toGeo(e as unknown as PointerEvent)
    if (!g || !Number.isFinite(g[0])) return
    const base = templateRow(table)
    onTableChange!(appendRow(table, { ...base, [roleColumn(mapping, 'lat')!]: Math.round(g[1] * 1e4) / 1e4, [roleColumn(mapping, 'lon')!]: Math.round(g[0] * 1e4) / 1e4 }))
    setParams({ selected: table.rows.length })
  }
  const sorted = [...placed].sort((a, b) => radius(b.p.value) - radius(a.p.value))
  const legendVals = vmax > 0 ? [vmax / 4, vmax / 2, vmax] : []

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg map-svg" role="img" data-testid="chart-svg" tabIndex={editable ? 0 : undefined} aria-label={`비례 심벌 지도: ${pts.length}개 위치`}
        onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={onDblClick} onPointerLeave={() => { hide(); linked?.set(null) }}
        onKeyDown={(e) => { if (editable && params.selected >= 0 && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); onTableChange!(removeRows(table, [params.selected])); setParams({ selected: -1 }) } }}>
        <g transform={`translate(${zoom.t.x},${zoom.t.y}) scale(${k})`}>
          {params.showMap && <BaseMap map={resolved.map} projection={projection} />}
          {sorted.map(({ p, xy }) => {
            const r = radius(p.value) / k
            const on = params.selected === p.row || marked.has(p.row)
            return (
              <g key={p.row}>
                <circle data-testid="symbol" data-row={p.row} data-value={p.value ?? ''} data-r={(r * k).toFixed(3)} data-nodrag={editable ? '' : undefined} className={editable ? 'is-draggable' : ''} cx={xy[0]} cy={xy[1]} r={Math.max(r, p.value == null ? 0 : 0.8 / k)}
                  fill={colorOf(p)} fillOpacity={params.opacity} stroke={on ? '#121816' : '#ffffff'} strokeWidth={on ? 2 : 1} vectorEffect="non-scaling-stroke"
                  onPointerDown={editable ? (e) => { e.stopPropagation(); ;(svgRef.current as Element).setPointerCapture(e.pointerId); drag.current = p.row; setDragging(true); setParams({ selected: p.row }); hide() } : undefined}
                  onPointerEnter={compact ? undefined : (e) => {
                    if (drag.current != null) return
                    linked?.set([p.row])
                    const lp = localPoint(svgRef.current!, e)
                    show(lp.x, lp.y, <><b>{p.label || `행 ${p.row + 1}`}</b><br />{roleColumn(mapping, 'value')}: {fmt(p.value)}<br />{fmt(p.lat, 3)}°, {fmt(p.lon, 3)}°{editable ? <><br />드래그해 위치 이동</> : null}</>)
                  }} onPointerLeave={() => { hide(); linked?.set(null) }} />
                {params.labels && !compact && r * k > 12 && <text className="net-label" x={xy[0]} y={xy[1]} dy="0.35em" textAnchor="middle" fontSize={11 / k} pointerEvents="none">{p.label}</text>}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          {params.colorBy === 'group' && groups.length > 0 && <Legend items={groups.map((g) => ({ key: g, color: gcolor(g) }))} title={roleColumn(mapping, 'group') ?? ''} />}
          <svg className="size-legend-svg" width={96} height={90} aria-label="크기 범례" style={{ position: 'absolute', left: 8, bottom: 8 }}>
            {legendVals.map((v) => <g key={v}><circle cx={44} cy={86 - radius(v) * 0.9} r={radius(v) * 0.9} fill="none" stroke="#8a9692" /><text x={44} y={86 - 2 * radius(v) * 0.9 - 2} textAnchor="middle" className="bar-label">{fmt(v, 1)}</text></g>)}
          </svg>
          <Readout items={[{ label: '위치', value: placed.length }, { label: '합계', value: fmt(d3.sum(pts, (p) => p.value ?? 0)) }]} />
          <MapZoomButtons zoom={zoom} k={k} />
          {skipped > 0 && <p className="chart-warning" role="status">좌표가 없거나 범위를 벗어난 {skipped}행은 그리지 않았습니다.</p>}
          {editable && params.selected >= 0 && params.selected < table.rows.length && (
            <div className="chart-actions" style={{ bottom: 'auto', top: 44, right: 8 }}><span>행 {params.selected + 1} 선택</span><button type="button" onClick={() => { onTableChange!(removeRows(table, [params.selected])); setParams({ selected: -1 }) }} data-testid="symbol-delete"><Trash2 size={14} aria-hidden="true" />삭제</button></div>
          )}
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function SymbolControls({ params, setParams, table, mapping }: ControlsProps<SymbolParams>) {
  const { pts } = useMemo(() => readPoints(table, mapping, { lat: 'lat', lon: 'lon' }), [table, mapping])
  const resolved = useMemo(() => resolvePointMap(params, pts), [params, pts])
  return (
    <>
      <ControlGroup title="원 크기">
        <Segmented label="크기 기준" value={params.sizeMode} onChange={(sizeMode) => setParams({ sizeMode })} testId="ctl-size-mode" options={[{ value: 'area', label: '면적' }, { value: 'radius', label: '반지름' }]} />
        <Hint>{params.sizeMode === 'area' ? '원의 넓이가 값에 비례합니다. 값이 4배면 반지름은 2배입니다.' : '반지름이 값에 비례해 넓이는 값의 제곱에 비례합니다. 값이 4배면 넓이가 16배가 되어 큰 값이 실제보다 훨씬 커 보입니다.'}</Hint>
        <Slider label="최대 반지름" value={params.maxRadius} min={6} max={70} onChange={(maxRadius) => setParams({ maxRadius })} format={(v) => `${v}px`} testId="ctl-max-radius" />
        <Slider label="불투명도" value={params.opacity} min={0.2} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} />
      </ControlGroup>
      <ControlGroup title="색상">
        <Segmented label="색 기준" value={params.colorBy} onChange={(colorBy) => setParams({ colorBy })} testId="ctl-color-by" options={[{ value: 'single', label: '단색' }, { value: 'value', label: '값' }, { value: 'group', label: '그룹' }]} />
        <Select label="값 팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={(Object.keys(schemes) as ColorScheme[]).map((k) => ({ value: k, label: schemes[k].name }))} />
        <Toggle label="이름 표시 (큰 원)" checked={params.labels} onChange={(labels) => setParams({ labels })} />
        <Toggle label="배경 지도" checked={params.showMap} onChange={(showMap) => setParams({ showMap })} testId="ctl-show-map" />
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}>
        <GeoControls params={params} setParams={setParams} resolved={resolved} />
        <Hint>원을 끌어 위치를 옮기고, 빈 곳을 더블클릭하면 위치가 추가됩니다. 선택한 원은 Delete 키로 지웁니다. 지도를 움직일 때는 빈 곳을 끄세요.</Hint>
      </ControlGroup>
    </>
  )
}

export const symbolMapModule: VizModule<SymbolParams> = {
  roles: [
    { key: 'value', label: '값 (원의 크기)', type: 'number', required: true, prefer: '값|value|인구|population|합계' },
    latRole(),
    lonRole(),
    { key: 'label', label: '이름 (선택)', type: 'category', auto: true, prefer: '지역|국가|이름|name' },
    { key: 'group', label: '그룹 (색, 선택)', type: 'category' },
  ],
  datasets: ['kr-regions', 'world-regions', 'geo-points'],
  defaultParams: { ...geoDefaults, sizeMode: 'area', maxRadius: 34, opacity: 0.7, colorBy: 'single', scheme: 'ylorrd', labels: false, showMap: true, selected: -1 },
  Chart: SymbolChart,
  Controls: SymbolControls,
  hint: '원을 끌어 위치 이동 · 빈 곳을 더블클릭해 추가 · 크기 기준을 면적↔반지름으로 바꿔 큰 값이 어떻게 달라 보이는지 비교',
}
