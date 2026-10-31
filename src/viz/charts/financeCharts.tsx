import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Legend, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, toTime, type DataTable } from '../../data/table'
import { categoryColor } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { formatISO } from '../../stats/datetime'
import { averageTrueRange, drawdown, heikinAshi, kagi, lineBreak, marketImpact, nelsonSiegel, orderBookDepth, pointAndFigure, renko, volumeProfile } from '../../stats/finance'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'
import { candlestickModule, prepareCandles } from './candlestick'
import { paddedDomain } from './shared'

/** Price-transformation charts (the price is re-plotted by rule, not by time) and other finance views. All example data are synthetic. */

const priceRoles = candlestickModule.roles

interface Colors { up: string; down: string }
const PRESETS = { kr: { up: '#d4403a', down: '#2f6fd0' }, global: { up: '#2a8c82', down: '#cf4f6a' } } as const
type Preset = keyof typeof PRESETS

function ColorControls({ params, setParams }: { params: { preset: Preset }; setParams: (p: { preset: Preset }) => void }) {
  return <Segmented label="색 규칙" value={params.preset} onChange={(preset) => setParams({ preset })} testId="ctl-fin-colors" options={[{ value: 'kr', label: '한국식 (상승 빨강)' }, { value: 'global', label: '글로벌 (상승 초록)' }]} />
}

const timeLabel = (t: number) => formatISO(t)

function useCandles(table: DataTable, mapping: Mapping) {
  return useMemo(() => prepareCandles(table, mapping), [table, mapping])
}

const need = <ChartMessage>날짜, 시가·고가·저가·종가(숫자형) 열을 선택하세요.</ChartMessage>

/** Index axis (brick / column / line number) with a few date labels taken from the bricks. */
function IndexAxis({ x, y, count, label, times }: { x: d3.ScaleLinear<number, number>; y: number; count: number; label: string; times: number[] }) {
  const ticks = d3.ticks(0, Math.max(1, count), 6).filter((v) => v >= 0 && v < times.length)
  return (
    <g transform={`translate(0,${y})`} className="axis" aria-hidden="true">
      <line className="domain" x1={x.range()[0]} x2={x.range()[1]} />
      {ticks.map((v) => <g key={v} transform={`translate(${x(v + 0.5)},0)`}><line y2={5} /><text y={18} textAnchor="middle">{timeLabel(times[v])}</text></g>)}
      <text className="axis-label" x={(x.range()[0] + x.range()[1]) / 2} y={42} textAnchor="middle">{label}</text>
    </g>
  )
}

// ─── Renko ──────────────────────────────────────────────────────────────────────────

export interface RenkoParams { mode: 'fixed' | 'atr'; size: number; atrMult: number; preset: Preset; showLine: boolean }

function RenkoChart({ table, mapping, params, width, height, compact }: ChartProps<RenkoParams>) {
  const { candles } = useCandles(table, mapping)
  const atr = useMemo(() => averageTrueRange(candles), [candles])
  const size = params.mode === 'atr' ? Math.max(1e-6, atr * params.atrMult) : params.size
  const bricks = useMemo(() => renko(candles.map((c) => ({ t: c.t, c: c.c })), size), [candles, size])
  const m = margins(compact)
  const iw = Math.max(40, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!roleColumn(mapping, 'close')) return need
  if (candles.length < 3) return <ChartMessage>유효한 가격 행이 3개 이상 필요합니다.</ChartMessage>
  if (!bricks.length) return <ChartMessage>벽돌 크기({fmt(size, 2)})가 가격 변동보다 커서 벽돌이 만들어지지 않습니다.<small>벽돌 크기를 줄이세요.</small></ChartMessage>
  const c: Colors = PRESETS[params.preset]
  const x = d3.scaleLinear().domain([0, bricks.length]).range([0, iw]), y = d3.scaleLinear().domain(paddedDomain(bricks.flatMap((b) => [b.open, b.close]), 0.05)).range([ih, 0])
  const bw = Math.max(2, Math.min(34, iw / bricks.length - 1.5))
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`렌코 차트: 벽돌 ${bricks.length}개, 크기 ${fmt(size, 2)}`} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <IndexAxis x={x} y={ih} count={bricks.length} label="벽돌 번호 (시간이 아닌 가격 변동 순서)" times={bricks.map((b) => b.t)} />
          <AxisLeft scale={y} x={0} grid={iw} label="가격" compact={compact} />
          {params.showLine && !compact && <path d={d3.line<(typeof candles)[number]>().x((_, i) => x((i / candles.length) * bricks.length)).y((k) => y(k.c))(candles) ?? ''} fill="none" stroke="#9aa7a3" strokeOpacity={0.5} strokeWidth={1} pointerEvents="none" />}
          {bricks.map((b) => <rect key={b.index} data-testid="renko-brick" data-up={b.up ? '1' : '0'} x={x(b.index + 0.5) - bw / 2} y={y(Math.max(b.open, b.close))} width={bw} height={Math.max(1, Math.abs(y(b.open) - y(b.close)) - 0.5)} fill={b.up ? c.up : c.down} fillOpacity={0.9}
            onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>벽돌 {b.index + 1}</b> ({b.up ? '상승' : '하락'})<br />{fmt(b.open, 2)} → {fmt(b.close, 2)}<br />{timeLabel(b.t)}에 완성</>) }} onPointerLeave={hide} />)}
        </g>
      </svg>
      {!compact && <><Readout items={[{ label: '벽돌 크기', value: fmt(size, 2) }, { label: '벽돌', value: bricks.length }, { label: '상승', value: bricks.filter((b) => b.up).length }, { label: 'ATR', value: fmt(atr, 2) }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function RenkoControls({ params, setParams }: ControlsProps<RenkoParams>) {
  return (
    <ControlGroup title="렌코 벽돌">
      <Segmented label="벽돌 크기" value={params.mode} onChange={(mode) => setParams({ mode })} testId="ctl-renko-mode" options={[{ value: 'atr', label: 'ATR 배수' }, { value: 'fixed', label: '고정 값' }]} />
      {params.mode === 'fixed' ? <Slider label="벽돌 크기 (가격)" value={params.size} min={0.2} max={10} step={0.1} onChange={(size) => setParams({ size })} testId="ctl-renko-size" /> : <Slider label="ATR 배수" value={params.atrMult} min={0.2} max={3} step={0.1} onChange={(atrMult) => setParams({ atrMult })} testId="ctl-renko-atr" />}
      <Toggle label="종가 선 (참고)" checked={params.showLine} onChange={(showLine) => setParams({ showLine })} />
      <ColorControls params={params} setParams={setParams} />
      <Hint>렌코 차트는 시간 대신 가격 변동만 그립니다. 종가가 마지막 벽돌의 윗변(아랫변)에서 벽돌 한 개 크기만큼 더 오르면(내리면) 새 벽돌을 붙이고, 작은 등락은 모두 무시합니다. 반전하려면 마지막 벽돌의 시작가를 벽돌 크기만큼 넘어서야 하므로 한 번 반전하는 데 벽돌 두 개 크기의 움직임이 필요합니다. 큰 변동은 한 번에 여러 벽돌을 만듭니다. 벽돌 크기가 결과를 좌우하므로 ATR(평균 진폭) 배수로 변동성에 맞추는 것이 흔합니다. x축은 시간 간격과 무관합니다.</Hint>
    </ControlGroup>
  )
}

export const renkoModule: VizModule<RenkoParams> = {
  roles: priceRoles,
  datasets: ['ohlc'],
  defaultParams: { mode: 'atr', size: 2, atrMult: 1, preset: 'kr', showLine: true },
  Chart: RenkoChart,
  Controls: RenkoControls,
  hint: '벽돌 크기를 바꿔 노이즈가 얼마나 걸러지는지 보세요 · ATR 배수로 변동성에 맞추기 · 벽돌에 포인터를 올리면 완성 시점',
}

// ─── Heikin-Ashi ────────────────────────────────────────────────────────────────────

export interface HaParams { preset: Preset; ghost: boolean }

function HeikinChart({ table, mapping, params, width, height, compact }: ChartProps<HaParams>) {
  const { candles } = useCandles(table, mapping)
  const ha = useMemo(() => heikinAshi(candles), [candles])
  const m = margins(compact)
  const iw = Math.max(40, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!roleColumn(mapping, 'close')) return need
  if (candles.length < 3) return <ChartMessage>유효한 가격 행이 3개 이상 필요합니다.</ChartMessage>
  const c: Colors = PRESETS[params.preset]
  const x = d3.scaleLinear().domain([0, ha.length]).range([0, iw]), y = d3.scaleLinear().domain(paddedDomain(candles.flatMap((k) => [k.h, k.l]), 0.05)).range([ih, 0])
  const bw = Math.max(1.5, (iw / ha.length) * 0.7)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`하이킨 아시 차트: 캔들 ${ha.length}개`} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <IndexAxis x={x} y={ih} count={ha.length} label="날짜" times={ha.map((k) => k.t)} />
          <AxisLeft scale={y} x={0} grid={iw} label="가격" compact={compact} />
          {params.ghost && !compact && candles.map((k, i) => <g key={`g${i}`} stroke="#aab4b0" strokeOpacity={0.55} pointerEvents="none"><line x1={x(i + 0.5)} x2={x(i + 0.5)} y1={y(k.h)} y2={y(k.l)} /><rect x={x(i + 0.5) - bw / 2} y={y(Math.max(k.o, k.c))} width={bw} height={Math.max(1, Math.abs(y(k.o) - y(k.c)))} fill="none" /></g>)}
          {ha.map((k, i) => { const up = k.c >= k.o; const col = up ? c.up : c.down; return (
            <g key={i} data-testid="ha-candle" data-up={up ? '1' : '0'} onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>{timeLabel(k.t)}</b><br />HA 시 {fmt(k.o, 2)} · 고 {fmt(k.h, 2)}<br />HA 저 {fmt(k.l, 2)} · 종 {fmt(k.c, 2)}<br />실제 종가 {fmt(candles[i].c, 2)}</>) }} onPointerLeave={hide}>
              <line x1={x(i + 0.5)} x2={x(i + 0.5)} y1={y(k.h)} y2={y(k.l)} stroke={col} />
              <rect x={x(i + 0.5) - bw / 2} y={y(Math.max(k.o, k.c))} width={bw} height={Math.max(1, Math.abs(y(k.o) - y(k.c)))} fill={col} />
            </g>) })}
        </g>
      </svg>
      {!compact && <><Readout items={[{ label: '캔들', value: ha.length }, { label: '연속 상승 최대', value: longestRun(ha.map((k) => k.c >= k.o)) }, { label: '실제 캔들 반전', value: switches(candles.map((k) => k.c >= k.o)) }, { label: 'HA 반전', value: switches(ha.map((k) => k.c >= k.o)) }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

const longestRun = (v: boolean[]) => { let best = 0, run = 0; for (const x of v) { run = x ? run + 1 : 0; best = Math.max(best, run) } return best }
const switches = (v: boolean[]) => v.reduce((s, x, i) => s + (i && x !== v[i - 1] ? 1 : 0), 0)

function HeikinControls({ params, setParams }: ControlsProps<HaParams>) {
  return (
    <ControlGroup title="하이킨 아시">
      <ColorControls params={params} setParams={setParams} />
      <Toggle label="실제 캔들 (옅게)" checked={params.ghost} onChange={(ghost) => setParams({ ghost })} testId="ctl-ha-ghost" />
      <Hint>하이킨 아시는 종가 = (시·고·저·종)의 평균, 시가 = 직전 하이킨 아시 몸통의 중간으로 캔들을 다시 계산해 평활합니다. 추세가 이어지는 동안 같은 색의 캔들이 길게 이어져 추세가 또렷하지만, 시가·종가가 실제 거래 가격이 아니므로 체결 가격으로 쓸 수 없습니다. 평균 때문에 실제 가격보다 한 박자 늦게 반응합니다. 아래 읽기값에서 반전 횟수가 실제 캔들보다 줄어든 것을 확인하세요.</Hint>
    </ControlGroup>
  )
}

export const heikinAshiModule: VizModule<HaParams> = {
  roles: priceRoles,
  datasets: ['ohlc'],
  defaultParams: { preset: 'kr', ghost: true },
  Chart: HeikinChart,
  Controls: HeikinControls,
  hint: '실제 캔들을 옅게 겹쳐 하이킨 아시가 얼마나 평활되는지 보세요 · 추세가 이어질 때 같은 색 캔들이 길게 이어집니다 · 포인터로 실제 종가 확인',
}

// ─── Kagi ───────────────────────────────────────────────────────────────────────────

export interface KagiParams { unit: 'abs' | 'pct'; amount: number; pctAmount: number; preset: Preset }

function KagiChart({ table, mapping, params, width, height, compact }: ChartProps<KagiParams>) {
  const { candles } = useCandles(table, mapping)
  const last = candles[candles.length - 1]?.c ?? 100
  const rev = params.unit === 'abs' ? params.amount : (last * params.pctAmount) / 100
  const segs = useMemo(() => kagi(candles.map((k) => ({ t: k.t, c: k.c })), rev), [candles, rev])
  const m = margins(compact)
  const iw = Math.max(40, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!roleColumn(mapping, 'close')) return need
  if (candles.length < 3) return <ChartMessage>유효한 가격 행이 3개 이상 필요합니다.</ChartMessage>
  if (!segs.length) return <ChartMessage>반전 기준이 커서 선이 그려지지 않습니다. 기준을 줄이세요.</ChartMessage>
  const c: Colors = PRESETS[params.preset]
  const nx = segs[segs.length - 1].x + 1
  const x = d3.scaleLinear().domain([0, nx]).range([0, iw]), y = d3.scaleLinear().domain(paddedDomain(segs.flatMap((s) => [s.from, s.to]), 0.06)).range([ih, 0])
  const times = segs.map((s) => s.t)
  const w = (s: (typeof segs)[number]) => (s.thick ? 3.6 : 1.6)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`카기 차트: 선 ${segs.length}개, 반전 기준 ${fmt(rev, 2)}`} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <IndexAxis x={x} y={ih} count={segs.length} label="선 번호 (반전 순서)" times={times} />
          <AxisLeft scale={y} x={0} grid={iw} label="가격" compact={compact} />
          {segs.map((s, i) => (
            <g key={i} data-testid="kagi-segment" data-thick={s.thick ? '1' : '0'} onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>{s.thick ? '굵은 선 (양선)' : '가는 선 (음선)'}</b> · {s.up ? '상승' : '하락'}<br />{fmt(s.from, 2)} → {fmt(s.to, 2)}</>) }} onPointerLeave={hide}>
              <line x1={x(s.x + 0.5)} x2={x(s.x + 0.5)} y1={y(s.from)} y2={y(s.to)} stroke={s.thick ? c.up : c.down} strokeWidth={w(s)} strokeLinecap="square" />
              {i + 1 < segs.length && <line x1={x(s.x + 0.5)} x2={x(segs[i + 1].x + 0.5)} y1={y(s.to)} y2={y(s.to)} stroke={segs[i + 1].thick ? c.up : c.down} strokeWidth={w(segs[i + 1])} />}
            </g>
          ))}
        </g>
      </svg>
      {!compact && <><Legend items={[{ key: '굵은 선: 직전 어깨를 돌파 (수요 우세)', color: c.up }, { key: '가는 선: 직전 허리를 이탈 (공급 우세)', color: c.down }]} /><Readout items={[{ label: '반전 기준', value: fmt(rev, 2) }, { label: '선', value: segs.length }, { label: '굵은 선', value: segs.filter((s) => s.thick).length }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function KagiControls({ params, setParams }: ControlsProps<KagiParams>) {
  return (
    <ControlGroup title="카기 반전 기준">
      <Segmented label="기준 단위" value={params.unit} onChange={(unit) => setParams({ unit })} testId="ctl-kagi-unit" options={[{ value: 'pct', label: '종가의 %' }, { value: 'abs', label: '가격 값' }]} />
      {params.unit === 'abs' ? <Slider label="반전 기준 (가격)" value={params.amount} min={0.5} max={15} step={0.25} onChange={(amount) => setParams({ amount })} testId="ctl-kagi-amount" /> : <Slider label="반전 기준 (마지막 종가의 %)" value={params.pctAmount} min={1} max={15} step={0.5} onChange={(pctAmount) => setParams({ pctAmount })} format={(v) => `${v}%`} testId="ctl-kagi-pct" />}
      <ColorControls params={params} setParams={setParams} />
      <Hint>카기 차트는 가격이 한 방향으로 가는 동안 선을 늘리고, 반전 기준만큼 반대로 움직이면 한 칸 옆에서 반대 방향으로 선을 그립니다. 선의 굵기는 직전의 어깨(고점)를 넘으면 굵게(수요 우세), 허리(저점) 아래로 내려가면 가늘게(공급 우세) 바뀝니다. 시간 축이 없고 작은 등락은 무시되므로 노이즈가 줄지만, 반전 기준에 따라 모양이 크게 달라집니다.</Hint>
    </ControlGroup>
  )
}

export const kagiModule: VizModule<KagiParams> = {
  roles: priceRoles,
  datasets: ['ohlc'],
  defaultParams: { unit: 'pct', amount: 3, pctAmount: 4, preset: 'kr' },
  Chart: KagiChart,
  Controls: KagiControls,
  hint: '반전 기준을 바꿔 선의 수가 어떻게 변하는지 보세요 · 굵은 선은 직전 어깨 돌파, 가는 선은 허리 이탈 · 선에 포인터를 올리면 가격 범위',
}

// ─── Point & Figure ─────────────────────────────────────────────────────────────────

export interface PfParams { auto: boolean; box: number; reversal: number; preset: Preset }

function PfChart({ table, mapping, params, width, height, compact }: ChartProps<PfParams>) {
  const { candles } = useCandles(table, mapping)
  const autoBox = useMemo(() => { const a = averageTrueRange(candles); const raw = a * 0.5; const p = 10 ** Math.floor(Math.log10(raw || 1)); return Math.max(0.01, Math.round(raw / p) * p) }, [candles])
  const box = params.auto ? autoBox : params.box
  const cols = useMemo(() => pointAndFigure(candles.map((k) => ({ t: k.t, c: k.c })), box, params.reversal), [candles, box, params.reversal])
  const m = margins(compact)
  const iw = Math.max(40, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!roleColumn(mapping, 'close')) return need
  if (candles.length < 3) return <ChartMessage>유효한 가격 행이 3개 이상 필요합니다.</ChartMessage>
  if (!cols.length) return <ChartMessage>상자 크기가 가격 변동보다 커서 열이 만들어지지 않습니다. 상자를 줄이세요.</ChartMessage>
  const c: Colors = PRESETS[params.preset]
  const lo = Math.min(...cols.map((k) => k.low)), hi = Math.max(...cols.map((k) => k.low + k.boxes * box))
  const rows = Math.max(1, Math.round((hi - lo) / box))
  const cell = Math.max(3, Math.min(iw / cols.length, ih / rows))
  const y = (price: number) => ih - ((price - lo) / box) * cell
  const x = d3.scaleLinear().domain([0, cols.length]).range([0, Math.min(iw, cols.length * cell)])
  const ticks = d3.range(0, rows + 1, Math.max(1, Math.ceil(rows / 8)))
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`포인트 앤 피겨: 열 ${cols.length}개, 상자 ${fmt(box, 2)}`} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          {ticks.map((t) => <g key={t}><line x1={0} x2={Math.min(iw, cols.length * cell)} y1={y(lo + t * box)} y2={y(lo + t * box)} stroke="#e7ecea" />{!compact && <text x={-8} y={y(lo + t * box) - cell / 2} dy="0.32em" textAnchor="end" fontSize={11} fill="#4b5563">{fmt(lo + t * box, 2)}</text>}</g>)}
          {cols.map((col, i) => Array.from({ length: col.boxes }, (_, b) => {
            const py = y(col.low + b * box) - cell / 2, px = x(i) + cell / 2
            const r = cell * 0.38
            return col.dir === 'X'
              ? <g key={`${i}-${b}`} data-testid="pf-x" stroke={c.up} strokeWidth={Math.max(1, cell / 8)} strokeLinecap="round"><line x1={px - r} y1={py - r} x2={px + r} y2={py + r} /><line x1={px - r} y1={py + r} x2={px + r} y2={py - r} /></g>
              : <circle key={`${i}-${b}`} data-testid="pf-o" cx={px} cy={py} r={r} fill="none" stroke={c.down} strokeWidth={Math.max(1, cell / 8)} />
          }))}
          {!compact && cols.map((col, i) => <rect key={`h${i}`} x={x(i)} y={y(col.low + col.boxes * box)} width={cell} height={col.boxes * cell} fill="transparent" onPointerEnter={(e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>열 {i + 1} ({col.dir === 'X' ? '상승 X' : '하락 O'})</b><br />{fmt(col.low, 2)} ~ {fmt(col.low + col.boxes * box, 2)}<br />상자 {col.boxes}개 · {timeLabel(col.t)}</>) }} onPointerLeave={hide} />)}
        </g>
      </svg>
      {!compact && <><Readout items={[{ label: '상자', value: fmt(box, 2) }, { label: '반전', value: `${params.reversal}상자` }, { label: '열', value: cols.length }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function PfControls({ params, setParams }: ControlsProps<PfParams>) {
  return (
    <ControlGroup title="포인트 앤 피겨">
      <Toggle label="상자 크기 자동 (ATR의 절반)" checked={params.auto} onChange={(auto) => setParams({ auto })} testId="ctl-pf-auto" />
      {!params.auto && <Slider label="상자 크기 (가격)" value={params.box} min={0.2} max={6} step={0.1} onChange={(box) => setParams({ box })} testId="ctl-pf-box" />}
      <Slider label="반전 기준 (상자 수)" value={params.reversal} min={1} max={5} onChange={(reversal) => setParams({ reversal })} testId="ctl-pf-rev" />
      <ColorControls params={params} setParams={setParams} />
      <Hint>포인트 앤 피겨는 시간 대신 가격만 그립니다. 가격이 상자 한 칸 이상 오르면 X를 위로 쌓고, 내리면 O를 아래로 쌓으며, 현재 열의 반대 방향으로 ‘반전 기준’ 상자 수만큼 움직여야 새 열을 시작합니다(보통 3상자 반전). 열이 늘어도 시간이 흐른 만큼 늘지 않으므로 가로 길이는 시간이 아니라 방향 전환 횟수입니다. 종가만 사용합니다.</Hint>
    </ControlGroup>
  )
}

export const pointFigureModule: VizModule<PfParams> = {
  roles: priceRoles,
  datasets: ['ohlc'],
  defaultParams: { auto: true, box: 2, reversal: 3, preset: 'kr' },
  Chart: PfChart,
  Controls: PfControls,
  hint: '상자 크기와 반전 상자 수를 바꿔 열의 수가 어떻게 변하는지 보세요 · X는 상승, O는 하락 · 열에 포인터를 올리면 가격 범위',
}

// ─── Equivolume ─────────────────────────────────────────────────────────────────────

export interface EquiParams { preset: Preset; normalize: boolean }

function EquivolumeChart({ table, mapping, params, width, height, compact }: ChartProps<EquiParams>) {
  const { candles, hasVolume } = useCandles(table, mapping)
  const m = margins(compact)
  const iw = Math.max(40, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const items = useMemo(() => { let acc = 0; const total = d3.sum(candles, (k) => k.v ?? 0); return candles.map((k) => { const v = Math.max(0, k.v ?? 0); const x0 = acc; acc += v; return { k, v, x0, x1: acc, share: total ? v / total : 0 } }) }, [candles])
  if (!roleColumn(mapping, 'close') || !roleColumn(mapping, 'volume')) return <ChartMessage>날짜, 시가·고가·저가·종가, 거래량(숫자형) 열을 모두 선택하세요.</ChartMessage>
  if (!hasVolume || candles.length < 3) return <ChartMessage>거래량이 있는 유효한 가격 행이 3개 이상 필요합니다.</ChartMessage>
  const c: Colors = PRESETS[params.preset]
  const total = items[items.length - 1].x1
  const x = d3.scaleLinear().domain([0, total]).range([0, iw]), y = d3.scaleLinear().domain(paddedDomain(candles.flatMap((k) => [k.h, k.l]), 0.05)).range([ih, 0])
  const times = items.map((i) => i.k.t)
  const ticks = d3.ticks(0, items.length - 1, 6).filter((i) => i < items.length)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`이퀴볼륨 차트: 캔들 ${items.length}개, 너비는 거래량`} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisLeft scale={y} x={0} grid={iw} label="가격 (상자의 높이 = 고가−저가)" compact={compact} />
          <g transform={`translate(0,${ih})`} className="axis" aria-hidden="true"><line className="domain" x2={iw} />{!compact && ticks.map((i) => <g key={i} transform={`translate(${x((items[i].x0 + items[i].x1) / 2)},0)`}><line y2={5} /><text y={18} textAnchor="middle">{timeLabel(times[i])}</text></g>)}{!compact && <text className="axis-label" x={iw / 2} y={42} textAnchor="middle">누적 거래량 (상자의 너비 = 거래량)</text>}</g>
          {items.map((it, i) => { const up = it.k.c >= it.k.o; return <rect key={i} data-testid="equi-box" data-volume={it.v} x={x(it.x0) + 0.3} y={y(it.k.h)} width={Math.max(0.6, x(it.x1) - x(it.x0) - 0.6)} height={Math.max(1, y(it.k.l) - y(it.k.h))} fill={up ? c.up : c.down} fillOpacity={0.72} stroke="#fff" strokeWidth={0.4}
            onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>{timeLabel(it.k.t)}</b><br />고 {fmt(it.k.h, 2)} · 저 {fmt(it.k.l, 2)}<br />시 {fmt(it.k.o, 2)} · 종 {fmt(it.k.c, 2)}<br />거래량 {fmt(it.v, 0)} ({pct(it.share)})</>) }} onPointerLeave={hide} /> })}
          {items.map((it, i) => <line key={`c${i}`} x1={x(it.x0)} x2={x(it.x1)} y1={y(it.k.c)} y2={y(it.k.c)} stroke="#111827" strokeWidth={1.3} pointerEvents="none" />)}
        </g>
      </svg>
      {!compact && <><Readout items={[{ label: '캔들', value: items.length }, { label: '총 거래량', value: fmt(total, 0) }, { label: '최대 거래량 캔들', value: timeLabel(items.reduce((b, i) => (i.v > b.v ? i : b)).k.t) }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function EquiControls({ params, setParams }: ControlsProps<EquiParams>) {
  return (
    <ControlGroup title="이퀴볼륨">
      <ColorControls params={params} setParams={setParams} />
      <Hint>이퀴볼륨 차트는 캔들마다 하나의 상자를 그립니다. 높이는 그날의 가격 범위(고가−저가), 너비는 거래량에 비례하므로 넓은 상자는 많은 거래가 그 가격대에서 일어났다는 뜻입니다. 상자 안의 가는 선이 종가입니다. 가로축이 거래량 누적이라 시간 간격이 일정하지 않습니다. 가격 범위 안에서 어디에 거래가 몰렸는지는 알 수 없습니다(거래량 프로파일을 보세요).</Hint>
    </ControlGroup>
  )
}

export const equivolumeModule: VizModule<EquiParams> = {
  roles: priceRoles,
  datasets: ['ohlc'],
  defaultParams: { preset: 'kr', normalize: false },
  Chart: EquivolumeChart,
  Controls: EquiControls,
  hint: '상자의 너비가 거래량 · 넓고 낮은 상자는 좁은 가격대에서 대량 거래 · 상자에 포인터를 올리면 가격과 거래량 비중',
}

// ─── volume profile ─────────────────────────────────────────────────────────────────

export interface VpParams { bins: number; area: number; split: boolean; preset: Preset }

function VolumeProfileChart({ table, mapping, params, width, height, compact }: ChartProps<VpParams>) {
  const { candles, hasVolume } = useCandles(table, mapping)
  const vp = useMemo(() => (candles.length ? volumeProfile(candles, params.bins, params.area) : null), [candles, params.bins, params.area])
  const m = margins(compact, compact ? {} : { right: 20 })
  const iw = Math.max(60, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const priceW = iw * 0.62, profW = iw - priceW - 12
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!roleColumn(mapping, 'close') || !roleColumn(mapping, 'volume')) return <ChartMessage>날짜, 시가·고가·저가·종가, 거래량(숫자형) 열을 모두 선택하세요.</ChartMessage>
  if (!hasVolume || !vp || candles.length < 3) return <ChartMessage>거래량이 있는 유효한 가격 행이 3개 이상 필요합니다.</ChartMessage>
  const c: Colors = PRESETS[params.preset]
  const lo = vp.bins[0].lo, hi = vp.bins[vp.bins.length - 1].hi
  const y = d3.scaleLinear().domain([lo, hi]).range([ih, 0])
  const x = d3.scaleLinear().domain([0, candles.length - 1]).range([0, priceW])
  const vmax = d3.max(vp.bins, (b) => b.volume) ?? 1
  const vx = d3.scaleLinear().domain([0, vmax]).range([0, profW])
  const [a, z] = vp.valueArea
  const bh = ih / vp.bins.length
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`거래량 프로파일: 최대 거래 가격대 ${fmt((vp.bins[vp.poc].lo + vp.bins[vp.poc].hi) / 2, 2)}`} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisLeft scale={y} x={0} grid={priceW} label="가격" compact={compact} />
          {candles.map((k, i) => <g key={i} stroke={k.c >= k.o ? c.up : c.down}><line x1={x(i)} x2={x(i)} y1={y(k.h)} y2={y(k.l)} strokeWidth={1} /><line x1={x(i)} x2={x(i)} y1={y(k.o)} y2={y(k.c)} strokeWidth={Math.max(1.5, priceW / candles.length * 0.6)} /></g>)}
          <line x1={0} x2={priceW + 12 + profW} y1={y((vp.bins[vp.poc].lo + vp.bins[vp.poc].hi) / 2)} y2={y((vp.bins[vp.poc].lo + vp.bins[vp.poc].hi) / 2)} stroke="#e07a3f" strokeDasharray="5 3" data-testid="poc-line" />
          <g transform={`translate(${priceW + 12},0)`}>
            <rect x={0} y={y(vp.bins[z].hi)} width={profW} height={Math.max(0, y(vp.bins[a].lo) - y(vp.bins[z].hi))} fill="#2a7d74" fillOpacity={0.08} data-testid="value-area" />
            {vp.bins.map((b, i) => (
              <g key={i} data-testid="vp-bin" data-volume={b.volume.toFixed(1)} onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>{fmt(b.lo, 2)} ~ {fmt(b.hi, 2)}</b><br />거래량 {fmt(b.volume, 0)} ({pct(b.volume / vp.total)})<br />매수 우세분 {fmt(b.buy, 0)} · 매도 우세분 {fmt(b.volume - b.buy, 0)}{i === vp.poc ? <><br /><b>최대 거래 가격대 (POC)</b></> : null}</>) }} onPointerLeave={hide}>
                {params.split
                  ? <><rect x={0} y={y(b.hi)} width={vx(b.buy)} height={Math.max(0.5, bh - 1)} fill={c.up} fillOpacity={0.8} /><rect x={vx(b.buy)} y={y(b.hi)} width={vx(b.volume - b.buy)} height={Math.max(0.5, bh - 1)} fill={c.down} fillOpacity={0.8} /></>
                  : <rect x={0} y={y(b.hi)} width={vx(b.volume)} height={Math.max(0.5, bh - 1)} fill={i === vp.poc ? '#e07a3f' : i >= a && i <= z ? '#2a7d74' : '#b7c4c0'} fillOpacity={0.9} />}
              </g>
            ))}
            {!compact && <text x={profW} y={-6} textAnchor="end" fontSize={11} fill="#6b7773">거래량</text>}
          </g>
        </g>
      </svg>
      {!compact && <><Readout items={[{ label: 'POC', value: fmt((vp.bins[vp.poc].lo + vp.bins[vp.poc].hi) / 2, 2) }, { label: `가치 영역 ${Math.round(params.area * 100)}%`, value: `${fmt(vp.bins[a].lo, 2)} ~ ${fmt(vp.bins[z].hi, 2)}` }, { label: '총 거래량', value: fmt(vp.total, 0) }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function VpControls({ params, setParams }: ControlsProps<VpParams>) {
  return (
    <ControlGroup title="거래량 프로파일">
      <Slider label="가격 구간 수" value={params.bins} min={10} max={80} onChange={(bins) => setParams({ bins })} testId="ctl-vp-bins" />
      <Slider label="가치 영역 비율" value={params.area} min={0.5} max={0.95} step={0.05} onChange={(area) => setParams({ area })} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-vp-area" />
      <Toggle label="매수 우세·매도 우세로 나누기" checked={params.split} onChange={(split) => setParams({ split })} testId="ctl-vp-split" />
      <ColorControls params={params} setParams={setParams} />
      <Hint>거래량 프로파일은 가격 구간별로 거래량을 모은 가로 막대입니다. 각 캔들의 거래량은 그 캔들의 고가–저가 범위가 걸치는 구간에 겹치는 길이에 비례해 나눕니다(범위 안에서 균일하게 거래됐다고 가정). 가장 긴 막대가 POC(최대 거래 가격대)이고, 가치 영역은 POC를 중심으로 전체 거래량의 일정 비율(기본 70%)을 담는 가장 좁은 가격 범위입니다. 일봉 거래량으로는 일중 분포를 알 수 없어 근사입니다. 매수·매도 우세는 캔들이 상승했는지로 구분한 근사입니다.</Hint>
    </ControlGroup>
  )
}

export const volumeProfileModule: VizModule<VpParams> = {
  roles: priceRoles,
  datasets: ['ohlc'],
  defaultParams: { bins: 36, area: 0.7, split: false, preset: 'kr' },
  Chart: VolumeProfileChart,
  Controls: VpControls,
  hint: '가격 구간 수와 가치 영역 비율을 바꿔 보세요 · 주황 선은 최대 거래 가격대(POC) · 막대에 포인터를 올리면 구간 거래량',
}

// ─── three-line break ───────────────────────────────────────────────────────────────

export interface LbParams { lines: number; preset: Preset }

function LineBreakChart({ table, mapping, params, width, height, compact }: ChartProps<LbParams>) {
  const { candles } = useCandles(table, mapping)
  const lines = useMemo(() => lineBreak(candles.map((k) => ({ t: k.t, c: k.c })), params.lines), [candles, params.lines])
  const m = margins(compact)
  const iw = Math.max(40, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!roleColumn(mapping, 'close')) return need
  if (candles.length < 4) return <ChartMessage>유효한 가격 행이 4개 이상 필요합니다.</ChartMessage>
  const c: Colors = PRESETS[params.preset]
  const x = d3.scaleLinear().domain([0, lines.length]).range([0, iw]), y = d3.scaleLinear().domain(paddedDomain(lines.flatMap((l) => [l.open, l.close]), 0.05)).range([ih, 0])
  const bw = Math.max(2, Math.min(34, iw / lines.length - 1.5))
  const reversals = lines.reduce((s, l, i) => s + (i && l.up !== lines[i - 1].up ? 1 : 0), 0)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`${params.lines}선 전환도: 선 ${lines.length}개, 반전 ${reversals}회`} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <IndexAxis x={x} y={ih} count={lines.length} label="선 번호 (새 극값이 나올 때만 추가)" times={lines.map((l) => l.t)} />
          <AxisLeft scale={y} x={0} grid={iw} label="가격" compact={compact} />
          {lines.map((l, i) => <rect key={i} data-testid="lb-line" data-up={l.up ? '1' : '0'} x={x(l.index + 0.5) - bw / 2} y={y(Math.max(l.open, l.close))} width={bw} height={Math.max(1, Math.abs(y(l.open) - y(l.close)) - 0.5)} fill={l.up ? c.up : c.down} fillOpacity={0.88}
            onPointerEnter={compact ? undefined : (e) => { const q = localPoint(svgRef.current!, e); show(q.x, q.y, <><b>선 {i + 1}</b> ({l.up ? '상승' : '하락'})<br />{fmt(l.open, 2)} → {fmt(l.close, 2)}<br />{timeLabel(l.t)}</>) }} onPointerLeave={hide} />)}
        </g>
      </svg>
      {!compact && <><Readout items={[{ label: '선', value: lines.length }, { label: '반전', value: reversals }, { label: '기준', value: `${params.lines}선 돌파` }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function LbControls({ params, setParams }: ControlsProps<LbParams>) {
  return (
    <ControlGroup title="선 전환도">
      <Slider label="반전에 필요한 선 수" value={params.lines} min={2} max={5} onChange={(lines) => setParams({ lines })} testId="ctl-lb-n" />
      <ColorControls params={params} setParams={setParams} />
      <Hint>3선 전환도는 종가가 직전 선의 고점(저점)을 넘어설 때만 같은 방향의 새 선을 붙입니다. 반전은 종가가 최근 {params.lines}개 선의 가장 높은(낮은) 값을 넘을 때에만 일어나므로 작은 등락은 반전을 만들지 못합니다. 선의 크기는 고정이 아니라 가격 변동에 따라 달라집니다. 시간 축이 없으며 ‘선 수’를 바꾸면 반전이 얼마나 까다로워지는지 볼 수 있습니다.</Hint>
    </ControlGroup>
  )
}

export const lineBreakModule: VizModule<LbParams> = {
  roles: priceRoles,
  datasets: ['ohlc'],
  defaultParams: { lines: 3, preset: 'kr' },
  Chart: LineBreakChart,
  Controls: LbControls,
  hint: '반전에 필요한 선 수를 바꿔 반전이 얼마나 까다로워지는지 보세요 · 선에 포인터를 올리면 가격과 완성 시점',
}

// ─── drawdown ───────────────────────────────────────────────────────────────────────

export interface DdParams { showPrice: boolean; shade: boolean; threshold: number }

function DrawdownChart({ table, mapping, params, width, height, compact }: ChartProps<DdParams>) {
  const di = columnIndex(table, roleColumn(mapping, 'date')), pi = columnIndex(table, roleColumn(mapping, 'price'))
  const series = useMemo(() => { const out: { t: number; p: number }[] = []; if (di < 0 || pi < 0) return out; for (const r of table.rows) { const t = toTime(r[di]), p = toNumber(r[pi]); if (t != null && p != null && p > 0) out.push({ t, p }) } return out.sort((a, b) => a.t - b.t) }, [table, di, pi])
  const dd = useMemo(() => drawdown(series.map((s) => s.p)), [series])
  const split = params.showPrice && !compact
  const m = margins(compact, compact ? {} : { bottom: 52 })
  const iw = Math.max(40, width - m.left - m.right)
  const gap = split ? 28 : 0
  const priceH = split ? Math.max(40, (height - m.top - m.bottom - gap) * 0.5) : 0
  const ddH = Math.max(40, height - m.top - m.bottom - gap - priceH)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!roleColumn(mapping, 'date') || !roleColumn(mapping, 'price')) return <ChartMessage>날짜(날짜형)와 가격(숫자형) 열을 선택하세요.</ChartMessage>
  if (series.length < 3) return <ChartMessage>유효한 (날짜, 가격) 행이 3개 이상 필요합니다.</ChartMessage>
  const x = d3.scaleLinear().domain([series[0].t, series[series.length - 1].t]).range([0, iw])
  const yp = d3.scaleLinear().domain(paddedDomain(series.map((s) => s.p), 0.05)).range([priceH, 0])
  const yd = d3.scaleLinear().domain([Math.min(dd.maxDd * 1.1, -0.02), 0]).range([ddH, 0])
  const area = d3.area<number>().x((_, i) => x(series[i].t)).y0(yd(0)).y1((v) => yd(v)).curve(d3.curveStepAfter)
  const hovered = (e: React.PointerEvent) => {
    const l = localPoint(svgRef.current!, e)
    const t = x.invert(l.x - m.left)
    const i = d3.bisector((s: { t: number }) => s.t).center(series, t)
    show(l.x, l.y, <><b>{timeLabel(series[i].t)}</b><br />가격 {fmt(series[i].p, 2)}<br />직전 고점 {fmt(dd.peak[i], 2)}<br />낙폭 <b>{fmt(dd.dd[i] * 100, 1)}%</b></>)
  }
  const mdStart = series[dd.peakIndex].t, mdEnd = series[dd.maxIndex].t
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`드로다운 차트: 최대 낙폭 ${fmt(dd.maxDd * 100, 1)}%`} onPointerMove={compact ? undefined : hovered} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          {split && (
            <g>
              <AxisLeft scale={yp} x={0} grid={iw} label="가격" ticks={4} />
              <path d={d3.line<number>().x((_, i) => x(series[i].t)).y((_, i) => yp(dd.peak[i])).curve(d3.curveStepAfter)(d3.range(series.length)) ?? ''} fill="none" stroke="#9aa7a3" strokeDasharray="4 3" strokeWidth={1.2} data-testid="peak-line" />
              <path d={d3.line<number>().x((_, i) => x(series[i].t)).y((_, i) => yp(series[i].p))(d3.range(series.length)) ?? ''} fill="none" stroke="#2a7d74" strokeWidth={1.8} />
            </g>
          )}
          <g transform={`translate(0,${priceH + gap})`}>
            <AxisBottom scale={x} y={ddH} grid={ddH} label="날짜" compact={compact} date />
            <AxisLeft scale={yd} x={0} grid={iw} label="최고점 대비 낙폭" format={(v) => `${Math.round(v * 100)}%`} ticks={4} compact={compact} />
            {params.shade && dd.maxDd < 0 && <rect x={x(mdStart)} y={0} width={Math.max(0, x(mdEnd) - x(mdStart))} height={ddH} fill="#d6573c" fillOpacity={0.09} data-testid="maxdd-band" />}
            <path d={area(dd.dd) ?? ''} fill="#d6573c" fillOpacity={0.35} stroke="#c0453a" strokeWidth={1.4} data-testid="dd-area" />
            {params.threshold > 0 && <line x1={0} x2={iw} y1={yd(-params.threshold / 100)} y2={yd(-params.threshold / 100)} stroke="#6b7773" strokeDasharray="5 3" />}
            <circle cx={x(series[dd.maxIndex].t)} cy={yd(dd.maxDd)} r={compact ? 2.5 : 5} fill="#fff" stroke="#c0453a" strokeWidth={2} />
          </g>
        </g>
      </svg>
      {!compact && <><Readout items={[{ label: '최대 낙폭', value: `${fmt(dd.maxDd * 100, 1)}%` }, { label: '최대 낙폭 시점', value: timeLabel(series[dd.maxIndex].t) }, { label: '가장 긴 수중 기간', value: `${dd.longest}개 관측` }, { label: '현재 낙폭', value: `${fmt(dd.dd[dd.dd.length - 1] * 100, 1)}%` }, { label: '고점 회복', value: dd.recovered ? '회복' : '미회복' }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function DdControls({ params, setParams }: ControlsProps<DdParams>) {
  return (
    <ControlGroup title="드로다운">
      <Toggle label="가격과 직전 고점 위쪽에 함께" checked={params.showPrice} onChange={(showPrice) => setParams({ showPrice })} testId="ctl-dd-price" />
      <Toggle label="최대 낙폭 기간 강조" checked={params.shade} onChange={(shade) => setParams({ shade })} />
      <Slider label="기준선 (낙폭 %)" value={params.threshold} min={0} max={40} onChange={(threshold) => setParams({ threshold })} format={(v) => (v ? `−${v}%` : '없음')} testId="ctl-dd-threshold" />
      <Hint>드로다운은 지금 가격이 그때까지의 최고점보다 얼마나 낮은지(P_t / 최고점 − 1)를 시간에 따라 그린 것입니다. 0에 닿으면 최고점을 새로 썼다는 뜻이고, 가장 깊은 골이 최대 낙폭(MDD)입니다. 수익률 평균만으로는 보이지 않는 ‘얼마나 아팠는지’와 ‘얼마나 오래 회복하지 못했는지’를 보여 줍니다. 낙폭 −50%를 회복하려면 +100%가 필요하다는 비대칭에 유의하세요. 예제는 합성 가격입니다.</Hint>
    </ControlGroup>
  )
}

export const drawdownModule: VizModule<DdParams> = {
  roles: [{ key: 'date', label: '날짜', type: 'date', required: true, prefer: '날짜|date' }, { key: 'price', label: '가격 (종가)', type: 'number', required: true, prefer: '종가|close|price' }],
  datasets: ['ohlc'],
  defaultParams: { showPrice: true, shade: true, threshold: 10 },
  Chart: DrawdownChart,
  Controls: DdControls,
  hint: '그래프 위를 움직이면 그 날의 낙폭과 직전 고점 · 최대 낙폭 기간이 붉게 강조됩니다 · 기준선으로 −10% 같은 위험 한도를 비교',
}

// ─── yield curve ────────────────────────────────────────────────────────────────────

export interface YieldParams { log: boolean; fit: boolean; hidden: string[] }

function YieldChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<YieldParams>) {
  const gi = columnIndex(table, roleColumn(mapping, 'group')), mi = columnIndex(table, roleColumn(mapping, 'maturity')), yi = columnIndex(table, roleColumn(mapping, 'yield'))
  const curves = useMemo(() => {
    const by = new Map<string, { t: number; y: number; row: number }[]>()
    if (mi < 0 || yi < 0) return []
    table.rows.forEach((r, row) => { const t = toNumber(r[mi]), y = toNumber(r[yi]); if (t == null || y == null || t <= 0) return; const g = gi >= 0 ? toLabel(r[gi]) || '(빈 값)' : '전체'; (by.get(g) ?? by.set(g, []).get(g)!).push({ t, y, row }) })
    return [...by].map(([key, pts]) => ({ key, pts: pts.sort((a, b) => a.t - b.t) })).filter((c) => c.pts.length >= 2)
  }, [table, gi, mi, yi])
  const color = categoryColor(curves.map((c) => c.key))
  const m = margins(compact)
  const iw = Math.max(40, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const all = curves.flatMap((c) => c.pts)
  const tmin = d3.min(all, (p) => p.t) ?? 0.25, tmax = d3.max(all, (p) => p.t) ?? 30
  const x: d3.ScaleContinuousNumeric<number, number> = params.log ? d3.scaleLog().domain([tmin, tmax]).range([0, iw]) : d3.scaleLinear().domain([0, tmax]).range([0, iw])
  const y = d3.scaleLinear().domain(paddedDomain(all.map((p) => p.y), 0.1)).range([ih, 0])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!roleColumn(mapping, 'maturity') || !roleColumn(mapping, 'yield')) return <ChartMessage>만기(년)와 수익률(숫자형) 열을 선택하세요.</ChartMessage>
  if (!curves.length) return <ChartMessage>만기가 0보다 크고 점이 2개 이상인 곡선이 없습니다.</ChartMessage>
  const shown = curves.filter((c) => !params.hidden.includes(c.key))
  const spread = (c: (typeof curves)[number]) => { const a = c.pts.find((p) => p.t === 2), b = c.pts.find((p) => p.t === 10); return a && b ? b.y - a.y : null }
  const fits = params.fit ? shown.map((c) => ({ key: c.key, fit: nelsonSiegel(c.pts.map((p) => p.t), c.pts.map((p) => p.y)) })) : []
  const grid = d3.range(0, 121).map((i) => (params.log ? tmin * (tmax / tmin) ** (i / 120) : (tmax * i) / 120))
  const line = d3.line<{ t: number; y: number }>().x((p) => x(p.t)).y((p) => y(p.y))
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`수익률 곡선: ${shown.length}개 시점`} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisBottom scale={x as d3.ScaleLinear<number, number>} y={ih} grid={ih} label="만기 (년)" format={(v) => (v < 1 ? v.toFixed(2) : String(v))} compact={compact} ticks={params.log ? 6 : 7} />
          <AxisLeft scale={y} x={0} grid={iw} label="수익률 (%)" compact={compact} />
          {fits.map((f) => f.fit && <path key={`f${f.key}`} data-testid="ns-fit" d={line(grid.map((t) => ({ t, y: f.fit!.at(t) }))) ?? ''} fill="none" stroke={color(f.key)} strokeDasharray="5 4" strokeOpacity={0.8} strokeWidth={1.6} />)}
          {shown.map((c) => (
            <g key={c.key}>
              <path data-testid="yield-line" data-group={c.key} d={line(c.pts) ?? ''} fill="none" stroke={color(c.key)} strokeWidth={2.2} strokeLinejoin="round" />
              {c.pts.map((p, i) => <circle key={i} cx={x(p.t)} cy={y(p.y)} r={compact ? 2 : 4} fill="#fff" stroke={color(c.key)} strokeWidth={1.8} onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>{c.key}</b><br />만기 {p.t}년 · {fmt(p.y, 3)}%</>) }} onPointerLeave={hide} />)}
            </g>
          ))}
        </g>
      </svg>
      {!compact && (<>
        <Legend items={curves.map((c) => ({ key: c.key, color: color(c.key) }))} hidden={params.hidden} onToggle={(k) => setParams({ hidden: params.hidden.includes(k) ? params.hidden.filter((x2) => x2 !== k) : [...params.hidden, k] })} />
        <Readout items={shown.flatMap((c) => { const s = spread(c); return s == null ? [] : [{ label: `10Y−2Y ${c.key.slice(0, 6)}`, value: `${fmt(s * 100, 0)}bp ${s < 0 ? '(역전)' : ''}` }] })} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

function YieldControls({ params, setParams }: ControlsProps<YieldParams>) {
  return (
    <ControlGroup title="수익률 곡선">
      <Toggle label="만기 축 로그 눈금" checked={params.log} onChange={(log) => setParams({ log })} testId="ctl-yield-log" />
      <Toggle label="Nelson–Siegel 적합 곡선" checked={params.fit} onChange={(fit) => setParams({ fit })} testId="ctl-yield-fit" />
      <Hint>수익률 곡선은 만기별 금리를 이은 선입니다. 보통 만기가 길수록 금리가 높은 우상향(정상)이지만, 단기 금리가 장기보다 높은 역전은 경기 침체의 선행 신호로 자주 언급됩니다(필연은 아님). 점선은 수준·기울기·곡률 세 성분(β0, β1, β2)과 감쇠 λ로 곡선을 요약하는 Nelson–Siegel 모형을 최소제곱으로 맞춘 것입니다. 10년−2년 금리 차(bp)로 기울기를 요약합니다. 예제는 합성 수익률로 실제 시장 금리가 아닙니다.</Hint>
    </ControlGroup>
  )
}

export const yieldCurveModule: VizModule<YieldParams> = {
  roles: [{ key: 'group', label: '시점 (곡선)', type: 'category', auto: true, prefer: '시점|date|기준' }, { key: 'maturity', label: '만기 (년)', type: 'number', required: true, prefer: '만기|maturity' }, { key: 'yield', label: '수익률 (%)', type: 'number', required: true, prefer: '수익률|yield' }],
  datasets: ['yield-curves'],
  defaultParams: { log: true, fit: false, hidden: [] },
  Chart: YieldChart,
  Controls: YieldControls,
  hint: '세 시점의 곡선 모양(정상·평탄·역전)을 비교 · Nelson–Siegel 적합선 켜기 · 범례로 곡선 숨기기 · 점에 포인터를 올리면 수익률',
}

// ─── order book depth ───────────────────────────────────────────────────────────────

export interface DepthParams { window: number; impact: number; preset: Preset }

const isBid = (s: string) => /매수|bid|buy/i.test(s)

function DepthChart({ table, mapping, params, width, height, compact }: ChartProps<DepthParams>) {
  const si = columnIndex(table, roleColumn(mapping, 'side')), pi = columnIndex(table, roleColumn(mapping, 'price')), zi = columnIndex(table, roleColumn(mapping, 'size'))
  const book = useMemo(() => {
    const bids: { price: number; size: number }[] = [], asks: { price: number; size: number }[] = []
    if (si < 0 || pi < 0 || zi < 0) return null
    for (const r of table.rows) { const p = toNumber(r[pi]), z = toNumber(r[zi]); if (p == null || z == null || z < 0) continue; (isBid(toLabel(r[si])) ? bids : asks).push({ price: p, size: z }) }
    return bids.length && asks.length ? orderBookDepth(bids, asks) : null
  }, [table, si, pi, zi])
  const m = margins(compact)
  const iw = Math.max(40, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!roleColumn(mapping, 'side') || !roleColumn(mapping, 'price') || !roleColumn(mapping, 'size')) return <ChartMessage>방향(매수/매도), 가격, 수량(숫자형) 열을 선택하세요.</ChartMessage>
  if (!book) return <ChartMessage>매수와 매도 호가가 모두 필요합니다.<small>방향 열에 ‘매수’, ‘매도’(또는 bid, ask)가 들어 있어야 합니다.</small></ChartMessage>
  const c: Colors = { up: '#2a8c82', down: '#cf4f6a' }
  const w = params.window / 100
  const lo = book.mid - (book.mid - Math.min(...book.bid.map((l) => l.price))) * w, hi = book.mid + (Math.max(...book.ask.map((l) => l.price)) - book.mid) * w
  const bid = book.bid.filter((l) => l.price >= lo), ask = book.ask.filter((l) => l.price <= hi)
  const cmax = Math.max(bid[bid.length - 1]?.cum ?? 0, ask[ask.length - 1]?.cum ?? 0, 1)
  const x = d3.scaleLinear().domain([lo, hi]).range([0, iw]), y = d3.scaleLinear().domain([0, cmax * 1.05]).range([ih, 0])
  const stepArea = (levels: typeof bid, bidSide: boolean) => {
    const pts: [number, number][] = [[x(levels[0].price), y(0)]]
    levels.forEach((l, i) => { const prev = i ? levels[i - 1].cum : 0; pts.push([x(l.price), y(prev)], [x(l.price), y(l.cum)]) })
    const last = levels[levels.length - 1]
    pts.push([x(bidSide ? lo : hi), y(last.cum)], [x(bidSide ? lo : hi), y(0)])
    return `M${pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join('L')}Z`
  }
  const impact = params.impact > 0 ? marketImpact(book.ask, params.impact) : null
  const imbalance = (bid[bid.length - 1]?.cum ?? 0) / ((bid[bid.length - 1]?.cum ?? 0) + (ask[ask.length - 1]?.cum ?? 0) || 1)
  const hover = (e: React.PointerEvent) => {
    const l = localPoint(svgRef.current!, e)
    const price = x.invert(l.x - m.left)
    if (l.x < m.left || l.x > m.left + iw) { hide(); return }
    const side = price <= book.mid ? bid.filter((q) => q.price >= price) : ask.filter((q) => q.price <= price)
    const cum = side[side.length - 1]?.cum ?? 0
    show(l.x, l.y, <><b>{fmt(price, 2)}</b><br />{price <= book.mid ? '이 가격까지 매수 잔량 누적' : '이 가격까지 매도 잔량 누적'} {fmt(cum, 0)}</>)
  }
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`호가 잔량 그래프: 스프레드 ${fmt(book.spread, 2)}`} onPointerMove={compact ? undefined : hover} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisBottom scale={x} y={ih} grid={ih} label="가격" compact={compact} />
          <AxisLeft scale={y} x={0} grid={iw} label="누적 잔량" compact={compact} />
          {bid.length > 0 && <path data-testid="depth-bid" d={stepArea(bid, true)} fill={c.up} fillOpacity={0.3} stroke={c.up} strokeWidth={1.6} />}
          {ask.length > 0 && <path data-testid="depth-ask" d={stepArea(ask, false)} fill={c.down} fillOpacity={0.3} stroke={c.down} strokeWidth={1.6} />}
          <line x1={x(book.mid)} x2={x(book.mid)} y1={0} y2={ih} stroke="#374151" strokeDasharray="4 3" data-testid="mid-line" />
          {impact && impact.filled > 0 && !compact && <g pointerEvents="none"><line x1={x(book.ask[0].price)} x2={x(book.ask.filter((l) => l.cum - l.size < impact.filled).pop()?.price ?? book.ask[0].price)} y1={y(impact.filled)} y2={y(impact.filled)} stroke="#e07a3f" strokeWidth={2} /><circle cx={x(impact.vwap)} cy={y(impact.filled)} r={4} fill="#e07a3f" /></g>}
        </g>
      </svg>
      {!compact && <><Readout items={[{ label: '최우선 매수/매도', value: `${fmt(book.bestBid, 2)} / ${fmt(book.bestAsk, 2)}` }, { label: '스프레드', value: fmt(book.spread, 2) }, { label: '중간가', value: fmt(book.mid, 3) }, { label: '매수 비중', value: pct(imbalance) }, ...(impact ? [{ label: `매수 ${params.impact} 체결`, value: impact.filled ? `평균 ${fmt(impact.vwap, 3)} (슬리피지 +${fmt(impact.slippage, 3)})${impact.complete ? '' : ' · 잔량 부족'}` : '–' }] : [])]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function DepthControls({ params, setParams }: ControlsProps<DepthParams>) {
  return (
    <ControlGroup title="호가 잔량">
      <Slider label="보여 줄 가격 범위" value={params.window} min={20} max={100} step={5} onChange={(window) => setParams({ window })} format={(v) => `${v}%`} testId="ctl-depth-window" />
      <Slider label="시장가 매수 수량 (체결 시뮬레이션)" value={params.impact} min={0} max={4000} step={50} onChange={(impact) => setParams({ impact })} format={(v) => (v ? String(v) : '없음')} testId="ctl-depth-impact" />
      <Hint>호가 잔량 그래프는 현재가에서 멀어지며 쌓이는 누적 주문량을 매수(왼쪽, 초록)와 매도(오른쪽, 빨강)로 그린 계단형 면입니다. 중간가에서 두 면 사이가 스프레드이고, 가파르게 솟는 곳은 큰 주문(벽)이 있는 가격입니다. 시장가 매수 수량을 올리면 매도 호가를 위에서부터 소진하며 체결되는 평균가와 슬리피지를 보여 줍니다. 호가는 언제든 취소될 수 있어 쌓인 잔량이 실제 지지·저항을 뜻하지는 않습니다. 예제는 합성 호가창입니다.</Hint>
    </ControlGroup>
  )
}

export const orderBookModule: VizModule<DepthParams> = {
  roles: [{ key: 'side', label: '방향 (매수/매도)', type: 'category', required: true, prefer: '방향|side' }, { key: 'price', label: '가격', type: 'number', required: true, prefer: '가격|price' }, { key: 'size', label: '수량', type: 'number', required: true, prefer: '수량|size|qty' }],
  datasets: ['order-book'],
  defaultParams: { window: 100, impact: 600, preset: 'global' },
  Chart: DepthChart,
  Controls: DepthControls,
  hint: '그래프 위를 움직이면 그 가격까지의 누적 잔량 · 시장가 매수 수량을 바꿔 평균 체결가와 슬리피지 확인 · 큰 계단은 큰 주문(벽)',
}

