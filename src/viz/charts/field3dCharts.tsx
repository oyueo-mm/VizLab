import { useMemo } from 'react'
import { ChartMessage } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { columnIndex, toNumber, type DataTable } from '../../data/table'
import { schemes } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { divCurl, gridFromRows, marchingTetrahedra, meshArea, opacityOf, renderVolume, streamline, tensorEigen, vecAt, vecGridFromRows, type Grid3, type V3 } from '../../stats/field3d'
import { createRng } from '../../lib/random'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, RoleSpec, VizModule } from '../types'
import { ViewControls, type ViewParams } from './geo3dCharts'
import { Scene3D } from './kit3d'
import { drawQuads, type Projector, type Quad } from './scene3d'

/** 3-D fields on grids: isosurface (marching tetrahedra), volume rendering (ray marching), 3-D vector field with streamlines and tensor glyphs. */

const scalarRoles: RoleSpec[] = [
  { key: 'x', label: 'x', type: 'number', required: true, prefer: '^x|x$' },
  { key: 'y', label: 'y', type: 'number', required: true, prefer: '^y|y$' },
  { key: 'z', label: 'z', type: 'number', required: true, prefer: '^z|z$' },
  { key: 'value', label: '스칼라 값', type: 'number', required: true, prefer: '값|value|밀도' },
]
const vectorRoles: RoleSpec[] = [
  { key: 'x', label: 'x', type: 'number', required: true, prefer: '^x' }, { key: 'y', label: 'y', type: 'number', required: true, prefer: '^y' }, { key: 'z', label: 'z', type: 'number', required: true, prefer: '^z' },
  { key: 'u', label: '벡터 u (x 성분)', type: 'number', required: true, prefer: '^u' }, { key: 'v', label: '벡터 v (y 성분)', type: 'number', required: true, prefer: '^v' }, { key: 'w', label: '벡터 w (z 성분)', type: 'number', required: true, prefer: '^w' },
]

function columns(table: DataTable, mapping: Mapping, keys: string[]) {
  const idx = keys.map((k) => columnIndex(table, roleColumn(mapping, k)))
  if (idx.some((i) => i < 0)) return null
  const rows: number[][] = []
  for (const r of table.rows) { const v = idx.map((i) => toNumber(r[i])); if (v.every((a) => a != null)) rows.push(v as number[]) }
  return rows
}

function useScalarGrid(table: DataTable, mapping: Mapping): Grid3 | null {
  return useMemo(() => { const c = columns(table, mapping, ['x', 'y', 'z', 'value']); return c ? gridFromRows(c.map(([x, y, z, v]) => ({ x, y, z, v }))) : null }, [table, mapping])
}
const needGrid = <ChartMessage>x, y, z 좌표와 값 열을 고르세요. 규칙적인 3차원 격자(축마다 2점 이상, 8행 이상)여야 합니다.</ChartMessage>

/** Maps world positions of a grid into the unit cube used by the scene (uniform scale, centred). */
function cubeMap(g: Grid3) {
  const ext = [(g.nx - 1) * g.dx, (g.ny - 1) * g.dy, (g.nz - 1) * g.dz], c = [g.x0 + ext[0] / 2, g.y0 + ext[1] / 2, g.z0 + ext[2] / 2], s = 2 / Math.max(...ext)
  return { s, norm: (p: V3): V3 => [(p[0] - c[0]) * s, (p[1] - c[1]) * s, (p[2] - c[2]) * s], box: { x: [-(ext[0] * s) / 2, (ext[0] * s) / 2] as [number, number], y: [-(ext[1] * s) / 2, (ext[1] * s) / 2] as [number, number], z: [-(ext[2] * s) / 2, (ext[2] * s) / 2] as [number, number] } }
}

const lookDir = (view: ViewParams): V3 => { const y = (view.yaw * Math.PI) / 180, p = (view.pitch * Math.PI) / 180; return [Math.sin(y) * Math.cos(p), Math.cos(y) * Math.cos(p), -Math.sin(p)] }

// ─── isosurface ─────────────────────────────────────────────────────────────────────

export interface IsoParams extends ViewParams { level: number; shell: boolean; color: 'height' | 'shade' | 'normal'; wire: boolean }

function IsoChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<IsoParams>) {
  const grid = useScalarGrid(table, mapping)
  const level = grid ? grid.min + params.level * (grid.max - grid.min) : 0
  const mesh = useMemo(() => (grid ? marchingTetrahedra(grid, level) : null), [grid, level])
  const outer = useMemo(() => (grid && params.shell ? marchingTetrahedra(grid, grid.min + Math.max(0.02, params.level * 0.55) * (grid.max - grid.min)) : null), [grid, params.shell, params.level])
  const area = useMemo(() => (mesh ? meshArea(mesh) : 0), [mesh])
  if (!grid || !mesh) return needGrid
  const cm = cubeMap(grid)
  const col = schemes.viridis
  const draw = (ctx: CanvasRenderingContext2D, proj: Projector) => {
    const dir = lookDir(params)
    const paint = (m: NonNullable<typeof mesh>, alpha: number, shellColor?: string) => {
      const quads: Quad[] = []
      const P = m.verts.map((v) => proj(cm.norm(v)))
      for (const [a, b, c] of m.tris) {
        const va = m.verts[a], vb = m.verts[b], vc = m.verts[c]
        const u = [vb[0] - va[0], vb[1] - va[1], vb[2] - va[2]], w = [vc[0] - va[0], vc[1] - va[1], vc[2] - va[2]]
        let n: V3 = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
        const l = Math.hypot(...n) || 1
        n = [n[0] / l, n[1] / l, n[2] / l]
        const lit = 0.3 + 0.7 * Math.abs(n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2])
        const cz = (va[2] + vb[2] + vc[2]) / 3
        let fill: string
        if (shellColor) fill = shellColor
        else if (params.color === 'normal') fill = `rgb(${Math.round(60 + 190 * Math.abs(n[0]) * lit)},${Math.round(60 + 190 * Math.abs(n[1]) * lit)},${Math.round(60 + 190 * Math.abs(n[2]) * lit)})`
        else if (params.color === 'height') { const t = (cz - grid.z0) / Math.max(1e-9, (grid.nz - 1) * grid.dz); const cc = col.interpolate(0.12 + 0.8 * Math.min(1, Math.max(0, t))); const m2 = /rgb\((\d+), (\d+), (\d+)\)/.exec(cc); fill = m2 ? `rgb(${Math.round(+m2[1] * lit)},${Math.round(+m2[2] * lit)},${Math.round(+m2[3] * lit)})` : cc }
        else { const g = Math.round(235 * lit); fill = `rgb(${g},${Math.round(g * 0.98)},${Math.round(g * 0.95)})` }
        quads.push({ pts: [[P[a].x, P[a].y], [P[b].x, P[b].y], [P[c].x, P[c].y]], depth: (P[a].depth + P[b].depth + P[c].depth) / 3, fill, stroke: params.wire ? 'rgba(15,23,42,.55)' : alpha < 1 ? undefined : fill })
      }
      ctx.globalAlpha = alpha
      drawQuads(ctx, quads, params.wire ? 0.5 : 0.4)
      ctx.globalAlpha = 1
    }
    if (outer) paint(outer, 0.18, 'rgb(120,170,200)')
    paint(mesh, 1)
  }
  return (
    <Scene3D width={width} height={height} compact={compact} params={params} setParams={setParams} label={`등치면: 삼각형 ${mesh.tris.length}개`} draw={draw} fit={0.42} box={cm.box}
      drawKey={`${level}|${params.shell}|${params.color}|${params.wire}|${mesh.tris.length}|${outer?.tris.length ?? 0}`}
      labels={[{ at: [cm.box.x[1], cm.box.y[0], cm.box.z[0]], text: 'x', anchor: 'start' }, { at: [cm.box.x[0], cm.box.y[1], cm.box.z[0]], text: 'y', anchor: 'end' }, { at: [cm.box.x[0], cm.box.y[0], cm.box.z[1]], text: 'z', anchor: 'end' }]}
      readout={[{ label: '등치값', value: fmt(level, 4) }, { label: '삼각형', value: mesh.tris.length }, { label: '표면적', value: fmt(area, 3) }, { label: '격자', value: `${grid.nx}×${grid.ny}×${grid.nz}` }]}
      note={mesh.tris.length === 0 ? '이 등치값에서는 곡면이 없습니다 — 슬라이더를 값 범위 안으로 옮기세요' : undefined} />
  )
}

function IsoControls({ params, setParams }: ControlsProps<IsoParams>) {
  return (
    <>
      <ControlGroup title="등치면">
        <Slider label="등치값 (최소~최대 사이 비율)" value={params.level} min={0.02} max={0.98} step={0.01} onChange={(level) => setParams({ level })} testId="ctl-level" format={(v) => `${Math.round(v * 100)}%`} />
        <Toggle label="바깥 껍질(낮은 등치값)을 반투명하게 겹침" checked={params.shell} onChange={(shell) => setParams({ shell })} />
        <Segmented label="색" value={params.color} onChange={(color) => setParams({ color })} testId="ctl-color" options={[{ value: 'height', label: '높이' }, { value: 'shade', label: '음영' }, { value: 'normal', label: '법선' }]} />
        <Toggle label="격자선" checked={params.wire} onChange={(wire) => setParams({ wire })} />
        <Hint>3차원 격자의 값에서 f = 등치값인 곡면을 추출합니다. 각 격자 칸을 6개의 사면체로 나누고, 사면체 안에서 값이 등치값보다 큰 꼭짓점과 작은 꼭짓점을 잇는 모서리마다 선형 보간한 점을 찍어 삼각형 하나 또는 둘을 만듭니다(marching tetrahedra). 이웃한 삼각형은 같은 모서리 점을 공유하므로 닫힌 곡면은 닫힌 메시가 되며, 격자가 성기면 곡면이 각져 보입니다. 3차원 장을 한 값으로 자른 껍질만 보이므로 여러 값을 옮겨 가며 봐야 전체 구조를 알 수 있습니다.</Hint>
      </ControlGroup>
      <ViewControls params={params} setParams={setParams} />
    </>
  )
}

export const isoModule: VizModule<IsoParams> = {
  roles: scalarRoles, datasets: ['scalar-metaballs', 'scalar-orbital', 'scalar-gyroid'], defaultParams: { yaw: -35, pitch: 28, zoom: 0.95, level: 0.35, shell: false, color: 'height', wire: false },
  Chart: IsoChart, Controls: IsoControls, hint: '등치값 슬라이더로 덩어리가 합쳐지고 갈라지는 지점을 찾아보세요 · 끌어서 회전 · 바깥 껍질을 켜면 안쪽 구조가 비칩니다',
}

// ─── volume rendering ───────────────────────────────────────────────────────────────

export interface VolumeParams extends ViewParams { center: number; width2: number; opacity: number; palette: 'viridis' | 'magma' | 'blues' | 'teal'; mode: 'absorb' | 'mip'; detail: number }

function VolumeChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<VolumeParams>) {
  const grid = useScalarGrid(table, mapping)
  const lut = useMemo(() => Array.from({ length: 256 }, (_, i) => { const m = /(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(schemes[params.palette].interpolate(i / 255)); return m ? [+m[1], +m[2], +m[3]] as [number, number, number] : [0, 0, 0] as [number, number, number] }), [params.palette])
  if (!grid) return needGrid
  const cm = cubeMap(grid)
  const tf = { center: params.center, width: params.width2, opacity: params.opacity }
  const draw = (ctx: CanvasRenderingContext2D) => {
    const w = Math.max(24, Math.round(width * (compact ? 0.18 : params.detail))), h = Math.max(24, Math.round(height * (compact ? 0.18 : params.detail)))
    const px = renderVolume(grid, params, w, h, tf, (s) => lut[Math.max(0, Math.min(255, Math.round(s * 255)))], params.mode === 'mip', compact ? 24 : 44)
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h
    const c2 = cv.getContext('2d'); if (!c2) return
    const img = c2.createImageData(w, h); img.data.set(px); c2.putImageData(img, 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(cv, 0, 0, width, height)
  }
  const curve = Array.from({ length: 41 }, (_, i) => ({ s: i / 40, a: opacityOf(i / 40, tf) }))
  const amax = Math.max(1e-9, ...curve.map((c) => c.a))
  return (
    <Scene3D width={width} height={height} compact={compact} params={params} setParams={setParams} label={`부피 렌더링: ${grid.nx}×${grid.ny}×${grid.nz} 격자`} draw={draw} fit={0.42} box={cm.box}
      drawKey={`${params.center}|${params.width2}|${params.opacity}|${params.palette}|${params.mode}|${params.detail}|${grid.data.length}|${grid.max}`}
      readout={[{ label: '방식', value: params.mode === 'mip' ? '최대 강도 투영' : '방출·흡수 합성' }, { label: '값 범위', value: `${fmt(grid.min, 3)} ~ ${fmt(grid.max, 3)}` }]}
      overlay={compact ? undefined : () => (
        <g transform={`translate(14,${height - 70})`} pointerEvents="none">
          <rect width={120} height={52} fill="#fff" fillOpacity={0.85} stroke="#d1d5db" rx={6} />
          <path d={`M8,${44} ${curve.map((c) => `L${8 + c.s * 104},${44 - (c.a / amax) * 34}`).join(' ')} L112,44 Z`} fill="#2a8c82" fillOpacity={0.35} stroke="#2a8c82" />
          <text x={8} y={12} fontSize={10} fill="#374151">전달 함수 (값 → 불투명도)</text>
        </g>
      )}
      note="흰 배경 위에 값의 크기에 따른 색과 불투명도를 앞에서 뒤로 누적" />
  )
}

function VolumeControls({ params, setParams }: ControlsProps<VolumeParams>) {
  return (
    <>
      <ControlGroup title="전달 함수">
        <Segmented label="합성 방식" value={params.mode} onChange={(mode) => setParams({ mode })} testId="ctl-mode" options={[{ value: 'absorb', label: '방출·흡수' }, { value: 'mip', label: '최대 강도(MIP)' }]} />
        <Slider label="강조할 값 (정규화)" value={params.center} min={0} max={1} step={0.01} onChange={(center) => setParams({ center })} testId="ctl-center" format={(v) => v.toFixed(2)} />
        <Slider label="강조 폭" value={params.width2} min={0.02} max={0.6} step={0.01} onChange={(width2) => setParams({ width2 })} testId="ctl-width" format={(v) => v.toFixed(2)} />
        <Slider label="불투명도 세기" value={params.opacity} min={0.5} max={30} step={0.5} onChange={(opacity) => setParams({ opacity })} testId="ctl-opacity" />
        <Select label="색상표" value={params.palette} options={[{ value: 'viridis', label: '비리디스' }, { value: 'magma', label: '마그마' }, { value: 'blues', label: '파랑' }, { value: 'teal', label: '청록' }]} onChange={(palette) => setParams({ palette })} testId="ctl-palette" />
        <Slider label="화질 (해상도 비율)" value={params.detail} min={0.25} max={0.9} step={0.05} onChange={(detail) => setParams({ detail })} testId="ctl-detail" />
        <Hint>격자를 곡면으로 바꾸는 등치면과 달리, 부피 렌더링은 시선 방향의 모든 점을 쓰는 직접 방식입니다. 화면의 화소마다 시선을 따라 앞에서 뒤로 48점을 3선형 보간으로 표집하고, 값마다 색(색상표)과 불투명도(전달 함수의 종 모양 곡선)를 정해 α-합성합니다. 전달 함수가 어느 값을 보이게 할지를 정하므로 같은 자료도 설정에 따라 전혀 다르게 보입니다. MIP는 시선 위의 최댓값만 나타내 밝은 구조를 찾기에 좋지만 깊이감이 사라집니다. CPU로 계산하므로 해상도를 낮추면 회전이 부드럽습니다.</Hint>
      </ControlGroup>
      <ViewControls params={params} setParams={setParams} />
    </>
  )
}

export const volumeModule: VizModule<VolumeParams> = {
  roles: scalarRoles, datasets: ['scalar-orbital', 'scalar-metaballs', 'scalar-gyroid'], defaultParams: { yaw: -35, pitch: 28, zoom: 0.95, center: 0.62, width2: 0.2, opacity: 7, palette: 'magma', mode: 'absorb', detail: 0.55 },
  Chart: VolumeChart, Controls: VolumeControls, hint: '강조할 값과 폭을 옮겨 보이는 구조를 바꿔 보세요 · 끌어서 회전 (화질을 낮추면 회전이 빨라집니다)',
}

// ─── 3-D vector field ───────────────────────────────────────────────────────────────

export interface VectorParams extends ViewParams { arrow: number; stride: number; streams: number; color: 'speed' | 'plain'; arrows: boolean }

function VectorChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<VectorParams>) {
  const field = useMemo(() => { const c = columns(table, mapping, ['x', 'y', 'z', 'u', 'v', 'w']); return c ? vecGridFromRows(c.map(([x, y, z, a, b, cc]) => ({ x, y, z, a, b, c: cc }))) : null }, [table, mapping])
  const stats = useMemo(() => {
    if (!field) return null
    const g = field.u
    let vmax = 0
    const pts: { p: V3; v: V3; m: number }[] = []
    for (let k = 0; k < g.nz; k++) for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) { const p: V3 = [g.x0 + i * g.dx, g.y0 + j * g.dy, g.z0 + k * g.dz]; const v = vecAt(field, p) as V3; const m = Math.hypot(...v); vmax = Math.max(vmax, m); pts.push({ p, v, m }) }
    const mid: V3 = [g.x0 + ((g.nx - 1) * g.dx) / 2 + g.dx * 0.13, g.y0 + ((g.ny - 1) * g.dy) / 2 + g.dy * 0.07, g.z0 + ((g.nz - 1) * g.dz) / 2 + g.dz * 0.11]
    return { vmax, pts, ...divCurl(field, mid) }
  }, [field])
  const lines = useMemo(() => {
    if (!field || !stats || params.streams <= 0) return []
    const g = field.u, rng = createRng(5)
    return Array.from({ length: params.streams }, () => {
      const seed: V3 = [g.x0 + rng() * (g.nx - 1) * g.dx, g.y0 + rng() * (g.ny - 1) * g.dy, g.z0 + rng() * (g.nz - 1) * g.dz]
      const fw = streamline(field, seed, g.dx * 0.25, 160, 1), bw = streamline(field, seed, g.dx * 0.25, 160, -1)
      return [...bw.reverse(), ...fw.slice(1)]
    })
  }, [field, stats, params.streams])
  if (!field || !stats) return <ChartMessage>x, y, z 좌표와 벡터 성분 u, v, w 열을 고르세요. 규칙적인 3차원 격자여야 합니다.</ChartMessage>
  const cm = cubeMap(field.u)
  const col = schemes.viridis
  const draw = (ctx: CanvasRenderingContext2D, proj: Projector) => {
    const cell = Math.min(field.u.dx, field.u.dy, field.u.dz) * cm.s
    if (params.arrows) {
      ctx.lineWidth = 1.4; ctx.lineCap = 'round'
      const items = stats.pts.filter((_, i) => i % params.stride === 0 && stats.pts[i].m > 1e-9).map((q) => { const a = proj(cm.norm(q.p)); return { q, a } }).sort((a, b) => b.a.depth - a.a.depth)
      for (const { q, a } of items) {
        const len = params.arrow * cell * (0.45 + 0.9 * (q.m / stats.vmax))
        const tip = proj([cm.norm(q.p)[0] + (q.v[0] / q.m) * len, cm.norm(q.p)[1] + (q.v[1] / q.m) * len, cm.norm(q.p)[2] + (q.v[2] / q.m) * len])
        ctx.strokeStyle = params.color === 'speed' ? col.interpolate(0.1 + 0.85 * (q.m / stats.vmax)) : '#4b5563'
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(tip.x, tip.y)
        const ang = Math.atan2(tip.y - a.y, tip.x - a.x), hl = 6
        ctx.moveTo(tip.x, tip.y); ctx.lineTo(tip.x - hl * Math.cos(ang - 0.45), tip.y - hl * Math.sin(ang - 0.45)); ctx.moveTo(tip.x, tip.y); ctx.lineTo(tip.x - hl * Math.cos(ang + 0.45), tip.y - hl * Math.sin(ang + 0.45))
        ctx.stroke()
      }
    }
    ctx.lineWidth = 1.7
    for (const l of lines) {
      const P = l.map((p) => proj(cm.norm(p)))
      for (let i = 1; i < P.length; i++) { const m = Math.hypot(...(vecAt(field, l[i]).map((v) => (Number.isFinite(v) ? v : 0)) as V3)) / stats.vmax; ctx.strokeStyle = params.color === 'speed' ? col.interpolate(0.1 + 0.85 * Math.min(1, m)) : '#e11d48'; ctx.beginPath(); ctx.moveTo(P[i - 1].x, P[i - 1].y); ctx.lineTo(P[i].x, P[i].y); ctx.stroke() }
    }
  }
  return (
    <Scene3D width={width} height={height} compact={compact} params={params} setParams={setParams} label={`3차원 벡터장: 격자점 ${stats.pts.length}개`} draw={draw} fit={0.42} box={cm.box}
      drawKey={`${params.arrow}|${params.stride}|${params.streams}|${params.color}|${params.arrows}|${lines.length}|${stats.vmax}`}
      readout={[{ label: '최대 크기', value: fmt(stats.vmax, 3) }, { label: '발산(중앙)', value: fmt(stats.div, 3) }, { label: '회전 크기(중앙)', value: fmt(stats.curl, 3) }]}
      note="화살표 = 격자점의 벡터, 선 = 무작위 씨앗에서 양방향으로 적분한 유선" />
  )
}

function VectorControls({ params, setParams }: ControlsProps<VectorParams>) {
  return (
    <>
      <ControlGroup title="화살표와 유선">
        <Toggle label="화살표 표시" checked={params.arrows} onChange={(arrows) => setParams({ arrows })} />
        <Slider label="화살표 길이" value={params.arrow} min={0.5} max={3} step={0.1} onChange={(arrow) => setParams({ arrow })} testId="ctl-arrow" />
        <Slider label="화살표 솎기 (n개마다 하나)" value={params.stride} min={1} max={6} onChange={(stride) => setParams({ stride })} testId="ctl-stride" />
        <Slider label="유선 개수" value={params.streams} min={0} max={40} onChange={(streams) => setParams({ streams })} testId="ctl-streams" />
        <Segmented label="색" value={params.color} onChange={(color) => setParams({ color })} testId="ctl-color" options={[{ value: 'speed', label: '크기' }, { value: 'plain', label: '단색' }]} />
        <Hint>격자점마다의 벡터(u, v, w)를 화살표로 그리고, 격자 사이는 3선형 보간한 장에서 4차 룽게–쿠타로 유선을 적분합니다. 가운데 점의 발산(∇·F)과 회전 크기(|∇×F|)는 중심 차분으로 계산합니다. ABC 흐름은 발산이 0(비압축)이고 회전이 흐름과 평행한 흐름이어서 유선이 닫히지 않고 감기며, 쌍극자 장은 한 극에서 나와 다른 극으로 들어가는 장선을 보입니다. 3차원 화살표는 투영하면 길이가 짧게 보이는 방향이 있으니 돌려서 확인하세요.</Hint>
      </ControlGroup>
      <ViewControls params={params} setParams={setParams} />
    </>
  )
}

export const vector3dModule: VizModule<VectorParams> = {
  roles: vectorRoles, datasets: ['vector-abc', 'vector-dipole'], defaultParams: { yaw: -35, pitch: 30, zoom: 0.9, arrow: 0.9, stride: 2, streams: 10, color: 'speed', arrows: true },
  Chart: VectorChart, Controls: VectorControls, hint: '끌어서 회전 · 유선 수를 늘려 흐름의 구조를 보세요 · 쌍극자 데이터에서는 장선이 극을 감쌉니다',
}

// ─── tensor glyphs ──────────────────────────────────────────────────────────────────

export interface TensorParams extends ViewParams { scale: number; faMin: number; color: 'fa' | 'direction'; detail: number }
const tensorRoles: RoleSpec[] = [
  { key: 'x', label: 'x', type: 'number', required: true, prefer: '^x' }, { key: 'y', label: 'y', type: 'number', required: true, prefer: '^y' }, { key: 'z', label: 'z', type: 'number', required: true, prefer: '^z' },
  { key: 'tensor', label: '텐서 성분 6개 (xx, yy, zz, xy, xz, yz)', type: 'number', required: true, multiple: { min: 6, max: 6 } },
]

function TensorChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<TensorParams>) {
  const data = useMemo(() => {
    const names = roleColumns(mapping, 'tensor')
    const xi = columnIndex(table, roleColumn(mapping, 'x')), yi = columnIndex(table, roleColumn(mapping, 'y')), zi = columnIndex(table, roleColumn(mapping, 'z')), ti = names.map((n) => columnIndex(table, n))
    if (xi < 0 || yi < 0 || zi < 0 || ti.length < 6 || ti.some((i) => i < 0)) return null
    const out: { p: V3; e: ReturnType<typeof tensorEigen>; row: number }[] = []
    table.rows.forEach((r, row) => { const p = [xi, yi, zi].map((i) => toNumber(r[i])), t = ti.map((i) => toNumber(r[i])); if (p.every((v) => v != null) && t.every((v) => v != null)) out.push({ p: p as V3, e: tensorEigen(t as number[]), row }) })
    return out.length ? out : null
  }, [table, mapping])
  if (!data) return <ChartMessage>x, y, z 좌표와 대칭 텐서의 성분 6개 열(xx, yy, zz, xy, xz, yz)을 고르세요.</ChartMessage>
  const xs = data.map((d) => d.p[0]), ys = data.map((d) => d.p[1]), zs = data.map((d) => d.p[2])
  const ext = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs)]
  const c: V3 = [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2, (Math.max(...zs) + Math.min(...zs)) / 2]
  const s = 2 / Math.max(...ext, 1e-9)
  const lmax = Math.max(...data.map((d) => d.e.values[0]), 1e-9)
  const spacing = Math.max(1e-6, Math.min(...ext.filter((v) => v > 1e-9)) / Math.max(2, Math.round(Math.cbrt(data.length))))
  const shown = data.filter((d) => d.e.fa >= params.faMin)
  const faMean = shown.length ? shown.reduce((a, d) => a + d.e.fa, 0) / shown.length : 0
  const box = { x: [-(ext[0] * s) / 2, (ext[0] * s) / 2] as [number, number], y: [-(ext[1] * s) / 2, (ext[1] * s) / 2] as [number, number], z: [-(ext[2] * s) / 2, (ext[2] * s) / 2] as [number, number] }
  const draw = (ctx: CanvasRenderingContext2D, proj: Projector) => {
    const dir = lookDir(params)
    const nl = params.detail, nm = params.detail * 2
    const quads: Quad[] = []
    for (const d of shown) {
      const axes = d.e.values.map((v) => Math.max(0.06, Math.max(v, 0) / lmax) * params.scale * spacing * 0.5 * s)
      const base: V3 = [(d.p[0] - c[0]) * s, (d.p[1] - c[1]) * s, (d.p[2] - c[2]) * s]
      const e1 = d.e.vectors[0]
      const fill0 = params.color === 'fa' ? schemes.viridis.interpolate(0.1 + 0.85 * d.e.fa) : `rgb(${Math.round(255 * Math.abs(e1[0]))},${Math.round(255 * Math.abs(e1[1]))},${Math.round(255 * Math.abs(e1[2]))})`
      const m = /(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(fill0)
      const rgb = m ? [+m[1], +m[2], +m[3]] : [120, 120, 120]
      const vert = (i: number, j: number) => {
        const th = (Math.PI * i) / nl, ph = (2 * Math.PI * j) / nm
        const u: V3 = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)]
        const pos: V3 = [0, 0, 0], nrm: V3 = [0, 0, 0]
        for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) { pos[a] += d.e.vectors[k][a] * axes[k] * u[k]; nrm[a] += d.e.vectors[k][a] * (u[k] / axes[k]) }
        const l = Math.hypot(...nrm) || 1
        return { w: [base[0] + pos[0], base[1] + pos[1], base[2] + pos[2]] as V3, n: [nrm[0] / l, nrm[1] / l, nrm[2] / l] as V3 }
      }
      const grid = Array.from({ length: nl + 1 }, (_, i) => Array.from({ length: nm + 1 }, (_, j) => { const v = vert(i, j); return { ...v, p: proj(v.w) } }))
      for (let i = 0; i < nl; i++) for (let j = 0; j < nm; j++) {
        const a = grid[i][j], b = grid[i + 1][j], cc = grid[i + 1][j + 1], dd = grid[i][j + 1]
        const n = a.n, lit = 0.35 + 0.65 * Math.abs(n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2])
        const f = `rgb(${Math.round(rgb[0] * lit)},${Math.round(rgb[1] * lit)},${Math.round(rgb[2] * lit)})`
        quads.push({ pts: [[a.p.x, a.p.y], [b.p.x, b.p.y], [cc.p.x, cc.p.y], [dd.p.x, dd.p.y]], depth: (a.p.depth + cc.p.depth) / 2, fill: f, stroke: f })
      }
    }
    drawQuads(ctx, quads, 0.3)
  }
  return (
    <Scene3D width={width} height={height} compact={compact} params={params} setParams={setParams} label={`텐서 글리프: 텐서 ${shown.length}개`} draw={draw} fit={0.4} box={box}
      drawKey={`${params.scale}|${params.faMin}|${params.color}|${params.detail}|${shown.length}|${data.length}|${data[0].e.fa}`}
      readout={[{ label: '표시한 텐서', value: `${shown.length}/${data.length}` }, { label: '평균 FA', value: fmt(faMean, 2) }, { label: '최대 고유값', value: fmt(lmax, 2) }]}
      note={params.color === 'fa' ? '색 = 분수 이방성(FA), 글리프 = 고유값 반축의 타원체' : '색 = 주축 방향 (빨강 x, 초록 y, 파랑 z)'} />
  )
}

function TensorControls({ params, setParams }: ControlsProps<TensorParams>) {
  return (
    <>
      <ControlGroup title="글리프">
        <Slider label="크기" value={params.scale} min={0.3} max={2} step={0.05} onChange={(scale) => setParams({ scale })} testId="ctl-scale" />
        <Slider label="FA 최소 (이보다 등방성인 것은 숨김)" value={params.faMin} min={0} max={0.9} step={0.05} onChange={(faMin) => setParams({ faMin })} testId="ctl-famin" />
        <Segmented label="색" value={params.color} onChange={(color) => setParams({ color })} testId="ctl-color" options={[{ value: 'fa', label: 'FA' }, { value: 'direction', label: '주축 방향' }]} />
        <Slider label="타원체 해상도" value={params.detail} min={4} max={10} onChange={(detail) => setParams({ detail })} testId="ctl-detail" />
        <Hint>각 위치의 대칭 텐서를 자코비 방법으로 고유분해해 고유값 λ₁ ≥ λ₂ ≥ λ₃과 고유벡터를 구하고, 반축이 고유값에 비례하는 타원체를 고유벡터 방향으로 놓습니다. 길쭉한 시가형은 한 방향의 이방성이 강하다(섬유 다발), 납작한 원반형은 평면 이방성(섬유 교차), 공은 등방성입니다. 분수 이방성 FA = √(3/2)·√(Σ(λᵢ − λ̄)²)/√(Σλᵢ²)는 0(등방)에서 1(선형)까지의 이방성 지표입니다. 텐서가 대칭이 아닌 자료는 지원하지 않습니다.</Hint>
      </ControlGroup>
      <ViewControls params={params} setParams={setParams} />
    </>
  )
}

export const tensorModule: VizModule<TensorParams> = {
  roles: tensorRoles, datasets: ['tensor-dti'], defaultParams: { yaw: -30, pitch: 40, zoom: 0.85, scale: 1.1, faMin: 0, color: 'direction', detail: 6 },
  Chart: TensorChart, Controls: TensorControls, hint: '색을 주축 방향으로 하면 왼쪽(x)과 오른쪽(y) 섬유 다발이 구별됩니다 · FA 최소값을 올려 등방성 영역을 숨기세요',
}
