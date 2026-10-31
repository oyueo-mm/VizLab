import { sankey, sankeyCenter, sankeyJustify, sankeyLeft, sankeyRight, type SankeyGraph, type SankeyLink, type SankeyNode } from 'd3-sankey'

export interface FlowEdge { source: string; target: string; value: number; rows: number[] }
export type SankeyAlign = 'justify' | 'left' | 'right' | 'center'

const aligns = { justify: sankeyJustify, left: sankeyLeft, right: sankeyRight, center: sankeyCenter }

export interface FlowNodeDatum { name: string }
export interface FlowLinkDatum { rows: number[] }
export type FlowNode = SankeyNode<FlowNodeDatum, FlowLinkDatum>
export type FlowLink = SankeyLink<FlowNodeDatum, FlowLinkDatum>

/**
 * Merges duplicate source→target pairs and separates what d3-sankey cannot draw:
 * self-loops and non-positive values are reported instead of being silently dropped.
 */
export function collectFlows(triples: readonly { source: string; target: string; value: number | null; row: number }[]) {
  const map = new Map<string, FlowEdge>()
  let selfLoops = 0
  let invalid = 0
  for (const t of triples) {
    if (!t.source || !t.target || t.value == null || !(t.value > 0)) { invalid++; continue }
    if (t.source === t.target) { selfLoops++; continue }
    const key = `${t.source}\u0000${t.target}`
    const e = map.get(key)
    if (e) { e.value += t.value; e.rows.push(t.row) } else map.set(key, { source: t.source, target: t.target, value: t.value, rows: [t.row] })
  }
  return { edges: [...map.values()], selfLoops, invalid }
}

/** A directed cycle (node names, first repeated at the end) or null. d3-sankey requires an acyclic graph. */
export function findCycle(edges: readonly { source: string; target: string }[]): string[] | null {
  const out = new Map<string, string[]>()
  for (const e of edges) out.set(e.source, [...(out.get(e.source) ?? []), e.target])
  const state = new Map<string, 1 | 2>()
  const stack: string[] = []
  const visit = (n: string): string[] | null => {
    state.set(n, 1)
    stack.push(n)
    for (const m of out.get(n) ?? []) {
      if (state.get(m) === 1) return [...stack.slice(stack.indexOf(m)), m]
      if (!state.has(m)) { const c = visit(m); if (c) return c }
    }
    stack.pop()
    state.set(n, 2)
    return null
  }
  for (const n of out.keys()) if (!state.has(n)) { const c = visit(n); if (c) return c }
  return null
}

export interface SankeyOptions { width: number; height: number; nodeWidth: number; nodePadding: number; align: SankeyAlign; iterations?: number }

/** Runs the d3-sankey layout on an acyclic edge list. Node value = max(Σ incoming, Σ outgoing). */
export function sankeyLayout(edges: readonly FlowEdge[], { width, height, nodeWidth, nodePadding, align, iterations = 6 }: SankeyOptions) {
  const names = [...new Set(edges.flatMap((e) => [e.source, e.target]))]
  const graph: SankeyGraph<FlowNodeDatum, FlowLinkDatum> = {
    nodes: names.map((name) => ({ name })),
    links: edges.map((e) => ({ source: names.indexOf(e.source), target: names.indexOf(e.target), value: e.value, rows: e.rows })),
  }
  const layout = sankey<FlowNodeDatum, FlowLinkDatum>().nodeWidth(nodeWidth).nodePadding(nodePadding).nodeAlign(aligns[align]).iterations(iterations)
    .extent([[0, 0], [Math.max(1, width), Math.max(1, height)]])
  return { graph: layout(graph), layout }
}

/** Σ incoming and Σ outgoing per node; intermediate nodes conserve flow when they match. */
export function flowBalance(edges: readonly FlowEdge[]) {
  const bal = new Map<string, { in: number; out: number }>()
  const get = (n: string) => { let b = bal.get(n); if (!b) { b = { in: 0, out: 0 }; bal.set(n, b) } return b }
  for (const e of edges) { get(e.source).out += e.value; get(e.target).in += e.value }
  return bal
}
