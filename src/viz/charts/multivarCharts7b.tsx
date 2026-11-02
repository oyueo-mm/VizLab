import { useMemo, useRef } from 'react'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider } from '../../components/controls'
import { schemes, type SequentialScheme } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { dimensionalStacking, faceFeatures, faceGeometry, kdeND, lensLayout, pixelBars, recursivePos, segmentPixels, sliceGrid, type FaceGeometry } from '../../stats/multivar7'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { MULTIVAR_DATASETS, applyOrder, multivarRoles, pct, useObs } from './kit7'

const seqColor = (scheme: SequentialScheme) => schemes[scheme].interpolate
const schemeOptions = [{ value: 'viridis', label: 'Viridis' }, { value: 'blues', label: '파랑' }, { value: 'magma', label: 'Magma' }, { value: 'ylorrd', label: '노랑–빨강' }] as { value: SequentialScheme; label: string }[]
const normOptions = [{ value: 'minmax', label: '최소–최대' }, { value: 'zscore', label: 'z 점수' }] as { value: 'minmax' | 'zscore'; label: string }[]

// ───────────────────────────── Dimensional Stacking ─────────────────────────────

export interface StackParams { norm: 'minmax' | 'zscore'; order: string[]; bins: number; horizontalFirst: boolean; colorVar: string; scheme: SequentialScheme }

function StackChart({ table, mapping, params, width, height, compact }: ChartProps<StackParams>) {
  const obs = useObs(table, mapping, params.norm)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const colorIdx = obs.vars.indexOf(params.colorVar) >= 0 ? obs.vars.indexOf(params.colorVar) : Math.max(0, obs.vars.length - 1)
  const order = applyOrder(obs.vars.length, params.order.map((v) => obs.vars.indexOf(v))).filter((j) => j !== colorIdx || obs.vars.length <= 2)
  const stack = useMemo(() => dimensionalStacking(obs.norm, order.slice(0, 5), params.bins, obs.norm.map((r) => r[colorIdx]), params.horizontalFirst), [obs, order.join(','), params.bins, params.horizontalFirst, colorIdx])
  if (obs.vars.length < 3) return <ChartMessage>Dimensional Stacking에는 변수가 3개 이상 필요합니다.</ChartMessage>
  if (!obs.rows.length) return <ChartMessage>모든 변수 값이 있는 행이 없습니다.</ChartMessage>
  const m = compact ? 6 : 46
  const w = width - 2 * m, h = height - 2 * m - (compact ? 0 : 20)
  const cw = w / stack.cols, ch = h / stack.rows
  const color = seqColor(params.scheme)
  const used = order.slice(0, 5)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Dimensional Stacking: ${used.map((j) => obs.vars[j]).join(' › ')}, 색 ${obs.vars[colorIdx]}`} onPointerLeave={hide}>
        <g transform={`translate(${m},${m})`}>
          <rect width={w} height={h} fill="#fafbfc" stroke="#d6dbe0" />
          {stack.cells.map((c) => (
            <rect key={`${c.cx},${c.cy}`} x={c.cx * cw} y={c.cy * ch} width={Math.max(0.5, cw - (compact ? 0.4 : 1))} height={Math.max(0.5, ch - (compact ? 0.4 : 1))} fill={color(c.mean)} data-testid="stack-cell"
              onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>관측값 {c.count}개</b><br />{obs.vars[colorIdx]} 평균(정규화) {c.mean.toFixed(2)}</>) }} onPointerLeave={hide} />
          ))}
        </g>
        {!compact && <text x={m} y={height - 10} className="radar-axis-label">바깥 → 안쪽 중첩: {used.map((j, i) => `${obs.vars[j]}(${(i % 2 === 0) === params.horizontalFirst ? '가로' : '세로'})`).join(' › ')}</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function StackControls({ params, setParams, mapping }: ControlsProps<StackParams>) {
  const vars = roleColumns(mapping, 'vars')
  const colorVar = vars.includes(params.colorVar) ? params.colorVar : vars[vars.length - 1] ?? ''
  const rest = vars.filter((v) => v !== colorVar)
  const order = applyOrder(rest.length, params.order.map((v) => rest.indexOf(v))).map((i) => rest[i])
  const move = (k: number, d: number) => { const o = order.slice(); const t = k + d; if (t < 0 || t >= o.length) return; [o[k], o[t]] = [o[t], o[k]]; setParams({ order: o }) }
  return (
    <>
      <ControlGroup title="중첩 구조">
        <Slider label="변수당 구간 수" value={params.bins} min={2} max={6} onChange={(bins) => setParams({ bins })} testId="ctl-bins" />
        <Segmented label="가장 바깥 변수의 방향" value={params.horizontalFirst ? 'h' : 'v'} onChange={(v) => setParams({ horizontalFirst: v === 'h' })} options={[{ value: 'h', label: '가로' }, { value: 'v', label: '세로' }]} testId="ctl-dir" />
        <div className="field"><span className="field-label">변수 순서 (바깥 → 안)</span>
          {order.map((v, k) => (
            <div key={v} className="order-row">
              <span>{k + 1}. {v}{k >= 5 ? ' (미사용)' : ''}</span>
              <button type="button" className="icon-btn-xs" aria-label={`${v} 위로`} onClick={() => move(k, -1)} data-testid={`up-${v}`}>↑</button>
              <button type="button" className="icon-btn-xs" aria-label={`${v} 아래로`} onClick={() => move(k, 1)}>↓</button>
            </div>
          ))}
        </div>
        <Hint>바깥 변수는 큰 칸을, 안쪽 변수는 그 안의 작은 칸을 나눕니다. 최대 5개 변수까지 중첩합니다.</Hint>
      </ControlGroup>
      <ControlGroup title="색">
        <Select label="색에 쓸 변수 (칸 안 평균)" value={colorVar} onChange={(colorVar) => setParams({ colorVar })} options={vars.map((v) => ({ value: v, label: v }))} testId="ctl-colorvar" />
        <Select label="색 구성" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={schemeOptions} />
        <Segmented label="정규화" value={params.norm} onChange={(norm) => setParams({ norm })} options={normOptions} />
      </ControlGroup>
    </>
  )
}

export const stackModule: VizModule<StackParams> = {
  roles: multivarRoles(8),
  datasets: [...MULTIVAR_DATASETS],
  defaultParams: { norm: 'minmax', order: [], bins: 3, horizontalFirst: true, colorVar: '', scheme: 'viridis' },
  Chart: StackChart,
  Controls: StackControls,
  hint: '변수 순서를 바꾸면 중첩 구조가 바뀌어 보이는 패턴이 달라집니다 · 칸에 마우스를 올려 개수 확인',
}

// ───────────────────────────── Table Lens ─────────────────────────────

export interface LensParams { norm: 'minmax' | 'zscore'; sortBy: string; desc: boolean; focus: number[]; focusH: number; scheme: SequentialScheme; mode: 'bar' | 'color' }

function LensChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<LensParams>) {
  const obs = useObs(table, mapping, params.norm, 600)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const sortIdx = obs.vars.indexOf(params.sortBy)
  const ord = useMemo(() => {
    const o = obs.rows.map((_, i) => i)
    if (sortIdx >= 0) o.sort((a, b) => (obs.raw[a][sortIdx] - obs.raw[b][sortIdx]) * (params.desc ? -1 : 1) || a - b)
    return o
  }, [obs, sortIdx, params.desc])
  const focusSet = useMemo(() => new Set(params.focus.map((row) => ord.findIndex((i) => obs.rows[i] === row)).filter((p) => p >= 0)), [params.focus, ord, obs])
  if (obs.vars.length < 2) return <ChartMessage>Table Lens에는 변수가 2개 이상 필요합니다.</ChartMessage>
  if (!obs.rows.length) return <ChartMessage>모든 변수 값이 있는 행이 없습니다.</ChartMessage>
  const top = compact ? 4 : 44, left = compact ? 4 : 96
  const H = height - top - (compact ? 4 : 10), W = width - left - (compact ? 4 : 14)
  const { top: ty, height: th } = lensLayout(ord.length, focusSet, H, compact ? 0 : params.focusH, 1)
  const colW = W / obs.vars.length
  const color = seqColor(params.scheme)
  const toggle = (row: number) => setParams({ focus: params.focus.includes(row) ? params.focus.filter((r) => r !== row) : [...params.focus, row] })
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Table Lens: ${obs.rows.length}행 × ${obs.vars.length}열, 확대한 행 ${focusSet.size}개`} onPointerLeave={hide}>
        {!compact && obs.vars.map((v, j) => (
          <g key={v} transform={`translate(${left + j * colW},0)`}>
            <text x={colW / 2} y={top - 12} textAnchor="middle" className="radar-axis-label" style={{ cursor: 'pointer', fontWeight: params.sortBy === v ? 700 : 400 }} onClick={() => setParams(params.sortBy === v ? { desc: !params.desc } : { sortBy: v, desc: false })} data-testid={`lens-head-${v}`}>
              {v}{params.sortBy === v ? (params.desc ? ' ▼' : ' ▲') : ''}
            </text>
          </g>
        ))}
        {ord.map((i, p) => {
          const focused = focusSet.has(p)
          const y = top + ty[p], hgt = th[p]
          return (
            <g key={obs.rows[i]} data-testid="lens-row" data-focus={focused ? '1' : '0'} onClick={compact ? undefined : () => toggle(obs.rows[i])} style={{ cursor: compact ? undefined : 'pointer' }}>
              {focused && <rect x={0} y={y} width={width} height={hgt} fill="#f1f6f5" />}
              {focused && !compact && <text x={left - 8} y={y + hgt / 2} dy="0.35em" textAnchor="end" className="radar-axis-label">{obs.groups[i] || `행 ${obs.rows[i] + 1}`}</text>}
              {obs.vars.map((v, j) => {
                const x0 = left + j * colW + 3
                const frac = obs.norm[i][j]
                return params.mode === 'bar'
                  ? <rect key={v} x={x0} y={y} width={Math.max(0.5, frac * (colW - 6))} height={Math.max(0.8, hgt - (focused ? 6 : 0.2))} fill={obs.color(obs.groups[i])} fillOpacity={focused ? 0.9 : 0.7}
                      onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{obs.groups[i] || `행 ${obs.rows[i] + 1}`}</b><br />{v}: {fmt(obs.raw[i][j])}</>) }} onPointerLeave={hide} />
                  : <rect key={v} x={x0} y={y} width={colW - 6} height={Math.max(0.8, hgt - 0.2)} fill={color(frac)} onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{obs.groups[i] || `행 ${obs.rows[i] + 1}`}</b><br />{v}: {fmt(obs.raw[i][j])}</>) }} onPointerLeave={hide} />
              })}
              {focused && !compact && obs.vars.map((v, j) => <text key={v} x={left + j * colW + 6} y={y + hgt / 2} dy="0.35em" className="radar-level" fill="#111" style={{ pointerEvents: 'none' }}>{fmt(obs.raw[i][j])}</text>)}
            </g>
          )
        })}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function LensControls({ params, setParams, mapping }: ControlsProps<LensParams>) {
  const vars = roleColumns(mapping, 'vars')
  return (
    <>
      <ControlGroup title="Focus + Context">
        <Slider label="확대한 행의 높이" value={params.focusH} min={14} max={44} onChange={(focusH) => setParams({ focusH })} format={(v) => `${v}px`} testId="ctl-focush" />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ focus: [] })} data-testid="lens-clear">확대 해제 ({params.focus.length})</button>
        <Hint>행을 누르면 그 행만 펼쳐 값을 읽을 수 있고, 나머지 행은 한 줄(≥1px)로 압축된 막대로 남아 전체 흐름을 보여줍니다. 열 제목을 누르면 정렬합니다.</Hint>
      </ControlGroup>
      <ControlGroup title="표현">
        <Segmented label="셀 표현" value={params.mode} onChange={(mode) => setParams({ mode })} options={[{ value: 'bar', label: '막대 길이' }, { value: 'color', label: '색' }]} testId="ctl-mode" />
        <Select label="정렬 열" value={vars.includes(params.sortBy) ? params.sortBy : ''} onChange={(sortBy) => setParams({ sortBy })} options={[{ value: '', label: '원래 순서' }, ...vars.map((v) => ({ value: v, label: v }))]} testId="ctl-sort" />
        <Segmented label="정규화" value={params.norm} onChange={(norm) => setParams({ norm })} options={normOptions} />
        {params.mode === 'color' && <Select label="색 구성" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={schemeOptions} />}
      </ControlGroup>
    </>
  )
}

export const lensModule: VizModule<LensParams> = {
  roles: multivarRoles(10, 2),
  datasets: [...MULTIVAR_DATASETS],
  defaultParams: { norm: 'minmax', sortBy: '', desc: false, focus: [], focusH: 24, scheme: 'viridis', mode: 'bar' },
  Chart: LensChart,
  Controls: LensControls,
  hint: '행을 눌러 확대/축소 · 열 제목을 눌러 정렬',
}

// ───────────────────────────── Recursive Pattern ─────────────────────────────

export interface RecursiveParams { norm: 'minmax' | 'zscore'; depth: number; block: number; sortBy: string; snake: boolean; scheme: SequentialScheme }

/** Levels of the recursive pattern for n records: (block × block) at the inner levels, the outermost level sized to fit. */
export function recursiveLevels(n: number, block: number, depth: number): [number, number][] {
  const levels: [number, number][] = Array.from({ length: Math.max(1, depth) - 1 }, () => [block, block])
  const inner = levels.reduce((s, [w, h]) => s * w * h, 1)
  const cells = Math.max(1, Math.ceil(n / inner))
  const w = Math.ceil(Math.sqrt(cells))
  levels.push([w, Math.ceil(cells / w)])
  return levels
}

function RecursiveChart({ table, mapping, params, width, height, compact }: ChartProps<RecursiveParams>) {
  const obs = useObs(table, mapping, params.norm, 4000)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const sortIdx = obs.vars.indexOf(params.sortBy)
  const order = useMemo(() => {
    const o = obs.rows.map((_, i) => i)
    if (sortIdx >= 0) o.sort((a, b) => obs.raw[a][sortIdx] - obs.raw[b][sortIdx] || a - b)
    return o
  }, [obs, sortIdx])
  const levels = useMemo(() => recursiveLevels(order.length, Math.max(2, params.block), params.depth), [order.length, params.block, params.depth])
  if (!obs.rows.length) return <ChartMessage>모든 변수 값이 있는 행이 없습니다.</ChartMessage>
  const d = obs.vars.length
  const cols = d <= 3 ? d : Math.ceil(Math.sqrt(d))
  const rows = Math.ceil(d / cols)
  const pad = compact ? 4 : 18
  const pw = (width - pad * (cols + 1)) / cols, ph = (height - pad * (rows + 1) - (compact ? 0 : 14 * rows)) / rows
  const gridW = levels.reduce((s, [w]) => s * w, 1), gridH = levels.reduce((s, [, h]) => s * h, 1)
  const px = Math.max(0.5, Math.min(pw / gridW, ph / gridH))
  const color = seqColor(params.scheme)
  const innerLevel = levels.slice(0, -1)
  const blockPx = innerLevel.reduce((s, [w]) => s * w, 1)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Recursive Pattern: 변수 ${d}개, 관측값 ${order.length}개, ${params.depth}단계 재귀 배치`} onPointerLeave={hide}>
        {obs.vars.map((v, j) => {
          const ox = pad + (j % cols) * (pw + pad) + (pw - gridW * px) / 2
          const oy = pad + Math.floor(j / cols) * (ph + pad + (compact ? 0 : 14)) + (compact ? 0 : 14)
          return (
            <g key={v} transform={`translate(${ox},${oy})`}>
              {!compact && <text x={(gridW * px) / 2} y={-5} textAnchor="middle" className="radar-axis-label">{v}</text>}
              <rect width={gridW * px} height={gridH * px} fill="#fafbfc" stroke="#d6dbe0" />
              {order.map((i, k) => {
                const [x, y] = recursivePos(k, levels, params.snake)
                return <rect key={k} x={x * px} y={y * px} width={px} height={px} fill={color(obs.norm[i][j])} data-testid="rp-pixel"
                  onPointerEnter={compact || px < 2 ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{obs.groups[i] || `행 ${obs.rows[i] + 1}`}</b><br />{v}: {fmt(obs.raw[i][j])}</>) }} onPointerLeave={hide} />
              })}
              {!compact && blockPx > 1 && params.depth > 1 && px >= 2 && <rect width={gridW * px} height={gridH * px} fill="none" stroke="#9aa3ad" strokeOpacity={0.35} strokeDasharray="2 3" />}
            </g>
          )
        })}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function RecursiveControls({ params, setParams, mapping }: ControlsProps<RecursiveParams>) {
  const vars = roleColumns(mapping, 'vars')
  return (
    <>
      <ControlGroup title="재귀 구조">
        <Slider label="재귀 깊이" value={params.depth} min={1} max={4} onChange={(depth) => setParams({ depth })} testId="ctl-depth" />
        <Slider label="안쪽 블록 한 변" value={params.block} min={2} max={8} onChange={(block) => setParams({ block })} testId="ctl-block" />
        <Select label="정렬 기준 변수" value={vars.includes(params.sortBy) ? params.sortBy : ''} onChange={(sortBy) => setParams({ sortBy })} options={[{ value: '', label: '원래 순서' }, ...vars.map((v) => ({ value: v, label: v }))]} testId="ctl-sort" />
        <Segmented label="블록 안 순서" value={params.snake ? 'snake' : 'row'} onChange={(v) => setParams({ snake: v === 'snake' })} options={[{ value: 'row', label: '행 순서' }, { value: 'snake', label: '뱀 모양' }]} />
        <Hint>한 변수가 패널 하나이고 관측값 하나가 픽셀 하나입니다. 같은 위치는 모든 패널에서 같은 관측값이라 패널을 가로질러 비교할 수 있습니다.</Hint>
      </ControlGroup>
      <ControlGroup title="색">
        <Select label="색 구성" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={schemeOptions} />
        <Segmented label="정규화" value={params.norm} onChange={(norm) => setParams({ norm })} options={normOptions} />
      </ControlGroup>
    </>
  )
}

export const recursiveModule: VizModule<RecursiveParams> = {
  roles: multivarRoles(9, 1),
  datasets: [...MULTIVAR_DATASETS],
  defaultParams: { norm: 'minmax', depth: 2, block: 4, sortBy: '', snake: false, scheme: 'viridis' },
  Chart: RecursiveChart,
  Controls: RecursiveControls,
  hint: '재귀 깊이와 블록 크기로 배치 구조를 바꾸고, 정렬 변수를 정하면 그 변수 순서대로 픽셀이 채워집니다',
}

// ───────────────────────────── Circle Segments ─────────────────────────────

export interface SegmentsParams { norm: 'minmax' | 'zscore'; sortBy: string; scheme: SequentialScheme }

function SegmentsChart({ table, mapping, params, width, height, compact }: ChartProps<SegmentsParams>) {
  const obs = useObs(table, mapping, params.norm, 3000)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const sortIdx = obs.vars.indexOf(params.sortBy)
  const order = useMemo(() => {
    const o = obs.rows.map((_, i) => i)
    if (sortIdx >= 0) o.sort((a, b) => obs.raw[a][sortIdx] - obs.raw[b][sortIdx] || a - b)
    return o
  }, [obs, sortIdx])
  const d = obs.vars.length
  const n = order.length
  const R = Math.max(20, Math.min(width, height) / 2 - (compact ? 6 : 48))
  const layout = useMemo(() => {
    if (!n || d < 2) return null
    // Pixel size in normalized units: the sector area (annulus part) holds n pixels with ~10% slack.
    const inner = 0.12
    let px = Math.sqrt(((Math.PI / d) * (1 - inner * inner)) / (n * 1.1))
    let pixels = segmentPixels(n, d, 0, px, inner)
    const maxR = () => pixels[pixels.length - 1].radius + px / 2
    while (maxR() > 1 && px > 0.002) { px *= 0.96; pixels = segmentPixels(n, d, 0, px, inner) }
    return { px, sectors: obs.vars.map((_, s) => segmentPixels(n, d, s, px, inner)) }
  }, [n, d, obs.vars])
  if (d < 2) return <ChartMessage>Circle Segments에는 변수가 2개 이상 필요합니다.</ChartMessage>
  if (!n || !layout) return <ChartMessage>모든 변수 값이 있는 행이 없습니다.</ChartMessage>
  const color = seqColor(params.scheme)
  const cx = width / 2, cy = height / 2
  const size = Math.max(0.6, layout.px * R)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Circle Segments: 변수 ${d}개를 원의 구역 ${d}개로, 관측값 ${n}개`} onPointerLeave={hide}>
        {obs.vars.map((v, s) => {
          const mid = (s + 0.5) * ((2 * Math.PI) / d) - Math.PI / 2
          return (
            <g key={v}>
              {layout.sectors[s].map((p, k) => {
                const i = order[k]
                return <rect key={k} x={cx + Math.cos(p.angle) * p.radius * R - size / 2} y={cy + Math.sin(p.angle) * p.radius * R - size / 2} width={size} height={size} fill={color(obs.norm[i][s])} data-testid="cs-pixel"
                  onPointerEnter={compact || size < 2 ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{obs.groups[i] || `행 ${obs.rows[i] + 1}`}</b><br />{v}: {fmt(obs.raw[i][s])}</>) }} onPointerLeave={hide} />
              })}
              <line x1={cx} y1={cy} x2={cx + Math.cos(s * ((2 * Math.PI) / d) - Math.PI / 2) * R} y2={cy + Math.sin(s * ((2 * Math.PI) / d) - Math.PI / 2) * R} stroke="#fff" strokeWidth={1.5} />
              {!compact && <text x={cx + Math.cos(mid) * (R + 18)} y={cy + Math.sin(mid) * (R + 18)} dy="0.35em" textAnchor={Math.cos(mid) > 0.2 ? 'start' : Math.cos(mid) < -0.2 ? 'end' : 'middle'} className="radar-axis-label">{v}</text>}
            </g>
          )
        })}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function SegmentsControls({ params, setParams, mapping }: ControlsProps<SegmentsParams>) {
  const vars = roleColumns(mapping, 'vars')
  return (
    <>
      <ControlGroup title="배치">
        <Select label="정렬 기준 변수" value={vars.includes(params.sortBy) ? params.sortBy : ''} onChange={(sortBy) => setParams({ sortBy })} options={[{ value: '', label: '원래 순서' }, ...vars.map((v) => ({ value: v, label: v }))]} testId="ctl-sort" />
        <Hint>변수마다 원의 한 구역이 배정되고, 관측값은 정렬 순서대로 중심에서 바깥으로 링을 따라 채워집니다. 같은 링·같은 각 위치는 모든 구역에서 같은 관측값입니다.</Hint>
      </ControlGroup>
      <ControlGroup title="색">
        <Select label="색 구성" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={schemeOptions} />
        <Segmented label="정규화" value={params.norm} onChange={(norm) => setParams({ norm })} options={normOptions} />
      </ControlGroup>
    </>
  )
}

export const segmentsModule: VizModule<SegmentsParams> = {
  roles: multivarRoles(10, 2),
  datasets: [...MULTIVAR_DATASETS],
  defaultParams: { norm: 'minmax', sortBy: '', scheme: 'viridis' },
  Chart: SegmentsChart,
  Controls: SegmentsControls,
  hint: '정렬 변수를 바꾸면 모든 구역의 픽셀 순서가 함께 바뀝니다',
}

// ───────────────────────────── HyperSlice ─────────────────────────────

export interface HyperParams { norm: 'minmax' | 'zscore'; off: string[]; point: number[]; bandwidth: number; scheme: SequentialScheme; shared: boolean }

const SLICE_N = 16

function HyperChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<HyperParams>) {
  const obs = useObs(table, mapping, params.norm, 300)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const idx = obs.vars.map((v, i) => (params.off.includes(v) ? -1 : i)).filter((i) => i >= 0).slice(0, 4)
  const d = idx.length
  const data = useMemo(() => obs.norm.map((r) => idx.map((j) => r[j])), [obs, idx.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const point = idx.map((_, k) => params.point[k] ?? 0.5)
  const grids = useMemo(() => {
    if (d < 2) return []
    const f = (p: number[]) => kdeND(data, p, params.bandwidth)
    const out: { a: number; b: number; g: number[][] }[] = []
    for (let a = 0; a < d; a++) for (let b = a + 1; b < d; b++) out.push({ a, b, g: sliceGrid(f, point, a, b, SLICE_N) })
    return out
  }, [data, d, point.join(','), params.bandwidth]) // eslint-disable-line react-hooks/exhaustive-deps
  if (d < 2) return <ChartMessage>HyperSlice에는 변수가 2개 이상 필요합니다.</ChartMessage>
  if (!obs.rows.length) return <ChartMessage>모든 변수 값이 있는 행이 없습니다.</ChartMessage>
  const color = seqColor(params.scheme)
  const globalMax = Math.max(1e-12, ...grids.flatMap((p) => p.g.flat()))
  const cols = d === 2 ? 1 : d === 3 ? 3 : 3
  const rows = Math.ceil(grids.length / cols)
  const pad = compact ? 5 : 30
  const pw = (width - pad * (cols + 1)) / cols, ph = (height - pad * (rows + 1) - (compact ? 0 : 10)) / rows
  const side = Math.max(20, Math.min(pw, ph))
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`HyperSlice: ${d}개 변수의 2차원 단면 ${grids.length}개`} onPointerLeave={hide}>
        {grids.map((p, k) => {
          const ox = pad + (k % cols) * (pw + pad) + (pw - side) / 2
          const oy = pad + Math.floor(k / cols) * (ph + pad) + 10
          const lmax = params.shared ? globalMax : Math.max(1e-12, ...p.g.flat())
          const cell = side / SLICE_N
          return (
            <g key={`${p.a}-${p.b}`} transform={`translate(${ox},${oy})`} data-testid="hs-panel">
              {p.g.map((row, iy) => row.map((v, ix) => <rect key={`${ix},${iy}`} x={ix * cell} y={iy * cell} width={cell + 0.4} height={cell + 0.4} fill={color(Math.min(1, v / lmax))} />))}
              <rect width={side} height={side} fill="none" stroke="#9aa3ad" />
              {!compact && <>
                <line x1={point[p.a] * side} x2={point[p.a] * side} y1={0} y2={side} stroke="#fff" strokeWidth={1.4} strokeDasharray="3 2" />
                <line y1={(1 - point[p.b]) * side} y2={(1 - point[p.b]) * side} x1={0} x2={side} stroke="#fff" strokeWidth={1.4} strokeDasharray="3 2" />
                <text x={side / 2} y={side + 15} textAnchor="middle" className="radar-axis-label">{obs.vars[idx[p.a]]} →</text>
                <text x={-8} y={side / 2} textAnchor="middle" className="radar-axis-label" transform={`rotate(-90 -8 ${side / 2})`} dy="-0.3em">{obs.vars[idx[p.b]]} →</text>
                <rect width={side} height={side} fill="transparent" style={{ cursor: 'crosshair' }} data-testid={`hs-hit-${p.a}-${p.b}`}
                  onPointerMove={(e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <>클릭해 단면 위치 이동</>) }}
                  onClick={(e) => {
                    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect()
                    const next = point.slice()
                    next[p.a] = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
                    next[p.b] = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))
                    setParams({ point: next })
                  }} />
              </>}
            </g>
          )
        })}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function HyperControls({ params, setParams, mapping }: ControlsProps<HyperParams>) {
  const vars = roleColumns(mapping, 'vars')
  const active = vars.filter((v) => !params.off.includes(v)).slice(0, 4)
  return (
    <>
      <ControlGroup title="단면 위치">
        {active.map((v, k) => <Slider key={v} label={v} value={params.point[k] ?? 0.5} min={0} max={1} step={0.02} onChange={(x) => { const p = active.map((_, i) => params.point[i] ?? 0.5); p[k] = x; setParams({ point: p }) }} format={pct} testId={`slice-${k}`} />)}
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ point: [] })} data-testid="hs-center">중앙으로</button>
        <Hint>각 패널은 두 변수를 가로·세로로 움직이고 나머지 변수는 점선이 가리키는 값에 고정한 밀도(커널 밀도 추정)의 단면입니다. 패널을 누르면 단면 위치가 이동합니다.</Hint>
      </ControlGroup>
      <ControlGroup title="계산">
        <Slider label="커널 폭" value={params.bandwidth} min={0.05} max={0.5} step={0.01} onChange={(bandwidth) => setParams({ bandwidth })} format={(v) => v.toFixed(2)} testId="ctl-bw" />
        <Segmented label="색 범위" value={params.shared ? 'shared' : 'own'} onChange={(v) => setParams({ shared: v === 'shared' })} options={[{ value: 'shared', label: '모든 패널 공통' }, { value: 'own', label: '패널별' }]} />
        <Select label="색 구성" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={schemeOptions} />
        <Segmented label="정규화" value={params.norm} onChange={(norm) => setParams({ norm })} options={normOptions} />
      </ControlGroup>
      <ControlGroup title="변수 선택 (최대 4개)">
        {vars.map((v) => (
          <label key={v} className="check-row"><input type="checkbox" checked={!params.off.includes(v)} onChange={(e) => setParams({ off: e.target.checked ? params.off.filter((x) => x !== v) : [...params.off, v] })} data-testid={`hsvar-${v}`} /> {v}</label>
        ))}
      </ControlGroup>
    </>
  )
}

export const hyperSliceModule: VizModule<HyperParams> = {
  roles: multivarRoles(8, 2),
  datasets: [...MULTIVAR_DATASETS],
  defaultParams: { norm: 'minmax', off: [], point: [], bandwidth: 0.2, scheme: 'viridis', shared: true },
  Chart: HyperChart,
  Controls: HyperControls,
  hint: '패널을 눌러 단면 위치를 옮기면 나머지 패널이 함께 갱신됩니다',
}

// ───────────────────────────── Pixel Bar Chart ─────────────────────────────

export interface PixelBarParams { norm: 'minmax' | 'zscore'; sortBy: string; colorBy: string; cols: number; scheme: SequentialScheme; order: 'name' | 'count' }

function PixelBarChart({ table, mapping, params, width, height, compact }: ChartProps<PixelBarParams>) {
  const vars = roleColumns(mapping, 'vars')
  const obs = useObs(table, mapping, params.norm, 3000)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const groupCol = roleColumn(mapping, 'group')
  const sortIdx = Math.max(0, obs.vars.indexOf(params.sortBy))
  const colorIdx = obs.vars.indexOf(params.colorBy) >= 0 ? obs.vars.indexOf(params.colorBy) : Math.min(1, obs.vars.length - 1)
  const names = params.order === 'count' ? [...obs.groupNames].sort((a, b) => obs.groups.filter((g) => g === b).length - obs.groups.filter((g) => g === a).length) : obs.groupNames
  const bars = useMemo(() => pixelBars(obs.groups, obs.raw.map((r) => r[sortIdx]), params.cols, names), [obs, sortIdx, params.cols, names.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!groupCol) return <ChartMessage>막대를 나눌 범주형 열(그룹)을 선택하세요.</ChartMessage>
  if (!obs.rows.length || !vars.length) return <ChartMessage>모든 변수 값이 있는 행이 없습니다.</ChartMessage>
  const m = compact ? { l: 6, r: 6, t: 6, b: 6 } : { l: 54, r: 20, t: 24, b: 54 }
  const plotW = width - m.l - m.r, plotH = height - m.t - m.b
  const gap = compact ? 4 : 18
  const barW = (plotW - gap * (bars.length - 1)) / bars.length
  const maxH = Math.max(1, ...bars.map((b) => b.height))
  const px = Math.max(0.6, barW / params.cols)
  const py = Math.max(0.6, Math.min(plotH / maxH, px * 2.2))
  const color = seqColor(params.scheme)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Pixel Bar Chart: ${bars.length}개 막대, 관측값 ${obs.rows.length}개`} onPointerLeave={hide}>
        <g transform={`translate(${m.l},${m.t})`}>
          {bars.map((b, bi) => {
            const x0 = bi * (barW + gap) + (barW - px * params.cols) / 2
            return (
              <g key={b.key} transform={`translate(${x0},0)`}>
                {b.pixels.map((p) => (
                  <rect key={p.record} x={p.col * px} y={plotH - (p.row + 1) * py} width={px} height={py} fill={color(obs.norm[p.record][colorIdx])} data-testid="pb-pixel"
                    onPointerEnter={compact || px < 2 ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{b.key}</b><br />{obs.vars[sortIdx]}: {fmt(obs.raw[p.record][sortIdx])}<br />{obs.vars[colorIdx]}: {fmt(obs.raw[p.record][colorIdx])}</>) }} onPointerLeave={hide} />
                ))}
                {!compact && <text x={(px * params.cols) / 2} y={plotH + 18} textAnchor="middle" className="radar-axis-label">{b.key}</text>}
                {!compact && <text x={(px * params.cols) / 2} y={plotH + 34} textAnchor="middle" className="radar-level">{b.rows.length}개</text>}
              </g>
            )
          })}
          <line x1={0} x2={plotW} y1={plotH} y2={plotH} stroke="#9aa3ad" />
        </g>
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function PixelBarControls({ params, setParams, mapping }: ControlsProps<PixelBarParams>) {
  const vars = roleColumns(mapping, 'vars')
  return (
    <>
      <ControlGroup title="막대와 픽셀">
        <Select label="막대 안 정렬 변수 (아래 → 위)" value={vars.includes(params.sortBy) ? params.sortBy : vars[0] ?? ''} onChange={(sortBy) => setParams({ sortBy })} options={vars.map((v) => ({ value: v, label: v }))} testId="ctl-sort" />
        <Select label="픽셀 색 변수" value={vars.includes(params.colorBy) ? params.colorBy : vars[Math.min(1, vars.length - 1)] ?? ''} onChange={(colorBy) => setParams({ colorBy })} options={vars.map((v) => ({ value: v, label: v }))} testId="ctl-color" />
        <Slider label="막대 너비 (픽셀 수)" value={params.cols} min={4} max={30} onChange={(cols) => setParams({ cols })} testId="ctl-cols" />
        <Segmented label="막대 순서" value={params.order} onChange={(order) => setParams({ order })} options={[{ value: 'name', label: '등장 순' }, { value: 'count', label: '개수 순' }]} />
        <Hint>막대 높이는 범주의 레코드 수이고, 막대 안의 픽셀 하나가 레코드 하나입니다.</Hint>
      </ControlGroup>
      <ControlGroup title="색">
        <Select label="색 구성" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={schemeOptions} />
        <Segmented label="정규화" value={params.norm} onChange={(norm) => setParams({ norm })} options={normOptions} />
      </ControlGroup>
    </>
  )
}

export const pixelBarModule: VizModule<PixelBarParams> = {
  roles: [
    { key: 'group', label: '막대 범주', type: 'category', required: true },
    { key: 'vars', label: '정렬·색 변수 (숫자형)', type: 'number', required: true, multiple: { min: 2, max: 6 } },
  ],
  datasets: [...MULTIVAR_DATASETS],
  defaultParams: { norm: 'minmax', sortBy: '', colorBy: '', cols: 10, scheme: 'viridis', order: 'name' },
  Chart: PixelBarChart,
  Controls: PixelBarControls,
  hint: '정렬 변수와 색 변수를 바꿔 막대 안 분포를 비교',
}

// ───────────────────────────── Chernoff Faces ─────────────────────────────

export interface FaceParams { norm: 'minmax' | 'zscore'; count: number; assign: Record<string, string>; labels: boolean }

export function Face({ g, cx, cy, size, fill }: { g: FaceGeometry; cx: number; cy: number; size: number; fill: string }) {
  const S = size
  const ex = g.eyeGap * S, ey = -0.08 * S
  return (
    <g transform={`translate(${cx},${cy})`} data-testid="chernoff-face">
      <ellipse rx={g.rx * S} ry={g.ry * S} fill={fill} fillOpacity={0.25} stroke={fill} strokeWidth={1.4} />
      {[-1, 1].map((s) => (
        <g key={s}>
          <circle cx={s * ex} cy={ey} r={g.eyeR * S} fill="#fff" stroke="#333" strokeWidth={1} />
          <circle cx={s * ex} cy={ey} r={g.eyeR * S * 0.45} fill="#333" />
          <line x1={s * ex - 0.05 * S} x2={s * ex + 0.05 * S} y1={ey - 0.1 * S - s * g.browTilt * S} y2={ey - 0.1 * S + s * g.browTilt * S} stroke="#333" strokeWidth={1.4} />
        </g>
      ))}
      <line x1={0} x2={0} y1={ey + 0.02 * S} y2={ey + 0.02 * S + g.noseLen * S} stroke="#333" strokeWidth={1.2} />
      <path d={`M ${-g.mouthHalf * S} ${0.17 * S} Q 0 ${0.17 * S + g.mouthCurve * 2 * S} ${g.mouthHalf * S} ${0.17 * S}`} fill="none" stroke="#333" strokeWidth={1.6} strokeLinecap="round" />
    </g>
  )
}

function FaceChart({ table, mapping, params, width, height, compact }: ChartProps<FaceParams>) {
  const obs = useObs(table, mapping, params.norm, 3000)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const assign = useMemo(() => faceFeatures.map((f, k) => params.assign[f] ?? obs.vars[k] ?? ''), [params.assign, obs.vars])
  const picks = useMemo(() => {
    const n = obs.rows.length
    const count = Math.min(compact ? 6 : params.count, n)
    return Array.from({ length: count }, (_, k) => Math.floor((k * n) / Math.max(1, count)))
  }, [obs.rows.length, params.count, compact])
  if (!obs.rows.length) return <ChartMessage>모든 변수 값이 있는 행이 없습니다.</ChartMessage>
  const cols = compact ? 3 : Math.max(1, Math.min(picks.length, Math.floor(width / 120)))
  const rows = Math.ceil(picks.length / cols)
  const cw = width / cols
  const ch = (height - 8) / rows
  const size = Math.min(cw, ch) * (compact ? 1.0 : 0.88)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Chernoff Faces: 얼굴 ${picks.length}개, 변수 ${obs.vars.length}개를 얼굴 요소에 대응`} onPointerLeave={hide}>
        {picks.map((i, k) => {
          const vals = assign.map((v) => { const j = obs.vars.indexOf(v); return j >= 0 ? obs.norm[i][j] : 0.5 })
          const cx = (k % cols) * cw + cw / 2, cy = Math.floor(k / cols) * ch + ch / 2 - (compact || !params.labels ? 0 : 6)
          const g = obs.groups[i]
          return (
            <g key={i} onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{g || `행 ${obs.rows[i] + 1}`}</b>{faceFeatures.map((f, q) => assign[q] ? <div key={f}>{f} ← {assign[q]}: {fmt(obs.raw[i][obs.vars.indexOf(assign[q])])}</div> : null)}</>) }} onPointerLeave={hide}>
              <Face g={faceGeometry(vals)} cx={cx} cy={cy} size={size} fill={obs.color(g)} />
              {!compact && params.labels && <text x={cx} y={cy + size * 0.5 + 12} textAnchor="middle" className="radar-level">{g || `행 ${obs.rows[i] + 1}`}</text>}
            </g>
          )
        })}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function FaceControls({ params, setParams, mapping }: ControlsProps<FaceParams>) {
  const vars = roleColumns(mapping, 'vars')
  return (
    <>
      <ControlGroup title="변수 → 얼굴 요소">
        {faceFeatures.map((f, k) => (
          <Select key={f} label={f} value={params.assign[f] ?? vars[k] ?? ''} onChange={(v) => setParams({ assign: { ...params.assign, [f]: v } })} options={[{ value: '', label: '(대응 없음)' }, ...vars.map((v) => ({ value: v, label: v }))]} testId={`face-${k}`} />
        ))}
        <Hint>정규화한 값 0 → 1이 요소의 최소 → 최대에 대응합니다(눈 크기, 입의 곡률 등). 대응 없는 요소는 중간값에 고정됩니다.</Hint>
      </ControlGroup>
      <ControlGroup title="표시">
        <Slider label="얼굴 수" value={params.count} min={4} max={40} onChange={(count) => setParams({ count })} testId="ctl-count" />
        <Segmented label="정규화 범위" value={params.norm} onChange={(norm) => setParams({ norm })} options={normOptions} />
      </ControlGroup>
    </>
  )
}

export const faceModule: VizModule<FaceParams> = {
  roles: multivarRoles(8, 2),
  datasets: [...MULTIVAR_DATASETS],
  defaultParams: { norm: 'minmax', count: 16, assign: {}, labels: true },
  Chart: FaceChart,
  Controls: FaceControls,
  hint: '변수와 얼굴 요소의 대응을 바꿔 가며 같은 관측값을 비교',
}
