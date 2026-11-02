import * as d3 from 'd3'
import { useMemo } from 'react'
import { ChartMessage } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider } from '../../components/controls'
import { columnIndex, toLabel, type DataTable } from '../../data/table'
import { fmt } from '../../lib/format'
import { collocations, dispersion, tokenize, zipf } from '../../stats/applied'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, RoleSpec, VizModule } from '../types'
import { HeatGrid, Stage, XYPlot, useStage, type Layer } from './kit'

/** Language and text charts: collocation (PMI) matrix, lexical dispersion plot and Zipf rank–frequency plot (all example corpora are synthetic). */

const textRoles: RoleSpec[] = [{ key: 'text', label: '텍스트 열 (한 행 = 한 문장·줄)', type: 'category', required: true, prefer: '문장|줄|text|본문' }]

/** Tokens per row; `withBreaks` inserts an empty token between rows so windows never cross a sentence. */
function tokensOf(table: DataTable, mapping: Mapping, withBreaks: boolean): string[] {
  const i = columnIndex(table, roleColumn(mapping, 'text'))
  if (i < 0) return []
  const out: string[] = []
  for (const r of table.rows) { const t = tokenize(toLabel(r[i])); if (!t.length) continue; if (withBreaks && out.length) out.push(''); out.push(...t) }
  return out
}
const needText = <ChartMessage>텍스트 열을 고르세요. 단어가 50개 이상 있어야 합니다.</ChartMessage>

// ─── collocation matrix ─────────────────────────────────────────────────────────────

export interface CollParams { window: number; topN: number; minCount: number; measure: 'pmi' | 'count' }

function CollChart({ table, mapping, params, width, height, compact }: ChartProps<CollParams>) {
  const m = useMemo(() => {
    const tokens = tokensOf(table, mapping, true)
    if (tokens.filter(Boolean).length < 50) return null
    const c = collocations(tokens, params.window, params.minCount)
    const words = [...c.freq.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, params.topN).map(([w]) => w)
    const cell = new Map<string, { pmi: number; count: number }>()
    for (const r of c.rows) cell.set(`${r.a}\u0001${r.b}`, { pmi: r.pmi, count: r.count })
    const get = (a: string, b: string) => cell.get(a < b ? `${a}\u0001${b}` : `${b}\u0001${a}`)
    // greedy chain: next word = the unvisited word with the strongest PMI to the last one (puts related words next to each other)
    const left = new Set(words), order: string[] = []
    let cur = words[0]
    while (cur) {
      order.push(cur); left.delete(cur)
      let best = '', bs = -Infinity
      for (const w of left) { const v = get(cur, w)?.pmi ?? -1e9; if (v > bs) { bs = v; best = w } }
      cur = best || [...left][0]
    }
    return { c, order, get }
  }, [table, mapping, params.window, params.topN, params.minCount])
  if (!m) return needText
  const { order, get, c } = m
  const values = order.map((a) => order.map((b) => { if (a === b) return NaN; const v = get(a, b); return v ? (params.measure === 'pmi' ? v.pmi : v.count) : NaN }))
  const finite = values.flat().filter(Number.isFinite), max = Math.max(1e-9, ...finite.map(Math.abs))
  const color = params.measure === 'pmi' ? (v: number) => d3.interpolateRdBu(0.5 + (0.5 * v) / max) : (v: number) => d3.interpolateBlues(0.15 + (0.8 * v) / max)
  return (
    <HeatGrid rows={order} cols={order} values={values} width={width} height={height} compact={compact} square title={`공기어 행렬: 상위 ${order.length}개 단어`} color={color}
      text={(v) => (params.measure === 'pmi' ? fmt(v, 1) : String(v))}
      tip={(i, j, v) => { const r = get(order[i], order[j]); return <><b>{order[i]} · {order[j]}</b><br />PMI {fmt(r?.pmi ?? v, 3)} · 함께 나온 횟수 {r?.count}</> }}
      readout={[{ label: '단어 종류 / 전체', value: `${c.freq.size} / ${[...c.freq.values()].reduce((a, b) => a + b, 0)}` }, { label: '공기 쌍', value: String(c.rows.length) }]}
      note={params.measure === 'pmi' ? '파랑 = 우연보다 자주 함께(PMI > 0), 빨강 = 우연보다 드묾' : '창 안에서 함께 나온 횟수'} />
  )
}

function CollControls({ params, setParams }: ControlsProps<CollParams>) {
  return (
    <ControlGroup title="공기어 분석">
      <Slider label="창 크기 (앞뒤 단어 수)" value={params.window} min={1} max={15} onChange={(window) => setParams({ window })} testId="ctl-window" />
      <Slider label="표시할 단어 수" value={params.topN} min={6} max={40} onChange={(topN) => setParams({ topN })} testId="ctl-topn" />
      <Slider label="최소 공기 횟수" value={params.minCount} min={1} max={10} onChange={(minCount) => setParams({ minCount })} testId="ctl-mincount" />
      <Segmented label="값" value={params.measure} onChange={(measure) => setParams({ measure })} testId="ctl-measure" options={[{ value: 'pmi', label: '점별 상호정보량' }, { value: 'count', label: '횟수' }]} />
      <Hint>같은 문장 안에서 서로 창 크기 이내에 나타난 단어 쌍을 세어 점별 상호정보량 PMI = log₂ [ p(a, b) / (p(a) p(b)) ]를 계산합니다. 두 단어가 독립이면 0, 우연보다 자주 함께 나오면 양수입니다. 횟수만 보면 흔한 단어끼리 크게 보이지만 PMI는 빈도를 보정해 진짜 연어(연결 어휘)를 드러냅니다. 드문 단어 쌍은 PMI가 과대 추정되기 쉬워 최소 공기 횟수로 거릅니다. 단어는 띄어쓰기 기준이므로 조사가 붙은 한국어는 형태소 분석 없이 다른 단어로 취급됩니다.</Hint>
    </ControlGroup>
  )
}

export const collModule: VizModule<CollParams> = {
  roles: textRoles, datasets: ['corpus-topics'], defaultParams: { window: 5, topN: 24, minCount: 2, measure: 'pmi' },
  Chart: CollChart, Controls: CollControls, hint: '같은 주제의 단어가 파란 블록으로 묶입니다 · 창 크기를 줄이면 더 가까운 단어만 연결됩니다 · 값을 횟수로 바꿔 PMI와 비교하세요 (합성 말뭉치)',
}

// ─── lexical dispersion ─────────────────────────────────────────────────────────────

export interface DispParams { words: number; parts: number; sort: 'freq' | 'dp' }

function DispChart({ table, mapping, params, width, height, compact }: ChartProps<DispParams>) {
  const stage = useStage()
  const m = useMemo(() => {
    const tokens = tokensOf(table, mapping, false)
    if (tokens.length < 50) return null
    const freq = new Map<string, number>()
    for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1)
    const top = [...freq.entries()].filter(([, f]) => f >= 3).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, params.words).map(([w]) => w)
    const rows = dispersion(tokens, top, params.parts)
    if (params.sort === 'dp') rows.sort((a, b) => a.dp - b.dp)
    return { n: tokens.length, rows }
  }, [table, mapping, params.words, params.parts, params.sort])
  if (!m) return needText
  const left = compact ? 6 : 84, right = compact ? 6 : 64, x = d3.scaleLinear().domain([0, m.n]).range([left, width - right])
  const rh = Math.max(6, Math.min(28, (height - 56) / m.rows.length)), color = d3.scaleLinear<string>().domain([0, 0.8]).range(['#2a8c82', '#e07a3f']).clamp(true)
  const mean = m.rows.reduce((a, r) => a + r.dp, 0) / m.rows.length
  return (
    <Stage stage={stage} width={width} height={height} label={`어휘 분산 도표: 단어 ${m.rows.length}개`} compact={compact} readout={[{ label: '전체 단어 수', value: String(m.n) }, { label: '평균 분산도 DP', value: fmt(mean, 3) }]} note="막대 위치 = 텍스트 안의 위치 · 오른쪽 숫자 = Gries DP (0 균등, 1 몰림)">
      <g transform="translate(0,10)">
        {m.rows.map((r, i) => (
          <g key={r.word} data-testid="disp-row" transform={`translate(0,${i * rh})`} onPointerEnter={compact ? undefined : (e) => stage.at(e, <><b>{r.word}</b><br />{r.total}번 · DP {fmt(r.dp, 3)}</>)}>
            <rect x={left} width={x(m.n) - left} height={rh - 2} fill="#f6f7f9" />
            {r.positions.map((p, k) => <line key={k} x1={x(p)} x2={x(p)} y1={1} y2={rh - 3} stroke={color(r.dp)} strokeWidth={1.2} />)}
            {!compact && <text x={left - 8} y={(rh - 2) / 2} dy="0.34em" textAnchor="end" fontSize={11.5} fill="#374151">{r.word.length > 8 ? `${r.word.slice(0, 7)}…` : r.word}</text>}
            {!compact && <text x={x(m.n) + 8} y={(rh - 2) / 2} dy="0.34em" fontSize={11} fill="#6b7280">{fmt(r.dp, 2)}</text>}
          </g>
        ))}
      </g>
      {!compact && <g transform={`translate(0,${12 + m.rows.length * rh})`}>{x.ticks(6).map((t) => <g key={t} transform={`translate(${x(t)},0)`}><line y2={4} stroke="#9aa1a9" /><text y={16} textAnchor="middle" fontSize={10.5} fill="#6b7280">{t}</text></g>)}<text x={(left + x(m.n)) / 2} y={32} textAnchor="middle" fontSize={12} fill="#6b7280" className="axis-label">단어 위치 (몇 번째 단어)</text></g>}
    </Stage>
  )
}

function DispControls({ params, setParams }: ControlsProps<DispParams>) {
  return (
    <ControlGroup title="어휘 분산">
      <Slider label="표시할 단어 수 (빈도 상위)" value={params.words} min={3} max={20} onChange={(words) => setParams({ words })} testId="ctl-words" />
      <Slider label="DP를 계산할 구간 수" value={params.parts} min={2} max={30} onChange={(parts) => setParams({ parts })} testId="ctl-parts" />
      <Segmented label="정렬" value={params.sort} onChange={(sort) => setParams({ sort })} testId="ctl-sort" options={[{ value: 'freq', label: '빈도순' }, { value: 'dp', label: '균등한 순' }]} />
      <Hint>텍스트를 단어로 나누어 선택한 단어가 몇 번째 위치에 나오는지 막대로 찍습니다. 같은 횟수여도 고르게 퍼진 단어(전 범위에 쓰이는 일반어)와 한 곳에 몰린 단어(특정 주제어)는 모양이 다릅니다. Gries의 편차 비율 DP는 텍스트를 같은 길이의 k구간으로 나누어 단어의 실제 구간별 비율과 구간 크기의 비율(1/k) 차이의 절댓값 합의 절반으로, 0이면 완전히 균등하고 1에 가까울수록 한 구간에 몰립니다. 구간 수를 바꾸면 값이 달라지니 비교는 같은 구간 수에서 하세요.</Hint>
    </ControlGroup>
  )
}

export const dispModule: VizModule<DispParams> = {
  roles: textRoles, datasets: ['corpus-topics'], defaultParams: { words: 16, parts: 10, sort: 'freq' },
  Chart: DispChart, Controls: DispControls, hint: '앞부분에만 나오는 날씨 단어와 뒷부분에만 나오는 스포츠 단어를 비교해 보세요 · 정렬을 균등한 순으로 바꾸면 일반어가 위로 옵니다 (합성 말뭉치)',
}

// ─── Zipf rank–frequency ────────────────────────────────────────────────────────────

export interface ZipfParams { from: number; to: number; ideal: boolean }

function ZipfChart({ table, mapping, params, width, height, compact }: ChartProps<ZipfParams>) {
  const z = useMemo(() => {
    const tokens = tokensOf(table, mapping, false)
    return tokens.length >= 50 ? zipf(tokens, params.from, params.to) : null
  }, [table, mapping, params.from, params.to])
  if (!z) return needText
  const top = z.rows[0], inFit = z.rows.filter((r) => r.rank >= params.from && r.rank <= params.to)
  const layers: Layer[] = [
    { kind: 'points', color: '#9ab8b4', r: compact ? 2 : 3.4, opacity: 0.8, label: '단어', pts: z.rows.map((r) => ({ x: r.rank, y: r.freq, key: r.word, tip: <><b>{r.word}</b><br />순위 {r.rank} · {r.freq}번</> })) },
    { kind: 'points', color: '#2a8c82', r: compact ? 2 : 3.6, label: '적합에 쓴 순위', pts: inFit.map((r) => ({ x: r.rank, y: r.freq, key: r.word })) },
    ...(z.fit ? [{ kind: 'line', x: [params.from, params.to], y: [Math.exp(z.fit.intercept + z.fit.slope * Math.log(params.from)), Math.exp(z.fit.intercept + z.fit.slope * Math.log(params.to))], color: '#e07a3f', width: 2.6, label: `적합 기울기 ${fmt(z.fit.slope, 3)}` } as Layer] : []),
    ...(params.ideal ? [{ kind: 'line', x: [1, z.types], y: [top.freq, top.freq / z.types], color: '#9aa1a9', dash: '6 4', width: 1.6, label: '이상적인 1/순위' } as Layer] : []),
  ]
  return (
    <XYPlot hover={false} layers={layers} width={width} height={height} compact={compact} xScale="log" yScale="log" xLabel="순위 (로그)" yLabel="빈도 (로그)" title={`지프 도표: 단어 ${z.types}종`}
      readout={[{ label: '전체 단어 / 종류', value: `${z.tokens} / ${z.types}` }, { label: '한 번만 나온 단어', value: `${z.hapax} (${fmt((100 * z.hapax) / z.types, 3)}%)` }, ...(z.fit ? [{ label: '지프 지수 s (−기울기)', value: fmt(-z.fit.slope, 3) }, { label: '적합 R²', value: fmt(z.fit.r2, 4) }] : [])]}
      note="로그–로그에서 직선에 가까울수록 지프 법칙" />
  )
}

function ZipfControls({ params, setParams }: ControlsProps<ZipfParams>) {
  return (
    <ControlGroup title="지프 법칙">
      <Slider label="적합 시작 순위" value={params.from} min={1} max={50} onChange={(from) => setParams({ from: Math.min(from, params.to - 1) })} testId="ctl-from" />
      <Slider label="적합 끝 순위" value={params.to} min={5} max={1000} step={5} onChange={(to) => setParams({ to: Math.max(to, params.from + 1) })} testId="ctl-to" />
      <Segmented label="기준선" value={params.ideal ? 'on' : 'off'} onChange={(v) => setParams({ ideal: v === 'on' })} options={[{ value: 'on', label: '1/순위 표시' }, { value: 'off', label: '숨김' }]} />
      <Hint>단어를 빈도 순으로 세워 순위 r과 빈도 f를 로그–로그로 그리면 자연어에서 f ∝ r^(−s), s ≈ 1인 거의 직선이 나타납니다(지프 법칙). 선택한 순위 구간에서 ln f = a − s ln r을 최소제곱으로 적합해 지수 s를 구합니다. 순위가 낮은 꼬리는 빈도가 1, 2처럼 정수로 계단져 기울기가 편향되므로 구간을 조절해 보세요. 최소제곱 적합은 간단하지만 꼬리 부분에 민감하며, 엄밀한 추정에는 최대가능도 방법이 쓰입니다.</Hint>
    </ControlGroup>
  )
}

export const zipfModule: VizModule<ZipfParams> = {
  roles: textRoles, datasets: ['corpus-zipf', 'corpus-topics'], defaultParams: { from: 1, to: 200, ideal: true },
  Chart: ZipfChart, Controls: ZipfControls, hint: '점이 회색 점선(1/순위)에 가까우면 지프 법칙을 따릅니다 · 적합 구간을 바꿔 기울기가 어떻게 달라지는지 보세요 · 문장 수를 늘리면 꼬리가 채워집니다 (합성 말뭉치)',
}
