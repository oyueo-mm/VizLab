/**
 * Andrews (1972) function of an observation x = (x₁, x₂, …, x_p):
 *   f_x(t) = x₁/√2 + x₂ sin t + x₃ cos t + x₄ sin 2t + x₅ cos 2t + …,  −π ≤ t ≤ π.
 * It is an isometry: ∫ (f_x − f_y)² dt = π · ‖x − y‖², so curves stay close exactly when observations are close.
 */
export function andrewsValue(x: readonly number[], t: number): number {
  let s = x.length ? x[0] / Math.SQRT2 : 0
  for (let j = 1; j < x.length; j++) {
    const k = Math.ceil(j / 2)
    s += x[j] * (j % 2 === 1 ? Math.sin(k * t) : Math.cos(k * t))
  }
  return s
}

export const andrewsGrid = (steps = 121) => Array.from({ length: steps }, (_, i) => -Math.PI + (2 * Math.PI * i) / (steps - 1))

export const andrewsCurve = (x: readonly number[], ts: readonly number[]) => ts.map((t) => andrewsValue(x, t))

/** Human-readable term j (0-based) of the series, e.g. term 3 = "x₄·sin 2t". */
export function andrewsTerm(j: number): string {
  if (j === 0) return 'x₁/√2'
  const k = Math.ceil(j / 2)
  return `x${j + 1}·${j % 2 === 1 ? 'sin' : 'cos'}${k > 1 ? ` ${k}t` : ' t'}`
}
