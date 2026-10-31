import * as d3 from 'd3'
import { Shuffle } from 'lucide-react'
import { useMemo, useRef } from 'react'
import { ChartMessage, Readout, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, NumberField, Slider, Toggle } from '../../components/controls'
import { MapZoomButtons, useMapZoom } from '../../geo/useMapZoom'
import { randomPointsIn } from '../../geo/geojson'
import { createRng } from '../../lib/random'
import { fmt } from '../../lib/format'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { GeoControls, geoDefaults, regionData, regionRoles, resolveMap, useProjection, type GeoParams } from './geoShared'

export interface DotParams extends GeoParams {
  /** Quantity one dot stands for; 0 = chosen so the map has about 1,500 dots. */
  perDot: number
  dotSize: number
  seed: number
  borders: boolean
  color: string
}

const MAX_DOTS = 6000

/** A "nice" number near x (1, 2 or 5 × a power of ten), used as the automatic value of one dot. */
export function niceUnit(x: number) {
  if (!(x > 0)) return 1
  const p = 10 ** Math.floor(Math.log10(x))
  const f = x / p
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p
}

/** Number of dots for a region: value / perDot rounded to whole dots. */
export const dotCount = (value: number, perDot: number) => (perDot > 0 && value > 0 ? Math.round(value / perDot) : 0)

/** Hash of a region id into the seed, so editing one region redraws only that region's dots. */
const mix = (seed: number, id: string) => { let h = seed >>> 0; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 2654435761) >>> 0; return h || 1 }

function DotChart({ table, mapping, params, width, height, compact, linked }: ChartProps<DotParams>) {
  const data = useMemo(() => regionData(table, mapping), [table, mapping])
  const resolved = useMemo(() => resolveMap(params, [...data.keys()]), [params, data])
  const { map } = resolved
  const projection = useProjection(map, params, width, height, resolved.id)
  const svgRef = useRef<SVGSVGElement>(null)
  const zoom = useMapZoom(svgRef, { enabled: !compact, width, height })
  const { tip, show, hide } = useTooltip()
  const total = d3.sum([...data.values()].filter((d) => map.byId.has(d.id)), (d) => Math.max(0, d.value ?? 0))
  const perDot = params.perDot > 0 ? params.perDot : niceUnit(total / (compact ? 400 : 1500))
  // The dot budget protects the browser: if the chosen unit would draw too many dots, the unit is enlarged.
  const unit = total / perDot > MAX_DOTS ? niceUnit(total / MAX_DOTS) : perDot
  const paths = useMemo(() => { const g = d3.geoPath(projection); return map.regions.map((r) => ({ r, d: g(r.feature) ?? '' })) }, [map, projection])
  const layers = useMemo(() => map.regions.map((r) => {
    const v = data.get(r.id)?.value ?? null
    const n = v != null ? dotCount(v, unit) : 0
    const pts = n > 0 ? randomPointsIn(r.feature, n, createRng(mix(params.seed, r.id))) : []
    const xy = pts.map((p) => projection(p)).filter((p): p is [number, number] => !!p)
    return { r, v, n, d: xy.map(([x, y]) => `M${x.toFixed(1)},${y.toFixed(1)}h0`).join('') }
  }), [map, data, unit, params.seed, projection])
  const marked = new Set(linked?.rows ?? [])
  const k = zoom.t.k
  const dots = d3.sum(layers, (l) => l.n)

  if (!roleColumn(mapping, 'region') || !roleColumn(mapping, 'value')) return <ChartMessage>지역 ID(범주형)와 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!total) return <ChartMessage>지도와 맞는 지역 ID에 0보다 큰 값이 없습니다.</ChartMessage>

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg map-svg" role="img" data-testid="chart-svg" aria-label={`점 밀도 지도: 점 ${dots}개, 점 하나가 ${fmt(unit)}`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${zoom.t.x},${zoom.t.y}) scale(${k})`}>
          {paths.map(({ r, d }, i) => (
            <path key={r.id} d={d} fill={marked.has(data.get(r.id)?.rows[0] ?? -1) ? '#ffe9d6' : '#f4f6f5'} stroke={params.borders ? '#c3cbc8' : 'none'} strokeWidth={0.6} vectorEffect="non-scaling-stroke" data-testid="dot-region" data-id={r.id} data-dots={layers[i].n}
              onPointerMove={compact ? undefined : (e) => { linked?.set(data.get(r.id)?.rows ?? null); const p = localPoint(svgRef.current!, e); show(p.x, p.y, <><b>{r.name}</b><br />값 {fmt(layers[i].v)} → 점 {layers[i].n}개<br />(점 하나 = {fmt(unit)})</>) }}
              onPointerLeave={() => { hide(); linked?.set(null) }} />
          ))}
          {layers.map((l) => l.n > 0 && <path key={`d${l.r.id}`} className="map-dots" d={l.d} stroke={params.color} strokeWidth={(compact ? Math.max(1, params.dotSize * 0.6) : params.dotSize) / k} strokeLinecap="round" fill="none" pointerEvents="none" />)}
        </g>
      </svg>
      {!compact && (
        <>
          <Readout items={[{ label: '점', value: dots.toLocaleString() }, { label: '점 하나', value: fmt(unit) }, { label: '합계', value: fmt(total) }]} />
          <MapZoomButtons zoom={zoom} k={k} />
          <p className="chart-footnote" style={{ left: 8, top: 'auto', bottom: 4 }}>점은 지역 안의 임의 위치(합성)이며 실제 사람·사건의 위치가 아닙니다.</p>
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function DotControls({ params, setParams, table, mapping }: ControlsProps<DotParams>) {
  const data = useMemo(() => regionData(table, mapping), [table, mapping])
  const resolved = useMemo(() => resolveMap(params, [...data.keys()]), [params, data])
  const total = d3.sum([...data.values()].filter((d) => resolved.map.byId.has(d.id)), (d) => Math.max(0, d.value ?? 0))
  const auto = niceUnit(total / 1500)
  return (
    <>
      <ControlGroup title="점">
        <NumberField label={`점 하나가 대표하는 수량 (0 = 자동 ${fmt(auto)})`} value={params.perDot} min={0} onChange={(perDot) => setParams({ perDot })} testId="ctl-per-dot" />
        <Hint>값 ÷ 수량을 반올림한 개수만큼 점을 찍습니다. 수량을 작게 할수록 점이 빽빽해지지만, 점이 {MAX_DOTS.toLocaleString()}개를 넘으면 자동으로 수량을 키웁니다.</Hint>
        <Slider label="점 크기" value={params.dotSize} min={1} max={7} step={0.5} onChange={(dotSize) => setParams({ dotSize })} testId="ctl-dot-size" />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ seed: (params.seed * 48271 + 11) % 2147483647 || 1 })} data-testid="dots-reseed"><Shuffle size={14} aria-hidden="true" />점 다시 뿌리기</button>
        <Hint>시드 {params.seed}: 같은 시드는 언제나 같은 점 배치를 만듭니다. 한 지역의 값을 바꿔도 다른 지역의 점은 그대로입니다.</Hint>
        <Toggle label="지역 경계선" checked={params.borders} onChange={(borders) => setParams({ borders })} />
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}>
        <GeoControls params={params} setParams={setParams} resolved={resolved} />
      </ControlGroup>
    </>
  )
}

export const dotDensityModule: VizModule<DotParams> = {
  roles: regionRoles,
  datasets: ['kr-regions', 'world-regions'],
  defaultParams: { ...geoDefaults, perDot: 0, dotSize: 2.4, seed: 7, borders: true, color: '#1f6f66' },
  Chart: DotChart,
  Controls: DotControls,
  hint: '점 하나가 대표하는 수량을 바꿔 보세요 · ‘다시 뿌리기’로 시드 변경 · 점은 지역 안에서 임의로 배치한 합성 위치입니다',
}
