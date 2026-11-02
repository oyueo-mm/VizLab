import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Legend, Tooltip, localPoint, toggleIn, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, toTime } from '../../data/table'
import { categoryColor, schemes } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { formatTime } from '../../stats/datetime'
import { normalizeColumns } from '../../stats/multivar7'
import { classicalMDS, euclid, polylineCrossings } from '../../stats/uncert7'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'

// ───────────────────────────── Time Curves ─────────────────────────────

export interface TimeCurveParams { smooth: boolean; labelEvery: number; neighbors: boolean; loops: boolean }

function TimeCurveChart({ table, mapping, params, width, height, compact }: ChartProps<TimeCurveParams>) {
  const tcol = roleColumn(mapping, 'time'), vars = roleColumns(mapping, 'vars')
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const model = useMemo(() => {
    const ti = columnIndex(table, tcol), vi = vars.map((v) => columnIndex(table, v))
    if (ti < 0 || vi.length < 2) return null
    const isDate = table.columns[ti].type === 'date'
    const rows = table.rows.map((r, row) => ({ row, t: isDate ? toTime(r[ti]) : toNumber(r[ti]), v: vi.map((k) => toNumber(r[k])) }))
      .filter((r): r is { row: number; t: number; v: number[] } => r.t != null && r.v.every((x) => x != null)).sort((a, b) => a.t - b.t)
    if (rows.length < 3) return null
    const norm = normalizeColumns(rows.map((r) => r.v), 'zscore')
    const D = norm.map((a) => norm.map((b) => euclid(a, b)))
    const pts = classicalMDS(D)
    return { rows, D, pts, isDate }
  }, [table, tcol, vars.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!model) return <ChartMessage>Time Curves에는 시간 열 하나와 숫자형 변수 2개 이상, 3개 이상의 시점이 필요합니다.</ChartMessage>
  const { rows, D, pts, isDate } = model
  const n = rows.length
  const m = compact ? 8 : 44
  const [x0, x1] = d3.extent(pts, (p) => p[0]) as [number, number], [y0, y1] = d3.extent(pts, (p) => p[1]) as [number, number]
  const sc = Math.min((width - 2 * m) / Math.max(1e-9, x1 - x0), (height - 2 * m) / Math.max(1e-9, y1 - y0))
  const px = (p: [number, number]) => (width - sc * (x1 - x0)) / 2 + (p[0] - x0) * sc
  const py = (p: [number, number]) => (height - sc * (y1 - y0)) / 2 + (p[1] - y0) * sc
  const ramp = schemes.viridis.interpolate
  const fmtT = (t: number) => (isDate ? formatTime(t) : fmt(t))
  // the most similar pair of states that are far apart in time is where the data repeats itself
  let loop: [number, number] | null = null
  if (params.loops) {
    let best = Infinity
    for (let i = 0; i < n; i++) for (let j = i + Math.ceil(n / 4); j < n; j++) if (D[i][j] < best) { best = D[i][j]; loop = [i, j] }
  }
  const P = (i: number) => pts[Math.min(n - 1, Math.max(0, i))]
  // one segment of the curve; with `smooth` it is the Catmull-Rom piece between the two points, otherwise a straight line
  const segPath = (i: number) => {
    const a = P(i), b = P(i + 1)
    if (!params.smooth) return `M${px(a)},${py(a)}L${px(b)},${py(b)}`
    const p0 = P(i - 1), p3 = P(i + 2)
    const c1: [number, number] = [a[0] + (b[0] - p0[0]) / 6, a[1] + (b[1] - p0[1]) / 6], c2: [number, number] = [b[0] - (p3[0] - a[0]) / 6, b[1] - (p3[1] - a[1]) / 6]
    return `M${px(a)},${py(a)}C${px(c1)},${py(c1)} ${px(c2)},${py(c2)} ${px(b)},${py(b)}`
  }
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Time Curves: 시점 ${n}개를 상태 유사도에 따라 배치하고 시간 순서로 이은 곡선`} onPointerLeave={hide}>
        {Array.from({ length: n - 1 }, (_, i) => (
          <path key={i} d={segPath(i)} fill="none" stroke={ramp(i / (n - 2 || 1))} strokeWidth={compact ? 1.6 : 3} strokeOpacity={0.9} strokeLinecap="round" data-testid="tc-seg" />
        ))}
        {params.loops && loop && !compact && <line x1={px(pts[loop[0]])} y1={py(pts[loop[0]])} x2={px(pts[loop[1]])} y2={py(pts[loop[1]])} stroke="#cf4f6a" strokeDasharray="4 3" strokeWidth={1.5} data-testid="tc-loop" />}
        {rows.map((r, i) => (
          <g key={i}>
            <circle cx={px(pts[i])} cy={py(pts[i])} r={compact ? 2 : 4.5} fill={ramp(i / (n - 1 || 1))} stroke="#fff" strokeWidth={1} data-testid="tc-point"
              onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{fmtT(r.t)}</b>{vars.map((v, k) => <div key={v}>{v}: {fmt(r.v[k])}</div>)}</>) }} onPointerLeave={hide} />
            {!compact && (i === 0 || i === n - 1 || i % params.labelEvery === 0) && <text x={px(pts[i]) + 7} y={py(pts[i]) - 7} className="radar-level" style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}>{fmtT(r.t)}</text>}
          </g>
        ))}
        {!compact && params.neighbors && <text x={m} y={20} className="radar-level">점에 마우스를 올려 값을 확인하세요</text>}
        {!compact && loop && <text x={m} y={height - 12} className="radar-level" fill="#cf4f6a">가장 닮은데 시간은 먼 두 시점: {fmtT(rows[loop[0]].t)} ↔ {fmtT(rows[loop[1]].t)} (거리 {D[loop[0]][loop[1]].toFixed(2)})</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function TimeCurveControls({ params, setParams }: ControlsProps<TimeCurveParams>) {
  return (
    <ControlGroup title="곡선">
      <Toggle label="점 사이를 부드럽게 (곡선)" checked={params.smooth} onChange={(smooth) => setParams({ smooth })} />
      <Slider label="시간 라벨 간격 (시점마다)" value={params.labelEvery} min={2} max={24} onChange={(labelEvery) => setParams({ labelEvery })} testId="ctl-label" />
      <Toggle label="가장 닮은 먼 시점 연결 표시" checked={params.loops} onChange={(loops) => setParams({ loops })} testId="ctl-loops" />
      <Hint>각 시점의 상태(변수 벡터)를 z 점수로 표준화한 뒤 고전적 다차원 척도법(MDS)으로 2차원에 놓아, 상태가 비슷한 시점끼리 가깝게 만듭니다. 시간 순서는 곡선의 색(보라 → 노랑)으로 읽습니다. 곡선이 원점으로 돌아오는 모양이면 주기, 한 방향으로 길게 가면 추세입니다.</Hint>
    </ControlGroup>
  )
}

export const timeCurveModule: VizModule<TimeCurveParams> = {
  roles: [
    { key: 'time', label: '시간', type: 'date', accept: ['date', 'number'], required: true },
    { key: 'vars', label: '상태 변수 (숫자형)', type: 'number', required: true, multiple: { min: 2, max: 10 } },
  ],
  datasets: ['state-series', 'cars'],
  defaultParams: { smooth: false, labelEvery: 6, neighbors: true, loops: true },
  Chart: TimeCurveChart,
  Controls: TimeCurveControls,
  hint: '곡선의 모양으로 주기·추세·급변을 읽습니다 · 점에 올려 해당 시점 값 확인',
}

// ───────────────────────────── Marey Chart ─────────────────────────────

export interface MareyParams { crossings: boolean; startHour: number; highlight: string; invert: boolean }

const clock = (startHour: number) => (m: number) => { const t = Math.round(startHour * 60 + m); return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` }

function MareyChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<MareyParams>) {
  const tcol = roleColumn(mapping, 'train'), pcol = roleColumn(mapping, 'pos'), mcol = roleColumn(mapping, 'time'), scol = roleColumn(mapping, 'station')
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const model = useMemo(() => {
    const ti = columnIndex(table, tcol), pi = columnIndex(table, pcol), mi = columnIndex(table, mcol), si = columnIndex(table, scol)
    if (ti < 0 || pi < 0 || mi < 0) return null
    const by = new Map<string, [number, number][]>()
    const stations = new Map<number, string>()
    for (const r of table.rows) {
      const p = toNumber(r[pi]), t = toNumber(r[mi])
      if (p == null || t == null) continue
      const k = toLabel(r[ti])
      if (!by.has(k)) by.set(k, [])
      by.get(k)!.push([t, p])
      if (si >= 0) stations.set(p, toLabel(r[si]))
    }
    const lines = [...by.entries()].map(([key, pts]) => ({ key, pts: pts.sort((a, b) => a[0] - b[0]) })).filter((l) => l.pts.length >= 2)
    return lines.length ? { lines, stations, cross: polylineCrossings(lines) } : null
  }, [table, tcol, pcol, mcol, scol])
  if (!model) return <ChartMessage>열차, 위치, 시각 열을 선택하세요(열차마다 2개 이상의 지점).</ChartMessage>
  const m = compact ? { l: 8, r: 8, t: 8, b: 14 } : { l: 70, r: 24, t: 36, b: 52 }
  const w = width - m.l - m.r, h = height - m.t - m.b
  const allT = model.lines.flatMap((l) => l.pts.map((p) => p[0])), allP = model.lines.flatMap((l) => l.pts.map((p) => p[1]))
  const x = d3.scaleLinear().domain([Math.min(...allT), Math.max(...allT)]).range([0, w])
  const y = d3.scaleLinear().domain([Math.min(...allP), Math.max(...allP)]).range(params.invert ? [h, 0] : [0, h])
  const color = categoryColor(model.lines.map((l) => l.key))
  const fmtClock = clock(params.startHour)
  const stationTicks = [...model.stations.entries()].sort((a, b) => a[0] - b[0])
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Marey Chart: 열차 ${model.lines.length}대의 시각–위치 선, 교차 ${model.cross.length}곳`} onPointerLeave={hide}>
        <g transform={`translate(${m.l},${m.t})`}>
          {!compact && stationTicks.map(([p, name]) => <g key={p}><line x1={0} x2={w} y1={y(p)} y2={y(p)} stroke="#e3e7ea" /><text x={-8} y={y(p)} dy="0.34em" textAnchor="end" className="radar-axis-label">{name} ({fmt(p)}km)</text></g>)}
          {!compact && !stationTicks.length && <AxisLeft scale={y} x={0} grid={w} />}
          <AxisBottom scale={x} y={h} compact={compact} format={fmtClock} />
          {model.lines.map((l) => {
            const dim = params.highlight && params.highlight !== l.key
            return <path key={l.key} d={d3.line()(l.pts.map((p) => [x(p[0]), y(p[1])] as [number, number])) ?? ''} fill="none" stroke={color(l.key)} strokeWidth={params.highlight === l.key ? 3.2 : compact ? 1.4 : 2} strokeOpacity={dim ? 0.18 : 0.95} data-testid="marey-line" />
          })}
          {!compact && model.lines.map((l) => l.pts.slice(0, -1).map((p, i) => {
            const q = l.pts[i + 1]
            const speed = q[0] === p[0] ? 0 : (Math.abs(q[1] - p[1]) / (q[0] - p[0])) * 60
            return <line key={`${l.key}${i}`} x1={x(p[0])} y1={y(p[1])} x2={x(q[0])} y2={y(q[1])} stroke="transparent" strokeWidth={10}
              onPointerEnter={(e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{l.key}</b><br />{fmtClock(p[0])} → {fmtClock(q[0])}<br />{speed > 0.5 ? `속도 ${speed.toFixed(0)} km/h` : '정차'}</>) }} onPointerLeave={hide} />
          }))}
          {params.crossings && !compact && model.cross.map((c, i) => <circle key={i} cx={x(c.x)} cy={y(c.y)} r={4} fill="#fff" stroke="#cf4f6a" strokeWidth={1.6} data-testid="marey-cross"
            onPointerEnter={(e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{c.a} × {c.b}</b><br />{fmtClock(c.x)}, {fmt(c.y)}km 부근에서 교차</>) }} onPointerLeave={hide} />)}
        </g>
      </svg>
      {!compact && <Legend items={model.lines.map((l) => ({ key: l.key, color: color(l.key) }))} hidden={params.highlight ? model.lines.map((l) => l.key).filter((k) => k !== params.highlight) : []} onToggle={(k) => setParams({ highlight: params.highlight === k ? '' : k })} />}
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function MareyControls({ params, setParams }: ControlsProps<MareyParams>) {
  return (
    <ControlGroup title="표시">
      <Toggle label="교차(만남·추월) 표시" checked={params.crossings} onChange={(crossings) => setParams({ crossings })} testId="ctl-cross" />
      <Toggle label="위치 축 뒤집기" checked={params.invert} onChange={(invert) => setParams({ invert })} />
      <Slider label="시작 시각 (시)" value={params.startHour} min={0} max={12} onChange={(startHour) => setParams({ startHour })} testId="ctl-hour" />
      <Hint>가로가 시각, 세로가 위치이므로 선의 기울기가 곧 속도입니다(가파를수록 느림, 수평 구간은 정차). 선이 서로 가로지르는 곳은 열차가 마주치거나 추월한 지점이며, 빨간 테두리 원으로 표시합니다. 범례를 누르면 열차 하나를 강조합니다.</Hint>
    </ControlGroup>
  )
}

export const mareyModule: VizModule<MareyParams> = {
  roles: [
    { key: 'train', label: '이동 개체 (열차)', type: 'category', required: true },
    { key: 'pos', label: '위치·거리', type: 'number', required: true, prefer: '거리|위치|km' },
    { key: 'time', label: '시각', type: 'number', required: true, prefer: '시각|시간' },
    { key: 'station', label: '지점 이름 (선택)', type: 'category', auto: true, prefer: '역|지점' },
  ],
  datasets: ['train-timetable'],
  defaultParams: { crossings: true, startHour: 6, highlight: '', invert: false },
  Chart: MareyChart,
  Controls: MareyControls,
  hint: '선의 기울기가 속도입니다 · 범례로 열차를 강조 · 빨간 원은 교차 지점',
}

// ───────────────────────────── LifeLines ─────────────────────────────

export interface LifeLinesParams { hidden: string[]; selected: string[]; align: 'absolute' | 'relative'; t0: number; t1: number }

function LifeLinesChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<LifeLinesParams>) {
  const ecol = roleColumn(mapping, 'entity'), lcol = roleColumn(mapping, 'label'), ycol = roleColumn(mapping, 'type'), s0 = roleColumn(mapping, 'start'), s1 = roleColumn(mapping, 'end')
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const model = useMemo(() => {
    const ei = columnIndex(table, ecol), li = columnIndex(table, lcol), yi = columnIndex(table, ycol), a = columnIndex(table, s0), b = columnIndex(table, s1)
    if (ei < 0 || a < 0) return null
    const events = table.rows.map((r) => {
      const st = toNumber(r[a]), en = b >= 0 ? toNumber(r[b]) : st
      return st == null ? null : { entity: toLabel(r[ei]), label: li >= 0 ? toLabel(r[li]) : '', type: yi >= 0 ? toLabel(r[yi]) : '사건', start: st, end: Math.max(st, en ?? st) }
    }).filter((e): e is NonNullable<typeof e> => e != null)
    return events.length ? { events, entities: [...new Set(events.map((e) => e.entity))], types: [...new Set(events.map((e) => e.type))] } : null
  }, [table, ecol, lcol, ycol, s0, s1])
  if (!model) return <ChartMessage>개체 열과 시작 열을 선택하세요.</ChartMessage>
  const shown = model.entities.filter((e) => !params.selected.length || params.selected.includes(e))
  const origin = new Map(shown.map((e) => [e, params.align === 'relative' ? Math.min(...model.events.filter((v) => v.entity === e).map((v) => v.start)) : 0]))
  const ev = model.events.filter((e) => shown.includes(e.entity) && !params.hidden.includes(e.type)).map((e) => ({ ...e, a: e.start - origin.get(e.entity)!, b: e.end - origin.get(e.entity)! }))
  const lo = Math.min(...model.events.filter((e) => shown.includes(e.entity)).map((e) => e.start - origin.get(e.entity)!)), hi = Math.max(...model.events.filter((e) => shown.includes(e.entity)).map((e) => e.end - origin.get(e.entity)!))
  const dom0 = lo + (hi - lo) * params.t0, dom1 = lo + (hi - lo) * params.t1
  const m = compact ? { l: 6, r: 6, t: 6, b: 10 } : { l: 84, r: 24, t: 20, b: 46 }
  const w = width - m.l - m.r, h = height - m.t - m.b
  const x = d3.scaleLinear().domain([dom0, Math.max(dom1, dom0 + 1e-6)]).range([0, w])
  const row = d3.scaleBand<string>().domain(shown).range([0, h]).padding(0.28)
  const color = categoryColor(model.types)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`LifeLines: 개체 ${shown.length}명의 사건 ${ev.length}건`} onPointerLeave={hide}>
        <defs><clipPath id="ll-clip"><rect width={w} height={h} /></clipPath></defs>
        <g transform={`translate(${m.l},${m.t})`}>
          {shown.map((e) => (
            <g key={e}>
              <rect x={0} y={row(e)! - 3} width={w} height={row.bandwidth() + 6} fill="#f6f8f9" />
              {!compact && <text x={-8} y={row(e)! + row.bandwidth() / 2} dy="0.34em" textAnchor="end" className="radar-axis-label" style={{ cursor: 'pointer', fontWeight: params.selected.includes(e) ? 700 : 400 }} onClick={() => setParams({ selected: toggleIn(params.selected, e) })} data-testid={`ll-entity-${e}`}>{e}</text>}
            </g>
          ))}
          <g clipPath="url(#ll-clip)">
            {ev.map((e, i) => {
              const yy = row(e.entity)! + row.bandwidth() / 2
              const tipFn = (ev2: { clientX: number; clientY: number }) => { const lp = localPoint(svgRef.current!, ev2); show(lp.x, lp.y, <><b>{e.entity} · {e.label || e.type}</b><br />{e.type}<br />{e.a === e.b ? `${fmt(e.a)}일` : `${fmt(e.a)} – ${fmt(e.b)}일 (${fmt(e.b - e.a)}일간)`}</>) }
              return e.a === e.b
                ? <path key={i} d={`M${x(e.a)},${yy - 6}L${x(e.a) + 6},${yy}L${x(e.a)},${yy + 6}L${x(e.a) - 6},${yy}Z`} fill={color(e.type)} stroke="#fff" data-testid="ll-instant" onPointerEnter={compact ? undefined : tipFn} onPointerLeave={hide} />
                : <rect key={i} x={x(e.a)} y={yy - row.bandwidth() * (e.type === model.types[0] ? 0.46 : 0.28)} width={Math.max(2, x(e.b) - x(e.a))} height={row.bandwidth() * (e.type === model.types[0] ? 0.92 : 0.56)} rx={2} fill={color(e.type)} fillOpacity={0.85} data-testid="ll-bar" onPointerEnter={compact ? undefined : tipFn} onPointerLeave={hide} />
            })}
          </g>
          <AxisBottom scale={x} y={h} compact={compact} label={params.align === 'relative' ? '첫 사건 이후 일수' : '일'} />
        </g>
      </svg>
      {!compact && <Legend items={model.types.map((t) => ({ key: t, color: color(t) }))} hidden={params.hidden} onToggle={(t) => setParams({ hidden: toggleIn(params.hidden, t) })} />}
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function LifeLinesControls({ params, setParams }: ControlsProps<LifeLinesParams>) {
  return (
    <ControlGroup title="시간 범위와 비교">
      <Segmented label="시간 기준" value={params.align} onChange={(align) => setParams({ align })} options={[{ value: 'absolute', label: '실제 시각' }, { value: 'relative', label: '첫 사건 기준 정렬' }]} testId="ctl-align" />
      <Slider label="보이는 구간 시작" value={params.t0} min={0} max={0.9} step={0.01} onChange={(t0) => setParams({ t0, t1: Math.max(params.t1, t0 + 0.05) })} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-t0" />
      <Slider label="보이는 구간 끝" value={params.t1} min={0.1} max={1} step={0.01} onChange={(t1) => setParams({ t1, t0: Math.min(params.t0, t1 - 0.05) })} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-t1" />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ selected: [], hidden: [], t0: 0, t1: 1 })} data-testid="ll-reset">선택·확대 해제</button>
      <Hint>개체 이름을 누르면 선택한 개체만 남겨 비교합니다. ‘첫 사건 기준 정렬’은 각 개체의 첫 사건을 0일로 맞춰 경과 일수로 비교합니다. 범례를 눌러 사건 유형을 숨길 수 있고, 마름모는 한 시점에 일어난 사건입니다.</Hint>
    </ControlGroup>
  )
}

export const lifelinesModule: VizModule<LifeLinesParams> = {
  roles: [
    { key: 'entity', label: '개체 (행)', type: 'category', required: true, prefer: '환자|개체|사람' },
    { key: 'label', label: '사건 이름', type: 'category', auto: true, prefer: '사건' },
    { key: 'type', label: '사건 유형 (색)', type: 'category', auto: true, prefer: '유형' },
    { key: 'start', label: '시작', type: 'number', required: true, prefer: '시작' },
    { key: 'end', label: '종료', type: 'number', auto: true, prefer: '종료' },
  ],
  datasets: ['patient-events'],
  defaultParams: { hidden: [], selected: [], align: 'absolute', t0: 0, t1: 1 },
  Chart: LifeLinesChart,
  Controls: LifeLinesControls,
  hint: '개체 이름을 눌러 비교 대상을 고르고, 범례로 사건 유형을 숨기세요',
}
