import * as d3 from 'd3'
import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useRef } from 'react'
import { ChartMessage, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, StatTable, Toggle } from '../../components/controls'
import { appendRow, removeRows, templateRow } from '../../data/table'
import { fmt } from '../../lib/format'
import { metaAnalysis, type MetaModel } from '../../stats/meta'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { EffectAxis } from './metaAxis'
import { readStudies, studyRoles, type EffectScale } from './metaShared'

export interface ForestParams {
  scale: EffectScale
  model: MetaModel
  sort: 'input' | 'effect' | 'weight'
  showWeights: boolean
  showPooled: boolean
  /** Selected table row, or −1. */
  selected: number
}

const NAME_W = 118
const TEXT_W = 172

function ForestChart({ table, mapping, params, setParams, width, height, compact, onTableChange, linked }: ChartProps<ForestParams>) {
  const { studies, skipped } = useMemo(() => readStudies(table, mapping, params.scale), [table, mapping, params.scale])
  const meta = useMemo(() => metaAnalysis(studies, params.model), [studies, params.model])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const log = params.scale === 'ratio'
  const back = (v: number) => (log ? Math.exp(v) : v)
  const rows = useMemo(() => {
    const r = studies.map((s, i) => ({ s, w: meta?.weights[i] ?? 0 }))
    if (params.sort === 'effect') r.sort((a, b) => a.s.effect - b.s.effect)
    else if (params.sort === 'weight') r.sort((a, b) => b.w - a.w)
    return r
  }, [studies, meta, params.sort])
  const marked = new Set(linked?.rows ?? [])
  const editable = !!onTableChange && !compact
  const effectCol = roleColumn(mapping, 'effect')

  if (!effectCol) return <ChartMessage>효과 크기(숫자형) 열을 선택하세요.</ChartMessage>
  if (!studies.length || !meta) return <ChartMessage>그릴 수 있는 연구가 없습니다.<small>효과 크기와 신뢰구간(또는 표준오차)이 필요하고, 비(ratio)는 0보다 커야 합니다.</small></ChartMessage>

  const nameW = compact ? 0 : Math.min(NAME_W, width * 0.22)
  const textW = compact ? 0 : width > 620 ? TEXT_W : 0
  const m = margins(compact, { left: nameW + 8, right: textW + 12, top: compact ? 8 : width < 520 ? 86 : 58, bottom: compact ? 10 : width < 520 ? 96 : 56 })
  const iw = Math.max(40, width - m.left - m.right)
  const lines = rows.length + (params.showPooled ? 1.6 : 0)
  const rowH = Math.max(compact ? 3 : 14, Math.min(30, (height - m.top - m.bottom) / lines))
  const ih = rowH * lines
  const lo = d3.min([...studies.map((s) => s.rawLo), back(meta.lo)].filter((v): v is number => v != null && (!log || v > 0)))!
  const hi = d3.max([...studies.map((s) => s.rawHi), back(meta.hi)])!
  const pad = log ? [lo / 1.15, hi * 1.15] : [lo - (hi - lo) * 0.06, hi + (hi - lo) * 0.06]
  const nullV = log ? 1 : 0
  const dom: [number, number] = [Math.min(pad[0], nullV), Math.max(pad[1], nullV)]
  const x = (log ? d3.scaleLog() : d3.scaleLinear()).domain(dom).range([0, iw]) as d3.ScaleContinuousNumeric<number, number>
  const wMax = d3.max(rows, (r) => r.w) || 1
  const half = (w: number) => (compact ? 2 : 3 + 6 * Math.sqrt(w / wMax))
  const label = log ? '효과 크기 (비, 로그 축)' : '효과 크기 (차이)'
  const del = () => { if (params.selected >= 0 && params.selected < table.rows.length) { onTableChange!(removeRows(table, [params.selected])); setParams({ selected: -1 }) } }
  const add = () => {
    const base = templateRow(table)
    const names = roleColumn(mapping, 'label')
    const e = back(meta.effect)
    const patch: Record<string, string | number> = { [effectCol]: Math.round(e * 1e3) / 1e3 }
    const lc = roleColumn(mapping, 'lo'); const hc = roleColumn(mapping, 'hi'); const sc = roleColumn(mapping, 'se')
    const se = 0.3
    if (lc) patch[lc] = Math.round(back(meta.effect - 1.96 * se) * 1e3) / 1e3
    if (hc) patch[hc] = Math.round(back(meta.effect + 1.96 * se) * 1e3) / 1e3
    if (sc) patch[sc] = se
    if (names) patch[names] = `연구 ${table.rows.length + 1}`
    onTableChange!(appendRow(table, { ...base, ...patch }))
    setParams({ selected: table.rows.length })
  }
  const textOf = (e: number, l: number, h: number) => `${fmt(e, 3)} [${fmt(l, 3)}, ${fmt(h, 3)}]`
  const py = rows.length * rowH + rowH * 0.8

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`포레스트 플롯: 연구 ${rows.length}개, 합동 효과 ${fmt(back(meta.effect), 3)}`} tabIndex={editable ? 0 : undefined} onPointerLeave={() => { hide(); linked?.set(null) }}
        onKeyDown={(e) => { if (editable && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); del() } }}>
        <g transform={`translate(${m.left},${m.top})`}>
          <EffectAxis scale={x} y={ih + 4} log={log} label={label} compact={compact} grid={ih} />
          <line className="ref-line" data-testid="forest-null" x1={x(nullV)} x2={x(nullV)} y1={-4} y2={ih + 4} stroke="#121816" strokeDasharray="4 3" />
          {!compact && <text className="bar-label" x={x(nullV)} y={-10} textAnchor="middle">효과 없음 ({nullV})</text>}
          {!compact && <text className="axis-label" x={-8} y={-10} textAnchor="end">연구</text>}
          {!compact && textW > 0 && <text className="axis-label" x={iw + 12} y={-10}>{log ? '비' : '차이'} [95% 신뢰구간]{params.showWeights ? ' · 가중치' : ''}</text>}
          {rows.map(({ s, w }, i) => {
            const cy = (i + 0.5) * rowH
            const on = params.selected === s.row || marked.has(s.row)
            const xl = Math.max(0, x(s.rawLo))
            const xr = Math.min(iw, x(s.rawHi))
            const sz = half(w)
            return (
              <g key={s.row} data-testid="forest-row" data-row={s.row} data-weight={w.toFixed(4)} className={on ? 'is-on' : ''}
                onPointerEnter={compact ? undefined : (e) => { linked?.set([s.row]); const p = localPoint(svgRef.current!, e); show(p.x, p.y, <><b>{s.name}</b><br />{fmt(s.raw, 3)} [{fmt(s.rawLo, 3)}, {fmt(s.rawHi, 3)}]<br />가중치 {fmt(w * 100, 1)}% ({params.model === 'random' ? '무작위효과' : '고정효과'})<br />표준오차 {fmt(s.se, 3)}{log ? ' (로그 척도)' : ''}</>) }}
                onPointerLeave={() => { hide(); linked?.set(null) }}
                onClick={compact ? undefined : () => setParams({ selected: params.selected === s.row ? -1 : s.row })} style={{ cursor: compact ? undefined : 'pointer' }}>
                <rect x={-m.left} y={cy - rowH / 2} width={width} height={rowH} fill={on ? '#fff3e8' : 'transparent'} />
                <line x1={xl} x2={xr} y1={cy} y2={cy} stroke="#121816" strokeWidth={on ? 2.2 : 1.3} />
                {x(s.rawLo) < 0 && <path d={`M0,${cy}l6,-3v6z`} fill="#121816" />}
                {x(s.rawHi) > iw && <path d={`M${iw},${cy}l-6,-3v6z`} fill="#121816" />}
                <rect data-testid="forest-box" x={x(s.raw) - sz} y={cy - sz} width={2 * sz} height={2 * sz} fill={on ? '#e07a3f' : '#2a7d74'} />
                {!compact && <text className="bar-label" x={-8} y={cy} dy="0.32em" textAnchor="end">{s.name.length > 14 ? `${s.name.slice(0, 13)}…` : s.name}</text>}
                {!compact && textW > 0 && rowH >= 13 && <text className="bar-label" x={iw + 12} y={cy} dy="0.32em">{textOf(s.raw, s.rawLo, s.rawHi)}{params.showWeights ? `  ${fmt(w * 100, 1)}%` : ''}</text>}
              </g>
            )
          })}
          {params.showPooled && (
            <g data-testid="forest-pooled" data-effect={back(meta.effect).toFixed(5)} data-lo={back(meta.lo).toFixed(5)} data-hi={back(meta.hi).toFixed(5)}
              onPointerEnter={compact ? undefined : (e) => { const p = localPoint(svgRef.current!, e); show(p.x, p.y, <><b>합동 효과 ({params.model === 'random' ? '무작위효과, DerSimonian–Laird' : '고정효과, 역분산 가중'})</b><br />{textOf(back(meta.effect), back(meta.lo), back(meta.hi))}<br />I² {fmt(meta.I2 * 100, 1)}% · τ² {fmt(meta.tau2, 3)} · Q p {fmt(meta.pQ, 3)}</>) }} onPointerLeave={hide}>
              <line x1={-m.left + 4} x2={iw + m.right - 4} y1={py - rowH * 0.75} y2={py - rowH * 0.75} stroke="#cfd6d3" />
              <path d={`M${x(back(meta.lo))},${py}L${x(back(meta.effect))},${py - rowH * 0.42}L${x(back(meta.hi))},${py}L${x(back(meta.effect))},${py + rowH * 0.42}Z`} fill="#121816" />
              {!compact && <text className="bar-label" x={-8} y={py} dy="0.32em" textAnchor="end" fontWeight={700}>합동</text>}
              {!compact && textW > 0 && <text className="bar-label" x={iw + 12} y={py} dy="0.32em" fontWeight={700}>{textOf(back(meta.effect), back(meta.lo), back(meta.hi))}</text>}
            </g>
          )}
        </g>
      </svg>
      {!compact && (
        <>
          <Readout items={[{ label: '연구', value: meta.k }, { label: '합동', value: fmt(back(meta.effect), 3) }, { label: 'I²', value: `${fmt(meta.I2 * 100, 1)}%` }, { label: 'p', value: meta.p < 0.001 ? '<0.001' : fmt(meta.p, 3) }]} />
          {skipped > 0 && <p className="chart-warning" role="status">{skipped}행은 효과 크기·신뢰구간(또는 표준오차)이 올바르지 않아 제외했습니다.</p>}
          {editable && (
            <div className="chart-actions" style={{ bottom: 6, right: 8 }}>
              <button type="button" onClick={add} data-testid="forest-add"><Plus size={14} aria-hidden="true" />연구 추가</button>
              {params.selected >= 0 && params.selected < table.rows.length && <button type="button" onClick={del} data-testid="forest-delete"><Trash2 size={14} aria-hidden="true" />선택 삭제</button>}
            </div>
          )}
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function ForestControls({ params, setParams, table, mapping }: ControlsProps<ForestParams>) {
  const { studies } = useMemo(() => readStudies(table, mapping, params.scale), [table, mapping, params.scale])
  const meta = useMemo(() => metaAnalysis(studies, params.model), [studies, params.model])
  const fixed = useMemo(() => metaAnalysis(studies, 'fixed'), [studies])
  const back = (v: number) => (params.scale === 'ratio' ? Math.exp(v) : v)
  return (
    <>
      <ControlGroup title="합동 추정">
        <Segmented label="모형" value={params.model} onChange={(model) => setParams({ model })} testId="ctl-model" options={[{ value: 'random', label: '무작위효과' }, { value: 'fixed', label: '고정효과' }]} />
        <Hint>{params.model === 'fixed' ? '모든 연구가 같은 참 효과를 잰다고 가정하고 가중치를 1/se²로 둡니다. 큰 연구가 결과를 거의 정합니다.' : '연구마다 참 효과가 조금씩 다르다고 보고 연구 간 분산 τ²(DerSimonian–Laird)을 더해 가중치 1/(se²+τ²)을 씁니다. 작은 연구의 영향이 커지고 신뢰구간이 넓어집니다.'}</Hint>
        <Segmented label="효과 크기의 종류" value={params.scale} onChange={(scale) => setParams({ scale })} testId="ctl-effect-scale" options={[{ value: 'ratio', label: '비 (OR·RR, 로그 축)' }, { value: 'difference', label: '차이 (평균차 등)' }]} />
        <Hint>비는 로그를 취해 합치고 로그 축에 그립니다(1이 효과 없음, 0.5와 2가 같은 거리). 차이는 선형 축에 그립니다(0이 효과 없음).</Hint>
      </ControlGroup>
      <ControlGroup title="표시">
        <Select label="정렬" value={params.sort} onChange={(sort) => setParams({ sort })} options={[{ value: 'input', label: '입력 순서' }, { value: 'effect', label: '효과 크기순' }, { value: 'weight', label: '가중치순' }]} />
        <Toggle label="가중치(%) 표시" checked={params.showWeights} onChange={(showWeights) => setParams({ showWeights })} />
        <Toggle label="합동 추정(마름모)" checked={params.showPooled} onChange={(showPooled) => setParams({ showPooled })} testId="ctl-pooled" />
      </ControlGroup>
      {meta && (
        <ControlGroup title="결과 요약">
          <StatTable rows={[
            ['합동 효과', `${fmt(back(meta.effect), 4)} [${fmt(back(meta.lo), 4)}, ${fmt(back(meta.hi), 4)}]`],
            ['z · p', `${fmt(meta.z, 3)} · ${meta.p < 0.001 ? '<0.001' : fmt(meta.p, 3)}`],
            ['Cochran Q', `${fmt(meta.Q, 3)} (df ${meta.df}, p ${fmt(meta.pQ, 3)})`],
            ['I² (이질성)', `${fmt(meta.I2 * 100, 1)}%`],
            ['τ² (연구 간 분산)', fmt(meta.tau2, 4)],
            ...(fixed && params.model === 'random' ? [['고정효과 합동', fmt(back(fixed.effect), 4)]] : []),
          ]} />
          <Hint>I²가 크면 연구 결과가 우연보다 더 많이 엇갈린다는 뜻이므로 하나의 합동값이 무엇을 대표하는지 신중히 보아야 합니다. 연구가 적을 때(특히 10개 미만) τ²와 I²는 매우 불안정합니다.</Hint>
        </ControlGroup>
      )}
    </>
  )
}

export const forestModule: VizModule<ForestParams> = {
  roles: studyRoles,
  datasets: ['studies', 'studies-biased'],
  defaultParams: { scale: 'ratio', model: 'random', sort: 'input', showWeights: true, showPooled: true, selected: -1 },
  Chart: ForestChart,
  Controls: ForestControls,
  hint: '연구를 클릭해 선택(Delete로 삭제) · ‘연구 추가’ · 고정/무작위효과 모형을 바꿔 합동 추정과 신뢰구간 변화 확인 · 표의 값을 고쳐도 즉시 다시 계산',
}
