import * as d3 from 'd3'
import { Trash2 } from 'lucide-react'
import { useMemo, useRef, type PointerEvent } from 'react'
import { ChartMessage, Legend, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, NumberField, Select, Slider, StatTable, Toggle } from '../../components/controls'
import { columnIndex, removeRows, toLabel, toNumber, updateRow, type DataTable } from '../../data/table'
import { fmt } from '../../lib/format'
import { CONSTANTS, capability, controlTypes, detectSignals, ruleLabels, type ControlType, type RuleId, type Signal } from '../../stats/control'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'
import { paddedDomain } from './shared'

export interface ControlParams {
  type: 'auto' | ControlType
  /** Number of leading points used to set the limits (0 = all). The rest are judged against those limits. */
  baseline: number
  rules: RuleId[]
  zones: boolean
  spec: boolean
  lsl: number
  usl: number
  selected: number
}

interface Pt { i: number; value: number; rows: number[]; label: string; n?: number }

export function effectiveType(params: ControlParams, mapping: Mapping): ControlType {
  if (params.type !== 'auto') return params.type
  return roleColumn(mapping, 'group') ? 'xbar' : roleColumn(mapping, 'n') ? 'p' : 'imr'
}

/** Reads the plotted points for a chart type. Subgroups (X̄) need at least 2 values; p points need 0 ≤ defects ≤ inspected. */
function readPoints(table: DataTable, mapping: Mapping, type: ControlType) {
  const vi = columnIndex(table, roleColumn(mapping, 'value'))
  const gi = columnIndex(table, roleColumn(mapping, 'group'))
  const ni = columnIndex(table, roleColumn(mapping, 'n'))
  const xi = columnIndex(table, roleColumn(mapping, 'x'))
  const lab = (r: DataTable['rows'][number], row: number) => (xi >= 0 ? toLabel(r[xi]) : String(row + 1))
  const pts: Pt[] = []
  const groups: number[][] = []
  let skipped = 0
  if (vi < 0) return { pts, groups, skipped }
  if (type === 'xbar') {
    if (gi < 0) return { pts, groups, skipped }
    const by = new Map<string, { vals: number[]; rows: number[]; label: string }>()
    table.rows.forEach((r, row) => {
      const v = toNumber(r[vi]); const g = toLabel(r[gi])
      if (v == null || !g) { skipped++; return }
      const e = by.get(g) ?? { vals: [], rows: [], label: lab(r, row) }
      e.vals.push(v); e.rows.push(row); by.set(g, e)
    })
    for (const e of by.values()) {
      if (e.vals.length < 2) { skipped += e.vals.length; continue }
      groups.push(e.vals)
      pts.push({ i: pts.length, value: d3.mean(e.vals)!, rows: e.rows, label: e.label, n: e.vals.length })
    }
    return { pts, groups, skipped }
  }
  table.rows.forEach((r, row) => {
    const v = toNumber(r[vi])
    if (v == null) { skipped++; return }
    if (type === 'p') {
      const n = ni >= 0 ? toNumber(r[ni]) : null
      if (n == null || !(n > 0) || v < 0 || v > n) { skipped++; return }
      pts.push({ i: pts.length, value: v / n, rows: [row], label: lab(r, row), n })
    } else if (type === 'c' && v < 0) skipped++
    else pts.push({ i: pts.length, value: v, rows: [row], label: lab(r, row) })
  })
  return { pts, groups, skipped }
}

interface Computed {
  values: number[]
  center: number[]
  sigma: number[]
  ucl: number[]
  lcl: number[]
  range?: { values: number[]; center: number; ucl: number; lcl: number; label: string }
  label: string
  /** Number of points the limits were estimated from. */
  base: number
}

/** Limits from the first `base` points (all when 0), applied to every point. */
function compute(type: ControlType, pts: Pt[], groups: number[][], baseline: number): Computed | null {
  const n = pts.length
  const base = baseline > 0 ? Math.max(2, Math.min(n, baseline)) : n
  const mean = (v: readonly number[]) => v.reduce((s, x) => s + x, 0) / v.length
  const fill = (v: number) => new Array<number>(n).fill(v)
  if (n < 2 && type !== 'c' && type !== 'p') return null
  if (type === 'imr') {
    const x = pts.map((p) => p.value)
    const mrBase = x.slice(1, base).map((v, i) => Math.abs(v - x[i]))
    if (!mrBase.length) return null
    const mrBar = mean(mrBase)
    const c = mean(x.slice(0, base))
    const s = mrBar / CONSTANTS[2].d2
    return { values: x, center: fill(c), sigma: fill(s), ucl: fill(c + 3 * s), lcl: fill(c - 3 * s), label: '개별값', base,
      range: { values: [NaN, ...x.slice(1).map((v, i) => Math.abs(v - x[i]))], center: mrBar, ucl: CONSTANTS[2].D4 * mrBar, lcl: 0, label: '이동범위 MR' } }
  }
  if (type === 'xbar') {
    if (!groups.length) return null
    const size = Math.round(mean(groups.map((g) => g.length)))
    const k = CONSTANTS[Math.max(2, Math.min(10, size))]
    const ranges = groups.map((g) => Math.max(...g) - Math.min(...g))
    const means = groups.map(mean)
    const grand = mean(means.slice(0, base))
    const rBar = mean(ranges.slice(0, base))
    const s = (k.A2 * rBar) / 3
    return { values: means, center: fill(grand), sigma: fill(s), ucl: fill(grand + 3 * s), lcl: fill(grand - 3 * s), label: '부분군 평균 X̄', base,
      range: { values: ranges, center: rBar, ucl: k.D4 * rBar, lcl: k.D3 * rBar, label: '부분군 범위 R' } }
  }
  if (type === 'p') {
    const b = pts.slice(0, base)
    const pbar = b.reduce((s, p) => s + p.value * p.n!, 0) / b.reduce((s, p) => s + p.n!, 0)
    const sg = pts.map((p) => Math.sqrt((pbar * (1 - pbar)) / p.n!))
    return { values: pts.map((p) => p.value), center: fill(pbar), sigma: sg, ucl: sg.map((s) => Math.min(1, pbar + 3 * s)), lcl: sg.map((s) => Math.max(0, pbar - 3 * s)), label: '불량률 p', base }
  }
  const cbar = mean(pts.slice(0, base).map((p) => p.value))
  const s = Math.sqrt(cbar)
  return { values: pts.map((p) => p.value), center: fill(cbar), sigma: fill(s), ucl: fill(cbar + 3 * s), lcl: fill(Math.max(0, cbar - 3 * s)), label: '결함 수 c', base }
}

const RULE_COLOR: Record<RuleId, string> = { 1: '#d2492f', 2: '#e07a3f', 3: '#9a5fb0', 5: '#2f6fb3' }

function useControl(table: DataTable, mapping: Mapping, params: ControlParams) {
  const type = effectiveType(params, mapping)
  const { pts, groups, skipped } = useMemo(() => readPoints(table, mapping, type), [table, mapping, type])
  const lim = useMemo(() => compute(type, pts, groups, params.baseline), [type, pts, groups, params.baseline])
  const signals = useMemo(() => (lim ? detectSignals(lim, params.rules) : []), [lim, params.rules])
  return { type, pts, lim, signals, skipped }
}

function ControlChart({ table, mapping, params, setParams, width, height, compact, onTableChange, linked }: ChartProps<ControlParams>) {
  const { type, pts, lim, signals, skipped } = useControl(table, mapping, params)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<number | null>(null)
  const marked = new Set(linked?.rows ?? [])
  const editable = !!onTableChange && !compact
  const hasRange = !!lim?.range
  // The rule legend lists one line per signal kind that occurred; on a phone each line is its own row above the plot.
  const legendRows = new Set(signals.map((x) => x.rule)).size
  const m = margins(compact, compact ? {} : { top: width < 520 ? 76 + 26 * legendRows : 40, bottom: hasRange ? 36 : 48, left: 62 })
  const iw = Math.max(40, width - m.left - m.right)
  const totalH = Math.max(80, height - m.top - m.bottom)
  const gapH = hasRange && !compact ? 38 : hasRange ? 4 : 0
  const h1 = hasRange ? (totalH - gapH) * 0.66 : totalH
  const h2 = hasRange ? totalH - gapH - h1 : 0

  if (!roleColumn(mapping, 'value')) return <ChartMessage>측정값(숫자형) 열을 선택하세요.</ChartMessage>
  if (type === 'xbar' && !roleColumn(mapping, 'group')) return <ChartMessage>X̄ 관리도에는 ‘부분군’ 열이 필요합니다.<small>같은 부분군에 속한 측정값을 묶는 열입니다. 부분군이 없으면 개별값 I-MR을 고르세요.</small></ChartMessage>
  if (type === 'p' && !roleColumn(mapping, 'n')) return <ChartMessage>p 관리도에는 ‘검사 수’ 열이 필요합니다.<small>값 열은 불량 개수, 검사 수 열은 그날 검사한 개수입니다.</small></ChartMessage>
  if (!lim || pts.length < 2) return <ChartMessage>관리도를 그릴 데이터가 부족합니다.<small>{type === 'xbar' ? '부분군마다 값이 2개 이상 필요합니다.' : '값이 2개 이상 필요합니다.'}</small></ChartMessage>

  const n = pts.length
  const x = d3.scalePoint<number>().domain(d3.range(n)).range([0, iw]).padding(0.4)
  const sigmaAll = d3.max(lim.sigma) ?? 0
  const specVals = params.spec && type !== 'p' && type !== 'c' ? [params.lsl, params.usl] : []
  const yd = paddedDomain([...lim.values, ...lim.ucl, ...lim.lcl, ...specVals], 0.1)
  const y = d3.scaleLinear().domain(yd).range([h1, 0])
  const r = lim.range
  const ry = r ? d3.scaleLinear().domain(paddedDomain([...r.values.filter(Number.isFinite), r.ucl, r.lcl], 0.1, true)).range([h2, 0]) : null
  const sigByIdx = new Map<number, Signal[]>()
  for (const s of signals) sigByIdx.set(s.index, [...(sigByIdx.get(s.index) ?? []), s])
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 96))))
  const path = (a: number[], sc: d3.ScaleLinear<number, number>) => a.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${sc(v)}`).join('')
  const stepPath = (a: number[]) => a.map((v, i) => `${i ? 'L' : 'M'}${x(i)! - (i ? x.step() / 2 : 0)},${y(v)}L${x(i)! + (i < a.length - 1 ? x.step() / 2 : 0)},${y(v)}`).join('')
  const fmtV = (v: number) => (type === 'p' ? `${fmt(v * 100, 1)}%` : fmt(v, 4))
  const del = () => {
    const p = pts[params.selected]
    if (p) { onTableChange!(removeRows(table, p.rows)); setParams({ selected: -1 }) }
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (drag.current == null) return
    const p = pts[drag.current]
    const vc = roleColumn(mapping, 'value')!
    const target = y.invert(localPoint(svgRef.current!, e).y - m.top)
    if (!p || !Number.isFinite(target)) return
    let next = table
    if (type === 'p') next = updateRow(next, p.rows[0], { [vc]: Math.max(0, Math.min(p.n!, Math.round(target * p.n!))) })
    else if (type === 'c') next = updateRow(next, p.rows[0], { [vc]: Math.max(0, Math.round(target)) })
    else if (type === 'imr') next = updateRow(next, p.rows[0], { [vc]: Math.round(target * 1e3) / 1e3 })
    else { const delta = target - p.value; for (const row of p.rows) next = updateRow(next, row, { [vc]: Math.round((toNumber(table.rows[row][columnIndex(table, vc)])! + delta) * 1e3) / 1e3 }) }
    onTableChange!(next, true)
  }
  const onUp = () => { if (drag.current != null) { drag.current = null; onTableChange!(table, false) } }
  const lineLabel = (v: number, name: string, color: string) => !compact && <text className="bar-label" x={iw + 4} y={y(v)} dy="0.32em" fill={color} style={{ pointerEvents: 'none' }}>{name}</text>

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`관리도 ${lim.label}: 점 ${n}개, 신호 ${signals.length}개`} tabIndex={editable ? 0 : undefined}
        onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => { hide(); linked?.set(null) }}
        onKeyDown={(e) => { if (editable && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); del() } }}>
        <g transform={`translate(${m.left},${m.top})`}>
          {/* value panel */}
          {!compact && d3.ticks(yd[0], yd[1], 5).map((v) => <g key={v}><line className="grid" x1={0} x2={iw} y1={y(v)} y2={y(v)} /><text className="axis" x={-9} y={y(v)} dy="0.32em" textAnchor="end" style={{ fontSize: 11 }}>{type === 'p' ? `${fmt(v * 100, 1)}%` : fmt(v, 4)}</text></g>)}
          {!compact && <text className="axis-label" transform={`translate(-46,${h1 / 2}) rotate(-90)`} textAnchor="middle">{lim.label}</text>}
          {params.zones && sigmaAll > 0 && [1, 2].map((k) => ['+', '-'].map((sg) => <path key={`${k}${sg}`} d={stepPath(lim.center.map((c, i) => c + (sg === '+' ? 1 : -1) * k * lim.sigma[i]))} fill="none" stroke="#9aa6a2" strokeWidth={0.8} strokeDasharray="2 3" />))}
          <path data-testid="ctl-ucl" d={stepPath(lim.ucl)} data-value={lim.ucl[0].toFixed(5)} fill="none" stroke="#d2492f" strokeWidth={1.4} />
          <path data-testid="ctl-lcl" d={stepPath(lim.lcl)} data-value={lim.lcl[0].toFixed(5)} fill="none" stroke="#d2492f" strokeWidth={1.4} />
          <path data-testid="ctl-center" d={stepPath(lim.center)} data-value={lim.center[0].toFixed(5)} fill="none" stroke="#2a7d74" strokeWidth={1.4} />
          {lineLabel(lim.ucl[n - 1], 'UCL', '#d2492f')}{lineLabel(lim.lcl[n - 1], 'LCL', '#d2492f')}{lineLabel(lim.center[n - 1], 'CL', '#2a7d74')}
          {specVals.map((v, i) => (
            <g key={i}><line data-testid={i ? 'spec-usl' : 'spec-lsl'} x1={0} x2={iw} y1={y(v)} y2={y(v)} stroke="#8a4fff" strokeWidth={1.4} strokeDasharray="1 4" strokeLinecap="round" />{!compact && <text className="bar-label" x={iw + 4} y={y(v)} dy="0.32em" fill="#8a4fff">{i ? 'USL' : 'LSL'} (규격)</text>}</g>
          ))}
          {lim.base < n && <g><line x1={x(lim.base - 1)! + x.step() / 2} x2={x(lim.base - 1)! + x.step() / 2} y1={0} y2={totalH} stroke="#b9c3bf" strokeDasharray="3 3" />{!compact && <text className="bar-label" x={x(lim.base - 1)! + x.step() / 2 + 4} y={10}>← 한계 계산 구간 | 판정 구간 →</text>}</g>}
          <path d={path(lim.values, y)} fill="none" stroke="#5a6b66" strokeWidth={1.2} />
          {pts.map((p) => {
            const sg = sigByIdx.get(p.i)
            const on = params.selected === p.i || p.rows.some((q) => marked.has(q))
            const color = sg ? RULE_COLOR[sg.slice().sort((a, b) => a.rule - b.rule)[0].rule] : '#2a7d74'
            return (
              <circle key={p.i} data-testid="ctl-point" data-i={p.i} data-signal={sg ? sg.map((s) => s.rule).join(',') : undefined} data-nodrag="" cx={x(p.i)} cy={y(p.value)} r={on ? 6 : sg ? (compact ? 2.5 : 5) : compact ? 1.8 : 3.4} fill={sg ? color : '#ffffff'} stroke={sg ? (on ? '#121816' : '#ffffff') : on ? '#121816' : '#2a7d74'} strokeWidth={on ? 2 : 1.4}
                style={{ cursor: editable ? 'grab' : compact ? undefined : 'pointer', touchAction: editable ? 'none' : undefined }}
                onPointerDown={editable ? (e) => { e.stopPropagation(); svgRef.current!.setPointerCapture(e.pointerId); drag.current = p.i; setParams({ selected: p.i }); hide() } : compact ? undefined : () => setParams({ selected: params.selected === p.i ? -1 : p.i })}
                onPointerEnter={compact ? undefined : (e) => { if (drag.current != null) return; linked?.set(p.rows); const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{p.label}</b>{type === 'xbar' ? <> · 부분군 {p.n}개</> : null}<br />{fmtV(p.value)}{type === 'p' ? <> ({Math.round(p.value * p.n!)}/{p.n})</> : null}<br />한계 {fmtV(lim.lcl[p.i])} ~ {fmtV(lim.ucl[p.i])}{sg ? <><br />{sg.map((s) => ruleLabels[s.rule]).join(' · ')}</> : null}{editable ? <><br />위아래로 끌어 값 수정</> : null}</>) }}
                onPointerLeave={() => { hide(); linked?.set(null) }} />
            )
          })}
          {/* range panel */}
          {r && ry && (
            <g transform={`translate(0,${h1 + gapH})`}>
              {!compact && d3.ticks(ry.domain()[0], ry.domain()[1], 3).map((v) => <g key={v}><line className="grid" x1={0} x2={iw} y1={ry(v)} y2={ry(v)} /><text className="axis" x={-9} y={ry(v)} dy="0.32em" textAnchor="end" style={{ fontSize: 11 }}>{fmt(v, 3)}</text></g>)}
              {!compact && <text className="axis-label" transform={`translate(-46,${h2 / 2}) rotate(-90)`} textAnchor="middle">{r.label}</text>}
              <line data-testid="ctl-range-ucl" data-value={r.ucl.toFixed(5)} x1={0} x2={iw} y1={ry(r.ucl)} y2={ry(r.ucl)} stroke="#d2492f" strokeWidth={1.2} />
              {r.lcl > 0 && <line x1={0} x2={iw} y1={ry(r.lcl)} y2={ry(r.lcl)} stroke="#d2492f" strokeWidth={1.2} />}
              <line x1={0} x2={iw} y1={ry(r.center)} y2={ry(r.center)} stroke="#2a7d74" strokeWidth={1.2} />
              <path d={r.values.map((v, i) => (Number.isFinite(v) ? `${i && Number.isFinite(r.values[i - 1]) ? 'L' : 'M'}${x(i)},${ry(v)}` : '')).join('')} fill="none" stroke="#5a6b66" strokeWidth={1} />
              {r.values.map((v, i) => Number.isFinite(v) && <circle key={i} cx={x(i)} cy={ry(v)} r={compact ? 1.5 : 2.8} fill={v > r.ucl || v < r.lcl ? '#d2492f' : '#ffffff'} stroke={v > r.ucl || v < r.lcl ? '#d2492f' : '#2a7d74'} />)}
            </g>
          )}
          {!compact && (
            <g transform={`translate(0,${totalH})`} className="axis" aria-hidden="true">
              <line className="domain" x1={0} x2={iw} />
              {pts.filter((p) => p.i % step === 0).map((p) => <g key={p.i} transform={`translate(${x(p.i)},0)`}><line y2={5} /><text y={18} textAnchor="middle">{p.label.length > 10 ? p.label.slice(5, 16).replace('T', ' ') : p.label}</text></g>)}
            </g>
          )}
        </g>
      </svg>
      {!compact && (
        <>
          <Legend items={[...new Set(signals.map((s) => s.rule))].sort().map((rule) => ({ key: ruleLabels[rule as RuleId], color: RULE_COLOR[rule as RuleId] }))} />
          <Readout items={[{ label: '점', value: n }, { label: '중심', value: fmtV(lim.center[0]) }, { label: '신호', value: signals.length ? [...new Set(signals.map((s) => s.index))].length : '없음' }]} />
          {skipped > 0 && <p className="chart-warning" role="status">값이 없거나 범위가 올바르지 않은 {skipped}행은 제외했습니다.</p>}
          {editable && params.selected >= 0 && params.selected < pts.length && <div className="chart-actions" style={{ bottom: 6, right: 8 }}><span>{pts[params.selected].label}</span><button type="button" onClick={del} data-testid="ctl-delete"><Trash2 size={14} aria-hidden="true" />삭제</button></div>}
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function ControlControls({ params, setParams, table, mapping }: ControlsProps<ControlParams>) {
  const { type, pts, lim, signals } = useControl(table, mapping, params)
  const info = controlTypes.find((t) => t.value === type)
  const cap = lim && (type === 'imr' || type === 'xbar')
    ? capability(lim.center[0], type === 'xbar' ? lim.sigma[0] * Math.sqrt(Math.round(d3.mean(pts, (p) => p.n ?? 1) ?? 1)) : lim.sigma[0], params.lsl, params.usl)
    : null
  const toggleRule = (r: RuleId) => setParams({ rules: params.rules.includes(r) ? params.rules.filter((x) => x !== r) : [...params.rules, r].sort() as RuleId[] })
  return (
    <>
      <ControlGroup title="관리도 종류">
        <Select label="종류" value={params.type} onChange={(t) => setParams({ type: t })} testId="ctl-control-type"
          options={[{ value: 'auto', label: `자동 (${controlTypes.find((t) => t.value === type)?.label ?? ''})` }, ...controlTypes.map((t) => ({ value: t.value as 'auto' | ControlType, label: t.label }))]} />
        {info && <Hint>{info.hint}</Hint>}
        <Slider label="한계 계산에 쓰는 앞쪽 점 수 (0 = 전체)" value={params.baseline} min={0} max={Math.max(2, pts.length)} onChange={(baseline) => setParams({ baseline })} testId="ctl-baseline" />
        <Hint>안정된 구간으로 중심선과 관리한계를 정하고 이후 점을 그 한계로 판정합니다. 0이면 모든 점으로 계산하므로 이동한 구간이 한계를 넓혀 신호가 묻힐 수 있습니다.</Hint>
      </ControlGroup>
      <ControlGroup title="신호 규칙">
        {([1, 2, 3, 5] as RuleId[]).map((rule) => <Toggle key={rule} label={ruleLabels[rule]} checked={params.rules.includes(rule)} onChange={() => toggleRule(rule)} testId={`ctl-rule-${rule}`} />)}
        <Toggle label="±1σ·±2σ 구역선" checked={params.zones} onChange={(zones) => setParams({ zones })} />
        <Hint>신호는 ‘공정이 우연변동만으로는 설명되지 않는다’는 뜻이지 불량이라는 뜻이 아닙니다. 규칙을 많이 켤수록 안정된 공정에서도 거짓 경보가 늘어납니다.</Hint>
      </ControlGroup>
      <ControlGroup title="규격 한계 (관리한계와 다름)" defaultOpen={false}>
        <Toggle label="규격 한계 표시 (개별값·평균 관리도)" checked={params.spec} onChange={(spec) => setParams({ spec })} testId="ctl-spec" />
        <NumberField label="하한 LSL" value={params.lsl} onChange={(lsl) => setParams({ lsl })} step={0.5} testId="ctl-lsl" />
        <NumberField label="상한 USL" value={params.usl} onChange={(usl) => setParams({ usl })} step={0.5} testId="ctl-usl" />
        <Hint>관리한계(UCL/LCL)는 공정이 스스로 보이는 변동에서 계산한 ‘목소리’이고, 규격한계는 고객·설계가 정한 ‘요구’입니다. 둘은 관계가 없습니다. 개별값을 규격과 비교하는 것이 맞고, 부분군 평균을 규격과 비교하면 안 됩니다(평균은 개별값보다 덜 흩어지기 때문입니다).</Hint>
        {cap && params.spec && <StatTable rows={[['공정 평균', fmt(lim!.center[0], 4)], ['σ̂ (군내)', fmt(type === 'xbar' ? lim!.sigma[0] * Math.sqrt(Math.round(d3.mean(pts, (p) => p.n ?? 1) ?? 1)) : lim!.sigma[0], 4)], ['Cp', cap.cp == null ? '–' : fmt(cap.cp, 3)], ['Cpk', cap.cpk == null ? '–' : fmt(cap.cpk, 3)]]} />}
      </ControlGroup>
      {lim && <p className="hint" style={{ margin: '4px 0' }}>신호가 있는 점 {[...new Set(signals.map((s) => s.index))].length}개 / 전체 {pts.length}개</p>}
    </>
  )
}

export const controlModule: VizModule<ControlParams> = {
  roles: [
    { key: 'value', label: '측정값 · 불량 수 · 결함 수', type: 'number', required: true },
    { key: 'group', label: '부분군 (X̄ 관리도)', type: 'category', auto: true, prefer: '부분군|group|subgroup' },
    { key: 'n', label: '검사 수 (p 관리도)', type: 'number', auto: true, prefer: '검사|inspected|표본' },
    { key: 'x', label: '시점·순서 (선택)', type: 'date', accept: ['date', 'number', 'category'], auto: true, prefer: '시점|일자|date|time' },
  ],
  datasets: ['process', 'process-counts'],
  defaultParams: { type: 'auto', baseline: 0, rules: [1, 2, 3, 5], zones: false, spec: false, lsl: 46, usl: 54, selected: -1 },
  Chart: ControlChart,
  Controls: ControlControls,
  hint: '점을 위아래로 끌어 값 수정 · 신호가 켜진 점은 색으로 표시 · 한계 계산 구간을 앞쪽으로 줄여 이후 이동을 판정 · 관리한계와 규격한계는 다릅니다',
}
