export interface FlowRow { fromStage: string; toStage: string; from: string; to: string; value: number; row: number }

export interface AlNode {
  key: string
  stage: number
  stageName: string
  name: string
  inflow: number
  outflow: number
  /** Drawn size: the larger of what comes in and what goes out. */
  value: number
  x0: number
  x1: number
  y0: number
  y1: number
}

export interface AlLink {
  id: string
  source: string
  target: string
  fromName: string
  toName: string
  value: number
  rows: number[]
  /** Top edge of the ribbon where it leaves the source node and where it enters the target node. */
  sy: number
  ty: number
  width: number
}

export interface Alluvial {
  stages: string[]
  nodes: AlNode[]
  links: AlLink[]
  /** Flows that were skipped because they jump over a stage, run backwards, or have no positive value. */
  issues: string[]
  /** Interior nodes whose inflow and outflow differ — people appearing or disappearing between stages. */
  imbalanced: { key: string; inflow: number; outflow: number }[]
  /** Pixels per unit of value (the same in every column). */
  scale: number
}

export interface AlluvialOptions {
  width: number
  height: number
  nodeWidth: number
  nodePad: number
  order: 'data' | 'size'
}

const nodeKey = (stage: number, name: string) => `${stage}\u0000${name}`

/**
 * Alluvial layout. Stages are columns in order of first appearance; every flow must go from one stage to the next.
 * A node is sized by the larger of its inflow and outflow and all columns share one scale, so a flow's ribbon keeps
 * the same thickness at both ends and the total in each column can be compared.
 */
export function buildAlluvial(rows: readonly FlowRow[], { width, height, nodeWidth, nodePad, order }: AlluvialOptions): Alluvial {
  const stages: string[] = []
  const issues: string[] = []
  for (const r of rows) for (const s of [r.fromStage, r.toStage]) if (s && !stages.includes(s)) stages.push(s)
  const valid = rows.filter((r) => {
    const a = stages.indexOf(r.fromStage)
    const b = stages.indexOf(r.toStage)
    if (!(r.value > 0)) { issues.push(`${r.row + 1}행: 값이 0 이하라 제외했습니다.`); return false }
    if (!r.from || !r.to || a < 0 || b < 0) { issues.push(`${r.row + 1}행: 단계나 범주가 비어 있어 제외했습니다.`); return false }
    if (b !== a + 1) { issues.push(`${r.row + 1}행: ‘${r.fromStage}’에서 ‘${r.toStage}’로 이어지지 않는 흐름(바로 다음 단계만 가능)이라 제외했습니다.`); return false }
    return true
  })

  const nodeMap = new Map<string, AlNode>()
  const ensure = (stage: number, name: string) => {
    const key = nodeKey(stage, name)
    let n = nodeMap.get(key)
    if (!n) { n = { key, stage, stageName: stages[stage], name, inflow: 0, outflow: 0, value: 0, x0: 0, x1: 0, y0: 0, y1: 0 }; nodeMap.set(key, n) }
    return n
  }
  const merged = new Map<string, AlLink>()
  for (const r of valid) {
    const a = stages.indexOf(r.fromStage)
    const s = ensure(a, r.from)
    const t = ensure(a + 1, r.to)
    s.outflow += r.value
    t.inflow += r.value
    const id = `${s.key}\u0001${t.key}`
    const l = merged.get(id)
    if (l) { l.value += r.value; l.rows.push(r.row) } else merged.set(id, { id, source: s.key, target: t.key, fromName: r.from, toName: r.to, value: r.value, rows: [r.row], sy: 0, ty: 0, width: 0 })
  }
  const nodes = [...nodeMap.values()]
  for (const n of nodes) n.value = Math.max(n.inflow, n.outflow)

  // Order the nodes of every column.
  const firstSeen = new Map<string, number>()
  nodes.forEach((n, i) => { if (!firstSeen.has(n.name)) firstSeen.set(n.name, i) })
  const byStage = stages.map((_, s) => nodes.filter((n) => n.stage === s).sort((a, b) => (order === 'size' ? b.value - a.value : (firstSeen.get(a.name) ?? 0) - (firstSeen.get(b.name) ?? 0))))

  const totals = byStage.map((col) => col.reduce((sum, n) => sum + n.value, 0))
  const widest = Math.max(0, ...byStage.map((c) => c.length - 1))
  const maxTotal = Math.max(1e-9, ...totals)
  const scale = Math.max(0, (height - widest * nodePad) / maxTotal)
  const colX = (s: number) => (stages.length > 1 ? (s * (width - nodeWidth)) / (stages.length - 1) : 0)
  byStage.forEach((col, s) => {
    const used = totals[s] * scale + (col.length - 1) * nodePad
    let y = Math.max(0, (height - used) / 2)
    for (const n of col) {
      n.x0 = colX(s)
      n.x1 = colX(s) + nodeWidth
      n.y0 = y
      n.y1 = y + n.value * scale
      y = n.y1 + nodePad
    }
  })

  const index = new Map<string, number>()
  byStage.forEach((col) => col.forEach((n, i) => index.set(n.key, i)))
  const links = [...merged.values()]
  for (const l of links) l.width = l.value * scale
  const outCursor = new Map<string, number>()
  const inCursor = new Map<string, number>()
  for (const n of nodes) { outCursor.set(n.key, n.y0); inCursor.set(n.key, n.y0) }
  // Leave each node by the target order and enter by the source order, so ribbons never cross inside a node.
  for (const l of [...links].sort((a, b) => index.get(a.target)! - index.get(b.target)!)) { l.sy = outCursor.get(l.source)!; outCursor.set(l.source, l.sy + l.width) }
  for (const l of [...links].sort((a, b) => index.get(a.source)! - index.get(b.source)!)) { l.ty = inCursor.get(l.target)!; inCursor.set(l.target, l.ty + l.width) }

  const imbalanced = nodes.filter((n) => n.stage > 0 && n.stage < stages.length - 1 && Math.abs(n.inflow - n.outflow) > 1e-9).map((n) => ({ key: n.key, inflow: n.inflow, outflow: n.outflow }))
  return { stages, nodes, links, issues, imbalanced, scale }
}

/** Total flow leaving each stage (the population carried from one stage to the next). */
export function stageTotals(a: Alluvial) {
  return a.stages.map((_, s) => a.nodes.filter((n) => n.stage === s).reduce((sum, n) => sum + Math.max(n.inflow, n.outflow), 0))
}
