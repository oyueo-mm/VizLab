import * as d3 from 'd3'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { useReducedMotion } from '../../hooks/motion'
import { schemes, type SequentialScheme } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { columnIndex, toLabel, toNumber } from '../../data/table'
import { fitDist, groupStats, hopDraw, meanDensity, meanQuantile, quantileDots, wilkinsonStack, type DistKind } from '../../stats/uncert7'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { categoryColor } from '../../lib/colors'

const ACCENT = '#2a8c82'
const distOptions: { value: DistKind; label: string }[] = [{ value: 'normal', label: '정규' }, { value: 'lognormal', label: '로그정규' }, { value: 'exponential', label: '지수' }, { value: 'empirical', label: '경험적' }]

function useValues(table: ChartProps<unknown>['table'], mapping: ChartProps<unknown>['mapping'], role = 'value') {
  const col = roleColumn(mapping, role)
  return useMemo(() => {
    const i = columnIndex(table, col)
    return i < 0 ? [] : table.rows.map((r) => toNumber(r[i])).filter((v): v is number => v != null)
  }, [table, col])
}

function useGroups(table: ChartProps<unknown>['table'], mapping: ChartProps<unknown>['mapping']) {
  const g = roleColumn(mapping, 'group'), v = roleColumn(mapping, 'value')
  return useMemo(() => {
    const gi = columnIndex(table, g), vi = columnIndex(table, v)
    if (gi < 0 || vi < 0) return []
    const keys: string[] = [], vals: number[] = []
    table.rows.forEach((r) => { const x = toNumber(r[vi]); if (x != null) { keys.push(toLabel(r[gi])); vals.push(x) } })
    return groupStats(keys, vals)
  }, [table, g, v])
}

// ───────────────────────────── Quantile Dotplot ─────────────────────────────

export interface QuantileParams { dist: DistKind; dots: number; interval: number; showPdf: boolean; showSample: boolean }

function QuantileChart({ table, mapping, params, width, height, compact }: ChartProps<QuantileParams>) {
  const values = useValues(table, mapping)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const dist = useMemo(() => fitDist(values, params.dist), [values, params.dist])
  const n = params.dots
  const dots = useMemo(() => (dist ? quantileDots(dist, n) : []), [dist, n])
  if (!dist) return <ChartMessage>선택한 분포를 맞출 수 없습니다(양수 값이 2개 이상 필요한 분포도 있습니다).</ChartMessage>
  const m = compact ? { l: 8, r: 8, t: 8, b: 14 } : { l: 30, r: 30, t: 50, b: 56 }
  const w = width - m.l - m.r, h = height - m.t - m.b
  const lo = dist.quantile(0.5 / n) - 0.02 * (dist.quantile(1 - 0.5 / n) - dist.quantile(0.5 / n))
  const hi = dist.quantile(1 - 0.5 / n) + 0.02 * (dist.quantile(1 - 0.5 / n) - dist.quantile(0.5 / n))
  const x = d3.scaleLinear().domain([Math.min(lo, ...values), Math.max(hi, ...values)]).nice().range([0, w])
  const bins = Math.max(6, Math.round(Math.sqrt(n) * 2.6))
  const stacked = wilkinsonStack(dots, (x.domain()[1] - x.domain()[0]) / bins)
  const levels = Math.max(1, ...stacked.map((s) => s.level + 1))
  const r = Math.max(1.5, Math.min(w / bins / 2, h / levels / 2) - 0.6)
  const a = (1 - params.interval / 100) / 2
  const [ql, qh] = [dist.quantile(a), dist.quantile(1 - a)]
  const inside = dots.filter((v) => v >= ql && v <= qh).length
  const pdfMax = Math.max(1e-12, ...x.ticks(80).map((t) => dist.pdf(t)))
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Quantile Dotplot: ${dist.kind} 분포의 ${n}개 분위수 점, 한 점의 확률 ${(100 / n).toFixed(1)}%`} onPointerLeave={hide}>
        <g transform={`translate(${m.l},${m.t})`}>
          {params.showPdf && !compact && <path d={d3.line<number>().x((t) => x(t)).y((t) => h - (dist.pdf(t) / pdfMax) * h * 0.9)(x.ticks(120)) ?? ''} fill="none" stroke="#9aa3ad" strokeDasharray="4 3" />}
          {!compact && <rect x={x(ql)} width={Math.max(0, x(qh) - x(ql))} y={0} height={h} fill={ACCENT} fillOpacity={0.07} />}
          {stacked.map((s, i) => {
            const v = s.value
            const hot = v >= ql && v <= qh
            return <circle key={i} cx={x(s.x)} cy={h - r - s.level * 2 * r * 1.04} r={r} fill={hot ? ACCENT : '#c3cad1'} data-testid="qdot"
              onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{fmt(v)}</b><br />분위수 p ≈ {(100 * dist.cdf(v)).toFixed(1)}%<br />점 하나 = {(100 / n).toFixed(1)}%</>) }} onPointerLeave={hide} />
          })}
          {params.showSample && !compact && values.map((v, i) => <line key={i} x1={x(v)} x2={x(v)} y1={h + 6} y2={h + 12} stroke="#111" strokeOpacity={0.35} />)}
          <AxisBottom scale={x} y={h} compact={compact} />
        </g>
        {!compact && <text x={m.l} y={24} className="radar-axis-label">점 {n}개 중 {inside}개({((inside / n) * 100).toFixed(0)}%)가 중앙 {params.interval}% 구간 [{fmt(ql)}, {fmt(qh)}] 안</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function QuantileControls({ params, setParams }: ControlsProps<QuantileParams>) {
  return (
    <>
      <ControlGroup title="확률분포">
        <Segmented label="분포 선택" value={params.dist} onChange={(dist) => setParams({ dist })} options={distOptions} testId="ctl-dist" />
        <Slider label="점 개수" value={params.dots} min={10} max={200} step={5} onChange={(dots) => setParams({ dots })} testId="ctl-dots" />
        <Hint>점 하나가 확률 1/n을 뜻합니다. 점의 개수를 세면 확률이 되므로 ‘20개 중 3개’처럼 빈도로 읽을 수 있습니다.</Hint>
      </ControlGroup>
      <ControlGroup title="구간과 표본">
        <Segmented label="강조 구간 (중앙)" value={String(params.interval)} onChange={(v) => setParams({ interval: Number(v) })} options={[{ value: '50', label: '50%' }, { value: '80', label: '80%' }, { value: '95', label: '95%' }]} testId="ctl-interval" />
        <Toggle label="확률밀도 곡선" checked={params.showPdf} onChange={(showPdf) => setParams({ showPdf })} />
        <Toggle label="원 표본 눈금 보기" checked={params.showSample} onChange={(showSample) => setParams({ showSample })} testId="ctl-sample" />
      </ControlGroup>
    </>
  )
}

export const quantileModule: VizModule<QuantileParams> = {
  roles: [{ key: 'value', label: '값 (표본)', type: 'number', required: true }],
  datasets: ['normal', 'skewed', 'bimodal'],
  defaultParams: { dist: 'normal', dots: 50, interval: 80, showPdf: true, showSample: false },
  Chart: QuantileChart,
  Controls: QuantileControls,
  hint: '분포와 점 개수를 바꿔 보세요 · 점 개수를 세어 구간 확률을 읽습니다',
}

// ───────────────────────────── Hypothetical Outcome Plots ─────────────────────────────

export interface HopParams { playing: boolean; fps: number; seed: number; frame: number; showCi: boolean }

function HopChart({ table, mapping, params, width, height, compact }: ChartProps<HopParams>) {
  const groups = useGroups(table, mapping)
  const reduced = useReducedMotion()
  const [frame, setFrame] = useState(params.frame)
  const [tally, setTally] = useState({ wins: 0, seen: 0 })
  const playing = params.playing && !compact && !reduced
  useEffect(() => {
    if (!playing) { setFrame(params.frame); return }
    const id = window.setInterval(() => setFrame((f) => f + 1), 1000 / params.fps)
    return () => window.clearInterval(id)
  }, [playing, params.fps, params.frame])
  useEffect(() => { setTally({ wins: 0, seen: 0 }) }, [params.seed, groups])
  const draw = useMemo(() => hopDraw(groups, frame, params.seed), [groups, frame, params.seed])
  useEffect(() => { if (draw.length >= 2) setTally((t) => ({ wins: t.wins + (draw[0] > draw[1] ? 1 : 0), seen: t.seen + 1 })) }, [draw])
  if (groups.length < 2) return <ChartMessage>HOPs에는 값이 2개 이상인 그룹이 2개 이상 필요합니다.</ChartMessage>
  const m = compact ? { l: 8, r: 8, t: 8, b: 14 } : { l: 62, r: 30, t: 56, b: 60 }
  const w = width - m.l - m.r, h = height - m.t - m.b
  const lo = Math.min(...groups.map((g) => meanQuantile(g, 0.001))), hi = Math.max(...groups.map((g) => meanQuantile(g, 0.999)))
  const y = d3.scaleLinear().domain([Math.min(0, lo), hi]).nice().range([h, 0])
  const x = d3.scaleBand<string>().domain(groups.map((g) => g.key)).range([0, w]).padding(0.35)
  const color = categoryColor(groups.map((g) => g.key))
  return (
    <div className="chart-root">
      <svg width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Hypothetical Outcome Plot: 그룹 ${groups.length}개의 평균을 표본추출한 ${frame + 1}번째 가능한 결과`}>
        <g transform={`translate(${m.l},${m.t})`}>
          <AxisLeft scale={y} x={0} compact={compact} grid={w} />
          {groups.map((g, i) => (
            <g key={g.key}>
              {params.showCi && !compact && <rect x={x(g.key)!} width={x.bandwidth()} y={y(meanQuantile(g, 0.975))} height={Math.max(0, y(meanQuantile(g, 0.025)) - y(meanQuantile(g, 0.975)))} fill={color(g.key)} fillOpacity={0.12} />}
              <rect x={x(g.key)!} width={x.bandwidth()} y={Math.min(y(draw[i]), y(0))} height={Math.abs(y(0) - y(draw[i]))} fill={color(g.key)} fillOpacity={0.88} data-testid="hop-bar" />
              {!compact && <text x={x(g.key)! + x.bandwidth() / 2} y={h + 20} textAnchor="middle" className="radar-axis-label">{g.key}</text>}
              {!compact && <text x={x(g.key)! + x.bandwidth() / 2} y={y(draw[i]) - 6} textAnchor="middle" className="radar-level">{fmt(draw[i])}</text>}
            </g>
          ))}
        </g>
        {!compact && <text x={m.l} y={26} className="radar-axis-label">가능한 결과 #{frame + 1} (시드 {params.seed}) — 평균의 표본분포에서 한 번씩 뽑은 값</text>}
        {!compact && <text x={m.l} y={44} className="radar-level" data-testid="hop-tally">지금까지 {tally.seen}개 결과 중 ‘{groups[0].key} &gt; {groups[1].key}’ {tally.wins}번</text>}
      </svg>
    </div>
  )
}

function HopControls({ params, setParams }: ControlsProps<HopParams>) {
  return (
    <>
      <ControlGroup title="재생">
        <Toggle label="재생" checked={params.playing} onChange={(playing) => setParams({ playing })} testId="hop-play" />
        <Slider label="속도 (결과/초)" value={params.fps} min={1} max={12} onChange={(fps) => setParams({ fps })} testId="hop-fps" />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ playing: false, frame: params.frame + 1 })} data-testid="hop-step">다음 결과 하나 (정지)</button>
        <Slider label="시드" value={params.seed} min={1} max={99} onChange={(seed) => setParams({ seed, frame: 0 })} testId="hop-seed" />
        <Toggle label="95% 구간 겹쳐 보기" checked={params.showCi} onChange={(showCi) => setParams({ showCi })} />
        <Hint>매 장면은 각 그룹 평균의 표본분포(스튜던트 t)에서 새로 뽑은 한 번의 가능한 결과입니다. 같은 시드와 장면 번호는 항상 같은 그림을 만듭니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const hopModule: VizModule<HopParams> = {
  roles: [{ key: 'group', label: '그룹', type: 'category', required: true }, { key: 'value', label: '값', type: 'number', required: true }],
  datasets: ['groups', 'big-groups', 'cars'],
  defaultParams: { playing: true, fps: 4, seed: 7, frame: 0, showCi: true },
  Chart: HopChart,
  Controls: HopControls,
  hint: '막대가 매번 바뀌는 것이 불확실성입니다 · 한 장면씩 넘겨 보거나 재생하세요',
}

// ───────────────────────────── Gradient Plot ─────────────────────────────

export interface GradientParams { mode: 'gradient' | 'interval' | 'both'; level: number; scheme: 'opacity' | 'color'; palette: SequentialScheme }

function GradientChart({ table, mapping, params, width, height, compact }: ChartProps<GradientParams>) {
  const groups = useGroups(table, mapping)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!groups.length) return <ChartMessage>그룹과 값 열을 선택하세요.</ChartMessage>
  const m = compact ? { l: 8, r: 8, t: 8, b: 14 } : { l: 62, r: 30, t: 44, b: 56 }
  const w = width - m.l - m.r, h = height - m.t - m.b
  const lo = Math.min(...groups.map((g) => g.mean - 3.5 * g.se)), hi = Math.max(...groups.map((g) => g.mean + 3.5 * g.se))
  const y = d3.scaleLinear().domain([lo, hi]).nice().range([h, 0])
  const x = d3.scaleBand<string>().domain(groups.map((g) => g.key)).range([0, w]).padding(0.4)
  const color = categoryColor(groups.map((g) => g.key))
  const SLICES = 70
  const a = (1 - params.level / 100) / 2
  const ramp = schemes[params.palette].interpolate
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Gradient Plot: 그룹 ${groups.length}개의 평균과 불확실성을 농도로 표현`} onPointerLeave={hide}>
        <g transform={`translate(${m.l},${m.t})`}>
          <AxisLeft scale={y} x={0} compact={compact} grid={w} />
          {groups.map((g) => {
            const dMax = meanDensity(g, g.mean) || 1
            const x0 = x(g.key)!
            const slice = (y.domain()[1] - y.domain()[0]) / SLICES
            return (
              <g key={g.key} onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{g.key}</b><br />평균 {fmt(g.mean)} (표준오차 {fmt(g.se)})<br />{params.level}% 구간 [{fmt(meanQuantile(g, a))}, {fmt(meanQuantile(g, 1 - a))}]<br />n = {g.n}</>) }}>
                {params.mode !== 'interval' && Array.from({ length: SLICES }, (_, k) => {
                  const v = y.domain()[0] + (k + 0.5) * slice
                  const t = meanDensity(g, v) / dMax
                  return <rect key={k} x={x0} width={x.bandwidth()} y={y(v + slice / 2)} height={Math.abs(y(0) - y(slice)) + 0.6} fill={params.scheme === 'opacity' ? color(g.key) : ramp(t)} fillOpacity={params.scheme === 'opacity' ? Math.min(1, t) : t < 0.01 ? 0 : 1} data-testid="grad-slice" />
                })}
                {params.mode !== 'gradient' && <>
                  <line x1={x0 + x.bandwidth() / 2} x2={x0 + x.bandwidth() / 2} y1={y(meanQuantile(g, 1 - a))} y2={y(meanQuantile(g, a))} stroke="#111" strokeWidth={2.4} data-testid="grad-interval" />
                  <line x1={x0 + x.bandwidth() * 0.3} x2={x0 + x.bandwidth() * 0.7} y1={y(meanQuantile(g, 1 - a))} y2={y(meanQuantile(g, 1 - a))} stroke="#111" strokeWidth={2} />
                  <line x1={x0 + x.bandwidth() * 0.3} x2={x0 + x.bandwidth() * 0.7} y1={y(meanQuantile(g, a))} y2={y(meanQuantile(g, a))} stroke="#111" strokeWidth={2} />
                </>}
                <line x1={x0} x2={x0 + x.bandwidth()} y1={y(g.mean)} y2={y(g.mean)} stroke="#111" strokeWidth={1.4} />
                {!compact && <text x={x0 + x.bandwidth() / 2} y={h + 20} textAnchor="middle" className="radar-axis-label">{g.key}</text>}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function GradientControls({ params, setParams }: ControlsProps<GradientParams>) {
  return (
    <>
      <ControlGroup title="표현">
        <Segmented label="다른 표현과 비교" value={params.mode} onChange={(mode) => setParams({ mode })} options={[{ value: 'gradient', label: '농도' }, { value: 'both', label: '둘 다' }, { value: 'interval', label: '구간 막대' }]} testId="ctl-mode" />
        <Segmented label="농도를 나타내는 것" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={[{ value: 'opacity', label: '투명도' }, { value: 'color', label: '색' }]} testId="ctl-scheme" />
        <Select label="색 구성 (색 모드)" value={params.palette} onChange={(palette) => setParams({ palette })} options={[{ value: 'viridis', label: 'Viridis' }, { value: 'blues', label: '파랑' }, { value: 'magma', label: 'Magma' }, { value: 'ylorrd', label: '노랑–빨강' }]} />
        <Segmented label="구간 수준" value={String(params.level)} onChange={(v) => setParams({ level: Number(v) })} options={[{ value: '50', label: '50%' }, { value: '80', label: '80%' }, { value: '95', label: '95%' }]} />
        <Hint>농도는 평균의 표본분포 밀도입니다. 구간 막대는 경계 안팎이 갑자기 달라 보이지만 농도는 평균에 가까울수록 진하게 부드럽게 변해 확률의 연속성을 보여줍니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const gradientModule: VizModule<GradientParams> = {
  roles: [{ key: 'group', label: '그룹', type: 'category', required: true }, { key: 'value', label: '값', type: 'number', required: true }],
  datasets: ['groups', 'big-groups', 'cars'],
  defaultParams: { mode: 'gradient', level: 95, scheme: 'opacity', palette: 'viridis' },
  Chart: GradientChart,
  Controls: GradientControls,
  hint: '‘구간 막대’와 번갈아 보며 같은 불확실성이 어떻게 달리 읽히는지 비교',
}

// ───────────────────────────── Wilkinson Dot Plot ─────────────────────────────

export interface WilkinsonParams { bins: number; rug: boolean }

function WilkinsonChart({ table, mapping, params, width, height, compact }: ChartProps<WilkinsonParams>) {
  const values = useValues(table, mapping)
  const gcol = roleColumn(mapping, 'group')
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const gi = columnIndex(table, gcol), vi = columnIndex(table, roleColumn(mapping, 'value'))
  const groupOf = useMemo(() => {
    const map = new Map<number, string>()
    if (gi >= 0 && vi >= 0) table.rows.forEach((r) => { const v = toNumber(r[vi]); if (v != null) map.set(v, toLabel(r[gi])) })
    return map
  }, [table, gi, vi])
  const groups = useMemo(() => [...new Set(groupOf.values())], [groupOf])
  const color = categoryColor(groups)
  if (values.length < 2) return <ChartMessage>값이 2개 이상 필요합니다.</ChartMessage>
  const m = compact ? { l: 8, r: 8, t: 8, b: 14 } : { l: 30, r: 30, t: 30, b: 56 }
  const w = width - m.l - m.r, h = height - m.t - m.b
  const x = d3.scaleLinear().domain(d3.extent(values) as [number, number]).nice().range([0, w])
  const binW = (x.domain()[1] - x.domain()[0]) / params.bins
  const stacked = wilkinsonStack(values, binW)
  const levels = Math.max(1, ...stacked.map((s) => s.level + 1))
  const r = Math.max(1.2, Math.min((w / params.bins) / 2, h / levels / 2) - 0.4)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Wilkinson Dot Plot: 관측값 ${values.length}개를 너비 ${fmt(binW)}의 구간에 쌓은 점`} onPointerLeave={hide}>
        <g transform={`translate(${m.l},${m.t})`}>
          {stacked.map((s, i) => (
            <circle key={i} cx={x(s.x)} cy={h - r - s.level * 2 * r * 1.03} r={r} fill={groupOf.has(s.value) && groups.length > 1 ? color(groupOf.get(s.value)!) : ACCENT} fillOpacity={0.85} data-testid="wdot"
              onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{fmt(s.value)}</b><br />구간 중심 {fmt(s.x)}에 쌓임</>) }} onPointerLeave={hide} />
          ))}
          {params.rug && !compact && stacked.map((s, i) => <line key={`r${i}`} x1={x(s.value)} x2={x(s.value)} y1={h + 6} y2={h + 12} stroke="#111" strokeOpacity={0.4} />)}
          <AxisBottom scale={x} y={h} compact={compact} />
        </g>
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function WilkinsonControls({ params, setParams }: ControlsProps<WilkinsonParams>) {
  return (
    <ControlGroup title="구간">
      <Slider label="구간 수" value={params.bins} min={5} max={60} onChange={(bins) => setParams({ bins })} testId="ctl-bins" />
      <Toggle label="정확한 위치 눈금" checked={params.rug} onChange={(rug) => setParams({ rug })} testId="ctl-rug" />
      <Hint>값을 구간별로 모아 구간 중심에 점을 쌓습니다. 비스웜은 점의 가로 위치를 보존하고 옆으로 비켜 겹침을 피하지만, 이 기법은 위치를 구간 중심으로 맞춰 쌓아 막대 높이처럼 개수를 읽게 합니다.</Hint>
    </ControlGroup>
  )
}

export const wilkinsonModule: VizModule<WilkinsonParams> = {
  roles: [{ key: 'value', label: '값', type: 'number', required: true }, { key: 'group', label: '그룹 (색)', type: 'category', auto: true }],
  datasets: ['normal', 'groups', 'bimodal'],
  defaultParams: { bins: 24, rug: false },
  Chart: WilkinsonChart,
  Controls: WilkinsonControls,
  hint: '구간 수를 바꾸면 쌓이는 방식이 바뀝니다',
}

// ───────────────────────────── Punchcard / Balloon Matrix ─────────────────────────────

export interface PunchParams { agg: 'sum' | 'mean'; color: 'single' | 'value'; palette: SequentialScheme; sort: 'none' | 'total'; max: number }

function PunchChart({ table, mapping, params, width, height, compact }: ChartProps<PunchParams>) {
  const rowCol = roleColumn(mapping, 'row'), colCol = roleColumn(mapping, 'col'), valCol = roleColumn(mapping, 'value')
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const data = useMemo(() => {
    const ri = columnIndex(table, rowCol), ci = columnIndex(table, colCol), vi = columnIndex(table, valCol)
    if (ri < 0 || ci < 0 || vi < 0) return null
    const cells = new Map<string, { sum: number; n: number }>()
    const rows: string[] = [], cols: string[] = []
    for (const r of table.rows) {
      const v = toNumber(r[vi])
      if (v == null) continue
      const a = toLabel(r[ri]), b = toLabel(r[ci])
      if (!rows.includes(a)) rows.push(a)
      if (!cols.includes(b)) cols.push(b)
      const c = cells.get(`${a}\u0001${b}`) ?? { sum: 0, n: 0 }
      c.sum += v; c.n++
      cells.set(`${a}\u0001${b}`, c)
    }
    const value = (a: string, b: string) => { const c = cells.get(`${a}\u0001${b}`); return c ? (params.agg === 'mean' ? c.sum / c.n : c.sum) : null }
    if (params.sort === 'total') {
      const tot = (f: (s: string) => number) => (s: string) => f(s)
      rows.sort((p, q) => tot((s) => cols.reduce((u, c) => u + (value(s, c) ?? 0), 0))(q) - tot((s) => cols.reduce((u, c) => u + (value(s, c) ?? 0), 0))(p))
      cols.sort((p, q) => rows.reduce((u, r) => u + (value(r, q) ?? 0), 0) - rows.reduce((u, r) => u + (value(r, p) ?? 0), 0))
    }
    return { rows, cols, value }
  }, [table, rowCol, colCol, valCol, params.agg, params.sort])
  if (!data || !data.rows.length) return <ChartMessage>행·열 범주와 값 열을 선택하세요.</ChartMessage>
  const m = compact ? { l: 8, r: 8, t: 8, b: 8 } : { l: 96, r: 110, t: 70, b: 20 }
  const cw = (width - m.l - m.r) / data.cols.length, ch = (height - m.t - m.b) / data.rows.length
  const maxV = Math.max(1e-12, ...data.rows.flatMap((r) => data.cols.map((c) => data.value(r, c) ?? 0)))
  const rMax = Math.max(2, (Math.min(cw, ch) / 2) * 0.92 * params.max)
  const radius = d3.scaleSqrt().domain([0, maxV]).range([0, rMax])
  const ramp = schemes[params.palette].interpolate
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Punchcard: ${data.rows.length}행 × ${data.cols.length}열, 원의 면적이 값`} onPointerLeave={hide}>
        <g transform={`translate(${m.l},${m.t})`}>
          {data.rows.map((r, i) => <line key={r} x1={0} x2={cw * data.cols.length} y1={ch * (i + 0.5)} y2={ch * (i + 0.5)} stroke="#eef0f2" />)}
          {!compact && data.rows.map((r, i) => <text key={r} x={-8} y={ch * (i + 0.5)} dy="0.35em" textAnchor="end" className="radar-axis-label">{r}</text>)}
          {!compact && data.cols.map((c, j) => <text key={c} x={cw * (j + 0.5)} y={-10} textAnchor="middle" className="radar-axis-label">{c}</text>)}
          {data.rows.map((r, i) => data.cols.map((c, j) => {
            const v = data.value(r, c)
            if (v == null) return null
            return <circle key={`${i}-${j}`} cx={cw * (j + 0.5)} cy={ch * (i + 0.5)} r={radius(v)} fill={params.color === 'value' ? ramp(0.15 + 0.85 * (v / maxV)) : ACCENT} fillOpacity={0.82} data-testid="punch-circle"
              onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{r} · {c}</b><br />{params.agg === 'mean' ? '평균' : '합계'} {fmt(v)}</>) }} onPointerLeave={hide} />
          }))}
        </g>
        {!compact && (
          <g transform={`translate(${width - m.r + 12},${m.t + 6})`}>
            <text y={-10} className="radar-level">면적 = 값</text>
            {[0.25, 0.6, 1].map((f, k) => {
              const lr = d3.scaleSqrt().domain([0, maxV]).range([0, Math.min(rMax, 24)])
              return <g key={f} transform={`translate(26,${k * 58 + 28})`}><circle r={lr(maxV * f)} fill="none" stroke="#9aa3ad" /><text x={34} dy="0.35em" className="radar-level">{fmt(maxV * f)}</text></g>
            })}
          </g>
        )}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function PunchControls({ params, setParams }: ControlsProps<PunchParams>) {
  return (
    <ControlGroup title="크기 인코딩">
      <Segmented label="집계" value={params.agg} onChange={(agg) => setParams({ agg })} options={[{ value: 'sum', label: '합계' }, { value: 'mean', label: '평균' }]} testId="ctl-agg" />
      <Slider label="원 최대 크기" value={params.max} min={0.4} max={1} step={0.05} onChange={(max) => setParams({ max })} format={(v) => v.toFixed(2)} testId="ctl-max" />
      <Segmented label="색" value={params.color} onChange={(color) => setParams({ color })} options={[{ value: 'single', label: '한 가지' }, { value: 'value', label: '값에 따라' }]} testId="ctl-color" />
      <Segmented label="정렬" value={params.sort} onChange={(sort) => setParams({ sort })} options={[{ value: 'none', label: '원래 순서' }, { value: 'total', label: '합계 큰 순' }]} testId="ctl-sort" />
      <Hint>원의 반지름이 아니라 면적이 값에 비례하도록 제곱근 척도를 씁니다. 히트맵의 색 농도 대신 크기로 읽으므로 값의 순서를 더 정확히 비교할 수 있습니다.</Hint>
    </ControlGroup>
  )
}

export const punchModule: VizModule<PunchParams> = {
  roles: [
    { key: 'row', label: '행 (범주)', type: 'category', required: true },
    { key: 'col', label: '열 (범주)', type: 'category', required: true },
    { key: 'value', label: '값 (원의 면적)', type: 'number', required: true },
  ],
  datasets: ['survey-cats', 'survey'],
  defaultParams: { agg: 'sum', color: 'single', palette: 'viridis', sort: 'none', max: 0.9 },
  Chart: PunchChart,
  Controls: PunchControls,
  hint: '원의 면적이 값에 비례합니다 · 정렬을 바꿔 패턴을 찾아보세요',
}
