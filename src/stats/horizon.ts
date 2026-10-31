export interface HorizonLayers {
  /** Value range covered by one band. */
  bandWidth: number
  /** pos[k][i] ∈ [0, 1]: how full band k is at point i above the baseline. */
  pos: number[][]
  /** neg[k][i] ∈ [0, 1]: how full band k is below the baseline. */
  neg: number[][]
}

/**
 * Splits the distance from the baseline into `bands` equal slices and folds them on top of each other:
 * band k holds clamp(|v − baseline| / w − k, 0, 1). Values beyond bands · w saturate the darkest band.
 */
export function horizonLayers(values: readonly (number | null)[], baseline: number, bands: number, maxAbs?: number): HorizonLayers {
  const dev = values.map((v) => (v == null ? 0 : v - baseline))
  const top = maxAbs ?? Math.max(1e-12, ...dev.map(Math.abs))
  const w = top / bands
  const layer = (sign: 1 | -1) => Array.from({ length: bands }, (_, k) => dev.map((d) => Math.min(1, Math.max(0, (sign * d) / w - k))))
  return { bandWidth: w, pos: layer(1), neg: layer(-1) }
}

/** Value represented by the folded bands at point i: the inverse of `horizonLayers` (exact below saturation). */
export function unfold(layers: HorizonLayers, i: number): number {
  const up = layers.pos.reduce((s, b) => s + b[i], 0)
  const down = layers.neg.reduce((s, b) => s + b[i], 0)
  return (up - down) * layers.bandWidth
}
