import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { AxisBottom, AxisLeft, BandAxis, ChartMessage, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { categoryColor } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { boxStats } from '../../stats/boxplot'
import { boxCount, letterRules, letterValues, type LetterRule } from '../../stats/letterValue'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { groupedValues, paddedDomain } from './shared'

export interface LetterParams {
  rule: LetterRule
  /** 0 = chosen by the rule; otherwise an upper limit on the number of boxes. */
  maxBoxes: number
  outliers: boolean
  orientation: 'vertical' | 'horizontal'
  compareBox: boolean
}

function LetterChart({ table, mapping, params, width, height, compact }: ChartProps<LetterParams>) {
  const valueCol = roleColumn(mapping, 'value')
  const groupCol = roleColumn(mapping, 'group')
  const groups = useMemo(() => groupedValues(table, valueCol, groupCol), [table, valueCol, groupCol])
  const horizontal = params.orientation === 'horizontal'
  const m = margins(compact, horizontal && !compact ? { left: 92 } : {})
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const { tip, show, hide } = useTooltip()
  const color = useMemo(() => categoryColor(groups.map((g) => g.key)), [groups])
  const stats = useMemo(() => groups.map((g) => {
    const auto = boxCount(g.values.length, params.rule)
    const k = params.maxBoxes > 0 ? Math.min(auto, params.maxBoxes) : auto
    return { g, auto, k, lv: letterValues(g.values, k), box: boxStats(g.values) }
  }), [groups, params.rule, params.maxBoxes])

  if (!valueCol) return <ChartMessage>값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!stats.length) return <ChartMessage>그릴 값이 없습니다.</ChartMessage>

  const all = stats.flatMap((s) => s.g.values)
  const domain = paddedDomain(all, 0.05)
  const v = d3.scaleLinear().domain(domain).range(horizontal ? [0, iw] : [ih, 0]).nice()
  const band = d3.scaleBand().domain(stats.map((s) => s.g.key)).range(horizontal ? [0, ih] : [0, iw]).padding(0.28)
  const bw = band.bandwidth()
  const rect = (c: number, lo: number, hi: number, w: number) => horizontal
    ? { x: Math.min(v(lo), v(hi)), y: c - w / 2, width: Math.abs(v(hi) - v(lo)), height: w }
    : { x: c - w / 2, y: Math.min(v(lo), v(hi)), width: w, height: Math.abs(v(hi) - v(lo)) }

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`레터 밸류 플롯: ${valueCol}${groupCol ? `, ${groupCol}별` : ''}`} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          {horizontal
            ? <><AxisBottom scale={v} y={ih} grid={ih} label={valueCol} compact={compact} /><BandAxis scale={band} orient="left" offset={0} label={groupCol ?? undefined} compact={compact} /></>
            : <><AxisLeft scale={v} x={0} grid={iw} label={valueCol} compact={compact} /><BandAxis scale={band} orient="bottom" offset={ih} label={groupCol ?? undefined} compact={compact} /></>}
          {stats.map(({ g, lv, box, k }) => {
            if (!lv) return null
            const c = (band(g.key) ?? 0) + bw / 2
            const base = color(g.key)
            const widest = Math.min(bw, 90)
            const widthOf = (level: number) => widest * (1 - (0.82 * (level - 1)) / Math.max(1, k))
            return (
              <g key={g.key} className="marks" data-testid="lv-group">
                {[...lv.boxes].reverse().map((b) => {
                  const r = rect(c, b.lower, b.upper, widthOf(b.level))
                  const shade = 0.28 + 0.62 * (1 - (b.level - 1) / Math.max(1, k))
                  return (
                    <rect key={b.level} className="lv-box" data-testid="lv-box" {...r} fill={base} fillOpacity={shade} stroke={base} strokeWidth={0.8}
                      onPointerMove={compact ? undefined : (e) => {
                        const p = localPoint(svgRef.current!, e)
                        show(p.x, p.y, <><b>{g.key} · {b.name} 상자</b><br />{fmt(b.lower)} ~ {fmt(b.upper)}<br />양쪽 꼬리에 각각 약 {fmt(b.tail * 100, 1)}%가 바깥</>)
                      }} />
                  )
                })}
                <line className="lv-median" x1={horizontal ? v(lv.median) : c - widest / 2} x2={horizontal ? v(lv.median) : c + widest / 2} y1={horizontal ? c - widest / 2 : v(lv.median)} y2={horizontal ? c + widest / 2 : v(lv.median)}
                  stroke="#121816" strokeWidth={2.4} aria-hidden="true" />
                <title>{`${g.key}: n=${lv.n}, 중앙값 ${fmt(lv.median)}`}</title>
                {params.outliers && lv.outliers.map((o, i) => (
                  <circle key={i} className="outlier" cx={horizontal ? v(o) : c} cy={horizontal ? c : v(o)} r={compact ? 1.4 : 2.6} fill="#fff" stroke={base} strokeWidth={1.2} />
                ))}
                {params.compareBox && box && !compact && (
                  <g aria-hidden="true" className="lv-tukey">
                    <rect {...rect(c + (horizontal ? 0 : widest * 0.62), box.q1, box.q3, Math.max(5, widest * 0.14))} fill="none" stroke="#121816" strokeWidth={1.2} strokeDasharray="3 2" transform={horizontal ? `translate(0,${widest * 0.62})` : undefined} />
                  </g>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
      {!compact && (
        <p className="chart-footnote" style={{ left: m.left }}>
          {stats.map((s) => `${s.g.key}: n=${s.g.values.length.toLocaleString()}, ${s.k}단계`).join(' · ')}
        </p>
      )}
    </div>
  )
}

function LetterControls({ params, setParams }: ControlsProps<LetterParams>) {
  const rule = letterRules.find((r) => r.value === params.rule)
  return (
    <>
      <ControlGroup title="분위수 단계">
        <Select label="단계 수 기준" value={params.rule} onChange={(rule) => setParams({ rule })} options={letterRules.map((r) => ({ value: r.value, label: r.label }))} testId="ctl-rule" />
        {rule && <Hint>{rule.hint}. 표본이 작으면 근거가 부족한 바깥쪽 단계는 자동으로 빠집니다.</Hint>}
        <Slider label="최대 단계 수 제한" value={params.maxBoxes} min={0} max={10} onChange={(maxBoxes) => setParams({ maxBoxes })} format={(n) => (n === 0 ? '제한 없음' : `${n}단계`)} testId="ctl-max-boxes" />
      </ControlGroup>
      <ControlGroup title="표현">
        <Segmented label="방향" value={params.orientation} onChange={(orientation) => setParams({ orientation })} testId="ctl-orient" options={[{ value: 'vertical', label: '세로' }, { value: 'horizontal', label: '가로' }]} />
        <Toggle label="이상치 표시" description="가장 바깥 상자 밖의 관측값" checked={params.outliers} onChange={(outliers) => setParams({ outliers })} testId="ctl-outliers" />
        <Toggle label="일반 박스 플롯과 비교" description="점선 상자: 사분위수(Q1–Q3)" checked={params.compareBox} onChange={(compareBox) => setParams({ compareBox })} testId="ctl-compare-box" />
      </ControlGroup>
    </>
  )
}

export const letterValueModule: VizModule<LetterParams> = {
  roles: [
    { key: 'value', label: '값', type: 'number', required: true },
    { key: 'group', label: '그룹 (선택)', type: 'category', auto: true },
  ],
  datasets: ['big-groups', 'temps', 'outliers', 'groups', 'normal'],
  defaultParams: { rule: 'proportion', maxBoxes: 0, outliers: true, orientation: 'vertical', compareBox: false },
  Chart: LetterChart,
  Controls: LetterControls,
  hint: '단계 수 기준과 최대 단계를 바꿔 꼬리의 분위수가 어떻게 드러나는지 확인 · 상자에 마우스를 올려 구간 확인',
}
