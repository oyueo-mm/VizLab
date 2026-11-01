import { useMemo } from 'react'
import { ChartMessage } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, type DataTable } from '../../data/table'
import { fmt } from '../../lib/format'
import { FLOWS, integrate, lyapunov, poincareSection, type FlowId, type V3 } from '../../stats/physics'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, RoleSpec, VizModule } from '../types'
import { ViewControls, type ViewParams } from './geo3dCharts'
import { XYPlot, type Layer } from './kit'
import { Scene3D } from './kit3d'
import type { Projector } from './scene3d'
import { schemes } from '../../lib/colors'

/** Chaotic flows: 3-D strange attractors and their Poincaré sections / return maps. Parameters come from the table (name, value). */

const paramRoles: RoleSpec[] = [
  { key: 'name', label: '모수 이름', type: 'category', required: true },
  { key: 'value', label: '값', type: 'number', required: true },
]

function readParams(table: DataTable, mapping: Mapping, id: FlowId): number[] {
  const ni = columnIndex(table, roleColumn(mapping, 'name')), vi = columnIndex(table, roleColumn(mapping, 'value'))
  const byName = new Map<string, number>()
  if (ni >= 0 && vi >= 0) for (const r of table.rows) { const v = toNumber(r[vi]); if (v != null) byName.set(toLabel(r[ni]).trim(), v) }
  return FLOWS[id].params.map((p) => byName.get(p.key) ?? p.def)
}

const flowOptions = (Object.keys(FLOWS) as FlowId[]).map((id) => ({ value: id, label: FLOWS[id].name }))

// ─── strange attractor ──────────────────────────────────────────────────────────────

export interface AttractorParams extends ViewParams { system: FlowId; steps: number; color: 'time' | 'speed'; twin: boolean; twinEps: number; line: number }

function AttractorChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<AttractorParams>) {
  const flow = FLOWS[params.system] ?? FLOWS.lorenz
  const p = useMemo(() => readParams(table, mapping, params.system), [table, mapping, params.system])
  const steps = compact ? Math.min(4000, params.steps) : params.steps
  const traj = useMemo(() => integrate(flow, p, flow.start, flow.dt, steps, Math.round(30 / flow.dt / 10)), [flow, p, steps])
  const twin = useMemo(() => (params.twin ? integrate(flow, p, [flow.start[0] + 10 ** params.twinEps, flow.start[1], flow.start[2]], flow.dt, steps, Math.round(30 / flow.dt / 10)) : null), [flow, p, steps, params.twin, params.twinEps])
  const lyap = useMemo(() => (compact ? NaN : lyapunov(flow, p, flow.start, flow.dt, 25000, 2000)), [flow, p, compact])
  const norm = (s: V3): V3 => [(s[0] - flow.center[0]) / flow.extent[0], (s[1] - flow.center[1]) / flow.extent[1], (s[2] - flow.center[2]) / flow.extent[2]]
  const speeds = useMemo(() => traj.map((s) => Math.hypot(...flow.f(p, s))), [traj, flow, p])
  const smax = Math.max(...speeds, 1e-9)
  const diverged = Math.max(...traj.map((s) => Math.hypot(...s))) > 1e5 || traj.some((s) => !Number.isFinite(s[0]))
  const draw = (ctx: CanvasRenderingContext2D, proj: Projector) => {
    const pts = traj.map((s) => proj(norm(s)))
    ctx.lineCap = 'round'; ctx.lineWidth = params.line
    const col = schemes.viridis
    const chunk = Math.max(4, Math.floor(traj.length / 400))
    for (let i = 0; i < pts.length - 1; i += chunk) {
      const t = params.color === 'time' ? i / pts.length : Math.min(1, speeds[i] / smax)
      ctx.strokeStyle = col.interpolate(0.1 + 0.85 * t)
      ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y)
      for (let k = i + 1; k <= Math.min(i + chunk, pts.length - 1); k++) ctx.lineTo(pts[k].x, pts[k].y)
      ctx.stroke()
    }
    if (twin) {
      ctx.strokeStyle = 'rgba(225,29,72,.8)'; ctx.lineWidth = params.line
      ctx.beginPath()
      twin.forEach((s, i) => { const q = proj(norm(s)); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y) })
      ctx.stroke()
    }
  }
  if (diverged) return <ChartMessage>궤적이 발산했습니다. 모수 값을 확인하세요 (표의 ‘{flow.params[0].key}’ 등).</ChartMessage>
  const gap = twin ? Math.hypot(...traj[traj.length - 1].map((v, i) => v - twin[twin.length - 1][i])) : 0
  return (
    <Scene3D width={width} height={height} compact={compact} params={params} setParams={setParams} label={`${flow.name}의 끌개: ${traj.length}점`} draw={draw} fit={0.42}
      drawKey={`${params.system}|${p.join(',')}|${steps}|${params.color}|${params.twin}|${params.twinEps}|${params.line}`}
      labels={[{ at: [1, -1, -1], text: 'x', anchor: 'start' }, { at: [-1, 1, -1], text: 'y', anchor: 'end' }, { at: [-1, -1, 1], text: 'z', anchor: 'end' }]}
      readout={[{ label: '계', value: flow.name }, { label: '최대 리아푸노프 지수', value: Number.isFinite(lyap) ? fmt(lyap, 3) : '–' }, ...(twin ? [{ label: '쌍둥이 궤적 거리', value: fmt(gap, 2) }] : [])]}
      note={twin ? '빨간 선 = 초기값을 10^' + params.twinEps + '만큼 바꾼 궤적' : '색 = ' + (params.color === 'time' ? '시간' : '속력')} />
  )
}

function AttractorControls({ params, setParams, table, mapping }: ControlsProps<AttractorParams>) {
  const flow = FLOWS[params.system] ?? FLOWS.lorenz
  const vals = readParams(table, mapping, params.system)
  return (
    <>
      <ControlGroup title="동역학계">
        <Select label="계" value={params.system} options={flowOptions} onChange={(system) => setParams({ system })} testId="ctl-system" />
        <Slider label="궤적 길이 (적분 단계)" value={params.steps} min={2000} max={60000} step={2000} onChange={(steps) => setParams({ steps })} testId="ctl-steps" />
        <Segmented label="색" value={params.color} onChange={(color) => setParams({ color })} testId="ctl-color" options={[{ value: 'time', label: '시간' }, { value: 'speed', label: '속력' }]} />
        <Slider label="선 굵기" value={params.line} min={0.4} max={2.5} step={0.1} onChange={(line) => setParams({ line })} testId="ctl-line" />
        <Toggle label="초기값을 조금 바꾼 쌍둥이 궤적" checked={params.twin} onChange={(twin) => setParams({ twin })} testId="ctl-twin" />
        {params.twin && <Slider label="초기값 차이 10^x" value={params.twinEps} min={-10} max={-2} onChange={(twinEps) => setParams({ twinEps })} testId="ctl-eps" />}
        <p className="hint" style={{ margin: '4px 0 0' }}>{flow.params.map((q, i) => `${q.key} = ${fmt(vals[i], 3)}`).join(' · ')} (표에서 바꿉니다)</p>
        <Hint>미분방정식을 4차 룽게–쿠타로 적분한 실제 궤적입니다(과도 구간은 버립니다). 초기값을 조금만 바꿔도 두 궤적이 지수적으로 멀어지는 것이 혼돈의 특징이며, 그 속도가 최대 리아푸노프 지수(Benettin 방법으로 추정)입니다. 표의 모수(예: 로렌츠 ρ)를 바꾸면 혼돈에서 주기 운동으로 바뀌는 구간도 볼 수 있습니다.</Hint>
      </ControlGroup>
      <ViewControls params={params} setParams={setParams} />
    </>
  )
}

export const attractorModule: VizModule<AttractorParams> = {
  roles: paramRoles, datasets: ['attractor-params'], defaultParams: { yaw: -40, pitch: 30, zoom: 1.2, system: 'lorenz', steps: 20000, color: 'time', twin: false, twinEps: -6, line: 0.9 },
  Chart: AttractorChart, Controls: AttractorControls, hint: '끌어서 돌려 보세요 · 쌍둥이 궤적을 켜면 초기값의 작은 차이가 어떻게 벌어지는지 보입니다 · 표의 모수를 바꿔 혼돈이 사라지는 지점을 찾아보세요',
}

// ─── Poincaré section ───────────────────────────────────────────────────────────────

export interface PoincareParams { system: FlowId; axis: 0 | 1 | 2; level: number; direction: 1 | -1; map: boolean; orbit: boolean; steps: number }
const AXES = ['x', 'y', 'z']

function PoincareChart({ table, mapping, params, width, height, compact }: ChartProps<PoincareParams>) {
  const flow = FLOWS[params.system] ?? FLOWS.lorenz
  const p = useMemo(() => readParams(table, mapping, params.system), [table, mapping, params.system])
  const steps = compact ? 20000 : params.steps
  const traj = useMemo(() => integrate(flow, p, flow.start, flow.dt, steps, Math.round(30 / flow.dt / 10)), [flow, p, steps])
  const level = flow.center[params.axis] + params.level * flow.extent[params.axis]
  const sec = useMemo(() => poincareSection(traj, params.axis, level, params.direction), [traj, params.axis, level, params.direction])
  const others = [0, 1, 2].filter((k) => k !== params.axis)
  if (traj.some((s) => !Number.isFinite(s[0]))) return <ChartMessage>궤적이 발산했습니다. 모수 값을 확인하세요.</ChartMessage>
  const dim = (k: number) => AXES[k]
  const layers: Layer[] = []
  if (params.map) {
    const w = sec.map((q) => q.v)
    layers.push({ kind: 'line', x: [Math.min(...w), Math.max(...w)], y: [Math.min(...w), Math.max(...w)], color: '#9aa1a9', dash: '5 4', width: 1.2 })
    layers.push({ kind: 'points', r: 3, color: '#2a8c82', pts: w.slice(0, -1).map((v, i) => ({ x: v, y: w[i + 1], key: String(i), tip: <><b>{i + 1}번째 → {i + 2}번째 통과</b><br />{dim(others[1])}ₙ = {fmt(v, 3)}<br />{dim(others[1])}ₙ₊₁ = {fmt(w[i + 1], 3)}</> })) })
  } else {
    if (params.orbit) layers.push({ kind: 'line', x: traj.slice(0, 6000).map((s) => s[others[0]]), y: traj.slice(0, 6000).map((s) => s[others[1]]), color: '#cbd5d3', width: 0.7, opacity: 0.8 })
    layers.push({ kind: 'points', r: compact ? 1.5 : 2.6, opacity: 0.8, pts: sec.map((q, i) => ({ x: q.u, y: q.v, key: String(i), color: schemes.viridis.interpolate(i / Math.max(1, sec.length - 1)), tip: <><b>{i + 1}번째 통과</b><br />{dim(others[0])} = {fmt(q.u, 3)}<br />{dim(others[1])} = {fmt(q.v, 3)}</> })) })
  }
  return (
    <XYPlot layers={layers} width={width} height={height} compact={compact} xLabel={params.map ? `${dim(others[1])}ₙ` : dim(others[0])} yLabel={params.map ? `${dim(others[1])}ₙ₊₁` : dim(others[1])} equal={params.map}
      title={`푸앵카레 단면: ${flow.name}, ${dim(params.axis)} = ${fmt(level, 2)}`}
      readout={[{ label: '단면 통과 수', value: sec.length }, { label: '단면', value: `${dim(params.axis)} = ${fmt(level, 2)} (${params.direction === 1 ? '증가' : '감소'} 방향)` }]}
      note={params.map ? '점이 한 곡선 위에 놓이면 1차원 사상으로 결정론적 혼돈을 설명할 수 있습니다' : '연속 흐름을 평면 위 점들의 이산 사상으로 바꿉니다'} />
  )
}

function PoincareControls({ params, setParams, table, mapping }: ControlsProps<PoincareParams>) {
  const flow = FLOWS[params.system] ?? FLOWS.lorenz
  const vals = readParams(table, mapping, params.system)
  return (
    <ControlGroup title="단면">
      <Select label="계" value={params.system} options={flowOptions} onChange={(system) => setParams({ system, level: system === 'lorenz' ? -0.05 : 0 })} testId="ctl-system" />
      <Segmented label="단면 축" value={String(params.axis)} onChange={(v) => setParams({ axis: Number(v) as 0 | 1 | 2 })} testId="ctl-axis" options={[{ value: '0', label: 'x' }, { value: '1', label: 'y' }, { value: '2', label: 'z' }]} />
      <Slider label="단면 위치 (범위의 비율)" value={params.level} min={-1} max={1} step={0.02} onChange={(level) => setParams({ level })} testId="ctl-level" format={(v) => `${v.toFixed(2)}`} />
      <Segmented label="통과 방향" value={String(params.direction)} onChange={(v) => setParams({ direction: Number(v) as 1 | -1 })} testId="ctl-direction" options={[{ value: '1', label: '증가' }, { value: '-1', label: '감소' }]} />
      <Slider label="적분 단계" value={params.steps} min={20000} max={300000} step={20000} onChange={(steps) => setParams({ steps })} testId="ctl-steps" />
      <Toggle label="귀환 사상 (이전 통과 → 다음 통과)" checked={params.map} onChange={(map) => setParams({ map })} testId="ctl-map" />
      {!params.map && <Toggle label="궤적 투영 겹치기" checked={params.orbit} onChange={(orbit) => setParams({ orbit })} />}
      <p className="hint" style={{ margin: '4px 0 0' }}>{flow.params.map((q, i) => `${q.key} = ${fmt(vals[i], 3)}`).join(' · ')}</p>
      <Hint>3차원 흐름이 정한 평면을 한 방향으로 가로지르는 점(두 샘플 사이를 선형 보간)만 모읍니다. 주기 궤도는 유한한 점으로, 준주기 운동은 닫힌 곡선으로, 혼돈은 프랙탈 구조의 점 구름으로 나타납니다. 귀환 사상은 이번 통과 위치로 다음 통과 위치를 예측하는 1차원 함수이며, 뢰슬러 계에서는 한 개의 볼록 곡선이라 로지스틱 사상과 같은 주기 배가 경로를 설명합니다.</Hint>
    </ControlGroup>
  )
}

export const poincareModule: VizModule<PoincareParams> = {
  roles: paramRoles, datasets: ['attractor-params'], defaultParams: { system: 'rossler', axis: 0, level: 0, direction: 1, map: false, orbit: true, steps: 120000 },
  Chart: PoincareChart, Controls: PoincareControls, hint: '단면 위치와 방향을 바꿔 보세요 · 귀환 사상을 켜면 혼돈이 1차원 곡선으로 요약됩니다 · 표의 모수를 바꿔 주기 배가를 관찰하세요',
}

