/** Nelson–Siegel yield (in %) at maturity τ (years): level β₀, slope β₁ (negative = upward sloping), curvature β₂ and decay λ. */
export const nelsonSiegelCurve = (tau: readonly number[], b0: number, b1: number, b2: number, lambda: number): number[] =>
  tau.map((t) => { const x = t / lambda, f = (1 - Math.exp(-x)) / x; return b0 + b1 * f + b2 * (f - Math.exp(-x)) })
