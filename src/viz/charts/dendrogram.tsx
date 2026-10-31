import * as d3 from 'd3'
import { useMemo, useRef, type PointerEvent } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Readout, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber } from '../../data/table'
import { colorAt } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { clusterCount, cutTree, hclust, linkageTree, standardizeColumns, type ClusterNode, type Linkage, type Metric } from '../../stats/cluster'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'

export interface DendrogramParams {
  metric: Metric
  linkage: Linkage
  standardize: boolean
  orientation: 'horizontal' | 'vertical'
  /** Cut height; 0 = no cut. */
  cut: number
  showHeights: boolean
  /** Merge ids (≥ n) of subtrees folded into one leaf. */
  collapsed: number[]
}

const MAX_LEAVES = 120

export interface Placed { node: ClusterNode; pos: number; h: number; folded: boolean; children: Placed[] }

/** Leaf slots in DFS order; each internal node sits at the mean of its children and at its merge height. */
export function placeTree(root: ClusterNode, collapsed: ReadonlySet<number>) {
  let slot = 0
  const rec = (n: ClusterNode): Placed => {
    if (!n.children || collapsed.has(n.id)) return { node: n, pos: slot++, h: n.height, folded: !!n.children, children: [] }
    const kids = n.children.map(rec)
    return { node: n, pos: d3.mean(kids, (k) => k.pos)!, h: n.height, folded: false, children: kids }
  }
  const placed = rec(root)
  return { placed, slots: slot }
}

function leavesOf(n: ClusterNode): string[] {
  return n.children ? n.children.flatMap(leavesOf) : [n.label ?? String(n.id)]
}

function DendrogramChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<DendrogramParams>) {
  const labelCol = roleColumn(mapping, 'label')
  const feats = roleColumns(mapping, 'features')
  const svgRef = useRef<SVGSVGElement>(null)
  const dragCut = useRef(false)
  const { tip, show, hide } = useTooltip()

  const data = useMemo(() => {
    const li = columnIndex(table, labelCol)
    const fi = feats.map((f) => columnIndex(table, f))
    const labels: string[] = []
    const rows: number[][] = []
    let skipped = 0
    table.rows.forEach((r) => {
      const vals = fi.map((i) => toNumber(r[i]))
      const label = toLabel(r[li])
      if (!label || vals.some((v) => v == null)) { skipped++; return }
      labels.push(label)
      rows.push(vals as number[])
    })
    return { labels, rows, skipped }
  }, [table, labelCol, feats])

  const model = useMemo(() => {
    if (data.rows.length < 2 || data.rows.length > MAX_LEAVES) return null
    const pts = params.standardize ? standardizeColumns(data.rows) : data.rows
    const merges = hclust(pts, params.metric, params.linkage)
    return { merges, tree: linkageTree(merges, data.labels), maxH: d3.max(merges, (m) => m.height) ?? 1 }
  }, [data, params.metric, params.linkage, params.standardize])

  const horizontal = params.orientation === 'horizontal'
  const m = compact ? { l: 6, r: 6, t: 6, b: 6 } : horizontal ? { l: 20, r: 120, t: 20, b: 50 } : { l: 60, r: 20, t: 20, b: 96 }
  const iw = Math.max(10, width - m.l - m.r)
  const ih = Math.max(10, height - m.t - m.b)
  const layout = useMemo(() => (model ? placeTree(model.tree, new Set(params.collapsed)) : null), [model, params.collapsed])

  if (!labelCol || !feats.length) return <ChartMessage>이름 열과 특징(숫자형) 열을 1개 이상 선택하세요.</ChartMessage>
  if (data.rows.length < 2) return <ChartMessage>군집화하려면 값이 모두 있는 행이 2개 이상 필요합니다.{data.skipped > 0 && ` (${data.skipped}행 제외)`}</ChartMessage>
  if (!model || !layout) return <ChartMessage>행이 {MAX_LEAVES}개를 넘어 덴드로그램이 읽기 어렵습니다. 행 수를 줄여 보세요.</ChartMessage>

  const { placed, slots } = layout
  const heightLen = horizontal ? iw : ih
  const crossLen = horizontal ? ih : iw
  const hs = d3.scaleLinear().domain([0, model.maxH]).range([0, heightLen])
  const heightAxis = horizontal ? d3.scaleLinear().domain([model.maxH, 0]).range([0, iw]).nice() : d3.scaleLinear().domain([0, model.maxH]).range([ih, 0]).nice()
  if (horizontal) hs.domain([0, heightAxis.domain()[0]]); else hs.domain([0, heightAxis.domain()[1]])
  const P = (pos: number, h: number): [number, number] => {
    const c = ((pos + 0.5) / slots) * crossLen
    return horizontal ? [heightLen - hs(h), c] : [c, heightLen - hs(h)]
  }
  const cutOn = params.cut > 0
  const flat = cutOn ? cutTree(model.merges, data.labels.length, params.cut) : []
  const clusterOfLeaf = new Map<number, number>()
  const walkLeaves = (n: ClusterNode) => { if (n.children) n.children.forEach(walkLeaves); else clusterOfLeaf.set(n.id, flat[n.id]) }
  walkLeaves(model.tree)
  const clusterOfNode = (n: ClusterNode): number | null => {
    if (!cutOn) return null
    const ids = new Set(leavesIdx(n).map((i) => flat[i]))
    return ids.size === 1 ? [...ids][0] : null
  }
  function leavesIdx(n: ClusterNode): number[] { return n.children ? n.children.flatMap(leavesIdx) : [n.id] }
  const colorOfCluster = (k: number | null) => (k == null ? '#8a9490' : colorAt(k))

  const links: { d: string; color: string }[] = []
  const dots: Placed[] = []
  const rec = (p: Placed) => {
    if (!p.children.length) return
    dots.push(p)
    const pts = [P(p.children[0].pos, p.children[0].h), P(p.children[0].pos, p.h), P(p.children[1].pos, p.h), P(p.children[1].pos, p.children[1].h)]
    const k = clusterOfNode(p.node)
    links.push({ d: `M${pts.map((q) => q.join(',')).join('L')}`, color: colorOfCluster(k) })
    p.children.forEach(rec)
  }
  rec(placed)
  const leafList: Placed[] = []
  const collect = (p: Placed) => { if (!p.children.length) leafList.push(p); else p.children.forEach(collect) }
  collect(placed)
  const k = cutOn ? clusterCount(model.merges, data.labels.length, params.cut) : 0
  const cutPx = cutOn ? heightLen - hs(params.cut) : 0

  const setCutFromPointer = (e: PointerEvent) => {
    const lp = localPoint(svgRef.current!, e)
    const along = horizontal ? lp.x - m.l : lp.y - m.t
    const h = hs.invert(heightLen - Math.max(0, Math.min(heightLen, along)))
    setParams({ cut: Math.round(Math.max(0, Math.min(model.maxH, h)) * 1000) / 1000 })
  }
  const toggleFold = (id: number) => setParams({ collapsed: params.collapsed.includes(id) ? params.collapsed.filter((x) => x !== id) : [...params.collapsed, id] })

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`덴드로그램: ${data.labels.length}개 항목의 ${params.linkage} 연결 군집화`}
        onPointerDown={(e) => { if (!compact && (e.target as Element).closest('[data-cut]')) { (e.currentTarget as Element).setPointerCapture(e.pointerId); dragCut.current = true } }}
        onPointerMove={(e) => { if (dragCut.current) setCutFromPointer(e) }} onPointerUp={() => { dragCut.current = false }} onPointerCancel={() => { dragCut.current = false }} onPointerLeave={hide}>
        <g transform={`translate(${m.l},${m.t})`}>
          {!compact && (horizontal
            ? <AxisBottom scale={heightAxis} y={ih + 10} label={`병합 거리 (${params.linkage}${params.linkage === 'ward' ? ', 분산 증가량' : ''})`} compact={compact} />
            : <AxisLeft scale={heightAxis} x={-10} grid={0} label="병합 거리" compact={compact} />)}
          {links.map((l, i) => <path key={i} className="dendro-link" data-testid="dendro-link" d={l.d} stroke={l.color} fill="none" strokeWidth={compact ? 1.2 : 1.8} />)}
          {dots.map((p) => {
            const [cx, cy] = P(p.pos, p.h)
            return (
              <g key={p.node.id}>
                <circle className="dendro-join" data-testid="dendro-join" cx={cx} cy={cy} r={compact ? 1.5 : 4} fill="#fff" stroke="#6b7280" strokeWidth={1.3} style={{ cursor: compact ? 'default' : 'pointer' }}
                  onClick={compact ? undefined : () => toggleFold(p.node.id)}
                  onPointerMove={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); const ls = leavesOf(p.node); show(lp.x, lp.y, <><b>병합 거리 {fmt(p.h, 3)}</b><br />포함 {p.node.size}개: {ls.slice(0, 4).join(', ')}{ls.length > 4 ? ' …' : ''}<br />클릭하면 접기</>) }} onPointerLeave={hide} />
                {params.showHeights && !compact && slots <= 40 && <text className="dendro-h" x={cx + (horizontal ? -6 : 6)} y={cy + (horizontal ? -6 : -6)} textAnchor={horizontal ? 'end' : 'start'}>{fmt(p.h, 2)}</text>}
              </g>
            )
          })}
          {leafList.map((p) => {
            const [cx, cy] = P(p.pos, p.h)
            const c = p.folded ? '#6b7280' : colorOfCluster(cutOn ? clusterOfLeaf.get(p.node.id) ?? null : null)
            const label = p.folded ? `▸ ${p.node.size}개` : p.node.label ?? ''
            const [a, b] = horizontal ? [cx, cy] : [cx, cy]
            return (
              <g key={`${p.node.id}`}>
                {p.folded
                  ? <polygon className="dendro-folded" data-testid="dendro-folded" points={horizontal ? `${a},${b} ${heightLen},${b - 7} ${heightLen},${b + 7}` : `${a},${b} ${a - 7},${heightLen} ${a + 7},${heightLen}`} fill="#e5e9e8" stroke="#6b7280"
                      style={{ cursor: 'pointer' }} onClick={compact ? undefined : () => toggleFold(p.node.id)} />
                  : <circle cx={cx} cy={cy} r={compact ? 1.5 : 3} fill={c} />}
                {!compact && (horizontal
                  ? <text className="dendro-label" x={heightLen + 8} y={cy} dy="0.35em" fill={c === '#8a9490' ? undefined : c}>{label}</text>
                  : <text className="dendro-label" transform={`translate(${cx},${heightLen + 10}) rotate(55)`} textAnchor="start" fill={c === '#8a9490' ? undefined : c}>{label}</text>)}
              </g>
            )
          })}
          {cutOn && !compact && (
            <g>
              <line className="dendro-cut" x1={horizontal ? cutPx : 0} x2={horizontal ? cutPx : iw} y1={horizontal ? 0 : cutPx} y2={horizontal ? ih : cutPx} />
              <line data-cut="1" data-testid="dendro-cut" x1={horizontal ? cutPx : 0} x2={horizontal ? cutPx : iw} y1={horizontal ? 0 : cutPx} y2={horizontal ? ih : cutPx} stroke="transparent" strokeWidth={14} style={{ cursor: horizontal ? 'ew-resize' : 'ns-resize' }} />
            </g>
          )}
        </g>
      </svg>
      {!compact && (
        <>
          <Readout items={[{ label: '항목', value: data.labels.length }, { label: '최대 병합 거리', value: fmt(model.maxH, 3) }, ...(cutOn ? [{ label: '군집 수', value: k }] : []), ...(data.skipped ? [{ label: '제외한 행', value: data.skipped }] : [])]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function DendrogramControls({ params, setParams, table, mapping }: ControlsProps<DendrogramParams>) {
  const feats = roleColumns(mapping, 'features')
  return (
    <>
      <ControlGroup title="군집화 방법">
        <Select label="연결 방식" value={params.linkage} onChange={(linkage) => setParams({ linkage, collapsed: [] })} testId="ctl-linkage"
          options={[{ value: 'average', label: '평균 연결 (UPGMA)' }, { value: 'complete', label: '완전 연결 (최대 거리)' }, { value: 'single', label: '단일 연결 (최소 거리)' }, { value: 'ward', label: 'Ward (분산 증가 최소)' }]} />
        <Hint>
          {params.linkage === 'single' && '두 군집의 가장 가까운 두 점 사이 거리로 병합합니다. 사슬처럼 길게 이어지는 군집이 생기기 쉽습니다.'}
          {params.linkage === 'complete' && '두 군집의 가장 먼 두 점 사이 거리로 병합합니다. 지름이 작은 둥근 군집을 만듭니다.'}
          {params.linkage === 'average' && '두 군집에 속한 모든 점 쌍의 평균 거리로 병합합니다.'}
          {params.linkage === 'ward' && '병합했을 때 군집 내 제곱합이 가장 적게 늘어나는 쌍을 합칩니다. 높이는 유클리드 거리 기준입니다.'}
        </Hint>
        <Segmented label="거리" value={params.linkage === 'ward' ? 'euclidean' : params.metric} onChange={(metric) => setParams({ metric, collapsed: [] })} testId="ctl-metric"
          options={[{ value: 'euclidean', label: '유클리드' }, { value: 'manhattan', label: '맨해튼' }]} />
        <Toggle label="열마다 표준화" description="단위가 다른 특징이 거리를 지배하지 않게 z-점수로 변환" checked={params.standardize} onChange={(standardize) => setParams({ standardize, collapsed: [] })} testId="ctl-standardize" />
        <Hint>특징 {feats.length}개: {feats.join(', ') || '없음'}. 데이터 탭에서 특징 열을 고르거나 값을 고치면 트리가 다시 계산됩니다.</Hint>
      </ControlGroup>
      <ControlGroup title="표시">
        <Segmented label="방향" value={params.orientation} onChange={(orientation) => setParams({ orientation })} testId="ctl-orient" options={[{ value: 'horizontal', label: '가로' }, { value: 'vertical', label: '세로' }]} />
        <Toggle label="병합 거리 표시" checked={params.showHeights} onChange={(showHeights) => setParams({ showHeights })} testId="ctl-heights" />
        <Slider label="자르는 높이 (군집 나누기)" value={params.cut} min={0} max={Math.ceil(maxHeight(table, mapping, params) * 100) / 100 || 1} step={0.01} onChange={(cut) => setParams({ cut })} format={(v) => (v === 0 ? '끔' : v.toFixed(2))} testId="ctl-cut" />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ collapsed: [] })} disabled={!params.collapsed.length}>접은 가지 모두 펼치기</button>
        <Hint>가지의 ○를 클릭하면 그 아래를 접고 다시 클릭하면 펼칩니다. 자르는 높이를 올리면 가까운 항목끼리 같은 군집으로 묶이며, 점선을 직접 드래그해도 됩니다.</Hint>
      </ControlGroup>
    </>
  )
}

function maxHeight(table: ChartProps<DendrogramParams>['table'], mapping: ChartProps<DendrogramParams>['mapping'], params: DendrogramParams) {
  const feats = roleColumns(mapping, 'features').map((f) => columnIndex(table, f))
  const li = columnIndex(table, roleColumn(mapping, 'label'))
  const rows = table.rows.filter((r) => toLabel(r[li]) && feats.every((i) => toNumber(r[i]) != null)).map((r) => feats.map((i) => toNumber(r[i]) as number))
  if (rows.length < 2 || rows.length > MAX_LEAVES) return 1
  const merges = hclust(params.standardize ? standardizeColumns(rows) : rows, params.metric, params.linkage)
  return d3.max(merges, (x) => x.height) ?? 1
}

export const dendrogramModule: VizModule<DendrogramParams> = {
  roles: [
    { key: 'label', label: '항목 이름', type: 'category', required: true },
    { key: 'features', label: '특징 (거리 계산에 쓸 열)', type: 'number', required: true, multiple: { min: 1 } },
  ],
  datasets: ['nutrition', 'players'],
  defaultParams: { metric: 'euclidean', linkage: 'average', standardize: true, orientation: 'horizontal', cut: 0, showHeights: false, collapsed: [] },
  Chart: DendrogramChart,
  Controls: DendrogramControls,
  hint: '가지의 ○를 클릭해 접기·펼치기 · 자르는 높이 슬라이더(또는 점선 드래그)로 군집 나누기 · 값을 고치면 트리가 다시 계산됩니다',
}
