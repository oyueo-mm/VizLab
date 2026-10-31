import * as d3 from 'd3'
import type { TreeNode } from './hierarchy'

export interface IcicleNode {
  path: string[]
  name: string
  depth: number
  value: number
  /** Position along the value axis and along the depth axis, both in [0, 1] of the (zoomed) view. */
  a0: number
  a1: number
  d0: number
  d1: number
  hasChildren: boolean
}

/** Walks to the node at `path` (names from just below the root); stops at the deepest name that still exists if the path is stale. */
export function findNode(tree: TreeNode, path: readonly string[]): { node: TreeNode; path: string[] } {
  let node = tree
  const used: string[] = []
  for (const name of path) {
    const next = node.children?.find((c) => c.name === name)
    if (!next) break
    node = next
    used.push(name)
  }
  return { node, path: used }
}

/**
 * Icicle layout of the subtree at `focus`: the focused node fills the full value axis, and `maxDepth` levels
 * below it are drawn. Child extents add up to their parent's extent (partition layout).
 */
export function icicleLayout(tree: TreeNode, focus: readonly string[], maxDepth: number, sort: 'value' | 'none' = 'value'): IcicleNode[] {
  const { node, path } = findNode(tree, focus)
  const root = d3.hierarchy<TreeNode>(node).sum((d) => (d.children?.length ? 0 : Math.max(0, d.value ?? 0)))
  if (sort === 'value') root.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
  const levels = Math.max(1, Math.min(maxDepth + 1, root.height + 1))
  d3.partition<TreeNode>().size([1, levels])(root)
  return root.descendants().filter((n) => n.depth < levels).map((n) => {
    const r = n as d3.HierarchyRectangularNode<TreeNode>
    return {
      path: [...path, ...n.ancestors().reverse().slice(1).map((a) => a.data.name)], name: n.data.name, depth: n.depth, value: n.value ?? 0,
      a0: r.x0, a1: r.x1, d0: r.y0 / levels, d1: r.y1 / levels, hasChildren: !!n.children?.length,
    }
  })
}
