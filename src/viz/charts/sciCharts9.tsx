import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { ChartMessage } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { columnIndex, toNumber } from '../../data/table'
import { useReducedMotion } from '../../hooks/motion'
import { schemes } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { gridFromRows, type Grid3, type V3 } from '../../stats/field3d'
import { fiberSurface, field2FromRows, hyperstreamline, hypertube, ibfvStep, makeNoise, tensorFieldFromRows, type Field2, type Pt } from '../../stats/field9'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, RoleSpec, VizModule } from '../types'
import { cubeMap } from './field3dCharts'
import { ViewControls, type ViewParams } from './geo3dCharts'
import { drawQuads, type Projector, type Quad } from './scene3d'
import { Scene3D } from './kit3d'

const shade = (rgb: [number, number, number], k: number) => `rgb(${Math.round(rgb[0] * k)},${Math.round(rgb[1] * k)},${Math.round(rgb[2] * k)})`
const hexRgb = (css: string): [number, number, number] => {
  const m = /(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(css)
  if (m) return [+m[1], +m[2], +m[3]]
  const h = css.replace('#', '')
  return h.length === 6 ? [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] : [120, 120, 120]
}
const LIGHT: V3 = (() => { const l = Math.hypot(0.4, 0.5, 0.8); return [0.4 / l, 0.5 / l, 0.8 / l] })()
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const lit = (a: V3, b: V3, c: V3) => {
  const n = cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]])
  const l = Math.hypot(...n) || 1
  return 0.4 + 0.6 * Math.abs((n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / l)
}

// ───────────────────────────── IBFV ─────────────────────────────

export interface IbfvParams { speed: number; alpha: number; cell: number; hold: number; res: number; seed: number; playing: boolean; arrows: boolean; nonce: number }

function useField2(table: ChartProps<IbfvParams>['table'], mapping: ChartProps<IbfvParams>['mapping']): Field2 | null {
  return useMemo(() => {
    const xi = columnIndex(table, roleColumn(mapping, 'x')), yi = columnIndex(table, roleColumn(mapping, 'y')), ui = columnIndex(table, roleColumn(mapping, 'u')), vi = columnIndex(table, roleColumn(mapping, 'v'))
    if ([xi, yi, ui, vi].some((i) => i < 0)) return null
    const rows: { x: number; y: number; u: number; v: number }[] = []
    for (const r of table.rows) { const x = toNumber(r[xi]), y = toNumber(r[yi]), u = toNumber(r[ui]), v = toNumber(r[vi]); if (x != null && y != null && u != null && v != null) rows.push({ x, y, u, v }) }
    return field2FromRows(rows)
  }, [table, mapping])
}

function IbfvChart({ table, mapping, params, width, height, compact }: ChartProps<IbfvParams>) {
  const field = useField2(table, mapping)
  const cvRef = useRef<HTMLCanvasElement>(null)
  const frame = useRef(0)
  const img = useRef<Float32Array | null>(null)
  const reduced = useReducedMotion()
  const [count, setCount] = useState(0)
  const size = Math.max(60, Math.min(compact ? 100 : params.res, 260))
  const side = Math.max(120, Math.min(width, height) - (compact ? 8 : 56))
  const noises = useRef(new Map<number, Float32Array>())
  const noiseFor = (k: number) => {
    const m = noises.current
    let t = m.get(k)
    if (!t) { t = makeNoise(size, size, params.cell, params.seed * 1000 + k); m.set(k, t); if (m.size > 6) m.delete(m.keys().next().value as number) }
    return t
  }
  const paint = () => {
    const cv = cvRef.current
    if (!cv || !img.current) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const id = ctx.createImageData(size, size)
    const interp = schemes.blues.interpolate
    for (let i = 0; i < size * size; i++) {
      const [r, g, b] = hexRgb(interp(0.12 + 0.88 * Math.min(1, Math.max(0, img.current[i]))))
      id.data[i * 4] = r; id.data[i * 4 + 1] = g; id.data[i * 4 + 2] = b; id.data[i * 4 + 3] = 255
    }
    ctx.putImageData(id, 0, 0)
  }
  const step = () => {
    if (!field || !img.current) return
    img.current = ibfvStep(img.current, size, size, field, noiseFor(Math.floor(frame.current / params.hold)), params.speed, params.alpha)
    frame.current++
    paint()
  }
  const stepRef = useRef(step); stepRef.current = step
  // restart whenever the field or the texture settings change
  useEffect(() => {
    noises.current.clear(); frame.current = 0
    img.current = new Float32Array(size * size).fill(0.5)
    for (let i = 0; i < 24 && field; i++) stepRef.current() // pre-roll so that the first picture already shows streaks
    setCount(frame.current); paint()
  }, [field, size, params.cell, params.hold, params.seed, params.nonce]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!field || !params.playing || reduced || compact) return
    let raf = 0, last = 0
    const loop = (t: number) => {
      if (t - last > 33) { last = t; stepRef.current(); setCount(frame.current) }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [field, params.playing, reduced, compact])
  if (!field) return <ChartMessage>x, y, u, v 열을 고르세요. 규칙적인 2차원 격자여야 합니다.</ChartMessage>
  const arrowCells = 9
  return (
    <div className="chart-root">
      <div style={{ position: 'absolute', left: (width - side) / 2, top: (height - side) / 2 - (compact ? 0 : 8), width: side, height: side }}>
        <canvas ref={cvRef} width={size} height={size} data-testid="ibfv-canvas" data-frame={count} style={{ width: side, height: side, imageRendering: 'auto', borderRadius: 4 }} role="img" aria-label={`IBFV: ${size}×${size} 격자에서 흐름을 따라 질감이 이동`} />
        {(
          <svg width={side} height={side} style={{ position: 'absolute', inset: 0 }} pointerEvents="none" data-testid="chart-svg" aria-hidden="true">
            <rect x={0.5} y={0.5} width={side - 1} height={side - 1} rx={4} fill="none" stroke="#cfd6d6" />
            <rect x={4} y={4} width={side - 8} height={side - 8} rx={3} fill="none" stroke="#e5eaea" />
            {!compact && Array.from({ length: 8 }, (_, i) => <rect key={`ramp-${i}`} x={side - 96 + i * 10} y={side - 22} width={10} height={8} fill={schemes.blues.interpolate(0.12 + 0.88 * (i / 7))} stroke="#fff" strokeWidth={0.5} />)}
            {!compact && <text x={side - 98} y={side - 8} fontSize={9} fill="#fff" stroke="#1f3a5a" strokeWidth={0.4}>명암 = 노이즈(값 아님)</text>}
            {params.arrows && !compact && Array.from({ length: arrowCells * arrowCells }, (_, n) => {
              const i = n % arrowCells, j = Math.floor(n / arrowCells)
              const x = field.x0 + ((i + 0.5) / arrowCells) * (field.x1 - field.x0), y = field.y1 - ((j + 0.5) / arrowCells) * (field.y1 - field.y0)
              const fx = Math.min(field.nx - 1, Math.max(0, ((x - field.x0) / (field.x1 - field.x0)) * (field.nx - 1))), fy = Math.min(field.ny - 1, Math.max(0, ((y - field.y0) / (field.y1 - field.y0)) * (field.ny - 1)))
              const k = Math.round(fy) * field.nx + Math.round(fx)
              const u = field.u[k], v = field.v[k], sp = Math.hypot(u, v) / (field.maxSpeed || 1), len = (side / arrowCells) * 0.6 * sp
              const cx = ((i + 0.5) / arrowCells) * side, cy = ((j + 0.5) / arrowCells) * side, ang = Math.atan2(-v, u)
              return <g key={n} transform={`translate(${cx},${cy}) rotate(${(ang * 180) / Math.PI})`}><line x1={-len / 2} x2={len / 2} stroke="#d4452f" strokeWidth={1.4} opacity={0.85} /><path d={`M${len / 2},0l-5,-3v6z`} fill="#d4452f" opacity={0.85} /></g>
            })}
          </svg>
        )}
      </div>
      {!compact && <p className="chart-note" role="note" style={{ left: 8, right: 'auto', bottom: 2 }} data-testid="ibfv-readout">프레임 {count} · {size}×{size} 해상도 · 최대 속도 {fmt(field.maxSpeed, 3)}{reduced ? ' · 움직임 줄이기 설정이라 정지' : ''}</p>}
    </div>
  )
}

function IbfvControls({ params, setParams }: ControlsProps<IbfvParams>) {
  return (
    <ControlGroup title="흐름 질감">
      <Toggle label="움직이기" checked={params.playing} onChange={(playing) => setParams({ playing })} testId="ctl-playing" />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ nonce: params.nonce + 1 })} data-testid="ibfv-restart">처음부터 다시</button>
      <Slider label="이동 속도 (한 단계당 최대 픽셀)" value={params.speed} min={0.3} max={4} step={0.1} onChange={(speed) => setParams({ speed })} format={(v) => v.toFixed(1)} testId="ctl-speed" />
      <Slider label="새 노이즈 섞는 비율" value={params.alpha} min={0.02} max={0.4} step={0.01} onChange={(alpha) => setParams({ alpha })} format={(v) => v.toFixed(2)} testId="ctl-alpha" />
      <Slider label="질감 알갱이 크기 (픽셀)" value={params.cell} min={2} max={14} onChange={(cell) => setParams({ cell })} testId="ctl-cell" />
      <Slider label="같은 노이즈를 유지하는 단계 수 (줄무늬 길이)" value={params.hold} min={1} max={24} onChange={(hold) => setParams({ hold })} testId="ctl-hold" />
      <Slider label="계산 해상도 (한 변 픽셀)" value={params.res} min={80} max={260} step={10} onChange={(res) => setParams({ res })} testId="ctl-res" />
      <Slider label="시드" value={params.seed} min={1} max={30} onChange={(seed) => setParams({ seed })} testId="ctl-seed" />
      <Toggle label="벡터장 화살표 겹치기" checked={params.arrows} onChange={(arrows) => setParams({ arrows })} testId="ctl-arrows" />
      <Hint>매 단계마다 이전 영상을 흐름의 상류 쪽에서 가져와 옮기고(이류, 쌍선형 보간), 새 노이즈를 조금 섞습니다. 그러면 노이즈가 흐름을 따라 늘어난 줄무늬가 되어 질감이 흐름 방향으로 흐릅니다. 줄무늬가 흐름과 나란한지, 속도가 빠른 곳에서 더 빨리 움직이는지 확인해 보세요. LIC처럼 선적분을 한 번에 계산하지 않고 단계마다 질감을 옮기며 누적하는 방식이라 애니메이션이 자연스럽습니다. 이 구현은 CPU 계산이고 원 논문의 GPU 메시 변형·타일링 노이즈는 쓰지 않습니다.</Hint>
    </ControlGroup>
  )
}

export const ibfvModule: VizModule<IbfvParams> = {
  roles: [
    { key: 'x', label: 'x', type: 'number', required: true, prefer: '^x' }, { key: 'y', label: 'y', type: 'number', required: true, prefer: '^y' },
    { key: 'u', label: 'u (x 성분)', type: 'number', required: true, prefer: '^u' }, { key: 'v', label: 'v (y 성분)', type: 'number', required: true, prefer: '^v' },
  ],
  datasets: ['flow-2d'],
  defaultParams: { speed: 1.6, alpha: 0.08, cell: 3, hold: 14, res: 200, seed: 3, playing: true, arrows: false, nonce: 0 },
  Chart: IbfvChart,
  Controls: IbfvControls,
  hint: '질감이 흐름을 따라 움직입니다 · 알갱이 크기와 유지 단계로 줄무늬 모양을 조절 · 화살표를 겹쳐 방향 확인',
}

// ───────────────────────────── Hyperstreamlines ─────────────────────────────

const tensorRoles: RoleSpec[] = [
  { key: 'x', label: 'x', type: 'number', required: true, prefer: '^x' }, { key: 'y', label: 'y', type: 'number', required: true, prefer: '^y' }, { key: 'z', label: 'z', type: 'number', required: true, prefer: '^z' },
  { key: 'tensor', label: '텐서 성분 6개 (xx, yy, zz, xy, xz, yz)', type: 'number', required: true, multiple: { min: 6, max: 6 } },
]

export interface HyperParams extends ViewParams { seeds: number; sy: number; sz: number; length: number; step: number; steps: number; axis: 0 | 1 | 2; scale: number; sides: number; color: 'major' | 'fa' }

function useTensorField(table: ChartProps<HyperParams>['table'], mapping: ChartProps<HyperParams>['mapping']) {
  return useMemo(() => {
    const names = roleColumns(mapping, 'tensor')
    const xi = columnIndex(table, roleColumn(mapping, 'x')), yi = columnIndex(table, roleColumn(mapping, 'y')), zi = columnIndex(table, roleColumn(mapping, 'z')), ti = names.map((n) => columnIndex(table, n))
    if (xi < 0 || yi < 0 || zi < 0 || ti.length < 6 || ti.some((i) => i < 0)) return null
    const rows: { x: number; y: number; z: number; t: number[] }[] = []
    for (const r of table.rows) { const p = [xi, yi, zi].map((i) => toNumber(r[i])), t = ti.map((i) => toNumber(r[i])); if (p.every((v) => v != null) && t.every((v) => v != null)) rows.push({ x: p[0]!, y: p[1]!, z: p[2]!, t: t as number[] }) }
    return tensorFieldFromRows(rows)
  }, [table, mapping])
}

function HyperChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<HyperParams>) {
  const field = useTensorField(table, mapping)
  const built = useMemo(() => {
    if (!field) return null
    const g = field.comps[0]
    const cm = cubeMap(g)
    const ext: V3 = [(g.nx - 1) * g.dx, (g.ny - 1) * g.dy, (g.nz - 1) * g.dz]
    const n = Math.max(1, params.seeds)
    const lines = Array.from({ length: n }, (_, i) => {
      const x = g.x0 + ext[0] * (0.5 + 0.1) + (n === 1 ? 0 : (i / (n - 1)) * ext[0] * params.length * 0.8)
      const seed: V3 = [x, g.y0 + ext[1] * params.sy, g.z0 + ext[2] * params.sz]
      return hyperstreamline(field, seed, params.axis, params.step * Math.min(g.dx, g.dy, g.dz) * 2, compact ? 80 : params.steps)
    }).filter((l) => l.length > 3)
    const lmax = Math.max(1e-9, ...lines.flatMap((l) => l.map((s) => s.values[0])))
    const tubes = lines.map((l) => hypertube(l, params.scale * 0.02 * (Math.min(...ext) / Math.max(1e-9, lmax)) * 2, compact ? 6 : params.sides))
    return { cm, lines, tubes, lmax, ext }
  }, [field, params.seeds, params.sy, params.sz, params.length, params.step, params.steps, params.axis, params.scale, params.sides, compact])
  if (!field) return <ChartMessage>x, y, z 좌표와 대칭 텐서 성분 6개(xx, yy, zz, xy, xz, yz)를 고르세요. 규칙적인 3차원 격자여야 합니다.</ChartMessage>
  if (!built || !built.lines.length) return <ChartMessage>이 시드에서는 경로가 만들어지지 않습니다(텐서가 등방성이거나 경계 밖). 시드 위치를 옮기세요.</ChartMessage>
  const { cm, lines, tubes, lmax } = built
  const draw = (ctx: CanvasRenderingContext2D, proj: Projector) => {
    const quads: Quad[] = []
    tubes.forEach((tube, ti) => {
      const P = tube.rings.map((ring) => ring.map((v) => proj(cm.norm(v))))
      const W = tube.rings.map((ring) => ring.map((v) => cm.norm(v)))
      for (const q of tube.quads) {
        const [ia, ja] = q.a, [ib, jb] = q.b, [ic, jc] = q.c, [id, jd] = q.d
        const pts = [P[ia][ja], P[ib][jb], P[ic][jc], P[id][jd]]
        const s = lines[ti][ia]
        const t = params.color === 'major' ? s.values[0] / lmax : (s.values[0] - s.values[2]) / (s.values[0] + s.values[1] + s.values[2] || 1)
        const rgb = hexRgb(schemes.viridis.interpolate(0.1 + 0.85 * Math.min(1, Math.max(0, t))))
        quads.push({ pts: pts.map((p) => [p.x, p.y] as [number, number]), depth: (pts[0].depth + pts[1].depth + pts[2].depth + pts[3].depth) / 4, fill: shade(rgb, lit(W[ia][ja], W[ib][jb], W[id][jd])) })
      }
    })
    drawQuads(ctx, quads, 0.3)
  }
  return (
    <Scene3D width={width} height={height} compact={compact} params={params} setParams={setParams} label={`하이퍼스트림라인: 고유벡터를 따르는 단면 튜브 ${tubes.length}개`} draw={draw} fit={0.42} box={cm.box}
      drawKey={`${tubes.length}|${tubes[0].rings.length}|${params.color}|${params.axis}|${params.scale}|${params.sides}|${params.seeds}|${params.sy}|${params.sz}|${params.length}|${params.step}|${params.steps}`}
      overlay={(proj) => (
        <g pointerEvents="none">{lines.map((l, i) => { const p = proj(cm.norm(l[Math.floor(l.length / 2)].p)); return <circle key={i} cx={p.x} cy={p.y} r={compact ? 1.5 : 3} fill="#d4452f" data-testid="hyper-seed" /> })}</g>
      )}
      readout={[{ label: '튜브', value: `${tubes.length}개` }, { label: '최대 λ₁', value: fmt(lmax, 3) }, { label: '추적 고유벡터', value: ['주(λ₁)', '중간(λ₂)', '최소(λ₃)'][params.axis] }]}
      note="튜브 중심은 고유벡터를 따르는 경로, 단면은 나머지 두 고유값에 비례하는 타원, 색은 주 고유값(또는 FA)" />
  )
}

function HyperControls({ params, setParams }: ControlsProps<HyperParams>) {
  return (
    <>
      <ControlGroup title="경로 (시드)">
        <Segmented label="따라갈 고유벡터" value={String(params.axis)} onChange={(v) => setParams({ axis: Number(v) as 0 | 1 | 2 })} options={[{ value: '0', label: '주 (λ₁)' }, { value: '1', label: '중간 (λ₂)' }, { value: '2', label: '최소 (λ₃)' }]} testId="ctl-axis" />
        <Slider label="시드 수" value={params.seeds} min={1} max={10} onChange={(seeds) => setParams({ seeds })} testId="ctl-seeds" />
        <Slider label="시드 y 위치 (0~1)" value={params.sy} min={0.05} max={0.95} step={0.01} onChange={(sy) => setParams({ sy })} format={(v) => v.toFixed(2)} testId="ctl-sy" />
        <Slider label="시드 z 위치 (0~1)" value={params.sz} min={0.05} max={0.95} step={0.01} onChange={(sz) => setParams({ sz })} format={(v) => v.toFixed(2)} testId="ctl-sz" />
        <Slider label="시드 선 길이" value={params.length} min={0.1} max={1} step={0.05} onChange={(length) => setParams({ length })} format={(v) => v.toFixed(2)} testId="ctl-length" />
        <Slider label="적분 간격" value={params.step} min={0.1} max={1} step={0.05} onChange={(step) => setParams({ step })} format={(v) => v.toFixed(2)} testId="ctl-step" />
        <Slider label="적분 단계 수" value={params.steps} min={20} max={300} step={10} onChange={(steps) => setParams({ steps })} testId="ctl-steps" />
      </ControlGroup>
      <ControlGroup title="튜브">
        <Slider label="단면 크기" value={params.scale} min={0.2} max={3} step={0.1} onChange={(scale) => setParams({ scale })} format={(v) => v.toFixed(1)} testId="ctl-scale" />
        <Slider label="둘레 분할 수" value={params.sides} min={6} max={24} onChange={(sides) => setParams({ sides })} testId="ctl-sides" />
        <Segmented label="색" value={params.color} onChange={(color) => setParams({ color })} options={[{ value: 'major', label: '주 고유값' }, { value: 'fa', label: '이방성(FA)' }]} testId="ctl-color" />
        <Hint>위치마다 대칭 텐서를 보간해 고유분해하고, 선택한 고유벡터 방향으로 경로를 적분합니다(2차 룽게–쿠타, 고유벡터는 부호가 없으므로 이전 방향과 이어지게 부호를 맞춤). 경로를 따라 나머지 두 고유벡터가 이루는 평면에 타원 단면을 두고 반축을 두 고유값에 비례시켜 한 줄의 연속적인 관으로 텐서 전체를 나타냅니다. 타원 글리프(Tensor Glyph)처럼 점마다 따로 그리지 않고 경로를 따라 변하는 크기와 모양을 이어서 봅니다. 이 구현은 대칭 텐서만 다루고 특이점(고유값이 같은 곳)에서 경로를 멈춥니다.</Hint>
      </ControlGroup>
      <ViewControls params={params} setParams={setParams} />
    </>
  )
}

export const hyperModule: VizModule<HyperParams> = {
  roles: tensorRoles,
  datasets: ['tensor-twist', 'tensor-dti'],
  defaultParams: { yaw: -30, pitch: 38, zoom: 0.95, seeds: 4, sy: 0.5, sz: 0.5, length: 0.5, step: 0.5, steps: 45, axis: 0, scale: 1, sides: 12, color: 'major' },
  Chart: HyperChart,
  Controls: HyperControls,
  hint: '시드 위치를 옮기고 따라갈 고유벡터(주·중간·최소)를 바꿔 보세요 · 화면을 끌어 회전',
}

// ───────────────────────────── Fiber surfaces ─────────────────────────────

export interface FiberParams extends ViewParams { poly: Pt[]; opacity: number; wire: boolean }

const FIBER_DEFAULT: Pt[] = [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]]

const fiberRoles: RoleSpec[] = [
  { key: 'x', label: 'x', type: 'number', required: true, prefer: '^x' }, { key: 'y', label: 'y', type: 'number', required: true, prefer: '^y' }, { key: 'z', label: 'z', type: 'number', required: true, prefer: '^z' },
  { key: 'f1', label: '스칼라장 1 (범위 평면 가로축)', type: 'number', required: true, prefer: '온도|f1' },
  { key: 'f2', label: '스칼라장 2 (범위 평면 세로축)', type: 'number', required: true, prefer: '농도|f2' },
]

function useBivariate(table: ChartProps<FiberParams>['table'], mapping: ChartProps<FiberParams>['mapping']) {
  return useMemo(() => {
    const idx = ['x', 'y', 'z', 'f1', 'f2'].map((k) => columnIndex(table, roleColumn(mapping, k)))
    if (idx.some((i) => i < 0)) return null
    const rows: { x: number; y: number; z: number; a: number; b: number }[] = []
    for (const r of table.rows) { const v = idx.map((i) => toNumber(r[i])); if (v.every((x) => x != null)) rows.push({ x: v[0]!, y: v[1]!, z: v[2]!, a: v[3]!, b: v[4]! }) }
    const g1 = gridFromRows(rows.map((r) => ({ x: r.x, y: r.y, z: r.z, v: r.a }))), g2 = gridFromRows(rows.map((r) => ({ x: r.x, y: r.y, z: r.z, v: r.b })))
    return g1 && g2 ? { g1, g2 } : null
  }, [table, mapping])
}

/** The polygon is stored in 0…1 units of each field's own range. */
const toRange = (g: Grid3, p: number) => g.min + p * (g.max - g.min)

function FiberChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<FiberParams>) {
  const data = useBivariate(table, mapping)
  const poly = params.poly.length >= 3 ? params.poly : FIBER_DEFAULT
  const mesh = useMemo(() => {
    if (!data) return null
    const P = poly.map(([a, b]) => [toRange(data.g1, a), toRange(data.g2, b)] as Pt)
    return fiberSurface(data.g1, data.g2, P)
  }, [data, poly])
  if (!data) return <ChartMessage>x, y, z 좌표와 스칼라장 두 개를 고르세요. 규칙적인 3차원 격자여야 합니다.</ChartMessage>
  const cm = cubeMap(data.g1)
  const draw = (ctx: CanvasRenderingContext2D, proj: Projector) => {
    if (!mesh) return
    const quads: Quad[] = []
    const rgb = hexRgb('#2a8c82')
    for (const [a, b, c] of mesh.tris) {
      const A = cm.norm(mesh.verts[a]), B = cm.norm(mesh.verts[b]), C = cm.norm(mesh.verts[c])
      const pa = proj(A), pb = proj(B), pc = proj(C)
      const f = shade(rgb, lit(A, B, C))
      quads.push({ pts: [[pa.x, pa.y], [pb.x, pb.y], [pc.x, pc.y]], depth: (pa.depth + pb.depth + pc.depth) / 3, fill: f, stroke: params.wire ? 'rgba(20,50,48,0.5)' : f })
    }
    ctx.globalAlpha = params.opacity
    drawQuads(ctx, quads, 0.4)
    ctx.globalAlpha = 1
  }
  return (
    <Scene3D width={width} height={height} compact={compact} params={params} setParams={setParams} label={`Fiber Surface: 범위 평면 다각형 ${poly.length}각형의 역상, 삼각형 ${mesh?.tris.length ?? 0}개`} draw={draw} fit={0.42} box={cm.box}
      drawKey={`${mesh?.tris.length}|${poly.map((p) => p.join()).join(';')}|${params.opacity}|${params.wire}`}
      readout={[{ label: '삼각형', value: `${mesh?.tris.length ?? 0}개` }, { label: '다각형 꼭짓점', value: `${poly.length}개` }]}
      note="곡면 위 모든 점은 두 스칼라장의 값 쌍이 범위 평면의 다각형 경계에 놓입니다" />
  )
}

/** Range plot with a draggable polygon: the horizontal axis is field 1, the vertical field 2, and the dots are the samples of the volume. */
function RangeEditor({ params, setParams, table, mapping }: ControlsProps<FiberParams>) {
  const data = useBivariate(table, mapping)
  const ref = useRef<SVGSVGElement>(null)
  const drag = useRef(-1)
  const poly = params.poly.length >= 3 ? params.poly : FIBER_DEFAULT
  if (!data) return null
  const S = 220, pad = 12
  const to = (p: Pt): Pt => [pad + p[0] * (S - 2 * pad), pad + (1 - p[1]) * (S - 2 * pad)]
  const from = (e: RPointerEvent): Pt => {
    const r = ref.current!.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * S, y = ((e.clientY - r.top) / r.height) * S
    return [Math.min(1, Math.max(0, (x - pad) / (S - 2 * pad))), Math.min(1, Math.max(0, 1 - (y - pad) / (S - 2 * pad)))]
  }
  const samples = data.g1.data.length > 4000 ? Math.ceil(data.g1.data.length / 4000) : 1
  const dots: Pt[] = []
  for (let i = 0; i < data.g1.data.length; i += samples) dots.push([(data.g1.data[i] - data.g1.min) / (data.g1.max - data.g1.min || 1), (data.g2.data[i] - data.g2.min) / (data.g2.max - data.g2.min || 1)])
  return (
    <svg ref={ref} width="100%" viewBox={`0 0 ${S} ${S}`} style={{ maxWidth: 260, touchAction: 'none', background: '#fafcfc', border: '1px solid #e5eaea', borderRadius: 6 }} data-testid="range-plot"
      onPointerMove={(e) => { if (drag.current >= 0) setParams({ poly: poly.map((p, i) => (i === drag.current ? from(e) : p)) }) }} onPointerUp={() => { drag.current = -1 }} onPointerLeave={() => { drag.current = -1 }}>
      {dots.map((d, i) => <circle key={i} cx={to(d)[0]} cy={to(d)[1]} r={1.1} fill="#9aa6a6" opacity={0.35} />)}
      <polygon points={poly.map((p) => to(p).join()).join(' ')} fill="#2a8c82" fillOpacity={0.14} stroke="#2a8c82" strokeWidth={2} />
      {poly.map((p, i) => <circle key={i} cx={to(p)[0]} cy={to(p)[1]} r={7} fill="#fff" stroke="#1f6f67" strokeWidth={2.4} style={{ cursor: 'grab' }} data-testid={`range-vertex-${i}`}
        onPointerDown={(e) => { drag.current = i; (e.currentTarget as Element).closest('svg')?.setPointerCapture(e.pointerId); e.preventDefault() }} />)}
      <text x={S / 2} y={S - 1} textAnchor="middle" fontSize={9} fill="#6b7280">스칼라장 1 →</text>
      <text x={7} y={S / 2} fontSize={9} fill="#6b7280" transform={`rotate(-90 7 ${S / 2})`} textAnchor="middle">스칼라장 2 →</text>
    </svg>
  )
}

function FiberControls({ params, setParams, table, mapping, setTable }: ControlsProps<FiberParams>) {
  const preset = (poly: Pt[]) => setParams({ poly })
  return (
    <>
      <ControlGroup title="범위 평면의 다각형">
        <RangeEditor params={params} setParams={setParams} table={table} mapping={mapping} setTable={setTable} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <button type="button" className="btn btn-secondary btn-sm" data-testid="fiber-square" onClick={() => preset(FIBER_DEFAULT)}>사각형</button>
          <button type="button" className="btn btn-secondary btn-sm" data-testid="fiber-triangle" onClick={() => preset([[0.2, 0.2], [0.8, 0.3], [0.45, 0.85]])}>삼각형</button>
          <button type="button" className="btn btn-secondary btn-sm" data-testid="fiber-band" onClick={() => preset([[0.45, 0.05], [0.55, 0.05], [0.55, 0.95], [0.45, 0.95]])}>가는 띠 (등값면에 가까움)</button>
        </div>
        <Slider label="불투명도" value={params.opacity} min={0.3} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} testId="ctl-opacity" />
        <Toggle label="격자선 표시" checked={params.wire} onChange={(wire) => setParams({ wire })} testId="ctl-wire" />
        <Hint>두 스칼라장 (f₁, f₂)의 값 쌍을 평면의 한 점으로 보는 ‘범위 평면’ 위에 다각형을 그리면, 값 쌍이 그 다각형의 경계 위에 있는 3차원 점들이 모여 곡면(파이버 곡면)을 이룹니다. 점은 부피 표본의 값 쌍이고, 다각형 꼭짓점을 끌어 곡면이 어떻게 바뀌는지 봅니다. 각 사면체에서 다각형 변마다의 평면을 구하고 그 변의 길이만큼 잘라 이어 붙입니다. 하나의 값 기준인 등값면(Isosurface)은 가는 띠로 근사됩니다. 이 구현은 사면체마다 독립된 삼각형을 그리며(꼭짓점 공유·용접 없음) 매우 큰 격자는 셀 수를 제한합니다.</Hint>
      </ControlGroup>
      <ViewControls params={params} setParams={setParams} />
    </>
  )
}

export const fiberModule: VizModule<FiberParams> = {
  roles: fiberRoles,
  datasets: ['bivariate-volume'],
  defaultParams: { yaw: -35, pitch: 30, zoom: 0.95, poly: FIBER_DEFAULT, opacity: 0.85, wire: false },
  Chart: FiberChart,
  Controls: FiberControls,
  hint: '범위 평면의 다각형 꼭짓점을 끌어 곡면을 바꿉니다 · 화면을 끌어 회전',
}
