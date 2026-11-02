import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Select, Segmented, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber } from '../../data/table'
import { categoryColor, schemes } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { defaultKelp, kelp, type Pt } from '../../stats/sets8'
import { textWidthEm } from '../../stats/struct7'
import { assignLanes, flowstrates, lifeFlow, lifeFlowLayout, matchesPattern, type FlowNode, type Seq } from '../../stats/tempo8'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'

// ───────────────────────────── LifeFlow ─────────────────────────────

export interface LifeFlowParams { maxDepth: number; minCount: number; p1: string; p2: string; labels: boolean }

function readSeqs(table: ChartProps<unknown>['table'], mapping: ChartProps<unknown>['mapping']): Seq[] {
  const ii = columnIndex(table, roleColumn(mapping, 'id')), ei = columnIndex(table, roleColumn(mapping, 'event')), ti = columnIndex(table, roleColumn(mapping, 'time'))
  if (ii < 0 || ei < 0 || ti < 0) return []
  const m = new Map<string, Seq>()
  for (const r of table.rows) {
    const id = toLabel(r[ii]).trim(), type = toLabel(r[ei]).trim(), t = toNumber(r[ti])
    if (!id || !type || t == null) continue
    let s = m.get(id)
    if (!s) { s = { id, events: [] }; m.set(id, s) }
    s.events.push({ type, t })
  }
  return [...m.values()]
}

/** Removes nodes with fewer than `min` records (and their subtrees), keeping the ids consecutive. */
function prune(nodes: readonly FlowNode[], min: number): { nodes: FlowNode[]; origin: number[] } {
  const keep: number[] = []
  const map = new Map<number, number>()
  const walk = (id: number) => { map.set(id, keep.length); keep.push(id); for (const c of nodes[id].children) if (nodes[c].count >= min) walk(c) }
  walk(0)
  return { nodes: keep.map((old) => ({ ...nodes[old], id: map.get(old)!, parent: nodes[old].parent < 0 ? -1 : map.get(nodes[old].parent)!, children: nodes[old].children.filter((c) => map.has(c)).map((c) => map.get(c)!) })), origin: keep }
}

function LifeFlowChart({ table, mapping, params, width, height, compact, linked }: ChartProps<LifeFlowParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const seqs = useMemo(() => readSeqs(table, mapping), [table, mapping])
  const model = useMemo(() => {
    if (!seqs.length) return null
    const full = lifeFlow(seqs, params.maxDepth)
    const { nodes, origin } = prune(full, params.minCount)
    const pat = [params.p1, params.p2].filter(Boolean)
    const matched = pat.length ? seqs.filter((s) => matchesPattern(s, pat)) : []
    // matched records per node: follow the same prefix path through the full tree
    const matchCount = new Map<number, number>()
    if (pat.length) {
      for (const s of matched) {
        let at = 0
        for (const e of [...s.events].sort((a, b) => a.t - b.t).slice(0, params.maxDepth)) {
          const next = full[at].children.find((c) => full[c].type === e.type)
          if (next == null) break
          matchCount.set(next, (matchCount.get(next) ?? 0) + 1)
          at = next
        }
      }
    }
    const types = [...new Set(seqs.flatMap((s) => s.events.map((e) => e.type)))]
    return { full, nodes, origin, matched, matchCount, pat, types }
  }, [seqs, params.maxDepth, params.minCount, params.p1, params.p2])
  if (!model) return <ChartMessage>기록(범주), 사건(범주), 시점(숫자) 열을 선택하세요.</ChartMessage>
  const { nodes, origin, matched, matchCount, types } = model
  const m = compact ? { l: 4, r: 4, t: 4, b: 4 } : { l: 10, r: 20, t: 26, b: 28 }
  const iw = width - m.l - m.r, ih = height - m.t - m.b
  const lay = lifeFlowLayout(nodes, iw, ih)
  const color = categoryColor(types)
  const total = nodes[0].count
  const maxX = Math.max(1e-9, ...nodes.map((n) => { let s = 0; for (let v = n.id; v > 0; v = nodes[v].parent) s += nodes[v].meanGap; return s }))
  const span = (iw - 64) / maxX
  const marked = new Set(linked?.rows ?? [])
  void marked
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" onPointerLeave={hide}
        aria-label={`LifeFlow: 기록 ${total}개의 사건 시퀀스를 집계한 흐름, 표시 노드 ${nodes.length - 1}개${model.pat.length ? `, 패턴 ${model.pat.join('→')} 일치 ${matched.length}개` : ''}`}>
        <g transform={`translate(${m.l},${m.t})`}>
          {nodes.filter((n) => n.id).map((n) => {
            const L = lay[n.id], P = lay[n.parent]
            const mc = matchCount.get(origin[n.id]) ?? 0
            const dim = model.pat.length > 0 && mc === 0
            return (
              <g key={n.id} data-testid="lifeflow-node" opacity={dim ? 0.25 : 1}
                onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{n.type}</b> (단계 {n.depth})<br />기록 {n.count}개 ({fmt((n.count / total) * 100, 1)}%) · 여기서 끝 {n.ended}개<br />직전 사건 후 평균 {fmt(n.meanGap, 1)}일{model.pat.length ? <><br />패턴 일치 {mc}개</> : null}</>) }} onPointerLeave={hide}>
                {n.parent > 0 && <path d={`M${P.x1},${Math.min(P.y1, Math.max(P.y0, L.y0))}L${L.x0},${L.y0}L${L.x0},${L.y1}L${P.x1},${Math.min(P.y1, L.y1)}Z`} fill={color(n.type)} fillOpacity={0.14} />}
                <rect x={L.x0} y={L.y0} width={Math.max(2, L.x1 - L.x0)} height={Math.max(1, L.y1 - L.y0)} fill={color(n.type)} fillOpacity={0.85} stroke="#fff" strokeWidth={0.7} />
                {mc > 0 && <rect x={L.x0} y={L.y0} width={Math.max(2, L.x1 - L.x0)} height={Math.max(1, ((L.y1 - L.y0) * mc) / Math.max(1, n.count))} fill="#111" fillOpacity={0.55} />}
                {!compact && params.labels && L.x1 - L.x0 > 34 && L.y1 - L.y0 > 11 && <text x={L.x0 + 4} y={L.y0 + 11} fontSize={10} fill="#fff" style={{ pointerEvents: 'none' }}>{n.type}</text>}
              </g>
            )
          })}
          {!compact && (() => { const ticks = d3.range(0, Math.floor(maxX) + 1, Math.max(1, Math.round(maxX / 8))); return ticks.map((t) => <g key={t}><line x1={t * span} x2={t * span} y1={ih} y2={ih + 4} stroke="#9aa3ad" /><text x={t * span} y={ih + 16} textAnchor="middle" className="radar-level">{t}</text></g>) })()}
          {!compact && <text x={iw} y={ih + 26} textAnchor="end" className="radar-level">시작 이후 평균 경과 일수(막대 길이 = 직전 사건과의 평균 간격)</text>}
          {!compact && <text x={0} y={-10} className="radar-level" data-testid="lifeflow-stats">기록 {total}개{model.pat.length ? ` · ‘${model.pat.join(' → ')}’ 패턴을 거친 기록 ${matched.length}개 (${fmt((matched.length / total) * 100, 1)}%)` : ''} · 막대 두께 = 기록 수</text>}
        </g>
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function LifeFlowControls({ params, setParams, table, mapping }: ControlsProps<LifeFlowParams>) {
  const ei = columnIndex(table, roleColumn(mapping, 'event'))
  const types = ei >= 0 ? [...new Set(table.rows.map((r) => toLabel(r[ei]).trim()).filter(Boolean))] : []
  const opts = [{ value: '', label: '(없음)' }, ...types.map((t) => ({ value: t, label: t }))]
  return (
    <ControlGroup title="집계와 패턴 검색">
      <Slider label="볼 사건 단계 수" value={params.maxDepth} min={2} max={8} onChange={(maxDepth) => setParams({ maxDepth })} testId="ctl-depth" />
      <Slider label="표시할 최소 기록 수" value={params.minCount} min={1} max={30} onChange={(minCount) => setParams({ minCount })} testId="ctl-mincount" />
      <Select label="패턴: 먼저 일어난 사건" value={params.p1} options={opts} onChange={(p1) => setParams({ p1 })} testId="ctl-p1" />
      <Select label="패턴: 이어서 일어난 사건" value={params.p2} options={opts} onChange={(p2) => setParams({ p2 })} testId="ctl-p2" />
      <Toggle label="사건 이름 표시" checked={params.labels} onChange={(labels) => setParams({ labels })} testId="ctl-labels" />
      <Hint>모든 기록의 사건 순서를 앞에서부터 합쳐 하나의 나무로 만듭니다(같은 사건 순서로 시작하는 기록은 같은 막대를 공유). 막대의 두께는 그 지점을 지나는 기록 수, 길이는 직전 사건과의 평균 시간 간격입니다. 패턴(A 다음 B, 중간에 다른 사건이 끼어도 됨)을 고르면 그 패턴을 거친 기록의 몫이 검게 표시됩니다. 이벤트 래스터·라이프라인은 기록을 하나씩 늘어놓지만 라이프플로는 집계해 전체 경로의 분기를 한눈에 보입니다. 시퀀스 정렬·유사도 군집은 구현하지 않았습니다.</Hint>
    </ControlGroup>
  )
}

export const lifeFlowModule: VizModule<LifeFlowParams> = {
  roles: [
    { key: 'id', label: '기록(개체)', type: 'category', required: true },
    { key: 'event', label: '사건 종류', type: 'category', required: true },
    { key: 'time', label: '시점', type: 'number', required: true, prefer: '시점|time|시간' },
  ],
  datasets: ['care-pathways'],
  defaultParams: { maxDepth: 5, minCount: 3, p1: '', p2: '', labels: true },
  Chart: LifeFlowChart,
  Controls: LifeFlowControls,
  hint: '막대에 올려 기록 수와 평균 간격 확인 · 패턴을 골라 그 경로를 거친 기록의 몫 보기',
}

// ───────────────────────────── TimeSets ─────────────────────────────

export interface TimeSetsParams { radius: number; fusion: number; labels: boolean; focus: number }

function TimeSetsChart({ table, mapping, params, width, height, compact, linked }: ChartProps<TimeSetsParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const setCols = roleColumns(mapping, 'sets')
  const model = useMemo(() => {
    const ti = columnIndex(table, roleColumn(mapping, 'time')), li = columnIndex(table, roleColumn(mapping, 'label'))
    const si = setCols.map((c) => columnIndex(table, c))
    if (ti < 0 || si.length < 2 || si.some((i) => i < 0)) return null
    const rows: number[] = [], time: number[] = [], names: string[] = []
    table.rows.forEach((r, i) => { const t = toNumber(r[ti]); if (t == null) return; rows.push(i); time.push(t); names.push(li >= 0 ? toLabel(r[li]) : `사건 ${i + 1}`) })
    if (rows.length < 2) return null
    const member = si.map((c) => rows.map((i) => (toNumber(table.rows[i][c]) ?? 0) > 0))
    return { rows, time, names, member }
  }, [table, mapping, setCols.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  const scene = useMemo(() => {
    if (!model) return null
    const m = compact ? { l: 10, r: 10, t: 10, b: 10 } : { l: 30, r: 40, t: 20, b: 34 }
    const iw = width - m.l - m.r, ih = height - m.t - m.b
    const x = d3.scaleLinear().domain(d3.extent(model.time) as [number, number]).range([m.l, m.l + iw])
    const wpx = model.names.map((n) => (compact ? 6 : textWidthEm(n) * 6.2 + 14))
    const { lane, lanes } = assignLanes(model.time.map((t) => x(t) - 6), wpx, 6)
    const laneH = Math.min(46, ih / lanes)
    const yAt = (i: number) => m.t + (lane[i] + 0.5) * laneH + (ih - lanes * laneH) / 2
    const px: Pt[] = model.time.map((t, i) => [x(t), yAt(i)])
    const regions = model.member.map((mm) => kelp(px, mm, width, height, { ...defaultKelp, radius: params.radius, fusion: params.fusion, cell: compact ? 8 : 5, waist: 0.4, avoid: 0.9 }))
    return { m, iw, ih, x, px, regions, lanes }
  }, [model, width, height, compact, params.radius, params.fusion])
  if (!model || !scene) return <ChartMessage>시점(숫자)과 집합 열(0/1 소속) 2개 이상을 선택하세요.</ChartMessage>
  const color = categoryColor(setCols)
  const marked = new Set(linked?.rows ?? [])
  const ticks = scene.x.ticks(8)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" onPointerLeave={hide}
        aria-label={`TimeSets: 사건 ${model.rows.length}개를 시간 축에 놓고 집합 ${setCols.length}개의 영역을 표시`}>
        {!compact && ticks.map((t) => <g key={t}><line x1={scene.x(t)} x2={scene.x(t)} y1={scene.m.t} y2={scene.m.t + scene.ih} stroke="#f0f2f4" /><text x={scene.x(t)} y={height - 14} textAnchor="middle" className="radar-level">{t}</text></g>)}
        {scene.regions.map((r, s) => (
          <path key={s} d={r.rings.map((ring) => `M${ring.map((p) => p.join(',')).join('L')}Z`).join('')} fill={color(setCols[s])} fillOpacity={0.18} stroke={color(setCols[s])} strokeWidth={compact ? 0.8 : 1.6} fillRule="evenodd" opacity={params.focus >= 0 && params.focus !== s ? 0.12 : 1} data-testid="timeset-region" />
        ))}
        {model.time.map((_, i) => {
          const inSets = model.member.map((mm, s) => (mm[i] ? s : -1)).filter((s) => s >= 0)
          const hot = marked.has(model.rows[i])
          return (
            <g key={i} transform={`translate(${scene.px[i][0]},${scene.px[i][1]})`} data-testid="timeset-event" opacity={params.focus >= 0 && !inSets.includes(params.focus) ? 0.25 : 1}
              onPointerEnter={compact ? undefined : (e) => { linked?.set([model.rows[i]]); const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{model.names[i]}</b><br />시점 {model.time[i]}<br />{inSets.map((s) => setCols[s]).join(' · ')}</>) }} onPointerLeave={() => { hide(); linked?.set(null) }}>
              <circle r={compact ? 2.4 : 4.5} fill="#fff" stroke={hot ? '#111' : inSets.length ? color(setCols[inSets[0]]) : '#8a929b'} strokeWidth={hot ? 2.4 : 1.6} />
              {!compact && params.labels && <text x={7} y={0} dy="0.34em" className="radar-level" style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}>{model.names[i]}</text>}
            </g>
          )
        })}
        {!compact && <g transform="translate(10,12)">{setCols.map((s, i) => <g key={s} transform={`translate(${i * 90},0)`}><rect width={10} height={10} y={-9} fill={color(s)} fillOpacity={0.7} /><text x={15} className="radar-level">{s}</text></g>)}</g>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function TimeSetsControls({ params, setParams, table, mapping }: ControlsProps<TimeSetsParams>) {
  const sets = roleColumns(mapping, 'sets')
  void table
  return (
    <ControlGroup title="시간 위의 집합">
      <Slider label="영역 반지름 (px)" value={params.radius} min={8} max={30} onChange={(radius) => setParams({ radius })} testId="ctl-radius" />
      <Slider label="영역 융합 (0 = 켈프만)" value={params.fusion} min={0} max={1} step={0.05} onChange={(fusion) => setParams({ fusion })} format={(v) => v.toFixed(2)} testId="ctl-fusion" />
      <Segmented label="강조할 집합" value={String(params.focus)} onChange={(v) => setParams({ focus: Number(v) })} options={[{ value: '-1', label: '모두' }, ...sets.map((s, i) => ({ value: String(i), label: s }))]} testId="ctl-focus" />
      <Toggle label="사건 이름 표시" checked={params.labels} onChange={(labels) => setParams({ labels })} testId="ctl-labels" />
      <Hint>가로는 시간이고, 세로 위치는 이름이 겹치지 않도록 자리를 나눈 것(의미 없음)입니다. 같은 집합의 사건을 켈프 영역으로 감싸므로 영역이 시간 축을 따라 길게 이어지며 집합이 언제 활발하고 언제 다른 집합과 겹치는지 보입니다. 원 논문의 사건 지속시간·라벨 너비 표현과 상호작용 필터는 포함하지 않았습니다.</Hint>
    </ControlGroup>
  )
}

export const timeSetsModule: VizModule<TimeSetsParams> = {
  roles: [
    { key: 'label', label: '사건 이름', type: 'category', auto: true },
    { key: 'time', label: '시점', type: 'number', required: true, prefer: '시점|time|날짜' },
    { key: 'sets', label: '집합 (0/1 소속 열)', type: 'number', required: true, multiple: { min: 2, max: 6 } },
  ],
  datasets: ['timed-events'],
  defaultParams: { radius: 14, fusion: 0, labels: true, focus: -1 },
  Chart: TimeSetsChart,
  Controls: TimeSetsControls,
  hint: '사건에 올려 소속 집합 확인 · 융합 값을 올려 영역을 넓게 이어 보기',
}

// ───────────────────────────── Flowstrates ─────────────────────────────

export interface FlowstratesParams { order: 'origin' | 'dest' | 'total'; top: number; focus: string }

function FlowstratesChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<FlowstratesParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const model = useMemo(() => {
    const idx = (k: string) => columnIndex(table, roleColumn(mapping, k))
    const oi = idx('origin'), di = idx('dest'), oxi = idx('ox'), oyi = idx('oy'), dxi = idx('dx'), dyi = idx('dy'), ti = idx('time'), vi = idx('value')
    if ([oi, di, oxi, oyi, dxi, dyi, ti, vi].some((i) => i < 0)) return null
    const rows: { o: string; d: string; t: number; v: number }[] = []
    const opos = new Map<string, [number, number]>(), dpos = new Map<string, [number, number]>()
    for (const r of table.rows) {
      const o = toLabel(r[oi]).trim(), d = toLabel(r[di]).trim(), t = toNumber(r[ti]), v = toNumber(r[vi])
      const a = toNumber(r[oxi]), b = toNumber(r[oyi]), c = toNumber(r[dxi]), e = toNumber(r[dyi])
      if (!o || !d || t == null || v == null || a == null || b == null || c == null || e == null) continue
      rows.push({ o, d, t, v })
      if (!opos.has(o)) opos.set(o, [a, b])
      if (!dpos.has(d)) dpos.set(d, [c, e])
    }
    if (!rows.length) return null
    const all = [...opos.values(), ...dpos.values()]
    return { rows, opos, dpos, ex: d3.extent(all, (p) => p[0]) as [number, number], ey: d3.extent(all, (p) => p[1]) as [number, number] }
  }, [table, mapping])
  const fs = useMemo(() => (model ? flowstrates(model.rows, params.order, params.order === 'dest' ? model.dpos : model.opos) : null), [model, params.order])
  if (!model || !fs) return <ChartMessage>출발·도착, 두 지역의 좌표, 시점, 값 열을 선택하세요.</ChartMessage>
  let links = params.focus ? fs.links.filter((l) => l.o === params.focus || l.d === params.focus) : fs.links
  if (params.order === 'total') links = links.slice(0, params.top)
  else links = [...links].sort((a, b) => b.total - a.total).slice(0, params.top).sort((a, b) => fs.links.indexOf(a) - fs.links.indexOf(b))
  const m = compact ? { l: 4, r: 4, t: 4, b: 4 } : { l: 10, r: 10, t: 28, b: 14 }
  const pw = Math.max(70, (width - m.l - m.r) * 0.2)
  const mid0 = m.l + pw + (compact ? 4 : 26), mid1 = width - m.r - pw - (compact ? 4 : 26)
  const rowH = Math.max(3, Math.min(26, (height - m.t - m.b) / Math.max(1, links.length)))
  const top = m.t + ((height - m.t - m.b) - rowH * links.length) / 2
  const sx = d3.scaleLinear().domain(model.ex).range([0, pw - 20]), sy = d3.scaleLinear().domain(model.ey).range([m.t + 10, height - m.b - 10])
  const tx = d3.scaleBand<number>().domain(fs.times.map((_, i) => i)).range([mid0, mid1]).paddingInner(0.04)
  const col = (v: number) => schemes.teal.interpolate(0.08 + 0.92 * (v / Math.max(1e-9, fs.max)))
  const oPt = (id: string): Pt => [m.l + 10 + sx(model.opos.get(id)![0]), sy(model.opos.get(id)![1])]
  const dPt = (id: string): Pt => [width - m.r - pw + 10 + sx(model.dpos.get(id)![0]), sy(model.dpos.get(id)![1])]
  const usedO = new Set(links.map((l) => l.o)), usedD = new Set(links.map((l) => l.d))
  const curve = (a: Pt, b: Pt) => `M${a[0]},${a[1]}C${(a[0] + b[0]) / 2},${a[1]} ${(a[0] + b[0]) / 2},${b[1]} ${b[0]},${b[1]}`
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" onPointerLeave={hide}
        aria-label={`Flowstrates: 출발 지역 ${usedO.size}곳, 도착 지역 ${usedD.size}곳, 이동 쌍 ${links.length}개의 시간별 흐름`}>
        {!compact && <><text x={m.l + 10} y={14} className="radar-axis-label">출발 지역</text><text x={width - m.r - pw + 10} y={14} className="radar-axis-label">도착 지역</text></>}
        {links.map((l, k) => (
          <g key={`${l.o}-${l.d}`} data-testid="flowstrate-row"
            onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{l.o} → {l.d}</b><br />합계 {fmt(l.total, 0)} · 최대 월 {fmt(Math.max(...l.series), 0)}</>) }} onPointerLeave={hide}>
            <path d={curve(oPt(l.o), [mid0, top + (k + 0.5) * rowH])} fill="none" stroke="#9aa3ad" strokeWidth={0.8} opacity={0.5} />
            <path d={curve([mid1, top + (k + 0.5) * rowH], dPt(l.d))} fill="none" stroke="#9aa3ad" strokeWidth={0.8} opacity={0.5} />
            {fs.times.map((t, i) => <rect key={t} x={tx(i)} y={top + k * rowH} width={tx.bandwidth()} height={Math.max(1, rowH - 1)} fill={col(l.series[i])} data-testid="flowstrate-cell" onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{l.o} → {l.d}</b><br />시점 {t}: {fmt(l.series[i], 0)}</>) }} />)}
          </g>
        ))}
        {[...usedO].map((id) => { const p = oPt(id); const on = params.focus === id; return (
          <g key={`o${id}`} data-testid="flowstrate-origin" style={{ cursor: compact ? undefined : 'pointer' }} onClick={compact ? undefined : () => setParams({ focus: on ? '' : id })}>
            <circle cx={p[0]} cy={p[1]} r={compact ? 3 : 6} fill={on ? '#111' : '#2a8c82'} stroke="#fff" /><text x={p[0] + 9} y={p[1]} dy="0.34em" className="radar-level">{compact ? '' : id}</text>
          </g>) })}
        {[...usedD].map((id) => { const p = dPt(id); const on = params.focus === id; return (
          <g key={`d${id}`} data-testid="flowstrate-dest" style={{ cursor: compact ? undefined : 'pointer' }} onClick={compact ? undefined : () => setParams({ focus: on ? '' : id })}>
            <circle cx={p[0]} cy={p[1]} r={compact ? 3 : 6} fill={on ? '#111' : '#e07a3f'} stroke="#fff" /><text x={p[0] - 9} y={p[1]} dy="0.34em" textAnchor="end" className="radar-level">{compact ? '' : id}</text>
          </g>) })}
        {!compact && fs.times.map((t, i) => (i % Math.ceil(fs.times.length / 12) === 0 ? <text key={t} x={(tx(i) ?? 0) + tx.bandwidth() / 2} y={m.t - 6} textAnchor="middle" className="radar-level">{t}</text> : null))}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function FlowstratesControls({ params, setParams }: ControlsProps<FlowstratesParams>) {
  return (
    <ControlGroup title="행 정렬과 선택">
      <Segmented label="이동 쌍(행) 정렬" value={params.order} onChange={(order) => setParams({ order })} options={[{ value: 'origin', label: '출발 위치' }, { value: 'dest', label: '도착 위치' }, { value: 'total', label: '합계' }]} testId="ctl-order" />
      <Slider label="표시할 이동 쌍 수" value={params.top} min={3} max={30} onChange={(top) => setParams({ top })} testId="ctl-top" />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ focus: '' })} data-testid="flowstrate-clear">지역 선택 해제</button>
      <Hint>왼쪽은 출발 지역, 오른쪽은 도착 지역(같은 좌표 범위)이고 가운데는 이동 쌍마다 한 줄인 시간×값 히트맵입니다. 선은 출발 지역에서 그 줄의 왼쪽으로, 줄의 오른쪽에서 도착 지역으로 이어집니다. 지역 점을 누르면 그 지역이 출발·도착인 쌍만 남습니다. 이 구현의 ‘지도’는 지도 타일이 아니라 지역 좌표를 찍은 도식입니다.</Hint>
    </ControlGroup>
  )
}

export const flowstratesModule: VizModule<FlowstratesParams> = {
  roles: [
    { key: 'origin', label: '출발 지역', type: 'category', required: true },
    { key: 'dest', label: '도착 지역', type: 'category', required: true },
    { key: 'ox', label: '출발 x', type: 'number', required: true, prefer: '출발 x' }, { key: 'oy', label: '출발 y', type: 'number', required: true, prefer: '출발 y' },
    { key: 'dx', label: '도착 x', type: 'number', required: true, prefer: '도착 x' }, { key: 'dy', label: '도착 y', type: 'number', required: true, prefer: '도착 y' },
    { key: 'time', label: '시점', type: 'number', required: true, prefer: '월|시점|time' },
    { key: 'value', label: '이동량', type: 'number', required: true, prefer: '이동량|값|value' },
  ],
  datasets: ['od-timeseries'],
  defaultParams: { order: 'origin', top: 15, focus: '' },
  Chart: FlowstratesChart,
  Controls: FlowstratesControls,
  hint: '지역 점을 눌러 그 지역의 이동만 보기 · 정렬을 바꿔 선의 엉킴 비교',
}
