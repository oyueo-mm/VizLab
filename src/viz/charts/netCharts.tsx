import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { ChartMessage, Legend, Readout, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, type DataTable } from '../../data/table'
import { categoryColor } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { buildTree } from '../../stats/hierarchy'
import { buildNetwork } from '../../stats/network'
import { bioFabric, classicVenn, eulerLayout, exclusiveIntersections, inclusiveCount, jaccard, regionAreas, type Circle } from '../../stats/sets'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'
import { edgeRoles, edgeRows } from './networkShared'

/** Set and network charts: Euler/Venn, UpSet, hypergraph (set hulls), BioFabric and radial tree. */

// ─── set-membership input ───────────────────────────────────────────────────────────

interface SetData { names: string[]; items: string[]; member: boolean[][]; sizes: number[] }

function setData(table: DataTable, mapping: Mapping): SetData {
  const cols = roleColumns(mapping, 'sets')
  const ci = cols.map((c) => columnIndex(table, c)).filter((i) => i >= 0)
  const ni = columnIndex(table, roleColumn(mapping, 'item'))
  const member = table.rows.map((r) => ci.map((c) => (toNumber(r[c]) ?? 0) > 0))
  return { names: ci.map((i) => table.columns[i].name), items: table.rows.map((r, i) => (ni >= 0 ? toLabel(r[ni]) : `행 ${i + 1}`)), member, sizes: ci.map((_, j) => member.filter((m) => m[j]).length) }
}

const setRoles = (min: number, max: number) => [
  { key: 'item', label: '항목 이름', type: 'category' as const, auto: true },
  { key: 'sets', label: '집합 열 (1 = 속함, 0 = 안 속함)', type: 'number' as const, required: true, multiple: { min, max } },
]

const NEED_SETS = '집합 열(숫자형: 1 = 속함, 0 = 안 속함)을 2개 이상 선택하세요.'

// ─── Euler / Venn ───────────────────────────────────────────────────────────────────

export interface VennParams { mode: 'euler' | 'classic'; a: number; b: number; c: number; labels: 'count' | 'percent' }

function VennChart({ table, mapping, params, width, height, compact, linked }: ChartProps<VennParams>) {
  const data = useMemo(() => setData(table, mapping), [table, mapping])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const k0 = data.names.length
  const pick = useMemo(() => {
    const raw = [params.a, params.b, params.c].filter((v) => v >= 0 && v < k0)
    return raw.filter((v, i) => raw.indexOf(v) === i).slice(0, 3)
  }, [params.a, params.b, params.c, k0])
  const sub = useMemo(() => data.member.map((m) => pick.map((p) => m[p])), [data.member, pick])
  const k = pick.length
  const sizes = useMemo(() => pick.map((p) => data.sizes[p]), [pick, data.sizes])
  const pair = useMemo(() => pick.map((_, i) => pick.map((__, j) => (i === j ? sizes[i] : inclusiveCount(sub, (1 << i) | (1 << j))))), [pick, sizes, sub])
  const ex = useMemo(() => exclusiveIntersections(sub, k), [sub, k])
  const circles = useMemo<Circle[]>(() => (k < 1 ? [] : params.mode === 'euler' && sizes.every((s) => s > 0) ? eulerLayout(sizes, pair) : classicVenn(k)), [k, params.mode, sizes, pair])
  const regions = useMemo(() => regionAreas(circles, compact ? 120 : 260), [circles, compact])
  if (k0 < 2) return <ChartMessage>{NEED_SETS}</ChartMessage>
  if (k < 2) return <ChartMessage>서로 다른 집합을 2개 이상 고르세요.</ChartMessage>
  const x0 = Math.min(...circles.map((c) => c.x - c.r)), x1 = Math.max(...circles.map((c) => c.x + c.r)), y0 = Math.min(...circles.map((c) => c.y - c.r)), y1 = Math.max(...circles.map((c) => c.y + c.r))
  const padX = compact ? 6 : 40, padTop = compact ? 6 : 60, padBottom = compact ? 6 : 40
  const sc = Math.min((width - 2 * padX) / (x1 - x0 || 1), (height - padTop - padBottom) / (y1 - y0 || 1))
  const ox = width / 2 - ((x0 + x1) / 2) * sc, oy = padTop + (height - padTop - padBottom) / 2 - ((y0 + y1) / 2) * sc
  const color = categoryColor(pick.map((p) => data.names[p]))
  const union = ex.reduce((s, e) => s + e.count, 0)
  const drawnTotal = regions.reduce((s, r) => s + r.area, 0)
  // representation error: how far the drawn region shares are from the true shares of the union (0 = perfectly proportional)
  const err = 0.5 * regions.reduce((s, r) => { const t = (ex.find((e) => e.mask === r.mask)?.count ?? 0) / (union || 1); return s + Math.abs(r.area / (drawnTotal || 1) - t) }, 0) + 0.5 * ex.reduce((s, e) => s + (regions.some((r) => r.mask === e.mask) ? 0 : e.count / (union || 1)), 0)
  const maskAt = (px: number, py: number) => {
    const x = (px - ox) / sc, y = (py - oy) / sc
    let mask = 0
    circles.forEach((c, i) => { if ((x - c.x) ** 2 + (y - c.y) ** 2 <= c.r * c.r) mask |= 1 << i })
    return mask
  }
  const label = (n: number) => (params.labels === 'percent' ? `${((n / (union || 1)) * 100).toFixed(0)}%` : String(n))
  const cx0 = d3.mean(circles, (c) => c.x)!, cy0 = d3.mean(circles, (c) => c.y)!
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`${params.mode === 'euler' ? '오일러' : '벤'} 다이어그램: 집합 ${k}개, 합집합 ${union}개`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g>
          {circles.map((c, i) => <circle key={i} data-testid="venn-circle" data-size={sizes[i]} cx={ox + c.x * sc} cy={oy + c.y * sc} r={c.r * sc} fill={color(data.names[pick[i]])} fillOpacity={0.3} stroke={color(data.names[pick[i]])} strokeWidth={2} />)}
          {!compact && regions.map((r) => {
            const e = ex.find((q) => q.mask === r.mask)
            const big = r.area * sc * sc > 520
            if (!e || !big) return null
            const t = label(e.count)
            return <g key={r.mask} data-testid="venn-region" data-count={e.count} data-mask={r.mask}><rect x={ox + r.cx * sc - 4 - t.length * 4.3} y={oy + r.cy * sc - 11} width={t.length * 8.6 + 8} height={22} rx={6} fill="#fff" fillOpacity={0.82} /><text x={ox + r.cx * sc} y={oy + r.cy * sc} dy="0.34em" textAnchor="middle" fontSize={13} fontWeight={600} fill="#111827">{t}</text></g>
          })}
          {!compact && circles.map((c, i) => {
            const dx = c.x - cx0, dy = c.y - cy0, n = Math.hypot(dx, dy) || 1
            const lx = ox + (c.x + (dx / n) * c.r * 1.0) * sc + (dx / n) * 12, ly = oy + (c.y + (dy / n) * c.r) * sc + (dy / n) * 14
            return <text key={i} x={lx} y={ly} textAnchor={Math.abs(dx / n) < 0.3 ? 'middle' : dx > 0 ? 'start' : 'end'} fontSize={13} fontWeight={600} fill={color(data.names[pick[i]])}>{data.names[pick[i]]} ({sizes[i]})</text>
          })}
          {!compact && <rect width={width} height={height} fill="transparent" onPointerMove={(e) => {
            const l = localPoint(svgRef.current!, e)
            const mask = maskAt(l.x, l.y)
            const found = ex.find((q) => q.mask === mask)
            if (!mask || !found) { hide(); linked?.set(null); return }
            linked?.set(found.rows)
            show(l.x, l.y, <><b>{found.sets.map((i) => data.names[pick[i]]).join(' ∩ ')}</b>{found.sets.length < k ? <> (나머지 집합에는 속하지 않음)</> : null}<br />{found.count}개 ({((found.count / (union || 1)) * 100).toFixed(1)}%)<br />{found.rows.slice(0, 3).map((r) => data.items[r]).join(', ')}{found.rows.length > 3 ? ' …' : ''}</>)
          }} />}
        </g>
      </svg>
      {!compact && <><Legend items={pick.map((p) => ({ key: data.names[p], color: color(data.names[p]) }))} /><Readout items={[{ label: '합집합', value: union }, { label: '모두의 교집합', value: ex.find((e) => e.degree === k)?.count ?? 0 }, ...(k === 2 ? [{ label: 'Jaccard', value: jaccard(sizes[0], sizes[1], pair[0][1]).toFixed(2) }] : []), ...(params.mode === 'euler' ? [{ label: '면적 오차', value: `${(err * 100).toFixed(1)}%` }] : [])]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function VennControls({ params, setParams, table, mapping }: ControlsProps<VennParams>) {
  const names = useMemo(() => setData(table, mapping).names, [table, mapping])
  const opts = names.map((n, i) => ({ value: String(i), label: n }))
  return (
    <ControlGroup title="오일러·벤 다이어그램">
      <Segmented label="원의 크기" value={params.mode} onChange={(mode) => setParams({ mode })} testId="ctl-venn-mode" options={[{ value: 'euler', label: '면적 비례 (오일러)' }, { value: 'classic', label: '같은 크기 (벤)' }]} />
      <Select label="집합 1" value={String(params.a)} onChange={(v) => setParams({ a: Number(v) })} options={opts} testId="ctl-venn-a" />
      <Select label="집합 2" value={String(params.b)} onChange={(v) => setParams({ b: Number(v) })} options={opts} testId="ctl-venn-b" />
      <Select label="집합 3 (선택)" value={String(params.c)} onChange={(v) => setParams({ c: Number(v) })} options={[{ value: '-1', label: '사용 안 함' }, ...opts]} testId="ctl-venn-c" />
      <Segmented label="영역 숫자" value={params.labels} onChange={(labels) => setParams({ labels })} options={[{ value: 'count', label: '개수' }, { value: 'percent', label: '비율' }]} />
      <Hint>벤 다이어그램은 같은 크기의 원으로 모든 조합 영역을 보여 주고, 오일러 다이어그램은 원의 넓이를 집합의 크기에 비례시켜 겹침의 크기까지 읽게 합니다. 두 집합은 겹치는 넓이를 정확히 맞출 수 있지만 세 집합은 세 쌍의 겹침을 동시에 맞춘 뒤 가운데 영역은 근사가 되므로 위쪽의 면적 오차(진짜 비율과 그려진 비율의 차이)를 함께 봅니다. 집합이 4개 이상이면 원으로 모든 조합을 그릴 수 없어 UpSet 도표가 낫습니다. 숫자는 다른 집합에 속하지 않고 그 영역에만 속한 개수입니다.</Hint>
    </ControlGroup>
  )
}

export const vennModule: VizModule<VennParams> = {
  roles: setRoles(2, 8),
  datasets: ['set-members'],
  defaultParams: { mode: 'euler', a: 0, b: 1, c: 2, labels: 'count' },
  Chart: VennChart,
  Controls: VennControls,
  hint: '영역에 포인터를 올리면 그 조합의 개수와 예시 · 면적 비례와 같은 크기 모드를 번갈아 보세요',
}

// ─── UpSet ──────────────────────────────────────────────────────────────────────────

export interface UpsetParams { sort: 'size' | 'degree' | 'sets'; minCount: number; maxCombos: number; mode: 'exclusive' | 'inclusive'; sortSets: boolean }

function UpsetChart({ table, mapping, params, width, height, compact, linked }: ChartProps<UpsetParams>) {
  const data = useMemo(() => setData(table, mapping), [table, mapping])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const k = data.names.length
  const order = useMemo(() => { const o = data.names.map((_, i) => i); return params.sortSets ? o.sort((a, b) => data.sizes[b] - data.sizes[a]) : o }, [data, params.sortSets])
  const combos = useMemo(() => {
    const ex = exclusiveIntersections(data.member, k)
    const withCount = ex.map((e) => ({ ...e, value: params.mode === 'exclusive' ? e.count : inclusiveCount(data.member, e.mask) }))
    const cmp = params.sort === 'size' ? (a: (typeof withCount)[number], b: (typeof withCount)[number]) => b.value - a.value || a.degree - b.degree
      : params.sort === 'degree' ? (a: (typeof withCount)[number], b: (typeof withCount)[number]) => a.degree - b.degree || b.value - a.value
        : (a: (typeof withCount)[number], b: (typeof withCount)[number]) => { const ra = a.sets.map((s) => order.indexOf(s)).sort((x, y) => x - y), rb = b.sets.map((s) => order.indexOf(s)).sort((x, y) => x - y); for (let i = 0; i < Math.min(ra.length, rb.length); i++) if (ra[i] !== rb[i]) return ra[i] - rb[i]; return ra.length - rb.length }
    return withCount.filter((c) => c.value >= params.minCount).sort(cmp).slice(0, compact ? 12 : params.maxCombos)
  }, [data, k, params.mode, params.sort, params.minCount, params.maxCombos, order, compact])
  const linkedSet = useMemo(() => new Set(linked?.rows ?? []), [linked?.rows])
  if (k < 2) return <ChartMessage>{NEED_SETS}</ChartMessage>
  if (!combos.length) return <ChartMessage>조건에 맞는 조합이 없습니다. 최소 개수를 낮추세요.</ChartMessage>
  const rowH = Math.max(14, Math.min(30, (height - (compact ? 60 : 190)) / k))
  const leftW = compact ? 0 : Math.min(190, width * 0.26)
  const matrixTop = Math.max(60, height - (compact ? 8 : 20) - k * rowH)
  const barTop = compact ? 6 : 30
  const gw = Math.max(40, width - leftW - (compact ? 10 : 24)), cw = gw / combos.length
  const maxV = Math.max(...combos.map((c) => c.value))
  const yBar = d3.scaleLinear([0, maxV], [matrixTop - 8, barTop + 6])
  const maxSet = Math.max(...data.sizes, 1)
  const setW = d3.scaleLinear([0, maxSet], [0, Math.max(30, leftW - 90)])
  const color = categoryColor(data.names)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`UpSet 도표: 집합 ${k}개, 조합 ${combos.length}개`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        {!compact && order.map((s, rIdx) => rIdx % 2 === 0 ? <rect key={`z${s}`} x={0} y={matrixTop + rIdx * rowH} width={leftW + gw} height={rowH} fill="#f3f6f5" /> : null)}
        <g transform={`translate(${leftW},0)`}>
          {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={0} x2={gw} y1={yBar(maxV * f)} y2={yBar(maxV * f)} stroke="#e8ecea" />)}
          {!compact && [0, 0.5, 1].map((f) => <text key={f} x={-6} y={yBar(maxV * f)} dy="0.32em" textAnchor="end" fontSize={10.5} fill="#6b7773">{Math.round(maxV * f)}</text>)}
          {combos.map((c, i) => {
            const hot = linkedSet.size > 0 && c.rows.some((r) => linkedSet.has(r))
            const rowsOf = c.sets.map((s) => order.indexOf(s))
            const top = Math.min(...rowsOf), bot = Math.max(...rowsOf)
            return (
              <g key={c.mask} data-testid="upset-col" data-count={c.value} data-degree={c.degree}
                onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); linked?.set(c.rows); show(l.x, l.y, <><b>{c.sets.map((s) => data.names[s]).join(' ∩ ')}</b><br />{params.mode === 'exclusive' ? '이 조합에만 속함' : '이 조합을 포함'}: {c.value}개{params.mode === 'inclusive' ? <><br />이 조합에만 속함: {c.count}개</> : null}</>) }} onPointerLeave={() => { hide(); linked?.set(null) }}>
                <rect x={i * cw} y={0} width={cw} height={height} fill={hot ? '#2a8c82' : 'transparent'} fillOpacity={0.08} />
                <rect data-testid="upset-bar" x={i * cw + cw * 0.18} y={yBar(c.value)} width={cw * 0.64} height={Math.max(0, matrixTop - 8 - yBar(c.value))} fill={hot ? '#1d6f66' : '#374151'} />
                {!compact && cw > 16 && <text x={i * cw + cw / 2} y={yBar(c.value) - 4} fontSize={10.5} textAnchor="middle" fill="#374151">{c.value}</text>}
                {rowsOf.length > 1 && <line x1={i * cw + cw / 2} x2={i * cw + cw / 2} y1={matrixTop + top * rowH + rowH / 2} y2={matrixTop + bot * rowH + rowH / 2} stroke="#374151" strokeWidth={2.4} />}
                {order.map((s, rIdx) => <circle key={s} cx={i * cw + cw / 2} cy={matrixTop + rIdx * rowH + rowH / 2} r={Math.max(2.5, Math.min(rowH * 0.32, cw * 0.36))} fill={c.sets.includes(s) ? '#374151' : '#e1e6e4'} />)}
              </g>
            )
          })}
        </g>
        {!compact && order.map((s, rIdx) => (
          <g key={s} transform={`translate(0,${matrixTop + rIdx * rowH})`}>
            <rect x={leftW - 90 - setW(data.sizes[s])} y={rowH * 0.2} width={setW(data.sizes[s])} height={rowH * 0.6} fill={color(data.names[s])} data-testid="upset-setbar" />
            <text x={leftW - 84} y={rowH / 2} dy="0.32em" fontSize={11.5} fill="#111827">{data.names[s]}</text>
            <text x={leftW - 94 - setW(data.sizes[s])} y={rowH / 2} dy="0.32em" textAnchor="end" fontSize={10.5} fill="#6b7773">{data.sizes[s]}</text>
          </g>
        ))}
      </svg>
      {!compact && <><Readout items={[{ label: '집합', value: k }, { label: '조합', value: combos.length }, { label: '항목', value: data.member.length }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function UpsetControls({ params, setParams }: ControlsProps<UpsetParams>) {
  return (
    <ControlGroup title="UpSet 도표">
      <Segmented label="막대의 의미" value={params.mode} onChange={(mode) => setParams({ mode })} testId="ctl-upset-mode" options={[{ value: 'exclusive', label: '그 조합에만 속함' }, { value: 'inclusive', label: '그 조합을 포함' }]} />
      <Select label="조합 정렬" value={params.sort} onChange={(sort) => setParams({ sort })} testId="ctl-upset-sort" options={[{ value: 'size', label: '개수 큰 순' }, { value: 'degree', label: '집합 수 적은 순' }, { value: 'sets', label: '집합 순서' }]} />
      <Slider label="최소 개수" value={params.minCount} min={0} max={30} onChange={(minCount) => setParams({ minCount })} testId="ctl-upset-min" />
      <Slider label="표시할 조합 수" value={params.maxCombos} min={4} max={40} onChange={(maxCombos) => setParams({ maxCombos })} />
      <Toggle label="큰 집합을 위쪽에" checked={params.sortSets} onChange={(sortSets) => setParams({ sortSets })} />
      <Hint>UpSet 도표는 벤 다이어그램으로 그릴 수 없는 4개 이상의 집합에서 모든 교집합 조합을 보여 줍니다. 아래 점 행렬의 채워진 점이 그 조합에 들어 있는 집합이고, 위쪽 막대는 그 조합에 속한 항목의 수이며, 왼쪽 막대는 집합 전체의 크기입니다. 기본은 정확히 그 조합에만 속한 항목을 세어(서로 겹치지 않음) 막대 합이 전체 항목 수와 같고, 포함 모드는 그 조합을 포함한 더 큰 조합의 항목까지 세어 같은 항목이 여러 막대에 나타납니다.</Hint>
    </ControlGroup>
  )
}

export const upsetModule: VizModule<UpsetParams> = {
  roles: setRoles(2, 12),
  datasets: ['set-members'],
  defaultParams: { sort: 'size', minCount: 0, maxCombos: 20, mode: 'exclusive', sortSets: true },
  Chart: UpsetChart,
  Controls: UpsetControls,
  hint: '조합 막대에 포인터를 올리면 그 조합의 항목이 다른 차트에서도 강조됩니다 · 정렬과 막대의 의미를 바꿔 보세요',
}

// ─── hypergraph (set hulls) ─────────────────────────────────────────────────────────

export interface HyperParams { pad: number; pull: number; labels: boolean; hulls: boolean }

function HyperChart({ table, mapping, params, width, height, compact, linked }: ChartProps<HyperParams>) {
  const data = useMemo(() => setData(table, mapping), [table, mapping])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const k = data.names.length
  const n = data.member.length
  const W = width, H = height - (compact ? 0 : 40)
  const layout = useMemo(() => {
    if (k < 2 || !n) return null
    const R = Math.min(W, H) * 0.3
    const anchors = data.names.map((_, i) => { const a = (i / k) * Math.PI * 2 - Math.PI / 2; return { x: W / 2 + R * Math.cos(a), y: H / 2 + R * Math.sin(a) } })
    const nodes = data.member.map((m, i) => {
      const own = anchors.filter((_, j) => m[j])
      const tx = own.length ? d3.mean(own, (a) => a.x)! : W / 2, ty = own.length ? d3.mean(own, (a) => a.y)! : H / 2
      return { i, tx, ty, deg: own.length, x: tx + ((i * 7919) % 31) - 15, y: ty + ((i * 104729) % 29) - 14 }
    })
    const r = compact ? 2.6 : Math.max(3, Math.min(6, 340 / Math.sqrt(n + 1) / 3))
    const sim = d3.forceSimulation(nodes).force('x', d3.forceX<(typeof nodes)[number]>((d) => d.tx).strength(params.pull)).force('y', d3.forceY<(typeof nodes)[number]>((d) => d.ty).strength(params.pull)).force('collide', d3.forceCollide(r + 1.2)).stop()
    for (let i = 0; i < 240; i++) sim.tick()
    return { nodes, anchors, r }
  }, [data, k, n, W, H, params.pull, compact])
  const color = categoryColor(data.names)
  const hullPath = (j: number) => {
    if (!layout) return ''
    const pts = layout.nodes.filter((nd) => data.member[nd.i][j])
    if (!pts.length) return ''
    const pad = params.pad + layout.r
    const ring: [number, number][] = pts.flatMap((p) => Array.from({ length: 10 }, (_, t) => [p.x + pad * Math.cos((t / 10) * Math.PI * 2), p.y + pad * Math.sin((t / 10) * Math.PI * 2)] as [number, number]))
    const hull = d3.polygonHull(ring)
    return hull ? (d3.line().curve(d3.curveCatmullRomClosed.alpha(0.6))(hull) ?? '') : ''
  }
  const linkedSet = useMemo(() => new Set(linked?.rows ?? []), [linked?.rows])
  if (k < 2) return <ChartMessage>{NEED_SETS}</ChartMessage>
  if (!layout) return <ChartMessage>항목이 없습니다.</ChartMessage>
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`하이퍼그래프: 항목 ${n}개, 집합 ${k}개`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(0,${compact ? 0 : 36})`}>
          {params.hulls && data.names.map((nm, j) => <path key={nm} data-testid="hyper-hull" d={hullPath(j)} fill={color(nm)} fillOpacity={0.12} stroke={color(nm)} strokeWidth={1.6} strokeOpacity={0.8} />)}
          {layout.nodes.map((nd) => {
            const sets = data.names.filter((_, j) => data.member[nd.i][j])
            return (
              <circle key={nd.i} data-testid="hyper-node" data-degree={nd.deg} cx={nd.x} cy={nd.y} r={layout.r * (linkedSet.has(nd.i) ? 1.6 : 1)} fill={nd.deg === 1 ? color(sets[0]) : nd.deg === 0 ? '#b8c0bd' : '#374151'} stroke={linkedSet.has(nd.i) ? '#111827' : '#fff'} strokeWidth={linkedSet.has(nd.i) ? 2 : 0.8}
                onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); linked?.set([nd.i]); show(l.x, l.y, <><b>{data.items[nd.i]}</b><br />{sets.length ? sets.join(' · ') : '어느 집합에도 속하지 않음'}</>) }} onPointerLeave={() => { hide(); linked?.set(null) }} />
            )
          })}
          {!compact && params.labels && layout.anchors.map((a, j) => { const cx = W / 2, cy = H / 2, d = Math.hypot(a.x - cx, a.y - cy) || 1; return <text key={j} x={a.x + ((a.x - cx) / d) * (Math.min(W, H) * 0.2)} y={a.y + ((a.y - cy) / d) * (Math.min(W, H) * 0.2)} textAnchor="middle" fontSize={13} fontWeight={600} fill={color(data.names[j])}>{data.names[j]}</text> })}
        </g>
      </svg>
      {!compact && <><Legend items={[...data.names.map((nm) => ({ key: nm, color: color(nm) })), { key: '여러 집합에 속함', color: '#374151' }]} /><Readout items={[{ label: '항목', value: n }, { label: '여러 집합 소속', value: layout.nodes.filter((nd) => nd.deg > 1).length }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function HyperControls({ params, setParams }: ControlsProps<HyperParams>) {
  return (
    <ControlGroup title="하이퍼그래프 (집합 영역)">
      <Slider label="집합 영역 여백" value={params.pad} min={2} max={30} onChange={(pad) => setParams({ pad })} />
      <Slider label="집합 중심으로 끌어당기는 힘" value={params.pull} min={0.05} max={0.5} step={0.01} onChange={(pull) => setParams({ pull })} format={(v) => v.toFixed(2)} testId="ctl-hyper-pull" />
      <Toggle label="집합 영역(윤곽)" checked={params.hulls} onChange={(hulls) => setParams({ hulls })} />
      <Toggle label="집합 이름" checked={params.labels} onChange={(labels) => setParams({ labels })} />
      <Hint>하이퍼그래프는 한 선이 두 노드가 아니라 여러 노드를 한꺼번에 묶는 관계(여기서는 집합)를 다룹니다. 항목은 점으로, 집합은 그 구성원을 감싸는 윤곽으로 그리며 여러 집합에 속한 항목은 윤곽이 겹치는 곳에 놓입니다. 위치는 항목이 속한 집합 중심의 평균으로 끌어당기는 힘과 서로 겹치지 않으려는 힘으로 계산한 것이어서 거리 자체에 정량적 의미는 없고, 정확한 개수는 UpSet 도표가 더 낫습니다.</Hint>
    </ControlGroup>
  )
}

export const hypergraphModule: VizModule<HyperParams> = {
  roles: setRoles(2, 8),
  datasets: ['set-members'],
  defaultParams: { pad: 8, pull: 0.2, labels: true, hulls: true },
  Chart: HyperChart,
  Controls: HyperControls,
  hint: '점에 포인터를 올리면 그 항목이 속한 집합 · 끌어당기는 힘을 바꿔 겹침이 어떻게 달라지는지 보세요',
}

// ─── BioFabric ──────────────────────────────────────────────────────────────────────

export interface FabricParams { order: 'bfs' | 'degree' | 'name'; labels: boolean; weight: boolean }

function FabricChart({ table, mapping, params, width, height, compact, linked }: ChartProps<FabricParams>) {
  const rows = useMemo(() => edgeRows(table, mapping), [table, mapping])
  const net = useMemo(() => buildNetwork(rows), [rows])
  const fab = useMemo(() => bioFabric(net, params.order), [net, params.order])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const groups = useMemo(() => [...new Set(net.nodes.map((nd) => nd.group).filter(Boolean))], [net])
  const color = categoryColor(groups)
  const groupOf = useMemo(() => new Map(net.nodes.map((nd) => [nd.id, nd.group])), [net])
  const rowsOf = useMemo(() => new Map(net.nodes.map((nd) => [nd.id, nd.rows])), [net])
  const linkedSet = useMemo(() => new Set(linked?.rows ?? []), [linked?.rows])
  if (!roleColumn(mapping, 'source') || !roleColumn(mapping, 'target')) return <ChartMessage>출발 노드와 도착 노드(범주형) 열을 선택하세요.</ChartMessage>
  if (!fab.rows.length) return <ChartMessage>노드가 없습니다.</ChartMessage>
  const n = fab.rows.length, E = fab.edges.length
  const labelW = compact ? 0 : params.labels ? Math.min(90, width * 0.16) : 0
  const m = { top: compact ? 6 : 16, left: labelW + (compact ? 6 : 12), right: compact ? 6 : 16, bottom: compact ? 6 : 16 }
  const iw = Math.max(20, width - m.left - m.right), ih = Math.max(20, height - m.top - m.bottom - (compact ? 0 : 6))
  const rh = ih / Math.max(1, n), cw = iw / Math.max(1, E)
  const rowY = (i: number) => (i + 0.5) * rh, colX = (j: number) => (j + 0.5) * cw
  const span = new Map<string, [number, number]>()
  fab.edges.forEach((e, j) => { for (const id of [e.source, e.target]) { const s = span.get(id); span.set(id, s ? [Math.min(s[0], j), Math.max(s[1], j)] : [j, j]) } })
  const idx = new Map(fab.rows.map((id, i) => [id, i]))
  const wMax = Math.max(1, ...fab.edges.map((e) => e.weight || 1))
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`BioFabric: 노드 ${n}개, 연결 ${E}개`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${m.left},${m.top})`}>
          {fab.rows.map((id, i) => {
            const sp = span.get(id), c = color(groupOf.get(id) ?? '')
            const hot = (rowsOf.get(id) ?? []).some((r) => linkedSet.has(r))
            return (
              <g key={id} data-testid="fabric-node" onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); linked?.set(rowsOf.get(id) ?? []); show(l.x, l.y, <><b>{id}</b>{groupOf.get(id) ? ` · ${groupOf.get(id)}` : ''}<br />연결 {net.nodes.find((q) => q.id === id)?.degree ?? 0}개</>) }} onPointerLeave={() => { hide(); linked?.set(null) }}>
                <line x1={sp ? colX(sp[0]) - cw / 2 : 0} x2={sp ? colX(sp[1]) + cw / 2 : cw} y1={rowY(i)} y2={rowY(i)} stroke={c || '#5b6a66'} strokeWidth={Math.max(1, Math.min(3.5, rh * 0.45)) * (hot ? 1.8 : 1)} />
                <rect x={-labelW - 6} y={rowY(i) - Math.max(rh, 6) / 2} width={labelW + 6 + iw} height={Math.max(rh, 6)} fill="transparent" />
                {!compact && params.labels && rh > 8 && <text x={-6} y={rowY(i)} dy="0.32em" textAnchor="end" fontSize={Math.min(11, rh * 0.9)} fill="#374151">{id.length > 9 ? `${id.slice(0, 8)}…` : id}</text>}
              </g>
            )
          })}
          {fab.edges.map((e, j) => (
            <g key={j} data-testid="fabric-edge" onPointerEnter={compact ? undefined : (ev) => { const l = localPoint(svgRef.current!, ev); show(l.x, l.y, <><b>{e.source} — {e.target}</b>{e.weight > 1 || params.weight ? <><br />가중치 {fmt(e.weight)}</> : null}</>) }} onPointerLeave={hide}>
              <line x1={colX(j)} x2={colX(j)} y1={rowY(idx.get(e.source)!)} y2={rowY(idx.get(e.target)!)} stroke="#374151" strokeWidth={Math.max(0.8, Math.min(3, cw * 0.55)) * (params.weight ? 0.5 + (e.weight || 1) / wMax : 1)} />
              <circle cx={colX(j)} cy={rowY(idx.get(e.source)!)} r={Math.max(1.2, Math.min(3, cw * 0.5, rh * 0.5))} fill="#374151" />
              <circle cx={colX(j)} cy={rowY(idx.get(e.target)!)} r={Math.max(1.2, Math.min(3, cw * 0.5, rh * 0.5))} fill="#374151" />
            </g>
          ))}
        </g>
      </svg>
      {!compact && <><Legend items={groups.map((g) => ({ key: g, color: color(g) }))} /><Readout items={[{ label: '노드', value: n }, { label: '연결', value: E }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function FabricControls({ params, setParams }: ControlsProps<FabricParams>) {
  return (
    <ControlGroup title="BioFabric">
      <Select label="노드(행) 순서" value={params.order} onChange={(order) => setParams({ order })} testId="ctl-fabric-order" options={[{ value: 'bfs', label: '너비 우선 탐색 (이웃끼리 가깝게)' }, { value: 'degree', label: '연결 많은 순' }, { value: 'name', label: '이름순' }]} />
      <Toggle label="노드 이름" checked={params.labels} onChange={(labels) => setParams({ labels })} />
      <Toggle label="연결 가중치를 선 굵기로" checked={params.weight} onChange={(weight) => setParams({ weight })} />
      <Hint>BioFabric은 노드를 점이 아니라 가로선 하나로, 연결을 두 노드의 가로선을 잇는 세로선 하나로 그립니다. 선이 서로 가로지르거나 겹치는 일이 없어 노드가 수백~수천 개이고 연결이 많아도 읽을 수 있습니다(힘 기반 배치는 털뭉치가 되기 쉬움). 노드의 가로선은 그 노드의 첫 연결에서 마지막 연결까지이므로 선이 길수록 연결이 흩어져 있다는 뜻이고, 세로선이 짧을수록 이웃이 가까이 놓였다는 뜻입니다. 순서에 따라 모양이 크게 달라지므로 너비 우선과 연결 수 순서를 비교해 보세요.</Hint>
    </ControlGroup>
  )
}

export const fabricModule: VizModule<FabricParams> = {
  roles: edgeRoles,
  datasets: ['network', 'energy', 'modules'],
  defaultParams: { order: 'bfs', labels: true, weight: false },
  Chart: FabricChart,
  Controls: FabricControls,
  hint: '노드 행에 포인터를 올리면 그 노드의 연결이 강조됩니다 · 순서를 바꿔 이웃이 가까워지는 정도를 비교하세요',
}

// ─── radial tree ────────────────────────────────────────────────────────────────────

export interface RadialTreeParams { layout: 'cluster' | 'tree'; labels: boolean; sizeByValue: boolean; maxDepth: number }

function RadialTreeChart({ table, mapping, params, width, height, compact }: ChartProps<RadialTreeParams>) {
  const levels = roleColumns(mapping, 'levels')
  const valueCol = roleColumn(mapping, 'value')
  const { tree } = useMemo(() => buildTree(table, levels, valueCol), [table, levels.join('\u0000'), valueCol]) // eslint-disable-line react-hooks/exhaustive-deps
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const root = useMemo(() => {
    const h = d3.hierarchy(tree).sum((d) => d.value ?? 0)
    if (params.maxDepth < 4 || h.height > params.maxDepth) h.each((nd) => { if (nd.depth >= params.maxDepth && nd.children) { nd.data = { ...nd.data, value: nd.value ?? 0, children: undefined }; nd.children = undefined } })
    return h
  }, [tree, params.maxDepth])
  const leafCount = root.leaves().length
  const labelPad = compact ? 6 : leafCount > 120 ? 20 : 96
  const R = Math.max(40, Math.min(width, height) / 2 - labelPad)
  const laid = useMemo(() => {
    const l = params.layout === 'cluster' ? d3.cluster<typeof tree>() : d3.tree<typeof tree>()
    l.size([Math.PI * 2, R]).separation((a, b) => (a.parent === b.parent ? 1 : 1.6) / Math.max(1, a.depth))
    return l(root.copy())
  }, [root, params.layout, R])
  const tops = useMemo(() => (tree.children ?? []).map((c) => c.name), [tree])
  const color = categoryColor(tops)
  if (!levels.length) return <ChartMessage>계층 수준(범주형) 열을 선택하세요.</ChartMessage>
  if (!tree.children?.length) return <ChartMessage>0보다 큰 값을 가진 항목이 없습니다.</ChartMessage>
  const pt = (nd: d3.HierarchyPointNode<typeof tree>): [number, number] => [nd.y * Math.sin(nd.x), -nd.y * Math.cos(nd.x)]
  const topOf = (nd: d3.HierarchyNode<typeof tree>) => nd.ancestors().find((a) => a.depth === 1)?.data.name ?? ''
  const link = d3.linkRadial<d3.HierarchyPointLink<typeof tree>, d3.HierarchyPointNode<typeof tree>>().angle((d) => d.x).radius((d) => d.y)
  const vmax = Math.max(1, ...laid.leaves().map((l) => l.value ?? 0))
  const rOf = (nd: d3.HierarchyPointNode<typeof tree>) => (compact ? 2.4 : params.sizeByValue && !nd.children ? 2.5 + 6 * Math.sqrt((nd.value ?? 0) / vmax) : nd.children ? 3 : 4)
  const showLabels = !compact && params.labels && leafCount <= 120
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`방사형 트리: 잎 ${leafCount}개`} onPointerLeave={hide}>
        <g transform={`translate(${width / 2},${height / 2})`}>
          {laid.links().map((l, i) => <path key={i} data-testid="radial-link" d={link(l) ?? ''} fill="none" stroke={color(topOf(l.target))} strokeOpacity={0.6} strokeWidth={1.3} />)}
          {laid.descendants().map((nd, i) => {
            const [x, y] = pt(nd)
            const deg = (nd.x * 180) / Math.PI - 90, flip = nd.x > Math.PI
            return (
              <g key={i} transform={`translate(${x},${y})`} onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>{nd.ancestors().reverse().slice(1).map((a) => a.data.name).join(' › ') || '전체'}</b>{(nd.value ?? 0) > 0 ? <><br />값 {fmt(nd.value ?? 0)}{nd.children ? ` (하위 잎 ${nd.leaves().length}개)` : ''}</> : null}</>) }} onPointerLeave={hide}>
                <circle data-testid="radial-node" r={rOf(nd)} fill={nd.depth === 0 ? '#111827' : nd.children ? '#fff' : color(topOf(nd))} stroke={nd.depth === 0 ? '#111827' : color(topOf(nd))} strokeWidth={1.4} />
                {showLabels && (!nd.children || nd.depth <= 1) && nd.depth > 0 && <text transform={`rotate(${flip ? deg + 180 : deg}) translate(${flip ? -8 : 8},0)`} textAnchor={flip ? 'end' : 'start'} dy="0.32em" fontSize={nd.children ? 12 : 10.5} fontWeight={nd.children ? 600 : 400} fill="#111827" stroke="#fff" strokeWidth={3} paintOrder="stroke">{nd.data.name.length > 11 ? `${nd.data.name.slice(0, 10)}…` : nd.data.name}</text>}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && <><Legend items={tops.map((t) => ({ key: t, color: color(t) }))} /><Readout items={[{ label: '잎', value: leafCount }, { label: '깊이', value: root.height }, { label: '배치', value: params.layout === 'cluster' ? '잎을 바깥에 정렬' : '깊이별 간격' }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function RadialTreeControls({ params, setParams }: ControlsProps<RadialTreeParams>) {
  return (
    <ControlGroup title="방사형 트리">
      <Segmented label="배치 방식" value={params.layout} onChange={(layout) => setParams({ layout })} testId="ctl-rtree-layout" options={[{ value: 'cluster', label: '잎을 바깥 원에 정렬' }, { value: 'tree', label: '깊이에 비례한 간격' }]} />
      <Slider label="표시할 최대 깊이" value={params.maxDepth} min={1} max={4} onChange={(maxDepth) => setParams({ maxDepth })} testId="ctl-rtree-depth" />
      <Toggle label="잎의 크기를 값에 비례" checked={params.sizeByValue} onChange={(sizeByValue) => setParams({ sizeByValue })} />
      <Toggle label="이름" checked={params.labels} onChange={(labels) => setParams({ labels })} />
      <Hint>방사형 트리는 뿌리를 가운데에 두고 가지를 바깥으로 뻗어 계층을 그립니다. 사각형 트리보다 공간을 효율적으로 쓰므로 잎이 많은 계층도 한 원 안에 넣을 수 있습니다. 같은 가지의 하위 항목은 같은 방향의 부채꼴에 모이며 색은 최상위 가지를 따릅니다. 반지름은 깊이이고 각도 순서에는 의미가 없습니다. 바깥으로 갈수록 같은 각도 간격이 길어져 바깥쪽 잎이 과장되어 보일 수 있고, 잎이 120개를 넘으면 이름을 숨깁니다.</Hint>
    </ControlGroup>
  )
}

export const radialTreeModule: VizModule<RadialTreeParams> = {
  roles: [
    { key: 'levels', label: '계층 수준 (바깥 → 안쪽)', type: 'category', required: true, multiple: { min: 1, max: 4 } },
    { key: 'value', label: '값 (선택, 잎 크기)', type: 'number', auto: true, prefer: '예산|매출|값|value|크기|size' },
  ],
  datasets: ['budget', 'folders'],
  defaultParams: { layout: 'cluster', labels: true, sizeByValue: true, maxDepth: 4 },
  Chart: RadialTreeChart,
  Controls: RadialTreeControls,
  hint: '가지와 잎에 포인터를 올리면 경로와 값 · 최대 깊이를 줄여 큰 가지만 보세요',
}

