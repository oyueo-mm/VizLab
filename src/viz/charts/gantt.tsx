import * as d3 from 'd3'
import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useRef, type PointerEvent } from 'react'
import { ChartMessage, Readout, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Slider, Toggle } from '../../components/controls'
import { appendRow, columnIndex, removeRows, templateRow, toLabel, toNumber, updateRow, type DataTable } from '../../data/table'
import { MapZoomButtons, useMapZoom } from '../../geo/useMapZoom'
import { categoryColor } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { DAY_MS, dateTickFormat, dateTicks, formatISO, formatTime, toTime } from '../../stats/datetime'
import { durationDays, resizeTask, shiftTask, validateTasks, type Task } from '../../stats/process'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'

export interface GanttParams {
  groupRows: boolean
  deps: boolean
  progress: boolean
  rowHeight: number
  selected: number
}

/** Reads tasks; rows whose start or end is not a valid date are skipped and counted. Predecessors are comma-separated names. */
export function readTasks(table: DataTable, mapping: Mapping) {
  const ix = (k: string) => columnIndex(table, roleColumn(mapping, k))
  const [ni, si, ei, gi, pi, di] = ['name', 'start', 'end', 'group', 'progress', 'deps'].map(ix)
  const tasks: Task[] = []
  let skipped = 0
  if (ni < 0 || si < 0 || ei < 0) return { tasks, skipped }
  table.rows.forEach((r, row) => {
    const s = toTime(r[si]); const e = toTime(r[ei]); const name = toLabel(r[ni]).trim()
    if (s == null || e == null || !name) { skipped++; return }
    const p = pi >= 0 ? toNumber(r[pi]) : null
    tasks.push({ name, start: s, end: e, group: gi >= 0 ? toLabel(r[gi]) : '', progress: p == null ? null : Math.max(0, Math.min(100, p)), deps: di >= 0 ? toLabel(r[di]).split(/[,;、]/).map((x) => x.trim()).filter(Boolean) : [], row })
  })
  return { tasks, skipped }
}

const LABEL_W = 150

function GanttChart({ table, mapping, params, setParams, width, height, compact, onTableChange, linked }: ChartProps<GanttParams>) {
  const { tasks, skipped } = useMemo(() => readTasks(table, mapping), [table, mapping])
  const issues = useMemo(() => validateTasks(tasks), [tasks])
  const issueRows = new Set(issues.map((i) => i.row))
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ row: number; mode: 'move' | 'start' | 'end'; x0: number; base: Task } | null>(null)
  const marked = new Set(linked?.rows ?? [])
  const editable = !!onTableChange && !compact
  // On a phone the readout wraps to two rows, so the axis gets more room below it.
  const AXIS_H = width < 520 ? 96 : 64
  const labelW = compact ? 0 : Math.min(LABEL_W, width * 0.28)
  const rowH = compact ? Math.max(4, Math.min(14, (height - 12) / Math.max(1, tasks.length))) : params.rowHeight

  // Rows: optionally clustered by group with a header line per group.
  const layout = useMemo(() => {
    const groups = [...new Set(tasks.map((t) => t.group))]
    const ordered = params.groupRows && groups.length > 1 ? groups.flatMap((g) => tasks.filter((t) => t.group === g)) : tasks
    const out: { task: Task; y: number }[] = []
    const heads: { name: string; y: number }[] = []
    let y = 0
    let prev: string | null = null
    for (const t of ordered) {
      if (params.groupRows && groups.length > 1 && t.group !== prev && !compact) { heads.push({ name: t.group || '(그룹 없음)', y }); y += rowH * 0.8; prev = t.group }
      out.push({ task: t, y }); y += rowH
    }
    return { rows: out, heads, h: y }
  }, [tasks, params.groupRows, rowH, compact])
  const color = useMemo(() => categoryColor([...new Set(tasks.map((t) => t.group || '작업'))]), [tasks])
  const iw = Math.max(40, width - labelW - (compact ? 6 : 16))
  const bodyH = Math.max(layout.h + 8, compact ? height : height - AXIS_H)
  const zoom = useMapZoom(svgRef, { enabled: !compact, maxK: 80, width: iw, height: bodyH })

  const [t0, t1] = tasks.length ? [d3.min(tasks, (t) => t.start)!, d3.max(tasks, (t) => t.end)! + DAY_MS] : [0, DAY_MS]
  const span = Math.max(DAY_MS * 3, t1 - t0)
  const base = d3.scaleTime().domain([t0 - span * 0.03, t1 + span * 0.03]).range([0, iw])
  // Only the horizontal part of the zoom is used: the time axis stretches, rows keep their height.
  const k = zoom.t.k
  const sx = (ms: number) => zoom.t.x + k * base(ms)
  const invX = (px: number) => base.invert((px - zoom.t.x) / k).getTime()
  const pxPerDay = (k * iw * DAY_MS) / (base.domain()[1].getTime() - base.domain()[0].getTime())
  const [v0, v1] = [invX(0), invX(iw)]
  const ticks = dateTicks(v0, v1, Math.max(3, Math.floor(iw / 90)))
  const tfmt = dateTickFormat(v0, v1, Math.max(3, Math.floor(iw / 90)))
  const pos = new Map(layout.rows.map((r) => [r.task.name, r]))
  const sc = roleColumn(mapping, 'start'); const ec = roleColumn(mapping, 'end')

  if (!roleColumn(mapping, 'name') || !sc || !ec) return <ChartMessage>작업 이름(범주형)과 시작·종료(날짜형) 열을 선택하세요.</ChartMessage>
  if (!tasks.length) return <ChartMessage>올바른 날짜가 있는 작업이 없습니다.<small>시작·종료 열은 2024-03-04 같은 날짜여야 합니다.</small></ChartMessage>

  const setDates = (tbl: DataTable, row: number, start: number, end: number) => updateRow(tbl, row, { [sc]: formatISO(start), [ec]: formatISO(end) })
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d || !(pxPerDay > 0)) return
    const days = Math.round((localPoint(svgRef.current!, e).x - d.x0) / pxPerDay)
    const next = d.mode === 'move' ? shiftTask(d.base, days) : resizeTask(d.base, d.mode, days)
    onTableChange!(setDates(table, d.row, next.start, next.end), true)
  }
  const onUp = () => { if (drag.current) { drag.current = null; onTableChange!(table, false) } }
  const del = () => { if (params.selected >= 0 && params.selected < table.rows.length) { onTableChange!(removeRows(table, [params.selected])); setParams({ selected: -1 }) } }
  const add = () => {
    const nameCol = roleColumn(mapping, 'name')!
    const last = d3.max(tasks, (t) => t.end) ?? t0
    const start = last + DAY_MS
    const patch: Record<string, string | number> = { [nameCol]: `새 작업 ${tasks.length + 1}`, [sc]: formatISO(start), [ec]: formatISO(start + 4 * DAY_MS) }
    const gc = roleColumn(mapping, 'group'); const pc = roleColumn(mapping, 'progress'); const dc = roleColumn(mapping, 'deps')
    if (gc) patch[gc] = tasks[tasks.length - 1]?.group ?? ''
    if (pc) patch[pc] = 0
    if (dc) patch[dc] = ''
    onTableChange!(appendRow(table, { ...templateRow(table), ...patch }))
    setParams({ selected: table.rows.length })
  }
  const startDrag = (e: PointerEvent, t: Task, mode: 'move' | 'start' | 'end') => {
    e.stopPropagation()
    svgRef.current!.setPointerCapture(e.pointerId)
    drag.current = { row: t.row, mode, x0: localPoint(svgRef.current!, e).x, base: t }
    setParams({ selected: t.row }); hide()
  }
  const barPath = (a: Task, b: Task) => {
    const pa = pos.get(a.name); const pb = pos.get(b.name)
    if (!pa || !pb) return null
    const x1 = sx(a.end + DAY_MS); const y1 = pa.y + rowH / 2; const x2 = sx(b.start); const y2 = pb.y + rowH / 2
    const xm = Math.min(x2 - 6, x1 + 8)
    return `M${x1},${y1}H${xm}V${y2}H${x2}`
  }

  return (
    <div className="chart-root">
      <svg width={width} height={AXIS_H} className="chart-svg gantt-axis" aria-hidden="true" style={{ pointerEvents: 'none', display: compact ? 'none' : 'block' }}>
        <g transform={`translate(${labelW},${AXIS_H - 1})`} className="axis">
          <line className="domain" x1={0} x2={iw} />
          {ticks.map((v) => <g key={v} transform={`translate(${sx(v)},0)`}><line y2={-6} /><text y={-12} textAnchor="middle">{tfmt(v)}</text></g>)}
        </g>
      </svg>
      <div className="gantt-scroll" style={{ height: compact ? height : height - AXIS_H, overflowY: compact ? 'hidden' : 'auto', overflowX: 'hidden' }}>
        <svg ref={svgRef} width={width} height={bodyH} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`간트 차트: 작업 ${tasks.length}개`} tabIndex={editable ? 0 : undefined}
          onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => { hide(); linked?.set(null) }}
          onKeyDown={(e) => { if (editable && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); del() } }} style={{ touchAction: 'pan-y' }}>
          <defs><clipPath id="gantt-clip"><rect x={labelW} y={0} width={iw} height={bodyH} /></clipPath></defs>
          {!compact && ticks.map((v) => sx(v) >= 0 && sx(v) <= iw && <line key={v} className="grid" x1={labelW + sx(v)} x2={labelW + sx(v)} y1={0} y2={bodyH} />)}
          {layout.heads.map((h) => <text key={h.name} className="axis-label" x={4} y={h.y + rowH * 0.6} fontWeight={700}>{h.name}</text>)}
          <g clipPath="url(#gantt-clip)">
            <g transform={`translate(${labelW},0)`}>
              {params.deps && layout.rows.flatMap(({ task: t }) => t.deps.map((d) => tasks.find((x) => x.name === d)).filter((x): x is Task => !!x && x.name !== t.name).map((p) => {
                const path = barPath(p, t)
                return path ? <g key={`${p.row}-${t.row}`} data-testid="gantt-dep" data-from={p.name} data-to={t.name}><path d={path} fill="none" stroke={t.start <= p.end ? '#d2492f' : '#8a9692'} strokeWidth={1.2} /><path d={`M${sx(t.start)},${(pos.get(t.name)?.y ?? 0) + rowH / 2}l-5,-3v6z`} fill={t.start <= p.end ? '#d2492f' : '#8a9692'} /></g> : null
              }))}
              {layout.rows.map(({ task: t, y }) => {
                const x0 = sx(t.start); const x1 = sx(t.end + DAY_MS)
                const w = Math.max(3, x1 - x0)
                const on = params.selected === t.row || marked.has(t.row)
                const bad = issueRows.has(t.row)
                const h = Math.max(3, rowH * 0.62)
                const fill = color(t.group || '작업')
                return (
                  <g key={t.row} data-testid="gantt-bar" data-row={t.row} data-name={t.name} data-start={formatISO(t.start)} data-end={formatISO(t.end)} data-days={durationDays(t)}
                    onPointerEnter={compact ? undefined : (e) => { if (drag.current) return; linked?.set([t.row]); const lp = localPoint(svgRef.current!.parentElement!, e); show(lp.x, lp.y + AXIS_H, <><b>{t.name}</b>{t.group ? ` · ${t.group}` : ''}<br />{formatTime(t.start)} – {formatTime(t.end)} ({durationDays(t)}일){t.progress != null ? <><br />진행률 {fmt(t.progress, 3)}%</> : null}{t.deps.length ? <><br />선행: {t.deps.join(', ')}</> : null}{bad ? <><br />{issues.filter((i) => i.row === t.row).map((i) => i.text).join(' ')}</> : null}{editable ? <><br />끌어서 이동 · 양 끝을 끌어 기간 조절</> : null}</>) }}
                    onPointerLeave={() => { hide(); linked?.set(null) }}>
                    <rect x={0 - labelW} y={y} width={width} height={rowH} fill={on ? '#fff3e8' : 'transparent'} pointerEvents="none" />
                    <rect x={x0} y={y + (rowH - h) / 2} width={w} height={h} rx={Math.min(4, h / 2)} fill={fill} fillOpacity={params.progress && t.progress != null ? 0.35 : 0.9} stroke={bad ? '#d2492f' : on ? '#121816' : 'none'} strokeWidth={bad || on ? 2 : 0}
                      data-nodrag="" style={{ cursor: editable ? 'grab' : compact ? undefined : 'pointer' }} onPointerDown={editable ? (e) => startDrag(e, t, 'move') : compact ? undefined : () => setParams({ selected: params.selected === t.row ? -1 : t.row })} />
                    {params.progress && t.progress != null && <rect x={x0} y={y + (rowH - h) / 2} width={w * (t.progress / 100)} height={h} rx={Math.min(4, h / 2)} fill={fill} pointerEvents="none" />}
                    {editable && w > 14 && <>
                      <rect x={x0 - 3} y={y + (rowH - h) / 2} width={7} height={h} fill="transparent" data-nodrag="" style={{ cursor: 'ew-resize' }} data-testid="gantt-handle-start" onPointerDown={(e) => startDrag(e, t, 'start')} />
                      <rect x={x1 - 4} y={y + (rowH - h) / 2} width={7} height={h} fill="transparent" data-nodrag="" style={{ cursor: 'ew-resize' }} data-testid="gantt-handle-end" onPointerDown={(e) => startDrag(e, t, 'end')} />
                    </>}
                  </g>
                )
              })}
            </g>
          </g>
          {!compact && layout.rows.map(({ task: t, y }) => <text key={t.row} className="bar-label" x={labelW - 8} y={y + rowH / 2} dy="0.32em" textAnchor="end" fontWeight={params.selected === t.row ? 700 : 400} fill={issueRows.has(t.row) ? '#d2492f' : undefined}>{t.name.length > 12 ? `${t.name.slice(0, 11)}…` : t.name}</text>)}
        </svg>
      </div>
      {!compact && (
        <>
          <Readout items={[{ label: '작업', value: tasks.length }, { label: '기간', value: `${Math.round((t1 - t0) / DAY_MS)}일` }, { label: '문제', value: issues.length ? `${issues.length}건` : '없음' }]} />
          <MapZoomButtons zoom={zoom} k={k} />
          {(skipped > 0 || issues.length > 0) && <p className="chart-warning" role="status" style={{ bottom: 44 }}>{skipped > 0 ? `날짜가 올바르지 않은 ${skipped}행은 그리지 않았습니다. ` : ''}{issues.slice(0, 2).map((i) => i.text).join(' ')}{issues.length > 2 ? ` 외 ${issues.length - 2}건` : ''}</p>}
          {editable && (
            <div className="chart-actions" style={{ bottom: 6, right: 8 }}>
              <button type="button" onClick={add} data-testid="gantt-add"><Plus size={14} aria-hidden="true" />작업 추가</button>
              {params.selected >= 0 && params.selected < table.rows.length && <button type="button" onClick={del} data-testid="gantt-delete"><Trash2 size={14} aria-hidden="true" />선택 삭제</button>}
            </div>
          )}
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function GanttControls({ params, setParams, table, mapping }: ControlsProps<GanttParams>) {
  const { tasks } = useMemo(() => readTasks(table, mapping), [table, mapping])
  const issues = useMemo(() => validateTasks(tasks), [tasks])
  return (
    <>
      <ControlGroup title="표시">
        <Toggle label="그룹별로 묶기" checked={params.groupRows} onChange={(groupRows) => setParams({ groupRows })} testId="ctl-gantt-group" />
        <Toggle label="선행 작업 화살표" checked={params.deps} onChange={(deps) => setParams({ deps })} testId="ctl-gantt-deps" />
        <Toggle label="진행률 채우기" checked={params.progress} onChange={(progress) => setParams({ progress })} />
        <Slider label="행 높이" value={params.rowHeight} min={18} max={44} onChange={(rowHeight) => setParams({ rowHeight })} format={(v) => `${v}px`} />
        <Hint>막대를 끌면 하루 단위로 이동하고, 양 끝을 끌면 기간이 바뀝니다. 선행 작업은 작업 이름을 쉼표로 이어 데이터 표에 적습니다. 종료일은 그날 하루를 포함하므로 시작·종료가 같으면 1일입니다. 휠·드래그·핀치로 시간축을 확대하고 옮길 수 있습니다.</Hint>
      </ControlGroup>
      {issues.length > 0 && (
        <ControlGroup title={`일정 문제 ${issues.length}건`}>
          <ul className="issue-list">{issues.map((i, n) => <li key={n}>{i.text}</li>)}</ul>
          <Hint>자동으로 고치지 않습니다. 막대를 옮기거나 표의 날짜를 직접 수정하세요.</Hint>
        </ControlGroup>
      )}
    </>
  )
}

export const ganttModule: VizModule<GanttParams> = {
  roles: [
    { key: 'name', label: '작업 이름', type: 'category', required: true, prefer: '작업|task|name' },
    { key: 'start', label: '시작일', type: 'date', required: true, prefer: '시작|start' },
    { key: 'end', label: '종료일', type: 'date', required: true, prefer: '종료|end' },
    { key: 'group', label: '그룹 (색, 선택)', type: 'category', prefer: '그룹|group' },
    { key: 'progress', label: '진행률 % (선택)', type: 'number', prefer: '진행|progress' },
    { key: 'deps', label: '선행 작업 (쉼표로 구분, 선택)', type: 'category', prefer: '선행|depend|pred' },
  ],
  datasets: ['projects'],
  defaultParams: { groupRows: false, deps: true, progress: true, rowHeight: 28, selected: -1 },
  Chart: GanttChart,
  Controls: GanttControls,
  hint: '막대를 끌어 일정 이동 · 양 끝을 끌어 기간 조절 · 휠·핀치로 시간축 확대 · 선행 작업보다 먼저 시작하면 빨갛게 표시',
}
