// ───────────────────────────── Hinton diagram ─────────────────────────────

/** Side of the square for a value: the area is proportional to |v| (side ∝ √|v|), scaled so that the largest |v| fills the cell. */
export function hintonSide(v: number, maxAbs: number): number {
  return maxAbs > 0 ? Math.sqrt(Math.abs(v) / maxAbs) : 0
}

// ───────────────────────────── Taylor / Target diagrams ─────────────────────────────

export interface SkillStats { sdObs: number; sdMod: number; r: number; /** centred (bias-removed) RMS difference */ crmsd: number; bias: number; rmsd: number }

const mean = (a: readonly number[]) => a.reduce((s, v) => s + v, 0) / a.length

/** Statistics shared by the Taylor and Target diagrams (population standard deviations, as in Taylor 2001). */
export function skillStats(obs: readonly number[], mod: readonly number[]): SkillStats {
  const n = obs.length
  const mo = mean(obs), mm = mean(mod)
  let so = 0, sm = 0, cov = 0, d2 = 0
  for (let i = 0; i < n; i++) { const a = obs[i] - mo, b = mod[i] - mm; so += a * a; sm += b * b; cov += a * b; d2 += (b - a) ** 2 }
  const sdObs = Math.sqrt(so / n), sdMod = Math.sqrt(sm / n)
  const r = sdObs > 0 && sdMod > 0 ? cov / n / (sdObs * sdMod) : 0
  const crmsd = Math.sqrt(d2 / n)
  const bias = mm - mo
  return { sdObs, sdMod, r, crmsd, bias, rmsd: Math.sqrt(crmsd * crmsd + bias * bias) }
}

/** Taylor diagram position of a model: radius = its standard deviation, angle = arccos(r) from the horizontal axis. */
export function taylorPoint(s: SkillStats): { radius: number; angle: number } {
  return { radius: s.sdMod, angle: Math.acos(Math.max(-1, Math.min(1, s.r))) }
}

/** Target diagram position (Jolliff et al. 2009): x = signed unbiased RMSD (sign of σm − σo), y = bias, both normalised by σo. */
export function targetPoint(s: SkillStats): { x: number; y: number } {
  const k = s.sdObs > 0 ? s.sdObs : 1
  const ubrmsd = Math.sqrt(Math.max(0, s.sdMod * s.sdMod + s.sdObs * s.sdObs - 2 * s.sdMod * s.sdObs * s.r))
  return { x: (Math.sign(s.sdMod - s.sdObs) * ubrmsd) / k, y: s.bias / k }
}

// ───────────────────────────── nomogram ─────────────────────────────

export interface NomoVar { name: string; min: number; max: number; beta: number }
export interface NomoScale extends NomoVar { /** points gained over the variable's range (0…100) */ range: number; /** value at which the variable scores 0 points */ ref: number; /** points of a value */ points: (x: number) => number }

/** Nomogram of a logistic model: every variable gets a points axis whose length is proportional to |β|·(max − min); the longest axis spans 100 points. */
export function nomogram(vars: readonly NomoVar[], intercept: number) {
  const spans = vars.map((v) => Math.abs(v.beta) * (v.max - v.min))
  const top = Math.max(...spans, 1e-12)
  const scales: NomoScale[] = vars.map((v, i) => {
    const ref = v.beta >= 0 ? v.min : v.max
    return { ...v, range: (100 * spans[i]) / top, ref, points: (x: number) => (100 * v.beta * (x - ref)) / top }
  })
  const lpMin = intercept + vars.reduce((s, v) => s + (v.beta >= 0 ? v.beta * v.min : v.beta * v.max), 0)
  const unit = top / 100 // log-odds per point
  return {
    scales,
    totalMax: scales.reduce((s, v) => s + v.range, 0),
    linearPredictor: (total: number) => lpMin + total * unit,
    probability: (total: number) => 1 / (1 + Math.exp(-(lpMin + total * unit))),
    pointsForProbability: (p: number) => (Math.log(p / (1 - p)) - lpMin) / unit,
  }
}

// ───────────────────────────── water chemistry (Piper, Stiff) ─────────────────────────────

/** Equivalent weights (g/eq) used to turn mg/L into meq/L. */
export const EQ_WEIGHT = { Ca: 20.04, Mg: 12.15, Na: 22.99, K: 39.1, HCO3: 61.02, SO4: 48.03, Cl: 35.45 } as const
export interface Ions { Ca: number; Mg: number; Na: number; K: number; HCO3: number; SO4: number; Cl: number }

export function toMeq(mgL: Ions): Ions {
  const o = {} as Ions
  for (const k of Object.keys(EQ_WEIGHT) as (keyof Ions)[]) o[k] = mgL[k] / EQ_WEIGHT[k]
  return o
}

/** Percentages of the cation (Ca, Mg, Na+K) and anion (HCO3, SO4, Cl) groups, from meq/L. */
export function piperPercents(meq: Ions) {
  const ct = meq.Ca + meq.Mg + meq.Na + meq.K, at = meq.HCO3 + meq.SO4 + meq.Cl
  return { Ca: ct ? (100 * meq.Ca) / ct : 0, Mg: ct ? (100 * meq.Mg) / ct : 0, NaK: ct ? (100 * (meq.Na + meq.K)) / ct : 0, HCO3: at ? (100 * meq.HCO3) / at : 0, SO4: at ? (100 * meq.SO4) / at : 0, Cl: at ? (100 * meq.Cl) / at : 0 }
}

/**
 * Piper diagram coordinates in a unit layout: the cation triangle (Ca left, Na+K right, Mg apex) at x 0…1, the anion triangle (HCO3 left, Cl right,
 * SO4 apex) at x 1.5…2.5, and the diamond between and above them whose point is fixed by %(Ca+Mg) and %(SO4+Cl): bottom = (0, 0) of both, left = Ca+Mg only, right = SO4+Cl only.
 */
export function piperLayout() {
  const h = Math.sqrt(3) / 2
  const cat = { Ca: [0, 0] as [number, number], NaK: [1, 0] as [number, number], Mg: [0.5, h] as [number, number] }
  const an = { HCO3: [1.5, 0] as [number, number], Cl: [2.5, 0] as [number, number], SO4: [2, h] as [number, number] }
  const dB: [number, number] = [1.25, h + 0.12]
  const eC: [number, number] = [-0.5, h], eA: [number, number] = [0.5, h]
  return { cat, an, diamond: { bottom: dB, eC, eA } }
}

export function piperPoints(p: ReturnType<typeof piperPercents>) {
  const L = piperLayout()
  const bary = (v: Record<string, [number, number]>, w: Record<string, number>) => { let x = 0, y = 0; for (const k of Object.keys(v)) { x += (w[k] / 100) * v[k][0]; y += (w[k] / 100) * v[k][1] } return [x, y] as [number, number] }
  const cation = bary(L.cat, { Ca: p.Ca, NaK: p.NaK, Mg: p.Mg })
  const anion = bary(L.an, { HCO3: p.HCO3, Cl: p.Cl, SO4: p.SO4 })
  const c = (p.Ca + p.Mg) / 100, a = (p.SO4 + p.Cl) / 100
  const d = L.diamond
  const diamond: [number, number] = [d.bottom[0] + c * d.eC[0] + a * d.eA[0], d.bottom[1] + c * d.eC[1] + a * d.eA[1]]
  return { cation, anion, diamond }
}

/** Stiff pattern rows: cations on the left, anions on the right, in meq/L (Na+K, Ca, Mg | Cl, HCO3, SO4). */
export function stiffRows(meq: Ions) {
  return [
    { cation: 'Na+K', anion: 'Cl', left: meq.Na + meq.K, right: meq.Cl },
    { cation: 'Ca', anion: 'HCO3', left: meq.Ca, right: meq.HCO3 },
    { cation: 'Mg', anion: 'SO4', left: meq.Mg, right: meq.SO4 },
  ]
}

// ───────────────────────────── Skew-T Log-P ─────────────────────────────

export const RD = 287.04, CP = 1005.7, KAPPA = RD / CP, LV = 2.501e6, EPS = 0.622
export const P0 = 1000

/** Skew-T coordinates: y grows with ln(p0/p), isotherms lean to the right by `skew` °C per unit of y. */
export function skewT(tC: number, p: number, skew = 35): { x: number; y: number } {
  const y = Math.log(P0 / p)
  return { x: tC + skew * y, y }
}

/** Saturation vapour pressure (hPa) over water, Bolton (1980). */
export const satVapor = (tC: number) => 6.112 * Math.exp((17.67 * tC) / (tC + 243.5))
/** Saturation mixing ratio (kg/kg) at temperature tC and pressure p (hPa). */
export const satMixing = (tC: number, p: number) => { const es = satVapor(tC); return (EPS * es) / Math.max(1e-6, p - es) }
/** Dewpoint (°C) for a vapour pressure e (hPa). */
export const dewFromVapor = (e: number) => { const l = Math.log(e / 6.112); return (243.5 * l) / (17.67 - l) }

/** Temperature (°C) on the dry adiabat of potential temperature theta (°C) at pressure p. */
export const dryAdiabat = (thetaC: number, p: number) => (thetaC + 273.15) * (p / P0) ** KAPPA - 273.15

/** Lifted condensation level (Bolton 1980): temperature (K) and pressure (hPa) from the surface temperature, dewpoint (°C) and pressure. */
export function lcl(tC: number, tdC: number, p: number) {
  const T = tC + 273.15, Td = tdC + 273.15
  const tl = 1 / (1 / (Td - 56) + Math.log(T / Td) / 800) + 56
  return { tK: tl, p: p * (tl / T) ** (1 / KAPPA) }
}

/** Moist-adiabatic lapse dT/dp (K/hPa) at T (K), p (hPa). */
export function moistLapse(TK: number, p: number): number {
  const rs = satMixing(TK - 273.15, p)
  return ((RD * TK + LV * rs) / (p * (CP + (LV * LV * rs * EPS) / (RD * TK * TK))))
}

/** Parcel path lifted from (t, td, p): dry adiabat up to the LCL, then the pseudo-adiabat; returns points (p hPa, T °C) from the surface to pTop. */
export function parcelPath(tC: number, tdC: number, p: number, pTop = 200, step = 10) {
  const L = lcl(tC, tdC, p)
  const pts: { p: number; t: number }[] = []
  const theta = tC + 273.15
  let q = p
  while (q > L.p) { pts.push({ p: q, t: dryAdiabat(theta - 273.15, q) * 1 }); q -= step }
  let T = dryAdiabat(theta - 273.15, L.p) + 273.15
  q = L.p
  pts.push({ p: q, t: T - 273.15 })
  while (q > pTop) {
    // classical RK4 in pressure
    const h = -step
    const k1 = moistLapse(T, q), k2 = moistLapse(T + (h * k1) / 2, q + h / 2), k3 = moistLapse(T + (h * k2) / 2, q + h / 2), k4 = moistLapse(T + h * k3, q + h)
    T += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4)
    q += h
    pts.push({ p: q, t: T - 273.15 })
  }
  return { lcl: L, path: pts }
}

// ───────────────────────────── Hasse diagram ─────────────────────────────

export interface Poset { elements: string[]; /** a ≤ b pairs after the transitive closure (a ≠ b) */ closure: Set<string>; covers: [string, string][]; level: Map<string, number>; cyclic: boolean; minimal: string[]; maximal: string[] }

/** Hasse diagram data of the partial order generated by the pairs (a ≤ b): transitive closure, antisymmetry check, covering relation (transitive reduction) and levels. */
export function hasse(pairs: readonly [string, string][]): Poset {
  const elements = [...new Set(pairs.flat())]
  const idx = new Map(elements.map((e, i) => [e, i]))
  const n = elements.length
  const le: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false))
  for (const [a, b] of pairs) if (a !== b) le[idx.get(a)!][idx.get(b)!] = true
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) if (le[i][k]) for (let j = 0; j < n; j++) if (le[k][j]) le[i][j] = true
  let cyclic = false
  for (let i = 0; i < n; i++) if (le[i][i]) cyclic = true
  const closure = new Set<string>()
  const covers: [string, string][] = []
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j || !le[i][j]) continue
    closure.add(`${elements[i]}\u0000${elements[j]}`)
    let between = false
    for (let k = 0; k < n && !between; k++) if (k !== i && k !== j && le[i][k] && le[k][j]) between = true
    if (!between) covers.push([elements[i], elements[j]])
  }
  const level = new Map<string, number>()
  if (!cyclic) {
    const memo = new Map<number, number>()
    const lv = (j: number): number => { if (!memo.has(j)) { let best = 0; for (const [a, b] of covers) if (idx.get(b) === j) best = Math.max(best, 1 + lv(idx.get(a)!)); memo.set(j, best) } return memo.get(j)! }
    elements.forEach((e, j) => level.set(e, lv(j)))
  }
  const minimal = elements.filter((_, j) => !le.some((row, i) => i !== j && row[j]))
  const maximal = elements.filter((_, i) => !le[i].some((v, j) => j !== i && v))
  return { elements, closure, covers, level, cyclic, minimal, maximal }
}

/** Order the elements inside each level by the barycentre of their neighbours in the level below (a few sweeps) to cut crossings. */
export function hasseOrder(p: Poset, sweeps = 6): string[][] {
  const maxL = Math.max(0, ...p.level.values())
  const rows: string[][] = Array.from({ length: maxL + 1 }, () => [])
  for (const e of p.elements) rows[p.level.get(e) ?? 0].push(e)
  rows.forEach((r) => r.sort())
  const pos = new Map<string, number>()
  const setPos = () => rows.forEach((r) => r.forEach((e, i) => pos.set(e, i)))
  setPos()
  for (let s = 0; s < sweeps; s++) {
    for (let l = 1; l <= maxL; l++) {
      const bary = (e: string) => { const nb = p.covers.filter(([, b]) => b === e).map(([a]) => pos.get(a)!); return nb.length ? nb.reduce((x, y) => x + y, 0) / nb.length : pos.get(e)! }
      rows[l].sort((a, b) => bary(a) - bary(b) || a.localeCompare(b))
      rows[l].forEach((e, i) => pos.set(e, i))
    }
    for (let l = maxL - 1; l >= 0; l--) {
      const bary = (e: string) => { const nb = p.covers.filter(([a]) => a === e).map(([, b]) => pos.get(b)!); return nb.length ? nb.reduce((x, y) => x + y, 0) / nb.length : pos.get(e)! }
      rows[l].sort((a, b) => bary(a) - bary(b) || a.localeCompare(b))
      rows[l].forEach((e, i) => pos.set(e, i))
    }
  }
  return rows
}
