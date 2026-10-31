import * as d3 from 'd3'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { ChartMessage, Readout, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { columnIndex, type Cell, type DataTable } from '../../data/table'
import { categoryColor } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { relationMatrix, reorderMatrix } from '../../stats/chord'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'

export interface ChordParams {
  directed: boolean
  pad: number
  opacity: number
  labels: boolean
  order: string[]
  highlight: string
  /** Hide ribbons below this share of the largest ribbon. */
  threshold: number
  sort: 'none' | 'desc'
}

function useRelation(table: DataTable, mapping: ChartProps<ChordParams>['mapping'], params: ChordParams) {
  const fromCol = roleColumn(mapping, 'from')
  const mapped = roleColumns(mapping, 'to')
  const rel = useMemo(() => {
    // Columns added later (new groups) are not in the mapping yet; any numeric column named like a row label counts too.
    const fi = columnIndex(table, fromCol)
    const names = new Set(table.rows.map((r) => String(r[fi] ?? '')))
    const extra = table.columns.filter((c) => c.type === 'number' && c.name !== fromCol && names.has(c.name) && !mapped.includes(c.name)).map((c) => c.name)
    return relationMatrix(table, fromCol, [...mapped, ...extra])
  }, [table, fromCol, mapped])
  const toCols = mapped
  const ordered = useMemo(() => reorderMatrix(rel, params.order), [rel, params.order])
  return { fromCol, toCols, rel, ordered }
}

function ChordChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<ChordParams>) {
  const { fromCol, toCols, rel, ordered } = useRelation(table, mapping, params)
  const { labels, matrix } = ordered
  const color = useMemo(() => categoryColor(rel.labels), [rel.labels])
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<string | null>(null)
  const { tip, show, hide } = useTooltip()
  const outer = Math.max(20, Math.min(width, height) / 2 - (compact ? 6 : 64))
  const inner = outer - (compact ? 6 : 14)
  const layout = useMemo(() => {
    const gen = params.directed ? d3.chordDirected() : d3.chord()
    gen.padAngle(params.pad)
    if (params.sort === 'desc') gen.sortGroups((a, b) => b - a)
    return gen(matrix)
  }, [matrix, params.directed, params.pad, params.sort])
  const maxRibbon = d3.max(layout, (c) => Math.max(c.source.value, c.target.value)) ?? 1

  if (!fromCol || toCols.length < 2) return <ChartMessage>그룹 이름 열과 관계 값(숫자형) 열을 2개 이상 선택하세요.</ChartMessage>
  if (labels.length < 2) return <ChartMessage>그룹이 2개 이상 필요합니다.</ChartMessage>
  if (!d3.sum(matrix.flat())) return <ChartMessage>관계 값이 모두 0입니다. 데이터 탭에서 값을 입력하세요.</ChartMessage>
  const active = hover ?? (params.highlight || null)
  const name = (i: number) => labels[i]
  const ribbon = params.directed ? d3.ribbonArrow().radius(inner).padAngle(0) : d3.ribbon().radius(inner)
  const arc = d3.arc<d3.ChordGroup>().innerRadius(inner).outerRadius(outer)
  const totalAll = d3.sum(matrix.flat())

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`코드 다이어그램: 그룹 ${labels.length}개 사이의 관계`} onPointerLeave={() => { hide(); setHover(null) }}>
        <g transform={`translate(${width / 2},${height / 2})`}>
          <g className="chord-ribbons">
            {layout.filter((c) => Math.max(c.source.value, c.target.value) >= maxRibbon * params.threshold).map((c, k) => {
              const s = name(c.source.index)
              const t = name(c.target.index)
              const on = active == null || s === active || t === active
              return (
                <path key={k} className="chord-ribbon" data-testid="chord-ribbon" d={(ribbon as any)(c) ?? ''} fill={color(s)} fillOpacity={on ? params.opacity : 0.06} stroke={d3.color(color(s))!.darker(0.5).formatHex()} strokeOpacity={on ? 0.5 : 0.1}
                  onPointerMove={compact ? undefined : (e) => {
                    const lp = localPoint(svgRef.current!, e)
                    const back = matrix[c.target.index][c.source.index]
                    show(lp.x, lp.y, <><b>{s} → {t}</b>: {fmt(c.source.value)}{s !== t && <><br /><b>{t} → {s}</b>: {fmt(back)}</>}<br />전체의 {pct(c.source.value / totalAll)}</>)
                  }} onPointerLeave={hide} />
              )
            })}
          </g>
          {layout.groups.map((g) => {
            const n = name(g.index)
            const out = d3.sum(matrix[g.index])
            const inn = d3.sum(matrix, (r) => r[g.index])
            const mid = (g.startAngle + g.endAngle) / 2
            return (
              <g key={n} className="marks chord-group" opacity={active == null || active === n ? 1 : 0.35}>
                <path className="chord-arc" data-testid="chord-arc" d={arc(g) ?? ''} fill={color(n)} onPointerEnter={() => setHover(n)} onPointerLeave={() => { setHover(null); hide() }}
                  onClick={compact ? undefined : () => setParams({ highlight: params.highlight === n ? '' : n })}
                  onPointerMove={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{n}</b><br />나가는 합계 {fmt(out)}<br />들어오는 합계 {fmt(inn)}<br />순유출 {fmt(out - inn)}</>) }} />
                {params.labels && !compact && (
                  <text className="chord-label" transform={`rotate(${(mid * 180) / Math.PI - 90}) translate(${outer + 8},0)${mid > Math.PI ? ' rotate(180)' : ''}`} textAnchor={mid > Math.PI ? 'end' : 'start'} dy="0.35em" pointerEvents="none">{n}</text>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          <Readout items={[{ label: '그룹', value: labels.length }, { label: '관계 합계', value: fmt(totalAll) }, ...(rel.unmatchedColumns.length ? [{ label: '무시한 열', value: rel.unmatchedColumns.length }] : [])]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function ChordControls({ params, setParams, table, mapping, setTable }: ControlsProps<ChordParams>) {
  const { fromCol, toCols, rel, ordered } = useRelation(table, mapping, params)
  const [name, setName] = useState('')
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= ordered.labels.length) return
    const next = [...ordered.labels]
    ;[next[i], next[j]] = [next[j], next[i]]
    setParams({ order: next, sort: 'none' })
  }
  const fi = columnIndex(table, fromCol)
  const addGroup = () => {
    const n = name.trim()
    if (!setTable || !n || rel.labels.includes(n) || table.columns.some((c) => c.name === n) || fi < 0) return
    const columns = [...table.columns, { name: n, type: 'number' as const }]
    const rows: Cell[][] = table.rows.map((r) => [...r, toCols.includes(n) ? 0 : 0])
    const fresh: Cell[] = table.columns.map((c, i) => (i === fi ? n : toCols.includes(c.name) ? 0 : null))
    rows.push([...fresh, 0])
    setTable({ columns, rows })
    setName('')
  }
  const removeGroup = (g: string) => {
    if (!setTable || rel.labels.length <= 2) return
    const ci = columnIndex(table, g)
    const rows = table.rows.filter((r) => String(r[fi] ?? '') !== g).map((r) => r.filter((_, i) => i !== ci))
    setTable({ columns: table.columns.filter((c) => c.name !== g), rows })
  }
  return (
    <>
      <ControlGroup title="관계 표현">
        <Segmented label="방향" value={params.directed ? 'dir' : 'sym'} onChange={(v) => setParams({ directed: v === 'dir' })} testId="ctl-directed"
          options={[{ value: 'dir', label: '방향 있음 (화살표 리본)' }, { value: 'sym', label: '방향 없음' }]} />
        <Hint>{params.directed ? '리본의 끝에 화살촉이 붙고 A→B와 B→A가 따로 그려집니다. 행 = 출발, 열 = 도착입니다.' : '두 그룹 사이의 A→B와 B→A를 하나의 리본으로 묶어 양 끝 폭이 각각의 값이 됩니다.'}</Hint>
        <Slider label="연결 강도 하한" value={params.threshold} min={0} max={0.9} step={0.05} onChange={(threshold) => setParams({ threshold })} format={(v) => `최대의 ${Math.round(v * 100)}%`} testId="ctl-threshold" />
        <Slider label="리본 불투명도" value={params.opacity} min={0.15} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} />
        <Slider label="그룹 사이 간격" value={params.pad} min={0} max={0.2} step={0.01} onChange={(pad) => setParams({ pad })} format={(v) => `${Math.round((v * 180) / Math.PI)}°`} />
        <Toggle label="레이블" checked={params.labels} onChange={(labels) => setParams({ labels })} />
        <Select label="강조할 그룹" value={params.highlight} onChange={(highlight) => setParams({ highlight })} testId="ctl-highlight"
          options={[{ value: '', label: '없음 (호를 클릭해도 강조)' }, ...rel.labels.map((l) => ({ value: l, label: l }))]} />
      </ControlGroup>
      <ControlGroup title="그룹 순서·추가·삭제">
        <Segmented label="정렬" value={params.sort} onChange={(sort) => setParams({ sort })} options={[{ value: 'none', label: '아래 목록 순서' }, { value: 'desc', label: '합계 큰 순' }]} />
        <fieldset className="field multi-role" data-testid="group-order">
          <legend>그룹 순서</legend>
          <ul>
            {ordered.labels.map((l, i) => (
              <li key={l}><label>{l}</label>
                <button type="button" className="icon-btn-xs" aria-label={`${l} 위로`} onClick={() => move(i, -1)}><ArrowUp size={13} /></button>
                <button type="button" className="icon-btn-xs" aria-label={`${l} 아래로`} onClick={() => move(i, 1)}><ArrowDown size={13} /></button>
                <button type="button" className="icon-btn-xs" aria-label={`${l} 삭제`} disabled={rel.labels.length <= 2} onClick={() => removeGroup(l)} data-testid={`group-del-${l}`}><Trash2 size={13} /></button>
              </li>
            ))}
          </ul>
        </fieldset>
        <form className="add-flow" onSubmit={(e) => { e.preventDefault(); addGroup() }}>
          <div className="field"><label htmlFor="grp-name">새 그룹 이름</label><input id="grp-name" className="text-input" value={name} onChange={(e) => setName(e.target.value)} data-testid="group-name" /></div>
          <button type="submit" className="btn btn-secondary btn-sm" disabled={!name.trim() || rel.labels.includes(name.trim())} data-testid="group-add"><Plus size={14} aria-hidden="true" />그룹 추가</button>
        </form>
        <Hint>그룹 이름은 행 이름과 같은 이름의 열로 짝을 이룹니다. 새 그룹은 모든 값이 0인 행과 열로 추가되며, 관계 값은 데이터 탭에서 채웁니다.{rel.unmatchedColumns.length > 0 && ` 짝이 없는 열(${rel.unmatchedColumns.join(', ')})은 무시합니다.`}</Hint>
      </ControlGroup>
    </>
  )
}

export const chordModule: VizModule<ChordParams> = {
  roles: [
    { key: 'from', label: '그룹 이름 (행)', type: 'category', required: true },
    { key: 'to', label: '관계 값 열 (그룹 이름과 같은 열 이름)', type: 'number', required: true, multiple: { min: 2 } },
  ],
  datasets: ['migration'],
  defaultParams: { directed: true, pad: 0.05, opacity: 0.7, labels: true, order: [], highlight: '', threshold: 0, sort: 'none' },
  Chart: ChordChart,
  Controls: ChordControls,
  hint: '호를 클릭하거나 마우스를 올려 그 그룹의 연결 강조 · 데이터 탭에서 관계 행렬을 편집',
}
