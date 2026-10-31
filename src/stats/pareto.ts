export interface ParetoItem { name: string; value: number; row: number }
export interface ParetoRow extends ParetoItem { share: number; cum: number }

/** Items sorted by value descending (optionally) with each item's share and the running cumulative share of the total. */
export function pareto(items: readonly ParetoItem[], sort = true): { rows: ParetoRow[]; total: number } {
  const list = items.filter((i) => Number.isFinite(i.value) && i.value >= 0)
  const ordered = sort ? [...list].sort((a, b) => b.value - a.value) : list
  const total = ordered.reduce((s, i) => s + i.value, 0)
  let acc = 0
  const rows = ordered.map((i) => {
    acc += i.value
    return { ...i, share: total ? i.value / total : 0, cum: total ? acc / total : 0 }
  })
  return { rows, total }
}

/** Index of the first item at which the cumulative share reaches `threshold` — the "vital few" are items 0…index. */
export function vitalFew(rows: readonly ParetoRow[], threshold = 0.8): number {
  const i = rows.findIndex((r) => r.cum >= threshold - 1e-12)
  return i < 0 ? rows.length - 1 : i
}
