import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber } from '../../data/table'
import { categoryColor } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { buildTree } from '../../stats/hierarchy'
import { dustStep, gosperLevelFor, gosperMap, normalizeColumns, type GNode, type Magnet, type Pt } from '../../stats/multi9'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'

// ───────────────────────────── Dust & Magnet ─────────────────────────────

export interface DustParams { magnets: Magnet[]; spread: number; rate: number; contrast: number; trails: boolean; selected: number; nonce: number; colorBy: number }

const circleMagnets = (k: number): Magnet[] => Array.from({ length: k }, (_, j) => ({ x: 0.5 + 0.38 * Math.cos(-Math.PI / 2 + (2 * Math.PI * j) / k), y: 0.5 + 0.38 * Math.sin(-Math.PI / 2 + (2 * Math.PI * j) / k), strength: 1, on: true }))

function useDust(table: ChartProps<DustParams>['table'], mapping: ChartProps<DustParams>['mapping']) {
  return useMemo(() => {
    const cols = roleColumns(mapping, 'vars')
    const ci = cols.map((c) => columnIndex(table, c))
    if (cols.length < 2 || ci.some((i) => i < 0)) return null
    const li = columnIndex(table, roleColumn(mapping, 'label'))
    const raw: number[][] = [], rowOf: number[] = []
    table.rows.forEach((r, i) => { const v = ci.map((c) => toNumber(r[c])); if (v.every((x) => x != null)) { raw.push(v as number[]); rowOf.push(i) } })
    if (raw.length < 2) return null
    return { cols, raw, vals: normalizeColumns(raw), rowOf, names: rowOf.map((i) => (li >= 0 ? toLabel(table.rows[i][li]) : `점 ${i + 1}`)) }
  }, [table, mapping])
}

function DustChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<DustParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const data = useDust(table, mapping)
  const [, tick] = useState(0)
  const pos = useRef<Pt[]>([])
  const dragging = useRef(-1)
  const key = data ? `${data.cols.join('|')}|${data.raw.length}|${params.nonce}` : ''
  const magnets = data && params.magnets.length === data.cols.length ? params.magnets : data ? circleMagnets(data.cols.length) : []
  const magRef = useRef(magnets); magRef.current = magnets
  const spreadRef = useRef(params.spread); spreadRef.current = params.spread
  const rateRef = useRef(params.rate); rateRef.current = params.rate
  const contrastRef = useRef(params.contrast); contrastRef.current = params.contrast
  const sizeRef = useRef(0)
  // dust restarts in the middle whenever the data or the reset counter changes; magnets pull it from there
  useEffect(() => { if (data) { pos.current = data.vals.map(() => [0.5, 0.5] as Pt); tick((n) => n + 1) } }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const magKey = magnets.map((m) => `${m.x.toFixed(3)},${m.y.toFixed(3)},${m.strength},${m.on}`).join(';')
  useEffect(() => {
    if (!data) return
    let raf = 0, alive = true
    const loop = () => {
      if (!alive) return
      const move = dustStep(pos.current, data.vals, magRef.current, rateRef.current, spreadRef.current * (1 / Math.max(1, Math.sqrt(data.vals.length))) * 0.5, contrastRef.current)
      tick((n) => n + 1)
      if (move > 1e-4) raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { alive = false; cancelAnimationFrame(raf) }
  }, [data, key, magKey, params.spread, params.rate, params.contrast])
  if (!data) return <ChartMessage>수치형 변수를 2개 이상 고르세요(행마다 모든 값이 있어야 합니다).</ChartMessage>
  if (pos.current.length !== data.vals.length) pos.current = data.vals.map(() => [0.5, 0.5] as Pt)
  const k = data.cols.length
  const color = categoryColor(data.cols)
  const pad = compact ? 10 : 46
  const size = Math.min(width, height) - 2 * pad
  sizeRef.current = size
  const ox = (width - size) / 2, oy = (height - size) / 2
  const sx = (u: number) => ox + u * size, sy = (v: number) => oy + v * size
  const moveMagnet = (e: PointerEvent) => {
    if (dragging.current < 0 || !svgRef.current) return
    const p = localPoint(svgRef.current, e)
    const u = Math.min(1.05, Math.max(-0.05, (p.x - ox) / size)), v = Math.min(1.05, Math.max(-0.05, (p.y - oy) / size))
    setParams({ magnets: magnets.map((m, j) => (j === dragging.current ? { ...m, x: u, y: v } : m)) })
  }
  const sel = params.selected
  const dominant = (i: number) => (params.colorBy >= 0 ? params.colorBy : data.vals[i].indexOf(Math.max(...data.vals[i])))
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Dust & Magnet: 먼지 ${data.vals.length}개, 자석 ${k}개`} style={{ touchAction: 'none' }}
        onPointerMove={compact ? undefined : moveMagnet} onPointerUp={() => { dragging.current = -1 }} onPointerLeave={() => { dragging.current = -1; hide() }}>
        <rect x={ox} y={oy} width={size} height={size} fill="#fafcfc" stroke="#e5eaea" />
        {sel >= 0 && !compact && magnets.map((m, j) => {
          const kk = m.on ? m.strength * data.vals[sel][j] ** params.contrast : 0
          return kk > 0 ? <line key={j} x1={sx(pos.current[sel][0])} y1={sy(pos.current[sel][1])} x2={sx(m.x)} y2={sy(m.y)} stroke={color(data.cols[j])} strokeWidth={0.5 + kk * 4} opacity={0.55} pointerEvents="none" /> : null
        })}
        {data.vals.map((_, i) => {
          const p = pos.current[i]
          const hot = sel === i || (linked?.rows.includes(data.rowOf[i]) ?? false)
          const off = magnets[dominant(i)]?.on === false
          return (
            <circle key={i} cx={sx(p[0])} cy={sy(p[1])} r={hot ? 6 : compact ? 2.4 : 3.6} fill={off ? '#b6bec4' : color(data.cols[dominant(i)])} fillOpacity={0.75} stroke={hot ? '#d4452f' : '#fff'} strokeWidth={hot ? 2 : 0.6} data-testid="dust" data-i={i} style={{ cursor: compact ? undefined : 'pointer' }}
              onClick={compact ? undefined : () => setParams({ selected: sel === i ? -1 : i })}
              onPointerEnter={(e) => { linked?.set([data.rowOf[i]]); if (!compact) { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{data.names[i]}</b><br />{data.cols.map((c, j) => `${c}: ${fmt(data.raw[i][j], 3)}`).join(' · ')}</>) } }}
              onPointerLeave={() => { linked?.set(null); hide() }} />
          )
        })}
        {magnets.map((m, j) => (
          <g key={j} data-testid="magnet" data-var={data.cols[j]} data-on={m.on ? 1 : 0} style={{ cursor: compact ? undefined : 'grab' }}
            onPointerDown={compact ? undefined : (e) => { dragging.current = j; (e.target as Element).closest('svg')?.setPointerCapture?.(e.pointerId); e.preventDefault() }}>
            <circle cx={sx(m.x)} cy={sy(m.y)} r={compact ? 6 : 10 + 3 * m.strength} fill={m.on ? color(data.cols[j]) : '#fff'} stroke={color(data.cols[j])} strokeWidth={2.2} opacity={m.on ? 0.92 : 0.6} />
            <path d={`M${sx(m.x) - 4},${sy(m.y) - 3}v5a4,4 0 0 0 8,0v-5`} fill="none" stroke={m.on ? '#fff' : color(data.cols[j])} strokeWidth={2} pointerEvents="none" />
            {!compact && <text x={sx(m.x)} y={sy(m.y) - 16 - 3 * m.strength} textAnchor="middle" fontSize={12} fontWeight={700} fill={color(data.cols[j])} pointerEvents="none">{data.cols[j]}</text>}
          </g>
        ))}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function DustControls({ params, setParams, table, mapping }: ControlsProps<DustParams>) {
  const data = useDust(table, mapping)
  if (!data) return null
  const magnets = params.magnets.length === data.cols.length ? params.magnets : circleMagnets(data.cols.length)
  const color = categoryColor(data.cols)
  const patch = (j: number, p: Partial<Magnet>) => setParams({ magnets: magnets.map((m, i) => (i === j ? { ...m, ...p } : m)) })
  return (
    <>
      <ControlGroup title="자석">
        {data.cols.map((c, j) => (
          <div key={c} className="field" data-testid={`magnet-ctl-${j}`}>
            <Toggle label={c} checked={magnets[j].on} onChange={(on) => patch(j, { on })} testId={`magnet-on-${j}`} />
            <Slider label="세기" value={magnets[j].strength} min={0} max={3} step={0.1} onChange={(strength) => patch(j, { strength })} format={(v) => v.toFixed(1)} testId={`magnet-strength-${j}`} disabled={!magnets[j].on} />
            <span className="hint" style={{ color: color(c) }}>● 자석을 끌어 옮기면 먼지가 따라 움직입니다</span>
          </div>
        ))}
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ magnets: circleMagnets(data.cols.length) })} data-testid="dust-circle">자석을 원 둘레에 다시 놓기</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ nonce: params.nonce + 1 })} data-testid="dust-reset">먼지를 가운데로 모으기</button>
      </ControlGroup>
      <ControlGroup title="먼지의 움직임">
        <Slider label="끌려가는 속도" value={params.rate} min={0.03} max={0.6} step={0.01} onChange={(rate) => setParams({ rate })} format={(v) => v.toFixed(2)} testId="ctl-rate" />
        <Slider label="대비 (끌림 = 값의 거듭제곱, 1이면 선형)" value={params.contrast} min={1} max={5} step={0.25} onChange={(contrast) => setParams({ contrast })} format={(v) => v.toFixed(2)} testId="ctl-contrast" />
        <Slider label="겹침 밀어내기" value={params.spread} min={0} max={1} step={0.05} onChange={(spread) => setParams({ spread })} format={(v) => v.toFixed(2)} testId="ctl-spread" />
        <Hint>변수마다 자석이 하나이고, 관측값(먼지)은 정규화한 값에 비례하는 힘으로 모든 자석에 끌려 힘이 균형을 이루는 곳에 멈춥니다. 자석을 끌어 옮기면 그 변수의 값이 큰 먼지일수록 많이 따라오며, 세기를 바꾸거나 끄면 그 변수의 영향이 달라집니다. 먼지를 눌러 어느 자석에 얼마나 끌리는지 선의 굵기로 봅니다. 자석이 원 둘레에 같은 세기로 있으면 위치 계산이 RadViz와 같아지고, 자유로운 자석 위치·세기·애니메이션과 겹침 밀어내기는 이 기법만의 조작입니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const dustMagnetModule: VizModule<DustParams> = {
  roles: [
    { key: 'label', label: '이름', type: 'category', auto: true },
    { key: 'vars', label: '변수 (자석)', type: 'number', required: true, multiple: { min: 2, max: 8 } },
  ],
  datasets: ['phone-specs'],
  defaultParams: { magnets: [], spread: 0.4, rate: 0.12, contrast: 2.5, trails: false, selected: -1, nonce: 0, colorBy: -1 },
  Chart: DustChart,
  Controls: DustControls,
  hint: '자석을 끌어 옮기면 먼지가 따라옵니다 · 자석을 끄거나 세기를 바꿔 변수의 영향을 비교 · 먼지를 눌러 끌리는 힘 확인',
}

// ───────────────────────────── GosperMap ─────────────────────────────

export interface GosperParams { depth: number; focus: string[]; labels: boolean; level: number }

const key6 = (p: Pt) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`
const SQ3 = Math.sqrt(3)

function GosperChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<GosperParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const levels = roleColumns(mapping, 'levels'), valueCol = roleColumn(mapping, 'value')
  const built = useMemo(() => {
    if (!levels.length || !valueCol) return null
    const { tree } = buildTree(table, levels, valueCol)
    const leaves = (n: GNode): number => (n.children?.length ? n.children.reduce((a, c) => a + leaves(c), 0) : 1)
    const lvl = params.level > 0 ? params.level : gosperLevelFor(leaves(tree as GNode), 6)
    const model = gosperMap(tree as GNode, lvl)
    const at = new Map(model.cells.map((c, i) => [key6(c), i]))
    return { tree, model, at, depth: levels.length }
  }, [table, levels.join('|'), valueCol, params.level]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!built || !built.model.leaves.length) return <ChartMessage>계층 수준 열과 값(양수) 열을 고르세요.</ChartMessage>
  const { model, at, depth: maxDepth } = built
  const depth = Math.min(maxDepth, Math.max(1, params.depth))
  const top = [...new Set(model.leaves.map((l) => l.path[0]))]
  const color = categoryColor(top)
  const focusCells = params.focus.length ? model.leafOf.map((li, c) => (params.focus.every((p, k) => model.leaves[li].path[k] === p) ? c : -1)).filter((c) => c >= 0) : model.cells.map((_, i) => i)
  const pts = focusCells.map((c) => model.cells[c])
  const minX = Math.min(...pts.map((p) => p[0])) - 1, maxX = Math.max(...pts.map((p) => p[0])) + 1, minY = Math.min(...pts.map((p) => p[1])) - 1, maxY = Math.max(...pts.map((p) => p[1])) + 1
  const pad = compact ? 6 : 24
  const k = Math.min((width - 2 * pad) / (maxX - minX), (height - 2 * pad - (compact ? 0 : 26)) / (maxY - minY))
  const X = (x: number) => pad + (width - 2 * pad - (maxX - minX) * k) / 2 + (x - minX) * k
  const Y = (y: number) => pad + (height - 2 * pad - (compact ? 0 : 26) - (maxY - minY) * k) / 2 + (y - minY) * k
  const R = 1 / SQ3
  const group = (c: number, d: number) => model.leaves[model.leafOf[c]].path.slice(0, d).join('/')
  const leafShade = (c: number) => {
    const li = model.leafOf[c], lf = model.leaves[li]
    const sib = model.leaves.filter((o) => o.path[0] === lf.path[0])
    const idx = sib.indexOf(lf)
    return 0.55 + 0.4 * (idx / Math.max(1, sib.length - 1)) // lighter leaves later in the group
  }
  const hexPath = (c: number) => {
    const [cx, cy] = model.cells[c]
    return 'M' + Array.from({ length: 6 }, (_, j) => `${X(cx + R * Math.cos(Math.PI / 6 + (j * Math.PI) / 3))},${Y(cy + R * Math.sin(Math.PI / 6 + (j * Math.PI) / 3))}`).join('L') + 'Z'
  }
  const shown = new Set(focusCells)
  // borders: shared hexagon sides where the group at some depth differs; deeper levels are drawn thinner
  const borders = (() => {
    const out: { d: number; a: Pt; b: Pt }[] = []
    for (const c of focusCells) {
      const [cx, cy] = model.cells[c]
      for (let j = 0; j < 6; j++) {
        const ang = (j * Math.PI) / 3
        const nb = at.get(key6([cx + Math.cos(ang), cy + Math.sin(ang)]))
        const a: Pt = [cx + R * Math.cos(ang - Math.PI / 6), cy + R * Math.sin(ang - Math.PI / 6)], b: Pt = [cx + R * Math.cos(ang + Math.PI / 6), cy + R * Math.sin(ang + Math.PI / 6)]
        if (nb === undefined || !shown.has(nb)) { out.push({ d: 0, a, b }); continue }
        if (nb < c) continue
        for (let d = 1; d <= depth; d++) if (group(c, d) !== group(nb, d)) { out.push({ d, a, b }); break }
      }
    }
    return out
  })()
  // label of every region at the shown depth: placed on the region's cell nearest its centroid
  const regions = (() => {
    const m = new Map<string, number[]>()
    focusCells.forEach((c) => { const g = group(c, depth); m.set(g, [...(m.get(g) ?? []), c]) })
    return [...m.entries()].map(([g, cs]) => {
      const mx = cs.reduce((a, c) => a + model.cells[c][0], 0) / cs.length, my = cs.reduce((a, c) => a + model.cells[c][1], 0) / cs.length
      const nearest = cs.reduce((b, c) => (Math.hypot(model.cells[c][0] - mx, model.cells[c][1] - my) < Math.hypot(model.cells[b][0] - mx, model.cells[b][1] - my) ? c : b), cs[0])
      return { g, cells: cs.length, at: model.cells[nearest], name: g.split('/').pop()!, value: model.leaves.filter((l) => l.path.slice(0, depth).join('/') === g).reduce((a, l) => a + l.value, 0) }
    })
  })()
  const total = model.leaves.reduce((a, l) => a + l.value, 0)
  const widthOf = (d: number) => (d === 0 ? 0.6 : Math.max(0.8, (depth - d + 1) * (compact ? 0.8 : 1.4)))
  const click = (c: number) => { const g = group(c, depth).split('/'); setParams({ focus: g.length === params.focus.length ? params.focus.slice(0, -1) : g }) }
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`GosperMap: 잎 ${model.leaves.length}개, 셀 ${model.cells.length}개`} onPointerLeave={hide}>
        {focusCells.map((c) => (
          <path key={c} d={hexPath(c)} fill={color(model.leaves[model.leafOf[c]].path[0])} fillOpacity={leafShade(c)} stroke="none" data-testid="gosper-cell" style={{ cursor: compact ? undefined : 'pointer' }}
            onClick={compact ? undefined : () => click(c)}
            onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); const g = group(c, depth); const r = regions.find((x) => x.g === g); show(lp.x, lp.y, <><b>{g.split('/').join(' › ')}</b><br />값 {fmt(r?.value ?? 0, 4)} ({fmt(((r?.value ?? 0) / total) * 100, 3)}%) · 셀 {r?.cells}개</>) }} onPointerLeave={hide} />
        ))}
        <g pointerEvents="none" data-testid="gosper-borders">
          {borders.map((b, i) => <line key={i} x1={X(b.a[0])} y1={Y(b.a[1])} x2={X(b.b[0])} y2={Y(b.b[1])} stroke={b.d === 0 ? '#9aa6a6' : '#fff'} strokeWidth={widthOf(b.d)} strokeLinecap="round" />)}
        </g>
        {!compact && params.labels && regions.filter((r) => r.cells * k * k > 700).map((r) => (
          <text key={r.g} x={X(r.at[0])} y={Y(r.at[1])} textAnchor="middle" dy="0.34em" fontSize={Math.min(14, 8 + Math.sqrt(r.cells * k * k) / 14)} fontWeight={600} fill="#1f2937" stroke="#fff" strokeWidth={3} paintOrder="stroke" pointerEvents="none" data-testid="gosper-label">{r.name}</text>
        ))}
        {!compact && <text x={12} y={height - 10} fontSize={11} fill="#6b7280" data-testid="gosper-path">{params.focus.length ? `보는 중: ${params.focus.join(' › ')}` : '전체'} · 셀 {model.cells.length}개 · 잎 {model.leaves.length}개 · 표시 수준 {depth}/{maxDepth}</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function GosperControls({ params, setParams, table, mapping }: ControlsProps<GosperParams>) {
  const levels = roleColumns(mapping, 'levels')
  void table
  return (
    <ControlGroup title="수준과 해상도">
      <Slider label="표시 수준 (경계·이름을 보이는 계층)" value={Math.min(levels.length || 1, Math.max(1, params.depth))} min={1} max={Math.max(1, levels.length)} onChange={(depth) => setParams({ depth })} testId="ctl-depth" />
      <Slider label="곡선 차수 (0이면 자동, 셀 수 7ⁿ)" value={params.level} min={0} max={5} onChange={(level) => setParams({ level })} testId="ctl-level" />
      <Toggle label="이름 표시" checked={params.labels} onChange={(labels) => setParams({ labels })} testId="ctl-labels" />
      <button type="button" className="btn btn-secondary btn-sm" disabled={!params.focus.length} onClick={() => setParams({ focus: params.focus.slice(0, -1) })} data-testid="gosper-up">상위 수준으로</button>
      <button type="button" className="btn btn-secondary btn-sm" disabled={!params.focus.length} onClick={() => setParams({ focus: [] })} data-testid="gosper-reset">전체 보기</button>
      <Hint>고스퍼 공간충전곡선은 육각 격자의 모든 점을 연속된 한 줄로 이어 방문합니다. 계층의 잎을 깊이 우선 순서로 이 곡선을 따라 늘어놓고 값에 비례하는 길이의 구간(셀 묶음)을 주면, 모든 상위 노드가 곡선의 연속 구간이라 하나로 이어진 지도 같은 영역이 됩니다. 영역을 누르면 그 노드만 확대하고, 두꺼운 경계는 상위 수준입니다. 셀은 이산 단위라 작은 값은 최소 1셀로 올려 그려지며 면적이 값에 정확히 비례하지는 않습니다.</Hint>
    </ControlGroup>
  )
}

export const gosperMapModule: VizModule<GosperParams> = {
  roles: [
    { key: 'levels', label: '계층 수준 (바깥 → 안쪽)', type: 'category', required: true, multiple: { min: 1, max: 4 } },
    { key: 'value', label: '값 (면적)', type: 'number', required: true },
  ],
  datasets: ['budget', 'categorical', 'votes'],
  defaultParams: { depth: 3, focus: [], labels: true, level: 0 },
  Chart: GosperChart,
  Controls: GosperControls,
  hint: '영역을 눌러 그 노드로 확대 · 표시 수준을 바꿔 계층의 안쪽 경계까지 보기',
}
