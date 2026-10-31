import type { ScaleBand, ScaleLinear } from 'd3'
import { useState, type ReactNode } from 'react'
import { tick as tickFormat } from '../../lib/format'
import { dateTickFormat, dateTicks } from '../../stats/datetime'

export interface Margin { top: number; right: number; bottom: number; left: number }

/** Plot margins that leave room for axes and titles; compact thumbnails get a thin frame. */
export function margins(compact: boolean | undefined, extra: Partial<Margin> = {}): Margin {
  const m = compact ? { top: 8, right: 8, bottom: 10, left: 10 } : { top: 40, right: 24, bottom: 52, left: 62 }
  return { ...m, ...extra }
}

type Linear = ScaleLinear<number, number>

interface AxisProps {
  scale: Linear
  /** Pixel length of the perpendicular gridlines; 0 hides them. */
  grid?: number
  ticks?: number
  label?: string
  format?: (v: number) => string
  compact?: boolean
  /** The domain is epoch milliseconds: ticks fall on calendar boundaries and labels are dates. */
  date?: boolean
}

export function AxisBottom({ scale, grid = 0, ticks = 6, label, format: customFormat, compact, y, date }: AxisProps & { y: number }) {
  const [r0, r1] = scale.range()
  const [d0, d1] = scale.domain()
  const count = compact ? 3 : ticks
  const values = date ? dateTicks(d0, d1, count) : scale.ticks(count)
  const format = customFormat ?? (date ? dateTickFormat(d0, d1, count) : tickFormat)
  return (
    <g transform={`translate(0,${y})`} className="axis" aria-hidden="true">
      {grid > 0 && values.map((v) => <line key={`g${v}`} className="grid" x1={scale(v)} x2={scale(v)} y1={0} y2={-grid} />)}
      {!compact && <line className="domain" x1={r0} x2={r1} />}
      {!compact && values.map((v) => (
        <g key={v} transform={`translate(${scale(v)},0)`}>
          <line y2={5} />
          <text y={18} textAnchor="middle">{format(v)}</text>
        </g>
      ))}
      {label && !compact && <text className="axis-label" x={(r0 + r1) / 2} y={42} textAnchor="middle">{label}</text>}
    </g>
  )
}

export function AxisLeft({ scale, grid = 0, ticks = 6, label, format = tickFormat, compact, x }: AxisProps & { x: number }) {
  const [r0, r1] = scale.range()
  const values = scale.ticks(compact ? 3 : ticks)
  return (
    <g transform={`translate(${x},0)`} className="axis" aria-hidden="true">
      {grid > 0 && values.map((v) => <line key={`g${v}`} className="grid" x1={0} x2={grid} y1={scale(v)} y2={scale(v)} />)}
      {!compact && <line className="domain" y1={r0} y2={r1} />}
      {!compact && values.map((v) => (
        <g key={v} transform={`translate(0,${scale(v)})`}>
          <line x2={-5} />
          <text x={-9} dy="0.32em" textAnchor="end">{format(v)}</text>
        </g>
      ))}
      {label && !compact && <text className="axis-label" transform={`translate(${-46},${(r0 + r1) / 2}) rotate(-90)`} textAnchor="middle">{label}</text>}
    </g>
  )
}

/** Category axis for band scales (horizontal or vertical). */
export function BandAxis({ scale, orient, offset, label, compact, maxChars = 10 }: { scale: ScaleBand<string>; orient: 'bottom' | 'left'; offset: number; label?: string; compact?: boolean; maxChars?: number }) {
  if (compact) return null
  const [r0, r1] = scale.range()
  const bw = scale.bandwidth()
  const short = (s: string) => (s.length > maxChars ? `${s.slice(0, maxChars - 1)}…` : s)
  if (orient === 'bottom') {
    const rotate = scale.domain().length > 0 && bw < 46
    return (
      <g transform={`translate(0,${offset})`} className="axis" aria-hidden="true">
        <line className="domain" x1={r0} x2={r1} />
        {scale.domain().map((d) => (
          <text key={d} x={(scale(d) ?? 0) + bw / 2} y={rotate ? 10 : 18} textAnchor={rotate ? 'end' : 'middle'} transform={rotate ? `rotate(-35 ${(scale(d) ?? 0) + bw / 2} 10)` : undefined}>
            <title>{d}</title>{short(d)}
          </text>
        ))}
        {label && <text className="axis-label" x={(r0 + r1) / 2} y={44} textAnchor="middle">{label}</text>}
      </g>
    )
  }
  return (
    <g transform={`translate(${offset},0)`} className="axis" aria-hidden="true">
      <line className="domain" y1={r0} y2={r1} />
      {scale.domain().map((d) => (
        <text key={d} x={-8} y={(scale(d) ?? 0) + bw / 2} dy="0.32em" textAnchor="end"><title>{d}</title>{short(d)}</text>
      ))}
      {label && <text className="axis-label" transform={`translate(${-54},${(r0 + r1) / 2}) rotate(-90)`} textAnchor="middle">{label}</text>}
    </g>
  )
}

export interface TipState { x: number; y: number; content: ReactNode }

/** Tooltip positioned inside the chart container (which must be position: relative). */
export function useTooltip() {
  const [tip, setTip] = useState<TipState | null>(null)
  const show = (x: number, y: number, content: ReactNode) => setTip({ x, y, content })
  const hide = () => setTip(null)
  return { tip, show, hide }
}

export function Tooltip({ tip, width }: { tip: TipState | null; width: number }) {
  if (!tip) return null
  const left = tip.x > width - 190
  return (
    <div className="chart-tooltip" role="status" style={{ left: tip.x, top: tip.y, transform: `translate(${left ? 'calc(-100% - 12px)' : '12px'}, -50%)` }}>
      {tip.content}
    </div>
  )
}

/** Legend with optional toggling of series visibility. */
export function Legend({ items, hidden, onToggle, title }: { items: { key: string; color: string }[]; hidden?: readonly string[]; onToggle?: (key: string) => void; title?: string }) {
  if (!items.length) return null
  return (
    <div className="chart-legend" aria-label={title ?? '범례'}>
      {title && <span className="legend-title">{title}</span>}
      {items.map((it) => {
        const off = hidden?.includes(it.key)
        const swatch = <span className="legend-swatch" style={{ background: off ? 'transparent' : it.color, borderColor: it.color }} />
        return onToggle ? (
          <button key={it.key} type="button" className={`legend-item ${off ? 'is-off' : ''}`} aria-pressed={!off} onClick={() => onToggle(it.key)} title={off ? '다시 표시' : '숨기기'}>
            {swatch}{it.key}
          </button>
        ) : (
          <span key={it.key} className="legend-item">{swatch}{it.key}</span>
        )
      })}
    </div>
  )
}

/** Shown inside the chart area when the data cannot be drawn. */
export function ChartMessage({ children }: { children: ReactNode }) {
  return <div className="chart-message" role="alert">{children}</div>
}

/** Pointer position relative to an element's top-left corner. */
export function localPoint(el: Element, e: { clientX: number; clientY: number }) {
  const r = el.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

export function toggleIn(list: readonly string[], key: string) {
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key]
}

/** Readout row rendered over the chart's top-right corner. */
export function Readout({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="chart-readout">
      {items.map((it) => (
        <div key={it.label}><dt>{it.label}</dt><dd>{it.value}</dd></div>
      ))}
    </dl>
  )
}

let svgIdCounter = 0
/** Stable, URL-safe id for SVG defs (clip paths, gradients) referenced through url(#id). */
export function useSvgId(prefix: string) {
  const [id] = useState(() => `${prefix}-${++svgIdCounter}`)
  return id
}
