import * as d3 from 'd3'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Legend, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, NumberField, Segmented, Select, Slider, StatTable, Toggle } from '../../components/controls'
import { appendRow, columnIndex, toLabel, toNumber, updateRow, type DataTable } from '../../data/table'
import { categoryColor, schemes, type ColorScheme } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { attractor, classifyLinear, lyapunov, maps1d, periodOf, phaseSystems, trajectory, type MapId, type SystemId } from '../../stats/dynamics'
import { cwt, recurrencePlot, stft, type WindowKind } from '../../stats/signal'
import { gridIsolines, makeGrid } from '../../stats/spatial'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'
import { canvasFor, Frame3D, ViewControls, viewOf, type ViewParams } from './geo3dCharts'
import { drawQuads, makeProjector, useOrbit, type Quad, type V3 } from './scene3d'
import { paddedDomain } from './shared'

/** Science and mathematics: 3D surface & scatter, phase portraits, bifurcation, spectrogram, scalogram and recurrence plots. */

const seq = (Object.keys(schemes) as ColorScheme[]).filter((k) => !schemes[k].diverging).map((k) => ({ value: k, label: schemes[k].name }))

/** Draws a matrix as an image (one pixel block per cell) into a canvas laid out over the plot area. */
function MatrixCanvas({ rows, cols, color, width, height, left, top, smooth = false }: { rows: number; cols: number; color: (r: number, c: number) => number; width: number; height: number; left: number; top: number; smooth?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv || width < 2 || height < 2 || !rows || !cols) return
    cv.width = Math.round(width); cv.height = Math.round(height)
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const off = document.createElement('canvas'); off.width = cols; off.height = rows
    const octx = off.getContext('2d')
    if (!octx) return
    const img = octx.createImageData(cols, rows)
    const buf = new Uint32Array(img.data.buffer)
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) buf[r * cols + c] = color(r, c)
    octx.putImageData(img, 0, 0)
    ctx.imageSmoothingEnabled = smooth
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.drawImage(off, 0, 0, cv.width, cv.height)
  }, [rows, cols, color, width, height, smooth])
  return <canvas ref={ref} className="matrix-canvas" data-testid="matrix-canvas" aria-hidden="true" style={{ left, top, width, height }} />
}

const packC = (css: string) => { const c = d3.rgb(css); return ((255 << 24) | (Math.round(c.b) << 16) | (Math.round(c.g) << 8) | Math.round(c.r)) >>> 0 }
const rampPack = (interp: (t: number) => string) => Array.from({ length: 256 }, (_, i) => packC(interp(i / 255)))

// ─── 3D surface ─────────────────────────────────────────────────────────────────────

export interface Surface3dParams extends ViewParams { mode: 'surface' | 'wire' | 'both'; scheme: ColorScheme; zScale: number; refine: number; contours: boolean }

function readXyz(table: DataTable, mapping: Mapping) {
  const xi = columnIndex(table, roleColumn(mapping, 'x')), yi = columnIndex(table, roleColumn(mapping, 'y')), zi = columnIndex(table, roleColumn(mapping, 'z'))
  if (xi < 0 || yi < 0 || zi < 0) return null
  const key = (v: number) => Math.round(v * 1e5)
  const cells: { x: number; y: number; z: number; row: number }[] = []
  table.rows.forEach((r, row) => { const x = toNumber(r[xi]), y = toNumber(r[yi]), z = toNumber(r[zi]); if (x != null && y != null && z != null) cells.push({ x, y, z, row }) })
  const xs = [...new Set(cells.map((c) => key(c.x)))].sort((a, b) => a - b), ys = [...new Set(cells.map((c) => key(c.y)))].sort((a, b) => a - b)
  if (xs.length < 2 || ys.length < 2 || xs.length * ys.length > 90000) return null
  const Z = Array.from({ length: ys.length }, () => new Array<number>(xs.length).fill(NaN))
  const xIndex = new Map(xs.map((v, i) => [v, i])), yIndex = new Map(ys.map((v, i) => [v, i]))
  for (const c of cells) Z[yIndex.get(key(c.y))!][xIndex.get(key(c.x))!] = c.z
  const complete = Z.every((r) => r.every(Number.isFinite))
  return { xs: xs.map((v) => v / 1e5), ys: ys.map((v) => v / 1e5), Z, complete, count: cells.length }
}

function Surface3dChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<Surface3dParams>) {
  const g = useMemo(() => readXyz(table, mapping), [table, mapping])
  const cvRef = useRef<HTMLCanvasElement>(null), boxRef = useRef<HTMLDivElement>(null)
  useOrbit(boxRef, viewOf(params), (v) => setParams(v), !compact)
  const view = viewOf(params)
  const proj = useMemo(() => makeProjector(view, width, height, 0.4), [view.yaw, view.pitch, view.zoom, width, height]) // eslint-disable-line react-hooks/exhaustive-deps
  const scheme = schemes[params.scheme]
  // optional refinement: bilinear upsampling of the mesh so a coarse grid still looks smooth
  const mesh = useMemo(() => {
    if (!g || !g.complete) return null
    const f = compact ? 1 : params.refine
    const nx = (g.xs.length - 1) * f + 1, ny = (g.ys.length - 1) * f + 1
    const xs = Array.from({ length: nx }, (_, i) => g.xs[0] + ((g.xs[g.xs.length - 1] - g.xs[0]) * i) / (nx - 1))
    const ys = Array.from({ length: ny }, (_, j) => g.ys[0] + ((g.ys[g.ys.length - 1] - g.ys[0]) * j) / (ny - 1))
    const Z = ys.map((_, j) => xs.map((_, i) => {
      const fx = i / f, fy = j / f, i0 = Math.min(g.xs.length - 2, Math.floor(fx)), j0 = Math.min(g.ys.length - 2, Math.floor(fy)), tx = fx - i0, ty = fy - j0
      return (g.Z[j0][i0] * (1 - tx) + g.Z[j0][i0 + 1] * tx) * (1 - ty) + (g.Z[j0 + 1][i0] * (1 - tx) + g.Z[j0 + 1][i0 + 1] * tx) * ty
    }))
    const [zlo, zhi] = d3.extent(Z.flat()) as [number, number]
    return { xs, ys, Z, zlo, zhi }
  }, [g, params.refine, compact])
  const dims = useMemo(() => {
    if (!g) return null
    const [zlo, zhi] = d3.extent(g.Z.flat().filter(Number.isFinite)) as [number, number]
    const sx = g.xs[g.xs.length - 1] - g.xs[0], sy = g.ys[g.ys.length - 1] - g.ys[0], s = Math.max(sx, sy)
    return { hw: sx / s, hh: sy / s, zlo, zhi, zr: (zhi - zlo) || 1 }
  }, [g])
  useEffect(() => {
    const ctx = canvasFor(cvRef, width, height)
    if (!ctx || !mesh || !dims) return
    const P = (i: number, j: number): V3 => [-dims.hw + (2 * dims.hw * i) / (mesh.xs.length - 1), -dims.hh + (2 * dims.hh * j) / (mesh.ys.length - 1), ((mesh.Z[j][i] - dims.zlo) / dims.zr) * params.zScale]
    const quads: Quad[] = []
    for (let j = 0; j + 1 < mesh.ys.length; j++) for (let i = 0; i + 1 < mesh.xs.length; i++) {
      const a = proj(P(i, j)), b = proj(P(i + 1, j)), c = proj(P(i + 1, j + 1)), d = proj(P(i, j + 1))
      const zm = (mesh.Z[j][i] + mesh.Z[j][i + 1] + mesh.Z[j + 1][i + 1] + mesh.Z[j + 1][i]) / 4
      // flat shading from the slope of the cell against a light from the upper left
      const dzx = (mesh.Z[j][i + 1] + mesh.Z[j + 1][i + 1] - mesh.Z[j][i] - mesh.Z[j + 1][i]) / 2, dzy = (mesh.Z[j + 1][i] + mesh.Z[j + 1][i + 1] - mesh.Z[j][i] - mesh.Z[j][i + 1]) / 2
      const shade = Math.max(0.35, Math.min(1.1, 0.8 - 0.35 * (dzx - dzy) / (dims.zr / 4 || 1)))
      const base = d3.rgb(scheme.interpolate(0.08 + 0.88 * ((zm - dims.zlo) / dims.zr)))
      const fill = params.mode === 'wire' ? '#ffffff' : `rgb(${Math.min(255, Math.round(base.r * shade))},${Math.min(255, Math.round(base.g * shade))},${Math.min(255, Math.round(base.b * shade))})`
      quads.push({ pts: [[a.x, a.y], [b.x, b.y], [c.x, c.y], [d.x, d.y]], depth: (a.depth + b.depth + c.depth + d.depth) / 4, fill, stroke: params.mode === 'surface' ? fill : 'rgba(31,41,55,.45)' })
    }
    drawQuads(ctx, quads, params.mode === 'surface' ? 0.6 : 0.6)
  }, [mesh, dims, proj, params.mode, params.zScale, scheme, width, height])
  if (!roleColumn(mapping, 'x') || !roleColumn(mapping, 'y') || !roleColumn(mapping, 'z')) return <ChartMessage>x, y, z(숫자형) 열을 선택하세요.</ChartMessage>
  if (!g || !dims) return <ChartMessage>x와 y가 서로 다른 값 2개 이상으로 이루어진 규칙적인 격자여야 합니다.<small>한 행이 (x, y)의 격자점 하나입니다.</small></ChartMessage>
  if (!g.complete) return <ChartMessage>격자의 일부 (x, y) 조합에 z 값이 없습니다.<small>모든 격자점에 값이 있어야 표면을 그릴 수 있습니다. 비어 있는 칸을 채우세요.</small></ChartMessage>
  const box = { x: [-dims.hw, dims.hw] as [number, number], y: [-dims.hh, dims.hh] as [number, number], z: [0, params.zScale] as [number, number] }
  return (
    <div className="chart-root">
      <div ref={boxRef} className="orbit-box" tabIndex={compact ? -1 : 0} style={{ width, height }} aria-label="3차원 표면: 끌어서 회전, 휠로 확대">
        <canvas ref={cvRef} className="canvas3d" data-testid="canvas3d" style={{ width, height }} aria-hidden="true" />
        <svg width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`3차원 표면 그래프: ${g.xs.length}×${g.ys.length} 격자, z 범위 ${fmt(dims.zlo)}~${fmt(dims.zhi)}`} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          <Frame3D proj={proj} box={box} labels={compact ? [] : [{ at: [-dims.hw, -dims.hh, 0], text: `x=${fmt(g.xs[0])}`, anchor: 'end' }, { at: [dims.hw, -dims.hh, 0], text: `x=${fmt(g.xs[g.xs.length - 1])}`, anchor: 'start' }, { at: [dims.hw, dims.hh, 0], text: `y=${fmt(g.ys[g.ys.length - 1])}`, anchor: 'start' }, { at: [dims.hw, -dims.hh, params.zScale], text: `z=${fmt(dims.zhi)}`, anchor: 'start' }, { at: [dims.hw, -dims.hh, 0], text: `z=${fmt(dims.zlo)}`, anchor: 'start' }]} />
        </svg>
      </div>
      {!compact && <Readout items={[{ label: '격자', value: `${g.xs.length}×${g.ys.length}` }, { label: 'z 범위', value: `${fmt(dims.zlo)} ~ ${fmt(dims.zhi)}` }, { label: '메시', value: mesh ? `${mesh.xs.length}×${mesh.ys.length}` : '–' }]} />}
    </div>
  )
}

function Surface3dControls({ params, setParams }: ControlsProps<Surface3dParams>) {
  return (
    <>
      <ViewControls params={params} setParams={setParams} />
      <ControlGroup title="표면">
        <Segmented label="그리기" value={params.mode} onChange={(mode) => setParams({ mode })} testId="ctl-surf-mode" options={[{ value: 'surface', label: '면' }, { value: 'both', label: '면+격자선' }, { value: 'wire', label: '격자선' }]} />
        <Select label="팔레트 (높이 z)" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={seq} />
        <Slider label="높이 배율" value={params.zScale} min={0.3} max={2} step={0.05} onChange={(zScale) => setParams({ zScale })} testId="ctl-surf-z" />
        <Slider label="메시 세분 (쌍선형)" value={params.refine} min={1} max={4} onChange={(refine) => setParams({ refine })} format={(v) => `${v}배`} testId="ctl-surf-refine" />
        <Hint>한 행이 (x, y, z) 격자점 하나입니다. 표의 z 값을 고치면 표면이 바뀌고, 칸 수는 데이터 탭의 ‘한 변의 칸 수’로 조절합니다. 각 칸의 네 모서리를 평면 조각으로 이어 먼 조각부터 그리며, 색은 높이, 밝기는 칸의 기울기에서 옵니다. 격자가 성긴데 메시를 세분하면 보기에만 매끄러울 뿐 새로운 정보가 생기지 않습니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const surface3dModule: VizModule<Surface3dParams> = {
  roles: [{ key: 'x', label: 'x (격자)', type: 'number', required: true, prefer: '^x$|x' }, { key: 'y', label: 'y (격자)', type: 'number', required: true, prefer: '^y$|y' }, { key: 'z', label: 'z (높이)', type: 'number', required: true, prefer: '^z$|z|높이' }],
  datasets: ['surface-grid'],
  defaultParams: { yaw: -35, pitch: 36, zoom: 1.1, mode: 'both', scheme: 'viridis', zScale: 1, refine: 2, contours: false },
  Chart: Surface3dChart,
  Controls: Surface3dControls,
  hint: '끌어서 회전 · 휠로 확대 · 표의 z 값을 고치면 표면이 바뀝니다 · 면과 격자선을 바꿔 보세요',
}

// ─── 3D scatter ─────────────────────────────────────────────────────────────────────

export interface Scatter3dParams extends ViewParams { size: number; opacity: number; drops: boolean; selected: number }

function Scatter3dChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<Scatter3dParams>) {
  const xi = columnIndex(table, roleColumn(mapping, 'x')), yi = columnIndex(table, roleColumn(mapping, 'y')), zi = columnIndex(table, roleColumn(mapping, 'z')), ci = columnIndex(table, roleColumn(mapping, 'color'))
  const pts = useMemo(() => {
    const out: { row: number; x: number; y: number; z: number; g: string }[] = []
    if (xi < 0 || yi < 0 || zi < 0) return out
    table.rows.forEach((r, row) => { const x = toNumber(r[xi]), y = toNumber(r[yi]), z = toNumber(r[zi]); if (x != null && y != null && z != null) out.push({ row, x, y, z, g: ci >= 0 ? toLabel(r[ci]) : '' }) })
    return out
  }, [table, xi, yi, zi, ci])
  const boxRef = useRef<HTMLDivElement>(null)
  const { tip, show, hide } = useTooltip()
  useOrbit(boxRef, viewOf(params), (v) => setParams(v), !compact)
  const view = viewOf(params)
  const proj = useMemo(() => makeProjector(view, width, height, 0.38), [view.yaw, view.pitch, view.zoom, width, height]) // eslint-disable-line react-hooks/exhaustive-deps
  const dom = useMemo(() => [pts.map((p) => p.x), pts.map((p) => p.y), pts.map((p) => p.z)].map((a) => paddedDomain(a, 0.04)) as [number, number][], [pts])
  const norm = (p: { x: number; y: number; z: number }): V3 => [((p.x - dom[0][0]) / (dom[0][1] - dom[0][0])) * 2 - 1, ((p.y - dom[1][0]) / (dom[1][1] - dom[1][0])) * 2 - 1, ((p.z - dom[2][0]) / (dom[2][1] - dom[2][0])) * 2 - 1]
  const groups = useMemo(() => [...new Set(pts.map((p) => p.g))].filter(Boolean), [pts])
  const color = categoryColor(groups)
  const marked = new Set(linked?.rows ?? [])
  if (!roleColumn(mapping, 'x') || !roleColumn(mapping, 'y') || !roleColumn(mapping, 'z')) return <ChartMessage>x, y, z(숫자형) 열을 선택하세요.</ChartMessage>
  if (!pts.length) return <ChartMessage>숫자로 읽을 수 있는 (x, y, z) 행이 없습니다.</ChartMessage>
  const drawn = pts.map((p) => ({ p, q: proj(norm(p)), floor: proj([...norm(p).slice(0, 2), -1] as V3) })).sort((a, b) => b.q.depth - a.q.depth)
  const box = { x: [-1, 1] as [number, number], y: [-1, 1] as [number, number], z: [-1, 1] as [number, number] }
  const names = [roleColumn(mapping, 'x') ?? 'x', roleColumn(mapping, 'y') ?? 'y', roleColumn(mapping, 'z') ?? 'z']
  return (
    <div className="chart-root">
      <div ref={boxRef} className="orbit-box" tabIndex={compact ? -1 : 0} style={{ width, height }} aria-label="3차원 산점도: 끌어서 회전, 휠로 확대">
        <svg width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`3차원 산점도: 점 ${pts.length}개`} onPointerLeave={() => { hide(); linked?.set(null) }} style={{ overflow: 'hidden' }}>
          <Frame3D proj={proj} box={box} labels={compact ? [] : [{ at: [1, -1, -1], text: `${names[0]} ${fmt(dom[0][1])}`, anchor: 'start' }, { at: [-1, -1, -1], text: `${fmt(dom[0][0])}`, anchor: 'end' }, { at: [-1, 1, -1], text: `${names[1]} ${fmt(dom[1][1])}`, anchor: 'end' }, { at: [-1, -1, 1], text: `${names[2]} ${fmt(dom[2][1])}`, anchor: 'end' }, { at: [-1, -1, -1], text: `${fmt(dom[2][0])}`, anchor: 'end' }]} />
          {params.drops && !compact && drawn.slice(0, 500).map(({ p, q, floor }) => <line key={`d${p.row}`} x1={q.x} y1={q.y} x2={floor.x} y2={floor.y} stroke="#cfd6d3" strokeWidth={0.6} pointerEvents="none" />)}
          {drawn.map(({ p, q }) => {
            const on = params.selected === p.row || marked.has(p.row)
            return <circle key={p.row} className="mark-point" data-testid="point3d" data-row={p.row} cx={q.x} cy={q.y} r={compact ? 2 : on ? params.size + 2 : params.size} fill={p.g ? color(p.g) : '#2a7d74'} fillOpacity={params.opacity} stroke={on ? '#121816' : '#fff'} strokeWidth={on ? 2 : 0.6}
              onPointerEnter={compact ? undefined : (e) => { linked?.set([p.row]); const l = localPoint(boxRef.current!, e); show(l.x, l.y, <><b>행 {p.row + 1}</b>{p.g ? ` · ${p.g}` : ''}<br />{names[0]} {fmt(p.x)}<br />{names[1]} {fmt(p.y)}<br />{names[2]} {fmt(p.z)}</>) }} onPointerLeave={() => { hide(); linked?.set(null) }}
              onClick={compact ? undefined : () => setParams({ selected: params.selected === p.row ? -1 : p.row })} />
          })}
        </svg>
      </div>
      {!compact && (<>
        {groups.length > 0 && <Legend items={groups.map((g) => ({ key: g, color: color(g) }))} />}
        <Readout items={[{ label: '점', value: pts.length }, { label: '시점', value: `${params.yaw}° / ${params.pitch}°` }]} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

function Scatter3dControls({ params, setParams }: ControlsProps<Scatter3dParams>) {
  return (
    <>
      <ViewControls params={params} setParams={setParams} />
      <ControlGroup title="점">
        <Slider label="점 크기" value={params.size} min={2} max={10} step={0.5} onChange={(size) => setParams({ size })} testId="ctl-s3-size" />
        <Slider label="불투명도" value={params.opacity} min={0.2} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} />
        <Toggle label="바닥으로 내린 선 (위치 파악)" checked={params.drops} onChange={(drops) => setParams({ drops })} testId="ctl-s3-drops" />
        <Hint>세 변수를 입체 좌표로 놓으면 군집이 보이기도 하지만, 평면 투영에서는 앞뒤 점이 겹쳐 위치를 정확히 읽기 어렵습니다. 돌려 보며 확인하고, 바닥으로 내린 선이 점의 x·y 위치를 알려 줍니다. 점은 정사영으로 그려 원근에 따른 크기 차이가 없습니다. 정확한 비교에는 페어 플롯을 함께 쓰세요. 점을 누르면 선택됩니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const scatter3dModule: VizModule<Scatter3dParams> = {
  roles: [{ key: 'x', label: 'x', type: 'number', required: true }, { key: 'y', label: 'y', type: 'number', required: true }, { key: 'z', label: 'z', type: 'number', required: true }, { key: 'color', label: '색 (범주, 선택)', type: 'category', auto: true }],
  datasets: ['flowers', 'cars'],
  defaultParams: { yaw: -35, pitch: 28, zoom: 1.1, size: 4.5, opacity: 0.8, drops: false, selected: -1 },
  Chart: Scatter3dChart,
  Controls: Scatter3dControls,
  hint: '끌어서 회전 · 휠로 확대 · 점을 눌러 선택 · 바닥으로 내린 선을 켜면 점의 평면 위치가 보입니다',
}

// ─── phase portrait ─────────────────────────────────────────────────────────────────

export interface PhaseParams { system: SystemId; values: Record<string, number>; field: boolean; nullclines: boolean; equilibria: boolean; backward: boolean; steps: number; dt: number; selected: number }

const defaultValues = (id: SystemId) => Object.fromEntries(phaseSystems.find((s) => s.id === id)!.params.map((p) => [p.key, p.value]))

function equilibria(f: (x: number, y: number) => [number, number], win: { x: [number, number]; y: [number, number] }) {
  const out: { x: number; y: number; tr: number; det: number }[] = []
  const h = 1e-5
  for (let i = 0; i < 9; i++) for (let j = 0; j < 7; j++) {
    let x = win.x[0] + ((win.x[1] - win.x[0]) * (i + 0.5)) / 9, y = win.y[0] + ((win.y[1] - win.y[0]) * (j + 0.5)) / 7
    for (let it = 0; it < 40; it++) {
      const [fx, fy] = f(x, y)
      const a = (f(x + h, y)[0] - fx) / h, b = (f(x, y + h)[0] - fx) / h, c = (f(x + h, y)[1] - fy) / h, d = (f(x, y + h)[1] - fy) / h
      const det = a * d - b * c
      if (Math.abs(det) < 1e-12) break
      const dx = (d * fx - b * fy) / det, dy = (-c * fx + a * fy) / det
      x -= dx; y -= dy
      if (Math.hypot(dx, dy) < 1e-10) break
    }
    const [fx, fy] = f(x, y)
    if (Math.hypot(fx, fy) > 1e-6 || x < win.x[0] || x > win.x[1] || y < win.y[0] || y > win.y[1]) continue
    if (out.some((e) => Math.hypot(e.x - x, e.y - y) < 1e-3)) continue
    const a = (f(x + h, y)[0] - fx) / h, b = (f(x, y + h)[0] - fx) / h, c = (f(x + h, y)[1] - fy) / h, d = (f(x, y + h)[1] - fy) / h
    out.push({ x, y, tr: a + d, det: a * d - b * c })
  }
  return out
}

function PhaseChart({ table, mapping, params, setParams, width, height, compact, onTableChange }: ChartProps<PhaseParams>) {
  const sys = phaseSystems.find((s) => s.id === params.system) ?? phaseSystems[0]
  const vals = useMemo(() => ({ ...defaultValues(sys.id), ...params.values }), [sys.id, params.values])
  const f = useMemo(() => sys.field(vals), [sys, vals])
  const xi = columnIndex(table, roleColumn(mapping, 'x0')), yi = columnIndex(table, roleColumn(mapping, 'y0')), ni = columnIndex(table, roleColumn(mapping, 'name'))
  const seeds = useMemo(() => table.rows.flatMap((r, row) => { const x = xi >= 0 ? toNumber(r[xi]) : null, y = yi >= 0 ? toNumber(r[yi]) : null; return x != null && y != null ? [{ row, x, y, name: ni >= 0 ? toLabel(r[ni]) : String(row + 1) }] : [] }), [table, xi, yi, ni])
  const m = margins(compact)
  const iw = Math.max(40, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const x = d3.scaleLinear().domain(sys.window.x).range([0, iw]), y = d3.scaleLinear().domain(sys.window.y).range([ih, 0])
  const paths = useMemo(() => seeds.map((s) => ({ s, fwd: trajectory(f, [s.x, s.y], params.dt, params.steps, sys.window), back: params.backward ? trajectory((a, b) => { const v = f(a, b); return [-v[0], -v[1]] }, [s.x, s.y], params.dt, params.steps, sys.window) : [] })), [seeds, f, params.dt, params.steps, params.backward, sys.window])
  const arrows = useMemo(() => {
    if (!params.field) return []
    const out: { x: number; y: number; dx: number; dy: number; sp: number }[] = []
    const nx = compact ? 12 : 22, ny = compact ? 8 : 14
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const px = sys.window.x[0] + ((sys.window.x[1] - sys.window.x[0]) * (i + 0.5)) / nx, py = sys.window.y[0] + ((sys.window.y[1] - sys.window.y[0]) * (j + 0.5)) / ny
      const [u, v] = f(px, py)
      // direction in pixel space (y is flipped)
      const sx = u / (sys.window.x[1] - sys.window.x[0]), sy = v / (sys.window.y[1] - sys.window.y[0])
      const l = Math.hypot(sx, sy)
      if (l > 1e-9) out.push({ x: x(px), y: y(py), dx: (sx / l) * (iw / nx) * 0.42, dy: -(sy / l) * (ih / ny) * 0.42, sp: Math.hypot(u, v) })
    }
    return out
  }, [params.field, f, sys.window, iw, ih, compact]) // eslint-disable-line react-hooks/exhaustive-deps
  const spMax = d3.max(arrows, (a) => a.sp) ?? 1
  const nulls = useMemo(() => {
    if (!params.nullclines) return null
    const box = { west: sys.window.x[0], east: sys.window.x[1], south: sys.window.y[0], north: sys.window.y[1] }
    const mk = (k: 0 | 1) => gridIsolines(makeGrid(box, 90, 70, (a, b) => f(a, b)[k]), [0])[0]?.lines ?? []
    return { fx: mk(0), fy: mk(1) }
  }, [params.nullclines, f, sys.window])
  const eq = useMemo(() => (params.equilibria ? equilibria(f, sys.window) : []), [params.equilibria, f, sys.window])
  const down = useRef<{ x: number; y: number } | null>(null)
  const drag = useRef<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const { tip, show, hide } = useTooltip()
  if (!roleColumn(mapping, 'x0') || !roleColumn(mapping, 'y0')) return <ChartMessage>초기 조건의 x₀, y₀ 열(숫자형)을 선택하세요.</ChartMessage>
  const editable = !!onTableChange && !compact
  const toData = (e: { clientX: number; clientY: number }) => { const l = localPoint(svgRef.current!, e); return [x.invert(l.x - m.left), y.invert(l.y - m.top)] as [number, number] }
  const round = (v: number) => Math.round(v * 100) / 100
  const lineGen = d3.line<[number, number]>().x((p) => x(p[0])).y((p) => y(p[1]))
  const kind = (e: { tr: number; det: number }) => (e.det < 0 ? 'saddle' : e.det > 0 && Math.abs(e.tr) < 1e-6 ? 'center' : e.tr < 0 ? 'stable' : 'unstable')
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`위상 초상도: ${sys.name}, 궤적 ${seeds.length}개`}
        onPointerDown={(e) => { down.current = { x: e.clientX, y: e.clientY } }}
        onPointerMove={(e) => { if (drag.current != null && editable) { const [a, b] = toData(e); onTableChange!(updateRow(table, drag.current, { [roleColumn(mapping, 'x0')!]: round(a), [roleColumn(mapping, 'y0')!]: round(b) }), true) } }}
        onPointerUp={(e) => {
          if (drag.current != null) { drag.current = null; onTableChange!(table, false); return }
          const d = down.current; down.current = null
          if (!editable || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return
          const [a, b] = toData(e)
          if (a >= sys.window.x[0] && a <= sys.window.x[1] && b >= sys.window.y[0] && b <= sys.window.y[1]) onTableChange!(appendRow(table, { [roleColumn(mapping, 'x0')!]: round(a), [roleColumn(mapping, 'y0')!]: round(b), ...(ni >= 0 ? { [table.columns[ni].name]: String.fromCharCode(65 + (table.rows.length % 26)) } : {}) }))
        }} onPointerLeave={hide}>
        <defs><clipPath id="pp-clip"><rect width={iw} height={ih} /></clipPath><marker id="pp-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L8,4L0,8Z" fill="#2a7d74" /></marker></defs>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisBottom scale={x} y={ih} grid={ih} label={sys.xLabel} compact={compact} />
          <AxisLeft scale={y} x={0} grid={iw} label={sys.yLabel} compact={compact} />
          <g clipPath="url(#pp-clip)">
            {arrows.map((a, i) => <line key={i} data-testid="field-arrow" x1={a.x - a.dx} y1={a.y - a.dy} x2={a.x + a.dx} y2={a.y + a.dy} stroke={d3.interpolateBlues(0.3 + 0.55 * (a.sp / spMax))} strokeWidth={1.2} markerEnd={compact ? undefined : 'url(#pp-arrow)'} pointerEvents="none" />)}
            {nulls && [[nulls.fx, '#c0643a', 'ẋ = 0'], [nulls.fy, '#2b6cb0', 'ẏ = 0']].map(([lines, col, label]) => <path key={label as string} data-testid="nullcline" d={(lines as [number, number][][]).map((l) => lineGen(l.map((p) => [p[0], p[1]] as [number, number]))).join('')} fill="none" stroke={col as string} strokeDasharray="5 3" strokeWidth={1.6} />)}
            {paths.map(({ s, fwd, back }) => (
              <g key={s.row}>
                {back.length > 1 && <path d={lineGen(back) ?? ''} fill="none" stroke="#2a7d74" strokeOpacity={0.35} strokeWidth={1.4} strokeDasharray="3 3" />}
                <path data-testid="trajectory" d={lineGen(fwd) ?? ''} fill="none" stroke="#2a7d74" strokeWidth={2} strokeLinejoin="round" markerEnd={fwd.length > 8 && !compact ? 'url(#pp-arrow)' : undefined} />
              </g>
            ))}
            {eq.map((e, i) => { const k = kind(e); return <g key={i} data-testid="equilibrium" data-kind={k} transform={`translate(${x(e.x)},${y(e.y)})`}><title>{`평형점 (${fmt(e.x, 3)}, ${fmt(e.y, 3)}): ${classifyLinear(e.tr, e.det)}`}</title>{k === 'saddle' ? <rect x={-5} y={-5} width={10} height={10} transform="rotate(45)" fill="#e07a3f" stroke="#fff" /> : <circle r={5.5} fill={k === 'stable' ? '#2a7d74' : k === 'center' ? '#4c6fb5' : '#fff'} stroke={k === 'unstable' ? '#c0453a' : '#fff'} strokeWidth={k === 'unstable' ? 2.2 : 1.4} />}</g> })}
          </g>
          {seeds.map((s) => (
            <circle key={s.row} data-testid="seed" data-nodrag="" cx={x(s.x)} cy={y(s.y)} r={compact ? 2.4 : 5.5} fill="#e8a33d" stroke="#fff" strokeWidth={1.6} style={{ cursor: editable ? 'grab' : 'default' }}
              onPointerDown={editable ? (e) => { e.stopPropagation(); (svgRef.current as Element).setPointerCapture(e.pointerId); drag.current = s.row; setParams({ selected: s.row }); hide() } : undefined}
              onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>{s.name}</b> 시작점<br />({fmt(s.x, 2)}, {fmt(s.y, 2)}){editable ? <><br />끌어서 이동</> : null}</>) }} onPointerLeave={hide} />
          ))}
        </g>
      </svg>
      {!compact && <Readout items={[{ label: '시스템', value: sys.name }, { label: '궤적', value: seeds.length }, { label: '평형점', value: params.equilibria ? eq.length : '–' }]} />}
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function PhaseControls({ params, setParams }: ControlsProps<PhaseParams>) {
  const sys = phaseSystems.find((s) => s.id === params.system) ?? phaseSystems[0]
  const vals = { ...defaultValues(sys.id), ...params.values }
  const lin = sys.id === 'linear' ? classifyLinear(vals.tr, vals.det) : null
  return (
    <>
      <ControlGroup title="시스템">
        <Select label="미분방정식" value={params.system} onChange={(system) => setParams({ system, values: defaultValues(system) })} testId="ctl-phase-system" options={phaseSystems.map((s) => ({ value: s.id, label: s.name }))} />
        {sys.params.map((p) => <Slider key={p.key} label={p.label} value={vals[p.key]} min={p.min} max={p.max} step={p.step} onChange={(v) => setParams({ values: { ...vals, [p.key]: v } })} testId={`ctl-phase-${p.key}`} />)}
        {lin && <StatTable rows={[['분류', '고유값 조건'], [lin, `τ=${fmt(vals.tr, 2)}, Δ=${fmt(vals.det, 2)}`]]} />}
        <Hint>{sys.note} 평면을 클릭하면 그 점에서 출발하는 궤적이 추가되고, 노란 점을 끌어 옮기면 궤적이 다시 계산됩니다. 궤적은 4차 룽게–쿠타로 적분합니다.</Hint>
      </ControlGroup>
      <ControlGroup title="표현">
        <Toggle label="방향장 (화살표)" checked={params.field} onChange={(field) => setParams({ field })} testId="ctl-phase-field" />
        <Toggle label="영점 곡선 (nullcline)" checked={params.nullclines} onChange={(nullclines) => setParams({ nullclines })} testId="ctl-phase-null" />
        <Toggle label="평형점과 안정성" checked={params.equilibria} onChange={(equilibria) => setParams({ equilibria })} testId="ctl-phase-eq" />
        <Toggle label="과거 방향 궤적 (점선)" checked={params.backward} onChange={(backward) => setParams({ backward })} />
        <Slider label="적분 단계 수" value={params.steps} min={100} max={4000} step={100} onChange={(steps) => setParams({ steps })} />
        <Slider label="시간 간격 dt" value={params.dt} min={0.005} max={0.1} step={0.005} onChange={(dt) => setParams({ dt })} />
        <Hint>평형점: 청록 채움 = 안정, 빈 빨간 원 = 불안정, 주황 마름모 = 안장점, 파랑 = 중심. 안정성은 평형점에서의 야코비안의 대각합·행렬식으로 판정한 선형 분류입니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const phasePortraitModule: VizModule<PhaseParams> = {
  roles: [{ key: 'name', label: '이름 (선택)', type: 'category', auto: true }, { key: 'x0', label: '초기 x₀', type: 'number', required: true, prefer: 'x0' }, { key: 'y0', label: '초기 y₀', type: 'number', required: true, prefer: 'y0' }],
  datasets: ['phase-seeds'],
  defaultParams: { system: 'pendulum', values: defaultValues('pendulum'), field: true, nullclines: false, equilibria: true, backward: false, steps: 1500, dt: 0.02, selected: -1 },
  Chart: PhaseChart,
  Controls: PhaseControls,
  hint: '평면을 클릭해 시작점 추가 · 노란 점을 끌어 이동 · 시스템과 매개변수를 바꿔 궤도가 어떻게 달라지는지 확인 · 영점 곡선과 평형점 켜기',
}

// ─── bifurcation diagram ────────────────────────────────────────────────────────────

export interface BifParams { map: MapId; rMin: number; rMax: number; yMin: number; yMax: number; keep: number; lyap: boolean }

function BifChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<BifParams>) {
  const cvRef = useRef<HTMLCanvasElement>(null)
  const m = margins(compact, compact ? {} : { bottom: params.lyap ? 98 : 52 })
  const iw = Math.max(40, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const lyapH = params.lyap && !compact ? 22 : 0
  const ph = ih - (lyapH ? lyapH + 18 : 0)
  const meta = maps1d[params.map]
  const x = d3.scaleLinear().domain([params.rMin, params.rMax]).range([0, iw]), y = d3.scaleLinear().domain([params.yMin, params.yMax]).range([ph, 0])
  const rowsR = useMemo(() => { const ri = columnIndex(table, roleColumn(mapping, 'r')), ni = columnIndex(table, roleColumn(mapping, 'name')); return ri < 0 ? [] : table.rows.flatMap((r, row) => { const v = toNumber(r[ri]); return v == null ? [] : [{ row, r: v, name: ni >= 0 ? toLabel(r[ni]) : '' }] }) }, [table, mapping])
  const cols = Math.min(compact ? 160 : 700, Math.max(60, Math.round(iw)))
  const lyap = useMemo(() => (params.lyap ? Array.from({ length: Math.min(cols, 300) }, (_, i) => { const r = params.rMin + ((params.rMax - params.rMin) * i) / (Math.min(cols, 300) - 1); return { r, l: lyapunov(params.map, r, 300, 800) } }) : []), [params.lyap, params.map, params.rMin, params.rMax, cols])
  useEffect(() => {
    const cv = cvRef.current
    if (!cv || iw < 2 || ph < 2) return
    const dpr = 1
    cv.width = Math.round(iw * dpr); cv.height = Math.round(ph * dpr)
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.fillStyle = 'rgba(42,125,116,.55)'
    for (let c = 0; c < cols; c++) {
      const r = params.rMin + ((params.rMax - params.rMin) * c) / (cols - 1)
      const px = (c / (cols - 1)) * iw
      for (const v of attractor(params.map, r, 400, params.keep)) { if (v < params.yMin || v > params.yMax) continue; ctx.fillRect(px, ph - ((v - params.yMin) / (params.yMax - params.yMin)) * ph, 1.2, 1.2) }
    }
  }, [params.map, params.rMin, params.rMax, params.yMin, params.yMax, params.keep, cols, iw, ph])
  const brush = useRef<{ x0: number; y0: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const { tip, show, hide } = useTooltip()
  if (!roleColumn(mapping, 'r')) return <ChartMessage>표시할 매개변수 r 열(숫자형)을 선택하세요.</ChartMessage>
  const lyapX = d3.scaleLinear().domain([params.rMin, params.rMax]).range([0, iw])
  return (
    <div className="chart-root">
      <div style={{ position: 'relative', width, height }}>
        <canvas ref={cvRef} className="canvas3d" data-testid="bif-canvas" style={{ left: m.left, top: m.top, width: iw, height: ph }} aria-hidden="true" />
        <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`분기 다이어그램: ${meta.name}, r ${fmt(params.rMin)}~${fmt(params.rMax)}`} style={{ position: 'absolute', inset: 0, cursor: compact ? 'default' : 'crosshair' }}
          onPointerDown={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); if (l.x > m.left && l.x < m.left + iw && l.y > m.top && l.y < m.top + ph) { brush.current = { x0: l.x, y0: l.y }; (svgRef.current as Element).setPointerCapture(e.pointerId) } }}
          onPointerMove={(e) => { const l = localPoint(svgRef.current!, e); if (!brush.current) { if (!compact && l.x > m.left && l.x < m.left + iw) show(l.x, l.y, <>r = <b>{fmt(x.invert(l.x - m.left), 3)}</b><br />x = {fmt(y.invert(l.y - m.top), 3)}</>); else hide() } else { const b = brush.current; const g = svgRef.current!.querySelector('[data-testid=bif-brush]') as SVGRectElement | null; if (g) { g.setAttribute('x', String(Math.min(b.x0, l.x))); g.setAttribute('y', String(Math.min(b.y0, l.y))); g.setAttribute('width', String(Math.abs(l.x - b.x0))); g.setAttribute('height', String(Math.abs(l.y - b.y0))); g.setAttribute('visibility', 'visible') } } }}
          onPointerUp={(e) => {
            const b = brush.current; brush.current = null
            const g = svgRef.current!.querySelector('[data-testid=bif-brush]') as SVGRectElement | null; g?.setAttribute('visibility', 'hidden')
            if (!b) return
            const l = localPoint(svgRef.current!, e)
            if (Math.abs(l.x - b.x0) < 8 || Math.abs(l.y - b.y0) < 8) return
            const r0 = x.invert(Math.min(b.x0, l.x) - m.left), r1 = x.invert(Math.max(b.x0, l.x) - m.left), y1 = y.invert(Math.min(b.y0, l.y) - m.top), y0 = y.invert(Math.max(b.y0, l.y) - m.top)
            setParams({ rMin: +r0.toFixed(4), rMax: +r1.toFixed(4), yMin: +Math.max(0, y0).toFixed(4), yMax: +Math.min(1.2, y1).toFixed(4) })
          }} onPointerLeave={hide}>
          <g transform={`translate(${m.left},${m.top})`}>
            <AxisBottom scale={x} y={ph} grid={ph} label={lyapH ? undefined : '매개변수 r'} compact={compact} />
            <AxisLeft scale={y} x={0} grid={iw} label="장기 거동 x" compact={compact} />
            {rowsR.filter((p) => p.r >= params.rMin && p.r <= params.rMax).map((p) => {
              const orbit = attractor(params.map, p.r, 400, 64)
              return <g key={p.row} data-testid="r-mark"><line x1={x(p.r)} x2={x(p.r)} y1={0} y2={ph} stroke="#e07a3f" strokeDasharray="4 3" strokeWidth={1.4} />{!compact && <text x={x(p.r) + 4} y={12} fontSize={11} fill="#a8531f" stroke="#fff" strokeWidth={3} paintOrder="stroke">{p.name || `r=${fmt(p.r)}`} · 주기 {periodOf(orbit) > 16 ? '∞(혼돈)' : periodOf(orbit)}</text>}</g>
            })}
            {lyapH > 0 && (
              <g transform={`translate(0,${ph + 34})`} data-testid="lyap-strip">
                {lyap.map((p, i) => <rect key={i} x={lyapX(p.r)} y={0} width={Math.max(1, iw / lyap.length + 0.5)} height={lyapH} fill={p.l > 0 ? '#c0453a' : '#2a7d74'} fillOpacity={Math.min(0.9, 0.25 + Math.abs(p.l))} />)}
                <text x={0} y={lyapH + 14} fontSize={11} fill="#6b7773">리아푸노프 지수: 붉은색 &gt; 0 (혼돈) · 청록 &lt; 0 (안정 주기)</text>
              </g>
            )}
            <rect data-testid="bif-brush" x={0} y={0} width={0} height={0} visibility="hidden" fill="#e07a3f" fillOpacity={0.12} stroke="#e07a3f" strokeDasharray="4 3" transform={`translate(${-m.left},${-m.top})`} pointerEvents="none" />
          </g>
        </svg>
      </div>
      {!compact && (<><Readout items={[{ label: '사상', value: meta.name.split(' ')[0] }, { label: 'r 범위', value: `${fmt(params.rMin)} ~ ${fmt(params.rMax)}` }, { label: '표시 열', value: cols }]} /><Tooltip tip={tip} width={width} /></>)}
    </div>
  )
}

function BifControls({ params, setParams }: ControlsProps<BifParams>) {
  const meta = maps1d[params.map]
  return (
    <>
      <ControlGroup title="사상과 범위">
        <Select label="1차원 사상" value={params.map} onChange={(map) => setParams({ map, rMin: maps1d[map].rRange[0], rMax: maps1d[map].rRange[1], yMin: 0, yMax: 1 })} testId="ctl-bif-map" options={(Object.keys(maps1d) as MapId[]).map((k) => ({ value: k, label: maps1d[k].name }))} />
        <NumberField label="r 최소" value={params.rMin} step={0.05} onChange={(rMin) => setParams({ rMin })} testId="ctl-bif-rmin" />
        <NumberField label="r 최대" value={params.rMax} step={0.05} onChange={(rMax) => setParams({ rMax })} testId="ctl-bif-rmax" />
        <Slider label="r마다 그릴 점 수" value={params.keep} min={30} max={300} step={10} onChange={(keep) => setParams({ keep })} />
        <Toggle label="리아푸노프 지수 띠" checked={params.lyap} onChange={(lyap) => setParams({ lyap })} testId="ctl-bif-lyap" />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ rMin: meta.rRange[0], rMax: meta.rRange[1], yMin: 0, yMax: 1 })} data-testid="bif-reset">전체 범위로</button>
        <Hint>각 r에서 사상을 400번 반복해 과도 구간을 버린 뒤 남는 값(장기 거동)을 점으로 찍습니다. 한 점이면 안정한 고정점, 둘이면 주기 2, 점점 갈라지다(주기 배가) 점들이 띠로 번지면 혼돈입니다. 그래프를 드래그해 사각형을 그리면 그 영역을 확대합니다 — 확대할수록 같은 모양이 반복되는 자기 유사성이 보입니다. 표의 r 값은 세로 표시선이며 그 r의 주기를 알려 줍니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const bifurcationModule: VizModule<BifParams> = {
  roles: [{ key: 'name', label: '이름 (선택)', type: 'category', auto: true }, { key: 'r', label: '표시할 매개변수 r', type: 'number', required: true, prefer: '^r$|r' }],
  datasets: ['bifurcation-marks'],
  defaultParams: { map: 'logistic', rMin: 2.5, rMax: 4, yMin: 0, yMax: 1, keep: 120, lyap: true },
  Chart: BifChart,
  Controls: BifControls,
  hint: '드래그로 사각형을 그려 확대하세요(자기 유사성) · 표의 r 값 옆에 그 주기가 표시됩니다 · 사상을 바꿔 보세요',
}

// ─── spectrogram & scalogram ────────────────────────────────────────────────────────

function readSignal(table: DataTable, mapping: Mapping) {
  const vi = columnIndex(table, roleColumn(mapping, 'signal')), ti = columnIndex(table, roleColumn(mapping, 'time'))
  const v: number[] = []
  const t: number[] = []
  if (vi < 0) return { x: v, fs: 1, t0: 0, hasTime: false }
  table.rows.forEach((r, i) => { const a = toNumber(r[vi]); if (a != null) { v.push(a); t.push(ti >= 0 ? (toNumber(r[ti]) ?? i) : i) } })
  const hasTime = ti >= 0 && t.length > 1 && t[t.length - 1] > t[0]
  return { x: v, fs: hasTime ? (t.length - 1) / (t[t.length - 1] - t[0]) : 1, t0: hasTime ? t[0] : 0, hasTime }
}

const signalRoles = [{ key: 'time', label: '시간 (선택)', type: 'number' as const, prefer: '시간|time' }, { key: 'signal', label: '신호', type: 'number' as const, required: true, prefer: '신호|값|signal' }]

export interface SpecParams { frame: number; overlap: number; win: WindowKind; range: number; scheme: ColorScheme; logF: boolean }

function SpectrogramChart({ table, mapping, params, width, height, compact }: ChartProps<SpecParams>) {
  const sig = useMemo(() => readSignal(table, mapping), [table, mapping])
  const frame = Math.min(params.frame, Math.max(16, Math.floor(sig.x.length / 2)))
  const sp = useMemo(() => (sig.x.length >= 32 ? stft(sig.x, frame, Math.max(1, Math.round(frame * (1 - params.overlap))), params.win) : null), [sig.x, frame, params.overlap, params.win])
  const db = useMemo(() => { if (!sp) return null; const mx = d3.max(sp.mag, (f) => d3.max(f)!) ?? 1; return { mx, rows: sp.mag.map((f) => Array.from(f, (v) => 20 * Math.log10(Math.max(1e-12, v / mx)))) } }, [sp])
  const m = margins(compact, compact ? {} : { right: 70 })
  const iw = Math.max(40, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const scheme = schemes[params.scheme]
  const ramp = useMemo(() => rampPack(scheme.interpolate), [scheme])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const nF = sp?.freqs.length ?? 0, nT = sp?.mag.length ?? 0
  const fmax = sig.fs / 2
  const px = useMemo(() => (sp ? { logLo: Math.max(sp.freqs[1] ?? 1e-3, 1e-3) } : null), [sp])
  const colorOf = useCallback((r: number, c: number) => {
    // image row r is from the top: highest frequency first; with a log axis each row maps to a frequency geometrically
    if (!sp || !db || !px) return 0
    const t = r / Math.max(1, Math.round(ih) - 1)
    const fFrac = 1 - t
    const bin = params.logF ? Math.min(nF - 1, Math.round(((Math.exp(Math.log(px.logLo) + fFrac * (Math.log(0.5) - Math.log(px.logLo)))) / 0.5) * (nF - 1))) : Math.round(fFrac * (nF - 1))
    const v = db.rows[Math.min(nT - 1, Math.round((c / Math.max(1, Math.round(iw) - 1)) * (nT - 1)))][Math.max(0, bin)]
    return ramp[Math.max(0, Math.min(255, Math.round((1 + v / params.range) * 255)))]
  }, [sp, db, px, nF, nT, ih, iw, params.logF, params.range, ramp])
  if (!roleColumn(mapping, 'signal')) return <ChartMessage>신호(숫자형) 열을 선택하세요.</ChartMessage>
  if (!sp || !db) return <ChartMessage>스펙트로그램에는 표본이 32개 이상 필요합니다.</ChartMessage>
  const T = sig.hasTime ? sig.x.length / sig.fs : sig.x.length
  const xT = d3.scaleLinear().domain([sig.t0, sig.t0 + T]).range([0, iw])
  const yF = params.logF ? d3.scaleLog().domain([Math.max(sig.fs * (px?.logLo ?? 0.01), 1e-3), fmax]).range([ih, 0]) : d3.scaleLinear().domain([0, fmax]).range([ih, 0])
  const info = (e: React.PointerEvent) => {
    const l = localPoint(svgRef.current!, e)
    if (l.x < m.left || l.x > m.left + iw || l.y < m.top || l.y > m.top + ih) { hide(); return }
    const t = xT.invert(l.x - m.left), f = yF.invert(l.y - m.top)
    const ti = Math.max(0, Math.min(nT - 1, Math.round(((t - sig.t0) / T) * (nT - 1)))), fi = Math.max(0, Math.min(nF - 1, Math.round((f / fmax) * (nF - 1))))
    show(l.x, l.y, <>시간 {fmt(t, 3)}{sig.hasTime ? ' s' : ''}<br />주파수 {fmt(f, 2)}{sig.hasTime ? ' Hz' : ' (사이클/표본 × fs)'}<br />세기 {fmt(db.rows[ti][fi], 1)} dB</>)
  }
  return (
    <div className="chart-root" style={{ width, height }}>
      <MatrixCanvas rows={Math.round(ih)} cols={Math.round(iw)} color={colorOf} width={iw} height={ih} left={m.left} top={m.top} />
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`스펙트로그램: 프레임 ${frame}, ${nT}개 프레임 × ${nF}개 주파수`} style={{ position: 'absolute', inset: 0 }} onPointerMove={compact ? undefined : info} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <rect width={iw} height={ih} fill="none" stroke="#cfd6d3" />
          <line x1={0} y1={ih} x2={iw} y2={ih} stroke="#8a9692" /><line x1={0} y1={0} x2={0} y2={ih} stroke="#8a9692" />
          <AxisBottom scale={xT} y={ih} label={sig.hasTime ? '시간 (s)' : '표본 번호'} compact={compact} />
          {params.logF ? <AxisLeft scale={yF as never} x={0} label={sig.hasTime ? '주파수 (Hz)' : '주파수'} compact={compact} /> : <AxisLeft scale={yF as d3.ScaleLinear<number, number>} x={0} label={sig.hasTime ? '주파수 (Hz)' : '주파수'} compact={compact} />}
        </g>
        {!compact && <g transform={`translate(${m.left + iw + 14},${m.top})`}><defs><linearGradient id="spec-grad" x1="0" y1="1" x2="0" y2="0">{d3.range(0, 1.01, 0.1).map((v) => <stop key={v} offset={`${v * 100}%`} stopColor={scheme.interpolate(v)} />)}</linearGradient></defs><rect width={12} height={ih} fill="url(#spec-grad)" /><text x={18} y={8} fontSize={10.5} fill="#6b7773">0 dB</text><text x={18} y={ih} fontSize={10.5} fill="#6b7773">−{params.range}</text></g>}
      </svg>
      {!compact && <><Readout items={[{ label: '표본 주파수', value: sig.hasTime ? `${fmt(sig.fs, 1)} Hz` : '1 (시간 열 없음)' }, { label: '주파수 해상도', value: `${fmt(sig.fs / frame, 2)}` }, { label: '시간 해상도', value: `${fmt(frame / sig.fs, 3)} s` }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function SpecControls({ params, setParams }: ControlsProps<SpecParams>) {
  return (
    <ControlGroup title="STFT 설정">
      <Select label="프레임 길이 (표본)" value={String(params.frame)} onChange={(v) => setParams({ frame: Number(v) })} testId="ctl-spec-frame" options={[32, 64, 128, 256, 512].map((n) => ({ value: String(n), label: `${n}` }))} />
      <Slider label="프레임 겹침" value={params.overlap} min={0} max={0.9} step={0.05} onChange={(overlap) => setParams({ overlap })} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-spec-overlap" />
      <Select label="창 함수" value={params.win} onChange={(win) => setParams({ win })} testId="ctl-spec-window" options={[{ value: 'hann', label: 'Hann' }, { value: 'hamming', label: 'Hamming' }, { value: 'blackman', label: 'Blackman' }, { value: 'rect', label: '사각 (창 없음)' }]} />
      <Slider label="동적 범위 (dB)" value={params.range} min={20} max={100} step={5} onChange={(range) => setParams({ range })} format={(v) => `${v} dB`} testId="ctl-spec-range" />
      <Select label="팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={seq} />
      <Toggle label="주파수 로그 눈금" checked={params.logF} onChange={(logF) => setParams({ logF })} />
      <Hint>단시간 푸리에 변환(STFT)은 신호를 겹치는 짧은 프레임으로 잘라 창 함수를 곱한 뒤 푸리에 변환해 시간별 주파수 성분을 구합니다. 프레임이 길면 주파수 해상도는 좋아지고 시간 해상도는 나빠집니다(불확정성 관계) — 처프는 짧은 프레임에서, 순음은 긴 프레임에서 또렷합니다. 시간 열이 있으면 표본 주파수를 간격에서 계산합니다.</Hint>
    </ControlGroup>
  )
}

export const spectrogramModule: VizModule<SpecParams> = {
  roles: signalRoles,
  datasets: ['signal-chirp', 'rp-series'],
  defaultParams: { frame: 128, overlap: 0.75, win: 'hann', range: 60, scheme: 'magma', logF: false },
  Chart: SpectrogramChart,
  Controls: SpecControls,
  hint: '프레임 길이를 바꿔 시간·주파수 해상도의 균형을 확인하세요 · 20 Hz 순음, 60 Hz 파열, 올라가는 처프가 보입니다 · 포인터로 값 읽기',
}

export interface ScaloParams { bands: number; fMin: number; w0: number; range: number; scheme: ColorScheme }

function ScalogramChart({ table, mapping, params, width, height, compact }: ChartProps<ScaloParams>) {
  const sig = useMemo(() => readSignal(table, mapping), [table, mapping])
  const x = useMemo(() => (sig.x.length > 512 ? sig.x.filter((_, i) => i % Math.ceil(sig.x.length / 512) === 0) : sig.x), [sig.x])
  const stride = sig.x.length / Math.max(1, x.length)
  const fsEff = sig.fs / stride
  const nb = compact ? 20 : params.bands
  const freqsN = useMemo(() => { const lo = params.fMin, hi = 0.4; return Array.from({ length: nb }, (_, i) => lo * (hi / lo) ** (i / (nb - 1))) }, [nb, params.fMin])
  const sc = useMemo(() => (x.length >= 32 ? cwt(x, freqsN, params.w0) : null), [x, freqsN, params.w0])
  const db = useMemo(() => { if (!sc) return null; const mx = d3.max(sc.mag, (r) => d3.max(r)!) ?? 1; return sc.mag.map((r) => Array.from(r, (v) => 20 * Math.log10(Math.max(1e-12, v / mx)))) }, [sc])
  const m = margins(compact, compact ? {} : { right: 70 })
  const iw = Math.max(40, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const scheme = schemes[params.scheme]
  const ramp = useMemo(() => rampPack(scheme.interpolate), [scheme])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const colorOf = useCallback((r: number, c: number) => {
    if (!db) return 0
    const rowFrac = 1 - r / Math.max(1, Math.round(ih) - 1)
    const si = Math.round(rowFrac * (db.length - 1))
    const v = db[si][Math.round((c / Math.max(1, Math.round(iw) - 1)) * (x.length - 1))]
    return ramp[Math.max(0, Math.min(255, Math.round((1 + v / params.range) * 255)))]
  }, [db, ih, iw, x.length, params.range, ramp])
  if (!roleColumn(mapping, 'signal')) return <ChartMessage>신호(숫자형) 열을 선택하세요.</ChartMessage>
  if (!sc || !db) return <ChartMessage>스케일로그램에는 표본이 32개 이상 필요합니다.</ChartMessage>
  const T = sig.hasTime ? sig.x.length / sig.fs : sig.x.length
  const xT = d3.scaleLinear().domain([sig.t0, sig.t0 + T]).range([0, iw])
  const fLo = freqsN[0] * fsEff, fHi = freqsN[freqsN.length - 1] * fsEff
  const yF = d3.scaleLog().domain([fLo, fHi]).range([ih, 0])
  return (
    <div className="chart-root" style={{ width, height }}>
      <MatrixCanvas rows={Math.round(ih)} cols={Math.round(iw)} color={colorOf} width={iw} height={ih} left={m.left} top={m.top} smooth />
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`스케일로그램: 모를레 웨이블릿 ω₀=${params.w0}, 스케일 ${nb}개`} style={{ position: 'absolute', inset: 0 }} onPointerLeave={hide}
        onPointerMove={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); if (l.x < m.left || l.x > m.left + iw || l.y < m.top || l.y > m.top + ih) { hide(); return } const f = yF.invert(l.y - m.top), t = xT.invert(l.x - m.left); const si = d3.bisectCenter(freqsN.map((q) => q * fsEff), f); show(l.x, l.y, <>시간 {fmt(t, 3)}<br />주파수 {fmt(f, 2)}{sig.hasTime ? ' Hz' : ''}<br />스케일 {fmt(sc.scales[si] * stride, 1)} 표본<br />세기 {fmt(db[si][Math.round(((t - sig.t0) / T) * (x.length - 1))] ?? 0, 1)} dB</>) }}>
        <g transform={`translate(${m.left},${m.top})`}>
          <rect width={iw} height={ih} fill="none" stroke="#cfd6d3" />
          <line x1={0} y1={ih} x2={iw} y2={ih} stroke="#8a9692" /><line x1={0} y1={0} x2={0} y2={ih} stroke="#8a9692" />
          <AxisBottom scale={xT} y={ih} label={sig.hasTime ? '시간 (s)' : '표본 번호'} compact={compact} />
          <AxisLeft scale={yF as never} x={0} label={sig.hasTime ? '의사 주파수 (Hz, 로그)' : '의사 주파수 (로그)'} format={(v) => (v >= 1 ? String(Math.round(v)) : v.toPrecision(1))} compact={compact} ticks={6} />
        </g>
        {!compact && <g transform={`translate(${m.left + iw + 14},${m.top})`}><defs><linearGradient id="scal-grad" x1="0" y1="1" x2="0" y2="0">{d3.range(0, 1.01, 0.1).map((v) => <stop key={v} offset={`${v * 100}%`} stopColor={scheme.interpolate(v)} />)}</linearGradient></defs><rect width={12} height={ih} fill="url(#scal-grad)" /><text x={18} y={8} fontSize={10.5} fill="#6b7773">0 dB</text><text x={18} y={ih} fontSize={10.5} fill="#6b7773">−{params.range}</text></g>}
      </svg>
      {!compact && <><Readout items={[{ label: '웨이블릿', value: `Morlet ω₀=${params.w0}` }, { label: '표본', value: `${x.length}${stride > 1 ? ` (1/${Math.round(stride)} 솎음)` : ''}` }, { label: '주파수', value: `${fmt(fLo, 2)}–${fmt(fHi, 1)}` }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function ScaloControls({ params, setParams }: ControlsProps<ScaloParams>) {
  return (
    <ControlGroup title="웨이블릿 설정">
      <Slider label="주파수(스케일) 개수" value={params.bands} min={16} max={96} step={4} onChange={(bands) => setParams({ bands })} testId="ctl-scal-bands" />
      <Slider label="최저 주파수 (사이클/표본)" value={params.fMin} min={0.005} max={0.06} step={0.005} onChange={(fMin) => setParams({ fMin })} testId="ctl-scal-fmin" />
      <Slider label="모를레 ω₀ (시간·주파수 균형)" value={params.w0} min={3} max={12} step={0.5} onChange={(w0) => setParams({ w0 })} testId="ctl-scal-w0" />
      <Slider label="동적 범위 (dB)" value={params.range} min={20} max={80} step={5} onChange={(range) => setParams({ range })} format={(v) => `${v} dB`} />
      <Select label="팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={seq} />
      <Hint>연속 웨이블릿 변환은 늘이고 줄인 모를레 파형을 신호와 겹쳐(합성곱) 시간·스케일별 세기를 구합니다. 스케일 s는 주파수 ω₀/(2π s)에 대응해 같은 시간·주파수 평면으로 보이게 했습니다. 낮은 주파수는 시간 해상도가 낮고 높은 주파수는 주파수 해상도가 낮은 다중 해상도 분석이라 처프나 순간적인 파열의 모양을 STFT와 다르게 보여 줍니다. ω₀가 클수록 주파수 해상도가 좋고 시간 해상도가 나빠집니다. 양 끝은 신호가 잘려 부정확합니다(가장자리 효과). 표본이 512개를 넘으면 솎아 계산합니다.</Hint>
    </ControlGroup>
  )
}

export const scalogramModule: VizModule<ScaloParams> = {
  roles: signalRoles,
  datasets: ['signal-chirp', 'rp-series'],
  defaultParams: { bands: 56, fMin: 0.02, w0: 6, range: 45, scheme: 'viridis' },
  Chart: ScalogramChart,
  Controls: ScaloControls,
  hint: 'ω₀를 바꿔 시간·주파수 해상도의 균형을 비교 · 스펙트로그램과 같은 신호를 비교하세요 · 포인터로 시간·주파수 읽기',
}

// ─── recurrence plot ────────────────────────────────────────────────────────────────

export interface RecParams { m: number; tau: number; eps: number; maxN: number }

function RecurrenceChart({ table, mapping, params, width, height, compact }: ChartProps<RecParams>) {
  const sig = useMemo(() => { const vi = columnIndex(table, roleColumn(mapping, 'value')); return vi < 0 ? [] : table.rows.map((r) => toNumber(r[vi])).filter((v): v is number => v != null) }, [table, mapping])
  const stride = Math.max(1, Math.ceil(sig.length / (compact ? 120 : params.maxN)))
  const x = useMemo(() => sig.filter((_, i) => i % stride === 0), [sig, stride])
  const rp = useMemo(() => (x.length >= params.m * params.tau + 4 ? recurrencePlot(x, params.m, params.tau, params.eps) : null), [x, params.m, params.tau, params.eps])
  const side = Math.max(60, Math.min(width - 90, height - 70))
  const left = (width - side) / 2, top = (height - side) / 2 - 8
  const color = useCallback((r: number, c: number) => {
    if (!rp) return 0
    const i = Math.round(((rp.n - 1) * (rp.n - 1 - r)) / Math.max(1, Math.round(side) - 1)), j = Math.round(((rp.n - 1) * c) / Math.max(1, Math.round(side) - 1))
    return rp.r[i * rp.n + j] ? 0xff2d1f12 : 0xfff6f8f7
  }, [rp, side])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!roleColumn(mapping, 'value')) return <ChartMessage>값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!rp) return <ChartMessage>재귀 플롯에는 임베딩 길이 이상의 충분한 표본이 필요합니다.<small>(임베딩 차원−1) × 지연 + 4개 이상</small></ChartMessage>
  return (
    <div className="chart-root" style={{ width, height }}>
      <MatrixCanvas rows={Math.round(side)} cols={Math.round(side)} color={color} width={side} height={side} left={left} top={top} />
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`재귀 플롯: ${rp.n}×${rp.n}, 재귀율 ${(rp.rate * 100).toFixed(1)}%`} style={{ position: 'absolute', inset: 0 }} onPointerLeave={hide}
        onPointerMove={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); if (l.x < left || l.x > left + side || l.y < top || l.y > top + side) { hide(); return } const a = Math.round((side - (l.y - top)) / side * (rp.n - 1)), b = Math.round((l.x - left) / side * (rp.n - 1)); show(l.x, l.y, <>시점 {a * stride} ↔ {b * stride}<br />{rp.r[a * rp.n + b] ? '재귀 (상태가 가까움)' : '재귀 아님'}</>) }}>
        <g transform={`translate(${left},${top})`}>
          <rect width={side} height={side} fill="none" stroke="#cfd6d3" />
          <line x1={0} y1={side} x2={side} y2={0} stroke="#e07a3f" strokeOpacity={0.35} strokeDasharray="4 3" />
          <line x1={0} y1={side} x2={side} y2={side} stroke="#8a9692" /><line x1={0} y1={0} x2={0} y2={side} stroke="#8a9692" />
          {!compact && <><text x={side / 2} y={side + 26} textAnchor="middle" fontSize={11.5} fill="#6b7773">시점 i →</text><text transform={`translate(-14,${side / 2}) rotate(-90)`} textAnchor="middle" fontSize={11.5} fill="#6b7773">시점 j →</text>{[0, 0.5, 1].map((f) => <g key={f}><line x1={f * side} x2={f * side} y1={side} y2={side + 4} stroke="#8a9692" /><text x={f * side} y={side + 14} textAnchor="middle" fontSize={10} fill="#6b7773">{Math.round(f * (rp.n - 1) * stride)}</text></g>)}</>}
        </g>
      </svg>
      {!compact && <><Readout items={[{ label: '재귀율', value: `${(rp.rate * 100).toFixed(1)}%` }, { label: '결정성(DET)', value: `${(rp.determinism * 100).toFixed(0)}%` }, { label: 'ε', value: fmt(rp.eps, 3) }, { label: '상태 수', value: rp.n }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function RecControls({ params, setParams }: ControlsProps<RecParams>) {
  return (
    <ControlGroup title="재귀 플롯 설정">
      <Slider label="임베딩 차원 m" value={params.m} min={1} max={6} onChange={(m) => setParams({ m })} testId="ctl-rec-m" />
      <Slider label="지연 τ (표본)" value={params.tau} min={1} max={30} onChange={(tau) => setParams({ tau })} testId="ctl-rec-tau" />
      <Slider label="거리 문턱 ε (최대 거리의 비율)" value={params.eps} min={0.02} max={0.6} step={0.01} onChange={(eps) => setParams({ eps })} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-rec-eps" />
      <Slider label="표시 해상도 (최대 점 수)" value={params.maxN} min={100} max={500} step={20} onChange={(maxN) => setParams({ maxN })} />
      <Hint>시계열을 지연 좌표 (x_t, x_(t+τ), …, x_(t+(m−1)τ))의 상태로 바꾸고, 두 시점의 상태 사이 거리가 ε 이하이면 점(검은색)을 찍은 행렬입니다. 주기 신호는 일정한 간격의 대각선 줄무늬, 무작위 잡음은 흩어진 점, 혼돈은 짧고 불규칙한 대각선, 상태가 갑자기 바뀌면 격자 무늬의 띠가 생깁니다. ‘결정성’은 대각선 위에 있는 점의 비율입니다. ε이 너무 크면 모두 검게, 너무 작으면 빈 화면이 되므로 재귀율이 몇 % 되도록 조절하세요.</Hint>
    </ControlGroup>
  )
}

export const recurrenceModule: VizModule<RecParams> = {
  roles: [{ key: 'value', label: '시계열 값', type: 'number', required: true, prefer: '값|value' }],
  datasets: ['rp-series', 'signal-chirp'],
  defaultParams: { m: 2, tau: 6, eps: 0.12, maxN: 320 },
  Chart: RecurrenceChart,
  Controls: RecControls,
  hint: 'ε·임베딩·지연을 조절해 재귀율을 몇 %로 맞춰 보세요 · 대각선 줄무늬 = 주기, 흩어진 점 = 잡음 · 위상이 바뀌면 줄무늬가 어긋납니다',
}

