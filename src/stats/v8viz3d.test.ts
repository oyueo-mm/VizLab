import { describe, expect, it } from 'vitest'
import { vecGridFromRows, type V3 } from './field3d'
import type { TreeNode } from './hierarchy'
import { coneTree, facePhases, integrateTime, pathTo, streamSurface, streamtube, surfaceArea, tubeRadius } from './viz3d8'

/** Grid of a field on [-3, 3]³ with 13 points per axis. */
function grid(F: (x: number, y: number, z: number) => V3) {
  const rows: { x: number; y: number; z: number; a: number; b: number; c: number }[] = []
  const n = 13
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -3 + (6 * i) / (n - 1), y = -3 + (6 * j) / (n - 1), z = -3 + (6 * k) / (n - 1)
    const [a, b, c] = F(x, y, z)
    rows.push({ x, y, z, a, b, c })
  }
  return vecGridFromRows(rows)!
}

const rotation = grid((x, y) => [-y, x, 0]) // rigid rotation about the z axis, angular velocity 1
const uniform = grid(() => [1, 0, 0])

describe('time integration', () => {
  it('follows a circle of constant radius with angular velocity 1', () => {
    const line = integrateTime(rotation, [1.5, 0, 0], 0.05, 60)
    for (const p of line) expect(Math.hypot(p[0], p[1])).toBeCloseTo(1.5, 3)
    const last = line[line.length - 1]
    expect(Math.atan2(last[1], last[0])).toBeCloseTo(60 * 0.05, 3)
  })
  it('stops at a stagnation point', () => {
    expect(integrateTime(rotation, [0, 0, 0], 0.1, 20)).toHaveLength(1)
  })
})

describe('stream surface', () => {
  it('in a uniform flow is a plane whose area is seed length × path length', () => {
    const s = streamSurface(uniform, [-2, -1, 0], [-2, 1, 0], { seeds: 5, dt: 0.1, steps: 30, maxSpan: 5, maxSeeds: 20 })
    // 30 steps of 0.1 at speed 1 = 3 units downstream, seed segment 2 units long
    expect(surfaceArea(s.mesh)).toBeCloseTo(2 * 3, 3)
    expect(s.mesh.verts.every((v) => Math.abs(v[2]) < 1e-9)).toBe(true)
  })
  it('in a rotating flow lies on the disc z = 0 and keeps each curve at its radius', () => {
    const s = streamSurface(rotation, [1, 0, 0], [2, 0, 0], { seeds: 4, dt: 0.05, steps: 40, maxSpan: 5, maxSeeds: 20 })
    for (const [k, l] of s.lines.entries()) {
      const r = 1 + s.params[k]
      for (const p of l) { expect(p[2]).toBeCloseTo(0, 9); expect(Math.hypot(p[0], p[1])).toBeCloseTo(r, 3) }
    }
    // annulus swept by a rotation of 2 rad: area = (angle / 2)(R² − r²) = 1·(4 − 1) = 3 (the mesh is a polygonal approximation)
    expect(surfaceArea(s.mesh)).toBeGreaterThan(2.9)
    expect(surfaceArea(s.mesh)).toBeLessThan(3.01)
  })
  it('inserts curves where neighbouring curves drift apart', () => {
    // a shearing flow (speed grows with y) makes neighbouring curves diverge
    const shear = grid((_x, y) => [1 + 0.5 * y, 0, 0])
    const few = streamSurface(shear, [-2, -2, 0], [-2, 2, 0], { seeds: 3, dt: 0.1, steps: 30, maxSpan: 0.8, maxSeeds: 40 })
    expect(few.refined).toBeGreaterThan(0)
    expect(few.params.length).toBeGreaterThan(3)
    expect(few.params).toEqual([...few.params].sort((a, b) => a - b))
  })
})

describe('streamtube', () => {
  const axis: V3[] = Array.from({ length: 40 }, (_, i) => [Math.cos(i * 0.12), Math.sin(i * 0.12), i * 0.03] as V3)
  it('puts every ring vertex at the radius from its axis point, in the plane orthogonal to the tangent', () => {
    const tube = streamtube(axis, axis.map(() => 0.1), 10)
    tube.rings.forEach((ring, i) => {
      const t = [axis[Math.min(39, i + 1)][0] - axis[Math.max(0, i - 1)][0], axis[Math.min(39, i + 1)][1] - axis[Math.max(0, i - 1)][1], axis[Math.min(39, i + 1)][2] - axis[Math.max(0, i - 1)][2]]
      const tl = Math.hypot(...t)
      for (const v of ring) {
        const d = [v[0] - axis[i][0], v[1] - axis[i][1], v[2] - axis[i][2]]
        expect(Math.hypot(...d)).toBeCloseTo(0.1, 8)
        expect(Math.abs((d[0] * t[0] + d[1] * t[1] + d[2] * t[2]) / tl)).toBeLessThan(1e-8)
      }
    })
  })
  it('has no twist: consecutive ring frames differ only by a small rotation', () => {
    const tube = streamtube(axis, axis.map(() => 0.1), 8)
    for (let i = 1; i < tube.normals.length; i++) {
      const a = tube.normals[i - 1][0], b = tube.normals[i][0]
      expect(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]).toBeGreaterThan(0.95)
    }
  })
  it('builds sides × (rings − 1) quads', () => {
    expect(streamtube(axis, axis.map(() => 0.1), 12).quads).toHaveLength(12 * 39)
  })
  it('flux-conserving radius keeps speed × area constant up to the clamp', () => {
    const flux = (s: number) => s * Math.PI * tubeRadius('conservation', 0.1, s, 1) ** 2
    expect(flux(1.5)).toBeCloseTo(flux(0.8), 8)
    expect(tubeRadius('speed', 0.1, 2, 1)).toBeGreaterThan(tubeRadius('speed', 0.1, 1, 1))
    expect(tubeRadius('fixed', 0.1, 3, 1)).toBe(0.1)
  })
})

describe('cone tree', () => {
  const T: TreeNode = { name: 'root', children: [
    { name: 'a', children: [{ name: 'a1' }, { name: 'a2' }, { name: 'a3' }] },
    { name: 'b', children: [{ name: 'b1' }, { name: 'b2' }] },
    { name: 'c' },
  ] }
  it('places depth k at height −k·gap and children on a ring around the parent', () => {
    const nodes = coneTree(T, { levelGap: 0.5 })
    expect(nodes).toHaveLength(9)
    for (const n of nodes) {
      expect(n.pos[2]).toBeCloseTo(-n.depth * 0.5, 9)
      for (const c of n.children) expect(Math.hypot(nodes[c].pos[0] - n.pos[0], nodes[c].pos[1] - n.pos[1])).toBeCloseTo(n.ring, 9)
    }
  })
  it('keeps the subtrees of siblings apart', () => {
    const nodes = coneTree(T)
    for (const n of nodes) for (let i = 0; i < n.children.length; i++) for (let j = i + 1; j < n.children.length; j++) {
      const a = nodes[n.children[i]], b = nodes[n.children[j]]
      expect(Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1])).toBeGreaterThanOrEqual(a.extent + b.extent - 1e-9)
    }
  })
  it('collapsing a node removes its descendants', () => {
    const nodes = coneTree(T, { collapsed: new Set(['root/a']) })
    expect(nodes.find((n) => n.name === 'a')!.children).toHaveLength(0)
    expect(nodes.some((n) => n.name === 'a1')).toBe(false)
  })
  it('rotates ancestors so the path to a target faces the viewer', () => {
    const nodes = coneTree(T)
    const target = nodes.find((n) => n.name === 'b2')!.id
    const front = 1.2
    const ph = facePhases(nodes, target, front)
    const rot = coneTree(T, { phase: ph })
    const path = pathTo(rot, target)
    for (let i = 0; i + 1 < path.length; i++) {
      const a = rot[path[i]], c = rot[path[i + 1]]
      expect(Math.atan2(c.pos[1] - a.pos[1], c.pos[0] - a.pos[0])).toBeCloseTo(front, 6)
    }
  })
})
