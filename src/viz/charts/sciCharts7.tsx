import * as d3 from 'd3'
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { ChartMessage, Tooltip, localPoint, useSvgId, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber } from '../../data/table'
import { getMap } from '../../geo/maps'
import { useReducedMotion } from '../../hooks/motion'
import { schemes, type ColorScheme, type SequentialScheme } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { classBreaks, classIndex } from '../../stats/geo'
import { gridFromRows, type Grid3 } from '../../stats/field3d'
import { fieldAt, lic, mprSlice, whiteNoise, type FlowSource, type Plane } from '../../stats/sci7'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { regionData, regionRoles } from './geoShared'

// ───────────────────────────── Line Integral Convolution ─────────────────────────────

export interface LicParams { length: number; res: 'low' | 'mid' | 'high'; color: 'speed' | 'mono'; arrows: boolean; noise: boolean; seed: number }
const RES = { low: 120, mid: 200, high: 300 }

function useSources(table: ChartProps<unknown>['table'], mapping: ChartProps<unknown>['mapping']): FlowSource[] {
  const cols = ['kind', 'x', 'y', 'strength', 'radius'].map((k) => columnIndex(table, roleColumn(mapping, k)))
  return useMemo(() => {
    if (cols.some((c) => c < 0)) return []
    return table.rows.map((r) => {
      const kind = toLabel(r[cols[0]]) as FlowSource['kind']
      const [x, y, s, rad] = [1, 2, 3, 4].map((k) => toNumber(r[cols[k]]))
      return x == null || y == null || s == null ? null : ({ kind: (['소용돌이', '흡입', '방출', '균일'].includes(kind) ? kind : '소용돌이') as FlowSource['kind'], x, y, strength: s, radius: Math.max(0.01, rad ?? 0.1) })
    }).filter((s): s is FlowSource => s != null)
  }, [table, cols.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
}

function LicChart({ table, mapping, params, width, height, compact }: ChartProps<LicParams>) {
  const sources = useSources(table, mapping)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const m = compact ? 6 : 36
  const side = Math.max(60, Math.min(width, height) - 2 * m)
  const res = compact ? 70 : RES[params.res]
  const img = useMemo(() => {
    if (!sources.length) return null
    const noise = whiteNoise(res, res, params.seed)
    // velocity in pixel space: world y points up, pixel y points down
    const field = (px: number, py: number): [number, number] => { const [u, v] = fieldAt(sources, px / res, 1 - py / res); return [u, -v] }
    const speed = new Float32Array(res * res)
    let maxSp = 1e-9
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) { const [u, v] = fieldAt(sources, i / res, 1 - j / res); const s = Math.hypot(u, v); speed[j * res + i] = s; maxSp = Math.max(maxSp, s) }
    return { noise, texture: lic(field, noise, res, res, Math.round(params.length * (res / 200))), speed, maxSp }
  }, [sources, res, params.length, params.seed])
  useEffect(() => {
    const c = canvasRef.current
    if (!c || !img) return
    c.width = res; c.height = res
    const ctx = c.getContext('2d')
    if (!ctx) return
    const out = ctx.createImageData(res, res)
    const ramp = schemes.viridis.interpolate
    for (let i = 0; i < res * res; i++) {
      const t = params.noise ? img.noise[i] : img.texture[i]
      let r = 255 * t, g = 255 * t, b = 255 * t
      if (params.color === 'speed' && !params.noise) {
        const col = d3.rgb(ramp(0.1 + 0.85 * Math.sqrt(img.speed[i] / img.maxSp)))
        const k = 0.28 + 0.72 * t
        r = col.r * k; g = col.g * k; b = col.b * k
      }
      out.data[i * 4] = r; out.data[i * 4 + 1] = g; out.data[i * 4 + 2] = b; out.data[i * 4 + 3] = 255
    }
    ctx.putImageData(out, 0, 0)
  }, [img, res, params.color, params.noise])
  if (!sources.length) return <ChartMessage>유동장 원천(종류, x, y, 세기, 반경) 열을 선택하세요.</ChartMessage>
  const ox = (width - side) / 2, oy = (height - side) / 2
  const arrows: { x: number; y: number; a: number; len: number }[] = []
  if (params.arrows && !compact) {
    const n = 14
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const wx = (i + 0.5) / n, wy = (j + 0.5) / n
      const [u, v] = fieldAt(sources, wx, wy)
      const s = Math.hypot(u, v)
      if (s > 1e-9) arrows.push({ x: wx * side, y: (1 - wy) * side, a: Math.atan2(-v, u), len: Math.min(side / n * 0.8, 6 + 14 * Math.sqrt(s / (img?.maxSp ?? 1))) })
    }
  }
  return (
    <div className="chart-root" style={{ position: 'relative', width, height }}>
      <canvas ref={canvasRef} data-testid="lic-canvas" style={{ position: 'absolute', left: ox, top: oy, width: side, height: side, imageRendering: 'auto', background: '#fff' }} />
      <svg width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" style={{ position: 'relative', zIndex: 1 }} aria-label={`Line Integral Convolution: 원천 ${sources.length}개로 만든 유동장의 방향을 노이즈 텍스처로 표현`}>
        <g transform={`translate(${ox},${oy})`}>
          <rect width={side} height={side} fill="none" stroke="#9aa3ad" />
          {!compact && [0, 0.25, 0.5, 0.75, 1].map((t) => <g key={t}><line x1={t * side} x2={t * side} y1={side} y2={side + 5} stroke="#9aa3ad" /><text x={t * side} y={side + 17} textAnchor="middle" className="radar-level">{t}</text><line x1={-5} x2={0} y1={(1 - t) * side} y2={(1 - t) * side} stroke="#9aa3ad" /><text x={-8} y={(1 - t) * side} dy="0.34em" textAnchor="end" className="radar-level">{t}</text></g>)}
          {arrows.map((a, i) => <g key={i} transform={`translate(${a.x},${a.y}) rotate(${(a.a * 180) / Math.PI})`}><path d={`M${-a.len / 2},0 L${a.len / 2},0 M${a.len / 2 - 3},-2.5 L${a.len / 2},0 L${a.len / 2 - 3},2.5`} stroke="#fff" strokeWidth={2.4} fill="none" /><path d={`M${-a.len / 2},0 L${a.len / 2},0 M${a.len / 2 - 3},-2.5 L${a.len / 2},0 L${a.len / 2 - 3},2.5`} stroke="#111" strokeWidth={1} fill="none" /></g>)}
          {sources.filter((s) => s.kind !== '균일').map((s, i) => (
            <g key={i} transform={`translate(${s.x * side},${(1 - s.y) * side})`}>
              <circle r={compact ? 3 : 7} fill="#fff" stroke={s.kind === '소용돌이' ? '#cf4f6a' : s.kind === '흡입' ? '#4c6fb5' : '#e07a3f'} strokeWidth={2} />
              {!compact && <text y={-11} textAnchor="middle" className="radar-level" style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}>{s.kind}</text>}
            </g>
          ))}
        </g>
      </svg>
    </div>
  )
}

function LicControls({ params, setParams }: ControlsProps<LicParams>) {
  return (
    <>
      <ControlGroup title="LIC 계산">
        <Slider label="적분 길이 (픽셀)" value={params.length} min={4} max={40} onChange={(length) => setParams({ length })} testId="ctl-length" />
        <Segmented label="해상도" value={params.res} onChange={(res) => setParams({ res })} options={[{ value: 'low', label: '낮음' }, { value: 'mid', label: '보통' }, { value: 'high', label: '높음' }]} testId="ctl-res" />
        <Slider label="노이즈 시드" value={params.seed} min={1} max={30} onChange={(seed) => setParams({ seed })} />
        <Hint>모든 픽셀에서 흐름을 따라 앞뒤로 적분 길이만큼 이동하며 백색 노이즈를 평균합니다. 같은 유선 위의 픽셀은 거의 같은 값을 평균하므로 흐름 방향으로는 매끄럽고 수직 방향으로는 변해, 방향이 결이 되어 보입니다.</Hint>
      </ControlGroup>
      <ControlGroup title="표현 비교">
        <Segmented label="색" value={params.color} onChange={(color) => setParams({ color })} options={[{ value: 'speed', label: '속력에 따라' }, { value: 'mono', label: '흑백' }]} testId="ctl-color" />
        <Toggle label="화살표 격자 겹치기" checked={params.arrows} onChange={(arrows) => setParams({ arrows })} testId="ctl-arrows" />
        <Toggle label="입력 노이즈만 보기" checked={params.noise} onChange={(noise) => setParams({ noise })} testId="ctl-noise" />
      </ControlGroup>
    </>
  )
}

export const licModule: VizModule<LicParams> = {
  roles: [
    { key: 'kind', label: '종류', type: 'category', required: true },
    { key: 'x', label: 'x', type: 'number', required: true, prefer: '^x' },
    { key: 'y', label: 'y', type: 'number', required: true, prefer: '^y' },
    { key: 'strength', label: '세기', type: 'number', required: true, prefer: '세기' },
    { key: 'radius', label: '반경', type: 'number', required: true, prefer: '반경' },
  ],
  datasets: ['lic-sources'],
  defaultParams: { length: 18, res: 'mid', color: 'speed', arrows: false, noise: false, seed: 5 },
  Chart: LicChart,
  Controls: LicControls,
  hint: '원천의 세기와 위치를 데이터 탭에서 고치면 흐름의 결이 바뀝니다 · 화살표와 겹쳐 비교',
}

// ───────────────────────────── 3D Globe ─────────────────────────────

export interface GlobeParams { lon: number; lat: number; spin: boolean; speed: number; scheme: ColorScheme; classes: number; graticule: boolean; markers: boolean }

function GlobeChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<GlobeParams>) {
  const data = useMemo(() => regionData(table, mapping), [table, mapping])
  const map = useMemo(() => getMap('world'), [])
  const reduced = useReducedMotion()
  const [rot, setRot] = useState<[number, number]>([params.lon, params.lat])
  const drag = useRef<{ x: number; y: number; lon: number; lat: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const { tip, show, hide } = useTooltip()
  const clip = useSvgId('globe-clip')
  useEffect(() => { setRot([params.lon, params.lat]) }, [params.lon, params.lat])
  const spinning = params.spin && !compact && !reduced
  useEffect(() => {
    if (!spinning) return
    let raf = 0, last = performance.now()
    const step = (now: number) => { const dt = (now - last) / 1000; last = now; if (!drag.current) setRot((r) => [((r[0] + params.speed * dt + 540) % 360) - 180, r[1]]); raf = requestAnimationFrame(step) }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [spinning, params.speed])
  const R = Math.max(30, Math.min(width, height) / 2 - (compact ? 6 : 26))
  const projection = useMemo(() => d3.geoOrthographic().scale(R).translate([width / 2, height / 2]).clipAngle(90).rotate([-rot[0], -rot[1]]), [R, width, height, rot])
  const path = useMemo(() => d3.geoPath(projection), [projection])
  const values = [...data.values()].map((d) => d.value).filter((v): v is number => v != null)
  const edges = useMemo(() => (values.length ? classBreaks(values, 'quantile', params.classes) : []), [values.join(','), params.classes]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!data.size) return <ChartMessage>국가 ID(예: KOR)와 값 열을 선택하세요.</ChartMessage>
  const scheme = schemes[params.scheme]
  const colorOf = (v: number) => { const n = Math.max(1, edges.length - 1); const t = n === 1 ? 0.5 : classIndex(v, edges) / (n - 1); return scheme.interpolate(scheme.diverging ? t : 0.12 + 0.88 * t) }
  const onDown = (e: PointerEvent<SVGSVGElement>) => { if (compact) return; (e.currentTarget as Element).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, lon: rot[0], lat: rot[1] }; hide() }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    const k = 180 / (Math.PI * R) * 0.9
    setRot([((d.lon - (e.clientX - d.x) * k + 540) % 360) - 180, Math.max(-85, Math.min(85, d.lat + (e.clientY - d.y) * k))])
  }
  const onUp = () => { if (drag.current) { drag.current = null; setParams({ lon: Math.round(rot[0]), lat: Math.round(rot[1]) }) } }
  const maxV = Math.max(...values, 1e-9)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" style={{ touchAction: 'none', cursor: compact ? undefined : drag.current ? 'grabbing' : 'grab' }}
        aria-label={`3D Globe: 세계 국가 ${map.regions.length}곳을 구면에 올려 중심 경도 ${rot[0].toFixed(0)}°, 위도 ${rot[1].toFixed(0)}°에서 본 모습`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={hide}>
        <defs><clipPath id={clip}><circle cx={width / 2} cy={height / 2} r={R} /></clipPath></defs>
        <circle cx={width / 2} cy={height / 2} r={R} fill="#eef3f6" stroke="#9aa3ad" data-testid="globe-sphere" />
        <g clipPath={`url(#${clip})`}>
          {params.graticule && <path d={path(d3.geoGraticule10()) ?? ''} fill="none" stroke="#c9d3da" strokeWidth={0.5} />}
          {map.regions.map((r) => {
            const d = data.get(r.id)
            return <path key={r.id} d={path(r.feature) ?? ''} fill={d && d.value != null ? colorOf(d.value) : '#f6f7f8'} stroke="#fff" strokeWidth={0.4} data-testid="globe-region"
              onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{r.name}</b><br />{d && d.value != null ? `값 ${fmt(d.value)}` : '데이터 없음'}</>) }} onPointerLeave={hide} />
          })}
          {params.markers && !compact && map.regions.map((r) => {
            const d = data.get(r.id)
            if (!d || d.value == null) return null
            const p = projection(r.centroid)
            const vis = d3.geoDistance(r.centroid, [rot[0], rot[1]]) < Math.PI / 2
            return p && vis ? <circle key={`m${r.id}`} cx={p[0]} cy={p[1]} r={1 + 9 * Math.sqrt(d.value / maxV)} fill="#111" fillOpacity={0.22} stroke="#111" strokeWidth={0.6} style={{ pointerEvents: 'none' }} /> : null
          })}
        </g>
        <circle cx={width / 2} cy={height / 2} r={R} fill="none" stroke="#9aa3ad" />
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function GlobeControls({ params, setParams }: ControlsProps<GlobeParams>) {
  return (
    <>
      <ControlGroup title="시점">
        <Slider label="중심 경도" value={params.lon} min={-180} max={180} onChange={(lon) => setParams({ lon, spin: false })} format={(v) => `${v}°`} testId="ctl-lon" />
        <Slider label="중심 위도" value={params.lat} min={-85} max={85} onChange={(lat) => setParams({ lat })} format={(v) => `${v}°`} testId="ctl-lat" />
        <Toggle label="자동 회전" checked={params.spin} onChange={(spin) => setParams({ spin })} testId="ctl-spin" />
        <Slider label="회전 속도 (°/초)" value={params.speed} min={2} max={40} onChange={(speed) => setParams({ speed })} />
        <Hint>구면을 직교투영한 모습이라 한 번에 한쪽 반구만 보입니다. 끌어서 돌리면 면적과 모양이 중심에서는 정확하고 가장자리로 갈수록 찌그러지는 것을 볼 수 있습니다. 평면 지도에서는 이 왜곡이 다른 방식으로 나타납니다.</Hint>
      </ControlGroup>
      <ControlGroup title="표현">
        <Select label="색 구성" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={(['teal', 'viridis', 'blues', 'magma', 'ylorrd'] as SequentialScheme[]).map((s) => ({ value: s, label: schemes[s].name }))} />
        <Slider label="분류 수 (분위수)" value={params.classes} min={3} max={8} onChange={(classes) => setParams({ classes })} testId="ctl-classes" />
        <Toggle label="경위선 격자" checked={params.graticule} onChange={(graticule) => setParams({ graticule })} />
        <Toggle label="값 크기 점 (중심점)" checked={params.markers} onChange={(markers) => setParams({ markers })} testId="ctl-markers" />
      </ControlGroup>
    </>
  )
}

export const globeModule: VizModule<GlobeParams> = {
  roles: regionRoles,
  datasets: ['world-regions'],
  defaultParams: { lon: 127, lat: 25, spin: false, speed: 12, scheme: 'teal', classes: 5, graticule: true, markers: false },
  Chart: GlobeChart,
  Controls: GlobeControls,
  hint: '지구본을 끌어서 회전 · 자동 회전과 시점 슬라이더 · 국가에 올려 값 확인',
}

// ───────────────────────────── Multi-Planar Reconstruction ─────────────────────────────

export interface MprParams { pos: [number, number, number]; center: number; width2: number; palette: SequentialScheme; smooth: boolean }

const PLANES: { id: Plane; name: string; u: 0 | 1 | 2; v: 0 | 1 | 2; fixed: 0 | 1 | 2 }[] = [
  { id: 'axial', name: '축면 (z 고정)', u: 0, v: 1, fixed: 2 },
  { id: 'coronal', name: '관상면 (y 고정)', u: 0, v: 2, fixed: 1 },
  { id: 'sagittal', name: '시상면 (x 고정)', u: 1, v: 2, fixed: 0 },
]

function useGrid(table: ChartProps<unknown>['table'], mapping: ChartProps<unknown>['mapping']): Grid3 | null {
  return useMemo(() => {
    const idx = ['x', 'y', 'z', 'value'].map((k) => columnIndex(table, roleColumn(mapping, k)))
    if (idx.some((i) => i < 0)) return null
    const rows: { x: number; y: number; z: number; v: number }[] = []
    for (const r of table.rows) { const [x, y, z, v] = idx.map((i) => toNumber(r[i])); if (x != null && y != null && z != null && v != null) rows.push({ x, y, z, v }) }
    return gridFromRows(rows)
  }, [table, mapping])
}

function MprChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<MprParams>) {
  const g = useGrid(table, mapping)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!g) return <ChartMessage>x, y, z, 스칼라 값 열이 규칙적인 3차원 격자를 이루어야 합니다.</ChartMessage>
  const n = [g.nx, g.ny, g.nz] as const
  const lo = [g.x0, g.y0, g.z0], span = [(g.nx - 1) * g.dx, (g.ny - 1) * g.dy, (g.nz - 1) * g.dz]
  const frac = params.pos
  const world = [0, 1, 2].map((a) => lo[a] + frac[a] * span[a]) as [number, number, number]
  const gap = compact ? 4 : 18
  const cols = compact ? 3 : width > 760 ? 3 : 2
  const rows = Math.ceil(3 / cols)
  const side = Math.max(40, Math.min((width - gap * (cols + 1)) / cols, (height - gap * (rows + 1) - (compact ? 0 : 22 * rows)) / rows))
  const res = (a: number) => Math.min(48, Math.max(8, n[a] * (params.smooth ? 2 : 1)))
  const ramp = schemes[params.palette].interpolate
  const range = g.max - g.min || 1
  const c0 = g.min + params.center * range, w2 = Math.max(0.02, params.width2) * range
  const colorOf = (v: number) => ramp(Math.min(1, Math.max(0, (v - (c0 - w2 / 2)) / w2)))
  const value = (() => { const i = Math.round(frac[0] * (n[0] - 1)), j = Math.round(frac[1] * (n[1] - 1)), k = Math.round(frac[2] * (n[2] - 1)); return g.data[(k * g.ny + j) * g.nx + i] })()
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Multi-Planar Reconstruction: 3차원 볼륨의 축면·관상면·시상면 단면, 교차점 (${world.map((v) => v.toFixed(1)).join(', ')})`} onPointerLeave={hide}>
        {PLANES.map((pl, pi) => {
          const nu = res(pl.u), nv = res(pl.v)
          const cells = mprSlice(g, pl.id, world, nu, nv)
          const ox = gap + (pi % cols) * (side + gap) + ((width - gap * (cols + 1) - side * cols) / 2), oy = gap + Math.floor(pi / cols) * (side + gap + (compact ? 0 : 22)) + (compact ? 0 : 18)
          return (
            <g key={pl.id} transform={`translate(${ox},${oy})`} data-testid={`mpr-${pl.id}`}>
              {!compact && <text y={-6} className="radar-axis-label">{pl.name}</text>}
              {cells.map((row, r) => row.map((v, c) => <rect key={`${r},${c}`} x={(c * side) / nu} y={(r * side) / nv} width={side / nu + 0.4} height={side / nv + 0.4} fill={colorOf(v)} />))}
              <rect width={side} height={side} fill="none" stroke="#9aa3ad" />
              <line x1={frac[pl.u] * side} x2={frac[pl.u] * side} y1={0} y2={side} stroke="#fff" strokeWidth={1.2} strokeDasharray="4 3" />
              <line x1={0} x2={side} y1={(1 - frac[pl.v]) * side} y2={(1 - frac[pl.v]) * side} stroke="#fff" strokeWidth={1.2} strokeDasharray="4 3" />
              {!compact && <rect width={side} height={side} fill="transparent" style={{ cursor: 'crosshair' }} data-testid={`mpr-hit-${pl.id}`}
                onPointerMove={(e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <>클릭해 교차점 이동</>) }}
                onClick={(e) => {
                  const b = (e.currentTarget as SVGRectElement).getBoundingClientRect()
                  const next = [...frac] as [number, number, number]
                  next[pl.u] = Math.min(1, Math.max(0, (e.clientX - b.left) / b.width))
                  next[pl.v] = Math.min(1, Math.max(0, 1 - (e.clientY - b.top) / b.height))
                  setParams({ pos: next })
                }} />}
            </g>
          )
        })}
        {!compact && <text x={gap} y={height - 8} className="radar-level" data-testid="mpr-readout">교차점 (x {fmt(world[0])}, y {fmt(world[1])}, z {fmt(world[2])}) · 값 {fmt(value)}</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function MprControls({ params, setParams }: ControlsProps<MprParams>) {
  const set = (a: number, v: number) => { const pos = [...params.pos] as [number, number, number]; pos[a] = v; setParams({ pos }) }
  return (
    <>
      <ControlGroup title="단면 위치 (교차점)">
        {['x (시상면)', 'y (관상면)', 'z (축면)'].map((l, a) => <Slider key={l} label={l} value={params.pos[a]} min={0} max={1} step={0.01} onChange={(v) => set(a, v)} format={(v) => `${Math.round(v * 100)}%`} testId={`mpr-pos-${a}`} />)}
        <Hint>세 단면은 같은 교차점을 지나는 서로 수직인 평면입니다. 어느 단면에서든 눌러 교차점을 옮기면 나머지 두 단면이 함께 바뀝니다. 한 단면만으로는 보이지 않던 3차원 구조가 세 방향에서 맞춰집니다.</Hint>
      </ControlGroup>
      <ControlGroup title="명암 창">
        <Slider label="창 중심" value={params.center} min={0} max={1} step={0.01} onChange={(center) => setParams({ center })} format={(v) => v.toFixed(2)} testId="mpr-center" />
        <Slider label="창 너비" value={params.width2} min={0.05} max={1.2} step={0.01} onChange={(width2) => setParams({ width2 })} format={(v) => v.toFixed(2)} testId="mpr-width" />
        <Select label="색 구성" value={params.palette} onChange={(palette) => setParams({ palette })} options={[{ value: 'viridis', label: 'Viridis' }, { value: 'magma', label: 'Magma' }, { value: 'blues', label: '파랑' }, { value: 'ylorrd', label: '노랑–빨강' }]} />
        <Toggle label="보간으로 부드럽게 (2배)" checked={params.smooth} onChange={(smooth) => setParams({ smooth })} />
      </ControlGroup>
    </>
  )
}

export const mprModule: VizModule<MprParams> = {
  roles: [
    { key: 'x', label: 'x', type: 'number', required: true, prefer: '^x|x$' },
    { key: 'y', label: 'y', type: 'number', required: true, prefer: '^y|y$' },
    { key: 'z', label: 'z', type: 'number', required: true, prefer: '^z|z$' },
    { key: 'value', label: '스칼라 값', type: 'number', required: true, prefer: '값|value|밀도' },
  ],
  datasets: ['scalar-metaballs', 'scalar-orbital', 'scalar-gyroid'],
  defaultParams: { pos: [0.5, 0.5, 0.5], center: 0.45, width2: 0.9, palette: 'magma', smooth: true },
  Chart: MprChart,
  Controls: MprControls,
  hint: '단면을 눌러 교차점을 옮기면 세 단면이 동기화됩니다 · 창 중심/너비로 명암 조절',
}
