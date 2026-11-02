import * as d3 from 'd3'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber } from '../../data/table'
import { categoryColor, schemes } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { excentricLabels, lineUp, splatter, unitLayout, zameBlocks, zameBuild, zameRefine, type LabelItem, type UnitLeaf, type UnitRecord } from '../../stats/info10'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'

// ───────────────────────────── ZAME ─────────────────────────────

export interface ZameParams { cells: number; frontier: number[]; measure: 'density' | 'count'; selBlock: string }

function useZame(table: ChartProps<ZameParams>['table'], mapping: ChartProps<ZameParams>['mapping']) {
  return useMemo(() => {
    const ai = columnIndex(table, roleColumn(mapping, 'a')), bi = columnIndex(table, roleColumn(mapping, 'b')), wi = columnIndex(table, roleColumn(mapping, 'weight'))
    if (ai < 0 || bi < 0) return null
    const ids = new Map<string, number>(), names: string[] = []
    const id = (s: string) => { let k = ids.get(s); if (k == null) { k = names.length; ids.set(s, k); names.push(s) } return k }
    const edges: [number, number, number][] = [], rowOf: number[] = []
    table.rows.forEach((r, i) => { const a = toLabel(r[ai]), b = toLabel(r[bi]); if (!a || !b) return; edges.push([id(a), id(b), wi >= 0 ? Math.max(0, toNumber(r[wi]) ?? 1) || 1 : 1]); rowOf.push(i) })
    if (names.length < 3) return null
    return { names, edges, rowOf, model: zameBuild(names.length, edges) }
  }, [table, mapping])
}

const MAX_CELLS = 90

function ZameChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<ZameParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const data = useZame(table, mapping)
  if (!data) return <ChartMessage>노드 A, 노드 B(범주형) 열을 고르세요. 한 행이 간선 하나여야 합니다.</ChartMessage>
  const m = data.model
  const frontier = params.frontier.length && params.frontier.every((id) => id < m.nodes.length) ? params.frontier : zameRefine(m, [...m.nodes[m.root].children], Math.min(MAX_CELLS, params.cells))
  const blocks = zameBlocks(m, frontier)
  const K = frontier.length
  const pad = compact ? 4 : 36
  const side = Math.min(width, height) - pad - (compact ? 4 : 14)
  const sizes = frontier.map((id) => m.nodes[id].hi - m.nodes[id].lo)
  const start = sizes.reduce<number[]>((a, s) => [...a, a[a.length - 1] + s], [0])
  const px = (i: number) => (start[i] / m.n) * side
  const maxD = Math.max(1e-9, ...blocks.map((b) => (params.measure === 'density' ? b.density : b.sum)))
  const ramp = schemes.teal.interpolate
  const ox = pad, oy = pad - (compact ? 0 : 10)
  const sel = params.selBlock
  const cellRows = (a: number, b: number) => {
    const inA = new Set<number>(), inB = new Set<number>()
    for (let i = m.nodes[frontier[a]].lo; i < m.nodes[frontier[a]].hi; i++) inA.add(m.order[i])
    for (let i = m.nodes[frontier[b]].lo; i < m.nodes[frontier[b]].hi; i++) inB.add(m.order[i])
    return data.edges.map((e, i) => ((inA.has(e[0]) && inB.has(e[1])) || (inA.has(e[1]) && inB.has(e[0])) ? data.rowOf[i] : -1)).filter((r) => r >= 0)
  }
  const expand = (i: number) => {
    const nd = m.nodes[frontier[i]]
    if (!nd.children.length || K - 1 + nd.children.length > 160) return
    setParams({ frontier: [...frontier.slice(0, i), ...nd.children, ...frontier.slice(i + 1)] })
  }
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`ZAME: 노드 ${m.n}개, 간선 ${data.edges.length}개를 ${K}×${K} 칸으로 집계`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${ox},${oy})`}>
          <rect width={side} height={side} fill="#f7f9f9" stroke="#dbe3e3" />
          {blocks.map((b) => [b, b.a === b.b ? null : { ...b, a: b.b, b: b.a }].map((bl) => bl && (
            <rect key={`${bl.a}-${bl.b}`} x={px(bl.b)} y={px(bl.a)} width={Math.max(0.6, (sizes[bl.b] / m.n) * side - (K > 60 ? 0 : 0.5))} height={Math.max(0.6, (sizes[bl.a] / m.n) * side - (K > 60 ? 0 : 0.5))}
              fill={bl.sum > 0 ? ramp(0.1 + 0.9 * Math.sqrt(Math.min(1, (params.measure === 'density' ? bl.density : bl.sum) / maxD))) : '#f1f4f4'} stroke={sel === `${Math.min(bl.a, bl.b)}-${Math.max(bl.a, bl.b)}` ? '#d4452f' : 'none'} strokeWidth={1.6} data-testid="zame-cell" data-sum={bl.sum} data-a={bl.a} data-b={bl.b}
              style={{ cursor: compact ? undefined : 'pointer' }}
              onClick={compact ? undefined : () => { const key = `${Math.min(bl.a, bl.b)}-${Math.max(bl.a, bl.b)}`; setParams({ selBlock: sel === key ? '' : key }) }}
              onPointerEnter={compact ? undefined : (e) => { linked?.set(cellRows(bl.a, bl.b)); const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>클러스터 {bl.a + 1} × {bl.b + 1}</b><br />노드 {sizes[bl.a]}개 × {sizes[bl.b]}개<br />간선 가중치 합 {fmt(bl.sum, 4)} · 밀도 {fmt(bl.density, 3)}</>) }} onPointerLeave={() => { linked?.set(null); hide() }} />
          )))}
          {!compact && frontier.map((id, i) => (
            <g key={id} data-testid="zame-header" data-size={sizes[i]} style={{ cursor: sizes[i] > 1 ? 'pointer' : 'default' }} onClick={() => expand(i)}>
              <rect x={px(i)} y={-9} width={Math.max(1, (sizes[i] / m.n) * side - 1)} height={7} fill={m.nodes[id].children.length ? '#9aa6a6' : '#dbe3e3'} rx={1}><title>{`클러스터 ${i + 1} (노드 ${sizes[i]}개) — 눌러 펼치기`}</title></rect>
              <rect x={-9} y={px(i)} width={7} height={Math.max(1, (sizes[i] / m.n) * side - 1)} fill={m.nodes[id].children.length ? '#9aa6a6' : '#dbe3e3'} rx={1} />
            </g>
          ))}
        </g>
        {!compact && <text x={12} y={height - 6} fontSize={11} fill="#6b7280" data-testid="zame-readout">{K}×{K} 칸 · 노드 {m.n}개 · 간선 {data.edges.length}개 · 위·왼쪽 막대를 눌러 클러스터를 펼칩니다</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function ZameControls({ params, setParams, table, mapping }: ControlsProps<ZameParams>) {
  const data = useZame(table, mapping)
  return (
    <ControlGroup title="해상도와 집계">
      <Slider label="목표 칸 수 (가장 큰 클러스터부터 펼침)" value={Math.min(MAX_CELLS, params.cells)} min={3} max={MAX_CELLS} onChange={(cells) => setParams({ cells, frontier: [], selBlock: '' })} testId="ctl-cells" />
      <Segmented label="색이 나타내는 값" value={params.measure} onChange={(measure) => setParams({ measure })} options={[{ value: 'density', label: '밀도(가능한 쌍 대비)' }, { value: 'count', label: '간선 가중치 합' }]} testId="ctl-measure" />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ frontier: [], selBlock: '' })} data-testid="zame-reset">처음 해상도로</button>
      {data && <p className="hint" data-testid="zame-stats">노드 {data.model.n}개 · 간선 {data.edges.length}개 · 공동체 {data.model.nodes[data.model.root].children.length}개</p>}
      <Hint>인접 행렬의 행·열을 공동체와 너비 우선 순서로 정렬한 뒤, 이진 클러스터 트리로 묶어 클러스터 쌍마다 칸 하나로 집계합니다. 칸의 색은 두 클러스터 사이의 간선이 가능한 쌍에 비해 얼마나 촘촘한지(밀도) 또는 가중치 합입니다. 위·왼쪽 막대를 눌러 클러스터를 두 개로 펼치면 그 부분만 더 세밀해지고, 끝까지 펼치면 원래의 인접 행렬이 됩니다. 칸에 올리면 그 칸에 속한 간선 행이 연동 강조됩니다. 이 구현은 ZAME의 핵심(다중 스케일 집계 + 확대로 원본 복원)을 구현하며, 대규모 그래프용 해상도별 사전 계산·글리프 칸(분포 표시)은 쓰지 않습니다.</Hint>
    </ControlGroup>
  )
}

export const zameModule: VizModule<ZameParams> = {
  roles: [
    { key: 'a', label: '노드 A', type: 'category', required: true, prefer: '노드 A|출발|source' },
    { key: 'b', label: '노드 B', type: 'category', required: true, prefer: '노드 B|도착|target' },
    { key: 'weight', label: '가중치', type: 'number', auto: true, prefer: '가중치|weight' },
  ],
  datasets: ['modular-graph'],
  defaultParams: { cells: 16, frontier: [], measure: 'density', selBlock: '' },
  Chart: ZameChart,
  Controls: ZameControls,
  hint: '위·왼쪽 막대를 눌러 클러스터를 펼칩니다 · 칸에 올리면 그 칸의 간선이 연동 강조됩니다',
}

// ───────────────────────────── Excentric labeling ─────────────────────────────

export interface ExcentricParams { radius: number; maxLabels: number; lens: boolean }

function ExcentricChart({ table, mapping, params, width, height, compact, linked }: ChartProps<ExcentricParams>) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [cursor, setCursor] = useState<[number, number] | null>(null)
  const pts = useMemo(() => {
    const li = columnIndex(table, roleColumn(mapping, 'label')), xi = columnIndex(table, roleColumn(mapping, 'x')), yi = columnIndex(table, roleColumn(mapping, 'y')), gi = columnIndex(table, roleColumn(mapping, 'group'))
    if (xi < 0 || yi < 0) return null
    const out: { row: number; label: string; x: number; y: number; g: string }[] = []
    table.rows.forEach((r, row) => { const x = toNumber(r[xi]), y = toNumber(r[yi]); if (x != null && y != null) out.push({ row, label: li >= 0 ? toLabel(r[li]) : `점 ${row + 1}`, x, y, g: gi >= 0 ? toLabel(r[gi]) : '' }) })
    return out.length ? out : null
  }, [table, mapping])
  if (!pts) return <ChartMessage>x, y(숫자) 열과 이름 열을 고르세요.</ChartMessage>
  const pad = compact ? 6 : 28
  const ex = d3.extent(pts, (p) => p.x) as [number, number], ey = d3.extent(pts, (p) => p.y) as [number, number]
  const sx = d3.scaleLinear().domain(ex).range([pad, width - pad]), sy = d3.scaleLinear().domain(ey).range([height - pad, pad])
  const groups = [...new Set(pts.map((p) => p.g))]
  const color = categoryColor(groups)
  const px: LabelItem[] = pts.map((p, i) => ({ index: i, x: sx(p.x), y: sy(p.y), text: p.label }))
  const lens = cursor && !compact ? excentricLabels(px, cursor, params.radius, { maxLabels: params.maxLabels, labelH: 15, labelW: (t) => t.length * 7.2 + 8, gap: 16, bounds: [width, height] }) : null
  const onMove = (e: PointerEvent) => { if (!svgRef.current || compact) return; const p = localPoint(svgRef.current, e); setCursor([p.x, p.y]) }
  const inside = new Set(lens?.inside.map((p) => p.index) ?? [])
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Excentric Labeling: 점 ${pts.length}개`} style={{ touchAction: 'none' }} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => { setCursor(null); linked?.set(null) }}>
        <rect x={pad} y={pad} width={width - 2 * pad} height={height - 2 * pad} fill="#fafcfc" stroke="#e5eaea" />
        {pts.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={inside.has(i) ? 3.8 : compact ? 1.6 : 2.4} fill={color(p.g)} fillOpacity={inside.has(i) ? 1 : 0.55} stroke={inside.has(i) ? '#1f2937' : 'none'} strokeWidth={0.8} data-testid="ex-point" />)}
        {cursor && lens && (
          <g pointerEvents="none" data-testid="ex-lens">
            <circle cx={cursor[0]} cy={cursor[1]} r={params.radius} fill="#2a8c82" fillOpacity={0.06} stroke="#2a8c82" strokeWidth={1.2} />
            {lens.placed.map((l) => (
              <g key={l.index} data-testid="ex-label">
                <polyline points={`${l.x},${l.y} ${l.side === 'right' ? cursor[0] + params.radius : cursor[0] - params.radius},${l.anchor[1]} ${l.anchor[0]},${l.anchor[1]}`} fill="none" stroke="#6b7280" strokeWidth={0.8} />
                <rect x={l.box[0]} y={l.box[1]} width={l.box[2]} height={l.box[3] - 1} rx={2} fill="#fff" stroke="#b6bec4" strokeWidth={0.8} />
                <text x={l.box[0] + 4} y={l.box[1] + l.box[3] / 2 + 3.5} fontSize={11} fill="#1f2937">{l.text}</text>
              </g>
            ))}
          </g>
        )}
        {!compact && <text x={pad} y={height - 8} fontSize={11} fill="#6b7280" data-testid="ex-readout">{lens ? `원 안의 점 ${lens.inside.length}개 중 ${lens.placed.length}개에 이름 표시${lens.hidden ? ` (가까운 순, ${lens.hidden}개 생략)` : ''}` : '마우스를 올리거나 화면을 눌러 주변 점의 이름을 봅니다'}</text>}
      </svg>
    </div>
  )
}

function ExcentricControls({ params, setParams }: ControlsProps<ExcentricParams>) {
  return (
    <ControlGroup title="렌즈">
      <Slider label="원(주변)의 반지름 (픽셀)" value={params.radius} min={20} max={160} onChange={(radius) => setParams({ radius })} testId="ctl-radius" />
      <Slider label="한 번에 붙일 이름 수" value={params.maxLabels} min={3} max={24} onChange={(maxLabels) => setParams({ maxLabels })} testId="ctl-maxlabels" />
      <Hint>커서 둘레의 원 안에 있는 점들의 이름만 원 양옆에 두 줄로 쌓아 보여 줍니다. 이름은 점의 높이 순서로 놓고 서로 겹치지 않게 세로 간격을 두어, 점에서 이름까지의 지시선이 교차하지 않습니다. 원 안의 점이 많으면 커서에 가까운 점부터 최대 개수만큼만 붙입니다. 점 위치와 모양은 바뀌지 않고 이름만 동적으로 붙으므로 점이 수백 개여도 읽을 수 있습니다. 이 구현은 원 논문의 라벨 정렬·병합 외에 지시선 모양 개선(곡선), 라벨 크기 조절은 하지 않습니다.</Hint>
    </ControlGroup>
  )
}

export const excentricModule: VizModule<ExcentricParams> = {
  roles: [
    { key: 'label', label: '이름', type: 'category', auto: true, prefer: '이름|name' },
    { key: 'x', label: 'x', type: 'number', required: true, prefer: '^x' },
    { key: 'y', label: 'y', type: 'number', required: true, prefer: '^y' },
    { key: 'group', label: '분류(색)', type: 'category', auto: true, prefer: '분류|group' },
  ],
  datasets: ['label-points'],
  defaultParams: { radius: 70, maxLabels: 10, lens: true },
  Chart: ExcentricChart,
  Controls: ExcentricControls,
  hint: '마우스를 올리면(터치는 누르기) 주변 점의 이름이 두 줄로 나타납니다 · 반지름과 이름 수를 조절',
}

// ───────────────────────────── LineUp ─────────────────────────────

export interface LineUpParams { weights: number[]; invert: boolean[]; sortBy: number; selected: number }

function readLineUp(table: ChartProps<LineUpParams>['table'], mapping: ChartProps<LineUpParams>['mapping']) {
  const cols = roleColumns(mapping, 'attrs')
  const ci = cols.map((c) => columnIndex(table, c))
  const li = columnIndex(table, roleColumn(mapping, 'label'))
  if (cols.length < 2 || ci.some((i) => i < 0)) return null
  const rows: number[] = [], vals: number[][] = [], names: string[] = []
  table.rows.forEach((r, i) => { const v = ci.map((c) => toNumber(r[c])); if (v.every((x) => x != null)) { rows.push(i); vals.push(v as number[]); names.push(li >= 0 ? toLabel(r[li]) : `행 ${i + 1}`) } })
  return vals.length >= 2 ? { cols, rows, vals, names } : null
}

function LineUpChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<LineUpParams>) {
  const data = useMemo(() => readLineUp(table, mapping), [table, mapping])
  if (!data) return <ChartMessage>이름 열과 지표(숫자) 열 2개 이상을 고르세요.</ChartMessage>
  const k = data.cols.length
  const weights = params.weights.length === k ? params.weights : data.cols.map(() => 1)
  const invert = params.invert.length === k ? params.invert : data.cols.map((c) => /학생 수|비율|오류|지연|cost|비용/.test(c))
  const ranked = lineUp(data.vals, data.cols.map((name, j) => ({ name, weight: weights[j], invert: invert[j] })), params.sortBy >= 0 && params.sortBy < k ? params.sortBy : 'score')
  const color = categoryColor(data.cols)
  const top = compact ? 4 : 52, left = compact ? 4 : 34, nameW = compact ? 0 : Math.min(120, width * 0.2)
  const rowH = Math.max(compact ? 2.5 : 8, Math.min(26, (height - top - 8) / ranked.length))
  const scoreW = Math.min(240, (width - left - nameW) * 0.4), colW = (width - left - nameW - scoreW - 16) / k
  const lo = data.cols.map((_, j) => Math.min(...data.vals.map((r) => r[j]))), hi = data.cols.map((_, j) => Math.max(...data.vals.map((r) => r[j])))
  return (
    <div className="chart-root">
      <svg width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`LineUp: 대상 ${ranked.length}개, 지표 ${k}개의 가중 순위`}>
        {!compact && (
          <g data-testid="lineup-header">
            <text x={left} y={top - 28} fontSize={11} fontWeight={600} fill="#374151" onClick={() => setParams({ sortBy: -1 })} style={{ cursor: 'pointer' }}>점수(가중 합)</text>
            <g transform={`translate(${left + nameW},${top - 22})`}>{data.cols.map((c, j) => <rect key={c} x={(weights[j] > 0 ? 0 : 0) + (scoreW * (weights.slice(0, j).reduce((a, b) => a + Math.max(0, b), 0))) / Math.max(1e-9, weights.reduce((a, b) => a + Math.max(0, b), 0))} width={(scoreW * Math.max(0, weights[j])) / Math.max(1e-9, weights.reduce((a, b) => a + Math.max(0, b), 0))} height={8} fill={color(c)} />)}</g>
            {data.cols.map((c, j) => (
              <g key={c} transform={`translate(${left + nameW + scoreW + 16 + j * colW},${top - 30})`} style={{ cursor: 'pointer' }} onClick={() => setParams({ sortBy: params.sortBy === j ? -1 : j })} data-testid={`lineup-col-${j}`}>
                <text fontSize={11} fontWeight={600} fill={color(c)} y={0}>{c.length > 6 ? c.slice(0, 6) + '…' : c}{invert[j] ? ' ↓' : ''}{params.sortBy === j ? ' ▼' : ''}</text>
                <text fontSize={10} fill="#6b7280" y={13}>가중치 {weights[j].toFixed(1)}</text>
              </g>
            ))}
          </g>
        )}
        {ranked.map((r, i) => {
          const y = top + i * rowH
          const hot = params.selected === r.index
          const marked = linked?.rows.includes(data.rows[r.index]) ?? false
          return (
            <g key={r.index} data-testid="lineup-row" data-rank={r.rank} data-index={r.index} style={{ cursor: compact ? undefined : 'pointer' }} onClick={compact ? undefined : () => setParams({ selected: hot ? -1 : r.index })}
              onPointerEnter={() => linked?.set([data.rows[r.index]])} onPointerLeave={() => linked?.set(null)}>
              {(hot || marked) && <rect x={0} y={y - 1} width={width} height={rowH} fill="#fde8e4" />}
              {!compact && rowH >= 9 && <text x={left - 6} y={y + rowH / 2} dy="0.34em" textAnchor="end" fontSize={Math.min(11, rowH - 1)} fill="#6b7280">{r.rank}</text>}
              {!compact && rowH >= 9 && <text x={left} y={y + rowH / 2} dy="0.34em" fontSize={Math.min(11, rowH - 1)} fill="#1f2937">{data.names[r.index].slice(0, 12)}</text>}
              {(() => { let x = left + nameW; return r.parts.map((p, j) => { const w = p * scoreW; const el = <rect key={j} x={x} y={y + 1} width={Math.max(0, w)} height={Math.max(1, rowH - 2.5)} fill={color(data.cols[j])} data-testid="lineup-part" />; x += w; return el }) })()}
              {data.cols.map((c, j) => { const t = hi[j] > lo[j] ? (data.vals[r.index][j] - lo[j]) / (hi[j] - lo[j]) : 0.5; return <rect key={c} x={left + nameW + scoreW + 16 + j * colW} y={y + 1} width={Math.max(0.5, (invert[j] ? 1 - t : t) * (colW - 6))} height={Math.max(1, rowH - 2.5)} fill={color(c)} opacity={weights[j] > 0 ? 0.55 : 0.18} /> })}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function LineUpControls({ params, setParams, table, mapping }: ControlsProps<LineUpParams>) {
  const data = useMemo(() => readLineUp(table, mapping), [table, mapping])
  if (!data) return null
  const k = data.cols.length
  const weights = params.weights.length === k ? params.weights : data.cols.map(() => 1)
  const invert = params.invert.length === k ? params.invert : data.cols.map((c) => /학생 수|비율|오류|지연|cost|비용/.test(c))
  const color = categoryColor(data.cols)
  return (
    <ControlGroup title="지표의 가중치">
      {data.cols.map((c, j) => (
        <div key={c} className="field">
          <Slider label={c} value={weights[j]} min={0} max={4} step={0.1} onChange={(v) => setParams({ weights: weights.map((w, i) => (i === j ? v : w)), invert })} format={(v) => v.toFixed(1)} testId={`ctl-weight-${j}`} />
          <Toggle label="낮을수록 좋음(뒤집기)" checked={invert[j]} onChange={(v) => setParams({ invert: invert.map((x, i) => (i === j ? v : x)), weights })} testId={`ctl-invert-${j}`} />
          <span className="hint" style={{ color: color(c) }}>●</span>
        </div>
      ))}
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ weights: [], invert: [], sortBy: -1, selected: -1 })} data-testid="lineup-reset">초기화</button>
      <Hint>대상마다 지표를 0~1로 맞춰(‘낮을수록 좋음’은 뒤집어) 가중치만큼 이어 붙인 한 개의 쌓인 막대가 점수이고, 막대의 색 구간이 어느 지표가 점수에 얼마나 기여했는지입니다. 가중치를 바꾸면 순위가 즉시 다시 계산되고, 지표 머리글을 누르면 그 지표 하나로 정렬합니다. 지표 열의 연한 막대는 각 대상의 원래 값(0~1 비율)입니다. 이 구현은 LineUp의 핵심(쌓인 막대 점수 + 가중치 조절 + 열 정렬)만 구현하며, 순위 변화 기울기 그래프·여러 순위 비교·그룹 순위는 구현하지 않았습니다.</Hint>
    </ControlGroup>
  )
}

export const lineUpModule: VizModule<LineUpParams> = {
  roles: [
    { key: 'label', label: '이름', type: 'category', auto: true, prefer: '대학|이름|name' },
    { key: 'attrs', label: '지표 (숫자 열)', type: 'number', required: true, multiple: { min: 2, max: 8 } },
  ],
  datasets: ['univ-ranking'],
  defaultParams: { weights: [], invert: [], sortBy: -1, selected: -1 },
  Chart: LineUpChart,
  Controls: LineUpControls,
  hint: '가중치 슬라이더로 순위가 어떻게 바뀌는지 봅니다 · 지표 머리글을 눌러 그 지표로 정렬',
}

// ───────────────────────────── Unit visualization ─────────────────────────────

export interface UnitParams { leaf: UnitLeaf; splits: 1 | 2; colorBy: 'value' | 'split'; selected: number }

function UnitChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<UnitParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const data = useMemo(() => {
    const li = columnIndex(table, roleColumn(mapping, 'label')), a = columnIndex(table, roleColumn(mapping, 'split1')), b = columnIndex(table, roleColumn(mapping, 'split2')), vi = columnIndex(table, roleColumn(mapping, 'value'))
    if (a < 0) return null
    const recs: UnitRecord[] = [], names: string[] = []
    table.rows.forEach((r, i) => { recs.push({ id: i, cats: [toLabel(r[a]), b >= 0 ? toLabel(r[b]) : ''], value: vi >= 0 ? toNumber(r[vi]) ?? 0 : 0 }); names.push(li >= 0 ? toLabel(r[li]) : `레코드 ${i + 1}`) })
    return recs.length ? { recs, names, hasValue: vi >= 0, hasSplit2: b >= 0 } : null
  }, [table, mapping])
  if (!data) return <ChartMessage>나눌 범주 열(부서 등)을 하나 이상 고르세요.</ChartMessage>
  const pad = compact ? 4 : 30
  const splits = data.hasSplit2 ? params.splits : 1
  const L = unitLayout(data.recs, splits, params.leaf, width - 2 * pad, height - 2 * pad - (compact ? 0 : 6))
  const vmax = Math.max(1, ...data.recs.map((r) => r.value)), vmin = Math.min(...data.recs.map((r) => r.value))
  const keys = [...new Set(data.recs.map((r) => r.cats[0]))].sort((x, y) => x.localeCompare(y, 'ko'))
  const catColor = categoryColor(keys)
  const ramp = schemes.viridis.interpolate
  const fillOf = (id: number) => (params.colorBy === 'value' && data.hasValue ? ramp(0.1 + 0.85 * ((data.recs[id].value - vmin) / Math.max(1e-9, vmax - vmin))) : catColor(data.recs[id].cats[0]))
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`단위 시각화: 레코드 ${data.recs.length}개를 단위 하나씩`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${pad},${pad})`}>
          {L.cells.map((c) => (
            <g key={c.key} data-testid="unit-cell" data-count={c.count}>
              <rect x={c.x} y={c.y} width={c.w} height={c.h} fill="#fafcfc" stroke="#e5eaea" />
              {!compact && <text x={c.x + 3} y={c.y - 4} fontSize={10} fill="#6b7280">{c.key.split('/').filter(Boolean).join(' · ')} ({c.count})</text>}
            </g>
          ))}
          {L.marks.map((m) => {
            const hot = params.selected === m.id || (linked?.rows.includes(m.id) ?? false)
            return params.leaf === 'grid'
              ? <rect key={m.id} x={m.x - m.r} y={m.y - m.r} width={2 * m.r} height={2 * m.r} rx={m.r * 0.2} fill={fillOf(m.id)} stroke={hot ? '#d4452f' : 'none'} strokeWidth={1.6} data-testid="unit-mark" style={{ cursor: compact ? undefined : 'pointer' }}
                onClick={compact ? undefined : () => setParams({ selected: params.selected === m.id ? -1 : m.id })} onPointerEnter={(e) => { linked?.set([m.id]); if (!compact) { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{data.names[m.id]}</b><br />{data.recs[m.id].cats.filter(Boolean).join(' · ')}{data.hasValue ? <><br />값 {fmt(data.recs[m.id].value, 3)}</> : null}</>) } }} onPointerLeave={() => { linked?.set(null); hide() }} />
              : <circle key={m.id} cx={m.x} cy={m.y} r={m.r} fill={fillOf(m.id)} stroke={hot ? '#d4452f' : '#fff'} strokeWidth={hot ? 1.8 : 0.5} data-testid="unit-mark" style={{ cursor: compact ? undefined : 'pointer' }}
                onClick={compact ? undefined : () => setParams({ selected: params.selected === m.id ? -1 : m.id })} onPointerEnter={(e) => { linked?.set([m.id]); if (!compact) { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{data.names[m.id]}</b><br />{data.recs[m.id].cats.filter(Boolean).join(' · ')}{data.hasValue ? <><br />값 {fmt(data.recs[m.id].value, 3)}</> : null}</>) } }} onPointerLeave={() => { linked?.set(null); hide() }} />
          })}
        </g>
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function UnitControls({ params, setParams, table, mapping }: ControlsProps<UnitParams>) {
  const has2 = columnIndex(table, roleColumn(mapping, 'split2')) >= 0
  const hasV = columnIndex(table, roleColumn(mapping, 'value')) >= 0
  return (
    <ControlGroup title="나누기와 단위 배치">
      <Segmented label="단위를 놓는 방식" value={params.leaf} onChange={(leaf) => setParams({ leaf })} testId="ctl-leaf" options={[{ value: 'grid', label: '격자(와플)' }, { value: 'dodge', label: '값 쌓기(점도표)' }, { value: 'pack', label: '원 채우기' }, { value: 'jitter', label: '흩뿌리기' }]} />
      <Segmented label="나누는 단계" value={String(params.splits)} onChange={(v) => setParams({ splits: Number(v) as 1 | 2 })} testId="ctl-splits" options={[{ value: '1', label: '한 단계' }, { value: '2', label: '두 단계' }]} />
      <Segmented label="색" value={params.colorBy} onChange={(colorBy) => setParams({ colorBy })} testId="ctl-colorby" options={[{ value: 'split', label: '첫 번째 분류' }, { value: 'value', label: '값(연속)' }]} />
      {!has2 && params.splits === 2 && <Hint>두 번째 분류 열을 고르면 두 단계로 나눌 수 있습니다.</Hint>}
      {!hasV && params.colorBy === 'value' && <Hint>값 열을 고르면 색이 값을 나타냅니다.</Hint>}
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ selected: -1 })} data-testid="unit-clear">선택 해제</button>
      <Hint>레코드 하나가 단위(표시) 하나입니다. 먼저 첫 번째 분류로 가로 방향 칸을, 두 번째 분류로 그 안의 세로 방향 칸을 나누고(칸의 크기는 레코드 수에 비례), 각 칸 안에서 단위를 격자·값 쌓기(점도표)·원 채우기·흩뿌리기 중 하나로 늘어놓습니다. 같은 자료로 막대(격자), 점도표, 모자이크처럼 보이는 그림을 연속적으로 만들 수 있고 단위 하나를 눌러 그 레코드를 확인합니다. 이 구현은 Atom 문법의 ‘분할 후 배치’ 핵심만 구현하며 임의 순서의 연산 조합·규칙 기반 레이아웃 언어는 지원하지 않습니다.</Hint>
    </ControlGroup>
  )
}

export const unitModule: VizModule<UnitParams> = {
  roles: [
    { key: 'label', label: '이름', type: 'category', auto: true, prefer: '응답|이름|name' },
    { key: 'split1', label: '첫 번째 분류 (가로로 나눔)', type: 'category', required: true, prefer: '부서' },
    { key: 'split2', label: '두 번째 분류 (세로로 나눔)', type: 'category', auto: true, prefer: '직급' },
    { key: 'value', label: '값 (색·쌓기)', type: 'number', auto: true, prefer: '만족도|값|value' },
  ],
  datasets: ['survey-units'],
  defaultParams: { leaf: 'grid', splits: 2, colorBy: 'split', selected: -1 },
  Chart: UnitChart,
  Controls: UnitControls,
  hint: '단위 배치 방식을 바꿔 같은 자료가 막대·점도표·원 채우기로 바뀌는 것을 봅니다 · 단위를 눌러 레코드 확인',
}

// ───────────────────────────── Splatterplot ─────────────────────────────

export interface SplatParams { bandwidth: number; coverage: number; showInside: boolean; pointSize: number }

function SplatChart({ table, mapping, params, width, height, compact }: ChartProps<SplatParams>) {
  const data = useMemo(() => {
    const xi = columnIndex(table, roleColumn(mapping, 'x')), yi = columnIndex(table, roleColumn(mapping, 'y')), ci = columnIndex(table, roleColumn(mapping, 'class'))
    if (xi < 0 || yi < 0) return null
    const by = new Map<string, [number, number][]>()
    for (const r of table.rows) { const x = toNumber(r[xi]), y = toNumber(r[yi]); if (x != null && y != null) { const c = ci >= 0 ? toLabel(r[ci]) : ''; by.set(c, [...(by.get(c) ?? []), [x, y]]) } }
    return by.size ? by : null
  }, [table, mapping])
  const ext = useMemo(() => {
    if (!data) return null
    const all = [...data.values()].flat()
    const ex = d3.extent(all, (p) => p[0]) as [number, number], ey = d3.extent(all, (p) => p[1]) as [number, number]
    const px = (ex[1] - ex[0]) * 0.04 || 1, py = (ey[1] - ey[0]) * 0.04 || 1
    return { x: [ex[0] - px, ex[1] + px] as [number, number], y: [ey[0] - py, ey[1] + py] as [number, number] }
  }, [data])
  const classes = useMemo(() => (data && ext ? [...data].map(([name, pts]) => ({ name, ...splatter(pts, ext.x, ext.y, { grid: compact ? 50 : 90, bandwidth: params.bandwidth, coverage: params.coverage }) })) : null), [data, ext, params.bandwidth, params.coverage, compact])
  if (!data || !ext || !classes) return <ChartMessage>x, y(숫자) 열과 분류 열을 고르세요.</ChartMessage>
  const pad = compact ? 6 : 28
  const sx = d3.scaleLinear().domain(ext.x).range([pad, width - pad]), sy = d3.scaleLinear().domain(ext.y).range([height - pad, pad])
  const color = categoryColor(classes.map((c) => c.name))
  const total = classes.reduce((a, c) => a + c.points.length, 0)
  const out = classes.reduce((a, c) => a + c.inside.filter((v) => !v).length, 0)
  return (
    <div className="chart-root">
      <svg width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`스플래터플롯: 점 ${total}개, 윤곽 밖 점 ${out}개`}>
        <rect x={pad} y={pad} width={width - 2 * pad} height={height - 2 * pad} fill="#fff" stroke="#e5eaea" />
        {classes.map((c) => (
          <g key={c.name}>
            {c.rings.map((ring, i) => <path key={i} d={'M' + ring.map((p) => `${sx(p[0])},${sy(p[1])}`).join('L') + 'Z'} fill={color(c.name)} fillOpacity={0.3} stroke={color(c.name)} strokeWidth={1.4} data-testid="splat-region" />)}
            {c.points.map((p, i) => (!c.inside[i] || params.showInside) && <circle key={i} cx={sx(p[0])} cy={sy(p[1])} r={c.inside[i] ? Math.max(0.7, params.pointSize * 0.5) : params.pointSize} fill={color(c.name)} fillOpacity={c.inside[i] ? 0.25 : 0.9} stroke={c.inside[i] ? 'none' : '#fff'} strokeWidth={0.6} data-testid={c.inside[i] ? 'splat-inner' : 'splat-outlier'} />)}
          </g>
        ))}
        {!compact && <text x={pad} y={height - 8} fontSize={11} fill="#6b7280" data-testid="splat-readout">점 {total}개 중 윤곽 밖 {out}개를 하나씩 표시 · 윤곽 = 분류별 점의 {Math.round(params.coverage * 100)}%를 담는 밀도 영역</text>}
      </svg>
    </div>
  )
}

function SplatControls({ params, setParams }: ControlsProps<SplatParams>) {
  return (
    <ControlGroup title="밀도 윤곽">
      <Slider label="평활 폭 (화면 비율)" value={params.bandwidth} min={0.01} max={0.12} step={0.005} onChange={(bandwidth) => setParams({ bandwidth })} format={(v) => v.toFixed(3)} testId="ctl-bandwidth" />
      <Slider label="윤곽이 담을 점의 비율" value={params.coverage} min={0.5} max={0.99} step={0.01} onChange={(coverage) => setParams({ coverage })} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-coverage" />
      <Slider label="바깥 점의 크기" value={params.pointSize} min={1} max={6} step={0.5} onChange={(pointSize) => setParams({ pointSize })} testId="ctl-pointsize" />
      <Toggle label="윤곽 안의 점도 흐리게 표시" checked={params.showInside} onChange={(showInside) => setParams({ showInside })} testId="ctl-showinside" />
      <Hint>점이 너무 많아 겹쳐 그려지면(overdraw) 어디가 빽빽한지, 바깥에 흩어진 점이 있는지 알 수 없습니다. 스플래터플롯은 분류마다 점 밀도를 매끈하게 추정해 ‘점의 일정 비율을 담는 밀도 등치선’ 안쪽을 색 영역 하나로 대신하고, 그 밖에 있는 점만 하나씩 그려 이상치가 가려지지 않게 합니다. 영역이 겹치는 곳에서는 분류 사이의 겹침이 보입니다. 이 구현은 CPU의 가우시안 평활과 등치선(d3-contour)을 쓰며 원 논문의 GPU 구현·색 혼합 규칙·점 크기 자동 조절은 쓰지 않습니다.</Hint>
    </ControlGroup>
  )
}

export const splatModule: VizModule<SplatParams> = {
  roles: [
    { key: 'x', label: 'x', type: 'number', required: true, prefer: '^x' },
    { key: 'y', label: 'y', type: 'number', required: true, prefer: '^y' },
    { key: 'class', label: '분류(색)', type: 'category', auto: true, prefer: '분류|class' },
  ],
  datasets: ['class-scatter'],
  defaultParams: { bandwidth: 0.04, coverage: 0.9, showInside: false, pointSize: 3 },
  Chart: SplatChart,
  Controls: SplatControls,
  hint: '윤곽이 담을 점의 비율을 바꿔 바깥 점(이상치)이 어떻게 드러나는지 봅니다',
}
