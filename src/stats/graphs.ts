import * as d3 from 'd3'
import type { EdgeRow, Network, NetNode } from './network'

// ─── adjacency matrix ───────────────────────────────────────────────────────

/** Weight matrix in the given node order: m[i][j] is the weight of the edge from order[i] to order[j] (symmetric when undirected). */
export function adjacencyMatrix(net: Network, order: readonly string[], directed: boolean): number[][] {
  const idx = new Map(order.map((id, i) => [id, i]))
  const m = order.map(() => new Array<number>(order.length).fill(0))
  for (const l of net.links) {
    const i = idx.get(l.source)
    const j = idx.get(l.target)
    if (i == null || j == null) continue
    m[i][j] += l.weight
    if (!directed) m[j][i] += l.weight
  }
  return m
}

export type MatrixOrder = 'data' | 'name' | 'degree' | 'group' | 'cluster'

/**
 * Node order for a matrix or an arc layout. `cluster` places connected components together and orders each by a greedy
 * nearest-neighbour walk from its best-connected node, which tends to put dense blocks on the diagonal.
 */
export function orderNodes(net: Network, order: MatrixOrder): NetNode[] {
  const list = [...net.nodes]
  if (order === 'name') return list.sort((a, b) => a.id.localeCompare(b.id, 'ko'))
  if (order === 'degree') return list.sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id, 'ko'))
  if (order === 'group') return list.sort((a, b) => a.group.localeCompare(b.group, 'ko') || a.component - b.component || b.degree - a.degree)
  if (order === 'cluster') {
    const nb = new Map<string, Map<string, number>>(list.map((n) => [n.id, new Map()]))
    for (const l of net.links) { nb.get(l.source)!.set(l.target, l.weight); nb.get(l.target)!.set(l.source, l.weight) }
    const out: NetNode[] = []
    const seen = new Set<string>()
    const byId = new Map(list.map((n) => [n.id, n]))
    for (const comp of [...new Set(list.map((n) => n.component))]) {
      const members = list.filter((n) => n.component === comp).sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id, 'ko'))
      let cur: NetNode | undefined = members[0]
      while (cur) {
        out.push(cur)
        seen.add(cur.id)
        const next: string | undefined = [...nb.get(cur.id)!.entries()].filter(([id]) => !seen.has(id)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))[0]?.[0]
        cur = next ? byId.get(next) : members.find((m) => !seen.has(m.id))
      }
    }
    return out
  }
  return list
}

// ─── bipartite graph ────────────────────────────────────────────────────────

export interface BipartiteIssue { node: string; text: string }

export interface Bipartite {
  left: string[]
  right: string[]
  /** Edges between a left node and a right node, merged by summing weights. */
  edges: { a: string; b: string; weight: number; rows: number[] }[]
  /** Names used on both sides, edges inside one side, and self-pairs — each breaks the two-set structure. */
  issues: BipartiteIssue[]
}

/**
 * Two node sets from an edge list: the first column names the left set, the second the right set. A name that appears in both columns
 * cannot belong to both sets, so it is reported; edges that would connect a name to itself or stay inside one set are dropped.
 */
export function buildBipartite(rows: readonly EdgeRow[]): Bipartite {
  const left: string[] = []
  const right: string[] = []
  for (const r of rows) {
    const a = r.source.trim()
    const b = r.target.trim()
    if (a && !left.includes(a)) left.push(a)
    if (b && !right.includes(b)) right.push(b)
  }
  const both = left.filter((n) => right.includes(n))
  const issues: BipartiteIssue[] = both.map((n) => ({ node: n, text: `‘${n}’이(가) 양쪽 집합에 모두 나타납니다. 두 집합은 서로 겹치지 않아야 합니다.` }))
  const bad = new Set(both)
  const m = new Map<string, { a: string; b: string; weight: number; rows: number[] }>()
  for (const r of rows) {
    const a = r.source.trim()
    const b = r.target.trim()
    const w = r.weight ?? 1
    if (!a || !b || bad.has(a) || bad.has(b) || !(w > 0)) continue
    const k = `${a}\u0000${b}`
    const e = m.get(k)
    if (e) { e.weight += w; e.rows.push(r.row) } else m.set(k, { a, b, weight: w, rows: [r.row] })
  }
  return { left: left.filter((n) => !bad.has(n)), right: right.filter((n) => !bad.has(n)), edges: [...m.values()], issues }
}

/** Number of edge pairs that cross when the two sets are drawn in the given orders. */
export function crossings(edges: readonly { a: string; b: string }[], leftOrder: readonly string[], rightOrder: readonly string[]): number {
  const li = new Map(leftOrder.map((n, i) => [n, i]))
  const ri = new Map(rightOrder.map((n, i) => [n, i]))
  let c = 0
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const da = (li.get(edges[i].a) ?? 0) - (li.get(edges[j].a) ?? 0)
    const db = (ri.get(edges[i].b) ?? 0) - (ri.get(edges[j].b) ?? 0)
    if (da * db < 0) c++
  }
  return c
}

/** Barycenter heuristic: repeatedly order each side by the mean position of its neighbours on the other side. Reduces crossings; does not guarantee the minimum. */
export function barycenterOrder(bp: Pick<Bipartite, 'left' | 'right' | 'edges'>, rounds = 8): { left: string[]; right: string[] } {
  let left = [...bp.left]
  let right = [...bp.right]
  const sortBy = (side: string[], other: string[], key: 'a' | 'b') => {
    const pos = new Map(other.map((n, i) => [n, i]))
    const bary = new Map(side.map((n) => {
      const es = bp.edges.filter((e) => e[key] === n)
      const w = d3.sum(es, (e) => e.weight)
      return [n, w ? d3.sum(es, (e) => (pos.get(key === 'a' ? e.b : e.a) ?? 0) * e.weight) / w : Infinity] as const
    }))
    // stable: nodes without edges keep their relative order at the end
    return [...side].sort((x, y) => (bary.get(x)! === bary.get(y)! ? side.indexOf(x) - side.indexOf(y) : bary.get(x)! - bary.get(y)!))
  }
  for (let r = 0; r < rounds; r++) {
    left = sortBy(left, right, 'a')
    right = sortBy(right, left, 'b')
  }
  return { left, right }
}

// ─── hive plot ──────────────────────────────────────────────────────────────

export type HiveAxisRule = 'group' | 'degree' | 'component'
export type HivePosition = 'degree' | 'strength' | 'name'

export interface HiveNode { id: string; axis: number; /** Position along the axis in [0, 1] (0 = centre). */ t: number }

/**
 * Deterministic hive-plot layout: each node goes to an axis by a rule on its own attributes, and its distance from the centre is its rank by
 * another attribute — no simulation, so the same data always gives the same picture. `group` maps the sorted group names to axes in order
 * (extra groups share the last axis); `degree` splits nodes into equal-sized bands of connectivity; `component` uses connected components.
 */
export function hiveLayout(net: Network, axes: number, rule: HiveAxisRule, position: HivePosition): HiveNode[] {
  const k = Math.max(2, axes)
  const nodes = [...net.nodes]
  const axisOf = new Map<string, number>()
  if (rule === 'group') {
    const groups = [...new Set(nodes.map((n) => n.group || '(없음)'))].sort((a, b) => a.localeCompare(b, 'ko'))
    nodes.forEach((n) => axisOf.set(n.id, Math.min(k - 1, groups.indexOf(n.group || '(없음)'))))
  } else if (rule === 'component') {
    const sizes = new Map<number, number>()
    nodes.forEach((n) => sizes.set(n.component, (sizes.get(n.component) ?? 0) + 1))
    const comps = [...sizes.keys()].sort((a, b) => sizes.get(b)! - sizes.get(a)! || a - b)
    nodes.forEach((n) => axisOf.set(n.id, Math.min(k - 1, comps.indexOf(n.component))))
  } else {
    const sorted = [...nodes].sort((a, b) => a.degree - b.degree || a.id.localeCompare(b.id, 'ko'))
    sorted.forEach((n, i) => axisOf.set(n.id, Math.min(k - 1, Math.floor((i * k) / sorted.length))))
  }
  const metric = (n: NetNode) => (position === 'degree' ? n.degree : position === 'strength' ? n.strength : 0)
  const out: HiveNode[] = []
  for (let a = 0; a < k; a++) {
    const on = nodes.filter((n) => axisOf.get(n.id) === a).sort((x, y) => (position === 'name' ? x.id.localeCompare(y.id, 'ko') : metric(x) - metric(y) || x.id.localeCompare(y.id, 'ko')))
    on.forEach((n, i) => out.push({ id: n.id, axis: a, t: on.length > 1 ? i / (on.length - 1) : 0.5 }))
  }
  return out
}

// ─── hierarchical edge bundling ─────────────────────────────────────────────

export interface PathTree { name: string; children?: PathTree[] }

/** Tree of nodes from slash-separated paths ("app/ui/Button"): every prefix becomes an inner node, every full path a leaf. */
export function treeFromPaths(paths: readonly string[], sep = '/'): PathTree {
  const root: PathTree = { name: '', children: [] }
  for (const p of paths) {
    let node = root
    for (const part of p.split(sep).map((s) => s.trim()).filter(Boolean)) {
      node.children ??= []
      let c = node.children.find((x) => x.name === part)
      if (!c) { c = { name: part }; node.children.push(c) }
      node = c
    }
  }
  return root
}

/**
 * The hierarchy nodes a bundled edge passes through: from the source up to the lowest common ancestor and down to the target
 * (d3's `source.path(target)`). The edge curve is a bundle (B-spline) through these nodes, so connections follow the hierarchy.
 */
export function bundlePath<T>(root: d3.HierarchyNode<T>, a: string, b: string, key: (n: d3.HierarchyNode<T>) => string): d3.HierarchyNode<T>[] | null {
  const leaves = new Map(root.leaves().map((n) => [key(n), n]))
  const s = leaves.get(a)
  const t = leaves.get(b)
  return s && t ? s.path(t) : null
}
