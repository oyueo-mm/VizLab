import { useMemo, useRef } from 'react'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, type DataTable } from '../../data/table'
import { categoryColor } from '../../lib/colors'
import { braid, paoh, setStreams, type EventRecord, type HyperEdge, type MembershipRecord, type PaohOrder } from '../../stats/tempo9'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'

const text = (fill = '#4b5563', size = 11) => ({ fill, fontSize: size })

// ───────────────────────────── PAOHvis ─────────────────────────────

export interface PaohParams { order: PaohOrder; from: number; to: number; selNode: string; selEdge: string; labels: boolean }

function readEdges(table: DataTable, mapping: Mapping): HyperEdge[] | null {
  const ti = columnIndex(table, roleColumn(mapping, 'time')), ei = columnIndex(table, roleColumn(mapping, 'edge')), mi = columnIndex(table, roleColumn(mapping, 'member'))
  if (ti < 0 || ei < 0 || mi < 0) return null
  const map = new Map<string, HyperEdge>()
  for (const r of table.rows) {
    const t = toNumber(r[ti]); if (t == null) continue
    const id = toLabel(r[ei]), key = `${t}|${id}`
    const e = map.get(key) ?? { time: t, id, members: [] }
    e.members.push(toLabel(r[mi])); map.set(key, e)
  }
  return [...map.values()].filter((e) => new Set(e.members).size >= 2)
}

function PaohChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<PaohParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const edges = useMemo(() => readEdges(table, mapping), [table, mapping])
  const range = useMemo(() => {
    const t = edges?.map((e) => e.time) ?? []
    return t.length ? ([Math.min(...t), Math.max(...t)] as [number, number]) : null
  }, [edges])
  const layout = useMemo(() => (edges && range ? paoh(edges, params.order, [Math.max(range[0], params.from || range[0]), Math.min(range[1], params.to || range[1])]) : null), [edges, range, params.order, params.from, params.to])
  if (!edges || !layout || !layout.columns.length) return <ChartMessage>시점·하이퍼엣지·참여자 열을 고르세요. 한 행이 ‘한 시점, 한 하이퍼엣지, 한 참여자’여야 합니다.</ChartMessage>
  const left = compact ? 6 : 88, top = compact ? 8 : 34, bottom = compact ? 6 : 24
  const n = layout.nodes.length
  const rowH = Math.min(26, (height - top - bottom) / Math.max(1, n))
  const gapT = compact ? 4 : 12
  // x of every column: columns of one time slot sit together, slots are separated by a gap
  const slotCols = layout.times.map((t) => layout.columns.filter((c) => c.time === t).length)
  const totalUnits = layout.columns.length + gapT / 14 * (layout.times.length - 1)
  const step = Math.min(34, (width - left - 14) / Math.max(1, totalUnits))
  const xs: number[] = []
  let x = left + step / 2
  layout.times.forEach((_, si) => { for (let k = 0; k < slotCols[si]; k++) { xs.push(x); x += step } ; x += (gapT / 14) * step })
  const firstOf = layout.times.map((_, si) => slotCols.slice(0, si).reduce((a, b) => a + b, 0))
  const inSelNode = (rows: number[]) => !params.selNode || rows.some((r) => layout.nodes[r] === params.selNode)
  const colKey = (c: { time: number; ids: string[] }) => `${c.time}|${c.ids[0]}`
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`PAOHvis: 참여자 ${n}명, 하이퍼엣지 ${layout.columns.length}개`} onPointerLeave={hide}>
        {layout.nodes.map((nm, r) => (
          <g key={nm} data-testid="paoh-row" style={{ cursor: compact ? undefined : 'pointer' }} onClick={compact ? undefined : () => setParams({ selNode: params.selNode === nm ? '' : nm, selEdge: '' })}>
            <line x1={left - 4} x2={width - 8} y1={top + r * rowH + rowH / 2} y2={top + r * rowH + rowH / 2} stroke={params.selNode === nm ? '#2a8c82' : '#e3e8e8'} strokeWidth={params.selNode === nm ? 2 : 1} />
            {!compact && <text x={left - 10} y={top + r * rowH + rowH / 2} textAnchor="end" dy="0.34em" {...text(params.selNode === nm ? '#1f6f67' : '#4b5563')} fontWeight={params.selNode === nm ? 700 : 400}>{nm}</text>}
          </g>
        ))}
        {layout.columns.map((c, ci) => {
          const x0 = xs[ci]
          const active = (!params.selEdge || params.selEdge === colKey(c)) && inSelNode(c.rows)
          const y0 = top + c.rows[0] * rowH + rowH / 2, y1 = top + c.rows[c.rows.length - 1] * rowH + rowH / 2
          const sw = Math.min(step * 0.6, 2 + (c.count - 1) * 1.6)
          return (
            <g key={ci} opacity={active ? 1 : 0.18} data-testid="paoh-edge" data-members={c.rows.length} data-count={c.count} style={{ cursor: compact ? undefined : 'pointer' }}
              onClick={compact ? undefined : () => setParams({ selEdge: params.selEdge === colKey(c) ? '' : colKey(c), selNode: '' })}
              onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{c.time}년 · {c.ids.join(', ')}</b><br />{c.rows.map((r) => layout.nodes[r]).join(', ')}{c.count > 1 ? ` (동일 구성 ${c.count}건 합침)` : ''}</>) }} onPointerLeave={hide}>
              <line x1={x0} x2={x0} y1={y0} y2={y1} stroke="#2a8c82" strokeWidth={sw} strokeLinecap="round" />
              {c.rows.map((r) => <circle key={r} cx={x0} cy={top + r * rowH + rowH / 2} r={Math.max(2.6, sw / 2 + 1.6)} fill="#1f6f67" stroke="#fff" strokeWidth={1} />)}
              {!compact && c.count > 1 && <text x={x0} y={y0 - 7} textAnchor="middle" {...text('#1f6f67', 10)} fontWeight={700}>×{c.count}</text>}
            </g>
          )
        })}
        {!compact && layout.times.map((t, si) => <text key={t} x={(xs[firstOf[si]] + xs[firstOf[si] + slotCols[si] - 1]) / 2} y={16} textAnchor="middle" {...text('#374151', 12)} fontWeight={600}>{t}</text>)}
        {!compact && <text x={8} y={height - 6} {...text('#6b7280', 10)}>선 = 하이퍼엣지(한 프로젝트), 점 = 참여자 · 같은 구성은 ×n으로 합침 · 가로선 = 참여자</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function PaohControls({ params, setParams, table, mapping }: ControlsProps<PaohParams>) {
  const edges = useMemo(() => readEdges(table, mapping), [table, mapping])
  const ts = edges?.map((e) => e.time) ?? []
  const lo = ts.length ? Math.min(...ts) : 0, hi = ts.length ? Math.max(...ts) : 1
  const layout = useMemo(() => (edges ? paoh(edges, params.order, [params.from || lo, params.to || hi]) : null), [edges, params.order, params.from, params.to, lo, hi])
  return (
    <ControlGroup title="정렬과 시간 범위">
      <Segmented label="참여자(가로선) 순서" value={params.order} onChange={(order) => setParams({ order })} options={[{ value: 'first', label: '등장순' }, { value: 'degree', label: '참여 횟수' }, { value: 'barycenter', label: '함께한 사람끼리' }, { value: 'name', label: '이름순' }]} testId="ctl-order" />
      <Slider label="시작 시점" value={params.from || lo} min={lo} max={hi} onChange={(from) => setParams({ from: Math.min(from, params.to || hi) })} testId="ctl-from" />
      <Slider label="끝 시점" value={params.to || hi} min={lo} max={hi} onChange={(to) => setParams({ to: Math.max(to, params.from || lo) })} testId="ctl-to" />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ selNode: '', selEdge: '' })} data-testid="paoh-clear">선택 해제</button>
      {layout && <p className="hint" data-testid="paoh-stats">하이퍼엣지 {layout.columns.length}개(합친 뒤) · 참여자 {layout.nodes.length}명 · 선 길이 합 {layout.span}</p>}
      <Hint>참여자는 평행한 가로선, 하이퍼엣지는 그 시점 칸의 세로선이며 선이 지나는 점이 참여자입니다. 같은 시점에 구성이 같은 하이퍼엣지는 하나로 합쳐 ×n으로 표시합니다(Aggregated). ‘함께한 사람끼리’는 함께 참여한 사람의 평균 위치로 가로선을 옮기는 휴리스틱으로 세로선의 길이 합을 줄입니다. 가로선이나 세로선을 눌러 관련 항목만 강조합니다.</Hint>
    </ControlGroup>
  )
}

export const paohModule: VizModule<PaohParams> = {
  roles: [
    { key: 'time', label: '시점', type: 'number', required: true, prefer: '연도|시점|year|time' },
    { key: 'edge', label: '하이퍼엣지', type: 'category', required: true, prefer: '프로젝트|edge' },
    { key: 'member', label: '참여자(정점)', type: 'category', required: true, prefer: '참여자|member' },
  ],
  datasets: ['team-projects'],
  defaultParams: { order: 'barycenter', from: 0, to: 0, selNode: '', selEdge: '', labels: true },
  Chart: PaohChart,
  Controls: PaohControls,
  hint: '가로선(참여자)이나 세로선(하이퍼엣지)을 눌러 관련 항목 강조 · 시간 범위와 정렬을 바꿔 보세요',
}

// ───────────────────────────── Set Streams ─────────────────────────────

export interface StreamsParams { from: number; to: number; selSet: string; selFlow: string; hideNone: boolean }

function readMembership(table: DataTable, mapping: Mapping): MembershipRecord[] | null {
  const ii = columnIndex(table, roleColumn(mapping, 'item')), ti = columnIndex(table, roleColumn(mapping, 'time')), si = columnIndex(table, roleColumn(mapping, 'set'))
  if (ii < 0 || ti < 0 || si < 0) return null
  const out: MembershipRecord[] = []
  for (const r of table.rows) { const t = toNumber(r[ti]); if (t != null) out.push({ item: toLabel(r[ii]), time: t, set: toLabel(r[si]) }) }
  return out
}

function StreamsChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<StreamsParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const rec = useMemo(() => readMembership(table, mapping), [table, mapping])
  const range = useMemo(() => { const t = rec?.map((r) => r.time) ?? []; return t.length ? ([Math.min(...t), Math.max(...t)] as [number, number]) : null }, [rec])
  const model = useMemo(() => (rec && range ? setStreams(rec, [params.from || range[0], params.to || range[1]]) : null), [rec, range, params.from, params.to])
  if (!rec || !model || model.times.length < 2) return <ChartMessage>개체·시점·집합 열을 고르세요. 시점이 둘 이상이어야 합니다.</ChartMessage>
  const color = categoryColor(model.setNames)
  const left = compact ? 6 : 112, right = compact ? 6 : 16, top = compact ? 8 : 24, bottom = compact ? 8 : 34
  const rows = model.combos.map((_, i) => i).filter((i) => !(params.hideNone && model.combos[i].sets.length === 0))
  const laneH = (height - top - bottom) / Math.max(1, rows.length)
  const laneY = new Map(rows.map((r, k) => [r, top + k * laneH + laneH / 2]))
  const unit = (laneH * 0.9) / Math.max(1, Math.max(...model.counts.flatMap((c, i) => (laneY.has(i) ? c : []))))
  const T = model.times.length
  const colW = Math.min(18, (width - left - right) / T * 0.28)
  const xs = model.times.map((_, t) => left + colW / 2 + (t * (width - left - right - colW)) / (T - 1))
  const label = (i: number) => model.combos[i].sets.map((s) => model.setNames[s]).join(' + ') || '없음'
  const hot = (i: number) => !params.selSet || model.combos[i].sets.some((s) => model.setNames[s] === params.selSet)
  const comboColor = (i: number) => (model.combos[i].sets.length ? color(model.setNames[model.combos[i].sets[0]]) : '#b6bec4')
  // ribbons
  const ribbons: { key: string; d: string; fill: string; flow: { t: number; from: number; to: number; n: number; items: string[] }; moves: boolean }[] = []
  model.flows.forEach((fl, t) => {
    const used = fl.filter((f) => laneY.has(f.from) && laneY.has(f.to))
    const outOff = new Map<string, number>(), inOff = new Map<string, number>()
    const start = (c: number, tt: number) => laneY.get(c)! - (model.counts[c][tt] * unit) / 2
    const bySrc = new Map<number, typeof used>(), byDst = new Map<number, typeof used>()
    used.forEach((f) => { bySrc.set(f.from, [...(bySrc.get(f.from) ?? []), f]); byDst.set(f.to, [...(byDst.get(f.to) ?? []), f]) })
    bySrc.forEach((list, c) => { let o = start(c, t); list.sort((a, b) => laneY.get(a.to)! - laneY.get(b.to)!).forEach((f) => { outOff.set(`${f.from}>${f.to}`, o); o += f.n * unit }) })
    byDst.forEach((list, c) => { let o = start(c, t + 1); list.sort((a, b) => laneY.get(a.from)! - laneY.get(b.from)!).forEach((f) => { inOff.set(`${f.from}>${f.to}`, o); o += f.n * unit }) })
    used.forEach((f) => {
      const k = `${f.from}>${f.to}`, h = f.n * unit
      const x0 = xs[t] + colW / 2, x1 = xs[t + 1] - colW / 2, xm = (x0 + x1) / 2
      const y0 = outOff.get(k)!, y1 = inOff.get(k)!
      ribbons.push({ key: `${t}:${f.from}:${f.to}`, flow: { t, ...f }, moves: f.from !== f.to, fill: comboColor(f.from),
        d: `M${x0},${y0}C${xm},${y0} ${xm},${y1} ${x1},${y1}L${x1},${y1 + h}C${xm},${y1 + h} ${xm},${y0 + h} ${x0},${y0 + h}Z` })
    })
  })
  const selItems = new Set(ribbons.find((r) => r.key === params.selFlow)?.flow.items ?? [])
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Set Streams: 시점 ${T}개, 집합 조합 ${rows.length}개, 개체 ${model.items.length}명`} onPointerLeave={hide}>
        {rows.map((r) => <line key={r} x1={left} x2={width - right} y1={laneY.get(r)} y2={laneY.get(r)} stroke="#eef1f1" />)}
        {ribbons.map((r) => {
          const mine = selItems.size > 0 && r.flow.items.some((it) => selItems.has(it))
          const op = (hot(r.flow.from) || hot(r.flow.to) ? 1 : 0.15) * (selItems.size ? (mine ? 1 : 0.12) : r.moves ? 0.62 : 0.34)
          return (
            <path key={r.key} d={r.d} fill={r.fill} opacity={op} stroke={params.selFlow === r.key ? '#d4452f' : 'none'} strokeWidth={1.5} data-testid="stream-ribbon" data-moves={r.moves ? 1 : 0} data-n={r.flow.n} style={{ cursor: compact ? undefined : 'pointer' }}
              onClick={compact ? undefined : () => setParams({ selFlow: params.selFlow === r.key ? '' : r.key })}
              onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{label(r.flow.from)} → {label(r.flow.to)}</b><br />{model.times[r.flow.t]} → {model.times[r.flow.t + 1]}: {r.flow.n}명</>) }} onPointerLeave={hide} />
          )
        })}
        {rows.map((r) => model.times.map((_, t) => model.counts[r][t] > 0 && (
          <rect key={`${r}-${t}`} x={xs[t] - colW / 2} y={laneY.get(r)! - (model.counts[r][t] * unit) / 2} width={colW} height={Math.max(1, model.counts[r][t] * unit)} rx={2} fill={comboColor(r)} opacity={hot(r) ? 1 : 0.25} data-testid="stream-block" data-count={model.counts[r][t]} />
        )))}
        {!compact && rows.map((r) => (
          <text key={r} x={left - 8} y={laneY.get(r)} textAnchor="end" dy="0.34em" {...text(hot(r) ? '#374151' : '#b6bec4')} style={{ cursor: 'pointer' }} data-testid="stream-lane"
            onClick={() => { const s = model.combos[r].sets[0]; if (s != null) setParams({ selSet: params.selSet === model.setNames[s] ? '' : model.setNames[s] }) }}>{label(r)}</text>
        ))}
        {!compact && model.times.map((t, i) => <text key={t} x={xs[i]} y={height - 12} textAnchor="middle" {...text('#6b7280')}>{t}</text>)}
        {!compact && selItems.size > 0 && <text x={left} y={14} {...text('#d4452f', 12)} data-testid="stream-selected">선택한 흐름의 개체 {selItems.size}명을 따라가는 중 (붉은 테두리 리본의 개체)</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function StreamsControls({ params, setParams, table, mapping }: ControlsProps<StreamsParams>) {
  const rec = useMemo(() => readMembership(table, mapping), [table, mapping])
  const ts = rec?.map((r) => r.time) ?? []
  const lo = ts.length ? Math.min(...ts) : 0, hi = ts.length ? Math.max(...ts) : 1
  const names = [...new Set(rec?.map((r) => r.set) ?? [])]
  const color = categoryColor(names)
  const model = useMemo(() => (rec ? setStreams(rec, [params.from || lo, params.to || hi]) : null), [rec, params.from, params.to, lo, hi])
  const moved = model ? model.flows.reduce((a, fl) => a + fl.filter((f) => f.from !== f.to).reduce((b, f) => b + f.n, 0), 0) : 0
  return (
    <ControlGroup title="시간 범위와 집합 강조">
      <Slider label="시작 시점" value={params.from || lo} min={lo} max={Math.max(lo, hi - 1)} onChange={(from) => setParams({ from: Math.min(from, (params.to || hi) - 1), selFlow: '' })} testId="ctl-from" />
      <Slider label="끝 시점" value={params.to || hi} min={Math.min(hi, lo + 1)} max={hi} onChange={(to) => setParams({ to: Math.max(to, (params.from || lo) + 1), selFlow: '' })} testId="ctl-to" />
      <Toggle label="‘어느 집합에도 없음’ 줄 숨기기" checked={params.hideNone} onChange={(hideNone) => setParams({ hideNone, selFlow: '' })} testId="ctl-hide-none" />
      <div className="field">
        <label>집합 강조</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <button type="button" className="btn btn-secondary btn-sm" aria-pressed={!params.selSet} onClick={() => setParams({ selSet: '' })}>전체</button>
          {names.map((n) => <button key={n} type="button" className="btn btn-secondary btn-sm" aria-pressed={params.selSet === n} data-testid={`stream-set-${n}`} style={{ borderColor: color(n) }} onClick={() => setParams({ selSet: params.selSet === n ? '' : n })}>{n}</button>)}
        </div>
      </div>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ selFlow: '', selSet: '' })} data-testid="stream-clear">선택 해제</button>
      {model && <p className="hint" data-testid="stream-stats">개체 {model.items.length}명 · 조합 {model.combos.length}개 · 시점 사이 이동 {moved}건(조합이 바뀐 횟수)</p>}
      <Hint>가로 줄은 집합 조합(교집합)이고 줄 위 막대의 두께가 그 시점의 개체 수입니다. 리본은 같은 개체들이 다음 시점에 어떤 조합으로 옮겨 가는지(분기·합류)를 보여 주며 폭이 개체 수입니다. 리본을 누르면 그 흐름의 개체들이 모든 시점에서 지나는 리본만 강조되어 개체의 이동 경로를 따라갈 수 있습니다.</Hint>
    </ControlGroup>
  )
}

export const setStreamsModule: VizModule<StreamsParams> = {
  roles: [
    { key: 'item', label: '개체', type: 'category', required: true, prefer: '개체|id' },
    { key: 'time', label: '시점', type: 'number', required: true, prefer: '월|시점|time' },
    { key: 'set', label: '집합', type: 'category', required: true, prefer: '집합|set' },
  ],
  datasets: ['membership-history'],
  defaultParams: { from: 0, to: 0, selSet: '', selFlow: '', hideNone: false },
  Chart: StreamsChart,
  Controls: StreamsControls,
  hint: '리본을 눌러 그 개체들이 시간에 따라 어떤 집합 조합으로 이동하는지 따라갑니다 · 줄 이름을 눌러 집합 강조',
}

// ───────────────────────────── Sequence Braiding ─────────────────────────────

export interface BraidParams { sort: 'path' | 'group' | 'entity'; pick: number[]; counts: boolean }

function readEvents(table: DataTable, mapping: Mapping): EventRecord[] | null {
  const ei = columnIndex(table, roleColumn(mapping, 'entity')), oi = columnIndex(table, roleColumn(mapping, 'order')), vi = columnIndex(table, roleColumn(mapping, 'event')), gi = columnIndex(table, roleColumn(mapping, 'group'))
  if (ei < 0 || oi < 0 || vi < 0) return null
  const out: EventRecord[] = []
  for (const r of table.rows) { const o = toNumber(r[oi]); if (o != null) out.push({ entity: toLabel(r[ei]), order: o, event: toLabel(r[vi]), group: gi >= 0 ? toLabel(r[gi]) : '전체' }) }
  return out
}

function BraidChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<BraidParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const rec = useMemo(() => readEvents(table, mapping), [table, mapping])
  const model = useMemo(() => (rec && rec.length ? braid(rec, params.sort) : null), [rec, params.sort])
  if (!rec || !model || !model.nodes.length) return <ChartMessage>개체·순서·사건 열을 고르세요(집단 열은 선택).</ChartMessage>
  const color = categoryColor(model.groups)
  const left = compact ? 6 : 14, right = compact ? 6 : 14, top = compact ? 8 : 26, bottom = compact ? 8 : 14
  const colW = (width - left - right) / model.layers
  const nodeW = Math.min(compact ? 10 : 96, colW * 0.62)
  const layerNodes = Array.from({ length: model.layers }, (_, l) => model.nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.layer === l).sort((a, b) => a.n.rank - b.n.rank))
  const unit = Math.max(0.6, Math.min(4, Math.min(...layerNodes.map((l) => (height - top - bottom - Math.max(0, l.length - 1) * 24) / Math.max(1, l.reduce((a, { n }) => a + n.visits, 0))))))
  const pos = new Map<number, { x: number; y: number; h: number }>()
  layerNodes.forEach((l, li) => {
    const total = l.reduce((a, { n }) => a + n.visits * unit, 0) + Math.max(0, l.length - 1) * 24
    let y = top + (height - top - bottom - total) / 2
    l.forEach(({ n, i }) => { pos.set(i, { x: left + li * colW + (colW - nodeW) / 2, y, h: n.visits * unit }); y += n.visits * unit + 24 })
  })
  const slotY = (n: number, s: number, step: number) => {
    const k = model.slots[n].findIndex(([si, st]) => si === s && st === step)
    return pos.get(n)!.y + (k + 0.5) * unit
  }
  const pickSet = params.pick
  const matches = (si: number) => {
    if (!pickSet.length) return true
    const path = model.strands[si].path
    let at = -1
    for (const p of pickSet) { const k = path.indexOf(p, at + 1); if (k < 0) return false; at = k }
    return true
  }
  const nMatch = model.strands.filter((_, i) => matches(i)).length
  const togglePick = (i: number) => setParams({ pick: pickSet.includes(i) ? pickSet.filter((p) => p !== i) : [...pickSet, i] })
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Sequence Braiding: 사건 유형 ${model.nodes.length}개, 시퀀스 ${model.strands.length}개`} onPointerLeave={hide}>
        {model.strands.map((s, si) => {
          const ok = matches(si)
          let d = ''
          for (let k = 0; k < s.path.length - 1; k++) {
            const a = s.path[k], b = s.path[k + 1]
            const x0 = pos.get(a)!.x + nodeW, x1 = pos.get(b)!.x
            const y0 = slotY(a, si, k), y1 = slotY(b, si, k + 1), xm = (x0 + x1) / 2
            d += `M${x0},${y0}C${xm},${y0} ${xm},${y1} ${x1},${y1}`
          }
          return <path key={si} d={d} fill="none" stroke={color(s.group)} strokeWidth={Math.max(0.7, unit * 0.85)} opacity={ok ? (pickSet.length ? 0.9 : 0.55) : 0.05} data-testid="braid-strand" data-group={s.group} data-match={ok ? 1 : 0}
            onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{s.entity}</b> ({s.group})<br />{s.path.map((n) => model.nodes[n].type).join(' → ')}</>) }} onPointerLeave={hide} />
        })}
        {model.nodes.map((n, i) => {
          const p = pos.get(i)!
          const picked = pickSet.indexOf(i)
          return (
            <g key={i} data-testid="braid-node" data-visits={n.visits} data-type={n.type} style={{ cursor: compact ? undefined : 'pointer' }} onClick={compact ? undefined : () => togglePick(i)}>
              <rect x={p.x} y={p.y - 1} width={nodeW} height={p.h + 2} rx={3} fill={picked >= 0 ? '#fde8e4' : '#f1f4f4'} stroke={picked >= 0 ? '#d4452f' : '#9aa6a6'} strokeWidth={picked >= 0 ? 2 : 1} opacity={0.9} />
              {!compact && <text x={p.x + nodeW / 2} y={p.y - 6} textAnchor="middle" {...text('#1f2937', 11)} fontWeight={600} pointerEvents="none">{n.type}{picked >= 0 ? ` (${picked + 1})` : ''}</text>}
              {!compact && params.counts && <text x={p.x + nodeW / 2} y={p.y + p.h / 2} textAnchor="middle" dy="0.34em" {...text('#374151', 10)} pointerEvents="none">{n.visits}{n.repeats ? ` · 반복 ${n.repeats}` : ''}</text>}
            </g>
          )
        })}
        {!compact && <text x={left} y={14} {...text('#6b7280', 11)} data-testid="braid-readout">{pickSet.length ? `패턴 ${pickSet.map((p) => model.nodes[p].type).join(' → ')}: ${nMatch} / ${model.strands.length}개 시퀀스` : `시퀀스 ${model.strands.length}개 · 선 교차 ${model.crossings}회 · 색 = ${model.groups.join(' / ')}`}</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function BraidControls({ params, setParams, table, mapping }: ControlsProps<BraidParams>) {
  const rec = useMemo(() => readEvents(table, mapping), [table, mapping])
  const model = useMemo(() => (rec && rec.length ? braid(rec, params.sort) : null), [rec, params.sort])
  const color = model ? categoryColor(model.groups) : () => '#999'
  return (
    <ControlGroup title="땋기 순서와 패턴">
      <Segmented label="노드 안 가닥 정렬" value={params.sort} onChange={(sort) => setParams({ sort })} options={[{ value: 'path', label: '집단 + 다음 단계' }, { value: 'group', label: '집단' }, { value: 'entity', label: '개체 순서' }]} testId="ctl-sort" />
      <Toggle label="노드에 방문 수 표시" checked={params.counts} onChange={(counts) => setParams({ counts })} testId="ctl-counts" />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ pick: [] })} data-testid="braid-clear">패턴 선택 해제</button>
      {model && <p className="hint" data-testid="braid-stats">사건 유형 {model.nodes.length}개 · 층 {model.layers}개 · 가닥 교차 {model.crossings}회 {model.groups.map((g) => <span key={g} style={{ color: color(g), marginLeft: 6 }}>● {g}</span>)}</p>}
      <Hint>사건 유형이 노드이고 층은 사건의 전형적인 순서(앞쪽 사건이 왼쪽)입니다. 개체 한 명의 사건열이 노드를 지나는 가닥 하나이며 색은 개체의 속성(집단)입니다. 노드 안에서는 가닥을 집단별로 모으고 다음 노드 위치 순으로 늘어놓아 교차를 줄입니다. 같은 사건이 연달아 반복되면 한 번으로 줄이고 ‘반복’ 수를 적으며, 건너뛴 사건은 층을 건너 잇는 가닥으로 보입니다. 노드를 차례로 눌러 ‘이 순서로 지나는 시퀀스’ 패턴을 고릅니다.</Hint>
    </ControlGroup>
  )
}

export const braidModule: VizModule<BraidParams> = {
  roles: [
    { key: 'entity', label: '개체', type: 'category', required: true, prefer: '개체|id' },
    { key: 'order', label: '순서(시점)', type: 'number', required: true, prefer: '순서|시점|order' },
    { key: 'event', label: '사건', type: 'category', required: true, prefer: '사건|event' },
    { key: 'group', label: '속성(집단)', type: 'category', prefer: '집단|group' },
  ],
  datasets: ['care-braids'],
  defaultParams: { sort: 'path', pick: [], counts: true },
  Chart: BraidChart,
  Controls: BraidControls,
  hint: '노드를 순서대로 눌러 그 순서로 지나는 시퀀스만 고릅니다 · 가닥에 올리면 개체의 사건열',
}
