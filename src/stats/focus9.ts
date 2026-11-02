// ───────────────────────────── Perspective Wall and Bifocal Display ─────────────────────────────

export type FocusMode = 'wall' | 'bifocal'
export interface FocusSpec {
  mode: FocusMode
  /** data interval shown */
  lo: number
  hi: number
  /** data coordinate in the middle of the flat (detail) panel */
  focus: number
  /** half width of the detail panel in data units */
  half: number
  /** screen width in pixels */
  width: number
  /** share of the screen taken by the detail panel (0.2 … 0.8) */
  panel: number
  /** wall only: fold angle of the side panels in degrees (0 = flat) */
  angle: number
}

export interface FocusMap { sx: number; /** vertical scale at this position (1 in the detail panel, smaller in the context) */ scale: number }

/** Geometry of the wall: eye distance chosen so that the side panels' vanishing limit leaves a margin beyond the screen edge. */
function wallGeometry(s: FocusSpec) {
  const half = Math.max(1e-9, s.half)
  const hk = (s.panel * s.width) / 2 // detail panel half width in pixels
  const k = hk / half // pixels per data unit in the detail panel
  const sideRoom = s.width / 2 - hk
  const rad = (Math.min(80, Math.max(0, s.angle)) * Math.PI) / 180
  const E = Math.max(hk * Math.tan(rad) * 1.05, (sideRoom * 1.2) * Math.tan(Math.max(rad, 1e-3)), 1)
  return { k, hk, rad, E }
}

export function focusMap(s: FocusSpec, x: number): FocusMap {
  const c = s.width / 2
  const d = x - s.focus
  const a = Math.abs(d)
  const sign = d < 0 ? -1 : 1
  if (a <= s.half) return { sx: c + (d * ((s.panel * s.width) / 2)) / s.half, scale: 1 }
  const u = a - s.half
  if (s.mode === 'bifocal') {
    const hk = (s.panel * s.width) / 2
    const dataSide = sign < 0 ? s.focus - s.half - s.lo : s.hi - (s.focus + s.half)
    const room = s.width / 2 - hk
    return { sx: c + sign * (hk + (u / Math.max(1e-9, dataSide)) * room), scale: 1 }
  }
  const g = wallGeometry(s)
  const X = g.hk + u * g.k * Math.cos(g.rad), Z = u * g.k * Math.sin(g.rad)
  const f = g.E / (g.E + Z)
  return { sx: c + sign * X * f, scale: f }
}

/** Data coordinate under a screen x (inverse of `focusMap`, found by bisection because the map is monotone). */
export function focusInverse(s: FocusSpec, sx: number): number {
  let a = s.lo - (s.hi - s.lo), b = s.hi + (s.hi - s.lo)
  for (let i = 0; i < 60; i++) { const m = (a + b) / 2; if (focusMap(s, m).sx < sx) a = m; else b = m }
  return (a + b) / 2
}
