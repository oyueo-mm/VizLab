export type TieMethod = 'min' | 'dense' | 'average' | 'first'

/**
 * Ranks values (1 = best). `descending` ranks the largest value first. Missing values get null.
 * Ties: `min` (competition ranking 1, 2, 2, 4), `dense` (1, 2, 2, 3), `average` (1, 2.5, 2.5, 4)
 * and `first` (ties broken by input order).
 */
export function rankValues(values: readonly (number | null)[], method: TieMethod = 'min', descending = true): (number | null)[] {
  const idx = values.map((v, i) => [v, i] as const).filter((e): e is readonly [number, number] => e[0] != null && Number.isFinite(e[0]))
  idx.sort((a, b) => (descending ? b[0] - a[0] : a[0] - b[0]) || a[1] - b[1])
  const out: (number | null)[] = values.map(() => null)
  let dense = 0
  for (let k = 0; k < idx.length; ) {
    let j = k
    while (j + 1 < idx.length && idx[j + 1][0] === idx[k][0]) j++
    dense++
    for (let t = k; t <= j; t++) {
      const i = idx[t][1]
      out[i] = method === 'min' ? k + 1 : method === 'dense' ? dense : method === 'average' ? (k + 1 + j + 1) / 2 : t + 1
    }
    k = j + 1
  }
  return out
}
