import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { AxisLeft, BandAxis, ChartMessage, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, StatTable, Toggle } from '../../components/controls'
import { categoryColor } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { removeRows } from '../../data/table'
import { useTween } from '../../hooks/motion'
import { boxStats, type BoxStats, type WhiskerRule } from '../../stats/boxplot'
import type { QuantileMethod } from '../../stats/descriptive'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { addToBand, jitter } from './groupShared'
import { groupedValues, paddedDomain } from './shared'

export interface BoxParams {
  rule: WhiskerRule
  k: number
  method: QuantileMethod
  showPoints: boolean
  showMean: boolean
}

const statsFor = (values: number[], p: BoxParams) => boxStats(values, { rule: p.rule, k: p.k, method: p.method, percentile: 0.05 })

function BoxChart({ table, mapping, params, width, height, compact, onTableChange }: ChartProps<BoxParams>) {
  const valueCol = roleColumn(mapping, 'value')
  const groupCol = roleColumn(mapping, 'group')
  const groups = useMemo(() => groupedValues(table, valueCol, groupCol), [table, valueCol, groupCol])
  const color = useMemo(() => categoryColor(groups.map((g) => g.key)), [groups])
  const stats = useMemo(() => groups.map((g) => statsFor(g.values, params)!), [groups, params])
  const m = margins(compact)
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const { tip, show, hide } = useTooltip()
  const all = groups.flatMap((g) => g.values)
  const y = d3.scaleLinear().domain(paddedDomain(all, 0.06)).range([ih, 0]).nice()
  const x = d3.scaleBand().domain(groups.map((g) => g.key)).range([0, iw]).paddingInner(0.35).paddingOuter(0.25)
  const bw = Math.min(x.bandwidth(), 140)
  const geometry = useMemo(() => stats.map((s) => [s.whiskerLow, s.q1, s.median, s.q3, s.whiskerHigh].map((v) => y(v))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stats, ih, y.domain()[0], y.domain()[1]])
  const shown = useTween(geometry, { snapKey: `${iw}x${ih}`, enabled: !compact })

  if (!valueCol) return <ChartMessage>값으로 사용할 숫자형 열을 선택하세요.</ChartMessage>
  if (!all.length) return <ChartMessage>숫자 값이 없습니다.</ChartMessage>
  const editable = !!onTableChange && !compact

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} role="img" data-testid="chart-svg"
        aria-label={`박스 플롯: ${valueCol}${groupCol ? ` (${groupCol}별)` : ''}`}
        onPointerUp={(e) => { if (editable) { const t = addToBand(e, svgRef.current!, m, ih, x, y, table, valueCol, groupCol); if (t) onTableChange!(t) } }}
        onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <rect width={iw} height={ih} className="plot-bg" fill="transparent" />
          <AxisLeft scale={y} x={0} grid={iw} label={valueCol} compact={compact} />
          {groups.map((g, gi) => {
            const s: BoxStats = stats[gi]
            const [wl, q1, md, q3, wh] = shown[gi] ?? geometry[gi]
            const cx = (x(g.key) ?? 0) + x.bandwidth() / 2
            const c = color(g.key)
            const outlierSet = new Set(s.outliers)
            return (
              <g key={g.key} className="marks" data-group={g.key}>
                {params.showPoints && !compact && g.values.map((v, k) => !outlierSet.has(v) && (
                  <circle key={g.rows[k]} className="box-point" cx={cx + jitter(g.rows[k]) * bw * 0.8} cy={y(v)} r={2.4} fill={c}
                    onPointerUp={editable ? (e) => { e.stopPropagation(); onTableChange!(removeRows(table, [g.rows[k]])) } : undefined}><title>{fmt(v)}{editable ? ' · 클릭하면 삭제' : ''}</title></circle>
                ))}
                <line className="whisker" x1={cx} x2={cx} y1={wl} y2={q1} />
                <line className="whisker" x1={cx} x2={cx} y1={q3} y2={wh} />
                <line className="whisker" x1={cx - bw / 4} x2={cx + bw / 4} y1={wl} y2={wl} />
                <line className="whisker" x1={cx - bw / 4} x2={cx + bw / 4} y1={wh} y2={wh} />
                <rect className="box" x={cx - bw / 2} width={bw} y={Math.min(q1, q3)} height={Math.max(1, Math.abs(q1 - q3))} fill={c} fillOpacity={0.22} stroke={c}
                  onPointerEnter={compact ? undefined : (e) => {
                    const lp = localPoint(svgRef.current!, e)
                    show(lp.x, lp.y, <><b>{g.key}</b> (n = {s.n})<br />Q3 {fmt(s.q3)} · 중앙값 {fmt(s.median)} · Q1 {fmt(s.q1)}<br />IQR {fmt(s.iqr)} · 이상치 {s.outliers.length}개</>)
                  }} onPointerLeave={hide} />
                <line className="median" x1={cx - bw / 2} x2={cx + bw / 2} y1={md} y2={md} />
                {params.showMean && <path className="mean-mark" d={`M${cx},${y(d3.mean(g.values)!) - 5}l5,5l-5,5l-5,-5z`} />}
                {params.rule === 'tukey' && !compact && (
                  <g className="fence" aria-hidden="true">
                    <line x1={cx - bw / 2 - 6} x2={cx + bw / 2 + 6} y1={y(s.upperFence)} y2={y(s.upperFence)} />
                    <line x1={cx - bw / 2 - 6} x2={cx + bw / 2 + 6} y1={y(s.lowerFence)} y2={y(s.lowerFence)} />
                  </g>
                )}
                {g.values.map((v, k) => outlierSet.has(v) && (
                  <circle key={`o${g.rows[k]}`} className="outlier" cx={cx} cy={y(v)} r={compact ? 2 : 4} stroke={c} data-testid="outlier"
                    onPointerUp={editable ? (e) => { e.stopPropagation(); onTableChange!(removeRows(table, [g.rows[k]])) } : undefined}>
                    <title>이상치 {fmt(v)}{editable ? ' · 클릭하면 삭제' : ''}</title>
                  </circle>
                ))}
              </g>
            )
          })}
          <BandAxis scale={x} orient="bottom" offset={ih} label={groupCol ?? undefined} compact={compact} />
        </g>
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function BoxControls({ params, setParams, table, mapping }: ControlsProps<BoxParams>) {
  const groups = groupedValues(table, roleColumn(mapping, 'value'), roleColumn(mapping, 'group'))
  const rows = groups.map((g) => ({ key: g.key, s: statsFor(g.values, params)! }))
  return (
    <>
      <ControlGroup title="수염과 이상치 기준">
        <Segmented label="수염 규칙" value={params.rule} onChange={(rule) => setParams({ rule })} testId="ctl-whisker"
          options={[{ value: 'tukey', label: 'k × IQR' }, { value: 'percentile', label: '5–95%' }, { value: 'minmax', label: '최소–최대' }]} />
        <Slider label="IQR 배수 k" value={params.k} min={0.5} max={3} step={0.1} disabled={params.rule !== 'tukey'} onChange={(k) => setParams({ k })} format={(v) => v.toFixed(1)} testId="ctl-k" />
        <Hint>
          {params.rule === 'tukey' && `울타리 = [Q1 − ${params.k.toFixed(1)}·IQR, Q3 + ${params.k.toFixed(1)}·IQR]. 수염은 울타리 안의 가장 먼 관측값까지, 밖의 값은 이상치(○)입니다. 점선이 울타리입니다.`}
          {params.rule === 'percentile' && '수염은 5번째와 95번째 백분위수에서 끝나고, 그 바깥 관측값을 점으로 표시합니다.'}
          {params.rule === 'minmax' && '수염이 최솟값과 최댓값까지 뻗어 이상치를 따로 표시하지 않습니다.'}
        </Hint>
        <Segmented label="사분위수 계산" value={params.method} onChange={(method) => setParams({ method })} testId="ctl-method"
          options={[{ value: 'linear', label: '선형 보간 (R-7)' }, { value: 'tukey', label: 'Tukey 힌지' }]} />
      </ControlGroup>
      <ControlGroup title="표시">
        <Toggle label="관측값 점 표시" description="점을 클릭하면 삭제" checked={params.showPoints} onChange={(showPoints) => setParams({ showPoints })} testId="ctl-points" />
        <Toggle label="평균 표시 (◆)" checked={params.showMean} onChange={(showMean) => setParams({ showMean })} />
      </ControlGroup>
      <ControlGroup title="요약 통계">
        <StatTable rows={[['그룹', 'Q1', '중앙값', 'Q3', 'IQR', '이상치'], ...rows.map(({ key, s }) => [key, fmt(s.q1), fmt(s.median), fmt(s.q3), fmt(s.iqr), String(s.outliers.length)])]} />
      </ControlGroup>
    </>
  )
}

export const boxModule: VizModule<BoxParams> = {
  roles: [
    { key: 'value', label: '값', type: 'number', required: true },
    { key: 'group', label: '그룹', type: 'category', auto: true },
  ],
  datasets: ['outliers', 'groups', 'normal', 'skewed', 'bimodal'],
  defaultParams: { rule: 'tukey', k: 1.5, method: 'linear', showPoints: false, showMean: false },
  Chart: BoxChart,
  Controls: BoxControls,
  hint: '그룹 영역을 클릭하면 그 높이에 값이 추가됩니다 (위·아래 끝을 눌러 이상치 만들기) · 이상치를 클릭하면 삭제',
}
