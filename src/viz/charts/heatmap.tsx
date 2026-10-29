import * as d3 from 'd3'
import { useMemo, useRef, useState } from 'react'
import { ChartMessage, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, NumberField, Segmented, Select, Toggle } from '../../components/controls'
import { schemes, textOn, type ColorScheme } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { columnIndex, setCell, toLabel, toNumber, type DataTable } from '../../data/table'
import { mean, standardDeviation } from '../../stats/descriptive'
import { correlationMatrix } from '../../stats/layout'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'

export interface HeatmapParams {
  mode: 'values' | 'corr'
  scheme: ColorScheme
  normalize: 'none' | 'row' | 'col'
  range: 'auto' | 'manual'
  min: number
  max: number
  showValues: boolean
  sortRows: 'none' | 'sum'
}

interface Matrix { rows: string[]; cols: string[]; values: (number | null)[][]; source: (number | null)[][]; rowIndex: number[] }

/** Builds the displayed matrix: raw cells, z-scored by row/column, or a correlation matrix. */
export function buildMatrix(table: DataTable, labelCol: string | null, cols: string[], p: Pick<HeatmapParams, 'mode' | 'normalize' | 'sortRows'>): Matrix {
  if (p.mode === 'corr') {
    const data = cols.map((c) => table.rows.map((r) => toNumber(r[columnIndex(table, c)])))
    const values = correlationMatrix(data).map((row) => row.map((v) => (Number.isFinite(v) ? v : null)))
    return { rows: cols, cols, values, source: values, rowIndex: [] }
  }
  const li = columnIndex(table, labelCol)
  const ci = cols.map((c) => columnIndex(table, c))
  let rowIndex = table.rows.map((_, i) => i)
  const raw = (i: number) => ci.map((k) => toNumber(table.rows[i][k]))
  if (p.sortRows === 'sum') rowIndex = [...rowIndex].sort((a, b) => d3.sum(raw(b), (v) => v ?? 0) - d3.sum(raw(a), (v) => v ?? 0))
  const source = rowIndex.map(raw)
  let values = source.map((r) => [...r])
  const z = (arr: (number | null)[]) => {
    const f = arr.filter((v): v is number => v != null)
    const m = mean(f)
    const s = standardDeviation(f)
    return arr.map((v) => (v == null ? null : s > 0 ? (v - m) / s : 0))
  }
  if (p.normalize === 'row') values = values.map(z)
  if (p.normalize === 'col') {
    const colsZ = cols.map((_, j) => z(values.map((r) => r[j])))
    values = values.map((r, i) => r.map((_, j) => colsZ[j][i]))
  }
  return { rows: rowIndex.map((i) => (li >= 0 ? toLabel(table.rows[i][li]) : `행 ${i + 1}`)), cols, values, source, rowIndex }
}

function HeatmapChart({ table, mapping, params, width, height, compact, onTableChange }: ChartProps<HeatmapParams>) {
  const labelCol = roleColumn(mapping, 'label')
  const cols = roleColumns(mapping, 'columns')
  const mat = useMemo(() => buildMatrix(table, labelCol, cols, params), [table, labelCol, cols, params])
  const svgRef = useRef<SVGSVGElement>(null)
  const [edit, setEdit] = useState<{ r: number; c: number; text: string } | null>(null)
  const { tip, show, hide } = useTooltip()
  const m = margins(compact, compact ? {} : { left: 70, bottom: 56, top: 10, right: 16 })
  const iw = Math.max(10, width - m.left - m.right)
  const ih = Math.max(10, height - m.top - m.bottom - (compact ? 0 : 28))
  const flat = mat.values.flat().filter((v): v is number => v != null)
  const diverging = schemes[params.scheme].diverging
  const corr = params.mode === 'corr'
  let domain: [number, number]
  if (params.range === 'manual') domain = [params.min, params.max > params.min ? params.max : params.min + 1]
  else if (corr) domain = [-1, 1]
  else if (params.normalize !== 'none' || diverging) { const a = d3.max(flat, Math.abs) ?? 1; domain = [-a, a] }
  else domain = (d3.extent(flat) as [number, number])[0] === undefined ? [0, 1] : (d3.extent(flat) as [number, number])
  if (domain[0] === domain[1]) domain = [domain[0] - 1, domain[1] + 1]
  const color = (v: number) => schemes[params.scheme].interpolate(Math.max(0, Math.min(1, (v - domain[0]) / (domain[1] - domain[0]))))
  const x = d3.scaleBand().domain(mat.cols).range([0, iw]).padding(0.04)
  const y = d3.scaleBand().domain(mat.rows.map((r, i) => `${i}\u0001${r}`)).range([0, ih]).padding(0.04)

  if (!cols.length) return <ChartMessage>행렬의 열로 쓸 숫자형 열을 하나 이상 선택하세요.</ChartMessage>
  if (!mat.rows.length) return <ChartMessage>행이 없습니다.</ChartMessage>
  if (corr && cols.length < 2) return <ChartMessage>상관 행렬에는 숫자형 열이 2개 이상 필요합니다.</ChartMessage>
  const editable = !!onTableChange && !compact && !corr
  const commit = () => {
    if (!edit) return
    const v = edit.text.trim() === '' ? null : Number(edit.text)
    if (v === null || Number.isFinite(v)) onTableChange!(setCell(table, mat.rowIndex[edit.r], mat.cols[edit.c], v))
    setEdit(null)
  }
  const fontSize = Math.max(9, Math.min(13, x.bandwidth() / 4.5, y.bandwidth() / 2))

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} role="img" data-testid="chart-svg"
        aria-label={`히트맵: ${mat.rows.length}행 × ${mat.cols.length}열${corr ? ' 상관 행렬' : ''}`} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          {mat.values.map((row, r) => row.map((v, c) => {
            const key = `${r}\u0001${mat.rows[r]}`
            const fill = v == null ? '#f3f4f6' : color(v)
            const raw = mat.source[r]?.[c]
            return (
              <g key={`${r}-${c}`} transform={`translate(${x(mat.cols[c])},${y(key)})`} className="marks">
                <rect className={`hm-cell ${edit?.r === r && edit.c === c ? 'is-editing' : ''}`} width={x.bandwidth()} height={y.bandwidth()} fill={fill} rx={2} data-testid="hm-cell"
                  onPointerEnter={compact ? undefined : (e) => {
                    const lp = localPoint(svgRef.current!, e)
                    show(lp.x, lp.y, <><b>{mat.rows[r]} × {mat.cols[c]}</b><br />{corr ? `r = ${fmt(v, 3)}` : <>값: {fmt(raw)}{params.normalize !== 'none' && <><br />z-점수: {fmt(v, 2)}</>}</>}{editable && <><br />클릭해 값 수정</>}</>)
                  }}
                  onClick={editable ? () => { hide(); setEdit({ r, c, text: raw == null ? '' : String(raw) }) } : undefined} />
                {params.showValues && !compact && x.bandwidth() > 26 && y.bandwidth() > 14 && v != null && (
                  <text className="hm-value" x={x.bandwidth() / 2} y={y.bandwidth() / 2} dy="0.35em" textAnchor="middle" fill={textOn(fill)} style={{ fontSize }}>
                    {corr ? fmt(v, 2) : params.normalize !== 'none' ? fmt(v, 1) : fmt(raw, 1)}
                  </text>
                )}
              </g>
            )
          }))}
          {!compact && (
            <g className="axis" aria-hidden="true">
              {mat.rows.map((r, i) => <text key={i} x={-8} y={(y(`${i}\u0001${r}`) ?? 0) + y.bandwidth() / 2} dy="0.32em" textAnchor="end">{r.length > 8 ? `${r.slice(0, 7)}…` : r}</text>)}
              {mat.cols.map((c) => <text key={c} x={(x(c) ?? 0) + x.bandwidth() / 2} y={ih + 16} textAnchor="middle">{c.length > 8 ? `${c.slice(0, 7)}…` : c}</text>)}
            </g>
          )}
        </g>
      </svg>
      {edit && (
        <div className="cell-editor" style={{ left: m.left + (x(mat.cols[edit.c]) ?? 0), top: m.top + (y(`${edit.r}\u0001${mat.rows[edit.r]}`) ?? 0), width: Math.max(80, x.bandwidth()) }}>
          <input autoFocus type="number" aria-label={`${mat.rows[edit.r]} × ${mat.cols[edit.c]} 값`} value={edit.text} data-testid="hm-input"
            onChange={(e) => setEdit({ ...edit, text: e.target.value })} onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEdit(null) }} />
        </div>
      )}
      {!compact && (
        <>
          <div className="color-legend" aria-label="색상 범례">
            <span>{fmt(domain[0], 2)}</span>
            <span className="color-ramp" style={{ background: `linear-gradient(90deg, ${d3.range(0, 1.01, 0.1).map((t) => schemes[params.scheme].interpolate(t)).join(',')})` }} />
            <span>{fmt(domain[1], 2)}</span>
            <span className="legend-note">{corr ? '피어슨 r' : params.normalize === 'row' ? '행별 z-점수' : params.normalize === 'col' ? '열별 z-점수' : '값'}</span>
          </div>
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function HeatmapControls({ params, setParams, table, mapping }: ControlsProps<HeatmapParams>) {
  const mat = buildMatrix(table, roleColumn(mapping, 'label'), roleColumns(mapping, 'columns'), params)
  const flat = mat.values.flat().filter((v): v is number => v != null)
  const [lo, hi] = flat.length ? (d3.extent(flat) as [number, number]) : [0, 1]
  return (
    <>
      <ControlGroup title="행렬">
        <Segmented label="표시할 값" value={params.mode} onChange={(mode) => setParams({ mode, scheme: mode === 'corr' ? 'rdbu' : 'viridis', range: 'auto' })} testId="ctl-mode"
          options={[{ value: 'values', label: '원래 값' }, { value: 'corr', label: '상관 행렬' }]} />
        {params.mode === 'values' && (
          <>
            <Select label="정규화" value={params.normalize} onChange={(normalize) => setParams({ normalize, range: 'auto' })} testId="ctl-normalize"
              options={[{ value: 'none', label: '없음' }, { value: 'row', label: '행마다 z-점수' }, { value: 'col', label: '열마다 z-점수' }]} />
            <Hint>열마다 단위가 다르면 정규화해야 색을 비교할 수 있습니다. 행 정규화는 각 행 안에서의 상대적 패턴을 보여줍니다.</Hint>
            <Segmented label="행 정렬" value={params.sortRows} onChange={(sortRows) => setParams({ sortRows })} options={[{ value: 'none', label: '데이터 순서' }, { value: 'sum', label: '합계 내림차순' }]} />
          </>
        )}
      </ControlGroup>
      <ControlGroup title="색상">
        <Select label="색상 스케일" value={params.scheme} onChange={(scheme) => setParams({ scheme })} testId="ctl-scheme"
          options={(Object.keys(schemes) as ColorScheme[]).map((s) => ({ value: s, label: schemes[s].name }))} />
        <Hint>순차 스케일은 크기를, 발산 스케일은 기준값(0)에서 양쪽으로 벗어난 정도를 나타낼 때 씁니다.</Hint>
        <Segmented label="색상 범위" value={params.range} onChange={(range) => setParams(range === 'manual' ? { range, min: +lo.toFixed(2), max: +hi.toFixed(2) } : { range })} testId="ctl-range"
          options={[{ value: 'auto', label: '자동' }, { value: 'manual', label: '직접 지정' }]} />
        {params.range === 'manual' && (
          <div className="field-pair">
            <NumberField label="최솟값" value={params.min} step={0.1} onChange={(min) => setParams({ min })} testId="ctl-min" />
            <NumberField label="최댓값" value={params.max} step={0.1} onChange={(max) => setParams({ max })} testId="ctl-max" />
          </div>
        )}
        <Toggle label="칸에 값 표시" checked={params.showValues} onChange={(showValues) => setParams({ showValues })} testId="ctl-values" />
      </ControlGroup>
    </>
  )
}

export const heatmapModule: VizModule<HeatmapParams> = {
  roles: [
    { key: 'label', label: '행 이름', type: 'category', auto: true },
    { key: 'columns', label: '열 (숫자형)', type: 'number', required: true, multiple: { min: 1, max: 30 } },
  ],
  datasets: ['activity', 'players', 'flowers', 'cars'],
  defaultParams: { mode: 'values', scheme: 'viridis', normalize: 'none', range: 'auto', min: 0, max: 1, showValues: true, sortRows: 'none' },
  Chart: HeatmapChart,
  Controls: HeatmapControls,
  hint: '칸을 클릭하면 값을 직접 고칠 수 있습니다 (Enter로 확정, Esc로 취소)',
}
