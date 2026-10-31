import * as d3 from 'd3'
import { ArrowLeft } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { ChartMessage, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, StatTable } from '../../components/controls'
import { columnIndex, toLabel, toNumber, type DataTable } from '../../data/table'
import { fmt } from '../../lib/format'
import { buildFlame, flameLayout, flameMatches, type FlameBlock, type FlameRow } from '../../stats/process'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'

export interface FlameParams {
  /** Function path of the zoomed subtree (root-first); empty = the whole profile. */
  focus: string[]
  query: string
  colorBy: 'name' | 'self'
  direction: 'up' | 'down'
  rowHeight: number
}

export function readStacks(table: DataTable, mapping: Mapping) {
  const si = columnIndex(table, roleColumn(mapping, 'stack'))
  const vi = columnIndex(table, roleColumn(mapping, 'value'))
  const rows: FlameRow[] = []
  let skipped = 0
  if (si >= 0 && vi >= 0) table.rows.forEach((r, row) => {
    const v = toNumber(r[vi]); const s = toLabel(r[si])
    if (v == null || !(v > 0) || !s.trim()) { skipped++; return }
    rows.push({ stack: s, value: v, row })
  })
  return { rows, skipped }
}

const key = (b: FlameBlock) => b.node.path.join(';')

/** A warm colour that depends only on the function name, so the same function keeps its colour at every zoom level. */
function nameColor(name: string) {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619) >>> 0
  return d3.hsl(8 + (h % 44), 0.68 + ((h >>> 8) % 20) / 100, 0.58 + ((h >>> 16) % 12) / 100).formatHex()
}

function FlameChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<FlameParams>) {
  const { rows, skipped } = useMemo(() => readStacks(table, mapping), [table, mapping])
  const root = useMemo(() => buildFlame(rows), [rows])
  const { blocks, top } = useMemo(() => flameLayout(root, params.focus), [root, params.focus])
  const found = useMemo(() => flameMatches(blocks, params.query), [blocks, params.query])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<string | null>(null)
  const marked = new Set(linked?.rows ?? [])
  const maxDepth = d3.max(blocks, (b) => b.depth) ?? 0
  const m = margins(compact, compact ? { top: 4, bottom: 4, left: 4, right: 4 } : { top: 30, left: 12, right: 12, bottom: 30 })
  const iw = Math.max(40, width - m.left - m.right)
  const ih = Math.max(40, height - m.top - m.bottom)
  const fit = ih / (maxDepth + 1)
  const rowH = compact ? fit : Math.max(14, params.rowHeight > 0 ? Math.min(params.rowHeight, fit) : Math.min(40, fit))
  const selfMax = d3.max(blocks, (b) => (b.node.total ? b.node.self / b.node.total : 0)) || 1
  const query = params.query.trim()
  // The hovered stack: the hovered block, its callers up to the top, and everything it calls.
  const stack = hover ? hover.split(';') : null
  const inStack = (b: FlameBlock) => {
    if (!stack) return false
    const p = b.node.path
    const n = Math.min(p.length, stack.length)
    return p.slice(0, n).every((x, i) => x === stack[i])
  }

  if (!roleColumn(mapping, 'stack') || !roleColumn(mapping, 'value')) return <ChartMessage>호출 스택(범주형)과 표본 수(숫자형) 열을 선택하세요.</ChartMessage>
  if (!rows.length || root.total <= 0) return <ChartMessage>0보다 큰 표본 수가 있는 스택이 없습니다.<small>스택은 main;parse;lex 처럼 함수 이름을 ;로 이은 문자열입니다.</small></ChartMessage>

  const y = (d: number) => (params.direction === 'up' ? ih - (d + 1) * rowH : d * rowH)
  const total = root.total

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`플레임 그래프: 함수 ${blocks.length}개, 총 표본 ${total}`} onPointerLeave={() => { hide(); setHover(null); linked?.set(null) }}>
        <g transform={`translate(${m.left},${m.top})`}>
          {blocks.map((b) => {
            const w = (b.x1 - b.x0) * iw
            if (w < (compact ? 0.4 : 0.8)) return null
            const k = key(b)
            const match = found.has(k)
            const dim = (query && !match) || (stack && !inStack(b))
            const sel = stack && b.node.path.length === stack.length && inStack(b)
            const r = b.node.total ? b.node.self / b.node.total : 0
            const fill = params.colorBy === 'self' ? d3.interpolateOrRd(0.12 + 0.85 * (r / selfMax)) : nameColor(b.node.name)
            const linkedOn = b.node.rows.some((q) => marked.has(q))
            return (
              <g key={k} data-testid="flame-block" data-name={b.node.name} data-depth={b.depth} data-total={b.node.total} data-self={b.node.self} data-width={w.toFixed(2)} style={{ cursor: compact ? undefined : 'pointer' }}
                onPointerEnter={compact ? undefined : (e) => { setHover(k); linked?.set(b.node.rows); const p = localPoint(svgRef.current!, e); show(p.x, p.y, <><b>{b.node.name}</b><br />포함 비용 {fmt(b.node.total)} ({fmt((b.node.total / total) * 100, 1)}%)<br />자체 비용 {fmt(b.node.self)} ({fmt((b.node.self / total) * 100, 1)}%)<br /><small>{b.node.path.join(' → ') || '전체'}</small><br />클릭해 이 함수로 확대</>) }}
                onPointerLeave={() => { setHover(null); hide(); linked?.set(null) }}
                onClick={compact ? undefined : () => setParams({ focus: b.node.path })}>
                <rect x={b.x0 * iw} y={y(b.depth)} width={Math.max(0.5, w - 0.6)} height={rowH - 1} rx={1.5} fill={b.depth === 0 && !params.focus.length ? '#cfd6d3' : fill} fillOpacity={dim ? 0.28 : 1} stroke={sel || linkedOn ? '#121816' : match ? '#2f6fb3' : 'none'} strokeWidth={sel || linkedOn || match ? 2 : 0} />
                {!compact && w > 34 && <text x={b.x0 * iw + 4} y={y(b.depth) + rowH / 2 - 0.5} dy="0.34em" fontSize={11} fill="#121816" fillOpacity={dim ? 0.4 : 1} pointerEvents="none">{b.node.name.length * 6.2 > w - 8 ? `${b.node.name.slice(0, Math.max(1, Math.floor((w - 8) / 6.2) - 1))}…` : b.node.name}</text>}
              </g>
            )
          })}
          {!compact && <text className="axis-label" x={iw / 2} y={params.direction === 'up' ? ih + 22 : -12} textAnchor="middle">가로 = 포함 비용(표본 수) 비율 · 시간 순서가 아닙니다 · 세로 = 호출 깊이</text>}
        </g>
      </svg>
      {!compact && (
        <>
          <div className="chart-actions" style={{ top: 6, left: 8, bottom: 'auto', right: 'auto' }}>
            {params.focus.length > 0 && <button type="button" onClick={() => setParams({ focus: params.focus.slice(0, -1) })} data-testid="flame-back"><ArrowLeft size={14} aria-hidden="true" />위로</button>}
            <span data-testid="flame-crumb">{params.focus.length ? params.focus.join(' › ') : '전체'}</span>
            {params.focus.length > 0 && <button type="button" onClick={() => setParams({ focus: [] })} data-testid="flame-reset">처음으로</button>}
          </div>
          <Readout items={[{ label: '함수', value: blocks.length }, { label: '깊이', value: maxDepth + 1 }, { label: '표본', value: fmt(top.total) }, ...(query ? [{ label: `“${query}”`, value: `${found.size}곳` }] : [])]} />
          {skipped > 0 && <p className="chart-warning" role="status">값이 0 이하이거나 스택이 비어 있는 {skipped}행은 제외했습니다.</p>}
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function FlameControls({ params, setParams, table, mapping }: ControlsProps<FlameParams>) {
  const { rows } = useMemo(() => readStacks(table, mapping), [table, mapping])
  const root = useMemo(() => buildFlame(rows), [rows])
  const { blocks } = useMemo(() => flameLayout(root, []), [root])
  const heavy = useMemo(() => [...blocks].filter((b) => b.depth > 0).sort((a, b) => b.node.self - a.node.self).slice(0, 5), [blocks])
  return (
    <>
      <ControlGroup title="찾기와 보기">
        <div className="field number-field">
          <label htmlFor="flame-query">함수 이름 검색</label>
          <input id="flame-query" type="search" value={params.query} onChange={(e) => setParams({ query: e.target.value })} placeholder="예: render" data-testid="ctl-flame-query" />
        </div>
        <Hint>일치하는 모든 호출 위치가 파란 테두리로 표시되고 나머지는 흐려집니다. 같은 함수가 여러 경로에서 불려도 모두 찾습니다.</Hint>
        <Segmented label="방향" value={params.direction} onChange={(direction) => setParams({ direction })} testId="ctl-flame-dir" options={[{ value: 'up', label: '불꽃 (아래→위)' }, { value: 'down', label: '고드름 (위→아래)' }]} />
        <Segmented label="색" value={params.colorBy} onChange={(colorBy) => setParams({ colorBy })} testId="ctl-flame-color" options={[{ value: 'name', label: '함수 이름' }, { value: 'self', label: '자체 비용 비율' }]} />
        <Slider label="행 높이" value={params.rowHeight} min={0} max={34} onChange={(rowHeight) => setParams({ rowHeight })} format={(v) => (v === 0 ? '자동' : `${v}px`)} />
        <Hint>블록을 클릭하면 그 함수가 전체 너비가 되도록 확대되고 ‘위로’로 돌아옵니다. 포인터를 올리면 그 호출 스택(호출한 쪽과 호출된 쪽)이 강조됩니다. 가로 순서는 시간이 아니라 이름 순이며, 같은 스택의 호출은 모두 합쳐져 있습니다.</Hint>
      </ControlGroup>
      {heavy.length > 0 && (
        <ControlGroup title="자체 비용이 큰 함수">
          <StatTable rows={heavy.map((b) => [b.node.name, `${fmt(b.node.self)} (${fmt((b.node.self / root.total) * 100, 1)}%)`])} />
          <Hint>‘자체 비용’은 다른 함수를 부르지 않고 그 함수 안에서 쓴 비용입니다. 포함 비용이 커도 자체 비용이 작으면 병목은 더 아래 함수에 있습니다.</Hint>
        </ControlGroup>
      )}
    </>
  )
}

export const flameModule: VizModule<FlameParams> = {
  roles: [
    { key: 'stack', label: '호출 스택 (a;b;c)', type: 'category', required: true },
    { key: 'value', label: '표본 수 (비용)', type: 'number', required: true },
  ],
  datasets: ['profile'],
  defaultParams: { focus: [], query: '', colorBy: 'name', direction: 'up', rowHeight: 0 },
  Chart: FlameChart,
  Controls: FlameControls,
  hint: '블록을 클릭해 확대 · ‘위로’로 복귀 · 함수 이름 검색 · 포인터를 올려 호출 스택 강조 · 가로 순서는 시간이 아닙니다',
}
