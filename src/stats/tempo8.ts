/** Engines of the v0.8 event-sequence and time techniques: LifeFlow, Flowstrates and the lane assignment of TimeSets. */

// ───────────────────────────── LifeFlow ─────────────────────────────

export interface Seq { id: string; events: { type: string; t: number }[] }
export interface FlowNode {
  id: number
  type: string
  depth: number
  parent: number
  children: number[]
  /** Records that pass through this node. */
  count: number
  /** Records whose sequence ends here. */
  ended: number
  /** Mean time since the previous event of the record (0 for the first event). */
  meanGap: number
}

/**
 * LifeFlow (Wongsuphasawat et al. 2011): the event sequences of all records are merged into a prefix tree. Records that share the same first
 * k event types share the node at depth k; its count is how many records pass through, and the mean time since the previous event gives the
 * horizontal length of the segment. Sequences longer than `maxDepth` events are cut there (counted as ended).
 */
export function lifeFlow(seqs: readonly Seq[], maxDepth = 6): FlowNode[] {
  const nodes: FlowNode[] = [{ id: 0, type: '시작', depth: 0, parent: -1, children: [], count: seqs.length, ended: 0, meanGap: 0 }]
  const gapSum = new Map<number, number>()
  for (const s of seqs) {
    const ev = [...s.events].sort((a, b) => a.t - b.t).slice(0, maxDepth)
    let at = 0
    ev.forEach((e, k) => {
      let next = nodes[at].children.find((c) => nodes[c].type === e.type)
      if (next == null) {
        next = nodes.length
        nodes.push({ id: next, type: e.type, depth: at === 0 ? 1 : nodes[at].depth + 1, parent: at, children: [], count: 0, ended: 0, meanGap: 0 })
        nodes[at].children.push(next)
      }
      nodes[next].count++
      gapSum.set(next, (gapSum.get(next) ?? 0) + (k === 0 ? 0 : e.t - ev[k - 1].t))
      at = next
    })
    nodes[at].ended++
  }
  for (const n of nodes) if (n.id) n.meanGap = (gapSum.get(n.id) ?? 0) / n.count
  // children in descending count order, so that the biggest flow is on top
  for (const n of nodes) n.children.sort((a, b) => nodes[b].count - nodes[a].count || a - b)
  return nodes
}

/** True when the pattern occurs in the sequence as an ordered (not necessarily consecutive) subsequence of event types. */
export function matchesPattern(seq: Seq, pattern: readonly string[]): boolean {
  if (!pattern.length) return true
  const types = [...seq.events].sort((a, b) => a.t - b.t).map((e) => e.type)
  let k = 0
  for (const t of types) if (t === pattern[k] && ++k === pattern.length) return true
  return false
}

export interface FlowLayoutNode { id: number; x0: number; x1: number; y0: number; y1: number }

/** Stacks the prefix tree vertically (height ∝ count) and places each node after its parent, its length ∝ mean gap. */
export function lifeFlowLayout(nodes: readonly FlowNode[], width: number, height: number, gapPx = 3): FlowLayoutNode[] {
  const out = new Map<number, FlowLayoutNode>()
  const total = nodes[0].count || 1
  // total vertical extent needed: leaves stacked with gaps; scale so that the widest column fits
  const leaves = nodes.filter((n) => !n.children.length && n.id).length
  const unit = Math.max(0, (height - leaves * gapPx) / total)
  const maxX = Math.max(1e-9, ...nodes.map((n) => { let s = 0; for (let v = n.id; v > 0; v = nodes[v].parent) s += nodes[v].meanGap; return s }))
  const span = (width - 64) / maxX
  let cursor = 0
  const place = (id: number, x: number) => {
    const n = nodes[id]
    const x0 = x, x1 = x + n.meanGap * span + (id ? 10 : 0)
    // a node's own band starts at the top of its subtree and spans its count; children are stacked inside it
    const y0 = cursor
    const startCursor = cursor
    for (const c of n.children) place(c, x1)
    const y1 = Math.max(startCursor + n.count * unit, cursor)
    if (!n.children.length) cursor = y1 + gapPx
    out.set(id, { id, x0, x1, y0, y1 })
  }
  place(0, 0)
  return nodes.map((n) => out.get(n.id)!)
}

// ───────────────────────────── Flowstrates ─────────────────────────────

export interface OD { o: string; d: string; t: number; v: number }
export interface FlowLink { o: string; d: string; series: number[]; total: number }

/**
 * Flowstrates (Boyandin et al. 2011): the origin map on the left, the destination map on the right and between them one row per
 * origin–destination pair with a heatmap of its flow over time. Returns the rows (one per pair) with the series over the time points `times`.
 */
export function flowstrates(rows: readonly OD[], order: 'origin' | 'dest' | 'total', pos: ReadonlyMap<string, [number, number]>): { links: FlowLink[]; times: number[]; max: number } {
  const times = [...new Set(rows.map((r) => r.t))].sort((a, b) => a - b)
  const ti = new Map(times.map((t, i) => [t, i]))
  const m = new Map<string, FlowLink>()
  for (const r of rows) {
    const key = `${r.o}\u0001${r.d}`
    let l = m.get(key)
    if (!l) { l = { o: r.o, d: r.d, series: new Array<number>(times.length).fill(0), total: 0 }; m.set(key, l) }
    l.series[ti.get(r.t)!] += r.v
    l.total += r.v
  }
  const links = [...m.values()]
  const y = (id: string) => pos.get(id)?.[1] ?? 0
  links.sort((a, b) => (order === 'total' ? b.total - a.total : order === 'origin' ? y(a.o) - y(b.o) || y(a.d) - y(b.d) : y(a.d) - y(b.d) || y(a.o) - y(b.o)) || a.o.localeCompare(b.o) || a.d.localeCompare(b.d))
  return { links, times, max: Math.max(0, ...links.flatMap((l) => l.series)) }
}

// ───────────────────────────── TimeSets lanes ─────────────────────────────

/**
 * Assigns each event a lane (vertical slot) so events whose labels would overlap horizontally get different lanes: the events are taken in
 * time order and put into the first lane whose last event ends before this one starts (plus `gap`).
 */
export function assignLanes(starts: readonly number[], widths: readonly number[], gap = 6): { lane: number[]; lanes: number } {
  const order = starts.map((_, i) => i).sort((a, b) => starts[a] - starts[b] || a - b)
  const ends: number[] = []
  const lane = new Array<number>(starts.length).fill(0)
  for (const i of order) {
    const l = ends.findIndex((e) => e + gap <= starts[i])
    if (l >= 0) { lane[i] = l; ends[l] = starts[i] + widths[i] } else { lane[i] = ends.length; ends.push(starts[i] + widths[i]) }
  }
  return { lane, lanes: Math.max(1, ends.length) }
}
