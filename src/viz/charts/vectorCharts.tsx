import * as d3 from 'd3'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChartMessage, Readout } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, updateRow, type DataTable } from '../../data/table'
import { useReducedMotion } from '../../hooks/motion'
import { project } from '../../geo/projections'
import { schemes, type ColorScheme } from '../../lib/colors'
import { createRng } from '../../lib/random'
import { divergenceCurl, evenStreamlines, fieldAt, makeParticles, stepParticleBuffer, type BBox, type FieldSource, type LonLat, type VectorField } from '../../stats/spatial'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, RoleSpec, VizModule } from '../types'
import { boxFor, colorRamp, RampLegend, SurfaceStage, useSurfaceProjection, type StageContext } from './geoKit'
import { GeoControls, geoDefaults, resolvePointMap, type GeoParams, type Resolved } from './geoShared'

/** Charts of one synthetic flow field: arrows, evenly spaced streamlines and animated particles. The table lists the field's sources. */

export interface FieldParams extends GeoParams { windSpeed: number; windDir: number; scheme: ColorScheme }

const round4 = (v: number) => Math.round(v * 1e4) / 1e4
const seq = (Object.keys(schemes) as ColorScheme[]).filter((k) => !schemes[k].diverging).map((k) => ({ value: k, label: schemes[k].name }))

export const fieldRoles: RoleSpec[] = [
  { key: 'kind', label: '종류 (소용돌이·발원·흡수)', type: 'category', required: true, prefer: '종류|kind|type' },
  { key: 'lat', label: '위도', type: 'number', required: true, prefer: '위도|lat' },
  { key: 'lon', label: '경도', type: 'number', required: true, prefer: '경도|lon|lng' },
  { key: 'strength', label: '세기 (m/s)', type: 'number', required: true, prefer: '세기|strength' },
  { key: 'radius', label: '반경 (km)', type: 'number', required: true, prefer: '반경|radius' },
]

const kindOf = (s: string): FieldSource['kind'] | null => (/소용|회전|vortex|cyclone|태풍/i.test(s) ? 'vortex' : /발원|source|해풍|분출/i.test(s) ? 'source' : /흡수|sink|수렴/i.test(s) ? 'sink' : null)

export interface SourceRow extends FieldSource { row: number; label: string }

export function readSources(table: DataTable, mapping: Mapping) {
  const ki = columnIndex(table, roleColumn(mapping, 'kind')), li = columnIndex(table, roleColumn(mapping, 'lat')), oi = columnIndex(table, roleColumn(mapping, 'lon'))
  const si = columnIndex(table, roleColumn(mapping, 'strength')), ri = columnIndex(table, roleColumn(mapping, 'radius'))
  const out: SourceRow[] = []
  let skipped = 0
  if ([ki, li, oi, si, ri].some((i) => i < 0)) return { sources: out, skipped }
  table.rows.forEach((r, row) => {
    const kind = kindOf(toLabel(r[ki])), lat = toNumber(r[li]), lon = toNumber(r[oi]), strength = toNumber(r[si]), radius = toNumber(r[ri])
    if (!kind || lat == null || lon == null || strength == null || radius == null || !(radius > 0) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { skipped++; return }
    out.push({ kind, lat, lon, strength, radiusKm: radius, row, label: toLabel(r[ki]) })
  })
  return { sources: out, skipped }
}

export function useFieldModel(table: DataTable, mapping: Mapping, params: FieldParams) {
  const { sources, skipped } = useMemo(() => readSources(table, mapping), [table, mapping])
  const resolved: Resolved = useMemo(() => resolvePointMap(params, sources), [params, sources])
  const field: VectorField = useMemo(() => {
    const dir = (params.windDir * Math.PI) / 180
    return { sources, uniform: [params.windSpeed * Math.sin(dir), params.windSpeed * Math.cos(dir)] }
  }, [sources, params.windSpeed, params.windDir])
  const box: BBox = useMemo(() => (sources.length ? boxFor(resolved, sources, 0.5) : { west: 125, east: 130, south: 33, north: 38 }), [resolved, sources])
  const surface = useMemo(() => ({ box, resolved, points: sources.map((s) => ({ row: s.row, lat: s.lat, lon: s.lon, value: s.strength, radius: s.radiusKm, label: s.label })) }), [box, resolved, sources])
  return { sources, skipped, resolved, field, box, surface }
}

/** A 100 km scale bar measured at the map centre. */
function ScaleBar({ projection, x, y }: { projection: d3.GeoProjection; x: number; y: number }) {
  const c = projection.invert?.([x + 40, y - 40])
  if (!c) return null
  const a = projection(c), b = projection([c[0] + 100 / (111.195 * Math.cos((c[1] * Math.PI) / 180)), c[1]])
  if (!a || !b) return null
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  return (
    <g pointerEvents="none" aria-label="축척 100 km">
      <line x1={x} x2={x + len} y1={y} y2={y} stroke="#374151" strokeWidth={1.5} />
      <line x1={x} x2={x} y1={y - 4} y2={y + 4} stroke="#374151" strokeWidth={1.5} />
      <line x1={x + len} x2={x + len} y1={y - 4} y2={y + 4} stroke="#374151" strokeWidth={1.5} />
      <text x={x + len / 2} y={y - 6} textAnchor="middle" fontSize={10.5} fill="#4b5563">100 km</text>
    </g>
  )
}

const KIND_COLOR = { vortex: '#4c6fb5', source: '#d6573c', sink: '#2a7d74' }
const KIND_GLYPH = { vortex: '↺', source: '✦', sink: '◎' }

/** Draggable markers of the field's sources (moving one rewrites its row, so the field recomputes). */
function SourceMarkers({ sources, c, table, mapping, onTableChange, selected, setSelected }: { sources: SourceRow[]; c: StageContext; table: DataTable; mapping: Mapping; onTableChange?: (t: DataTable, transient?: boolean) => void; selected: number; setSelected: (row: number) => void }) {
  const drag = useRef<number | null>(null)
  const toGeo = (e: React.PointerEvent) => {
    const r = c.svg!.getBoundingClientRect()
    return c.projection.invert?.([(e.clientX - r.left - c.t.x) / c.t.k, (e.clientY - r.top - c.t.y) / c.t.k]) ?? null
  }
  return (
    <g>
      {sources.map((s) => {
        const xy = project(c.projection, s.lon, s.lat)
        if (!xy) return null
        const on = selected === s.row
        return (
          <g key={s.row} data-nodrag="" transform={`translate(${xy[0]},${xy[1]}) scale(${1 / c.k})`} style={{ cursor: onTableChange ? 'grab' : 'default' }} data-testid="field-source" data-kind={s.kind}
            onPointerDown={onTableChange ? (e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = s.row; setSelected(s.row) } : undefined}
            onPointerMove={onTableChange ? (e) => {
              if (drag.current !== s.row) return
              const g = toGeo(e)
              if (g && Number.isFinite(g[0])) onTableChange(updateRow(table, s.row, { [roleColumn(mapping, 'lat')!]: round4(g[1]), [roleColumn(mapping, 'lon')!]: round4(g[0]) }), true)
            } : undefined}
            onPointerUp={onTableChange ? () => { if (drag.current === s.row) { drag.current = null; onTableChange(table, false) } } : undefined}>
            <circle r={11} fill="#fff" fillOpacity={0.92} stroke={KIND_COLOR[s.kind]} strokeWidth={on ? 3 : 1.8} />
            <text textAnchor="middle" dy="0.35em" fontSize={13} fill={KIND_COLOR[s.kind]} pointerEvents="none">{s.kind === 'vortex' && s.strength < 0 ? '↻' : KIND_GLYPH[s.kind]}</text>
            <title>{`${s.label} · 세기 ${s.strength} m/s · 반경 ${s.radiusKm} km`}</title>
          </g>
        )
      })}
    </g>
  )
}

function FieldControls<P extends FieldParams>({ params, setParams, table, mapping, children }: ControlsProps<P> & { children?: ReactNode }) {
  const { sources, resolved } = useMemo(() => { const s = readSources(table, mapping).sources; return { sources: s, resolved: resolvePointMap(params, s) } }, [table, mapping, params])
  return (
    <>
      {children}
      <ControlGroup title="배경 바람">
        <Slider label="균일한 바람 속도 (m/s)" value={params.windSpeed} min={0} max={20} step={0.5} onChange={(windSpeed) => setParams({ windSpeed } as Partial<P>)} testId="ctl-wind-speed" />
        <Slider label="불어 가는 방향 (북=0°, 시계)" value={params.windDir} min={0} max={359} onChange={(windDir) => setParams({ windDir } as Partial<P>)} format={(v) => `${v}°`} testId="ctl-wind-dir" />
        <Hint>흐름장 = 균일한 바람 + 표의 소용돌이·발원·흡수 효과의 합입니다. 소용돌이는 접선 방향, 발원은 바깥, 흡수는 안쪽으로 흐르며 세기가 음수인 소용돌이는 시계 방향입니다. 지도의 기호를 끌어 위치를 옮기면 표가 갱신됩니다. 합성 데이터이며 실제 기상 자료가 아닙니다.</Hint>
        <Select label="색상 팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme } as Partial<P>)} options={seq} />
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams as never} resolved={resolved} />{sources.length === 0 && <Hint>흐름 원천이 없습니다.</Hint>}</ControlGroup>
    </>
  )
}

const baseField = { ...geoDefaults, windSpeed: 4, windDir: 90, scheme: 'teal' as ColorScheme }

// ─── vector field map ───────────────────────────────────────────────────────────────

export interface VectorFieldParams extends FieldParams { spacing: number; maxLen: number; lengthMode: 'speed' | 'unit'; background: 'none' | 'speed' | 'divergence' | 'curl'; selected: number }

function VectorFieldChart({ table, mapping, params, setParams, width, height, compact, onTableChange }: ChartProps<VectorFieldParams>) {
  const m = useFieldModel(table, mapping, params)
  const { field } = m
  const projection = useSurfaceProjection(m.surface, params, width, height)
  const spacing = compact ? params.spacing * 1.3 : params.spacing
  const speedMax = useMemo(() => {
    let mx = 1e-9
    for (let lat = m.box.south; lat <= m.box.north; lat += (m.box.north - m.box.south) / 24) for (let lon = m.box.west; lon <= m.box.east; lon += (m.box.east - m.box.west) / 24) mx = Math.max(mx, Math.hypot(...fieldAt(field, lon, lat)))
    return mx
  }, [field, m.box])
  const arrows = useMemo(() => {
    const out: { x: number; y: number; ang: number; speed: number }[] = []
    const inv = projection.invert
    if (!inv) return out
    for (let y = spacing / 2; y < height; y += spacing) for (let x = spacing / 2; x < width; x += spacing) {
      const ll = inv([x, y])
      if (!ll || ll[0] < m.box.west || ll[0] > m.box.east || ll[1] < m.box.south || ll[1] > m.box.north) continue
      const [u, v] = fieldAt(field, ll[0], ll[1])
      const sp = Math.hypot(u, v)
      if (sp < 1e-6) continue
      const eps = 0.02
      const q = projection([ll[0] + (u / sp) * eps / Math.cos((ll[1] * Math.PI) / 180), ll[1] + (v / sp) * eps])
      if (!q) continue
      out.push({ x, y, ang: Math.atan2(q[1] - y, q[0] - x), speed: sp })
    }
    return out
  }, [projection, field, m.box, spacing, width, height])
  const scheme = schemes[params.scheme]
  const bins = 6
  const grouped = useMemo(() => {
    const g: string[] = Array(bins).fill('')
    for (const a of arrows) {
      const len = params.lengthMode === 'speed' ? Math.max(3, (a.speed / speedMax) * params.maxLen) : params.maxLen * 0.6
      const hx = Math.cos(a.ang), hy = Math.sin(a.ang)
      const x0 = a.x - (hx * len) / 2, y0 = a.y - (hy * len) / 2, x1 = a.x + (hx * len) / 2, y1 = a.y + (hy * len) / 2
      const hs = Math.min(5, len * 0.4)
      const p = (ang: number) => `L${(x1 - Math.cos(a.ang + ang) * hs).toFixed(1)},${(y1 - Math.sin(a.ang + ang) * hs).toFixed(1)}M${x1.toFixed(1)},${y1.toFixed(1)}`
      const b = Math.min(bins - 1, Math.floor((a.speed / speedMax) * bins))
      g[b] += `M${x0.toFixed(1)},${y0.toFixed(1)}L${x1.toFixed(1)},${y1.toFixed(1)}M${x1.toFixed(1)},${y1.toFixed(1)}${p(0.45)}${p(-0.45)}`
    }
    return g
  }, [arrows, params.lengthMode, params.maxLen, speedMax])
  const speedRamp = useMemo(() => colorRamp(scheme.interpolate), [scheme])
  const divRamp = useMemo(() => colorRamp(schemes.rdbu.interpolate), [])
  const dcMax = useMemo(() => {
    if (params.background !== 'divergence' && params.background !== 'curl') return 1
    let mx = 1e-9
    for (const s of m.sources) { const dc = divergenceCurl(field, s.lon, s.lat); mx = Math.max(mx, Math.abs(params.background === 'divergence' ? dc.div : dc.curl)) }
    return mx
  }, [field, m.sources, params.background])
  const paint = useCallback((lon: number, lat: number) => {
    if (params.background === 'none') return 0
    if (lon < m.box.west || lon > m.box.east || lat < m.box.south || lat > m.box.north) return 0
    let c: number
    if (params.background === 'speed') c = speedRamp[Math.min(255, Math.round((Math.hypot(...fieldAt(field, lon, lat)) / speedMax) * 255))]
    else { const dc = divergenceCurl(field, lon, lat); c = divRamp[Math.max(0, Math.min(255, Math.round(128 + 127 * (params.background === 'divergence' ? dc.div : dc.curl) / dcMax)))] }
    return (c & 0x00ffffff) | (150 << 24)
  }, [params.background, field, m.box, speedRamp, divRamp, speedMax, dcMax])
  if (!m.sources.length) return <ChartMessage>종류·위도·경도·세기·반경 열을 확인하세요. 유효한 흐름 원천이 없습니다.</ChartMessage>
  const editable = !!onTableChange && !compact
  return (
    <SurfaceStage width={width} height={height} compact={compact} params={params} surface={m.surface} paint={paint} label={`벡터장 지도: 화살표 ${arrows.length}개`}
      info={(lon, lat) => { if (lon < m.box.west || lon > m.box.east || lat < m.box.south || lat > m.box.north) return null; const [u, v] = fieldAt(field, lon, lat); const sp = Math.hypot(u, v); return <>속력 <b>{sp.toFixed(1)} m/s</b><br />방향 {((((Math.atan2(u, v) * 180) / Math.PI) % 360) + 360) % 360 | 0}° (북=0°)</> }}
      overlay={(c) => (
        <g>
          <g data-testid="arrows" data-count={arrows.length} pointerEvents="none">
            {grouped.map((d, i) => <path key={i} d={d} fill="none" stroke={scheme.interpolate(0.25 + 0.7 * ((i + 0.5) / bins))} strokeWidth={1.3} strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}
          </g>
          <SourceMarkers sources={m.sources} c={c} table={table} mapping={mapping} onTableChange={editable ? onTableChange : undefined} selected={params.selected} setSelected={(selected) => setParams({ selected })} />
        </g>
      )}
      legend={!compact && <RampLegend interpolate={scheme.interpolate} min="0" max={speedMax.toFixed(1)} unit=" m/s" label="속력" />}
      extra={<Readout items={[{ label: '화살표', value: arrows.length }, { label: '원천', value: m.sources.length }, { label: '최대 속력', value: `${speedMax.toFixed(1)} m/s` }]} />} />
  )
}

function VectorFieldControls(props: ControlsProps<VectorFieldParams>) {
  const { params, setParams } = props
  return (
    <FieldControls {...props}>
      <ControlGroup title="화살표">
        <Slider label="간격 (화면 px)" value={params.spacing} min={14} max={60} onChange={(spacing) => setParams({ spacing })} format={(v) => `${v}px`} testId="ctl-arrow-spacing" />
        <Slider label="최대 길이" value={params.maxLen} min={8} max={60} onChange={(maxLen) => setParams({ maxLen })} format={(v) => `${v}px`} />
        <Segmented label="길이" value={params.lengthMode} onChange={(lengthMode) => setParams({ lengthMode })} testId="ctl-arrow-len" options={[{ value: 'speed', label: '속력에 비례' }, { value: 'unit', label: '모두 같게' }]} />
        <Select label="배경" value={params.background} onChange={(background) => setParams({ background })} testId="ctl-field-bg" options={[{ value: 'none', label: '없음' }, { value: 'speed', label: '속력' }, { value: 'divergence', label: '발산 (퍼짐·모임)' }, { value: 'curl', label: '회전 (소용돌이도)' }]} />
        {params.background === 'divergence' && <Hint>발산 ∇·v는 흐름이 퍼지는 곳(+, 붉은색)과 모이는 곳(−, 푸른색)입니다. 발원은 +, 흡수는 −이고, 순수한 소용돌이는 0입니다.</Hint>}
        {params.background === 'curl' && <Hint>회전 ∇×v는 흐름이 도는 정도입니다. 반시계 방향 회전이 +, 시계 방향이 −이며, 순수한 발원·흡수는 0입니다.</Hint>}
      </ControlGroup>
    </FieldControls>
  )
}

export const vectorFieldModule: VizModule<VectorFieldParams> = {
  roles: fieldRoles,
  datasets: ['wind-sources'],
  defaultParams: { ...baseField, spacing: 30, maxLen: 26, lengthMode: 'speed', background: 'speed', selected: -1 },
  Chart: VectorFieldChart,
  Controls: VectorFieldControls,
  hint: '소용돌이·발원·흡수 기호를 끌어 흐름장을 바꿔 보세요 · 배경을 발산·회전으로 바꾸면 흐름이 퍼지는 곳과 도는 곳이 보입니다',
}

// ─── streamlines ────────────────────────────────────────────────────────────────────

export interface StreamParams extends FieldParams { sepKm: number; stepKm: number; maxSteps: number; width: number; colorBySpeed: boolean; arrows: boolean; seeds: LonLat[] }

function StreamChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<StreamParams>) {
  const m = useFieldModel(table, mapping, params)
  const projection = useSurfaceProjection(m.surface, params, width, height)
  const sep = compact ? params.sepKm * 1.6 : params.sepKm
  const lines = useMemo(() => evenStreamlines(m.field, m.box, sep, params.stepKm, params.maxSteps, params.seeds), [m.field, m.box, sep, params.stepKm, params.maxSteps, params.seeds])
  const speedMax = useMemo(() => d3.max(lines.flat(), (p) => Math.hypot(...fieldAt(m.field, p[0], p[1]))) ?? 1, [lines, m.field])
  const drawn = useMemo(() => lines.map((l, i) => {
    const pts = l.map((p) => project(projection, p[0], p[1])).filter((q): q is [number, number] => !!q)
    const speed = d3.mean(l.filter((_, k) => k % 4 === 0), (p) => Math.hypot(...fieldAt(m.field, p[0], p[1]))) ?? 0
    return { i, d: d3.line()(pts) ?? '', pts, speed, seeded: params.seeds.some((s) => l.some((p) => Math.abs(p[0] - s[0]) < 1e-9 && Math.abs(p[1] - s[1]) < 1e-9)) }
  }), [lines, projection, m.field, params.seeds])
  const scheme = schemes[params.scheme]
  const down = useRef<{ x: number; y: number } | null>(null)
  if (!m.sources.length) return <ChartMessage>종류·위도·경도·세기·반경 열을 확인하세요. 유효한 흐름 원천이 없습니다.</ChartMessage>
  const arrowAt = (pts: [number, number][]) => {
    if (pts.length < 6) return null
    const a = pts[Math.floor(pts.length * 0.5)], b = pts[Math.floor(pts.length * 0.5) + 1]
    if (!a || !b) return null
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
    return `M${a[0]},${a[1]}l${(-7 * Math.cos(ang - 0.45)).toFixed(1)},${(-7 * Math.sin(ang - 0.45)).toFixed(1)}M${a[0]},${a[1]}l${(-7 * Math.cos(ang + 0.45)).toFixed(1)},${(-7 * Math.sin(ang + 0.45)).toFixed(1)}`
  }
  return (
    <SurfaceStage width={width} height={height} compact={compact} params={params} surface={m.surface} paint={() => 0} label={`스트림라인 지도: 유선 ${lines.length}개`}
      onSvgPointerDown={(e) => { down.current = { x: e.clientX, y: e.clientY } }}
      info={(lon, lat) => { const [u, v] = fieldAt(m.field, lon, lat); return <>속력 <b>{Math.hypot(u, v).toFixed(1)} m/s</b><br />클릭하면 이 위치에서 유선을 추가</> }}
      overlay={(c) => (
        <g>
          <rect x={-5000} y={-5000} width={10000} height={10000} fill="transparent" data-testid="stream-hit"
            onPointerUp={(e) => {
              const d = down.current
              down.current = null
              if (compact || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || !c.svg) return
              const r = c.svg.getBoundingClientRect()
              const g = projection.invert?.([(e.clientX - r.left - c.t.x) / c.t.k, (e.clientY - r.top - c.t.y) / c.t.k])
              if (g && g[0] >= m.box.west && g[0] <= m.box.east && g[1] >= m.box.south && g[1] <= m.box.north) setParams({ seeds: [...params.seeds, [round4(g[0]), round4(g[1])] as LonLat].slice(-24) })
            }} />
          {drawn.map((l) => (
            <g key={l.i} pointerEvents="none">
              <path data-testid="streamline" d={l.d} fill="none" stroke={params.colorBySpeed ? scheme.interpolate(0.2 + 0.78 * Math.min(1, l.speed / speedMax)) : '#3b6f8f'} strokeWidth={(l.seeded ? 2 : 1) * params.width} strokeOpacity={l.seeded ? 1 : 0.85} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              {params.arrows && !compact && <path d={arrowAt(l.pts) ?? ''} fill="none" stroke={params.colorBySpeed ? scheme.interpolate(0.2 + 0.78 * Math.min(1, l.speed / speedMax)) : '#3b6f8f'} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
            </g>
          ))}
          {!compact && params.seeds.map((s, i) => { const xy = project(projection, s[0], s[1]); return xy ? <circle key={i} cx={xy[0]} cy={xy[1]} r={3.5 / c.k} fill="#e07a3f" stroke="#fff" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" /> : null })}
          <SourceMarkers sources={m.sources} c={c} table={table} mapping={mapping} selected={-1} setSelected={() => {}} />
        </g>
      )}
      legend={!compact && params.colorBySpeed && <RampLegend interpolate={scheme.interpolate} min="0" max={speedMax.toFixed(1)} unit=" m/s" label="속력" />}
      extra={<Readout items={[{ label: '유선', value: lines.length }, { label: '시드', value: params.seeds.length }, { label: '간격', value: `${params.sepKm} km` }]} />} />
  )
}

function StreamControls(props: ControlsProps<StreamParams>) {
  const { params, setParams } = props
  return (
    <FieldControls {...props}>
      <ControlGroup title="유선">
        <Slider label="유선 간격 (km)" value={params.sepKm} min={12} max={120} onChange={(sepKm) => setParams({ sepKm })} format={(v) => `${v} km`} testId="ctl-stream-sep" />
        <Slider label="적분 간격 (km)" value={params.stepKm} min={1} max={20} onChange={(stepKm) => setParams({ stepKm })} format={(v) => `${v} km`} testId="ctl-stream-step" />
        <Slider label="최대 단계 수" value={params.maxSteps} min={40} max={400} step={10} onChange={(maxSteps) => setParams({ maxSteps })} />
        <Slider label="선 굵기" value={params.width} min={0.6} max={3} step={0.2} onChange={(width) => setParams({ width })} />
        <Toggle label="속력으로 색칠" checked={params.colorBySpeed} onChange={(colorBySpeed) => setParams({ colorBySpeed })} />
        <Toggle label="방향 화살표" checked={params.arrows} onChange={(arrows) => setParams({ arrows })} />
        <Hint>유선은 흐름의 접선 방향을 따라 4차 룽게–쿠타(RK4)로 적분한 궤적이고, 서로 간격 이상 떨어지도록 골라 지도를 고르게 채웁니다. 지도를 클릭하면 그 점에서 시작하는 유선이 추가됩니다(주황). 안정 상태(시간에 따라 변하지 않는) 흐름에서 유선은 입자의 실제 경로와 같습니다.</Hint>
        {params.seeds.length > 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ seeds: [] })} data-testid="stream-clear">시드 {params.seeds.length}개 지우기</button>}
      </ControlGroup>
    </FieldControls>
  )
}

export const streamlineModule: VizModule<StreamParams> = {
  roles: fieldRoles,
  datasets: ['wind-sources'],
  defaultParams: { ...baseField, sepKm: 44, stepKm: 6, maxSteps: 220, width: 1.2, colorBySpeed: true, arrows: true, seeds: [] },
  Chart: StreamChart,
  Controls: StreamControls,
  hint: '지도를 클릭해 그 점에서 시작하는 유선을 추가 · 유선 간격과 적분 간격 조절 · 소용돌이 기호를 끌어 흐름 변경',
}

// ─── animated particle flow ─────────────────────────────────────────────────────────

export interface ParticleParams extends FieldParams { count: number; speedUp: number; maxAge: number; fade: number; lineWidth: number; paused: boolean }

function ParticleChart({ table, mapping, params, width, height, compact }: ChartProps<ParticleParams>) {
  const m = useFieldModel(table, mapping, params)
  const projection = useSurfaceProjection(m.surface, params, width, height)
  const cvRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const [visible, setVisible] = useState(true)
  const [tabVisible, setTabVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  const [frames, setFrames] = useState(0)
  const count = compact ? Math.min(900, params.count) : params.count
  const scheme = schemes[params.scheme]
  const outline = useMemo(() => d3.geoPath(projection)(m.resolved.map.collection) ?? '', [projection, m.resolved.map])
  const running = visible && tabVisible && !reduced && !params.paused && !compact

  useEffect(() => {
    const onVis = () => setTabVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVis)
    const el = wrapRef.current
    let io: IntersectionObserver | undefined
    if (el && typeof IntersectionObserver !== 'undefined') { io = new IntersectionObserver((es) => setVisible(es[es.length - 1]?.isIntersecting ?? true)); io.observe(el) }
    return () => { document.removeEventListener('visibilitychange', onVis); io?.disconnect() }
  }, [])

  // One effect owns the buffer, the canvas and the single animation timer; it is torn down and rebuilt whenever the field or the view changes.
  useEffect(() => {
    const cv = cvRef.current
    if (!cv || width < 2 || height < 2 || !m.sources.length) return
    cv.width = width
    cv.height = height
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const rng = createRng(11)
    const buf = makeParticles(count, m.box, rng, params.maxAge)
    const px = new Float32Array(count), py = new Float32Array(count)
    const speedMax = Math.max(1e-6, ...m.sources.map((s) => Math.abs(s.strength)), Math.hypot(m.field.uniform[0], m.field.uniform[1]))
    const colors = Array.from({ length: 6 }, (_, i) => scheme.interpolate(0.25 + 0.7 * ((i + 0.5) / 6)))
    const place = () => { for (let i = 0; i < count; i++) { const q = projection([buf.lon[i], buf.lat[i]]); px[i] = q ? q[0] : -1e4; py[i] = q ? q[1] : -1e4 } }
    place()
    const frame = () => {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = `rgba(0,0,0,${params.fade})`
      ctx.fillRect(0, 0, width, height)
      ctx.globalCompositeOperation = 'source-over'
      ctx.lineWidth = params.lineWidth
      ctx.lineCap = 'round'
      const ox = new Float32Array(px), oy = new Float32Array(py)
      const wasAge = new Uint16Array(buf.age)
      stepParticleBuffer(buf, m.field, m.box, 1, params.speedUp, params.maxAge, rng)
      place()
      const byBin: number[][] = [[], [], [], [], [], []]
      for (let i = 0; i < count; i++) if (buf.age[i] > wasAge[i] && ox[i] > -1e3 && px[i] > -1e3) byBin[Math.min(5, Math.floor((buf.speed[i] / speedMax) * 6))].push(i)
      byBin.forEach((ids, b) => {
        if (!ids.length) return
        ctx.strokeStyle = colors[b]
        ctx.beginPath()
        for (const i of ids) { ctx.moveTo(ox[i], oy[i]); ctx.lineTo(px[i], py[i]) }
        ctx.stroke()
      })
    }
    let raf = 0
    let n = 0
    ctx.clearRect(0, 0, width, height)
    if (!running) {
      // static picture (thumbnail, reduced motion or paused): run a burst of steps so the trails already show the flow
      for (let i = 0; i < (compact ? 40 : 90); i++) frame()
      setFrames((f) => f + 1)
      return
    }
    const loop = () => { frame(); n++; if (n % 30 === 0) setFrames((f) => f + 30); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [projection, m.field, m.box, m.sources, count, params.speedUp, params.maxAge, params.fade, params.lineWidth, scheme, width, height, running, compact])

  if (!m.sources.length) return <ChartMessage>종류·위도·경도·세기·반경 열을 확인하세요. 유효한 흐름 원천이 없습니다.</ChartMessage>
  return (
    <div className="chart-root" ref={wrapRef}>
      <svg width={width} height={height} className="chart-svg map-svg" role="img" data-testid="chart-svg" aria-label={`바람 입자 흐름 지도: 입자 ${count}개`} style={{ cursor: 'default' }}>
        <rect className="map-frame" x={0.5} y={0.5} width={Math.max(0, width - 1)} height={Math.max(0, height - 1)} fill="#fbfcfc" stroke="#e1e6e4" />
        <path className="map-outline" d={outline} fill="#f1f4f3" stroke="#b8c2bf" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
        {m.sources.map((s) => { const xy = project(projection, s.lon, s.lat); return xy ? <circle key={s.row} cx={xy[0]} cy={xy[1]} r={compact ? 2 : 4} fill="none" stroke={KIND_COLOR[s.kind]} strokeWidth={1.4} opacity={0.8} /> : null })}
        {!compact && <ScaleBar projection={projection} x={14} y={height - 16} />}
      </svg>
      <canvas ref={cvRef} className="flow-canvas" data-testid="flow-canvas" data-running={running ? '1' : '0'} data-count={count} data-frames={frames} aria-hidden="true" style={{ width, height }} />
      {!compact && <Readout items={[{ label: '입자', value: count.toLocaleString() }, { label: '상태', value: reduced ? '정지 (모션 줄이기)' : running ? '재생 중' : params.paused ? '일시정지' : '화면 밖 정지' }]} />}
    </div>
  )
}

function ParticleControls(props: ControlsProps<ParticleParams>) {
  const { params, setParams } = props
  return (
    <FieldControls {...props}>
      <ControlGroup title="입자">
        <Toggle label="일시정지" checked={params.paused} onChange={(paused) => setParams({ paused })} testId="ctl-pause" />
        <Slider label="입자 수" value={params.count} min={200} max={8000} step={100} onChange={(count) => setParams({ count })} format={(v) => v.toLocaleString()} testId="ctl-particles" />
        <Slider label="속도 배율" value={params.speedUp} min={40} max={900} step={10} onChange={(speedUp) => setParams({ speedUp })} format={(v) => `${v}×`} testId="ctl-particle-speed" />
        <Slider label="수명 (프레임)" value={params.maxAge} min={20} max={400} step={10} onChange={(maxAge) => setParams({ maxAge })} />
        <Slider label="꼬리 지속 (작을수록 길게)" value={params.fade} min={0.02} max={0.3} step={0.01} onChange={(fade) => setParams({ fade })} />
        <Slider label="선 굵기" value={params.lineWidth} min={0.6} max={3} step={0.2} onChange={(lineWidth) => setParams({ lineWidth })} />
        <Hint>입자는 매 프레임 흐름장의 속도 × 시간만큼 움직이고, 수명이 다하거나 지도를 벗어나면 무작위 위치에서 다시 태어납니다. 화면 밖이거나 탭이 숨겨지면 멈추고, 시스템의 ‘동작 줄이기’ 설정에서는 움직이지 않는 그림만 보여 줍니다. 소용돌이 위치는 데이터 탭의 표에서 바꿉니다.</Hint>
      </ControlGroup>
    </FieldControls>
  )
}

export const particleFlowModule: VizModule<ParticleParams> = {
  roles: fieldRoles,
  datasets: ['wind-sources'],
  defaultParams: { ...baseField, count: 3000, speedUp: 260, maxAge: 120, fade: 0.07, lineWidth: 1.2, paused: false },
  Chart: ParticleChart,
  Controls: ParticleControls,
  hint: '입자 수·속도·수명을 바꿔 흐름의 모양을 관찰 · 데이터 탭에서 소용돌이·발원·흡수를 고치면 흐름이 바뀝니다 · 일시정지 가능',
}
