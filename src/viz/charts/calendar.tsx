import * as d3 from 'd3'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChartMessage, Readout, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, NumberField, Segmented, Select, Toggle } from '../../components/controls'
import { appendRow, columnIndex, removeRows, templateRow, toLabel, toNumber, updateRow, type DataTable } from '../../data/table'
import { schemes, type SequentialScheme } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { calendarCell, daysInMonth, formatDate, fromDayNumber, isLeapYear, weekday, yearDates } from '../../stats/calendar'
import { parseDateTime } from '../../stats/datetime'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'

export interface CalendarParams {
  /** 0 = latest year in the data. */
  year: number
  weekStart: 0 | 1
  scheme: SequentialScheme
  range: 'auto' | 'manual'
  min: number
  max: number
  agg: 'sum' | 'mean' | 'max'
  missing: 'hatch' | 'blank'
  labelDays: boolean
  /** Part of the year shown: the whole year, a half or a quarter (bigger cells on small screens). */
  view: 'year' | 'h1' | 'h2' | 'q1' | 'q2' | 'q3' | 'q4'
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const schemeOptions = (Object.keys(schemes) as (keyof typeof schemes)[]).filter((k) => !schemes[k].diverging) as SequentialScheme[]

export interface DayData { value: number; rows: number[] }

/** Day → aggregated value (and source rows). `invalid` counts rows whose date or value cannot be used. */
export function dayValues(table: DataTable, dateCol: string | null, valueCol: string | null, agg: CalendarParams['agg']) {
  const di = columnIndex(table, dateCol)
  const vi = columnIndex(table, valueCol)
  const raw = new Map<string, { vals: number[]; rows: number[] }>()
  let invalid = 0
  if (di >= 0 && vi >= 0) {
    table.rows.forEach((r, i) => {
      const ms = typeof r[di] === 'number' ? (r[di] as number) : parseDateTime(toLabel(r[di]))
      const d = ms == null || !Number.isFinite(ms) ? null : fromDayNumber(Math.floor(ms / 86400000))
      const v = toNumber(r[vi])
      if (!d || v == null) { if (toLabel(r[di]) !== '' || r[vi] != null) invalid++; return }
      const key = formatDate(d)
      let e = raw.get(key)
      if (!e) { e = { vals: [], rows: [] }; raw.set(key, e) }
      e.vals.push(v)
      e.rows.push(i)
    })
  }
  const days = new Map<string, DayData>()
  for (const [k, e] of raw) days.set(k, { value: agg === 'sum' ? d3.sum(e.vals) : agg === 'mean' ? d3.mean(e.vals)! : d3.max(e.vals)!, rows: e.rows })
  const years = [...new Set([...days.keys()].map((k) => Number(k.slice(0, 4))))].sort((a, b) => a - b)
  return { days, years, invalid }
}

function CalendarChart({ table, mapping, params, width, height, compact, onTableChange }: ChartProps<CalendarParams>) {
  const dateCol = roleColumn(mapping, 'date')
  const valueCol = roleColumn(mapping, 'value')
  const { days, years, invalid } = useMemo(() => dayValues(table, dateCol, valueCol, params.agg), [table, dateCol, valueCol, params.agg])
  const year = params.year && years.includes(params.year) ? params.year : years[years.length - 1] ?? new Date().getFullYear()
  const dates = useMemo(() => yearDates(year), [year])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const [edit, setEdit] = useState<{ key: string; x: number; y: number } | null>(null)
  const [draft, setDraft] = useState('')
  useEffect(() => { setEdit(null) }, [year, table])

  const vals = dates.map((d) => days.get(formatDate(d))?.value).filter((v): v is number => v != null)
  const lo = params.range === 'manual' ? params.min : d3.min(vals) ?? 0
  const hi = params.range === 'manual' ? Math.max(params.max, lo + 1e-9) : d3.max(vals) ?? 1
  const color = d3.scaleSequential(schemes[params.scheme].interpolate).domain([lo, hi === lo ? lo + 1 : hi]).clamp(true)

  const padL = compact ? 4 : params.labelDays ? 30 : 8
  const padT = compact ? 4 : 56
  const padB = compact ? 4 : 34
  // The visible months decide which week columns are drawn; the cells never shrink below a readable size, so a narrow
  // screen scrolls sideways (or the view can be narrowed to a half or a quarter of the year) instead of squeezing 53 weeks.
  const [m0, m1] = compact ? [1, 12] : { year: [1, 12], h1: [1, 6], h2: [7, 12], q1: [1, 3], q2: [4, 6], q3: [7, 9], q4: [10, 12] }[params.view] ?? [1, 12]
  const startCol = calendarCell({ y: year, m: m0, d: 1 }, params.weekStart).col
  const endCol = calendarCell({ y: year, m: m1, d: daysInMonth(year, m1) }, params.weekStart).col
  const weeks = endCol - startCol + 1
  const minCell = compact ? 3 : 15
  const cell = Math.max(minCell, Math.min((width - padL - 8) / weeks, (height - padT - padB) / 7))
  const gap = Math.max(0.5, cell * 0.12)
  const gridW = cell * weeks
  const svgW = compact ? width : Math.max(width, padL + gridW + 8)
  const colX = (col: number) => (col - startCol) * cell
  const offsetY = compact ? padT : padT + Math.max(0, (height - padT - padB - cell * 7) / 2)

  if (!dateCol || !valueCol) return <ChartMessage>날짜와 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!years.length) return <ChartMessage>읽을 수 있는 날짜(예: 2024-03-15)가 있는 행이 없습니다.{invalid > 0 && ` (${invalid}행은 날짜나 값을 읽지 못했습니다)`}</ChartMessage>
  const editable = !!onTableChange && !compact
  const cells = dates.map((d) => ({ d, key: formatDate(d), ...calendarCell(d, params.weekStart), data: days.get(formatDate(d)) })).filter((c) => c.col >= startCol && c.col <= endCol && c.d.m >= m0 && c.d.m <= m1)
  const cellAt = new Map(cells.map((c) => [`${c.col},${c.row}`, c]))
  const filled = cells.filter((c) => c.data).length
  const shownDays = cells.length
  const total = d3.sum(cells, (c) => c.data?.value ?? 0)

  const commit = () => {
    if (!edit) return
    const t = draft.trim()
    const day = days.get(edit.key)
    if (t === '') { if (day) onTableChange!(removeRows(table, day.rows)); setEdit(null); return }
    const v = toNumber(t)
    if (v == null) return
    if (day) {
      let next = updateRow(table, day.rows[0], { [valueCol]: v })
      if (day.rows.length > 1) next = removeRows(next, day.rows.slice(1))
      onTableChange!(next)
    } else onTableChange!(appendRow(table, { ...templateRow(table), [dateCol]: edit.key, [valueCol]: v }))
    setEdit(null)
  }

  return (
    <div className="chart-root cal-scroll" data-testid="cal-scroll" style={{ overflowX: svgW > width ? 'auto' : undefined }}>
      <svg ref={svgRef} width={svgW} height={height} className={`chart-svg ${editable ? 'is-editable' : ''}`} role="img" data-testid="chart-svg"
        aria-label={`캘린더 히트맵: ${year}년 ${valueCol}, ${shownDays}일 중 ${filled}일 기록`} onPointerLeave={hide}>
        <defs>
          <pattern id="cal-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="#d5dbd9" strokeWidth="1.4" /></pattern>
        </defs>
        <g transform={`translate(${padL},${offsetY})`}>
          {!compact && Array.from({ length: m1 - m0 + 1 }, (_, k) => {
            const mi = m0 + k
            const col = Math.max(startCol, calendarCell({ y: year, m: mi, d: 1 }, params.weekStart).col)
            return <text key={mi} className="cal-month" x={colX(col)} y={-8}>{mi}월</text>
          })}
          {!compact && params.labelDays && [1, 3, 5].map((k) => {
            const wd = (k + params.weekStart) % 7
            const row = (wd - params.weekStart + 7) % 7
            return <text key={k} className="cal-day" x={-6} y={row * cell + cell / 2} dy="0.35em" textAnchor="end">{WEEKDAYS[wd]}</text>
          })}
          {cells.map((c) => {
            const has = !!c.data
            const fill = has ? color(c.data!.value) : params.missing === 'hatch' ? 'url(#cal-hatch)' : 'transparent'
            return (
              <rect key={c.key} className={`cal-cell ${has ? '' : 'is-missing'}`} data-date={c.key} data-testid="cal-cell" x={colX(c.col) + gap / 2} y={c.row * cell + gap / 2}
                width={Math.max(1, cell - gap)} height={Math.max(1, cell - gap)} rx={Math.min(3, cell / 5)} fill={fill} stroke={has ? 'none' : '#e5e9e8'} strokeWidth={has || params.missing === 'blank' && !compact ? 0.6 : 0}
                onPointerMove={compact ? undefined : (e) => {
                  const lp = localPoint(svgRef.current!, e)
                  show(lp.x, lp.y, <><b>{c.key} ({WEEKDAYS[weekday(c.d)]})</b><br />{has ? <>{valueCol}: {fmt(c.data!.value)}{c.data!.rows.length > 1 && <> (행 {c.data!.rows.length}개 {params.agg === 'sum' ? '합계' : params.agg === 'mean' ? '평균' : '최댓값'})</>}</> : '기록 없음'}{editable && <><br />클릭해 값 입력</>}</>)
                }}
                onClick={editable ? (e) => { const lp = localPoint(svgRef.current!, e); setEdit({ key: c.key, x: lp.x, y: lp.y }); setDraft(has ? String(c.data!.value) : ''); hide() } : undefined} />
            )
          })}
          {/* month boundaries */}
          {cells.map((c) => {
            const out: React.ReactNode[] = []
            const below = cellAt.get(`${c.col},${c.row + 1}`)
            const right = cellAt.get(`${c.col + 1},${c.row}`)
            if (c.row === 6 || (below && below.d.m !== c.d.m)) out.push(<line key="b" className="cal-sep" x1={colX(c.col)} x2={colX(c.col + 1)} y1={(c.row + 1) * cell} y2={(c.row + 1) * cell} />)
            if (right && right.d.m !== c.d.m) out.push(<line key="r" className="cal-sep" x1={colX(c.col + 1)} x2={colX(c.col + 1)} y1={c.row * cell} y2={(c.row + 1) * cell} />)
            return out.length ? <g key={c.key}>{out}</g> : null
          })}
          {!compact && (
            <g transform={`translate(${Math.max(44, gridW - 280)},${7 * cell + 8})`} aria-hidden="true">
              <text className="cal-day" x={-6} y={9} textAnchor="end">적음</text>
              {Array.from({ length: 9 }, (_, k) => <rect key={k} x={k * 16} y={0} width={14} height={12} rx={2} fill={color(lo + ((hi - lo) * k) / 8)} />)}
              <text className="cal-day" x={9 * 16 + 4} y={9}>많음 ({fmt(hi)})</text>
            </g>
          )}
        </g>
      </svg>
      {!compact && (
        <>
          <Readout items={[{ label: '연도', value: `${year}${isLeapYear(year) ? ' (윤년)' : ''}` }, { label: '기록', value: `${filled} / ${shownDays}일` }, { label: '합계', value: fmt(total) }, ...(invalid ? [{ label: '읽지 못한 행', value: invalid }] : [])]} />
          <Tooltip tip={tip} width={width} />
          {edit && (
            <form className="cell-popover" style={{ left: Math.min(width - 190, edit.x), top: edit.y + 10 }} onSubmit={(e) => { e.preventDefault(); commit() }}>
              <label>{edit.key}</label>
              <input autoFocus type="text" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`${edit.key} 값`} data-testid="cal-input"
                onKeyDown={(e) => { if (e.key === 'Escape') setEdit(null) }} placeholder="비우면 기록 삭제" />
              <button type="submit" className="btn btn-primary btn-sm">적용</button>
            </form>
          )}
        </>
      )}
    </div>
  )
}

function CalendarControls({ params, setParams, table, mapping }: ControlsProps<CalendarParams>) {
  const { years, days } = dayValues(table, roleColumn(mapping, 'date'), roleColumn(mapping, 'value'), params.agg)
  const vals = [...days.values()].map((d) => d.value)
  return (
    <>
      <ControlGroup title="기간">
        <Select label="연도" value={String(params.year && years.includes(params.year) ? params.year : years[years.length - 1] ?? 0)} onChange={(v) => setParams({ year: Number(v) })} testId="ctl-year"
          options={(years.length ? years : [0]).map((y) => ({ value: String(y), label: y ? `${y}년${isLeapYear(y) ? ' (윤년)' : ''}` : '데이터 없음' }))} />
        <Segmented label="주 시작" value={String(params.weekStart)} onChange={(v) => setParams({ weekStart: Number(v) as 0 | 1 })} testId="ctl-weekstart"
          options={[{ value: '0', label: '일요일' }, { value: '1', label: '월요일' }]} />
        <Select label="표시 기간" value={params.view} onChange={(view) => setParams({ view })} testId="ctl-view"
          options={[{ value: 'year', label: '1년 전체' }, { value: 'h1', label: '상반기 (1–6월)' }, { value: 'h2', label: '하반기 (7–12월)' }, { value: 'q1', label: '1분기' }, { value: 'q2', label: '2분기' }, { value: 'q3', label: '3분기' }, { value: 'q4', label: '4분기' }]} />
        <Select label="같은 날 여러 행" value={params.agg} onChange={(agg) => setParams({ agg })} options={[{ value: 'sum', label: '합계' }, { value: 'mean', label: '평균' }, { value: 'max', label: '최댓값' }]} />
      </ControlGroup>
      <ControlGroup title="색상">
        <Select label="색상 팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} testId="ctl-scheme" options={schemeOptions.map((k) => ({ value: k, label: schemes[k].name }))} />
        <Segmented label="색 범위" value={params.range} onChange={(range) => setParams({ range, min: params.range === 'auto' ? d3.min(vals) ?? 0 : params.min, max: params.range === 'auto' ? d3.max(vals) ?? 1 : params.max })} testId="ctl-range"
          options={[{ value: 'auto', label: '자동' }, { value: 'manual', label: '직접 지정' }]} />
        {params.range === 'manual' && (
          <>
            <NumberField label="최솟값 (가장 연한 색)" value={params.min} onChange={(min) => setParams({ min })} testId="ctl-min" />
            <NumberField label="최댓값 (가장 진한 색)" value={params.max} onChange={(max) => setParams({ max })} testId="ctl-max" />
          </>
        )}
        <Segmented label="기록 없는 날" value={params.missing} onChange={(missing) => setParams({ missing })} options={[{ value: 'hatch', label: '빗금' }, { value: 'blank', label: '빈칸' }]} />
        <Toggle label="요일 이름" checked={params.labelDays} onChange={(labelDays) => setParams({ labelDays })} />
        <Hint>기록이 없는 날은 값이 0인 날과 다르게 표시됩니다. 칸을 클릭해 값을 입력하거나(비우면 삭제), 데이터 탭에서 날짜를 편집하세요. 좁은 화면에서는 칸이 일정한 크기 밑으로 줄지 않고 옆으로 스크롤되며, ‘표시 기간’으로 일부만 크게 볼 수 있습니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const calendarModule: VizModule<CalendarParams> = {
  roles: [
    { key: 'date', label: '날짜 (예: 2024-03-15)', type: 'date', accept: ['date', 'category'], required: true },
    { key: 'value', label: '값', type: 'number', required: true },
  ],
  datasets: ['daily'],
  defaultParams: { year: 0, weekStart: 0, scheme: 'teal', range: 'auto', min: 0, max: 1, agg: 'sum', missing: 'hatch', labelDays: true, view: 'year' },
  Chart: CalendarChart,
  Controls: CalendarControls,
  hint: '칸을 클릭해 그날의 값 입력·수정(비우면 삭제) · 마우스를 올려 날짜와 요일 확인',
}
