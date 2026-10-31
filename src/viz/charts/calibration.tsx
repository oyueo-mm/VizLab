import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, StatTable, Toggle } from '../../components/controls'
import { fmt } from '../../lib/format'
import { calibration } from '../../stats/agreement'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { classifierRoles, scoredRows } from './classifier'

export interface CalibrationParams {
  bins: number
  strategy: 'uniform' | 'quantile'
  showCi: boolean
  showCounts: boolean
  /** Selected bin index, or −1. */
  selected: number
}

function useCalibration(table: ChartProps<CalibrationParams>['table'], mapping: ChartProps<CalibrationParams>['mapping'], params: CalibrationParams) {
  const { data, badLabels } = useMemo(() => scoredRows(table, mapping), [table, mapping])
  const probs = useMemo(() => data.map((d) => ({ p: d.score, y: d.label as 0 | 1, row: d.row })), [data])
  const outOfRange = probs.filter((d) => d.p < 0 || d.p > 1).length
  const cal = useMemo(() => calibration(probs, params.bins, params.strategy), [probs, params.bins, params.strategy])
  return { cal, outOfRange, badLabels, n: probs.length }
}

function CalibrationChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<CalibrationParams>) {
  const { cal, outOfRange, badLabels } = useCalibration(table, mapping, params)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const marked = new Set(linked?.rows ?? [])
  const showCounts = params.showCounts && !compact
  const m = margins(compact, compact ? {} : { right: 20 })
  const histH = showCounts ? Math.min(70, height * 0.2) : 0
  const gap = showCounts ? 38 : 0
  const iw = Math.max(40, width - m.left - m.right)
  const ih = Math.max(40, height - m.top - m.bottom - histH - gap)

  if (!mapping.score || !mapping.label) return <ChartMessage>예측 확률(0~1)과 실제 레이블(0/1) 열을 선택하세요.</ChartMessage>
  if (!cal) return <ChartMessage>0~1 사이의 예측 확률과 0/1 레이블이 있는 행이 없습니다.<small>{outOfRange > 0 ? '확률이 아닌 점수(0~1 밖)는 보정 곡선에 쓸 수 없습니다. ' : ''}{badLabels > 0 ? `레이블이 0/1이 아닌 ${badLabels}행이 있습니다.` : ''}</small></ChartMessage>

  const x = d3.scaleLinear().domain([0, 1]).range([0, iw])
  const y = d3.scaleLinear().domain([0, 1]).range([ih, 0])
  const nMax = d3.max(cal.bins, (b) => b.n) || 1
  const hy = d3.scaleLinear().domain([0, nMax]).range([histH, 0])
  const rad = (n: number) => (compact ? 2.5 : 4 + 7 * Math.sqrt(n / nMax))
  const line = d3.line<(typeof cal.bins)[number]>().x((b) => x(b.meanPred)).y((b) => y(b.observed))

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`보정 곡선: 구간 ${cal.bins.length}개, ECE ${fmt(cal.ece, 3)}`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisBottom scale={x} y={ih} grid={ih} label={showCounts ? undefined : '예측 확률 (구간 평균)'} compact={compact} />
          <AxisLeft scale={y} x={0} grid={iw} label="실제 양성 비율" compact={compact} />
          <line data-testid="cal-diagonal" x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="#8a9692" strokeDasharray="5 4" />
          {!compact && <text className="bar-label" x={x(0.62)} y={y(0.62) + 18} fill="#5a6b66" transform={`rotate(-45 ${x(0.62)} ${y(0.62) + 18})`}>완벽한 보정</text>}
          <path d={line(cal.bins) ?? ''} fill="none" stroke="#2a7d74" strokeWidth={1.6} />
          {cal.bins.map((b, i) => {
            const on = params.selected === i || b.rows.some((r) => marked.has(r))
            return (
              <g key={i} data-testid="cal-bin" data-n={b.n} data-pred={b.meanPred.toFixed(5)} data-obs={b.observed.toFixed(5)} style={{ cursor: compact ? undefined : 'pointer' }}
                onPointerEnter={compact ? undefined : (e) => { linked?.set(b.rows); const p = localPoint(svgRef.current!, e); show(p.x, p.y, <><b>구간 {i + 1}</b> ({fmt(b.lo, 3)} ~ {fmt(b.hi, 3)})<br />예측 평균 {fmt(b.meanPred, 3)} · 실제 {fmt(b.observed, 3)} ({b.positives}/{b.n})<br />{params.showCi ? <>95% 신뢰구간(Wilson) {fmt(b.ciLo, 3)} ~ {fmt(b.ciHi, 3)}<br /></> : null}{b.observed < b.meanPred ? '과대 예측(과신)' : b.observed > b.meanPred ? '과소 예측' : '일치'}</>) }}
                onPointerLeave={() => { hide(); linked?.set(null) }}
                onClick={compact ? undefined : () => setParams({ selected: params.selected === i ? -1 : i })}>
                {params.showCi && !compact && <g stroke="#2a7d74" strokeOpacity={0.7}><line x1={x(b.meanPred)} x2={x(b.meanPred)} y1={y(b.ciLo)} y2={y(b.ciHi)} /><line x1={x(b.meanPred) - 4} x2={x(b.meanPred) + 4} y1={y(b.ciLo)} y2={y(b.ciLo)} /><line x1={x(b.meanPred) - 4} x2={x(b.meanPred) + 4} y1={y(b.ciHi)} y2={y(b.ciHi)} /></g>}
                <circle cx={x(b.meanPred)} cy={y(b.observed)} r={on ? rad(b.n) + 2 : rad(b.n)} fill={on ? '#e07a3f' : '#2a7d74'} fillOpacity={0.85} stroke={on ? '#121816' : '#ffffff'} strokeWidth={on ? 2 : 1} />
              </g>
            )
          })}
          {showCounts && (
            <g transform={`translate(0,${ih + gap})`} aria-label="구간별 표본 수">
              {cal.bins.map((b, i) => <rect key={i} data-testid="cal-count" x={x(b.lo)} y={hy(b.n)} width={Math.max(1, x(b.hi) - x(b.lo) - 1)} height={histH - hy(b.n)} fill={params.selected === i ? '#e07a3f' : '#b7c4c0'} />)}
              <line className="domain" x1={0} x2={iw} y1={histH} y2={histH} />
              <text className="axis-label" x={iw / 2} y={histH + 16} textAnchor="middle">예측 확률 분포 (구간별 표본 수)</text>
              <text className="bar-label" x={-6} y={4} textAnchor="end">{nMax}</text>
            </g>
          )}
        </g>
      </svg>
      {!compact && (
        <>
          <Readout items={[{ label: 'ECE', value: fmt(cal.ece, 3) }, { label: 'MCE', value: fmt(cal.mce, 3) }, { label: 'Brier', value: fmt(cal.brier, 3) }, { label: 'n', value: cal.n }]} />
          {(outOfRange > 0 || badLabels > 0) && <p className="chart-warning" role="status">{outOfRange > 0 ? `0~1 밖의 예측 ${outOfRange}행 ` : ''}{badLabels > 0 ? `레이블이 0/1이 아닌 ${badLabels}행 ` : ''}은 제외했습니다.</p>}
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function CalibrationControls({ params, setParams, table, mapping }: ControlsProps<CalibrationParams>) {
  const { cal } = useCalibration(table, mapping, params)
  return (
    <>
      <ControlGroup title="구간 나누기">
        <Slider label="구간 수" value={params.bins} min={3} max={30} onChange={(bins) => setParams({ bins })} testId="ctl-cal-bins" />
        <Segmented label="구간 방식" value={params.strategy} onChange={(strategy) => setParams({ strategy })} testId="ctl-cal-strategy" options={[{ value: 'uniform', label: '같은 폭' }, { value: 'quantile', label: '같은 개수' }]} />
        <Hint>{params.strategy === 'uniform' ? '확률 0~1을 같은 폭으로 나눕니다. 예측이 한쪽에 몰려 있으면 일부 구간은 표본이 매우 적어 점이 흔들립니다.' : '구간마다 표본 수가 같도록 나눕니다. 점의 신뢰도가 고르지만 구간의 폭은 서로 다릅니다.'}</Hint>
        <Toggle label="신뢰구간(Wilson)" checked={params.showCi} onChange={(showCi) => setParams({ showCi })} />
        <Toggle label="구간별 표본 수 히스토그램" checked={params.showCounts} onChange={(showCounts) => setParams({ showCounts })} />
      </ControlGroup>
      {cal && (
        <ControlGroup title="결과">
          <StatTable rows={[['표본 수', cal.n], ['ECE (기대 보정 오차)', fmt(cal.ece, 4)], ['MCE (최대 보정 오차)', fmt(cal.mce, 4)], ['Brier 점수', fmt(cal.brier, 4)]]} />
          <Hint>ECE = Σ (구간 표본 비율 × |실제 비율 − 예측 평균|)입니다. 대각선보다 아래면 예측 확률이 실제보다 높은 과신, 위면 과소 예측입니다. ECE는 구간 방식과 개수에 따라 값이 달라지므로 한 숫자로만 비교하지 마세요. 보정이 좋아도 구분 능력(AUC)이 낮을 수 있고 그 반대도 가능합니다.</Hint>
        </ControlGroup>
      )}
    </>
  )
}

export const calibrationModule: VizModule<CalibrationParams> = {
  roles: classifierRoles.map((r) => (r.key === 'score' ? { ...r, label: '예측 확률 (0~1)', prefer: '확률|prob|score' } : r)),
  datasets: ['risk-model', 'scores', 'scores-imbalanced'],
  defaultParams: { bins: 10, strategy: 'uniform', showCi: true, showCounts: true, selected: -1 },
  Chart: CalibrationChart,
  Controls: CalibrationControls,
  hint: '구간 수와 방식(같은 폭/같은 개수)을 바꿔 보세요 · 점이 대각선 아래면 과신 · 구간을 클릭하면 선택됩니다',
}
