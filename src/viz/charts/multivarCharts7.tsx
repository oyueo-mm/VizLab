import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { fmt } from '../../lib/format'
import { useReducedMotion } from '../../hooks/motion'
import { anchorAngle, defaultAxes, project, radviz, starCoordinates, tourFrame } from '../../stats/multivar7'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { MULTIVAR_DATASETS, enabledVars, multivarRoles, useObs, type Obs } from './kit7'
import { roleColumns } from '../mapping'

const MARGIN = 54

function Legend7({ obs, highlight, onPick }: { obs: Obs; highlight: string; onPick: (g: string) => void }) {
  if (!obs.groupNames.length) return null
  return (
    <div className="chart-legend" aria-label="그룹">
      {obs.groupNames.map((g) => (
        <button key={g} type="button" className={`legend-item ${highlight && highlight !== g ? 'is-off' : ''}`} onClick={() => onPick(highlight === g ? '' : g)} data-testid={`legend-${g}`}>
          <span className="legend-swatch" style={{ background: obs.color(g), borderColor: obs.color(g) }} />{g}
        </button>
      ))}
    </div>
  )
}

function VarSwitches({ obs, off, onChange }: { obs: { vars: string[] }; off: string[]; onChange: (off: string[]) => void }) {
  return (
    <ControlGroup title="변수 선택">
      {obs.vars.map((v) => <Toggle key={v} label={v} checked={!off.includes(v)} onChange={(on) => onChange(on ? off.filter((x) => x !== v) : [...off, v])} testId={`var-${v}`} />)}
    </ControlGroup>
  )
}

/** Variable names for the controls (they only get the mapping, not the observations). */
const useVarNames = (mapping: ControlsProps<unknown>['mapping']) => ({ vars: roleColumns(mapping, 'vars') })

// ───────────────────────────── RadViz ─────────────────────────────

export interface RadvizParams { norm: 'minmax' | 'zscore'; off: string[]; angles: Record<string, number>; highlight: string; size: number; opacity: number; labels: boolean }

function RadvizChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<RadvizParams>) {
  const obs = useObs(table, mapping, params.norm)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef<string | null>(null)
  const idx = enabledVars(obs, params.off)
  const marked = new Set(linked?.rows ?? [])
  const angles = idx.map((j, k) => params.angles[obs.vars[j]] ?? anchorAngle(k, idx.length))
  const pts = useMemo(() => radviz(obs.norm.map((r) => idx.map((j) => r[j])), angles), [obs, idx.join(','), angles.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  if (idx.length < 3) return <ChartMessage>RadViz에는 변수가 3개 이상 필요합니다.</ChartMessage>
  if (!obs.rows.length) return <ChartMessage>모든 변수 값이 있는 행이 없습니다.</ChartMessage>
  const m = compact ? 6 : MARGIN
  const R = Math.max(20, Math.min(width, height) / 2 - m)
  const cx = width / 2, cy = height / 2
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const v = dragging.current
    if (!v) return
    const p = localPoint(svgRef.current!, e)
    setParams({ angles: { ...params.angles, ...Object.fromEntries(idx.map((j, k) => [obs.vars[j], params.angles[obs.vars[j]] ?? anchorAngle(k, idx.length)])), [v]: Math.atan2(p.y - cy, p.x - cx) } })
  }
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`RadViz: 변수 ${idx.length}개, 관측값 ${obs.rows.length}개`}
        onPointerMove={onMove} onPointerUp={() => { dragging.current = null }} onPointerCancel={() => { dragging.current = null }} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="#d6dbe0" />
        {obs.rows.map((row, i) => {
          const g = obs.groups[i]
          const dim = (params.highlight && g !== params.highlight) || (marked.size > 0 && !marked.has(row))
          return (
            <circle key={row} cx={cx + pts[i][0] * R} cy={cy + pts[i][1] * R} r={marked.has(row) ? params.size + 2 : params.size} fill={obs.color(g)} fillOpacity={dim ? 0.08 : params.opacity} stroke={marked.has(row) ? '#111' : 'none'}
              data-testid="radviz-point" onPointerEnter={compact ? undefined : (e) => {
                linked?.set([row])
                const lp = localPoint(svgRef.current!, e)
                show(lp.x, lp.y, <><b>{g || `행 ${row + 1}`}</b>{idx.map((j) => <div key={j}>{obs.vars[j]}: {fmt(obs.raw[i][j])}</div>)}</>)
              }} onPointerLeave={hide} />
          )
        })}
        {idx.map((j, k) => {
          const a = angles[k]
          const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R
          return (
            <g key={obs.vars[j]}>
              <circle cx={x} cy={y} r={compact ? 3 : 7} fill="#fff" stroke="#333" strokeWidth={1.5} style={{ cursor: compact ? undefined : 'grab' }} data-testid={`anchor-${obs.vars[j]}`}
                onPointerDown={compact ? undefined : (e) => { (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId); dragging.current = obs.vars[j]; hide() }} />
              {!compact && params.labels && <text x={cx + Math.cos(a) * (R + 18)} y={cy + Math.sin(a) * (R + 18)} dy="0.35em" textAnchor={Math.cos(a) > 0.2 ? 'start' : Math.cos(a) < -0.2 ? 'end' : 'middle'} className="radar-axis-label">{obs.vars[j]}</text>}
            </g>
          )
        })}
      </svg>
      {!compact && <><Legend7 obs={obs} highlight={params.highlight} onPick={(highlight) => setParams({ highlight })} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function RadvizControls({ params, setParams, mapping }: ControlsProps<RadvizParams>) {
  const { vars } = useVarNames(mapping)
  return (
    <>
      <ControlGroup title="계산">
        <Segmented label="정규화" value={params.norm} onChange={(norm) => setParams({ norm })} options={[{ value: 'minmax', label: '최소–최대' }, { value: 'zscore', label: 'z 점수' }]} testId="ctl-norm" />
        <Hint>앵커(원 위의 흰 점)를 드래그해 배치를 바꿉니다. 관측값은 정규화한 변수값을 가중치로 한 앵커들의 가중 평균 위치에 놓입니다.</Hint>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ angles: {} })} data-testid="radviz-reset">앵커를 균등하게 재배치</button>
      </ControlGroup>
      <VarSwitches obs={{ vars }} off={params.off} onChange={(off) => setParams({ off })} />
      <ControlGroup title="모양">
        <Slider label="점 크기" value={params.size} min={1.5} max={8} step={0.5} onChange={(size) => setParams({ size })} />
        <Slider label="불투명도" value={params.opacity} min={0.2} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} />
        <Toggle label="변수 이름 표시" checked={params.labels} onChange={(labels) => setParams({ labels })} />
      </ControlGroup>
    </>
  )
}

export const radvizModule: VizModule<RadvizParams> = {
  roles: multivarRoles(),
  datasets: [...MULTIVAR_DATASETS],
  defaultParams: { norm: 'minmax', off: [], angles: {}, highlight: '', size: 3.5, opacity: 0.75, labels: true },
  Chart: RadvizChart,
  Controls: RadvizControls,
  hint: '흰 앵커를 드래그해 변수 배치 변경 · 범례를 눌러 그룹 강조',
}

// ───────────────────────────── Star Coordinates ─────────────────────────────

export interface StarParams { norm: 'minmax' | 'zscore'; off: string[]; axes: Record<string, [number, number]>; weights: Record<string, number>; highlight: string; spin: boolean; size: number }

function StarChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<StarParams>) {
  const obs = useObs(table, mapping, params.norm)
  const marked = new Set(linked?.rows ?? [])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef<string | null>(null)
  const reduced = useReducedMotion()
  const [phase, setPhase] = useState(0)
  useEffect(() => {
    if (!params.spin || compact || reduced) return
    let raf = 0
    const t0 = performance.now()
    const step = (now: number) => { setPhase((now - t0) / 4000); raf = requestAnimationFrame(step) }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [params.spin, compact, reduced])
  const idx = enabledVars(obs, params.off)
  const base = defaultAxes(idx.length)
  const axes = idx.map((j, k) => params.axes[obs.vars[j]] ?? base[k])
  const weights = idx.map((j) => params.weights[obs.vars[j]] ?? 1)
  // The animation sweeps the first variable's axis around the circle so its effect on the layout is visible.
  const animAxes = params.spin && !compact && !reduced ? axes.map((a, k) => (k === 0 ? [Math.cos(phase * 2 * Math.PI - Math.PI / 2), Math.sin(phase * 2 * Math.PI - Math.PI / 2)] as [number, number] : a)) : axes
  const pts = useMemo(() => starCoordinates(obs.norm.map((r) => idx.map((j) => r[j])), animAxes, weights), [obs, idx.join(','), JSON.stringify(animAxes), weights.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  if (idx.length < 3) return <ChartMessage>Star Coordinates에는 변수가 3개 이상 필요합니다.</ChartMessage>
  if (!obs.rows.length) return <ChartMessage>모든 변수 값이 있는 행이 없습니다.</ChartMessage>
  const R = Math.max(20, Math.min(width, height) / 2 - (compact ? 6 : MARGIN))
  const cx = width / 2, cy = height / 2
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const v = dragging.current
    if (!v) return
    const p = localPoint(svgRef.current!, e)
    const len = Math.min(1, Math.hypot(p.x - cx, p.y - cy) / R)
    const a = Math.atan2(p.y - cy, p.x - cx)
    setParams({ axes: { ...params.axes, ...Object.fromEntries(idx.map((j, k) => [obs.vars[j], params.axes[obs.vars[j]] ?? base[k]])), [v]: [Math.cos(a) * Math.max(0.15, len), Math.sin(a) * Math.max(0.15, len)] } })
  }
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Star Coordinates: 축 ${idx.length}개, 관측값 ${obs.rows.length}개`}
        onPointerMove={onMove} onPointerUp={() => { dragging.current = null }} onPointerCancel={() => { dragging.current = null }} onPointerLeave={hide}>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="#eceff2" />
        {idx.map((j, k) => (
          <g key={obs.vars[j]}>
            <line x1={cx} y1={cy} x2={cx + animAxes[k][0] * R} y2={cy + animAxes[k][1] * R} stroke="#9aa3ad" strokeWidth={1.2} />
            <circle cx={cx + animAxes[k][0] * R} cy={cy + animAxes[k][1] * R} r={compact ? 2.5 : 6} fill="#fff" stroke="#333" strokeWidth={1.5} style={{ cursor: compact ? undefined : 'grab' }} data-testid={`axis-${obs.vars[j]}`}
              onPointerDown={compact ? undefined : (e) => { (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId); dragging.current = obs.vars[j]; hide() }} />
            {!compact && <text x={cx + animAxes[k][0] * (R + 16)} y={cy + animAxes[k][1] * (R + 16)} dy="0.35em" textAnchor={animAxes[k][0] > 0.2 ? 'start' : animAxes[k][0] < -0.2 ? 'end' : 'middle'} className="radar-axis-label">{obs.vars[j]}</text>}
          </g>
        ))}
        {obs.rows.map((row, i) => {
          const g = obs.groups[i]
          const dim = (params.highlight && g !== params.highlight) || (marked.size > 0 && !marked.has(row))
          return <circle key={row} cx={cx + pts[i][0] * R} cy={cy + pts[i][1] * R} r={marked.has(row) ? params.size + 2 : params.size} fill={obs.color(g)} fillOpacity={dim ? 0.08 : 0.75} stroke={marked.has(row) ? '#111' : 'none'} data-testid="star-point"
            onPointerEnter={compact ? undefined : (e) => { linked?.set([row]); const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{g || `행 ${row + 1}`}</b>{idx.map((j) => <div key={j}>{obs.vars[j]}: {fmt(obs.raw[i][j])}</div>)}</>) }} onPointerLeave={() => { hide(); linked?.set(null) }} />
        })}
      </svg>
      {!compact && <><Legend7 obs={obs} highlight={params.highlight} onPick={(highlight) => setParams({ highlight })} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function StarControls({ params, setParams, mapping }: ControlsProps<StarParams>) {
  const { vars } = useVarNames(mapping)
  return (
    <>
      <ControlGroup title="계산">
        <Segmented label="정규화" value={params.norm} onChange={(norm) => setParams({ norm })} options={[{ value: 'minmax', label: '최소–최대' }, { value: 'zscore', label: 'z 점수' }]} />
        <Toggle label="첫 변수 축 회전 애니메이션" checked={params.spin} onChange={(spin) => setParams({ spin })} testId="star-spin" />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ axes: {}, weights: {} })} data-testid="star-reset">축과 가중치 초기화</button>
        <Hint>축 끝의 점을 끌면 방향과 길이가 바뀝니다. 길이가 길수록 그 변수의 영향이 큽니다.</Hint>
      </ControlGroup>
      <ControlGroup title="변수별 가중치">
        {vars.filter((v) => !params.off.includes(v)).map((v) => <Slider key={v} label={v} value={params.weights[v] ?? 1} min={0} max={3} step={0.1} onChange={(w) => setParams({ weights: { ...params.weights, [v]: w } })} format={(x) => x.toFixed(1)} testId={`w-${v}`} />)}
      </ControlGroup>
      <VarSwitches obs={{ vars }} off={params.off} onChange={(off) => setParams({ off })} />
      <ControlGroup title="모양"><Slider label="점 크기" value={params.size} min={1.5} max={8} step={0.5} onChange={(size) => setParams({ size })} /></ControlGroup>
    </>
  )
}

export const starModule: VizModule<StarParams> = {
  roles: multivarRoles(),
  datasets: [...MULTIVAR_DATASETS],
  defaultParams: { norm: 'minmax', off: [], axes: {}, weights: {}, highlight: '', spin: false, size: 3.5 },
  Chart: StarChart,
  Controls: StarControls,
  hint: '축 끝의 점을 드래그해 방향·길이 변경 · 슬라이더로 변수 가중치 조절',
}

// ───────────────────────────── Grand Tour ─────────────────────────────

export interface TourParams { norm: 'minmax' | 'zscore'; off: string[]; speed: number; seed: number; playing: boolean; t: number; highlight: string; trail: boolean; selected: number }

function TourChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<TourParams>) {
  const obs = useObs(table, mapping, params.norm)
  const marked = new Set(linked?.rows ?? [])
  const reduced = useReducedMotion()
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const [clock, setClock] = useState(params.t)
  const idx = enabledVars(obs, params.off)
  const playing = params.playing && !compact && !reduced
  useEffect(() => {
    if (!playing) { setClock(params.t); return }
    let raf = 0
    let last = performance.now()
    const step = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setClock((c) => c + dt * params.speed)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, params.speed, params.t])
  const sel = params.selected
  const frame = useMemo(() => tourFrame(Math.max(idx.length, 1), clock, params.seed), [idx.length, clock, params.seed])
  const pts = useMemo(() => project(obs.norm.map((r) => idx.map((j) => r[j] - 0.5)), frame), [obs, idx.join(','), frame])
  if (idx.length < 3) return <ChartMessage>Grand Tour에는 변수가 3개 이상 필요합니다.</ChartMessage>
  if (!obs.rows.length) return <ChartMessage>모든 변수 값이 있는 행이 없습니다.</ChartMessage>
  const half = Math.sqrt(idx.length) * 0.5
  const R = Math.max(20, Math.min(width, height) / 2 - (compact ? 6 : MARGIN))
  const sc = R / half
  const cx = width / 2, cy = height / 2
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Grand Tour: ${idx.length}차원 데이터의 2차원 투영`} onPointerLeave={hide}>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="#eceff2" />
        {!compact && idx.map((j, k) => (
          <g key={j} opacity={0.55}>
            <line x1={cx} y1={cy} x2={cx + frame[0][k] * R * 0.9} y2={cy + frame[1][k] * R * 0.9} stroke="#9aa3ad" />
            <text x={cx + frame[0][k] * R * 0.97} y={cy + frame[1][k] * R * 0.97} className="radar-axis-label" textAnchor="middle" dy="0.35em">{obs.vars[j]}</text>
          </g>
        ))}
        {obs.rows.map((row, i) => {
          const g = obs.groups[i]
          const dim = (params.highlight && g !== params.highlight) || (sel >= 0 && sel !== row) || (marked.size > 0 && !marked.has(row))
          return <circle key={row} cx={cx + pts[i][0] * sc} cy={cy + pts[i][1] * sc} r={sel === row || marked.has(row) ? 6 : 3.4} fill={obs.color(g)} fillOpacity={dim ? 0.1 : 0.78} stroke={sel === row ? '#111' : 'none'} data-testid="tour-point"
            onPointerEnter={compact ? undefined : (e) => { linked?.set([row]); const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{g || `행 ${row + 1}`}</b><br />클릭해 이 관측값을 따라가기</>) }} onPointerLeave={() => { hide(); linked?.set(null) }}
            onClick={compact ? undefined : () => setParams({ selected: sel === row ? -1 : row })} />
        })}
      </svg>
      {!compact && <><Legend7 obs={obs} highlight={params.highlight} onPick={(highlight) => setParams({ highlight })} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function TourControls({ params, setParams, mapping }: ControlsProps<TourParams>) {
  const { vars } = useVarNames(mapping)
  return (
    <>
      <ControlGroup title="투영">
        <Toggle label="재생" checked={params.playing} onChange={(playing) => setParams({ playing })} testId="tour-play" />
        <Slider label="회전 속도" value={params.speed} min={0.05} max={1.5} step={0.05} onChange={(speed) => setParams({ speed })} format={(v) => v.toFixed(2)} testId="tour-speed" />
        <Slider label="투영 위치 (정지 시)" value={params.t} min={0} max={20} step={0.05} onChange={(t) => setParams({ t, playing: false })} format={(v) => v.toFixed(2)} testId="tour-t" />
        <Slider label="경로 시드" value={params.seed} min={1} max={30} onChange={(seed) => setParams({ seed })} testId="tour-seed" />
        <Hint>투영 평면은 난수 경유점 사이를 부드럽게 보간하되 매 순간 정규직교로 다시 맞춥니다. 점을 눌러 한 관측값을 따라가 보세요.</Hint>
        <Segmented label="정규화" value={params.norm} onChange={(norm) => setParams({ norm })} options={[{ value: 'minmax', label: '최소–최대' }, { value: 'zscore', label: 'z 점수' }]} />
      </ControlGroup>
      <VarSwitches obs={{ vars }} off={params.off} onChange={(off) => setParams({ off })} />
    </>
  )
}

export const tourModule: VizModule<TourParams> = {
  roles: multivarRoles(),
  datasets: [...MULTIVAR_DATASETS],
  defaultParams: { norm: 'minmax', off: [], speed: 0.4, seed: 3, playing: true, t: 0.6, highlight: '', trail: false, selected: -1 },
  Chart: TourChart,
  Controls: TourControls,
  hint: '점을 눌러 관측값 선택 · 재생/정지와 속도 조절 · 변수 수가 늘면 투영이 더 다양해집니다',
}
