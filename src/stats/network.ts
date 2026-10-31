import * as d3 from 'd3'

export interface EdgeRow { source: string; target: string; weight: number | null; group: string; row: number }

export interface NetNode { id: string; group: string; degree: number; strength: number; component: number; rows: number[]; /** Edges leaving / arriving (directed graphs; for undirected ones both count every incident edge). */ outDeg: number; inDeg: number }
export interface NetLink { source: string; target: string; weight: number; rows: number[] }

export interface Network {
  nodes: NetNode[]
  links: NetLink[]
  /** Edges from a node to itself (not drawn) and rows that could not be used (no source, or a weight ≤ 0). */
  selfLoops: number
  skipped: number
}

/**
 * Builds nodes and weighted undirected edges from edge rows. A row with an empty target declares an isolated node;
 * duplicate edges (A–B and B–A included) are merged by summing their weights; a missing weight counts as 1.
 */
export function buildNetwork(rows: readonly EdgeRow[], { directed = false }: { directed?: boolean } = {}): Network {
  const nodes = new Map<string, NetNode>()
  const links = new Map<string, NetLink>()
  let selfLoops = 0
  let skipped = 0
  const node = (id: string, group: string, row: number) => {
    let n = nodes.get(id)
    if (!n) { n = { id, group, degree: 0, strength: 0, component: -1, rows: [], outDeg: 0, inDeg: 0 }; nodes.set(id, n) }
    if (!n.group && group) n.group = group
    n.rows.push(row)
    return n
  }
  for (const r of rows) {
    const s = r.source.trim()
    const t = r.target.trim()
    if (!s) { skipped++; continue }
    const w = r.weight ?? 1
    if (!(w > 0)) { skipped++; continue }
    node(s, r.group, r.row)
    if (!t) continue
    if (s === t) { selfLoops++; continue }
    node(t, '', r.row)
    // Undirected: A–B and B–A are one edge. Directed: they are two.
    const [a, b] = directed || s < t ? [s, t] : [t, s]
    const key = `${a}\u0000${b}`
    const link = links.get(key)
    if (link) { link.weight += w; link.rows.push(r.row) } else links.set(key, { source: s, target: t, weight: w, rows: [r.row] })
  }
  for (const l of links.values()) {
    for (const id of [l.source, l.target]) { const n = nodes.get(id)!; n.degree++; n.strength += l.weight }
    nodes.get(l.source)!.outDeg++
    nodes.get(l.target)!.inDeg++
    if (!directed) { nodes.get(l.source)!.inDeg++; nodes.get(l.target)!.outDeg++ }
  }
  // Connected components by union–find.
  const parent = new Map<string, string>([...nodes.keys()].map((k) => [k, k]))
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r }
  for (const l of links.values()) parent.set(find(l.source), find(l.target))
  const ids = new Map<string, number>()
  for (const n of nodes.values()) {
    const root = find(n.id)
    if (!ids.has(root)) ids.set(root, ids.size)
    n.component = ids.get(root)!
  }
  return { nodes: [...nodes.values()], links: [...links.values()], selfLoops, skipped }
}

export interface ForceOptions {
  width: number
  height: number
  /** Resting length of an average edge in px. */
  linkDistance: number
  /** Strength multiplier of the springs along edges (0 disables them). */
  linkStrength: number
  /** Repulsion between all node pairs. */
  charge: number
  /** Pull toward the centre. */
  gravity: number
  /** Node radius used to keep nodes from overlapping. */
  radius: number
}

export interface SimNode extends d3.SimulationNodeDatum { id: string }

/** Creates (but does not start) a force simulation over copies of the nodes and links; positions are written to the returned nodes. */
export function createSimulation(net: Network, opts: ForceOptions, previous?: ReadonlyMap<string, { x: number; y: number }>) {
  const wmax = Math.max(1e-9, ...net.links.map((l) => l.weight))
  const nodes: SimNode[] = net.nodes.map((n, i) => {
    const prev = previous?.get(n.id)
    // Without a previous position, start on a spiral so the run is deterministic.
    const a = i * 2.399963
    const r = 12 * Math.sqrt(i + 1)
    return { id: n.id, x: prev?.x ?? opts.width / 2 + r * Math.cos(a), y: prev?.y ?? opts.height / 2 + r * Math.sin(a) }
  })
  const links = net.links.map((l) => ({ source: l.source, target: l.target, weight: l.weight }))
  const sim = d3.forceSimulation<SimNode>(nodes)
    .force('link', d3.forceLink<SimNode, { source: string; target: string; weight: number }>(links).id((d) => d.id)
      .distance((l) => opts.linkDistance * (1.25 - 0.5 * (l.weight / wmax)))
      .strength((l) => Math.min(1, opts.linkStrength * (0.25 + 0.75 * (l.weight / wmax)))))
    .force('charge', d3.forceManyBody().strength(-opts.charge))
    .force('x', d3.forceX(opts.width / 2).strength(opts.gravity))
    .force('y', d3.forceY(opts.height / 2).strength(opts.gravity))
    .force('collide', d3.forceCollide(opts.radius + 2))
    .force('bounds', () => {
      // Keep every node inside the drawing area: in a small pane the repulsion would otherwise push nodes out of view.
      const pad = opts.radius + 4
      for (const n of nodes) {
        n.x = Math.max(pad, Math.min(opts.width - pad, n.x ?? 0))
        n.y = Math.max(pad, Math.min(opts.height - pad, n.y ?? 0))
      }
    })
    .stop()
  return { sim, nodes }
}

/** Runs the simulation synchronously and returns the settled positions. */
export function layoutNetwork(net: Network, opts: ForceOptions, ticks = 300, previous?: ReadonlyMap<string, { x: number; y: number }>) {
  const { sim, nodes } = createSimulation(net, opts, previous)
  for (let i = 0; i < ticks; i++) sim.tick()
  return new Map(nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]))
}
