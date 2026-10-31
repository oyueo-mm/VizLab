export interface MosaicRecord { keys: string[]; count: number; rows: number[] }

export interface MosaicCell {
  keys: string[]
  count: number
  rows: number[]
  x: number
  y: number
  w: number
  h: number
  /** Count expected if the variables were independent, and the Pearson residual (O − E)/√E. */
  expected: number
  residual: number
}

/** Counts per combination of categories (summing duplicates), with each variable's categories in first-appearance order. */
export function collectCounts(rows: readonly { keys: string[]; count: number; row: number }[], depth: number) {
  const levels: string[][] = Array.from({ length: depth }, () => [])
  const map = new Map<string, MosaicRecord>()
  for (const r of rows) {
    r.keys.forEach((k, i) => { if (!levels[i].includes(k)) levels[i].push(k) })
    const id = r.keys.join('\u0000')
    const rec = map.get(id)
    if (rec) { rec.count += r.count; rec.rows.push(r.row) } else map.set(id, { keys: r.keys, count: r.count, rows: [r.row] })
  }
  return { levels, counts: map }
}

/**
 * Mosaic layout: split the rectangle by the first variable along `firstDir` in proportion to its marginal counts, then each
 * strip by the next variable along the other direction in proportion to the conditional counts, and so on. With zero gap,
 * every cell's area is exactly its share of the total count.
 */
export function mosaicLayout(levels: readonly string[][], counts: ReadonlyMap<string, MosaicRecord>, width: number, height: number, firstDir: 'x' | 'y', gap = 0): { cells: MosaicCell[]; total: number } {
  const depth = levels.length
  const records = [...counts.values()]
  const total = records.reduce((s, r) => s + r.count, 0)
  const marg = levels.map((lv, d) => new Map(lv.map((k) => [k, records.filter((r) => r.keys[d] === k).reduce((s, r) => s + r.count, 0)])))
  const cells: MosaicCell[] = []
  const sumUnder = (prefix: string[]) => records.filter((r) => prefix.every((k, i) => r.keys[i] === k)).reduce((s, r) => s + r.count, 0)
  const walk = (prefix: string[], x: number, y: number, w: number, h: number, dir: 'x' | 'y') => {
    const d = prefix.length
    if (d === depth) {
      const rec = counts.get(prefix.join('\u0000'))
      const count = rec?.count ?? 0
      const expected = total ? prefix.reduce((e, k, i) => e * ((marg[i].get(k) ?? 0) / total), total) : 0
      cells.push({ keys: prefix, count, rows: rec?.rows ?? [], x, y, w, h, expected, residual: expected > 0 ? (count - expected) / Math.sqrt(expected) : 0 })
      return
    }
    const parent = sumUnder(prefix)
    const kids = levels[d]
    const span = dir === 'x' ? w : h
    const usable = Math.max(0, span - gap * (kids.length - 1))
    let pos = 0
    for (const k of kids) {
      const part = parent ? sumUnder([...prefix, k]) / parent : 0
      const len = usable * part
      if (dir === 'x') walk([...prefix, k], x + pos, y, len, h, 'y')
      else walk([...prefix, k], x, y + pos, w, len, 'x')
      pos += len + gap
    }
  }
  if (total > 0) walk([], 0, 0, width, height, firstDir)
  return { cells, total }
}

/** Pearson χ² statistic against mutual independence and its degrees of freedom (Πrᵢ − 1 − Σ(rᵢ − 1)). */
export function chiSquare(cells: readonly MosaicCell[], levels: readonly string[][]) {
  const stat = cells.reduce((s, c) => s + (c.expected > 0 ? (c.count - c.expected) ** 2 / c.expected : 0), 0)
  const sizes = levels.map((l) => l.length)
  const df = Math.max(0, sizes.reduce((p, r) => p * r, 1) - 1 - sizes.reduce((s, r) => s + (r - 1), 0))
  return { stat, df }
}
