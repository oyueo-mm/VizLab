// ───────────────────────────── OD Maps ─────────────────────────────

export interface OdRow { origin: string; dest: string; ox: number; oy: number; dx: number; dy: number; flow: number }
export interface OdModel {
  regions: string[]
  /** grid position (column, row) of every region */
  grid: [number, number][]
  cols: number
  rows: number
  /** flow[o][d] */
  flow: number[][]
  max: number
  maxOff: number
  out: number[]
  inn: number[]
}

/** Matrix of flows between regions placed on a coarse map grid. */
export function odModel(rows: readonly OdRow[]): OdModel | null {
  const regions: string[] = [], pos = new Map<string, [number, number]>()
  for (const r of rows) {
    if (!pos.has(r.origin)) { pos.set(r.origin, [r.ox, r.oy]); regions.push(r.origin) }
    if (!pos.has(r.dest)) { pos.set(r.dest, [r.dx, r.dy]); regions.push(r.dest) }
  }
  if (regions.length < 2) return null
  const idx = new Map(regions.map((r, i) => [r, i]))
  const flow = regions.map(() => regions.map(() => 0))
  for (const r of rows) flow[idx.get(r.origin)!][idx.get(r.dest)!] += r.flow
  const grid = regions.map((r) => pos.get(r)!)
  const cols = Math.max(...grid.map((g) => g[0])) + 1, rowsN = Math.max(...grid.map((g) => g[1])) + 1
  let max = 0, maxOff = 0
  flow.forEach((row, o) => row.forEach((v, d) => { max = Math.max(max, v); if (o !== d) maxOff = Math.max(maxOff, v) }))
  return { regions, grid, cols, rows: rowsN, flow, max, maxOff, out: flow.map((r) => r.reduce((a, b) => a + b, 0)), inn: regions.map((_, d) => flow.reduce((a, r) => a + r[d], 0)) }
}

/** Position of the (outer, inner) pair on the OD map: outer = the focal region's map cell, inner = the partner region's cell inside it. */
export const odCellPos = (m: OdModel, outer: number, inner: number): { x: number; y: number } => ({
  x: m.grid[outer][0] * m.cols + m.grid[inner][0],
  y: m.grid[outer][1] * m.rows + m.grid[inner][1],
})
