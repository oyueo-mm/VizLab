import * as d3 from 'd3'
import { Shuffle } from 'lucide-react'
import { useMemo, useRef, type PointerEvent } from 'react'
import { AxisBottom, BandAxis, ChartMessage, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, NumberField, Segmented, Select, Slider, StatTable, Toggle } from '../../components/controls'
import { removeRows } from '../../data/table'
import { categoryColor } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { meanInterval, simulateIntervals, type CiMethod } from '../../stats/inference'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { addValueAtBand } from './ciHelpers'
import { groupedValues, paddedDomain } from './shared'

export interface CiParams {
  mode: 'groups' | 'simulate'
  level: number
  method: CiMethod
  showPoints: boolean
  /** simulate mode */
  n: number
  sims: number
  mu: number
  sigma: number
  seed: number
}

const METHOD_LABEL: Record<CiMethod, string> = { t: 't 분포', z: '정규 근사 (z)', bootstrap: '부트스트랩 백분위' }

function CiChart({ table, mapping, params, width, height, compact, onTableChange }: ChartProps<CiParams>) {
  const valueCol = roleColumn(mapping, 'value')
  const groupCol = roleColumn(mapping, 'group')
  const groups = useMemo(() => groupedValues(table, valueCol, groupCol), [table, valueCol, groupCol])
  const color = useMemo(() => categoryColor(groups.map((g) => g.key)), [groups])
  const stats = useMemo(() => groups.map((g) => ({ g, ci: meanInterval(g.values, params.level, params.method, { seed: params.seed }) })), [groups, params.level, params.method, params.seed])
  const sims = useMemo(() => (params.mode === 'simulate' ? simulateIntervals(params.sims, params.n, params.mu, params.sigma, params.level, params.method, params.seed) : []), [params.mode, params.sims, params.n, params.mu, params.sigma, params.level, params.method, params.seed])
  const m = margins(compact, compact ? {} : params.mode === 'simulate' ? { left: 36 } : { left: 86 })
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const { tip, show, hide } = useTooltip()

  const simulate = params.mode === 'simulate'
  const domain: [number, number] = simulate
    ? paddedDomain([...sims.flatMap((s) => [s.lo, s.hi]), params.mu], 0.05)
    : paddedDomain([...stats.flatMap((s) => (s.ci ? [s.ci.lo, s.ci.hi] : [])), ...(params.showPoints ? groups.flatMap((g) => g.values) : [])], 0.06)
  const x = d3.scaleLinear().domain(domain).range([0, iw])
  if (!compact) x.nice()
  const band = d3.scaleBand().domain(simulate ? sims.map((_, i) => String(i)) : groups.map((g) => g.key)).range([0, ih]).padding(simulate ? 0.35 : 0.4)

  if (!simulate) {
    if (!valueCol) return <ChartMessage>값으로 사용할 숫자형 열을 선택하세요.</ChartMessage>
    if (!groups.length) return <ChartMessage>숫자 값이 없습니다.</ChartMessage>
    if (stats.every((s) => !s.ci)) return <ChartMessage>신뢰구간은 그룹마다 값이 2개 이상 필요합니다 (표준오차에 n − 1이 쓰입니다).</ChartMessage>
  }
  const editable = !!onTableChange && !compact && !simulate
  const covered = sims.filter((s) => s.covers).length

  const onUp = (e: PointerEvent<SVGSVGElement>) => {
    if (!editable) return
    const t = addValueAtBand(e, svgRef.current!, m, iw, ih, x, band, table, valueCol!, groupCol)
    if (t) onTableChange!(t)
  }

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} role="img" data-testid="chart-svg"
        aria-label={simulate ? `신뢰구간 반복 표집: ${sims.length}개 중 ${covered}개가 모평균을 포함` : `신뢰구간 그래프: ${groupCol ?? valueCol}별 평균의 ${pct(params.level, 0)} 신뢰구간`} onPointerUp={onUp} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <rect width={iw} height={ih} className="plot-bg" fill="transparent" />
          <AxisBottom scale={x} y={ih} grid={ih} label={simulate ? '표본 평균과 신뢰구간' : valueCol ?? ''} compact={compact} />
          {!simulate && <BandAxis scale={band} orient="left" offset={0} compact={compact} />}
          {simulate ? (
            <>
              <line className="ci-true" data-testid="ci-true" x1={x(params.mu)} x2={x(params.mu)} y1={0} y2={ih} />
              {sims.map((s, i) => {
                const cy = (band(String(i)) ?? 0) + band.bandwidth() / 2
                const c = s.covers ? '#2a8c82' : '#cf4f6a'
                return (
                  <g key={i} className="marks" data-testid="ci-sim" data-covers={s.covers ? '1' : '0'}
                    onPointerMove={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>표본 {i + 1}</b><br />평균 {fmt(s.mean, 3)}<br />[{fmt(s.lo, 3)}, {fmt(s.hi, 3)}]<br />{s.covers ? '모평균 포함' : '모평균을 놓침'}</>) }} onPointerLeave={hide}>
                    <line x1={x(s.lo)} x2={x(s.hi)} y1={cy} y2={cy} stroke={c} strokeWidth={compact ? 1.2 : 2} />
                    {!compact && <circle cx={x(s.mean)} cy={cy} r={2.4} fill={c} />}
                  </g>
                )
              })}
            </>
          ) : stats.map(({ g, ci }) => {
            const cy = (band(g.key) ?? 0) + band.bandwidth() / 2
            const c = color(g.key)
            return (
              <g key={g.key} className="marks" data-group={g.key}>
                {params.showPoints && g.values.map((v, k) => (
                  <circle key={g.rows[k]} className="ci-point" cx={x(v)} cy={cy + ((((g.rows[k] * 2654435761) >>> 0) % 1000) / 1000 - 0.5) * band.bandwidth() * 0.9} r={compact ? 1.5 : 2.4} fill={c} fillOpacity={0.28}
                    onPointerUp={editable ? (e) => { e.stopPropagation(); onTableChange!(removeRows(table, [g.rows[k]])) } : undefined}>{editable && <title>{fmt(v)} · 클릭하면 삭제</title>}</circle>
                ))}
                {ci && (
                  <g data-testid="ci-bar"
                    onPointerMove={compact ? undefined : (e) => {
                      const lp = localPoint(svgRef.current!, e)
                      show(lp.x, lp.y, <><b>{g.key}</b> (n = {ci.n})<br />평균 {fmt(ci.mean, 3)} · 표준편차 {fmt(ci.sd, 3)}<br />표준오차 {fmt(ci.se, 3)}{params.method !== 'bootstrap' && <><br />{params.method === 't' ? `t(${ci.df}) = ` : 'z = '}{fmt(ci.crit, 3)}</>}<br />{pct(params.level, 0)} 신뢰구간 [{fmt(ci.lo, 3)}, {fmt(ci.hi, 3)}]</>)
                    }} onPointerLeave={hide}>
                    <line x1={x(ci.lo)} x2={x(ci.hi)} y1={cy} y2={cy} stroke={c} strokeWidth={compact ? 2 : 3.2} />
                    <line x1={x(ci.lo)} x2={x(ci.lo)} y1={cy - 7} y2={cy + 7} stroke={c} strokeWidth={2.4} />
                    <line x1={x(ci.hi)} x2={x(ci.hi)} y1={cy - 7} y2={cy + 7} stroke={c} strokeWidth={2.4} />
                    <circle cx={x(ci.mean)} cy={cy} r={compact ? 3 : 5.5} fill="#fff" stroke={c} strokeWidth={2.6} />
                  </g>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          <Readout items={simulate
            ? [{ label: '포함한 구간', value: `${covered} / ${sims.length}` }, { label: '실제 포함률', value: pct(sims.length ? covered / sims.length : 0, 0) }, { label: '목표 신뢰수준', value: pct(params.level, 0) }]
            : [{ label: '신뢰수준', value: pct(params.level, 0) }, { label: '방법', value: METHOD_LABEL[params.method] }]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function CiControls({ params, setParams, table, mapping }: ControlsProps<CiParams>) {
  const groups = groupedValues(table, roleColumn(mapping, 'value'), roleColumn(mapping, 'group'))
  const stats = groups.map((g) => ({ g, ci: meanInterval(g.values, params.level, params.method, { seed: params.seed }) }))
  return (
    <>
      <ControlGroup title="보기">
        <Segmented label="모드" value={params.mode} onChange={(mode) => setParams({ mode })} testId="ctl-mode"
          options={[{ value: 'groups', label: '내 데이터' }, { value: 'simulate', label: '반복 표집 실험' }]} />
        <Slider label="신뢰수준" value={params.level} min={0.5} max={0.99} step={0.01} onChange={(level) => setParams({ level })} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-level" />
        <Select label="구간 계산 방법" value={params.method} onChange={(method) => setParams({ method })} testId="ctl-method"
          options={[{ value: 't', label: 't 분포 (x̄ ± t·s/√n)' }, { value: 'z', label: '정규 근사 (x̄ ± z·s/√n)' }, { value: 'bootstrap', label: '부트스트랩 (재표집 2000회)' }]} />
        <Hint>
          {params.method === 't' && '모집단이 정규분포를 따르고 표준편차를 모를 때 정확한 구간입니다. 표본이 크면 정규 근사와 거의 같아집니다.'}
          {params.method === 'z' && 'n이 충분히 클 때(중심극한정리) 쓰는 근사입니다. 표본이 작으면 t 분포보다 구간이 좁아 신뢰수준이 실제보다 낮아집니다.'}
          {params.method === 'bootstrap' && '표본에서 복원추출한 평균들의 분포에서 양쪽 꼬리를 잘라낸 백분위 구간입니다. 분포 가정이 필요 없지만 작은 표본에서는 약간 좁게 나오는 경향이 있습니다.'}
        </Hint>
      </ControlGroup>
      {params.mode === 'groups' ? (
        <ControlGroup title="계산 결과">
          <Toggle label="관측값 점 표시" checked={params.showPoints} onChange={(showPoints) => setParams({ showPoints })} testId="ctl-points" />
          <StatTable rows={[['그룹', 'n', '평균', 'SE', '구간'], ...stats.map(({ g, ci }) => [g.key, String(g.values.length), ci ? fmt(ci.mean, 2) : '–', ci ? fmt(ci.se, 2) : '–', ci ? `${fmt(ci.lo, 2)} ~ ${fmt(ci.hi, 2)}` : 'n < 2'])]} />
          <Hint>표본 수는 데이터 탭의 크기 슬라이더로 바꿉니다. n이 4배가 되면 표준오차는 절반이 되어 구간이 좁아집니다. 구간이 겹쳐도 평균 차이가 유의하지 않다고 단정할 수는 없습니다.</Hint>
        </ControlGroup>
      ) : (
        <ControlGroup title="반복 표집 설정">
          <NumberField label="모평균 μ" value={params.mu} onChange={(mu) => setParams({ mu })} testId="ctl-mu" />
          <NumberField label="모표준편차 σ" value={params.sigma} min={0.01} onChange={(sigma) => setParams({ sigma })} testId="ctl-sigma" />
          <Slider label="표본 하나의 크기 n" value={params.n} min={2} max={200} onChange={(n) => setParams({ n })} testId="ctl-n" />
          <Slider label="반복 횟수" value={params.sims} min={10} max={100} step={5} onChange={(sims) => setParams({ sims })} testId="ctl-sims" />
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ seed: (params.seed * 48271 + 11) % 2147483647 || 1 })} data-testid="ctl-resample"><Shuffle size={14} aria-hidden="true" />새 표본 뽑기</button>
          <Hint>같은 모집단에서 표본을 {params.sims}번 뽑아 매번 구간을 만듭니다. 신뢰수준 {Math.round(params.level * 100)}%는 이런 구간 중 약 {Math.round(params.level * 100)}%가 모평균을 포함한다는 뜻이며, 구간 하나에 모평균이 있을 확률이 아닙니다. 빨간 구간이 모평균을 놓친 것입니다.</Hint>
        </ControlGroup>
      )}
    </>
  )
}

export const ciModule: VizModule<CiParams> = {
  roles: [
    { key: 'value', label: '값', type: 'number', required: true },
    { key: 'group', label: '그룹', type: 'category', auto: true },
  ],
  datasets: ['groups', 'outliers', 'normal'],
  defaultParams: { mode: 'groups', level: 0.95, method: 't', showPoints: true, n: 10, sims: 40, mu: 50, sigma: 10, seed: 7 },
  Chart: CiChart,
  Controls: CiControls,
  hint: '그룹 줄을 클릭해 값 추가 · 점을 클릭하면 삭제 · ‘반복 표집 실험’에서 신뢰수준의 의미 확인',
}

