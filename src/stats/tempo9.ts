export type Pt = [number, number]

// ───────────────────────────── PAOHvis ─────────────────────────────

export interface HyperEdge { time: number; id: string; members: string[] }
export type PaohOrder = 'first' | 'degree' | 'name' | 'barycenter'
export interface PaohColumn {
  time: number
  /** Row indexes (into `nodes`) of the members, ascending. */
  rows: number[]
  /** Hyperedge ids merged into this column (identical membership at the same time). */
  ids: string[]
  count: number
}
export interface PaohLayout {
  nodes: string[]
  columns: PaohColumn[]
  times: number[]
  /** Sum over columns of (lowest row − highest row): the length of all hyperedge lines. */
  span: number
}

/** Parallel Aggregated Ordered hypergraph layout: vertices are rows, every hyperedge is a vertical line in a column of its time slot. */
export function paoh(edges: readonly HyperEdge[], order: PaohOrder, timeRange?: [number, number]): PaohLayout {
  const kept = edges.filter((e) => (!timeRange || (e.time >= timeRange[0] && e.time <= timeRange[1])) && new Set(e.members).size >= 1)
  const times = [...new Set(kept.map((e) => e.time))].sort((a, b) => a - b)
  const names: string[] = []
  const firstSeen = new Map<string, number>()
  const degree = new Map<string, number>()
  for (const e of [...kept].sort((a, b) => a.time - b.time)) for (const m of new Set(e.members)) {
    if (!firstSeen.has(m)) { firstSeen.set(m, names.length); names.push(m) }
    degree.set(m, (degree.get(m) ?? 0) + 1)
  }
  // aggregate identical memberships within a time slot
  const agg = new Map<string, { time: number; members: string[]; ids: string[] }>()
  for (const e of kept) {
    const members = [...new Set(e.members)].sort()
    const key = `${e.time}|${members.join('\u0001')}`
    const cur = agg.get(key)
    if (cur) cur.ids.push(e.id)
    else agg.set(key, { time: e.time, members, ids: [e.id] })
  }
  const groups = [...agg.values()]
  let nodes = [...names]
  if (order === 'degree') nodes.sort((a, b) => (degree.get(b)! - degree.get(a)!) || (firstSeen.get(a)! - firstSeen.get(b)!))
  else if (order === 'name') nodes.sort((a, b) => a.localeCompare(b, 'ko'))
  else if (order === 'barycenter') {
    // repeatedly move each vertex to the mean position of the vertices it shares hyperedges with
    for (let it = 0; it < 12; it++) {
      const pos = new Map(nodes.map((n, i) => [n, i]))
      const sum = new Map<string, number>(), w = new Map<string, number>()
      for (const g of groups) {
        const wt = g.ids.length / Math.max(1, g.members.length - 1) ** 2 // small hyperedges say more about who belongs together
        for (const m of g.members) for (const o of g.members) {
          if (o === m) continue
          sum.set(m, (sum.get(m) ?? 0) + pos.get(o)! * wt); w.set(m, (w.get(m) ?? 0) + wt)
        }
      }
      const score = new Map(nodes.map((n) => [n, w.get(n) ? sum.get(n)! / w.get(n)! : pos.get(n)!]))
      nodes = [...nodes].sort((a, b) => (score.get(a)! - score.get(b)!) || (pos.get(a)! - pos.get(b)!))
    }
  }
  const row = new Map(nodes.map((n, i) => [n, i]))
  const columns: PaohColumn[] = groups
    .map((g) => ({ time: g.time, rows: g.members.map((m) => row.get(m)!).sort((a, b) => a - b), ids: g.ids, count: g.ids.length }))
    .sort((a, b) => (a.time - b.time) || (a.rows[0] - b.rows[0]) || (b.rows.length - a.rows.length))
  const span = columns.reduce((a, c) => a + (c.rows[c.rows.length - 1] - c.rows[0]), 0)
  return { nodes, columns, times, span }
}

// ───────────────────────────── Set Streams ─────────────────────────────

export interface MembershipRecord { item: string; time: number; set: string }
export interface StreamCombo { key: string; sets: number[] }
export interface StreamFlow { from: number; to: number; n: number; items: string[] }
export interface SetStreamsModel {
  setNames: string[]
  times: number[]
  items: string[]
  /** Combinations in vertical order (rows); the empty combination (in no set) is always last when present. */
  combos: StreamCombo[]
  /** counts[c][t]: items whose membership at time t is exactly combination c. */
  counts: number[][]
  /** flows[t]: movements of items from time t to time t+1 between combinations. */
  flows: StreamFlow[][]
  /** combination index of every item at every time (rows aligned to `items`). */
  at: number[][]
}

/** Dynamic overlapping sets: every item has, at every time, a combination of sets; rows are combinations and ribbons carry items from one time to the next. */
export function setStreams(records: readonly MembershipRecord[], timeRange?: [number, number]): SetStreamsModel {
  const rec = records.filter((r) => !timeRange || (r.time >= timeRange[0] && r.time <= timeRange[1]))
  const setNames = [...new Set(rec.map((r) => r.set))]
  const times = [...new Set(rec.map((r) => r.time))].sort((a, b) => a - b)
  const items = [...new Set(rec.map((r) => r.item))]
  const sIdx = new Map(setNames.map((s, i) => [s, i]))
  const tIdx = new Map(times.map((t, i) => [t, i]))
  const iIdx = new Map(items.map((s, i) => [s, i]))
  const mask: number[][] = items.map(() => times.map(() => 0))
  for (const r of rec) mask[iIdx.get(r.item)!][tIdx.get(r.time)!] |= 1 << sIdx.get(r.set)!
  const keys = [...new Set(mask.flat())]
  const deg = (m: number) => m.toString(2).split('1').length - 1
  let order = keys.sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : deg(a) - deg(b) || a - b))
  const tmp = (): { counts: Map<number, number[]> } => {
    const counts = new Map<number, number[]>(keys.map((k) => [k, times.map(() => 0)]))
    mask.forEach((row) => row.forEach((m, t) => { counts.get(m)![t]++ }))
    return { counts }
  }
  const { counts: cm } = tmp()
  // flows between consecutive times
  const flowMap: Map<string, StreamFlow>[] = times.slice(1).map(() => new Map())
  items.forEach((it, i) => {
    for (let t = 0; t < times.length - 1; t++) {
      const k = `${mask[i][t]}>${mask[i][t + 1]}`
      const f = flowMap[t].get(k) ?? { from: mask[i][t], to: mask[i][t + 1], n: 0, items: [] }
      f.n++; f.items.push(it)
      flowMap[t].set(k, f)
    }
  })
  // barycentre sweeps: rows are pulled toward the rows of the combinations their items move to
  for (let it = 0; it < 6; it++) {
    const pos = new Map(order.map((m, i) => [m, i]))
    const sum = new Map<number, number>(), w = new Map<number, number>()
    for (const fm of flowMap) for (const f of fm.values()) {
      if (f.from === f.to) continue
      sum.set(f.from, (sum.get(f.from) ?? 0) + pos.get(f.to)! * f.n); w.set(f.from, (w.get(f.from) ?? 0) + f.n)
      sum.set(f.to, (sum.get(f.to) ?? 0) + pos.get(f.from)! * f.n); w.set(f.to, (w.get(f.to) ?? 0) + f.n)
    }
    const score = (m: number) => (m === 0 ? 1e9 : w.get(m) ? (0.5 * sum.get(m)!) / w.get(m)! + 0.5 * pos.get(m)! : pos.get(m)!)
    order = [...order].sort((a, b) => score(a) - score(b))
  }
  const rowOf = new Map(order.map((m, i) => [m, i]))
  const combos = order.map((m) => ({ key: String(m), sets: setNames.map((_, s) => s).filter((s) => m & (1 << s)) }))
  return {
    setNames, times, items, combos,
    counts: order.map((m) => cm.get(m)!),
    flows: flowMap.map((fm) => [...fm.values()].map((f) => ({ from: rowOf.get(f.from)!, to: rowOf.get(f.to)!, n: f.n, items: f.items })).sort((a, b) => a.from - b.from || a.to - b.to)),
    at: mask.map((row) => row.map((m) => rowOf.get(m)!)),
  }
}

// ───────────────────────────── Sequence Braiding ─────────────────────────────

export interface EventRecord { entity: string; order: number; event: string; group: string }
export interface BraidNode { type: string; layer: number; /** vertical rank inside the layer */ rank: number; visits: number; repeats: number }
export interface BraidStrand { entity: string; group: string; /** node indexes along the (repeat-collapsed) sequence */ path: number[]; /** how many times each step repeated consecutively */ reps: number[] }
export interface BraidModel {
  nodes: BraidNode[]
  strands: BraidStrand[]
  groups: string[]
  layers: number
  /** per node: strands listed in the order they are stacked inside it, as [strand, step index] */
  slots: [number, number][][]
  crossings: number
}

/**
 * Layered DAG of event types (nodes) with every entity's sequence as a strand braided through the nodes. Strands stay grouped by their
 * attribute and are ordered inside nodes so that strands leaving toward the same next node stay together.
 */
export function braid(records: readonly EventRecord[], sortBy: 'group' | 'path' | 'entity' = 'path'): BraidModel {
  const byEntity = new Map<string, EventRecord[]>()
  for (const r of records) byEntity.set(r.entity, [...(byEntity.get(r.entity) ?? []), r])
  const entities = [...byEntity.keys()]
  const seqs = entities.map((e) => byEntity.get(e)!.sort((a, b) => a.order - b.order))
  const groups = [...new Set(seqs.map((s) => s[0].group))].sort((a, b) => a.localeCompare(b, 'ko'))
  // collapse consecutive repeats
  const collapsed = seqs.map((s) => {
    const ev: string[] = [], reps: number[] = []
    for (const r of s) { if (ev.length && ev[ev.length - 1] === r.event) reps[reps.length - 1]++; else { ev.push(r.event); reps.push(1) } }
    return { ev, reps }
  })
  const types = [...new Set(collapsed.flatMap((c) => c.ev))]
  // global order: mean normalised position of the type along the sequences that contain it
  const pos = new Map<string, number[]>()
  collapsed.forEach((c) => c.ev.forEach((t, i) => pos.set(t, [...(pos.get(t) ?? []), c.ev.length > 1 ? i / (c.ev.length - 1) : 0])))
  const rank = new Map(types.map((t) => [t, pos.get(t)!.reduce((a, b) => a + b, 0) / pos.get(t)!.length]))
  const sortedTypes = [...types].sort((a, b) => rank.get(a)! - rank.get(b)! || a.localeCompare(b, 'ko'))
  const tIdx = new Map(sortedTypes.map((t, i) => [t, i]))
  // layering: longest path over the forward transitions
  const fwd = new Map<string, Set<string>>()
  collapsed.forEach((c) => c.ev.slice(1).forEach((t, i) => { const f = c.ev[i]; if (tIdx.get(f)! < tIdx.get(t)!) fwd.set(f, new Set([...(fwd.get(f) ?? []), t])) }))
  const layer = new Map<string, number>(sortedTypes.map((t) => [t, 0]))
  for (const t of sortedTypes) for (const to of fwd.get(t) ?? []) layer.set(to, Math.max(layer.get(to)!, layer.get(t)! + 1))
  const layers = Math.max(0, ...layer.values()) + 1
  // order inside layers: barycentre of strand neighbours, three sweeps
  const inLayer: string[][] = Array.from({ length: layers }, () => [])
  sortedTypes.forEach((t) => inLayer[layer.get(t)!].push(t))
  const yOf = new Map<string, number>()
  inLayer.forEach((l) => l.forEach((t, i) => yOf.set(t, i)))
  for (let sweep = 0; sweep < 4; sweep++) for (let li = 0; li < layers; li++) {
    const score = new Map<string, number>()
    for (const t of inLayer[li]) {
      let s = 0, w = 0
      collapsed.forEach((c) => c.ev.forEach((e, i) => { if (e !== t) return; for (const j of [i - 1, i + 1]) if (c.ev[j] !== undefined && layer.get(c.ev[j]) !== li) { s += yOf.get(c.ev[j])!; w++ } }))
      score.set(t, w ? s / w : yOf.get(t)!)
    }
    inLayer[li].sort((a, b) => score.get(a)! - score.get(b)! || yOf.get(a)! - yOf.get(b)!)
    inLayer[li].forEach((t, i) => yOf.set(t, i))
  }
  const nodes: BraidNode[] = []
  const nIdx = new Map<string, number>()
  inLayer.forEach((l, li) => l.forEach((t, i) => { nIdx.set(t, nodes.length); nodes.push({ type: t, layer: li, rank: i, visits: 0, repeats: 0 }) }))
  const strands: BraidStrand[] = collapsed.map((c, i) => ({ entity: entities[i], group: seqs[i][0].group, path: c.ev.map((t) => nIdx.get(t)!), reps: c.reps }))
  strands.forEach((s) => s.path.forEach((n, i) => { nodes[n].visits++; nodes[n].repeats += s.reps[i] - 1 }))
  // slot order inside every node
  const slots: [number, number][][] = nodes.map(() => [])
  strands.forEach((s, si) => s.path.forEach((n, i) => slots[n].push([si, i])))
  const gIdx = new Map(groups.map((g, i) => [g, i]))
  const nextRank = (si: number, i: number) => { const n = strands[si].path[i + 1]; return n === undefined ? -1 : nodes[n].layer * 100 + nodes[n].rank }
  const prevRank = (si: number, i: number) => { const n = strands[si].path[i - 1]; return n === undefined ? -1 : nodes[n].layer * 100 + nodes[n].rank }
  slots.forEach((list) => list.sort((a, b) => {
    if (sortBy === 'entity') return a[0] - b[0]
    const g = gIdx.get(strands[a[0]].group)! - gIdx.get(strands[b[0]].group)!
    if (sortBy === 'group') return g || a[0] - b[0]
    return g || prevRank(a[0], a[1]) - prevRank(b[0], b[1]) || nextRank(a[0], a[1]) - nextRank(b[0], b[1]) || a[0] - b[0]
  }))
  // crossings: pairs of strand segments between the same two nodes' slots that swap order (computed per directed edge pair of consecutive visits)
  const yslot = (n: number, si: number, i: number) => {
    // vertical position of a strand inside a node column: cumulative visits of the nodes ranked above in the layer plus the slot index
    let above = 0
    nodes.forEach((o) => { if (o.layer === nodes[n].layer && o.rank < nodes[n].rank) above += o.visits })
    return above + slots[n].findIndex(([s, k]) => s === si && k === i) + nodes[n].rank * 2
  }
  const segs: { l: number; y0: number; y1: number }[] = []
  strands.forEach((s, si) => { for (let i = 0; i < s.path.length - 1; i++) { const a = s.path[i], b = s.path[i + 1]; if (nodes[b].layer === nodes[a].layer + 1) segs.push({ l: nodes[a].layer, y0: yslot(a, si, i), y1: yslot(b, si, i + 1) }) } })
  let crossings = 0
  const byLayer = new Map<number, { y0: number; y1: number }[]>()
  segs.forEach((g) => byLayer.set(g.l, [...(byLayer.get(g.l) ?? []), g]))
  for (const list of byLayer.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if ((list[i].y0 - list[j].y0) * (list[i].y1 - list[j].y1) < 0) crossings++
  return { nodes, strands, groups, layers, slots, crossings }
}
