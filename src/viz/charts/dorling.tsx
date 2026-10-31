import * as d3 from 'd3'
import { Play } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChartMessage, Readout, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Select, Slider, Toggle } from '../../components/controls'
import { project } from '../../geo/projections'
import { MapZoomButtons, useMapZoom } from '../../geo/useMapZoom'
import { schemes, type ColorScheme } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { dorling, maxOverlap, type DorlingInput } from '../../stats/geo'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { BaseMap, GeoControls, geoDefaults, regionData, regionRoles, resolveMap, useProjection, type GeoParams } from './geoShared'

export interface DorlingParams extends GeoParams {
  maxRadius: number
  /** 0 = circles drift freely away from their region, 1 = circles stay on the region centre where they can. */
  pull: number
  scheme: ColorScheme
  colorBy: 'size' | 'color-role'
  showMap: boolean
  labels: boolean
  selected: string
  /** Timestamp of the last ‘play’ click; each change replays the grow-and-slide animation. */
  replay: number
}

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function DorlingChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<DorlingParams>) {
  const data = useMemo(() => regionData(table, mapping, 'color'), [table, mapping])
  const resolved = useMemo(() => resolveMap(params, [...data.keys()]), [params, data])
  const { map } = resolved
  const projection = useProjection(map, params, width, height, resolved.id)
  const svgRef = useRef<SVGSVGElement>(null)
  const zoom = useMapZoom(svgRef, { enabled: !compact, width, height })
  const { tip, show, hide } = useTooltip()
  const [t, setT] = useState(1)
  const raf = useRef(0)
  const R = (compact ? 0.45 : 1) * params.maxRadius * Math.min(1, Math.max(0.5, Math.min(width, height) / 480))

  const items: DorlingInput[] = useMemo(() => map.regions.flatMap((r) => {
    const v = data.get(r.id)?.value
    const xy = project(projection, r.centroid[0], r.centroid[1])
    return v != null && v > 0 && xy ? [{ id: r.id, x: xy[0], y: xy[1], value: v }] : []
  }), [map, data, projection])
  const nodes = useMemo(() => dorling(items, { maxRadius: R, pull: params.pull }), [items, R, params.pull])
  const overlap = useMemo(() => maxOverlap(nodes), [nodes])

  // Animation: circles grow out of the region centres and slide to their final, collision-free positions.
  const play = () => {
    cancelAnimationFrame(raf.current)
    if (reduced()) { setT(1); return }
    const start = performance.now()
    const step = (now: number) => { const p = Math.min(1, (now - start) / 1100); setT(d3.easeCubicInOut(p)); if (p < 1) raf.current = requestAnimationFrame(step) }
    raf.current = requestAnimationFrame(step)
  }
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  useEffect(() => { setT(1) }, [params.pull, params.maxRadius, table])
  useEffect(() => { if (params.replay) { setT(0); play() } }, [params.replay])

  const colorVals = nodes.map((n) => (params.colorBy === 'color-role' ? data.get(n.id)?.base : data.get(n.id)?.value) ?? null)
  const [lo, hi] = d3.extent(colorVals.filter((v): v is number => v != null)) as [number, number]
  const scheme = schemes[params.scheme]
  const colorOf = (v: number | null) => (v == null ? '#cfd6d3' : scheme.interpolate(scheme.diverging ? (hi === lo ? 0.5 : (v - lo) / (hi - lo)) : 0.12 + 0.88 * (hi === lo ? 0.5 : (v - lo) / (hi - lo))))
  const marked = new Set(linked?.rows ?? [])
  const k = zoom.t.k
  const total = d3.sum(nodes, (n) => n.value)

  if (!roleColumn(mapping, 'region') || !roleColumn(mapping, 'value')) return <ChartMessage>지역 ID(범주형)와 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!nodes.length) return <ChartMessage>지도와 맞는 지역 ID에 0보다 큰 값이 없습니다.</ChartMessage>

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg map-svg" role="img" data-testid="chart-svg" aria-label={`도를링 카토그램: ${nodes.length}개 지역, 원의 넓이가 ${roleColumn(mapping, 'value')}에 비례`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${zoom.t.x},${zoom.t.y}) scale(${k})`}>
          {params.showMap && <BaseMap map={map} projection={projection} fill="#f6f8f7" stroke="#e3e8e6" />}
          {nodes.map((n, i) => {
            const x = n.px + (n.x - n.px) * t
            const y = n.py + (n.y - n.py) * t
            const r = n.r * (0.25 + 0.75 * t)
            const d = data.get(n.id)
            const on = params.selected === n.id || (d?.rows.some((q) => marked.has(q)) ?? false)
            return (
              <g key={n.id}>
                {t < 1 || n.px !== n.x || n.py !== n.y ? params.showMap && <line x1={n.px} y1={n.py} x2={x} y2={y} stroke="#b9c3bf" strokeWidth={0.6} vectorEffect="non-scaling-stroke" pointerEvents="none" /> : null}
                <circle data-testid="dorling-circle" data-id={n.id} data-r={n.r.toFixed(3)} data-x={n.x.toFixed(2)} data-y={n.y.toFixed(2)} cx={x} cy={y} r={r} fill={colorOf(colorVals[i])} fillOpacity={0.88} stroke={on ? '#121816' : '#ffffff'} strokeWidth={on ? 2 : 0.8} vectorEffect="non-scaling-stroke"
                  onClick={compact ? undefined : () => setParams({ selected: params.selected === n.id ? '' : n.id })}
                  onPointerMove={compact ? undefined : (e) => { linked?.set(d?.rows ?? null); const p = localPoint(svgRef.current!, e); show(p.x, p.y, <><b>{map.byId.get(n.id)?.name}</b> <small>{n.id}</small><br />{roleColumn(mapping, 'value')}: {fmt(n.value)} ({fmt((n.value / total) * 100, 1)}%)</>) }}
                  onPointerLeave={() => { hide(); linked?.set(null) }} />
                {params.labels && !compact && r * k > 13 && <text className="net-label" x={x} y={y} dy="0.35em" textAnchor="middle" fontSize={Math.min(12, (r * k) / 2.6) / k} pointerEvents="none">{map.byId.get(n.id)?.name.slice(0, Math.max(2, Math.floor((r * k) / 4)))}</text>}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          <div className="color-legend"><span>{fmt(lo, 3)}</span><span className="color-ramp" style={{ background: `linear-gradient(90deg, ${d3.range(0, 1.01, 0.1).map((v) => scheme.interpolate(scheme.diverging ? v : 0.12 + 0.88 * v)).join(',')})` }} /><span>{fmt(hi, 3)}</span></div>
          <Readout items={[{ label: '지역', value: nodes.length }, { label: '합계', value: fmt(total) }, { label: '최대 겹침', value: overlap < 0.5 ? '없음' : `${overlap.toFixed(1)}px` }]} />
          <MapZoomButtons zoom={zoom} k={k} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function DorlingControls({ params, setParams, table, mapping }: ControlsProps<DorlingParams>) {
  const data = useMemo(() => regionData(table, mapping, 'color'), [table, mapping])
  const resolved = useMemo(() => resolveMap(params, [...data.keys()]), [params, data])
  return (
    <>
      <ControlGroup title="원">
        <Slider label="최대 반지름" value={params.maxRadius} min={14} max={90} onChange={(maxRadius) => setParams({ maxRadius })} format={(v) => `${v}px`} testId="ctl-dorling-radius" />
        <Hint>원의 넓이가 값에 비례합니다(반지름 ∝ √값). 가장 큰 값의 원이 최대 반지름이 됩니다.</Hint>
        <Slider label="원래 위치로 당기는 힘" value={params.pull} min={0} max={1} step={0.05} onChange={(pull) => setParams({ pull })} format={(v) => v.toFixed(2)} testId="ctl-dorling-pull" />
        <Hint>힘이 크면 원이 지역 중심에 가깝게 남아 지도 모양을 알아보기 쉽지만 겹침을 풀려고 밀려나는 거리가 늘어납니다. 힘이 작으면 원끼리 서로 더 자유롭게 퍼집니다. 어느 쪽이든 원은 겹치지 않습니다.</Hint>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ replay: Date.now() })} data-testid="dorling-play"><Play size={14} aria-hidden="true" />모양 변하는 과정 보기</button>
      </ControlGroup>
      <ControlGroup title="색상">
        <Select label="색 기준" value={params.colorBy} onChange={(colorBy) => setParams({ colorBy })} options={[{ value: 'size', label: '원 크기와 같은 값' }, { value: 'color-role', label: '‘색 값’ 열 (선택)' }]} />
        <Select label="색상 팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={(Object.keys(schemes) as ColorScheme[]).map((k) => ({ value: k, label: schemes[k].name }))} />
        <Toggle label="원래 지도 겹쳐 보기 (비교)" checked={params.showMap} onChange={(showMap) => setParams({ showMap })} testId="ctl-dorling-map" description="회색 지도와 연결선으로 원이 원래 위치에서 얼마나 밀려났는지 확인합니다." />
        <Toggle label="이름 표시" checked={params.labels} onChange={(labels) => setParams({ labels })} />
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams} resolved={resolved} /></ControlGroup>
    </>
  )
}

export const dorlingModule: VizModule<DorlingParams> = {
  roles: [...regionRoles, { key: 'color', label: '색 값 (선택)', type: 'number' }],
  datasets: ['kr-regions', 'world-regions'],
  defaultParams: { ...geoDefaults, maxRadius: 52, pull: 0.6, scheme: 'teal', colorBy: 'size', showMap: true, labels: true, selected: '', replay: 0 },
  Chart: DorlingChart,
  Controls: DorlingControls,
  hint: '지역의 땅 넓이가 아니라 값에 비례하는 원 · 힘 슬라이더로 지도 모양과 겹침 해소 사이의 균형 조절 · 원래 지도와 겹쳐 비교',
}
