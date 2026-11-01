import { describe, expect, it } from 'vitest'
import { ELEMENTS, MOLECULES, angle, cellVolume, crystalDensity, detectBonds, dihedral, formula, latticeVectors, molarMass, nearestNeighbours, supercell, type CrystalAtom } from './chem'
import { divCurl, edgeUse, gradient, gridFromRows, marchingTetrahedra, meshArea, opacityOf, renderVolume, sample, streamline, tensorEigen, vecAt, vecGridFromRows } from './field3d'

function sphereRows(n: number, r: number) {
  const rows: { x: number; y: number; z: number; v: number }[] = []
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -1 + (2 * i) / (n - 1), y = -1 + (2 * j) / (n - 1), z = -1 + (2 * k) / (n - 1)
    rows.push({ x, y, z, v: r - Math.hypot(x, y, z) })
  }
  return rows
}

describe('isosurface extraction', () => {
  const g = gridFromRows(sphereRows(34, 0.6))!
  it('rebuilds the regular grid from rows and interpolates trilinearly (exact for linear fields)', () => {
    expect(g.nx).toBe(34)
    expect(g.dx).toBeCloseTo(2 / 33, 6)
    const lin = gridFromRows(Array.from({ length: 27 }, (_, n) => { const i = n % 3, j = Math.floor(n / 3) % 3, k = Math.floor(n / 9); return { x: i, y: j, z: k, v: 2 * i - j + 3 * k } }))!
    expect(sample(lin, 0.3, 1.4, 0.7)).toBeCloseTo(0.6 - 1.4 + 2.1, 12)
    const gr = gradient(lin, 1, 1, 1)
    expect(gr[0]).toBeCloseTo(2, 9); expect(gr[1]).toBeCloseTo(-1, 9); expect(gr[2]).toBeCloseTo(3, 9)
  })
  it('the sphere isosurface has area ≈ 4πr² and is a closed manifold (every edge shared by exactly two triangles)', () => {
    const m = marchingTetrahedra(g, 0)
    expect(meshArea(m)).toBeGreaterThan(4 * Math.PI * 0.36 * 0.97)
    expect(meshArea(m)).toBeLessThan(4 * Math.PI * 0.36 * 1.05)
    for (const c of edgeUse(m).values()) expect(c).toBe(2)
    for (const v of m.verts) expect(Math.abs(Math.hypot(...v) - 0.6)).toBeLessThan(0.03)
  })
  it('a level outside the data range gives an empty mesh and a larger sphere gives a larger area', () => {
    expect(marchingTetrahedra(g, 5).tris.length).toBe(0)
    const small = meshArea(marchingTetrahedra(g, 0.3)), big = meshArea(marchingTetrahedra(g, -0.1))
    expect(big).toBeGreaterThan(small)
  })
})

describe('vector fields', () => {
  const rows: { x: number; y: number; z: number; a: number; b: number; c: number }[] = []
  for (let k = 0; k < 9; k++) for (let j = 0; j < 9; j++) for (let i = 0; i < 9; i++) { const x = -2 + i * 0.5, y = -2 + j * 0.5, z = -2 + k * 0.5; rows.push({ x, y, z, a: -y, b: x, c: 0.2 }) }
  const f = vecGridFromRows(rows)!
  it('a rigid rotation has zero divergence, curl 2 and RK4 streamlines stay on circles of constant radius', () => {
    const dc = divCurl(f, [0.3, 0.2, 0.1])
    expect(dc.div).toBeCloseTo(0, 9)
    expect(dc.curl).toBeCloseTo(2, 9)
    expect(vecAt(f, [1, 0, 0])[1]).toBeCloseTo(1, 12)
    const s = streamline(f, [1, 0, -1], 0.05, 80)
    expect(s.length).toBeGreaterThan(40)
    for (const p of s) expect(Math.hypot(p[0], p[1])).toBeCloseTo(1, 3)
    expect(s[s.length - 1][2]).toBeGreaterThan(-1) // drifts upward with w = 0.2
  })
})

describe('tensors', () => {
  it('eigenvalues of a diagonal tensor are its entries sorted, with FA 0 for an isotropic and ≈ 1 for a line tensor', () => {
    const e = tensorEigen([3, 1, 2, 0, 0, 0])
    expect(e.values[0]).toBeCloseTo(3, 9); expect(e.values[1]).toBeCloseTo(2, 9); expect(e.values[2]).toBeCloseTo(1, 9)
    expect(Math.abs(e.vectors[0][0])).toBeCloseTo(1, 9)
    expect(tensorEigen([1, 1, 1, 0, 0, 0]).fa).toBeCloseTo(0, 12)
    expect(tensorEigen([1, 0, 0, 0, 0, 0]).fa).toBeCloseTo(1, 12)
  })
  it('a rotated tensor keeps its eigenvalues and trace, and the principal axis follows the rotation', () => {
    const c = Math.cos(0.6), s = Math.sin(0.6), a = 4, b = 1
    const xx = a * c * c + b * s * s, yy = a * s * s + b * c * c, xy = (a - b) * c * s
    const e = tensorEigen([xx, yy, 0.5, xy, 0, 0])
    expect(e.values[0]).toBeCloseTo(4, 9)
    expect(e.trace).toBeCloseTo(5.5, 12)
    expect(Math.abs(e.vectors[0][0])).toBeCloseTo(c, 6)
    expect(Math.abs(e.vectors[0][1])).toBeCloseTo(s, 6)
  })
})

describe('volume rendering', () => {
  it('an opaque ball is brighter in the middle of the image than the white background and the transfer bump peaks at its centre', () => {
    const g = gridFromRows(sphereRows(18, 0.6))!
    const tf = { center: 0.9, width: 0.3, opacity: 8 }
    expect(opacityOf(0.9, tf)).toBeCloseTo(8, 12)
    expect(opacityOf(0.3, tf)).toBeLessThan(opacityOf(0.9, tf))
    const img = renderVolume(g, { yaw: -30, pitch: 30, zoom: 1 }, 40, 40, tf, () => [20, 30, 160], false, 40)
    const centre = (20 * 40 + 20) * 4, corner = 0
    expect(img[centre + 2]).toBeGreaterThan(0)
    expect(img[centre]).toBeLessThan(img[corner])
    expect(img[corner]).toBe(255)
    const mip = renderVolume(g, { yaw: 0, pitch: 60, zoom: 1 }, 40, 40, tf, () => [0, 0, 0], true, 40)
    expect(mip[centre]).toBeLessThan(mip[corner])
  })
})

describe('molecules and crystals', () => {
  it('bond detection reproduces the bond graphs of water, methane, benzene and ethane', () => {
    const count = (id: string) => detectBonds(MOLECULES[id].atoms).length
    expect(count('water')).toBe(2)
    expect(count('methane')).toBe(4)
    expect(count('benzene')).toBe(12)
    expect(count('ethane')).toBe(7)
    expect(count('ethene')).toBe(5)
    expect(count('co2')).toBe(2)
  })
  it('geometry matches the construction: H–O–H 104.5°, tetrahedral 109.47°, ethane staggered dihedral 60°, ammonia 106.7°', () => {
    const w = MOLECULES.water.atoms
    expect(angle(w[1].pos, w[0].pos, w[2].pos)).toBeCloseTo(104.52, 6)
    const m = MOLECULES.methane.atoms
    expect(angle(m[1].pos, m[0].pos, m[2].pos)).toBeCloseTo(109.4712, 3)
    const n = MOLECULES.ammonia.atoms
    expect(angle(n[1].pos, n[0].pos, n[2].pos)).toBeCloseTo(106.7, 6)
    const e = MOLECULES.ethane.atoms
    // atoms: C0, C1, then three H on C0 (2..4), three H on C1 (5..7)
    expect(Math.abs(dihedral(e[2].pos, e[0].pos, e[1].pos, e[5].pos))).toBeCloseTo(60, 6)
    expect(angle(MOLECULES.co2.atoms[1].pos, MOLECULES.co2.atoms[0].pos, MOLECULES.co2.atoms[2].pos)).toBeCloseTo(180, 6)
  })
  it('formulae follow the Hill system and the molar mass of water is 18.015', () => {
    expect(formula(MOLECULES.benzene.atoms)).toBe('C₆H₆')
    expect(formula(MOLECULES.water.atoms)).toBe('H₂O')
    expect(formula(MOLECULES.co2.atoms)).toBe('CO₂')
    expect(molarMass(MOLECULES.water.atoms)).toBeCloseTo(18.015, 3)
    expect(ELEMENTS.C.mass).toBeCloseTo(12.011, 3)
  })
  const nacl: CrystalAtom[] = [
    { el: 'Na', frac: [0, 0, 0] }, { el: 'Na', frac: [0.5, 0.5, 0] }, { el: 'Na', frac: [0.5, 0, 0.5] }, { el: 'Na', frac: [0, 0.5, 0.5] },
    { el: 'Cl', frac: [0.5, 0, 0] }, { el: 'Cl', frac: [0, 0.5, 0] }, { el: 'Cl', frac: [0, 0, 0.5] }, { el: 'Cl', frac: [0.5, 0.5, 0.5] },
  ]
  const cubic = { a: 5.64, b: 5.64, c: 5.64, alpha: 90, beta: 90, gamma: 90 }
  it('cell volume: cubic a³, hexagonal a²c√3/2; the lattice vectors have the requested lengths and angles', () => {
    expect(cellVolume(cubic)).toBeCloseTo(5.64 ** 3, 9)
    const hex = { a: 3.209, b: 3.209, c: 5.211, alpha: 90, beta: 90, gamma: 120 }
    expect(cellVolume(hex)).toBeCloseTo(3.209 ** 2 * 5.211 * Math.sqrt(3) / 2, 9)
    const [a, b, c] = latticeVectors({ a: 3, b: 4, c: 5, alpha: 80, beta: 85, gamma: 100 })
    expect(Math.hypot(...a)).toBeCloseTo(3, 12); expect(Math.hypot(...b)).toBeCloseTo(4, 12); expect(Math.hypot(...c)).toBeCloseTo(5, 12)
    expect((a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (3 * 4)).toBeCloseTo(Math.cos((100 * Math.PI) / 180), 12)
  })
  it('the density of NaCl is 2.16 g/cm³ and sodium has 6 chloride neighbours at a/2', () => {
    expect(crystalDensity(nacl, cubic)).toBeCloseTo(2.164, 2)
    const nn = nearestNeighbours(nacl, cubic, 0)
    expect(nn.distance).toBeCloseTo(2.82, 6)
    expect(nn.count).toBe(6)
    expect(supercell(nacl, cubic, [2, 2, 2]).length).toBe(64)
    const fcc: CrystalAtom[] = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]].map((f) => ({ el: 'Cu', frac: f as [number, number, number] }))
    expect(nearestNeighbours(fcc, { a: 3.615, b: 3.615, c: 3.615, alpha: 90, beta: 90, gamma: 90 }).count).toBe(12)
    expect(crystalDensity(fcc, { a: 3.615, b: 3.615, c: 3.615, alpha: 90, beta: 90, gamma: 90 })).toBeCloseTo(8.93, 1)
  })
})
