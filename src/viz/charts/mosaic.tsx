import * as d3 from 'd3'
import { Minus, Plus } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { ChartMessage, Legend, Readout, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, StatTable, Toggle } from '../../components/controls'
import { columnIndex, removeRows, setCell, toLabel, toNumber, appendRow, templateRow, type DataTable } from '../../data/table'
import { categoryColor, schemes, textOn } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { chiSquare, collectCounts, mosaicLayout, type MosaicCell } from '../../stats/mosaic'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'

export interface MosaicParams {
  firstDir: 'x' | 'y'
  swap: boolean
  color: 'first' | 'second' | 'residual'
  labels: boolean
  show: 'count' | 'percent' | 'none'
  gap: number
}

interface Source { cols: string[]; countCol: string | null }

const sourceOf = (mapping: Mapping): Source => ({ cols: ['v1', 'v2', 'v3'].map((k) => roleColumn(mapping, k)).filter((c): c is string => !!c), countCol: roleColumn(mapping, 'count') })

function build(table: DataTable, src: Source, swap: boolean) {
  const cols = swap && src.cols.length >= 2 ? [src.cols[1], src.cols[0], ...src.cols.slice(2)] : src.cols
  const idx = cols.map((c) => columnIndex(table, c))
  const ci = columnIndex(table, src.countCol)
  const rows: { keys: string[]; count: number; row: number }[] = []
  let skipped = 0
  table.rows.forEach((r, row) => {
    const keys = idx.map((i) => toLabel(r[i]))
    const count = ci >= 0 ? toNumber(r[ci]) : 1
    if (keys.some((k) => k === '') || count == null || count < 0) { skipped++; return }
    rows.push({ keys, count, row })
  })
  return { cols, ...collectCounts(rows, cols.length), skipped }
}

function MosaicChart({ table, mapping, params, width, height, compact, linked }: ChartProps<MosaicParams>) {
  const src = useMemo(() => sourceOf(mapping), [mapping])
  const data = useMemo(() => build(table, src, params.swap), [table, src, params.swap])
  const pad = compact ? 4 : 10
  const left = compact ? 4 : width < 520 ? 22 : 66
  const top = compact ? 4 : width < 520 ? 94 : 66
  const iw = Math.max(10, width - left - pad)
  const ih = Math.max(10, height - top - (compact ? 4 : 26))
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const layout = useMemo(() => mosaicLayout(data.levels, data.counts, iw, ih, params.firstDir, compact ? 1 : params.gap), [data, iw, ih, params.firstDir, params.gap, compact])

  if (src.cols.length < 2 || !src.countCol) return <ChartMessage>범주형 변수 2개 이상과 빈도(숫자형) 열을 선택하세요.</ChartMessage>
  if (!layout.total) return <ChartMessage>빈도가 모두 0이거나 비어 있습니다. 0보다 큰 빈도를 입력하세요.</ChartMessage>
  const { cells, total } = layout
  const colorKey = params.color === 'second' ? 1 : 0
  const pal = categoryColor(data.levels[Math.min(colorKey, data.levels.length - 1)])
  const resid = d3.scaleDiverging(schemes.rdbu.interpolate).domain([-4, 0, 4]).clamp(true)
  const fillOf = (c: MosaicCell) => (params.color === 'residual' ? resid(c.residual) : pal(c.keys[colorKey]))
  const chi = chiSquare(cells, data.levels)
  const marked = new Set(linked?.rows ?? [])
  const showText = (c: MosaicCell) => params.labels && !compact && c.w > 46 && c.h > 28 && c.count > 0
  const label = (c: MosaicCell) => (params.show === 'count' ? fmt(c.count, 0) : params.show === 'percent' ? pct(c.count / total) : '')
  const firstAcross = params.firstDir === 'x'

  // Axis labels: first variable's categories across the split direction, second along the other (first-level strips only).
  const level0 = data.levels[0].map((k) => {
    const g = cells.filter((c) => c.keys[0] === k)
    if (!g.length) return { k, x: 0, y: 0, w: 0, h: 0 }
    const x0 = Math.min(...g.map((c) => c.x)); const y0 = Math.min(...g.map((c) => c.y))
    return { k, x: x0, y: y0, w: Math.max(...g.map((c) => c.x + c.w)) - x0, h: Math.max(...g.map((c) => c.y + c.h)) - y0 }
  })

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`모자이크 플롯: ${data.cols.join(' × ')}`} onPointerLeave={hide}>
        <g transform={`translate(${left},${top})`}>
          {cells.map((c, i) => {
            const on = c.rows.some((r) => marked.has(r))
            return (
              <g key={i} className="mosaic-cell" data-testid="mosaic-cell" data-count={c.count}>
                <rect x={c.x} y={c.y} width={Math.max(0, c.w)} height={Math.max(0, c.h)} fill={c.count > 0 ? fillOf(c) : '#f6f8f7'} stroke={on ? '#121816' : '#fff'} strokeWidth={on ? 2.5 : compact ? 0.5 : 1.5}
                  data-w={c.w.toFixed(2)} data-h={c.h.toFixed(2)}
                  onPointerMove={compact ? undefined : (e) => {
                    linked?.set(c.rows)
                    const p = localPoint(svgRef.current!, e)
                    show(p.x, p.y, <><b>{c.keys.join(' · ')}</b><br />빈도 {fmt(c.count, 0)} ({pct(c.count / total)})<br />독립일 때 기대 {fmt(c.expected, 1)}<br />잔차 {c.residual >= 0 ? '+' : ''}{fmt(c.residual, 2)}</>)
                  }} onPointerLeave={() => { linked?.set(null); hide() }} />
                {showText(c) && <text className="mosaic-label" x={c.x + c.w / 2} y={c.y + c.h / 2} textAnchor="middle" dy="0.35em" fill={textOn(fillOf(c))}>{c.keys[data.cols.length - 1]}{params.show !== 'none' ? ` ${label(c)}` : ''}</text>}
              </g>
            )
          })}
          {!compact && level0.map((l) => firstAcross
            ? <text key={l.k} className="cat-label" x={l.x + l.w / 2} y={-10} textAnchor="middle">{l.k}</text>
            : <text key={l.k} className="cat-label" x={-8} y={l.y + l.h / 2} textAnchor="end" dy="0.35em">{l.k}</text>)}
        </g>
        {!compact && <text className="axis-label" x={firstAcross ? left + iw / 2 : 14} y={firstAcross ? top - 36 : top + ih / 2} textAnchor="middle" transform={firstAcross ? undefined : `rotate(-90 14 ${top + ih / 2})`}>{data.cols[0]}{firstAcross ? ' (가로로 분할)' : ' (세로로 분할)'}</text>}
      </svg>
      {!compact && (
        <>
          {params.color === 'residual'
            ? <div className="color-legend"><span>기대보다 적음</span><span className="color-ramp" style={{ background: `linear-gradient(90deg, ${d3.range(0, 1.01, 0.1).map((v) => schemes.rdbu.interpolate(v)).join(',')})` }} /><span>기대보다 많음 (잔차 ±4)</span></div>
            : <Legend title={data.cols[colorKey]} items={data.levels[Math.min(colorKey, data.levels.length - 1)].map((k) => ({ key: k, color: pal(k) }))} />}
          <Readout items={[{ label: 'N', value: fmt(total, 0) }, { label: 'χ²', value: fmt(chi.stat, 2) }, { label: '자유도', value: chi.df }]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function MosaicControls({ params, setParams, table, mapping, setTable }: ControlsProps<MosaicParams>) {
  const src = useMemo(() => sourceOf(mapping), [mapping])
  const data = useMemo(() => build(table, src, false), [table, src])
  const [adding, setAdding] = useState<{ col: string; name: string }>({ col: src.cols[0] ?? '', name: '' })
  const twoWay = data.cols.length === 2
  const countIdx = columnIndex(table, src.countCol)
  const rowFor = (a: string, b: string) => table.rows.findIndex((r) => toLabel(r[columnIndex(table, data.cols[0])]) === a && toLabel(r[columnIndex(table, data.cols[1])]) === b)

  const setCount = (a: string, b: string, v: number) => {
    if (!setTable || countIdx < 0) return
    const row = rowFor(a, b)
    if (row >= 0) setTable(setCell(table, row, src.countCol!, Math.max(0, v)))
    else setTable(appendRow(table, { ...templateRow(table), [data.cols[0]]: a, [data.cols[1]]: b, [src.countCol!]: Math.max(0, v) }))
  }
  const addCategory = () => {
    const name = adding.name.trim()
    const ci = data.cols.indexOf(adding.col)
    if (!setTable || !name || ci < 0 || data.levels[ci].includes(name) || !src.countCol) return
    // A new category needs a cell for every combination with the other variables, so the table stays a full cross-tab.
    const others = data.levels.map((lv, i) => (i === ci ? [name] : lv))
    let next = table
    const combos = others.reduce<string[][]>((acc, lv) => acc.flatMap((p) => lv.map((k) => [...p, k])), [[]])
    for (const keys of combos) next = appendRow(next, { ...templateRow(table), ...Object.fromEntries(data.cols.map((c, i) => [c, keys[i]])), [src.countCol]: 0 })
    setTable(next)
    setAdding({ ...adding, name: '' })
  }
  const removeCategory = (colIdx: number, name: string) => {
    if (!setTable) return
    const ci = columnIndex(table, data.cols[colIdx])
    setTable(removeRows(table, table.rows.map((r, i) => (toLabel(r[ci]) === name ? i : -1)).filter((i) => i >= 0)))
  }
  const rowsTotal = (a: string) => data.levels[1]?.reduce((s, b) => s + (data.counts.get(`${a}\u0000${b}`)?.count ?? 0), 0) ?? 0

  return (
    <>
      <ControlGroup title="분할과 색">
        <Segmented label="첫 변수를 나누는 방향" value={params.firstDir} onChange={(firstDir) => setParams({ firstDir })} testId="ctl-dir" options={[{ value: 'x', label: '가로' }, { value: 'y', label: '세로' }]} />
        <Toggle label="첫째·둘째 변수 바꾸기" description="어느 변수를 먼저 나누느냐에 따라 같은 표가 다르게 보입니다" checked={params.swap} onChange={(swap) => setParams({ swap })} testId="ctl-swap" />
        <Select label="색상 기준" value={params.color} onChange={(color) => setParams({ color })} testId="ctl-color"
          options={[{ value: 'first', label: '첫째 변수' }, { value: 'second', label: '둘째 변수' }, { value: 'residual', label: '피어슨 잔차 (연관성)' }]} />
        {params.color === 'residual' && <Hint>잔차 (관측 − 기대) / √기대: 두 변수가 독립이라면 기대되는 빈도와의 차이입니다. 파랑은 기대보다 많고 빨강은 적은 칸입니다.</Hint>}
      </ControlGroup>
      <ControlGroup title="표시">
        <Toggle label="칸 레이블" checked={params.labels} onChange={(labels) => setParams({ labels })} />
        <Select label="값 표시" value={params.show} onChange={(show) => setParams({ show })} options={[{ value: 'count', label: '빈도' }, { value: 'percent', label: '전체 대비 비율' }, { value: 'none', label: '없음' }]} />
        <Slider label="칸 사이 간격" value={params.gap} min={0} max={10} step={1} onChange={(gap) => setParams({ gap })} format={(v) => `${v}px`} />
        <Hint>간격이 0이면 칸의 넓이가 빈도에 정확히 비례합니다. 간격이 있으면 칸이 조금씩 줄어들지만 비율은 같습니다.</Hint>
      </ControlGroup>
      <ControlGroup title="범주 추가·삭제">
        {data.cols.map((c, ci) => (
          <div key={c} className="cat-chips">
            <span className="field-label">{c}</span>
            <ul>{data.levels[ci].map((k) => (
              <li key={k}>{k}<button type="button" className="icon-btn-xs" aria-label={`${c}의 ${k} 삭제`} disabled={data.levels[ci].length <= 1} onClick={() => removeCategory(ci, k)}><Minus size={12} /></button></li>
            ))}</ul>
          </div>
        ))}
        <div className="field-pair">
          <Select label="변수" value={adding.col} onChange={(col) => setAdding({ ...adding, col })} options={data.cols.map((c) => ({ value: c, label: c }))} testId="mosaic-add-col" />
          <div className="field number-field"><label htmlFor="mosaic-new">새 범주 이름</label>
            <input id="mosaic-new" type="text" value={adding.name} data-testid="mosaic-add-name" onChange={(e) => setAdding({ ...adding, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') addCategory() }} /></div>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={addCategory} disabled={!adding.name.trim()} data-testid="mosaic-add"><Plus size={14} aria-hidden="true" />범주 추가</button>
        <Hint>새 범주는 빈도 0인 칸으로 시작하니 아래 교차표나 데이터 탭에서 값을 입력하세요.</Hint>
      </ControlGroup>
      {twoWay && data.levels[0].length > 0 && (
        <ControlGroup title="교차표 편집">
          <div className="crosstab-wrap" data-testid="crosstab">
            <table className="crosstab">
              <thead><tr><th scope="col">{data.cols[0]} ＼ {data.cols[1]}</th>{data.levels[1].map((b) => <th key={b} scope="col">{b}</th>)}<th scope="col">합계</th></tr></thead>
              <tbody>{data.levels[0].map((a) => (
                <tr key={a}><th scope="row">{a}</th>
                  {data.levels[1].map((b) => {
                    const dup = table.rows.filter((r) => toLabel(r[columnIndex(table, data.cols[0])]) === a && toLabel(r[columnIndex(table, data.cols[1])]) === b).length > 1
                    return <td key={b}><input type="number" min={0} aria-label={`${a} × ${b}`} disabled={dup} title={dup ? '같은 조합이 여러 행에 있어 데이터 탭에서 편집하세요' : undefined}
                      value={data.counts.get(`${a}\u0000${b}`)?.count ?? 0} onChange={(e) => setCount(a, b, Number(e.target.value) || 0)} /></td>
                  })}
                  <td className="crosstab-total">{fmt(rowsTotal(a), 0)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <StatTable rows={[['요약', '값'], ['총 응답', fmt([...data.counts.values()].reduce((s, r) => s + r.count, 0), 0)]]} />
        </ControlGroup>
      )}
    </>
  )
}

export const mosaicModule: VizModule<MosaicParams> = {
  roles: [
    { key: 'v1', label: '첫째 범주 변수', type: 'category', required: true },
    { key: 'v2', label: '둘째 범주 변수', type: 'category', required: true },
    { key: 'v3', label: '셋째 범주 변수 (선택)', type: 'category', auto: true },
    { key: 'count', label: '빈도 (숫자형)', type: 'number', required: true },
  ],
  datasets: ['survey', 'categorical'],
  defaultParams: { firstDir: 'x', swap: false, color: 'second', labels: true, show: 'count', gap: 2 },
  Chart: MosaicChart,
  Controls: MosaicControls,
  hint: '칸의 넓이는 빈도에 비례 · 잔차 색상으로 변수 사이의 연관성이 큰 칸을 찾기 · 범주를 추가·삭제하고 교차표를 직접 편집',
}
