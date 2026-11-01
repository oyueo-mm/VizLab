import * as d3 from 'd3'
import { useMemo } from 'react'
import { ChartMessage } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, type DataTable } from '../../data/table'
import { colorAt, schemes } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import {
  bsDelta, cornishFisherVar, efficientFrontier, equalRiskContribution, eventStudy, globalMinVariance, historicalVarEs, impliedVol, kupiecLR, normalVarEs, portfolioReturn, portfolioVariance, randomPortfolios,
  riskContributions, tangency, covariance, meanVector, type EventRow,
} from '../../stats/finance2'
import { chiSquareSf } from '../../stats/survival'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, RoleSpec, VizModule } from '../types'
import { ViewControls, type ViewParams } from './geo3dCharts'
import { Panels, Stage, XYPlot, useStage, type Layer } from './kit'
import { Scene3D } from './kit3d'
import { drawQuads, type Projector, type Quad } from './scene3d'

/** Finance charts: efficient frontier, risk–return, implied-volatility smile and surface, order-flow footprint, order-book heatmap, event-study CAR, VaR / expected shortfall, risk contribution and yield-curve surface. Synthetic data; not investment advice. */

const assetRoles = (min = 2): RoleSpec[] => [
  { key: 'date', label: '기간 (선택)', type: 'date', accept: ['number'], auto: true, prefer: '월|날짜|date' },
  { key: 'assets', label: '자산 수익률 열', type: 'number', required: true, multiple: { min, max: 8 } },
]

function returnsOf(table: DataTable, mapping: Mapping) {
  const names = roleColumns(mapping, 'assets'), idx = names.map((n) => columnIndex(table, n))
  const rows: number[][] = []
  if (!idx.length || idx.some((i) => i < 0)) return { names, R: rows }
  for (const r of table.rows) { const v = idx.map((i) => toNumber(r[i])); if (v.every((x) => x != null)) rows.push(v as number[]) }
  return { names, R: rows }
}
const needAssets = <ChartMessage>수익률 열을 2개 이상 고르세요. 관측이 12개 이상 필요합니다.</ChartMessage>
const disclaimer = '합성 데이터 · 투자 조언이 아님'

// ─── efficient frontier ─────────────────────────────────────────────────────────────

export interface FrontierParams { longOnly: boolean; rf: number; periods: number; cloud: boolean; assets: boolean; cml: boolean; target: number }

function FrontierChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<FrontierParams>) {
  const { names, R } = useMemo(() => returnsOf(table, mapping), [table, mapping])
  const model = useMemo(() => {
    if (R.length < 12 || names.length < 2 || names.length > 8) return null
    const k = params.periods
    const mu = meanVector(R).map((v) => v * k), S = covariance(R).map((r) => r.map((v) => v * k))
    const fr = efficientFrontier(mu, S, 40, params.longOnly)
    const gmv = globalMinVariance(S, params.longOnly)
    const tan = tangency(mu, S, params.rf / 100, params.longOnly)
    return { mu, S, fr, gmv, tan, cloud: params.cloud && !compact ? randomPortfolios(mu, S, 1500, 5) : [] }
  }, [R, names.length, params.periods, params.longOnly, params.rf, params.cloud, compact])
  if (!model) return needAssets
  const { mu, S, fr, gmv, tan } = model
  const vol = (i: number) => Math.sqrt(S[i][i])
  const sel = fr.length ? fr[Math.max(0, Math.min(fr.length - 1, Math.round(params.target * (fr.length - 1))))] : null
  const lines: Layer[] = [
    ...(model.cloud.length ? [{ kind: 'points', color: '#9ab8b4', r: 1.8, opacity: 0.35, pts: model.cloud.map((p, i) => ({ x: p.vol, y: p.ret, key: String(i) })) } as Layer] : []),
    { kind: 'line', x: fr.map((f) => f.vol), y: fr.map((f) => f.ret), color: '#2a8c82', width: 3, label: '효율적 투자선' },
    ...(params.cml && tan ? [{ kind: 'line', x: [0, tan.vol * 2], y: [params.rf / 100, params.rf / 100 + ((tan.ret - params.rf / 100) / tan.vol) * tan.vol * 2], color: '#9aa1a9', dash: '6 4', width: 1.8, label: '자본시장선' } as Layer] : []),
    ...(params.assets ? [{ kind: 'points', color: '#111827', r: 5, label: '개별 자산', pts: names.map((n, i) => ({ x: vol(i), y: mu[i], key: n, tip: <><b>{n}</b><br />수익률 {pct(mu[i], 1)} · 변동성 {pct(vol(i), 1)}</> })) } as Layer, ...names.map((n, i): Layer => ({ kind: 'text', x: vol(i), y: mu[i], text: n, anchor: 'start', size: 10.5, color: '#374151' }))] : []),
    { kind: 'points', color: '#4c6fb5', r: 7, stroke: '#fff', label: '최소분산', pts: [{ x: Math.sqrt(portfolioVariance(gmv, S)), y: portfolioReturn(gmv, mu), tip: <><b>전역 최소분산</b><br />{names.map((n, i) => `${n} ${pct(gmv[i], 0)}`).join(' · ')}</> }] },
    ...(tan ? [{ kind: 'points', color: '#e07a3f', r: 7, stroke: '#fff', label: '접점(최대 샤프)', pts: [{ x: tan.vol, y: tan.ret, tip: <><b>접점 포트폴리오</b><br />샤프 {fmt((tan.ret - params.rf / 100) / tan.vol, 2)}<br />{names.map((n, i) => `${n} ${pct(tan.w[i], 0)}`).join(' · ')}</> }] } as Layer] : []),
    ...(sel ? [{ kind: 'points', color: '#e11d48', r: 6, stroke: '#fff', label: '선택한 점', pts: [{ x: sel.vol, y: sel.ret }] } as Layer] : []),
  ]
  const wRows = [['최소분산', gmv], ...(tan ? [['접점', tan.w] as const] : []), ...(sel ? [['선택', sel.w] as const] : [])] as [string, number[]][]
  const plot = (h: number) => (
    <XYPlot hover={false} layers={lines} width={width} height={h} compact={compact} xLabel="연 변동성 (위험)" yLabel="연 기대수익률" xFormat={(v) => pct(v, 0)} yFormat={(v) => pct(v, 0)} title={`효율적 투자선 (${params.longOnly ? '공매도 없음' : '공매도 허용'}): ${names.length}개 자산`}
      onPick={compact ? undefined : (x) => { const i = fr.reduce((b, f, k) => (Math.abs(f.vol - x) < Math.abs(fr[b].vol - x) ? k : b), 0); setParams({ target: i / Math.max(1, fr.length - 1) }) }}
      readout={[{ label: '최소분산 변동성', value: pct(Math.sqrt(portfolioVariance(gmv, S)), 1) }, ...(tan ? [{ label: '최대 샤프', value: fmt((tan.ret - params.rf / 100) / tan.vol, 2) }] : []), ...(sel ? [{ label: '선택 점', value: `${pct(sel.ret, 1)} / ${pct(sel.vol, 1)}` }] : [])]}
      note={`${disclaimer} · 선을 눌러 점 선택`} />
  )
  if (compact) return plot(height)
  return (
    <Panels width={width} height={height} parts={[3, 1]}>
      {[plot, (h) => <WeightBars width={width} height={h} names={names} rows={wRows} />]}
    </Panels>
  )
}

function WeightBars({ width, height, names, rows }: { width: number; height: number; names: string[]; rows: [string, number[]][] }) {
  const stage = useStage()
  const left = 70, iw = width - left - 24, rh = Math.min(26, (height - 12) / Math.max(1, rows.length))
  return (
    <Stage stage={stage} width={width} height={height} label="포트폴리오 구성 비중">
      <g transform="translate(0,6)">
        {rows.map(([label, w], r) => {
          let x = left
          return (
            <g key={label} transform={`translate(0,${r * (rh + 4)})`}>
              <text x={left - 8} y={rh / 2} dy="0.34em" textAnchor="end" fontSize={11.5} fill="#374151">{label}</text>
              {w.map((v, i) => { const wd = Math.max(0, v) * iw, el = <g key={i}><rect data-testid="weight-seg" x={x} width={wd} height={rh} fill={colorAt(i)} fillOpacity={0.9} onPointerEnter={(e) => stage.at(e, <><b>{names[i]}</b> {pct(v, 1)}</>)} />{wd > 34 && <text x={x + wd / 2} y={rh / 2} dy="0.34em" textAnchor="middle" fontSize={10} fill="#fff" pointerEvents="none">{Math.round(v * 100)}%</text>}</g>; x += wd; return el })}
            </g>
          )
        })}
      </g>
    </Stage>
  )
}

function FrontierControls({ params, setParams }: ControlsProps<FrontierParams>) {
  return (
    <ControlGroup title="포트폴리오 이론">
      <Segmented label="제약" value={params.longOnly ? 'long' : 'short'} onChange={(v) => setParams({ longOnly: v === 'long' })} testId="ctl-constraint" options={[{ value: 'long', label: '공매도 없음' }, { value: 'short', label: '공매도 허용' }]} />
      <Slider label="무위험 이자율 (연 %)" value={params.rf} min={0} max={8} step={0.25} onChange={(rf) => setParams({ rf })} testId="ctl-rf" />
      <Slider label="연간 기간 수" value={params.periods} min={1} max={252} onChange={(periods) => setParams({ periods })} testId="ctl-periods" />
      <Slider label="선택한 점 (위험 낮음 → 높음)" value={params.target} min={0} max={1} step={0.02} onChange={(target) => setParams({ target })} testId="ctl-target" format={(v) => `${Math.round(v * 100)}%`} />
      <Toggle label="무작위 포트폴리오 구름" checked={params.cloud} onChange={(cloud) => setParams({ cloud })} />
      <Toggle label="개별 자산 표시" checked={params.assets} onChange={(assets) => setParams({ assets })} />
      <Toggle label="자본시장선" checked={params.cml} onChange={(cml) => setParams({ cml })} />
      <Hint>표의 수익률에서 평균 μ와 공분산 Σ를 구해 연율로 바꾸고, 목표 수익률마다 분산 wᵀΣw가 가장 작은 비중을 구한 것이 효율적 투자선입니다(제약 조건이 예산 Σw = 1뿐이면 라그랑주 연립방정식의 정확한 해, 공매도 금지이면 자산 부분집합을 모두 시험하는 정확한 이차계획). 상관이 낮은 자산을 섞으면 어떤 개별 자산보다 위험이 낮은 조합이 생기는 분산 효과가 선이 왼쪽으로 휘는 정도입니다. 접점 포트폴리오는 샤프 비율이 최대인 점입니다. 표본 평균과 공분산의 추정 오차에 매우 민감하므로 이 결과는 과거 자료의 계산일 뿐 미래 수익을 약속하지 않으며 투자 조언이 아닙니다.</Hint>
    </ControlGroup>
  )
}

export const frontierModule: VizModule<FrontierParams> = {
  roles: assetRoles(2), datasets: ['asset-returns'], defaultParams: { longOnly: true, rf: 2, periods: 12, cloud: true, assets: true, cml: true, target: 0.5 },
  Chart: FrontierChart, Controls: FrontierControls, hint: '선을 눌러 점을 고르면 구성 비중이 아래에 표시됩니다 · 공매도 허용으로 바꾸면 선이 위로 열립니다 (합성 데이터)',
}

// ─── risk–return scatter ────────────────────────────────────────────────────────────

export interface RiskReturnParams { rf: number; periods: number; iso: boolean; size: boolean }

function RiskReturnChart({ table, mapping, params, width, height, compact }: ChartProps<RiskReturnParams>) {
  const { names, R } = useMemo(() => returnsOf(table, mapping), [table, mapping])
  const stats = useMemo(() => names.map((n, i) => {
    const col = R.map((r) => r[i]), m = d3.mean(col) ?? 0, sd = d3.deviation(col) ?? 0
    let lvl = 1, peak = 1, mdd = 0
    for (const v of col) { lvl *= 1 + v; peak = Math.max(peak, lvl); mdd = Math.min(mdd, lvl / peak - 1) }
    const k = params.periods
    return { name: n, mu: m * k, vol: sd * Math.sqrt(k), sharpe: sd > 0 ? (m * k - params.rf / 100) / (sd * Math.sqrt(k)) : NaN, mdd, skew: d3.mean(col.map((v) => ((v - m) / (sd || 1)) ** 3)) ?? 0 }
  }), [names, R, params.periods, params.rf])
  if (R.length < 12 || names.length < 1) return needAssets
  const vmax = Math.max(...stats.map((s) => s.vol)) * 1.2, rmax = Math.max(...stats.map((s) => s.mu), 0.02) * 1.25, rmin = Math.min(0, ...stats.map((s) => s.mu)) * 1.25
  const layers: Layer[] = [
    ...(params.iso ? [0.5, 1, 1.5].map((sr): Layer => ({ kind: 'line', x: [0, vmax], y: [params.rf / 100, params.rf / 100 + sr * vmax], color: '#cbd5d3', dash: '4 4', width: 1.2 })) : []),
    { kind: 'hline', v: params.rf / 100, color: '#9aa1a9' },
    ...stats.map((s, i): Layer => ({ kind: 'points', color: colorAt(i), r: params.size ? 5 + Math.max(0, s.sharpe) * 6 : 7, label: s.name, pts: [{ x: s.vol, y: s.mu, tip: <><b>{s.name}</b><br />연 수익률 {pct(s.mu, 1)} · 변동성 {pct(s.vol, 1)}<br />샤프 {fmt(s.sharpe, 2)} · 최대 낙폭 {pct(s.mdd, 0)}<br />왜도 {fmt(s.skew, 2)}</> }] })),
  ]
  return (
    <XYPlot hover={false} layers={layers} width={width} height={height} compact={compact} xDomain={[0, vmax]} yDomain={[rmin, rmax]} xLabel="연 변동성 (표준편차)" yLabel="연 수익률" xFormat={(v) => pct(v, 0)} yFormat={(v) => pct(v, 0)} title={`위험–수익 산점도: ${names.length}개 자산`}
      readout={[{ label: '최고 샤프', value: stats.reduce((b, s) => (s.sharpe > b.sharpe ? s : b), stats[0]).name }, { label: '최저 위험', value: stats.reduce((b, s) => (s.vol < b.vol ? s : b), stats[0]).name }]}
      note={`점선 = 샤프 0.5·1·1.5의 등위선 · ${disclaimer}`} />
  )
}

function RiskReturnControls({ params, setParams }: ControlsProps<RiskReturnParams>) {
  return (
    <ControlGroup title="위험–수익">
      <Slider label="무위험 이자율 (연 %)" value={params.rf} min={0} max={8} step={0.25} onChange={(rf) => setParams({ rf })} testId="ctl-rf" />
      <Slider label="연간 기간 수 (월 자료 = 12)" value={params.periods} min={1} max={252} onChange={(periods) => setParams({ periods })} testId="ctl-periods" />
      <Toggle label="샤프 등위선" checked={params.iso} onChange={(iso) => setParams({ iso })} />
      <Toggle label="점 크기 = 샤프 비율" checked={params.size} onChange={(size) => setParams({ size })} />
      <Hint>자산마다 수익률의 평균(세로)과 표준편차(가로)를 연율로 바꿔 한 평면에 놓았습니다. 왼쪽 위에 있을수록 같은 위험에 더 높은 수익률입니다. 샤프 비율 (μ − r_f)/σ가 같은 점은 무위험 이자율에서 나가는 한 직선 위에 있습니다. 평균과 표준편차만으로는 꼬리 위험(왜도, 최대 낙폭)이 보이지 않으므로 툴팁에서 함께 확인하세요. 과거의 위험·수익이 미래에도 이어진다는 보장은 없습니다.</Hint>
    </ControlGroup>
  )
}

export const riskReturnModule: VizModule<RiskReturnParams> = {
  roles: assetRoles(1), datasets: ['asset-returns'], defaultParams: { rf: 2, periods: 12, iso: true, size: true },
  Chart: RiskReturnChart, Controls: RiskReturnControls, hint: '점에 올려 샤프 비율·최대 낙폭·왜도를 보세요 · 점선은 같은 샤프 비율의 선 (합성 데이터)',
}

// ─── implied volatility ─────────────────────────────────────────────────────────────

export interface IvParams extends ViewParams { spot: number; rate: number; x: 'strike' | 'moneyness' | 'delta'; expiry: number; all: boolean; zScale: number; points: boolean }
const optionRoles: RoleSpec[] = [
  { key: 'T', label: '만기 (년)', type: 'number', required: true, prefer: '만기|T' },
  { key: 'K', label: '행사가', type: 'number', required: true, prefer: '행사가|K|strike' },
  { key: 'type', label: '유형 (콜/풋)', type: 'category', required: true, prefer: '유형|type' },
  { key: 'price', label: '옵션 가격', type: 'number', required: true, prefer: '가격|price' },
]

function ivPoints(table: DataTable, mapping: Mapping, S: number, r: number) {
  const ix = (k: string) => columnIndex(table, roleColumn(mapping, k))
  const [ti, ki, yi, pi] = ['T', 'K', 'type', 'price'].map(ix)
  const out: { T: number; K: number; iv: number; delta: number; k: number; call: boolean }[] = []
  if ([ti, ki, yi, pi].some((i) => i < 0)) return out
  for (const row of table.rows) {
    const T = toNumber(row[ti]), K = toNumber(row[ki]), p = toNumber(row[pi]), call = /콜|call|c$/i.test(toLabel(row[yi]))
    if (T == null || K == null || p == null || T <= 0 || K <= 0) continue
    const F = S * Math.exp(r * T)
    if ((call && K < F) || (!call && K >= F)) continue // out-of-the-money options only
    const iv = impliedVol(p, S, K, T, r, call)
    if (Number.isFinite(iv)) out.push({ T, K, iv, delta: bsDelta({ S, K, T, r, sigma: iv, call }), k: Math.log(K / F), call })
  }
  return out
}

function interp(xs: number[], ys: number[], x: number) {
  if (xs.length === 1) return ys[0]
  if (x <= xs[0]) return ys[0]
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1])
  return ys[ys.length - 1]
}

function IvSmileChart({ table, mapping, params, width, height, compact }: ChartProps<IvParams>) {
  const pts = useMemo(() => ivPoints(table, mapping, params.spot, params.rate / 100), [table, mapping, params.spot, params.rate])
  const expiries = useMemo(() => [...new Set(pts.map((p) => p.T))].sort((a, b) => a - b), [pts])
  if (pts.length < 4) return <ChartMessage>만기·행사가·유형(콜/풋)·가격 열을 선택하세요. 내재변동성을 구할 수 있는 옵션이 4개 이상 필요합니다.</ChartMessage>
  const sel = expiries[Math.min(params.expiry, expiries.length - 1)]
  const xOf = (p: (typeof pts)[number]) => (params.x === 'strike' ? p.K : params.x === 'moneyness' ? p.k : p.call ? p.delta : 1 + p.delta)
  const layers: Layer[] = []
  const shown = params.all ? expiries : [sel]
  shown.forEach((T, i) => {
    const s = pts.filter((p) => p.T === T).sort((a, b) => xOf(a) - xOf(b))
    const col = params.all ? d3.interpolateViridis(i / Math.max(1, shown.length - 1) * 0.85) : '#2a8c82'
    layers.push({ kind: 'line', x: s.map(xOf), y: s.map((p) => p.iv), color: col, width: params.all ? 2 : 2.8, label: `${fmt(T * 12, 0)}개월`, opacity: 0.9 })
    layers.push({ kind: 'points', color: col, r: compact ? 2 : 3.6, pts: s.map((p, k) => ({ x: xOf(p), y: p.iv, key: `${T}-${k}`, tip: <><b>{fmt(T * 12, 0)}개월 · 행사가 {fmt(p.K, 1)} ({p.call ? '콜' : '풋'})</b><br />내재변동성 {pct(p.iv, 1)}<br />델타 {fmt(p.delta, 2)} · 로그 머니니스 {fmt(p.k, 3)}</> })) })
  })
  const s = pts.filter((p) => p.T === sel).sort((a, b) => a.k - b.k)
  const atm = interp(s.map((p) => p.k), s.map((p) => p.iv), 0)
  const byDelta = [...s].sort((a, b) => (a.call ? a.delta : 1 + a.delta) - (b.call ? b.delta : 1 + b.delta))
  const at = (d: number) => interp(byDelta.map((p) => (p.call ? p.delta : 1 + p.delta)), byDelta.map((p) => p.iv), d)
  const rr = at(0.25) - at(0.75), bf = (at(0.75) + at(0.25)) / 2 - atm
  return (
    <XYPlot hover={false} layers={layers} width={width} height={height} compact={compact} yFormat={(v) => pct(v, 0)} xLabel={params.x === 'strike' ? '행사가' : params.x === 'moneyness' ? '로그 머니니스 ln(K/F)' : '콜 델타 (풋은 1 + 델타)'} yLabel="내재변동성" title={`내재변동성 스마일: ${params.all ? '모든 만기' : `${fmt(sel * 12, 0)}개월`}`}
      readout={[{ label: 'ATM 내재변동성', value: pct(atm, 1) }, { label: '25Δ 리스크 리버설', value: pct(rr, 1) }, { label: '25Δ 버터플라이', value: pct(bf, 1) }, { label: '유효 옵션', value: pts.length }]}
      note={`OTM 옵션의 가격에서 블랙–숄즈를 역산 · ${disclaimer}`} />
  )
}

function IvControls({ params, setParams, table, mapping, surface }: ControlsProps<IvParams> & { surface?: boolean }) {
  const pts = useMemo(() => ivPoints(table, mapping, params.spot, params.rate / 100), [table, mapping, params.spot, params.rate])
  const exp = [...new Set(pts.map((p) => p.T))].sort((a, b) => a - b)
  return (
    <>
      <ControlGroup title="옵션 가정">
        <Slider label="현물 가격 S" value={params.spot} min={50} max={200} onChange={(spot) => setParams({ spot })} testId="ctl-spot" />
        <Slider label="무위험 이자율 (연 %)" value={params.rate} min={0} max={8} step={0.25} onChange={(rate) => setParams({ rate })} testId="ctl-rate" />
        {!surface && <>
          <Segmented label="가로축" value={params.x} onChange={(x) => setParams({ x })} testId="ctl-x" options={[{ value: 'strike', label: '행사가' }, { value: 'moneyness', label: '머니니스' }, { value: 'delta', label: '델타' }]} />
          <Toggle label="모든 만기 겹쳐 보기" checked={params.all} onChange={(all) => setParams({ all })} />
          {!params.all && exp.length > 1 && <Slider label="만기" value={Math.min(params.expiry, exp.length - 1) + 1} min={1} max={exp.length} onChange={(v) => setParams({ expiry: v - 1 })} testId="ctl-expiry" format={(v) => `${fmt(exp[v - 1] * 12, 0)}개월`} />}
        </>}
        <Hint>옵션 시세에서 블랙–숄즈 모형의 변동성을 거꾸로 풀어(이분법) 내재변동성을 구합니다. 행사가가 선물가격 F = S·e^(rT)보다 낮으면 풋, 높으면 콜(외가격 옵션)만 써서 안정적으로 계산합니다. 블랙–숄즈는 모든 행사가에서 변동성이 같다고 가정하지만 시장 가격은 보통 낮은 행사가에서 더 높은 변동성(스큐)과 양 끝이 올라간 미소(스마일)를 보입니다. 25Δ 리스크 리버설 = IV(25Δ 콜) − IV(25Δ 풋)은 비대칭, 버터플라이는 양 끝의 평균 − ATM으로 꼬리의 두께를 나타냅니다. 합성 시세이며 실제 시장 자료가 아닙니다.</Hint>
      </ControlGroup>
      {surface && <ViewControls params={params} setParams={setParams} />}
    </>
  )
}

const ivDefaults: IvParams = { yaw: -38, pitch: 28, zoom: 1.0, spot: 100, rate: 3, x: 'moneyness', expiry: 3, all: false, zScale: 1, points: true }
export const ivSmileModule: VizModule<IvParams> = {
  roles: optionRoles, datasets: ['option-chain'], defaultParams: ivDefaults,
  Chart: IvSmileChart, Controls: (p) => <IvControls {...p} />, hint: '가로축을 델타로 바꾸면 25Δ 리스크 리버설과 버터플라이가 읽힙니다 · 만기를 겹쳐 보며 스마일이 만기에 따라 어떻게 변하는지 보세요 (합성 시세)',
}

function IvSurfaceChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<IvParams>) {
  const pts = useMemo(() => ivPoints(table, mapping, params.spot, params.rate / 100), [table, mapping, params.spot, params.rate])
  const expiries = useMemo(() => [...new Set(pts.map((p) => p.T))].sort((a, b) => a - b), [pts])
  const model = useMemo(() => {
    if (pts.length < 8 || expiries.length < 2) return null
    const kmin = Math.min(...pts.map((p) => p.k)), kmax = Math.max(...pts.map((p) => p.k))
    const slices = expiries.map((T) => { const s = pts.filter((p) => p.T === T).sort((a, b) => a.k - b.k); return { T, k: s.map((p) => p.k), w: s.map((p) => p.iv * p.iv * T) } })
    const nk = compact ? 12 : 26, nt = compact ? 8 : 18
    const ks = d3.range(nk).map((i) => kmin + ((kmax - kmin) * i) / (nk - 1)), ts = d3.range(nt).map((i) => expiries[0] + ((expiries[expiries.length - 1] - expiries[0]) * i) / (nt - 1))
    const grid = ts.map((T) => ks.map((k) => {
      // total variance is interpolated linearly in k within each expiry and linearly in T between expiries
      let j = 0; while (j < expiries.length - 2 && T > expiries[j + 1]) j++
      const wa = interp(slices[j].k, slices[j].w, k), wb = interp(slices[j + 1].k, slices[j + 1].w, k)
      const u = (T - expiries[j]) / (expiries[j + 1] - expiries[j])
      return Math.sqrt(Math.max(1e-6, (wa + (wb - wa) * Math.max(0, Math.min(1, u))) / T))
    }))
    return { ks, ts, grid, kmin, kmax, lo: Math.min(...grid.flat()), hi: Math.max(...grid.flat()) }
  }, [pts, expiries, compact])
  if (!model) return <ChartMessage>만기가 2개 이상인 옵션 시세가 필요합니다 (만기·행사가·유형·가격).</ChartMessage>
  const { ks, ts, grid, lo, hi } = model
  const norm = (k: number, T: number, v: number): [number, number, number] => [((k - model.kmin) / (model.kmax - model.kmin)) * 2 - 1, ((T - ts[0]) / (ts[ts.length - 1] - ts[0])) * 2 - 1, (((v - lo) / (hi - lo || 1)) * 1.4 - 0.2) * params.zScale]
  const draw = (ctx: CanvasRenderingContext2D, proj: Projector) => {
    const quads: Quad[] = []
    for (let j = 0; j < ts.length - 1; j++) for (let i = 0; i < ks.length - 1; i++) {
      const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => proj(norm(ks[a], ts[b], grid[b][a])))
      const v = (grid[j][i] + grid[j + 1][i + 1]) / 2
      const f = schemes.viridis.interpolate(0.1 + 0.85 * ((v - lo) / (hi - lo || 1)))
      quads.push({ pts: c.map((p) => [p.x, p.y] as [number, number]), depth: c.reduce((s, p) => s + p.depth, 0) / 4, fill: f, stroke: 'rgba(255,255,255,.55)' })
    }
    drawQuads(ctx, quads, 0.5)
  }
  const atmTs = expiries.map((T) => { const s = pts.filter((p) => p.T === T).sort((a, b) => a.k - b.k); return interp(s.map((p) => p.k), s.map((p) => p.iv), 0) })
  return (
    <Scene3D width={width} height={height} compact={compact} params={params} setParams={setParams} label="내재변동성 곡면" draw={draw} drawKey={`${params.zScale}|${lo}|${hi}|${ks.length}|${compact}`} fit={0.4}
      labels={[{ at: [1, -1, -0.2], text: '머니니스 →', anchor: 'start' }, { at: [-1, 1, -0.2], text: '만기 →', anchor: 'end' }, { at: [-1, -1, 1.2], text: '내재변동성', anchor: 'end' }]}
      overlay={(proj, stage) => params.points && !compact ? <g>{pts.map((p, i) => { const q = proj(norm(p.k, p.T, p.iv)); return <circle key={i} cx={q.x} cy={q.y} r={2.6} fill="#fff" stroke="#111827" strokeWidth={1} onPointerEnter={(e) => stage.at(e, <><b>{fmt(p.T * 12, 0)}개월 · K {fmt(p.K, 1)}</b><br />IV {pct(p.iv, 1)}</>)} /> })}</g> : null}
      readout={[{ label: 'ATM 기간 구조', value: expiries.map((T, i) => `${fmt(T * 12, 0)}m ${pct(atmTs[i], 0)}`).join(' · ') }, { label: '범위', value: `${pct(lo, 0)} ~ ${pct(hi, 0)}` }]} note={`곡면 = 총분산을 행사가·만기 방향으로 선형 보간 · ${disclaimer}`} />
  )
}

export const ivSurfaceModule: VizModule<IvParams> = {
  roles: optionRoles, datasets: ['option-chain'], defaultParams: { ...ivDefaults, zScale: 1 },
  Chart: IvSurfaceChart, Controls: (p) => (<><IvControls {...p} surface /><ControlGroup title="표시"><Slider label="높이 배율" value={p.params.zScale} min={0.4} max={2} step={0.1} onChange={(zScale) => p.setParams({ zScale })} testId="ctl-zscale" /><Toggle label="관측 옵션 점" checked={p.params.points} onChange={(points) => p.setParams({ points })} /></ControlGroup></>),
  hint: '끌어서 회전 · 점은 실제 시세에서 역산한 내재변동성, 면은 사이를 보간한 곡면 · 단기 만기일수록 스마일이 가파릅니다 (합성 시세)',
}

// ─── order-flow footprint ───────────────────────────────────────────────────────────

export interface FootprintParams { ratio: number; showDelta: boolean }
const footRoles: RoleSpec[] = [
  { key: 'bar', label: '캔들 번호', type: 'number', required: true, prefer: '캔들|bar' },
  { key: 'price', label: '가격 수준', type: 'number', required: true, prefer: '가격|price' },
  { key: 'buy', label: '매수 체결량 (ask 체결)', type: 'number', required: true, prefer: '매수|buy|ask' },
  { key: 'sell', label: '매도 체결량 (bid 체결)', type: 'number', required: true, prefer: '매도|sell|bid' },
]

function FootprintChart({ table, mapping, params, width, height, compact }: ChartProps<FootprintParams>) {
  const stage = useStage()
  const data = useMemo(() => {
    const ix = ['bar', 'price', 'buy', 'sell'].map((k) => columnIndex(table, roleColumn(mapping, k)))
    const rows: { bar: number; price: number; buy: number; sell: number }[] = []
    if (ix.every((i) => i >= 0)) for (const r of table.rows) { const v = ix.map((i) => toNumber(r[i])); if (v.every((x) => x != null)) rows.push({ bar: v[0]!, price: v[1]!, buy: v[2]!, sell: v[3]! }) }
    return rows
  }, [table, mapping])
  if (data.length < 4) return <ChartMessage>캔들 번호, 가격 수준, 매수·매도 체결량 열을 선택하세요.</ChartMessage>
  const bars = [...new Set(data.map((d) => d.bar))].sort((a, b) => a - b)
  const prices = [...new Set(data.map((d) => d.price))].sort((a, b) => a - b)
  const step = Math.min(...prices.slice(1).map((p, i) => p - prices[i])) || 0.1
  const m = { top: compact ? 6 : 48, right: compact ? 6 : 24, bottom: compact ? 6 : params.showDelta ? 96 : 40, left: compact ? 6 : 56 }
  const iw = width - m.left - m.right, ih = height - m.top - m.bottom
  const pmin = prices[0], pmax = prices[prices.length - 1]
  const levels = Math.round((pmax - pmin) / step) + 1
  const cw = iw / bars.length, ch = Math.min(26, ih / levels)
  const y = (p: number) => ih - ((p - pmin) / step + 1) * (ih / levels)
  const vmax = Math.max(...data.map((d) => d.buy + d.sell))
  const stats = bars.map((b) => { const s = data.filter((d) => d.bar === b), delta = d3.sum(s, (d) => d.buy - d.sell), tot = d3.sum(s, (d) => d.buy + d.sell), poc = s.reduce((a, d) => (d.buy + d.sell > a.buy + a.sell ? d : a), s[0]); return { b, delta, tot, poc: poc.price } })
  let cum = 0
  const cumDelta = stats.map((s) => (cum += s.delta))
  const dmax = Math.max(...stats.map((s) => Math.abs(s.delta)), 1), cmax = Math.max(...cumDelta.map(Math.abs), 1)
  return (
    <Stage stage={stage} width={width} height={height} compact={compact} label={`체결 푸트프린트: ${bars.length}개 캔들`} readout={[{ label: '총 체결', value: fmt(d3.sum(stats, (s) => s.tot), 0) }, { label: '누적 델타', value: fmt(cumDelta[cumDelta.length - 1], 0) }, { label: '불균형 기준', value: `${params.ratio}배` }]} note={`칸 = 매도 × 매수, 굵은 테두리 = 불균형 · ${disclaimer}`}>
      <g transform={`translate(${m.left},${m.top})`}>
        {!compact && [...prices].filter((_, i) => i % Math.ceil(levels / 14) === 0).map((p) => <text key={p} x={-6} y={y(p) + ch / 2} dy="0.34em" textAnchor="end" fontSize={10.5} fill="#6b7280">{p.toFixed(1)}</text>)}
        {bars.map((b, bi) => {
          const x0 = bi * cw
          return (
            <g key={b} transform={`translate(${x0},0)`}>
              {data.filter((d) => d.bar === b).map((d, k) => {
                const tot = d.buy + d.sell, w = (cw - 3), bw = (d.buy / Math.max(1, tot)) * w
                const impBuy = d.buy >= params.ratio * Math.max(1, d.sell), impSell = d.sell >= params.ratio * Math.max(1, d.buy)
                const strength = Math.min(1, tot / vmax)
                return (
                  <g key={k} data-testid="fp-cell" transform={`translate(1.5,${y(d.price)})`} onPointerEnter={compact ? undefined : (e) => stage.at(e, <><b>캔들 {b} · 가격 {d.price.toFixed(1)}</b><br />매도 {d.sell} × 매수 {d.buy}<br />델타 {d.buy - d.sell}{impBuy ? ' · 매수 불균형' : impSell ? ' · 매도 불균형' : ''}</>)}>
                    <rect width={bw} height={ch - 1} fill="#2a8c82" fillOpacity={0.25 + 0.6 * strength} /><rect x={bw} width={w - bw} height={ch - 1} fill="#cf4f6a" fillOpacity={0.25 + 0.6 * strength} />
                    {(impBuy || impSell) && <rect width={w} height={ch - 1} fill="none" stroke={impBuy ? '#0f766e' : '#9f1239'} strokeWidth={2} />}
                    {!compact && cw > 54 && ch > 11 && <text x={w / 2} y={(ch - 1) / 2} dy="0.34em" textAnchor="middle" fontSize={9.5} fill="#111827" pointerEvents="none">{d.sell} × {d.buy}</text>}
                    {d.price === stats[bi].poc && <rect x={-1} y={-1} width={w + 2} height={ch + 1} fill="none" stroke="#d4a53a" strokeWidth={2.4} strokeDasharray="4 2" />}
                  </g>
                )
              })}
              {!compact && <text x={cw / 2} y={-10} textAnchor="middle" fontSize={11} fill="#374151">캔들 {b}</text>}
              {!compact && params.showDelta && (
                <g transform={`translate(0,${ih + 14})`}>
                  <rect x={cw * 0.2} y={stats[bi].delta >= 0 ? 24 - (stats[bi].delta / dmax) * 24 : 24} width={cw * 0.6} height={(Math.abs(stats[bi].delta) / dmax) * 24} fill={stats[bi].delta >= 0 ? '#2a8c82' : '#cf4f6a'} />
                  <text x={cw / 2} y={-2} textAnchor="middle" fontSize={9.5} fill="#6b7280">{stats[bi].delta > 0 ? '+' : ''}{stats[bi].delta}</text>
                  <circle cx={cw / 2} cy={66 - (cumDelta[bi] / cmax) * 14} r={3} fill="#4c6fb5" />
                  {bi > 0 && <line x1={-cw / 2} y1={66 - (cumDelta[bi - 1] / cmax) * 14} x2={cw / 2} y2={66 - (cumDelta[bi] / cmax) * 14} stroke="#4c6fb5" strokeWidth={1.6} />}
                </g>
              )}
            </g>
          )
        })}
        {!compact && params.showDelta && <><text x={-6} y={ih + 38} textAnchor="end" fontSize={10.5} fill="#6b7280">델타</text><text x={-6} y={ih + 80} textAnchor="end" fontSize={10.5} fill="#4c6fb5">누적</text></>}
      </g>
    </Stage>
  )
}

function FootprintControls({ params, setParams }: ControlsProps<FootprintParams>) {
  return (
    <ControlGroup title="푸트프린트">
      <Slider label="불균형 기준 (배)" value={params.ratio} min={1.5} max={6} step={0.5} onChange={(ratio) => setParams({ ratio })} testId="ctl-ratio" />
      <Toggle label="캔들별 델타와 누적 델타" checked={params.showDelta} onChange={(showDelta) => setParams({ showDelta })} testId="ctl-delta" />
      <Hint>시세 차트가 한 캔들의 시·고·저·종만 보여준다면, 푸트프린트는 같은 캔들 안에서 각 가격 수준에 체결된 매도(bid 체결)·매수(ask 체결) 수량을 칸마다 적습니다. 한쪽이 상대의 기준 배수 이상이면 불균형(굵은 테두리)으로 보고, 한 캔들에서 거래가 가장 많이 일어난 가격(점선 테두리)이 POC입니다. 델타 = 매수 − 매도 체결량이며 누적 델타는 그 합입니다. 가격이 오르는데 델타가 줄면 상승의 힘이 약해진다는 식의 해석이 쓰이지만 이는 과거 체결의 기술적 요약일 뿐 예측이 아니며, 합성 자료입니다.</Hint>
    </ControlGroup>
  )
}

export const footprintModule: VizModule<FootprintParams> = {
  roles: footRoles, datasets: ['trade-footprint'], defaultParams: { ratio: 3, showDelta: true },
  Chart: FootprintChart, Controls: FootprintControls, hint: '칸에 올려 매도×매수 체결량을 확인하세요 · 불균형 기준을 바꿔 한쪽으로 쏠린 가격대를 찾아보세요 (합성 체결)',
}

// ─── order-book heatmap ─────────────────────────────────────────────────────────────

export interface BookParams { log: boolean; mid: boolean }
const bookRoles: RoleSpec[] = [
  { key: 't', label: '시점', type: 'number', required: true, prefer: '시점|t|time' },
  { key: 'price', label: '가격', type: 'number', required: true, prefer: '가격|price' },
  { key: 'size', label: '호가 잔량', type: 'number', required: true, prefer: '잔량|size' },
  { key: 'side', label: '측 (매수/매도)', type: 'category', required: true, prefer: '측|side' },
]

function BookChart({ table, mapping, params, width, height, compact }: ChartProps<BookParams>) {
  const model = useMemo(() => {
    const ix = ['t', 'price', 'size', 'side'].map((k) => columnIndex(table, roleColumn(mapping, k)))
    const rows: { t: number; p: number; s: number; bid: boolean }[] = []
    if (ix.every((i) => i >= 0)) for (const r of table.rows) { const t = toNumber(r[ix[0]]), p = toNumber(r[ix[1]]), s = toNumber(r[ix[2]]); if (t != null && p != null && s != null) rows.push({ t, p, s, bid: /매수|bid|buy/i.test(toLabel(r[ix[3]])) }) }
    if (rows.length < 8) return null
    const ts = [...new Set(rows.map((r) => r.t))].sort((a, b) => a - b), ps = [...new Set(rows.map((r) => Math.round(r.p * 1000) / 1000))].sort((a, b) => a - b)
    const step = Math.min(...ps.slice(1).map((p, i) => p - ps[i])) || 0.1
    const ny = Math.round((ps[ps.length - 1] - ps[0]) / step) + 1
    const z = new Array<number>(ts.length * ny).fill(NaN)
    const tIdx = new Map(ts.map((t, i) => [t, i]))
    for (const r of rows) { const j = Math.round((r.p - ps[0]) / step), i = tIdx.get(r.t)!; z[j * ts.length + i] = r.bid ? -r.s : r.s }
    const mid = ts.map((t) => { const at = rows.filter((r) => r.t === t); const bb = Math.max(...at.filter((r) => r.bid).map((r) => r.p)), ba = Math.min(...at.filter((r) => !r.bid).map((r) => r.p)); return { t, bid: bb, ask: ba, mid: (bb + ba) / 2 } })
    return { ts, ps, ny, z, mid, step, smax: Math.max(...rows.map((r) => r.s)) }
  }, [table, mapping])
  if (!model) return <ChartMessage>시점, 가격, 잔량, 측(매수/매도) 열을 선택하세요.</ChartMessage>
  const spread = d3.mean(model.mid.map((m) => m.ask - m.bid)) ?? 0
  const bidTot = d3.sum(model.z.filter((v) => v < 0).map((v) => -v)), askTot = d3.sum(model.z.filter((v) => v > 0))
  const colorFn = (v: number) => { const a = Math.min(1, (params.log ? Math.log1p(Math.abs(v)) / Math.log1p(model.smax) : Math.abs(v) / model.smax)); return v < 0 ? d3.interpolateBlues(0.12 + 0.88 * a) : d3.interpolateReds(0.12 + 0.88 * a) }
  return (
    <XYPlot hover layers={[
      { kind: 'raster', nx: model.ts.length, ny: model.ny, z: model.z, x0: model.ts[0] - 0.5, x1: model.ts[model.ts.length - 1] + 0.5, y0: model.ps[0] - model.step / 2, y1: model.ps[model.ps.length - 1] + model.step / 2, color: colorFn },
      ...(params.mid ? [{ kind: 'line', x: model.mid.map((m) => m.t), y: model.mid.map((m) => m.mid), color: '#111827', width: 2.2, label: '중간가' } as Layer] : []),
    ]} width={width} height={height} compact={compact} grid={false} pad={0} xDomain={[model.ts[0] - 0.5, model.ts[model.ts.length - 1] + 0.5]} yDomain={[model.ps[0] - model.step / 2, model.ps[model.ps.length - 1] + model.step / 2]} xLabel="시점" yLabel="가격" title="호가 잔량 히트맵: 시간에 따른 가격 수준별 잔량"
      readout={[{ label: '평균 스프레드', value: fmt(spread, 2) }, { label: '매수/매도 잔량', value: `${fmt(bidTot / Math.max(1, askTot), 2)}배` }, { label: '최대 잔량', value: fmt(model.smax, 0) }]}
      note={`파랑 = 매수 호가, 빨강 = 매도 호가, 진할수록 잔량이 큼 · ${disclaimer}`} />
  )
}

function BookControls({ params, setParams }: ControlsProps<BookParams>) {
  return (
    <ControlGroup title="호가 히트맵">
      <Toggle label="로그 색 눈금" checked={params.log} onChange={(log) => setParams({ log })} testId="ctl-log" />
      <Toggle label="중간가 선" checked={params.mid} onChange={(mid) => setParams({ mid })} />
      <Hint>호가창의 한 장면(깊이 그래프)이 아니라 시간에 따른 변화를 보는 히트맵입니다. 가로는 시간, 세로는 가격이고 색의 진하기가 그 가격에 쌓인 잔량입니다(매수 파랑, 매도 빨강). 큰 잔량이 오래 머무는 가로 줄은 지지·저항 ‘벽’으로 보이고, 가격이 벽에 닿기 전에 사라지는 호가는 스푸핑 가능성의 단서가 되기도 합니다. 중간가 선은 최우선 매수·매도호가의 평균입니다. 호가는 체결 없이 취소·변경될 수 있으므로 잔량이 곧 실제 거래 의지는 아닙니다. 합성 자료입니다.</Hint>
    </ControlGroup>
  )
}

export const bookHeatmapModule: VizModule<BookParams> = {
  roles: bookRoles, datasets: ['book-snapshots'], defaultParams: { log: true, mid: true },
  Chart: BookChart, Controls: BookControls, hint: '진한 가로 줄이 오래 머문 호가 벽입니다 · 중간가가 벽 근처에서 어떻게 움직이는지 보세요 (합성 호가)',
}

// ─── event study ────────────────────────────────────────────────────────────────────

export interface EventParams { pre: number; post: number; individual: boolean }
const eventRoles: RoleSpec[] = [
  { key: 'event', label: '사건', type: 'category', required: true, prefer: '사건|event' },
  { key: 'day', label: '사건일 기준 일 (0 = 사건일)', type: 'number', required: true, prefer: '일|day|offset' },
  { key: 'stock', label: '종목 수익률', type: 'number', required: true, prefer: '종목|stock' },
  { key: 'market', label: '시장 수익률', type: 'number', required: true, prefer: '시장|market' },
]

function EventChart({ table, mapping, params, width, height, compact }: ChartProps<EventParams>) {
  const res = useMemo(() => {
    const ix = ['event', 'day', 'stock', 'market'].map((k) => columnIndex(table, roleColumn(mapping, k)))
    const rows: EventRow[] = []
    if (ix.every((i) => i >= 0)) for (const r of table.rows) { const d = toNumber(r[ix[1]]), s = toNumber(r[ix[2]]), m = toNumber(r[ix[3]]); if (d != null && s != null && m != null) rows.push({ event: toLabel(r[ix[0]]), offset: d, stock: s, market: m }) }
    return rows.length >= 30 ? eventStudy(rows, params.pre, params.post) : null
  }, [table, mapping, params.pre, params.post])
  if (!res || res.n < 2) return <ChartMessage>사건·일·종목 수익률·시장 수익률 열을 선택하세요. 사건이 2개 이상, 사건 전 추정 구간(−{params.pre}일 이전)이 사건마다 5일 이상 필요합니다.</ChartMessage>
  const se = res.sdCar.map((s) => s / Math.sqrt(res.n))
  const last = res.caar.length - 1
  const sig = Math.abs(res.t[last]) > 1.96
  const common = { width, compact }
  const car: Layer[] = [
    { kind: 'band', x: res.days, lo: res.caar.map((v, i) => v - 1.96 * se[i]), hi: res.caar.map((v, i) => v + 1.96 * se[i]), color: '#2a8c82', opacity: 0.18 },
    ...(params.individual ? res.perEvent.map((e): Layer => ({ kind: 'line', x: res.days, y: e.car, color: '#9aa1a9', width: 1, opacity: 0.5, tip: <><b>{e.event}</b><br />CAR {pct(e.car[e.car.length - 1], 1)}<br />β = {fmt(e.mm.beta, 2)}</> })) : []),
    { kind: 'hline', v: 0, color: '#9ca3af', dash: '0' }, { kind: 'vline', v: 0, color: '#e07a3f' },
    { kind: 'line', x: res.days, y: res.caar, color: '#2a8c82', width: 3, label: 'CAAR (평균 누적 초과수익률)' },
  ]
  const readout = [{ label: 'CAAR(최종)', value: pct(res.caar[last], 2) }, { label: 't 통계량', value: fmt(res.t[last], 2) }, { label: '판정', value: sig ? '유의 (|t| > 1.96)' : '유의하지 않음' }, { label: '사건', value: res.n }]
  if (compact) return <XYPlot {...common} height={height} compact layers={car} title="사건 연구" />
  return (
    <Panels width={width} height={height} parts={[2, 3]}>
      {[
        (h) => <XYPlot {...common} height={h} hover xLabel="" yLabel="평균 초과수익률 AAR" title={`사건 연구: 사건일 0일, 추정 구간은 −${params.pre}일 이전`} yFormat={(v) => pct(v, 1)} margin={{ bottom: 22 }} layers={[{ kind: 'hline', v: 0, color: '#9ca3af', dash: '0' }, { kind: 'bars', x: res.days, y: res.aar, w: 0.8, color: res.aar.map((v) => (v >= 0 ? '#2a8c82' : '#cf4f6a')), label: 'AAR' }]} readout={readout} />,
        (h) => <XYPlot {...common} height={h} hover title="누적 초과수익률" xLabel="사건일 기준 일" yLabel="누적 초과수익률 CAR" yFormat={(v) => pct(v, 1)} margin={{ top: 12 }} layers={car} note={`띠 = 95% 신뢰구간 · ${disclaimer}`} />,
      ]}
    </Panels>
  )
}

function EventControls({ params, setParams }: ControlsProps<EventParams>) {
  return (
    <ControlGroup title="사건 연구">
      <Slider label="사건 전 창 (일)" value={params.pre} min={1} max={20} onChange={(pre) => setParams({ pre })} testId="ctl-pre" />
      <Slider label="사건 후 창 (일)" value={params.post} min={1} max={20} onChange={(post) => setParams({ post })} testId="ctl-post" />
      <Toggle label="사건별 CAR 선 겹치기" checked={params.individual} onChange={(individual) => setParams({ individual })} testId="ctl-individual" />
      <Hint>사건 전 추정 구간(−창 이전)에서 시장모형 R = α + β·R_m을 OLS로 맞춘 뒤, 사건 창에서 실제 수익률과 모형이 예상한 수익률의 차이인 초과수익률(AR)을 구합니다. 사건별 AR을 누적한 CAR을 사건 전체에 걸쳐 평균하면 CAAR이며 그 표준오차 s/√N으로 신뢰구간과 t 통계량을 냅니다. 사건일에 값이 뛰고 이후에도 유지되면 정보가 가격에 반영된 것으로, 사건 전부터 오르면 정보 유출을 의심합니다. 같은 시기의 다른 사건(혼재 효과), 추정 구간의 선택, 사건 수가 적을 때의 검정력 부족에 유의하세요.</Hint>
    </ControlGroup>
  )
}

export const eventModule: VizModule<EventParams> = {
  roles: eventRoles, datasets: ['event-returns'], defaultParams: { pre: 10, post: 10, individual: true },
  Chart: EventChart, Controls: EventControls, hint: '사건일(주황 선) 전후의 누적 초과수익률을 보세요 · 창의 길이를 바꿔 결론이 유지되는지 확인하세요 (합성 사건)',
}

// ─── VaR and expected shortfall ─────────────────────────────────────────────────────

export interface VarParams { alpha: number; method: 'historical' | 'normal' | 'cornish'; bins: number }
const pnlRoles: RoleSpec[] = [{ key: 'pnl', label: '손익 (이익 +, 손실 −)', type: 'number', required: true, prefer: '손익|pnl' }]

function VarChart({ table, mapping, params, width, height, compact }: ChartProps<VarParams>) {
  const x = useMemo(() => { const i = columnIndex(table, roleColumn(mapping, 'pnl')); return i < 0 ? [] : table.rows.map((r) => toNumber(r[i])).filter((v): v is number => v != null) }, [table, mapping])
  if (x.length < 50) return <ChartMessage>손익 열을 선택하세요. 관측이 50개 이상 필요합니다.</ChartMessage>
  const a = params.alpha / 100
  const m = d3.mean(x)!, sd = d3.deviation(x)!
  const hist = historicalVarEs(x, a), nrm = normalVarEs(m, sd, a), cf = cornishFisherVar(x, a)
  const use = params.method === 'historical' ? { v: hist.var, e: hist.es } : params.method === 'normal' ? { v: nrm.var, e: nrm.es } : { v: cf.var, e: hist.es }
  const lo = Math.min(...x), hi = Math.max(...x)
  const bins = d3.bin().domain([lo, hi]).thresholds(params.bins)(x)
  const w = (hi - lo) / params.bins
  const tailX = bins.map((b) => ((b.x0 ?? 0) + (b.x1 ?? 0)) / 2)
  const grid = d3.range(0, 161).map((i) => lo + ((hi - lo) * i) / 160)
  const exceed = x.filter((v) => -v > use.v).length
  const kup = kupiecLR(exceed, x.length, a), p = chiSquareSf(kup, 1)
  const layers: Layer[] = [
    { kind: 'bars', x: tailX, y: bins.map((b) => b.length / x.length / w), w: w * 0.96, color: tailX.map((v) => (-v > use.v ? '#cf4f6a' : '#9ab8b4')), label: '손익 분포 (꼬리 = 손실 초과분)' },
    { kind: 'line', x: grid, y: grid.map((g) => Math.exp(-0.5 * ((g - m) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI))), color: '#111827', width: 1.8, dash: '5 4', label: '같은 평균·표준편차의 정규분포' },
    { kind: 'vline', v: -use.v, color: '#cf4f6a', dash: '0', width: 2.4 }, { kind: 'vline', v: -use.e, color: '#7f1d1d', dash: '4 3', width: 2 },
    { kind: 'text', x: -use.v, y: 0, text: `VaR ${fmt(use.v, 2)}`, anchor: 'end', size: 11, color: '#cf4f6a' }, { kind: 'text', x: -use.e, y: 0, text: `ES ${fmt(use.e, 2)}`, anchor: 'end', size: 11, color: '#7f1d1d' },
  ]
  return (
    <XYPlot hover={false} layers={layers} width={width} height={height} compact={compact} xLabel="일 손익" yLabel="밀도" title={`${100 - params.alpha}% VaR와 기대손실(ES): ${({ historical: '역사적', normal: '정규', cornish: 'Cornish–Fisher' })[params.method]}`}
      readout={[{ label: 'VaR', value: fmt(use.v, 2) }, { label: 'ES', value: fmt(use.e, 2) }, { label: '왜도·초과첨도', value: `${fmt(cf.skew, 2)} · ${fmt(cf.kurt, 2)}` }, { label: `Kupiec p (초과 ${exceed}/${x.length})`, value: fmt(p, 3) }]}
      note={`${disclaimer} · 정규 가정은 꼬리를 과소평가할 수 있음`} />
  )
}

function VarControls({ params, setParams }: ControlsProps<VarParams>) {
  return (
    <ControlGroup title="꼬리 위험">
      <Slider label="유의수준 α (%)" value={params.alpha} min={1} max={10} step={0.5} onChange={(alpha) => setParams({ alpha })} testId="ctl-alpha" format={(v) => `${v}% (신뢰 ${100 - v}%)`} />
      <Segmented label="계산 방법" value={params.method} onChange={(method) => setParams({ method })} testId="ctl-method" options={[{ value: 'historical', label: '역사적' }, { value: 'normal', label: '정규' }, { value: 'cornish', label: 'Cornish–Fisher' }]} />
      <Slider label="히스토그램 구간 수" value={params.bins} min={15} max={80} onChange={(bins) => setParams({ bins })} testId="ctl-bins" />
      <Hint>VaR(위험가치)는 손실이 이 값을 넘을 확률이 α인 경계(손익 분포의 α 분위수의 부호를 바꾼 값)이고, ES(기대손실, CVaR)는 그 경계를 넘는 날들의 평균 손실입니다. VaR는 ‘얼마까지’만, ES는 ‘넘으면 평균 얼마나’까지 알려 주어 꼬리가 두꺼울수록 둘의 차이가 커집니다. 역사적 방법은 표본 분위수, 정규 방법은 μ − zσ, Cornish–Fisher는 왜도·첨도로 정규 분위수를 보정합니다. Kupiec 검정은 VaR를 넘은 날의 비율이 α와 같은지(χ²₁) 보는 백테스트입니다. 합성 손익이며 위험 한도나 투자를 정하는 근거가 아닙니다.</Hint>
    </ControlGroup>
  )
}

export const varModule: VizModule<VarParams> = {
  roles: pnlRoles, datasets: ['pnl-fat'], defaultParams: { alpha: 5, method: 'historical', bins: 40 },
  Chart: VarChart, Controls: VarControls, hint: '방법을 정규로 바꿔 두꺼운 꼬리에서 VaR·ES가 얼마나 작게 나오는지 비교하세요 · α를 1%로 줄이면 꼬리 위험이 두드러집니다 (합성 손익)',
}

// ─── risk contribution ──────────────────────────────────────────────────────────────

export interface RiskContribParams { mode: 'manual' | 'equal' | 'erc' | 'minvar'; w: number[] }

function RiskContribChart({ table, mapping, params, width, height, compact }: ChartProps<RiskContribParams>) {
  const stage = useStage()
  const { names, R } = useMemo(() => returnsOf(table, mapping), [table, mapping])
  const model = useMemo(() => {
    if (R.length < 12 || names.length < 2) return null
    const S = covariance(R).map((r) => r.map((v) => v * 12))
    const p = names.length
    const manual = Array.from({ length: p }, (_, i) => Math.max(0, params.w[i] ?? 1 / p))
    const tot = d3.sum(manual) || 1
    const w = params.mode === 'equal' ? new Array(p).fill(1 / p) : params.mode === 'erc' ? equalRiskContribution(S) : params.mode === 'minvar' ? globalMinVariance(S, true) : manual.map((v) => v / tot)
    return { S, w, rc: riskContributions(w, S) }
  }, [R, names, params.mode, params.w])
  if (!model) return needAssets
  const { w, rc } = model
  const m = { top: compact ? 8 : 46, right: compact ? 8 : 28, bottom: compact ? 8 : 50, left: compact ? 8 : 86 }
  const iw = width - m.left - m.right, ih = height - m.top - m.bottom
  const share = rc.contribution.map((c) => (rc.vol > 0 ? c / rc.vol : 0))
  const band = d3.scaleBand<string>().domain(names).range([0, ih]).padding(0.28)
  const x = d3.scaleLinear().domain([0, Math.max(0.5, ...w, ...share) * 1.1]).range([0, iw])
  return (
    <Stage stage={stage} width={width} height={height} compact={compact} label={`위험 기여도: 포트폴리오 연 변동성 ${pct(rc.vol, 1)}`} readout={[{ label: '포트폴리오 변동성(연)', value: pct(rc.vol, 1) }, { label: '최대 기여', value: names[share.indexOf(Math.max(...share))] }]} note={`위험 기여 = 비중 × 한계 위험 / 포트폴리오 위험 · ${disclaimer}`}>
      <g transform={`translate(${m.left},${m.top})`}>
        {!compact && x.ticks(5).map((t) => <g key={t}><line x1={x(t)} x2={x(t)} y1={0} y2={ih} stroke="#eef0f2" /><text x={x(t)} y={ih + 18} textAnchor="middle" fontSize={11} fill="#6b7280">{pct(t, 0)}</text></g>)}
        {names.map((n, i) => (
          <g key={n} transform={`translate(0,${band(n)})`}>
            {!compact && <text x={-8} y={band.bandwidth() / 2} dy="0.34em" textAnchor="end" fontSize={12} fill="#111827">{n}</text>}
            <rect data-testid="weight-bar" width={x(w[i])} height={band.bandwidth() / 2} fill="#9ab8b4" onPointerEnter={(e) => stage.at(e, <><b>{n}</b><br />자산 비중 {pct(w[i], 1)}</>)} />
            <rect data-testid="risk-bar" y={band.bandwidth() / 2} width={x(share[i])} height={band.bandwidth() / 2} fill="#cf4f6a" onPointerEnter={(e) => stage.at(e, <><b>{n}</b><br />위험 기여 {pct(share[i], 1)}<br />한계 위험 {pct(rc.marginal[i], 1)}</>)} />
            {!compact && <text x={Math.max(x(w[i]), x(share[i])) + 6} y={band.bandwidth() / 2} dy="0.34em" fontSize={10.5} fill="#374151">{pct(w[i], 0)} → {pct(share[i], 0)}</text>}
          </g>
        ))}
        {!compact && <g transform={`translate(${iw - 150},-30)`} fontSize={11}><rect width={12} height={10} fill="#9ab8b4" /><text x={16} y={9}>자산 비중</text><rect x={80} width={12} height={10} fill="#cf4f6a" /><text x={96} y={9}>위험 기여</text></g>}
      </g>
    </Stage>
  )
}

function RiskContribControls({ params, setParams, table, mapping }: ControlsProps<RiskContribParams>) {
  const { names } = useMemo(() => returnsOf(table, mapping), [table, mapping])
  return (
    <ControlGroup title="비중">
      <Select label="비중 정하기" value={params.mode} onChange={(mode) => setParams({ mode })} testId="ctl-mode" options={[{ value: 'manual', label: '직접 입력' }, { value: 'equal', label: '동일 비중' }, { value: 'erc', label: '동일 위험 기여 (ERC)' }, { value: 'minvar', label: '최소분산 (공매도 없음)' }]} />
      {params.mode === 'manual' && names.map((n, i) => <Slider key={n} label={n} value={params.w[i] ?? 1 / names.length} min={0} max={1} step={0.01} onChange={(v) => { const w = names.map((_, k) => params.w[k] ?? 1 / names.length); w[i] = v; setParams({ w }) }} testId={`ctl-w${i}`} format={(v) => `${Math.round(v * 100)}`} />)}
      <Hint>자산 i의 위험 기여는 비중 × 한계 위험(그 자산을 조금 늘릴 때 포트폴리오 변동성이 늘어나는 비율) = w_i(Σw)_i/σ_p이며 모두 더하면 포트폴리오 변동성입니다(오일러 분해). 자금을 동일 비중으로 나눠도 변동성이 큰 자산이 위험의 대부분을 차지할 수 있음을 위험 막대가 보여 주고, 동일 위험 기여(ERC) 비중은 모든 자산이 같은 몫의 위험을 지도록 반복 계산으로 구한 것입니다. 직접 입력한 비중은 합이 1이 되도록 정규화됩니다. 합성 수익률이며 비중 추천이 아닙니다.</Hint>
    </ControlGroup>
  )
}

export const riskContribModule: VizModule<RiskContribParams> = {
  roles: assetRoles(2), datasets: ['asset-returns'], defaultParams: { mode: 'equal', w: [] },
  Chart: RiskContribChart, Controls: RiskContribControls, hint: '동일 비중에서 주식이 위험의 대부분을 차지하는 것을 보고 ERC로 바꿔 보세요 · 직접 입력으로 비중을 조절하면 위험 기여가 바로 갱신됩니다 (합성 수익률)',
}

// ─── yield-curve surface ────────────────────────────────────────────────────────────

export interface YieldSurfaceParams extends ViewParams { time: number; zScale: number; color: 'yield' | 'slope' }
const yieldRoles: RoleSpec[] = [
  { key: 'date', label: '시점', type: 'date', accept: ['number'], required: true, prefer: '월|날짜|date' },
  { key: 'tenors', label: '만기별 수익률 열', type: 'number', required: true, multiple: { min: 3, max: 12 } },
]
const tenorYears = (name: string, i: number) => { const m = /(\d+(?:\.\d+)?)\s*(개월|m)/i.exec(name), y = /(\d+(?:\.\d+)?)\s*(년|y)/i.exec(name); return m ? +m[1] / 12 : y ? +y[1] : i + 1 }

function YieldSurfaceChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<YieldSurfaceParams>) {
  const data = useMemo(() => {
    const di = columnIndex(table, roleColumn(mapping, 'date')), names = roleColumns(mapping, 'tenors'), ti = names.map((n) => columnIndex(table, n))
    if (di < 0 || ti.some((i) => i < 0) || names.length < 3) return null
    const rows: { d: string; y: number[] }[] = []
    for (const r of table.rows) { const y = ti.map((i) => toNumber(r[i])); if (y.every((v) => v != null)) rows.push({ d: toLabel(r[di]), y: y as number[] }) }
    const ten = names.map(tenorYears)
    const order = ten.map((_, i) => i).sort((a, b) => ten[a] - ten[b])
    return rows.length >= 6 ? { rows, names: order.map((i) => names[i]), ten: order.map((i) => ten[i]), cols: order } : null
  }, [table, mapping])
  if (!data) return <ChartMessage>시점 열과 만기별 수익률 열(3개 이상)을 선택하세요. 시점이 6개 이상 필요합니다.</ChartMessage>
  const Y = data.rows.map((r) => data.cols.map((c) => r.y[c]))
  const lo = Math.min(...Y.flat()), hi = Math.max(...Y.flat())
  const slope = (row: number[]) => row[row.length - 1] - row[0]
  const slopes = Y.map(slope), smax = Math.max(...slopes.map(Math.abs), 1e-9)
  const nt = data.rows.length, nm = data.ten.length
  const sel = Math.min(nt - 1, Math.round(params.time * (nt - 1)))
  const norm = (i: number, j: number, v: number): [number, number, number] => [(j / (nm - 1)) * 2 - 1, (i / (nt - 1)) * 2 - 1, (((v - lo) / (hi - lo || 1)) * 1.5 - 0.3) * params.zScale]
  const draw = (ctx: CanvasRenderingContext2D, proj: Projector) => {
    const quads: Quad[] = []
    for (let i = 0; i < nt - 1; i++) for (let j = 0; j < nm - 1; j++) {
      const c = [[i, j], [i, j + 1], [i + 1, j + 1], [i + 1, j]].map(([a, b]) => proj(norm(a, b, Y[a][b])))
      const t = params.color === 'yield' ? (Y[i][j] - lo) / (hi - lo || 1) : 0.5 + (0.5 * slopes[i]) / smax
      quads.push({ pts: c.map((p) => [p.x, p.y] as [number, number]), depth: c.reduce((s, p) => s + p.depth, 0) / 4, fill: params.color === 'yield' ? schemes.viridis.interpolate(0.08 + 0.87 * t) : d3.interpolateRdBu(1 - t), stroke: 'rgba(255,255,255,.35)' })
    }
    drawQuads(ctx, quads, 0.4)
    ctx.strokeStyle = '#111827'; ctx.lineWidth = 3; ctx.beginPath()
    Y[sel].forEach((v, j) => { const p = proj(norm(sel, j, v)); if (j) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y) })
    ctx.stroke()
  }
  const sp = Y[sel][Math.min(nm - 1, data.ten.findIndex((t) => t >= 10))] - Y[sel][Math.max(0, data.ten.findIndex((t) => t >= 2))]
  return (
    <Scene3D width={width} height={height} compact={compact} params={params} setParams={setParams} label="수익률 곡선 곡면: 만기 × 시점 × 수익률" draw={draw} fit={0.4} drawKey={`${params.zScale}|${params.color}|${sel}|${nt}|${nm}|${lo}|${hi}`}
      labels={[{ at: [1, -1, -0.3], text: '만기 →', anchor: 'start' }, { at: [-1, 1, -0.3], text: '시간 →', anchor: 'end' }, { at: [-1, -1, 1.2], text: '수익률(%)', anchor: 'end' }]}
      readout={[{ label: '선택한 시점', value: data.rows[sel].d }, { label: '10년 − 2년', value: `${fmt(sp, 2)}%p` }, { label: '곡선', value: slope(Y[sel]) < 0 ? '역전' : '정상' }, { label: '범위', value: `${fmt(lo, 1)} ~ ${fmt(hi, 1)}%` }]}
      note={`검은 선 = 선택한 시점의 수익률 곡선 · ${disclaimer}`} />
  )
}

function YieldSurfaceControls({ params, setParams }: ControlsProps<YieldSurfaceParams>) {
  return (
    <>
      <ControlGroup title="곡면">
        <Slider label="강조할 시점 (전체 기간의 비율)" value={params.time} min={0} max={1} step={0.01} onChange={(time) => setParams({ time })} testId="ctl-time" format={(v) => `${Math.round(v * 100)}%`} />
        <Segmented label="색" value={params.color} onChange={(color) => setParams({ color })} testId="ctl-color" options={[{ value: 'yield', label: '수익률' }, { value: 'slope', label: '기울기(장단기)' }]} />
        <Slider label="높이 배율" value={params.zScale} min={0.4} max={2} step={0.1} onChange={(zScale) => setParams({ zScale })} testId="ctl-zscale" />
        <Hint>수익률 곡선(만기별 금리)을 시점마다 한 줄씩 쌓아 3차원 곡면으로 만들었습니다. 곡면의 가로 단면은 한 시점의 곡선이고 세로 단면은 한 만기의 금리 시계열입니다. 색을 ‘기울기’로 바꾸면 장단기 금리차(가장 긴 만기 − 가장 짧은 만기)의 부호가 보여, 파랑(장기 &gt; 단기)에서 빨강(단기 &gt; 장기, 역전)으로 바뀌는 구간을 찾을 수 있습니다. 합성 자료이며 실제 금리나 경기 예측이 아닙니다.</Hint>
      </ControlGroup>
      <ViewControls params={params} setParams={setParams} />
    </>
  )
}

export const yieldSurfaceModule: VizModule<YieldSurfaceParams> = {
  roles: yieldRoles, datasets: ['yield-history'], defaultParams: { yaw: -40, pitch: 30, zoom: 0.85, time: 0.6, zScale: 1, color: 'yield' },
  Chart: YieldSurfaceChart, Controls: YieldSurfaceControls, hint: '끌어서 회전 · 시점 슬라이더로 곡선을 강조 · 색을 기울기로 바꿔 역전 구간을 찾아보세요 (합성 금리)',
}
