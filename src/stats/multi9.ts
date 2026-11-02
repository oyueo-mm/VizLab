export type Pt = [number, number]

// ───────────────────────────── Dust & Magnet ─────────────────────────────

export interface Magnet { x: number; y: number; strength: number; on: boolean }

/** Min–max scaling of every column to 0…1 (a constant column becomes 0). */
export function normalizeColumns(rows: readonly number[][]): number[][] {
  const k = rows[0]?.length ?? 0
  const lo = Array.from({ length: k }, (_, j) => Math.min(...rows.map((r) => r[j])))
  const hi = Array.from({ length: k }, (_, j) => Math.max(...rows.map((r) => r[j])))
  return rows.map((r) => r.map((v, j) => (hi[j] > lo[j] ? (v - lo[j]) / (hi[j] - lo[j]) : 0)))
}

/**
 * Resting position of a dust particle: each magnet pulls with a spring whose stiffness is (magnet strength × the particle's value for
 * that magnet raised to `contrast`, 1 = linear), so the particle settles where the pulls balance. `null` when no magnet attracts it (it stays where it is).
 */
export function dustTarget(values: readonly number[], magnets: readonly Magnet[], contrast = 1): Pt | null {
  let sx = 0, sy = 0, sk = 0
  magnets.forEach((m, j) => {
    if (!m.on) return
    const k = m.strength * Math.max(0, values[j]) ** contrast
    if (k <= 0) return
    sx += k * m.x; sy += k * m.y; sk += k
  })
  return sk > 1e-12 ? [sx / sk, sy / sk] : null
}

/** One relaxation step: particles move a fraction of the way to their resting position; overlapping particles are pushed apart. Returns the largest move. */
export function dustStep(pos: Pt[], values: readonly (readonly number[])[], magnets: readonly Magnet[], rate: number, spread: number, contrast = 1): number {
  let maxMove = 0
  const target = values.map((v) => dustTarget(v, magnets, contrast))
  const next = pos.map((p, i): Pt => (target[i] ? [p[0] + (target[i]![0] - p[0]) * rate, p[1] + (target[i]![1] - p[1]) * rate] : [p[0], p[1]]))
  if (spread > 0) {
    for (let i = 0; i < next.length; i++) for (let j = i + 1; j < next.length; j++) {
      const dx = next[j][0] - next[i][0], dy = next[j][1] - next[i][1]
      const d = Math.hypot(dx, dy)
      if (d < spread && d > 1e-9) { const push = ((spread - d) / 2) * 0.5; next[i][0] -= (dx / d) * push; next[i][1] -= (dy / d) * push; next[j][0] += (dx / d) * push; next[j][1] += (dy / d) * push }
    }
  }
  next.forEach((n, i) => { maxMove = Math.max(maxMove, Math.hypot(n[0] - pos[i][0], n[1] - pos[i][1])); pos[i] = n })
  return maxMove
}

// ───────────────────────────── GosperMap ─────────────────────────────

const DIRS: Pt[] = Array.from({ length: 6 }, (_, k) => [Math.cos((k * Math.PI) / 3), Math.sin((k * Math.PI) / 3)])

/** Vertices of the Gosper (flowsnake) curve of the given level on the triangular lattice: 7^level + 1 points, consecutive ones at distance 1. */
export function gosperCurve(level: number): Pt[] {
  let s = 'A'
  for (let i = 0; i < level; i++) s = s.replace(/[AB]/g, (c) => (c === 'A' ? 'A-B--B+A++AA+B-' : '+A-BB--B-A++A+B'))
  const pts: Pt[] = [[0, 0]]
  let h = 0
  let x = 0, y = 0
  for (const c of s) {
    if (c === '+') h = (h + 1) % 6
    else if (c === '-') h = (h + 5) % 6
    else { x += DIRS[h][0]; y += DIRS[h][1]; pts.push([x, y]) }
  }
  return pts
}

export interface GNode { name: string; value?: number; children?: GNode[] }
export interface GosperLeaf { path: string[]; value: number; start: number; end: number }
export interface GosperModel {
  level: number
  /** Cell centres along the curve (cell i is the i-th vertex). */
  cells: Pt[]
  leaves: GosperLeaf[]
  /** Leaf index of every cell. */
  leafOf: number[]
}

const total = (n: GNode): number => (n.children?.length ? n.children.reduce((a, c) => a + total(c), 0) : Math.max(0, n.value ?? 0))

/**
 * GosperMap layout: leaves are laid along the curve in depth-first order, each taking a run of cells proportional to its value, so every
 * node of the hierarchy owns one contiguous run of the curve (a connected, map-like region).
 */
export function gosperMap(root: GNode, level: number): GosperModel {
  const curve = gosperCurve(level)
  const N = 7 ** level
  const cells = curve.slice(0, N)
  const leaves: GosperLeaf[] = []
  const walk = (n: GNode, path: string[]) => {
    if (n.children?.length) n.children.forEach((c) => walk(c, [...path, c.name]))
    else if (total(n) > 0) leaves.push({ path, value: total(n), start: 0, end: 0 })
  }
  walk(root, [])
  if (!leaves.length) return { level, cells, leaves, leafOf: [] }
  // largest-remainder allocation with at least one cell per leaf
  const sum = leaves.reduce((a, l) => a + l.value, 0)
  const spare = Math.max(0, N - leaves.length)
  const quota = leaves.map((l) => (l.value / sum) * spare)
  const base = quota.map((q) => Math.floor(q))
  let left = spare - base.reduce((a, b) => a + b, 0)
  quota.map((q, i) => ({ i, r: q - Math.floor(q) })).sort((a, b) => b.r - a.r || a.i - b.i).forEach(({ i }) => { if (left > 0) { base[i]++; left-- } })
  let at = 0
  const leafOf: number[] = []
  leaves.forEach((l, i) => { l.start = at; at += base[i] + 1; l.end = at; for (let c = l.start; c < l.end; c++) leafOf.push(i) })
  return { level, cells, leaves, leafOf: leafOf.slice(0, N) }
}

/** Smallest level whose 7^level cells give every leaf at least `perLeaf` cells. */
export function gosperLevelFor(leafCount: number, perLeaf = 4): number {
  let l = 1
  while (7 ** l < leafCount * perLeaf && l < 6) l++
  return l
}

/** Cells (indexes) whose leaf path starts with `prefix`. */
export const cellsUnder = (m: GosperModel, prefix: readonly string[]): number[] =>
  m.leafOf.map((li, c) => ({ li, c })).filter(({ li }) => prefix.every((p, k) => m.leaves[li].path[k] === p)).map(({ c }) => c)
