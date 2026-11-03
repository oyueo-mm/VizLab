// ───────────────────────────── Generalized Pythagoras tree ─────────────────────────────

export interface TreeIn { name: string; value?: number; children?: TreeIn[] }
type Pt = [number, number]

export interface PythNode { path: string[]; name: string; depth: number; side: number; weight: number; /** corners: bottom-left, bottom-right, top-right, top-left in the frame of the node */ corners: [Pt, Pt, Pt, Pt]; parent: number; leaf: boolean }

/** Total weight of a subtree: the sum of its leaf values (a leaf without a value counts 1). */
export function weightOf(n: TreeIn): number {
  return n.children?.length ? n.children.reduce((s, c) => s + weightOf(c), 0) : Math.max(0, n.value ?? 1)
}

/**
 * Generalized Pythagoras tree (after Beck et al. 2014): a node is a square standing on a base edge; its children's squares stand on chords of the
 * Thales semicircle over the node's top edge, so the chord chain runs from one top corner to the other. The chord lengths are proportional to the
 * square roots of the children's weights; for two equally heavy children this is the classical Pythagoras tree (c₁² + c₂² = c²).
 */
export function pythagoras(root: TreeIn, side = 1, maxDepth = 7, minSide = 0.004): PythNode[] {
  const out: PythNode[] = []
  const place = (n: TreeIn, path: string[], depth: number, a: Pt, b: Pt, parent: number) => {
    // a → b is the base edge, the square is erected to the left of a → b (outward for an upward-pointing chain)
    const dx = b[0] - a[0], dy = b[1] - a[1], s = Math.hypot(dx, dy)
    const nx = -dy, ny = dx
    const corners: [Pt, Pt, Pt, Pt] = [a, b, [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]]
    const idx = out.length
    const kids = n.children?.filter((c) => weightOf(c) > 0) ?? []
    out.push({ path, name: n.name, depth, side: s, weight: weightOf(n), corners, parent, leaf: kids.length === 0 })
    if (!kids.length || depth >= maxDepth || s < minSide) return
    const tl = corners[3], tr = corners[2] // top corners: left (above a) and right (above b)
    const ws = kids.map((c) => Math.sqrt(weightOf(c)))
    const sum = ws.reduce((x, y) => x + y, 0)
    const c0 = ws.map((w) => w / sum)
    // find the scale k so that the chords (length s·min(1, k·c0)) span exactly the diameter: Σ 2·asin(chord / s) = π
    const f = (k: number) => c0.reduce((acc, c) => acc + 2 * Math.asin(Math.min(1, k * c)), 0)
    let lo = 0, hi = 1 / Math.min(...c0)
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (f(m) < Math.PI) lo = m; else hi = m }
    const k = (lo + hi) / 2
    // Thales circle over the top edge: centre m, radius s/2; start at the corner tl and walk along the semicircle on the outer side
    const mid: Pt = [(tl[0] + tr[0]) / 2, (tl[1] + tr[1]) / 2]
    const ux = (tr[0] - tl[0]) / s, uy = (tr[1] - tl[1]) / s // direction tl → tr
    const ox = nx / s, oy = ny / s // outward normal
    let ang = Math.PI // angle measured from the direction tl → tr … start at tl (angle π), sweep to 0 through π/2 (the outward apex)
    const points: Pt[] = [tl]
    for (const c of c0) {
      ang -= 2 * Math.asin(Math.min(1, k * c))
      const r = s / 2
      points.push([mid[0] + r * (Math.cos(ang) * ux + Math.sin(ang) * ox), mid[1] + r * (Math.cos(ang) * uy + Math.sin(ang) * oy)])
    }
    points[points.length - 1] = tr
    // chord i runs from points[i] to points[i+1] (going clockwise as seen from outside), the child square must stand on it pointing away from the parent
    kids.forEach((c, i) => place(c, [...path, c.name], depth + 1, points[i], points[i + 1], idx))
  }
  place(root, [root.name], 0, [0, 0], [side, 0], -1)
  return out
}

// ───────────────────────────── CactusTree ─────────────────────────────

export interface CactusNode { path: string[]; name: string; depth: number; x: number; y: number; r: number; weight: number; parent: number; leaf: boolean }

/**
 * CactusTree layout (after Dang & Forbes 2017): every node is a circle whose area is proportional to its subtree weight; children sit on the periphery of
 * the parent circle, touching it, inside an angular range that opens away from the parent. The angular space is shared out in proportion to the child radii.
 */
export function cactusTree(root: TreeIn, spread = 0.8): CactusNode[] {
  const out: CactusNode[] = []
  const total = weightOf(root) || 1
  const radius = (w: number) => Math.sqrt(w / total) * 1
  const place = (n: TreeIn, path: string[], depth: number, x: number, y: number, a0: number, a1: number, parent: number) => {
    const w = weightOf(n)
    const r = radius(w)
    const idx = out.length
    const kids = (n.children ?? []).filter((c) => weightOf(c) > 0)
    out.push({ path, name: n.name, depth, x, y, r, weight: w, parent, leaf: kids.length === 0 })
    if (!kids.length) return
    const rs = kids.map((c) => radius(weightOf(c)))
    // angular width a circle of radius rc needs on the parent's periphery: 2·asin(rc / (r + rc))
    const need = rs.map((rc) => 2 * Math.asin(Math.min(1, rc / (r + rc))))
    const needSum = need.reduce((p, q) => p + q, 0)
    const range = a1 - a0
    const scale = needSum > range ? range / needSum : 1
    const free = Math.max(0, range - needSum * scale) / (kids.length + 1)
    let a = a0 + free
    kids.forEach((c, i) => {
      const span = need[i] * scale
      const mid = a + span / 2
      const rc = rs[i]
      const cx = x + (r + rc) * Math.cos(mid), cy = y + (r + rc) * Math.sin(mid)
      // the child's own range opens away from its parent: centred on mid, as wide as `spread · π` (at most the span it was given, widened for roomy subtrees)
      const half = Math.min(Math.PI * 0.9, Math.max(span / 2, spread * Math.PI * 0.5))
      place(c, [...path, c.name], depth + 1, cx, cy, mid - half, mid + half, idx)
      a += span + free
    })
  }
  place(root, [root.name], 0, 0, 0, 0, 2 * Math.PI, -1)
  return out
}

/** Uniform cubic B-spline through control points (Holten's hierarchical edge bundles), sampled with `per` points per segment. */
export function bspline(ctrl: readonly Pt[], per = 8): Pt[] {
  if (ctrl.length < 2) return [...ctrl]
  const P = [ctrl[0], ctrl[0], ...ctrl, ctrl[ctrl.length - 1], ctrl[ctrl.length - 1]]
  const out: Pt[] = []
  for (let i = 0; i + 3 < P.length; i++) for (let s = 0; s < per; s++) {
    const t = s / per, t2 = t * t, t3 = t2 * t
    const b0 = (1 - 3 * t + 3 * t2 - t3) / 6, b1 = (4 - 6 * t2 + 3 * t3) / 6, b2 = (1 + 3 * t + 3 * t2 - 3 * t3) / 6, b3 = t3 / 6
    out.push([b0 * P[i][0] + b1 * P[i + 1][0] + b2 * P[i + 2][0] + b3 * P[i + 3][0], b0 * P[i][1] + b1 * P[i + 1][1] + b2 * P[i + 2][1] + b3 * P[i + 3][1]])
  }
  out.push(ctrl[ctrl.length - 1])
  return out
}

/** Control points of a bundled edge between two nodes: the tree path through their lowest common ancestor, straightened by β (Holten 2006). */
export function bundlePath(nodes: readonly CactusNode[], a: number, b: number, beta: number): Pt[] {
  const up = (i: number) => { const r: number[] = []; for (let k = i; k >= 0; k = nodes[k].parent) r.push(k); return r }
  const pa = up(a), pb = up(b)
  const sb = new Set(pb)
  const lca = pa.find((k) => sb.has(k))!
  const route = [...pa.slice(0, pa.indexOf(lca) + 1), ...pb.slice(0, pb.indexOf(lca)).reverse()]
  const P = route.map((k) => [nodes[k].x, nodes[k].y] as Pt)
  const n = P.length
  if (n < 3) return P
  return P.map((p, i) => [beta * p[0] + (1 - beta) * (P[0][0] + (i / (n - 1)) * (P[n - 1][0] - P[0][0])), beta * p[1] + (1 - beta) * (P[0][1] + (i / (n - 1)) * (P[n - 1][1] - P[0][1]))] as Pt)
}

// ───────────────────────────── History Flow ─────────────────────────────

export interface Revision { version: number; seg: string; author: string; length: number; order: number }
export interface FlowRect { version: number; seg: string; author: string; y0: number; y1: number; status: 'kept' | 'new' | 'moved' }
export interface FlowRibbon { seg: string; author: string; from: number; to: number; y0a: number; y1a: number; y0b: number; y1b: number; moved: boolean }

/**
 * History Flow layout (Viégas et al. 2004): every version is a column of text segments stacked in document order, a segment's height is its length; the same
 * segment in consecutive versions is joined by a ribbon in the author's colour, new segments appear without a ribbon, deleted ones end without one.
 */
export function historyFlow(revs: readonly Revision[]) {
  const versions = [...new Set(revs.map((r) => r.version))].sort((a, b) => a - b)
  const by = new Map<number, Revision[]>()
  for (const v of versions) by.set(v, revs.filter((r) => r.version === v).sort((a, b) => a.order - b.order))
  const rects: FlowRect[] = []
  const at = new Map<string, FlowRect>()
  for (let vi = 0; vi < versions.length; vi++) {
    const v = versions[vi]
    let y = 0
    const prev = vi > 0 ? by.get(versions[vi - 1])! : []
    const prevIdx = new Map(prev.map((r, i) => [r.seg, i]))
    const cur = by.get(v)!
    // rank among the segments that survive from the previous version: a segment has moved when that relative order changed
    const surv = cur.filter((r) => prevIdx.has(r.seg))
    const prevOrder = surv.map((r) => prevIdx.get(r.seg)!)
    cur.forEach((r) => {
      const y0 = y
      y += r.length
      let status: FlowRect['status'] = 'kept'
      if (vi > 0 && !prevIdx.has(r.seg)) status = 'new'
      else if (vi > 0) { const rank = surv.indexOf(r); const sorted = [...prevOrder].sort((a, b) => a - b); if (prevOrder[rank] !== sorted[rank]) status = 'moved' }
      const rc: FlowRect = { version: v, seg: r.seg, author: r.author, y0, y1: y, status: vi === 0 ? 'new' : status }
      rects.push(rc)
      at.set(`${v}|${r.seg}`, rc)
    })
  }
  const ribbons: FlowRibbon[] = []
  let deleted = 0
  for (let vi = 0; vi + 1 < versions.length; vi++) {
    const a = by.get(versions[vi])!, b = new Set(by.get(versions[vi + 1])!.map((r) => r.seg))
    for (const r of a) {
      if (!b.has(r.seg)) { deleted++; continue }
      const ra = at.get(`${versions[vi]}|${r.seg}`)!, rb = at.get(`${versions[vi + 1]}|${r.seg}`)!
      ribbons.push({ seg: r.seg, author: r.author, from: versions[vi], to: versions[vi + 1], y0a: ra.y0, y1a: ra.y1, y0b: rb.y0, y1b: rb.y1, moved: rb.status === 'moved' || Math.abs(ra.y0 - rb.y0) > 1e-9 })
    }
  }
  const authors = [...new Set(revs.map((r) => r.author))]
  const height = Math.max(0, ...versions.map((v) => by.get(v)!.reduce((s, r) => s + r.length, 0)))
  return { versions, rects, ribbons, authors, height, deleted, inserted: rects.filter((r) => r.status === 'new' && r.version !== versions[0]).length }
}
