import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, updateRow, type DataTable } from '../../data/table'
import { categoryColor } from '../../lib/colors'
import { crystalPreset, crystalResult, infoCrystal, metroSets, mosaicSets, type GridKind, type Pt } from '../../stats/sets9'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, Linked, Mapping, VizModule } from '../types'

// ───────────────────────────── shared ─────────────────────────────

interface Membership { cols: string[]; names: string[]; member: boolean[][]; n: number }

function readMembership(table: DataTable, mapping: Mapping, roleKey = 'sets'): Membership | null {
  const cols = roleColumns(mapping, roleKey)
  const si = cols.map((c) => columnIndex(table, c))
  if (cols.length < 2 || si.some((i) => i < 0)) return null
  const li = columnIndex(table, roleColumn(mapping, 'label'))
  return {
    cols, n: table.rows.length,
    names: table.rows.map((r, i) => (li >= 0 ? toLabel(r[li]) : `원소 ${i + 1}`)),
    member: si.map((c) => table.rows.map((r) => (toNumber(r[c]) ?? 0) > 0)),
  }
}

const setRoles = (max = 8) => [
  { key: 'label', label: '이름', type: 'category' as const, auto: true },
  { key: 'sets', label: '집합 (0/1 소속 열)', type: 'number' as const, required: true, multiple: { min: 2, max } },
]

const isLinked = (linked: Linked | undefined, i: number) => !!linked && linked.rows.includes(i)

/** Edits the membership of one item (toggle) from the control panel. */
function MembershipEditor({ table, mapping, setTable, item, roleKey = 'sets' }: { table: DataTable; mapping: Mapping; setTable?: (t: DataTable) => void; item: number; roleKey?: string }) {
  const m = readMembership(table, mapping, roleKey)
  if (!m || item < 0 || item >= m.n) return <Hint>원소(역·칸)를 누르면 여기서 소속 집합을 바꿀 수 있습니다.</Hint>
  const color = categoryColor(m.cols)
  return (
    <div className="field" data-testid="member-editor">
      <label>{m.names[item]}의 소속</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {m.cols.map((c, s) => (
          <button key={c} type="button" className={`btn btn-sm ${m.member[s][item] ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={m.member[s][item]} data-testid={`member-toggle-${s}`}
            style={m.member[s][item] ? { background: color(c), borderColor: color(c) } : undefined}
            disabled={!setTable} onClick={() => setTable?.(updateRow(table, item, { [c]: m.member[s][item] ? 0 : 1 }))}>{c}</button>
        ))}
      </div>
    </div>
  )
}

// ───────────────────────────── MetroSets ─────────────────────────────

export interface MetroParams { share: number; seed: number; labels: boolean; focus: number; selected: number }

/** Offsets a polyline sideways by d (miter joints, clamped). */
function offsetPolyline(pts: Pt[], d: number): Pt[] {
  if (d === 0 || pts.length < 2) return pts
  const nrm = (a: Pt, b: Pt): Pt => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l] }
  return pts.map((p, i) => {
    const n0 = i > 0 ? nrm(pts[i - 1], p) : null, n1 = i < pts.length - 1 ? nrm(p, pts[i + 1]) : null
    const a = n0 ?? n1!, b = n1 ?? n0!
    const sx = a[0] + b[0], sy = a[1] + b[1]
    const l = Math.hypot(sx, sy) || 1
    const cos = Math.max(0.55, (a[0] * b[0] + a[1] * b[1] + 1) / 2) // clamp the miter length
    const k = d / Math.sqrt(cos)
    return [p[0] + (sx / l) * k, p[1] + (sy / l) * k] as Pt
  })
}

function MetroChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<MetroParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const m = useMemo(() => readMembership(table, mapping), [table, mapping])
  const layout = useMemo(() => (m ? metroSets(m.member, m.n, { share: params.share, seed: params.seed }) : null), [m, params.share, params.seed])
  if (!m || !layout) return <ChartMessage>집합 열(0/1 소속)을 2개 이상 선택하세요.</ChartMessage>
  const color = categoryColor(m.cols)
  const pad = compact ? 10 : 46
  const sx = (width - 2 * pad) / Math.max(1, layout.stats.cols - 1), sy = (height - 2 * pad - (compact ? 0 : 24)) / Math.max(1, layout.stats.rows - 1)
  const cell = Math.max(10, Math.min(sx, sy, 64))
  const ox = (width - cell * (layout.stats.cols - 1)) / 2, oy = (height - (compact ? 0 : 24) - cell * (layout.stats.rows - 1)) / 2
  const px = (p: Pt): Pt => [ox + p[0] * cell, oy + p[1] * cell]
  const lw = Math.max(2.2, Math.min(5, cell * 0.12))
  const gap = lw * 1.05
  const active = params.focus
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`MetroSets: 노선 ${m.cols.length}개, 환승역 ${layout.transfers.length}개`} onPointerLeave={hide}>
        {layout.edges.map((e, k) => e.lines.slice().sort((a, b) => a - b).map((s, j, arr) => {
          const pts = offsetPolyline(e.pts.map(px), (j - (arr.length - 1) / 2) * gap)
          return <polyline key={`${k}-${s}`} points={pts.map((p) => p.join()).join(' ')} fill="none" stroke={color(m.cols[s])} strokeWidth={lw} strokeLinecap="round" strokeLinejoin="round" opacity={active >= 0 && active !== s ? 0.14 : 1} data-testid="metro-line" data-set={s} />
        }))}
        {m.names.map((nm, i) => {
          const p = layout.pos[i]
          if (!p) return null
          const [x, y] = px(p)
          const sets = m.cols.map((_, s) => s).filter((s) => m.member[s][i])
          const transfer = sets.length > 1
          const dim = active >= 0 && !sets.includes(active)
          const hot = params.selected === i || isLinked(linked, i)
          const r = transfer ? lw * 1.15 + Math.min(sets.length - 1, 3) * 1.4 : lw * 0.75
          return (
            <g key={i} opacity={dim ? 0.25 : 1} style={{ cursor: compact ? undefined : 'pointer' }} data-testid={transfer ? 'metro-transfer' : 'metro-station'} data-item={i}
              onClick={compact ? undefined : () => setParams({ selected: params.selected === i ? -1 : i })}
              onPointerEnter={(e) => { linked?.set([i]); if (!compact) { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{nm}</b><br />{sets.map((s) => m.cols[s]).join(' · ')}{transfer ? ' (환승역)' : ''}</>) } }}
              onPointerLeave={() => { linked?.set(null); hide() }}>
              <circle cx={x} cy={y} r={r + (hot ? 3 : 0)} fill={transfer ? '#fff' : color(m.cols[sets[0]])} stroke={hot ? '#d4452f' : transfer ? '#1b2a2a' : '#fff'} strokeWidth={transfer ? 2 : 1.2} />
              {!compact && params.labels && <text x={x + r + 4} y={y - r - 1} className="radar-axis-label" fontSize={10}>{nm}</text>}
            </g>
          )
        })}
        {!compact && (
          <g transform={`translate(${pad},${height - 18})`} pointerEvents="none">
            {m.cols.map((c, s) => <g key={c} transform={`translate(${s * 92},0)`}><rect width={16} height={4} y={2} rx={2} fill={color(c)} /><text x={22} y={7} fontSize={11} fill="#4b5563">{c}</text></g>)}
          </g>
        )}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function MetroControls({ params, setParams, table, mapping, setTable }: ControlsProps<MetroParams>) {
  const m = readMembership(table, mapping)
  const layout = useMemo(() => (m ? metroSets(m.member, m.n, { share: params.share, seed: params.seed }) : null), [m, params.share, params.seed])
  const color = m ? categoryColor(m.cols) : () => '#999'
  return (
    <>
      <ControlGroup title="노선 배치">
        <Slider label="공유 구간 선호 (낮을수록 노선이 같은 구간을 함께 지남)" value={params.share} min={0.05} max={1} step={0.05} onChange={(share) => setParams({ share })} format={(v) => v.toFixed(2)} testId="ctl-share" />
        <Toggle label="역 이름 표시" checked={params.labels} onChange={(labels) => setParams({ labels })} testId="ctl-labels" />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ seed: params.seed + 1 })} data-testid="metro-relayout">레이아웃 다시 계산</button>
        {m && (
          <div className="field">
            <label>노선 강조</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button type="button" className="btn btn-secondary btn-sm" aria-pressed={params.focus < 0} onClick={() => setParams({ focus: -1 })}>전체</button>
              {m.cols.map((c, s) => <button key={c} type="button" className="btn btn-secondary btn-sm" aria-pressed={params.focus === s} data-testid={`metro-focus-${s}`} style={{ borderColor: color(c) }} onClick={() => setParams({ focus: params.focus === s ? -1 : s })}>{c}</button>)}
            </div>
          </div>
        )}
        {layout && <p className="hint" data-testid="metro-stats">환승역 {layout.transfers.length}개 · 공유 구간 {layout.stats.sharedEdges}개 · 꺾임 {layout.stats.bends}번 · 노선 교차 {layout.stats.crossings}번</p>}
        <Hint>집합마다 한 노선이 그 집합의 모든 원소(역)를 한 번씩 지나고, 둘 이상의 노선이 지나는 원소는 환승역입니다. 노선은 서로 같은 구간을 나란히 지나도록 경로를 고르고(지지 그래프), 모든 구간을 수평·수직·45° 대각선으로만 그립니다(구간당 꺾임 최대 1번). 배치는 휴리스틱이며 원 논문의 최적화(교차·꺾임 최소화)를 보장하지 않습니다.</Hint>
      </ControlGroup>
      <ControlGroup title="소속 편집">
        <MembershipEditor table={table} mapping={mapping} setTable={setTable} item={params.selected} />
      </ControlGroup>
    </>
  )
}

export const metroSetsModule: VizModule<MetroParams> = {
  roles: setRoles(),
  datasets: ['lab-members', 'set-members'],
  defaultParams: { share: 0.2, seed: 5, labels: true, focus: -1, selected: -1 },
  Chart: MetroChart,
  Controls: MetroControls,
  hint: '역을 눌러 소속 집합을 확인하고 설정 패널에서 소속을 바꿉니다 · 노선 이름을 눌러 한 노선만 강조',
}

// ───────────────────────────── MosaicSets ─────────────────────────────

export interface MosaicParams { grid: GridKind; seed: number; effort: number; labels: boolean; selected: number }

function hexPoints(cx: number, cy: number, r: number): Pt[] {
  return Array.from({ length: 6 }, (_, k) => [cx + r * Math.cos(Math.PI / 6 + (k * Math.PI) / 3), cy + r * Math.sin(Math.PI / 6 + (k * Math.PI) / 3)] as Pt)
}

function MosaicChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<MosaicParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const m = useMemo(() => readMembership(table, mapping), [table, mapping])
  const key = m ? m.member.map((s) => s.map((v) => (v ? 1 : 0)).join('')).join('/') : ''
  const layout = useMemo(() => (m ? mosaicSets(m.member, m.n, params.grid, params.seed, params.effort) : null), [key, params.grid, params.seed, params.effort]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!m || !layout) return <ChartMessage>집합 열(0/1 소속)을 2개 이상 선택하세요.</ChartMessage>
  const color = categoryColor(m.cols)
  const { cols, rows } = layout
  const pad = compact ? 8 : 20
  const hexW = Math.sqrt(3), hexH = 2
  const unitW = params.grid === 'hex' ? (cols + 0.5) * hexW : cols * 2, unitH = params.grid === 'hex' ? (rows - 1) * 1.5 + hexH : rows * 2
  const k = Math.min((width - 2 * pad) / unitW, (height - 2 * pad - (compact ? 0 : 22)) / unitH)
  const cellPos = (c: number): Pt => {
    const x = c % cols, y = Math.floor(c / cols)
    return params.grid === 'hex'
      ? [pad + (width - 2 * pad - unitW * k) / 2 + (x * hexW + (y % 2 ? hexW : hexW / 2)) * k, pad + (height - 2 * pad - 22 - unitH * k) / 2 + (1 + y * 1.5) * k]
      : [pad + (width - 2 * pad - unitW * k) / 2 + (x * 2 + 1) * k, pad + (height - 2 * pad - 22 - unitH * k) / 2 + (y * 2 + 1) * k]
  }
  const shape = (c: number, scale: number): Pt[] => {
    const [cx, cy] = cellPos(c)
    return params.grid === 'hex' ? hexPoints(cx, cy, k * scale) : [[cx - k * scale, cy - k * scale], [cx + k * scale, cy - k * scale], [cx + k * scale, cy + k * scale], [cx - k * scale, cy + k * scale]]
  }
  const path = (pts: Pt[]) => 'M' + pts.map((p) => p.join()).join('L') + 'Z'
  // boundary edges of each set: polygon sides that face a non-member cell or the border
  const nbr = (c: number): number[] => {
    const x = c % cols, y = Math.floor(c / cols)
    const d: Pt[] = params.grid === 'square' ? [[1, 0], [0, 1], [-1, 0], [0, -1]] : (y % 2 === 0 ? [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]] : [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]])
    return d.map(([dx, dy]) => (x + dx < 0 || y + dy < 0 || x + dx >= cols || y + dy >= rows ? -1 : (y + dy) * cols + x + dx))
  }
  const boundary = (s: number): [Pt, Pt][] => {
    const out: [Pt, Pt][] = []
    for (let i = 0; i < m.n; i++) {
      if (!m.member[s][i]) continue
      const c = layout.cellOf[i]
      const pts = shape(c, 1 - 0.07 * s - 0.04)
      nbr(c).forEach((nb, side) => {
        const other = nb >= 0 ? layout.itemAt[nb] : -1
        if (other >= 0 && m.member[s][other]) return
        // squares list their sides right, bottom, left, top; hexes list them from the right, counter-clockwise on screen
        out.push(params.grid === 'square' ? [pts[(side + 1) % 4], pts[(side + 2) % 4]] : [pts[(side + 5) % 6], pts[side]])
      })
    }
    return out
  }
  const bounds = useMemo(() => m.cols.map((_, s) => boundary(s)), [layout, m, params.grid, width, height]) // eslint-disable-line react-hooks/exhaustive-deps
  const contiguous = layout.components.filter((c) => c === 1).length
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`MosaicSets: ${params.grid === 'hex' ? '육각' : '사각'} 격자, 집합 ${m.cols.length}개 중 ${contiguous}개가 연속된 영역`} onPointerLeave={hide}>
        {Array.from({ length: cols * rows }, (_, c) => <path key={c} d={path(shape(c, 0.96))} fill="#f6f8f8" stroke="#e5eaea" strokeWidth={0.6} />)}
        {m.names.map((nm, i) => {
          const c = layout.cellOf[i]
          const sets = m.cols.map((_, s) => s).filter((s) => m.member[s][i])
          const [cx, cy] = cellPos(c)
          const hot = params.selected === i || isLinked(linked, i)
          return (
            <g key={i} data-testid="mosaic-cell" data-item={i} style={{ cursor: compact ? undefined : 'pointer' }}
              onClick={compact ? undefined : () => setParams({ selected: params.selected === i ? -1 : i })}
              onPointerEnter={(e) => { linked?.set([i]); if (!compact) { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{nm}</b><br />{sets.length ? sets.map((s) => m.cols[s]).join(' · ') : '소속 없음'}</>) } }}
              onPointerLeave={() => { linked?.set(null); hide() }}>
              <path d={path(shape(c, 0.94))} fill={sets.length ? '#fff' : '#eef1f1'} stroke={hot ? '#d4452f' : '#cfd6d6'} strokeWidth={hot ? 2.2 : 0.8} />
              {sets.map((s, j) => <circle key={s} cx={cx + (j - (sets.length - 1) / 2) * k * 0.42} cy={cy + (compact ? 0 : k * 0.28)} r={Math.max(1.6, k * 0.17)} fill={color(m.cols[s])} />)}
              {!compact && params.labels && k > 14 && <text x={cx} y={cy - k * 0.2} textAnchor="middle" fontSize={Math.min(11, k * 0.5)} fill="#374151">{nm.length > 4 ? nm.slice(0, 4) : nm}</text>}
            </g>
          )
        })}
        {m.cols.map((c, s) => (
          <g key={c} pointerEvents="none" data-testid="mosaic-region" data-set={s}>
            {bounds[s].map(([a, b], j) => <line key={j} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={color(c)} strokeWidth={Math.max(1.6, k * 0.1)} strokeLinecap="round" />)}
          </g>
        ))}
        {!compact && (
          <g transform={`translate(${pad},${height - 14})`} pointerEvents="none">
            {m.cols.map((c, s) => <g key={c} transform={`translate(${s * 104},0)`}><rect width={16} height={4} y={2} rx={2} fill={color(c)} /><text x={22} y={7} fontSize={11} fill="#4b5563">{c}{layout.components[s] > 1 ? ` (${layout.components[s]}조각)` : ''}</text></g>)}
          </g>
        )}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function MosaicControls({ params, setParams, table, mapping, setTable }: ControlsProps<MosaicParams>) {
  const m = readMembership(table, mapping)
  const key = m ? m.member.map((s) => s.map((v) => (v ? 1 : 0)).join('')).join('/') : ''
  const layout = useMemo(() => (m ? mosaicSets(m.member, m.n, params.grid, params.seed, params.effort) : null), [key, params.grid, params.seed, params.effort]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <ControlGroup title="격자와 최적화">
        <Segmented label="격자" value={params.grid} onChange={(grid) => setParams({ grid })} options={[{ value: 'square', label: '사각' }, { value: 'hex', label: '육각' }]} testId="ctl-grid" />
        <Slider label="최적화 반복 횟수 (0이면 정렬만 한 초기 배치)" value={params.effort} min={0} max={20000} step={500} onChange={(effort) => setParams({ effort })} testId="ctl-effort" />
        <Toggle label="이름 표시" checked={params.labels} onChange={(labels) => setParams({ labels })} testId="ctl-labels" />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ seed: params.seed + 1 })} data-testid="mosaic-relayout">다른 배치 찾기</button>
        {layout && m && <p className="hint" data-testid="mosaic-stats">연속된 집합 {layout.components.filter((c) => c === 1).length} / {m.cols.length} · 비용 {layout.initialCost.toFixed(0)} → {layout.cost.toFixed(0)}</p>}
        <Hint>원소 하나가 격자 셀 하나를 차지하고, 같은 집합의 셀이 한 덩어리로 이어지도록 셀 배치를 바꿉니다. 원 논문은 정수 선형 계획법으로 최적 배치를 찾지만, 이 구현은 모의 담금질(연결 요소 수와 둘레를 줄이는 교환)이라 최적을 보장하지 않으며, 끊어진 집합은 범례에 조각 수로 표시합니다. 셀 색 점은 소속, 굵은 선은 집합 영역의 경계입니다.</Hint>
      </ControlGroup>
      <ControlGroup title="소속 편집">
        <MembershipEditor table={table} mapping={mapping} setTable={setTable} item={params.selected} />
      </ControlGroup>
    </>
  )
}

export const mosaicSetsModule: VizModule<MosaicParams> = {
  roles: setRoles(),
  datasets: ['lab-members', 'set-members'],
  defaultParams: { grid: 'hex', seed: 1, effort: 8000, labels: true, selected: -1 },
  Chart: MosaicChart,
  Controls: MosaicControls,
  hint: '셀을 눌러 소속을 확인하고 바꿉니다 · 격자 모양과 반복 횟수를 바꿔 영역이 이어지는 정도를 비교',
}

// ───────────────────────────── InfoCrystal ─────────────────────────────

export interface CrystalParams { masks: number[]; off: number[]; counts: boolean }

function CrystalChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<CrystalParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const m = useMemo(() => readMembership(table, mapping, 'criteria'), [table, mapping])
  const activeIdx = m ? m.cols.map((_, i) => i).filter((i) => !params.off.includes(i)) : []
  const model = useMemo(() => (m && activeIdx.length >= 2 ? infoCrystal(activeIdx.map((i) => m.member[i]), m.n) : null), [m, params.off.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!m) return <ChartMessage>검색어(조건) 열(0/1)을 2개 이상 선택하세요.</ChartMessage>
  if (!model) return <ChartMessage>활성화된 조건이 2개 이상 있어야 합니다.</ChartMessage>
  const k = activeIdx.length
  const color = categoryColor(m.cols)
  const R = Math.min(width, height) / 2 - (compact ? 10 : 78)
  const cx = width / 2, cy = height / 2 - (compact ? 0 : 6)
  const P = (x: number, y: number): Pt => [cx + x * R, cy + y * R]
  const maxCount = Math.max(1, ...model.icons.map((i) => i.count))
  const sel = new Set(params.masks)
  const result = crystalResult(model.icons, sel)
  const toggle = (mask: number) => setParams({ masks: sel.has(mask) ? params.masks.filter((x) => x !== mask) : [...params.masks, mask] })
  const iconR = (count: number) => (compact ? 5 : Math.max(10, 8 + (R * 0.11 * Math.sqrt(count)) / Math.sqrt(maxCount)))
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`InfoCrystal: 조건 ${k}개, 조합 ${model.icons.length}개, 선택 결과 ${result.length}건`} onPointerLeave={hide}>
        <polygon points={model.corners.map((c) => P(c[0], c[1]).join()).join(' ')} fill="#f7fafa" stroke="#dbe3e3" />
        {model.icons.map((ic) => {
          const [x, y] = P(ic.x, ic.y)
          const members = activeIdx.filter((_, j) => ic.mask & (1 << j))
          const inQuery = sel.has(ic.mask)
          return (
            <g key={ic.mask} data-testid="crystal-icon" data-mask={ic.mask} data-count={ic.count} style={{ cursor: compact ? undefined : 'pointer' }} onClick={compact ? undefined : () => toggle(ic.mask)}
              onPointerEnter={(e) => { if (!compact) { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{members.map((i) => m.cols[i]).join(' ∩ ')}</b><br />다른 조건은 만족하지 않음 · 문서 {ic.count}건 ({((ic.count / m.n) * 100).toFixed(1)}%)</>) } }} onPointerLeave={hide}>
              {members.map((i) => { const j = activeIdx.indexOf(i); const [qx, qy] = P(model.corners[j][0], model.corners[j][1]); return <line key={i} x1={x} y1={y} x2={qx} y2={qy} stroke={color(m.cols[i])} strokeWidth={inQuery ? 1.6 : 0.6} opacity={inQuery ? 0.9 : 0.28} pointerEvents="none" /> })}
              <circle cx={x} cy={y} r={iconR(ic.count)} fill={ic.count ? '#fff' : '#f3f5f5'} stroke={inQuery ? '#d4452f' : '#6b7280'} strokeWidth={inQuery ? 3 : 1.2} />
              {members.map((i, a) => {
                const arc = d3.arc()({ innerRadius: iconR(ic.count) - 4, outerRadius: iconR(ic.count) - 1, startAngle: (a / members.length) * Math.PI * 2, endAngle: ((a + 1) / members.length) * Math.PI * 2 - 0.04 })
                return <path key={i} d={arc ?? ''} transform={`translate(${x},${y})`} fill={color(m.cols[i])} pointerEvents="none" />
              })}
              {!compact && params.counts && <text x={x} y={y} textAnchor="middle" dy="0.34em" fontSize={11} fontWeight={600} fill="#1f2937" pointerEvents="none">{ic.count}</text>}
            </g>
          )
        })}
        {model.corners.map((c, j) => {
          const [x, y] = P(c[0] * 1.0, c[1] * 1.0)
          const i = activeIdx[j]
          const total = m.member[i].filter(Boolean).length
          return (
            <g key={i} pointerEvents="none">
              <text x={x + c[0] * (compact ? 8 : 40)} y={y + c[1] * (compact ? 8 : 40)} textAnchor={c[0] > 0.3 ? 'start' : c[0] < -0.3 ? 'end' : 'middle'} dy="0.34em" fontSize={compact ? 9 : 12} fontWeight={600} fill={color(m.cols[i])}>{m.cols[i]}</text>
              {!compact && <text x={x + c[0] * 40} y={y + c[1] * 40 + 13} textAnchor={c[0] > 0.3 ? 'start' : c[0] < -0.3 ? 'end' : 'middle'} fontSize={10} fill="#6b7280">{total}건</text>}
            </g>
          )
        })}
        {!compact && <text x={12} y={height - 12} fontSize={12} fill="#374151" data-testid="crystal-result">결과 {result.length}건 ({((result.length / m.n) * 100).toFixed(1)}%) · 전체 {m.n}건 · 어느 조건도 만족하지 않음 {model.outside.length}건</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function CrystalControls({ params, setParams, table, mapping }: ControlsProps<CrystalParams>) {
  const m = readMembership(table, mapping, 'criteria')
  const k = m ? m.cols.length - params.off.filter((i) => i < m.cols.length).length : 0
  const color = m ? categoryColor(m.cols) : () => '#999'
  return (
    <ControlGroup title="조건과 불리언 조합">
      <Toggle label="아이콘에 문서 수 표시" checked={params.counts} onChange={(counts) => setParams({ counts })} testId="ctl-counts" />
      {m && (
        <div className="field">
          <label>조건 활성화 (끄면 결정체에서 빠짐)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {m.cols.map((c, i) => <button key={c} type="button" className="btn btn-secondary btn-sm" aria-pressed={!params.off.includes(i)} data-testid={`crystal-criterion-${i}`} style={{ borderColor: color(c) }}
              onClick={() => setParams({ off: params.off.includes(i) ? params.off.filter((x) => x !== i) : [...params.off, i], masks: [] })}>{c}</button>)}
          </div>
        </div>
      )}
      <div className="field">
        <label>조합 선택 (아이콘의 합집합이 결과)</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {([['and', '모두 포함 (AND)'], ['or', '하나 이상 (OR)'], ['one', '정확히 하나'], ['multi', '둘 이상']] as const).map(([kind, label]) => (
            <button key={kind} type="button" className="btn btn-secondary btn-sm" data-testid={`crystal-${kind}`} disabled={k < 2} onClick={() => setParams({ masks: [...crystalPreset(k, kind)] })}>{label}</button>
          ))}
          <button type="button" className="btn btn-secondary btn-sm" data-testid="crystal-clear" onClick={() => setParams({ masks: [] })}>선택 해제</button>
        </div>
      </div>
      <Hint>조건(검색어)마다 정다각형의 꼭짓점이 있고, 그 조건들만 만족하고 나머지는 만족하지 않는 문서의 수가 조건 조합마다 아이콘 하나에 담깁니다. 많은 조건을 함께 만족하는 아이콘일수록 가운데에 놓입니다. 아이콘을 눌러 합치면 그 합집합이 불리언 질의의 결과이고, 조건을 끄면 결정체가 다시 계산됩니다. 원 논문의 가중 질의·임계값 모드는 구현하지 않았습니다.</Hint>
    </ControlGroup>
  )
}

export const infoCrystalModule: VizModule<CrystalParams> = {
  roles: [
    { key: 'label', label: '문서 이름', type: 'category', auto: true },
    { key: 'criteria', label: '조건 (0/1 적중 열)', type: 'number', required: true, multiple: { min: 2, max: 5 } },
  ],
  datasets: ['search-hits', 'set-members'],
  defaultParams: { masks: [], off: [], counts: true },
  Chart: CrystalChart,
  Controls: CrystalControls,
  hint: '아이콘을 눌러 불리언 질의에 포함하거나 뺍니다 · 조건 버튼으로 결정체를 다시 계산',
}
