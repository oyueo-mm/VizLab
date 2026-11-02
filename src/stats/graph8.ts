/**
 * Engines of the v0.8 network techniques: Power Graph (flat biclique / clique decomposition), Confluent Drawing (tracks over the
 * same decomposition) and the block layout of NodeTrix.
 */
import * as d3 from 'd3'

export type Edge = [number, number]
export type Pt = [number, number]

const key = (a: number, b: number) => (a < b ? a * 100000 + b : b * 100000 + a)

/** Distinct undirected edges without self loops, each as [min, max]. */
export function uniqueEdges(edges: readonly Edge[]): Edge[] {
  const seen = new Set<number>()
  const out: Edge[] = []
  for (const [a, b] of edges) {
    if (a === b) continue
    const k = key(a, b)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(a < b ? [a, b] : [b, a])
  }
  return out
}

// ───────────────────────────── Power Graph ─────────────────────────────

export interface PowerGroup { members: number[]; /** Every pair inside the group is connected (a clique power node). */ clique: boolean }
export interface PowerGraph {
  groups: PowerGroup[]
  /** Power edges between two groups: every member of a is connected to every member of b (a === b for a clique). */
  powerEdges: { a: number; b: number }[]
  /** Edges that are not covered by a power edge. */
  residual: Edge[]
  original: number
  /** Number of drawn connections: power edges + residual edges. */
  compressed: number
}

/**
 * Flat Power Graph decomposition (after Royer et al. 2008): greedily finds bicliques X×N and cliques whose edges are replaced by one power
 * edge between two power nodes. The search takes the candidate with the largest saving (|X||N| − 1, or k(k−1)/2 − 1 for a clique)
 * until no candidate saves `minGain` edges. In this version power nodes are disjoint (the original algorithm also allows nesting).
 */
export function powerGraph(n: number, edges: readonly Edge[], minGain = 3): PowerGraph {
  const E = uniqueEdges(edges)
  const R: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false))
  for (const [a, b] of E) { R[a][b] = true; R[b][a] = true }
  const taken = new Array<boolean>(n).fill(false)
  const groups: PowerGroup[] = []
  const powerEdges: { a: number; b: number }[] = []
  const free = (v: number) => !taken[v]
  const nbrs = (v: number) => { const out: number[] = []; for (let w = 0; w < n; w++) if (R[v][w] && free(w)) out.push(w); return out }

  for (let guard = 0; guard < n * 2; guard++) {
    let best: { gain: number; kind: 'bi' | 'clique'; X: number[]; N: number[] } | null = null
    for (let u = 0; u < n; u++) {
      if (!free(u)) continue
      const nu = nbrs(u)
      for (let v = u + 1; v < n; v++) {
        if (!free(v)) continue
        // biclique seed: u and v with common neighbours
        let N = nu.filter((w) => w !== v && R[v][w])
        if (N.length >= 1) {
          let X = [u, v]
          for (let w = 0; w < n; w++) if (free(w) && w !== u && w !== v && !N.includes(w) && N.every((x) => R[w][x])) X.push(w)
          N = N.filter((x) => X.every((w) => R[w][x]))
          if (N.length) {
            // the common neighbourhood may have shrunk the group of sources: grow it once more
            X = [...new Set([...X, ...Array.from({ length: n }, (_, w) => w).filter((w) => free(w) && !N.includes(w) && N.every((x) => R[w][x]))])]
            const gain = X.length * N.length - 1
            if (X.length >= 2 && gain >= minGain && (!best || gain > best.gain)) best = { gain, kind: 'bi', X, N }
          }
        }
        // clique seed grown greedily from an edge
        if (R[u][v]) {
          const C = [u, v]
          let cand = nu.filter((w) => w !== v && R[v][w])
          while (cand.length) {
            const pick = cand.reduce((b, w) => (cand.filter((x) => R[w][x]).length > cand.filter((x) => R[b][x]).length ? w : b), cand[0])
            C.push(pick)
            cand = cand.filter((x) => x !== pick && R[pick][x])
          }
          const gain = (C.length * (C.length - 1)) / 2 - 1
          if (C.length >= 3 && gain >= minGain && (!best || gain > best.gain)) best = { gain, kind: 'clique', X: C, N: [] }
        }
      }
    }
    if (!best) break
    if (best.kind === 'clique') {
      const gi = groups.length
      groups.push({ members: [...best.X].sort((a, b) => a - b), clique: true })
      powerEdges.push({ a: gi, b: gi })
      for (const a of best.X) { taken[a] = true; for (const b of best.X) if (a !== b) R[a][b] = false }
    } else {
      const ga = groups.length
      groups.push({ members: [...best.X].sort((a, b) => a - b), clique: false })
      groups.push({ members: [...best.N].sort((a, b) => a - b), clique: false })
      powerEdges.push({ a: ga, b: ga + 1 })
      for (const a of best.X) for (const b of best.N) { R[a][b] = false; R[b][a] = false }
      for (const v of [...best.X, ...best.N]) taken[v] = true
    }
  }
  const residual: Edge[] = []
  for (const [a, b] of E) if (R[a][b]) residual.push([a, b])
  return { groups, powerEdges, residual, original: E.length, compressed: powerEdges.length + residual.length }
}

/** The edges that the power edges and residual edges stand for (sorted, distinct). */
export function expandPowerGraph(pg: Pick<PowerGraph, 'groups' | 'powerEdges' | 'residual'>): Edge[] {
  const out: Edge[] = [...pg.residual]
  for (const { a, b } of pg.powerEdges) {
    const A = pg.groups[a].members, B = pg.groups[b].members
    if (a === b) { for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) out.push([A[i], A[j]]) }
    else for (const x of A) for (const y of B) out.push([Math.min(x, y), Math.max(x, y)])
  }
  return uniqueEdges(out).sort((p, q) => p[0] - q[0] || p[1] - q[1])
}

// ───────────────────────────── Confluent Drawing ─────────────────────────────

export interface ConfluentTrack {
  /** Nodes on the two ends of the track; every `from` node is connected to every `to` node (a clique has a single end set). */
  from: number[]
  to: number[]
  clique: boolean
  /** Junction points (two for a biclique, one hub for a clique). */
  junctions: Pt[]
}

const centroid = (idx: number[], P: Pt[]): Pt => [d3.mean(idx, (i) => P[i][0])!, d3.mean(idx, (i) => P[i][1])!]

/**
 * Confluent drawing over a power-graph decomposition: every biclique is drawn as a trunk with a junction at each end, the member curves
 * merge smoothly into the junction, so the edges can still be read as smooth paths from node to node (Dickerson et al. 2005, simplified:
 * the decomposition is the greedy flat one, not an optimal confluent drawing).
 */
export function confluentTracks(pg: PowerGraph, P: Pt[], trunk = 0.3): ConfluentTrack[] {
  return pg.powerEdges.map(({ a, b }) => {
    const A = pg.groups[a].members
    if (a === b) return { from: A, to: A, clique: true, junctions: [centroid(A, P)] }
    const B = pg.groups[b].members
    const ca = centroid(A, P), cb = centroid(B, P)
    const dx = cb[0] - ca[0], dy = cb[1] - ca[1]
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len, uy = dy / len
    const mid: Pt = [(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2]
    const half = Math.min(80, len * trunk) / 2
    return { from: A, to: B, clique: false, junctions: [[mid[0] - ux * half, mid[1] - uy * half], [mid[0] + ux * half, mid[1] + uy * half]] }
  })
}

/** Edges that the tracks stand for; equals the biclique / clique part of the original graph. */
export function expandTracks(tracks: readonly ConfluentTrack[]): Edge[] {
  const out: Edge[] = []
  for (const t of tracks) {
    if (t.clique) { for (let i = 0; i < t.from.length; i++) for (let j = i + 1; j < t.from.length; j++) out.push([t.from[i], t.from[j]]) }
    else for (const x of t.from) for (const y of t.to) out.push([Math.min(x, y), Math.max(x, y)])
  }
  return uniqueEdges(out).sort((p, q) => p[0] - q[0] || p[1] - q[1])
}

/** SVG path from a node to a junction; the curve leaves the node towards the junction and arrives along the trunk direction. */
export function trackCurve(from: Pt, junction: Pt, trunkDir: Pt, arrive = 0.45): string {
  const d = Math.hypot(junction[0] - from[0], junction[1] - from[1])
  const c1: Pt = [from[0] + (junction[0] - from[0]) * arrive, from[1] + (junction[1] - from[1]) * arrive]
  const c2: Pt = [junction[0] - trunkDir[0] * d * arrive, junction[1] - trunkDir[1] * d * arrive]
  return `M${from[0]},${from[1]}C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${junction[0]},${junction[1]}`
}

// ───────────────────────────── NodeTrix ─────────────────────────────

export interface Block { group: number; members: number[]; x: number; y: number; size: number }

/** Orders the members of a block by how many neighbours they have inside the block (hubs first), a simple matrix ordering. */
export function orderBlock(members: number[], edges: readonly Edge[]): number[] {
  const inside = new Set(members)
  const deg = new Map<number, number>(members.map((m) => [m, 0]))
  for (const [a, b] of edges) if (inside.has(a) && inside.has(b)) { deg.set(a, deg.get(a)! + 1); deg.set(b, deg.get(b)! + 1) }
  return [...members].sort((a, b) => deg.get(b)! - deg.get(a)! || a - b)
}

/**
 * Places the blocks (communities) of a NodeTrix drawing: a force layout on the quotient graph where every block is a disc as large as its
 * matrix, linked blocks attract in proportion to the number of edges between them.
 */
export function blockLayout(sizes: number[], weight: number[][], width: number, height: number, ticks = 300): Pt[] {
  const nodes = sizes.map((s, i) => ({ i, r: s * 0.75 + 10, x: width / 2 + Math.cos((i / sizes.length) * 2 * Math.PI) * 40, y: height / 2 + Math.sin((i / sizes.length) * 2 * Math.PI) * 40 }))
  const links: { source: number; target: number; w: number }[] = []
  for (let a = 0; a < sizes.length; a++) for (let b = a + 1; b < sizes.length; b++) if (weight[a][b] > 0) links.push({ source: a, target: b, w: weight[a][b] })
  const sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink<(typeof nodes)[number], (typeof links)[number]>(links).id((d) => d.i).distance((l) => (((l.source as unknown as { r: number }).r) + ((l.target as unknown as { r: number }).r)) * 1.2 + 30).strength((l) => Math.min(0.6, 0.1 + l.w * 0.04)))
    .force('charge', d3.forceManyBody().strength(-60))
    .force('collide', d3.forceCollide<(typeof nodes)[number]>().radius((d) => d.r + 6).strength(1))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .stop()
  for (let t = 0; t < ticks; t++) sim.tick()
  // keep every block (and its header) inside the drawing area
  return nodes.map((n) => { const h = sizes[n.i] / 2 + 14; return [Math.max(h, Math.min(width - h, n.x)), Math.max(h + 12, Math.min(height - h, n.y))] as Pt })
}

/**
 * Where a link between a node of block `from` and the block at `toward` leaves the matrix: on the side facing the other block, at the
 * row (left / right side) or column (top / bottom side) of the node.
 */
export function attachPoint(block: { x: number; y: number; size: number }, index: number, count: number, toward: Pt): Pt {
  const half = block.size / 2
  const cell = block.size / Math.max(1, count)
  const dx = toward[0] - block.x, dy = toward[1] - block.y
  if (Math.abs(dx) >= Math.abs(dy)) return [block.x + Math.sign(dx || 1) * half, block.y - half + (index + 0.5) * cell]
  return [block.x - half + (index + 0.5) * cell, block.y + Math.sign(dy || 1) * half]
}

// ───────────────────────────── layout for Power Graph and Confluent Drawing ─────────────────────────────

export interface GroupLayout { pos: Pt[]; /** Disc of every group (same order as `PowerGraph.groups`). */ discs: { x: number; y: number; r: number }[] }

/**
 * Lays out the contracted graph: every power node is a disc and every node outside the groups a small disc, linked by the power edges and
 * residual edges; members then sit on a sunflower spiral inside their disc, so a group stays visually one piece.
 */
export function groupLayout(n: number, pg: PowerGraph, width: number, height: number, spacing = 20): GroupLayout {
  const groupOf = new Array<number>(n).fill(-1)
  pg.groups.forEach((g, gi) => g.members.forEach((m) => { groupOf[m] = gi }))
  // super nodes: groups first, then the nodes without a group
  const superOf = (v: number) => (groupOf[v] >= 0 ? groupOf[v] : pg.groups.length + v)
  const ids = new Map<number, number>()
  const sup: { key: number; r: number; x: number; y: number }[] = []
  const add = (key: number, r: number) => { if (!ids.has(key)) { ids.set(key, sup.length); sup.push({ key, r, x: 0, y: 0 }) } }
  pg.groups.forEach((g, gi) => add(gi, spacing * 0.62 * Math.sqrt(g.members.length) + spacing * 0.75))
  for (let v = 0; v < n; v++) if (groupOf[v] < 0) add(pg.groups.length + v, spacing * 0.55)
  sup.forEach((s, i) => { s.x = width / 2 + Math.cos(i * 2.399963) * (20 + 14 * Math.sqrt(i)); s.y = height / 2 + Math.sin(i * 2.399963) * (20 + 14 * Math.sqrt(i)) })
  const links: { source: number; target: number }[] = []
  const seen = new Set<number>()
  const link = (a: number, b: number) => {
    const sa = ids.get(superOf(a))!, sb = ids.get(superOf(b))!
    if (sa === sb) return
    const k = key(sa, sb)
    if (seen.has(k)) return
    seen.add(k)
    links.push({ source: sa, target: sb })
  }
  for (const { a, b } of pg.powerEdges) if (a !== b) link(pg.groups[a].members[0], pg.groups[b].members[0])
  for (const [a, b] of pg.residual) link(a, b)
  const sim = d3.forceSimulation(sup)
    .force('link', d3.forceLink<(typeof sup)[number], (typeof links)[number]>(links).distance((l) => (l.source as unknown as { r: number }).r + (l.target as unknown as { r: number }).r + spacing * 2.5).strength(0.35))
    .force('charge', d3.forceManyBody().strength(-90))
    .force('collide', d3.forceCollide<(typeof sup)[number]>().radius((d) => d.r + 10).strength(1))
    .force('x', d3.forceX(width / 2).strength(0.06))
    .force('y', d3.forceY(height / 2).strength(0.08))
    .stop()
  for (let t = 0; t < 320; t++) {
    sim.tick()
    for (const s of sup) { s.x = Math.max(s.r + 4, Math.min(width - s.r - 4, s.x)); s.y = Math.max(s.r + 4, Math.min(height - s.r - 4, s.y)) }
  }
  const pos: Pt[] = new Array<Pt>(n)
  const discs = pg.groups.map((_, gi) => { const s = sup[ids.get(gi)!]; return { x: s.x, y: s.y, r: s.r } })
  pg.groups.forEach((g, gi) => {
    const d = discs[gi]
    g.members.forEach((m, k) => {
      const rr = spacing * 0.62 * Math.sqrt(k + 0.5)
      pos[m] = g.members.length === 1 ? [d.x, d.y] : [d.x + rr * Math.cos(k * 2.399963), d.y + rr * Math.sin(k * 2.399963)]
    })
  })
  for (let v = 0; v < n; v++) if (groupOf[v] < 0) { const s = sup[ids.get(pg.groups.length + v)!]; pos[v] = [s.x, s.y] }
  return { pos, discs }
}
