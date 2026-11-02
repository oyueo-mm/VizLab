/** Engines of the v0.8 attribute-driven network layouts (Semantic Substrates, PivotGraph) and the dynamic network layout of TimeArcs. */

// ───────────────────────────── Semantic Substrates ─────────────────────────────

export interface SubNode { id: string; sub: string; x: number | null; y: number | null }
export interface SubRegion { sub: string; x0: number; y0: number; x1: number; y1: number }
export interface SubstrateLayout { regions: SubRegion[]; pos: Map<string, [number, number]> }

/**
 * Semantic Substrates (Shneiderman & Aris 2006, simplified): every node is placed in the rectangular region (substrate) of its category, and
 * inside the region by two numeric attributes. Regions are stacked as rows or columns; attributes are scaled over all nodes or per region.
 * A node without a value for an attribute is put at the middle of that axis.
 */
export function substrateLayout(nodes: readonly SubNode[], width: number, height: number, opt: { direction: 'rows' | 'columns'; perRegion: boolean; gap?: number; pad?: number; order?: readonly string[] }): SubstrateLayout {
  const gap = opt.gap ?? 10, pad = opt.pad ?? 14
  const subs = opt.order?.length ? [...opt.order] : [...new Set(nodes.map((n) => n.sub))]
  const k = Math.max(1, subs.length)
  const regions: SubRegion[] = subs.map((sub, i) => opt.direction === 'rows'
    ? { sub, x0: 0, x1: width, y0: (i * height) / k + (i ? gap / 2 : 0), y1: ((i + 1) * height) / k - (i < k - 1 ? gap / 2 : 0) }
    : { sub, x0: (i * width) / k + (i ? gap / 2 : 0), x1: ((i + 1) * width) / k - (i < k - 1 ? gap / 2 : 0), y0: 0, y1: height })
  const ext = (vals: (number | null)[]): [number, number] => { const v = vals.filter((a): a is number => a != null); return v.length ? [Math.min(...v), Math.max(...v)] : [0, 1] }
  const gx = ext(nodes.map((n) => n.x)), gy = ext(nodes.map((n) => n.y))
  const pos = new Map<string, [number, number]>()
  for (const r of regions) {
    const mine = nodes.filter((n) => n.sub === r.sub)
    const ex = opt.perRegion ? ext(mine.map((n) => n.x)) : gx, ey = opt.perRegion ? ext(mine.map((n) => n.y)) : gy
    const f = (v: number | null, e: [number, number], a: number, b: number, flip: boolean) => {
      const t = v == null || e[1] === e[0] ? 0.5 : (v - e[0]) / (e[1] - e[0])
      return flip ? b - pad - t * (b - a - 2 * pad) : a + pad + t * (b - a - 2 * pad)
    }
    for (const n of mine) pos.set(n.id, [f(n.x, ex, r.x0, r.x1, false), f(n.y, ey, r.y0, r.y1, true)])
  }
  return { regions, pos }
}

// ───────────────────────────── PivotGraph ─────────────────────────────

export interface PivotCell { col: number; row: number; count: number; nodes: number[] }
export interface PivotLink { a: number; b: number; count: number }
export interface Pivot { cols: string[]; rows: string[]; cells: PivotCell[]; links: PivotLink[]; nodeCount: number; edgeCount: number }

/**
 * PivotGraph (Wattenberg 2006): nodes are grouped by two categorical attributes into a grid (one attribute on each axis), every cell is
 * one aggregated node sized by the number of nodes, and the edges between nodes are aggregated into links between cells weighted by their
 * number. With `directed` the link a→b is separate from b→a.
 */
export function pivotGraph(nodes: readonly { col: string; row: string }[], edges: readonly [number, number][], opt: { directed: boolean; sort: 'count' | 'name' }): Pivot {
  const count = (key: (n: { col: string; row: string }) => string) => { const m = new Map<string, number>(); for (const n of nodes) m.set(key(n), (m.get(key(n)) ?? 0) + 1); return m }
  const order = (m: Map<string, number>) => [...m.keys()].sort((a, b) => (opt.sort === 'count' ? m.get(b)! - m.get(a)! || a.localeCompare(b) : a.localeCompare(b)))
  const cols = order(count((n) => n.col)), rows = order(count((n) => n.row))
  const cells: PivotCell[] = []
  const cellIdx = new Map<string, number>()
  nodes.forEach((n, i) => {
    const key = `${n.col}\u0001${n.row}`
    let c = cellIdx.get(key)
    if (c == null) { c = cells.length; cellIdx.set(key, c); cells.push({ col: cols.indexOf(n.col), row: rows.indexOf(n.row), count: 0, nodes: [] }) }
    cells[c].count++
    cells[c].nodes.push(i)
  })
  const cellOf = nodes.map((n) => cellIdx.get(`${n.col}\u0001${n.row}`)!)
  const links = new Map<string, PivotLink>()
  for (const [u, v] of edges) {
    let a = cellOf[u], b = cellOf[v]
    if (!opt.directed && a > b) [a, b] = [b, a]
    const key = `${a}|${b}`
    const l = links.get(key)
    if (l) l.count++
    else links.set(key, { a, b, count: 1 })
  }
  return { cols, rows, cells, links: [...links.values()], nodeCount: nodes.length, edgeCount: edges.length }
}

// ───────────────────────────── TimeArcs ─────────────────────────────

export interface DynEdge { t: number; a: number; b: number; w: number }

/** Total weighted distance between the endpoints of all edges when the nodes sit in the given vertical order. */
export function arcLength(order: readonly number[], edges: readonly DynEdge[]): number {
  const pos = new Map(order.map((v, i) => [v, i]))
  return edges.reduce((s, e) => s + e.w * Math.abs(pos.get(e.a)! - pos.get(e.b)!), 0)
}

/**
 * One-dimensional node order for TimeArcs (Dang et al. 2016 use a force layout for this): the weighted mean position of the neighbours
 * is iterated (barycenter heuristic), keeping the best order seen, then adjacent pairs are swapped while that shortens the arcs.
 */
export function arcOrder(n: number, edges: readonly DynEdge[]): number[] {
  const w = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (const e of edges) if (e.a !== e.b) { w[e.a][e.b] += e.w; w[e.b][e.a] += e.w }
  const first = new Array<number>(n).fill(Infinity)
  for (const e of edges) { first[e.a] = Math.min(first[e.a], e.t); first[e.b] = Math.min(first[e.b], e.t) }
  let order = Array.from({ length: n }, (_, i) => i).sort((a, b) => first[a] - first[b] || a - b)
  let best = order, bestCost = arcLength(order, edges)
  for (let it = 0; it < 60; it++) {
    const pos = new Map(order.map((v, i) => [v, i]))
    const bary = order.map((v) => { let s = 0, t = 0; for (let u = 0; u < n; u++) if (w[v][u]) { s += w[v][u] * pos.get(u)!; t += w[v][u] } return t ? s / t : pos.get(v)! })
    const next = order.map((v, i) => ({ v, b: bary[i] })).sort((p, q) => p.b - q.b || p.v - q.v).map((x) => x.v)
    const c = arcLength(next, edges)
    if (c < bestCost - 1e-9) { best = next; bestCost = c }
    if (next.join() === order.join()) break
    order = next
  }
  order = [...best]
  for (let pass = 0; pass < 10; pass++) {
    let improved = false
    for (let i = 0; i + 1 < n; i++) {
      const cand = [...order]; [cand[i], cand[i + 1]] = [cand[i + 1], cand[i]]
      const c = arcLength(cand, edges)
      if (c < bestCost - 1e-9) { order = cand; bestCost = c; improved = true }
    }
    if (!improved) break
  }
  return order
}
