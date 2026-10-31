import * as d3 from 'd3'
import type { Mark } from './heroFrames'

const SVG = 'http://www.w3.org/2000/svg'

/** Numeric and color fields interpolated for each mark type. */
const NUM: Record<Mark['t'], string[]> = {
  rect: ['x', 'y', 'w', 'h', 'r', 'sw', 'o'], circle: ['x', 'y', 'r', 'o'], line: ['x1', 'y1', 'x2', 'y2', 'sw', 'o'],
  poly: ['fo', 'so', 'sw', 'o'], band: ['fo', 'so', 'sw', 'o'], arc: ['cx', 'cy', 'a0', 'a1', 'r0', 'r1', 'o'],
  link: ['x0', 'y0', 'x1', 'y1', 'w', 'o'], text: ['x', 'y', 'o'],
}
const COLOR: Record<Mark['t'], string[]> = {
  rect: ['fill', 'stroke'], circle: ['fill'], line: ['stroke'], poly: ['fill', 'stroke'], band: ['fill', 'stroke'], arc: ['fill', 'stroke'], link: ['stroke'], text: ['fill'],
}

type Rec = Record<string, any>

function create(m: Mark): SVGElement {
  const tag = { rect: 'rect', circle: 'circle', line: 'line', poly: 'path', arc: 'path', link: 'path', text: 'text', band: 'g' }[m.t]
  const el = document.createElementNS(SVG, tag)
  if (m.t === 'band') { el.appendChild(document.createElementNS(SVG, 'path')); el.appendChild(document.createElementNS(SVG, 'path')) }
  if (m.t === 'link') el.setAttribute('fill', 'none')
  if (m.t === 'text') { el.setAttribute('text-anchor', m.anchor); el.textContent = m.text }
  return el
}

const curve = d3.curveMonotoneX
const polyLine = d3.line()
const bandArea = d3.area<[number, number, number]>().curve(curve).x((d) => d[0]).y0((d) => d[1]).y1((d) => d[2])
const bandTop = d3.line<[number, number, number]>().curve(curve).x((d) => d[0]).y((d) => d[2])
const arcGen = d3.arc<Rec>().startAngle((d) => d.a0).endAngle((d) => d.a1).innerRadius((d) => Math.max(0, d.r0)).outerRadius((d) => Math.max(0, d.r1))

/** Writes one (possibly mid-transition) mark state into its element. */
function apply(el: SVGElement, m: Rec) {
  const set = (name: string, v: string | number) => el.setAttribute(name, typeof v === 'number' ? (Math.round(v * 100) / 100).toString() : v)
  switch (m.t as Mark['t']) {
    case 'rect': set('x', m.x); set('y', m.y); set('width', Math.max(0, m.w)); set('height', Math.max(0, m.h)); set('rx', m.r); set('fill', m.fill); set('stroke', m.stroke); set('stroke-width', m.sw); break
    case 'circle': set('cx', m.x); set('cy', m.y); set('r', Math.max(0, m.r)); set('fill', m.fill); break
    case 'line': set('x1', m.x1); set('y1', m.y1); set('x2', m.x2); set('y2', m.y2); set('stroke', m.stroke); set('stroke-width', m.sw); break
    case 'poly': {
      const d = polyLine(m.pts) ?? ''
      set('d', m.closed ? `${d}Z` : d); set('fill', m.fill); set('fill-opacity', m.fo); set('stroke', m.stroke); set('stroke-opacity', m.so); set('stroke-width', m.sw); set('stroke-linejoin', 'round')
      break
    }
    case 'band': {
      const [fillPath, linePath] = Array.from(el.children) as SVGElement[]
      fillPath.setAttribute('d', bandArea(m.pts) ?? ''); fillPath.setAttribute('fill', m.fill); fillPath.setAttribute('fill-opacity', String(m.fo)); fillPath.setAttribute('stroke', 'none')
      linePath.setAttribute('d', bandTop(m.pts) ?? ''); linePath.setAttribute('fill', 'none'); linePath.setAttribute('stroke', m.stroke); linePath.setAttribute('stroke-opacity', String(m.so)); linePath.setAttribute('stroke-width', String(m.sw)); linePath.setAttribute('stroke-linejoin', 'round')
      break
    }
    case 'arc': set('d', arcGen(m) ?? ''); set('transform', `translate(${m.cx},${m.cy})`); set('fill', m.fill); set('stroke', m.stroke); set('stroke-width', 0.8); break
    case 'link': {
      const mx = (m.x0 + m.x1) / 2
      set('d', `M${m.x0},${m.y0}C${mx},${m.y0} ${mx},${m.y1} ${m.x1},${m.y1}`); set('stroke', m.stroke); set('stroke-width', Math.max(0, m.w)); break
    }
    case 'text': set('x', m.x); set('y', m.y); set('fill', m.fill); break
  }
  el.setAttribute('opacity', String(Math.max(0, Math.min(1, m.o))))
}

interface Entry {
  el: SVGElement
  from: Rec
  to: Rec
  exiting: boolean
  /** Fraction of the transition each mark waits (stagger by horizontal position). */
  delay: number
  colors: Record<string, (t: number) => string>
}

/**
 * Imperative mark animator. Marks with the same key morph between frames; new marks fade/grow in and
 * missing ones fade out. Nothing runs between transitions, so an idle chart costs no CPU.
 */
export class MarkEngine {
  private entries = new Map<string, Entry>()
  private raf = 0
  private start = 0
  private duration = 0
  private width = 1
  /** The state currently on screen (kept per key so an interrupted transition continues from where it is). */
  private shown = new Map<string, Rec>()

  constructor(private root: SVGGElement) {}

  get count() { return this.entries.size }

  setFrame(frame: Mark[], duration: number, width: number) {
    cancelAnimationFrame(this.raf)
    this.width = Math.max(1, width)
    const next = new Set<string>()
    for (const m of frame) {
      next.add(m.k)
      const to = { ...m } as Rec
      delete to.from
      let e = this.entries.get(m.k)
      if (!e) {
        const el = create(m)
        this.root.appendChild(el)
        const from = { ...m, o: 0, ...(m.from ?? {}) } as Rec
        delete from.from
        e = { el, from, to, exiting: false, delay: 0, colors: {} }
        this.entries.set(m.k, e)
        apply(el, from)
        this.shown.set(m.k, from)
      } else {
        e.from = { ...this.shown.get(m.k)! }
        e.to = to
        e.exiting = false
        // text content of a persistent key follows its latest label
        if (m.t === 'text' && e.el.textContent !== m.text) e.el.textContent = m.text
        if (m.t === 'text') e.el.setAttribute('text-anchor', m.anchor)
      }
      e.colors = {}
      for (const f of COLOR[m.t]) e.colors[f] = d3.interpolateRgb(e.from[f] ?? to[f], to[f])
      const x = typeof to.x === 'number' ? to.x : typeof to.x0 === 'number' ? to.x0 : typeof to.cx === 'number' ? to.cx : 0
      e.delay = m.t === 'circle' ? Math.max(0, Math.min(1, x / this.width)) * 0.3 : 0
    }
    for (const [k, e] of this.entries) {
      if (next.has(k)) continue
      e.from = { ...this.shown.get(k)! }
      e.to = { ...e.from, o: 0 }
      e.exiting = true
      e.delay = 0
      e.colors = {}
    }
    if (duration <= 0) { this.draw(1); this.finish(); return }
    this.duration = duration
    this.start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - this.start) / this.duration)
      this.draw(t)
      if (t < 1) this.raf = requestAnimationFrame(tick)
      else this.finish()
    }
    this.raf = requestAnimationFrame(tick)
  }

  private draw(t: number) {
    for (const [k, e] of this.entries) {
      const local = Math.max(0, Math.min(1, (t - e.delay) / (1 - e.delay || 1)))
      const p = d3.easeCubicInOut(local)
      const cur: Rec = { ...e.to }
      for (const f of NUM[e.to.t as Mark['t']]) {
        const a = e.from[f] ?? e.to[f]
        cur[f] = a + (e.to[f] - a) * p
      }
      for (const f of COLOR[e.to.t as Mark['t']]) cur[f] = e.colors[f]?.(p) ?? e.to[f]
      if (Array.isArray(e.to.pts)) {
        const a = e.from.pts
        cur.pts = a && a.length === e.to.pts.length ? e.to.pts.map((q: number[], i: number) => q.map((v, j) => a[i][j] + (v - a[i][j]) * p)) : e.to.pts
      }
      if (e.to.t === 'arc') cur.a1 = Math.max(cur.a0, cur.a1)
      this.shown.set(k, cur)
      apply(e.el, cur)
    }
  }

  /** Jumps to the end state and drops marks that finished fading out. */
  finish() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    for (const [k, e] of this.entries) {
      if (e.exiting) { e.el.remove(); this.entries.delete(k); this.shown.delete(k); continue }
      this.shown.set(k, { ...e.to })
      apply(e.el, e.to)
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    this.entries.clear()
    this.shown.clear()
    this.root.replaceChildren()
  }
}
