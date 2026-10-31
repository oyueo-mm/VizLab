/** Small helpers for the population pyramid and the bullet chart. */

export type PyramidMode = 'absolute' | 'total' | 'group'

export interface PyramidRow { name: string; left: number; right: number; row: number }

/**
 * Display values of a pyramid. `absolute` keeps the raw numbers; `total` divides by the grand total of both groups
 * (so the whole pyramid sums to 100 %); `group` divides each side by its own group total (each side sums to 100 %).
 */
export function pyramidValues(rows: readonly PyramidRow[], mode: PyramidMode) {
  const lt = rows.reduce((s, r) => s + Math.max(0, r.left), 0)
  const rt = rows.reduce((s, r) => s + Math.max(0, r.right), 0)
  return rows.map((r) => {
    const l = Math.max(0, r.left)
    const rr = Math.max(0, r.right)
    if (mode === 'absolute') return { left: l, right: rr }
    if (mode === 'total') { const t = lt + rt || 1; return { left: (l / t) * 100, right: (rr / t) * 100 } }
    return { left: lt ? (l / lt) * 100 : 0, right: rt ? (rr / rt) * 100 : 0 }
  })
}

/** Qualitative range edges (ascending upper bounds). Non-increasing or missing values are repaired so bands never invert. */
export function bulletRanges(raw: readonly (number | null)[], fallbackMax: number): number[] {
  const out: number[] = []
  let prev = 0
  raw.forEach((v, i) => {
    const fallback = (fallbackMax * (i + 1)) / raw.length
    const x = v != null && Number.isFinite(v) ? v : fallback
    prev = Math.max(prev, x)
    out.push(prev)
  })
  return out
}

/** Index of the qualitative range an actual value falls in (0 = worst) or -1 when below zero. */
export function bulletBand(actual: number, edges: readonly number[]): number {
  if (actual < 0) return -1
  const i = edges.findIndex((e) => actual <= e)
  return i < 0 ? edges.length - 1 : i
}
