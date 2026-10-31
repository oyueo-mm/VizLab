import { useEffect, useRef, type RefObject } from 'react'

/**
 * A tiny 3D toolkit (no WebGL): an orbit camera, projection to the screen and a painter's-algorithm quad renderer for canvas.
 * World axes: x east/right, y north/away, z up. The camera sits south of the scene at elevation `pitch` and turns by `yaw` about the vertical.
 */

export interface View3 { yaw: number; pitch: number; zoom: number }
export type V3 = [number, number, number]

export const DEFAULT_VIEW: View3 = { yaw: -30, pitch: 38, zoom: 1 }

const RAD = Math.PI / 180

export interface Projector { (p: V3): { x: number; y: number; depth: number } }

/** Orthographic projection of the unit-ish cube [-1, 1]³ into a width × height box. Larger `depth` is farther from the camera. */
export function makeProjector(view: View3, width: number, height: number, fit = 0.46): Projector {
  const yaw = view.yaw * RAD, e = view.pitch * RAD
  const cy = Math.cos(yaw), sy = Math.sin(yaw), ce = Math.cos(e), se = Math.sin(e)
  const s = Math.min(width, height) * fit * view.zoom
  const cx = width / 2, cyy = height / 2 + height * 0.04
  return (p) => {
    const x1 = p[0] * cy - p[1] * sy, y1 = p[0] * sy + p[1] * cy
    return { x: cx + x1 * s, y: cyy - (y1 * se + p[2] * ce) * s, depth: y1 * ce - p[2] * se }
  }
}

export interface Quad { pts: [number, number][]; depth: number; fill: string; stroke?: string }

/** Draws filled polygons far to near (painter's algorithm). */
export function drawQuads(ctx: CanvasRenderingContext2D, quads: Quad[], lineWidth = 0.5) {
  quads.sort((a, b) => b.depth - a.depth)
  ctx.lineWidth = lineWidth
  ctx.lineJoin = 'round'
  for (const q of quads) {
    ctx.beginPath()
    ctx.moveTo(q.pts[0][0], q.pts[0][1])
    for (let i = 1; i < q.pts.length; i++) ctx.lineTo(q.pts[i][0], q.pts[i][1])
    ctx.closePath()
    ctx.fillStyle = q.fill
    ctx.fill()
    if (q.stroke) { ctx.strokeStyle = q.stroke; ctx.stroke() }
  }
}

/** Unit normal of the triangle (a, b, c). */
export function normal(a: V3, b: V3, c: V3): V3 {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  const l = Math.hypot(...n) || 1
  return [n[0] / l, n[1] / l, n[2] / l]
}

/** Orbit camera controls: drag to turn, wheel to zoom, arrow keys to nudge. The element must be focusable for keys. */
export function useOrbit(ref: RefObject<Element | null>, view: View3, setView: (v: Partial<View3>) => void, enabled = true) {
  const state = useRef({ view, setView })
  state.current = { view, setView }
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    let drag: { x: number; y: number; yaw: number; pitch: number } | null = null
    const down = (e: Event) => {
      const pe = e as PointerEvent
      if (pe.button) return
      drag = { x: pe.clientX, y: pe.clientY, yaw: state.current.view.yaw, pitch: state.current.view.pitch }
      ;(el as Element).setPointerCapture?.(pe.pointerId)
    }
    const move = (e: Event) => {
      const pe = e as PointerEvent
      if (!drag) return
      state.current.setView({ yaw: Math.round(drag.yaw + (pe.clientX - drag.x) * 0.5), pitch: Math.round(Math.max(5, Math.min(89, drag.pitch + (pe.clientY - drag.y) * 0.4))) })
    }
    const up = () => { drag = null }
    const wheel = (e: Event) => {
      const we = e as WheelEvent
      we.preventDefault()
      state.current.setView({ zoom: Math.max(0.4, Math.min(4, +(state.current.view.zoom * (we.deltaY < 0 ? 1.1 : 1 / 1.1)).toFixed(3))) })
    }
    const key = (e: Event) => {
      const ke = e as KeyboardEvent
      const v = state.current.view
      if (ke.key === 'ArrowLeft') state.current.setView({ yaw: v.yaw - 8 })
      else if (ke.key === 'ArrowRight') state.current.setView({ yaw: v.yaw + 8 })
      else if (ke.key === 'ArrowUp') state.current.setView({ pitch: Math.min(89, v.pitch + 6) })
      else if (ke.key === 'ArrowDown') state.current.setView({ pitch: Math.max(5, v.pitch - 6) })
      else if (ke.key === '+' || ke.key === '=') state.current.setView({ zoom: Math.min(4, +(v.zoom * 1.15).toFixed(3)) })
      else if (ke.key === '-') state.current.setView({ zoom: Math.max(0.4, +(v.zoom / 1.15).toFixed(3)) })
      else return
      ke.preventDefault()
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('keydown', key)
    return () => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up); el.removeEventListener('wheel', wheel); el.removeEventListener('keydown', key)
    }
  }, [ref, enabled])
}

/** The 12 edges of the cube [x0,x1]×[y0,y1]×[z0,z1] as pairs of corners. */
export function boxEdges(b: { x: [number, number]; y: [number, number]; z: [number, number] }): [V3, V3][] {
  const c = (i: number, j: number, k: number): V3 => [b.x[i], b.y[j], b.z[k]]
  const out: [V3, V3][] = []
  for (const [a, bb] of [[0, 1]] as const) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) out.push([c(a, j, k), c(bb, j, k)])
  for (let i = 0; i < 2; i++) for (let k = 0; k < 2; k++) out.push([c(i, 0, k), c(i, 1, k)])
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) out.push([c(i, j, 0), c(i, j, 1)])
  return out
}

/** Which of the 12 box edges are behind the scene (drawn light) — an edge is "back" when it lies in the farther half of the cube. */
export function isBackEdge(proj: Projector, a: V3, b: V3, centre: number): boolean {
  return (proj(a).depth + proj(b).depth) / 2 > centre
}

export const view3Defaults = (v: Partial<View3> = {}): View3 => ({ ...DEFAULT_VIEW, ...v })

/** Buttons-free helper: the view patch for `reset`. */
export const RESET_VIEW: View3 = { ...DEFAULT_VIEW }
