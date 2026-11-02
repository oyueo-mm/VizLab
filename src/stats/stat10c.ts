// ───────────────────────────── contour band depth ─────────────────────────────

export interface ContourBoxplot {
  /** band depth of every member (fraction of member pairs whose band contains it) */
  depth: number[]
  median: number
  /** members of the central half, deepest first */
  central: number[]
  outliers: number[]
  /** union and intersection masks of the central members */
  union: Uint8Array
  intersection: Uint8Array
}

/** Modified contour band depth: for a pair (a, b) a mask u is "inside the band" at a cell when min(a, b) ≤ u ≤ max(a, b); the depth is the share of band pairs satisfying this, averaged over the cells where the members disagree (cells where all agree carry no information). The strict set-inclusion version (a∩b ⊆ u ⊆ a∪b everywhere) degenerates to the same depth for every member when contours cross, which is why the modified version is used. */
export function contourBandDepth(masks: readonly Uint8Array[]): number[] {
  const n = masks.length, m = masks[0].length
  const pairs = (n * (n - 1)) / 2
  const c2 = (k: number) => (k * (k - 1)) / 2
  const sum = new Array<number>(n).fill(0)
  let cells = 0
  for (let p = 0; p < m; p++) {
    let c = 0
    for (let i = 0; i < n; i++) c += masks[i][p]
    if (c === 0 || c === n) continue
    cells++
    const vOne = c2(n - c) / pairs, vZero = c2(c) / pairs
    for (let i = 0; i < n; i++) sum[i] += 1 - (masks[i][p] ? vOne : vZero)
  }
  return sum.map((v) => (cells ? v / cells : 1))
}

/** Contour boxplot of the masks: median = deepest, box = union/intersection of the deepest half; outliers are members whose depth falls below a fence set from the depth quartiles (a simplification of the original 1.5× band inflation). */
export function contourBoxplot(masks: readonly Uint8Array[], factor = 1.5): ContourBoxplot {
  const n = masks.length, m = masks[0].length
  const depth = contourBandDepth(masks)
  const order = depth.map((_, i) => i).sort((a, b) => depth[b] - depth[a] || a - b)
  const central = order.slice(0, Math.ceil(n / 2))
  const union = new Uint8Array(m), intersection = new Uint8Array(m).fill(1)
  for (const i of central) for (let p = 0; p < m; p++) { union[p] |= masks[i][p]; intersection[p] &= masks[i][p] }
  const sorted = [...depth].sort((a, b) => a - b)
  const q = (f: number) => sorted[Math.min(n - 1, Math.floor(f * (n - 1)))]
  const q1 = q(0.25), q3 = q(0.75)
  const lo = q1 - factor * (q3 - q1)
  const outliers = depth.map((d, i) => (d < lo ? i : -1)).filter((i) => i >= 0)
  return { depth, median: order[0], central, outliers, union, intersection }
}

// ───────────────────────────── SpaceTree layout ─────────────────────────────

export interface SpaceTreeInput { name: string; children?: SpaceTreeInput[] }
export interface SpaceTreeNode { path: string[]; name: string; depth: number; y: number; h: number; open: boolean; hasKids: boolean; leaves: number; parent: number }

function leafCount(n: SpaceTreeInput): number { return n.children?.length ? n.children.reduce((a, c) => a + leafCount(c), 0) : 1 }

/** SpaceTree-style layout (Plaisant, Grosjean & Bederson 2002): only the path to the selected node and the selected node's children are open; at each depth the visible nodes are stacked in tree order and their height is rescaled so the column fits in `height`. */
export function spaceTree(root: SpaceTreeInput, selected: readonly string[], height: number, pad = 10, gap = 4, maxH = 24, minH = 6): SpaceTreeNode[] {
  const out: SpaceTreeNode[] = []
  const visit = (n: SpaceTreeInput, path: string[], depth: number, parent: number) => {
    // open = the node lies on the selected path (or is the selected node itself), so its children are shown
    const below = path.slice(1)
    const open = !!n.children?.length && below.length <= selected.length && below.every((s, i) => s === selected[i])
    const idx = out.length
    out.push({ path, name: n.name, depth, y: 0, h: 0, open, hasKids: !!n.children?.length, leaves: leafCount(n), parent })
    if (open) for (const c of n.children ?? []) visit(c, [...path, c.name], depth + 1, idx)
  }
  visit(root, [root.name], 0, -1)
  const maxDepth = Math.max(...out.map((o) => o.depth))
  const avail = height - 2 * pad
  // heights: the most crowded column decides the common node height
  let crowd = 1
  for (let d = 0; d <= maxDepth; d++) crowd = Math.max(crowd, out.filter((o) => o.depth === d).length)
  const h = Math.max(minH, Math.min(maxH, avail / crowd - gap))
  for (let d = 0; d <= maxDepth; d++) {
    const col = out.filter((o) => o.depth === d)
    col.forEach((o) => { o.h = h })
    // ideal position: the parent's centre (the first column is centred)
    col.forEach((o) => { o.y = o.parent >= 0 ? out[o.parent].y : pad + avail / 2 })
    // spread siblings around the parent, then resolve overlaps downward and bounds upward
    const step = h + gap
    for (let i = 0; i < col.length; i++) {
      const sibs = col.filter((c) => c.parent === col[i].parent)
      const k = sibs.indexOf(col[i])
      col[i].y = col[i].y + (k - (sibs.length - 1) / 2) * step
    }
    for (let i = 1; i < col.length; i++) col[i].y = Math.max(col[i].y, col[i - 1].y + step)
    const over = col.length ? col[col.length - 1].y - (pad + avail - h / 2) : 0
    if (over > 0) col.forEach((o) => { o.y -= over })
    const under = col.length ? pad + h / 2 - col[0].y : 0
    if (under > 0) col.forEach((o) => { o.y += under })
    for (let i = 1; i < col.length; i++) col[i].y = Math.max(col[i].y, col[i - 1].y + step)
  }
  return out
}
