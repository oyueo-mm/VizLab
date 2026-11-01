import * as d3 from 'd3'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { AxisBottom, AxisLeft, Readout, Tooltip, localPoint, margins } from '../../components/chart/primitives'
import { useStage } from './kit'

/** A canvas-rendered image of a function over a pannable, zoomable region of the plane with SVG axes on top. */

export interface PlaneView { cx: number; cy: number; span: number }

export interface PlaneProps {
  width: number
  height: number
  compact?: boolean
  view: PlaneView
  setView: (v: Partial<PlaneView>) => void
  /** Colour of the point (x, y) as [r, g, b]. */
  pixel: (x: number, y: number) => [number, number, number]
  /** Changing this string re-renders the image (everything `pixel` depends on besides the view). */
  version: string
  /** Rendering scale of the canvas relative to the screen (1 = one sample per pixel). */
  resolution?: number
  info?: (x: number, y: number) => ReactNode
  title: string
  xLabel?: string
  yLabel?: string
  readout?: { label: string; value: ReactNode }[]
  note?: ReactNode
  /** SVG drawn in plot coordinates above the image. */
  overlay?: (api: { x: (v: number) => number; y: (v: number) => number; iw: number; ih: number }) => ReactNode
  onClickAt?: (x: number, y: number) => void
  extra?: ReactNode
  /** Zoom limits for `span`. */
  minSpan?: number
  maxSpan?: number
}

export function Plane(p: PlaneProps) {
  const { width, height, compact, view } = p
  const stage = useStage()
  const canvas = useRef<HTMLCanvasElement>(null)
  const m = margins(compact, { right: compact ? 8 : 16 })
  if (p.note && !compact) m.bottom += 18
  const iw = Math.max(40, width - m.left - m.right), ih = Math.max(40, height - m.top - m.bottom)
  const hx = view.span / 2, hy = (hx * ih) / iw
  const sx = useMemo(() => d3.scaleLinear().domain([view.cx - hx, view.cx + hx]).range([0, iw]), [view.cx, hx, iw])
  const sy = useMemo(() => d3.scaleLinear().domain([view.cy - hy, view.cy + hy]).range([ih, 0]), [view.cy, hy, ih])
  const res = compact ? 0.35 : p.resolution ?? 0.6
  const pixelRef = useRef(p.pixel)
  pixelRef.current = p.pixel
  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    const w = Math.max(8, Math.round(iw * res)), h = Math.max(8, Math.round(ih * res))
    cv.width = w; cv.height = h
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const img = ctx.createImageData(w, h)
    const fn = pixelRef.current
    for (let j = 0; j < h; j++) {
      const y = view.cy + hy - ((j + 0.5) / h) * 2 * hy
      for (let i = 0; i < w; i++) {
        const [r, g, b] = fn(view.cx - hx + ((i + 0.5) / w) * 2 * hx, y)
        const o = (j * w + i) * 4
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [iw, ih, view.cx, view.cy, view.span, res, p.version]) // eslint-disable-line react-hooks/exhaustive-deps

  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null)
  const live = useRef({ view, set: p.setView, iw, ih, minSpan: p.minSpan ?? 1e-12, maxSpan: p.maxSpan ?? 50 })
  live.current = { view, set: p.setView, iw, ih, minSpan: p.minSpan ?? 1e-12, maxSpan: p.maxSpan ?? 50 }
  const rect = useRef<SVGRectElement>(null)
  useEffect(() => {
    const el = rect.current
    if (!el || compact) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const { view: v, set, iw: w, ih: h, minSpan, maxSpan } = live.current
      const r = el.getBoundingClientRect()
      const fx = (e.clientX - r.left) / w, fy = (e.clientY - r.top) / h
      const k = e.deltaY < 0 ? 0.8 : 1.25
      const span = Math.min(maxSpan, Math.max(minSpan, v.span * k))
      // keep the point under the cursor fixed
      const px = v.cx - v.span / 2 + fx * v.span, py = v.cy + (v.span * h) / w / 2 - fy * (v.span * h) / w
      set({ span, cx: px - (fx - 0.5) * span, cy: py + (fy - 0.5) * ((span * h) / w) })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [compact])
  const toPlane = (e: { clientX: number; clientY: number }) => { const l = localPoint(stage.svgRef.current!, e); return { x: sx.invert(l.x - m.left), y: sy.invert(l.y - m.top) } }
  return (
    <div className="chart-root" data-testid="plane-root">
      <canvas ref={canvas} data-testid="plane-canvas" style={{ position: 'absolute', left: m.left, top: m.top, width: iw, height: ih, imageRendering: 'auto' }} aria-hidden="true" />
      <svg ref={stage.svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={p.title} style={{ position: 'relative', zIndex: 1 }} onPointerLeave={stage.hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisBottom scale={sx} y={ih} label={p.xLabel ?? '실수부'} compact={compact} ticks={7} />
          <AxisLeft scale={sy} x={0} label={p.yLabel ?? '허수부'} compact={compact} ticks={6} />
          <rect x={0} y={0} width={iw} height={ih} fill="none" stroke="#9ca3af" />
          {p.overlay?.({ x: sx, y: sy, iw, ih })}
          <rect ref={rect} data-testid="plane-hit" x={0} y={0} width={iw} height={ih} fill="transparent" style={{ cursor: compact ? undefined : 'grab', touchAction: 'none' }}
            onPointerDown={compact ? undefined : (e) => { (e.target as Element).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, moved: false }; stage.hide() }}
            onPointerMove={compact ? undefined : (e) => {
              const d = drag.current
              if (d) { const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true; if (d.moved) p.setView({ cx: d.cx - (dx / iw) * view.span, cy: d.cy + (dy / iw) * view.span }); return }
              if (p.info) { const q = toPlane(e); stage.at(e, p.info(q.x, q.y)) }
            }}
            onPointerUp={compact ? undefined : (e) => { const d = drag.current; drag.current = null; if (d && !d.moved && p.onClickAt) { const q = toPlane(e); p.onClickAt(q.x, q.y) } }} />
        </g>
      </svg>
      {p.extra}
      <Tooltip tip={stage.tip} width={width} />
      {!compact && p.readout && <Readout items={p.readout} />}
      {!compact && p.note && <p className="chart-note" role="note" style={{ left: 'auto', right: 8, bottom: 2, maxWidth: '58%', textAlign: 'right' }}>{p.note}</p>}
    </div>
  )
}

/** 256-entry colour lookup table for an escape-time palette. */
export function lut(interp: (t: number) => string): [number, number, number][] {
  return Array.from({ length: 256 }, (_, i) => { const c = d3.rgb(interp(i / 255)); return [c.r, c.g, c.b] as [number, number, number] })
}

export const PALETTES: Record<string, { name: string; interp: (t: number) => string }> = {
  fire: { name: '불꽃', interp: d3.interpolateInferno },
  ocean: { name: '바다', interp: d3.interpolateYlGnBu },
  rainbow: { name: '무지개', interp: (t) => d3.interpolateRainbow((t * 0.85 + 0.05) % 1) },
  viridis: { name: '비리디스', interp: d3.interpolateViridis },
  mono: { name: '흑백', interp: (t) => d3.interpolateGreys(1 - t) },
}
