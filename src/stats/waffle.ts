export type Rounding = 'largest' | 'round' | 'floor'

/**
 * Converts non-negative values into whole cell counts out of `total`.
 * - `largest` (Hamilton / largest remainder): floor every quota, then give the leftover cells to the
 *   largest fractional parts — the counts always add up to `total`.
 * - `round` / `floor`: independent rounding; the sum can miss `total` (the difference is reported).
 */
export function allocateCells(values: readonly number[], total: number, method: Rounding = 'largest') {
  const sum = values.reduce((s, v) => s + Math.max(0, v), 0)
  if (!(sum > 0) || total <= 0) return { counts: values.map(() => 0), quotas: values.map(() => 0), diff: 0 }
  const quotas = values.map((v) => (Math.max(0, v) / sum) * total)
  let counts: number[]
  if (method === 'round') counts = quotas.map((q) => Math.round(q))
  else {
    counts = quotas.map((q) => Math.floor(q + 1e-9))
    if (method === 'largest') {
      let left = total - counts.reduce((s, c) => s + c, 0)
      const order = quotas.map((q, i) => [q - Math.floor(q + 1e-9), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1])
      for (let k = 0; left > 0 && k < order.length; k++, left--) counts[order[k][1]]++
    }
  }
  return { counts, quotas, diff: counts.reduce((s, c) => s + c, 0) - total }
}
