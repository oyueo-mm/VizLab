import { useMemo } from 'react'
import { ChartMessage } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { columnIndex, toNumber, toTime, type DataTable } from '../../data/table'
import { schemes } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { acf, bartlettSe, ccf, ljungBox, pacf, stl, zOf } from '../../stats/tsa'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, RoleSpec, VizModule } from '../types'
import { Panels, XYPlot, type Layer } from './kit'

/** Serial-dependence charts: ACF, PACF, cross-correlation, STL decomposition, seasonal subseries and lag plots. */

const valueRole: RoleSpec[] = [{ key: 'value', label: '값 (시간 순서대로)', type: 'number', required: true, prefer: '값|판매량|지표|방문|value' }]
const timeValueRoles: RoleSpec[] = [
  { key: 'time', label: '시간 (정렬 기준, 선택)', type: 'date', accept: ['number'], auto: true, prefer: '시점|월|날짜|date|time|연도' },
  { key: 'value', label: '값', type: 'number', required: true },
]

function series(table: DataTable, mapping: Mapping, key = 'value') {
  const vi = columnIndex(table, roleColumn(mapping, key))
  const out: number[] = [], rows: number[] = []
  if (vi >= 0) table.rows.forEach((r, i) => { const v = toNumber(r[vi]); if (v != null) { out.push(v); rows.push(i) } })
  return { v: out, rows }
}

function timed(table: DataTable, mapping: Mapping) {
  const vi = columnIndex(table, roleColumn(mapping, 'value')), ti = columnIndex(table, roleColumn(mapping, 'time'))
  const date = table.columns[ti]?.type === 'date'
  const pts: { t: number; v: number; row: number }[] = []
  table.rows.forEach((r, row) => {
    const v = vi >= 0 ? toNumber(r[vi]) : null
    const t = ti >= 0 ? (date ? toTime(r[ti]) : toNumber(r[ti])) : pts.length
    if (v != null && t != null) pts.push({ t, v, row })
  })
  pts.sort((a, b) => a.t - b.t)
  return { pts, date: date && ti >= 0 }
}

const diffOnce = (x: number[]) => x.slice(1).map((v, i) => v - x[i])
const diffN = (x: number[], d: number) => { let y = x; for (let i = 0; i < d; i++) y = diffOnce(y); return y }
const needValue = <ChartMessage>숫자형 값 열을 선택하세요. 관측이 8개 이상 필요합니다.</ChartMessage>

// ─── ACF / PACF ─────────────────────────────────────────────────────────────────────

export interface CorrParams { maxLag: number; level: number; band: 'white' | 'bartlett'; diff: number }

function CorrChart({ kind, table, mapping, params, width, height, compact }: ChartProps<CorrParams> & { kind: 'acf' | 'pacf' }) {
  const s = useMemo(() => series(table, mapping), [table, mapping])
  const x = useMemo(() => diffN(s.v, params.diff), [s.v, params.diff])
  const res = useMemo(() => {
    if (x.length < 8) return null
    const K = Math.min(params.maxLag, x.length - 2)
    const r = acf(x, K)
    return { r, p: pacf(x, K), K }
  }, [x, params.maxLag])
  if (!res) return needValue
  const n = x.length, z = zOf(params.level)
  const vals = kind === 'acf' ? res.r.slice(1) : res.p
  const lags = vals.map((_, i) => i + 1)
  const bound = (k: number) => z * (kind === 'acf' && params.band === 'bartlett' ? bartlettSe(res.r, k, n) : 1 / Math.sqrt(n))
  const bnd = lags.map(bound)
  const out = lags.filter((_, i) => Math.abs(vals[i]) > bnd[i])
  const layers: Layer[] = [
    { kind: 'band', x: lags, lo: bnd.map((b) => -b), hi: bnd, color: '#4c6fb5', opacity: 0.12 },
    { kind: 'hline', v: 0, color: '#111827', dash: '0', width: 1 },
    { kind: 'stem', x: lags.filter((_, i) => Math.abs(vals[i]) <= bnd[i]), y: vals.filter((_, i) => Math.abs(vals[i]) <= bnd[i]), color: '#4c6fb5', label: '신뢰대 안' },
    { kind: 'stem', x: lags.filter((_, i) => Math.abs(vals[i]) > bnd[i]), y: vals.filter((_, i) => Math.abs(vals[i]) > bnd[i]), color: '#e07a3f', label: '유의한 시차' },
  ]
  const Q = ljungBox(res.r, n, Math.min(10, res.K))
  const title = kind === 'acf' ? '자기상관 함수(ACF)' : '편자기상관 함수(PACF)'
  return (
    <XYPlot hover layers={layers} width={width} height={height} compact={compact} xLabel="시차 (lag)" yLabel={kind === 'acf' ? '자기상관' : '편자기상관'} title={`${title}: 최대 시차 ${res.K}`} yDomain={[Math.min(-0.3, ...vals) - 0.05, Math.max(0.3, ...vals) + 0.1]} xFormat={(v) => String(Math.round(v))}
      readout={[{ label: 'n', value: n }, { label: '유의 시차', value: out.length }, ...(kind === 'acf' ? [{ label: 'Ljung–Box Q(10)', value: fmt(Q, 1) }] : [])]}
      note={`띠 = ${Math.round(params.level * 100)}% 신뢰대 (${kind === 'acf' && params.band === 'bartlett' ? 'Bartlett' : '백색잡음'} 기준)`} />
  )
}

function CorrControls({ kind, params, setParams }: ControlsProps<CorrParams> & { kind: 'acf' | 'pacf' }) {
  return (
    <ControlGroup title={kind === 'acf' ? 'ACF' : 'PACF'}>
      <Slider label="최대 시차" value={params.maxLag} min={5} max={80} onChange={(maxLag) => setParams({ maxLag })} testId="ctl-maxlag" />
      <Slider label="차분 횟수" value={params.diff} min={0} max={2} onChange={(diff) => setParams({ diff })} testId="ctl-diff" />
      <Segmented label="신뢰수준" value={String(params.level)} onChange={(v) => setParams({ level: Number(v) })} testId="ctl-level" options={[{ value: '0.9', label: '90%' }, { value: '0.95', label: '95%' }, { value: '0.99', label: '99%' }]} />
      {kind === 'acf' && <Segmented label="신뢰대 기준" value={params.band} onChange={(band) => setParams({ band })} testId="ctl-band" options={[{ value: 'white', label: '백색잡음' }, { value: 'bartlett', label: 'Bartlett' }]} />}
      <Hint>{kind === 'acf'
        ? '시차 k에서 자기 자신과의 상관 r_k = Σ(x_t − x̄)(x_{t+k} − x̄) / Σ(x_t − x̄)²입니다. 천천히 줄어들면 추세나 강한 지속성(차분이 필요), 사인파처럼 감쇠하면 주기성이 있고, 계절 주기의 배수에서 솟으면 계절성이 있습니다. 띠 밖의 막대는 그 시차에서 상관이 0이라는 가정을 기각할 만큼 큽니다(검정 20번이면 하나쯤은 우연히 밖에 나옵니다).'
        : '시차 1..k−1의 영향을 제거한 뒤 남는 x_t와 x_{t+k}의 직접 상관입니다. Durbin–Levinson 점화식으로 계산합니다. AR(p) 과정은 PACF가 p시차 뒤에서 끊기고 ACF는 서서히 줄어듭니다. MA(q) 과정은 반대로 ACF가 끊깁니다.'}</Hint>
    </ControlGroup>
  )
}

const corrDefaults: CorrParams = { maxLag: 30, level: 0.95, band: 'white', diff: 0 }
export const acfModule: VizModule<CorrParams> = {
  roles: valueRole, datasets: ['ts-ar2', 'ts-seasonal', 'ts-pair'], defaultParams: corrDefaults,
  Chart: (p) => <CorrChart kind="acf" {...p} />, Controls: (p) => <CorrControls kind="acf" {...p} />,
  hint: '차분 횟수를 바꿔 추세가 사라지는지 보세요 · 막대에 올리면 시차별 값',
}
export const pacfModule: VizModule<CorrParams> = {
  roles: valueRole, datasets: ['ts-ar2', 'ts-seasonal', 'ts-pair'], defaultParams: corrDefaults,
  Chart: (p) => <CorrChart kind="pacf" {...p} />, Controls: (p) => <CorrControls kind="pacf" {...p} />,
  hint: 'PACF가 끊기는 시차가 AR 차수의 단서입니다 · AR(2) 데이터에서는 2시차에서 끊깁니다',
}

// ─── cross-correlation ──────────────────────────────────────────────────────────────

export interface CcfParams { maxLag: number; level: number; diff: number }
const ccfRoles: RoleSpec[] = [
  { key: 'x', label: '계열 X (원인 후보)', type: 'number', required: true, prefer: '선행|x' },
  { key: 'y', label: '계열 Y (결과 후보)', type: 'number', required: true, prefer: '결과|y' },
]

function CcfChart({ table, mapping, params, width, height, compact }: ChartProps<CcfParams>) {
  const data = useMemo(() => {
    const xi = columnIndex(table, roleColumn(mapping, 'x')), yi = columnIndex(table, roleColumn(mapping, 'y'))
    const a: number[] = [], b: number[] = []
    if (xi >= 0 && yi >= 0) table.rows.forEach((r) => { const u = toNumber(r[xi]), v = toNumber(r[yi]); if (u != null && v != null) { a.push(u); b.push(v) } })
    return { x: diffN(a, params.diff), y: diffN(b, params.diff) }
  }, [table, mapping, params.diff])
  const c = useMemo(() => (data.x.length >= 12 ? ccf(data.x, data.y, params.maxLag) : []), [data, params.maxLag])
  if (!c.length) return <ChartMessage>서로 다른 두 숫자형 열을 고르세요. 관측이 12개 이상 필요합니다.</ChartMessage>
  const n = data.x.length, b = zOf(params.level) / Math.sqrt(n)
  const best = c.reduce((m, v) => (Math.abs(v.r) > Math.abs(m.r) ? v : m))
  const lags = c.map((v) => v.lag)
  return (
    <XYPlot hover width={width} height={height} compact={compact} xLabel="시차 k (양수: Y가 X보다 k만큼 늦음)" yLabel="교차상관 r_xy(k)" title={`교차상관: 최대 |r| = ${fmt(best.r, 2)} (시차 ${best.lag})`} xFormat={(v) => String(Math.round(v))} yDomain={[Math.min(-0.25, ...c.map((v) => v.r)) - 0.05, Math.max(0.25, ...c.map((v) => v.r)) + 0.1]}
      layers={[
        { kind: 'band', x: lags, lo: lags.map(() => -b), hi: lags.map(() => b), color: '#4c6fb5', opacity: 0.12 },
        { kind: 'hline', v: 0, color: '#111827', dash: '0', width: 1 },
        { kind: 'vline', v: 0, color: '#d1d5db', dash: '0' },
        { kind: 'stem', x: lags, y: c.map((v) => v.r), color: '#2a8c82', label: '교차상관' },
        { kind: 'points', color: '#e07a3f', r: 6, pts: [{ x: best.lag, y: best.r, tip: <><b>최대 |r|</b><br />시차 {best.lag}, r = {fmt(best.r, 3)}</> }] },
      ]}
      readout={[{ label: '최대 시차', value: best.lag }, { label: 'r', value: fmt(best.r, 3) }, { label: 'n', value: n }]} note="주황 점 = 가장 큰 |r|, 띠 = 두 계열이 무관할 때의 신뢰대" />
  )
}

function CcfControls({ params, setParams }: ControlsProps<CcfParams>) {
  return (
    <ControlGroup title="교차상관">
      <Slider label="최대 시차" value={params.maxLag} min={4} max={40} onChange={(maxLag) => setParams({ maxLag })} testId="ctl-maxlag" />
      <Slider label="차분 횟수 (사전 백색화 대용)" value={params.diff} min={0} max={2} onChange={(diff) => setParams({ diff })} testId="ctl-diff" />
      <Segmented label="신뢰수준" value={String(params.level)} onChange={(v) => setParams({ level: Number(v) })} testId="ctl-level" options={[{ value: '0.9', label: '90%' }, { value: '0.95', label: '95%' }, { value: '0.99', label: '99%' }]} />
      <Hint>두 계열을 시차 k만큼 밀어 놓고 계산한 상관 r_xy(k) = corr(x_t, y_{'{t+k}'})입니다. 선행·후행 관계와 지연 시간을 찾는 데 쓰입니다. 두 계열이 모두 추세나 강한 자기상관을 가지면 무관해도 상관이 크게 나오는 가짜 상관이 생기므로, 차분 횟수를 올려 추세를 제거한 뒤에도 남는지 확인하세요. 상관은 인과가 아닙니다.</Hint>
    </ControlGroup>
  )
}

export const ccfModule: VizModule<CcfParams> = {
  roles: ccfRoles, datasets: ['ts-pair'], defaultParams: { maxLag: 16, level: 0.95, diff: 0 },
  Chart: CcfChart, Controls: CcfControls, hint: '선행 지표가 4시점 뒤 결과에 영향을 주도록 만든 데이터입니다 · 차분 횟수를 바꿔 피크가 유지되는지 보세요',
}

// ─── STL ────────────────────────────────────────────────────────────────────────────

export interface StlParams { period: number; window: number; robust: boolean }

function StlChart({ table, mapping, params, width, height, compact }: ChartProps<StlParams>) {
  const t = useMemo(() => timed(table, mapping), [table, mapping])
  const res = useMemo(() => (t.pts.length >= 2 * params.period + 2 ? stl(t.pts.map((p) => p.v), params.period, { seasonal: params.window, outer: params.robust ? 3 : 0 }) : null), [t, params.period, params.window, params.robust])
  if (!res) return <ChartMessage>값 열을 고르세요. 주기 {params.period}의 두 배보다 많은 관측이 필요합니다.</ChartMessage>
  const x = t.pts.map((p) => p.t)
  const common = { xDate: t.date, width, hover: true as const }
  if (compact) return <XYPlot {...common} height={height} compact title="STL 분해" layers={[{ kind: 'line', x, y: t.pts.map((p) => p.v), color: '#9aa1a9', width: 1.4 }, { kind: 'line', x, y: res.trend, color: '#2a8c82' }]} />
  const readout = [{ label: '추세 강도', value: fmt(res.trendStrength, 2) }, { label: '계절 강도', value: fmt(res.seasonalStrength, 2) }]
  return (
    <Panels width={width} height={height} parts={[3, 2, 2, 2]}>
      {[
        (h) => <XYPlot {...common} height={h} title="STL 분해: 원 자료와 추세" yLabel="원 자료" margin={{ bottom: 20, top: 30 }} readout={readout} layers={[{ kind: 'line', x, y: t.pts.map((p) => p.v), label: '원 자료', color: '#9aa1a9', width: 1.6 }, { kind: 'line', x, y: res.trend, label: '추세', color: '#2a8c82', width: 2.8 }]} />,
        (h) => <XYPlot {...common} height={h} title="계절 성분" yLabel="계절" margin={{ bottom: 20, top: 10 }} layers={[{ kind: 'hline', v: 0, dash: '0', color: '#d1d5db' }, { kind: 'line', x, y: res.seasonal, label: '계절', color: '#e07a3f' }]} />,
        (h) => <XYPlot {...common} height={h} title="잔차" yLabel="잔차" margin={{ bottom: 20, top: 10 }} layers={[{ kind: 'hline', v: 0, dash: '0', color: '#d1d5db' }, { kind: 'stem', x, y: res.remainder, label: '잔차', color: '#4c6fb5', dot: false }]} />,
        (h) => <XYPlot {...common} height={h} title="추세 + 계절 성분" yLabel="재합성" margin={{ bottom: 42, top: 10 }} layers={[{ kind: 'line', x, y: t.pts.map((p) => p.v), label: '원 자료', color: '#d1d5db', width: 3 }, { kind: 'line', x, y: res.trend.map((v, i) => v + res.seasonal[i]), label: '추세 + 계절', color: '#111827', width: 1.4 }]} />,
      ]}
    </Panels>
  )
}

function StlControls({ params, setParams }: ControlsProps<StlParams>) {
  return (
    <ControlGroup title="STL 분해">
      <Slider label="계절 주기 (관측 수)" value={params.period} min={2} max={52} onChange={(period) => setParams({ period })} testId="ctl-period" />
      <Slider label="계절 평활 창 (홀수)" value={params.window} min={3} max={51} step={2} onChange={(window) => setParams({ window })} testId="ctl-window" />
      <Toggle label="이상치에 강건하게 (3회 반복)" checked={params.robust} onChange={(robust) => setParams({ robust })} />
      <Hint>Cleveland 등(1990)의 STL입니다. 각 계절 위치(예: 모든 1월)의 값만 모은 부분계열을 loess로 매끈하게 하고, 저주파 필터를 빼 계절 성분을 만들고, 계절을 뺀 자료를 loess로 다듬어 추세로 삼는 과정을 반복합니다. 계절 평활 창이 작으면 계절 모양이 해마다 달라질 수 있고, 크면 거의 같게 됩니다. 이상치가 있으면 강건 반복이 가중치를 낮춰 이상치가 계절·추세에 스며드는 것을 막습니다. 추세 + 계절 + 잔차는 항상 원 자료와 같습니다.</Hint>
    </ControlGroup>
  )
}

export const stlModule: VizModule<StlParams> = {
  roles: timeValueRoles, datasets: ['ts-seasonal'], defaultParams: { period: 12, window: 9, robust: false },
  Chart: StlChart, Controls: StlControls, hint: '계절 평활 창을 바꿔 계절 성분이 해마다 변하는지 확인하세요 · 주기를 틀리게 두면 잔차에 계절이 남습니다',
}

// ─── seasonal subseries ─────────────────────────────────────────────────────────────

export interface SubseriesParams { by: 'auto' | 'month' | 'quarter' | 'weekday' | 'hour'; mean: boolean }
const subseriesRoles: RoleSpec[] = [
  { key: 'time', label: '날짜·시각', type: 'date', required: true },
  { key: 'value', label: '값', type: 'number', required: true },
]
const NAMES = {
  month: Array.from({ length: 12 }, (_, i) => `${i + 1}월`), quarter: ['1분기', '2분기', '3분기', '4분기'], weekday: ['일', '월', '화', '수', '목', '금', '토'], hour: Array.from({ length: 24 }, (_, i) => `${i}시`),
}
const seasonOf = (ms: number, by: SubseriesParams['by']) => { const d = new Date(ms); return by === 'month' ? d.getUTCMonth() : by === 'quarter' ? Math.floor(d.getUTCMonth() / 3) : by === 'weekday' ? d.getUTCDay() : d.getUTCHours() }

function SubseriesChart({ table, mapping, params, width, height, compact }: ChartProps<SubseriesParams>) {
  const t = useMemo(() => timed(table, mapping), [table, mapping])
  // 'auto' picks the first unit that splits the data into several seasons: months, then weekdays, then hours
  const by = useMemo<Exclude<SubseriesParams['by'], 'auto'>>(() => {
    if (params.by !== 'auto') return params.by
    if (!t.date) return 'month'
    for (const u of ['month', 'weekday', 'hour'] as const) if (new Set(t.pts.map((p) => seasonOf(p.t, u))).size >= (u === 'month' ? 6 : 5)) return u
    return 'month'
  }, [params.by, t])
  const names = NAMES[by]
  const groups = useMemo(() => {
    const g = names.map(() => [] as { t: number; v: number; row: number }[])
    if (t.date) for (const p of t.pts) g[seasonOf(p.t, by)].push(p)
    return g
  }, [t, by, names])
  const filled = groups.map((g, i) => ({ g, i })).filter((x) => x.g.length)
  if (!t.date || filled.length < 2) return <ChartMessage>날짜형 열과 값 열을 고르세요. 계절({names.length}개 중 2개 이상)에 해당하는 관측이 있어야 합니다.</ChartMessage>
  const all = t.pts.map((p) => p.v)
  const gm = all.reduce((a, b) => a + b, 0) / all.length
  const layers: Layer[] = [{ kind: 'hline', v: gm, color: '#9aa1a9', dash: '4 4' }]
  for (const { g, i } of filled) {
    const xs = g.map((_, k) => (g.length === 1 ? i : i - 0.38 + (0.76 * k) / (g.length - 1)))
    layers.push({ kind: 'line', x: xs, y: g.map((p) => p.v), color: '#4c6fb5', width: 1.5, opacity: 0.8 })
    layers.push({ kind: 'points', color: '#4c6fb5', r: 2.2, pts: g.map((p, k) => ({ x: xs[k], y: p.v, key: `${i}-${k}`, tip: <><b>{names[i]}</b> · {new Date(p.t).toISOString().slice(0, 10)}<br />값 {fmt(p.v)}</> })) })
    if (params.mean) { const m = g.reduce((a, p) => a + p.v, 0) / g.length; layers.push({ kind: 'line', x: [i - 0.42, i + 0.42], y: [m, m], color: '#e07a3f', width: 3.2 }) }
  }
  const means = filled.map(({ g, i }) => ({ i, m: g.reduce((a, p) => a + p.v, 0) / g.length }))
  const hi = means.reduce((a, b) => (b.m > a.m ? b : a)), lo = means.reduce((a, b) => (b.m < a.m ? b : a))
  return (
    <XYPlot width={width} height={height} compact={compact} layers={layers} grid={false} xDomain={[-0.6, names.length - 0.4]} xTicks={names.length} xFormat={(v) => (Math.abs(v - Math.round(v)) < 1e-9 ? names[Math.round(v)] ?? '' : '')} yLabel="값" title={`계절 부분계열 도표: ${names.length}개 ${by === 'month' ? '월' : by === 'quarter' ? '분기' : by === 'weekday' ? '요일' : '시간대'}`}
      readout={[{ label: '가장 높은 계절', value: `${names[hi.i]} (${fmt(hi.m, 1)})` }, { label: '가장 낮은 계절', value: `${names[lo.i]} (${fmt(lo.m, 1)})` }]} note="파란 선 = 같은 계절의 해마다 값, 주황 선 = 그 계절 평균, 점선 = 전체 평균" />
  )
}

function SubseriesControls({ params, setParams }: ControlsProps<SubseriesParams>) {
  return (
    <ControlGroup title="계절 단위">
      <Segmented label="묶는 단위" value={params.by} onChange={(by) => setParams({ by })} testId="ctl-by" options={[{ value: 'auto', label: '자동' }, { value: 'month', label: '월' }, { value: 'quarter', label: '분기' }, { value: 'weekday', label: '요일' }, { value: 'hour', label: '시간' }]} />
      <Toggle label="계절별 평균 선" checked={params.mean} onChange={(mean) => setParams({ mean })} />
      <Hint>같은 계절(모든 1월, 모든 월요일…)에 해당하는 값을 시간 순서대로 모아 계절마다 작은 시계열로 그립니다. 주황 평균선의 높낮이가 계절 패턴이고, 각 파란 선의 기울기는 그 계절 값이 해마다 어떻게 변하는지를 보여 줍니다. 일반 선 그래프에서는 섞여 보이는 ‘계절 패턴’과 ‘계절별 추세’를 분리해서 볼 수 있습니다.</Hint>
    </ControlGroup>
  )
}

export const subseriesModule: VizModule<SubseriesParams> = {
  roles: subseriesRoles, datasets: ['ts-seasonal', 'ts-hourly'], defaultParams: { by: 'auto', mean: true },
  Chart: SubseriesChart, Controls: SubseriesControls, hint: '묶는 단위를 바꿔 보세요 · 점에 올리면 날짜와 값, 기울어진 파란 선은 그 계절의 해마다 추세',
}

// ─── lag plot ───────────────────────────────────────────────────────────────────────

export interface LagParams { lag: number; connect: boolean; colorTime: boolean }

function LagChart({ table, mapping, params, width, height, compact }: ChartProps<LagParams>) {
  const s = useMemo(() => series(table, mapping), [table, mapping])
  const k = Math.max(1, Math.min(params.lag, Math.max(1, s.v.length - 3)))
  const pairs = useMemo(() => s.v.slice(0, s.v.length - k).map((v, i) => ({ a: v, b: s.v[i + k], i })), [s.v, k])
  if (pairs.length < 6) return needValue
  const r = acf(s.v, k)[k] ?? 0
  const lo = Math.min(...s.v), hi = Math.max(...s.v)
  const col = (i: number) => (params.colorTime ? schemes.viridis.interpolate(i / Math.max(1, pairs.length - 1)) : '#4c6fb5')
  return (
    <XYPlot width={width} height={height} compact={compact} equal xLabel="x(t)" yLabel={`x(t + ${k})`} title={`시차 도표: 시차 ${k}, r = ${fmt(r, 2)}`}
      layers={[
        { kind: 'line', x: [lo, hi], y: [lo, hi], color: '#9aa1a9', dash: '5 4', width: 1.2 },
        ...(params.connect ? [{ kind: 'line', x: pairs.map((p) => p.a), y: pairs.map((p) => p.b), color: '#9aa1a9', width: 1, opacity: 0.35 } as Layer] : []),
        { kind: 'points', r: 3.6, opacity: 0.85, pts: pairs.map((p) => ({ x: p.a, y: p.b, color: col(p.i), key: String(p.i), tip: <><b>t = {s.rows[p.i] + 1}</b><br />x(t) = {fmt(p.a)}<br />x(t + {k}) = {fmt(p.b)}</> })) },
      ]}
      readout={[{ label: '시차 k', value: k }, { label: '자기상관 r_k', value: fmt(r, 3) }, { label: '쌍 수', value: pairs.length }]} note={params.colorTime ? '색 = 시간(보라 → 노랑), 점선 = y = x' : '점선 = y = x'} />
  )
}

function LagControls({ params, setParams }: ControlsProps<LagParams>) {
  return (
    <ControlGroup title="시차 도표">
      <Slider label="시차 k" value={params.lag} min={1} max={48} onChange={(lag) => setParams({ lag })} testId="ctl-lag" />
      <Toggle label="시간 순서로 색칠" checked={params.colorTime} onChange={(colorTime) => setParams({ colorTime })} />
      <Toggle label="이웃한 쌍을 선으로 연결" checked={params.connect} onChange={(connect) => setParams({ connect })} />
      <Hint>현재값 x(t)를 가로축, k시점 뒤의 값 x(t+k)를 세로축에 놓은 산점도입니다. 점이 y = x 주위에 모이면 양의 자기상관, 우하향이면 음의 상관(교대하는 계열), 타원이나 나선 같은 구조가 보이면 선형 상관 하나로는 알 수 없는 비선형 동역학입니다. 시차를 키워 상관이 약해지는 속도로 기억의 길이를 가늠하세요. 점 사이가 선으로 이어져 보이는 것은 자기상관이 큰 시계열의 특징입니다.</Hint>
    </ControlGroup>
  )
}

export const lagModule: VizModule<LagParams> = {
  roles: valueRole, datasets: ['ts-ar2', 'ts-seasonal', 'ts-pair'], defaultParams: { lag: 1, connect: false, colorTime: true },
  Chart: LagChart, Controls: LagControls, hint: '시차를 1, 2, 3… 으로 바꾸며 준주기 계열의 점 구름이 어떻게 회전하는지 보세요',
}
