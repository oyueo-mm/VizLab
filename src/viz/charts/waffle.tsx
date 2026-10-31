import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { ChartMessage, Legend, Readout, Tooltip, localPoint, toggleIn, useTooltip } from '../../components/chart/primitives'
import { ColorField, ControlGroup, Hint, NumberField, Segmented, Select, Slider } from '../../components/controls'
import { columnIndex, updateRow } from '../../data/table'
import { colorAt } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { allocateCells, type Rounding } from '../../stats/waffle'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { crossTab } from './shared'

export interface WaffleParams {
  rows: number
  cols: number
  rounding: Rounding
  fill: 'row' | 'column'
  shape: 'square' | 'circle'
  gap: number
  hidden: string[]
  colors: Record<string, string>
}

/** Cell index → [column, row] (row 0 at the top); fills start bottom-left like a filling glass. */
export function cellPosition(index: number, rows: number, cols: number, fill: WaffleParams['fill']): [number, number] {
  if (fill === 'row') return [index % cols, rows - 1 - Math.floor(index / cols)]
  return [Math.floor(index / rows), rows - 1 - (index % rows)]
}

function useWaffle(table: ChartProps<WaffleParams>['table'], mapping: ChartProps<WaffleParams>['mapping'], params: WaffleParams) {
  const catCol = roleColumn(mapping, 'category')
  const valueCol = roleColumn(mapping, 'value')
  const tab = useMemo(() => crossTab(table, catCol, null, valueCol, (v) => d3.sum(v)), [table, catCol, valueCol])
  const cats = tab.cats.filter((c) => tab.value(c, '') > 0 && !params.hidden.includes(c))
  const total = params.rows * params.cols
  const alloc = allocateCells(cats.map((c) => tab.value(c, '')), total, params.rounding)
  const sum = d3.sum(cats, (c) => tab.value(c, ''))
  return { catCol, valueCol, tab, cats, total, alloc, sum }
}

function WaffleChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<WaffleParams>) {
  const { catCol, valueCol, tab, cats, total, alloc, sum } = useWaffle(table, mapping, params)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const colorOf = (c: string) => params.colors[c] ?? colorAt(Math.max(0, tab.cats.indexOf(c)))
  const legendH = compact ? 0 : 44
  const pad = compact ? 6 : 20
  const size = Math.max(4, Math.min((width - pad * 2) / params.cols, (height - legendH - pad * 2) / params.rows))
  const gridW = size * params.cols
  const gridH = size * params.rows
  const ox = (width - gridW) / 2
  const oy = legendH + Math.max(pad, (height - legendH - gridH) / 2)

  // cell → category index (cells beyond the allocated counts stay empty)
  const owner = useMemo(() => {
    const out: number[] = []
    alloc.counts.forEach((n, ci) => { for (let k = 0; k < n; k++) out.push(ci) })
    return out
  }, [alloc.counts])

  if (!catCol || !valueCol) return <ChartMessage>범주와 값 열을 선택하세요.</ChartMessage>
  if (!cats.length || !(sum > 0)) return <ChartMessage>양수 값이 있는 범주가 없습니다.</ChartMessage>
  const inset = Math.min(params.gap, size / 3) / 2

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg"
        aria-label={`와플 차트: ${catCol}별 ${valueCol} 비율, ${total}칸`} onPointerLeave={hide}>
        <g transform={`translate(${ox},${oy})`}>
          {Array.from({ length: total }, (_, i) => {
            const [cx, cy] = cellPosition(i, params.rows, params.cols, params.fill)
            const ci = owner[i]
            const filled = ci != null
            const c = filled ? colorOf(cats[ci]) : '#e5e9e8'
            const common = {
              className: 'waffle-cell', 'data-cat': filled ? cats[ci] : '', fill: c,
              onPointerEnter: compact || !filled ? undefined : (e: React.PointerEvent) => {
                const lp = localPoint(svgRef.current!, e)
                const v = tab.value(cats[ci], '')
                show(lp.x, lp.y, <><b>{cats[ci]}</b><br />{valueCol}: {fmt(v)} ({pct(v / sum)})<br />{alloc.counts[ci]}칸 / {total}칸 ({pct(alloc.counts[ci] / total)})</>)
              },
            }
            return params.shape === 'circle'
              ? <circle key={i} {...common} cx={cx * size + size / 2} cy={cy * size + size / 2} r={Math.max(1, size / 2 - inset)} />
              : <rect key={i} {...common} x={cx * size + inset} y={cy * size + inset} width={Math.max(1, size - inset * 2)} height={Math.max(1, size - inset * 2)} rx={Math.min(3, size / 6)} />
          })}
        </g>
      </svg>
      {!compact && (
        <>
          <Legend items={tab.cats.filter((c) => tab.value(c, '') > 0).map((c) => ({ key: c, color: colorOf(c) }))} hidden={params.hidden} title={catCol} onToggle={(k) => setParams({ hidden: toggleIn(params.hidden, k) })} />
          <Readout items={[{ label: '전체', value: `${total}칸` }, { label: '채운 칸', value: alloc.counts.reduce((s, c) => s + c, 0) }, ...(alloc.diff !== 0 ? [{ label: '반올림 오차', value: `${alloc.diff > 0 ? '+' : ''}${alloc.diff}칸` }] : [])]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function WaffleControls({ params, setParams, table, mapping, setTable }: ControlsProps<WaffleParams>) {
  const { valueCol, tab, cats, total, alloc, sum } = useWaffle(table, mapping, params)
  const valueIdx = columnIndex(table, valueCol)
  const colorOf = (c: string) => params.colors[c] ?? colorAt(Math.max(0, tab.cats.indexOf(c)))
  return (
    <>
      <ControlGroup title="격자">
        <Slider label="가로 칸" value={params.cols} min={2} max={25} onChange={(cols) => setParams({ cols })} testId="ctl-cols" />
        <Slider label="세로 칸" value={params.rows} min={2} max={25} onChange={(rows) => setParams({ rows })} testId="ctl-rows" />
        <Segmented label="기본 격자" value={`${params.rows}x${params.cols}`} onChange={(v) => { const [r, c] = v.split('x').map(Number); setParams({ rows: r, cols: c }) }} testId="ctl-preset"
          options={[{ value: '10x10', label: '10×10 (100칸)' }, { value: '5x20', label: '5×20' }, { value: '4x25', label: '4×25' }]} />
        <Segmented label="채우는 방향" value={params.fill} onChange={(fill) => setParams({ fill })} options={[{ value: 'row', label: '가로로' }, { value: 'column', label: '세로로' }]} />
        <Segmented label="칸 모양" value={params.shape} onChange={(shape) => setParams({ shape })} options={[{ value: 'square', label: '사각형' }, { value: 'circle', label: '원' }]} />
        <Slider label="칸 간격" value={params.gap} min={0} max={10} step={0.5} onChange={(gap) => setParams({ gap })} format={(v) => `${v}px`} />
      </ControlGroup>
      <ControlGroup title="반올림 처리">
        <Select label="칸 수 배정 방식" value={params.rounding} onChange={(rounding) => setParams({ rounding })} testId="ctl-rounding"
          options={[{ value: 'largest', label: '최대 잉여법 (합이 항상 일치)' }, { value: 'round', label: '단순 반올림 (합이 어긋날 수 있음)' }, { value: 'floor', label: '내림 (빈 칸이 남음)' }]} />
        <Hint>비율 × 전체 칸 수가 정수가 아닐 때 칸을 어떻게 나누는지 정합니다. 최대 잉여법은 먼저 내림한 뒤, 남은 칸을 소수 부분이 큰 범주에 한 칸씩 줍니다.</Hint>
        {cats.length > 0 && sum > 0 && (
          <div className="alloc-list" data-testid="alloc">
            {cats.map((c, i) => (
              <div key={c} className="alloc-row"><span>{c}</span><span>{fmt(alloc.quotas[i], 2)} → <b>{alloc.counts[i]}</b>칸</span></div>
            ))}
            <div className="alloc-row is-total"><span>합계</span><span>{alloc.counts.reduce((s, c) => s + c, 0)} / {total}칸</span></div>
          </div>
        )}
      </ControlGroup>
      <ControlGroup title="범주별 값·색">
        {tab.cats.map((c) => {
          const rows = tab.rows(c, '')
          return (
            <div key={c} className="cat-edit">
              <ColorField label={c} value={colorOf(c)} onChange={(col) => setParams({ colors: { ...params.colors, [c]: col } })} />
              {rows.length === 1 && setTable && valueIdx >= 0
                ? <NumberField label={`${c} 값`} value={tab.value(c, '')} min={0} step={1} testId={`val-${c}`} onChange={(v) => setTable(updateRow(table, rows[0], { [valueCol!]: v }))} />
                : <p className="control-hint">같은 범주의 행이 {rows.length}개라 합계({fmt(tab.value(c, ''))})를 사용합니다. 데이터 탭에서 편집하세요.</p>}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ hidden: toggleIn(params.hidden, c) })}>{params.hidden.includes(c) ? '다시 포함' : '제외'}</button>
            </div>
          )
        })}
        <Hint>값은 서로의 비율로만 쓰입니다. 제외한 범주는 나머지 범주끼리의 비율로 다시 계산됩니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const waffleModule: VizModule<WaffleParams> = {
  roles: [
    { key: 'category', label: '범주', type: 'category', required: true },
    { key: 'value', label: '값', type: 'number', required: true },
  ],
  datasets: ['votes', 'categorical'],
  defaultParams: { rows: 10, cols: 10, rounding: 'largest', fill: 'row', shape: 'square', gap: 3, hidden: [], colors: {} },
  Chart: WaffleChart,
  Controls: WaffleControls,
  hint: '칸에 마우스를 올려 범주 확인 · 오른쪽 패널에서 값·격자 크기·반올림 방식을 바꿔 칸 수가 어떻게 달라지는지 확인',
}
