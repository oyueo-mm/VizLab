import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber } from '../../data/table'
import { fmt } from '../../lib/format'
import { functionalBoxplot, lorenz, poissonPmf, rootogram, stemLeaf, sunflower, tornado } from '../../stats/stat10'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'

// ───────────────────────────── functional boxplot ─────────────────────────────

export interface FbParams { factor: number; showAll: boolean; selected: number }

function FbChart({ table, mapping, params, width, height, compact }: ChartProps<FbParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const data = useMemo(() => {
    const mi = columnIndex(table, roleColumn(mapping, 'member')), ti = columnIndex(table, roleColumn(mapping, 'time')), vi = columnIndex(table, roleColumn(mapping, 'value'))
    if (mi < 0 || ti < 0 || vi < 0) return null
    const times = [...new Set(table.rows.map((r) => toNumber(r[ti])).filter((v): v is number => v != null))].sort((a, b) => a - b)
    const by = new Map<string, Map<number, number>>()
    for (const r of table.rows) { const t = toNumber(r[ti]), v = toNumber(r[vi]); if (t != null && v != null) { const m = toLabel(r[mi]); if (!by.has(m)) by.set(m, new Map()); by.get(m)!.set(t, v) } }
    const names = [...by.keys()].filter((m) => times.every((t) => by.get(m)!.has(t)))
    if (names.length < 4 || times.length < 2) return null
    return { times, names, curves: names.map((m) => times.map((t) => by.get(m)!.get(t)!)) }
  }, [table, mapping])
  const fb = useMemo(() => (data ? functionalBoxplot(data.curves, params.factor) : null), [data, params.factor])
  if (!data || !fb) return <ChartMessage>멤버(범주), 시점, 값 열을 고르세요. 멤버마다 같은 시점의 값이 모두 있어야 하고 멤버가 4개 이상이어야 합니다.</ChartMessage>
  const pad = compact ? 6 : 34
  const all = data.curves.flat().concat(fb.fenceLo, fb.fenceHi)
  const sx = d3.scaleLinear().domain([data.times[0], data.times[data.times.length - 1]]).range([pad + 8, width - pad]), sy = d3.scaleLinear().domain(d3.extent(all) as [number, number]).nice().range([height - pad - (compact ? 0 : 14), pad])
  const line = (c: readonly number[]) => d3.line<number>().x((_, t) => sx(data.times[t])).y((v) => sy(v))(c as number[]) ?? ''
  const band = (lo: readonly number[], hi: readonly number[]) => d3.area<number>().x((_, t) => sx(data.times[t])).y0((_, t) => sy(lo[t])).y1((_, t) => sy(hi[t]))(lo as number[]) ?? ''
  const outl = new Set(fb.outliers)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`함수형 상자그림: 곡선 ${data.names.length}개, 이상 곡선 ${fb.outliers.length}개`} onPointerLeave={hide}>
        <path d={band(fb.fenceLo, fb.fenceHi)} fill="#eef3f3" data-testid="fb-fence" />
        {params.showAll && data.curves.map((c, i) => !outl.has(i) && <path key={i} d={line(c)} fill="none" stroke="#9aa6a6" strokeWidth={0.7} opacity={0.5} data-testid="fb-curve" />)}
        <path d={band(fb.lower, fb.upper)} fill="#2a8c82" fillOpacity={0.28} stroke="#2a8c82" strokeWidth={1} data-testid="fb-band" />
        {fb.outliers.map((i) => <path key={i} d={line(data.curves[i])} fill="none" stroke="#d4452f" strokeWidth={1.8} strokeDasharray="5 3" data-testid="fb-outlier" style={{ cursor: compact ? undefined : 'pointer' }}
          onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{data.names[i]}</b><br />이상 곡선(깊이 {fmt(fb.depth[i], 3)})</>) }} onPointerLeave={hide} />)}
        <path d={line(data.curves[fb.median])} fill="none" stroke="#1f2937" strokeWidth={2.4} data-testid="fb-median" />
        {params.selected >= 0 && params.selected < data.curves.length && <path d={line(data.curves[params.selected])} fill="none" stroke="#4c6fb5" strokeWidth={2.2} />}
        {!compact && <text x={pad} y={height - 6} fontSize={11} fill="#374151" data-testid="fb-readout">곡선 {data.names.length}개 · 중앙값(굵은 선) {data.names[fb.median]} · 이상 곡선 {fb.outliers.length}개 · 상자 = 가장 깊은 50%</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function FbControls({ params, setParams }: ControlsProps<FbParams>) {
  return (
    <ControlGroup title="울타리와 곡선">
      <Slider label="이상 판정 배율(상자 높이의 몇 배를 울타리로)" value={params.factor} min={0.5} max={3} step={0.1} onChange={(factor) => setParams({ factor })} format={(v) => v.toFixed(1)} testId="ctl-factor" />
      <Toggle label="모든 곡선 표시" checked={params.showAll} onChange={(showAll) => setParams({ showAll })} testId="ctl-showall" />
      <Hint>같은 시점축 위의 곡선 묶음(앙상블)을 한 장의 상자그림으로 요약합니다. 곡선마다 ‘다른 곡선 두 개가 만드는 띠 안에 있는 시점의 비율’을 평균한 수정 띠 깊이를 구해 깊은(중심에 가까운) 순서로 정렬하고, 가장 깊은 곡선이 중앙값, 가장 깊은 50%의 곡선이 덮는 영역이 상자(초록 띠), 상자 높이의 배율만큼 넓힌 영역이 울타리(연한 띠)입니다. 한 시점이라도 울타리를 벗어난 곡선이 이상 곡선(붉은 점선)입니다. 계산은 모든 곡선 쌍을 보는 O(n²·T)라 곡선 수가 수백 개를 넘으면 느립니다. 이 구현은 Sun·Genton의 수정 띠 깊이와 상자 구성을 따르며, 원 논문의 빠른 깊이 계산 알고리즘과 곡선의 부드러움을 고려한 확장은 구현하지 않았습니다.</Hint>
    </ControlGroup>
  )
}

export const fbModule: VizModule<FbParams> = {
  roles: [
    { key: 'member', label: '멤버(곡선)', type: 'category', required: true, prefer: '멤버|member' },
    { key: 'time', label: '시점', type: 'number', required: true, prefer: '시점|time' },
    { key: 'value', label: '값', type: 'number', required: true, prefer: '값|value' },
  ],
  datasets: ['ensemble-curves'],
  defaultParams: { factor: 1.5, showAll: true, selected: -1 },
  Chart: FbChart,
  Controls: FbControls,
  hint: '울타리 배율을 바꿔 이상 곡선이 달라지는 것을 봅니다 · 굵은 선은 가장 깊은 곡선(중앙값)',
}

// ───────────────────────────── stem-and-leaf ─────────────────────────────

export interface StemParams { unit: number; split: boolean }

const niceUnit = (range: number) => { for (const u of [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]) if (range / (u * 10) <= 16) return u; return 1000 }

function StemChart({ table, mapping, params, width, height, compact }: ChartProps<StemParams>) {
  const vals = useMemo(() => { const vi = columnIndex(table, roleColumn(mapping, 'value')); return vi < 0 ? null : table.rows.map((r) => toNumber(r[vi])).filter((v): v is number => v != null) }, [table, mapping])
  if (!vals || vals.length < 3) return <ChartMessage>값(숫자) 열을 고르세요.</ChartMessage>
  const unit = params.unit > 0 ? params.unit : niceUnit(Math.max(...vals) - Math.min(...vals))
  const { rows } = stemLeaf(vals, unit, params.split)
  const rowH = Math.max(7, Math.min(22, (height - 70) / rows.length)), fs = Math.min(15, rowH * 0.85)
  const cw = fs * 0.62
  const top = compact ? 10 : 34
  const stemW = String(Math.max(...rows.map((r) => Math.abs(r.stem)))).length + 2
  const ox = Math.max(12, (width - (stemW + Math.max(...rows.map((r) => r.leaves.length)) + 2) * cw) / 2)
  const fmtStem = (s: number) => String(Math.round(s * 10 * unit * 1e6) / 1e6)
  return (
    <div className="chart-root">
      <svg width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`줄기-잎 그림: 값 ${vals.length}개, 줄기 ${rows.length}줄`}>
        {!compact && <text x={ox} y={18} fontSize={12} fill="#6b7280" data-testid="stem-key">잎 한 칸 = {fmt(unit, 3)} · 예) {fmtStem(rows[Math.floor(rows.length / 2)].stem)}│{rows[Math.floor(rows.length / 2)].leaves[0] ?? 0} = {fmt((rows[Math.floor(rows.length / 2)].stem * 10 + (rows[Math.floor(rows.length / 2)].leaves[0] ?? 0)) * unit, 6)}</text>}
        {rows.map((r, i) => (
          <g key={i} data-testid="stem-row" data-count={r.leaves.length}>
            <text x={ox + stemW * cw} y={top + i * rowH + rowH * 0.8} fontSize={fs} fontFamily="monospace" textAnchor="end" fill="#374151">{fmtStem(r.stem)}</text>
            <line x1={ox + (stemW + 0.5) * cw} x2={ox + (stemW + 0.5) * cw} y1={top + i * rowH} y2={top + (i + 1) * rowH} stroke="#9aa6a6" />
            <text x={ox + (stemW + 1.5) * cw} y={top + i * rowH + rowH * 0.8} fontSize={fs} fontFamily="monospace" fill="#2a8c82" letterSpacing={cw * 0.4} data-testid="stem-leaves">{[...r.leaves].sort((a, b) => a - b).join('')}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}

function StemControls({ params, setParams }: ControlsProps<StemParams>) {
  return (
    <ControlGroup title="줄기와 잎">
      <Segmented label="잎 한 칸의 값" value={String(params.unit)} onChange={(v) => setParams({ unit: Number(v) })} testId="ctl-unit" options={[{ value: '0', label: '자동' }, { value: '0.1', label: '0.1' }, { value: '1', label: '1' }, { value: '10', label: '10' }]} />
      <Toggle label="줄기를 둘로 쪼개기(잎 0–4 / 5–9)" checked={params.split} onChange={(split) => setParams({ split })} testId="ctl-split" />
      <Hint>값을 ‘앞 자리(줄기)’와 ‘마지막 한 자리(잎)’로 나눠 줄기마다 잎을 가로로 늘어놓습니다. 막대 대신 숫자 자체를 쓰므로 분포의 모양(히스토그램)과 원래 값이 한꺼번에 보이고, 잎의 개수가 곧 막대 길이입니다. 두 봉우리가 있는 점수 분포라면 두 곳에서 잎이 길게 늘어섭니다. 값은 잎 한 칸의 값으로 반올림합니다(Tukey의 관례). 음수·소수는 줄기 숫자에 단위를 곱해 읽습니다.</Hint>
    </ControlGroup>
  )
}

export const stemModule: VizModule<StemParams> = {
  roles: [{ key: 'value', label: '값', type: 'number', required: true, prefer: '점수|값|value' }],
  datasets: ['exam-scores'],
  defaultParams: { unit: 0, split: true },
  Chart: StemChart,
  Controls: StemControls,
  hint: '잎 한 칸의 값을 바꾸고 줄기를 쪼개 분포의 모양이 어떻게 보이는지 확인합니다',
}

// ───────────────────────────── sunflower plot ─────────────────────────────

export interface SunParams { bins: number; petals: boolean }

function SunChart({ table, mapping, params, width, height, compact }: ChartProps<SunParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const pts = useMemo(() => {
    const xi = columnIndex(table, roleColumn(mapping, 'x')), yi = columnIndex(table, roleColumn(mapping, 'y'))
    if (xi < 0 || yi < 0) return null
    const out: [number, number][] = []
    for (const r of table.rows) { const x = toNumber(r[xi]), y = toNumber(r[yi]); if (x != null && y != null) out.push([x, y]) }
    return out.length >= 3 ? out : null
  }, [table, mapping])
  if (!pts) return <ChartMessage>x, y(숫자) 열을 고르세요.</ChartMessage>
  const ex = d3.extent(pts, (p) => p[0]) as [number, number], ey = d3.extent(pts, (p) => p[1]) as [number, number]
  const x: [number, number] = [ex[0] - 0.5, ex[1] + 0.5], y: [number, number] = [ey[0] - 0.5, ey[1] + 0.5]
  const bins: [number, number] = [params.bins > 0 ? params.bins : Math.round(ex[1] - ex[0]) + 1, params.bins > 0 ? params.bins : Math.round(ey[1] - ey[0]) + 1]
  const cells = sunflower(pts, x, y, bins)
  const pad = compact ? 6 : 34
  const sx = d3.scaleLinear().domain(x).range([pad, width - pad]), sy = d3.scaleLinear().domain(y).range([height - pad - (compact ? 0 : 12), pad])
  const cw = (width - 2 * pad) / bins[0], ch = (height - 2 * pad) / bins[1]
  const rr = Math.max(3, Math.min(cw, ch) * 0.42)
  const maxN = Math.max(...cells.map((c) => c.n))
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`선플라워 플롯: 관측 ${pts.length}개를 칸 ${cells.length}개로`} onPointerLeave={hide}>
        <rect x={pad} y={pad} width={width - 2 * pad} height={height - 2 * pad - (compact ? 0 : 12)} fill="#fafcfc" stroke="#e5eaea" />
        {cells.map((c, i) => {
          const cx = sx(c.x), cy = sy(c.y)
          const petals = params.petals ? Math.min(c.n, 60) : 0
          return (
            <g key={i} data-testid="sun-cell" data-n={c.n} onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>관측 {c.n}개</b><br />위치 ({fmt(c.x, 3)}, {fmt(c.y, 3)}) 칸</>) }} onPointerLeave={hide}>
              {c.n > 1 && Array.from({ length: petals }, (_, k) => { const a = (k / petals) * Math.PI * 2; return <line key={k} x1={cx} y1={cy} x2={cx + Math.cos(a) * rr * (0.55 + 0.45 * Math.min(1, c.n / maxN)) } y2={cy + Math.sin(a) * rr * (0.55 + 0.45 * Math.min(1, c.n / maxN))} stroke="#e07a3f" strokeWidth={1.2} /> })}
              <circle cx={cx} cy={cy} r={c.n > 1 ? Math.max(2.4, rr * 0.18) : Math.max(1.6, rr * 0.16)} fill={c.n > 1 ? '#d4452f' : '#2a8c82'} />
              {!params.petals && c.n > 1 && !compact && <text x={cx} y={cy - rr * 0.5} textAnchor="middle" fontSize={Math.min(11, rr * 0.7)} fill="#374151">{c.n}</text>}
            </g>
          )
        })}
        {!compact && <text x={pad} y={height - 6} fontSize={11} fill="#6b7280" data-testid="sun-readout">관측 {pts.length}개 → 칸 {cells.length}개 · 한 칸의 최대 {maxN}개 · 꽃잎 하나 = 관측 하나(한 칸 최대 60장까지)</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function SunControls({ params, setParams }: ControlsProps<SunParams>) {
  return (
    <ControlGroup title="칸과 꽃잎">
      <Slider label="한 축을 나누는 칸 수 (0이면 정수 값마다 한 칸)" value={params.bins} min={0} max={30} onChange={(bins) => setParams({ bins })} testId="ctl-bins" />
      <Toggle label="꽃잎으로 표시(끄면 개수 숫자)" checked={params.petals} onChange={(petals) => setParams({ petals })} testId="ctl-petals" />
      <Hint>같은 칸에 겹친 관측을 점 하나로 그리면 겹친 개수를 알 수 없습니다. 선플라워 플롯은 칸마다 관측 수만큼의 꽃잎(방사선)을 가진 해바라기 하나를 그려, 겹친 정도가 꽃잎의 수와 밀도로 보이게 합니다. 하나뿐인 관측은 초록 점, 겹친 칸은 붉은 중심에 주황 꽃잎입니다. 칸의 모양과 위치는 데이터 값을 칸 가운데로 모은 것이며 칸 안의 정확한 위치는 잃습니다. 원 논문(Cleveland·McGill 1984)의 꽃잎 하나가 관측 n개를 뜻하는 변형은 구현하지 않았습니다.</Hint>
    </ControlGroup>
  )
}

export const sunModule: VizModule<SunParams> = {
  roles: [
    { key: 'x', label: 'x', type: 'number', required: true, prefer: '만족도|x' },
    { key: 'y', label: 'y', type: 'number', required: true, prefer: '추천|y' },
  ],
  datasets: ['discrete-pairs'],
  defaultParams: { bins: 0, petals: true },
  Chart: SunChart,
  Controls: SunControls,
  hint: '칸에 올리면 겹친 관측 수를 확인합니다 · 칸 수를 바꿔 겹침이 어떻게 달라지는지 봅니다',
}

// ───────────────────────────── hanging rootogram ─────────────────────────────

export interface RootParams { hanging: boolean; maxK: number }

function RootChart({ table, mapping, params, width, height, compact }: ChartProps<RootParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const counts = useMemo(() => { const vi = columnIndex(table, roleColumn(mapping, 'count')); return vi < 0 ? null : table.rows.map((r) => toNumber(r[vi])).filter((v): v is number => v != null && v >= 0 && Number.isInteger(v)) }, [table, mapping])
  if (!counts || counts.length < 5) return <ChartMessage>사건 수(0 이상의 정수) 열을 고르세요.</ChartMessage>
  const K = Math.min(params.maxK, Math.max(...counts))
  const obs = Array.from({ length: K + 1 }, (_, k) => counts.filter((c) => c === k).length)
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length
  const exp = poissonPmf(mean, K).map((p) => p * counts.length)
  const bars = rootogram(obs, exp)
  const pad = compact ? 6 : 38
  const ymin = Math.min(0, ...bars.map((b) => b.bottom)), ymax = Math.max(...bars.map((b) => Math.max(b.top, Math.sqrt(b.observed))))
  const sx = d3.scaleBand<number>().domain(bars.map((b) => b.k)).range([pad, width - pad]).padding(0.15), sy = d3.scaleLinear().domain([ymin * 1.05, ymax * 1.05]).range([height - pad - (compact ? 0 : 12), pad])
  const tail = counts.filter((c) => c > K).length
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`걸린 루트그램: 평균 ${fmt(mean, 3)}의 포아송 적합과 관측`} onPointerLeave={hide}>
        <line x1={pad} x2={width - pad} y1={sy(0)} y2={sy(0)} stroke="#6b7280" />
        {bars.map((b) => (
          <rect key={b.k} x={sx(b.k)} y={params.hanging ? sy(b.top) : sy(Math.sqrt(b.observed))} width={sx.bandwidth()} height={Math.abs(params.hanging ? sy(b.bottom) - sy(b.top) : sy(0) - sy(Math.sqrt(b.observed)))} fill={params.hanging && b.bottom < -1e-9 ? '#e07a3f' : '#4c6fb5'} fillOpacity={0.75} data-testid="root-bar" data-k={b.k} data-bottom={b.bottom.toFixed(3)}
            onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{b.k}회</b><br />관측 {b.observed}명 · 기대 {fmt(b.expected, 3)}명<br />{b.bottom < 0 ? '관측이 기대보다 많음(0선 아래)' : b.bottom > 0 ? '관측이 기대보다 적음(0선 위)' : '일치'}</>) }} onPointerLeave={hide} />
        ))}
        <path d={d3.line<number>().x((_, i) => (sx(bars[i].k) ?? 0) + sx.bandwidth() / 2).y((_, i) => sy(bars[i].top))(bars.map((b) => b.top)) ?? ''} fill="none" stroke="#d4452f" strokeWidth={2} data-testid="root-curve" />
        {!compact && bars.map((b) => <text key={b.k} x={(sx(b.k) ?? 0) + sx.bandwidth() / 2} y={height - 18} textAnchor="middle" fontSize={10} fill="#6b7280">{b.k}</text>)}
        {!compact && <text x={pad} y={height - 4} fontSize={11} fill="#374151" data-testid="root-readout">평균 {fmt(mean, 3)} · 개체 {counts.length}명{tail ? ` · ${K}회 초과 ${tail}명은 표시하지 않음` : ''} · 세로축은 제곱근 눈금</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function RootControls({ params, setParams }: ControlsProps<RootParams>) {
  return (
    <ControlGroup title="루트그램">
      <Segmented label="막대" value={params.hanging ? 'hang' : 'stand'} onChange={(v) => setParams({ hanging: v === 'hang' })} testId="ctl-hanging" options={[{ value: 'hang', label: '걸린(기대 곡선에 매달림)' }, { value: 'stand', label: '선(0에서 올라감)' }]} />
      <Slider label="표시할 최대 횟수" value={params.maxK} min={4} max={30} onChange={(maxK) => setParams({ maxK })} testId="ctl-maxk" />
      <Hint>관측한 빈도 막대를 포아송 분포의 기대 빈도 곡선(붉은 선)에 매달고 제곱근 눈금으로 그립니다. 모형이 잘 맞으면 막대 끝이 모두 0선에 닿고, 0선 아래로 삐져나온(주황) 막대는 관측이 기대보다 많은 횟수, 0선 위에서 멈춘 막대는 기대보다 적은 횟수입니다. 제곱근 눈금은 빈도가 작은 꼬리에서도 편차를 같은 눈으로 비교하게 해 줍니다(분산 안정화). 과분산된 자료는 0과 큰 횟수에서 막대가 0선 아래로 내려갑니다. 이 구현은 평균 하나로 적합한 포아송 모형만 쓰며 회귀 모형(음이항·허들)의 기대 빈도는 계산하지 않습니다.</Hint>
    </ControlGroup>
  )
}

export const rootModule: VizModule<RootParams> = {
  roles: [{ key: 'count', label: '사건 수 (0 이상의 정수)', type: 'number', required: true, prefer: '사건|횟수|count' }],
  datasets: ['count-data'],
  defaultParams: { hanging: true, maxK: 12 },
  Chart: RootChart,
  Controls: RootControls,
  hint: '막대가 0선 아래로 내려간 횟수가 포아송 모형이 과소 예측한 곳입니다',
}

// ───────────────────────────── Lorenz curve ─────────────────────────────

export interface LorenzParams { deciles: boolean; fill: boolean }

function LorenzChart({ table, mapping, params, width, height, compact }: ChartProps<LorenzParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const vals = useMemo(() => { const vi = columnIndex(table, roleColumn(mapping, 'value')); return vi < 0 ? null : table.rows.map((r) => toNumber(r[vi])).filter((v): v is number => v != null && v >= 0) }, [table, mapping])
  if (!vals || vals.length < 3) return <ChartMessage>값(0 이상의 숫자) 열을 고르세요.</ChartMessage>
  const l = lorenz(vals)
  const pad = compact ? 6 : 40
  const side = Math.min(width, height) - 2 * pad - (compact ? 0 : 10)
  const ox = (width - side) / 2, oy = pad
  const X = (v: number) => ox + v * side, Y = (v: number) => oy + side - v * side
  const dec = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((p) => { const k = Math.round(p * (l.points.length - 1)); return l.points[k] })
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`로렌츠 곡선: 지니계수 ${fmt(l.gini, 3)}`} onPointerLeave={hide}>
        <rect x={ox} y={oy} width={side} height={side} fill="#fafcfc" stroke="#dbe3e3" />
        {params.fill && <path d={`M${X(0)},${Y(0)}L${X(1)},${Y(1)}` + [...l.points].reverse().map((p) => `L${X(p[0])},${Y(p[1])}`).join('') + 'Z'} fill="#e07a3f" fillOpacity={0.22} data-testid="lorenz-area" />}
        <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} stroke="#6b7280" strokeDasharray="5 4" />
        <path d={'M' + l.points.map((p) => `${X(p[0])},${Y(p[1])}`).join('L')} fill="none" stroke="#d4452f" strokeWidth={2.4} data-testid="lorenz-curve" />
        {params.deciles && !compact && dec.map((p, i) => <circle key={i} cx={X(p[0])} cy={Y(p[1])} r={4.5} fill="#fff" stroke="#d4452f" strokeWidth={2} data-testid="lorenz-decile"
          onPointerEnter={(e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <>아래 <b>{Math.round(p[0] * 100)}%</b> 가구가 전체 소득의 <b>{fmt(p[1] * 100, 3)}%</b>를 가짐</>) }} onPointerLeave={hide} />)}
        {!compact && <text x={ox} y={oy + side + 20} fontSize={11} fill="#6b7280">누적 인구 비율(소득이 낮은 순) →</text>}
        {!compact && <text x={ox + 8} y={oy + 16} fontSize={13} fontWeight={700} fill="#d4452f" data-testid="lorenz-gini">지니계수 {fmt(l.gini, 3)}</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function LorenzControls({ params, setParams }: ControlsProps<LorenzParams>) {
  return (
    <ControlGroup title="로렌츠 곡선">
      <Toggle label="10분위 점 표시" checked={params.deciles} onChange={(deciles) => setParams({ deciles })} testId="ctl-deciles" />
      <Toggle label="불평등 면적 칠하기" checked={params.fill} onChange={(fill) => setParams({ fill })} testId="ctl-fill" />
      <Hint>값(소득)이 낮은 대상부터 줄을 세워 ‘누적 인구 비율’(가로)에 대한 ‘누적 값 비율’(세로)을 이은 곡선입니다. 모두 같으면 대각선(완전 평등)과 겹치고, 불평등할수록 아래로 처집니다. 대각선과 곡선 사이 면적의 두 배가 지니계수(0 = 완전 평등, 1에 가까울수록 한 사람이 거의 다 가짐)입니다. 곡선의 모양으로 불평등이 어느 구간(하위층의 몫, 상위의 집중)에서 생기는지 읽을 수 있습니다. 표본 지니계수이며 신뢰구간은 계산하지 않습니다.</Hint>
    </ControlGroup>
  )
}

export const lorenzModule: VizModule<LorenzParams> = {
  roles: [{ key: 'value', label: '값 (소득 등)', type: 'number', required: true, prefer: '소득|값|value' }],
  datasets: ['income-dist'],
  defaultParams: { deciles: true, fill: true },
  Chart: LorenzChart,
  Controls: LorenzControls,
  hint: '10분위 점에 올려 아래쪽 몇 %가 전체의 몇 %를 갖는지 읽습니다',
}

// ───────────────────────────── tornado chart ─────────────────────────────

export interface TornadoParams { sorted: boolean }

function TornadoChart({ table, mapping, params, width, height, compact }: ChartProps<TornadoParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const data = useMemo(() => {
    const ni = columnIndex(table, roleColumn(mapping, 'name')), li = columnIndex(table, roleColumn(mapping, 'low')), hi = columnIndex(table, roleColumn(mapping, 'high')), bi = columnIndex(table, roleColumn(mapping, 'base'))
    if (ni < 0 || li < 0 || hi < 0) return null
    const rows = table.rows.map((r) => ({ name: toLabel(r[ni]), low: toNumber(r[li]), high: toNumber(r[hi]), base: bi >= 0 ? toNumber(r[bi]) : null })).filter((r): r is { name: string; low: number; high: number; base: number | null } => r.low != null && r.high != null)
    if (rows.length < 2) return null
    const base = rows.find((r) => r.base != null)?.base ?? (rows.reduce((a, r) => a + (r.low + r.high) / 2, 0) / rows.length)
    return { base, bars: tornado(base, params.sorted ? rows : rows.map((r) => r)) , raw: rows }
  }, [table, mapping, params.sorted])
  if (!data) return <ChartMessage>변수 이름, 낮은 값 결과, 높은 값 결과 열을 고르세요(기준 열은 선택).</ChartMessage>
  const bars = params.sorted ? data.bars : data.raw.map((r) => ({ ...r, dLow: r.low - data.base, dHigh: r.high - data.base, swing: Math.abs(r.high - r.low) }))
  const pad = compact ? 6 : 34, left = compact ? 6 : 110
  const lo = Math.min(...bars.flatMap((b) => [b.low, b.high]), data.base), hi = Math.max(...bars.flatMap((b) => [b.low, b.high]), data.base)
  const sx = d3.scaleLinear().domain([lo, hi]).nice().range([left, width - pad])
  const rowH = Math.min(34, (height - pad - 30) / bars.length)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`토네이도 차트: 변수 ${bars.length}개, 기준 ${fmt(data.base, 4)}`} onPointerLeave={hide}>
        {bars.map((b, i) => {
          const y = 24 + i * rowH
          const segs = [{ from: data.base, to: b.low, c: '#4c6fb5', t: '낮은 값' }, { from: data.base, to: b.high, c: '#e07a3f', t: '높은 값' }]
          return (
            <g key={b.name} data-testid="tornado-bar" data-swing={b.swing.toFixed(2)}>
              {!compact && <text x={left - 8} y={y + rowH / 2} dy="0.34em" textAnchor="end" fontSize={Math.min(12, rowH - 2)} fill="#374151">{b.name}</text>}
              {segs.map((s) => <rect key={s.t} x={Math.min(sx(s.from), sx(s.to))} y={y + 2} width={Math.abs(sx(s.to) - sx(s.from))} height={Math.max(2, rowH - 6)} fill={s.c} opacity={0.85}
                onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{b.name}</b> · {s.t}<br />결과 {fmt(s.to, 4)} (기준 대비 {s.to - data.base >= 0 ? '+' : ''}{fmt(s.to - data.base, 4)})</>) }} onPointerLeave={hide} />)}
            </g>
          )
        })}
        <line x1={sx(data.base)} x2={sx(data.base)} y1={18} y2={24 + bars.length * rowH} stroke="#1f2937" strokeWidth={1.4} />
        {!compact && <text x={sx(data.base)} y={14} textAnchor="middle" fontSize={11} fill="#374151">기준 {fmt(data.base, 4)}</text>}
        {!compact && sx.ticks(6).map((t) => <text key={t} x={sx(t)} y={height - 8} textAnchor="middle" fontSize={10} fill="#9aa6a6">{t}</text>)}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function TornadoControls({ params, setParams }: ControlsProps<TornadoParams>) {
  return (
    <ControlGroup title="정렬">
      <Toggle label="영향이 큰 변수부터 정렬" checked={params.sorted} onChange={(sorted) => setParams({ sorted })} testId="ctl-sorted" />
      <Hint>모형의 입력 변수를 하나씩만 낮은 값·높은 값으로 바꿨을 때 결과가 기준에서 얼마나 달라지는지를 기준선 양옆의 막대로 그립니다(파랑 = 낮은 값, 주황 = 높은 값). 영향이 큰 변수 순으로 쌓으면 막대 모양이 회오리(토네이도)처럼 위가 넓고 아래가 좁아져, 결과를 좌우하는 변수를 한눈에 찾습니다. 한 번에 한 변수만 바꾸므로 변수 사이의 상호작용은 반영되지 않습니다.</Hint>
    </ControlGroup>
  )
}

export const tornadoModule: VizModule<TornadoParams> = {
  roles: [
    { key: 'name', label: '변수', type: 'category', required: true, prefer: '변수|name' },
    { key: 'low', label: '낮은 값 결과', type: 'number', required: true, prefer: '낮은|low' },
    { key: 'high', label: '높은 값 결과', type: 'number', required: true, prefer: '높은|high' },
    { key: 'base', label: '기준 결과', type: 'number', auto: true, prefer: '기준|base' },
  ],
  datasets: ['sensitivity'],
  defaultParams: { sorted: true },
  Chart: TornadoChart,
  Controls: TornadoControls,
  hint: '막대가 긴 변수가 결과를 가장 크게 좌우합니다 · 정렬을 끄면 입력 순서로 봅니다',
}
