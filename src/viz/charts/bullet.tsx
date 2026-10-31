import * as d3 from 'd3'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { AxisBottom, AxisLeft, BandAxis, ChartMessage, Legend, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ColorField, ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, updateRow } from '../../data/table'
import { colorAt } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { bulletBand, bulletRanges } from '../../stats/bars'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { dragDigits, roundTo } from './shared'

export interface BulletParams {
  orientation: 'horizontal' | 'vertical'
  scale: 'shared' | 'row'
  barRatio: number
  values: boolean
  barColor: string
  targetColor: string
}

const BAND_COLORS = ['#c9d0cd', '#dde2e0', '#eef1f0']
const DEFAULT_NAMES = ['나쁨', '보통', '좋음']

interface Item { name: string; row: number; actual: number; target: number | null; edges: number[]; max: number }

function BulletChart({ table, mapping, params, width, height, compact, onTableChange }: ChartProps<BulletParams>) {
  const catCol = roleColumn(mapping, 'category')
  const actualCol = roleColumn(mapping, 'actual')
  const targetCol = roleColumn(mapping, 'target')
  const rangeCols = roleColumns(mapping, 'ranges')
  const rangeKey = rangeCols.join('\u0000')
  const vertical = params.orientation === 'vertical'
  const items = useMemo<Item[]>(() => {
    const ci = columnIndex(table, catCol)
    const ai = columnIndex(table, actualCol)
    const ti = columnIndex(table, targetCol)
    const ri = rangeCols.map((c) => columnIndex(table, c))
    if (ci < 0 || ai < 0) return []
    const out: Item[] = []
    table.rows.forEach((r, row) => {
      const actual = toNumber(r[ai])
      const name = toLabel(r[ci])
      if (actual == null || !name) return
      const target = ti >= 0 ? toNumber(r[ti]) : null
      const reach = Math.max(actual, target ?? 0, ...ri.map((c) => toNumber(r[c]) ?? 0))
      const raw = ri.length ? ri.map((c) => toNumber(r[c])) : [0.5, 0.75, 1].map((f) => reach * 1.1 * f)
      const edges = bulletRanges(raw, reach * 1.1)
      out.push({ name, row, actual, target, edges, max: Math.max(edges[edges.length - 1] ?? 0, actual, target ?? 0) })
    })
    return out
  }, [table, catCol, actualCol, targetCol, rangeKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const names = rangeCols.length ? rangeCols : DEFAULT_NAMES.slice(0, 3)
  const m = margins(compact, compact ? {} : vertical ? { left: 56, bottom: 64 } : { left: 92, right: 36, bottom: params.scale === 'shared' ? 52 : 24 })
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ item: Item; what: 'actual' | 'target'; max: number } | null>(null)
  const [, setDragging] = useState(false)
  const { tip, show, hide } = useTooltip()

  if (!catCol || !actualCol) return <ChartMessage>항목과 실제값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!items.length) return <ChartMessage>그릴 항목이 없습니다.</ChartMessage>
  const gmax = Math.max(1e-9, ...items.map((i) => i.max))
  const length = vertical ? ih : iw
  const scaleFor = (it: Item) => d3.scaleLinear().domain([0, drag.current && drag.current.item.row === it.row ? drag.current.max : params.scale === 'shared' ? gmax : it.max]).range(vertical ? [length, 0] : [0, length])
  const band = d3.scaleBand().domain(items.map((i) => i.name)).range([0, vertical ? iw : ih]).padding(0.28)
  const bw = band.bandwidth()
  const shared = d3.scaleLinear().domain([0, gmax]).range(vertical ? [length, 0] : [0, length]).nice()
  const editable = !!onTableChange && !compact
  const dec = dragDigits(gmax)
  const sc = (it: Item) => (params.scale === 'shared' && !(drag.current && drag.current.item.row === it.row) ? shared : scaleFor(it))

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!editable) return
    const t = (e.target as Element).closest('[data-what]')
    if (!t) return
    const item = items.find((i) => i.row === Number(t.getAttribute('data-row')))
    if (!item) return
    const what = t.getAttribute('data-what') as 'actual' | 'target'
    if (what === 'target' && !targetCol) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { item, what, max: sc(item).domain()[1] }
    setDragging(true)
    hide()
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    const p = localPoint(svgRef.current!, e)
    const v = Math.max(0, roundTo(scaleFor(d.item).invert(vertical ? p.y - m.top : p.x - m.left), dec))
    onTableChange!(updateRow(table, d.item.row, { [d.what === 'actual' ? actualCol : targetCol!]: v }), true)
  }
  const onUp = () => {
    if (!drag.current) return
    drag.current = null
    setDragging(false)
    onTableChange!(table, false)
  }

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} role="img" data-testid="chart-svg" aria-label={`불릿 차트: ${catCol}별 실제값과 목표`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          {params.scale === 'shared' && (vertical
            ? <AxisLeft scale={shared} x={0} grid={0} compact={compact} />
            : <AxisBottom scale={shared} y={ih} compact={compact} />)}
          <BandAxis scale={band} orient={vertical ? 'bottom' : 'left'} offset={vertical ? ih : 0} compact={compact} maxChars={10} />
          {items.map((it) => {
            const s = sc(it)
            const a0 = band(it.name) ?? 0
            const cb = bw * params.barRatio
            const co = a0 + (bw - cb) / 2
            const tb = bw * 0.62
            const to = a0 + (bw - tb) / 2
            const rect = (lo: number, hi: number, off: number, thick: number) => vertical
              ? { x: off, y: Math.min(s(lo), s(hi)), width: thick, height: Math.abs(s(hi) - s(lo)) }
              : { x: Math.min(s(lo), s(hi)), y: off, width: Math.abs(s(hi) - s(lo)), height: thick }
            const bandIdx = bulletBand(it.actual, it.edges)
            let prev = 0
            return (
              <g key={it.row} className="marks" data-testid="bullet-row">
                {it.edges.map((e, k) => { const r = rect(prev, e, a0, bw); prev = e; return <rect key={k} {...r} fill={BAND_COLORS[Math.min(k, BAND_COLORS.length - 1)]} data-testid="bullet-range" /> })}
                <rect className={`bullet-bar ${editable ? 'is-draggable' : ''}`} data-what="actual" data-row={it.row} data-testid="bullet-bar" {...rect(0, it.actual, co, cb)} fill={params.barColor}
                  onPointerEnter={compact ? undefined : (e) => {
                    if (drag.current) return
                    const lp = localPoint(svgRef.current!, e)
                    show(lp.x, lp.y, <><b>{it.name}</b><br />실제 {fmt(it.actual)}{it.target != null && <><br />목표 {fmt(it.target)} (달성률 {pct(it.target ? it.actual / it.target : 0, 0)})</>}<br />구간: {bandIdx >= 0 ? names[Math.min(bandIdx, names.length - 1)] : '–'}{editable ? <><br />막대를 끌어 값 변경</> : null}</>)
                  }} onPointerLeave={hide} />
                {it.target != null && (vertical
                  ? <line className={`bullet-target ${editable ? 'is-draggable' : ''}`} data-what="target" data-row={it.row} data-testid="bullet-target" x1={to} x2={to + tb} y1={s(it.target)} y2={s(it.target)} stroke={params.targetColor} strokeWidth={compact ? 2 : 4} strokeLinecap="round" />
                  : <line className={`bullet-target ${editable ? 'is-draggable' : ''}`} data-what="target" data-row={it.row} data-testid="bullet-target" x1={s(it.target)} x2={s(it.target)} y1={to} y2={to + tb} stroke={params.targetColor} strokeWidth={compact ? 2 : 4} strokeLinecap="round" />)}
                {params.values && !compact && (vertical
                  ? <text className="bar-label" x={a0 + bw / 2} y={-6 + 0} textAnchor="middle" transform={`translate(0,${0})`}>{fmt(it.actual)}</text>
                  : <text className="bar-label" x={length + 6} y={a0 + bw / 2} dy="0.35em">{fmt(it.actual)}</text>)}
                {params.scale === 'row' && !compact && (vertical
                  ? <text className="bar-label" x={a0 + bw / 2} y={length + 14} textAnchor="middle" fill="#8a9692">0–{fmt(s.domain()[1])}</text>
                  : <text className="bar-label" x={0} y={a0 + bw + 11} fill="#8a9692">0 – {fmt(s.domain()[1])}</text>)}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          <Legend items={[{ key: '실제값', color: params.barColor }, ...(targetCol ? [{ key: '목표', color: params.targetColor }] : []), ...names.map((n, i) => ({ key: n, color: BAND_COLORS[Math.min(i, 2)] }))]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function BulletControls({ params, setParams }: ControlsProps<BulletParams>) {
  return (
    <>
      <ControlGroup title="배치">
        <Segmented label="방향" value={params.orientation} onChange={(orientation) => setParams({ orientation })} testId="ctl-orient" options={[{ value: 'horizontal', label: '가로' }, { value: 'vertical', label: '세로' }]} />
        <Segmented label="척도" value={params.scale} onChange={(scale) => setParams({ scale })} testId="ctl-scale" options={[{ value: 'shared', label: '공통' }, { value: 'row', label: '항목별' }]} />
        <Hint>{params.scale === 'shared' ? '모든 항목이 같은 눈금을 써서 항목 사이 크기를 비교할 수 있습니다.' : '항목마다 자기 구간 끝까지를 눈금으로 삼아, 단위가 다른 지표도 한 차트에 놓을 수 있습니다. 항목끼리 길이는 비교하지 마세요.'}</Hint>
      </ControlGroup>
      <ControlGroup title="모양">
        <Slider label="실제값 막대 굵기" value={params.barRatio} min={0.15} max={0.6} step={0.05} onChange={(barRatio) => setParams({ barRatio })} format={(v) => `${Math.round(v * 100)}%`} />
        <Toggle label="실제값 레이블" checked={params.values} onChange={(values) => setParams({ values })} />
        <ColorField label="실제값 색" value={params.barColor} onChange={(barColor) => setParams({ barColor })} />
        <ColorField label="목표 눈금 색" value={params.targetColor} onChange={(targetColor) => setParams({ targetColor })} />
      </ControlGroup>
      <ControlGroup title="구간과 목표" defaultOpen={false}>
        <Hint>나쁨·보통·좋음 구간 상한은 데이터 탭의 ‘열 매핑’에서 숫자형 열(최대 3개)로 지정합니다. 지정하지 않으면 각 항목의 50%·75%·100% 지점(최댓값의 110%)을 씁니다. 상한이 앞 구간보다 작으면 앞 구간 값으로 보정합니다. 막대와 목표 눈금을 끌어 값을 바꾸고, 항목은 데이터 탭에서 추가·삭제하세요.</Hint>
      </ControlGroup>
    </>
  )
}

export const bulletModule: VizModule<BulletParams> = {
  roles: [
    { key: 'category', label: '항목', type: 'category', required: true },
    { key: 'actual', label: '실제값', type: 'number', required: true },
    { key: 'target', label: '목표값 (선택)', type: 'number', auto: true },
    { key: 'ranges', label: '구간 상한 (나쁨→좋음, 선택)', type: 'number', multiple: { min: 0, max: 3 } },
  ],
  datasets: ['kpi', 'before-after'],
  defaultParams: { orientation: 'horizontal', scale: 'shared', barRatio: 0.32, values: true, barColor: '#121816', targetColor: colorAt(1) },
  Chart: BulletChart,
  Controls: BulletControls,
  hint: '검은 막대는 실제값, 굵은 눈금은 목표, 배경 띠는 나쁨~좋음 · 막대와 눈금을 끌어 수정',
}
