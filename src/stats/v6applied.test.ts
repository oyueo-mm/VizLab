import { describe, expect, it } from 'vitest'
import {
  alignmentColumns, buildBackbone, collocations, dihedral, directlyFollows, dispersion, distanceMatrix, enrichmentTest, enrichmentWalk, erlangC, faultTree, medianRanks, mmcStats, phiPsi, ramaRegion,
  simulateQueue, tokenize, toleranceStack, weibullCdf, weibullFit, zipf, type TolItem, type V3,
} from './applied'

describe('Weibull reliability', () => {
  it('median ranks of a complete sample are Bernard\'s (i − 0.3)/(n + 0.4)', () => {
    const p = medianRanks([10, 20, 30, 40, 50], [true, true, true, true, true])
    p.forEach((q, i) => expect(q.F).toBeCloseTo((i + 1 - 0.3) / 5.4, 12))
  })
  it('Johnson adjusted ranks: a suspension between failures raises the later ranks by the textbook amount', () => {
    // n = 5, sorted F, S, F, F, S: increments (6 − prev)/(1 + units left) = 6/6, 5/4, 3.75/3 → 1, 2.25, 3.5
    const p = medianRanks([1, 2, 3, 4, 5], [true, false, true, true, false])
    expect(p.map((q) => q.rank)).toEqual([1, 2.25, 3.5])
  })
  it('rank regression recovers β and η exactly from data placed on a Weibull line, and the mean/B10 formulas hold', () => {
    const n = 12, beta = 2.4, eta = 500
    const t = Array.from({ length: n }, (_, i) => eta * (-Math.log(1 - (i + 1 - 0.3) / (n + 0.4))) ** (1 / beta))
    const f = weibullFit(t, t.map(() => true), 'rry')!
    expect(f.beta).toBeCloseTo(beta, 8); expect(f.eta).toBeCloseTo(eta, 6); expect(f.r2).toBeCloseTo(1, 10)
    expect(weibullCdf(f.b10, f.beta, f.eta)).toBeCloseTo(0.1, 10)
    expect(weibullFit(t, t.map(() => true), 'rrx')!.beta).toBeCloseTo(beta, 8)
    expect(f.mean / f.eta).toBeCloseTo(0.8865, 3) // Γ(1 + 1/2.4)
    const t2 = Array.from({ length: n }, (_, i) => 100 * (-Math.log(1 - (i + 1 - 0.3) / (n + 0.4))) ** 0.5)
    expect(weibullFit(t2, t2.map(() => true), 'rry')!.mean / 100).toBeCloseTo(Math.sqrt(Math.PI) / 2, 8) // Γ(1.5)
  })
  it('maximum likelihood satisfies its score equation and handles suspended units', () => {
    const t = [105, 190, 240, 310, 420, 505, 600, 700], failed = [true, true, true, true, true, true, false, false]
    const m = weibullFit(t, failed, 'mle')!
    const r = 6, s0 = t.reduce((a, x) => a + x ** m.beta, 0), s1 = t.reduce((a, x) => a + x ** m.beta * Math.log(x), 0)
    const meanLn = t.slice(0, 6).reduce((a, x) => a + Math.log(x), 0) / r
    expect(s1 / s0 - 1 / m.beta - meanLn).toBeCloseTo(0, 8)
    expect(m.eta).toBeCloseTo((s0 / r) ** (1 / m.beta), 8)
    expect(m.beta).toBeGreaterThan(1)
  })
})

describe('tolerance stack-up', () => {
  const part = (name: string, nominal: number, tol: number, dir: 1 | -1 = 1, dist: TolItem['dist'] = 'normal'): TolItem => ({ name, nominal, plus: tol, minus: tol, dist, dir })
  it('worst case adds the tolerances and RSS adds their squares (Cp = 1 → σ = tol / 3)', () => {
    const items = [part('a', 10, 0.1), part('b', 20, 0.1, 1), part('c', 5, 0.1, -1), part('d', 3, 0.1, 1)]
    const r = toleranceStack(items, { n: 20000, seed: 4, cp: 1, lsl: null, usl: null })
    expect(r.nominal).toBe(28)
    expect(r.worstHi - r.worstLo).toBeCloseTo(0.8, 12)
    expect(r.rssSd).toBeCloseTo(Math.sqrt(4) * (0.1 / 3), 12)
    expect(r.mean).toBeCloseTo(28, 2)
    expect(Math.abs(r.sd / r.rssSd - 1)).toBeLessThan(0.03)
    expect(r.hist.reduce((a, b) => a + b, 0)).toBe(20000)
  })
  it('uniform and triangular parts use σ = h/√3 and h/√6; the out-of-spec share matches the normal tail', () => {
    const u = toleranceStack([part('u', 1, 0.3, 1, 'uniform')], { n: 30000, seed: 2, cp: 1, lsl: null, usl: null })
    expect(u.rssSd).toBeCloseTo(0.3 / Math.sqrt(3), 12)
    expect(Math.abs(u.sd / u.rssSd - 1)).toBeLessThan(0.02)
    const t = toleranceStack([part('t', 1, 0.3, 1, 'triangular')], { n: 30000, seed: 2, cp: 1, lsl: null, usl: null })
    expect(Math.abs(t.sd / (0.3 / Math.sqrt(6)) - 1)).toBeLessThan(0.02)
    const n = toleranceStack([part('n', 0, 0.3)], { n: 60000, seed: 9, cp: 1, lsl: -0.3, usl: 0.3 })
    expect(n.analyticOutside).toBeCloseTo(0.0026998, 5)
    expect(Math.abs(n.outside - n.analyticOutside)).toBeLessThan(0.0015)
  })
})

describe('queueing', () => {
  it('Erlang C matches the hand values and M/M/1 reduces to ρ', () => {
    expect(erlangC(1, 0.5)).toBeCloseTo(0.5, 12)
    expect(erlangC(2, 1.5)).toBeCloseTo(4.5 / 7, 12)
    const s = mmcStats(0.8, 1, 1)
    expect(s.wq).toBeCloseTo(0.8 / (1 * 0.2), 12)
    expect(s.lq).toBeCloseTo(0.8 * 0.8 / 0.2, 12)
    expect(mmcStats(2, 1, 2).stable).toBe(false)
  })
  it('the simulation reproduces the analytic mean wait and wait probability', () => {
    const run = simulateQueue(1.5, 1, 2, 40000, 11), a = mmcStats(1.5, 1, 2)
    expect(Math.abs(run.meanWait / a.wq - 1)).toBeLessThan(0.12)
    expect(Math.abs(run.pWait - a.pWait)).toBeLessThan(0.02)
    expect(Math.abs(run.utilisation - a.rho)).toBeLessThan(0.02)
    run.start.forEach((s, i) => { expect(s).toBeGreaterThanOrEqual(run.arrive[i] - 1e-12) })
    expect(Math.abs(run.meanQueue - a.lq) / a.lq).toBeLessThan(0.15)
  })
})

describe('process mining', () => {
  it('counts directly-follows pairs, mean gaps and variants per case', () => {
    const log = [['1', 'A', 0], ['1', 'B', 2], ['1', 'C', 5], ['2', 'A', 0], ['2', 'B', 4], ['2', 'C', 5], ['3', 'A', 1], ['3', 'C', 4]].map(([caseId, activity, time]) => ({ caseId: caseId as string, activity: activity as string, time: time as number }))
    const r = directlyFollows(log)
    expect(r.cases).toBe(3)
    expect(r.edges.find((e) => e.a === 'A' && e.b === 'B')).toEqual({ a: 'A', b: 'B', count: 2, mean: 3 })
    expect(r.edges.find((e) => e.a === 'A' && e.b === 'C')?.mean).toBe(3)
    expect(r.variants[0]).toEqual({ path: 'A → B → C', count: 2 })
    expect(r.starts.get('A')).toBe(3); expect(r.ends.get('C')).toBe(3)
  })
})

describe('fault tree', () => {
  const gates = [{ name: 'TOP', kind: 'OR' as const, inputs: ['G1', 'C'] }, { name: 'G1', kind: 'AND' as const, inputs: ['A', 'B'] }]
  it('matches the closed form P = 1 − (1 − pA pB)(1 − pC) and finds the minimal cut sets', () => {
    const r = faultTree(gates, { A: 0.1, B: 0.2, C: 0.05 }, 'TOP')!
    expect(r.topP).toBeCloseTo(1 - (1 - 0.02) * (1 - 0.05), 12)
    expect(r.cuts.map((c) => c.events.slice().sort().join('+')).sort()).toEqual(['A+B', 'C'])
    expect(r.birnbaum.find((b) => b.name === 'C')!.birnbaum).toBeCloseTo(1 - 0.02, 12)
    expect(r.birnbaum.find((b) => b.name === 'A')!.birnbaum).toBeCloseTo(0.2 * 0.95, 12)
  })
  it('k-out-of-n gates use the binomial tail', () => {
    const r = faultTree([{ name: 'T', kind: 'KOFN', inputs: ['x', 'y', 'z'], k: 2 }], { x: 0.1, y: 0.1, z: 0.1 }, 'T')!
    expect(r.topP).toBeCloseTo(3 * 0.01 * 0.9 + 0.001, 12)
  })
})

describe('gene-set enrichment', () => {
  it('a set that fills the top of the list has ES = 1 and a spread-out set stays near 0', () => {
    const n = 100, scores = Array.from({ length: n }, (_, i) => 3 - (6 * i) / (n - 1))
    const top = scores.map((_, i) => i < 10), spread = scores.map((_, i) => i % 10 === 0)
    expect(enrichmentWalk(scores, top, 0)!.es).toBeCloseTo(1, 12)
    expect(Math.abs(enrichmentWalk(scores, spread, 0)!.es)).toBeLessThan(0.15)
    const hand = enrichmentWalk([3, 2, 1, -1], [true, false, true, false], 1)! // N_R = 4, miss step 1/2 → 0.75, 0.25, 0.5, 0
    expect(hand.run).toEqual([0.75, 0.25, 0.5, 0])
    expect(hand.es).toBe(0.75)
  })
  it('the permutation p-value is small for the top set and large for a random one', () => {
    const n = 200, scores = Array.from({ length: n }, (_, i) => 3 - (6 * i) / (n - 1))
    const top = enrichmentTest(scores, scores.map((_, i) => i < 15), 1, 300, 1)!
    expect(top.pValue).toBeLessThan(0.02); expect(top.nes).toBeGreaterThan(2)
    const rnd = enrichmentTest(scores, scores.map((_, i) => (i * 37) % 200 < 15), 1, 300, 1)!
    expect(rnd.pValue).toBeGreaterThan(0.05)
  })
})

describe('alignment columns', () => {
  it('entropy and information content of conserved and uniform columns (no correction)', () => {
    const seqs = ['AAC', 'AGC', 'ATC', 'ACC']
    const { cols } = alignmentColumns(seqs, 'dna', false)
    expect(cols[0].entropy).toBeCloseTo(0, 12); expect(cols[0].ic).toBeCloseTo(2, 12)
    expect(cols[1].entropy).toBeCloseTo(2, 12); expect(cols[1].ic).toBeCloseTo(0, 12)
    expect(cols[2].consensus).toBe('C')
    expect(alignmentColumns(['A-', 'A-', 'AC'], 'dna', true).cols[1].n).toBe(1)
    // small-sample correction for 4 letters, n = 4: e = 3 / (2 ln2 · 4)
    expect(alignmentColumns(seqs, 'dna', true).cols[0].ic).toBeCloseTo(2 - 3 / (2 * Math.LN2 * 4), 12)
  })
})

describe('protein backbone geometry', () => {
  it('dihedral angle has the IUPAC sign convention', () => {
    const a: V3 = [1, 0, 0], b: V3 = [0, 0, 0], c: V3 = [0, 1, 0]
    expect(dihedral(a, b, c, [0, 1, 1])).toBeCloseTo(-90, 9)
    expect(dihedral(a, b, c, [0, 1, -1])).toBeCloseTo(90, 9)
    expect(Math.abs(dihedral(a, b, c, [1, 1, 0]))).toBeCloseTo(0, 9)
    expect(Math.abs(dihedral(a, b, c, [-1, 1, 0]))).toBeCloseTo(180, 9)
  })
  it('φ/ψ recomputed from built coordinates round-trip, bond lengths are ideal and a helix has ~1.5 Å rise per residue', () => {
    const phi = Array.from({ length: 12 }, () => -57), psi = Array.from({ length: 12 }, () => -47)
    const atoms = buildBackbone(phi, psi)
    const pp = phiPsi(atoms)
    for (let i = 1; i < 11; i++) { expect(pp[i].phi).toBeCloseTo(-57, 6); expect(pp[i].psi).toBeCloseTo(-47, 6) }
    expect(Number.isNaN(pp[0].phi)).toBe(true); expect(Number.isNaN(pp[11].psi)).toBe(true)
    const ca = atoms.filter((a) => a.atom === 'CA').map((a) => a.xyz)
    const d = distanceMatrix(ca)
    expect(d[0][1]).toBeCloseTo(3.8, 1)
    expect(d[0][4]).toBeCloseTo(6.2, 0) // i → i+4 in an α-helix ≈ 6.2 Å
    expect(ramaRegion(-57, -47)).toBe('α-나선'); expect(ramaRegion(-120, 130)).toBe('β-가닥'); expect(ramaRegion(60, 45)).toBe('왼손 나선')
  })
})

describe('text statistics', () => {
  it('tokenises letters and digits, lower-cased', () => { expect(tokenize("Hello, World! It's 2026 — 안녕 세계")).toEqual(['hello', 'world', "it's", '2026', '안녕', '세계']) })
  it('PMI is log2(p(a,b)/(p(a)p(b))) and is positive for words that always co-occur', () => {
    const toks = 'a b x y x y a b x y'.split(' ')
    const c = collocations(toks, 1, 1), ab = c.rows.find((r) => r.a === 'a' && r.b === 'b')!
    expect(ab.count).toBe(2)
    expect(ab.pmi).toBeGreaterThan(0)
    expect(c.total).toBe(9 - toks.filter((_, i) => i < 9 && toks[i] === toks[i + 1]).length)
  })
  it('windows do not cross an empty sentence-boundary token', () => {
    const c = collocations(['a', 'b', '', 'c', 'd'], 5, 1)
    expect(c.rows.map((r) => `${r.a}${r.b}`).sort()).toEqual(['ab', 'cd'])
    expect(c.freq.has('')).toBe(false)
  })
  it('Gries DP is 0 for evenly spread words and large for a word that sits in one part', () => {
    const toks = Array.from({ length: 100 }, (_, i) => (i % 10 === 0 ? 'even' : i < 10 ? 'clump' : 'x'))
    const [even, clump] = dispersion(toks.map((t, i) => (i < 10 && t === 'clump' ? 'clump' : t)), ['even', 'clump'], 10)
    expect(even.dp).toBeCloseTo(0, 12)
    expect(clump.dp).toBeCloseTo(0.9, 12)
  })
  it('Zipf slope is −1 for a perfect 1/rank corpus', () => {
    const toks: string[] = []
    for (let r = 1; r <= 8; r++) for (let k = 0; k < 840 / r; k++) toks.push(`w${r}`)
    const z = zipf(toks, 1, 8)
    expect(z.fit!.slope).toBeCloseTo(-1, 6)
    expect(z.rows[0].word).toBe('w1')
    expect(z.hapax).toBe(0)
  })
})
