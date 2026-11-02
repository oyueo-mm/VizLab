import { generateDataset } from '../data/datasets'
import { toNumber } from '../data/table'
import { colorAt, schemes } from '../lib/colors'
import { vecGridFromRows } from '../stats/field3d'
import { arcOrder } from '../stats/relate8'
import { buildTree } from '../stats/hierarchy'
import { attachPoint, blockLayout, confluentTracks, groupLayout, orderBlock, powerGraph, type Edge } from '../stats/graph8'
import { bubbleSet, defaultBubble, radialSets, type Pt } from '../stats/sets8'
import { lifeFlow, lifeFlowLayout, type Seq } from '../stats/tempo8'
import { coneTree, streamSurface } from '../stats/viz3d8'
import type { ArcMark, CircleMark, LineMark, Mark, PolyMark, RectMark, TextMark } from './heroFrames'

/**
 * Frames of the eight v0.8 stages: Bubble Sets, NodeTrix, Cone Tree, Stream Surface, Radial Sets, Confluent Drawing, TimeArcs and LifeFlow.
 * Each runs the app's own engine on seeded data; the module is a separate chunk that the home page fetches a few stages before the first of them.
 */

const CLEAR = 'rgba(0,0,0,0)'
const PAD = { l: 18, r: 18, t: 18, b: 34 }
const seed = (cycle: number) => 7 + cycle * 13

const rectM = (k: string, x: number, y: number, wd: number, ht: number, fill: string, o = 1, r = 1.5): RectMark => ({ t: 'rect', k, x, y, w: Math.max(0, wd), h: Math.max(0, ht), r, fill, stroke: CLEAR, sw: 0, o, from: { o: 0 } })
const dot = (k: string, x: number, y: number, r: number, fill: string, o = 1): CircleMark => ({ t: 'circle', k, x, y, r, fill, o, from: { r: 0, o: 0 } })
const lineM = (k: string, x1: number, y1: number, x2: number, y2: number, stroke: string, sw: number, o = 1): LineMark => ({ t: 'line', k, x1, y1, x2, y2, stroke, sw, o, from: { o: 0 } })
const textM = (k: string, x: number, y: number, s: string): TextMark => ({ t: 'text', k, x, y, text: s, anchor: 'middle', fill: '#8a9490', o: 1 })
const pathM = (k: string, pts: Pt[], stroke: string, sw: number, so = 0.85): PolyMark => ({ t: 'poly', k, pts, closed: false, fill: CLEAR, stroke, fo: 0, so, sw, o: 1, from: { so: 0, o: 0 } })
const polyM = (k: string, pts: Pt[], fill: string, fo: number, stroke = '#fff', sw = 0.6): PolyMark => ({ t: 'poly', k, pts, closed: true, fill, stroke, fo, so: 1, sw, o: 1, from: { fo: 0, o: 0 } })

const inner = (w: number, h: number) => ({ x0: PAD.l + 4, x1: w - PAD.r - 4, y0: PAD.t + 4, y1: h - PAD.b - 2 })
const note = (k: string, w: number, h: number, s: string) => textM(k, w / 2, h - 12, s)
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/** Resamples a closed ring to a fixed number of points along its perimeter so that regions can morph. */
function resample(ring: readonly Pt[], n: number): Pt[] {
  const pts = [...ring, ring[0]]
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]))
  const total = seg.reduce((a, b) => a + b, 0) || 1
  const out: Pt[] = []
  let i = 0, acc = 0
  for (let k = 0; k < n; k++) {
    const target = (k / n) * total
    while (i < seg.length - 1 && acc + seg[i] < target) { acc += seg[i]; i++ }
    const t = seg[i] ? (target - acc) / seg[i] : 0
    out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t])
  }
  return out
}

// ─── Bubble Sets ───────────────────────────────────────────────────────────────

function bubbleFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('set-points', seed(cycle), 26)
  const X = a.x1 - a.x0, Y = a.y1 - a.y0
  const pts: Pt[] = t.rows.map((r) => [a.x0 + (((toNumber(r[1]) ?? 50) - 6) / 88) * X, a.y0 + (((toNumber(r[2]) ?? 35) - 6) / 58) * Y])
  const marks: Mark[] = []
  for (const s of [0, 1, 2]) {
    const member = t.rows.map((r) => (toNumber(r[3 + s]) ?? 0) > 0)
    const reg = bubbleSet(pts, member, w, h, { ...defaultBubble, r0: 10, r1: 34, cell: 7 })
    reg.rings.slice(0, 3).forEach((ring, i) => { if (ring.length > 3) marks.push(polyM(`bs:${s}:${i}`, resample(ring, 40), colorAt(s), 0.2, colorAt(s), 1.6)) })
  }
  pts.forEach((p, i) => {
    const s = [0, 1, 2].find((q) => (toNumber(t.rows[i][3 + q]) ?? 0) > 0)
    marks.push(dot(`bs:p${i}`, p[0], p[1], 4.4, s == null ? '#fff' : colorAt(s), 1))
  })
  marks.push(note('bs:note', w, h, '소속 점에는 양의, 외부 점에는 음의 에너지 → 등치선이 집합 영역'))
  return marks
}

// ─── NodeTrix ──────────────────────────────────────────────────────────────────

function nodeTrixFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('net-communities', seed(cycle), 6)
  const names: string[] = []
  const idx = new Map<string, number>()
  const id = (s: string) => { let i = idx.get(s); if (i == null) { i = names.length; idx.set(s, i); names.push(s) } return i }
  const groupOf: string[] = []
  const edges: Edge[] = []
  for (const r of t.rows) { const u = id(String(r[0])), v = id(String(r[1])); groupOf[u] = String(r[3]); if (u !== v) edges.push([Math.min(u, v), Math.max(u, v)]) }
  const groups = [...new Set(names.map((_, i) => groupOf[i] ?? ''))]
  const blocks = groups.map((g) => orderBlock(names.map((_, i) => i).filter((i) => (groupOf[i] ?? '') === g), edges))
  const cell = Math.min(15, Math.floor(Math.min(a.x1 - a.x0, a.y1 - a.y0) / 2 / 8))
  const sizes = blocks.map((b) => b.length * cell)
  const weight = groups.map(() => groups.map(() => 0))
  const gi = (v: number) => groups.indexOf(groupOf[v] ?? '')
  for (const [u, v] of edges) if (gi(u) !== gi(v)) { weight[gi(u)][gi(v)]++; weight[gi(v)][gi(u)]++ }
  const pos = blockLayout(sizes, weight, a.x1 - a.x0, a.y1 - a.y0, 200).map((p) => [p[0] + a.x0, p[1] + a.y0] as Pt)
  const marks: Mark[] = []
  const bl = blocks.map((m, g) => ({ x: pos[g][0], y: pos[g][1], size: sizes[g], members: m }))
  edges.filter(([u, v]) => gi(u) !== gi(v)).forEach(([u, v], k) => {
    const A = bl[gi(u)], B = bl[gi(v)]
    const p = attachPoint(A, A.members.indexOf(u), A.members.length, [B.x, B.y]), q = attachPoint(B, B.members.indexOf(v), B.members.length, [A.x, A.y])
    marks.push(lineM(`nt:l${k}`, p[0], p[1], q[0], q[1], '#9aa3a0', 0.9, 0.7))
  })
  bl.forEach((b, g) => {
    marks.push(rectM(`nt:b${g}`, b.x - b.size / 2, b.y - b.size / 2, b.size, b.size, '#ffffff', 1, 1))
    marks.push(rectM(`nt:h${g}`, b.x - b.size / 2, b.y - b.size / 2 - 7, b.size, 6, colorAt(g), 0.85, 1))
    b.members.forEach((u, i) => b.members.forEach((v, j) => {
      if (u !== v && edges.some(([p, q]) => (p === u && q === v) || (p === v && q === u))) marks.push(rectM(`nt:c${g}:${i}:${j}`, b.x - b.size / 2 + j * cell + 0.5, b.y - b.size / 2 + i * cell + 0.5, cell - 1, cell - 1, colorAt(g), 0.9, 0.5))
    }))
  })
  marks.push(note('nt:note', w, h, '밀집한 공동체는 행렬, 공동체 사이는 선'))
  return marks
}

// ─── Cone Tree ─────────────────────────────────────────────────────────────────

function coneFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('org-tree', 7, 0)
  const tree = buildTree(t, ['부문', '팀', '파트'], null).tree
  const nodes = coneTree(tree, { levelGap: 0.6, maxDepth: 3 })
  const yaw = cycle * 0.55 + 0.3, pitch = 0.62
  const root = nodes[0]
  const scale = Math.min(a.x1 - a.x0, a.y1 - a.y0) / Math.max(2 * root.extent, 3 * 0.6 + 0.2) * 0.9
  const cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2
  const proj = (p: [number, number, number]) => {
    const x1 = p[0] * Math.cos(yaw) - p[1] * Math.sin(yaw), y1 = p[0] * Math.sin(yaw) + p[1] * Math.cos(yaw)
    return { x: cx + x1 * scale, y: cy + 0.45 * 3 * 0.6 * scale * 0.5 - (y1 * Math.sin(pitch) + (p[2] + 0.9) * Math.cos(pitch)) * scale * 0.9, d: y1 * Math.cos(pitch) - p[2] * Math.sin(pitch) }
  }
  const P = nodes.map((n) => proj(n.pos))
  const marks: Mark[] = []
  nodes.filter((n) => n.parent >= 0).forEach((n) => marks.push(lineM(`cn:e${n.id}`, P[n.parent].x, P[n.parent].y, P[n.id].x, P[n.id].y, '#7d8791', 0.9, 0.6)))
  const order = [...nodes].sort((p, q) => P[q.id].d - P[p.id].d)
  order.forEach((n) => marks.push(dot(`cn:n${n.id}`, P[n.id].x, P[n.id].y, n.children.length ? 5.5 : 3.4, colorAt(n.depth), 0.95)))
  marks.push(note('cn:note', w, h, '계층을 3차원 원뿔로 배치하고 시점을 돌려 봅니다'))
  return marks
}

// ─── Stream Surface ────────────────────────────────────────────────────────────

function surfaceFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('vector-vortex', 7, 7)
  const f = vecGridFromRows(t.rows.map((r) => ({ x: toNumber(r[0]) ?? 0, y: toNumber(r[1]) ?? 0, z: toNumber(r[2]) ?? 0, a: toNumber(r[3]) ?? 0, b: toNumber(r[4]) ?? 0, c: toNumber(r[5]) ?? 0 })))
  if (!f) return []
  const az = ((cycle * 35) % 180) * (Math.PI / 180)
  const c0: [number, number, number] = [-1.1 * Math.cos(az) * 0.6, -1.1 * Math.sin(az) * 0.6, -1.2]
  const dirv: [number, number, number] = [Math.cos(az + 1.2), Math.sin(az + 1.2), 0]
  const d0: [number, number, number] = [c0[0] - dirv[0] * 0.7, c0[1] - dirv[1] * 0.7, c0[2]], d1: [number, number, number] = [c0[0] + dirv[0] * 0.7, c0[1] + dirv[1] * 0.7, c0[2]]
  const s = streamSurface(f, d0, d1, { seeds: 9, dt: 0.16, steps: 26, maxSpan: 1e9, maxSeeds: 9 })
  const yaw = -0.6 + cycle * 0.25, pitch = 0.5
  const scale = Math.min(a.x1 - a.x0, a.y1 - a.y0) * 0.2
  const cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2 + 8
  const proj = (p: [number, number, number]) => {
    const x1 = p[0] * Math.cos(yaw) - p[1] * Math.sin(yaw), y1 = p[0] * Math.sin(yaw) + p[1] * Math.cos(yaw)
    return { x: cx + x1 * scale, y: cy - (y1 * Math.sin(pitch) + p[2] * Math.cos(pitch)) * scale, d: y1 * Math.cos(pitch) - p[2] * Math.sin(pitch) }
  }
  const P = s.mesh.verts.map((v) => proj(v))
  const tris = s.mesh.tris.map((tr, i) => ({ tr, i, d: (P[tr[0]].d + P[tr[1]].d + P[tr[2]].d) / 3 })).sort((p, q) => q.d - p.d)
  const marks: Mark[] = tris.map(({ tr, i }) => {
    const k = clamp(0.12 + 0.8 * (i % 51) / 51, 0, 1)
    const base = schemes.viridis.interpolate(0.2 + 0.7 * (s.mesh.verts[tr[0]][2] + 2) / 4)
    return polyM(`ss:t${i}`, [[P[tr[0]].x, P[tr[0]].y], [P[tr[1]].x, P[tr[1]].y], [P[tr[2]].x, P[tr[2]].y]], base, 0.55 + 0.4 * (1 - k), 'rgba(30,40,50,0.3)', 0.4)
  })
  const e0 = proj(d0), e1 = proj(d1)
  marks.push(lineM('ss:seed', e0.x, e0.y, e1.x, e1.y, '#d4452f', 3, 1))
  marks.push(note('ss:note', w, h, '시작선(빨강)에서 나온 유선들이 훑은 곡면'))
  return marks
}

// ─── Radial Sets ───────────────────────────────────────────────────────────────

function radialFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('set-members', seed(cycle), 90)
  const member = [1, 2, 3, 4, 5].map((c) => t.rows.map((r) => (toNumber(r[c]) ?? 0) > 0))
  const lay = radialSets(member, t.rows.length, 0.1)
  const R = Math.min(a.x1 - a.x0, a.y1 - a.y0) / 2 - 6
  const cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2
  const rIn = R * 0.46, rBase = R * 0.58, bandH = R * 0.42
  const marks: Mark[] = []
  const P = (an: number, r: number): Pt => [cx + r * Math.sin(an), cy - r * Math.cos(an)]
  lay.links.forEach((l, k) => {
    const pts: Pt[] = []
    const arc = (a0: number, a1: number) => Array.from({ length: 4 }, (_, i) => P(a0 + ((a1 - a0) * i) / 3, rIn))
    const bez = (p: Pt, q: Pt): Pt[] => Array.from({ length: 5 }, (_, i) => { const u = (i + 1) / 6; return [(1 - u) * (1 - u) * p[0] + 2 * u * (1 - u) * cx + u * u * q[0], (1 - u) * (1 - u) * p[1] + 2 * u * (1 - u) * cy + u * u * q[1]] as Pt })
    const A = arc(l.a0, l.a1), B = arc(l.b0, l.b1)
    pts.push(...A, ...bez(A[3], B[0]), ...B, ...bez(B[3], A[0]))
    marks.push(polyM(`rd:l${k}`, pts, colorAt(l.a), 0.35, colorAt(l.b), 0.6))
  })
  lay.sectors.forEach((s) => marks.push({ t: 'arc', k: `rd:s${s.set}`, cx, cy, a0: s.a0, a1: s.a1, r0: rIn - 6, r1: rIn, fill: colorAt(s.set), stroke: CLEAR, o: 1, from: { o: 0, a1: s.a0 } } as ArcMark))
  lay.arcs.forEach((r, k) => marks.push({ t: 'arc', k: `rd:a${r.set}:${r.degree}:${k}`, cx, cy, a0: r.a0, a1: r.a1, r0: rBase, r1: rBase + (r.degree / lay.maxDegree) * bandH, fill: colorAt(r.set), stroke: '#fff', o: 0.3 + 0.6 * (r.degree / lay.maxDegree), from: { o: 0, a1: r.a0 } } as ArcMark))
  marks.push(note('rd:note', w, h, '부채꼴 = 집합, 방사 막대 = 속한 집합 수, 띠 = 공통 원소'))
  return marks
}

// ─── Confluent Drawing ─────────────────────────────────────────────────────────

function confluentFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('dense-modules', seed(cycle), 3)
  const names: string[] = []
  const idx = new Map<string, number>()
  const id = (s: string) => { let i = idx.get(s); if (i == null) { i = names.length; idx.set(s, i); names.push(s) } return i }
  const edges: Edge[] = []
  for (const r of t.rows) { const u = id(String(r[0])), v = id(String(r[1])); if (u !== v) edges.push([Math.min(u, v), Math.max(u, v)]) }
  const pg = powerGraph(names.length, edges, 3)
  const lay = groupLayout(names.length, pg, a.x1 - a.x0, a.y1 - a.y0, 20)
  const pos = lay.pos.map((p) => [p[0] + a.x0, p[1] + a.y0] as Pt)
  const tracks = confluentTracks(pg, pos, 0.3)
  const cubic = (p0: Pt, p1: Pt, p2: Pt, p3: Pt): Pt[] => Array.from({ length: 9 }, (_, i) => { const u = i / 8, v = 1 - u; return [v * v * v * p0[0] + 3 * v * v * u * p1[0] + 3 * v * u * u * p2[0] + u * u * u * p3[0], v * v * v * p0[1] + 3 * v * v * u * p1[1] + 3 * v * u * u * p2[1] + u * u * u * p3[1]] as Pt })
  const curve = (from: Pt, j: Pt, dir: Pt): Pt[] => { const d = Math.hypot(j[0] - from[0], j[1] - from[1]); return cubic(from, [from[0] + (j[0] - from[0]) * 0.45, from[1] + (j[1] - from[1]) * 0.45], [j[0] - dir[0] * d * 0.45, j[1] - dir[1] * d * 0.45], j) }
  const marks: Mark[] = []
  pg.residual.forEach(([u, v], k) => marks.push(lineM(`cd:r${k}`, pos[u][0], pos[u][1], pos[v][0], pos[v][1], '#9aa3a0', 1, 0.8)))
  tracks.forEach((tr, k) => {
    const c = colorAt(k)
    if (tr.clique) { tr.from.forEach((m) => marks.push(pathM(`cd:${k}:c${m}`, [pos[m], [(pos[m][0] + tr.junctions[0][0]) / 2, (pos[m][1] + tr.junctions[0][1]) / 2], tr.junctions[0]], c, 1.4))); return }
    const [ja, jb] = tr.junctions
    const L = Math.hypot(jb[0] - ja[0], jb[1] - ja[1]) || 1
    const dir: Pt = [(jb[0] - ja[0]) / L, (jb[1] - ja[1]) / L]
    tr.from.forEach((m) => marks.push(pathM(`cd:${k}:a${m}`, curve(pos[m], ja, dir), c, 1.4)))
    tr.to.forEach((m) => marks.push(pathM(`cd:${k}:b${m}`, curve(pos[m], jb, [-dir[0], -dir[1]]), c, 1.4)))
    marks.push(lineM(`cd:${k}:trunk`, ja[0], ja[1], jb[0], jb[1], c, 4, 1))
  })
  pos.forEach((p, i) => marks.push(dot(`cd:n${i}`, p[0], p[1], 4.4, '#fff', 1)))
  marks.push(note('cd:note', w, h, '같은 이웃을 공유하는 간선이 한 줄기로 합류'))
  return marks
}

// ─── TimeArcs ──────────────────────────────────────────────────────────────────

function timeArcsFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('dynamic-links', seed(cycle), 16)
  const names: string[] = []
  const idx = new Map<string, number>()
  const id = (s: string) => { let i = idx.get(s); if (i == null) { i = names.length; idx.set(s, i); names.push(s) } return i }
  const edges = t.rows.map((r) => ({ t: toNumber(r[0]) ?? 0, a: id(String(r[1])), b: id(String(r[2])), w: toNumber(r[3]) ?? 1 }))
  const order = arcOrder(names.length, edges)
  const row = new Map(order.map((v, i) => [v, i]))
  const X = a.x1 - a.x0, Y = a.y1 - a.y0
  const tx = (tt: number) => a.x0 + 26 + ((tt - 1) / 15) * (X - 30)
  const y = (v: number) => a.y0 + ((row.get(v)! + 0.5) / names.length) * Y
  const marks: Mark[] = []
  order.forEach((v) => marks.push(lineM(`ta:r${v}`, a.x0 + 22, y(v), a.x1, y(v), '#eceff1', 1, 1)))
  edges.forEach((e, k) => {
    const ya = y(e.a), yb = y(e.b), x0 = tx(e.t)
    const top = Math.min(ya, yb), bot = Math.max(ya, yb)
    const rx = Math.min(24, (bot - top) * 0.3)
    const pts: Pt[] = Array.from({ length: 9 }, (_, i) => { const th = (i / 8) * Math.PI; return [x0 + Math.sin(th) * rx, top + ((1 - Math.cos(th)) / 2) * (bot - top)] as Pt })
    const same = names[e.a][0] === names[e.b][0]
    marks.push(pathM(`ta:e${k}`, pts, same ? colorAt('ABC'.indexOf(names[e.a][0])) : '#9aa3ad', 0.7 + e.w * 0.3, 0.6))
  })
  order.forEach((v) => marks.push(dot(`ta:n${v}`, a.x0 + 18, y(v), 3.4, colorAt('ABC'.indexOf(names[v][0])), 1)))
  marks.push(note('ta:note', w, h, '노드 줄 사이를 잇는 호로 시간별 관계를 표시'))
  return marks
}

// ─── LifeFlow ──────────────────────────────────────────────────────────────────

function lifeFlowFrame(cycle: number, w: number, h: number): Mark[] {
  const a = inner(w, h)
  const t = generateDataset('care-pathways', seed(cycle), 60)
  const m = new Map<string, Seq>()
  for (const r of t.rows) { const idv = String(r[0]); const s = m.get(idv) ?? { id: idv, events: [] }; s.events.push({ type: String(r[1]), t: toNumber(r[2]) ?? 0 }); m.set(idv, s) }
  const full = lifeFlow([...m.values()], 4)
  // drop rare branches so the picture stays readable
  const keep = new Set<number>([0])
  const walk = (id: number) => { for (const c of full[id].children) if (full[c].count >= 3) { keep.add(c); walk(c) } }
  walk(0)
  const kept = full.filter((n) => keep.has(n.id))
  const remap = new Map(kept.map((n, i) => [n.id, i]))
  const fixed = kept.map((n, i) => ({ ...n, id: i, parent: n.parent < 0 ? -1 : remap.get(n.parent)!, children: n.children.filter((c) => remap.has(c)).map((c) => remap.get(c)!) }))
  const lay = lifeFlowLayout(fixed, a.x1 - a.x0, a.y1 - a.y0)
  const types = [...new Set(full.map((n) => n.type))]
  const marks: Mark[] = []
  fixed.filter((n) => n.id).forEach((n) => {
    const L = lay[n.id]
    marks.push(rectM(`lf:${n.id}:${n.type}:${n.depth}`, a.x0 + L.x0, a.y0 + L.y0, Math.max(3, L.x1 - L.x0), Math.max(1, L.y1 - L.y0), colorAt(types.indexOf(n.type)), 0.88, 1))
  })
  marks.push(note('lf:note', w, h, '기록의 사건 순서를 합쳐, 두께 = 기록 수 · 길이 = 평균 간격'))
  return marks
}

export const HERO_V8 = { bubble: bubbleFrame, nodetrix: nodeTrixFrame, cone: coneFrame, ssurface: surfaceFrame, radial: radialFrame, confluent: confluentFrame, tarcs: timeArcsFrame, lflow: lifeFlowFrame }
export type HeroV8Key = keyof typeof HERO_V8

export function buildV8(key: HeroV8Key, cycle: number, w: number, h: number): Mark[] {
  return HERO_V8[key](cycle, w, h)
}
