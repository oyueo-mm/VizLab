import * as d3 from 'd3'
import { useEffect, useMemo, useRef } from 'react'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, type DataTable } from '../../data/table'
import { colorAt, schemes } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { shapeCentroid } from '../../stats/cartogram'
import { vecAt, type V3 } from '../../stats/field3d'
import { adjacencyFromRings, rectangularCartogram, spotNoise, streamRibbon, travelCartogram, travelTimes, type TEdge, type TNode } from '../../stats/field11'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'
import { cubeMap, vectorRoles } from './field3dCharts'
import { SeedControls, lookDir, maxSpeed, seedDefaults, seedLine, shade, useField, type SeedParams } from './fieldCharts8'
import { ViewControls, type ViewParams } from './geo3dCharts'
import { GeoControls, geoDefaults, regionRoles, resolveMap, type GeoParams } from './geoShared'
import { Scene3D } from './kit3d'
import { projectedShapes, regionRows, useRegionStage } from './regionKit'
import { drawQuads, type Projector, type Quad } from './scene3d'

// ───────────────────────────── Spot noise ─────────────────────────────

export interface SpotParams { spots: number; size: number; stretch: number; highPass: boolean; tint: boolean; seed: number }

function SpotChart({ table, mapping, params, width, height, compact }: ChartProps<SpotParams>) {
  const cvRef = useRef<HTMLCanvasElement>(null)
  const grid = useMemo(() => {
    const xi = columnIndex(table, roleColumn(mapping, 'x')), yi = columnIndex(table, roleColumn(mapping, 'y')), ui = columnIndex(table, roleColumn(mapping, 'u')), vi = columnIndex(table, roleColumn(mapping, 'v'))
    if (xi < 0 || yi < 0 || ui < 0 || vi < 0) return null
    const xs = [...new Set(table.rows.map((r) => toNumber(r[xi])).filter((v): v is number => v != null))].sort((a, b) => a - b)
    const ys = [...new Set(table.rows.map((r) => toNumber(r[yi])).filter((v): v is number => v != null))].sort((a, b) => a - b)
    if (xs.length < 3 || ys.length < 3 || xs.length * ys.length > 6000) return null
    const xm = new Map(xs.map((v, i) => [v, i])), ym = new Map(ys.map((v, i) => [v, i]))
    const U = new Float64Array(xs.length * ys.length), V = new Float64Array(xs.length * ys.length)
    let n = 0
    for (const r of table.rows) { const x = toNumber(r[xi]), y = toNumber(r[yi]), u = toNumber(r[ui]), v = toNumber(r[vi]); if (x == null || y == null || u == null || v == null) continue; const k = ym.get(y)! * xs.length + xm.get(x)!; U[k] = u; V[k] = v; n++ }
    return n >= xs.length * ys.length ? { xs, ys, U, V } : null
  }, [table, mapping])
  const W = compact ? 120 : Math.min(560, Math.max(160, Math.floor(width))), H = compact ? 90 : Math.min(420, Math.max(120, Math.floor(height)))
  const tex = useMemo(() => {
    if (!grid) return null
    const { xs, ys, U, V } = grid
    const nx = xs.length, ny = ys.length
    const field = (px: number, py: number): [number, number] => {
      const fx = Math.min(nx - 1.001, Math.max(0, (px / W) * (nx - 1))), fy = Math.min(ny - 1.001, Math.max(0, (1 - py / H) * (ny - 1)))
      const i = Math.floor(fx), j = Math.floor(fy), a = fx - i, b = fy - j
      const s = (A: Float64Array) => A[j * nx + i] * (1 - a) * (1 - b) + A[j * nx + i + 1] * a * (1 - b) + A[(j + 1) * nx + i] * (1 - a) * b + A[(j + 1) * nx + i + 1] * a * b
      return [s(U), -s(V)]
    }
    const t = spotNoise(field, W, H, compact ? Math.round(params.spots / 6) : params.spots, params.size * (compact ? 0.5 : 1), params.stretch, params.seed, params.highPass)
    return { t, field }
  }, [grid, W, H, params.spots, params.size, params.stretch, params.highPass, params.seed, compact])
  useEffect(() => {
    const cv = cvRef.current
    if (!cv || !tex) return
    cv.width = W; cv.height = H
    const ctx = cv.getContext('2d')!
    const img = ctx.createImageData(W, H)
    let s2 = 0
    for (const v of tex.t.tex) s2 += v * v
    const sd = Math.sqrt(s2 / tex.t.tex.length) || 1
    let vmax = 1e-9
    if (params.tint) for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) { const [u, v] = tex.field(x, y); vmax = Math.max(vmax, Math.hypot(u, v)) }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const g = Math.max(0, Math.min(255, 128 + (tex.t.tex[y * W + x] / (2.2 * sd)) * 127))
      let rgb: [number, number, number] = [g, g, g]
      if (params.tint) { const [u, v] = tex.field(x, y); const c = d3.rgb(d3.interpolateYlGnBu(Math.hypot(u, v) / vmax)); const m = 0.38; rgb = [g * (1 - m) + c.r * m, g * (1 - m) + c.g * m, g * (1 - m) + c.b * m] }
      const o = (y * W + x) * 4
      img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  }, [tex, params.tint, W, H])
  if (!grid) return <ChartMessage>x, y 좌표와 벡터 성분 u, v 열을 고르세요. 규칙적인 이차원 격자여야 합니다.</ChartMessage>
  return (
    <div className="chart-root">
      <canvas ref={cvRef} data-testid="spot-canvas" data-spots={params.spots} style={{ position: 'absolute', left: 0, top: 0, width, height, imageRendering: 'auto' }} role="img" aria-label="스폿 노이즈: 속도장에 따라 늘어난 반점의 합성 텍스처" />
      <svg width={width} height={height} className="chart-svg" data-testid="chart-svg" style={{ pointerEvents: 'none' }} aria-hidden="true">
        <rect x={0.5} y={0.5} width={Math.max(0, width - 1)} height={Math.max(0, height - 1)} fill="none" stroke="#dbe3e3" />
        {!compact && <g>
          {Array.from({ length: 8 }, (_, i) => <rect key={i} x={width - 118 + i * 12} y={height - 24} width={12} height={8} fill={d3.interpolateYlGnBu(i / 7)} />)}
          <text x={width - 118} y={height - 28} fontSize={9} fill="#374151">속도 (색 입히기를 켜면 적용)</text>
          <line x1={width - 118} x2={width - 22} y1={height - 12} y2={height - 12} stroke="#9aa6a6" />
        </g>}
        {compact && <line x1={4} y1={height - 4} x2={width - 4} y2={height - 4} stroke="#e5ebeb" />}
      </svg>
    </div>
  )
}

function SpotControls({ params, setParams }: ControlsProps<SpotParams>) {
  return (
    <ControlGroup title="스폿 노이즈">
      <Slider label="반점 수" value={params.spots} min={500} max={9000} step={250} onChange={(spots) => setParams({ spots })} testId="ctl-spots" />
      <Slider label="반점 크기(픽셀)" value={params.size} min={2} max={12} step={0.5} onChange={(size) => setParams({ size })} format={(v) => v.toFixed(1)} testId="ctl-spotsize" />
      <Slider label="속도에 따른 늘어남" value={params.stretch} min={0} max={8} step={0.5} onChange={(stretch) => setParams({ stretch })} format={(v) => v.toFixed(1)} testId="ctl-stretch" />
      <Slider label="난수 씨앗" value={params.seed} min={1} max={30} onChange={(seed) => setParams({ seed })} testId="ctl-spotseed" />
      <Toggle label="고주파 통과(국소 평균 제거)" checked={params.highPass} onChange={(highPass) => setParams({ highPass })} testId="ctl-hp" />
      <Toggle label="속도 크기로 색 입히기" checked={params.tint} onChange={(tint) => setParams({ tint })} testId="ctl-tint" />
      <Hint>스폿 노이즈(van Wijk 1991)는 무작위 위치에 놓인 무작위 가중치(±1)의 작은 반점들을 모두 더해 텍스처를 만듭니다. 각 반점은 그 자리의 속도에 맞춰 변형됩니다: 긴 축이 속도 방향을 향하고 속도가 클수록 길게 늘어나며(짧은 축은 그만큼 줄어 면적은 같음), 그래서 흐름 방향으로 이어진 줄무늬가 생깁니다. 반점 수와 크기, 늘어남을 바꿔 보세요. LIC·IBFV가 유선을 따라 노이즈를 평활하는 것과 달리 반점 모양 자체가 흐름을 담습니다. 이 구현은 속도 방향·크기만 반영하고 원 논문의 곡률에 따라 휘는 반점은 쓰지 않았습니다.</Hint>
    </ControlGroup>
  )
}

export const spotModule: VizModule<SpotParams> = {
  roles: [
    { key: 'x', label: 'x (격자)', type: 'number', required: true, prefer: '^x$' },
    { key: 'y', label: 'y (격자)', type: 'number', required: true, prefer: '^y$' },
    { key: 'u', label: '벡터 u', type: 'number', required: true, prefer: '^u$' },
    { key: 'v', label: '벡터 v', type: 'number', required: true, prefer: '^v$' },
  ],
  datasets: ['flow-2d'],
  defaultParams: { spots: 5000, size: 4, stretch: 4, highPass: true, tint: false, seed: 7 },
  Chart: SpotChart,
  Controls: SpotControls,
  hint: '늘어남을 키우면 줄무늬가 흐름 방향으로 길어집니다 · 반점 수를 늘리면 무늬가 촘촘해집니다',
}

// ───────────────────────────── Stream ribbons ─────────────────────────────

export interface RibbonParams extends ViewParams, SeedParams { seeds: number; steps: number; dtScale: number; width: number; color: 'twist' | 'speed' | 'plain' }

function RibbonChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<RibbonParams>) {
  const field = useField(table, mapping)
  const info = useMemo(() => { if (!field) return null; const g = field.u; const cm = cubeMap(g); return { cm, ext: [(g.nx - 1) * g.dx, (g.ny - 1) * g.dy, (g.nz - 1) * g.dz], vmax: maxSpeed(field), dx: Math.min(g.dx, g.dy, g.dz) } }, [field])
  const seed = useMemo(() => (field && info ? seedLine(params, info.cm, info.ext, field) : null), [field, info, params.cx, params.cy, params.cz, params.length, params.az, params.el]) // eslint-disable-line react-hooks/exhaustive-deps
  const built = useMemo(() => {
    if (!field || !info || !seed || info.vmax <= 0) return null
    const dt = (params.dtScale * 0.25 * info.dx) / info.vmax
    const n = Math.max(1, params.seeds)
    const vec = (p: V3): V3 => vecAt(field, p)
    const wData = (params.width * 0.06) / info.cm.s
    const ribbons = Array.from({ length: n }, (_, i) => {
      const t = n === 1 ? 0.5 : i / (n - 1)
      const s0: V3 = [seed.d0[0] + (seed.d1[0] - seed.d0[0]) * t, seed.d0[1] + (seed.d1[1] - seed.d0[1]) * t, seed.d0[2] + (seed.d1[2] - seed.d0[2]) * t]
      return streamRibbon(vec, s0, params.steps, dt, wData)
    })
    const rate = ribbons.flatMap((r) => r.twist.slice(1).map((th, k) => Math.abs(th - r.twist[k])))
    const rmax = Math.max(1e-9, ...rate)
    return { ribbons, rmax, maxTwist: Math.max(0, ...ribbons.map((r) => Math.abs(r.twist[r.twist.length - 1] ?? 0))) }
  }, [field, info, seed, params.seeds, params.steps, params.dtScale, params.width])
  if (!field || !info || !seed) return <ChartMessage>x, y, z 좌표와 벡터 성분 u, v, w 열을 고르세요. 규칙적인 3차원 격자여야 합니다.</ChartMessage>
  if (!built) return <ChartMessage>벡터가 모두 0이라 흐름이 없습니다.</ChartMessage>
  const { cm, vmax } = info
  const draw = (ctx: CanvasRenderingContext2D, proj: Projector) => {
    const L = lookDir(params)
    const quads: Quad[] = []
    for (const r of built.ribbons) {
      const l = r.left.map((p) => cm.norm(p)), rr = r.right.map((p) => cm.norm(p))
      for (let i = 0; i + 1 < l.length; i++) {
        const P = [proj(l[i]), proj(l[i + 1]), proj(rr[i + 1]), proj(rr[i])]
        const u: V3 = [l[i + 1][0] - l[i][0], l[i + 1][1] - l[i][1], l[i + 1][2] - l[i][2]], w: V3 = [rr[i][0] - l[i][0], rr[i][1] - l[i][1], rr[i][2] - l[i][2]]
        const nrm: V3 = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
        const nl = Math.hypot(...nrm) || 1
        const k = 0.55 + 0.45 * Math.abs((nrm[0] * L[0] + nrm[1] * L[1] + nrm[2] * L[2]) / nl) ** 0.7
        const dth = Math.abs(r.twist[i + 1] - r.twist[i])
        const sp = Math.hypot(...vecAt(field, r.axis[i]))
        const base = params.color === 'twist' ? d3.interpolateRdYlBu(1 - Math.min(1, dth / built.rmax)) : params.color === 'speed' ? schemes.viridis.interpolate(0.1 + 0.85 * Math.min(1, sp / Math.max(1e-9, vmax))) : '#4c78b5'
        quads.push({ pts: P.map((p) => [p.x, p.y] as [number, number]), depth: P.reduce((s, p) => s + p.depth, 0) / 4, fill: shade(base, k) })
      }
    }
    drawQuads(ctx, quads, 0.25)
  }
  return (
    <Scene3D width={width} height={height} compact={compact} params={params} setParams={setParams} label={`스트림 리본: 시작선 위 ${built.ribbons.length}개 유선의 리본`} draw={draw} fit={0.42} box={cm.box}
      drawKey={`${built.ribbons.length}|${built.ribbons[0]?.axis.length}|${params.color}|${params.width}|${params.steps}|${params.dtScale}|${seed.d0.join()}|${seed.d1.join()}`}
      overlay={(proj) => { const a = proj(seed.n0), b = proj(seed.n1); return <g pointerEvents="none"><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#d4452f" strokeWidth={compact ? 1.5 : 2.5} strokeLinecap="round" strokeDasharray="4 3" data-testid="seed-line" /></g> }}
      readout={[{ label: '리본', value: `${built.ribbons.length}개` }, { label: '최대 비틀림', value: `${fmt((built.maxTwist * 180) / Math.PI, 3)}°` }, { label: '최대 속도', value: fmt(vmax, 3) }]}
      note="리본의 넓이 방향이 유선을 따라 회전합니다(회전 = ½ 와도의 접선 성분)" />
  )
}

function RibbonControls({ params, setParams }: ControlsProps<RibbonParams>) {
  return (
    <>
      <SeedControls params={params} setParams={setParams} />
      <ControlGroup title="리본">
        <Slider label="리본 수(시작선 위 시드)" value={params.seeds} min={1} max={14} onChange={(seeds) => setParams({ seeds })} testId="ctl-rseeds" />
        <Slider label="리본 너비" value={params.width} min={0.3} max={4} step={0.1} onChange={(width) => setParams({ width })} format={(v) => v.toFixed(1)} testId="ctl-rwidth" />
        <Slider label="적분 단계 수" value={params.steps} min={20} max={300} step={10} onChange={(steps) => setParams({ steps })} testId="ctl-rsteps" />
        <Slider label="적분 간격 배율" value={params.dtScale} min={0.2} max={2} step={0.1} onChange={(dtScale) => setParams({ dtScale })} format={(v) => v.toFixed(1)} testId="ctl-rdt" />
        <Segmented label="색" value={params.color} onChange={(color) => setParams({ color })} testId="ctl-rcolor" options={[{ value: 'twist', label: '비틀림 속도' }, { value: 'speed', label: '속도' }, { value: 'plain', label: '단색' }]} />
        <Hint>유선(속도장을 따라 4차 룽게-쿠타로 적분한 곡선) 위에 얇은 띠를 놓고, 띠의 넓이 방향 벡터를 유선을 따라 옮기되(접선이 바뀔 때 평행 이동) 흐름의 국소 회전을 더해 접선 둘레로 돌립니다. 회전 각속도는 와도(curl)의 접선 성분의 절반 dθ/dt = ½(ω·T)로, 유체 조각이 유선 둘레로 도는 만큼 리본이 비틀립니다. 튜브가 단면이 비틀리지 않는 평행 이동 틀로 굵기만 나타내는 것과 달리 리본의 방향 자체가 회전을 읽게 합니다(색 = 구간별 비틀림 속도: 붉을수록 빠름). 와도는 유한차분으로 계산하며 리본끼리의 겹침이나 가림은 처리하지 않습니다.</Hint>
      </ControlGroup>
      <ViewControls params={params} setParams={setParams} />
    </>
  )
}

export const ribbonModule: VizModule<RibbonParams> = {
  roles: vectorRoles,
  datasets: ['vector-vortex', 'vector-abc', 'vector-dipole'],
  defaultParams: { yaw: -35, pitch: 28, zoom: 0.95, ...seedDefaults, seeds: 4, steps: 160, dtScale: 1, width: 1.2, color: 'twist' },
  Chart: RibbonChart,
  Controls: RibbonControls,
  hint: '시작선을 옮기고 돌려 보세요 · 소용돌이 근처에서 리본이 많이 비틀립니다',
}

// ───────────────────────────── Rectangular cartogram ─────────────────────────────

export interface RectParams extends GeoParams { colorBy: 'value' | 'region'; labels: boolean; tries: number; ghost: boolean }

const KEYS = ['value']

function RectCartoChart({ table, mapping, params, width, height, compact, linked }: ChartProps<RectParams>) {
  const st = useRegionStage(table, mapping, params, width, height, compact, KEYS, undefined, false)
  const { tip, show, hide, svgRef } = st
  const shapes = useMemo(() => projectedShapes(st.map, st.projection), [st.map, st.projection])
  const items = useMemo(() => st.map.regions.map((r, i) => ({ r, s: shapes[i], v: st.data.get(r.id)?.values.value ?? null })).filter((q) => q.v != null && q.v > 0 && q.s.rings.length > 0), [st.map, shapes, st.data])
  const layout = useMemo(() => {
    if (items.length < 4) return null
    const xs = items.flatMap((q) => q.s.rings.flat().map((p) => p[0])), ys = items.flatMap((q) => q.s.rings.flat().map((p) => p[1]))
    const aspect = Math.max(0.4, Math.min(2.5, (Math.max(...xs) - Math.min(...xs)) / Math.max(1e-9, Math.max(...ys) - Math.min(...ys))))
    const nb = adjacencyFromRings(items.map((q) => ({ id: q.r.id, rings: q.s.rings as [number, number][][] })), 2)
    const regs = items.map((q) => { const c = shapeCentroid(q.s); return { id: q.r.id, x: c[0], y: c[1], value: q.v! } })
    return { aspect, ...rectangularCartogram(regs, nb, aspect, params.tries, 5) }
  }, [items, params.tries])
  const linkedSet = useMemo(() => new Set(linked?.rows ?? []), [linked?.rows])
  if (!roleColumn(mapping, 'region') || !roleColumn(mapping, 'value')) return <ChartMessage>지역 ID(범주형)와 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!layout) return <ChartMessage>지도와 맞는 지역 ID에 0보다 큰 값이 4개 이상 필요합니다.</ChartMessage>
  const pad = compact ? 4 : 14
  const k = Math.min((width - 2 * pad) / layout.aspect, height - 2 * pad - (compact ? 0 : 6))
  const ox = (width - layout.aspect * k) / 2, oy = (height - k) / 2
  const byId = new Map(items.map((q, i) => [q.r.id, { ...q, i }]))
  const dens = items.map((q) => q.v! / Math.max(1, q.r.area))
  const dr = d3.extent(dens) as [number, number]
  const fill = (id: string) => { const q = byId.get(id)!; return params.colorBy === 'region' ? colorAt(q.i) : schemes.teal.interpolate(0.15 + 0.8 * ((Math.log(dens[q.i]) - Math.log(dr[0])) / Math.max(1e-9, Math.log(dr[1]) - Math.log(dr[0])))) }
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`직사각형 카토그램: 지역 ${layout.rects.length}개, 인접 관계 ${layout.adjacencyKept}/${layout.adjacencyTotal} 보존`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        {layout.rects.map((rc) => {
          const q = byId.get(rc.id)!
          const rows = st.data.get(rc.id)?.rows ?? []
          const on = rows.some((r) => linkedSet.has(r))
          const w = rc.w * k, h = rc.h * k
          return (
            <g key={rc.id} data-testid="rect-region" data-id={rc.id} data-area={(w * h).toFixed(2)} data-value={q.v}>
              <rect x={ox + rc.x * k} y={oy + rc.y * k} width={w} height={h} fill={fill(rc.id)} fillOpacity={0.92} stroke={on ? '#111827' : '#fff'} strokeWidth={on ? 2.2 : 1}
                onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); linked?.set(rows); show(lp.x, lp.y, <><b>{q.r.name}</b> <small>{q.r.id}</small><br />{roleColumn(mapping, 'value')}: {fmt(q.v)}<br />면적이 값에 정확히 비례</>) }} onPointerLeave={() => { hide(); linked?.set(null) }} />
              {params.labels && !compact && w > 34 && h > 14 && <text x={ox + rc.x * k + w / 2} y={oy + rc.y * k + h / 2} textAnchor="middle" dy="0.34em" fontSize={Math.min(11, h * 0.6)} fill="#111827" pointerEvents="none">{q.r.name.length > Math.floor(w / 7) ? q.r.name.slice(0, Math.max(1, Math.floor(w / 7) - 1)) + '…' : q.r.name}</text>}
            </g>
          )
        })}
        {params.ghost && !compact && (() => {
          const xs = items.flatMap((q) => q.s.rings.flat().map((p) => p[0])), ys = items.flatMap((q) => q.s.rings.flat().map((p) => p[1]))
          const x0 = Math.min(...xs), y0 = Math.min(...ys), sc = 70 / Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0)
          return <g pointerEvents="none" opacity={0.7}>{items.map((q) => <path key={q.r.id} d={q.s.rings.map((ring) => 'M' + ring.map((p) => `${8 + (p[0] - x0) * sc},${8 + (p[1] - y0) * sc}`).join('L') + 'Z').join('')} fill="#cfd8d8" stroke="#fff" strokeWidth={0.3} />)}</g>
        })()}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
      {!compact && <p className="chart-note" role="note" style={{ left: 'auto', right: 8, bottom: 2 }} data-testid="rect-readout">인접 관계 보존 {layout.adjacencyKept}/{layout.adjacencyTotal}쌍 ({layout.adjacencyTotal ? Math.round((100 * layout.adjacencyKept) / layout.adjacencyTotal) : 0}%) · 면적 오차 0%</p>}
    </div>
  )
}

function RectCartoControls({ params, setParams, table, mapping }: ControlsProps<RectParams>) {
  const data = useMemo(() => regionRows(table, mapping, KEYS), [table, mapping])
  const resolved = useMemo(() => resolveMap(params, [...data.keys()]), [params, data])
  return (
    <>
      <ControlGroup title="직사각형 카토그램">
        <Slider label="배치 탐색 횟수(무작위 시도)" value={params.tries} min={1} max={200} onChange={(tries) => setParams({ tries })} testId="ctl-rtries" />
        <Segmented label="색" value={params.colorBy} onChange={(colorBy) => setParams({ colorBy })} testId="ctl-rcolorby" options={[{ value: 'value', label: '원래 면적당 값' }, { value: 'region', label: '지역별 색' }]} />
        <Toggle label="지역 이름" checked={params.labels} onChange={(labels) => setParams({ labels })} testId="ctl-rlabels" />
        <Toggle label="원래 지도(작게)" checked={params.ghost} onChange={(ghost) => setParams({ ghost })} testId="ctl-rghost" />
        <Hint>모든 지역을 직사각형으로 바꾸고 직사각형의 면적을 값에 정확히 비례하게 만든 지도입니다. 지역을 중심점 순서로 둘로 나눠 값의 합이 비슷한 두 묶음으로 만들고 사각형을 그 비율로 자르는 일을 되풀이하므로(재귀 분할) 면적은 항상 정확합니다. 어느 방향으로 자를지를 무작위로 여러 번 시도해 실제 지도에서 이웃한 지역이 이웃한 사각형으로 남는 쌍이 가장 많은 배치를 고릅니다(하단 숫자). 트리맵과 달리 지도의 위치 관계를 보존하려 하지만 모든 이웃 관계를 지킬 수는 없습니다. van Kreveld·Speckmann의 방법(사각형 쌍대와 선형 계획)이 아니라 분할 기반의 단순화이며 보존 비율이 그보다 낮을 수 있습니다.</Hint>
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams as never} resolved={resolved} /></ControlGroup>
    </>
  )
}

export const rectCartoModule: VizModule<RectParams> = {
  roles: [...regionRoles],
  datasets: ['kr-regions', 'world-regions'],
  defaultParams: { ...geoDefaults, colorBy: 'value', labels: true, tries: 60, ghost: true },
  Chart: RectCartoChart,
  Controls: RectCartoControls,
  hint: '사각형의 면적이 값에 비례합니다 · 탐색 횟수를 늘리면 이웃 관계가 더 많이 보존될 수 있습니다',
}

// ───────────────────────────── Travel-time cartogram ─────────────────────────────

export interface TravelParams { origin: string; blend: number; edges: boolean; rings: boolean }

function readRoad(table: DataTable, mapping: Mapping) {
  const ix = (k: string) => columnIndex(table, roleColumn(mapping, k))
  const fi = ix('from'), fx = ix('fx'), fy = ix('fy'), ti = ix('to'), tx = ix('tx'), ty = ix('ty'), mi = ix('time')
  if ([fi, fx, fy, ti, tx, ty, mi].some((i) => i < 0)) return null
  const nodes = new Map<string, TNode>()
  const edges: TEdge[] = []
  for (const r of table.rows) {
    const a = toLabel(r[fi]), b = toLabel(r[ti]), ax = toNumber(r[fx]), ay = toNumber(r[fy]), bx = toNumber(r[tx]), by = toNumber(r[ty]), m = toNumber(r[mi])
    if (ax == null || ay == null || bx == null || by == null || m == null || m <= 0) continue
    nodes.set(a, { id: a, x: ax, y: ay }); nodes.set(b, { id: b, x: bx, y: by })
    edges.push({ a, b, minutes: m })
  }
  return nodes.size >= 3 ? { nodes: [...nodes.values()], edges } : null
}

function TravelChart({ table, mapping, params, width, height, compact }: ChartProps<TravelParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const road = useMemo(() => readRoad(table, mapping), [table, mapping])
  const origin = road && road.nodes.some((n) => n.id === params.origin) ? params.origin : road?.nodes[Math.floor((road?.nodes.length ?? 0) / 2)]?.id
  const model = useMemo(() => {
    if (!road || !origin) return null
    const times = travelTimes(road.nodes, road.edges, origin)
    return { times, now: travelCartogram(road.nodes, times, origin, params.blend), real: travelCartogram(road.nodes, times, origin, 0), full: travelCartogram(road.nodes, times, origin, 1) }
  }, [road, origin, params.blend])
  if (!road || !model || !origin) return <ChartMessage>출발·도착 지점과 좌표, 시간 열을 고르세요(지점 3개 이상).</ChartMessage>
  const all = [...model.now.pos.values(), ...model.real.pos.values(), ...model.full.pos.values()]
  const x0 = Math.min(...all.map((p) => p[0])), x1 = Math.max(...all.map((p) => p[0])), y0 = Math.min(...all.map((p) => p[1])), y1 = Math.max(...all.map((p) => p[1]))
  const pad = compact ? 6 : 28
  const k = Math.min((width - 2 * pad) / (x1 - x0), (height - 2 * pad) / (y1 - y0))
  const X = (v: number) => (width - (x1 - x0) * k) / 2 + (v - x0) * k, Y = (v: number) => height - (height - (y1 - y0) * k) / 2 - (v - y0) * k
  const tmax = Math.max(...[...model.times.values()].filter(Number.isFinite))
  const o = model.now.pos.get(origin)!
  const color = (t: number) => schemes.viridis.interpolate(0.9 - 0.8 * Math.min(1, t / tmax))
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`이동시간 카토그램: 출발 ${origin}, 변형 ${Math.round(params.blend * 100)}%`} onPointerLeave={hide}>
        {params.rings && params.blend > 0 && !compact && d3.range(10, tmax + 5, tmax > 80 ? 20 : 10).map((m) => <g key={m}><circle cx={X(o[0])} cy={Y(o[1])} r={m * model.now.scale * k} fill="none" stroke="#dbe3e3" strokeDasharray="3 3" /><text x={X(o[0]) + m * model.now.scale * k * 0.707} y={Y(o[1]) - m * model.now.scale * k * 0.707} fontSize={9} fill="#9aa6a6">{m}분</text></g>)}
        {params.edges && road.edges.map((e, i) => { const a = model.now.pos.get(e.a)!, b = model.now.pos.get(e.b)!; const fast = e.minutes / Math.max(1e-9, Math.hypot(...[road.nodes.find((n) => n.id === e.a)!, road.nodes.find((n) => n.id === e.b)!].map((n) => [n.x, n.y]).reduce((s, p, idx, arr) => (idx ? [arr[0][0] - p[0], arr[0][1] - p[1]] : s), [0, 0]) as [number, number])) < 0.8; return <line key={i} x1={X(a[0])} y1={Y(a[1])} x2={X(b[0])} y2={Y(b[1])} stroke={fast ? '#d4452f' : '#c8d1d1'} strokeWidth={fast ? 2.2 : 1} strokeOpacity={fast ? 0.7 : 0.9} /> })}
        {road.nodes.map((n) => {
          const p = model.now.pos.get(n.id)!, t = model.times.get(n.id)!
          return <g key={n.id} data-testid="travel-node" data-time={Number.isFinite(t) ? t.toFixed(1) : ''} data-id={n.id}>
            <circle cx={X(p[0])} cy={Y(p[1])} r={n.id === origin ? 8 : 5.5} fill={color(t)} stroke={n.id === origin ? '#111827' : '#fff'} strokeWidth={n.id === origin ? 2.4 : 1.2}
              onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{n.id}</b><br />{origin}에서 {Number.isFinite(t) ? `${fmt(t, 3)}분` : '도달 불가'}<br />실제 직선거리 {fmt(Math.hypot(n.x - road.nodes.find((q) => q.id === origin)!.x, n.y - road.nodes.find((q) => q.id === origin)!.y), 3)}</>) }} onPointerLeave={hide} />
          </g>
        })}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
      {!compact && <p className="chart-note" role="note" style={{ left: 8, right: 'auto', bottom: 2 }} data-testid="travel-readout">출발 {origin} · 가장 먼 지점까지 {fmt(tmax, 3)}분 · 변형 {Math.round(params.blend * 100)}%</p>}
    </div>
  )
}

function TravelControls({ params, setParams, table, mapping }: ControlsProps<TravelParams>) {
  const road = useMemo(() => readRoad(table, mapping), [table, mapping])
  return (
    <ControlGroup title="이동시간 카토그램">
      {road && <Select label="출발 지점" value={road.nodes.some((n) => n.id === params.origin) ? params.origin : road.nodes[Math.floor(road.nodes.length / 2)].id} onChange={(origin) => setParams({ origin })} options={road.nodes.map((n) => ({ value: n.id, label: n.id }))} />}
      <Slider label="실제 지도 → 이동시간 지도 (변형 정도)" value={params.blend} min={0} max={1} step={0.02} onChange={(blend) => setParams({ blend })} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-tblend" />
      <Toggle label="도로 구간(붉은색 = 고속 구간)" checked={params.edges} onChange={(edges) => setParams({ edges })} testId="ctl-tedges" />
      <Toggle label="이동시간 등고 원" checked={params.rings} onChange={(rings) => setParams({ rings })} testId="ctl-trings2" />
      <Hint>출발 지점에서 다른 지점까지의 최단 이동시간(다익스트라)을 구해 지도를 다시 그립니다. 모든 지점은 출발 지점에서 본 방위를 그대로 두고, 출발 지점으로부터의 거리만 이동시간에 비례하게 바뀝니다(방사형 거리 카토그램). 고속도로 근처 지점은 실제보다 가깝게, 외진 지점은 멀게 그려지고, 등고 원은 같은 이동시간의 선입니다. 시간에 비례하는 척도는 ‘거리 ÷ 시간’의 중앙값으로 정해 전체 크기를 실제 지도와 비슷하게 맞춥니다. 방위만 보존하므로 지점 사이의 거리·위상은 왜곡되며 서로 겹칠 수 있고, 모든 쌍의 이동시간을 맞추는 다차원 척도법 방식은 아닙니다.</Hint>
    </ControlGroup>
  )
}

export const travelModule: VizModule<TravelParams> = {
  roles: [
    { key: 'from', label: '출발 지점', type: 'category', required: true, prefer: '출발$' },
    { key: 'fx', label: '출발 x', type: 'number', required: true, prefer: '출발 x' },
    { key: 'fy', label: '출발 y', type: 'number', required: true, prefer: '출발 y' },
    { key: 'to', label: '도착 지점', type: 'category', required: true, prefer: '도착$' },
    { key: 'tx', label: '도착 x', type: 'number', required: true, prefer: '도착 x' },
    { key: 'ty', label: '도착 y', type: 'number', required: true, prefer: '도착 y' },
    { key: 'time', label: '구간 소요 시간(분)', type: 'number', required: true, prefer: '시간|time' },
  ],
  datasets: ['road-network'],
  defaultParams: { origin: '', blend: 1, edges: true, rings: true },
  Chart: TravelChart,
  Controls: TravelControls,
  hint: '변형 정도를 0에서 100%로 올려 보세요 · 고속 구간 근처 지점이 출발지 쪽으로 끌려옵니다',
}

// ───────────────────────────── Ring map ─────────────────────────────

export interface RingParams extends GeoParams { scale: 'global' | 'series'; labels: boolean }

const RKEYS: string[] = []

function RingMapChart({ table, mapping, params, width, height, compact, linked }: ChartProps<RingParams>) {
  const D = Math.min(width, height)
  const mapSide = D * 0.42
  const st = useRegionStage(table, mapping, params, mapSide, mapSide, compact, RKEYS, undefined, false)
  const { tip, show, hide, svgRef } = st
  const names = roleColumns(mapping, 'series')
  const ri = columnIndex(table, roleColumn(mapping, 'region'))
  const data = useMemo(() => {
    if (ri < 0 || names.length < 2) return null
    const cols = names.map((n) => columnIndex(table, n))
    const m = new Map<string, { values: (number | null)[]; row: number }>()
    table.rows.forEach((r, row) => { const id = toLabel(r[ri]); if (!m.has(id)) m.set(id, { values: cols.map((c) => toNumber(r[c])), row }) })
    return m
  }, [table, ri, names.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  const linkedSet = useMemo(() => new Set(linked?.rows ?? []), [linked?.rows])
  const sectors = useMemo(() => {
    if (!data) return []
    const cx = mapSide / 2, cy = mapSide / 2
    const list = st.map.regions.filter((r) => data.has(r.id)).map((r) => { const p = st.projection(r.centroid); return p ? { r, p: p as [number, number], ang: Math.atan2(p[1] - cy, p[0] - cx) } : null }).filter((q): q is NonNullable<typeof q> => !!q)
    list.sort((a, b) => a.ang - b.ang)
    return list
  }, [data, st.map, st.projection, mapSide])
  if (!data || sectors.length < 3) return <ChartMessage>지역 ID 열과 값 열(연도 등) 둘 이상을 고르세요. 지도와 맞는 지역이 3곳 이상이어야 합니다.</ChartMessage>
  const n = names.length
  const all = [...data.values()].flatMap((d) => d.values.filter((v): v is number => v != null))
  const ext = (k: number) => { const v = [...data.values()].map((d) => d.values[k]).filter((x): x is number => x != null); return [Math.min(...v), Math.max(...v)] as [number, number] }
  const gx = [Math.min(...all), Math.max(...all)]
  const colorOf = (v: number | null, k: number) => { if (v == null) return '#eef1f0'; const e = params.scale === 'series' ? ext(k) : gx; return d3.interpolateYlGnBu(0.1 + 0.85 * ((v - e[0]) / Math.max(1e-9, e[1] - e[0]))) }
  const cx = width / 2, cy = height / 2
  const mapX = cx - mapSide / 2, mapY = cy - mapSide / 2
  const rIn = mapSide * 0.74, rOut = D / 2 - (compact ? 4 : 30)
  const th = (rOut - rIn) / n
  const per = (2 * Math.PI) / sectors.length
  const arc = d3.arc()
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`링 맵: 지역 ${sectors.length}곳, 고리 ${n}겹`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${mapX},${mapY})`}>
          {st.paths.map(({ r, d }) => <path key={r.id} d={d} fill={data.has(r.id) ? '#e4ecea' : '#f5f7f7'} stroke="#fff" strokeWidth={0.7} />)}
        </g>
        {sectors.map((s, i) => {
          const a0 = -Math.PI / 2 + i * per + per * 0.04, a1 = -Math.PI / 2 + (i + 1) * per - per * 0.04, mid = (a0 + a1) / 2
          const d = data.get(s.r.id)!
          const on = linkedSet.has(d.row)
          const px = mapX + s.p[0], py = mapY + s.p[1]
          return (
            <g key={s.r.id} data-testid="ring-sector" data-id={s.r.id}
              onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); linked?.set([d.row]); show(lp.x, lp.y, <><b>{s.r.name}</b><br />{names.map((nm, k) => <span key={nm}>{nm}: {d.values[k] == null ? '—' : fmt(d.values[k]!, 4)}<br /></span>)}</>) }} onPointerLeave={() => { hide(); linked?.set(null) }}>
              <line x1={px} y1={py} x2={cx + Math.cos(mid) * rIn} y2={cy + Math.sin(mid) * rIn} stroke={on ? '#111827' : '#b8c2bf'} strokeWidth={on ? 1.6 : 0.8} />
              <circle cx={px} cy={py} r={on ? 4 : 2.4} fill={on ? '#111827' : '#6b7280'} />
              {d.values.map((v, k) => <path key={k} data-testid="ring-cell" d={arc({ innerRadius: rIn + k * th, outerRadius: rIn + (k + 1) * th - 0.6, startAngle: a0 + Math.PI / 2, endAngle: a1 + Math.PI / 2 }) ?? ''} transform={`translate(${cx},${cy})`} fill={colorOf(v, k)} stroke={on ? '#111827' : '#fff'} strokeWidth={on ? 1.2 : 0.5} />)}
              {params.labels && !compact && <text x={cx + Math.cos(mid) * (rOut + 8)} y={cy + Math.sin(mid) * (rOut + 8)} fontSize={9} fill="#374151" textAnchor={Math.cos(mid) >= 0 ? 'start' : 'end'} dy="0.3em">{s.r.name}</text>}
            </g>
          )
        })}
        {!compact && names.map((nm, k) => <text key={nm} x={cx + 4} y={cy - rIn - k * th - th / 2} fontSize={8} fill="#6b7280" dy="0.3em">{nm.replace('년', '')}</text>)}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function RingMapControls({ params, setParams, table, mapping }: ControlsProps<RingParams>) {
  const data = useMemo(() => regionRows(table, mapping, RKEYS), [table, mapping])
  const resolved = useMemo(() => resolveMap(params, [...data.keys()]), [params, data])
  return (
    <>
      <ControlGroup title="링 맵">
        <Segmented label="색 눈금" value={params.scale} onChange={(scale) => setParams({ scale })} testId="ctl-rscale" options={[{ value: 'global', label: '전체 공통' }, { value: 'series', label: '고리(연도)마다' }]} />
        <Toggle label="지역 이름" checked={params.labels} onChange={(labels) => setParams({ labels })} testId="ctl-rglabels" />
        <Hint>지도를 한가운데 두고 그 둘레에 지역마다 부채꼴 칸을 배정해, 칸 안의 동심 고리 한 겹이 연도(또는 변수) 하나를 나타내게 한 지도입니다. 지도 위 지역과 둘레의 칸은 지시선으로 이어지고, 칸은 지역 중심의 방위각 순서대로 같은 폭으로 나열됩니다. 작은 지역도 같은 크기의 칸을 갖기 때문에 지도에서 안 보이는 지역의 시간 변화도 읽을 수 있습니다. 고리는 안쪽이 첫 해이며 색이 진할수록 값이 큽니다. 작은 다중 지도(small multiples)와 달리 한 장에 모든 시점이 들어가지만 고리의 각 칸은 원호라 값 비교가 어렵고(방사형 차트와 같은 약점), 칸 폭이 지도상 면적을 반영하지 않습니다. 원 문헌의 정확한 배치 규칙은 확인하지 못해 위 방식으로 구현한 구조 보존 단순화입니다.</Hint>
      </ControlGroup>
      <ControlGroup title="지도" defaultOpen={false}><GeoControls params={params} setParams={setParams as never} resolved={resolved} /></ControlGroup>
    </>
  )
}

export const ringMapModule: VizModule<RingParams> = {
  roles: [
    { key: 'region', label: '지역 ID (예: KR-11)', type: 'category', required: true, prefer: 'ID|코드|code' },
    { key: 'series', label: '고리별 값 (연도 등, 2~8개)', type: 'number', required: true, multiple: { min: 2, max: 8 }, prefer: '년' },
  ],
  datasets: ['kr-series'],
  defaultParams: { ...geoDefaults, scale: 'global', labels: true },
  Chart: RingMapChart,
  Controls: RingMapControls,
  hint: '칸이나 지도의 점에 올려 그 지역의 연도별 값을 읽습니다 · 안쪽 고리가 첫 해',
}
