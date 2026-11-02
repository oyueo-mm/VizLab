import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber } from '../../data/table'
import { fmt } from '../../lib/format'
import { bagplot, decisionCurve, divergingBars } from '../../stats/stat10b'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'

// ───────────────────────────── bagplot ─────────────────────────────

export interface BagParams { factor: number; showFence: boolean }

function BagChart({ table, mapping, params, width, height, compact }: ChartProps<BagParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const pts = useMemo(() => {
    const xi = columnIndex(table, roleColumn(mapping, 'x')), yi = columnIndex(table, roleColumn(mapping, 'y'))
    if (xi < 0 || yi < 0) return null
    const p = table.rows.map((r) => [toNumber(r[xi]), toNumber(r[yi])] as const).filter((q): q is readonly [number, number] => q[0] != null && q[1] != null)
    return p.length >= 8 ? p.map((q) => [q[0], q[1]] as [number, number]) : null
  }, [table, mapping])
  const bp = useMemo(() => (pts ? bagplot(pts, params.factor) : null), [pts, params.factor])
  if (!pts || !bp) return <ChartMessage>숫자 열 X, Y를 고르세요(점 8개 이상).</ChartMessage>
  const pad = compact ? 6 : 36
  const allX = [...pts.map((p) => p[0]), ...(params.showFence ? bp.fence.map((p) => p[0]) : [])], allY = [...pts.map((p) => p[1]), ...(params.showFence ? bp.fence.map((p) => p[1]) : [])]
  const sx = d3.scaleLinear().domain(d3.extent(allX) as [number, number]).nice().range([pad, width - pad])
  const sy = d3.scaleLinear().domain(d3.extent(allY) as [number, number]).nice().range([height - pad, pad])
  const poly = (ring: [number, number][]) => 'M' + ring.map(([x, y]) => `${sx(x)},${sy(y)}`).join('L') + 'Z'
  const out = new Set(bp.outliers)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`백플롯: 점 ${pts.length}개, 이상점 ${bp.outliers.length}개`} onPointerLeave={hide}>
        {params.showFence && <path d={poly(bp.fence)} fill="#e8f1ee" stroke="#9fc4b8" strokeDasharray="4 3" data-testid="bag-fence" />}
        <path d={poly(bp.bag)} fill="#a9d3c4" fillOpacity={0.75} stroke="#3f8f78" strokeWidth={1.4} data-testid="bag-bag" />
        {pts.map((p, i) => (
          <circle key={i} cx={sx(p[0])} cy={sy(p[1])} r={out.has(i) ? 4 : 2.6} fill={out.has(i) ? '#d4452f' : '#3b4a52'} fillOpacity={out.has(i) ? 1 : 0.7} data-testid={out.has(i) ? 'bag-outlier' : 'bag-point'}
            onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <>점 {i + 1} · 깊이 <b>{bp.depth[i]}</b> / {pts.length}<br />{out.has(i) ? '울타리 밖 (이상점)' : '울타리 안'}</>) }} onPointerLeave={hide} />
        ))}
        <g data-testid="bag-center"><circle cx={sx(bp.center[0])} cy={sy(bp.center[1])} r={5.5} fill="#fff" stroke="#1f2937" strokeWidth={2} /><line x1={sx(bp.center[0]) - 8} x2={sx(bp.center[0]) + 8} y1={sy(bp.center[1])} y2={sy(bp.center[1])} stroke="#1f2937" /><line y1={sy(bp.center[1]) - 8} y2={sy(bp.center[1]) + 8} x1={sx(bp.center[0])} x2={sx(bp.center[0])} stroke="#1f2937" /></g>
        {!compact && <text x={pad} y={14} fontSize={11} fill="#374151" data-testid="bag-summary">가방 = 깊이가 큰 쪽 절반 · 이상점 {bp.outliers.length}개</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function BagControls({ params, setParams }: ControlsProps<BagParams>) {
  return (
    <ControlGroup title="백플롯">
      <Slider label="울타리 배율(중심에서 가방을 몇 배로 부풀릴지)" value={params.factor} min={1.5} max={4} step={0.5} onChange={(factor) => setParams({ factor })} format={(v) => v.toFixed(1)} testId="ctl-factor" />
      <Toggle label="울타리 표시" checked={params.showFence} onChange={(showFence) => setParams({ showFence })} testId="ctl-fence" />
      <Hint>이변량 상자그림입니다. 점마다 ‘그 점을 지나는 직선이 나누는 반평면 중 점이 더 적은 쪽의 점 수’(반공간 깊이)를 구해 깊은 점일수록 중심에 가깝다고 봅니다. 가장 깊은 점들의 평균이 중심(십자), 깊이가 큰 쪽 절반 점의 볼록 껍질이 가방, 중심에서 가방을 배율만큼 부풀린 것이 울타리이며 울타리 밖의 점(붉은색)이 이상점입니다. 이 구현은 점에서의 깊이를 360개 방향으로 근사하고, 가방을 정확한 깊이 윤곽 대신 점들의 껍질로 둡니다.</Hint>
    </ControlGroup>
  )
}

export const bagModule: VizModule<BagParams> = {
  roles: [
    { key: 'x', label: 'X (숫자)', type: 'number', required: true, prefer: 'X|x' },
    { key: 'y', label: 'Y (숫자)', type: 'number', required: true, prefer: 'Y|y' },
  ],
  datasets: ['bag-points'],
  defaultParams: { factor: 3, showFence: true },
  Chart: BagChart,
  Controls: BagControls,
  hint: '점에 올려 깊이를 읽습니다 · 울타리 배율을 바꾸면 이상점 판정이 달라집니다',
}

// ───────────────────────────── diverging stacked bar ─────────────────────────────

export interface DivParams { sorted: boolean; percent: boolean }

const DIV_COLORS = ['#b2182b', '#ef8a62', '#d9d9d9', '#67a9cf', '#2166ac']

function DivChart({ table, mapping, params, width, height, compact }: ChartProps<DivParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const items = useMemo(() => {
    const ii = columnIndex(table, roleColumn(mapping, 'item')), li = columnIndex(table, roleColumn(mapping, 'level')), ci = columnIndex(table, roleColumn(mapping, 'count'))
    if (ii < 0 || li < 0 || ci < 0) return null
    const levels = [...new Set(table.rows.map((r) => toNumber(r[li])).filter((v): v is number => v != null))].sort((a, b) => a - b)
    if (levels.length < 3 || levels.length > 9) return null
    const by = new Map<string, number[]>()
    for (const r of table.rows) { const l = toNumber(r[li]), c = toNumber(r[ci]); if (l == null || c == null) continue; const k = toLabel(r[ii]); if (!by.has(k)) by.set(k, levels.map(() => 0)); by.get(k)![levels.indexOf(l)] += c }
    return { levels, rows: [...by.entries()].map(([name, counts]) => ({ name, counts })) }
  }, [table, mapping])
  const bars = useMemo(() => {
    if (!items) return null
    const b = divergingBars(items.rows)
    return params.sorted ? [...b].sort((p, q) => q.positive - p.positive) : b
  }, [items, params.sorted])
  if (!items || !bars) return <ChartMessage>문항, 응답 단계(3~9단계), 응답 수 열을 고르세요.</ChartMessage>
  const L = items.levels.length
  const color = (l: number) => (L === 5 ? DIV_COLORS[l] : d3.interpolateRdBu(l / (L - 1)))
  const left = compact ? 6 : 96, pad = compact ? 6 : 28
  const maxSide = Math.max(...bars.map((b) => Math.max(b.negative + b.neutral / 2, b.positive + b.neutral / 2)))
  const lim = params.percent ? 100 : Math.max(10, Math.ceil(maxSide / 10) * 10)
  const sx = d3.scaleLinear().domain([-lim, lim]).range([left, width - pad])
  const rowH = Math.min(34, (height - pad - 18) / bars.length)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`발산형 쌓은 막대: 문항 ${bars.length}개, 응답 ${L}단계`} onPointerLeave={hide}>
        {bars.map((b, i) => {
          const y = 18 + i * rowH
          return (
            <g key={b.name} data-testid="div-bar" data-positive={b.positive.toFixed(1)}>
              {!compact && <text x={left - 8} y={y + rowH / 2} dy="0.34em" textAnchor="end" fontSize={Math.min(12, rowH - 2)} fill="#374151">{b.name}</text>}
              {b.shares.map((s, l) => (
                <rect key={l} x={sx(b.starts[l])} y={y + 2} width={Math.max(0, sx(b.starts[l] + s) - sx(b.starts[l]))} height={Math.max(2, rowH - 6)} fill={color(l)}
                  onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{b.name}</b> · 응답 {items.levels[l]}단계<br />{fmt(s, 3)}% (부정 {fmt(b.negative, 3)}% · 긍정 {fmt(b.positive, 3)}%)</>) }} onPointerLeave={hide} />
              ))}
            </g>
          )
        })}
        <line x1={sx(0)} x2={sx(0)} y1={12} y2={18 + bars.length * rowH} stroke="#1f2937" strokeWidth={1.4} />
        {!compact && sx.ticks(8).map((t) => <text key={t} x={sx(t)} y={height - 8} textAnchor="middle" fontSize={10} fill="#9aa6a6">{Math.abs(t)}%</text>)}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function DivControls({ params, setParams }: ControlsProps<DivParams>) {
  return (
    <ControlGroup title="발산형 쌓은 막대">
      <Toggle label="긍정 응답이 많은 문항부터 정렬" checked={params.sorted} onChange={(sorted) => setParams({ sorted })} testId="ctl-sorted" />
      <Toggle label="가로 범위를 100%로 고정" checked={params.percent} onChange={(percent) => setParams({ percent })} testId="ctl-percent" />
      <Hint>리커트 척도처럼 순서가 있는 응답의 비율을 한 줄에 쌓되, 가운데 응답을 0선에 걸치고 부정은 왼쪽, 긍정은 오른쪽으로 뻗게 합니다. 일반 쌓은 막대는 단계마다 시작점이 달라 비교가 어렵지만 여기서는 0선이 공통 기준이어서 긍정·부정의 균형이 바로 보입니다. 짝수 단계라면 가운데 경계를 0선으로 삼습니다.</Hint>
    </ControlGroup>
  )
}

export const divModule: VizModule<DivParams> = {
  roles: [
    { key: 'item', label: '문항', type: 'category', required: true, prefer: '문항|item' },
    { key: 'level', label: '응답 단계', type: 'number', required: true, prefer: '단계|level' },
    { key: 'count', label: '응답 수', type: 'number', required: true, prefer: '응답 수|count' },
  ],
  datasets: ['likert-survey'],
  defaultParams: { sorted: true, percent: false },
  Chart: DivChart,
  Controls: DivControls,
  hint: '조각에 올려 비율을 읽습니다 · 0선에서 오른쪽으로 길수록 긍정 응답이 많습니다',
}

// ───────────────────────────── decision curve ─────────────────────────────

export interface DcaParams { maxThreshold: number; showB: boolean }

function DcaChart({ table, mapping, params, width, height, compact }: ChartProps<DcaParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const data = useMemo(() => {
    const oi = columnIndex(table, roleColumn(mapping, 'outcome')), ai = columnIndex(table, roleColumn(mapping, 'riskA')), bi = columnIndex(table, roleColumn(mapping, 'riskB'))
    if (oi < 0 || ai < 0) return null
    const rows = table.rows.map((r) => ({ o: toNumber(r[oi]), a: toNumber(r[ai]), b: bi >= 0 ? toNumber(r[bi]) : null })).filter((r): r is { o: number; a: number; b: number | null } => (r.o === 0 || r.o === 1) && r.a != null)
    return rows.length >= 20 && rows.some((r) => r.o === 1) && rows.some((r) => r.o === 0) ? rows : null
  }, [table, mapping])
  const curves = useMemo(() => {
    if (!data) return null
    const ts = Array.from({ length: 98 }, (_, k) => 0.01 * (k + 1)).filter((t) => t <= params.maxThreshold + 1e-9)
    const o = data.map((r) => r.o)
    const a = decisionCurve(o, data.map((r) => r.a), ts)
    const hasB = data.every((r) => r.b != null)
    return { a, b: hasB ? decisionCurve(o, data.map((r) => r.b as number), ts) : null, prev: o.reduce((s, v) => s + v, 0) / o.length }
  }, [data, params.maxThreshold])
  if (!data || !curves) return <ChartMessage>결과(0/1)와 예측 위험(0~1) 열을 고르세요(환자 20명 이상).</ChartMessage>
  const pad = compact ? 6 : 40
  const ys = [...curves.a.flatMap((p) => [p.model, p.all]), ...(curves.b && params.showB ? curves.b.map((p) => p.model) : []), 0]
  const sx = d3.scaleLinear().domain([0, params.maxThreshold]).range([pad + 6, width - pad])
  const sy = d3.scaleLinear().domain([Math.max(-0.05, d3.min(ys)!), d3.max(ys)! * 1.05]).range([height - pad, pad])
  const line = (pts: { threshold: number; v: number }[]) => 'M' + pts.map((p) => `${sx(p.threshold)},${sy(Math.max(sy.domain()[0], p.v))}`).join('L')
  const L = [
    { key: 'all', label: '모두 치료', color: '#8f98a3', dash: '5 4', pts: curves.a.map((p) => ({ threshold: p.threshold, v: p.all })) },
    { key: 'none', label: '아무도 치료하지 않음', color: '#1f2937', dash: '', pts: curves.a.map((p) => ({ threshold: p.threshold, v: 0 })) },
    { key: 'A', label: '모형 A', color: '#d4452f', dash: '', pts: curves.a.map((p) => ({ threshold: p.threshold, v: p.model })) },
    ...(curves.b && params.showB ? [{ key: 'B', label: '모형 B', color: '#4c6fb5', dash: '', pts: curves.b.map((p) => ({ threshold: p.threshold, v: p.model })) }] : []),
  ]
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`결정 곡선: 임계 확률 0~${params.maxThreshold}에서 순이득 비교`} onPointerLeave={hide}>
        {L.map((c) => <path key={c.key} d={line(c.pts)} fill="none" stroke={c.color} strokeWidth={c.key === 'A' || c.key === 'B' ? 2.4 : 1.6} strokeDasharray={c.dash} data-testid={`dca-${c.key}`} />)}
        <rect x={pad + 6} y={pad} width={width - 2 * pad - 6} height={height - 2 * pad} fill="transparent"
          onPointerMove={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); const t = Math.round(sx.invert(lp.x) * 100) / 100; const k = curves.a.findIndex((p) => Math.abs(p.threshold - t) < 0.005); if (k < 0) return
            show(lp.x, lp.y, <>임계 확률 <b>{Math.round(t * 100)}%</b><br />모두 치료 {fmt(curves.a[k].all, 3)}<br />모형 A {fmt(curves.a[k].model, 3)}{curves.b && params.showB && <><br />모형 B {fmt(curves.b[k].model, 3)}</>}</>) }} onPointerLeave={hide} />
        {!compact && sy.ticks(5).map((t) => <text key={t} x={pad} y={sy(t)} dy="0.32em" textAnchor="end" fontSize={10} fill="#9aa6a6">{fmt(t, 2)}</text>)}
        {!compact && sx.ticks(6).map((t) => <text key={t} x={sx(t)} y={height - pad + 16} textAnchor="middle" fontSize={10} fill="#9aa6a6">{Math.round(t * 100)}%</text>)}
        {!compact && L.map((c, i) => <g key={c.key}><line x1={pad + 14} x2={pad + 34} y1={pad + 8 + i * 15} y2={pad + 8 + i * 15} stroke={c.color} strokeWidth={2} strokeDasharray={c.dash} /><text x={pad + 40} y={pad + 8 + i * 15} dy="0.34em" fontSize={11} fill="#374151">{c.label}</text></g>)}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function DcaControls({ params, setParams }: ControlsProps<DcaParams>) {
  return (
    <ControlGroup title="결정 곡선">
      <Slider label="임계 확률의 최댓값" value={params.maxThreshold} min={0.2} max={0.9} step={0.05} onChange={(maxThreshold) => setParams({ maxThreshold })} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-maxt" />
      <Toggle label="모형 B 표시" checked={params.showB} onChange={(showB) => setParams({ showB })} testId="ctl-showb" />
      <Hint>예측 모형으로 ‘위험이 임계 확률 이상이면 치료(개입)한다’고 했을 때의 순이득 = (참양성 수 − 거짓양성 수 × t/(1−t)) / 전체를 임계 확률 t마다 그린 곡선입니다. 가중치 t/(1−t)는 거짓양성 한 건이 참양성 한 건에 비해 얼마나 해로운지에 대한 판단을 임계 확률로 나타낸 것입니다. 곡선이 ‘모두 치료’와 ‘아무도 치료하지 않음(0)’ 선보다 위인 구간에서 모형이 유용하고, 그 구간에서 가장 높은 곡선이 가장 이득이 큽니다. 표본 자료로 계산한 점추정이며 신뢰구간은 그리지 않습니다.</Hint>
    </ControlGroup>
  )
}

export const dcaModule: VizModule<DcaParams> = {
  roles: [
    { key: 'outcome', label: '결과 (0/1)', type: 'number', required: true, prefer: '결과|outcome' },
    { key: 'riskA', label: '예측 위험 A', type: 'number', required: true, prefer: '모형 A|A' },
    { key: 'riskB', label: '예측 위험 B', type: 'number', auto: true, prefer: '모형 B|B' },
  ],
  datasets: ['risk-prediction'],
  defaultParams: { maxThreshold: 0.6, showB: true },
  Chart: DcaChart,
  Controls: DcaControls,
  hint: '곡선 위를 지나가며 임계 확률별 순이득을 읽습니다 · 가장 위의 곡선이 그 구간의 최선',
}
