import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { ChartMessage, Legend, Readout, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, updateRow } from '../../data/table'
import { categoryColor, schemes, type ColorScheme } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { circumcircle, delaunayTriangles, triangleAngles, voronoiCells, type P2 } from '../../stats/geometry'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { paddedDomain } from './shared'

/** Ternary plot, wind rose, polar plot, polar heatmap and the Delaunay triangulation. */

const seq = (Object.keys(schemes) as ColorScheme[]).filter((k) => !schemes[k].diverging).map((k) => ({ value: k, label: schemes[k].name }))

// ─── ternary ────────────────────────────────────────────────────────────────────────

export interface TernaryParams { grid: number; normalize: boolean; size: number; opacity: number; selected: number }

function TernaryChart({ table, mapping, params, setParams, width, height, compact, onTableChange, linked }: ChartProps<TernaryParams>) {
  const ai = columnIndex(table, roleColumn(mapping, 'a')), bi = columnIndex(table, roleColumn(mapping, 'b')), ci = columnIndex(table, roleColumn(mapping, 'c')), gi = columnIndex(table, roleColumn(mapping, 'group'))
  const names = [roleColumn(mapping, 'a') ?? 'A', roleColumn(mapping, 'b') ?? 'B', roleColumn(mapping, 'c') ?? 'C']
  const pts = useMemo(() => {
    const out: { row: number; a: number; b: number; c: number; sum: number; g: string }[] = []
    if (ai < 0 || bi < 0 || ci < 0) return out
    table.rows.forEach((r, row) => { const a = toNumber(r[ai]), b = toNumber(r[bi]), c = toNumber(r[ci]); if (a == null || b == null || c == null || a < 0 || b < 0 || c < 0 || a + b + c <= 0) return; const s = a + b + c; out.push({ row, a: a / s, b: b / s, c: c / s, sum: s, g: gi >= 0 ? toLabel(r[gi]) : '' }) })
    return out
  }, [table, ai, bi, ci, gi])
  const groups = useMemo(() => [...new Set(pts.map((p) => p.g))].filter(Boolean), [pts])
  const color = categoryColor(groups)
  const side = Math.max(80, Math.min(width - 120, (height - 100) * (2 / Math.sqrt(3))))
  const h = (side * Math.sqrt(3)) / 2
  const ox = (width - side) / 2, oy = (height - h) / 2 + 6
  // vertices: A at the top, B bottom-left, C bottom-right; a point is a·A + b·B + c·C
  const V = { A: [side / 2, 0], B: [0, h], C: [side, h] } as const
  const at = (a: number, b: number, c: number) => [a * V.A[0] + b * V.B[0] + c * V.C[0], a * V.A[1] + b * V.B[1] + c * V.C[1]] as [number, number]
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<number | null>(null)
  const { tip, show, hide } = useTooltip()
  const marked = new Set(linked?.rows ?? [])
  if (!roleColumn(mapping, 'a') || !roleColumn(mapping, 'b') || !roleColumn(mapping, 'c')) return <ChartMessage>세 성분 열(숫자형)을 선택하세요.</ChartMessage>
  if (!pts.length) return <ChartMessage>합이 0보다 큰 0 이상의 세 성분 값이 있는 행이 없습니다.</ChartMessage>
  const step = 1 / params.grid
  const ticks = Array.from({ length: params.grid + 1 }, (_, i) => i * step)
  const editable = !!onTableChange && !compact
  const toBary = (e: React.PointerEvent) => {
    const l = localPoint(svgRef.current!, e)
    const x = l.x - ox, y = l.y - oy
    // solve for (a, b, c) from the cartesian position with a + b + c = 1: y gives a, then x gives c
    const a = 1 - y / h
    const cc = (x - a * (side / 2)) / side, bb = 1 - a - cc
    const cl = (v: number) => Math.max(0, v)
    const s = cl(a) + cl(bb) + cl(cc) || 1
    return [cl(a) / s, cl(bb) / s, cl(cc) / s] as const
  }
  const labelOf = (i: number) => (names[i].length > 8 ? `${names[i].slice(0, 7)}…` : names[i])
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`삼각 좌표 그래프: 점 ${pts.length}개, 성분 ${names.join('·')}`} onPointerLeave={() => { hide(); linked?.set(null) }}
        onPointerMove={(e) => { if (drag.current == null || !editable) return; const [a, b, c] = toBary(e); const p = pts.find((q) => q.row === drag.current)!; const scale = params.normalize ? 100 : p.sum; onTableChange!(updateRow(table, drag.current, { [roleColumn(mapping, 'a')!]: Math.round(a * scale * 10) / 10, [roleColumn(mapping, 'b')!]: Math.round(b * scale * 10) / 10, [roleColumn(mapping, 'c')!]: Math.round(c * scale * 10) / 10 }), true) }}
        onPointerUp={() => { if (drag.current != null) { drag.current = null; onTableChange!(table, false) } }}>
        <g transform={`translate(${ox},${oy})`}>
          <path d={`M${V.A}L${V.B}L${V.C}Z`} fill="#fbfcfc" stroke="#6b7773" strokeWidth={1.4} />
          {ticks.slice(1, -1).map((t) => (
            <g key={t} stroke="#d7dedb" strokeWidth={0.9} data-testid="tern-grid">
              <line x1={at(t, 1 - t, 0)[0]} y1={at(t, 1 - t, 0)[1]} x2={at(t, 0, 1 - t)[0]} y2={at(t, 0, 1 - t)[1]} />
              <line x1={at(1 - t, t, 0)[0]} y1={at(1 - t, t, 0)[1]} x2={at(0, t, 1 - t)[0]} y2={at(0, t, 1 - t)[1]} />
              <line x1={at(1 - t, 0, t)[0]} y1={at(1 - t, 0, t)[1]} x2={at(0, 1 - t, t)[0]} y2={at(0, 1 - t, t)[1]} />
            </g>
          ))}
          {!compact && ticks.map((t) => <g key={`t${t}`} fontSize={10} fill="#6b7773"><text x={at(t, 1 - t, 0)[0] - 6} y={at(t, 1 - t, 0)[1] + 3} textAnchor="end">{Math.round(t * 100)}</text><text x={at(0, 1 - t, t)[0]} y={at(0, 1 - t, t)[1] + 14} textAnchor="middle">{Math.round(t * 100)}</text><text x={at(1 - t, 0, t)[0] + 6} y={at(1 - t, 0, t)[1] + 3} textAnchor="start">{Math.round(t * 100)}</text></g>)}
          {!compact && <g fontSize={12.5} fontWeight={650} fill="#111827"><text x={V.A[0]} y={V.A[1] - 10} textAnchor="middle">{labelOf(0)} (%) ↓</text><text x={V.B[0] - 6} y={V.B[1] + 30} textAnchor="start">← {labelOf(1)} (%)</text><text x={V.C[0] + 6} y={V.C[1] + 30} textAnchor="end">{labelOf(2)} (%) →</text></g>}
          {pts.map((p) => {
            const q = at(p.a, p.b, p.c)
            const on = params.selected === p.row || marked.has(p.row)
            return <circle key={p.row} className="mark-point" data-testid="tern-point" data-row={p.row} data-nodrag={editable ? '' : undefined} cx={q[0]} cy={q[1]} r={compact ? 2.4 : on ? params.size + 2 : params.size} fill={p.g ? color(p.g) : '#2a7d74'} fillOpacity={params.opacity} stroke={on ? '#121816' : '#fff'} strokeWidth={on ? 2 : 0.8} style={{ cursor: editable ? 'grab' : 'default' }}
              onPointerDown={editable ? (e) => { e.stopPropagation(); (svgRef.current as Element).setPointerCapture(e.pointerId); drag.current = p.row; setParams({ selected: p.row }); hide() } : undefined}
              onPointerEnter={compact ? undefined : (e) => { linked?.set([p.row]); const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>{p.g || `행 ${p.row + 1}`}</b><br />{names[0]} {fmt(p.a * 100, 1)}%<br />{names[1]} {fmt(p.b * 100, 1)}%<br />{names[2]} {fmt(p.c * 100, 1)}%{editable ? <><br />끌어서 조성 변경</> : null}</>) }} onPointerLeave={() => { hide(); linked?.set(null) }} />
          })}
        </g>
      </svg>
      {!compact && (<>
        {groups.length > 0 && <Legend items={groups.map((g) => ({ key: g, color: color(g) }))} />}
        <Readout items={[{ label: '점', value: pts.length }, { label: '평균 조성', value: `${pct(d3.mean(pts, (p) => p.a)!, 0)} / ${pct(d3.mean(pts, (p) => p.b)!, 0)} / ${pct(d3.mean(pts, (p) => p.c)!, 0)}` }]} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

function TernaryControls({ params, setParams }: ControlsProps<TernaryParams>) {
  return (
    <ControlGroup title="삼각 좌표">
      <Slider label="격자 간격" value={params.grid} min={2} max={10} onChange={(grid) => setParams({ grid })} format={(v) => `${Math.round(100 / v)}%`} testId="ctl-tern-grid" />
      <Toggle label="끌 때 합을 100으로 정규화" checked={params.normalize} onChange={(normalize) => setParams({ normalize })} />
      <Slider label="점 크기" value={params.size} min={2} max={9} step={0.5} onChange={(size) => setParams({ size })} />
      <Slider label="불투명도" value={params.opacity} min={0.2} max={1} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} />
      <Hint>세 성분의 합이 일정한 조성 자료는 한 성분이 늘면 다른 성분이 줄어 자유도가 2뿐이므로 삼각형 한 장에 담깁니다. 점이 꼭짓점에 가까울수록 그 성분의 비율이 큽니다. 각 점은 성분의 합으로 나눠 비율로 바꿔 그립니다. 읽을 때는 그 성분에 평행한 격자선을 따라가세요. 점을 끌면 세 열의 값이 함께 바뀝니다.</Hint>
    </ControlGroup>
  )
}

export const ternaryModule: VizModule<TernaryParams> = {
  roles: [{ key: 'group', label: '그룹 (선택)', type: 'category', auto: true }, { key: 'a', label: '성분 A (위)', type: 'number', required: true, prefer: '모래|a' }, { key: 'b', label: '성분 B (왼쪽 아래)', type: 'number', required: true, prefer: '미사|b' }, { key: 'c', label: '성분 C (오른쪽 아래)', type: 'number', required: true, prefer: '점토|c' }],
  datasets: ['soil-texture'],
  defaultParams: { grid: 5, normalize: true, size: 4.5, opacity: 0.82, selected: -1 },
  Chart: TernaryChart,
  Controls: TernaryControls,
  hint: '점을 끌면 세 성분이 함께 바뀝니다(합 100) · 꼭짓점에 가까울수록 그 성분이 큽니다 · 그룹별로 군집을 비교',
}

// ─── wind rose ──────────────────────────────────────────────────────────────────────

export interface RoseParams { sectors: number; classWidth: number; classes: number; calm: number; scale: 'linear' | 'sqrt'; scheme: ColorScheme }

function WindRoseChart({ table, mapping, params, width, height, compact }: ChartProps<RoseParams>) {
  const di = columnIndex(table, roleColumn(mapping, 'dir')), si = columnIndex(table, roleColumn(mapping, 'speed'))
  const obs = useMemo(() => { const out: { dir: number; speed: number }[] = []; if (di < 0 || si < 0) return out; for (const r of table.rows) { const d = toNumber(r[di]), s = toNumber(r[si]); if (d != null && s != null && s >= 0) out.push({ dir: ((d % 360) + 360) % 360, speed: s }) } return out }, [table, di, si])
  const n = params.sectors, w = 360 / n
  const calm = obs.filter((o) => o.speed < params.calm).length
  const moving = obs.filter((o) => o.speed >= params.calm)
  const bins = useMemo(() => {
    // sector k is centred on k·w; a direction belongs to the sector whose centre is nearest
    const out = Array.from({ length: n }, () => new Array<number>(params.classes).fill(0))
    for (const o of moving) { const k = Math.floor(((o.dir + w / 2) % 360) / w); const c = Math.min(params.classes - 1, Math.floor(o.speed / params.classWidth)); out[k][c]++ }
    return out
  }, [moving, n, w, params.classes, params.classWidth])
  const total = obs.length || 1
  const sectorTot = bins.map((b) => d3.sum(b) / total * 100)
  const maxPct = Math.max(1, d3.max(sectorTot) ?? 1)
  const R = Math.max(40, Math.min(width, height) / 2 - (compact ? 10 : 46))
  const rScale = params.scale === 'sqrt' ? d3.scaleSqrt().domain([0, maxPct * 1.08]).range([0, R]) : d3.scaleLinear().domain([0, maxPct * 1.08]).range([0, R])
  const scheme = schemes[params.scheme]
  const classColor = (c: number) => scheme.interpolate(0.15 + 0.8 * (c / Math.max(1, params.classes - 1)))
  const cx = width / 2, cy = height / 2
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!roleColumn(mapping, 'dir') || !roleColumn(mapping, 'speed')) return <ChartMessage>풍향(°)과 풍속(숫자형) 열을 선택하세요.</ChartMessage>
  if (!obs.length) return <ChartMessage>풍향·풍속이 올바른 행이 없습니다.</ChartMessage>
  const rings = rScale.ticks(compact ? 3 : 4).filter((t) => t > 0)
  const ang = (deg: number) => (deg * Math.PI) / 180
  const dom = sectorTot.indexOf(Math.max(...sectorTot))
  const names8 = ['북', '북동', '동', '남동', '남', '남서', '서', '북서']
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`풍향 장미도: 방위 ${n}개, 최다 풍향 ${Math.round(dom * w)}도`} onPointerLeave={hide}>
        <g transform={`translate(${cx},${cy})`}>
          {rings.map((t) => <g key={t}><circle r={rScale(t)} fill="none" stroke="#d7dedb" strokeWidth={0.9} />{!compact && <text x={3} y={-rScale(t) - 2} fontSize={10} fill="#6b7773">{t}%</text>}</g>)}
          {d3.range(0, 360, 360 / Math.min(n, 16) >= 22.5 ? 45 : 22.5).map((d) => <line key={d} x1={0} y1={0} x2={R * Math.sin(ang(d))} y2={-R * Math.cos(ang(d))} stroke="#e6ebe9" />)}
          {bins.map((b, k) => {
            let cum = 0
            return b.map((cnt, c) => {
              const p0 = (cum / total) * 100
              cum += cnt
              const p1 = (cum / total) * 100
              if (cnt === 0) return null
              const a0 = ang(k * w - w * 0.42), a1 = ang(k * w + w * 0.42)
              return <path key={`${k}-${c}`} data-testid="rose-wedge" data-sector={k} data-class={c} data-count={cnt} d={d3.arc()({ innerRadius: rScale(p0), outerRadius: rScale(p1), startAngle: a0, endAngle: a1 }) ?? ''} fill={classColor(c)} stroke="#fff" strokeWidth={0.6}
                onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); const lo = c * params.classWidth, hi = (c + 1) * params.classWidth; show(l.x, l.y, <><b>{Math.round(k * w)}° 방향 ({names8[Math.round(k * w / 45) % 8]}쪽에서)</b><br />풍속 {lo}–{c === params.classes - 1 ? '∞' : hi} m/s: {cnt}회 ({pct(cnt / total)})<br />이 방위 합계 {fmt(sectorTot[k], 1)}%</>) }} onPointerLeave={hide} />
            })
          })}
          {!compact && names8.map((nme, i) => <text key={nme} x={(R + 16) * Math.sin(ang(i * 45))} y={-(R + 16) * Math.cos(ang(i * 45)) + 4} textAnchor="middle" fontSize={12} fontWeight={i % 2 ? 400 : 650} fill="#374151">{nme}</text>)}
        </g>
      </svg>
      {!compact && (<>
        <Legend items={Array.from({ length: params.classes }, (_, c) => ({ key: `${c * params.classWidth}${c === params.classes - 1 ? '+' : `–${(c + 1) * params.classWidth}`} m/s`, color: classColor(c) }))} title="풍속" />
        <Readout items={[{ label: '관측', value: obs.length }, { label: '정온(<' + params.calm + ')', value: pct(calm / total) }, { label: '최다 방향', value: `${Math.round(dom * w)}° (${fmt(sectorTot[dom], 1)}%)` }]} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

function WindRoseControls({ params, setParams }: ControlsProps<RoseParams>) {
  return (
    <ControlGroup title="풍향 장미">
      <Select label="방위 수" value={String(params.sectors)} onChange={(v) => setParams({ sectors: Number(v) })} testId="ctl-rose-sectors" options={[8, 12, 16, 24, 36].map((n) => ({ value: String(n), label: `${n}방위 (${360 / n}°)` }))} />
      <Slider label="풍속 계급 폭 (m/s)" value={params.classWidth} min={1} max={5} step={0.5} onChange={(classWidth) => setParams({ classWidth })} testId="ctl-rose-class" />
      <Slider label="풍속 계급 수" value={params.classes} min={2} max={8} onChange={(classes) => setParams({ classes })} />
      <Slider label="정온으로 보는 풍속 (m/s 미만)" value={params.calm} min={0} max={2} step={0.1} onChange={(calm) => setParams({ calm })} testId="ctl-rose-calm" />
      <Segmented label="반지름 눈금" value={params.scale} onChange={(scale) => setParams({ scale })} options={[{ value: 'linear', label: '선형' }, { value: 'sqrt', label: '제곱근(면적 비례)' }]} />
      <Select label="팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={seq} />
      <Hint>풍향 장미는 바람이 불어오는 방향(북쪽 0°, 시계 방향)별로 관측 빈도를 쐐기 길이로 나타내고, 풍속 계급을 안쪽에서 바깥쪽으로 쌓습니다. 쐐기가 길수록 그 방향의 바람이 자주 분다는 뜻입니다. 선형 눈금에서는 긴 쐐기의 면적이 빈도보다 더 크게 보이므로 면적으로 비교할 때는 제곱근 눈금을 쓰세요. 방위를 너무 잘게 나누면 쐐기마다 관측이 적어 들쭉날쭉해집니다. 풍속 &lt; 정온 기준은 그리지 않고 비율만 알립니다.</Hint>
    </ControlGroup>
  )
}

export const windRoseModule: VizModule<RoseParams> = {
  roles: [{ key: 'dir', label: '풍향 (°)', type: 'number', required: true, prefer: '풍향|dir' }, { key: 'speed', label: '풍속', type: 'number', required: true, prefer: '풍속|speed' }],
  datasets: ['wind-obs'],
  defaultParams: { sectors: 16, classWidth: 2, classes: 5, calm: 0.5, scale: 'linear', scheme: 'viridis' },
  Chart: WindRoseChart,
  Controls: WindRoseControls,
  hint: '쐐기에 포인터를 올리면 방향·풍속 계급별 횟수 · 방위 수를 바꿔 보세요 · 제곱근 눈금은 면적이 빈도에 비례',
}

// ─── polar plot ─────────────────────────────────────────────────────────────────────

export interface PolarParams { unit: 'deg' | 'rad'; zero: 'top' | 'right'; dir: 'cw' | 'ccw'; mode: 'line' | 'points' | 'both'; smooth: boolean; hidden: string[] }

function PolarChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<PolarParams>) {
  const ti = columnIndex(table, roleColumn(mapping, 'angle')), ri = columnIndex(table, roleColumn(mapping, 'radius')), gi = columnIndex(table, roleColumn(mapping, 'group'))
  const series = useMemo(() => {
    const by = new Map<string, { th: number; r: number; row: number }[]>()
    if (ti < 0 || ri < 0) return []
    table.rows.forEach((row, i) => { const th = toNumber(row[ti]), r = toNumber(row[ri]); if (th == null || r == null) return; const g = gi >= 0 ? toLabel(row[gi]) || '(빈 값)' : '전체'; (by.get(g) ?? by.set(g, []).get(g)!).push({ th: params.unit === 'deg' ? (th * Math.PI) / 180 : th, r, row: i }) })
    return [...by].map(([key, pts]) => ({ key, pts }))
  }, [table, ti, ri, gi, params.unit])
  const color = categoryColor(series.map((s) => s.key))
  const rMax = d3.max(series.flatMap((s) => s.pts), (p) => Math.abs(p.r)) ?? 1
  const R = Math.max(40, Math.min(width, height) / 2 - (compact ? 10 : 40))
  const rs = d3.scaleLinear().domain([0, rMax]).nice().range([0, R])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!roleColumn(mapping, 'angle') || !roleColumn(mapping, 'radius')) return <ChartMessage>각도와 반지름(숫자형) 열을 선택하세요.</ChartMessage>
  if (!series.length) return <ChartMessage>각도와 반지름이 숫자인 행이 없습니다.</ChartMessage>
  const sign = params.dir === 'cw' ? 1 : -1
  const off = params.zero === 'top' ? -Math.PI / 2 : 0
  // screen position of (θ, r): a negative radius is drawn on the opposite side of the pole, as in the mathematical definition
  const xy = (th: number, r: number): [number, number] => { const a = off + sign * th; return [rs(r) * Math.cos(a), rs(r) * Math.sin(a)] }
  const shown = series.filter((s) => !params.hidden.includes(s.key))
  const rings = rs.ticks(compact ? 2 : 4).filter((t) => t > 0)
  const spokes = d3.range(0, 360, 30)
  const label = (deg: number) => (params.unit === 'deg' ? `${deg}°` : `${fmt((deg * Math.PI) / 180, 2)}`)
  const line = d3.line<[number, number]>().curve(params.smooth ? d3.curveCatmullRom : d3.curveLinear)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`극좌표 그래프: 곡선 ${shown.length}개`} onPointerLeave={hide}>
        <g transform={`translate(${width / 2},${height / 2})`}>
          {rings.map((t) => <g key={t}><circle r={rs(t)} fill="none" stroke="#d7dedb" strokeWidth={0.9} />{!compact && <text x={4} y={-rs(t) - 2} fontSize={10} fill="#6b7773">{fmt(t)}</text>}</g>)}
          {spokes.map((d) => { const a = off + sign * (d * Math.PI) / 180; return <g key={d}><line x1={0} y1={0} x2={R * Math.cos(a)} y2={R * Math.sin(a)} stroke="#e6ebe9" />{!compact && <text x={(R + 14) * Math.cos(a)} y={(R + 14) * Math.sin(a) + 4} textAnchor="middle" fontSize={11} fill="#6b7773">{label(d)}</text>}</g> })}
          {shown.map((s) => {
            const p = s.pts.map((q) => xy(q.th, q.r))
            return (
              <g key={s.key}>
                {params.mode !== 'points' && <path data-testid="polar-line" data-group={s.key} d={line(p) ?? ''} fill="none" stroke={color(s.key)} strokeWidth={2} strokeLinejoin="round" />}
                {params.mode !== 'line' && s.pts.map((q, i) => <circle key={i} data-testid="polar-point" cx={p[i][0]} cy={p[i][1]} r={compact ? 1.6 : 3.2} fill={color(s.key)} stroke="#fff" strokeWidth={0.6} onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>{s.key}</b><br />θ = {params.unit === 'deg' ? `${fmt((q.th * 180) / Math.PI, 1)}°` : `${fmt(q.th, 3)} rad`}<br />r = {fmt(q.r, 3)}</>) }} onPointerLeave={hide} />)}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (<>
        <Legend items={series.map((s) => ({ key: s.key, color: color(s.key) }))} hidden={params.hidden} onToggle={(k) => setParams({ hidden: params.hidden.includes(k) ? params.hidden.filter((x) => x !== k) : [...params.hidden, k] })} />
        <Readout items={[{ label: '곡선', value: shown.length }, { label: '점', value: d3.sum(shown, (s) => s.pts.length) }, { label: '최대 |r|', value: fmt(rMax, 2) }]} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

function PolarControls({ params, setParams }: ControlsProps<PolarParams>) {
  return (
    <ControlGroup title="극좌표">
      <Segmented label="각도 단위" value={params.unit} onChange={(unit) => setParams({ unit })} testId="ctl-polar-unit" options={[{ value: 'deg', label: '도(°)' }, { value: 'rad', label: '라디안' }]} />
      <Segmented label="0° 위치" value={params.zero} onChange={(zero) => setParams({ zero })} options={[{ value: 'top', label: '위쪽 (북)' }, { value: 'right', label: '오른쪽 (수학)' }]} />
      <Segmented label="각도 방향" value={params.dir} onChange={(dir) => setParams({ dir })} options={[{ value: 'cw', label: '시계 방향' }, { value: 'ccw', label: '반시계 방향' }]} />
      <Segmented label="표시" value={params.mode} onChange={(mode) => setParams({ mode })} options={[{ value: 'line', label: '선' }, { value: 'points', label: '점' }, { value: 'both', label: '둘 다' }]} />
      <Toggle label="곡선 부드럽게" checked={params.smooth} onChange={(smooth) => setParams({ smooth })} />
      <Hint>각 점은 극점에서의 거리(반지름)와 기준선에서 잰 각도로 정해집니다. 반지름이 음수이면 극점 반대편에 그립니다(장미 곡선의 잎이 이렇게 생깁니다). 각도의 기준과 방향은 학문마다 달라(수학은 오른쪽·반시계, 방위는 위쪽·시계) 해석 전에 확인해야 합니다. 같은 값이라도 반지름이 클수록 시각적으로 넓은 면적을 차지해 크기가 과장되어 보입니다.</Hint>
    </ControlGroup>
  )
}

export const polarModule: VizModule<PolarParams> = {
  roles: [{ key: 'group', label: '곡선 (선택)', type: 'category', auto: true, prefer: '곡선|group' }, { key: 'angle', label: '각도', type: 'number', required: true, prefer: '각도|angle|theta' }, { key: 'radius', label: '반지름', type: 'number', required: true, prefer: '반지름|radius|r' }],
  datasets: ['polar-curves', 'wind-obs'],
  defaultParams: { unit: 'deg', zero: 'right', dir: 'ccw', mode: 'line', smooth: true, hidden: [] },
  Chart: PolarChart,
  Controls: PolarControls,
  hint: '각도 단위·기준·방향을 바꿔 같은 표가 어떻게 달리 그려지는지 확인 · 장미 곡선의 음수 반지름은 반대편에 그려집니다 · 범례로 곡선 숨기기',
}

// ─── polar heatmap ──────────────────────────────────────────────────────────────────

export interface PolarHeatParams { scheme: ColorScheme; inner: number; gap: number; labels: boolean; start: number }

function PolarHeatChart({ table, mapping, params, width, height, compact }: ChartProps<PolarHeatParams>) {
  const ri = columnIndex(table, roleColumn(mapping, 'ring')), ai = columnIndex(table, roleColumn(mapping, 'angle')), vi = columnIndex(table, roleColumn(mapping, 'value'))
  const cells = useMemo(() => {
    const out: { ring: string; angle: number; v: number }[] = []
    if (ri < 0 || ai < 0 || vi < 0) return out
    for (const r of table.rows) { const a = toNumber(r[ai]), v = toNumber(r[vi]); if (a != null && v != null) out.push({ ring: toLabel(r[ri]), angle: a, v }) }
    return out
  }, [table, ri, ai, vi])
  const rings = useMemo(() => [...new Set(cells.map((c) => c.ring))], [cells])
  const angles = useMemo(() => [...new Set(cells.map((c) => c.angle))].sort((a, b) => a - b), [cells])
  const val = useMemo(() => new Map(cells.map((c) => [`${c.ring}|${c.angle}`, c.v])), [cells])
  const [lo, hi] = d3.extent(cells, (c) => c.v) as [number, number]
  const scheme = schemes[params.scheme]
  const R = Math.max(50, Math.min(width, height) / 2 - (compact ? 8 : 34))
  const r0 = R * params.inner
  const bw = rings.length ? (R - r0) / rings.length : 1
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!roleColumn(mapping, 'ring') || !roleColumn(mapping, 'angle') || !roleColumn(mapping, 'value')) return <ChartMessage>고리(범주), 각도(숫자형), 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!cells.length) return <ChartMessage>고리·각도·값이 올바른 행이 없습니다.</ChartMessage>
  const n = angles.length
  const sec = (2 * Math.PI) / n
  const start = (params.start * Math.PI) / 180
  const step = Math.max(1, Math.round(n / 6))
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`극좌표 히트맵: ${rings.length}개 고리 × ${n}개 각도`} onPointerLeave={hide}>
        <g transform={`translate(${width / 2},${height / 2})`}>
          {rings.map((ring, k) => angles.map((a, j) => {
            const v = val.get(`${ring}|${a}`)
            const a0 = start + j * sec, a1 = start + (j + 1) * sec
            const fill = v == null ? '#f1f4f3' : scheme.interpolate(0.06 + 0.92 * (hi === lo ? 0.5 : (v - lo) / (hi - lo)))
            return <path key={`${k}-${j}`} data-testid="polar-cell" data-ring={ring} data-angle={a} data-value={v ?? ''} d={d3.arc()({ innerRadius: r0 + k * bw + params.gap / 2, outerRadius: r0 + (k + 1) * bw - params.gap / 2, startAngle: a0 + 0.003, endAngle: a1 - 0.003 }) ?? ''} fill={fill}
              onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>{ring} · {a}</b><br />{roleColumn(mapping, 'value')}: {v == null ? '없음' : fmt(v)}</>) }} onPointerLeave={hide} />
          }))}
          {!compact && rings.map((ring, k) => <text key={ring} x={0} y={-(r0 + (k + 0.5) * bw) + 4} textAnchor="middle" fontSize={Math.min(11, bw * 0.7)} fill="#111827" stroke="#fff" strokeWidth={2.5} paintOrder="stroke" pointerEvents="none">{ring}</text>)}
          {!compact && params.labels && angles.map((a, j) => (j % step === 0) ? <text key={a} x={(R + 14) * Math.sin(start + (j + 0.5) * sec)} y={-(R + 14) * Math.cos(start + (j + 0.5) * sec) + 4} textAnchor="middle" fontSize={11} fill="#4b5563">{a}</text> : null)}
        </g>
      </svg>
      {!compact && (<>
        <div className="color-legend"><span>{fmt(lo)}</span><span className="color-ramp" style={{ background: `linear-gradient(90deg, ${d3.range(0, 1.01, 0.1).map((v) => scheme.interpolate(0.06 + 0.92 * v)).join(',')})` }} /><span>{fmt(hi)}</span></div>
        <Readout items={[{ label: '고리', value: rings.length }, { label: '각도 칸', value: n }, { label: '범위', value: `${fmt(lo)}–${fmt(hi)}` }]} />
        <Tooltip tip={tip} width={width} />
      </>)}
    </div>
  )
}

function PolarHeatControls({ params, setParams }: ControlsProps<PolarHeatParams>) {
  return (
    <ControlGroup title="극좌표 히트맵">
      <Select label="팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={seq} />
      <Slider label="가운데 비움" value={params.inner} min={0.1} max={0.6} step={0.02} onChange={(inner) => setParams({ inner })} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-pheat-inner" />
      <Slider label="고리 사이 간격" value={params.gap} min={0} max={6} step={0.5} onChange={(gap) => setParams({ gap })} />
      <Slider label="시작 각도" value={params.start} min={-180} max={180} step={15} onChange={(start) => setParams({ start })} format={(v) => `${v}°`} />
      <Toggle label="각도 눈금 이름" checked={params.labels} onChange={(labels) => setParams({ labels })} />
      <Hint>시각·월·방위처럼 끝이 처음으로 이어지는 주기 변수는 원으로 펼치면 자정과 다음 날 0시가 가까이 놓입니다. 각도 방향이 주기 변수, 고리가 두 번째 범주(요일 등)이고 칸의 색이 값입니다. 바깥 고리의 칸이 안쪽보다 넓어 같은 값도 크게 보이는 점에 주의하세요. 고리 수가 많으면 직사각형 히트맵이 비교에 더 정확합니다.</Hint>
    </ControlGroup>
  )
}

export const polarHeatmapModule: VizModule<PolarHeatParams> = {
  roles: [{ key: 'ring', label: '고리 (범주)', type: 'category', required: true, prefer: '요일|ring' }, { key: 'angle', label: '각도 (주기 변수, 숫자)', type: 'number', required: true, prefer: '시|hour|월|angle' }, { key: 'value', label: '값', type: 'number', required: true, prefer: '방문|값|value' }],
  datasets: ['hourly-visits'],
  defaultParams: { scheme: 'ylorrd', inner: 0.28, gap: 1.5, labels: true, start: 0 },
  Chart: PolarHeatChart,
  Controls: PolarHeatControls,
  hint: '자정이 이어지는 24시간 주기를 원으로 펼칩니다 · 칸에 포인터를 올리면 값 · 시작 각도와 가운데 비움을 바꿔 보세요',
}

// ─── Delaunay triangulation ─────────────────────────────────────────────────────────

export interface DelaunayParams { fill: 'quality' | 'none'; circles: boolean; voronoi: boolean; hull: boolean; selected: number }

function DelaunayChart({ table, mapping, params, setParams, width, height, compact, onTableChange }: ChartProps<DelaunayParams>) {
  const xi = columnIndex(table, roleColumn(mapping, 'x')), yi = columnIndex(table, roleColumn(mapping, 'y'))
  const pts = useMemo(() => { const out: { row: number; x: number; y: number }[] = []; if (xi < 0 || yi < 0) return out; table.rows.forEach((r, row) => { const x = toNumber(r[xi]), y = toNumber(r[yi]); if (x != null && y != null) out.push({ row, x, y }) }); return out }, [table, xi, yi])
  const m = compact ? 8 : 40
  const iw = Math.max(40, width - 2 * m), ih = Math.max(40, height - 2 * m)
  const xd = paddedDomain(pts.map((p) => p.x), 0.06), yd = paddedDomain(pts.map((p) => p.y), 0.06)
  const x = d3.scaleLinear().domain(xd).range([0, iw]), y = d3.scaleLinear().domain(yd).range([ih, 0])
  const P2s: P2[] = useMemo(() => pts.map((p) => [p.x, p.y]), [pts])
  const tris = useMemo(() => (pts.length >= 3 ? delaunayTriangles(P2s) : []), [P2s, pts.length])
  const info = useMemo(() => tris.map(([a, b, c]) => ({ t: [a, b, c] as [number, number, number], min: Math.min(...triangleAngles(P2s[a], P2s[b], P2s[c])), cc: circumcircle(P2s[a], P2s[b], P2s[c]) })), [tris, P2s])
  const hullIdx = useMemo(() => (pts.length >= 3 ? Array.from(d3.Delaunay.from(P2s).hull) : []), [P2s, pts.length])
  const cells = useMemo(() => (params.voronoi && pts.length >= 2 ? voronoiCells(P2s, [xd[0], yd[0], xd[1], yd[1]]) : []), [params.voronoi, P2s, pts.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const drag = useRef<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const { tip, show, hide } = useTooltip()
  if (!roleColumn(mapping, 'x') || !roleColumn(mapping, 'y')) return <ChartMessage>x, y(숫자형) 열을 선택하세요.</ChartMessage>
  if (pts.length < 3) return <ChartMessage>삼각분할에는 점이 3개 이상 필요합니다.</ChartMessage>
  const editable = !!onTableChange && !compact
  const sel = params.selected >= 0 && params.selected < info.length ? info[params.selected] : null
  const meanMin = d3.mean(info, (i) => i.min) ?? 0, worst = d3.min(info, (i) => i.min) ?? 0
  const poly = (v: P2[]) => `M${v.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('L')}Z`
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`들로네 삼각분할: 점 ${pts.length}개, 삼각형 ${tris.length}개`} onPointerLeave={hide}
        onPointerMove={(e) => { if (drag.current == null || !editable) return; const l = localPoint(svgRef.current!, e); onTableChange!(updateRow(table, drag.current, { [roleColumn(mapping, 'x')!]: Math.round(x.invert(l.x - m) * 10) / 10, [roleColumn(mapping, 'y')!]: Math.round(y.invert(l.y - m) * 10) / 10 }), true) }}
        onPointerUp={() => { if (drag.current != null) { drag.current = null; onTableChange!(table, false) } }}>
        <g transform={`translate(${m},${m})`}>
          <rect width={iw} height={ih} fill="#fbfcfc" stroke="#e1e6e4" />
          {cells.map((c, i) => c ? <path key={`v${i}`} d={poly(c)} fill="none" stroke="#9b5fb4" strokeOpacity={0.5} strokeWidth={0.9} pointerEvents="none" data-testid="vor-edge" /> : null)}
          {info.map((t, i) => <path key={i} data-testid="triangle" data-min-angle={t.min.toFixed(2)} d={poly(t.t.map((k) => P2s[k]))} fill={params.fill === 'quality' ? d3.interpolateRdYlGn(Math.min(1, t.min / 60)) : 'none'} fillOpacity={0.55} stroke={params.selected === i ? '#121816' : '#374151'} strokeWidth={params.selected === i ? 2 : 0.9}
            onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>삼각형 {i + 1}</b><br />최소 각 {t.min.toFixed(1)}°<br />외접원 반지름 {t.cc ? fmt(t.cc.r, 1) : '–'}</>) }} onPointerLeave={hide} onClick={compact ? undefined : () => setParams({ selected: params.selected === i ? -1 : i })} />)}
          {params.hull && hullIdx.length > 2 && <path d={poly(hullIdx.map((k) => P2s[k]))} fill="none" stroke="#e07a3f" strokeWidth={2} strokeDasharray="6 3" pointerEvents="none" data-testid="hull" />}
          {(params.circles || sel) && !compact && (params.circles ? info : sel ? [sel] : []).slice(0, 400).map((t, i) => t.cc ? <circle key={`c${i}`} data-testid="circumcircle" cx={x(t.cc.x)} cy={y(t.cc.y)} r={Math.abs(x(t.cc.x + t.cc.r) - x(t.cc.x))} fill="none" stroke="#2a7d74" strokeOpacity={params.circles ? 0.35 : 0.95} strokeWidth={params.circles ? 0.8 : 1.8} pointerEvents="none" /> : null)}
          {pts.map((p) => <circle key={p.row} data-testid="del-point" data-nodrag={editable ? '' : undefined} cx={x(p.x)} cy={y(p.y)} r={compact ? 2 : 5} fill="#121816" stroke="#fff" strokeWidth={1.4} style={{ cursor: editable ? 'grab' : 'default' }} onPointerDown={editable ? (e) => { e.stopPropagation(); (svgRef.current as Element).setPointerCapture(e.pointerId); drag.current = p.row; hide() } : undefined} />)}
        </g>
      </svg>
      {!compact && (<><Readout items={[{ label: '점', value: pts.length }, { label: '삼각형', value: `${tris.length} (= 2n−2−h = ${2 * pts.length - 2 - hullIdx.length})` }, { label: '평균 최소각', value: `${meanMin.toFixed(1)}°` }, { label: '최악 최소각', value: `${worst.toFixed(1)}°` }]} /><Tooltip tip={tip} width={width} /></>)}
    </div>
  )
}

function DelaunayControls({ params, setParams }: ControlsProps<DelaunayParams>) {
  return (
    <ControlGroup title="들로네 삼각분할">
      <Segmented label="삼각형 색" value={params.fill} onChange={(fill) => setParams({ fill })} testId="ctl-del-fill" options={[{ value: 'quality', label: '최소 각(품질)' }, { value: 'none', label: '없음' }]} />
      <Toggle label="모든 외접원" checked={params.circles} onChange={(circles) => setParams({ circles })} testId="ctl-del-circles" />
      <Toggle label="보로노이(쌍대) 겹치기" checked={params.voronoi} onChange={(voronoi) => setParams({ voronoi })} testId="ctl-del-voronoi" />
      <Toggle label="볼록 껍질" checked={params.hull} onChange={(hull) => setParams({ hull })} />
      <Hint>들로네 삼각분할은 각 삼각형의 외접원 안에 다른 점이 하나도 없도록 점들을 삼각형으로 이은 분할이며, 가능한 삼각분할 중 가장 작은 각을 가장 크게 만들어 길쭉한 삼각형을 피합니다. 점을 끌어 옮기면 삼각형이 다시 이어지는 것(플립)을 볼 수 있습니다. 삼각형 수는 점 n개, 볼록 껍질 위 점 h개일 때 2n − 2 − h로 항상 같습니다. 삼각형을 누르면 그 외접원이 나타나 안이 비어 있음을 확인할 수 있습니다. 보로노이 다이어그램은 이 분할의 쌍대입니다.</Hint>
    </ControlGroup>
  )
}

export const delaunayModule: VizModule<DelaunayParams> = {
  roles: [{ key: 'x', label: 'x', type: 'number', required: true, prefer: '^x$' }, { key: 'y', label: 'y', type: 'number', required: true, prefer: '^y$' }],
  datasets: ['points-2d'],
  defaultParams: { fill: 'quality', circles: false, voronoi: false, hull: true, selected: -1 },
  Chart: DelaunayChart,
  Controls: DelaunayControls,
  hint: '점을 끌어 삼각분할이 바뀌는 모습을 보세요 · 삼각형을 눌러 외접원 확인 · 보로노이 쌍대를 겹쳐 보기',
}
