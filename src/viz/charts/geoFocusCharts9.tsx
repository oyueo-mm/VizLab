import { useMemo, useRef, type PointerEvent } from 'react'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber } from '../../data/table'
import { categoryColor, schemes } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { focusInverse, focusMap, type FocusMode, type FocusSpec } from '../../stats/focus9'
import { odModel, type OdRow } from '../../stats/geo9'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'

// ───────────────────────────── OD Maps ─────────────────────────────

export interface OdParams { mode: 'origin' | 'dest'; scale: 'global' | 'local'; log: boolean; hideSelf: boolean; selOuter: number; selInner: number }

function OdMapChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<OdParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const model = useMemo(() => {
    const idx = ['origin', 'dest', 'ox', 'oy', 'dx', 'dy', 'flow'].map((k) => columnIndex(table, roleColumn(mapping, k)))
    if (idx.some((i) => i < 0)) return null
    const rows: OdRow[] = []
    for (const r of table.rows) {
      const n = [2, 3, 4, 5, 6].map((j) => toNumber(r[idx[j]]))
      if (n.every((v) => v != null)) rows.push({ origin: toLabel(r[idx[0]]), dest: toLabel(r[idx[1]]), ox: n[0]!, oy: n[1]!, dx: n[2]!, dy: n[3]!, flow: n[4]! })
    }
    return odModel(rows)
  }, [table, mapping])
  if (!model) return <ChartMessage>출발·도착 지역, 두 지역의 격자 위치(열·행), 이동량 열을 고르세요.</ChartMessage>
  const { cols, rows: R } = model
  const pad = compact ? 4 : 26
  const total = { w: cols * cols, h: R * R }
  const k = Math.min((width - 2 * pad) / total.w, (height - 2 * pad - (compact ? 0 : 20)) / total.h)
  const ox = (width - total.w * k) / 2, oy = (height - (compact ? 0 : 20) - total.h * k) / 2
  const ramp = schemes.teal.interpolate
  const cellOf = (o: number, d: number) => (params.mode === 'origin' ? { f: model.flow[o][d], pos: { x: model.grid[o][0] * cols + model.grid[d][0], y: model.grid[o][1] * R + model.grid[d][1] } } : { f: model.flow[d][o], pos: { x: model.grid[o][0] * cols + model.grid[d][0], y: model.grid[o][1] * R + model.grid[d][1] } })
  const localMax = (o: number) => Math.max(1e-9, ...model.regions.map((_, d) => (d === o ? 0 : cellOf(o, d).f)))
  const norm = (f: number, o: number) => {
    const m = params.scale === 'global' ? model.maxOff : localMax(o)
    const v = Math.min(1, f / Math.max(1e-9, m))
    return params.log ? Math.log1p(v * 99) / Math.log(100) : v
  }
  const outerLabel = params.mode === 'origin' ? '출발' : '도착', innerLabel = params.mode === 'origin' ? '도착' : '출발'
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`OD Map: 지역 ${model.regions.length}개, 바깥 격자 = ${outerLabel}, 안쪽 격자 = ${innerLabel}`} onPointerLeave={hide}>
        {model.regions.map((_, o) => {
          const [gx, gy] = model.grid[o]
          const sel = params.selOuter === o
          return (
            <g key={o} data-testid="od-outer" data-region={model.regions[o]}>
              <rect x={ox + gx * cols * k} y={oy + gy * R * k} width={cols * k} height={R * k} fill="#f7f9f9" stroke={sel ? '#d4452f' : '#aeb8b8'} strokeWidth={sel ? 2.2 : 0.8} />
              {model.regions.map((_, d) => {
                const c = cellOf(o, d)
                const self = d === o
                const x = ox + c.pos.x * k, y = oy + c.pos.y * k
                const hot = params.selInner === d
                if (self) return params.hideSelf ? null : <rect key={d} x={x} y={y} width={k} height={k} fill="#e3e8e8" />
                return (
                  <rect key={d} x={x + 0.3} y={y + 0.3} width={Math.max(0.5, k - 0.6)} height={Math.max(0.5, k - 0.6)} fill={c.f > 0 ? ramp(0.12 + 0.88 * norm(c.f, o)) : '#f1f4f4'} stroke={hot ? '#d4452f' : 'none'} strokeWidth={1.4} data-testid="od-cell" data-flow={c.f}
                    opacity={(params.selOuter >= 0 && !sel) || (params.selInner >= 0 && !hot && sel) ? 0.35 : 1}
                    style={{ cursor: compact ? undefined : 'pointer' }}
                    onClick={compact ? undefined : () => setParams({ selOuter: params.selOuter === o && params.selInner === d ? -1 : o, selInner: params.selOuter === o && params.selInner === d ? -1 : d })}
                    onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{params.mode === 'origin' ? `${model.regions[o]} → ${model.regions[d]}` : `${model.regions[d]} → ${model.regions[o]}`}</b><br />이동량 {fmt(c.f, 4)}</>) }} onPointerLeave={hide} />
                )
              })}
            </g>
          )
        })}
        {!compact && <text x={12} y={height - 8} fontSize={11} fill="#6b7280" data-testid="od-note">바깥 칸 = {outerLabel} 지역(지도 위치 그대로), 칸 안의 작은 칸 = {innerLabel} 지역(같은 지도 배열) · 진할수록 이동량이 큼{params.selOuter >= 0 ? ` · 선택: ${params.mode === 'origin' ? model.regions[params.selOuter] : model.regions[params.selInner] ?? ''}` : ''}</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function OdControls({ params, setParams, table, mapping }: ControlsProps<OdParams>) {
  void table; void mapping
  return (
    <ControlGroup title="OD 지도 보기">
      <Segmented label="바깥 격자의 기준" value={params.mode} onChange={(mode) => setParams({ mode, selOuter: -1, selInner: -1 })} options={[{ value: 'origin', label: '출발지(안: 도착지)' }, { value: 'dest', label: '도착지(안: 출발지)' }]} testId="ctl-mode" />
      <Segmented label="색 기준" value={params.scale} onChange={(scale) => setParams({ scale })} options={[{ value: 'global', label: '전체 최댓값' }, { value: 'local', label: '칸마다 최댓값' }]} testId="ctl-scale" />
      <Toggle label="로그 색 눈금" checked={params.log} onChange={(log) => setParams({ log })} testId="ctl-log" />
      <Toggle label="같은 지역 칸 숨기기" checked={params.hideSelf} onChange={(hideSelf) => setParams({ hideSelf })} testId="ctl-hideself" />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ selOuter: -1, selInner: -1 })} data-testid="od-clear">선택 해제</button>
      <Hint>지역을 지도 위치에 맞춘 격자 칸으로 놓고, 칸마다 안에 같은 지도 배열의 작은 칸을 넣습니다. 바깥 칸이 출발지라면 그 안의 작은 칸 하나가 ‘그 출발지에서 그 도착지로’의 이동량이고, 색이 진할수록 많이 이동한 것입니다. 선이 아니라 칸이라 흐름이 많아도 겹치지 않고, 안쪽 같은 위치의 작은 칸을 훑으면 한 도착지로 모이는 출발지를 볼 수 있습니다. 칸을 누르면 그 도착지를 모든 바깥 칸에서 강조합니다. 이 구현은 사각 격자로 단순화한 지도에 대한 것이며 실제 행정 경계나 불규칙한 지역 배열은 쓰지 않습니다.</Hint>
    </ControlGroup>
  )
}

export const odMapModule: VizModule<OdParams> = {
  roles: [
    { key: 'origin', label: '출발 지역', type: 'category', required: true, prefer: '출발' },
    { key: 'dest', label: '도착 지역', type: 'category', required: true, prefer: '도착' },
    { key: 'ox', label: '출발 열(가로 위치)', type: 'number', required: true, prefer: '출발 열|ox' },
    { key: 'oy', label: '출발 행(세로 위치)', type: 'number', required: true, prefer: '출발 행|oy' },
    { key: 'dx', label: '도착 열', type: 'number', required: true, prefer: '도착 열|dx' },
    { key: 'dy', label: '도착 행', type: 'number', required: true, prefer: '도착 행|dy' },
    { key: 'flow', label: '이동량', type: 'number', required: true, prefer: '이동량|flow' },
  ],
  datasets: ['grid-flows'],
  defaultParams: { mode: 'origin', scale: 'global', log: false, hideSelf: false, selOuter: -1, selInner: -1 },
  Chart: OdMapChart,
  Controls: OdControls,
  hint: '칸을 눌러 그 도착지(안쪽 위치)를 모든 출발지 칸에서 강조 · 바깥 기준을 출발지/도착지로 바꿔 보세요',
}

// ───────────────────────────── Perspective Wall / Bifocal ─────────────────────────────

export interface WallParams { mode: FocusMode; focus: number; half: number; panel: number; angle: number; labels: boolean; selected: number }

interface Item { row: number; t: number; lane: string; label: string; size: number }

function WallChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<WallParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef(false)
  const data = useMemo(() => {
    const ti = columnIndex(table, roleColumn(mapping, 'time')), li = columnIndex(table, roleColumn(mapping, 'lane')), ni = columnIndex(table, roleColumn(mapping, 'label')), si = columnIndex(table, roleColumn(mapping, 'size'))
    if (ti < 0 || li < 0) return null
    const items: Item[] = []
    table.rows.forEach((r, row) => { const t = toNumber(r[ti]); if (t != null) items.push({ row, t, lane: toLabel(r[li]), label: ni >= 0 ? toLabel(r[ni]) : '', size: si >= 0 ? toNumber(r[si]) ?? 1 : 1 }) })
    if (items.length < 2) return null
    const lo = Math.min(...items.map((i) => i.t)), hi = Math.max(...items.map((i) => i.t))
    return { items, lo, hi: hi > lo ? hi : lo + 1, lanes: [...new Set(items.map((i) => i.lane))] }
  }, [table, mapping])
  if (!data) return <ChartMessage>시간(수치) 열과 분류 열을 고르세요.</ChartMessage>
  const color = categoryColor(data.lanes)
  const focus = params.focus > 0 ? params.focus : (data.lo + data.hi) / 2
  const span = data.hi - data.lo
  const spec: FocusSpec = { mode: params.mode, lo: data.lo, hi: data.hi, focus: Math.min(data.hi, Math.max(data.lo, focus)), half: Math.max(span * 0.01, params.half || span * 0.09), width, panel: params.panel, angle: params.angle }
  const top = compact ? 8 : 34, bottom = compact ? 8 : 34
  const H = height - top - bottom, cy = top + H / 2
  const laneH = H / data.lanes.length
  const inDetail = data.items.filter((i) => Math.abs(i.t - spec.focus) <= spec.half)
  const setFocusFrom = (e: PointerEvent) => {
    if (!svgRef.current) return
    const p = localPoint(svgRef.current, e)
    setParams({ focus: Math.round(focusInverse(spec, p.x)) })
  }
  const edge = (sgn: -1 | 1) => (x: number) => cy + sgn * (H / 2) * focusMap(spec, x).scale
  const xs = Array.from({ length: 160 }, (_, i) => data.lo + (i * span) / 159)
  const frame = (sgn: -1 | 1) => xs.map((x) => `${focusMap(spec, x).sx},${edge(sgn)(x)}`).join(' ')
  const ticks = (() => {
    const all = Array.from({ length: Math.floor(span / 100) + 1 }, (_, i) => Math.ceil(data.lo / 100) * 100 + i * 100).filter((t) => t <= data.hi)
    const out: number[] = []
    let last = -1e9
    for (const t of all) { const sx = focusMap(spec, t).sx; if (sx - last >= 30) { out.push(t); last = sx } }
    return out
  })()
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`${params.mode === 'wall' ? 'Perspective Wall' : 'Bifocal Display'}: 초점 ${Math.round(spec.focus)}, 문서 ${data.items.length}건`} style={{ touchAction: 'none' }}
        onPointerDown={compact ? undefined : (e) => { drag.current = true; setFocusFrom(e) }} onPointerMove={compact ? undefined : (e) => { if (drag.current) setFocusFrom(e) }} onPointerUp={() => { drag.current = false }} onPointerLeave={() => { drag.current = false; hide() }}>
        <polygon points={`${frame(-1)} ${[...xs].reverse().map((x) => `${focusMap(spec, x).sx},${edge(1)(x)}`).join(' ')}`} fill="#f8fafa" stroke="#dbe3e3" />
        {params.mode === 'wall' && [spec.focus - spec.half, spec.focus + spec.half].map((x, i) => <line key={i} x1={focusMap(spec, x).sx} x2={focusMap(spec, x).sx} y1={cy - H / 2} y2={cy + H / 2} stroke="#2a8c82" strokeWidth={1.4} strokeDasharray="4 3" />)}
        {params.mode === 'bifocal' && [spec.focus - spec.half, spec.focus + spec.half].map((x, i) => <line key={i} x1={focusMap(spec, x).sx} x2={focusMap(spec, x).sx} y1={cy - H / 2} y2={cy + H / 2} stroke="#2a8c82" strokeWidth={1.4} strokeDasharray="4 3" />)}
        {data.lanes.map((l, li) => <line key={l} x1={0} x2={width} y1={cy - H / 2 + (li + 0.5) * laneH} y2={cy - H / 2 + (li + 0.5) * laneH} stroke="#eef1f1" strokeDasharray="2 4" pointerEvents="none" />)}
        {data.items.map((it) => {
          const m = focusMap(spec, it.t)
          const li = data.lanes.indexOf(it.lane)
          const yLane = cy - H / 2 + (li + 0.5) * laneH
          const y = cy + (yLane - cy) * m.scale
          const h = Math.max(1.5, laneH * 0.34 * m.scale * (0.5 + Math.min(1, it.size / 24)))
          const w = Math.max(1.4, (compact ? 1.5 : 3.2) * m.scale * (params.mode === 'bifocal' ? 1 : 1))
          const sel = params.selected === it.row
          return (
            <rect key={it.row} x={m.sx - w / 2} y={y - h / 2} width={w} height={h} rx={0.8} fill={color(it.lane)} stroke={sel ? '#d4452f' : 'none'} strokeWidth={sel ? 1.6 : 0} opacity={0.9} data-testid="wall-item" data-t={it.t} data-sx={m.sx.toFixed(1)}
              onClick={compact ? undefined : (e) => { e.stopPropagation(); setParams({ selected: sel ? -1 : it.row }) }} style={{ cursor: compact ? undefined : 'pointer' }}
              onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{it.label || it.lane}</b><br />{it.lane} · 날짜 {it.t} · 분량 {it.size}쪽</>) }} onPointerLeave={hide} />
          )
        })}
        {!compact && params.labels && inDetail.length <= 36 && inDetail.map((it) => {
          const m = focusMap(spec, it.t), li = data.lanes.indexOf(it.lane)
          return <text key={it.row} x={m.sx} y={cy - H / 2 + (li + 0.5) * laneH - laneH * 0.28} textAnchor="middle" fontSize={9} fill="#374151" transform={`rotate(-30 ${m.sx} ${cy - H / 2 + (li + 0.5) * laneH - laneH * 0.28})`} pointerEvents="none">{it.label}</text>
        })}
        {!compact && ticks.map((t) => <text key={t} x={focusMap(spec, t).sx} y={height - 14} textAnchor="middle" fontSize={9} fill="#9aa6a6" pointerEvents="none">{t}</text>)}
        {!compact && <text x={12} y={16} fontSize={11} fill="#374151" data-testid="wall-readout">초점 {Math.round(spec.focus)}일 · 가운데 칸 {Math.round(spec.focus - spec.half)}~{Math.round(spec.focus + spec.half)}일에 문서 {inDetail.length}건 · {params.mode === 'wall' ? `원근 접힘 ${params.angle}°` : '양쪽 균일 압축'}</text>}
        {!compact && data.lanes.map((l, li) => <text key={l} x={8} y={cy - H / 2 + (li + 0.5) * laneH + 4} fontSize={10} fill={color(l)} pointerEvents="none">{l}</text>)}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function WallControls({ params, setParams, table, mapping }: ControlsProps<WallParams>) {
  const ti = columnIndex(table, roleColumn(mapping, 'time'))
  const ts = ti >= 0 ? table.rows.map((r) => toNumber(r[ti])).filter((v): v is number => v != null) : []
  const lo = ts.length ? Math.min(...ts) : 0, hi = ts.length ? Math.max(...ts) : 1000
  return (
    <ControlGroup title="초점과 맥락">
      <Segmented label="방식" value={params.mode} onChange={(mode) => setParams({ mode })} options={[{ value: 'wall', label: 'Perspective Wall' }, { value: 'bifocal', label: 'Bifocal Display' }]} testId="ctl-mode" />
      <Slider label="초점 위치 (날짜)" value={Math.round(params.focus > 0 ? params.focus : (lo + hi) / 2)} min={Math.floor(lo)} max={Math.ceil(hi)} onChange={(focus) => setParams({ focus })} testId="ctl-focus" />
      <Slider label="가운데 칸의 폭 (일)" value={Math.round(params.half > 0 ? params.half : (hi - lo) * 0.09)} min={Math.max(1, Math.round((hi - lo) * 0.01))} max={Math.max(2, Math.round((hi - lo) * 0.3))} onChange={(half) => setParams({ half })} testId="ctl-half" />
      <Slider label="가운데 칸이 차지하는 화면 비율" value={params.panel} min={0.2} max={0.8} step={0.05} onChange={(panel) => setParams({ panel })} format={(v) => `${Math.round(v * 100)}%`} testId="ctl-panel" />
      <Slider label="양옆을 접는 각도 (Wall)" value={params.angle} min={10} max={75} onChange={(angle) => setParams({ angle })} format={(v) => `${v}°`} testId="ctl-angle" disabled={params.mode !== 'wall'} />
      <Toggle label="가운데 칸의 제목 표시" checked={params.labels} onChange={(labels) => setParams({ labels })} testId="ctl-labels" />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ focus: 0, half: 0, selected: -1 })} data-testid="wall-reset">초점 되돌리기</button>
      <Hint>긴 시간 축을 가운데 칸(자세히 보는 구간)과 양옆(전체 맥락)으로 나눕니다. Perspective Wall은 양옆 칸을 뒤로 접어 원근법으로 점점 작아지게 하고(가까운 쪽이 크고 먼 쪽이 작음), Bifocal Display는 양옆을 균일하게 압축합니다. 두 방식 모두 데이터 좌표와 화면 좌표가 하나씩 대응하고 되돌릴 수 있습니다(단조·연속). 화면을 끌거나 슬라이더로 초점을 옮기면 자세히 보는 구간이 따라갑니다. 단순한 CSS 3D 효과가 아니라 접힌 칸의 3D 위치를 원근 투영해 좌표를 계산합니다.</Hint>
    </ControlGroup>
  )
}

export const wallModule: VizModule<WallParams> = {
  roles: [
    { key: 'time', label: '시간(날짜)', type: 'number', required: true, prefer: '날짜|일|time' },
    { key: 'lane', label: '분류(줄)', type: 'category', required: true, prefer: '분류|lane' },
    { key: 'label', label: '제목', type: 'category', auto: true, prefer: '제목|label' },
    { key: 'size', label: '크기(분량)', type: 'number', auto: true, prefer: '분량|size' },
  ],
  datasets: ['memo-archive'],
  defaultParams: { mode: 'wall', focus: 0, half: 0, panel: 0.42, angle: 45, labels: true, selected: -1 },
  Chart: WallChart,
  Controls: WallControls,
  hint: '화면을 끌어 초점을 옮깁니다 · 방식을 Perspective Wall과 Bifocal로 바꿔 맥락 압축을 비교',
}
