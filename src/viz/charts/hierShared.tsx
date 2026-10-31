import * as d3 from 'd3'
import { ChevronRight } from 'lucide-react'
import { colorAt } from '../../lib/colors'
import type { TreeNode } from '../../stats/hierarchy'

export type HNode = d3.HierarchyNode<TreeNode>

export const pathOf = (d: HNode) => d.ancestors().reverse().slice(1).map((a) => a.data.name)

/** Follows `path` from the root; stale names (after the data changed) stop the walk at the last valid node. */
export function resolvePath(root: HNode, path: readonly string[]) {
  let node = root
  for (const name of path) {
    const next = node.children?.find((c) => c.data.name === name)
    if (!next) break
    node = next
  }
  return node
}

export function makeRoot(tree: TreeNode, sort = true) {
  const root = d3.hierarchy<TreeNode>(tree).sum((d) => d.value ?? 0)
  return sort ? root.sort((a, b) => (b.value ?? 0) - (a.value ?? 0)) : root
}

/** Branch color: the top-level ancestor picks the hue, depth lightens it. */
export function branchColor(d: HNode, tops: readonly string[], mode: 'branch' | 'depth' | 'single' = 'branch') {
  if (mode === 'single') return d3.interpolateRgb('#2a8c82', '#ffffff')(Math.min(0.7, (d.depth - 1) * 0.18))
  if (mode === 'depth') return d3.interpolateYlGnBu(0.25 + 0.14 * Math.min(5, d.depth))
  const top = d.ancestors().reverse()[1]
  const base = colorAt(Math.max(0, tops.indexOf(top?.data.name ?? '')))
  return d3.interpolateRgb(base, '#ffffff')(Math.min(0.55, (d.depth - 1) * 0.16))
}

export function Crumbs({ path, onNavigate }: { path: readonly string[]; onNavigate: (path: string[]) => void }) {
  return (
    <nav className="treemap-crumbs" aria-label="계층 위치">
      <button type="button" onClick={() => onNavigate([])} aria-current={path.length === 0 ? 'page' : undefined}>전체</button>
      {path.map((name, i) => (
        <span key={i}><ChevronRight size={14} aria-hidden="true" /><button type="button" onClick={() => onNavigate(path.slice(0, i + 1))}>{name}</button></span>
      ))}
    </nav>
  )
}
