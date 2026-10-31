import * as d3 from 'd3'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Legend, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ColorField, ControlGroup, Hint, Select, Slider, Toggle } from '../../components/controls'
import { columnIndex, toNumber, toTime, updateRow, type DataTable } from '../../data/table'
import { fmt, pct } from '../../lib/format'
import { formatTime, type DatePeriod } from '../../stats/datetime'
import { aggregateCandles, ohlcIssue, type Candle } from '../../stats/ohlc'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'
import { dragDigits, roundTo } from './shared'

export interface CandleParams {
  period: Extract<DatePeriod, 'day' | 'week' | 'month'>
  upColor: string
  downColor: string
  volume: boolean
  /** Visible window as percentages of the candles (from, to). */
  from: number
  to: number
  hollowUp: boolean
}

const PRESETS = {
  kr: { up: '#d4403a', down: '#2f6fd0', label: '한국식 (상승 빨강, 하락 파랑)' },
  global: { up: '#2a8c82', down: '#cf4f6a', label: '글로벌 (상승 초록, 하락 빨강)' },
} as const

interface Prepared { candles: Candle[]; issues: { row: number; text: string }[]; hasVolume: boolean }

/** Candles from the mapped columns; rows with an impossible open/high/low/close are reported, not drawn. */
export function prepareCandles(table: DataTable, mapping: Mapping): Prepared {
  const idx = (k: string) => columnIndex(table, roleColumn(mapping, k))
  const [ti, oi, hi, li, ci, vi] = ['date', 'open', 'high', 'low', 'close', 'volume'].map(idx)
  const issues: { row: number; text: string }[] = []
  const candles: Candle[] = []
  if ([ti, oi, hi, li, ci].some((i) => i < 0)) return { candles, issues, hasVolume: false }
  table.rows.forEach((r, row) => {
    const t = toTime(r[ti])
    const [o, h, l, c] = [oi, hi, li, ci].map((i) => toNumber(r[i]))
    if (t == null) { issues.push({ row, text: '날짜를 읽을 수 없습니다.' }); return }
    if (o == null || h == null || l == null || c == null) { issues.push({ row, text: '시가·고가·저가·종가에 빈 값이나 숫자가 아닌 값이 있습니다.' }); return }
    const problem = ohlcIssue(o, h, l, c)
    if (problem) { issues.push({ row, text: problem }); return }
    candles.push({ t, o, h, l, c, v: vi >= 0 ? toNumber(r[vi]) : null, row })
  })
  candles.sort((a, b) => a.t - b.t)
  return { candles, issues, hasVolume: vi >= 0 && candles.some((c) => c.v != null) }
}

function CandleChart({ table, mapping, params, width, height, compact, onTableChange }: ChartProps<CandleParams>) {
  const prepared = useMemo(() => prepareCandles(table, mapping), [table, mapping])
  const rolled = useMemo(() => aggregateCandles(prepared.candles, params.period), [prepared.candles, params.period])
  const lo = Math.floor((params.from / 100) * rolled.length)
  const hi = Math.max(lo + 1, Math.ceil((params.to / 100) * rolled.length))
  const shown = rolled.slice(lo, hi)
  const showVol = params.volume && prepared.hasVolume && !compact
  const narrow = width < 520
  const m = margins(compact, compact ? {} : { right: 24, top: narrow ? 78 : 40 })
  const volH = showVol ? Math.max(40, (height - m.top - m.bottom) * 0.22) : 0
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom - (showVol ? volH + 10 : 0))
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ row: number; domain: [number, number] } | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const { tip, show, hide } = useTooltip()

  if (!roleColumn(mapping, 'date') || !['open', 'high', 'low', 'close'].every((k) => roleColumn(mapping, k))) return <ChartMessage>날짜와 시가·고가·저가·종가 열을 모두 선택하세요.</ChartMessage>
  if (!shown.length) {
    return (
      <ChartMessage>
        <p>{prepared.issues.length ? '유효한 OHLC 행이 없습니다.' : '그릴 캔들이 없습니다.'}</p>
        {prepared.issues.slice(0, 3).map((i) => <small key={i.row}>{i.row + 1}행: {i.text}</small>)}
      </ChartMessage>
    )
  }
  const t0 = shown[0].t
  const t1 = shown[shown.length - 1].t
  const step = shown.length > 1 ? Math.min(...shown.slice(1).map((c, i) => c.t - shown[i].t)) : 86400000
  const pad = step / 2
  const x = d3.scaleLinear().domain([t0 - pad, t1 + pad]).range([0, iw])
  const yDom = drag.current?.domain ?? ((): [number, number] => {
    const a = d3.min(shown, (c) => c.l)!
    const b = d3.max(shown, (c) => c.h)!
    const sp = (b - a) || Math.abs(b) * 0.1 || 1
    return [a - sp * 0.06, b + sp * 0.06]
  })()
  const y = d3.scaleLinear().domain(yDom).range([ih, 0])
  if (!drag.current) y.nice()
  const bw = Math.max(1.5, Math.min(26, (iw / shown.length) * 0.68))
  const vmax = d3.max(shown, (c) => c.v ?? 0) || 1
  const vy = d3.scaleLinear().domain([0, vmax]).range([volH, 0])
  const editable = !!onTableChange && !compact && params.period === 'day'
  const dec = dragDigits(y.domain()[1] - y.domain()[0])
  const up = (c: Candle) => c.c >= c.o
  const colorOf = (c: Candle) => (up(c) ? params.upColor : params.downColor)

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!editable) return
    const t = (e.target as Element).closest('[data-row]')
    if (!t) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { row: Number(t.getAttribute('data-row')), domain: y.domain() as [number, number] }
    hide()
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const p = localPoint(svgRef.current!, e)
    if (drag.current) {
      // Dragging a candle moves its close; high and low stretch to keep the candle valid.
      const row = drag.current.row
      const r = table.rows[row]
      const c = roundTo(y.invert(p.y - m.top), dec)
      const [oi, hi2, li2] = ['open', 'high', 'low'].map((k) => columnIndex(table, roleColumn(mapping, k)))
      const o = toNumber(r[oi]) ?? c
      const hh = Math.max(toNumber(r[hi2]) ?? c, c, o)
      const ll = Math.min(toNumber(r[li2]) ?? c, c, o)
      onTableChange!(updateRow(table, row, { [roleColumn(mapping, 'close')!]: c, [roleColumn(mapping, 'high')!]: hh, [roleColumn(mapping, 'low')!]: ll }), true)
      return
    }
    if (compact) return
    const i = d3.bisectCenter(shown.map((c) => c.t), x.invert(p.x - m.left))
    const c = shown[i]
    if (!c || p.x - m.left < 0 || p.x - m.left > iw) { setHover(null); hide(); return }
    setHover(i)
    const prev = rolled[lo + i - 1]
    show(x(c.t) + m.left, p.y, <>
      <b>{formatTime(c.t)}{params.period !== 'day' ? ` 이후 ${params.period === 'week' ? '한 주' : '한 달'}` : ''}</b>
      <br />시가 {fmt(c.o)} · 고가 {fmt(c.h)}<br />저가 {fmt(c.l)} · 종가 {fmt(c.c)}
      <br />{up(c) ? '상승' : '하락'} {pct(c.o ? (c.c - c.o) / c.o : 0)}{prev ? ` · 전 캔들 종가 대비 ${pct(prev.c ? (c.c - prev.c) / prev.c : 0)}` : ''}
      {c.v != null && <><br />거래량 {fmt(c.v)}</>}{editable ? <><br />몸통을 끌어 종가 변경</> : null}
    </>)
  }
  const onUp = () => {
    if (!drag.current) return
    drag.current = null
    onTableChange!(table, false)
  }

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} role="img" data-testid="chart-svg" aria-label={`캔들스틱 차트: ${shown.length}개 캔들`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => { hide(); setHover(null) }}>
        <defs><clipPath id="candle-clip"><rect x={-4} y={-4} width={iw + 8} height={ih + 8} /></clipPath></defs>
        <g transform={`translate(${m.left},${m.top})`}>
          <rect width={iw} height={ih} fill="transparent" />
          <AxisLeft scale={y} x={0} grid={iw} label="가격" compact={compact} />
          <AxisBottom scale={x} y={ih + (showVol ? volH + 10 : 0)} label={compact ? undefined : '날짜'} compact={compact} date />
          {hover != null && shown[hover] && <line className="crosshair" x1={x(shown[hover].t)} x2={x(shown[hover].t)} y1={0} y2={ih + (showVol ? volH + 10 : 0)} />}
          <g clipPath="url(#candle-clip)">
            {shown.map((c) => {
              const cx = x(c.t)
              const top = y(Math.max(c.o, c.c))
              const bot = y(Math.min(c.o, c.c))
              const col = colorOf(c)
              return (
                <g key={c.row} className="candle" data-testid="candle" data-up={up(c) ? '1' : '0'}>
                  <line x1={cx} x2={cx} y1={y(c.h)} y2={y(c.l)} stroke={col} strokeWidth={compact ? 1 : 1.4} />
                  <rect className={editable ? 'is-draggable' : ''} data-row={c.row} x={cx - bw / 2} y={top} width={bw} height={Math.max(1.4, bot - top)} fill={up(c) && params.hollowUp ? '#fff' : col} stroke={col} strokeWidth={1.2} />
                </g>
              )
            })}
          </g>
          {showVol && (
            <g transform={`translate(0,${ih + 10})`} aria-label="거래량">
              {shown.map((c) => c.v != null && <rect key={c.row} x={x(c.t) - bw / 2} y={vy(c.v)} width={bw} height={volH - vy(c.v)} fill={colorOf(c)} fillOpacity={0.55} data-testid="volume-bar" />)}
              <line x1={0} x2={iw} y1={volH} y2={volH} stroke="#cfd6d3" />
              <text className="axis-label" x={-8} y={10} textAnchor="end">거래량</text>
            </g>
          )}
        </g>
      </svg>
      {!compact && (
        <>
          <Legend items={[{ key: '상승 (종가 ≥ 시가)', color: params.upColor }, { key: '하락', color: params.downColor }]} />
          <Readout items={[{ label: '캔들', value: `${shown.length}` }, { label: '기간', value: `${formatTime(t0)} – ${formatTime(t1)}` }]} />
          {prepared.issues.length > 0 && (
            <p className="chart-warning" role="status" data-testid="ohlc-warning">
              유효하지 않은 OHLC {prepared.issues.length}행을 제외했습니다 — {prepared.issues[0].row + 1}행: {prepared.issues[0].text}
            </p>
          )}
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function CandleControls({ params, setParams, table, mapping }: ControlsProps<CandleParams>) {
  const prepared = useMemo(() => prepareCandles(table, mapping), [table, mapping])
  const rolled = useMemo(() => aggregateCandles(prepared.candles, params.period), [prepared.candles, params.period])
  const lo = Math.floor((params.from / 100) * rolled.length)
  const hi = Math.max(lo + 1, Math.ceil((params.to / 100) * rolled.length))
  return (
    <>
      <ControlGroup title="기간">
        <Select label="캔들 단위" value={params.period} onChange={(period) => setParams({ period })} testId="ctl-period"
          options={[{ value: 'day', label: '일' }, { value: 'week', label: '주 (월요일 시작)' }, { value: 'month', label: '월' }]} />
        <Hint>주·월 캔들은 일별 캔들을 모아 시가는 첫날, 종가는 마지막 날, 고가·저가는 최고·최저, 거래량은 합계로 만듭니다.</Hint>
        <Slider label="시작 위치" value={params.from} min={0} max={95} step={1} onChange={(from) => setParams({ from, to: Math.max(params.to, from + 5) })} format={(v) => `${v}%`} testId="ctl-from" />
        <Slider label="끝 위치" value={params.to} min={5} max={100} step={1} onChange={(to) => setParams({ to, from: Math.min(params.from, to - 5) })} format={(v) => `${v}%`} testId="ctl-to" />
        {rolled[lo] && rolled[hi - 1] && <Hint>{formatTime(rolled[lo].t)} – {formatTime(rolled[hi - 1].t)}</Hint>}
      </ControlGroup>
      <ControlGroup title="색상과 거래량">
        <div className="data-actions">
          {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((k) => (
            <button key={k} type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ upColor: PRESETS[k].up, downColor: PRESETS[k].down })} data-testid={`preset-${k}`}>{PRESETS[k].label}</button>
          ))}
        </div>
        <ColorField label="상승 색" value={params.upColor} onChange={(upColor) => setParams({ upColor })} testId="ctl-up" />
        <ColorField label="하락 색" value={params.downColor} onChange={(downColor) => setParams({ downColor })} testId="ctl-down" />
        <Toggle label="상승 캔들 속 비우기" checked={params.hollowUp} onChange={(hollowUp) => setParams({ hollowUp })} />
        <Toggle label="거래량 표시" description={prepared.hasVolume ? undefined : '거래량 열을 매핑하면 사용할 수 있습니다'} checked={params.volume} onChange={(volume) => setParams({ volume })} testId="ctl-volume" />
      </ControlGroup>
      {prepared.issues.length > 0 && (
        <ControlGroup title={`오류 ${prepared.issues.length}행`}>
          <ul className="issue-list">{prepared.issues.slice(0, 8).map((i) => <li key={i.row}><b>{i.row + 1}행</b> {i.text}</li>)}</ul>
          <Hint>고가는 시가·종가·저가 이상이어야 하고, 저가는 시가·종가 이하여야 합니다. 데이터 탭에서 고치면 다시 그려집니다.</Hint>
        </ControlGroup>
      )}
    </>
  )
}

export const candlestickModule: VizModule<CandleParams> = {
  roles: [
    { key: 'date', label: '날짜', type: 'date', accept: ['date', 'number'], required: true },
    { key: 'open', label: '시가', type: 'number', required: true },
    { key: 'high', label: '고가', type: 'number', required: true },
    { key: 'low', label: '저가', type: 'number', required: true },
    { key: 'close', label: '종가', type: 'number', required: true },
    { key: 'volume', label: '거래량 (선택)', type: 'number', auto: true },
  ],
  datasets: ['ohlc'],
  defaultParams: { period: 'day', upColor: PRESETS.kr.up, downColor: PRESETS.kr.down, volume: true, from: 0, to: 100, hollowUp: false },
  Chart: CandleChart,
  Controls: CandleControls,
  hint: '캔들 몸통을 끌어 종가 수정(일 단위) · 마우스를 올려 OHLC 확인 · 캔들 단위로 일·주·월 전환',
}
