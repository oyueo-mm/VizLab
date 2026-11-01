import * as d3 from 'd3'
import { useMemo } from 'react'
import { ChartMessage } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider } from '../../components/controls'
import { columnIndex, toNumber, type DataTable } from '../../data/table'
import { colorAt } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { createRng } from '../../lib/random'
import { logGamma } from '../../stats/distributions'
import { kde, silvermanBandwidth } from '../../stats/kde'
import { chiSquareSf } from '../../stats/survival'
import { betaPdf, ess, gammaPdf, metropolis, normalPosterior, pooledRanks, rankHistogram, rhat, sbcRanks, sdOf, type SbcMode } from '../../stats/tsa'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, RoleSpec, VizModule } from '../types'
import { Panels, Stage, XYPlot, useStage, type Layer } from './kit'

/** Bayesian workflow charts: MCMC trace and rank plots, prior → posterior updating, posterior predictive checks and simulation-based calibration. */

const roles = (prefer = '측정값|성공|건수|값|value|시간'): RoleSpec[] => [{ key: 'value', label: '관측값', type: 'number', required: true, prefer }]

function values(table: DataTable, mapping: Mapping) {
  const vi = columnIndex(table, roleColumn(mapping, 'value'))
  const x: number[] = []
  if (vi >= 0) for (const r of table.rows) { const v = toNumber(r[vi]); if (v != null) x.push(v) }
  return x
}
const needData = <ChartMessage>숫자형 관측값 열을 선택하세요. 관측이 5개 이상 필요합니다.</ChartMessage>
const mean = (a: readonly number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0)

// ─── MCMC (random-walk Metropolis on a normal model) ─────────────────────────────────

export interface SamplerParams { steps: number; warmup: number; chains: number; step: number; param: 'mu' | 'sigma' }

function useSampler(x: number[], p: SamplerParams) {
  return useMemo(() => {
    const n = x.length
    if (n < 5) return null
    const m = mean(x), s = sdOf(x) || 1
    const logp = (t: readonly number[]) => -n * t[1] - x.reduce((a, v) => a + (v - t[0]) ** 2, 0) / (2 * Math.exp(2 * t[1]))
    const init = Array.from({ length: p.chains }, (_, c) => [m + (c - (p.chains - 1) / 2) * 5 * s, Math.log(s) + (c % 2 ? 1.5 : -1.5)])
    const run = metropolis(logp, init, p.steps, [(p.step * s) / Math.sqrt(n), p.step / Math.sqrt(2 * n)], 7)
    const pick = (d: number[]) => (p.param === 'mu' ? d[0] : Math.exp(d[1]))
    const chains = run.chains.map((c) => c.map(pick))
    const w = Math.floor((p.warmup / 100) * p.steps)
    return { n, m, s, chains, w, accept: run.accept, post: chains.map((c) => c.slice(w)) }
  }, [x, p.steps, p.warmup, p.chains, p.step, p.param])
}

const label = (p: SamplerParams['param']) => (p === 'mu' ? '평균 μ' : '표준편차 σ')

function TraceChart({ table, mapping, params, width, height, compact }: ChartProps<SamplerParams>) {
  const x = useMemo(() => values(table, mapping), [table, mapping])
  const res = useSampler(x, params)
  if (!res) return needData
  const steps = Array.from({ length: params.steps }, (_, i) => i + 1)
  const all = res.chains.flat()
  const trace: Layer[] = [
    ...res.chains.map((c, i): Layer => ({ kind: 'line', x: steps, y: c, color: colorAt(i), width: 1.2, label: `체인 ${i + 1}` })),
    { kind: 'vline', v: res.w, color: '#111827', dash: '5 4' },
  ]
  const flat = res.post.flat()
  const r = rhat(res.post), effective = res.post.reduce((a, c) => a + ess(c), 0)
  // exact marginal posterior under the flat prior on (μ, log σ): t for μ, an Inv-χ-type density for σ
  const n = res.n, s = res.s
  const lo = Math.min(...flat), hi = Math.max(...flat)
  const grid = d3.range(0, 121).map((i) => lo + ((hi - lo) * i) / 120)
  const exact = (g: number) => (params.param === 'mu'
    ? Math.exp(logGamma(n / 2) - logGamma((n - 1) / 2)) / Math.sqrt(Math.PI * (n - 1) * (s * s) / n) * (1 + ((g - res.m) ** 2) / ((s * s / n) * (n - 1))) ** (-n / 2)
    : (2 * Math.exp(((n - 1) / 2) * Math.log(((n - 1) * s * s) / 2) - logGamma((n - 1) / 2) - n * Math.log(g) - ((n - 1) * s * s) / (2 * g * g))))
  const bins = d3.bin().domain([lo, hi]).thresholds(30)(flat)
  const dens = bins.map((b) => b.length / flat.length / Math.max(1e-12, (b.x1 ?? 0) - (b.x0 ?? 0)))
  const common = { width, compact }
  if (compact) return <XYPlot {...common} height={height} title="MCMC 트레이스" layers={trace} />
  return (
    <Panels width={width} height={height} parts={[3, 2]}>
      {[
        (h) => <XYPlot {...common} height={h} title={`MCMC 트레이스: ${label(params.param)}, 체인 ${params.chains}개`} xLabel="" yLabel={label(params.param)} margin={{ bottom: 22 }} layers={trace} yDomain={[Math.min(...all), Math.max(...all)]}
          readout={[{ label: 'R̂', value: fmt(r, 3) }, { label: '유효 표본', value: Math.round(effective) }, { label: '수용률', value: pct(mean(res.accept), 0) }]} />,
        (h) => <XYPlot {...common} height={h} title="워밍업 이후의 사후분포" xLabel={label(params.param)} yLabel="밀도" margin={{ top: 12 }} layers={[
          { kind: 'bars', x: bins.map((b) => ((b.x0 ?? 0) + (b.x1 ?? 0)) / 2), y: dens, w: (hi - lo) / 30, color: '#9ab8b4', label: 'MCMC 표본' },
          { kind: 'line', x: grid, y: grid.map(exact), color: '#111827', width: 2, label: '정확한 사후분포' },
        ]} />,
      ]}
    </Panels>
  )
}

function SamplerControls({ params, setParams }: ControlsProps<SamplerParams>) {
  return (
    <ControlGroup title="Metropolis 표본추출">
      <Segmented label="보는 모수" value={params.param} onChange={(param) => setParams({ param })} testId="ctl-param" options={[{ value: 'mu', label: '평균 μ' }, { value: 'sigma', label: '표준편차 σ' }]} />
      <Slider label="체인 수" value={params.chains} min={2} max={6} onChange={(chains) => setParams({ chains })} testId="ctl-chains" />
      <Slider label="반복 수" value={params.steps} min={200} max={4000} step={100} onChange={(steps) => setParams({ steps })} testId="ctl-steps" />
      <Slider label="워밍업 비율" value={params.warmup} min={0} max={60} step={5} format={(v) => `${v}%`} onChange={(warmup) => setParams({ warmup })} testId="ctl-warmup" />
      <Slider label="제안 폭 (사후 표준편차의 배수)" value={params.step} min={0.05} max={12} step={0.05} onChange={(step) => setParams({ step })} testId="ctl-step" />
      <Hint>표의 관측값에 정규분포를 가정하고 (μ, log σ)에 균등 사전분포를 둔 사후분포를 무작위 걷기 Metropolis로 표본추출합니다. 체인마다 일부러 멀리 떨어진 곳에서 출발합니다. 제안 폭이 너무 작으면 수용률은 높아도 천천히 움직이고(유효 표본이 적음), 너무 크면 대부분 거절됩니다. 잘 섞인 체인은 서로 겹친 털실 뭉치처럼 보이고 R̂ ≈ 1입니다. 이 모형의 정확한 사후분포(검은 선)와 비교할 수 있습니다.</Hint>
    </ControlGroup>
  )
}

const samplerDefaults: SamplerParams = { steps: 1500, warmup: 20, chains: 4, step: 2.4, param: 'mu' }
export const traceModule: VizModule<SamplerParams> = {
  roles: roles(), datasets: ['bayes-sample', 'bayes-skewed'], defaultParams: samplerDefaults, Chart: TraceChart, Controls: SamplerControls,
  hint: '제안 폭을 0.1이나 12로 바꿔 체인이 어떻게 엉기는지 보세요 · R̂가 1.01 이하이고 유효 표본이 충분해야 믿을 수 있습니다',
}

// ─── rank plots ─────────────────────────────────────────────────────────────────────

function RankChart({ table, mapping, params, width, height, compact }: ChartProps<SamplerParams>) {
  const stage = useStage()
  const x = useMemo(() => values(table, mapping), [table, mapping])
  const res = useSampler(x, params)
  if (!res) return needData
  const C = res.post.length, bins = 20
  const ranks = pooledRanks(res.post)
  const total = res.post.reduce((a, c) => a + c.length, 0)
  const hists = ranks.map((r) => rankHistogram(r, total, bins))
  const per = res.post[0].length
  const exp = per / bins
  // draws of one chain are autocorrelated, so counts vary more than a binomial: inflate by sqrt(n / ESS)
  const inflate = Math.sqrt(Math.max(1, per / Math.max(1, mean(res.post.map((c) => ess(c))))))
  const sd = Math.sqrt(per * (1 / bins) * (1 - 1 / bins)) * inflate
  const top = Math.max(exp + 3 * sd, ...hists.flat()) * 1.05
  const cols = Math.min(C, compact ? C : width < 560 ? 2 : 3), rows = Math.ceil(C / cols)
  const m = { top: compact ? 6 : 46, left: compact ? 6 : 36, right: compact ? 6 : 16, bottom: compact ? 6 : 34 }
  const cw = (width - m.left - m.right) / cols, ch = (height - m.top - m.bottom) / rows
  const pad = compact ? 3 : 14
  const outside = hists.flat().filter((c) => Math.abs(c - exp) > 1.96 * sd).length
  return (
    <Stage stage={stage} width={width} height={height} compact={compact} label={`MCMC 순위 도표: ${label(params.param)}`} readout={[{ label: 'R̂', value: fmt(rhat(res.post), 3) }, { label: '띠 밖 막대', value: `${outside}/${C * bins}` }]} note="점선 = 균일 기대값, 띠 = 95% 범위 (자기상관 √(n/ESS)만큼 넓힘)">
      <g transform={`translate(${m.left},${m.top})`}>
        {hists.map((h, c) => {
          const gx = (c % cols) * cw, gy = Math.floor(c / cols) * ch
          const xs = d3.scaleLinear().domain([0, bins]).range([pad, cw - pad]), ys = d3.scaleLinear().domain([0, top]).range([ch - pad, pad])
          return (
            <g key={c} transform={`translate(${gx},${gy})`}>
              <rect x={pad} y={ys(exp + 1.96 * sd)} width={cw - 2 * pad} height={ys(exp - 1.96 * sd) - ys(exp + 1.96 * sd)} fill="#4c6fb5" fillOpacity={0.12} />
              <line x1={pad} x2={cw - pad} y1={ys(exp)} y2={ys(exp)} stroke="#6b7280" strokeDasharray="4 3" />
              {h.map((v, i) => <rect key={i} data-testid="rank-bar" x={xs(i) + 0.5} y={ys(v)} width={Math.max(1, xs(1) - xs(0) - 1)} height={ys(0) - ys(v)} fill={colorAt(c)} fillOpacity={0.85} onPointerEnter={compact ? undefined : (e) => stage.at(e, <><b>체인 {c + 1}</b> · 순위 구간 {i + 1}/{bins}<br />{v}개 (기대 {fmt(exp, 1)})</>)} />)}
              <line x1={pad} x2={cw - pad} y1={ys(0)} y2={ys(0)} stroke="#d1d5db" />
              {!compact && <text x={pad} y={pad - 4} fontSize={11.5} fill="#374151" fontWeight={600}>체인 {c + 1}</text>}
            </g>
          )
        })}
      </g>
    </Stage>
  )
}

export const rankModule: VizModule<SamplerParams> = {
  roles: roles(), datasets: ['bayes-sample', 'bayes-skewed'], defaultParams: { ...samplerDefaults, steps: 2000, step: 2.4 }, Chart: RankChart,
  Controls: (p) => (
    <>
      <SamplerControls {...p} />
      <ControlGroup title="순위 도표 읽기"><Hint>모든 체인의 워밍업 이후 표본을 한데 모아 순위를 매기고, 체인마다 그 순위의 히스토그램을 그립니다. 체인이 같은 분포를 탐색한다면 모든 체인의 순위는 균일해야 합니다. 한 체인의 막대가 한쪽으로 쏠리면 그 체인이 다른 체인과 다른 영역에 머물고 있다는 뜻입니다. 트레이스 도표보다 체인이 많을 때 문제를 찾기 쉽습니다. 이 도표는 원시 순위를 쓰며(꼬리 문제를 위한 순위 정규화는 하지 않습니다), 제안 폭을 극단으로 바꿔 보세요.</Hint></ControlGroup>
    </>
  ),
  hint: '제안 폭을 0.05로 줄이면 체인마다 순위가 한쪽으로 쏠립니다 · 막대에 올리면 개수',
}

// ─── prior → posterior ──────────────────────────────────────────────────────────────

export interface PriorParams { family: 'auto' | 'beta' | 'normal' | 'gamma'; used: number; a0: number; b0: number; m0: number; tau0: number; sigma: number }

function PriorChart({ table, mapping, params, width, height, compact }: ChartProps<PriorParams>) {
  const all = useMemo(() => values(table, mapping), [table, mapping])
  const used = Math.max(0, Math.min(all.length, params.used >= 9999 ? all.length : params.used))
  const x = all.slice(0, used)
  // 'auto' reads the data: only 0/1 → binomial, non-negative integers → Poisson, anything else → normal
  const family = params.family !== 'auto' ? params.family : all.length && all.every((v) => v === 0 || v === 1) ? 'beta' : all.length && all.every((v) => v >= 0 && Number.isInteger(v)) ? 'gamma' : 'normal'
  const res = useMemo(() => {
    if (all.length < 1) return null
    if (family === 'beta') {
      if (all.some((v) => v !== 0 && v !== 1)) return { error: '이항(베타) 모형은 0과 1로만 이루어진 열이 필요합니다.' as const }
      const k = x.filter((v) => v === 1).length, m = x.length
      const a = params.a0 + k, b = params.b0 + m - k
      const g = d3.range(1, 400).map((i) => i / 400)
      return { g, prior: g.map((v) => betaPdf(v, params.a0, params.b0)), post: g.map((v) => betaPdf(v, a, b)), lik: g.map((v) => v ** k * (1 - v) ** (m - k)), mean: a / (a + b), weight: (params.a0 + params.b0) / (a + b), xLabel: '성공 확률 p', prior0: params.a0 / (params.a0 + params.b0) }
    }
    if (family === 'gamma') {
      if (all.some((v) => v < 0 || !Number.isInteger(v))) return { error: '푸아송(감마) 모형은 0 이상의 정수 열이 필요합니다.' as const }
      const s = x.reduce((a, v) => a + v, 0), m = x.length
      const a = params.a0 + s, b = params.b0 + m
      const top = Math.max((a + 5 * Math.sqrt(a)) / b, (params.a0 + 5 * Math.sqrt(params.a0)) / params.b0, 1)
      const g = d3.range(1, 400).map((i) => (i / 400) * top)
      return { g, prior: g.map((v) => gammaPdf(v, params.a0, params.b0)), post: g.map((v) => gammaPdf(v, a, b)), lik: g.map((v) => v ** s * Math.exp(-m * v)), mean: a / b, weight: params.b0 / b, xLabel: '발생률 λ (건/일)', prior0: params.a0 / params.b0 }
    }
    const m = x.length, xbar = mean(x)
    const prec0 = 1 / params.tau0 ** 2, precL = m / params.sigma ** 2
    const pm = (prec0 * params.m0 + precL * xbar) / (prec0 + precL), psd = Math.sqrt(1 / (prec0 + precL))
    const lo = Math.min(params.m0 - 4 * params.tau0, pm - 5 * psd, xbar - 4 * params.sigma / Math.sqrt(Math.max(1, m))), hi = Math.max(params.m0 + 4 * params.tau0, pm + 5 * psd, xbar + 4 * params.sigma / Math.sqrt(Math.max(1, m)))
    const g = d3.range(0, 401).map((i) => lo + ((hi - lo) * i) / 400)
    const pdf = (v: number, mu: number, sd: number) => Math.exp(-0.5 * ((v - mu) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI))
    return { g, prior: g.map((v) => pdf(v, params.m0, params.tau0)), post: g.map((v) => pdf(v, pm, psd)), lik: g.map((v) => Math.exp(-0.5 * ((v - xbar) / (params.sigma / Math.sqrt(Math.max(1, m)))) ** 2)), mean: pm, weight: prec0 / (prec0 + precL), xLabel: '평균 μ', prior0: params.m0 }
  }, [all, x, family, params.a0, params.b0, params.m0, params.tau0, params.sigma])
  if (!res) return needData
  if ('error' in res) return <ChartMessage>{res.error}</ChartMessage>
  const ci = (() => { const cdf = [0]; for (let i = 1; i < res.g.length; i++) cdf.push(cdf[i - 1] + ((res.post[i] + res.post[i - 1]) / 2) * (res.g[i] - res.g[i - 1])); const t = cdf[cdf.length - 1] || 1; const q = (p: number) => res.g[Math.max(0, cdf.findIndex((c) => c / t >= p))]; return [q(0.025), q(0.975)] as const })()
  const postMax = Math.max(...res.post), likMax = Math.max(...res.lik) || 1
  const inCi = res.g.map((g, i) => (g >= ci[0] && g <= ci[1] ? res.post[i] : 0))
  return (
    <XYPlot width={width} height={height} compact={compact} xLabel={res.xLabel} yLabel="밀도" title={`사전분포 → 사후분포 (${({ beta: '이항–베타', normal: '정규–정규', gamma: '푸아송–감마' })[family]}): 관측 ${x.length}개`} yDomain={[0, Math.max(postMax, ...res.prior.filter((v) => Number.isFinite(v))) * 1.1]} hover
      layers={[
        { kind: 'band', x: res.g, lo: res.g.map(() => 0), hi: inCi, color: '#2a8c82', opacity: 0.18 },
        { kind: 'line', x: res.g, y: res.prior, color: '#9aa1a9', width: 2.2, label: '사전분포', dash: '6 4' },
        { kind: 'line', x: res.g, y: res.lik.map((v) => (v / likMax) * postMax), color: '#e07a3f', width: 1.8, label: '가능도 (크기 맞춤)' },
        { kind: 'line', x: res.g, y: res.post, color: '#2a8c82', width: 3, label: '사후분포' },
      ]}
      readout={[{ label: '사후 평균', value: fmt(res.mean, 3) }, { label: '95% 신용구간', value: `${fmt(ci[0], 3)} ~ ${fmt(ci[1], 3)}` }, { label: '사전 비중', value: pct(res.weight, 0) }]}
      note="초록 띠 = 95% 신용구간, 가능도는 사후분포와 높이를 맞춰 그린 것" />
  )
}

function PriorControls({ params, setParams, table, mapping }: ControlsProps<PriorParams>) {
  const rows = table.rows.length
  const vals = values(table, mapping)
  const family = params.family !== 'auto' ? params.family : vals.length && vals.every((v) => v === 0 || v === 1) ? 'beta' : vals.length && vals.every((v) => v >= 0 && Number.isInteger(v)) ? 'gamma' : 'normal'
  return (
    <ControlGroup title="베이지안 갱신">
      <Segmented label="모형" value={params.family} onChange={(family) => setParams(family === 'beta' ? { family, a0: 2, b0: 2 } : family === 'gamma' ? { family, a0: 2, b0: 2 } : { family })} testId="ctl-family" options={[{ value: 'auto', label: '자동' }, { value: 'beta', label: '이항' }, { value: 'normal', label: '정규' }, { value: 'gamma', label: '푸아송' }]} />
      <Slider label="반영한 관측 수" value={Math.min(params.used, rows)} min={0} max={Math.max(1, rows)} onChange={(used) => setParams({ used })} testId="ctl-used" />
      {family === 'normal' ? (
        <>
          <Slider label="사전 평균 m₀" value={params.m0} min={0} max={100} onChange={(m0) => setParams({ m0 })} testId="ctl-m0" />
          <Slider label="사전 표준편차 τ₀" value={params.tau0} min={1} max={50} onChange={(tau0) => setParams({ tau0 })} testId="ctl-tau0" />
          <Slider label="알려진 잡음 σ" value={params.sigma} min={1} max={20} onChange={(sigma) => setParams({ sigma })} testId="ctl-sigma" />
        </>
      ) : (
        <>
          <Slider label={family === 'beta' ? '사전 성공 횟수 α' : '사전 형태 α'} value={params.a0} min={0.5} max={30} step={0.5} onChange={(a0) => setParams({ a0 })} testId="ctl-a0" />
          <Slider label={family === 'beta' ? '사전 실패 횟수 β' : '사전 비율 β'} value={params.b0} min={0.5} max={30} step={0.5} onChange={(b0) => setParams({ b0 })} testId="ctl-b0" />
        </>
      )}
      <Hint>켤레 사전분포를 쓰므로 사후분포가 수식으로 정확히 나옵니다. 이항: Beta(α, β) → Beta(α + 성공, β + 실패). 푸아송: Gamma(α, β) → Gamma(α + 합계, β + 일수). 정규(σ 알려짐): 정밀도(1/분산)를 더하고 정밀도 가중 평균을 취합니다. 관측 수를 늘리면 사후분포가 가능도 쪽으로 이동하며 좁아지고, 사전 분포의 영향(사전 비중)은 줄어듭니다. 사전분포는 가정이므로 서로 다른 값으로 바꿔 민감도를 확인하세요.</Hint>
    </ControlGroup>
  )
}

export const priorModule: VizModule<PriorParams> = {
  roles: roles('성공|건수|측정값|값'), datasets: ['bayes-trials', 'bayes-sample', 'bayes-counts'], defaultParams: { family: 'auto', used: 9999, a0: 2, b0: 2, m0: 50, tau0: 15, sigma: 8 },
  Chart: PriorChart, Controls: PriorControls, hint: '반영한 관측 수를 0에서 늘려 가며 사후분포가 사전분포에서 가능도로 옮겨 가는 모습을 보세요 (데이터에 맞는 모형을 고르세요)',
}

// ─── posterior predictive check ─────────────────────────────────────────────────────

export interface PpcParams { model: 'normal' | 'lognormal'; stat: 'mean' | 'sd' | 'min' | 'max' | 'skew' | 'median'; draws: number }

const STATS: Record<PpcParams['stat'], { label: string; f: (v: readonly number[]) => number }> = {
  mean: { label: '평균', f: (v) => mean(v) },
  sd: { label: '표준편차', f: (v) => sdOf(v) },
  min: { label: '최솟값', f: (v) => Math.min(...v) },
  max: { label: '최댓값', f: (v) => Math.max(...v) },
  median: { label: '중앙값', f: (v) => { const s = [...v].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2 } },
  skew: { label: '왜도', f: (v) => { const m = mean(v), s = sdOf(v) || 1; return mean(v.map((a) => ((a - m) / s) ** 3)) } },
}

function PpcChart({ table, mapping, params, width, height, compact }: ChartProps<PpcParams>) {
  const x = useMemo(() => values(table, mapping), [table, mapping])
  const res = useMemo(() => {
    if (x.length < 8) return null
    if (params.model === 'lognormal' && x.some((v) => v <= 0)) return { error: '로그정규 모형은 모든 값이 0보다 커야 합니다.' as const }
    const z = params.model === 'lognormal' ? x.map(Math.log) : x
    const rng = createRng(11)
    const post = normalPosterior(z, params.draws, rng)
    const back = (v: number) => (params.model === 'lognormal' ? Math.exp(v) : v)
    const reps = post.map(({ mu, sigma }) => Array.from({ length: x.length }, () => back(mu + sigma * rng.normal())))
    const T = STATS[params.stat].f
    const tRep = reps.map(T), tObs = T(x)
    const p = tRep.filter((t) => t >= tObs).length / tRep.length
    return { reps, tRep, tObs, p, bw: silvermanBandwidth(x) }
  }, [x, params.model, params.draws, params.stat])
  if (x.length < 8) return <ChartMessage>숫자형 관측값이 8개 이상 필요합니다.</ChartMessage>
  if (!res) return needData
  if ('error' in res) return <ChartMessage>{res.error}</ChartMessage>
  const lo = Math.min(...x, ...res.reps.slice(0, 20).flat()), hi = Math.max(...x, ...res.reps.slice(0, 20).flat())
  const grid = d3.range(0, 161).map((i) => lo + ((hi - lo) * i) / 160)
  const extreme = Math.min(res.p, 1 - res.p) < 0.025
  const tlo = Math.min(...res.tRep, res.tObs), thi = Math.max(...res.tRep, res.tObs)
  const bins = d3.bin().domain([tlo, thi + 1e-9]).thresholds(28)(res.tRep)
  const bw = (thi - tlo) / 28 || 1
  const common = { width, compact }
  const layers1: Layer[] = [
    ...res.reps.slice(0, 20).map((r): Layer => ({ kind: 'line', x: grid, y: kde(r, res.bw, 'gaussian', grid), color: '#4c6fb5', width: 1, opacity: 0.35 })),
    { kind: 'line', x: grid, y: kde(x, res.bw, 'gaussian', grid), color: '#111827', width: 2.8, label: '관측 자료' },
  ]
  if (compact) return <XYPlot {...common} height={height} title="사후예측 점검" layers={layers1} />
  return (
    <Panels width={width} height={height} parts={[1, 1]}>
      {[
        (h) => <XYPlot {...common} height={h} title={`사후예측 점검: ${params.model === 'normal' ? '정규' : '로그정규'} 모형`} xLabel="" yLabel="밀도" margin={{ bottom: 24 }} layers={layers1} note="파란 선 = 사후예측으로 새로 만든 자료 20개의 밀도, 검은 선 = 관측 자료" />,
        (h) => <XYPlot {...common} height={h} title={`검정통계량: ${STATS[params.stat].label}`} xLabel={STATS[params.stat].label} yLabel="개수" margin={{ top: 14 }} readout={[{ label: '관측값', value: fmt(res.tObs, 3) }, { label: 'P(T_rep ≥ T_obs)', value: fmt(res.p, 3) }, { label: '판정', value: extreme ? '모형이 설명하지 못함' : '모형과 모순 없음' }]} layers={[
          { kind: 'bars', x: bins.map((b) => ((b.x0 ?? 0) + (b.x1 ?? 0)) / 2), y: bins.map((b) => b.length), w: bw, color: '#9ab8b4', label: '사후예측 분포' },
          { kind: 'vline', v: res.tObs, color: extreme ? '#cf4f6a' : '#111827', dash: '0', width: 2.4 },
        ]} />,
      ]}
    </Panels>
  )
}

function PpcControls({ params, setParams }: ControlsProps<PpcParams>) {
  return (
    <ControlGroup title="사후예측 점검">
      <Segmented label="모형" value={params.model} onChange={(model) => setParams({ model })} testId="ctl-model" options={[{ value: 'normal', label: '정규' }, { value: 'lognormal', label: '로그정규' }]} />
      <Select label="검정통계량 T" value={params.stat} onChange={(stat) => setParams({ stat })} testId="ctl-stat" options={Object.entries(STATS).map(([value, s]) => ({ value: value as PpcParams['stat'], label: s.label }))} />
      <Slider label="사후 표본 수" value={params.draws} min={200} max={3000} step={100} onChange={(draws) => setParams({ draws })} testId="ctl-draws" />
      <Hint>사후분포에서 모수 (μ, σ)를 뽑고, 그 모수로 관측 개수만큼의 새 자료 y_rep를 만들어 관측 자료와 비교합니다. 모형이 자료를 잘 설명한다면 관측 자료의 통계량 T(y)가 복제 자료의 T(y_rep) 분포 한가운데 있어야 합니다. 오른쪽으로 치우친 자료에 정규 모형을 쓰면 왜도나 최댓값에서 관측값이 분포의 끝에 나타나고, 로그정규 모형으로 바꾸면 해소됩니다. 사후예측 p값은 극단일 때(0.025 미만 또는 0.975 초과)만 의미가 있고 가설검정의 p값과는 다릅니다.</Hint>
    </ControlGroup>
  )
}

export const ppcModule: VizModule<PpcParams> = {
  roles: roles('대기|측정값|값'), datasets: ['bayes-skewed', 'bayes-sample'], defaultParams: { model: 'normal', stat: 'skew', draws: 1000 },
  Chart: PpcChart, Controls: PpcControls, hint: '치우친 자료에 정규 모형을 쓰고 왜도·최댓값을 비교한 뒤 로그정규 모형으로 바꿔 보세요',
}

// ─── simulation-based calibration ───────────────────────────────────────────────────

export interface SbcParams { mode: SbcMode; sims: number; tau: number }

function SbcChart({ table, mapping, params, width, height, compact }: ChartProps<SbcParams>) {
  const x = useMemo(() => values(table, mapping), [table, mapping])
  const n = Math.max(2, x.length), sigma = Math.max(0.2, sdOf(x) || 1)
  const draws = 99, bins = 20
  const res = useMemo(() => {
    const ranks = sbcRanks(n, sigma, { sims: params.sims, draws, tau: params.tau, mode: params.mode, seed: 3 })
    const h = rankHistogram(ranks.map((r) => r + 1), draws + 1, bins)
    const exp = params.sims / bins
    const chi = h.reduce((a, c) => a + (c - exp) ** 2 / exp, 0)
    return { h, exp, chi, p: chiSquareSf(chi, bins - 1) }
  }, [n, sigma, params.sims, params.tau, params.mode])
  if (x.length < 2) return <ChartMessage>설계용 숫자 열이 필요합니다. 행 수가 관측 개수 n, 표준편차가 잡음 σ로 쓰입니다.</ChartMessage>
  const sd = Math.sqrt(params.sims * (1 / bins) * (1 - 1 / bins))
  const xs = res.h.map((_, i) => i + 0.5)
  const verdict = res.p < 0.01 ? '교정 실패' : '균일과 모순 없음'
  return (
    <XYPlot width={width} height={height} compact={compact} xLabel={`사후 표본 ${draws}개 중 참값보다 작은 개수의 순위 (20개 구간)`} yLabel="시뮬레이션 횟수" xDomain={[0, bins]} xFormat={(v) => String(Math.round((v / bins) * (draws + 1)))} title={`SBC 순위 히스토그램: ${({ correct: '정확한 사후분포', overconfident: '과신하는 추론', underconfident: '과소신뢰 추론', biased: '편향된 추론' })[params.mode]}`}
      layers={[
        { kind: 'band', x: [0, bins], lo: [res.exp - 2.576 * sd, res.exp - 2.576 * sd], hi: [res.exp + 2.576 * sd, res.exp + 2.576 * sd], color: '#4c6fb5', opacity: 0.14 },
        { kind: 'hline', v: res.exp, color: '#6b7280' },
        { kind: 'bars', x: xs, y: res.h, w: 0.9, color: res.p < 0.01 ? '#cf4f6a' : '#2a8c82' },
      ]}
      readout={[{ label: 'n, σ', value: `${n}, ${fmt(sigma, 2)}` }, { label: 'χ² 균일성 p', value: res.p < 0.001 ? '<0.001' : fmt(res.p, 3) }, { label: '판정', value: verdict }]} note="띠 = 균일일 때 99% 범위, 사전분포에서 뽑은 참값의 순위는 균일해야 함" />
  )
}

function SbcControls({ params, setParams }: ControlsProps<SbcParams>) {
  return (
    <ControlGroup title="시뮬레이션 기반 보정">
      <Select label="추론 절차" value={params.mode} onChange={(mode) => setParams({ mode })} testId="ctl-mode" options={[{ value: 'correct', label: '정확한 사후분포' }, { value: 'overconfident', label: '과신 (사후 폭을 절반으로)' }, { value: 'underconfident', label: '과소신뢰 (사후 폭 2배)' }, { value: 'biased', label: '편향 (사후 평균을 이동)' }]} />
      <Slider label="시뮬레이션 횟수" value={params.sims} min={100} max={3000} step={100} onChange={(sims) => setParams({ sims })} testId="ctl-sims" />
      <Slider label="사전 표준편차 τ" value={params.tau} min={0.2} max={5} step={0.1} onChange={(tau) => setParams({ tau })} testId="ctl-tau" />
      <Hint>알려진 정답이 필요한 검증입니다. ① 사전분포에서 참값 θ를 뽑고 ② θ로 자료를 시뮬레이션하고 ③ 그 자료의 사후 표본 99개를 구해 ④ θ가 표본 중 몇 번째인지(순위)를 기록하기를 반복합니다. 추론이 올바르면 순위가 균일분포를 따릅니다. 가운데가 솟으면 사후분포가 너무 넓고, 양 끝이 솟은 U자는 사후분포가 너무 좁은(과신) 경우이며, 한쪽으로 기울면 편향입니다. 정규–정규 모형의 정확한 사후분포를 기준으로 하며, 여러분이 쓰는 추론 코드의 버그를 찾는 데 쓰는 절차를 보여 줍니다.</Hint>
    </ControlGroup>
  )
}

export const sbcModule: VizModule<SbcParams> = {
  roles: roles('측정값|값'), datasets: ['sbc-design'], defaultParams: { mode: 'correct', sims: 800, tau: 1 },
  Chart: SbcChart, Controls: SbcControls, hint: '추론 절차를 ‘과신’이나 ‘편향’으로 바꿔 순위 히스토그램이 어떻게 무너지는지 보세요',
}

