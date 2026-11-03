import * as d3 from 'd3'
import { useMemo, useRef, useState } from 'react'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, type DataTable } from '../../data/table'
import { colorAt } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { dryAdiabat, hasse, hasseOrder, hintonSide, moistLapse, nomogram, parcelPath, piperLayout, piperPercents, piperPoints, satMixing, skewT, skillStats, stiffRows, targetPoint, taylorPoint, toMeq, type Ions } from '../../stats/model11'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'

const numbers = (table: DataTable, col: string | null) => { const i = columnIndex(table, col); return i < 0 ? null : table.rows.map((r) => toNumber(r[i])) }

// ───────────────────────────── Hinton diagram ─────────────────────────────

export interface HintonParams { scale: 'global' | 'row'; values: boolean }

function HintonChart({ table, mapping, params, width, height, compact, linked }: ChartProps<HintonParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const m = useMemo(() => {
    const ri = columnIndex(table, roleColumn(mapping, 'row')), ci = columnIndex(table, roleColumn(mapping, 'col')), vi = columnIndex(table, roleColumn(mapping, 'value'))
    if (ri < 0 || ci < 0 || vi < 0) return null
    const rows: string[] = [], cols: string[] = []
    const cell = new Map<string, number>(), rowsOf = new Map<string, number[]>()
    table.rows.forEach((r, row) => { const a = toLabel(r[ri]), b = toLabel(r[ci]), v = toNumber(r[vi]); if (v == null) return; if (!rows.includes(a)) rows.push(a); if (!cols.includes(b)) cols.push(b); const k = `${a}\u0000${b}`; cell.set(k, (cell.get(k) ?? 0) + v); if (!rowsOf.has(k)) rowsOf.set(k, []); rowsOf.get(k)!.push(row) })
    return rows.length >= 2 && cols.length >= 2 && rows.length * cols.length <= 900 ? { rows, cols, cell, rowsOf } : null
  }, [table, mapping])
  const linkedSet = new Set(linked?.rows ?? [])
  if (!m) return <ChartMessage>행, 열(범주형)과 값(숫자형) 열을 고르세요. 행렬은 2×2 이상, 900칸 이하여야 합니다.</ChartMessage>
  const left = compact ? 4 : 84, top = compact ? 4 : 56
  const cw = Math.min((width - left - 12) / m.cols.length, (height - top - 12) / m.rows.length)
  const maxAll = Math.max(...[...m.cell.values()].map(Math.abs), 1e-12)
  const rowMax = m.rows.map((r) => Math.max(...m.cols.map((c) => Math.abs(m.cell.get(`${r}\u0000${c}`) ?? 0)), 1e-12))
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`힌턴 도표: ${m.rows.length}×${m.cols.length} 행렬`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        {!compact && m.cols.map((c, j) => <text key={c} x={left + j * cw + cw / 2} y={top - 8} textAnchor="start" fontSize={10} fill="#6b7280" transform={`rotate(-40 ${left + j * cw + cw / 2} ${top - 8})`}>{c}</text>)}
        {!compact && m.rows.map((r, i) => <text key={r} x={left - 8} y={top + i * cw + cw / 2} dy="0.34em" textAnchor="end" fontSize={10} fill="#6b7280">{r}</text>)}
        <rect x={left} y={top} width={cw * m.cols.length} height={cw * m.rows.length} fill="#f7f9f9" stroke="#dbe3e3" />
        {m.rows.map((r, i) => m.cols.map((c, j) => {
          const v = m.cell.get(`${r}\u0000${c}`) ?? 0
          const side = hintonSide(v, params.scale === 'row' ? rowMax[i] : maxAll) * cw * 0.92
          return (
            <g key={`${i}-${j}`} data-testid="hinton-cell" data-sign={v >= 0 ? 1 : -1} data-side={side.toFixed(2)} data-value={v}>
              <rect x={left + j * cw + (cw - side) / 2} y={top + i * cw + (cw - side) / 2} width={side} height={side} fill={v >= 0 ? '#2a8c82' : '#d4452f'} fillOpacity={0.9} stroke={(m.rowsOf.get(`${r}\u0000${c}`) ?? []).some((q) => linkedSet.has(q)) ? '#f59e0b' : 'none'} strokeWidth={2.2}
                onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); linked?.set(m.rowsOf.get(`${r}\u0000${c}`) ?? null); show(lp.x, lp.y, <><b>{r} → {c}</b><br />값 {fmt(v, 3)} ({v >= 0 ? '양수' : '음수'})<br />변 길이 ∝ √|값|, 면적 ∝ |값|</>) }} onPointerLeave={() => { hide(); linked?.set(null) }} />
              {params.values && !compact && cw > 34 && <text x={left + j * cw + cw / 2} y={top + i * cw + cw - 3} textAnchor="middle" fontSize={8} fill="#6b7280">{fmt(v, 2)}</text>}
            </g>
          )
        }))}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function HintonControls({ params, setParams }: ControlsProps<HintonParams>) {
  return (
    <ControlGroup title="힌턴 도표">
      <Segmented label="면적 기준" value={params.scale} onChange={(scale) => setParams({ scale })} testId="ctl-hscale" options={[{ value: 'global', label: '행렬 전체' }, { value: 'row', label: '행마다' }]} />
      <Toggle label="값 표시(칸이 클 때)" checked={params.values} onChange={(values) => setParams({ values })} testId="ctl-hvalues" />
      <Hint>행렬의 각 칸을 정사각형 하나로 그립니다. 면적이 값의 절댓값에 비례하도록 변의 길이를 √|값|로 하고, 부호는 색(청록 = 양수, 붉은색 = 음수)으로 구분합니다. 히트맵이 색의 진하기로 크기를 나타내는 것과 달리 면적으로 나타내므로 두 칸의 크기 비를 눈으로 비교하기 쉽지만, 면적 비교는 길이 비교보다 정확도가 낮습니다. 칸이 많으면 작은 값이 점처럼 보입니다.</Hint>
    </ControlGroup>
  )
}

export const hintonModule: VizModule<HintonParams> = {
  roles: [
    { key: 'row', label: '행', type: 'category', required: true, prefer: '행|row' },
    { key: 'col', label: '열', type: 'category', required: true, prefer: '열|col' },
    { key: 'value', label: '값 (부호 있는 숫자)', type: 'number', required: true, prefer: '값|value' },
  ],
  datasets: ['signed-matrix'],
  defaultParams: { scale: 'global', values: true },
  Chart: HintonChart,
  Controls: HintonControls,
  hint: '칸에 올려 값을 읽습니다 · 사각형의 면적이 |값|, 색이 부호입니다',
}

// ───────────────────────────── Taylor / Target diagrams ─────────────────────────────

function useSkill(table: DataTable, mapping: Mapping) {
  return useMemo(() => {
    const o = numbers(table, roleColumn(mapping, 'obs'))
    const names = roleColumns(mapping, 'models')
    if (!o || !names.length) return null
    const out: { name: string; s: ReturnType<typeof skillStats> }[] = []
    let sdObs = 0
    for (const n of names) {
      const m = numbers(table, n)
      if (!m) continue
      const ok = o.map((_, i) => (o[i] != null && m[i] != null ? i : -1)).filter((i) => i >= 0)
      if (ok.length < 5) continue
      const s = skillStats(ok.map((i) => o[i]!), ok.map((i) => m[i]!))
      sdObs = s.sdObs
      out.push({ name: n, s })
    }
    return out.length ? { models: out, sdObs } : null
  }, [table, mapping])
}

const skillRoles = [
  { key: 'obs', label: '관측값', type: 'number' as const, required: true, prefer: '관측|obs' },
  { key: 'models', label: '모형 예측값', type: 'number' as const, required: true, multiple: { min: 1, max: 6 }, prefer: '모형|model' },
]

export interface TaylorParams { normalize: boolean; rmsCircles: boolean }

function TaylorChart({ table, mapping, params, width, height, compact }: ChartProps<TaylorParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const sk = useSkill(table, mapping)
  if (!sk) return <ChartMessage>관측값 열과 모형 예측 열(하나 이상)을 고르세요. 값이 5쌍 이상이어야 합니다.</ChartMessage>
  const k = params.normalize ? 1 / sk.sdObs : 1
  const hasNeg = sk.models.some((m) => m.s.r < 0)
  const rmax = Math.max(sk.sdObs, ...sk.models.map((m) => m.s.sdMod)) * 1.25 * k
  const pad = compact ? 8 : 40
  const R = Math.min(width - 2 * pad, (hasNeg ? (height - 2 * pad) / 2 : height - 2 * pad - 10))
  const R2 = hasNeg ? Math.min(R, (width - 2 * pad) / 2) : Math.min(width - 2 * pad, height - 2 * pad - 10)
  const sc = R2 / rmax
  const cx = pad, cy = hasNeg ? height / 2 : height - pad - 6
  const P = (r: number, a: number) => [cx + r * sc * Math.cos(a), cy - r * sc * Math.sin(a)] as const
  const refX = sk.sdObs * k
  const maxA = hasNeg ? Math.PI : Math.PI / 2, minA = hasNeg ? -Math.PI / 2 : 0
  const ringPath = (r: number) => { const p0 = P(r, minA), p1 = P(r, maxA); return `M${p0[0]},${p0[1]}A${r * sc},${r * sc} 0 ${hasNeg ? 1 : 0} 0 ${p1[0]},${p1[1]}` }
  const ticks = d3.ticks(0, rmax, 4).filter((t) => t > 0)
  const corr = [0, 0.2, 0.4, 0.6, 0.8, 0.9, 0.95, 0.99, ...(hasNeg ? [-0.2, -0.4, -0.6, -0.8, -0.9] : [])]
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`테일러 도표: 모형 ${sk.models.length}개`} onPointerLeave={hide}>
        {ticks.map((t) => <path key={t} d={ringPath(t)} fill="none" stroke="#dbe3e3" />)}
        {!compact && ticks.map((t) => <text key={t} x={P(t, 0)[0]} y={cy + 13} textAnchor="middle" fontSize={10} fill="#9aa6a6">{fmt(t, 2)}</text>)}
        {corr.map((c) => { const a = Math.acos(c), p = P(rmax, a); return <g key={c}><line x1={cx} y1={cy} x2={p[0]} y2={p[1]} stroke="#e5ebeb" />{!compact && <text x={P(rmax * 1.04, a)[0]} y={P(rmax * 1.04, a)[1]} fontSize={9} fill="#6b7280" textAnchor="middle" dy="0.3em">{c}</text>}</g> })}
        {params.rmsCircles && Array.from({ length: 4 }, (_, i) => (i + 1) * 0.5 * refX).map((e) => {
          // points at a distance e from the reference (σo, 0): clip to the quadrant by sampling
          const pts: [number, number][] = []
          for (let a = minA; a <= maxA + 1e-9; a += 0.02) { const x = refX + e * Math.cos(a), y = e * Math.sin(a); const r = Math.hypot(x, y); const th = Math.atan2(y, x); if (r <= rmax && th >= minA - 1e-9 && th <= maxA + 1e-9) pts.push([cx + x * sc, cy - y * sc]) }
          return pts.length > 1 ? <path key={e} d={'M' + pts.map((p) => `${p[0]},${p[1]}`).join('L')} fill="none" stroke="#b8cfc9" strokeDasharray="4 3" data-testid="taylor-rms" /> : null
        })}
        <path d={ringPath(refX)} fill="none" stroke="#6b7280" strokeDasharray="2 3" />
        <circle cx={P(refX, 0)[0]} cy={P(refX, 0)[1]} r={6} fill="#111827" data-testid="taylor-ref" />
        {!compact && <text x={P(refX, 0)[0]} y={cy - 12} textAnchor="middle" fontSize={11} fill="#111827">관측</text>}
        {!compact && <text x={cx + (R2 * (rmax > 0 ? 1 : 0)) / 2} y={cy + 28} textAnchor="middle" fontSize={11} fill="#6b7280">{params.normalize ? '정규화된 표준편차(σ ÷ σ관측)' : '표준편차'}</text>}
        {sk.models.map((m, i) => { const t = taylorPoint(m.s), p = P(t.radius * k, t.angle); return (
          <g key={m.name} data-testid="taylor-model" data-r={m.s.r.toFixed(4)} data-sd={(m.s.sdMod * k).toFixed(4)}>
            <circle cx={p[0]} cy={p[1]} r={6.5} fill={colorAt(i)} stroke="#fff" strokeWidth={1.5}
              onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{m.name}</b><br />상관 {fmt(m.s.r, 3)} · σ {fmt(m.s.sdMod, 3)}<br />중심화 RMSD {fmt(m.s.crmsd, 3)} · 편향 {fmt(m.s.bias, 3)}</>) }} onPointerLeave={hide} />
            {!compact && <text x={p[0] + 9} y={p[1]} dy="0.34em" fontSize={11} fill={colorAt(i)}>{m.name}</text>}
          </g>
        ) })}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function TaylorControls({ params, setParams }: ControlsProps<TaylorParams>) {
  return (
    <ControlGroup title="테일러 도표">
      <Toggle label="표준편차를 관측의 표준편차로 정규화" checked={params.normalize} onChange={(normalize) => setParams({ normalize })} testId="ctl-tnorm" />
      <Toggle label="중심화 RMS 오차 등고 원" checked={params.rmsCircles} onChange={(rmsCircles) => setParams({ rmsCircles })} testId="ctl-trms" />
      <Hint>모형의 성능 세 가지를 한 점에 담습니다. 원점에서의 거리가 모형의 표준편차 σm, x축과 이루는 각이 관측과의 상관계수 r(cos θ = r)이고, 관측(검은 점)과의 거리가 중심화 RMS 오차 E′입니다. 코사인 법칙 E′² = σm² + σo² − 2σmσo·r 때문에 이 세 값이 하나의 평면 위치로 일관되게 표현됩니다. 관측에 가까운 점이 좋은 모형입니다. 평균의 편향은 이 도표에 나타나지 않으므로 타깃 도표 등으로 보완합니다.</Hint>
    </ControlGroup>
  )
}

export const taylorModule: VizModule<TaylorParams> = {
  roles: skillRoles,
  datasets: ['model-skill'],
  defaultParams: { normalize: false, rmsCircles: true },
  Chart: TaylorChart,
  Controls: TaylorControls,
  hint: '점에 올려 상관·표준편차·RMS 오차를 읽습니다 · 관측(검은 점)에 가까울수록 좋습니다',
}

export interface TargetParams { rings: boolean }

function TargetChart({ table, mapping, params, width, height, compact }: ChartProps<TargetParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const sk = useSkill(table, mapping)
  if (!sk) return <ChartMessage>관측값 열과 모형 예측 열(하나 이상)을 고르세요. 값이 5쌍 이상이어야 합니다.</ChartMessage>
  const pts = sk.models.map((m) => ({ name: m.name, s: m.s, ...targetPoint(m.s) }))
  const lim = Math.max(1.2, ...pts.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)])) * 1.1
  const side = Math.min(width, height) - (compact ? 10 : 70)
  const cx = width / 2, cy = height / 2, sc = side / 2 / lim
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`타깃 도표: 모형 ${pts.length}개`} onPointerLeave={hide}>
        <line x1={cx - lim * sc} x2={cx + lim * sc} y1={cy} y2={cy} stroke="#9aa6a6" />
        <line x1={cx} x2={cx} y1={cy - lim * sc} y2={cy + lim * sc} stroke="#9aa6a6" />
        {params.rings && [0.5, 1].map((r) => <circle key={r} cx={cx} cy={cy} r={r * sc} fill="none" stroke={r === 1 ? '#111827' : '#b8cfc9'} strokeDasharray={r === 1 ? '' : '4 3'} data-testid="target-ring" />)}
        {!compact && <text x={cx + sc * 0.72} y={cy - sc * 0.72 - 4} fontSize={10} fill="#111827">RMSD = σ관측</text>}
        {!compact && <text x={cx + lim * sc - 4} y={cy + 14} fontSize={10} fill="#6b7280" textAnchor="end">부호 있는 중심화 RMSD →(σm &gt; σo)</text>}
        {!compact && <text x={cx + 6} y={cy - lim * sc + 10} fontSize={10} fill="#6b7280">편향 ↑</text>}
        {pts.map((p, i) => (
          <g key={p.name} data-testid="target-model" data-x={p.x.toFixed(4)} data-y={p.y.toFixed(4)}>
            <circle cx={cx + p.x * sc} cy={cy - p.y * sc} r={6.5} fill={colorAt(i)} stroke="#fff" strokeWidth={1.5}
              onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{p.name}</b><br />편향 {fmt(p.s.bias, 3)} · 중심화 RMSD {fmt(p.s.crmsd, 3)}<br />전체 RMSD {fmt(p.s.rmsd, 3)} (= 원점에서의 거리 × σ관측)</>) }} onPointerLeave={hide} />
            {!compact && <text x={cx + p.x * sc + 9} y={cy - p.y * sc} dy="0.34em" fontSize={11} fill={colorAt(i)}>{p.name}</text>}
          </g>
        ))}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function TargetControls({ params, setParams }: ControlsProps<TargetParams>) {
  return (
    <ControlGroup title="타깃 도표">
      <Toggle label="기준 원(0.5, 1 σ관측)" checked={params.rings} onChange={(rings) => setParams({ rings })} testId="ctl-trings" />
      <Hint>모형 오차를 두 성분으로 나눠 한 평면에 놓습니다. 세로축은 편향(모형 평균 − 관측 평균), 가로축은 편향을 뺀 중심화 RMS 오차이며 모형의 표준편차가 관측보다 크면 오른쪽, 작으면 왼쪽입니다(Jolliff 외 2009). 값은 모두 관측의 표준편차로 나눕니다. 원점에서의 거리가 전체 RMSD(RMSD² = 편향² + E′²)이고, 반지름 1인 원 안의 모형이 관측의 평균을 쓰는 것보다 낫습니다. 테일러 도표와 달리 편향이 드러나지만 상관계수는 직접 보이지 않습니다.</Hint>
    </ControlGroup>
  )
}

export const targetModule: VizModule<TargetParams> = {
  roles: skillRoles,
  datasets: ['model-skill'],
  defaultParams: { rings: true },
  Chart: TargetChart,
  Controls: TargetControls,
  hint: '원점에 가까울수록 오차가 작습니다 · 위아래는 편향, 좌우는 변동의 과대·과소',
}

// ───────────────────────────── nomogram ─────────────────────────────

export interface NomoParams { intercept: number }

function NomogramChart({ table, mapping, params, width, height, compact }: ChartProps<NomoParams>) {
  const data = useMemo(() => {
    const ni = columnIndex(table, roleColumn(mapping, 'name')), lo = columnIndex(table, roleColumn(mapping, 'min')), hi = columnIndex(table, roleColumn(mapping, 'max')), bi = columnIndex(table, roleColumn(mapping, 'beta')), vi = columnIndex(table, roleColumn(mapping, 'value'))
    if (ni < 0 || lo < 0 || hi < 0 || bi < 0) return null
    const v = table.rows.map((r) => ({ name: toLabel(r[ni]), min: toNumber(r[lo]), max: toNumber(r[hi]), beta: toNumber(r[bi]), val: vi >= 0 ? toNumber(r[vi]) : null })).filter((r): r is { name: string; min: number; max: number; beta: number; val: number | null } => r.min != null && r.max != null && r.beta != null && r.max > r.min)
    return v.length >= 2 ? v : null
  }, [table, mapping])
  const nm = useMemo(() => (data ? nomogram(data, params.intercept) : null), [data, params.intercept])
  if (!data || !nm) return <ChartMessage>변수, 최솟값, 최댓값, 계수 열을 고르세요(변수 2개 이상, 현재 값 열은 선택).</ChartMessage>
  const left = compact ? 6 : 130, right = compact ? 6 : 24
  const x = d3.scaleLinear().domain([0, 100]).range([left, width - right])
  const rows = data.length + 3
  const rowH = Math.min(46, (height - 16) / rows)
  const y = (i: number) => 14 + (i + 0.5) * rowH
  const cur = nm.scales.map((s, i) => (data[i].val != null ? s.points(Math.min(s.max, Math.max(s.min, data[i].val!))) : null))
  const total = cur.every((c) => c != null) ? (cur as number[]).reduce((a, b) => a + b, 0) : null
  const tx = d3.scaleLinear().domain([0, nm.totalMax]).range([left, width - right])
  const probs = [0.01, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.8, 0.9, 0.95, 0.99].map((p) => ({ p, pts: nm.pointsForProbability(p) })).filter((q) => q.pts >= 0 && q.pts <= nm.totalMax)
  return (
    <div className="chart-root">
      <svg width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`노모그램: 변수 ${data.length}개`}>
        <line x1={x(0)} x2={x(100)} y1={y(0)} y2={y(0)} stroke="#374151" />
        {!compact && <text x={left - 10} y={y(0)} textAnchor="end" dy="0.34em" fontSize={11} fontWeight={700} fill="#374151">점수</text>}
        {d3.range(0, 101, 10).map((t) => <g key={t}><line x1={x(t)} x2={x(t)} y1={y(0) - 4} y2={y(0) + 4} stroke="#374151" />{!compact && <text x={x(t)} y={y(0) - 8} textAnchor="middle" fontSize={9} fill="#6b7280">{t}</text>}</g>)}
        {nm.scales.map((s, i) => {
          const yy = y(i + 1)
          const ticks = d3.ticks(s.min, s.max, 6)
          const xs = (v: number) => x(s.points(v))
          return (
            <g key={s.name} data-testid="nomo-axis" data-range={s.range.toFixed(2)}>
              <line x1={xs(s.min)} x2={xs(s.max)} y1={yy} y2={yy} stroke="#6b7280" strokeWidth={2} />
              {ticks.map((t) => <g key={t}><line x1={xs(t)} x2={xs(t)} y1={yy - 3} y2={yy + 3} stroke="#6b7280" />{!compact && <text x={xs(t)} y={yy + 14} textAnchor="middle" fontSize={9} fill="#6b7280">{t}</text>}</g>)}
              {!compact && <text x={left - 10} y={yy} textAnchor="end" dy="0.34em" fontSize={11} fill="#374151">{s.name}</text>}
              {data[i].val != null && <circle cx={xs(Math.min(s.max, Math.max(s.min, data[i].val!)))} cy={yy} r={5} fill="#d4452f" data-testid="nomo-marker" />}
            </g>
          )
        })}
        <g data-testid="nomo-total">
          <line x1={tx(0)} x2={tx(nm.totalMax)} y1={y(data.length + 1)} y2={y(data.length + 1)} stroke="#111827" strokeWidth={2} />
          {d3.ticks(0, nm.totalMax, 8).map((t) => <g key={t}><line x1={tx(t)} x2={tx(t)} y1={y(data.length + 1) - 3} y2={y(data.length + 1) + 3} stroke="#111827" />{!compact && <text x={tx(t)} y={y(data.length + 1) + 14} textAnchor="middle" fontSize={9} fill="#6b7280">{t}</text>}</g>)}
          {!compact && <text x={left - 10} y={y(data.length + 1)} textAnchor="end" dy="0.34em" fontSize={11} fontWeight={700} fill="#111827">총점</text>}
          {total != null && <circle cx={tx(total)} cy={y(data.length + 1)} r={6} fill="#d4452f" data-testid="nomo-total-marker" />}
        </g>
        <line x1={tx(0)} x2={tx(nm.totalMax)} y1={y(data.length + 2)} y2={y(data.length + 2)} stroke="#111827" strokeWidth={2} />
        {probs.map((q) => <g key={q.p}><line x1={tx(q.pts)} x2={tx(q.pts)} y1={y(data.length + 2) - 3} y2={y(data.length + 2) + 3} stroke="#111827" />{!compact && <text x={tx(q.pts)} y={y(data.length + 2) + 14} textAnchor="middle" fontSize={9} fill="#6b7280">{q.p}</text>}</g>)}
        {!compact && <text x={left - 10} y={y(data.length + 2)} textAnchor="end" dy="0.34em" fontSize={11} fontWeight={700} fill="#111827">사건 확률</text>}
        {total != null && <circle cx={tx(total)} cy={y(data.length + 2)} r={6} fill="#d4452f" data-testid="nomo-prob-marker" />}
        {total != null && !compact && <text x={width - right} y={height - 6} textAnchor="end" fontSize={12} fontWeight={700} fill="#d4452f" data-testid="nomo-readout">총점 {fmt(total, 3)} → 확률 {(nm.probability(total) * 100).toFixed(1)}%</text>}
      </svg>
    </div>
  )
}

function NomogramControls({ params, setParams }: ControlsProps<NomoParams>) {
  return (
    <ControlGroup title="노모그램">
      <Slider label="모형의 절편(로그 오즈)" value={params.intercept} min={-8} max={2} step={0.1} onChange={(intercept) => setParams({ intercept })} format={(v) => v.toFixed(1)} testId="ctl-intercept" />
      <Hint>로지스틱 모형 logit(p) = 절편 + Σ βᵢxᵢ를 눈금으로 푼 계산 도표입니다. 변수마다 눈금의 길이를 |β|·(최댓값 − 최솟값)에 비례하게 그려 영향이 가장 큰 변수가 100점이 되게 하고, 각 변수에서 현재 값의 점수를 읽어 더하면 총점이 되며, 총점 눈금에서 확률로 바꿉니다(점수 1점 = 로그 오즈 변화량이 일정). 계수가 음수인 변수는 눈금 방향이 반대입니다. 선형 로그 오즈를 가정한 모형이며 신뢰구간은 나타내지 않습니다.</Hint>
    </ControlGroup>
  )
}

export const nomogramModule: VizModule<NomoParams> = {
  roles: [
    { key: 'name', label: '변수', type: 'category', required: true, prefer: '변수|name' },
    { key: 'min', label: '최솟값', type: 'number', required: true, prefer: '최솟값|min' },
    { key: 'max', label: '최댓값', type: 'number', required: true, prefer: '최댓값|max' },
    { key: 'beta', label: '계수(로짓)', type: 'number', required: true, prefer: '계수|beta' },
    { key: 'value', label: '현재 값', type: 'number', auto: true, prefer: '현재|value' },
  ],
  datasets: ['nomogram-model'],
  defaultParams: { intercept: -4.2 },
  Chart: NomogramChart,
  Controls: NomogramControls,
  hint: '변수마다 점수를 읽어 더하면 총점, 총점 눈금에서 확률을 읽습니다 · 절편을 바꾸면 확률 눈금이 이동합니다',
}

// ───────────────────────────── water chemistry: Piper & Stiff ─────────────────────────────

const ionRoles = [
  { key: 'group', label: '수질 유형(색, 선택)', type: 'category' as const, auto: true, prefer: '유형|type' },
  ...(['Ca', 'Mg', 'Na', 'K', 'HCO3', 'SO4', 'Cl'] as const).map((k) => ({ key: k, label: `${k} (mg/L)`, type: 'number' as const, required: true, prefer: k })),
]

function useWater(table: DataTable, mapping: Mapping, unit: 'mg' | 'meq') {
  return useMemo(() => {
    const keys = ['Ca', 'Mg', 'Na', 'K', 'HCO3', 'SO4', 'Cl'] as const
    const cols = keys.map((k) => numbers(table, roleColumn(mapping, k)))
    if (cols.some((c) => !c)) return null
    const gi = columnIndex(table, roleColumn(mapping, 'group'))
    const out: { i: number; group: string; meq: Ions }[] = []
    table.rows.forEach((r, i) => {
      const ion = {} as Ions
      let ok = true
      keys.forEach((k, j) => { const v = cols[j]![i]; if (v == null || v < 0) ok = false; else ion[k] = v })
      if (ok) out.push({ i, group: gi >= 0 ? toLabel(r[gi]) : '', meq: unit === 'mg' ? toMeq(ion) : ion })
    })
    return out.length ? out : null
  }, [table, mapping, unit])
}

export interface PiperParams { unit: 'mg' | 'meq' }

function PiperChart({ table, mapping, params, width, height, compact, linked }: ChartProps<PiperParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const w = useWater(table, mapping, params.unit)
  const linkedSet = useMemo(() => new Set(linked?.rows ?? []), [linked?.rows])
  if (!w) return <ChartMessage>Ca, Mg, Na, K, HCO3, SO4, Cl 이온 농도 열을 모두 고르세요.</ChartMessage>
  const L = piperLayout()
  const gap = compact ? 4 : 30
  const totalW = 2.5, totalH = L.diamond.bottom[1] + 2 * Math.sqrt(3) / 2
  const s = Math.min((width - 2 * gap) / totalW, (height - 2 * gap - (compact ? 0 : 24)) / totalH)
  const ox = (width - totalW * s) / 2, oy = height - gap - (compact ? 0 : 20)
  const X = (p: readonly [number, number]) => ox + p[0] * s, Y = (p: readonly [number, number]) => oy - p[1] * s
  const tri = (v: Record<string, [number, number]>) => 'M' + Object.values(v).map((p) => `${X(p)},${Y(p)}`).join('L') + 'Z'
  const d = L.diamond
  const dmd: [number, number][] = [d.bottom, [d.bottom[0] + d.eA[0], d.bottom[1] + d.eA[1]], [d.bottom[0] + d.eC[0] + d.eA[0], d.bottom[1] + d.eC[1] + d.eA[1]], [d.bottom[0] + d.eC[0], d.bottom[1] + d.eC[1]]]
  const groups = [...new Set(w.map((r) => r.group))]
  const grid = (a: [number, number], b: [number, number], c: [number, number]) => [0.2, 0.4, 0.6, 0.8].flatMap((t) => [[[a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t]], [[b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t], [b[0] + (c[0] - b[0]) * t, b[1] + (c[1] - b[1]) * t]], [[c[0] + (a[0] - c[0]) * t, c[1] + (a[1] - c[1]) * t], [c[0] + (b[0] - c[0]) * t, c[1] + (b[1] - c[1]) * t]]] as [[number, number], [number, number]][])
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`파이퍼 도표: 시료 ${w.length}개`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        {[L.cat, L.an].map((v, k) => <g key={k}>{grid(...(Object.values(v) as [[number, number], [number, number], [number, number]])).map(([a, b], i) => <line key={i} x1={X(a)} y1={Y(a)} x2={X(b)} y2={Y(b)} stroke="#e5ebeb" />)}<path d={tri(v)} fill="none" stroke="#6b7280" /></g>)}
        <path d={'M' + dmd.map((p) => `${X(p)},${Y(p)}`).join('L') + 'Z'} fill="none" stroke="#6b7280" />
        {[0.2, 0.4, 0.6, 0.8].map((t) => <g key={t}><line x1={X([d.bottom[0] + d.eC[0] * t, d.bottom[1] + d.eC[1] * t])} y1={Y([d.bottom[0] + d.eC[0] * t, d.bottom[1] + d.eC[1] * t])} x2={X([d.bottom[0] + d.eC[0] * t + d.eA[0], d.bottom[1] + d.eC[1] * t + d.eA[1]])} y2={Y([d.bottom[0] + d.eC[0] * t + d.eA[0], d.bottom[1] + d.eC[1] * t + d.eA[1]])} stroke="#e5ebeb" /><line x1={X([d.bottom[0] + d.eA[0] * t, d.bottom[1] + d.eA[1] * t])} y1={Y([d.bottom[0] + d.eA[0] * t, d.bottom[1] + d.eA[1] * t])} x2={X([d.bottom[0] + d.eA[0] * t + d.eC[0], d.bottom[1] + d.eA[1] * t + d.eC[1]])} y2={Y([d.bottom[0] + d.eA[0] * t + d.eC[0], d.bottom[1] + d.eA[1] * t + d.eC[1]])} stroke="#e5ebeb" /></g>)}
        {!compact && <g fontSize={10} fill="#374151">
          <text x={X(L.cat.Ca)} y={Y(L.cat.Ca) + 14} textAnchor="middle">Ca</text><text x={X(L.cat.NaK)} y={Y(L.cat.NaK) + 14} textAnchor="middle">Na+K</text><text x={X(L.cat.Mg)} y={Y(L.cat.Mg) - 6} textAnchor="middle">Mg</text>
          <text x={X(L.an.HCO3)} y={Y(L.an.HCO3) + 14} textAnchor="middle">HCO₃</text><text x={X(L.an.Cl)} y={Y(L.an.Cl) + 14} textAnchor="middle">Cl</text><text x={X(L.an.SO4)} y={Y(L.an.SO4) - 6} textAnchor="middle">SO₄</text>
          <text x={X([d.bottom[0] + d.eC[0] - 0.05, d.bottom[1] + d.eC[1]])} y={Y([d.bottom[0] + d.eC[0], d.bottom[1] + d.eC[1]])} textAnchor="end">Ca+Mg ↑</text><text x={X([d.bottom[0] + d.eA[0] + 0.05, d.bottom[1] + d.eA[1]])} y={Y([d.bottom[0] + d.eA[0], d.bottom[1] + d.eA[1]])}>SO₄+Cl ↗</text>
        </g>}
        {w.map((r) => {
          const pp = piperPoints(piperPercents(r.meq))
          const col = colorAt(groups.indexOf(r.group))
          const on = linkedSet.has(r.i)
          return (
            <g key={r.i} data-testid="piper-sample" onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); linked?.set([r.i]); show(lp.x, lp.y, <><b>{r.group || `시료 ${r.i + 1}`}</b><br />Ca {fmt(piperPercents(r.meq).Ca, 3)}% · Mg {fmt(piperPercents(r.meq).Mg, 3)}% · Na+K {fmt(piperPercents(r.meq).NaK, 3)}%<br />HCO₃ {fmt(piperPercents(r.meq).HCO3, 3)}% · SO₄ {fmt(piperPercents(r.meq).SO4, 3)}% · Cl {fmt(piperPercents(r.meq).Cl, 3)}%</>) }} onPointerLeave={() => { hide(); linked?.set(null) }}>
              {[pp.cation, pp.anion, pp.diamond].map((p, k) => <circle key={k} cx={X(p)} cy={Y(p)} r={on ? 5.5 : 3.4} fill={col} fillOpacity={0.8} stroke={on ? '#111827' : '#fff'} strokeWidth={on ? 1.8 : 0.6} />)}
            </g>
          )
        })}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function PiperControls({ params, setParams }: ControlsProps<PiperParams>) {
  return (
    <ControlGroup title="파이퍼 도표">
      <Segmented label="입력 단위" value={params.unit} onChange={(unit) => setParams({ unit })} testId="ctl-unit" options={[{ value: 'mg', label: 'mg/L (당량으로 환산)' }, { value: 'meq', label: 'meq/L' }]} />
      <Hint>지하수의 주요 이온 조성을 세 개의 좌표에 한꺼번에 나타냅니다. 왼쪽 삼각형은 양이온(Ca, Mg, Na+K), 오른쪽 삼각형은 음이온(HCO₃, SO₄, Cl)의 당량 백분율이고, 가운데 마름모는 두 삼각형의 정보를 합쳐 %(Ca+Mg)와 %(SO₄+Cl)에 해당하는 위치로 시료 하나를 한 점으로 요약합니다. 마름모의 네 모서리가 수질 유형(Ca-HCO₃, Ca-SO₄/Cl, Na-Cl, Na-HCO₃)을 뜻합니다. 같은 시료가 세 곳에 점으로 찍히며, 단위는 mg/L를 당량 무게로 나누어 meq/L로 환산해 계산합니다.</Hint>
    </ControlGroup>
  )
}

export const piperModule: VizModule<PiperParams> = {
  roles: ionRoles,
  datasets: ['water-chem'],
  defaultParams: { unit: 'mg' },
  Chart: PiperChart,
  Controls: PiperControls,
  hint: '점에 올려 이온 구성비를 읽습니다 · 같은 시료는 세 좌표에 한 점씩 찍힙니다',
}

export interface StiffParams { max: number; shared: boolean }

function StiffChart({ table, mapping, params, width, height, compact, linked }: ChartProps<StiffParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const w = useWater(table, mapping, 'mg')
  const linkedSet = useMemo(() => new Set(linked?.rows ?? []), [linked?.rows])
  if (!w) return <ChartMessage>Ca, Mg, Na, K, HCO3, SO4, Cl 이온 농도 열을 모두 고르세요.</ChartMessage>
  const shown = w.slice(0, compact ? 6 : params.max)
  const cols = Math.max(1, Math.min(shown.length, Math.floor(width / (compact ? 70 : 150))))
  const rowsN = Math.ceil(shown.length / cols)
  const cw = width / cols, ch = Math.min(130, (height - (compact ? 4 : 28)) / rowsN)
  const rowsOf = shown.map((r) => stiffRows(r.meq))
  const gmax = Math.max(...rowsOf.flat().flatMap((q) => [q.left, q.right]), 1e-9)
  const groups = [...new Set(w.map((r) => r.group))]
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`스티프 도표: 시료 ${shown.length}개`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        {shown.map((r, k) => {
          const rows = rowsOf[k]
          const m = params.shared ? gmax : Math.max(...rows.flatMap((q) => [q.left, q.right]), 1e-9)
          const ox = (k % cols) * cw + cw / 2, oy = Math.floor(k / cols) * ch + 18
          const half = cw * 0.4, rowGap = (ch - 34) / 2
          const sx = (v: number) => (v / m) * half
          const pts = [...rows.map((q, i) => [ox - sx(q.left), oy + i * rowGap] as [number, number]), ...[...rows].reverse().map((q, i) => [ox + sx(q.right), oy + (2 - i) * rowGap] as [number, number])]
          const col = colorAt(groups.indexOf(r.group))
          const on = linkedSet.has(r.i)
          return (
            <g key={r.i} data-testid="stiff-pattern" data-vertices={pts.length} onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); linked?.set([r.i]); show(lp.x, lp.y, <><b>{r.group || `시료 ${r.i + 1}`}</b><br />{rows.map((q) => `${q.cation} ${fmt(q.left, 3)} | ${fmt(q.right, 3)} ${q.anion}`).map((t) => <span key={t}>{t}<br /></span>)}(meq/L)</>) }} onPointerLeave={() => { hide(); linked?.set(null) }}>
              <line x1={ox} x2={ox} y1={oy - 6} y2={oy + 2 * rowGap + 6} stroke="#9aa6a6" />
              <path d={'M' + pts.map((p) => `${p[0]},${p[1]}`).join('L') + 'Z'} fill={col} fillOpacity={0.35} stroke={on ? '#111827' : col} strokeWidth={on ? 2 : 1.4} />
              {!compact && rows.map((q, i) => <g key={q.cation} fontSize={9} fill="#6b7280"><text x={ox - half - 3} y={oy + i * rowGap} dy="0.3em" textAnchor="end">{q.cation}</text><text x={ox + half + 3} y={oy + i * rowGap} dy="0.3em">{q.anion}</text></g>)}
            </g>
          )
        })}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function StiffControls({ params, setParams }: ControlsProps<StiffParams>) {
  return (
    <ControlGroup title="스티프 도표">
      <Slider label="표시할 시료 수" value={params.max} min={2} max={24} onChange={(max) => setParams({ max })} testId="ctl-smax" />
      <Toggle label="모든 시료에 같은 눈금" checked={params.shared} onChange={(shared) => setParams({ shared })} testId="ctl-sshared" />
      <Hint>시료 하나를 중심축 양옆에 놓은 다각형으로 그립니다. 왼쪽은 양이온(Na+K, Ca, Mg), 오른쪽은 음이온(Cl, HCO₃, SO₄)의 당량 농도(meq/L)이며 같은 높이의 한 쌍이 한 행입니다. 다각형의 모양(쐐기, 한쪽으로 치우친 정도)과 크기로 물의 종류와 총 용존 이온량을 한눈에 비교하며, 같은 눈금을 쓰면 시료 사이의 크기 차이가 보이고 시료마다 따로 맞추면 모양만 비교됩니다. 레이더 차트와 달리 축이 좌우 대칭의 이온 쌍입니다.</Hint>
    </ControlGroup>
  )
}

export const stiffModule: VizModule<StiffParams> = {
  roles: ionRoles,
  datasets: ['water-chem'],
  defaultParams: { max: 12, shared: true },
  Chart: StiffChart,
  Controls: StiffControls,
  hint: '다각형의 모양으로 물의 유형을, 크기로 이온 총량을 비교합니다',
}

// ───────────────────────────── Skew-T Log-P ─────────────────────────────

export interface SkewParams { skew: number; adiabats: boolean; moist: boolean; mixing: boolean; parcel: boolean }

function SkewTChart({ table, mapping, params, width, height, compact }: ChartProps<SkewParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const prof = useMemo(() => {
    const p = numbers(table, roleColumn(mapping, 'p')), t = numbers(table, roleColumn(mapping, 't')), td = numbers(table, roleColumn(mapping, 'td'))
    if (!p || !t || !td) return null
    const rows = p.map((q, i) => ({ p: q, t: t[i], td: td[i] })).filter((r): r is { p: number; t: number; td: number } => r.p != null && r.t != null && r.td != null && r.p > 50 && r.p <= 1100).sort((a, b) => b.p - a.p)
    return rows.length >= 4 ? rows : null
  }, [table, mapping])
  if (!prof) return <ChartMessage>기압(hPa), 기온(°C), 이슬점(°C) 열을 고르세요(층 4개 이상).</ChartMessage>
  const pad = compact ? 6 : 38
  const pTop = 200, pBot = 1050
  const yOf = (p: number) => pad + ((Math.log(p) - Math.log(pTop)) / (Math.log(pBot) - Math.log(pTop))) * (height - 2 * pad)
  const xLo = -40, xHi = 40
  const sx = d3.scaleLinear().domain([xLo, xHi]).range([pad + (compact ? 0 : 6), width - pad])
  // skew: each ln(p0/p) unit shifts x by `skew` °C
  const X = (tC: number, p: number) => sx(skewT(tC, p, params.skew).x - 20)
  const line = (pts: { p: number; t: number }[]) => 'M' + pts.map((q) => `${X(q.t, q.p)},${yOf(q.p)}`).join('L')
  const ps = d3.range(1000, 199, -25)
  const iso = d3.range(-100, 50, 10)
  const surf = prof[0]
  const pcl = params.parcel ? parcelPath(surf.t, surf.td, surf.p) : null
  const mix = [1, 2, 4, 8, 12, 16, 20]
  const pseudo = d3.range(0, 41, 8).map((t0) => { const pts: { p: number; t: number }[] = [{ p: 1000, t: t0 }]; let T = t0 + 273.15, q = 1000; while (q > 200) { const h = -20, k1 = moistLapse(T, q), k2 = moistLapse(T + (h * k1) / 2, q + h / 2), k3 = moistLapse(T + (h * k2) / 2, q + h / 2), k4 = moistLapse(T + h * k3, q + h); T += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4); q += h; pts.push({ p: q, t: T - 273.15 }) } return pts })
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label="스큐-T 로그-P 도표" onPointerLeave={hide}>
        <defs><clipPath id="skewclip"><rect x={pad} y={yOf(pTop)} width={width - 2 * pad} height={yOf(pBot) - yOf(pTop)} /></clipPath></defs>
        <g clipPath="url(#skewclip)">
          {iso.map((t0) => <path key={t0} d={`M${X(t0, 1050)},${yOf(1050)}L${X(t0, 200)},${yOf(200)}`} stroke={t0 === 0 ? '#7aa8e0' : '#e1e6e6'} fill="none" data-testid="skew-isotherm" />)}
          {params.adiabats && d3.range(-30, 200, 10).map((th) => <path key={th} d={line(ps.map((p) => ({ p, t: dryAdiabat(th, p) })))} stroke="#e8c9a8" fill="none" data-testid="skew-dry" />)}
          {params.moist && pseudo.map((pts, i) => <path key={i} d={line(pts)} stroke="#a8d8b8" fill="none" strokeDasharray="4 3" data-testid="skew-moist" />)}
          {params.mixing && mix.map((w) => <path key={w} d={line(d3.range(1000, 599, -25).map((p) => { let lo = -60, hi = 40; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (satMixing(m, p) * 1000 < w) lo = m; else hi = m } return { p, t: (lo + hi) / 2 } }))} stroke="#cdb8e8" fill="none" strokeDasharray="2 3" />)}
          {pcl && <path d={line(pcl.path.map((q) => ({ p: q.p, t: q.t })))} stroke="#d4452f" strokeWidth={1.6} fill="none" strokeDasharray="5 3" data-testid="skew-parcel" />}
          <path d={line(prof.map((r) => ({ p: r.p, t: r.t })))} stroke="#d4452f" strokeWidth={2.6} fill="none" data-testid="skew-temp" />
          <path d={line(prof.map((r) => ({ p: r.p, t: r.td })))} stroke="#2a8c82" strokeWidth={2.6} fill="none" data-testid="skew-dew" />
          {prof.map((r, i) => <circle key={i} cx={X(r.t, r.p)} cy={yOf(r.p)} r={6} fill="transparent"
            onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{fmt(r.p, 4)} hPa</b><br />기온 {fmt(r.t, 3)}°C · 이슬점 {fmt(r.td, 3)}°C<br />이슬점 차이 {fmt(r.t - r.td, 3)}°C</>) }} onPointerLeave={hide} />)}
        </g>
        {pcl && <g data-testid="skew-lcl"><line x1={pad} x2={width - pad} y1={yOf(pcl.lcl.p)} y2={yOf(pcl.lcl.p)} stroke="#f59e0b" strokeDasharray="3 3" />{!compact && <text x={width - pad - 4} y={yOf(pcl.lcl.p) - 4} textAnchor="end" fontSize={10} fill="#b45309">LCL {Math.round(pcl.lcl.p)} hPa</text>}</g>}
        {!compact && [1000, 850, 700, 500, 400, 300, 200].map((p) => <text key={p} x={pad - 4} y={yOf(p)} dy="0.3em" textAnchor="end" fontSize={10} fill="#6b7280">{p}</text>)}
        {!compact && iso.filter((t0) => t0 >= -30 && t0 <= 40).map((t0) => <text key={t0} x={X(t0, 1050)} y={yOf(1050) + 12} textAnchor="middle" fontSize={9} fill="#9aa6a6">{t0}</text>)}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function SkewTControls({ params, setParams }: ControlsProps<SkewParams>) {
  return (
    <ControlGroup title="스큐-T 로그-P">
      <Slider label="온도축 기울기(°C / ln p)" value={params.skew} min={0} max={60} step={1} onChange={(skew) => setParams({ skew })} testId="ctl-skew" />
      <Toggle label="건조 단열선(θ)" checked={params.adiabats} onChange={(adiabats) => setParams({ adiabats })} testId="ctl-adiabats" />
      <Toggle label="습윤 단열선" checked={params.moist} onChange={(moist) => setParams({ moist })} testId="ctl-moist" />
      <Toggle label="포화 혼합비선" checked={params.mixing} onChange={(mixing) => setParams({ mixing })} testId="ctl-mixing" />
      <Toggle label="지표 공기 덩이 상승 경로와 LCL" checked={params.parcel} onChange={(parcel) => setParams({ parcel })} testId="ctl-parcel" />
      <Hint>세로축은 ln p(위로 갈수록 낮은 기압, 대략 높이에 비례), 가로축 등온선은 오른쪽으로 기울어져 있어 기온 곡선과 단열선이 약 45°에서 만나게 합니다. 붉은 곡선이 기온, 청록 곡선이 이슬점이며 둘 사이가 가까울수록 공기가 습합니다. 건조 단열선(θ 일정, T = θ(p/1000)^κ)과 습윤 단열선, 혼합비선을 바탕으로 깔아 공기 덩이를 들어 올리면 어떻게 식는지(LCL 아래는 건조, 위는 습윤 단열 하강률)를 읽습니다. 습윤 단열은 Rd·Lv 근사식을 룽게-쿠타로 적분한 것이며 대류가능에너지(CAPE) 계산은 하지 않았습니다.</Hint>
    </ControlGroup>
  )
}

export const skewTModule: VizModule<SkewParams> = {
  roles: [
    { key: 'p', label: '기압 (hPa)', type: 'number', required: true, prefer: '기압|pressure' },
    { key: 't', label: '기온 (°C)', type: 'number', required: true, prefer: '기온|temp' },
    { key: 'td', label: '이슬점 (°C)', type: 'number', required: true, prefer: '이슬점|dew' },
  ],
  datasets: ['sounding'],
  defaultParams: { skew: 35, adiabats: true, moist: true, mixing: true, parcel: true },
  Chart: SkewTChart,
  Controls: SkewTControls,
  hint: '기울기를 바꿔 보세요 · 붉은 점선이 지표 공기 덩이의 상승 경로, 노란 선이 응결 고도(LCL)',
}

// ───────────────────────────── Hasse diagram ─────────────────────────────

export interface HasseParams { closure: boolean; selected: string }

function HasseChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<HasseParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const poset = useMemo(() => {
    const ai = columnIndex(table, roleColumn(mapping, 'low')), bi = columnIndex(table, roleColumn(mapping, 'high'))
    if (ai < 0 || bi < 0) return null
    const pairs = table.rows.map((r) => [toLabel(r[ai]), toLabel(r[bi])] as [string, string]).filter(([a, b]) => a && b)
    return pairs.length ? hasse(pairs) : null
  }, [table, mapping])
  const rows = useMemo(() => (poset && !poset.cyclic ? hasseOrder(poset) : null), [poset])
  const [hover, setHover] = useState('')
  if (!poset) return <ChartMessage>아래 원소와 위 원소 열을 고르세요(a ≤ b인 쌍을 한 행에 하나씩).</ChartMessage>
  if (poset.cyclic || !rows) return <ChartMessage>부분순서가 아닙니다: 순환(반대칭성 위반)이 있어 a ≤ b ≤ … ≤ a인 원소가 있습니다.</ChartMessage>
  const padY = compact ? 12 : 34, padB = compact ? 12 : 56
  const L = rows.length
  const ly = (l: number) => height - padB - (L === 1 ? 0 : (l * (height - padY - padB)) / (L - 1))
  const pos = new Map<string, [number, number]>()
  rows.forEach((r, l) => r.forEach((e, i) => pos.set(e, [((i + 1) * width) / (r.length + 1), ly(l)])))
  const sel = params.selected
  const up = new Set<string>(), down = new Set<string>()
  if (sel) for (const e of poset.elements) { if (poset.closure.has(`${sel}\u0000${e}`)) up.add(e); if (poset.closure.has(`${e}\u0000${sel}`)) down.add(e) }
  const state = (e: string) => (e === sel ? 'sel' : up.has(e) ? 'up' : down.has(e) ? 'down' : sel ? 'dim' : 'on')
  const color = { sel: '#111827', up: '#d4452f', down: '#4c6fb5', dim: '#cfd8d8', on: '#2a8c82' }
  const closureEdges = poset.closure.size - poset.covers.length
  const R = compact ? 3.5 : Math.min(16, Math.max(7, width / (Math.max(...rows.map((r) => r.length)) * 3.2)))
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`하세 도표: 원소 ${poset.elements.length}개, 피복 관계 ${poset.covers.length}개`} onPointerLeave={hide}>
        {params.closure && !compact && [...poset.closure].map((k) => { const [a, b] = k.split('\u0000'); if (poset.covers.some(([x, y]) => x === a && y === b)) return null; const p = pos.get(a)!, q = pos.get(b)!; return <line key={k} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke="#e5d9d2" strokeDasharray="3 3" data-testid="hasse-closure" /> })}
        {poset.covers.map(([a, b]) => { const p = pos.get(a)!, q = pos.get(b)!; const on = !sel || ((a === sel || down.has(a)) && (b === sel || down.has(b))) || ((a === sel || up.has(a)) && (b === sel || up.has(b))); return <line key={`${a}-${b}`} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={on ? '#6b7280' : '#e5ebeb'} strokeWidth={1.4} data-testid="hasse-cover" /> })}
        {poset.elements.map((e) => { const p = pos.get(e)!; return (
          <g key={e} data-testid="hasse-node" data-state={state(e)} data-level={poset.level.get(e)} style={{ cursor: 'pointer' }} onClick={() => setParams({ selected: sel === e ? '' : e })}
            onPointerEnter={compact ? undefined : (ev) => { setHover(e); const lp = localPoint(svgRef.current!, ev); show(lp.x, lp.y, <><b>{e}</b> · 층 {poset.level.get(e)}<br />위로 이어진 원소 {[...poset.closure].filter((k) => k.startsWith(`${e}\u0000`)).length}개 · 아래 {[...poset.closure].filter((k) => k.endsWith(`\u0000${e}`)).length}개</>) }} onPointerLeave={() => { setHover(''); hide() }}>
            <circle cx={p[0]} cy={p[1]} r={R} fill={color[state(e)]} fillOpacity={state(e) === 'dim' ? 0.5 : 0.92} stroke={hover === e ? '#111827' : '#fff'} strokeWidth={1.4} />
            {!compact && R >= 8 && <text x={p[0]} y={p[1]} textAnchor="middle" dy="0.34em" fontSize={Math.min(11, R)} fill="#fff" pointerEvents="none">{e.length > 4 ? e.slice(0, 3) + '…' : e}</text>}
          </g>
        ) })}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
      {!compact && <p className="chart-note" role="note" style={{ left: 8, right: 'auto', bottom: 2 }} data-testid="hasse-readout">피복 관계 {poset.covers.length}개 · 이행적으로 생략된 관계 {closureEdges}개 · 최소 원소 {poset.minimal.join(', ')} · 최대 원소 {poset.maximal.join(', ')}</p>}
    </div>
  )
}

function HasseControls({ params, setParams }: ControlsProps<HasseParams>) {
  return (
    <ControlGroup title="하세 도표">
      <Toggle label="생략된 이행 관계를 점선으로 표시" checked={params.closure} onChange={(closure) => setParams({ closure })} testId="ctl-closure" />
      <Hint>부분순서 집합(반사성·반대칭성·추이성)을 방향 없는 그래프로 그립니다. a ≤ b이고 둘 사이에 다른 원소가 없을 때(b가 a를 ‘덮을’ 때)만 선을 긋는 이행적 축약(피복 관계)이며, 큰 원소가 항상 위에 옵니다. 층은 최소 원소에서의 가장 긴 사슬 길이입니다. 원소를 누르면 그보다 큰 원소(붉은색)와 작은 원소(파란색)가 강조됩니다. 입력에서 순환(a ≤ b ≤ … ≤ a)이 발견되면 반대칭성 위반으로 알립니다. 일반 DAG 배치와 달리 선이 아니라 순서 구조 자체(이행 관계, 위로 향하는 방향)를 읽는 도표입니다.</Hint>
    </ControlGroup>
  )
}

export const hasseModule: VizModule<HasseParams> = {
  roles: [
    { key: 'low', label: '아래 원소 (a ≤ b에서 a)', type: 'category', required: true, prefer: '아래|low' },
    { key: 'high', label: '위 원소 (a ≤ b에서 b)', type: 'category', required: true, prefer: '위|high' },
  ],
  datasets: ['poset'],
  defaultParams: { closure: false, selected: '' },
  Chart: HasseChart,
  Controls: HasseControls,
  hint: '원소를 눌러 그보다 큰 원소(붉은색)와 작은 원소(파란색)를 봅니다',
}
