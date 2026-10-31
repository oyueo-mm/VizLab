import * as d3 from 'd3'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Legend, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ColorField, ControlGroup, Hint, Slider, Toggle } from '../../components/controls'
import { columnIndex, toNumber, updateRow, type DataTable } from '../../data/table'
import { fmt, pct } from '../../lib/format'
import { fanIssue, FAN_LEVELS, repairFan } from '../../stats/fan'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'
import { dragDigits, roundTo, xFormat, xOfCell } from './shared'

export interface FanParams {
  /** Interval levels drawn (subset of 0.5, 0.8, 0.95). */
  levels: number[]
  opacity: number
  color: string
  /** Number of forecast points shown (0 = all). */
  horizon: number
  /** Multiplier on every interval's half-width around the centre. */
  widen: number
  actual: boolean
}

const LEVEL_KEYS: Record<number, [string, string]> = { 0.5: ['lo50', 'hi50'], 0.8: ['lo80', 'hi80'], 0.95: ['lo95', 'hi95'] }

interface Row { row: number; x: number; actual: number | null; center: number | null; lo: Record<number, number>; hi: Record<number, number> }

function fanRows(table: DataTable, mapping: Mapping) {
  const xc = roleColumn(mapping, 'x')
  const xi = columnIndex(table, xc)
  const date = table.columns[xi]?.type === 'date'
  const ai = columnIndex(table, roleColumn(mapping, 'actual'))
  const ci = columnIndex(table, roleColumn(mapping, 'center'))
  const bands = FAN_LEVELS.map((lv) => [lv, columnIndex(table, roleColumn(mapping, LEVEL_KEYS[lv][0])), columnIndex(table, roleColumn(mapping, LEVEL_KEYS[lv][1]))] as const).filter(([, a, b]) => a >= 0 && b >= 0)
  const rows: Row[] = []
  table.rows.forEach((r, row) => {
    const x = xi >= 0 ? xOfCell(r[xi], date) : null
    if (x == null) return
    const lo: Record<number, number> = {}
    const hi: Record<number, number> = {}
    for (const [lv, a, b] of bands) { const l = toNumber(r[a]); const h = toNumber(r[b]); if (l != null && h != null) { lo[lv] = l; hi[lv] = h } }
    rows.push({ row, x, actual: ai >= 0 ? toNumber(r[ai]) : null, center: ci >= 0 ? toNumber(r[ci]) : null, lo, hi })
  })
  rows.sort((a, b) => a.x - b.x)
  return { rows, date, levels: bands.map(([lv]) => lv as number) }
}

/** Which forecast rows break the nesting rules (centre inside every interval, wider intervals containing narrower ones). */
export function fanProblems(table: DataTable, mapping: Mapping) {
  const { rows, levels } = fanRows(table, mapping)
  return rows.filter((r) => r.center != null).map((r) => ({ row: r.row, text: levels.some((lv) => r.lo[lv] == null) ? '일부 구간의 하한·상한이 비어 있습니다.' : fanIssue({ center: r.center!, lo: r.lo, hi: r.hi }, levels) })).filter((p): p is { row: number; text: string } => !!p.text)
}

function FanChart({ table, mapping, params, width, height, compact, onTableChange }: ChartProps<FanParams>) {
  const { rows, date, levels } = useMemo(() => fanRows(table, mapping), [table, mapping])
  const fx = xFormat(date)
  const forecast = rows.filter((r) => r.center != null)
  const horizon = params.horizon > 0 ? Math.min(params.horizon, forecast.length) : forecast.length
  const shownForecast = forecast.slice(0, horizon)
  const lastX = shownForecast.length ? shownForecast[shownForecast.length - 1].x : Infinity
  const history = rows.filter((r) => r.actual != null && r.center == null)
  const actualPts = rows.filter((r) => r.actual != null && r.x <= lastX)
  const problems = useMemo(() => fanProblems(table, mapping), [table, mapping])
  const bad = new Set(problems.map((p) => p.row))
  const narrow = width < 520
  const m = margins(compact, narrow && !compact ? { top: 78 } : {})
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ row: number; domain: [number, number] } | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const { tip, show, hide } = useTooltip()

  if (!roleColumn(mapping, 'x') || !roleColumn(mapping, 'center')) return <ChartMessage>날짜(또는 순서)와 예측 중심값 열을 선택하세요.</ChartMessage>
  if (!shownForecast.length && !history.length) return <ChartMessage>예측값이 있는 행이 없습니다.</ChartMessage>
  const drawn = params.levels.filter((lv) => levels.includes(lv)).sort((a, b) => b - a)
  const w = (r: Row, lv: number, side: 'lo' | 'hi') => {
    const c = r.center!
    const edge = side === 'lo' ? r.lo[lv] : r.hi[lv]
    return c + (edge - c) * params.widen
  }
  const xs = [...history, ...shownForecast, ...actualPts].map((r) => r.x)
  const x = d3.scaleLinear().domain(d3.extent(xs) as [number, number]).range([0, iw])
  const ys = [
    ...history.map((r) => r.actual!), ...actualPts.map((r) => r.actual!),
    ...shownForecast.flatMap((r) => [r.center!, ...drawn.flatMap((lv) => (r.lo[lv] != null ? [w(r, lv, 'lo'), w(r, lv, 'hi')] : []))]),
  ].filter(Number.isFinite)
  const lo = d3.min(ys) ?? 0
  const hi = d3.max(ys) ?? 1
  const sp = hi - lo || 1
  const y = d3.scaleLinear().domain(drag.current?.domain ?? [lo - sp * 0.05, hi + sp * 0.05]).range([ih, 0])
  if (!drag.current) y.nice()
  const base = params.color
  const alpha = (lv: number) => params.opacity * (lv === 0.95 ? 0.45 : lv === 0.8 ? 0.7 : 1)
  const area = (lv: number) => d3.area<Row>().defined((r) => r.lo[lv] != null && r.center != null).x((r) => x(r.x)).y0((r) => y(w(r, lv, 'lo'))).y1((r) => y(w(r, lv, 'hi'))).curve(d3.curveMonotoneX)
  const centerLine = d3.line<Row>().x((r) => x(r.x)).y((r) => y(r.center!)).curve(d3.curveMonotoneX)
  const histLine = d3.line<Row>().x((r) => x(r.x)).y((r) => y(r.actual!))
  const editable = !!onTableChange && !compact
  const dec = dragDigits(y.domain()[1] - y.domain()[0])
  const joinFrom = history[history.length - 1]
  const joined: Row[] = joinFrom && shownForecast.length ? [{ ...joinFrom, center: joinFrom.actual }, ...shownForecast] : shownForecast

  // How often the realised values fell inside each interval (only rows where both exist).
  const coverage = drawn.map((lv) => {
    const rs = shownForecast.filter((r) => r.actual != null && r.lo[lv] != null)
    return { lv, n: rs.length, inside: rs.filter((r) => r.actual! >= w(r, lv, 'lo') && r.actual! <= w(r, lv, 'hi')).length }
  })

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!editable) return
    const t = (e.target as Element).closest('[data-row]')
    if (!t) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { row: Number(t.getAttribute('data-row')), domain: y.domain() as [number, number] }
    hide()
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const p = localPoint(svgRef.current!, e)
    if (drag.current) {
      // Moving a forecast shifts its whole fan, so the interval widths stay as they were.
      const r = rows.find((q) => q.row === drag.current!.row)
      if (!r || r.center == null) return
      const next = roundTo(y.invert(p.y - m.top), dec)
      const delta = next - r.center
      const patch: Record<string, number> = { [roleColumn(mapping, 'center')!]: next }
      for (const lv of levels) { patch[roleColumn(mapping, LEVEL_KEYS[lv][0])!] = roundTo(r.lo[lv] + delta, dec); patch[roleColumn(mapping, LEVEL_KEYS[lv][1])!] = roundTo(r.hi[lv] + delta, dec) }
      onTableChange!(updateRow(table, r.row, patch), true)
      return
    }
    if (compact) return
    const all = [...new Set(xs)].sort((a, b) => a - b)
    const nx = all[d3.bisectCenter(all, x.invert(p.x - m.left))]
    if (nx == null) return
    setHover(nx)
    const r = rows.find((q) => q.x === nx)
    if (!r) return
    show(x(nx) + m.left, p.y, <>
      <b>{fx(nx)}</b>
      {r.actual != null && <><br />실제 {fmt(r.actual)}</>}
      {r.center != null && <><br />예측 {fmt(r.center)}{drawn.map((lv) => r.lo[lv] != null && <span key={lv}><br />{Math.round(lv * 100)}% 예측구간 {fmt(w(r, lv, 'lo'))} ~ {fmt(w(r, lv, 'hi'))}</span>)}</>}
      {bad.has(r.row) && <><br />⚠ 구간이 서로 포함되지 않습니다</>}
    </>)
  }
  const onUp = () => {
    if (!drag.current) return
    drag.current = null
    onTableChange!(table, false)
  }

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} role="img" data-testid="chart-svg" aria-label={`팬 차트: 예측 ${shownForecast.length}개 시점의 ${drawn.map((l) => `${Math.round(l * 100)}%`).join('·')} 예측구간`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => { hide(); setHover(null) }}>
        <defs><clipPath id="fan-clip"><rect x={-4} y={-4} width={iw + 8} height={ih + 8} /></clipPath></defs>
        <g transform={`translate(${m.left},${m.top})`}>
          <rect width={iw} height={ih} fill="transparent" />
          <AxisBottom scale={x} y={ih} label={compact ? undefined : roleColumn(mapping, 'x') ?? ''} compact={compact} date={date} />
          <AxisLeft scale={y} x={0} grid={iw} label={compact ? undefined : '값'} compact={compact} />
          {hover != null && <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={0} y2={ih} />}
          <g clipPath="url(#fan-clip)">
            {drawn.map((lv) => <path key={lv} className="fan-band" data-testid="fan-band" data-level={lv} d={area(lv)(shownForecast) ?? ''} fill={base} fillOpacity={alpha(lv)} />)}
            {history.length > 0 && <path className="series-line" d={histLine(history) ?? ''} stroke="#121816" fill="none" strokeWidth={1.8} data-testid="fan-history" />}
            {joined.length > 0 && <path className="series-line" d={centerLine(joined) ?? ''} stroke={base} fill="none" strokeWidth={2.4} data-testid="fan-center" />}
            {params.actual && !compact && actualPts.filter((r) => r.center != null || r.x > (joinFrom?.x ?? -Infinity)).map((r) => <circle key={r.row} cx={x(r.x)} cy={y(r.actual!)} r={4} fill="#121816" stroke="#fff" strokeWidth={1.4} data-testid="fan-actual" />)}
            {!compact && shownForecast.map((r) => <circle key={r.row} data-row={r.row} className={editable ? 'is-draggable' : ''} cx={x(r.x)} cy={y(r.center!)} r={bad.has(r.row) ? 5 : 3.4} fill="#fff" stroke={bad.has(r.row) ? '#b4233a' : base} strokeWidth={bad.has(r.row) ? 2.4 : 1.6} data-testid="fan-point" />)}
          </g>
        </g>
      </svg>
      {!compact && (
        <>
          <Legend items={[...drawn.map((lv) => ({ key: `${Math.round(lv * 100)}% 예측구간`, color: base })), { key: '실제 관측값', color: '#121816' }].slice(0, drawn.length + 1)} />
          <Readout items={[{ label: '예측 시점', value: shownForecast.length }, ...coverage.filter((c) => c.n > 0 && (!narrow || c.lv === 0.8)).map((c) => ({ label: `${Math.round(c.lv * 100)}% 적중`, value: `${c.inside}/${c.n} (${pct(c.inside / c.n, 0)})` }))]} />
          {problems.length > 0 && <p className="chart-warning" role="status" data-testid="fan-warning">구간이 올바르게 포함되지 않는 행 {problems.length}개 — {problems[0].row + 1}행: {problems[0].text}</p>}
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function FanControls({ params, setParams, table, mapping, setTable }: ControlsProps<FanParams>) {
  const { rows, levels } = useMemo(() => fanRows(table, mapping), [table, mapping])
  const forecast = rows.filter((r) => r.center != null)
  const problems = useMemo(() => fanProblems(table, mapping), [table, mapping])
  const toggle = (lv: number) => setParams({ levels: params.levels.includes(lv) ? params.levels.filter((l) => l !== lv) : [...params.levels, lv] })
  const repair = () => {
    if (!setTable) return
    let next = table
    for (const p of problems) {
      const r = rows.find((q) => q.row === p.row)
      if (!r || r.center == null) continue
      const filled = { lo: { ...r.lo }, hi: { ...r.hi } }
      for (const lv of levels) { if (filled.lo[lv] == null) filled.lo[lv] = r.center; if (filled.hi[lv] == null) filled.hi[lv] = r.center }
      const fixed = repairFan({ center: r.center, ...filled }, levels)
      const patch: Record<string, number> = {}
      for (const lv of levels) { patch[roleColumn(mapping, LEVEL_KEYS[lv][0])!] = fixed.lo[lv]; patch[roleColumn(mapping, LEVEL_KEYS[lv][1])!] = fixed.hi[lv] }
      next = updateRow(next, r.row, patch)
    }
    setTable(next)
  }
  return (
    <>
      <ControlGroup title="예측구간">
        {FAN_LEVELS.map((lv) => (
          <Toggle key={lv} label={`${Math.round(lv * 100)}% 예측구간`} description={levels.includes(lv) ? undefined : '해당 하한·상한 열을 매핑하세요'} checked={params.levels.includes(lv)} onChange={() => toggle(lv)} testId={`ctl-level-${Math.round(lv * 100)}`} />
        ))}
        <Slider label="예측 기간" value={params.horizon === 0 ? forecast.length : Math.min(params.horizon, forecast.length)} min={1} max={Math.max(1, forecast.length)} onChange={(horizon) => setParams({ horizon })} format={(v) => `${v}개 시점`} testId="ctl-horizon" />
        <Slider label="구간 폭 배율" value={params.widen} min={0.4} max={2} step={0.05} onChange={(widen) => setParams({ widen })} format={(v) => `×${v.toFixed(2)}`} testId="ctl-widen" />
        <Hint>예측구간은 아직 관측되지 않은 미래의 값 하나가 들어올 범위이고, 신뢰구간은 평균 같은 모수의 불확실성입니다. 예측구간이 훨씬 넓습니다. 50%는 절반의 실제값이 그 안에 들어오도록 설계된 구간입니다.</Hint>
      </ControlGroup>
      <ControlGroup title="모양">
        <ColorField label="띠 색" value={params.color} onChange={(color) => setParams({ color })} testId="ctl-color" />
        <Slider label="띠 불투명도" value={params.opacity} min={0.1} max={0.9} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} testId="ctl-opacity" />
        <Toggle label="실제 관측값 표시" checked={params.actual} onChange={(actual) => setParams({ actual })} testId="ctl-actual" />
      </ControlGroup>
      <ControlGroup title={`구간 검증 (${problems.length === 0 ? '이상 없음' : `${problems.length}행 문제`})`} defaultOpen={problems.length > 0}>
        {problems.length === 0
          ? <Hint>모든 시점에서 중심값이 모든 구간 안에 있고, 95% ⊃ 80% ⊃ 50% 로 올바르게 포함됩니다.</Hint>
          : <>
            <ul className="issue-list">{problems.slice(0, 6).map((p) => <li key={p.row}><b>{p.row + 1}행</b> {p.text}</li>)}</ul>
            <button type="button" className="btn btn-secondary btn-sm" onClick={repair} data-testid="fan-repair">구간 자동 보정</button>
            <Hint>보정은 바깥 구간을 안쪽 구간이 들어가도록 넓힙니다.</Hint>
          </>}
        <Hint>예측 점을 위아래로 끌면 그 시점의 구간 전체가 같은 폭으로 따라 움직입니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const fanModule: VizModule<FanParams> = {
  roles: [
    { key: 'x', label: 'X축 (날짜·순서)', type: 'date', accept: ['date', 'number'], required: true },
    { key: 'actual', label: '실제 관측값 (선택)', type: 'number', auto: true },
    { key: 'center', label: '예측 중심값', type: 'number', required: true },
    { key: 'lo50', label: '50% 하한', type: 'number', auto: true },
    { key: 'hi50', label: '50% 상한', type: 'number', auto: true },
    { key: 'lo80', label: '80% 하한', type: 'number', auto: true },
    { key: 'hi80', label: '80% 상한', type: 'number', auto: true },
    { key: 'lo95', label: '95% 하한', type: 'number', auto: true },
    { key: 'hi95', label: '95% 상한', type: 'number', auto: true },
  ],
  datasets: ['forecast'],
  defaultParams: { levels: [0.5, 0.8, 0.95], opacity: 0.55, color: '#4c6fb5', horizon: 0, widen: 1, actual: true },
  Chart: FanChart,
  Controls: FanControls,
  hint: '예측 점을 끌어 중심값 이동(구간도 함께 이동) · 예측 기간과 구간 폭 배율 조절 · 검은 점은 나중에 알게 된 실제 값',
}

