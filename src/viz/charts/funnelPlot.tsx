import * as d3 from 'd3'
import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useRef } from 'react'
import { AxisLeft, ChartMessage, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, StatTable, Toggle } from '../../components/controls'
import { appendRow, removeRows, templateRow } from '../../data/table'
import { fmt } from '../../lib/format'
import { normalQuantile } from '../../stats/distributions'
import { eggerTest, metaAnalysis, type MetaModel } from '../../stats/meta'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { EffectAxis } from './metaAxis'
import { readStudies, studyRoles, type EffectScale } from './metaShared'

export interface FunnelPlotParams {
  scale: EffectScale
  /** The centre line: fixed-effect or random-effects pooled estimate. */
  model: MetaModel
  level: 0.9 | 0.95 | 0.99
  contours: boolean
  yAxis: 'se' | 'precision'
  selected: number
}

function FunnelPlotChart({ table, mapping, params, setParams, width, height, compact, onTableChange, linked }: ChartProps<FunnelPlotParams>) {
  const { studies, skipped } = useMemo(() => readStudies(table, mapping, params.scale), [table, mapping, params.scale])
  const meta = useMemo(() => metaAnalysis(studies, params.model), [studies, params.model])
  // The pseudo-confidence limits always centre on the fixed-effect estimate (the usual convention); the random-effects line is drawn for comparison.
  const fixed = useMemo(() => metaAnalysis(studies, 'fixed'), [studies])
  const egger = useMemo(() => eggerTest(studies), [studies])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const log = params.scale === 'ratio'
  const back = (v: number) => (log ? Math.exp(v) : v)
  const marked = new Set(linked?.rows ?? [])
  const editable = !!onTableChange && !compact
  const effectCol = roleColumn(mapping, 'effect')

  if (!effectCol) return <ChartMessage>효과 크기(숫자형) 열을 선택하세요.</ChartMessage>
  if (studies.length < 2 || !meta || !fixed) return <ChartMessage>연구가 2개 이상 필요합니다.<small>효과 크기와 신뢰구간(또는 표준오차)이 필요하고, 비(ratio)는 0보다 커야 합니다.</small></ChartMessage>

  const m = margins(compact, { top: compact ? 8 : 40, bottom: compact ? 10 : 52, left: compact ? 10 : 62 })
  const iw = Math.max(40, width - m.left - m.right)
  const ih = Math.max(40, height - m.top - m.bottom)
  const seMax = d3.max(studies, (s) => s.se)! * 1.08
  const z = normalQuantile((1 + params.level) / 2)
  // Both axes cover the funnel's widest limits and every point.
  const xs = studies.map((s) => s.effect)
  const half = Math.max(z * seMax, d3.max(xs.map((v) => Math.abs(v - fixed.effect)))! * 1.08)
  const dom: [number, number] = [fixed.effect - half, fixed.effect + half].map(back) as [number, number]
  const x = (log ? d3.scaleLog() : d3.scaleLinear()).domain(dom).range([0, iw]) as d3.ScaleContinuousNumeric<number, number>
  const precision = params.yAxis === 'precision'
  const yv = (se: number) => (precision ? 1 / se : se)
  const y = precision
    ? d3.scaleLinear().domain([0, d3.max(studies, (s) => 1 / s.se)! * 1.08]).range([ih, 0])
    : d3.scaleLinear().domain([0, seMax]).range([0, ih])
  const ses = d3.range(0, 41).map((i) => (seMax * i) / 40)
  const funnel = (centre: number, zz: number) => ses.map((se) => [x(back(centre - zz * se)), y(yv(Math.max(se, seMax * 1e-3)))] as const)
  const left = funnel(fixed.effect, z)
  const right = funnel(fixed.effect, -z)
  const region = precision ? '' : `M${left.map((p) => p.join(',')).join('L')}L${[...right].reverse().map((p) => p.join(',')).join('L')}Z`
  const line = (pts: readonly (readonly [number, number])[]) => `M${pts.map((p) => p.join(',')).join('L')}`
  const nullV = 0 // no effect, on the analysis scale (log 1 = 0 for ratios)
  const bands = [{ zz: normalQuantile(0.995), fill: '#e7ecea' }, { zz: normalQuantile(0.975), fill: '#eef2f1' }, { zz: normalQuantile(0.95), fill: '#f5f7f6' }]
  const del = () => { if (params.selected >= 0 && params.selected < table.rows.length) { onTableChange!(removeRows(table, [params.selected])); setParams({ selected: -1 }) } }
  const add = () => {
    const names = roleColumn(mapping, 'label')
    const lc = roleColumn(mapping, 'lo'); const hc = roleColumn(mapping, 'hi'); const sc = roleColumn(mapping, 'se')
    const se = Math.round(seMax * 0.6 * 1e3) / 1e3
    const patch: Record<string, string | number> = { [effectCol]: Math.round(back(fixed.effect) * 1e3) / 1e3 }
    if (lc) patch[lc] = Math.round(back(fixed.effect - 1.96 * se) * 1e3) / 1e3
    if (hc) patch[hc] = Math.round(back(fixed.effect + 1.96 * se) * 1e3) / 1e3
    if (sc) patch[sc] = se
    if (names) patch[names] = `연구 ${table.rows.length + 1}`
    onTableChange!(appendRow(table, { ...templateRow(table), ...patch }))
    setParams({ selected: table.rows.length })
  }

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`퍼널 플롯: 연구 ${studies.length}개`} tabIndex={editable ? 0 : undefined} onPointerLeave={() => { hide(); linked?.set(null) }}
        onKeyDown={(e) => { if (editable && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); del() } }}>
        <g transform={`translate(${m.left},${m.top})`}>
          {params.contours && !precision && (
            <g aria-hidden="true">{bands.map((b, i) => <path key={i} d={`M${ses.map((se) => `${x(back(nullV - b.zz * se))},${y(yv(Math.max(se, 1e-9)))}`).join('L')}L${[...ses].reverse().map((se) => `${x(back(nullV + b.zz * se))},${y(yv(Math.max(se, 1e-9)))}`).join('L')}Z`} fill={b.fill} />)}</g>
          )}
          {!precision && <path d={region} fill="#2a7d74" fillOpacity={0.07} data-testid="funnel-region" />}
          <EffectAxis scale={x} y={ih} log={log} label={log ? '효과 크기 (비, 로그 축)' : '효과 크기 (차이)'} compact={compact} grid={ih} />
          <AxisLeft scale={y} x={0} label={precision ? '정밀도 (1/표준오차)' : '표준오차 (위가 정밀)'} compact={compact} />
          {!precision && <><path d={line(left)} fill="none" stroke="#2a7d74" strokeDasharray="5 3" /><path d={line(right)} fill="none" stroke="#2a7d74" strokeDasharray="5 3" /></>}
          <line data-testid="funnel-center" x1={x(back(fixed.effect))} x2={x(back(fixed.effect))} y1={0} y2={ih} stroke="#2a7d74" strokeWidth={1.4} />
          {params.model === 'random' && meta.tau2 > 0 && <line x1={x(back(meta.effect))} x2={x(back(meta.effect))} y1={0} y2={ih} stroke="#e07a3f" strokeWidth={1.4} strokeDasharray="2 3" />}
          {log && x(1) >= 0 && x(1) <= iw && <line className="ref-line" x1={x(1)} x2={x(1)} y1={0} y2={ih} stroke="#121816" strokeOpacity={0.5} />}
          {!log && x(0) >= 0 && x(0) <= iw && <line className="ref-line" x1={x(0)} x2={x(0)} y1={0} y2={ih} stroke="#121816" strokeOpacity={0.5} />}
          {studies.map((s) => {
            const on = params.selected === s.row || marked.has(s.row)
            const out = Math.abs(s.effect - fixed.effect) > z * s.se
            return (
              <circle key={s.row} data-testid="funnel-point" data-row={s.row} data-outside={out ? '1' : undefined} cx={x(s.raw)} cy={y(yv(s.se))} r={on ? 6 : compact ? 2.4 : 4.5} fill={out ? '#e07a3f' : '#2a7d74'} fillOpacity={0.8} stroke={on ? '#121816' : '#ffffff'} strokeWidth={on ? 2 : 1} style={{ cursor: compact ? undefined : 'pointer' }}
                onPointerEnter={compact ? undefined : (e) => { linked?.set([s.row]); const p = localPoint(svgRef.current!, e); show(p.x, p.y, <><b>{s.name}</b><br />효과 {fmt(s.raw, 3)}<br />표준오차 {fmt(s.se, 3)}<br />{out ? `${fmt(params.level * 100, 1)}% 깔때기 밖` : '깔때기 안'}</>) }}
                onPointerLeave={() => { hide(); linked?.set(null) }}
                onClick={compact ? undefined : () => setParams({ selected: params.selected === s.row ? -1 : s.row })} />
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          <Readout items={[{ label: '연구', value: studies.length }, { label: '합동(고정)', value: fmt(back(fixed.effect), 3) }, ...(egger ? [{ label: 'Egger p', value: egger.p < 0.001 ? '<0.001' : fmt(egger.p, 3) }] : [{ label: 'Egger', value: '3개 이상 필요' }])]} />
          {skipped > 0 && <p className="chart-warning" role="status">{skipped}행은 효과 크기·신뢰구간(또는 표준오차)이 올바르지 않아 제외했습니다.</p>}
          {editable && (
            <div className="chart-actions" style={{ bottom: 6, right: 8 }}>
              <button type="button" onClick={add} data-testid="funnel-add"><Plus size={14} aria-hidden="true" />연구 추가</button>
              {params.selected >= 0 && params.selected < table.rows.length && <button type="button" onClick={del} data-testid="funnel-delete"><Trash2 size={14} aria-hidden="true" />선택 삭제</button>}
            </div>
          )}
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function FunnelPlotControls({ params, setParams, table, mapping }: ControlsProps<FunnelPlotParams>) {
  const { studies } = useMemo(() => readStudies(table, mapping, params.scale), [table, mapping, params.scale])
  const egger = useMemo(() => eggerTest(studies), [studies])
  const fixed = useMemo(() => metaAnalysis(studies, 'fixed'), [studies])
  const random = useMemo(() => metaAnalysis(studies, 'random'), [studies])
  const back = (v: number) => (params.scale === 'ratio' ? Math.exp(v) : v)
  const z = normalQuantile((1 + params.level) / 2)
  const outside = fixed ? studies.filter((s) => Math.abs(s.effect - fixed.effect) > z * s.se).length : 0
  return (
    <>
      <ControlGroup title="깔때기">
        <Segmented label="효과 크기의 종류" value={params.scale} onChange={(scale) => setParams({ scale })} testId="ctl-effect-scale" options={[{ value: 'ratio', label: '비 (로그 축)' }, { value: 'difference', label: '차이' }]} />
        <Select label="가상 신뢰한계" value={String(params.level)} onChange={(v) => setParams({ level: Number(v) as FunnelPlotParams['level'] })} testId="ctl-level" options={[{ value: '0.9', label: '90%' }, { value: '0.95', label: '95%' }, { value: '0.99', label: '99%' }]} />
        <Hint>합동 효과를 중심으로 ±z·표준오차 선을 그린 것이 깔때기입니다. 편향도 이질성도 없다면 연구의 약 {fmt(params.level * 100, 1)}%가 안에 들어옵니다.</Hint>
        <Segmented label="세로축" value={params.yAxis} onChange={(yAxis) => setParams({ yAxis })} testId="ctl-y-axis" options={[{ value: 'se', label: '표준오차' }, { value: 'precision', label: '정밀도' }]} />
        <Toggle label="유의수준 등고선 (효과 없음 기준)" checked={params.contours} onChange={(contours) => setParams({ contours })} description="효과 없음(0)을 중심으로 p<0.01, 0.05, 0.10 영역을 음영으로 표시합니다. 유의한 쪽에만 연구가 몰려 있다면 선택적 보고를 의심해 볼 수 있습니다." />
        <Select label="중심선 모형" value={params.model} onChange={(model) => setParams({ model })} options={[{ value: 'fixed', label: '고정효과' }, { value: 'random', label: '무작위효과 (주황 점선 추가)' }]} />
      </ControlGroup>
      <ControlGroup title="비대칭 검정">
        {fixed && random && (
          <StatTable rows={[
            ['합동 (고정)', fmt(back(fixed.effect), 4)],
            ['합동 (무작위)', fmt(back(random.effect), 4)],
            [`깔때기 밖 연구 (${fmt(params.level * 100, 1)}%)`, `${outside} / ${studies.length}`],
            ...(egger ? [['Egger 절편', fmt(egger.intercept, 3)], ['Egger p', egger.p < 0.001 ? '<0.001' : fmt(egger.p, 3)]] : [['Egger', '연구 3개 이상 필요']]),
          ]} />
        )}
        <Hint>비대칭이 보여도 출판 편향이 입증된 것은 아닙니다. 연구 간 이질성, 작은 연구의 다른 대상·방법, 우연도 같은 모양을 만들 수 있고, 연구가 10개 미만이면 검정력이 낮아 판단하기 어렵습니다. 이 그림은 퍼널 차트(전환율 단계)와 이름만 비슷한 별개의 그림입니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const funnelPlotModule: VizModule<FunnelPlotParams> = {
  roles: studyRoles,
  datasets: ['studies-biased', 'studies'],
  defaultParams: { scale: 'ratio', model: 'fixed', level: 0.95, contours: false, yAxis: 'se', selected: -1 },
  Chart: FunnelPlotChart,
  Controls: FunnelPlotControls,
  hint: '점을 클릭해 선택(Delete로 삭제) · ‘연구 추가’ · 깔때기 밖의 주황 점과 Egger 검정으로 비대칭 확인 — 비대칭이 곧 출판 편향은 아닙니다',
}
