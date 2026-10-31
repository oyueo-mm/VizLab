/** Dynamical systems: numerical integration, phase-portrait systems and one-dimensional maps (bifurcation diagram, Lyapunov exponent). */

export type Vec2 = [number, number]
export type Field2 = (x: number, y: number) => Vec2

/** One classical RK4 step of the planar system (x′, y′) = f(x, y). */
export function rk4(f: Field2, p: Vec2, dt: number): Vec2 {
  const k1 = f(p[0], p[1])
  const k2 = f(p[0] + (dt / 2) * k1[0], p[1] + (dt / 2) * k1[1])
  const k3 = f(p[0] + (dt / 2) * k2[0], p[1] + (dt / 2) * k2[1])
  const k4 = f(p[0] + dt * k3[0], p[1] + dt * k3[1])
  return [p[0] + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]), p[1] + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])]
}

export function trajectory(f: Field2, p0: Vec2, dt: number, steps: number, bounds?: { x: [number, number]; y: [number, number] }): Vec2[] {
  const out: Vec2[] = [p0]
  let p = p0
  for (let i = 0; i < steps; i++) {
    p = rk4(f, p, dt)
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) break
    if (bounds && (p[0] < bounds.x[0] * 3 || p[0] > bounds.x[1] * 3 || p[1] < bounds.y[0] * 3 || p[1] > bounds.y[1] * 3)) break
    out.push(p)
  }
  return out
}

export type SystemId = 'pendulum' | 'lotka-volterra' | 'van-der-pol' | 'duffing' | 'linear'

export interface PhaseSystem {
  id: SystemId
  name: string
  xLabel: string
  yLabel: string
  window: { x: [number, number]; y: [number, number] }
  params: { key: string; label: string; min: number; max: number; step: number; value: number }[]
  field: (p: Record<string, number>) => Field2
  note: string
  /** A conserved quantity (used to verify the integrator) or null. */
  invariant?: (p: Record<string, number>) => (x: number, y: number) => number
}

export const phaseSystems: PhaseSystem[] = [
  { id: 'pendulum', name: '단진자 (감쇠)', xLabel: '각도 θ (rad)', yLabel: '각속도 ω', window: { x: [-7, 7], y: [-4, 4] }, params: [{ key: 'damping', label: '감쇠 b', min: 0, max: 1, step: 0.02, value: 0.2 }],
    field: (p) => (x, y) => [y, -Math.sin(x) - p.damping * y], note: 'θ″ = −sin θ − bθ′. 감쇠가 0이면 에너지가 보존되어 닫힌 궤도(중심)와 열린 궤도(회전), 안장점이 보입니다. 감쇠가 있으면 궤도가 나선을 그리며 바닥으로 모입니다.',
    invariant: () => (x, y) => 0.5 * y * y - Math.cos(x) },
  { id: 'lotka-volterra', name: '로트카–볼테라 (포식자–피식자)', xLabel: '피식자 x', yLabel: '포식자 y', window: { x: [0, 4], y: [0, 4] }, params: [{ key: 'a', label: '피식자 성장 a', min: 0.4, max: 1.6, step: 0.05, value: 1 }, { key: 'c', label: '포식자 사망 c', min: 0.4, max: 1.6, step: 0.05, value: 1 }],
    field: (p) => (x, y) => [p.a * x - x * y, x * y - p.c * y], note: 'x′ = ax − xy, y′ = xy − cy. 평형점 (c, a) 주위로 닫힌 궤도가 도는 중심형이며, 이 모형은 보존량 x − c ln x + y − a ln y를 가집니다.',
    invariant: (p) => (x, y) => x - p.c * Math.log(Math.max(1e-9, x)) + y - p.a * Math.log(Math.max(1e-9, y)) },
  { id: 'van-der-pol', name: '반 데르 폴 진동자', xLabel: '위치 x', yLabel: '속도 y', window: { x: [-4, 4], y: [-6, 6] }, params: [{ key: 'mu', label: '비선형 세기 μ', min: 0.1, max: 4, step: 0.1, value: 1.2 }],
    field: (p) => (x, y) => [y, p.mu * (1 - x * x) * y - x], note: 'x″ − μ(1 − x²)x′ + x = 0. 원점은 불안정하고 어떤 궤도든 하나의 안정한 극한 순환(limit cycle)으로 모입니다.' },
  { id: 'duffing', name: '더핑 진동자 (이중 우물)', xLabel: '위치 x', yLabel: '속도 y', window: { x: [-2.5, 2.5], y: [-2.5, 2.5] }, params: [{ key: 'delta', label: '감쇠 δ', min: 0, max: 0.8, step: 0.02, value: 0.15 }],
    field: (p) => (x, y) => [y, x - x * x * x - p.delta * y], note: 'x″ = x − x³ − δx′. 위치 에너지가 두 우물이어서 안정한 평형점이 둘(±1)이고 원점은 안장점입니다. 초기값에 따라 어느 우물로 갈지 결정됩니다.',
    invariant: () => (x, y) => 0.5 * y * y - 0.5 * x * x + 0.25 * x ** 4 },
  { id: 'linear', name: '선형 시스템 (고유값으로 분류)', xLabel: 'x', yLabel: 'y', window: { x: [-3, 3], y: [-3, 3] }, params: [{ key: 'tr', label: '대각합 τ = a + d', min: -3, max: 3, step: 0.1, value: -0.6 }, { key: 'det', label: '행렬식 Δ = ad − bc', min: -3, max: 4, step: 0.1, value: 1.5 }],
    field: (p) => linearField(p.tr, p.det),
    note: '행렬의 대각합 τ와 행렬식 Δ가 고유값을 정합니다. Δ < 0이면 안장점, Δ > 0이면 τ의 부호로 안정·불안정, τ² − 4Δ의 부호로 마디(실수 고유값)와 나선(복소수 고유값)이 갈립니다.' },
]

/** Linear planar system ẋ = A x with trace τ and determinant Δ, built so that the eigenvalues are λ = τ/2 ± √(τ²/4 − Δ). */
export function linearField(tr: number, det: number): Field2 {
  const disc = (tr * tr) / 4 - det
  if (disc < 0) { const w = Math.sqrt(-disc); return (x, y) => [(tr / 2) * x - w * y, w * x + (tr / 2) * y] }
  const s = Math.sqrt(disc)
  return (x, y) => [(tr / 2 + s) * x, (tr / 2 - s) * y]
}

export function classifyLinear(tr: number, det: number): string {
  const disc = tr * tr - 4 * det
  if (det < 0) return '안장점 (불안정)'
  if (det === 0) return '퇴화 (선 위의 평형점)'
  if (Math.abs(tr) < 1e-9) return disc < 0 ? '중심 (닫힌 궤도)' : '퇴화'
  if (disc < 0) return tr < 0 ? '안정한 나선 (초점)' : '불안정한 나선'
  return tr < 0 ? '안정 마디' : '불안정 마디'
}

// ─── one-dimensional maps ───────────────────────────────────────────────────────────

export type MapId = 'logistic' | 'sine' | 'tent'

export const maps1d: Record<MapId, { name: string; rRange: [number, number]; f: (r: number, x: number) => number; df: (r: number, x: number) => number; x0: number }> = {
  logistic: { name: '로지스틱 사상 x → r·x(1−x)', rRange: [2.5, 4], f: (r, x) => r * x * (1 - x), df: (r, x) => r * (1 - 2 * x), x0: 0.4 },
  sine: { name: '사인 사상 x → r·sin(πx)/4 …', rRange: [0.5, 4], f: (r, x) => (r / 4) * Math.sin(Math.PI * x), df: (r, x) => (r / 4) * Math.PI * Math.cos(Math.PI * x), x0: 0.4 },
  tent: { name: '텐트 사상 x → r·min(x, 1−x)', rRange: [0.5, 2], f: (r, x) => r * Math.min(x, 1 - x), df: (r, x) => (x < 0.5 ? r : -r), x0: 0.3 },
}

/** Long-run orbit of the map: `transient` iterations are discarded, then `keep` values are returned. */
export function attractor(id: MapId, r: number, transient: number, keep: number): number[] {
  const m = maps1d[id]
  let x = m.x0
  for (let i = 0; i < transient; i++) x = m.f(r, x)
  const out: number[] = []
  for (let i = 0; i < keep; i++) { x = m.f(r, x); out.push(x) }
  return out
}

/** Lyapunov exponent λ = mean of ln|f′(x_n)| along the orbit: positive means chaos, negative a stable cycle. */
export function lyapunov(id: MapId, r: number, transient = 500, n = 2000): number {
  const m = maps1d[id]
  let x = m.x0
  for (let i = 0; i < transient; i++) x = m.f(r, x)
  let s = 0
  for (let i = 0; i < n; i++) { s += Math.log(Math.max(1e-12, Math.abs(m.df(r, x)))); x = m.f(r, x) }
  return s / n
}

/** Number of distinct values (to tolerance `tol`) in an attractor sample: 1 = fixed point, 2 = period-2, … */
export function periodOf(orbit: readonly number[], tol = 1e-4): number {
  const vals: number[] = []
  for (const v of orbit) if (!vals.some((u) => Math.abs(u - v) < tol)) vals.push(v)
  return vals.length
}
