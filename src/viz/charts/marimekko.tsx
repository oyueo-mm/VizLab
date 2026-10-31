import * as d3 from 'd3'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChartMessage, Legend, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, StatTable, Toggle } from '../../components/controls'
import { appendRow, columnIndex, setCell, templateRow, toLabel, toNumber, type DataTable } from '../../data/table'
import { categoryColor } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { marimekko } from '../../stats/process'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'

export interface MarimekkoParams {
  order: 'input' | 'total'
  gap: number
  labels: boolean
  /** Rectangle labels: the segment's share inside its column, or its share of the whole. */
  labelMode: 'column' | 'total'
}

function readCells(table: DataTable, mapping: Mapping) {
  const ci = columnIndex(table, roleColumn(mapping, 'category'))
  const si = columnIndex(table, roleColumn(mapping, 'segment'))
  const vi = columnIndex(table, roleColumn(mapping, 'value'))
  const rows: { category: string; segment: string; value: number; row: number }[] = []
  let skipped = 0
  if (ci >= 0 && si >= 0 && vi >= 0) table.rows.forEach((r, row) => {
    const v = toNumber(r[vi]); const c = toLabel(r[ci]).trim(); const s = toLabel(r[si]).trim()
    if (v == null || v < 0 || !c || !s) { skipped++; return }
    rows.push({ category: c, segment: s, value: v, row })
  })
  return { rows, skipped }
}

function MarimekkoChart({ table, mapping, params, width, height, compact, onTableChange, linked }: ChartProps<MarimekkoParams>) {
  const { rows, skipped } = useMemo(() => readCells(table, mapping), [table, mapping])
  const mm = useMemo(() => {
    const base = marimekko(rows)
    return params.order === 'total' ? marimekko(rows, [...base.columns].sort((a, b) => b.total - a.total).map((c) => c.name), base.segments) : base
  }, [rows, params.order])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const [edit, setEdit] = useState<{ row: number; x: number; y: number; label: string } | null>(null)
  const [draft, setDraft] = useState('')
  useEffect(() => { setEdit(null) }, [table])
  const color = useMemo(() => categoryColor(mm.segments), [mm.segments])
  const marked = new Set(linked?.rows ?? [])
  const m = margins(compact, compact ? {} : { top: 48, left: 44, bottom: 46, right: 16 })
  const iw = Math.max(40, width - m.left - m.right)
  const ih = Math.max(40, height - m.top - m.bottom)
  const editable = !!onTableChange && !compact

  if (!roleColumn(mapping, 'category') || !roleColumn(mapping, 'segment') || !roleColumn(mapping, 'value')) return <ChartMessage>열(범주형)·구성(범주형)·값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!mm.columns.length || mm.grand <= 0) return <ChartMessage>0보다 큰 값이 없습니다.</ChartMessage>

  const gap = compact ? 1 : params.gap
  const usable = iw - gap * (mm.columns.length - 1)
  let xCursor = 0
  const cols = mm.columns.map((c) => {
    const w = (c.total / mm.grand) * usable
    const x0 = xCursor
    xCursor += w + gap
    let y = 0
    const segs = c.segments.map((s) => { const h = s.share * ih; const r = { ...s, y0: y, h }; y += h; return r })
    return { c, x0, w, segs }
  })
  const commit = () => {
    if (!edit) return
    const v = Number(draft.replace(/,/g, ''))
    if (!Number.isFinite(v) || v < 0 || draft.trim() === '') return
    onTableChange!(setCell(table, edit.row, roleColumn(mapping, 'value')!, v))
    setEdit(null)
  }
  const addCell = () => {
    const first = mm.columns[0]
    onTableChange!(appendRow(table, { ...templateRow(table), [roleColumn(mapping, 'category')!]: first.name, [roleColumn(mapping, 'segment')!]: `${mm.segments[0]} (추가)`, [roleColumn(mapping, 'value')!]: Math.round(first.total * 0.1) }))
  }

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`마리메코 차트: 열 ${cols.length}개, 구성 ${mm.segments.length}개`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${m.left},${m.top})`}>
          {cols.map(({ c, x0, w, segs }) => (
            <g key={c.name} data-testid="mekko-column" data-name={c.name} data-width={w.toFixed(3)} data-total={c.total}>
              {segs.map((s) => {
                const on = s.row.some((r) => marked.has(r))
                const area = (s.value / mm.grand) * 100
                return (
                  <g key={s.name} data-testid="mekko-cell" data-column={c.name} data-segment={s.name} data-value={s.value} data-area={(w * s.h).toFixed(2)}>
                    <rect x={x0} y={s.y0} width={Math.max(0, w)} height={Math.max(0, s.h - (compact ? 0 : 1))} fill={color(s.name)} fillOpacity={on ? 1 : 0.88} stroke={on ? '#121816' : '#ffffff'} strokeWidth={on ? 2 : 0.8} style={{ cursor: editable ? 'pointer' : undefined }}
                      onPointerEnter={compact ? undefined : (e) => { linked?.set(s.row); const p = localPoint(svgRef.current!, e); show(p.x, p.y, <><b>{c.name} · {s.name}</b><br />{fmt(s.value)}<br />열 안의 {fmt(s.share * 100, 1)}% · 전체의 {fmt(area, 1)}%<br />열 합계 {fmt(c.total)} (전체의 {fmt((c.total / mm.grand) * 100, 1)}%){editable ? <><br />클릭해 값 수정</> : null}</>) }}
                      onPointerLeave={() => { hide(); linked?.set(null) }}
                      onClick={editable ? (e) => { const p = localPoint(svgRef.current!, e); setEdit({ row: s.row[0], x: p.x, y: p.y, label: `${c.name} · ${s.name}` }); setDraft(String(s.value)) } : undefined} />
                    {params.labels && !compact && w > 46 && s.h > 30 && <text x={x0 + w / 2} y={s.y0 + s.h / 2} dy="0.34em" textAnchor="middle" fill={d3.hsl(color(s.name)).l > 0.6 ? '#121816' : '#ffffff'} fontSize={11} pointerEvents="none">{params.labelMode === 'column' ? `${fmt(s.share * 100, 1)}%` : `${fmt(area, 1)}%`}</text>}
                  </g>
                )
              })}
              {!compact && <text className="bar-label" x={x0 + w / 2} y={ih + 16} textAnchor="middle">{w > 36 ? (c.name.length > Math.floor(w / 7) ? `${c.name.slice(0, Math.max(1, Math.floor(w / 7) - 1))}…` : c.name) : ''}</text>}
              {!compact && <text className="bar-label" x={x0 + w / 2} y={ih + 30} textAnchor="middle" fill="#5a6b66">{w > 36 ? `${fmt((c.total / mm.grand) * 100, 1)}%` : ''}</text>}
            </g>
          ))}
          {!compact && [0, 0.25, 0.5, 0.75, 1].map((v) => <text key={v} className="axis" x={-8} y={ih * (1 - v)} dy="0.32em" textAnchor="end" style={{ fontSize: 11 }}>{v * 100}%</text>)}
        </g>
      </svg>
      {!compact && (
        <>
          <Legend items={mm.segments.map((s) => ({ key: s, color: color(s) }))} title={roleColumn(mapping, 'segment') ?? ''} />
          <Readout items={[{ label: '열', value: cols.length }, { label: '전체 합계', value: fmt(mm.grand) }]} />
          {skipped > 0 && <p className="chart-warning" role="status">이름이 없거나 값이 음수·누락인 {skipped}행은 제외했습니다.</p>}
          {editable && <div className="chart-actions" style={{ bottom: 6, right: 8 }}><button type="button" onClick={addCell} data-testid="mekko-add">칸 추가</button></div>}
          <Tooltip tip={tip} width={width} />
          {edit && (
            <form className="cell-popover" style={{ left: Math.min(width - 200, edit.x), top: edit.y + 10 }} onSubmit={(e) => { e.preventDefault(); commit() }}>
              <label>{edit.label}</label>
              <input autoFocus type="text" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="값" data-testid="mekko-input" onKeyDown={(e) => { if (e.key === 'Escape') setEdit(null) }} />
              <button type="submit" className="btn btn-primary btn-sm">적용</button>
            </form>
          )}
        </>
      )}
    </div>
  )
}

function MarimekkoControls({ params, setParams, table, mapping }: ControlsProps<MarimekkoParams>) {
  const { rows } = useMemo(() => readCells(table, mapping), [table, mapping])
  const mm = useMemo(() => marimekko(rows), [rows])
  return (
    <>
      <ControlGroup title="표시">
        <Segmented label="열 순서" value={params.order} onChange={(order) => setParams({ order })} testId="ctl-mekko-order" options={[{ value: 'input', label: '입력 순서' }, { value: 'total', label: '큰 열 먼저' }]} />
        <Slider label="열 사이 간격" value={params.gap} min={0} max={12} onChange={(gap) => setParams({ gap })} format={(v) => `${v}px`} />
        <Toggle label="칸 안에 비율 표시" checked={params.labels} onChange={(labels) => setParams({ labels })} />
        <Segmented label="비율 기준" value={params.labelMode} onChange={(labelMode) => setParams({ labelMode })} options={[{ value: 'column', label: '열 안' }, { value: 'total', label: '전체' }]} />
        <Hint>각 칸의 넓이는 (값 ÷ 전체 합계)에 비례합니다. 열의 너비가 열 합계에 비례하고 칸의 높이가 열 안의 비율에 비례하기 때문입니다. 모자이크 플롯과 같은 구조처럼 보이지만, 모자이크는 두 범주형 변수의 빈도와 독립성을 다루는 그림이고 마리메코는 값(금액 등)의 크기와 구성을 함께 보는 그림입니다.</Hint>
      </ControlGroup>
      {mm.columns.length > 0 && (
        <ControlGroup title="열 합계">
          <StatTable rows={mm.columns.map((c) => [c.name, `${fmt(c.total)} (${fmt((c.total / mm.grand) * 100, 1)}%)`])} />
        </ControlGroup>
      )}
    </>
  )
}

export const marimekkoModule: VizModule<MarimekkoParams> = {
  roles: [
    { key: 'category', label: '열 (너비)', type: 'category', required: true },
    { key: 'segment', label: '구성 (높이·색)', type: 'category', required: true },
    { key: 'value', label: '값', type: 'number', required: true },
  ],
  datasets: ['market'],
  defaultParams: { order: 'input', gap: 3, labels: true, labelMode: 'column' },
  Chart: MarimekkoChart,
  Controls: MarimekkoControls,
  hint: '칸을 클릭해 값 수정 · 열 너비는 열의 합계, 높이는 열 안의 구성 비율 · 칸의 넓이가 전체에서의 비중입니다',
}
