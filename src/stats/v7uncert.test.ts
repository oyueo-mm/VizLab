import { describe, expect, it } from 'vitest'
import { createRng } from '../lib/random'
import { classicalMDS, euclid, fitDist, groupStats, hopDraw, meanQuantile, polylineCrossings, quantileDots, segmentCross, wilkinsonStack } from './uncert7'

const normalSample = (n: number, m: number, s: number, seed = 5) => { const r = createRng(seed); return Array.from({ length: n }, () => r.normal(m, s)) }

describe('distribution fits', () => {
  it('quantile and cdf are inverse functions for every family', () => {
    const data = normalSample(300, 50, 10).map((x) => Math.abs(x) + 1)
    for (const kind of ['normal', 'lognormal', 'exponential'] as const) {
      const d = fitDist(data, kind)!
      for (const p of [0.05, 0.25, 0.5, 0.75, 0.95]) expect(d.cdf(d.quantile(p)), `${kind} ${p}`).toBeCloseTo(p, 4)
    }
    const e = fitDist(data, 'empirical')!
    expect(e.quantile(0)).toBe(Math.min(...data))
    expect(e.quantile(1)).toBe(Math.max(...data))
  })
  it('refuses a fit it cannot make', () => {
    expect(fitDist([1], 'normal')).toBeNull()
    expect(fitDist([-1, -2, -3], 'lognormal')).toBeNull()
  })
})

describe('quantile dotplot', () => {
  it('each dot holds probability 1/n: the dots inside any interval carry its probability within 1/n', () => {
    const d = fitDist(normalSample(400, 10, 2), 'normal')!
    for (const n of [20, 50, 100]) {
      const dots = quantileDots(d, n)
      for (const [a, b] of [[6, 10], [8, 14], [10, 20], [-100, 9]]) {
        const inside = dots.filter((x) => x >= a && x < b).length / n
        expect(Math.abs(inside - (d.cdf(b) - d.cdf(a)))).toBeLessThanOrEqual(1 / n + 1e-9)
      }
    }
  })
  it('dots are sorted and symmetric around the median for a normal fit', () => {
    const d = fitDist(normalSample(400, 0, 1), 'normal')!
    const dots = quantileDots(d, 20)
    for (let i = 1; i < dots.length; i++) expect(dots[i]).toBeGreaterThan(dots[i - 1])
    expect(dots[0] + dots[19]).toBeCloseTo(2 * d.quantile(0.5), 9)
  })
})

describe('Wilkinson dot plot', () => {
  it('keeps every observation, stacks dots of a bin at its centre and bins are at least binWidth apart', () => {
    const v = [1, 1.1, 1.2, 2, 2.05, 5, 9, 9.4]
    const dots = wilkinsonStack(v, 0.5)
    expect(dots.length).toBe(v.length)
    expect(dots.filter((d) => Math.abs(d.x - 1.1) < 1e-9).map((d) => d.level)).toEqual([0, 1, 2])
    const centres = [...new Set(dots.map((d) => d.x))].sort((a, b) => a - b)
    expect(centres.length).toBe(4)
    for (let i = 1; i < centres.length; i++) expect(centres[i] - centres[i - 1]).toBeGreaterThan(0.4)
  })
})

describe('hypothetical outcome plots', () => {
  const g = groupStats(['a', 'a', 'a', 'a', 'b', 'b', 'b', 'b'], [10, 12, 11, 13, 20, 22, 19, 23])
  it('reproduces the same draw for the same seed and frame, and differs across frames and seeds', () => {
    expect(hopDraw(g, 4, 9)).toEqual(hopDraw(g, 4, 9))
    expect(hopDraw(g, 5, 9)).not.toEqual(hopDraw(g, 4, 9))
    expect(hopDraw(g, 4, 10)).not.toEqual(hopDraw(g, 4, 9))
  })
  it('draws follow the sampling distribution of the mean (mean and spread match)', () => {
    const draws = Array.from({ length: 4000 }, (_, f) => hopDraw(g, f, 3)[0])
    const m = draws.reduce((a, b) => a + b, 0) / draws.length
    expect(m).toBeCloseTo(g[0].mean, 1)
    const med = [...draws].sort((a, b) => a - b)[2000]
    expect(med).toBeCloseTo(g[0].mean, 1)
    // the 95% interval of the draws matches the t interval of the mean
    const sorted = [...draws].sort((a, b) => a - b)
    expect(sorted[Math.floor(0.975 * 4000)]).toBeCloseTo(meanQuantile(g[0], 0.975), 0)
  })
})

describe('classical MDS (time curves)', () => {
  it('recovers a planar configuration up to rotation: all pairwise distances are preserved', () => {
    const pts = [[0, 0, 0, 0], [3, 1, 0, 0], [1, 4, 0, 0], [-2, 2, 0, 0], [4, -3, 0, 0]]
    const D = pts.map((a) => pts.map((b) => euclid(a, b)))
    const Y = classicalMDS(D)
    for (let i = 0; i < pts.length; i++) for (let j = 0; j < pts.length; j++) expect(euclid(Y[i], Y[j])).toBeCloseTo(D[i][j], 5)
  })
  it('keeps similar states close even when they are far apart in time', () => {
    const states = [[0, 0, 1], [5, 5, 5], [0.1, 0, 1], [9, 1, 2]]
    const Y = classicalMDS(states.map((a) => states.map((b) => euclid(a, b))))
    expect(euclid(Y[0], Y[2])).toBeLessThan(euclid(Y[0], Y[1]))
  })
})

describe('Marey chart crossings', () => {
  it('finds the single meeting of two trains running in opposite directions', () => {
    const c = segmentCross({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 0, y0: 10, x1: 10, y1: 0 })!
    expect(c.x).toBeCloseTo(5, 9)
    expect(c.y).toBeCloseTo(5, 9)
    expect(segmentCross({ x0: 0, y0: 0, x1: 1, y1: 1 }, { x0: 2, y0: 2, x1: 3, y1: 3 })).toBeNull()
  })
  it('detects an overtaking between a slow and a fast train and ignores parallel trains', () => {
    const lines = [
      { key: 'slow', pts: [[0, 0], [10, 5]] as [number, number][] },
      { key: 'fast', pts: [[2, 0], [6, 5]] as [number, number][] },
      { key: 'slow2', pts: [[1, 0], [11, 5]] as [number, number][] },
    ]
    const x = polylineCrossings(lines)
    expect(x.map((c) => `${c.a}-${c.b}`)).toEqual(['slow-fast', 'fast-slow2'])
  })
})
