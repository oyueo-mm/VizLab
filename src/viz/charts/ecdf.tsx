import * as d3 from 'd3'
import { useMemo, useRef, useState } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Legend, Readout, localPoint, margins } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Toggle } from '../../components/controls'
import { categoryColor } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { mean, standardDeviation } from '../../stats/descriptive'
import { ecdf, ecdfAt, normalCdf } from '../../stats/ecdf'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { addValueAt, Rug } from './distShared'
import { groupedValues, paddedDomain } from './shared'

export interface EcdfParams {
  complementary: boolean
  showNormal: boolean
  showJumps: boolean
  showRug: boolean
}

/** SVG path for a right-continuous step function starting at F = 0 left of the data. */
export function stepPath(steps: { x: number; p: number }[], x: (v: number) => number, y: (v: number) => number, x0: number, x1: number, flip: boolean) {
  const f = (p: number) => y(flip ? 1 - p : p)
  let d = `M${x(x0)},${f(0)}`
  for (const s of steps) d += `H${x(s.x)}V${f(s.p)}`
  return `${d}H${x(x1)}`
}

function EcdfChart({ table, mapping, params, width, height, compact, onTableChange }: ChartProps<EcdfParams>) {
  const valueCol = roleColumn(mapping, 'value')
  const groupCol = roleColumn(mapping, 'group')
  const groups = useMemo(() => groupedValues(table, valueCol, groupCol), [table, valueCol, groupCol])
  const color = useMemo(() => (groupCol ? categoryColor(groups.map((g) => g.key)) : () => '#2a8c82'), [groups, groupCol])
  const series = useMemo(() => groups.map((g) => ({ key: g.key, steps: ecdf(g.values), mu: mean(g.values), sd: standardDeviation(g.values), n: g.values.length })), [groups])
  const m = margins(compact)
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const [probe, setProbe] = useState<number | null>(null)
  const all = groups.flatMap((g) => g.values)

  if (!valueCol) return <ChartMessage>값으로 사용할 숫자형 열을 선택하세요.</ChartMessage>
  if (!all.length) return <ChartMessage>숫자 값이 없습니다.</ChartMessage>

  const [x0, x1] = paddedDomain(all, 0.05)
  const x = d3.scaleLinear().domain([x0, x1]).range([0, iw])
  const y = d3.scaleLinear().domain([0, 1]).range([ih, 0])
  const flip = params.complementary
  const editable = !!onTableChange && !compact
  const label = flip ? '1 − F̂(x)  (x보다 큰 비율)' : 'F̂(x)  (x 이하 비율)'

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} role="img" data-testid="chart-svg"
        aria-label={`ECDF 플롯: ${valueCol}, ${all.length}개 관측`}
        onPointerMove={compact ? undefined : (e) => {
          const lp = localPoint(svgRef.current!, e)
          const v = x.invert(lp.x - m.left)
          setProbe(v >= x0 && v <= x1 ? v : null)
        }}
        onPointerLeave={() => setProbe(null)}
        onPointerUp={(e) => { if (editable) { const t = addValueAt(e, svgRef.current!, m, iw, ih, x, table, valueCol, groupCol, groups[0]?.key); if (t) onTableChange!(t) } }}>
        <g transform={`translate(${m.left},${m.top})`}>
          <rect width={iw} height={ih} className="plot-bg" fill="transparent" />
          <AxisLeft scale={y} x={0} grid={iw} label={label} compact={compact} format={(v) => pct(v, 0)} />
          {params.showNormal && series.map((s) => {
            if (!(s.sd > 0)) return null
            const xs = d3.range(0, 121).map((i) => x0 + ((x1 - x0) * i) / 120)
            const d = d3.line<number>().x((v) => x(v)).y((v) => y(flip ? 1 - normalCdf(v, s.mu, s.sd) : normalCdf(v, s.mu, s.sd)))(xs)
            return <path key={`n${s.key}`} className="normal-ref" d={d ?? ''} stroke={color(s.key)} />
          })}
          {series.map((s) => (
            <g key={s.key} className="marks">
              <path className="ecdf-step" d={stepPath(s.steps, x, y, x0, x1, flip)} stroke={color(s.key)} data-testid="ecdf-path" />
              {params.showJumps && !compact && s.n <= 80 && s.steps.map((st, i) => {
                const prev = i ? s.steps[i - 1].p : 0
                return (
                  <g key={i}>
                    <circle cx={x(st.x)} cy={y(flip ? 1 - prev : prev)} r={3} className="jump-open" stroke={color(s.key)} />
                    <circle cx={x(st.x)} cy={y(flip ? 1 - st.p : st.p)} r={3} fill={color(s.key)} />
                  </g>
                )
              })}
            </g>
          ))}
          {probe != null && (
            <g className="probe" aria-hidden="true">
              <line x1={x(probe)} x2={x(probe)} y1={0} y2={ih} />
              {series.map((s) => {
                const p = ecdfAt(s.steps, probe)
                return <circle key={s.key} cx={x(probe)} cy={y(flip ? 1 - p : p)} r={4.5} fill="#fff" stroke={color(s.key)} strokeWidth={2} />
              })}
            </g>
          )}
          <AxisBottom scale={x} y={ih} label={valueCol} compact={compact} />
          {params.showRug && !compact && <Rug groups={groups} x={x} y={ih} color={color} editable={editable} table={table} onTableChange={onTableChange} />}
        </g>
      </svg>
      {!compact && (
        <>
          {groupCol && <Legend items={groups.map((g) => ({ key: g.key, color: color(g.key) }))} title={groupCol} />}
          <Readout items={probe != null
            ? [{ label: 'x', value: fmt(probe) }, ...series.map((s) => {
              const p = ecdfAt(s.steps, probe)
              return { label: groupCol ? s.key : 'F̂(x)', value: `${pct(flip ? 1 - p : p)} (${Math.round(p * s.n)}/${s.n})` }
            })]
            : [{ label: 'n', value: all.length }, { label: '고유값', value: series.reduce((t, s) => t + s.steps.length, 0) }, { label: '안내', value: '마우스를 올려 F̂(x) 읽기' }]} />
        </>
      )}
    </div>
  )
}

function EcdfControls({ params, setParams }: ControlsProps<EcdfParams>) {
  return (
    <>
      <ControlGroup title="표현">
        <Segmented label="세로축" value={params.complementary ? 'ccdf' : 'cdf'} onChange={(v) => setParams({ complementary: v === 'ccdf' })} testId="ctl-ccdf"
          options={[{ value: 'cdf', label: 'F̂(x)' }, { value: 'ccdf', label: '1 − F̂(x)' }]} />
        <Toggle label="점프 지점 표시" description="●는 그 값을 포함한 비율, ○는 직전 비율 (80개 이하)" checked={params.showJumps} onChange={(showJumps) => setParams({ showJumps })} testId="ctl-jumps" />
        <Toggle label="정규분포 CDF 비교" description="표본 평균·표준편차로 맞춘 이론 곡선" checked={params.showNormal} onChange={(showNormal) => setParams({ showNormal })} testId="ctl-normal" />
        <Toggle label="관측값 러그" description="눈금을 클릭하면 삭제" checked={params.showRug} onChange={(showRug) => setParams({ showRug })} />
      </ControlGroup>
      <Hint>ECDF는 구간이나 대역폭을 정할 필요가 없습니다. 같은 값이 여러 번 나오면 그만큼 계단이 크게 뜁니다.</Hint>
    </>
  )
}

export const ecdfModule: VizModule<EcdfParams> = {
  roles: [
    { key: 'value', label: '값', type: 'number', required: true },
    { key: 'group', label: '그룹', type: 'category' },
  ],
  datasets: ['normal', 'skewed', 'bimodal', 'uniform', 'groups'],
  defaultParams: { complementary: false, showNormal: false, showJumps: true, showRug: true },
  Chart: EcdfChart,
  Controls: EcdfControls,
  hint: '그래프를 클릭해 표본 추가 · 러그 눈금 클릭으로 삭제 · 마우스를 올려 누적 비율 읽기',
}
