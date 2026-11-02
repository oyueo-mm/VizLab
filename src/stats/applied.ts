import { createRng } from '../lib/random'
import { logGamma } from './distributions'
import { normalCdf } from './ecdf'

/** Applied methods behind the v0.6 industry, bioinformatics and text charts. */

// ─── Weibull reliability ────────────────────────────────────────────────────────────

export interface LifePoint { t: number; failed: boolean; rank: number; F: number; x: number; y: number }

/** Johnson adjusted ranks with Bernard's median-rank plotting positions F = (rank − 0.3)/(n + 0.4); suspended (censored) units only change the ranks of later failures. Points are returned for failures only. */
export function medianRanks(times: readonly number[], failed: readonly boolean[]): LifePoint[] {
  const n = times.length
  const order = times.map((_, i) => i).sort((a, b) => times[a] - times[b] || Number(failed[b]) - Number(failed[a]))
  const out: LifePoint[] = []
  let prev = 0
  order.forEach((idx, i) => {
    if (!failed[idx]) return
    const reverse = n - i
    const rank = prev + (n + 1 - prev) / (1 + reverse)
    prev = rank
    const F = (rank - 0.3) / (n + 0.4)
    out.push({ t: times[idx], failed: true, rank, F, x: Math.log(times[idx]), y: Math.log(-Math.log(1 - F)) })
  })
  return out
}

const linfit = (x: number[], y: number[]) => {
  const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n
  let sxx = 0, sxy = 0, syy = 0
  for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); syy += (y[i] - my) ** 2 }
  const slope = sxy / sxx, intercept = my - slope * mx
  return { slope, intercept, r2: syy > 0 ? (sxy * sxy) / (sxx * syy) : 1 }
}

export interface WeibullFit { beta: number; eta: number; r2: number; points: LifePoint[]; b10: number; mean: number; method: 'rry' | 'rrx' | 'mle' }

/** Two-parameter Weibull from the probability plot (regress y on ln t, or ln t on y) or by maximum likelihood with right censoring. */
export function weibullFit(times: readonly number[], failed: readonly boolean[], method: 'rry' | 'rrx' | 'mle'): WeibullFit | null {
  const pts = medianRanks(times, failed)
  if (pts.length < 2 || times.some((t) => !(t > 0))) return null
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
  let beta: number, eta: number, r2: number
  if (method === 'rrx') {
    const f = linfit(ys, xs) // ln t = a + b·y  →  β = 1/b, η = e^a
    beta = 1 / f.slope; eta = Math.exp(f.intercept); r2 = f.r2
  } else {
    const f = linfit(xs, ys) // y = β ln t − β ln η
    beta = f.slope; eta = Math.exp(-f.intercept / f.slope); r2 = f.r2
  }
  if (method === 'mle') {
    const r = failed.filter(Boolean).length
    const lnFail = times.filter((_, i) => failed[i]).map(Math.log), meanLn = lnFail.reduce((a, b) => a + b, 0) / r
    const score = (b: number) => { let s0 = 0, s1 = 0; for (const t of times) { const tb = t ** b; s0 += tb; s1 += tb * Math.log(t) } return s1 / s0 - 1 / b - meanLn }
    let lo = 0.05, hi = 50
    if (score(lo) * score(hi) > 0) return null
    for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (score(lo) * score(mid) <= 0) hi = mid; else lo = mid }
    beta = (lo + hi) / 2
    eta = (times.reduce((s, t) => s + t ** beta, 0) / r) ** (1 / beta)
  }
  if (!Number.isFinite(beta) || !Number.isFinite(eta) || beta <= 0) return null
  return { beta, eta, r2, points: pts, method, b10: eta * (-Math.log(0.9)) ** (1 / beta), mean: eta * Math.exp(logGamma(1 + 1 / beta)) }
}

export const weibullCdf = (t: number, beta: number, eta: number) => 1 - Math.exp(-((t / eta) ** beta))

// ─── tolerance stack-up ─────────────────────────────────────────────────────────────

export interface TolItem { name: string; nominal: number; plus: number; minus: number; dist: 'normal' | 'uniform' | 'triangular'; dir: 1 | -1 }

export function toleranceStack(items: readonly TolItem[], opts: { n: number; seed: number; cp: number; lsl: number | null; usl: number | null; bins?: number }) {
  const nominal = items.reduce((s, it) => s + it.dir * it.nominal, 0)
  const half = (it: TolItem) => (it.plus + it.minus) / 2
  const centre = (it: TolItem) => it.nominal + (it.plus - it.minus) / 2
  const worst = items.reduce((s, it) => s + half(it), 0)
  const sigmaOf = (it: TolItem) => (it.dist === 'normal' ? half(it) / (3 * opts.cp) : it.dist === 'uniform' ? half(it) / Math.sqrt(3) : half(it) / Math.sqrt(6))
  const meanGap = items.reduce((s, it) => s + it.dir * centre(it), 0)
  const rssSd = Math.sqrt(items.reduce((s, it) => s + sigmaOf(it) ** 2, 0))
  const rng = createRng(opts.seed)
  const draw = (it: TolItem) => {
    const c = centre(it), h = half(it)
    if (it.dist === 'normal') return c + sigmaOf(it) * rng.normal()
    if (it.dist === 'uniform') return c + h * (2 * rng() - 1)
    const u = rng(); return c + h * (u < 0.5 ? -1 + Math.sqrt(2 * u) : 1 - Math.sqrt(2 * (1 - u)))
  }
  const gap = new Array<number>(opts.n)
  for (let k = 0; k < opts.n; k++) { let g = 0; for (const it of items) g += it.dir * draw(it); gap[k] = g }
  const mean = gap.reduce((a, b) => a + b, 0) / opts.n
  const sd = Math.sqrt(gap.reduce((a, b) => a + (b - mean) ** 2, 0) / (opts.n - 1))
  const lo = Math.min(...gap), hi = Math.max(...gap), bins = opts.bins ?? 40, width = (hi - lo) / bins || 1
  const hist = new Array<number>(bins).fill(0)
  for (const g of gap) hist[Math.min(bins - 1, Math.floor((g - lo) / width))]++
  const outside = gap.filter((g) => (opts.lsl != null && g < opts.lsl) || (opts.usl != null && g > opts.usl)).length
  // share of each part in the variance of the gap
  const share = items.map((it) => sigmaOf(it) ** 2 / (rssSd ** 2))
  const cpk = (() => { const c: number[] = []; if (opts.usl != null) c.push((opts.usl - mean) / (3 * sd)); if (opts.lsl != null) c.push((mean - opts.lsl) / (3 * sd)); return c.length ? Math.min(...c) : NaN })()
  const analytic = (opts.usl != null || opts.lsl != null) ? 1 - ((opts.usl != null ? normalCdf(opts.usl, meanGap, rssSd) : 1) - (opts.lsl != null ? normalCdf(opts.lsl, meanGap, rssSd) : 0)) : NaN
  return { nominal, worstLo: nominal - worst, worstHi: nominal + worst, rssLo: meanGap - 3 * rssSd, rssHi: meanGap + 3 * rssSd, meanGap, rssSd, mean, sd, lo, hi, width, hist, outside: outside / opts.n, analyticOutside: analytic, cpk, share }
}

// ─── queueing ───────────────────────────────────────────────────────────────────────

/** Erlang C: probability that an arriving customer must wait in an M/M/c queue with offered load a = λ/μ < c. */
export function erlangC(c: number, a: number): number {
  if (a >= c) return 1
  let term = 1, sum = 1
  for (let k = 1; k < c; k++) { term *= a / k; sum += term }
  const last = (term * a) / c * (1 / (1 - a / c)) // a^c / c! · 1/(1−ρ)
  return last / (sum + last)
}

export function mmcStats(lambda: number, mu: number, c: number) {
  const a = lambda / mu, rho = a / c
  if (rho >= 1) return { a, rho, pWait: 1, lq: Infinity, wq: Infinity, w: Infinity, l: Infinity, stable: false }
  const pWait = erlangC(c, a), wq = pWait / (c * mu - lambda), lq = lambda * wq
  return { a, rho, pWait, lq, wq, w: wq + 1 / mu, l: lq + a, stable: true }
}

export interface QueueRun { arrive: number[]; start: number[]; end: number[]; server: number[]; wait: number[]; meanWait: number; pWait: number; utilisation: number; horizon: number; steps: { t: number; inQueue: number; inService: number }[]; meanQueue: number }

/** Event-driven simulation of an M/M/c queue (Poisson arrivals, exponential service, first come first served). */
export function simulateQueue(lambda: number, mu: number, c: number, customers: number, seed: number): QueueRun {
  const rng = createRng(seed), arrive: number[] = [], service: number[] = []
  let t = 0
  for (let i = 0; i < customers; i++) { t += -Math.log(1 - rng()) / lambda; arrive.push(t); service.push(-Math.log(1 - rng()) / mu) }
  return runQueue(arrive, service, c)
}

/** First-come-first-served queue with `c` identical servers for given arrival times and service durations (a G/G/c run on recorded data). */
export function runQueue(arrive: readonly number[], service: readonly number[], c: number): QueueRun {
  const customers = arrive.length, start: number[] = [], end: number[] = [], server: number[] = []
  const free = new Array<number>(c).fill(-Infinity)
  for (let i = 0; i < customers; i++) {
    let s = 0
    for (let k = 1; k < c; k++) if (free[k] < free[s]) s = k
    const st = Math.max(arrive[i], free[s]), en = st + service[i]
    free[s] = en; start.push(st); end.push(en); server.push(s)
  }
  const wait = arrive.map((a, i) => start[i] - a)
  const horizon = Math.max(...end) - Math.min(...arrive)
  const ev: { t: number; dq: number; ds: number }[] = []
  for (let i = 0; i < customers; i++) { ev.push({ t: arrive[i], dq: 1, ds: 0 }, { t: start[i], dq: -1, ds: 1 }, { t: end[i], dq: 0, ds: -1 }) }
  ev.sort((a, b) => a.t - b.t)
  const steps: QueueRun['steps'] = []
  let q = 0, s = 0, prev = 0, area = 0
  for (const e of ev) { area += q * (e.t - prev); prev = e.t; q += e.dq; s += e.ds; steps.push({ t: e.t, inQueue: q, inService: s }) }
  const busy = start.reduce((acc, st, i) => acc + (end[i] - st), 0)
  return { arrive: [...arrive], start, end, server, wait, meanWait: wait.reduce((a, b) => a + b, 0) / customers, pWait: wait.filter((w) => w > 1e-12).length / customers, utilisation: busy / (c * horizon), horizon, steps, meanQueue: area / horizon }
}

// ─── process mining ─────────────────────────────────────────────────────────────────

export interface EventRec { caseId: string; activity: string; time: number }

/** Directly-follows graph of an event log: counts and mean waiting time per edge, per-activity frequency and the most common case variants. */
export function directlyFollows(events: readonly EventRec[]) {
  const byCase = new Map<string, EventRec[]>()
  for (const e of events) { const l = byCase.get(e.caseId) ?? []; l.push(e); byCase.set(e.caseId, l) }
  const acts = new Map<string, number>(), edges = new Map<string, { a: string; b: string; count: number; total: number }>(), variants = new Map<string, number>(), starts = new Map<string, number>(), ends = new Map<string, number>()
  for (const [, list] of byCase) {
    list.sort((x, y) => x.time - y.time)
    list.forEach((e, i) => {
      acts.set(e.activity, (acts.get(e.activity) ?? 0) + 1)
      if (i === 0) starts.set(e.activity, (starts.get(e.activity) ?? 0) + 1)
      if (i === list.length - 1) ends.set(e.activity, (ends.get(e.activity) ?? 0) + 1)
      if (i > 0) { const p = list[i - 1], k = `${p.activity}\u0001${e.activity}`, r = edges.get(k) ?? { a: p.activity, b: e.activity, count: 0, total: 0 }; r.count++; r.total += e.time - p.time; edges.set(k, r) }
    })
    const key = list.map((e) => e.activity).join(' → ')
    variants.set(key, (variants.get(key) ?? 0) + 1)
  }
  return {
    cases: byCase.size, activities: [...acts.entries()].map(([name, count]) => ({ name, count })), starts, ends,
    edges: [...edges.values()].map((e) => ({ a: e.a, b: e.b, count: e.count, mean: e.total / e.count })),
    variants: [...variants.entries()].map(([path, count]) => ({ path, count })).sort((x, y) => y.count - x.count),
  }
}

// ─── fault tree ─────────────────────────────────────────────────────────────────────

export interface Gate { name: string; kind: 'AND' | 'OR' | 'KOFN'; inputs: string[]; k?: number }

/** Exact top-event probability of a coherent fault tree with independent basic events: Shannon decomposition on the basic events (≤ 18 events). Returns minimal cut sets and Birnbaum importance too. */
export function faultTree(gates: readonly Gate[], p: Record<string, number>, top: string) {
  const gateMap = new Map(gates.map((g) => [g.name, g]))
  const basics = [...new Set(gates.flatMap((g) => g.inputs).filter((x) => !gateMap.has(x)))]
  if (basics.length > 18 || !gateMap.has(top)) return null
  const evalTop = (state: Map<string, boolean>): boolean => {
    const memo = new Map<string, boolean>()
    const ev = (name: string): boolean => {
      const g = gateMap.get(name)
      if (!g) return state.get(name) ?? false
      const hit = memo.get(name); if (hit !== undefined) return hit
      const vals = g.inputs.map(ev)
      const r = g.kind === 'AND' ? vals.every(Boolean) : g.kind === 'OR' ? vals.some(Boolean) : vals.filter(Boolean).length >= (g.k ?? 1)
      memo.set(name, r); return r
    }
    return ev(top)
  }
  const nB = basics.length, fail: boolean[] = new Array(1 << nB)
  for (let m = 0; m < 1 << nB; m++) fail[m] = evalTop(new Map(basics.map((b, i) => [b, (m >> i & 1) === 1])))
  const prob = (probs: number[]) => { let t = 0; for (let m = 0; m < 1 << nB; m++) if (fail[m]) { let w = 1; for (let i = 0; i < nB; i++) w *= (m >> i & 1) ? probs[i] : 1 - probs[i]; t += w } return t }
  const base = basics.map((b) => p[b] ?? 0)
  const topP = prob(base)
  // minimal cut sets: failing states none of whose proper subsets fail
  const cuts: string[][] = []
  for (let m = 1; m < 1 << nB; m++) {
    if (!fail[m]) continue
    let minimal = true
    for (let i = 0; i < nB && minimal; i++) if ((m >> i & 1) && fail[m & ~(1 << i)]) minimal = false
    if (minimal) cuts.push(basics.filter((_, i) => (m >> i & 1) === 1))
  }
  const birnbaum = basics.map((_, i) => { const hi = base.slice(), lo = base.slice(); hi[i] = 1; lo[i] = 0; return prob(hi) - prob(lo) })
  const cutProb = (c: string[]) => c.reduce((a, b) => a * (p[b] ?? 0), 1)
  return { basics, topP, cuts: cuts.map((c) => ({ events: c, p: cutProb(c) })).sort((a, b) => b.p - a.p), birnbaum: basics.map((b, i) => ({ name: b, birnbaum: birnbaum[i], criticality: topP > 0 ? (birnbaum[i] * base[i]) / topP : 0 })) }
}

// ─── gene-set enrichment ────────────────────────────────────────────────────────────

/** Running enrichment score of a gene set along a ranked list (Subramanian et al.): hits add |r|^p / N_R, misses subtract 1/(N − N_H); ES is the largest deviation from zero. */
export function enrichmentWalk(scores: readonly number[], inSet: readonly boolean[], p = 1) {
  const n = scores.length, nh = inSet.filter(Boolean).length
  const nr = scores.reduce((s, v, i) => s + (inSet[i] ? Math.abs(v) ** p : 0), 0)
  if (nh === 0 || nh === n || nr === 0) return null
  const run = new Array<number>(n)
  let cur = 0, es = 0, at = 0
  for (let i = 0; i < n; i++) {
    cur += inSet[i] ? Math.abs(scores[i]) ** p / nr : -1 / (n - nh)
    run[i] = cur
    if (Math.abs(cur) > Math.abs(es)) { es = cur; at = i }
  }
  return { run, es, at, hits: nh }
}

/** Permutation null (random gene sets of the same size) → normalised ES and empirical p-value. */
export function enrichmentTest(scores: readonly number[], inSet: readonly boolean[], p: number, perms: number, seed: number) {
  const walk = enrichmentWalk(scores, inSet, p)
  if (!walk) return null
  const rng = createRng(seed), n = scores.length
  const nulls: number[] = []
  const idx = Array.from({ length: n }, (_, i) => i)
  for (let k = 0; k < perms; k++) {
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]] }
    const set = new Array<boolean>(n).fill(false)
    for (let i = 0; i < walk.hits; i++) set[idx[i]] = true
    const w = enrichmentWalk(scores, set, p)
    if (w) nulls.push(w.es)
  }
  const same = nulls.filter((v) => (walk.es >= 0 ? v >= 0 : v < 0))
  const meanSame = same.length ? same.reduce((a, b) => a + Math.abs(b), 0) / same.length : NaN
  const extreme = same.filter((v) => (walk.es >= 0 ? v >= walk.es : v <= walk.es)).length
  return { ...walk, nes: walk.es / meanSame, pValue: (extreme + 1) / (same.length + 1), nulls }
}

// ─── sequence alignment columns ─────────────────────────────────────────────────────

const AA = 'ACDEFGHIKLMNPQRSTVWY'

/** Per-column residue frequencies, Shannon entropy (bits) and information content with the small-sample correction e_n = (s − 1)/(2 ln 2 · n). Gaps are ignored in the frequencies. */
export function alignmentColumns(seqs: readonly string[], alphabet: 'protein' | 'dna', smallSample: boolean) {
  const letters = alphabet === 'protein' ? AA : 'ACGT', s = letters.length, len = Math.max(0, ...seqs.map((q) => q.length))
  const cols = [] as { counts: number[]; n: number; entropy: number; ic: number; consensus: string; gapFrac: number }[]
  for (let j = 0; j < len; j++) {
    const counts = new Array<number>(s).fill(0)
    let n = 0, gaps = 0
    for (const q of seqs) { const ch = (q[j] ?? '-').toUpperCase(), k = letters.indexOf(ch); if (k >= 0) { counts[k]++; n++ } else gaps++ }
    let H = 0
    for (const c of counts) if (c > 0) H -= (c / n) * Math.log2(c / n)
    const en = smallSample && n > 0 ? (s - 1) / (2 * Math.LN2 * n) : 0
    const ic = n > 0 ? Math.max(0, Math.log2(s) - (H + en)) : 0
    const top = counts.indexOf(Math.max(...counts))
    cols.push({ counts, n, entropy: H, ic, consensus: n > 0 ? letters[top] : '-', gapFrac: gaps / seqs.length })
  }
  return { letters, cols }
}

// ─── protein backbone geometry ──────────────────────────────────────────────────────

export type V3 = [number, number, number]
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm3 = (a: V3) => Math.sqrt(dot3(a, a))
const scale3 = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
const unit3 = (a: V3) => scale3(a, 1 / norm3(a))

/** Dihedral angle (degrees, IUPAC sign) defined by four points. */
export function dihedral(p0: V3, p1: V3, p2: V3, p3: V3): number {
  const b0 = sub3(p0, p1), b1 = unit3(sub3(p2, p1)), b2 = sub3(p3, p2)
  const v = sub3(b0, scale3(b1, dot3(b0, b1))), w = sub3(b2, scale3(b1, dot3(b2, b1)))
  const x = dot3(v, w), y = dot3(cross3(b1, v), w)
  return (Math.atan2(y, x) * 180) / Math.PI
}

/** Place a fourth atom from three known ones (natural extension reference frame): bond length, bond angle and torsion in degrees. */
function place(a: V3, b: V3, c: V3, length: number, angle: number, torsion: number): V3 {
  const th = (angle * Math.PI) / 180, ph = (torsion * Math.PI) / 180
  const bc = unit3(sub3(c, b)), n = unit3(cross3(sub3(b, a), bc)), m = cross3(n, bc)
  const d: V3 = [-length * Math.cos(th), length * Math.sin(th) * Math.cos(ph), length * Math.sin(th) * Math.sin(ph)]
  return [c[0] + bc[0] * d[0] + m[0] * d[1] + n[0] * d[2], c[1] + bc[1] * d[0] + m[1] * d[1] + n[1] * d[2], c[2] + bc[2] * d[0] + m[2] * d[1] + n[2] * d[2]]
}

export interface BackboneAtom { residue: number; atom: 'N' | 'CA' | 'C'; xyz: V3 }

/** Backbone N–CA–C coordinates of a chain with the given φ/ψ angles (ω = 180°, ideal Engh & Huber geometry). */
export function buildBackbone(phi: readonly number[], psi: readonly number[]): BackboneAtom[] {
  const L = { nca: 1.458, cac: 1.525, cn: 1.329 }, A = { n: 111.0, ca: 116.2, c: 121.7 }
  const atoms: BackboneAtom[] = []
  let N: V3 = [0, 0, 0], CA: V3 = [L.nca, 0, 0], C: V3 = [L.nca + L.cac * Math.cos(((180 - A.n) * Math.PI) / 180), L.cac * Math.sin(((180 - A.n) * Math.PI) / 180), 0]
  atoms.push({ residue: 0, atom: 'N', xyz: N }, { residue: 0, atom: 'CA', xyz: CA }, { residue: 0, atom: 'C', xyz: C })
  for (let i = 1; i < phi.length; i++) {
    const Nn = place(N, CA, C, L.cn, A.ca, psi[i - 1])
    const CAn = place(CA, C, Nn, L.nca, A.c, 180)
    const Cn = place(C, Nn, CAn, L.cac, A.n, phi[i])
    atoms.push({ residue: i, atom: 'N', xyz: Nn }, { residue: i, atom: 'CA', xyz: CAn }, { residue: i, atom: 'C', xyz: Cn })
    N = Nn; CA = CAn; C = Cn
  }
  return atoms
}

/** φ (C₍ᵢ₋₁₎–N–CA–C) and ψ (N–CA–C–N₍ᵢ₊₁₎) per residue from backbone atoms; undefined at the chain ends. */
export function phiPsi(atoms: readonly BackboneAtom[]) {
  const by = new Map<number, Partial<Record<'N' | 'CA' | 'C', V3>>>()
  for (const a of atoms) { const r = by.get(a.residue) ?? {}; r[a.atom] = a.xyz; by.set(a.residue, r) }
  const ids = [...by.keys()].sort((a, b) => a - b)
  return ids.map((id, k) => {
    const r = by.get(id)!, prev = by.get(ids[k - 1] ?? NaN), next = by.get(ids[k + 1] ?? NaN)
    const phi = prev?.C && r.N && r.CA && r.C ? dihedral(prev.C, r.N, r.CA, r.C) : NaN
    const psi = next?.N && r.N && r.CA && r.C ? dihedral(r.N, r.CA, r.C, next.N) : NaN
    return { residue: id, phi, psi }
  })
}

export type RamaRegion = 'α-나선' | 'β-가닥' | '왼손 나선' | '기타'
/** Coarse Ramachandran regions (generously drawn boxes, not a validated force-field map). */
export function ramaRegion(phi: number, psi: number): RamaRegion {
  if (phi >= -160 && phi <= -20 && psi >= -80 && psi <= 10) return 'α-나선'
  if (phi >= -180 && phi <= -45 && (psi >= 90 || psi <= -150)) return 'β-가닥'
  if (phi >= 30 && phi <= 100 && psi >= -20 && psi <= 90) return '왼손 나선'
  return '기타'
}

/** Pairwise Cα distances; the contact map marks pairs closer than `cutoff` and at least `minSep` apart along the chain. */
export function distanceMatrix(xyz: readonly V3[]): number[][] {
  return xyz.map((a) => xyz.map((b) => norm3(sub3(a, b))))
}

// ─── text statistics ────────────────────────────────────────────────────────────────

export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean)
}

/** Pointwise mutual information of co-occurrence inside a sliding window: PMI = log2( p(a,b) / (p(a) p(b)) ). Counts are pairs of positions within `window` tokens of each other. */
export function collocations(tokens: readonly string[], window: number, minCount: number) {
  const n = tokens.length, freq = new Map<string, number>()
  for (const t of tokens) if (t !== '') freq.set(t, (freq.get(t) ?? 0) + 1)
  const pair = new Map<string, number>()
  let total = 0
  // an empty token marks a sentence boundary: windows never cross it
  for (let i = 0; i < n; i++) for (let j = i + 1; j <= Math.min(n - 1, i + window); j++) {
    if (tokens[i] === '') break
    if (tokens[j] === '') break
    if (tokens[i] === tokens[j]) continue
    const [a, b] = tokens[i] < tokens[j] ? [tokens[i], tokens[j]] : [tokens[j], tokens[i]]
    pair.set(`${a}\u0001${b}`, (pair.get(`${a}\u0001${b}`) ?? 0) + 1); total++
  }
  const wordTotal = new Map<string, number>()
  for (const [k, c] of pair) { const [a, b] = k.split('\u0001'); wordTotal.set(a, (wordTotal.get(a) ?? 0) + c); wordTotal.set(b, (wordTotal.get(b) ?? 0) + c) }
  const rows = [...pair.entries()].filter(([, c]) => c >= minCount).map(([k, c]) => {
    const [a, b] = k.split('\u0001')
    const pmi = Math.log2((c / total) / (((wordTotal.get(a) ?? 1) / (2 * total)) * ((wordTotal.get(b) ?? 1) / (2 * total))))
    return { a, b, count: c, pmi }
  })
  return { freq, rows, total }
}

/** Positions (0-based token index) of each word and Gries' deviation of proportions DP over `parts` equal parts (0 = evenly spread, near 1 = clumped). */
export function dispersion(tokens: readonly string[], words: readonly string[], parts: number) {
  const n = tokens.length
  return words.map((w) => {
    const pos: number[] = [], count = new Array<number>(parts).fill(0)
    tokens.forEach((t, i) => { if (t === w) { pos.push(i); count[Math.min(parts - 1, Math.floor((i / n) * parts))]++ } })
    const total = pos.length
    let dp = NaN
    if (total > 0) dp = 0.5 * count.reduce((s, c) => s + Math.abs(c / total - 1 / parts), 0)
    return { word: w, positions: pos, count, total, dp }
  })
}

/** Rank–frequency table and the log-log least-squares slope over ranks [from, to] (Zipf's law: slope ≈ −1). */
export function zipf(tokens: readonly string[], from: number, to: number) {
  const freq = new Map<string, number>()
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1)
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([w, f], i) => ({ word: w, freq: f, rank: i + 1 }))
  const sel = sorted.filter((r) => r.rank >= from && r.rank <= to)
  const fit = sel.length >= 2 ? linfit(sel.map((r) => Math.log(r.rank)), sel.map((r) => Math.log(r.freq))) : null
  return { rows: sorted, fit, types: sorted.length, tokens: tokens.length, hapax: sorted.filter((r) => r.freq === 1).length }
}
