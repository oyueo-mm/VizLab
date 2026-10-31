import { pearson } from './descriptive'

/**
 * Beeswarm "dodge": keep every circle at its exact value on the value axis and push it sideways
 * to the smallest offset (searching both sides) that avoids overlapping already-placed circles.
 * `oneSided` only searches non-negative offsets (points pile up on one side like a dot plot).
 */
export function dodge(positions: readonly number[], radius: number, maxOffset = Infinity, oneSided = false) {
  const order = positions.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0])
  const placed: { p: number; o: number }[] = []
  const offsets = new Array<number>(positions.length).fill(0)
  const d2 = (2 * radius) ** 2
  let start = 0
  for (const [p, i] of order) {
    while (start < placed.length && p - placed[start].p >= 2 * radius) start++
    const near = placed.slice(start)
    let best = 0
    if (near.length) {
      const candidates = [0]
      for (const q of near) {
        const h = Math.sqrt(Math.max(0, d2 - (q.p - p) ** 2))
        candidates.push(q.o + h + 0.01, q.o - h - 0.01)
      }
      candidates.sort((a, b) => Math.abs(a) - Math.abs(b))
      best = (oneSided ? candidates.filter((c) => c >= 0) : candidates).find((c) => near.every((q) => (q.p - p) ** 2 + (q.o - c) ** 2 >= d2 - 1e-6)) ?? 0
    }
    best = Math.max(-maxOffset, Math.min(maxOffset, best))
    placed.push({ p, o: best })
    offsets[i] = best
  }
  return offsets
}

/** Pearson correlation matrix for the given numeric columns (pairwise complete rows). */
export function correlationMatrix(columns: readonly (readonly (number | null)[])[]) {
  return columns.map((a) =>
    columns.map((b) => {
      const xs: number[] = []
      const ys: number[] = []
      for (let i = 0; i < a.length; i++) {
        const x = a[i]
        const y = b[i]
        if (x != null && y != null && Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y) }
      }
      return pearson(xs, ys)
    }),
  )
}
