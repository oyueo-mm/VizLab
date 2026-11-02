import * as d3 from 'd3'
import { useMemo } from 'react'
import { ChartMessage } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { schemes } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { vecAt, vecGridFromRows, type V3, type VecGrid } from '../../stats/field3d'
import { integrateTime, streamSurface, streamtube, surfaceArea, tubeRadius, type TubeRadius } from '../../stats/viz3d8'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { columns, cubeMap, vectorRoles } from './field3dCharts'
import { ViewControls, type ViewParams } from './geo3dCharts'
import { drawQuads, type Projector, type Quad } from './scene3d'
import { Scene3D } from './kit3d'

/** The seed line is given in the normalised cube [-1, 1]³: its centre, length and direction (azimuth, elevation). */
interface SeedParams { cx: number; cy: number; cz: number; length: number; az: number; el: number }

const seedDefaults: SeedParams = { cx: -0.4, cy: 0, cz: -0.3, length: 0.9, az: 90, el: 0 }

const useField = (table: ChartProps<unknown>['table'], mapping: ChartProps<unknown>['mapping']): VecGrid | null =>
  useMemo(() => { const c = columns(table, mapping, ['x', 'y', 'z', 'u', 'v', 'w']); return c ? vecGridFromRows(c.map(([x, y, z, a, b, cc]) => ({ x, y, z, a, b, c: cc }))) : null }, [table, mapping])

/** Maximum |v| over the grid, used to choose the time step and the colour scale. */
function maxSpeed(f: VecGrid) {
  let m = 0
  const g = f.u
  for (let k = 0; k < g.nz; k++) for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) { const v = vecAt(f, [g.x0 + i * g.dx, g.y0 + j * g.dy, g.z0 + k * g.dz]); const s = Math.hypot(...v); if (Number.isFinite(s)) m = Math.max(m, s) }
  return m
}

function seedLine(p: SeedParams, cm: ReturnType<typeof cubeMap>, ext: number[], f: VecGrid) {
  const a = (p.az * Math.PI) / 180, e = (p.el * Math.PI) / 180
  const dir: V3 = [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)]
  const c: V3 = [p.cx, p.cy, p.cz]
  const n0: V3 = [c[0] - (dir[0] * p.length) / 2, c[1] - (dir[1] * p.length) / 2, c[2] - (dir[2] * p.length) / 2]
  const n1: V3 = [c[0] + (dir[0] * p.length) / 2, c[1] + (dir[1] * p.length) / 2, c[2] + (dir[2] * p.length) / 2]
  // normalised cube → data coordinates (inverse of cm.norm)
  const o = cm.norm([0, 0, 0])
  const back = (n: V3): V3 => [(n[0] - o[0]) / cm.s, (n[1] - o[1]) / cm.s, (n[2] - o[2]) / cm.s]
  void ext; void f
  return { n0, n1, d0: back(n0), d1: back(n1) }
}

const lookDir = (view: ViewParams): V3 => { const y = (view.yaw * Math.PI) / 180, p = (view.pitch * Math.PI) / 180; return [Math.sin(y) * Math.cos(p), Math.cos(y) * Math.cos(p), -Math.sin(p)] }
const shade = (col: string, k: number) => { const c = d3.rgb(col); return `rgb(${Math.round(c.r * k)},${Math.round(c.g * k)},${Math.round(c.b * k)})` }
const triNormal = (a: V3, b: V3, c: V3): V3 => {
  const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  const l = Math.hypot(...n) || 1
  return [n[0] / l, n[1] / l, n[2] / l]
}

function SeedControls<P extends SeedParams>({ params, setParams }: { params: P; setParams: (p: Partial<P>) => void }) {
  const set = (patch: Partial<SeedParams>) => setParams(patch as Partial<P>)
  return (
    <ControlGroup title="시작선 (씨앗)">
      <Slider label="중심 x" value={params.cx} min={-1} max={1} step={0.05} onChange={(cx) => set({ cx })} format={(v) => v.toFixed(2)} testId="ctl-cx" />
      <Slider label="중심 y" value={params.cy} min={-1} max={1} step={0.05} onChange={(cy) => set({ cy })} format={(v) => v.toFixed(2)} testId="ctl-cy" />
      <Slider label="중심 z" value={params.cz} min={-1} max={1} step={0.05} onChange={(cz) => set({ cz })} format={(v) => v.toFixed(2)} testId="ctl-cz" />
      <Slider label="길이" value={params.length} min={0.1} max={1.8} step={0.05} onChange={(length) => set({ length })} format={(v) => v.toFixed(2)} testId="ctl-length" />
      <Slider label="방향 (방위)" value={params.az} min={0} max={180} onChange={(az) => set({ az })} format={(v) => `${v}°`} testId="ctl-az" />
      <Slider label="방향 (고도)" value={params.el} min={-90} max={90} onChange={(el) => set({ el })} format={(v) => `${v}°`} testId="ctl-el" />
    </ControlGroup>
  )
}

const colorOf = (mode: 'speed' | 'plain', s: number, vmax: number) => (mode === 'speed' ? schemes.viridis.interpolate(0.1 + 0.85 * Math.min(1, s / Math.max(1e-9, vmax))) : '#4c78b5')

// ───────────────────────────── Stream Surface ─────────────────────────────

export interface SurfaceParams extends ViewParams, SeedParams { seeds: number; steps: number; dtScale: number; color: 'speed' | 'plain'; wire: boolean; lines: boolean }

function SurfaceChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<SurfaceParams>) {
  const field = useField(table, mapping)
  const info = useMemo(() => {
    if (!field) return null
    const g = field.u
    const cm = cubeMap(g)
    const ext = [(g.nx - 1) * g.dx, (g.ny - 1) * g.dy, (g.nz - 1) * g.dz]
    const vmax = maxSpeed(field)
    return { cm, ext, vmax, dx: Math.min(g.dx, g.dy, g.dz) }
  }, [field])
  const seed = useMemo(() => (field && info ? seedLine(params, info.cm, info.ext, field) : null), [field, info, params.cx, params.cy, params.cz, params.length, params.az, params.el]) // eslint-disable-line react-hooks/exhaustive-deps
  const surf = useMemo(() => {
    if (!field || !info || !seed || info.vmax <= 0) return null
    const dt = (params.dtScale * 0.25 * info.dx) / info.vmax
    const s = streamSurface(field, seed.d0, seed.d1, { seeds: compact ? Math.min(8, params.seeds) : params.seeds, dt, steps: compact ? 80 : params.steps, maxSpan: Math.max(...info.ext) * 0.08, maxSeeds: compact ? 16 : 80 })
    const speeds = s.mesh.verts.map((v) => Math.hypot(...(vecAt(field, v).map((a) => (Number.isFinite(a) ? a : 0)) as V3)))
    return { s, speeds, area: surfaceArea(s.mesh) * info.cm.s * info.cm.s }
  }, [field, info, seed, params.seeds, params.steps, params.dtScale, compact])
  if (!field || !info || !seed) return <ChartMessage>x, y, z 좌표와 벡터 성분 u, v, w 열을 고르세요. 규칙적인 3차원 격자여야 합니다.</ChartMessage>
  if (!surf) return <ChartMessage>벡터가 모두 0이라 흐름이 없습니다.</ChartMessage>
  const { cm, vmax } = info
  const draw = (ctx: CanvasRenderingContext2D, proj: Projector) => {
    const V = surf.s.mesh.verts.map((v) => cm.norm(v))
    const P = V.map((v) => proj(v))
    const L = lookDir(params)
    const quads: Quad[] = surf.s.mesh.tris.map(([a, b, c]) => {
      const n = triNormal(V[a], V[b], V[c])
      const k = 0.55 + 0.45 * Math.abs(n[0] * L[0] + n[1] * L[1] + n[2] * L[2])
      const sp = (surf.speeds[a] + surf.speeds[b] + surf.speeds[c]) / 3
      return { pts: [[P[a].x, P[a].y], [P[b].x, P[b].y], [P[c].x, P[c].y]], depth: (P[a].depth + P[b].depth + P[c].depth) / 3, fill: shade(colorOf(params.color, sp, vmax), k), stroke: params.wire ? 'rgba(30,40,50,0.35)' : undefined }
    })
    drawQuads(ctx, quads, 0.4)
    if (params.lines) {
      ctx.lineWidth = 1.1
      ctx.strokeStyle = 'rgba(20,30,40,0.55)'
      for (const l of surf.s.lines) {
        ctx.beginPath()
        l.forEach((p, i) => { const q = proj(cm.norm(p)); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y) })
        ctx.stroke()
      }
    }
  }
  return (
    <Scene3D width={width} height={height} compact={compact} params={params} setParams={setParams} label={`Stream Surface: 시작선에서 출발한 유선 ${surf.s.lines.length}개로 만든 곡면`} draw={draw} fit={0.42} box={cm.box}
      drawKey={`${surf.s.mesh.verts.length}|${params.color}|${params.wire}|${params.lines}|${seed.d0.join()}|${seed.d1.join()}|${params.steps}|${params.dtScale}`}
      overlay={(proj) => {
        const a = proj(seed.n0), b = proj(seed.n1)
        return <g pointerEvents="none"><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#d4452f" strokeWidth={compact ? 2 : 3.5} strokeLinecap="round" data-testid="seed-line" />{!compact && <><circle cx={a.x} cy={a.y} r={4.5} fill="#d4452f" /><circle cx={b.x} cy={b.y} r={4.5} fill="#d4452f" /></>}</g>
      }}
      readout={[{ label: '유선', value: `${surf.s.lines.length}개 (보강 ${surf.s.refined})` }, { label: '삼각형', value: surf.s.mesh.tris.length }, { label: '곡면 넓이(정규화)', value: fmt(surf.area, 3) }, { label: '최대 속도', value: fmt(vmax, 3) }]}
      note="빨간 선 = 시작선, 곡면 = 시작선에서 나온 유선들이 같은 시간 동안 지나간 자리" />
  )
}

function SurfaceControls({ params, setParams }: ControlsProps<SurfaceParams>) {
  return (
    <>
      <SeedControls params={params} setParams={setParams} />
      <ControlGroup title="적분과 곡면">
        <Slider label="시작선 위 유선 수" value={params.seeds} min={3} max={40} onChange={(seeds) => setParams({ seeds })} testId="ctl-seeds" />
        <Slider label="적분 단계 수" value={params.steps} min={20} max={300} step={10} onChange={(steps) => setParams({ steps })} testId="ctl-steps" />
        <Slider label="적분 간격 배율" value={params.dtScale} min={0.2} max={2} step={0.1} onChange={(dtScale) => setParams({ dtScale })} format={(v) => v.toFixed(1)} testId="ctl-dt" />
        <Segmented label="색" value={params.color} onChange={(color) => setParams({ color })} options={[{ value: 'speed', label: '속도' }, { value: 'plain', label: '단색' }]} testId="ctl-color" />
        <Toggle label="격자(삼각형) 표시" checked={params.wire} onChange={(wire) => setParams({ wire })} testId="ctl-wire" />
        <Toggle label="유선 표시" checked={params.lines} onChange={(lines) => setParams({ lines })} testId="ctl-lines" />
        <Hint>시작선을 정하면 선 위 여러 점에서 같은 시간 간격으로 룽게–쿠타 적분을 하고, 이웃한 유선을 삼각형 띠로 이어 곡면을 만듭니다. 이웃 유선이 너무 벌어지면 그 사이에서 유선을 더 출발시킵니다(보강). 원 논문의 전진 전선(advancing front)은 구현하지 않은 단순화입니다.</Hint>
      </ControlGroup>
      <ViewControls params={params} setParams={setParams} />
    </>
  )
}

export const streamSurfaceModule: VizModule<SurfaceParams> = {
  roles: vectorRoles,
  datasets: ['vector-vortex', 'vector-abc', 'vector-dipole'],
  defaultParams: { yaw: -35, pitch: 28, zoom: 0.95, ...seedDefaults, seeds: 14, steps: 140, dtScale: 1, color: 'speed', wire: false, lines: true },
  Chart: SurfaceChart,
  Controls: SurfaceControls,
  hint: '시작선의 위치·길이·방향을 바꾸면 곡면이 다시 만들어집니다 · 끌어서 회전',
}

// ───────────────────────────── Streamtube ─────────────────────────────

export interface TubeParams extends ViewParams, SeedParams { seeds: number; steps: number; dtScale: number; radius: number; mode: TubeRadius; sides: number; color: 'speed' | 'plain' }

function TubeChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<TubeParams>) {
  const field = useField(table, mapping)
  const info = useMemo(() => {
    if (!field) return null
    const g = field.u
    const cm = cubeMap(g)
    return { cm, ext: [(g.nx - 1) * g.dx, (g.ny - 1) * g.dy, (g.nz - 1) * g.dz], vmax: maxSpeed(field), dx: Math.min(g.dx, g.dy, g.dz) }
  }, [field])
  const seed = useMemo(() => (field && info ? seedLine(params, info.cm, info.ext, field) : null), [field, info, params.cx, params.cy, params.cz, params.length, params.az, params.el]) // eslint-disable-line react-hooks/exhaustive-deps
  const tubes = useMemo(() => {
    if (!field || !info || !seed || info.vmax <= 0) return null
    const dt = (params.dtScale * 0.25 * info.dx) / info.vmax
    const n = Math.max(1, params.seeds)
    const lines = Array.from({ length: n }, (_, i) => integrateTime(field, [seed.d0[0] + ((seed.d1[0] - seed.d0[0]) * (n === 1 ? 0.5 : i / (n - 1))), seed.d0[1] + ((seed.d1[1] - seed.d0[1]) * (n === 1 ? 0.5 : i / (n - 1))), seed.d0[2] + ((seed.d1[2] - seed.d0[2]) * (n === 1 ? 0.5 : i / (n - 1)))], dt, compact ? 80 : params.steps)).filter((l) => l.length > 2)
    const speed = lines.map((l) => l.map((p) => Math.hypot(...(vecAt(field, p).map((a) => (Number.isFinite(a) ? a : 0)) as V3))))
    const all = speed.flat()
    const mean = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 1
    const base = params.radius * 0.05
    const built = lines.map((l, i) => {
      const axis = l.map((p) => info.cm.norm(p))
      const radius = speed[i].map((s) => tubeRadius(params.mode, base, s, mean))
      return { tube: streamtube(axis, radius, compact ? 6 : params.sides), speed: speed[i] }
    })
    return { built, mean }
  }, [field, info, seed, params.seeds, params.steps, params.dtScale, params.radius, params.mode, params.sides, compact])
  if (!field || !info || !seed) return <ChartMessage>x, y, z 좌표와 벡터 성분 u, v, w 열을 고르세요. 규칙적인 3차원 격자여야 합니다.</ChartMessage>
  if (!tubes) return <ChartMessage>벡터가 모두 0이라 흐름이 없습니다.</ChartMessage>
  const { cm, vmax } = info
  const draw = (ctx: CanvasRenderingContext2D, proj: Projector) => {
    const L = lookDir(params)
    const quads: Quad[] = []
    for (const { tube, speed } of tubes.built) {
      const P = tube.rings.map((ring) => ring.map((v) => proj(v)))
      for (const q of tube.quads) {
        const [ia, ja] = q.a, [ib, jb] = q.b, [ic, jc] = q.c, [id, jd] = q.d
        const pts = [P[ia][ja], P[ib][jb], P[ic][jc], P[id][jd]]
        const nrm = tube.normals[ia][ja]
        const k = 0.5 + 0.5 * Math.abs(nrm[0] * L[0] + nrm[1] * L[1] + nrm[2] * L[2]) ** 0.7
        quads.push({ pts: pts.map((p) => [p.x, p.y] as [number, number]), depth: (pts[0].depth + pts[1].depth + pts[2].depth + pts[3].depth) / 4, fill: shade(colorOf(params.color, (speed[ia] + speed[ic]) / 2, vmax), k) })
      }
    }
    drawQuads(ctx, quads, 0.3)
  }
  return (
    <Scene3D width={width} height={height} compact={compact} params={params} setParams={setParams} label={`Streamtube: 시작선 위 ${tubes.built.length}개 유선 둘레의 튜브`} draw={draw} fit={0.42} box={cm.box}
      drawKey={`${tubes.built.length}|${tubes.built[0]?.tube.axis.length}|${params.color}|${params.mode}|${params.radius}|${params.sides}|${seed.d0.join()}|${seed.d1.join()}|${params.steps}|${params.dtScale}`}
      overlay={(proj) => { const a = proj(seed.n0), b = proj(seed.n1); return <g pointerEvents="none"><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#d4452f" strokeWidth={compact ? 1.5 : 2.5} strokeLinecap="round" strokeDasharray="4 3" data-testid="seed-line" /></g> }}
      readout={[{ label: '튜브', value: `${tubes.built.length}개` }, { label: '평균 속도', value: fmt(tubes.mean, 3) }, { label: '최대 속도', value: fmt(vmax, 3) }]}
      note="붉은 점선 = 시드 위치, 튜브 반지름은 속도·유량 보존 규칙으로 달라집니다" />
  )
}

function TubeControls({ params, setParams }: ControlsProps<TubeParams>) {
  return (
    <>
      <SeedControls params={params} setParams={setParams} />
      <ControlGroup title="튜브">
        <Slider label="튜브 수 (시작선 위 시드)" value={params.seeds} min={1} max={16} onChange={(seeds) => setParams({ seeds })} testId="ctl-seeds" />
        <Slider label="기본 반지름" value={params.radius} min={0.3} max={3} step={0.1} onChange={(radius) => setParams({ radius })} format={(v) => v.toFixed(1)} testId="ctl-radius" />
        <Segmented label="반지름 규칙" value={params.mode} onChange={(mode) => setParams({ mode })} options={[{ value: 'fixed', label: '일정' }, { value: 'speed', label: '속도 비례' }, { value: 'conservation', label: '유량 보존' }]} testId="ctl-mode" />
        <Slider label="둘레 분할 수" value={params.sides} min={4} max={20} onChange={(sides) => setParams({ sides })} testId="ctl-sides" />
        <Slider label="적분 단계 수" value={params.steps} min={20} max={300} step={10} onChange={(steps) => setParams({ steps })} testId="ctl-steps" />
        <Slider label="적분 간격 배율" value={params.dtScale} min={0.2} max={2} step={0.1} onChange={(dtScale) => setParams({ dtScale })} format={(v) => v.toFixed(1)} testId="ctl-dt" />
        <Segmented label="색" value={params.color} onChange={(color) => setParams({ color })} options={[{ value: 'speed', label: '속도' }, { value: 'plain', label: '단색' }]} testId="ctl-color" />
        <Hint>각 시드에서 유선을 적분하고 그 둘레에 비틀리지 않는 원형 단면(평행 이동 프레임)을 이어 튜브를 만듭니다. ‘유량 보존’은 속도×단면적이 일정하도록 속도가 빠르면 가늘어지게 하고, ‘속도 비례’는 빠를수록 굵게 합니다. 곡면이 아니라 부피가 있는 관이라 개별 유선을 구분해 읽습니다.</Hint>
      </ControlGroup>
      <ViewControls params={params} setParams={setParams} />
    </>
  )
}

export const streamtubeModule: VizModule<TubeParams> = {
  roles: vectorRoles,
  datasets: ['vector-vortex', 'vector-abc', 'vector-dipole'],
  defaultParams: { yaw: -35, pitch: 28, zoom: 0.95, ...seedDefaults, seeds: 5, steps: 140, dtScale: 1, radius: 0.5, mode: 'conservation', sides: 12, color: 'speed' },
  Chart: TubeChart,
  Controls: TubeControls,
  hint: '반지름 규칙을 바꿔 유량 보존 튜브와 비교 · 시드 위치를 옮겨 보세요',
}
