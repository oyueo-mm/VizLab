import { useMemo, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent } from 'react'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, type DataTable } from '../../data/table'
import { categoryColor, schemes } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { criticalPoints, field2FromRows, sampleField2, separatrices, tangentCurve, type CriticalKind, type Field2, type Pt } from '../../stats/field9'
import { mapTrixOrder, odModel, type OdRow } from '../../stats/geo9'
import { setNet, setNetMaskAt } from '../../stats/sets9'
import { seesoft, type CodeLine } from '../../stats/text9'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'

const TEXT_INPUT = { width: '100%', padding: '6px 8px', border: '1px solid #cfd6d6', borderRadius: 6, fontSize: 13, background: '#fff' } as const

// ───────────────────────────── Vector field topology ─────────────────────────────

export interface TopoParams { arrows: boolean; separatrices: boolean; step: number; seeds: Pt[]; selected: number }

const KIND_LABEL: Record<CriticalKind, string> = { saddle: '안장점', source: '원천(불안정 마디)', sink: '흡수점(안정 마디)', 'repelling-focus': '밀어내는 나선점', 'attracting-focus': '끌어당기는 나선점', center: '중심(소용돌이)' }
const KIND_COLOR: Record<CriticalKind, string> = { saddle: '#d4452f', source: '#e07a3f', sink: '#2a8c82', 'repelling-focus': '#d4a53a', 'attracting-focus': '#4c6fb5', center: '#9b5fb4' }

function useVectorField2(table: DataTable, mapping: Mapping): Field2 | null {
  return useMemo(() => {
    const idx = ['x', 'y', 'u', 'v'].map((k) => columnIndex(table, roleColumn(mapping, k)))
    if (idx.some((i) => i < 0)) return null
    const rows: { x: number; y: number; u: number; v: number }[] = []
    for (const r of table.rows) { const v = idx.map((i) => toNumber(r[i])); if (v.every((x) => x != null)) rows.push({ x: v[0]!, y: v[1]!, u: v[2]!, v: v[3]! }) }
    return field2FromRows(rows)
  }, [table, mapping])
}

function TopoChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<TopoParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const field = useVectorField2(table, mapping)
  const topo = useMemo(() => {
    if (!field) return null
    const pts = criticalPoints(field)
    const step = params.step * Math.min((field.x1 - field.x0) / (field.nx - 1), (field.y1 - field.y0) / (field.ny - 1))
    const seps = pts.filter((p) => p.kind === 'saddle').map((s) => separatrices(field, s, step))
    return { pts, seps, step }
  }, [field, params.step])
  if (!field || !topo) return <ChartMessage>x, y, u, v 열을 고르세요. 규칙적인 2차원 격자여야 합니다.</ChartMessage>
  const pad = compact ? 6 : 24
  const side = Math.min(width, height) - 2 * pad
  const ox = (width - side) / 2, oy = (height - side) / 2
  const X = (x: number) => ox + ((x - field.x0) / (field.x1 - field.x0)) * side, Y = (y: number) => oy + ((field.y1 - y) / (field.y1 - field.y0)) * side
  const wx = (px: number) => field.x0 + ((px - ox) / side) * (field.x1 - field.x0), wy = (py: number) => field.y1 - ((py - oy) / side) * (field.y1 - field.y0)
  const path = (c: Pt[]) => 'M' + c.map((p) => `${X(p[0])},${Y(p[1])}`).join('L')
  const addSeed = (e: RMouseEvent) => {
    if (compact || !svgRef.current) return
    const p = localPoint(svgRef.current, e)
    if (p.x < ox || p.x > ox + side || p.y < oy || p.y > oy + side) return
    setParams({ seeds: [...params.seeds.slice(-19), [wx(p.x), wy(p.y)]] })
  }
  const cells = compact ? 8 : 14
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`벡터장 위상: 임계점 ${topo.pts.length}개`} onPointerLeave={hide} onClick={addSeed} style={{ cursor: compact ? undefined : 'crosshair' }}>
        <rect x={ox} y={oy} width={side} height={side} fill="#fafcfc" stroke="#e5eaea" />
        {params.arrows && Array.from({ length: cells * cells }, (_, n) => {
          const i = n % cells, j = Math.floor(n / cells)
          const x = field.x0 + ((i + 0.5) / cells) * (field.x1 - field.x0), y = field.y0 + ((j + 0.5) / cells) * (field.y1 - field.y0)
          const [u, v] = sampleField2(field, x, y), sp = Math.hypot(u, v) / (field.refSpeed * 1.5 || 1), len = Math.min(1, sp) * (side / cells) * 0.55
          const ang = Math.atan2(-v, u)
          return <g key={n} transform={`translate(${X(x)},${Y(y)}) rotate(${(ang * 180) / Math.PI})`} opacity={0.4} pointerEvents="none"><line x1={-len / 2} x2={len / 2} stroke="#8a9490" strokeWidth={1} /><path d={`M${len / 2},0l-3.5,-2v4z`} fill="#8a9490" /></g>
        })}
        {params.seeds.map((s, i) => {
          const f = tangentCurve(field, s, 1, topo.step, 500), b = tangentCurve(field, s, -1, topo.step, 500)
          return <g key={i} pointerEvents="none" data-testid="topo-stream"><path d={path([...b.reverse(), ...f.slice(1)])} fill="none" stroke="#4c6fb5" strokeWidth={1.2} opacity={0.75} /><circle cx={X(s[0])} cy={Y(s[1])} r={2.4} fill="#4c6fb5" /></g>
        })}
        {params.separatrices && topo.seps.map((group, gi) => group.map((c, ci) => <path key={`${gi}-${ci}`} d={path(c)} fill="none" stroke="#d4452f" strokeWidth={compact ? 1.2 : 2} strokeLinecap="round" opacity={0.9} data-testid="separatrix" pointerEvents="none" />))}
        {topo.pts.map((p, i) => (
          <g key={i} data-testid="critical-point" data-kind={p.kind} style={{ cursor: compact ? undefined : 'pointer' }}
            onClick={compact ? undefined : (e) => { e.stopPropagation(); setParams({ selected: params.selected === i ? -1 : i }) }}
            onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{KIND_LABEL[p.kind]}</b><br />위치 ({fmt(p.x, 3)}, {fmt(p.y, 3)})<br />trace {fmt(p.trace, 3)} · det {fmt(p.det, 3)}</>) }} onPointerLeave={hide}>
            <circle cx={X(p.x)} cy={Y(p.y)} r={compact ? 4 : params.selected === i ? 10 : 8} fill="#fff" stroke={KIND_COLOR[p.kind]} strokeWidth={3} />
            <circle cx={X(p.x)} cy={Y(p.y)} r={compact ? 1.6 : 3} fill={KIND_COLOR[p.kind]} />
          </g>
        ))}
        {!compact && (
          <g transform={`translate(${ox + 8},${oy + 8})`} pointerEvents="none" data-testid="topo-legend">
            {(Object.keys(KIND_LABEL) as CriticalKind[]).filter((k) => topo.pts.some((p) => p.kind === k)).map((k, i) => (
              <g key={k} transform={`translate(0,${i * 16})`}><circle cx={6} cy={6} r={5} fill="#fff" stroke={KIND_COLOR[k]} strokeWidth={2.4} /><text x={16} y={10} fontSize={11} fill="#374151">{KIND_LABEL[k]} {topo.pts.filter((p) => p.kind === k).length}</text></g>
            ))}
          </g>
        )}
        {!compact && <text x={ox} y={height - 6} fontSize={11} fill="#6b7280">빈 곳을 누르면 그 점을 지나는 유선(파랑)을 추가합니다 · 안장점에서 나가는 붉은 선이 분리선</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function TopoControls({ params, setParams }: ControlsProps<TopoParams>) {
  return (
    <ControlGroup title="위상 구조">
      <Toggle label="벡터 화살표 보이기" checked={params.arrows} onChange={(arrows) => setParams({ arrows })} testId="ctl-arrows" />
      <Toggle label="안장점의 분리선(separatrix)" checked={params.separatrices} onChange={(separatrices) => setParams({ separatrices })} testId="ctl-sep" />
      <Slider label="적분 간격 (격자 간격 배)" value={params.step} min={0.1} max={1} step={0.05} onChange={(step) => setParams({ step })} format={(v) => v.toFixed(2)} testId="ctl-step" />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ seeds: [], selected: -1 })} data-testid="topo-clear">유선 지우기</button>
      <Hint>벡터가 0이 되는 점(임계점)을 찾아 야코비 행렬의 대각합(trace)과 행렬식(det)으로 분류합니다: det&lt;0이면 안장점, det&gt;0이면 trace 부호에 따라 원천·흡수점(마디) 또는 나선점이고 trace≈0이면 중심입니다. 안장점에서는 야코비 행렬의 두 고유방향을 따라 네 개의 분리선을 적분해 흐름을 영역으로 가릅니다. 이 선들과 임계점만으로 흐름 전체의 골격이 요약됩니다. 이 구현은 2차원 격자의 쌍선형 보간장에서 뉴턴법으로 영점을 찾으며, 3차원·시간에 따라 변하는 장과 한계 순환(limit cycle)은 다루지 않습니다.</Hint>
    </ControlGroup>
  )
}

export const topologyModule: VizModule<TopoParams> = {
  roles: [
    { key: 'x', label: 'x', type: 'number', required: true, prefer: '^x' }, { key: 'y', label: 'y', type: 'number', required: true, prefer: '^y' },
    { key: 'u', label: 'u (x 성분)', type: 'number', required: true, prefer: '^u' }, { key: 'v', label: 'v (y 성분)', type: 'number', required: true, prefer: '^v' },
  ],
  datasets: ['flow-2d'],
  defaultParams: { arrows: true, separatrices: true, step: 0.35, seeds: [], selected: -1 },
  Chart: TopoChart,
  Controls: TopoControls,
  hint: '임계점에 올려 종류 확인 · 빈 곳을 눌러 유선 추가 · 안장점의 붉은 분리선이 흐름을 영역으로 나눕니다',
}

// ───────────────────────────── MapTrix ─────────────────────────────

export interface MapTrixParams { scale: 'linear' | 'log'; hideSelf: boolean; selOrigin: number; selDest: number }

function MapTrixChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<MapTrixParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const model = useMemo(() => {
    const idx = ['origin', 'dest', 'ox', 'oy', 'dx', 'dy', 'flow'].map((k) => columnIndex(table, roleColumn(mapping, k)))
    if (idx.some((i) => i < 0)) return null
    const rows: OdRow[] = []
    for (const r of table.rows) { const n = [2, 3, 4, 5, 6].map((j) => toNumber(r[idx[j]])); if (n.every((v) => v != null)) rows.push({ origin: toLabel(r[idx[0]]), dest: toLabel(r[idx[1]]), ox: n[0]!, oy: n[1]!, dx: n[2]!, dy: n[3]!, flow: n[4]! }) }
    return odModel(rows)
  }, [table, mapping])
  if (!model) return <ChartMessage>출발·도착 지역, 두 지역의 격자 위치(열·행), 이동량 열을 고르세요.</ChartMessage>
  const order = mapTrixOrder(model)
  const N = model.regions.length
  const pad = compact ? 6 : 14
  const head = compact ? 8 : 40
  const mapSide = Math.min(width * 0.36, height * 0.5)
  const gutter = compact ? 10 : 40
  const Q = Math.min(width - mapSide - gutter - 2 * pad, height - head - pad)
  const cell = Q / N
  const qx = width - pad - Q, qy = head
  const mx = pad, my = height - pad - mapSide
  const pt = (i: number): Pt => [mx + ((model.grid[i][0] + 0.5) / model.cols) * mapSide, my + ((model.grid[i][1] + 0.5) / model.rows) * mapSide]
  const rowOf = new Map(order.rows.map((r, k) => [r, k])), colOf = new Map(order.cols.map((c, k) => [c, k]))
  const ramp = schemes.teal.interpolate
  const val = (f: number) => { const v = Math.min(1, f / Math.max(1e-9, model.maxOff)); return params.scale === 'log' ? Math.log1p(v * 99) / Math.log(100) : v }
  const so = params.selOrigin, sd = params.selDest
  const hotRow = (o: number) => so === o, hotCol = (d: number) => sd === d
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`MapTrix: 지역 ${N}개, 지도와 행렬을 지시선으로 연결`} onPointerLeave={hide}>
        <rect x={mx} y={my} width={mapSide} height={mapSide} fill="#f7f9f9" stroke="#dbe3e3" />
        {/* leader lines: rows enter the matrix from its left side, columns from its top side */}
        {!compact && model.regions.map((_, i) => {
          const [px, py] = pt(i)
          const rk = rowOf.get(i)!, ck = colOf.get(i)!
          const laneX = qx - 8 - (rk % 6) * 4
          const laneY = qy - 8 - (ck % 6) * 4
          const yr = qy + rk * cell + cell / 2, xc = qx + ck * cell + cell / 2
          const hr = hotRow(i), hc = hotCol(i)
          return (
            <g key={i} pointerEvents="none">
              <path d={`M${px},${py}H${laneX}V${yr}H${qx}`} fill="none" stroke={hr ? '#d4452f' : '#4c6fb5'} strokeWidth={hr ? 1.8 : 0.7} opacity={so >= 0 && !hr ? 0.1 : hr ? 1 : 0.4} data-testid="leader-row" />
              <path d={`M${px},${py}V${laneY}H${xc}V${qy}`} fill="none" stroke={hc ? '#d4452f' : '#e07a3f'} strokeWidth={hc ? 1.8 : 0.7} opacity={sd >= 0 && !hc ? 0.1 : hc ? 1 : 0.4} data-testid="leader-col" />
            </g>
          )
        })}
        {model.regions.map((nm, i) => {
          const [px, py] = pt(i)
          const hot = so === i || sd === i
          return <circle key={i} cx={px} cy={py} r={compact ? 2 : hot ? 6 : 4} fill="#fff" stroke={hot ? '#d4452f' : '#1f6f67'} strokeWidth={2} data-testid="maptrix-point" style={{ cursor: compact ? undefined : 'pointer' }}
            onClick={compact ? undefined : () => setParams({ selOrigin: so === i ? -1 : i, selDest: sd === i ? -1 : sd })}
            onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{nm}</b><br />내보낸 양 {fmt(model.out[i], 4)} · 받은 양 {fmt(model.inn[i], 4)}</>) }} onPointerLeave={hide} />
        })}
        {order.rows.map((o, rk) => order.cols.map((d, ck) => {
          const f = model.flow[o][d]
          if (o === d && params.hideSelf) return null
          const hot = (so === o) || (sd === d)
          return <rect key={`${o}-${d}`} x={qx + ck * cell + 0.3} y={qy + rk * cell + 0.3} width={Math.max(0.5, cell - 0.6)} height={Math.max(0.5, cell - 0.6)} fill={o === d ? '#e3e8e8' : f > 0 ? ramp(0.12 + 0.88 * val(f)) : '#f1f4f4'} stroke={so === o && sd === d ? '#d4452f' : 'none'} strokeWidth={1.6} opacity={(so >= 0 || sd >= 0) && !hot ? 0.4 : 1} data-testid="maptrix-cell" data-flow={f}
            style={{ cursor: compact ? undefined : 'pointer' }} onClick={compact ? undefined : () => setParams({ selOrigin: so === o && sd === d ? -1 : o, selDest: so === o && sd === d ? -1 : d })}
            onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{model.regions[o]} → {model.regions[d]}</b><br />이동량 {fmt(f, 4)}</>) }} onPointerLeave={hide} />
        }))}
        {!compact && <text x={qx} y={14} fontSize={11} fill="#6b7280">열 = 도착지(지도의 가로 위치 순) →</text>}
        {!compact && <text x={qx - 10} y={qy + Q + 14} fontSize={11} fill="#6b7280" textAnchor="start">행 = 출발지(지도의 세로 위치 순) ↓</text>}
        {!compact && <text x={mx} y={my - 6} fontSize={11} fill="#6b7280">지도 위 지역 위치</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function MapTrixControls({ params, setParams }: ControlsProps<MapTrixParams>) {
  return (
    <ControlGroup title="MapTrix 보기">
      <Segmented label="색 눈금" value={params.scale} onChange={(scale) => setParams({ scale })} options={[{ value: 'linear', label: '선형' }, { value: 'log', label: '로그' }]} testId="ctl-scale" />
      <Toggle label="같은 지역 칸 숨기기" checked={params.hideSelf} onChange={(hideSelf) => setParams({ hideSelf })} testId="ctl-hideself" />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ selOrigin: -1, selDest: -1 })} data-testid="maptrix-clear">선택 해제</button>
      <Hint>지도 위의 지역마다 행(출발지)과 열(도착지)이 있는 OD 행렬을 지도 옆에 붙이고, 지역에서 행의 왼쪽 끝과 열의 위쪽 끝까지 직각 지시선(파랑 = 행, 주황 = 열)을 이어 행렬의 행과 열이 지도 위 어느 지역인지 보입니다. 행은 지역의 세로 위치 순, 열은 가로 위치 순으로 놓아 지시선이 서로 덜 교차하게 합니다(교차가 없다는 보장은 아님). 지역이나 칸을 누르면 그 행·열과 지도의 지역이 함께 강조됩니다. 이 구현은 사각 격자 지도 위의 단순화한 버전이며 원 논문의 지시선 라우팅 최적화와 실제 지도 투영은 쓰지 않습니다.</Hint>
    </ControlGroup>
  )
}

export const mapTrixModule: VizModule<MapTrixParams> = {
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
  defaultParams: { scale: 'linear', hideSelf: false, selOrigin: -1, selDest: -1 },
  Chart: MapTrixChart,
  Controls: MapTrixControls,
  hint: '지역(점)이나 칸을 눌러 행·열과 지도의 지역을 함께 강조 · 지시선으로 행렬 위치를 지도에서 확인',
}

// ───────────────────────────── Seesoft ─────────────────────────────

export interface SeesoftParams { colorBy: 'author' | 'age' | 'kind'; search: string; selAuthor: string; width: boolean }

function SeesoftChart({ table, mapping, params, width, height, compact }: ChartProps<SeesoftParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const lines = useMemo(() => {
    const idx = ['file', 'line', 'length', 'indent', 'author', 'age', 'kind', 'text'].map((k) => columnIndex(table, roleColumn(mapping, k)))
    if (idx[0] < 0 || idx[1] < 0) return null
    const out: CodeLine[] = []
    for (const r of table.rows) {
      const ln = toNumber(r[idx[1]]); if (ln == null) continue
      out.push({ file: toLabel(r[idx[0]]), line: ln, length: idx[2] >= 0 ? toNumber(r[idx[2]]) ?? 0 : 0, indent: idx[3] >= 0 ? toNumber(r[idx[3]]) ?? 0 : 0, author: idx[4] >= 0 ? toLabel(r[idx[4]]) : '', age: idx[5] >= 0 ? toNumber(r[idx[5]]) ?? 0 : 0, kind: idx[6] >= 0 ? toLabel(r[idx[6]]) : '', text: idx[7] >= 0 ? toLabel(r[idx[7]]) : '' })
    }
    return out
  }, [table, mapping])
  const top = compact ? 4 : 34, bottom = compact ? 4 : 30, left = compact ? 4 : 10
  const cols = useMemo(() => (lines ? seesoft(lines, Math.max(60, height - top - bottom), 1) : null), [lines, height, top, bottom])
  if (!lines || !cols || !cols.length) return <ChartMessage>파일(문서)과 줄 번호 열을 고르세요. 한 행이 한 줄이어야 합니다.</ChartMessage>
  const authors = [...new Set(lines.map((l) => l.author))]
  const kinds = [...new Set(lines.map((l) => l.kind))]
  const colA = categoryColor(authors), colK = categoryColor(kinds)
  const maxAge = Math.max(1, ...lines.map((l) => l.age)), maxLen = Math.max(1, ...lines.map((l) => l.length + l.indent))
  const age = schemes.magma.interpolate
  const colW = (width - left - 10) / cols.length
  const innerW = colW - (compact ? 3 : 14)
  const q = params.search.trim().toLowerCase()
  const colorOf = (l: CodeLine) => (params.colorBy === 'author' ? colA(l.author) : params.colorBy === 'kind' ? colK(l.kind) : age(0.9 - 0.8 * (l.age / maxAge)))
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Seesoft: 파일 ${cols.length}개, 줄 ${lines.length}개`} onPointerLeave={hide}>
        {cols.map((c, ci) => {
          const x0 = left + ci * colW
          return (
            <g key={c.file} data-testid="seesoft-column" data-file={c.file}>
              {!compact && <text x={x0 + innerW / 2} y={20} textAnchor="middle" fontSize={11} fontWeight={600} fill="#374151">{c.file} ({c.lines.length}줄)</text>}
              <rect x={x0 - 1} y={top - 1} width={innerW + 2} height={c.bands.length ? c.bands[c.bands.length - 1].y + c.bands[0].h + 2 : 0} fill="#fafcfc" stroke="#e5eaea" />
              {c.bands.map((b, bi) => {
                const group = c.lines.slice(b.from, b.to)
                const rep = group[Math.floor(group.length / 2)]
                const len = group.reduce((a, l) => a + (params.width ? l.length + l.indent : maxLen), 0) / group.length
                const ind = group.reduce((a, l) => a + (params.width ? l.indent : 0), 0) / group.length
                const match = q ? group.some((l) => l.text.toLowerCase().includes(q)) : false
                const authorHit = params.selAuthor && group.some((l) => l.author === params.selAuthor)
                const dim = (q && !match) || (params.selAuthor && !authorHit)
                const blank = group.every((l) => l.kind === '빈 줄')
                return (
                  <rect key={bi} x={x0 + (ind / maxLen) * innerW} y={top + b.y} width={Math.max(blank ? 0 : 1, ((len - ind) / maxLen) * innerW)} height={Math.max(0.6, b.h - (b.h > 3 ? 0.6 : 0))} fill={q && match ? '#d4452f' : colorOf(rep)} opacity={dim ? 0.12 : 1} data-testid="seesoft-line" data-author={rep.author}
                    onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{c.file}:{group[0].line}{group.length > 1 ? `–${group[group.length - 1].line}` : ''}</b><br />{rep.author} · {rep.age}일 전 · {rep.kind}<br /><code>{rep.text.trim().slice(0, 48) || '(빈 줄)'}</code></>) }} onPointerLeave={hide} />
                )
              })}
            </g>
          )
        })}
        {!compact && (
          <g transform={`translate(${left},${height - 12})`} pointerEvents="none">
            {params.colorBy === 'age'
              ? <><text x={0} y={0} fontSize={10} fill="#6b7280">밝음 = 최근 수정 → 어두움 = 오래됨 (최대 {maxAge}일)</text></>
              : (params.colorBy === 'author' ? authors : kinds).map((k, i) => <g key={k} transform={`translate(${i * 78},-8)`}><rect width={12} height={8} rx={2} fill={params.colorBy === 'author' ? colA(k) : colK(k)} /><text x={16} y={8} fontSize={10} fill="#4b5563">{k}</text></g>)}
          </g>
        )}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function SeesoftControls({ params, setParams, table, mapping }: ControlsProps<SeesoftParams>) {
  const ai = columnIndex(table, roleColumn(mapping, 'author'))
  const authors = ai >= 0 ? [...new Set(table.rows.map((r) => toLabel(r[ai])))] : []
  const color = categoryColor(authors)
  return (
    <ControlGroup title="줄의 색과 검색">
      <Segmented label="줄의 색" value={params.colorBy} onChange={(colorBy) => setParams({ colorBy })} options={[{ value: 'author', label: '작성자' }, { value: 'age', label: '수정 시점' }, { value: 'kind', label: '종류' }]} testId="ctl-colorby" />
      <Toggle label="줄 길이·들여쓰기로 막대 모양 그리기" checked={params.width} onChange={(width) => setParams({ width })} testId="ctl-width" />
      <div className="field">
        <label>내용 검색 (붉게 표시)</label>
        <input type="text" style={TEXT_INPUT} value={params.search} data-testid="seesoft-search" onChange={(e) => setParams({ search: e.target.value })} />
      </div>
      {authors.length > 0 && (
        <div className="field">
          <label>작성자 강조</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button type="button" className="btn btn-secondary btn-sm" aria-pressed={!params.selAuthor} onClick={() => setParams({ selAuthor: '' })}>전체</button>
            {authors.map((a) => <button key={a} type="button" className="btn btn-secondary btn-sm" aria-pressed={params.selAuthor === a} data-testid={`author-${a}`} style={{ borderColor: color(a) }} onClick={() => setParams({ selAuthor: params.selAuthor === a ? '' : a })}>{a}</button>)}
          </div>
        </div>
      )}
      <Hint>파일 하나가 세로 기둥 하나이고, 파일의 줄 하나가 가는 가로 막대 하나입니다. 막대의 길이와 들여쓰기는 그 줄의 글자 수와 들여쓰기이고 색은 작성자·수정 시점·종류 중 고른 속성이라, 코드를 읽지 않고도 파일 전체의 구조와 속성의 분포(오래된 부분, 한 사람이 쓴 구간)를 한눈에 봅니다. 줄이 화면의 세로 픽셀보다 많으면 인접한 줄을 묶어 한 막대로 그립니다. 검색어가 들어간 줄은 붉게 칠해지고, 막대에 올리면 그 줄의 내용이 보입니다. 원 논문의 ‘읽기 창’(실제 글자를 확대해서 보는 창)은 구현하지 않고 툴팁으로 대신합니다.</Hint>
    </ControlGroup>
  )
}

export const seesoftModule: VizModule<SeesoftParams> = {
  roles: [
    { key: 'file', label: '파일(문서)', type: 'category', required: true, prefer: '파일|file' },
    { key: 'line', label: '줄 번호', type: 'number', required: true, prefer: '줄|line' },
    { key: 'length', label: '글자 수', type: 'number', auto: true, prefer: '글자|length' },
    { key: 'indent', label: '들여쓰기', type: 'number', auto: true, prefer: '들여|indent' },
    { key: 'author', label: '작성자', type: 'category', auto: true, prefer: '작성자|author' },
    { key: 'age', label: '수정 후 일수', type: 'number', auto: true, prefer: '일수|age' },
    { key: 'kind', label: '종류', type: 'category', auto: true, prefer: '종류|kind' },
    { key: 'text', label: '내용', type: 'category', auto: true, prefer: '내용|text' },
  ],
  datasets: ['code-lines'],
  defaultParams: { colorBy: 'author', search: '', selAuthor: '', width: true },
  Chart: SeesoftChart,
  Controls: SeesoftControls,
  hint: '줄에 올려 내용 확인 · 색 기준을 작성자·수정 시점·종류로 바꾸고 검색어가 들어간 줄을 찾아 보세요',
}

// ───────────────────────────── SetNet ─────────────────────────────

export interface SetNetParams { seed: number; labels: boolean; focus: number; selected: number }

function readSetNet(table: DataTable, mapping: Mapping) {
  const cols = roleColumns(mapping, 'sets')
  const si = cols.map((c) => columnIndex(table, c))
  const li = columnIndex(table, roleColumn(mapping, 'label')), ni = columnIndex(table, roleColumn(mapping, 'links'))
  if (cols.length < 2 || si.some((i) => i < 0) || li < 0) return null
  const names = table.rows.map((r) => toLabel(r[li]))
  const member = si.map((c) => table.rows.map((r) => (toNumber(r[c]) ?? 0) > 0))
  const edges: [number, number][] = []
  const seen = new Set<string>()
  if (ni >= 0) table.rows.forEach((r, i) => toLabel(r[ni]).split(';').map((s) => s.trim()).filter(Boolean).forEach((nm) => { const j = names.indexOf(nm); if (j >= 0 && j !== i) { const key = i < j ? `${i}-${j}` : `${j}-${i}`; if (!seen.has(key)) { seen.add(key); edges.push(i < j ? [i, j] : [j, i]) } } }))
  return { cols, names, member, edges }
}

function SetNetChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<SetNetParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const data = useMemo(() => readSetNet(table, mapping), [table, mapping])
  const key = data ? `${data.names.join('|')}/${data.member.map((s) => s.map((v) => (v ? 1 : 0)).join('')).join('/')}/${data.edges.length}` : ''
  const model = useMemo(() => (data ? setNet(data.member, data.names.length, data.edges, params.seed) : null), [key, params.seed]) // eslint-disable-line react-hooks/exhaustive-deps
  const [moved, setMoved] = useState<{ key: string; pos: Map<number, Pt> }>({ key: '', pos: new Map() })
  const drag = useRef(-1)
  if (!data || !model) return <ChartMessage>이름 열과 동아리(집합) 열(0/1) 2~4개, 친구(이웃) 열을 고르세요.</ChartMessage>
  const mk = `${key}|${params.seed}`
  const override = moved.key === mk ? moved.pos : new Map<number, Pt>()
  const posOf = (i: number): Pt => override.get(i) ?? model.pos[i]
  const color = categoryColor(data.cols)
  const pad = compact ? 8 : 20
  const S = Math.min(width, height) - 2 * pad - (compact ? 0 : 8)
  const ox = (width - S) / 2, oy = (height - S) / 2 - (compact ? 0 : 4)
  const X = (u: number) => ox + u * S, Y = (v: number) => oy + v * S
  const sel = params.selected
  const nbr = new Set<number>(sel >= 0 ? data.edges.filter(([a, b]) => a === sel || b === sel).flatMap(([a, b]) => [a, b]) : [])
  const onMove = (e: PointerEvent) => {
    if (drag.current < 0 || !svgRef.current) return
    const p = localPoint(svgRef.current, e)
    const q: Pt = [Math.min(1, Math.max(0, (p.x - ox) / S)), Math.min(1, Math.max(0, (p.y - oy) / S))]
    // a node may only move inside the zone of its own sets
    if (setNetMaskAt(model, q) !== model.mask[drag.current]) return
    const next = new Map(override); next.set(drag.current, q)
    setMoved({ key: mk, pos: next })
  }
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`SetNet: 집합 ${data.cols.length}개, 노드 ${data.names.length}개, 간선 ${data.edges.length}개`} style={{ touchAction: 'none' }}
        onPointerMove={compact ? undefined : onMove} onPointerUp={() => { drag.current = -1 }} onPointerLeave={() => { drag.current = -1; hide() }}>
        {data.cols.map((c, s) => (
          <g key={c} data-testid="setnet-region" data-set={s} opacity={params.focus >= 0 && params.focus !== s ? 0.3 : 1}>
            <circle cx={X(model.centers[s][0])} cy={Y(model.centers[s][1])} r={model.radii[s] * S} fill={color(c)} fillOpacity={0.14} stroke={color(c)} strokeWidth={2} />
            {!compact && <text x={X(model.centers[s][0] + (model.centers[s][0] < 0.5 ? -1 : 1) * model.radii[s] * 0.7)} y={Y(model.centers[s][1] + (model.centers[s][1] < 0.5 ? -1 : 1) * model.radii[s] * 0.95)} textAnchor="middle" fontSize={12} fontWeight={700} fill={color(c)} pointerEvents="none">{c}</text>}
          </g>
        ))}
        {data.edges.map(([a, b], i) => {
          const hot = sel >= 0 && (a === sel || b === sel)
          return <line key={i} x1={X(posOf(a)[0])} y1={Y(posOf(a)[1])} x2={X(posOf(b)[0])} y2={Y(posOf(b)[1])} stroke={hot ? '#d4452f' : '#6b7280'} strokeWidth={hot ? 2 : 0.8} opacity={sel >= 0 && !hot ? 0.12 : 0.55} data-testid="setnet-edge" />
        })}
        {data.names.map((nm, i) => {
          const p = posOf(i)
          const sets = data.cols.map((_, s) => s).filter((s) => data.member[s][i])
          const hot = sel === i || nbr.has(i)
          const dim = (params.focus >= 0 && !sets.includes(params.focus)) || (sel >= 0 && !hot)
          return (
            <g key={i} data-testid="setnet-node" data-item={i} data-mask={model.mask[i]} opacity={dim ? 0.25 : 1} style={{ cursor: compact ? undefined : 'grab' }}
              onPointerDown={compact ? undefined : (e) => { drag.current = i; setParams({ selected: sel === i ? -1 : i }); e.currentTarget.closest('svg')?.setPointerCapture(e.pointerId) }}
              onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{nm}</b><br />{sets.length ? sets.map((s) => data.cols[s]).join(' · ') : '어느 동아리에도 없음'}<br />친구 {data.edges.filter(([a, b]) => a === i || b === i).length}명</>) }} onPointerLeave={hide}>
              <circle cx={X(p[0])} cy={Y(p[1])} r={compact ? 3 : sel === i ? 8 : 6} fill={sets.length ? color(data.cols[sets[0]]) : '#b6bec4'} stroke={sel === i ? '#d4452f' : '#fff'} strokeWidth={sel === i ? 2.4 : 1.4} />
              {!compact && params.labels && <text x={X(p[0]) + 8} y={Y(p[1]) - 6} fontSize={9.5} fill="#374151" pointerEvents="none">{nm}</text>}
            </g>
          )
        })}
        {!compact && <text x={12} y={height - 8} fontSize={11} fill="#6b7280" data-testid="setnet-readout">노드 {data.names.length} · 간선 {data.edges.length} · 영역에 못 놓은 노드 {model.violations}개 · 노드는 자기 집합의 영역 안에서만 끌 수 있습니다</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function SetNetControls({ params, setParams, table, mapping, setTable }: ControlsProps<SetNetParams>) {
  const data = readSetNet(table, mapping)
  const color = data ? categoryColor(data.cols) : () => '#999'
  const sel = params.selected
  return (
    <>
      <ControlGroup title="배치">
        <Toggle label="이름 표시" checked={params.labels} onChange={(labels) => setParams({ labels })} testId="ctl-labels" />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ seed: params.seed + 1, selected: -1 })} data-testid="setnet-relayout">레이아웃 다시 계산</button>
        {data && (
          <div className="field">
            <label>집합 강조</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button type="button" className="btn btn-secondary btn-sm" aria-pressed={params.focus < 0} onClick={() => setParams({ focus: -1 })}>전체</button>
              {data.cols.map((c, s) => <button key={c} type="button" className="btn btn-secondary btn-sm" aria-pressed={params.focus === s} data-testid={`setnet-focus-${s}`} style={{ borderColor: color(c) }} onClick={() => setParams({ focus: params.focus === s ? -1 : s })}>{c}</button>)}
            </div>
          </div>
        )}
        <Hint>집합을 먼저 오일러형 원으로 배치하되 노드를 많이 공유하거나 간선이 많이 이어진 집합끼리는 겹치게 하고, 그다음 노드마다 ‘자기가 속한 집합들의 교집합이면서 다른 집합은 아닌’ 영역(구역) 안에 힘 기반 배치로 놓습니다. 그래서 영역이 정확한 소속을 나타내고, 영역 안의 가까움은 친구 관계를 나타냅니다. 노드를 끌어 같은 구역 안에서 옮기고, 눌러 이웃을 강조합니다. 이 구현은 원 논문(SetNet)의 집합 배치 개선을 단순화해 원 크기·위치를 소속 겹침과 간선 수로만 조절하며, 해당 구역이 비면 가장 가까운 구역에 놓고 개수를 알립니다.</Hint>
      </ControlGroup>
      <ControlGroup title="소속 편집">
        {data && sel >= 0 && sel < data.names.length ? (
          <div className="field" data-testid="member-editor">
            <label>{data.names[sel]}의 소속</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {data.cols.map((c, s) => <button key={c} type="button" className={`btn btn-sm ${data.member[s][sel] ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={data.member[s][sel]} data-testid={`member-toggle-${s}`} disabled={!setTable}
                style={data.member[s][sel] ? { background: color(c), borderColor: color(c) } : undefined}
                onClick={() => { const ci = columnIndex(table, c); if (ci < 0) return; const rows = table.rows.slice(); const row = rows[sel].slice(); row[ci] = data.member[s][sel] ? 0 : 1; rows[sel] = row; setTable?.({ ...table, rows }) }}>{c}</button>)}
            </div>
          </div>
        ) : <Hint>노드를 누르면 여기서 소속 동아리를 바꿀 수 있습니다.</Hint>}
      </ControlGroup>
    </>
  )
}

export const setNetModule: VizModule<SetNetParams> = {
  roles: [
    { key: 'label', label: '이름(노드)', type: 'category', required: true, prefer: '이름|name' },
    { key: 'sets', label: '집합 (0/1 소속 열)', type: 'number', required: true, multiple: { min: 2, max: 4 } },
    { key: 'links', label: '이웃 목록 (이름을 ; 로 구분)', type: 'category', auto: true, prefer: '친구|이웃|links' },
  ],
  datasets: ['club-network'],
  defaultParams: { seed: 5, labels: true, focus: -1, selected: -1 },
  Chart: SetNetChart,
  Controls: SetNetControls,
  hint: '노드를 끌어 자기 집합의 영역 안에서 옮기고 눌러 친구를 강조 · 설정 패널에서 소속을 바꾸면 영역 배치가 다시 계산됩니다',
}
