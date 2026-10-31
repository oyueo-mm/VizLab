import * as d3 from 'd3'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Legend, Readout, Tooltip, localPoint, margins, toggleIn, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { useTween } from '../../hooks/motion'
import { categoryColor } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { stackRows, alignSeries, type StackOffsetName, type StackOrderName } from '../../stats/stack'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { curveOptions, seriesOf, type CurveName, curves } from './line'
import { pointRows } from './shared'

export interface LayerParams {
  curve: CurveName
  offset: StackOffsetName
  order: StackOrderName | 'custom'
  /** stacked area only: show stacked, overlapping or plain lines for comparison */
  view: 'stack' | 'overlap' | 'lines'
  opacity: number
  labels: boolean
  hidden: string[]
  /** User-chosen series order (names); series not listed follow in data order. */
  seriesOrder: string[]
}

type Kind = 'stacked' | 'stream'

export function orderSeries<T extends { key: string }>(series: T[], seriesOrder: readonly string[]) {
  const rank = (k: string) => { const i = seriesOrder.indexOf(k); return i < 0 ? seriesOrder.length : i }
  return [...series].sort((a, b) => rank(a.key) - rank(b.key))
}

function useLayers(props: Pick<ChartProps<LayerParams>, 'table' | 'mapping' | 'params'>) {
  const { table, mapping, params } = props
  const xCol = roleColumn(mapping, 'x')
  const yCol = roleColumn(mapping, 'y')
  const sCol = roleColumn(mapping, 'series')
  const pts = useMemo(() => pointRows(table, xCol, yCol, sCol), [table, xCol, yCol, sCol])
  const all = useMemo(() => orderSeries(seriesOf(pts), params.seriesOrder), [pts, params.seriesOrder])
  const series = useMemo(() => all.filter((s) => !params.hidden.includes(s.key)), [all, params.hidden])
  const aligned = useMemo(() => alignSeries(series), [series])
  // `custom` stacks in the order of the user's list; the other orders are d3 heuristics.
  const stackOrder: StackOrderName = params.order === 'custom' ? 'none' : params.order
  const layers = useMemo(() => stackRows(series.map((s) => s.key), aligned.rows, params.offset, stackOrder), [series, aligned, params.offset, stackOrder])
  return { xCol, yCol, sCol, pts, all, series, xs: aligned.xs, rows: aligned.rows, layers }
}

function LayerChart({ kind, ...props }: ChartProps<LayerParams> & { kind: Kind }) {
  const { params, setParams, width, height, compact } = props
  const { xCol, yCol, sCol, pts, all, series, xs, rows, layers } = useLayers(props)
  const color = useMemo(() => categoryColor(all.map((s) => s.key)), [all])
  const m = margins(compact)
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverX, setHoverX] = useState<number | null>(null)
  const { tip, show, hide } = useTooltip()
  const view = kind === 'stream' ? 'stack' : params.view
  const stream = kind === 'stream'

  const yDomain: [number, number] = view === 'stack'
    ? [d3.min(layers, (l) => d3.min(l, (d) => d[0])) ?? 0, d3.max(layers, (l) => d3.max(l, (d) => d[1])) ?? 1]
    : [0, d3.max(rows, (r) => d3.max(Object.values(r))) ?? 1]
  const x = d3.scaleLinear().domain(d3.extent(pts, (p) => p.x) as [number, number]).range([0, iw])
  const y = d3.scaleLinear().domain(yDomain).range([ih, 0])
  if (params.offset !== 'expand' || view !== 'stack') y.nice()

  const target = useMemo(() => {
    if (view === 'stack') return layers.map((l) => l.map((d) => [y(d[0]), y(d[1])]))
    return series.map((s) => rows.map((r) => [y(0), y(r[s.key])]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, rows, series, view, ih, y.domain()[0], y.domain()[1]])
  const shown = useTween(target, { snapKey: `${iw}x${ih}${series.length}${view}`, enabled: !compact })

  if (!xCol || !yCol) return <ChartMessage>X축과 Y축 숫자형 열을 선택하세요.</ChartMessage>
  if (!pts.length) return <ChartMessage>그릴 수 있는 점이 없습니다.</ChartMessage>
  if (pts.some((p) => p.y < 0)) return <ChartMessage>누적하려면 값이 0 이상이어야 합니다. 음수 값을 수정하세요.</ChartMessage>
  if (!series.length) return <ChartMessage>표시할 계열이 없습니다. 범례에서 계열을 다시 켜세요.</ChartMessage>
  const keys = view === 'stack' ? layers.map((l) => l.key) : series.map((s) => s.key)
  const expand = params.offset === 'expand' && view === 'stack'

  const onMove = (e: React.PointerEvent) => {
    if (compact) return
    const lp = localPoint(svgRef.current!, e)
    const i = d3.bisectCenter(xs, x.invert(lp.x - m.left))
    const xv = xs[i]
    if (xv == null) return
    setHoverX(xv)
    const row = rows[i]
    const total = d3.sum(Object.values(row))
    show(x(xv) + m.left, lp.y, <><b>{xCol} = {fmt(xv)}</b>{[...keys].reverse().map((k) => (
      <span key={k}><br /><i className="tip-swatch" style={{ background: color(k) }} />{k || yCol}: {fmt(row[k])}{series.length > 1 && total > 0 ? ` (${pct(row[k] / total)})` : ''}</span>
    ))}{series.length > 1 && <><br />합계: {fmt(total)}</>}</>)
  }

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg"
        aria-label={`${stream ? '스트림그래프' : '누적 영역 그래프'}: ${xCol}에 따른 ${yCol}`} onPointerMove={onMove} onPointerLeave={() => { hide(); setHoverX(null) }}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisBottom scale={x} y={ih} label={xCol} compact={compact} />
          {stream && params.offset !== 'none'
            ? <AxisLeft scale={y} x={0} grid={0} label={`${yCol} (두께로 읽음)`} compact={compact} format={() => ''} />
            : <AxisLeft scale={y} x={0} grid={iw} label={expand ? '비율' : yCol} compact={compact} format={expand ? (v) => pct(v, 0) : undefined} />}
          {keys.map((key, li) => {
            // the tweened state can lag one render behind a change in the number of time points
            const tweened = shown[li]
            const geo = tweened && tweened.length === xs.length ? tweened : target[li]
            if (!geo) return null
            const top = d3.line<number[]>().curve(curves[params.curve]).x((_, i) => x(xs[i])).y((d) => d[1])
            if (view === 'lines') return <path key={key} className="series-line" d={top(geo) ?? ''} stroke={color(key)} fill="none" data-testid="layer-line" />
            const area = d3.area<number[]>().curve(curves[params.curve]).x((_, i) => x(xs[i])).y0((d) => d[0]).y1((d) => d[1])
            // label at the x where the layer is thickest
            const thick = layers.find((l) => l.key === key)
            const wi = view === 'stack' && thick ? d3.maxIndex(thick, (d) => d[1] - d[0]) : -1
            const lw = thick && wi >= 0 ? y(thick[wi][0]) - y(thick[wi][1]) : 0
            return (
              <g key={key} className="marks">
                <path d={area(geo) ?? ''} fill={color(key)} fillOpacity={view === 'overlap' ? params.opacity * 0.55 : params.opacity} stroke="#fff" strokeWidth={stream ? 0.6 : 0} data-testid="layer-area" />
                {view === 'overlap' && <path className="area-top" d={top(geo) ?? ''} stroke={color(key)} />}
                {params.labels && !compact && view === 'stack' && lw > 14 && thick && (
                  <text className="layer-label" x={x(xs[wi])} y={(y(thick[wi][0]) + y(thick[wi][1])) / 2} dy="0.35em" textAnchor={wi < xs.length * 0.12 ? 'start' : wi > xs.length * 0.88 ? 'end' : 'middle'}>{key}</text>
                )}
              </g>
            )
          })}
          {hoverX != null && <line className="crosshair" x1={x(hoverX)} x2={x(hoverX)} y1={0} y2={ih} />}
        </g>
      </svg>
      {!compact && (
        <>
          {sCol && <Legend items={all.map((s) => ({ key: s.key, color: color(s.key) }))} hidden={params.hidden} title={sCol} onToggle={(k) => setParams({ hidden: toggleIn(params.hidden, k) })} />}
          <Readout items={[{ label: '계열', value: `${series.length} / ${all.length}` }, { label: '시점', value: xs.length }]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function SeriesOrder({ params, setParams, table, mapping }: ControlsProps<LayerParams>) {
  const pts = pointRows(table, roleColumn(mapping, 'x'), roleColumn(mapping, 'y'), roleColumn(mapping, 'series'))
  const names = orderSeries(seriesOf(pts), params.seriesOrder).map((s) => s.key).filter(Boolean)
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= names.length) return
    const next = [...names]
    ;[next[i], next[j]] = [next[j], next[i]]
    setParams({ seriesOrder: next, order: 'custom' })
  }
  if (names.length < 2) return null
  return (
    <fieldset className="field multi-role" data-testid="series-order">
      <legend>계열 순서 <small>위가 아래층</small></legend>
      <ul>
        {names.map((n, i) => (
          <li key={n}><label>{n}</label>
            <button type="button" className="icon-btn-xs" aria-label={`${n} 위로`} onClick={() => move(i, -1)}><ArrowUp size={13} /></button>
            <button type="button" className="icon-btn-xs" aria-label={`${n} 아래로`} onClick={() => move(i, 1)}><ArrowDown size={13} /></button>
          </li>
        ))}
      </ul>
    </fieldset>
  )
}

function LayerControls({ kind, ...p }: ControlsProps<LayerParams> & { kind: Kind }) {
  const { params, setParams } = p
  const stream = kind === 'stream'
  return (
    <>
      <ControlGroup title={stream ? '기준선 계산' : '표현 방식'}>
        {stream ? (
          <>
            <Select label="기준선 방식" value={params.offset} onChange={(offset) => setParams({ offset })} testId="ctl-offset"
              options={[{ value: 'wiggle', label: 'Wiggle (흔들림 최소화, Byron–Wattenberg)' }, { value: 'silhouette', label: 'Silhouette (가운데 정렬)' }, { value: 'none', label: '0 기준 (일반 누적)' }, { value: 'expand', label: '100% (비율)' }]} />
            <Hint>
              {params.offset === 'wiggle' && '층 두께로 가중한 기울기 제곱합을 최소화하도록 시점마다 기준선을 옮겨, 위아래 출렁임을 줄입니다.'}
              {params.offset === 'silhouette' && '각 시점의 전체 두께를 가로축 가운데에 맞춥니다. 대칭이지만 층의 기울기는 더 크게 변할 수 있습니다.'}
              {params.offset === 'none' && '기준선을 옮기지 않은 일반 누적 영역입니다. 스트림그래프와 비교해 보세요.'}
              {params.offset === 'expand' && '시점마다 합계를 1로 맞춥니다.'}
            </Hint>
          </>
        ) : (
          <Segmented label="표현" value={params.view} onChange={(view) => setParams({ view })} testId="ctl-view"
            options={[{ value: 'stack', label: '누적' }, { value: 'overlap', label: '겹치기' }, { value: 'lines', label: '선' }]} />
        )}
        {!stream && (
          <Segmented label="축 단위" value={params.offset === 'expand' ? 'expand' : 'none'} onChange={(offset) => setParams({ offset })} testId="ctl-unit"
            options={[{ value: 'none', label: '실제 값' }, { value: 'expand', label: '100%' }]} />
        )}
        <Select label="보간 방식" value={params.curve} onChange={(curve) => setParams({ curve })} options={curveOptions.filter((c) => c.value !== 'natural')} testId="ctl-curve" />
        <Slider label="채움 불투명도" value={params.opacity} min={0.2} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} />
        <Toggle label="층 이름 표시" checked={params.labels} onChange={(labels) => setParams({ labels })} testId="ctl-labels" />
      </ControlGroup>
      <ControlGroup title="층 쌓는 순서">
        <Select label="순서 규칙" value={params.order} onChange={(order) => setParams({ order })} testId="ctl-order"
          options={[{ value: 'custom', label: '아래 목록 순서' }, { value: 'none', label: '데이터 순서' }, { value: 'insideOut', label: '안쪽에서 바깥으로 (큰 층이 가운데)' }, { value: 'ascending', label: '작은 층 아래' }, { value: 'descending', label: '큰 층 아래' }, { value: 'reverse', label: '데이터 역순' }]} />
        <SeriesOrder {...p} />
        <Hint>범례를 눌러 계열을 빼면 나머지로 다시 계산됩니다. 계열 추가·삭제와 값 편집은 데이터 탭에서 합니다.</Hint>
      </ControlGroup>
    </>
  )
}

const roles = [
  { key: 'x', label: 'X축 (시간·순서)', type: 'number' as const, required: true },
  { key: 'y', label: 'Y축 (값)', type: 'number' as const, required: true },
  { key: 'series', label: '계열', type: 'category' as const, required: true },
]

const base: LayerParams = { curve: 'monotone', offset: 'none', order: 'custom', view: 'stack', opacity: 0.85, labels: false, hidden: [], seriesOrder: [] }

export const stackedAreaModule: VizModule<LayerParams> = {
  roles,
  datasets: ['timeseries', 'streams'],
  defaultParams: base,
  Chart: (p) => <LayerChart {...p} kind="stacked" />,
  Controls: (p) => <LayerControls {...p} kind="stacked" />,
  hint: '마우스를 올려 시점별 값과 비율 확인 · ‘선’과 ‘겹치기’로 누적 표현과 비교',
}

export const streamgraphModule: VizModule<LayerParams> = {
  roles,
  datasets: ['streams', 'timeseries'],
  defaultParams: { ...base, offset: 'wiggle', order: 'insideOut', labels: true, curve: 'basis', opacity: 0.9 },
  Chart: (p) => <LayerChart {...p} kind="stream" />,
  Controls: (p) => <LayerControls {...p} kind="stream" />,
  hint: '층의 두께가 값입니다 · 기준선 방식과 쌓는 순서를 바꿔 물줄기 모양이 어떻게 달라지는지 확인',
}
