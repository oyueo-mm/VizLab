import { describe, expect, it } from 'vitest'
import { createRng } from '../lib/random'
import { chromosomeOffsets, inflationFactor, leaves, lowCoverageRegions, neighborJoining, pathDistance, pcoa, runningMean, sequenceLogo, upgma } from './bio'

const euclid = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]))

describe('PCoA', () => {
  it('recovers planar points up to rotation: pairwise distances are reproduced from the first two axes', () => {
    const rng = createRng(3)
    const pts = Array.from({ length: 12 }, () => [rng() * 10, rng() * 6])
    const D = pts.map((p) => pts.map((q) => euclid(p, q)))
    const r = pcoa(D, 2)!
    expect(r.negativeShare).toBeCloseTo(0, 8)
    expect(r.explained[0] + r.explained[1]).toBeCloseTo(1, 6)
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) expect(euclid(r.coords[i], r.coords[j])).toBeCloseTo(D[i][j], 5)
    // the centred configuration has zero mean
    expect(r.coords.reduce((s, c) => s + c[0], 0)).toBeCloseTo(0, 8)
  })
  it('a non-Euclidean (violating the triangle inequality) matrix shows negative eigenvalues', () => {
    const D = [[0, 1, 5, 1], [1, 0, 1, 5], [5, 1, 0, 1], [1, 5, 1, 0]]
    expect(pcoa(D, 2)!.negativeShare).toBeGreaterThan(0.01)
    expect(pcoa([[0, 1], [1, 0]])).toBeNull()
  })
})

describe('phylogenetic trees', () => {
  it('UPGMA recovers an ultrametric tree: heights and the grouping of the two closest pairs', () => {
    // ((A,B):2,(C,D):4) with d(A,B)=2·1, d(C,D)=2·2, cross distance 2·5
    const D = [[0, 2, 10, 10], [2, 0, 10, 10], [10, 10, 0, 4], [10, 10, 4, 0]]
    const t = upgma(D, ['A', 'B', 'C', 'D'])
    expect(pathDistance(t, 'A', 'B')).toBeCloseTo(2, 12)
    expect(pathDistance(t, 'C', 'D')).toBeCloseTo(4, 12)
    expect(pathDistance(t, 'A', 'C')).toBeCloseTo(10, 12)
    expect(leaves(t).map((l) => l.name).sort()).toEqual(['A', 'B', 'C', 'D'])
  })
  it('neighbour joining reproduces every pairwise distance of an additive matrix (textbook 5-taxon example)', () => {
    const D = [[0, 5, 9, 9, 8], [5, 0, 10, 10, 9], [9, 10, 0, 8, 7], [9, 10, 8, 0, 3], [8, 9, 7, 3, 0]]
    const names = ['a', 'b', 'c', 'd', 'e']
    const t = neighborJoining(D, names)
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) expect(pathDistance(t, names[i], names[j])).toBeCloseTo(D[i][j], 9)
  })
})

describe('sequence logo', () => {
  const dna = ['A', 'C', 'G', 'T']
  it('a fully conserved column carries 2 bits, a uniform one 0 bits, and the small-sample correction lowers both', () => {
    const seqs = ['AAC', 'AGC', 'ATC', 'ACC']
    const raw = sequenceLogo(seqs, dna, false)
    expect(raw[0].bits).toBeCloseTo(2, 12)
    expect(raw[1].bits).toBeCloseTo(0, 12)
    expect(raw[2].bits).toBeCloseTo(2, 12)
    const corr = sequenceLogo(seqs, dna, true)
    expect(corr[0].bits).toBeCloseTo(2 - 3 / (2 * Math.LN2 * 4), 12)
    expect(corr[1].bits).toBe(0)
    expect(raw[0].freqs.A).toBe(1)
  })
  it('a 70/30 two-letter column has the entropy-based information content', () => {
    const seqs = [...Array(7).fill('A'), ...Array(3).fill('T')]
    const c = sequenceLogo(seqs, dna, false)[0]
    expect(c.bits).toBeCloseTo(2 - (-(0.7 * Math.log2(0.7) + 0.3 * Math.log2(0.3))), 12)
    expect(c.n).toBe(10)
  })
})

describe('coverage and genome layout', () => {
  it('finds low-coverage runs of at least the minimum length and smooths with a centred window', () => {
    const d = [30, 28, 3, 2, 1, 29, 30, 2, 31, 4, 3, 2, 1, 30]
    expect(lowCoverageRegions(d, 10, 3)).toEqual([[2, 4], [9, 12]])
    expect(lowCoverageRegions(d, 10, 1)).toHaveLength(3)
    expect(runningMean([1, 2, 3, 4, 5], 3)).toEqual([1.5, 2, 3, 4, 4.5])
  })
  it('chromosomes are laid out one after another with the gap between them', () => {
    expect(chromosomeOffsets([100, 50, 80], 10)).toEqual([0, 110, 170])
  })
  it('the inflation factor is ≈ 1 for uniform p-values and larger for inflated statistics', () => {
    const rng = createRng(9)
    const p = Array.from({ length: 5000 }, () => rng())
    expect(inflationFactor(p)).toBeGreaterThan(0.9)
    expect(inflationFactor(p)).toBeLessThan(1.1)
    expect(inflationFactor(p.map((v) => v ** 2))).toBeGreaterThan(1.5)
  })
})
