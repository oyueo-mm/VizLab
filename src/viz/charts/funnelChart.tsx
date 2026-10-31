import * as d3 from 'd3'
import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useRef, type PointerEvent } from 'react'
import { ChartMessage, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, StatTable, Toggle } from '../../components/controls'
import { appendRow, columnIndex, removeRows, templateRow, toLabel, toNumber, updateRow, type DataTable } from '../../data/table'
import { fmt } from '../../lib/format'
import { funnelMetrics, type Stage } from '../../stats/process'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'

export interface FunnelChartParams {
  /** Bar length: the value itself, or its share of the first stage. */
  scale: 'absolute' | 'percent'
  shape: 'bars' | 'connected'
  drops: boolean
  selected: number
}

function readStages(table: DataTable, mapping: Mapping) {
  const si = columnIndex(table, roleColumn(mapping, 'stage'))
  const vi = columnIndex(table, roleColumn(mapping, 'value'))
  const stages: Stage[] = []
  let skipped = 0
  if (si >= 0 && vi >= 0) table.rows.forEach((r, row) => {
    const v = toNumber(r[vi]); const name = toLabel(r[si]).trim()
    if (v == null || v < 0 || !name) { skipped++; return }
    stages.push({ name, value: v, row })
  })
  return { stages, skipped }
}

function FunnelChartView({ table, mapping, params, setParams, width, height, compact, onTableChange, linked }: ChartProps<FunnelChartParams>) {
  const { stages, skipped } = useMemo(() => readStages(table, mapping), [table, mapping])
  const metrics = useMemo(() => funnelMetrics(stages), [stages])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<number | null>(null)
  const marked = new Set(linked?.rows ?? [])
  const editable = !!onTableChange && !compact
  const m = margins(compact, compact ? {} : { left: 110, right: params.drops ? 150 : 40, top: 18, bottom: 16 })
  const iw = Math.max(40, width - m.left - m.right)
  const ih = Math.max(40, height - m.top - m.bottom)
  const vc = roleColumn(mapping, 'value'); const sc = roleColumn(mapping, 'stage')

  if (!sc || !vc) return <ChartMessage>단계(범주형)와 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!stages.length || stages[0].value <= 0) return <ChartMessage>첫 단계의 값이 0보다 커야 합니다.<small>단계 이름과 0 이상의 값이 있는 행이 필요합니다.</small></ChartMessage>

  const first = stages[0].value
  const maxV = d3.max(stages, (s) => s.value)!
  const band = d3.scaleBand<number>().domain(d3.range(stages.length)).range([0, ih]).paddingInner(params.shape === 'connected' ? 0.22 : 0.18)
  const half = (v: number) => (iw / 2) * (v / maxV)
  const cx = iw / 2
  const inflow = metrics.filter((x) => x.inflow)
  const lost = first - stages[stages.length - 1].value
  const del = () => { if (params.selected >= 0 && params.selected < table.rows.length) { onTableChange!(removeRows(table, [params.selected])); setParams({ selected: -1 }) } }
  const add = () => {
    const last = stages[stages.length - 1]
    onTableChange!(appendRow(table, { ...templateRow(table), [sc]: `단계 ${stages.length + 1}`, [vc]: Math.max(0, Math.round(last.value * 0.7)) }))
    setParams({ selected: table.rows.length })
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (drag.current == null) return
    const px = localPoint(svgRef.current!, e).x - m.left - cx
    const v = Math.max(0, Math.round((Math.abs(px) / (iw / 2)) * maxV))
    onTableChange!(updateRow(table, stages[drag.current].row, { [vc]: v }), true)
  }
  const onUp = () => { if (drag.current != null) { drag.current = null; onTableChange!(table, false) } }
  const label = (v: number) => (params.scale === 'percent' ? `${fmt((v / first) * 100, 1)}%` : fmt(v))

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`퍼널 차트: ${stages.length}단계, 최종 전환 ${fmt((stages[stages.length - 1].value / first) * 100, 1)}%`} tabIndex={editable ? 0 : undefined}
        onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => { hide(); linked?.set(null) }}
        onKeyDown={(e) => { if (editable && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); del() } }}>
        <g transform={`translate(${m.left},${m.top})`}>
          {params.shape === 'connected' && stages.slice(1).map((s, i) => {
            const a = stages[i]; const y0 = band(i)! + band.bandwidth(); const y1 = band(i + 1)!
            return <path key={`c${i}`} data-testid="funnel-link" d={`M${cx - half(a.value)},${y0}L${cx + half(a.value)},${y0}L${cx + half(s.value)},${y1}L${cx - half(s.value)},${y1}Z`} fill="#2a7d74" fillOpacity={0.12} />
          })}
          {stages.map((s, i) => {
            const mt = metrics[i]
            const on = params.selected === s.row || marked.has(s.row)
            const y = band(i)!; const h = band.bandwidth(); const w = half(s.value)
            return (
              <g key={s.row} data-testid="funnel-stage" data-row={s.row} data-value={s.value} data-conversion={mt.conversion == null ? '' : mt.conversion.toFixed(5)} data-inflow={mt.inflow ? '1' : undefined}
                onPointerEnter={compact ? undefined : (e) => { if (drag.current != null) return; linked?.set([s.row]); const p = localPoint(svgRef.current!, e); show(p.x, p.y, <><b>{s.name}</b><br />{fmt(s.value)} (첫 단계의 {fmt(mt.ofFirst * 100, 1)}%)<br />{mt.conversion != null ? (mt.inflow ? <>앞 단계보다 {fmt(s.value - stages[i - 1].value)} 많음 — 중간 유입</> : <>앞 단계 대비 {fmt(mt.conversion * 100, 1)}% 유지 · {fmt(mt.dropped!)} 이탈 ({fmt(mt.dropRate! * 100, 1)}%)</>) : '첫 단계'}{editable ? <><br />오른쪽 끝을 끌어 값 수정</> : null}</>) }}
                onPointerLeave={() => { hide(); linked?.set(null) }}
                onClick={compact ? undefined : () => setParams({ selected: params.selected === s.row ? -1 : s.row })} style={{ cursor: compact ? undefined : 'pointer' }}>
                <rect x={cx - w} y={y} width={Math.max(1, 2 * w)} height={h} rx={3} fill={mt.inflow ? '#e07a3f' : '#2a7d74'} fillOpacity={on ? 1 : 0.85} stroke={on ? '#121816' : 'none'} strokeWidth={2} />
                {!compact && <text className="bar-label" x={-10} y={y + h / 2} dy="0.32em" textAnchor="end">{s.name.length > 9 ? `${s.name.slice(0, 8)}…` : s.name}</text>}
                {!compact && w > 34 && <text x={cx} y={y + h / 2} dy="0.34em" textAnchor="middle" fill="#ffffff" fontWeight={600} fontSize={12} pointerEvents="none">{label(s.value)}</text>}
                {!compact && w <= 34 && <text className="bar-label" x={cx + w + 6} y={y + h / 2} dy="0.34em">{label(s.value)}</text>}
                {editable && <rect x={cx + w - 5} y={y} width={10} height={h} fill="transparent" style={{ cursor: 'ew-resize' }} data-testid="funnel-handle" onPointerDown={(e) => { e.stopPropagation(); svgRef.current!.setPointerCapture(e.pointerId); drag.current = i; setParams({ selected: s.row }); hide() }} />}
                {params.drops && !compact && mt.conversion != null && (
                  <text className="bar-label" x={iw + 12} y={y + h / 2} dy="0.32em" fill={mt.inflow ? '#c4631f' : '#5a6b66'}>
                    {mt.inflow ? `▲ 유입 +${fmt(s.value - stages[i - 1].value)}` : `${fmt(mt.conversion * 100, 1)}% 유지 · −${fmt(mt.dropped!)}`}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          <Readout items={[{ label: '단계', value: stages.length }, { label: '최종 전환', value: `${fmt((stages[stages.length - 1].value / first) * 100, 1)}%` }, { label: '총 이탈', value: fmt(lost) }]} />
          {inflow.length > 0 && <p className="chart-warning" role="status">‘{inflow.map((x) => x.name).join('’, ‘')}’ 단계는 앞 단계보다 값이 큽니다(주황). 중간에 새로 들어온 건이 있는 프로세스이므로 단계별 ‘전환율’이 100%를 넘어 순수한 퍼널이 아닙니다.</p>}
          {skipped > 0 && <p className="chart-warning" role="status" style={{ bottom: inflow.length ? 56 : 8 }}>이름이 없거나 값이 음수·누락인 {skipped}행은 제외했습니다.</p>}
          {editable && (
            <div className="chart-actions" style={{ bottom: 6, right: 8 }}>
              <button type="button" onClick={add} data-testid="funnel-add"><Plus size={14} aria-hidden="true" />단계 추가</button>
              {params.selected >= 0 && params.selected < table.rows.length && <button type="button" onClick={del} data-testid="funnel-delete"><Trash2 size={14} aria-hidden="true" />선택 삭제</button>}
            </div>
          )}
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function FunnelChartControls({ params, setParams, table, mapping }: ControlsProps<FunnelChartParams>) {
  const { stages } = useMemo(() => readStages(table, mapping), [table, mapping])
  const metrics = useMemo(() => funnelMetrics(stages), [stages])
  const worst = metrics.slice(1).filter((x) => !x.inflow).sort((a, b) => (a.conversion ?? 1) - (b.conversion ?? 1))[0]
  return (
    <>
      <ControlGroup title="표시">
        <Segmented label="막대 길이" value={params.scale} onChange={(scale) => setParams({ scale })} testId="ctl-funnel-scale" options={[{ value: 'absolute', label: '절댓값' }, { value: 'percent', label: '첫 단계 대비 %' }]} />
        <Hint>두 방식 모두 막대 길이는 같은 비율이고 숫자 표기만 다릅니다. 첫 단계를 100%로 보면 단계 간 비교가 쉽습니다.</Hint>
        <Segmented label="모양" value={params.shape} onChange={(shape) => setParams({ shape })} testId="ctl-funnel-shape" options={[{ value: 'bars', label: '막대' }, { value: 'connected', label: '연결' }]} />
        <Toggle label="단계별 유지율·이탈 표시" checked={params.drops} onChange={(drops) => setParams({ drops })} testId="ctl-funnel-drops" />
      </ControlGroup>
      {metrics.length > 1 && (
        <ControlGroup title="단계별 전환">
          <StatTable rows={metrics.slice(1).map((x) => [x.name, x.inflow ? `유입 +${fmt(stages[metrics.indexOf(x)].value - stages[metrics.indexOf(x) - 1].value)}` : `${fmt((x.conversion ?? 0) * 100, 1)}% (−${fmt(x.dropped ?? 0)})`])} />
          {worst && <Hint>가장 많이 빠져나가는 곳은 ‘{worst.name}’ 단계({fmt((worst.dropRate ?? 0) * 100, 1)}% 이탈)입니다.</Hint>}
          <Hint>퍼널은 값이 단계마다 줄기만 하는 경우에 맞는 그림입니다. 중간에 새로 들어오는 양이 있거나 단계를 건너뛰는 경로가 있으면 샌키 다이어그램 같은 흐름 그림이 더 정확합니다. 이 그림은 퍼널 플롯(메타분석)과 다른 그림입니다.</Hint>
        </ControlGroup>
      )}
    </>
  )
}

export const funnelChartModule: VizModule<FunnelChartParams> = {
  roles: [
    { key: 'stage', label: '단계', type: 'category', required: true },
    { key: 'value', label: '값 (인원·건수)', type: 'number', required: true },
  ],
  datasets: ['conversion', 'process-flow'],
  defaultParams: { scale: 'absolute', shape: 'connected', drops: true, selected: -1 },
  Chart: FunnelChartView,
  Controls: FunnelChartControls,
  hint: '막대 오른쪽 끝을 끌어 값 수정 · 단계 추가/삭제 · 앞 단계보다 커진 단계(주황)는 중간 유입 — 순수한 퍼널이 아닙니다',
}
