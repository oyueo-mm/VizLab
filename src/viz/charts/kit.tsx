import * as d3 from 'd3'
import { useMemo, useRef, type ReactNode } from 'react'
import { AxisBottom, AxisLeft, Legend, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { fmt } from '../../lib/format'
import { colorAt } from '../../lib/colors'
import { formatTime } from '../../stats/datetime'

/** Building blocks shared by the v0.6 charts: an SVG stage with tooltip and readout, a layered XY plot and a labelled heat grid. */

export function useStage() {
  const svgRef = useRef<SVGSVGElement>(null)
  const { tip, show, hide } = useTooltip()
  const at = (e: { clientX: number; clientY: number }, content: ReactNode) => { if (!svgRef.current) return; const l = localPoint(svgRef.current, e); show(l.x, l.y, content) }
  return { svgRef, tip, hide, at }
}
export type StageApi = ReturnType<typeof useStage>

/** Notes sit at the bottom right so they never cover the centred x-axis title. */
const NOTE_STYLE = { left: 'auto', right: 8, bottom: 2, maxWidth: '58%', textAlign: 'right' } as const

export function Stage({ stage, width, height, label, readout, note, compact, children, overlay }: {
  stage: StageApi; width: number; height: number; label: string; readout?: { label: string; value: ReactNode }[]; note?: ReactNode; compact?: boolean; children: ReactNode; overlay?: ReactNode
}) {
  return (
    <div className="chart-root">
      <svg ref={stage.svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={label} onPointerLeave={stage.hide}>{children}</svg>
      {overlay}
      <Tooltip tip={stage.tip} width={width} />
      {!compact && readout && readout.length > 0 && <Readout items={readout} />}
      {!compact && note && <p className="chart-note" role="note" style={NOTE_STYLE}>{note}</p>}
    </div>
  )
}

export type Layer =
  | { kind: 'line'; x: number[]; y: number[]; color?: string; label?: string; dash?: string; width?: number; step?: boolean; opacity?: number; tip?: ReactNode }
  | { kind: 'band'; x: number[]; lo: number[]; hi: number[]; color?: string; label?: string; opacity?: number }
  | { kind: 'points'; pts: { x: number; y: number; color?: string; r?: number; tip?: ReactNode; key?: string }[]; color?: string; r?: number; label?: string; opacity?: number; stroke?: string }
  | { kind: 'stem'; x: number[]; y: number[]; base?: number; color?: string; label?: string; dot?: boolean }
  | { kind: 'bars'; x: number[]; y: number[]; w: number; base?: number; color?: string | string[]; label?: string; opacity?: number }
  | { kind: 'hline'; v: number; color?: string; dash?: string; label?: string; width?: number }
  | { kind: 'vline'; v: number; color?: string; dash?: string; label?: string; width?: number }
  | { kind: 'raster'; nx: number; ny: number; z: number[]; x0: number; x1: number; y0: number; y1: number; color: (v: number) => string; label?: string; opacity?: number }
  | { kind: 'text'; x: number; y: number; text: string; color?: string; anchor?: 'start' | 'middle' | 'end'; size?: number }

export interface XYProps {
  layers: Layer[]
  width: number
  height: number
  compact?: boolean
  xLabel?: string
  yLabel?: string
  xDomain?: [number, number]
  yDomain?: [number, number]
  xScale?: 'linear' | 'log'
  yScale?: 'linear' | 'log'
  /** Tooltip lists every line / stem / bar layer at the nearest x. */
  hover?: boolean
  xFormat?: (v: number) => string
  yFormat?: (v: number) => string
  readout?: { label: string; value: ReactNode }[]
  note?: ReactNode
  title: string
  grid?: boolean
  /** Extra left / right margin (pixels), e.g. for a colour bar. */
  margin?: Partial<{ top: number; right: number; bottom: number; left: number }>
  /** Fixes the aspect so one x unit and one y unit have the same length. */
  equal?: boolean
  /** Makes the plot area itself square (centred). */
  square?: boolean
  onPick?: (x: number, y: number) => void
  extra?: (api: { x: (v: number) => number; y: (v: number) => number; iw: number; ih: number }) => ReactNode
  /** Domain padding fraction. */
  pad?: number
  /** Approximate number of x ticks. */
  xTicks?: number
  /** The x values are epoch milliseconds. */
  xDate?: boolean
  legend?: boolean
}

const finite = (v: number) => Number.isFinite(v)

export function XYPlot(p: XYProps) {
  const { layers, width, height, compact } = p
  const stage = useStage()
  const m = margins(compact, { ...(p.margin ?? {}) })
  if (p.note && !compact) m.bottom += 18
  let iw = Math.max(10, width - m.left - m.right), ih = Math.max(10, height - m.top - m.bottom)
  if (p.square) { const side = Math.min(iw, ih); m.left += (iw - side) / 2; iw = ih = side }
  const dom = useMemo(() => {
    const xs: number[] = [], ys: number[] = []
    for (const l of layers) {
      if (l.kind === 'line' || l.kind === 'stem') { xs.push(...l.x.filter(finite)); ys.push(...l.y.filter(finite)); if (l.kind === 'stem') ys.push(l.base ?? 0) }
      else if (l.kind === 'band') { xs.push(...l.x.filter(finite)); ys.push(...l.lo.filter(finite), ...l.hi.filter(finite)) }
      else if (l.kind === 'points') { for (const q of l.pts) { if (finite(q.x)) xs.push(q.x); if (finite(q.y)) ys.push(q.y) } }
      else if (l.kind === 'bars') { xs.push(...l.x.map((v) => v - l.w / 2), ...l.x.map((v) => v + l.w / 2)); ys.push(l.base ?? 0, ...l.y.filter(finite)) }
      else if (l.kind === 'raster') { xs.push(l.x0, l.x1); ys.push(l.y0, l.y1) }
    }
    return { xs, ys }
  }, [layers])
  const ext = (vals: number[], log: boolean, given?: [number, number]): [number, number] => {
    if (given) return given
    const v = log ? vals.filter((a) => a > 0) : vals
    if (!v.length) return log ? [1, 10] : [0, 1]
    let lo = Math.min(...v), hi = Math.max(...v)
    if (lo === hi) { if (log) { lo /= 2; hi *= 2 } else { lo -= 1; hi += 1 } }
    const pad = log ? 0 : (hi - lo) * (p.pad ?? 0.05)
    return [lo - pad, hi + pad]
  }
  let xd = ext(dom.xs, p.xScale === 'log', p.xDomain), yd = ext(dom.ys, p.yScale === 'log', p.yDomain)
  if (p.equal) {
    const cx = (xd[0] + xd[1]) / 2, cy = (yd[0] + yd[1]) / 2
    const k = Math.max((xd[1] - xd[0]) / iw, (yd[1] - yd[0]) / ih)
    xd = [cx - (k * iw) / 2, cx + (k * iw) / 2]; yd = [cy - (k * ih) / 2, cy + (k * ih) / 2]
  }
  const sx = (p.xScale === 'log' ? d3.scaleLog() : d3.scaleLinear()).domain(xd).range([0, iw]) as d3.ScaleLinear<number, number>
  const sy = (p.yScale === 'log' ? d3.scaleLog() : d3.scaleLinear()).domain(yd).range([ih, 0]) as d3.ScaleLinear<number, number>
  const X = (v: number) => sx(v), Y = (v: number) => sy(v)
  const clipId = useMemo(() => `xy${Math.random().toString(36).slice(2, 8)}`, [])
  const hoverLayers = layers.filter((l): l is Extract<Layer, { kind: 'line' | 'stem' | 'bars' }> => (l.kind === 'line' && !l.tip) || l.kind === 'stem' || l.kind === 'bars')
  const xsHover = useMemo(() => [...new Set(hoverLayers.flatMap((l) => l.x))].filter(finite).sort((a, b) => a - b), [hoverLayers])
  const guide = useRef<SVGLineElement>(null)
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (compact || !p.hover || !xsHover.length) return
    const l = localPoint(stage.svgRef.current!, e)
    const xv = sx.invert(l.x - m.left)
    if (xv < xd[0] || xv > xd[1]) { stage.hide(); guide.current?.setAttribute('visibility', 'hidden'); return }
    let best = xsHover[0]
    for (const v of xsHover) if (Math.abs(v - xv) < Math.abs(best - xv)) best = v
    guide.current?.setAttribute('x1', String(X(best))); guide.current?.setAttribute('x2', String(X(best))); guide.current?.setAttribute('visibility', 'visible')
    const yf = p.yFormat ?? fmt
    stage.at(e, (
      <>
        <b>{(p.xFormat ?? (p.xDate ? formatTime : fmt))(best)}</b>
        {hoverLayers.map((ly, i) => { const k = ly.x.findIndex((v) => v === best); return k < 0 || !finite(ly.y[k]) ? null : <div key={i}>{ly.label ?? `계열 ${i + 1}`}: {yf(ly.y[k])}</div> })}
      </>
    ))
  }
  const labelled = layers.filter((l) => 'label' in l && l.label && l.kind !== 'hline' && l.kind !== 'vline')
  const legendItems = labelled.map((l, i) => ({ key: (l as { label: string }).label, color: ((l as { color?: string | string[] }).color as string | undefined) ?? colorAt(i) }))
  return (
    <div className="chart-root">
      <svg ref={stage.svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={p.title} onPointerMove={onMove} onPointerLeave={() => { stage.hide(); guide.current?.setAttribute('visibility', 'hidden') }}
        onClick={p.onPick ? (e) => { const l = localPoint(stage.svgRef.current!, e); const x = l.x - m.left, y = l.y - m.top; if (x >= 0 && x <= iw && y >= 0 && y <= ih) p.onPick!(sx.invert(x), sy.invert(y)) } : undefined}>
        <defs><clipPath id={clipId}><rect x={-2} y={-2} width={iw + 4} height={ih + 4} /></clipPath></defs>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisBottom scale={sx} y={ih} grid={!compact && p.grid !== false ? ih : 0} label={p.xLabel} compact={compact} format={p.xFormat} ticks={p.xTicks} date={p.xDate} />
          <AxisLeft scale={sy} x={0} grid={!compact && p.grid !== false ? iw : 0} label={p.yLabel} compact={compact} format={p.yFormat} />
          <rect x={0} y={0} width={iw} height={ih} fill="none" stroke="#e5e7eb" />
          <g clipPath={`url(#${clipId})`}>
            {layers.map((l, i) => {
              const c = ('color' in l && typeof l.color === 'string' ? l.color : undefined) ?? colorAt(i)
              switch (l.kind) {
                case 'raster': {
                  const cw = (X(l.x1) - X(l.x0)) / l.nx, ch = (Y(l.y0) - Y(l.y1)) / l.ny
                  const cells: ReactNode[] = []
                  for (let r = 0; r < l.ny; r++) for (let q = 0; q < l.nx; q++) {
                    const v = l.z[r * l.nx + q]
                    if (!finite(v)) continue
                    cells.push(<rect key={r * l.nx + q} x={X(l.x0) + q * cw} y={Y(l.y0) - (r + 1) * ch} width={cw + 0.6} height={ch + 0.6} fill={l.color(v)} fillOpacity={l.opacity ?? 1} shapeRendering="crispEdges" />)
                  }
                  return <g key={i} data-testid="raster">{cells}</g>
                }
                case 'band': {
                  const pts = l.x.map((x, k) => [X(x), Y(l.hi[k])] as const).concat(l.x.map((x, k) => [X(x), Y(l.lo[k])] as const).reverse()).filter(([a, b]) => finite(a) && finite(b))
                  return pts.length ? <path key={i} d={`M${pts.map(([a, b]) => `${a},${b}`).join('L')}Z`} fill={c} fillOpacity={l.opacity ?? 0.18} stroke="none" /> : null
                }
                case 'line': {
                  const gen = d3.line<number>().defined((_, k) => finite(l.x[k]) && finite(l.y[k])).x((_, k) => X(l.x[k])).y((_, k) => Y(l.y[k])).curve(l.step ? d3.curveStepAfter : d3.curveLinear)
                  return <path key={i} data-testid="xy-line" d={gen(l.x.map((_, k) => k)) ?? ''} fill="none" stroke={c} strokeWidth={l.width ?? 2} strokeDasharray={l.dash} strokeLinejoin="round" strokeOpacity={l.opacity ?? 1}
                    onPointerMove={l.tip && !compact ? (e) => stage.at(e, l.tip) : undefined} style={l.tip ? { pointerEvents: 'stroke' } : undefined} />
                }
                case 'stem': {
                  const b = l.base ?? 0
                  return <g key={i} stroke={c}>{l.x.map((x, k) => finite(l.y[k]) && <g key={k}><line x1={X(x)} x2={X(x)} y1={Y(b)} y2={Y(l.y[k])} strokeWidth={compact ? 1 : 1.6} />{l.dot !== false && <circle cx={X(x)} cy={Y(l.y[k])} r={compact ? 1.5 : 3} fill={c} stroke="none" />}</g>)}</g>
                }
                case 'bars': {
                  const b = l.base ?? 0
                  return <g key={i}>{l.x.map((x, k) => finite(l.y[k]) && <rect key={k} data-testid="xy-bar" x={X(x - l.w / 2) + 0.5} width={Math.max(0.5, X(x + l.w / 2) - X(x - l.w / 2) - 1)} y={Math.min(Y(l.y[k]), Y(b))} height={Math.abs(Y(l.y[k]) - Y(b))} fill={Array.isArray(l.color) ? l.color[k] : c} fillOpacity={l.opacity ?? 0.85} />)}</g>
                }
                case 'hline': return <line key={i} x1={0} x2={iw} y1={Y(l.v)} y2={Y(l.v)} stroke={l.color ?? '#6b7280'} strokeDasharray={l.dash ?? '5 4'} strokeWidth={l.width ?? 1.2} />
                case 'vline': return <line key={i} x1={X(l.v)} x2={X(l.v)} y1={0} y2={ih} stroke={l.color ?? '#6b7280'} strokeDasharray={l.dash ?? '5 4'} strokeWidth={l.width ?? 1.2} />
                case 'text': return <text key={i} x={X(l.x)} y={Y(l.y)} fill={l.color ?? '#111827'} fontSize={l.size ?? 11} textAnchor={l.anchor ?? 'middle'}>{l.text}</text>
                case 'points': return (
                  <g key={i} fillOpacity={l.opacity ?? 0.85}>
                    {l.pts.map((q, k) => finite(q.x) && finite(q.y) && (
                      <circle key={q.key ?? k} data-testid="xy-point" cx={X(q.x)} cy={Y(q.y)} r={q.r ?? l.r ?? (compact ? 2 : 3.6)} fill={q.color ?? c} stroke={l.stroke ?? '#fff'} strokeWidth={l.stroke ? 1.8 : 0.6}
                        onPointerEnter={!compact && q.tip ? (e) => stage.at(e, q.tip) : undefined} />
                    ))}
                  </g>
                )
              }
            })}
            {p.extra?.({ x: X, y: Y, iw, ih })}
            {p.hover && !compact && <line ref={guide} y1={0} y2={ih} stroke="#9ca3af" strokeDasharray="3 3" visibility="hidden" pointerEvents="none" />}
          </g>
        </g>
      </svg>
      {!compact && p.legend !== false && legendItems.length > 1 && <Legend items={legendItems} />}
      <Tooltip tip={stage.tip} width={width} />
      {!compact && p.readout && <Readout items={p.readout} />}
      {!compact && p.note && <p className="chart-note" role="note" style={NOTE_STYLE}>{p.note}</p>}
    </div>
  )
}

export interface HeatProps {
  rows: string[]
  cols: string[]
  /** values[i][j]; non-finite cells are left empty. */
  values: number[][]
  width: number
  height: number
  compact?: boolean
  title: string
  color: (v: number) => string
  text?: (v: number, i: number, j: number) => string
  tip?: (i: number, j: number, v: number) => ReactNode
  rowTitle?: string
  colTitle?: string
  /** Highlights a cell, e.g. the argmax. */
  mark?: (i: number, j: number) => boolean
  onCell?: (i: number, j: number) => void
  selected?: [number, number] | null
  readout?: { label: string; value: ReactNode }[]
  note?: ReactNode
  /** Square cells (confusion matrix); otherwise the grid fills the plot area. */
  square?: boolean
  /** Show every n-th label (large matrices). */
  labelEvery?: number
  extra?: (api: { cx: (j: number) => number; cy: (i: number) => number; cw: number; ch: number }) => ReactNode
  rightPad?: number
  bottomPad?: number
}

export function HeatGrid(p: HeatProps) {
  const stage = useStage()
  const { rows, cols, values, width, height, compact } = p
  const n = rows.length, m = cols.length
  const maxRow = Math.max(0, ...rows.map((r) => r.length)), maxCol = Math.max(0, ...cols.map((r) => r.length))
  const every = p.labelEvery ?? 1
  const cw0 = (width - (compact ? 12 : 140)) / Math.max(1, m)
  const left = compact ? 6 : Math.min(120, 22 + Math.min(10, maxRow) * 7.2) + (p.rowTitle ? 14 : 0)
  const top = compact ? 6 : 52 + (maxCol >= 2 && m > 6 && cw0 < maxCol * 10.5 + 4 ? Math.min(70, maxCol * 8) : 0)
  const aw = Math.max(20, width - left - (compact ? 6 : p.rightPad ?? 24)), ah = Math.max(20, height - top - (compact ? 6 : p.bottomPad ?? 30))
  let cw = aw / Math.max(1, m), ch = ah / Math.max(1, n)
  if (p.square) { cw = ch = Math.min(cw, ch) }
  const rotate = !compact && cw < maxCol * 10.5 + 4
  return (
    <div className="chart-root">
      <svg ref={stage.svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={p.title} onPointerLeave={stage.hide}>
        <g transform={`translate(${left},${top})`}>
          {values.map((row, i) => row.map((v, j) => {
            if (!Number.isFinite(v)) return null
            const sel = p.selected && p.selected[0] === i && p.selected[1] === j
            const cell = p.text ? p.text(v, i, j) : ''
            return (
              <g key={`${i}-${j}`} data-testid="heat-cell" data-v={v} onPointerEnter={compact ? undefined : (e) => stage.at(e, p.tip ? p.tip(i, j, v) : <><b>{rows[i]} × {cols[j]}</b><br />{fmt(v, 3)}</>)} onClick={p.onCell && !compact ? () => p.onCell!(i, j) : undefined} style={p.onCell ? { cursor: 'pointer' } : undefined}>
                <rect x={j * cw} y={i * ch} width={Math.max(0.5, cw - (cw > 14 ? 1 : 0))} height={Math.max(0.5, ch - (ch > 14 ? 1 : 0))} fill={p.color(v)} stroke={sel ? '#111827' : p.mark?.(i, j) ? '#111827' : 'none'} strokeWidth={sel ? 2.4 : 1.4} />
                {!compact && cell && cw > 26 && ch > 14 && <text x={j * cw + cw / 2} y={i * ch + ch / 2} dy="0.34em" textAnchor="middle" fontSize={Math.min(13, cw / 3.2)} fill={d3.hsl(p.color(v)).l > 0.55 ? '#111827' : '#fff'} pointerEvents="none">{cell}</text>}
              </g>
            )
          }))}
          {p.extra?.({ cx: (j) => j * cw + cw / 2, cy: (i) => i * ch + ch / 2, cw, ch })}
          {!compact && rows.map((r, i) => i % every === 0 && <text key={`r${i}`} x={-6} y={i * ch + ch / 2} dy="0.34em" textAnchor="end" fontSize={ch < 12 ? 9 : 11} fill="#374151">{r.length > 11 ? `${r.slice(0, 10)}…` : r}</text>)}
          {!compact && cols.map((c, j) => j % every === 0 && (
            <text key={`c${j}`} fontSize={cw < 12 ? 9 : 11} fill="#374151" textAnchor={rotate ? 'start' : 'middle'} transform={`translate(${j * cw + cw / 2},-6) ${rotate ? 'rotate(-40)' : ''}`}>{c.length > 11 ? `${c.slice(0, 10)}…` : c}</text>
          ))}
          {!compact && p.colTitle && <text x={(m * cw) / 2} y={n * ch + 20} textAnchor="middle" className="axis-label" fill="#6b7280" fontSize={12}>{p.colTitle}</text>}
          {!compact && p.rowTitle && <text transform={`translate(${-left + 12},${(n * ch) / 2}) rotate(-90)`} textAnchor="middle" className="axis-label" fill="#6b7280" fontSize={12}>{p.rowTitle}</text>}
        </g>
      </svg>
      <Tooltip tip={stage.tip} width={width} />
      {!compact && p.readout && <Readout items={p.readout} />}
      {!compact && p.note && <p className="chart-note" role="note" style={NOTE_STYLE}>{p.note}</p>}
    </div>
  )
}

/** Equal-width bin edges helper for histogram-like charts. */
export const linspace = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => (n === 1 ? a : a + ((b - a) * i) / (n - 1)))

export const nums = (v: readonly (number | null)[]) => v.filter((x): x is number => x != null && Number.isFinite(x))

/** Vertically stacked panels that share one chart area; each child gets its pixel height. */
export function Panels({ width, height, parts, children }: { width: number; height: number; parts: number[]; children: ((h: number) => ReactNode)[] }) {
  const total = parts.reduce((a, b) => a + b, 0)
  let used = 0
  return (
    <div style={{ width, height }} data-testid="panels">
      {children.map((render, i) => {
        const h = i === children.length - 1 ? height - used : Math.floor((height * parts[i]) / total)
        used += h
        return <div key={i} style={{ height: h, position: 'relative' }}>{render(h)}</div>
      })}
    </div>
  )
}
