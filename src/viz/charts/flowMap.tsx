import * as d3 from 'd3'
import { Trash2 } from 'lucide-react'
import { useMemo, useRef, type PointerEvent } from 'react'
import { ChartMessage, Legend, Readout, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { columnIndex, removeRows, toLabel, toNumber, updateRow } from '../../data/table'
import { fmt } from '../../lib/format'
import { project } from '../../geo/projections'
import { MapZoomButtons, useMapZoom } from '../../geo/useMapZoom'
import { arcControl, crossesDateline, flowTotals } from '../../stats/geo'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { BaseMap, GeoControls, geoDefaults, resolvePointMap, useProjection, type GeoParams } from './geoShared'

export interface FlowParams extends GeoParams {
  maxWidth: number
  /** Bulge of each arc as a fraction of its length. */
  curve: number
  direction: 'arrow' | 'none'
  opacity: number
  /** Hide flows smaller than this share of the largest flow (0–0.5). */
  minShare: number
  places: boolean
  /** Selected place name ('' = none) — its outflows are orange and inflows blue. */
  selected: string
  /** Selected flow row, or −1. */
  selectedRow: number
}

const OUT = '#e07a3f'
const IN = '#2f6fb3'

interface FlowRow { row: number; from: string; to: string; value: number; a: [number, number]; b: [number, number] }

/** Reads flows. A row needs an origin and destination coordinate and a positive value; the others are counted as skipped. */
function readFlows(table: ChartProps<FlowParams>['table'], mapping: ChartProps<FlowParams>['mapping']) {
  const ix = (k: string) => columnIndex(table, roleColumn(mapping, k))
  const [fi, ti, vi, la0, lo0, la1, lo1] = ['from', 'to', 'value', 'lat0', 'lon0', 'lat1', 'lon1'].map(ix)
  const flows: FlowRow[] = []
  let skipped = 0
  if ([fi, ti, vi, la0, lo0, la1, lo1].every((i) => i >= 0)) {
    table.rows.forEach((r, row) => {
      const v = toNumber(r[vi])
      const c = [la0, lo0, la1, lo1].map((i) => toNumber(r[i]))
      const bad = v == null || !(v > 0) || c.some((x) => x == null) || Math.abs(c[0]!) > 90 || Math.abs(c[2]!) > 90 || Math.abs(c[1]!) > 180 || Math.abs(c[3]!) > 180
      if (bad) { skipped++; return }
      flows.push({ row, from: toLabel(r[fi]), to: toLabel(r[ti]), value: v!, a: [c[1]!, c[0]!], b: [c[3]!, c[2]!] })
    })
  }
  return { flows, skipped }
}

function FlowChart({ table, mapping, params, setParams, width, height, compact, onTableChange, linked }: ChartProps<FlowParams>) {
  const { flows, skipped } = useMemo(() => readFlows(table, mapping), [table, mapping])
  const endpoints = useMemo(() => flows.flatMap((f) => [{ lon: f.a[0], lat: f.a[1] }, { lon: f.b[0], lat: f.b[1] }]), [flows])
  const resolved = useMemo(() => resolvePointMap(params, endpoints), [params, endpoints])
  const projection = useProjection(resolved.map, params, width, height, resolved.id)
  const svgRef = useRef<SVGSVGElement>(null)
  const zoom = useMapZoom(svgRef, { enabled: !compact, width, height })
  const { tip, show, hide } = useTooltip()
  const drag = useRef<string | null>(null)
  // Pointer capture on the svg turns a click on a place into a pointerup on the svg, so a press that did not move is treated as the click.
  const down = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const clip = useMemo(() => d3.geoPath(projection)({ type: 'Sphere' }) ?? '', [projection])
  const k = zoom.t.k
  const vmax = d3.max(flows, (f) => f.value) ?? 1
  const shown = flows.filter((f) => f.value >= vmax * params.minShare)
  const totals = useMemo(() => flowTotals(flows), [flows])
  const editable = !!onTableChange && !compact
  const marked = new Set(linked?.rows ?? [])

  // Places keyed by name; the first coordinate given for a name wins.
  const places = useMemo(() => {
    const m = new Map<string, [number, number]>()
    for (const f of flows) { if (!m.has(f.from)) m.set(f.from, f.a); if (!m.has(f.to)) m.set(f.to, f.b) }
    return m
  }, [flows])

  /**
   * Screen paths for a flow. A flow whose short way round crosses the antimeridian would otherwise be drawn the long way across the whole
   * map, so it is drawn as two pieces: one running off the map edge from the origin and one entering from the opposite edge to the destination.
   */
  const geometry = useMemo(() => {
    const slope = (lat: number) => { const p0 = project(projection, 0, lat); const p1 = project(projection, 1, lat); return p0 && p1 ? p1[0] - p0[0] : 0 }
    return shown.map((f) => {
      const A = project(projection, f.a[0], f.a[1])
      const B = project(projection, f.b[0], f.b[1])
      if (!A || !B) return { f, segs: [] as { a: [number, number]; b: [number, number]; arrow: boolean }[], wrap: false }
      if (!crossesDateline(f.a[0], f.b[0])) return { f, segs: [{ a: A, b: B, arrow: true }], wrap: false }
      const dir = f.b[0] < f.a[0] ? 1 : -1
      const B2: [number, number] = [B[0] + dir * 360 * slope(f.b[1]), B[1]]
      const A2: [number, number] = [A[0] - dir * 360 * slope(f.a[1]), A[1]]
      return { f, segs: [{ a: A, b: B2, arrow: false }, { a: A2, b: B, arrow: true }], wrap: true }
    })
  }, [shown, projection])

  if (!['from', 'to', 'value', 'lat0', 'lon0', 'lat1', 'lon1'].every((r) => roleColumn(mapping, r))) return <ChartMessage>출발·도착 이름, 값, 출발/도착의 위도·경도 열을 모두 선택하세요.</ChartMessage>
  if (!flows.length) return <ChartMessage>그릴 수 있는 흐름이 없습니다.<small>값이 0보다 크고 좌표가 올바른 행이 필요합니다.</small></ChartMessage>

  const width_ = (v: number) => Math.max(0.6, (compact ? params.maxWidth * 0.5 : params.maxWidth) * (v / vmax))
  const sel = params.selected
  const colorFor = (f: FlowRow) => (sel ? (f.from === sel ? OUT : f.to === sel ? IN : '#9aa6a2') : '#2a7d74')
  const dim = (f: FlowRow) => (sel && f.from !== sel && f.to !== sel ? 0.12 : params.opacity)

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return
    const p = localPoint(svgRef.current!, e)
    if (down.current && Math.hypot(p.x - down.current.x, p.y - down.current.y) > 3) down.current.moved = true
    if (!down.current?.moved) return
    const g = projection.invert?.([(p.x - zoom.t.x) / k, (p.y - zoom.t.y) / k])
    if (!g || !Number.isFinite(g[0]) || !Number.isFinite(g[1])) return
    const name = drag.current
    const cols = ['lat0', 'lon0', 'lat1', 'lon1'].map((r) => roleColumn(mapping, r)!)
    let next = table
    for (const f of flows) {
      const patch: Record<string, number> = {}
      if (f.from === name) { patch[cols[0]] = Math.round(g[1] * 1e4) / 1e4; patch[cols[1]] = Math.round(g[0] * 1e4) / 1e4 }
      if (f.to === name) { patch[cols[2]] = Math.round(g[1] * 1e4) / 1e4; patch[cols[3]] = Math.round(g[0] * 1e4) / 1e4 }
      if (Object.keys(patch).length) next = updateRow(next, f.row, patch)
    }
    onTableChange!(next, true)
  }
  const onUp = () => {
    const name = drag.current
    if (!name) return
    drag.current = null
    if (down.current && !down.current.moved) setParams({ selected: sel === name ? '' : name })
    else onTableChange!(table, false)
    down.current = null
  }
  const arrowPath = (c: [number, number], b: [number, number], w: number) => {
    const L = (4 + w * 1.6) / k
    const ang = Math.atan2(b[1] - c[1], b[0] - c[0])
    const p = (da: number, r: number): string => `${(b[0] - Math.cos(ang + da) * r).toFixed(2)},${(b[1] - Math.sin(ang + da) * r).toFixed(2)}`
    return `M${b[0].toFixed(2)},${b[1].toFixed(2)}L${p(0.45, L)}L${p(-0.45, L)}Z`
  }
  const names = [...places.keys()]
  const topPlace = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1])[0]

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg map-svg" role="img" data-testid="chart-svg" aria-label={`흐름 지도: 흐름 ${shown.length}개, 장소 ${names.length}곳`}
        onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <defs><clipPath id="flow-clip"><path d={clip} /></clipPath></defs>
        <g transform={`translate(${zoom.t.x},${zoom.t.y}) scale(${k})`}>
          <BaseMap map={resolved.map} projection={projection} />
          <g clipPath={resolved.id === 'world' ? 'url(#flow-clip)' : undefined}>
            {[...geometry].sort((x, y) => x.f.value - y.f.value).map(({ f, segs, wrap }) => {
              const w = width_(f.value)
              const on = params.selectedRow === f.row || marked.has(f.row)
              const col = colorFor(f)
              return (
                <g key={f.row} data-testid="flow" data-row={f.row} data-from={f.from} data-to={f.to} data-wrap={wrap ? '1' : undefined} opacity={dim(f)}>
                  {segs.map((s, i) => {
                    const c = arcControl(s.a, s.b, params.curve)
                    const d = `M${s.a[0].toFixed(2)},${s.a[1].toFixed(2)}Q${c[0].toFixed(2)},${c[1].toFixed(2)} ${s.b[0].toFixed(2)},${s.b[1].toFixed(2)}`
                    return (
                      <g key={i}>
                        <path d={d} fill="none" stroke={col} strokeWidth={on ? w + 1.5 : w} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                        {params.direction === 'arrow' && s.arrow && <path d={arrowPath(c, s.b, w)} fill={col} />}
                        <path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(w, 10)} vectorEffect="non-scaling-stroke" style={{ cursor: 'pointer' }}
                          onPointerEnter={compact ? undefined : (e) => { linked?.set([f.row]); const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{f.from} → {f.to}</b><br />{roleColumn(mapping, 'value')}: {fmt(f.value)}{wrap ? <><br />날짜변경선을 건너는 흐름</> : null}</>) }}
                          onPointerLeave={() => { hide(); linked?.set(null) }}
                          onClick={compact ? undefined : () => setParams({ selectedRow: params.selectedRow === f.row ? -1 : f.row })} />
                      </g>
                    )
                  })}
                </g>
              )
            })}
          </g>
          {params.places && names.map((n) => {
            const xy = project(projection, places.get(n)![0], places.get(n)![1])
            if (!xy) return null
            const tot = (totals.out.get(n) ?? 0) + (totals.in.get(n) ?? 0)
            const r = (compact ? 2 : 3 + 5 * Math.sqrt(tot / (2 * vmax * Math.max(1, flows.length) ** 0.5))) / k
            return (
              <g key={n}>
                <circle data-testid="flow-place" data-name={n} data-nodrag={editable ? '' : undefined} className={editable ? 'is-draggable' : ''} cx={xy[0]} cy={xy[1]} r={Math.min(r, 14 / k)} fill={sel === n ? '#121816' : '#ffffff'} stroke="#121816" strokeWidth={1.4} vectorEffect="non-scaling-stroke"
                  onPointerDown={editable ? (e) => { e.stopPropagation(); ;(svgRef.current as Element).setPointerCapture(e.pointerId); drag.current = n; const lp = localPoint(svgRef.current!, e); down.current = { x: lp.x, y: lp.y, moved: false }; hide() } : undefined}
                  onClick={compact ? undefined : () => setParams({ selected: sel === n ? '' : n })}
                  onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{n}</b><br />나가는 양 {fmt(totals.out.get(n) ?? 0)}<br />들어오는 양 {fmt(totals.in.get(n) ?? 0)}<br />순유입 {fmt((totals.in.get(n) ?? 0) - (totals.out.get(n) ?? 0))}</>) }}
                  onPointerLeave={hide} />
                {!compact && (sel === n || names.length <= 16) && <text className="net-label" x={xy[0] + 6 / k} y={xy[1] - 6 / k} fontSize={11 / k} pointerEvents="none">{n}</text>}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          {sel && <Legend items={[{ key: `${sel}에서 나감`, color: OUT }, { key: `${sel}(으)로 들어옴`, color: IN }]} />}
          <Readout items={[{ label: '흐름', value: `${shown.length}${shown.length < flows.length ? ` / ${flows.length}` : ''}` }, { label: '장소', value: names.length }, ...(topPlace(totals.out) ? [{ label: '최대 유출', value: `${topPlace(totals.out)![0]} ${fmt(topPlace(totals.out)![1])}` }] : []), ...(topPlace(totals.in) ? [{ label: '최대 유입', value: `${topPlace(totals.in)![0]} ${fmt(topPlace(totals.in)![1])}` }] : [])]} />
          <MapZoomButtons zoom={zoom} k={k} />
          {skipped > 0 && <p className="chart-warning" role="status">값이 0 이하이거나 좌표가 올바르지 않은 {skipped}행은 그리지 않았습니다.</p>}
          {editable && params.selectedRow >= 0 && params.selectedRow < table.rows.length && (
            <div className="chart-actions" style={{ bottom: 'auto', top: 44, right: 8 }}><span>흐름 행 {params.selectedRow + 1} 선택</span><button type="button" onClick={() => { onTableChange!(removeRows(table, [params.selectedRow])); setParams({ selectedRow: -1 }) }} data-testid="flow-delete"><Trash2 size={14} aria-hidden="true" />삭제</button></div>
          )}
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function FlowControls({ params, setParams, table, mapping }: ControlsProps<FlowParams>) {
  const { flows } = useMemo(() => readFlows(table, mapping), [table, mapping])
  const resolved = useMemo(() => resolvePointMap(params, flows.flatMap((f) => [{ lon: f.a[0], lat: f.a[1] }, { lon: f.b[0], lat: f.b[1] }])), [params, flows])
  return (
    <>
      <ControlGroup title="선">
        <Slider label="최대 굵기" value={params.maxWidth} min={2} max={30} onChange={(maxWidth) => setParams({ maxWidth })} format={(v) => `${v}px`} testId="ctl-flow-width" />
        <Slider label="곡률" value={params.curve} min={0} max={0.5} step={0.02} onChange={(curve) => setParams({ curve })} format={(v) => v.toFixed(2)} testId="ctl-flow-curve" />
        <Hint>곡선은 진행 방향의 왼쪽으로 휘어, 같은 두 곳 사이의 왕복 흐름이 서로 겹치지 않습니다. 굵기는 값에 비례합니다.</Hint>
        <Segmented label="방향 표시" value={params.direction} onChange={(direction) => setParams({ direction })} testId="ctl-flow-dir" options={[{ value: 'arrow', label: '화살표' }, { value: 'none', label: '없음' }]} />
        <Slider label="불투명도" value={params.opacity} min={0.2} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} />
        <Slider label="작은 흐름 숨기기 (최댓값 대비)" value={params.minShare} min={0} max={0.5} step={0.01} onChange={(minShare) => setParams({ minShare })} format={(v) => `${Math.round(v * 100)}% 미만`} testId="ctl-flow-min" />
        <Toggle label="장소 표시" checked={params.places} onChange={(places) => setParams({ places })} />
      </ControlGroup>
      <ControlGroup title="선택">
        <Hint>장소를 클릭하면 그곳에서 나가는 흐름은 주황, 들어오는 흐름은 파랑으로 강조되고 나머지는 흐려집니다. 장소 점을 끌면 그 장소가 쓰인 모든 행의 좌표가 바뀝니다.</Hint>
        {params.selected && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ selected: '' })}>선택 해제 ({params.selected})</button>}
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams} resolved={resolved} /></ControlGroup>
    </>
  )
}

export const flowMapModule: VizModule<FlowParams> = {
  roles: [
    { key: 'from', label: '출발 이름', type: 'category', required: true, prefer: '출발|from|origin' },
    { key: 'to', label: '도착 이름', type: 'category', required: true, prefer: '도착|to|dest' },
    { key: 'value', label: '값 (선의 굵기)', type: 'number', required: true, prefer: '이동량|값|value' },
    { key: 'lat0', label: '출발 위도', type: 'number', required: true, prefer: '출발위도|lat0|from.*lat' },
    { key: 'lon0', label: '출발 경도', type: 'number', required: true, prefer: '출발경도|lon0|from.*lon' },
    { key: 'lat1', label: '도착 위도', type: 'number', required: true, prefer: '도착위도|lat1|to.*lat' },
    { key: 'lon1', label: '도착 경도', type: 'number', required: true, prefer: '도착경도|lon1|to.*lon' },
  ],
  datasets: ['kr-flows', 'world-flows'],
  defaultParams: { ...geoDefaults, maxWidth: 12, curve: 0.18, direction: 'arrow', opacity: 0.7, minShare: 0, places: true, selected: '', selectedRow: -1 },
  Chart: FlowChart,
  Controls: FlowControls,
  hint: '장소를 클릭해 유입(파랑)·유출(주황) 강조 · 점을 끌어 위치 이동 · 곡률과 굵기 조절 · 날짜변경선을 건너는 흐름은 두 조각으로 그려집니다',
}
