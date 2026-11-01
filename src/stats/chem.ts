/** Molecular graphs from coordinates and crystal-lattice geometry. */

export type V3 = [number, number, number]

export interface ElementInfo { symbol: string; /** Covalent radius in Å. */ cov: number; /** Van der Waals radius in Å. */ vdw: number; color: string; /** g/mol */ mass: number }

export const ELEMENTS: Record<string, ElementInfo> = {
  H: { symbol: 'H', cov: 0.31, vdw: 1.2, color: '#f3f4f6', mass: 1.008 },
  C: { symbol: 'C', cov: 0.76, vdw: 1.7, color: '#4b5563', mass: 12.011 },
  N: { symbol: 'N', cov: 0.71, vdw: 1.55, color: '#3b5bdb', mass: 14.007 },
  O: { symbol: 'O', cov: 0.66, vdw: 1.52, color: '#e03131', mass: 15.999 },
  F: { symbol: 'F', cov: 0.57, vdw: 1.47, color: '#74b816', mass: 18.998 },
  Na: { symbol: 'Na', cov: 1.66, vdw: 2.27, color: '#9c36b5', mass: 22.99 },
  Mg: { symbol: 'Mg', cov: 1.41, vdw: 1.73, color: '#2f9e44', mass: 24.305 },
  P: { symbol: 'P', cov: 1.07, vdw: 1.8, color: '#f76707', mass: 30.974 },
  S: { symbol: 'S', cov: 1.05, vdw: 1.8, color: '#f2c200', mass: 32.06 },
  Cl: { symbol: 'Cl', cov: 1.02, vdw: 1.75, color: '#37b24d', mass: 35.45 },
  Fe: { symbol: 'Fe', cov: 1.32, vdw: 2.0, color: '#e8590c', mass: 55.845 },
  Cu: { symbol: 'Cu', cov: 1.32, vdw: 1.4, color: '#c2763d', mass: 63.546 },
  Cs: { symbol: 'Cs', cov: 2.44, vdw: 3.43, color: '#6741d9', mass: 132.905 },
  Si: { symbol: 'Si', cov: 1.11, vdw: 2.1, color: '#868e96', mass: 28.086 },
}
export const elementOf = (s: string): ElementInfo => ELEMENTS[s.trim()] ?? { symbol: s.trim() || '?', cov: 0.9, vdw: 1.8, color: '#adb5bd', mass: 0 }

export interface Atom { el: string; pos: V3 }
export interface Bond { a: number; b: number; length: number }

const dist = (p: V3, q: V3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])

/** Bonds by the covalent-radius rule: atoms i, j are bonded when |r_i − r_j| < 1.2 (r_cov,i + r_cov,j) and > 0.4 Å. */
export function detectBonds(atoms: readonly Atom[], tolerance = 1.2): Bond[] {
  const out: Bond[] = []
  for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
    const d = dist(atoms[i].pos, atoms[j].pos)
    if (d > 0.4 && d < tolerance * (elementOf(atoms[i].el).cov + elementOf(atoms[j].el).cov)) out.push({ a: i, b: j, length: d })
  }
  return out
}

/** Hill-system molecular formula (C first, then H, then the rest alphabetically; plain alphabetical without carbon). */
export function formula(atoms: readonly Atom[]): string {
  const n = new Map<string, number>()
  for (const a of atoms) n.set(a.el.trim(), (n.get(a.el.trim()) ?? 0) + 1)
  const keys = [...n.keys()].sort()
  const order = n.has('C') ? ['C', ...(n.has('H') ? ['H'] : []), ...keys.filter((k) => k !== 'C' && k !== 'H')] : keys
  const sub = (k: number) => String(k).split('').map((d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)]).join('')
  return order.map((k) => `${k}${n.get(k)! > 1 ? sub(n.get(k)!) : ''}`).join('')
}

export const molarMass = (atoms: readonly Atom[]) => atoms.reduce((s, a) => s + elementOf(a.el).mass, 0)

export function angle(a: V3, b: V3, c: V3): number {
  const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]]
  const cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v))
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI
}

/** Dihedral angle a–b–c–d in degrees, range (−180, 180]. */
export function dihedral(a: V3, b: V3, c: V3, d: V3): number {
  const sub = (p: V3, q: V3): V3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]]
  const cross = (p: V3, q: V3): V3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]
  const dot = (p: V3, q: V3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2]
  const b1 = sub(b, a), b2 = sub(c, b), b3 = sub(d, c)
  const n1 = cross(b1, b2), n2 = cross(b2, b3)
  const m1 = cross(n1, [b2[0] / Math.hypot(...b2), b2[1] / Math.hypot(...b2), b2[2] / Math.hypot(...b2)])
  return (Math.atan2(dot(m1, n2), dot(n1, n2)) * 180) / Math.PI
}

// ─── crystals ───────────────────────────────────────────────────────────────────────

export interface Cell { a: number; b: number; c: number; alpha: number; beta: number; gamma: number }

/** Lattice vectors as rows: a along x, b in the xy plane (standard crystallographic setting). Angles in degrees. */
export function latticeVectors(c: Cell): [V3, V3, V3] {
  const r = Math.PI / 180
  const ca = Math.cos(c.alpha * r), cb = Math.cos(c.beta * r), cg = Math.cos(c.gamma * r), sg = Math.sin(c.gamma * r)
  const va: V3 = [c.a, 0, 0], vb: V3 = [c.b * cg, c.b * sg, 0]
  const cx = c.c * cb, cy = (c.c * (ca - cb * cg)) / sg
  const cz = Math.sqrt(Math.max(0, c.c * c.c - cx * cx - cy * cy))
  return [va, vb, [cx, cy, cz]]
}

export const cellVolume = (c: Cell) => { const [a, b, v] = latticeVectors(c); return Math.abs(a[0] * (b[1] * v[2] - b[2] * v[1]) - a[1] * (b[0] * v[2] - b[2] * v[0]) + a[2] * (b[0] * v[1] - b[1] * v[0])) }

export const toCartesian = (f: V3, L: readonly [V3, V3, V3]): V3 => [f[0] * L[0][0] + f[1] * L[1][0] + f[2] * L[2][0], f[0] * L[0][1] + f[1] * L[1][1] + f[2] * L[2][1], f[0] * L[0][2] + f[1] * L[1][2] + f[2] * L[2][2]]

export interface CrystalAtom { el: string; frac: V3 }

/** Atoms of an n₁×n₂×n₃ block of cells in Cartesian Å. */
export function supercell(basis: readonly CrystalAtom[], cell: Cell, n: [number, number, number]): Atom[] {
  const L = latticeVectors(cell)
  const out: Atom[] = []
  for (let i = 0; i < n[0]; i++) for (let j = 0; j < n[1]; j++) for (let k = 0; k < n[2]; k++) for (const b of basis) out.push({ el: b.el, pos: toCartesian([b.frac[0] + i, b.frac[1] + j, b.frac[2] + k], L) })
  return out
}

/** Density in g/cm³ = Σ m / (N_A · V) with V in Å³ (1 Å³ = 10⁻²⁴ cm³). */
export const crystalDensity = (basis: readonly CrystalAtom[], cell: Cell) => (basis.reduce((s, a) => s + elementOf(a.el).mass, 0) / (6.02214076e23 * cellVolume(cell) * 1e-24))

/** Nearest-neighbour distance of an atom of the first basis element and how many neighbours lie within 1.05 × that distance, using a 3×3×3 neighbourhood of periodic images. */
export function nearestNeighbours(basis: readonly CrystalAtom[], cell: Cell, index = 0): { distance: number; count: number } {
  const L = latticeVectors(cell)
  const p0 = toCartesian(basis[index].frac, L)
  const ds: number[] = []
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) for (let k = -2; k <= 2; k++) for (let b = 0; b < basis.length; b++) {
    const q = toCartesian([basis[b].frac[0] + i, basis[b].frac[1] + j, basis[b].frac[2] + k], L)
    const d = dist(p0, q)
    if (d > 1e-6) ds.push(d)
  }
  ds.sort((x, y) => x - y)
  const d0 = ds[0] ?? NaN
  return { distance: d0, count: ds.filter((d) => d < d0 * 1.05).length }
}

// ─── standard small molecules from bond lengths and angles ─────────────────────────

const DEG = Math.PI / 180

export const MOLECULES: Record<string, { name: string; atoms: Atom[] }> = {
  // water: O–H 0.9572 Å, H–O–H 104.52°
  water: { name: '물 H₂O', atoms: [{ el: 'O', pos: [0, 0, 0] }, { el: 'H', pos: [0.9572 * Math.sin(52.26 * DEG), 0.9572 * Math.cos(52.26 * DEG), 0] }, { el: 'H', pos: [-0.9572 * Math.sin(52.26 * DEG), 0.9572 * Math.cos(52.26 * DEG), 0] }] },
  // ammonia: N–H 1.012 Å, H–N–H 106.7°; the three H lie on a cone of half-angle θ about −z with cos a = 1.5 cos²θ − 0.5
  ammonia: (() => {
    const th = Math.acos(Math.sqrt((Math.cos(106.7 * DEG) + 0.5) / 1.5)), h = 1.012
    return { name: '암모니아 NH₃', atoms: [{ el: 'N', pos: [0, 0, 0] } as Atom, ...[0, 120, 240].map((p) => ({ el: 'H', pos: [h * Math.sin(th) * Math.cos(p * DEG), h * Math.sin(th) * Math.sin(p * DEG), -h * Math.cos(th)] as V3 }))] }
  })(),
  // methane: C–H 1.089 Å, tetrahedral
  methane: (() => {
    const t = 1.089 / Math.sqrt(3)
    return { name: '메테인 CH₄', atoms: [{ el: 'C', pos: [0, 0, 0] } as Atom, ...([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]] as V3[]).map((v) => ({ el: 'H', pos: [v[0] * t, v[1] * t, v[2] * t] as V3 }))] }
  })(),
  // ethene: C=C 1.339 Å, C–H 1.085 Å, H–C–H 117.4° (so H–C=C is 121.3°)
  ethene: (() => {
    const cc = 1.339 / 2, ch = 1.085, half = (117.4 / 2) * DEG
    return { name: '에텐 C₂H₄', atoms: [{ el: 'C', pos: [-cc, 0, 0] } as Atom, { el: 'C', pos: [cc, 0, 0] } as Atom, ...[[-1, 1], [-1, -1], [1, 1], [1, -1]].map(([sx, sy]) => ({ el: 'H', pos: [sx * (cc + ch * Math.cos(half)), sy * ch * Math.sin(half), 0] as V3 }))] }
  })(),
  // benzene: C–C ring radius 1.397 Å, C–H 1.084 Å radially outward
  benzene: (() => {
    const rc = 1.397, rh = rc + 1.084
    const ring = [0, 1, 2, 3, 4, 5]
    return { name: '벤젠 C₆H₆', atoms: [...ring.map((k) => ({ el: 'C', pos: [rc * Math.cos(k * 60 * DEG), rc * Math.sin(k * 60 * DEG), 0] as V3 })), ...ring.map((k) => ({ el: 'H', pos: [rh * Math.cos(k * 60 * DEG), rh * Math.sin(k * 60 * DEG), 0] as V3 }))] }
  })(),
  // ethane (staggered): C–C 1.536 Å, C–H 1.094 Å, H–C–C 111.2°, the two methyl groups twisted by 60°
  ethane: (() => {
    const cc = 1.536, ch = 1.094, th = 111.2 * DEG
    const methyl = (zc: number, off: number, sign: 1 | -1) => [0, 120, 240].map((p) => ({ el: 'H', pos: [ch * Math.sin(th) * Math.cos((p + off) * DEG), ch * Math.sin(th) * Math.sin((p + off) * DEG), zc + sign * ch * Math.cos(th)] as V3 }))
    return { name: '에테인 C₂H₆ (엇갈린 형태)', atoms: [{ el: 'C', pos: [0, 0, -cc / 2] } as Atom, { el: 'C', pos: [0, 0, cc / 2] } as Atom, ...methyl(-cc / 2, 0, 1), ...methyl(cc / 2, 60, -1)] }
  })(),
  // carbon dioxide: C=O 1.16 Å, linear
  co2: { name: '이산화탄소 CO₂', atoms: [{ el: 'C', pos: [0, 0, 0] }, { el: 'O', pos: [1.16, 0, 0] }, { el: 'O', pos: [-1.16, 0, 0] }] },
}
