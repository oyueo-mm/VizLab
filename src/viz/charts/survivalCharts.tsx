import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Legend, Readout, Tooltip, localPoint, margins, toggleIn, useSvgId, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Slider, StatTable, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, type DataTable } from '../../data/table'
import { categoryColor } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { cumHazardAt, kaplanMeier, logRank, nelsonAalenBand, riskTable, survivalAt, type Subject, type SurvivalCurve } from '../../stats/survival'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, RoleSpec, VizModule } from '../types'

/** Kaplan–Meier survival curves and Nelson–Aalen cumulative hazard for right-censored data. */

const roles: RoleSpec[] = [
  { key: 'time', label: '추적 기간', type: 'number', required: true, prefer: '기간|시간|time|duration' },
  { key: 'event', label: '사건 (1 = 발생, 0 = 검열)', type: 'number', required: true, prefer: '사건|event|status' },
  { key: 'group', label: '집단 (선택)', type: 'category', auto: true, prefer: '집단|group|arm|처치' },
]

interface Group { key: string; subjects: Subject[]; curve: SurvivalCurve }

export function readSurvival(table: DataTable, mapping: Mapping, level: number) {
  const ti = columnIndex(table, roleColumn(mapping, 'time')), ei = columnIndex(table, roleColumn(mapping, 'event')), gi = columnIndex(table, roleColumn(mapping, 'group'))
  const by = new Map<string, Subject[]>()
  let skipped = 0, badEvent = 0
  if (ti >= 0 && ei >= 0) table.rows.forEach((r, row) => {
    const t = toNumber(r[ti]), e = toNumber(r[ei])
    if (t == null || e == null || t < 0) { skipped++; return }
    if (e !== 0 && e !== 1) { badEvent++; return }
    const g = gi >= 0 ? toLabel(r[gi]) || '(빈 값)' : '전체'
    ;(by.get(g) ?? by.set(g, []).get(g)!).push({ time: t, event: e === 1, row })
  })
  const groups: Group[] = [...by].map(([key, subjects]) => ({ key, subjects, curve: kaplanMeier(subjects, level) }))
  return { groups, skipped, badEvent }
}

function SurvivalFrame({ mode, table, mapping, params, setParams, width, height, compact, linked }: ChartProps<SurvParams> & { mode: 'km' | 'na' }) {
  const { groups, skipped, badEvent } = useMemo(() => readSurvival(table, mapping, params.level), [table, mapping, params.level])
  const names = groups.map((g) => g.key)
  const color = categoryColor(names)
  const shown = groups.filter((g) => !params.hidden.includes(g.key))
  const tMax = d3.max(groups, (g) => d3.max(g.subjects, (s) => s.time)) ?? 1
  const showRisk = params.riskTable && mode === 'km' && !compact
  const riskH = showRisk ? 22 * shown.length + 26 : 0
  const m = margins(compact, { right: 22, bottom: compact ? 10 : 52 + riskH })
  const iw = Math.max(40, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const x = d3.scaleLinear().domain([0, tMax * 1.02]).range([0, iw])
  const bands = useMemo(() => new Map(groups.map((g) => [g.key, nelsonAalenBand(g.curve, params.level)])), [groups, params.level])
  const hMax = d3.max(groups, (g) => d3.max(bands.get(g.key)!, (b) => (params.ci ? b.hi : b.h))) ?? 1
  const y = mode === 'km' ? d3.scaleLinear().domain([0, 1]).range([ih, 0]) : d3.scaleLinear().domain([0, hMax * 1.05]).range([ih, 0])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const clip = useSvgId('surv-clip')
  const test = useMemo(() => (shown.length >= 2 ? logRank(shown.map((g) => g.subjects)) : null), [shown])
  const marked = new Set(linked?.rows ?? [])
  const riskTimes = useMemo(() => d3.ticks(0, tMax, 6), [tMax])
  if (!roleColumn(mapping, 'time') || !roleColumn(mapping, 'event')) return <ChartMessage>추적 기간과 사건(1/0) 열(숫자형)을 선택하세요.</ChartMessage>
  if (!groups.length) return <ChartMessage>유효한 추적 기록이 없습니다.<small>{badEvent > 0 ? `사건 열이 0/1이 아닌 ${badEvent}행이 있습니다.` : '기간은 0 이상의 숫자여야 합니다.'}</small></ChartMessage>
  const stepLine = (key: (s: SurvivalCurve['steps'][number]) => number) => (c: SurvivalCurve) => d3.line<SurvivalCurve['steps'][number]>().x((s) => x(s.time)).y((s) => y(key(s))).curve(d3.curveStepAfter)([{ time: 0, atRisk: 0, events: 0, censored: 0, surv: 1, lo: 1, hi: 1, cumHaz: 0, hazVar: 0 }, ...c.steps]) ?? ''
  const valueOf = (s: SurvivalCurve['steps'][number]) => (mode === 'km' ? s.surv : s.cumHaz)
  const area = (c: SurvivalCurve, g: string) => {
    const b = bands.get(g)!
    const pts = [{ t: 0, lo: mode === 'km' ? 1 : 0, hi: mode === 'km' ? 1 : 0 }, ...c.steps.map((s, i) => ({ t: s.time, lo: mode === 'km' ? s.lo : b[i].lo, hi: mode === 'km' ? s.hi : b[i].hi }))]
    return d3.area<(typeof pts)[number]>().x((p) => x(p.t)).y0((p) => y(p.lo)).y1((p) => y(p.hi)).curve(d3.curveStepAfter)(pts) ?? ''
  }
  const hover = (e: React.PointerEvent) => {
    if (compact) return
    const l = localPoint(svgRef.current!, e)
    if (l.x < m.left || l.x > m.left + iw) { hide(); return }
    const t = x.invert(l.x - m.left)
    show(l.x, l.y, <><b>t = {fmt(t, 1)}</b>{shown.map((g) => <span key={g.key}><br /><span className="tip-dot" style={{ background: color(g.key) }} /> {g.key}: {mode === 'km' ? `생존율 ${fmt(survivalAt(g.curve, t) * 100, 1)}%` : `누적 위험 ${fmt(cumHazardAt(g.curve, t), 3)}`}</span>)}</>)
  }
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={mode === 'km' ? `카플란–마이어 생존 곡선: 집단 ${shown.length}개` : `넬슨–알렌 누적 위험: 집단 ${shown.length}개`} onPointerMove={hover} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <defs><clipPath id={clip}><rect x={-2} y={-4} width={iw + 4} height={ih + 8} /></clipPath></defs>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisBottom scale={x} y={ih} grid={ih} label={roleColumn(mapping, 'time') ?? '시간'} compact={compact} />
          <AxisLeft scale={y} x={0} grid={iw} label={mode === 'km' ? '생존 확률 S(t)' : '누적 위험 H(t)'} format={mode === 'km' ? (v) => `${Math.round(v * 100)}%` : undefined} compact={compact} />
          <g clipPath={`url(#${clip})`}>
            {shown.map((g) => params.ci && !compact && <path key={`b${g.key}`} d={area(g.curve, g.key)} fill={color(g.key)} fillOpacity={0.14} data-testid="ci-band" />)}
            {mode === 'na' && params.overlay && shown.map((g) => <path key={`o${g.key}`} d={d3.line<SurvivalCurve['steps'][number]>().x((s) => x(s.time)).y((s) => y(-Math.log(Math.max(1e-9, s.surv)))).curve(d3.curveStepAfter)(g.curve.steps) ?? ''} fill="none" stroke={color(g.key)} strokeDasharray="4 4" strokeOpacity={0.7} strokeWidth={1.4} />)}
            {shown.map((g) => <path key={g.key} data-testid={mode === 'km' ? 'km-curve' : 'na-curve'} data-group={g.key} d={stepLine(valueOf)(g.curve)} fill="none" stroke={color(g.key)} strokeWidth={2.2} strokeLinejoin="round" />)}
            {params.censorMarks && !compact && shown.map((g) => g.subjects.filter((s) => !s.event).map((s) => {
              const v = mode === 'km' ? survivalAt(g.curve, s.time) : cumHazardAt(g.curve, s.time)
              const on = marked.has(s.row)
              return <g key={`${g.key}${s.row}`} data-testid="censor-mark" transform={`translate(${x(s.time)},${y(v)})`}><line y1={-4.5} y2={4.5} stroke={color(g.key)} strokeWidth={on ? 3 : 1.4} /><line x1={-4.5} x2={4.5} stroke={color(g.key)} strokeWidth={on ? 3 : 1.4} onPointerEnter={() => linked?.set([s.row])} onPointerLeave={() => linked?.set(null)} /></g>
            }))}
            {mode === 'km' && params.median && !compact && shown.map((g) => g.curve.median != null && <g key={`m${g.key}`} pointerEvents="none"><line x1={0} x2={x(g.curve.median)} y1={y(0.5)} y2={y(0.5)} stroke={color(g.key)} strokeDasharray="3 3" /><line x1={x(g.curve.median)} x2={x(g.curve.median)} y1={y(0.5)} y2={ih} stroke={color(g.key)} strokeDasharray="3 3" /></g>)}
          </g>
          {showRisk && (
            <g transform={`translate(0,${ih + 46})`} data-testid="risk-table" aria-label="위험 집단 표">
              <text x={-m.left + 6} y={0} fontSize={11} fontWeight={650} fill="#374151">위험 집단 (남은 인원)</text>
              {shown.map((g, gi) => (
                <g key={g.key} transform={`translate(0,${16 + gi * 22})`}>
                  <text x={-8} y={4} textAnchor="end" fontSize={11} fill={color(g.key)}>{g.key.length > 10 ? `${g.key.slice(0, 9)}…` : g.key}</text>
                  {riskTable(g.subjects, riskTimes).map((n, i) => <text key={i} x={x(riskTimes[i])} y={4} textAnchor="middle" fontSize={11} fill="#374151" data-testid="risk-n">{n}</text>)}
                </g>
              ))}
            </g>
          )}
        </g>
      </svg>
      {!compact && (<>
        <Legend items={groups.map((g) => ({ key: g.key, color: color(g.key) }))} hidden={params.hidden} onToggle={(k) => setParams({ hidden: toggleIn(params.hidden, k) })} />
        <Readout items={[
          { label: '대상', value: d3.sum(shown, (g) => g.subjects.length) },
          { label: '사건', value: d3.sum(shown, (g) => g.curve.events) },
          ...(mode === 'km' ? shown.slice(0, 3).map((g) => ({ label: `중앙 생존 ${g.key}`, value: g.curve.median == null ? '도달 안 함' : fmt(g.curve.median, 1) })) : []),
          ...(test && test.df === 1 ? [{ label: '로그-순위 p', value: test.p < 0.001 ? '<0.001' : fmt(test.p, 3) }] : test ? [{ label: `로그-순위 χ²(${test.df})`, value: `${fmt(test.chi2, 2)}, p ${test.p < 0.001 ? '<0.001' : fmt(test.p, 3)}` }] : []),
        ]} />
        {(skipped > 0 || badEvent > 0) && <p className="chart-warning" role="status">{skipped > 0 ? `기간이 올바르지 않은 ${skipped}행 ` : ''}{badEvent > 0 ? `사건이 0/1이 아닌 ${badEvent}행 ` : ''}은 제외했습니다.</p>}
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

export interface SurvParams { ci: boolean; level: number; censorMarks: boolean; riskTable: boolean; median: boolean; overlay: boolean; hidden: string[] }

function SurvControls({ mode, params, setParams, table, mapping }: ControlsProps<SurvParams> & { mode: 'km' | 'na' }) {
  const { groups } = useMemo(() => readSurvival(table, mapping, params.level), [table, mapping, params.level])
  const test = groups.length >= 2 ? logRank(groups.map((g) => g.subjects)) : null
  return (
    <>
      <ControlGroup title="곡선">
        <Toggle label="신뢰구간 띠" checked={params.ci} onChange={(ci) => setParams({ ci })} testId="ctl-surv-ci" />
        <Slider label="신뢰수준" value={Math.round(params.level * 100)} min={80} max={99} onChange={(v) => setParams({ level: v / 100 })} format={(v) => `${v}%`} />
        <Toggle label="검열 표시 (+)" checked={params.censorMarks} onChange={(censorMarks) => setParams({ censorMarks })} testId="ctl-surv-cens" />
        {mode === 'km' && <Toggle label="위험 집단 표" checked={params.riskTable} onChange={(riskTable) => setParams({ riskTable })} testId="ctl-surv-risk" />}
        {mode === 'km' && <Toggle label="중앙 생존 시간 선" checked={params.median} onChange={(median) => setParams({ median })} />}
        {mode === 'na' && <Toggle label="−log(KM 생존) 겹치기 (점선)" checked={params.overlay} onChange={(overlay) => setParams({ overlay })} />}
        <Hint>{mode === 'km' ? '카플란–마이어 곡선은 사건이 일어난 시점마다 (1 − 사건 수 / 위험 집단 수)를 곱해 생존율을 추정합니다. 검열(추적이 끝났거나 중도 탈락)된 사람은 그 시점까지는 위험 집단에 남고 이후로는 빠집니다. 검열이 많은 오른쪽 끝은 위험 집단이 작아 곡선이 불안정합니다 — 표의 남은 인원을 함께 보세요.' : '넬슨–알렌 추정량은 사건 수 / 위험 집단 수를 시간에 따라 더한 누적 위험 H(t)입니다. 곡선의 기울기가 그 시점의 순간 위험이므로 직선이면 위험이 일정(지수 분포)이고, 위로 휘면 위험이 늘고 있다는 뜻입니다. 생존 함수와는 S(t) ≈ exp(−H(t))로 이어져 있습니다.'}</Hint>
      </ControlGroup>
      {test && (
        <ControlGroup title="집단 비교 (로그-순위)">
          <StatTable rows={[['항목', '값'], ['χ²', fmt(test.chi2, 3)], ['자유도', test.df], ['p 값', test.p < 0.0001 ? '<0.0001' : fmt(test.p, 4)]]} />
          <Hint>로그-순위 검정은 모든 사건 시점에서 집단별 관측 사건 수와 (집단 크기에 비례해 기대되는) 사건 수의 차이를 합산한 것으로, 위험이 시간에 걸쳐 비례한다고 가정할 때 가장 검정력이 높습니다. p 값은 차이가 우연일 확률을 말할 뿐 효과의 크기(위험비)나 임상적 중요성이 아닙니다.</Hint>
        </ControlGroup>
      )}
    </>
  )
}

const defaults: SurvParams = { ci: true, level: 0.95, censorMarks: true, riskTable: true, median: true, overlay: false, hidden: [] }

export const kaplanMeierModule: VizModule<SurvParams> = {
  roles,
  datasets: ['survival-trial'],
  defaultParams: defaults,
  Chart: (p) => <SurvivalFrame mode="km" {...p} />,
  Controls: (p) => <SurvControls mode="km" {...p} />,
  hint: '범례를 눌러 집단을 숨기거나 보이기 · 곡선 위에 포인터를 올리면 그 시간의 생존율 · 신뢰구간과 위험 집단 표를 켜고 끄기',
}

export const nelsonAalenModule: VizModule<SurvParams> = {
  roles,
  datasets: ['survival-trial'],
  defaultParams: { ...defaults, riskTable: false, overlay: true },
  Chart: (p) => <SurvivalFrame mode="na" {...p} />,
  Controls: (p) => <SurvControls mode="na" {...p} />,
  hint: '기울기가 클수록 그 시점의 위험이 큽니다 · 점선은 카플란–마이어에서 얻은 −log S(t)와의 비교 · 범례로 집단 숨기기',
}
