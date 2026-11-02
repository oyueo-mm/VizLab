import * as d3 from 'd3'
import { describe, expect, it } from 'vitest'
import { gridFromRows, sample } from './field3d'
import { centralAngle, fieldAt, lic, lonLatToVec, mprSlice, neighbourContrast, orthographic, orthographicInvert, vecToLonLat, whiteNoise, type FlowSource } from './sci7'

describe('flow field', () => {
  it('a vortex circulates counter-clockwise and a sink points inwards', () => {
    const vortex: FlowSource[] = [{ kind: '소용돌이', x: 0, y: 0, strength: 1, radius: 0.1 }]
    const [u, v] = fieldAt(vortex, 1, 0)
    expect(Math.abs(u)).toBeLessThan(1e-12)
    expect(v).toBeGreaterThan(0)
    const [su, sv] = fieldAt([{ kind: '흡입', x: 0, y: 0, strength: 1, radius: 0.1 }], 1, 0)
    expect(su).toBeLessThan(0)
    expect(Math.abs(sv)).toBeLessThan(1e-12)
    expect(fieldAt([{ kind: '균일', x: 0, y: 0, strength: 2, radius: 1 }], 5, 5)).toEqual([2, 0])
  })
})

describe('line integral convolution', () => {
  const w = 96, h = 96
  const noise = whiteNoise(w, h, 4)
  it('is reproducible and stays in [0, 1]', () => {
    const a = lic(() => [1, 0], noise, w, h, 14), b = lic(() => [1, 0], noise, w, h, 14)
    expect(Array.from(a)).toEqual(Array.from(b))
    expect(Math.min(...a)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...a)).toBeLessThanOrEqual(1)
  })
  it('smears the noise along a horizontal flow: neighbours along the flow are much more alike than across it', () => {
    const img = lic(() => [1, 0], noise, w, h, 14)
    const c = neighbourContrast(img, w, h)
    expect(c.alongX).toBeLessThan(0.45 * c.alongY)
  })
  it('follows the flow direction when it is vertical or diagonal', () => {
    const v = neighbourContrast(lic(() => [0, 1], noise, w, h, 14), w, h)
    expect(v.alongY).toBeLessThan(0.45 * v.alongX)
    const d = lic(() => [1, 1], noise, w, h, 14)
    // along the diagonal neighbours are alike: compare (i,j)→(i+1,j+1) with (i,j)→(i+1,j−1)
    let along = 0, across = 0, n = 0
    for (let j = 5; j < h - 5; j++) for (let i = 5; i < w - 5; i++) { along += Math.abs(d[(j + 1) * w + i + 1] - d[j * w + i]); across += Math.abs(d[(j - 1) * w + i + 1] - d[j * w + i]); n++ }
    expect(along / n).toBeLessThan(0.5 * (across / n))
  })
  it('the texture of a vortex field is smooth along circles around the vortex', () => {
    const cx = w / 2, cy = h / 2
    const img = lic((x, y) => [-(y - cy), x - cx], noise, w, h, 14)
    // two points on the same circle that are close along it differ less than two points at the same distance across circles
    const r = 25
    const at = (rad: number, ang: number) => img[Math.round(cy + Math.sin(ang) * rad) * w + Math.round(cx + Math.cos(ang) * rad)]
    let along = 0, across = 0
    for (let k = 0; k < 60; k++) { const a = (k / 60) * Math.PI * 2; along += Math.abs(at(r, a) - at(r, a + 1.2 / r)); across += Math.abs(at(r, a) - at(r + 1.2, a)) }
    expect(along).toBeLessThan(0.6 * across)
  })
})

describe('orthographic globe', () => {
  it('matches d3.geoOrthographic for visible points and flags the far side', () => {
    const R = 100
    for (const [lon0, lat0] of [[0, 0], [30, 20], [-120, -45], [170, 60]]) {
      const proj = d3.geoOrthographic().scale(R).translate([0, 0]).clipAngle(90).rotate([-lon0, -lat0])
      for (const [lon, lat] of [[0, 0], [10, 10], [-60, 40], [100, -20], [170, 80], [-170, -60]]) {
        const mine = orthographic(lon, lat, lon0, lat0, R)
        const ref = proj([lon, lat])
        expect(mine.visible).toBe(d3.geoDistance([lon, lat], [lon0, lat0]) <= Math.PI / 2)
        if (ref) { expect(mine.x).toBeCloseTo(ref[0], 6); expect(mine.y).toBeCloseTo(ref[1], 6) }
      }
    }
  })
  it('projects the centre to the origin and inverts back', () => {
    const p = orthographic(33, -12, 33, -12, 1)
    expect(p.x).toBeCloseTo(0, 12)
    expect(p.y).toBeCloseTo(0, 12)
    for (const [lon0, lat0] of [[0, 0], [100, 30], [-40, -60]]) for (const [lon, lat] of [[lon0 + 10, lat0 + 5], [lon0 - 30, lat0 - 20], [lon0 + 50, lat0]]) {
      const q = orthographic(lon, lat, lon0, lat0, 1)
      const inv = orthographicInvert(q.x, q.y, lon0, lat0, 1)!
      expect(inv[0]).toBeCloseTo(((lon + 540) % 360) - 180, 6)
      expect(inv[1]).toBeCloseTo(lat, 6)
    }
    expect(orthographicInvert(1.2, 0, 0, 0, 1)).toBeNull()
  })
  it('coordinate conversion and great-circle distance', () => {
    const [lon, lat] = vecToLonLat(lonLatToVec(127, 37))
    expect(lon).toBeCloseTo(127, 9)
    expect(lat).toBeCloseTo(37, 9)
    expect(centralAngle([0, 0], [90, 0])).toBeCloseTo(90, 9)
    expect(centralAngle([0, 90], [123, -90])).toBeCloseTo(180, 9)
    expect(centralAngle([10, 20], [10, 20])).toBeCloseTo(0, 6)
  })
})

describe('multi-planar reconstruction', () => {
  const rows: { x: number; y: number; z: number; v: number }[] = []
  for (let k = 0; k < 8; k++) for (let j = 0; j < 9; j++) for (let i = 0; i < 10; i++) rows.push({ x: i, y: j, z: k, v: i + 10 * j + 100 * k })
  const g = gridFromRows(rows)!
  it('the three sections agree at their common point and with direct sampling', () => {
    const pos: [number, number, number] = [3.4, 5.2, 2.6]
    const nu = 18, nv = 16
    const ax = mprSlice(g, 'axial', pos, nu, nv), co = mprSlice(g, 'coronal', pos, nu, nv), sa = mprSlice(g, 'sagittal', pos, nu, nv)
    // the sample at row r, column c of every section equals the volume at that world point
    const cell = (plane: 'axial' | 'coronal' | 'sagittal', r: number, c: number) => {
      const tu = (c + 0.5) / nu, tv = 1 - (r + 0.5) / nv
      if (plane === 'axial') return [tu * 9, tv * 8, pos[2]]
      if (plane === 'coronal') return [tu * 9, pos[1], tv * 7]
      return [pos[0], tu * 8, tv * 7]
    }
    for (const [name, sl] of [['axial', ax], ['coronal', co], ['sagittal', sa]] as const) {
      for (const [r, c] of [[0, 0], [5, 7], [15, 17], [8, 3]]) { const [x, y, z] = cell(name, r, c); expect(sl[r][c], name).toBeCloseTo(sample(g, x, y, z), 9) }
    }
    // the linear volume makes the value at the common point the same in all sections
    const exact = pos[0] + 10 * pos[1] + 100 * pos[2]
    expect(sample(g, ...pos)).toBeCloseTo(exact, 9)
    expect(ax.length).toBe(nv)
    expect(ax[0].length).toBe(nu)
  })
  it('moving the crosshair along z only changes the axial section', () => {
    const a = mprSlice(g, 'axial', [3, 3, 1], 12, 12), b = mprSlice(g, 'axial', [3, 3, 4], 12, 12)
    expect(a).not.toEqual(b)
    expect(mprSlice(g, 'sagittal', [3, 3, 1], 12, 12)).toEqual(mprSlice(g, 'sagittal', [3, 6, 4], 12, 12))
  })
})
