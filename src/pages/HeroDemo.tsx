import * as d3 from 'd3'
import { ArrowUpRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from '../hooks/motion'
import { useSize } from '../hooks/useSize'
import { createRng } from '../lib/random'
import { routeHref } from '../router'
import { boxStats } from '../stats/boxplot'
import { binValues, equalEdges } from '../stats/histogram'
import { kde, kdeGrid, silvermanBandwidth } from '../stats/kde'

export const heroStages = [
  { key: 'scatter', label: '산점도', viz: 'scatter' },
  { key: 'histogram', label: '히스토그램', viz: 'histogram' },
  { key: 'kde', label: 'KDE', viz: 'kde' },
  { key: 'box', label: '박스 플롯', viz: 'box' },
] as const
export type HeroStage = (typeof heroStages)[number]['key']

const N = 140
const STAGE_MS = 3400
const MOVE_MS = 900

/** One synthetic study-time (x) vs. score (y) sample; the cycle number shifts the mixture so every loop differs. */
export function heroSample(cycle: number) {
  const rng = createRng(1000 + cycle * 7919)
  const shift = Math.sin(cycle * 1.3) * 5
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < N; i++) {
    const x = rng() < 0.58 ? rng.normal(38 + shift, 7) : rng.normal(66 - shift / 2, 8)
    xs.push(Math.max(5, Math.min(95, x)))
    ys.push(Math.max(5, Math.min(98, 18 + 0.8 * x + rng.normal(0, 8))))
  }
  return { xs, ys }
}

/** Target position of every point for a stage, plus the overlay geometry derived from the same data. */
export function heroLayout(stage: HeroStage, xs: number[], ys: number[], w: number, h: number) {
  const m = { l: 18, r: 18, t: 18, b: 34 }
  const x = d3.scaleLinear().domain([0, 100]).range([m.l, w - m.r])
  const base = h - m.b
  const top = m.t
  const edges = equalEdges(0, 100 / 14, 14)
  const { bins } = binValues(xs, edges)
  const maxCount = d3.max(bins, (b) => b.count) ?? 1
  const dot = Math.min((x(edges[1]) - x(edges[0])) * 0.9, (base - top) / maxCount)
  const pts: [number, number, number][] = new Array(xs.length)
  if (stage === 'scatter') {
    const y = d3.scaleLinear().domain([0, 100]).range([base, top])
    xs.forEach((v, i) => { pts[i] = [x(v), y(ys[i]), 4] })
  } else if (stage === 'histogram') {
    const stackCount = bins.map(() => 0)
    const order = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0])
    for (const [v, i] of order) {
      const b = Math.min(bins.length - 1, Math.max(0, Math.floor(v / (100 / 14))))
      const k = stackCount[b]++
      pts[i] = [(x(edges[b]) + x(edges[b + 1])) / 2, base - (k + 0.5) * dot, Math.max(1.5, dot / 2 - 0.6)]
    }
  } else if (stage === 'kde') {
    xs.forEach((v, i) => { pts[i] = [x(v), base + 9, 2.2] })
  } else {
    const mid = top + (base - top) * 0.5
    xs.forEach((v, i) => {
      const j = Math.sin(i * 12.9898) * 43758.5453
      pts[i] = [x(v), mid + (j - Math.floor(j) - 0.5) * (base - top) * 0.36, 3]
    })
  }
  const grid = kdeGrid(0, 100, 0, 120)
  const dens = kde(xs, silvermanBandwidth(xs), 'gaussian', grid)
  const dMax = d3.max(dens) ?? 1
  const kdePath = d3.area<number>().x((_, i) => x(grid[i])).y0(base).y1((d) => base - (d / dMax) * (base - top) * 0.92).curve(d3.curveBasis)(dens) ?? ''
  const bars = bins.map((b) => ({ x: x(b.x0) + 1, w: x(b.x1) - x(b.x0) - 2, y: base - b.count * dot, h: b.count * dot }))
  const s = boxStats(xs)!
  const mid = top + (base - top) * 0.5
  const box = { q1: x(s.q1), q3: x(s.q3), med: x(s.median), lo: x(s.whiskerLow), hi: x(s.whiskerHigh), mid, h: (base - top) * 0.42 }
  return { pts, bars, kdePath, box, base, axis: x, m }
}

export function HeroDemo() {
  const reduced = useReducedMotion()
  const [wrapRef, size] = useSize<HTMLAnchorElement>()
  const [stageIndex, setStageIndex] = useState(0)
  const [cycle, setCycle] = useState(0)
  const [visible, setVisible] = useState(true)
  const circles = useRef<(SVGCircleElement | null)[]>([])
  const current = useRef<[number, number, number][] | null>(null)
  const stage = heroStages[stageIndex]
  const width = size.width || 560
  const height = Math.max(260, Math.min(420, width * 0.68))
  const sample = useMemo(() => heroSample(cycle), [cycle])
  const layout = useMemo(() => heroLayout(stage.key, sample.xs, sample.ys, width, height), [stage.key, sample, width, height])

  // Pause when off-screen or the tab is hidden.
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((es) => setVisible(es[0]?.isIntersecting ?? true))
    io.observe(el)
    const onVis = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', onVis) }
  }, [wrapRef])

  useEffect(() => {
    if (reduced || !visible) return
    const t = window.setTimeout(() => {
      if (stageIndex === heroStages.length - 1) { setStageIndex(0); setCycle((c) => c + 1) }
      else setStageIndex(stageIndex + 1)
    }, STAGE_MS)
    return () => window.clearTimeout(t)
  }, [stageIndex, reduced, visible])

  // Point morphing runs outside React: one rAF loop writes circle attributes directly.
  useEffect(() => {
    const target = layout.pts
    const from = current.current ?? target
    const apply = (pts: [number, number, number][]) => pts.forEach((p, i) => {
      const c = circles.current[i]
      if (c) { c.setAttribute('cx', p[0].toFixed(1)); c.setAttribute('cy', p[1].toFixed(1)); c.setAttribute('r', p[2].toFixed(2)) }
    })
    if (reduced || !current.current) { current.current = target; apply(target); return }
    const start = performance.now()
    // Stagger by horizontal position so the morph sweeps left to right.
    const delay = target.map((p) => (p[0] / width) * 260)
    let raf = 0
    const tick = (now: number) => {
      let done = true
      const pts = target.map((p, i) => {
        const t = Math.min(1, Math.max(0, (now - start - delay[i]) / MOVE_MS))
        if (t < 1) done = false
        const e = d3.easeCubicInOut(t)
        const f = from[i] ?? p
        return [f[0] + (p[0] - f[0]) * e, f[1] + (p[1] - f[1]) * e, f[2] + (p[2] - f[2]) * e] as [number, number, number]
      })
      current.current = pts
      apply(pts)
      if (!done) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [layout, reduced, width])

  const { bars, kdePath, box, base, axis } = layout
  const show = (k: HeroStage) => (stage.key === k ? 1 : 0)
  return (
    <figure className="hero-demo" data-testid="hero-demo" data-stage={stage.key}>
      <a ref={wrapRef} href={routeHref({ page: 'viz', id: stage.viz })} className="hero-canvas" aria-label={`${stage.label} 실험실 열기`} data-testid="hero-link">
        <svg width={width} height={height} role="img" aria-label={`같은 데이터 ${N}개를 ${stage.label}(으)로 표현한 그래프`}>
          <g className="hero-axis" aria-hidden="true">
            <line x1={axis.range()[0]} x2={axis.range()[1]} y1={base + 0.5} y2={base + 0.5} />
            {axis.ticks(5).map((t) => <text key={t} x={axis(t)} y={base + 24} textAnchor="middle">{t}</text>)}
          </g>
          <g className="hero-bars" style={{ opacity: show('histogram') }}>
            {bars.map((b, i) => <rect key={i} x={b.x} y={b.y} width={Math.max(0, b.w)} height={b.h} rx={2} />)}
          </g>
          <path className="hero-kde" d={kdePath} style={{ opacity: show('kde') }} />
          <g className="hero-box" style={{ opacity: show('box') }}>
            <line x1={box.lo} x2={box.q1} y1={box.mid} y2={box.mid} />
            <line x1={box.q3} x2={box.hi} y1={box.mid} y2={box.mid} />
            <line x1={box.lo} x2={box.lo} y1={box.mid - box.h / 4} y2={box.mid + box.h / 4} />
            <line x1={box.hi} x2={box.hi} y1={box.mid - box.h / 4} y2={box.mid + box.h / 4} />
            <rect x={box.q1} y={box.mid - box.h / 2} width={Math.max(1, box.q3 - box.q1)} height={box.h} rx={3} />
            <line className="hero-median" x1={box.med} x2={box.med} y1={box.mid - box.h / 2} y2={box.mid + box.h / 2} />
          </g>
          <g className={`hero-points stage-${stage.key}`}>
            {sample.xs.map((_, i) => <circle key={i} ref={(el) => { circles.current[i] = el }} />)}
          </g>
        </svg>
        <span className="hero-open">{stage.label} 실험실 <ArrowUpRight size={15} aria-hidden="true" /></span>
      </a>
      <figcaption className="hero-stages">
        <span className="hero-note">같은 데이터 {N}개</span>
        <div role="tablist" aria-label="표현 방식">
          {heroStages.map((s, i) => (
            <button key={s.key} type="button" role="tab" aria-selected={i === stageIndex} onClick={() => setStageIndex(i)} data-testid={`hero-stage-${s.key}`}>{s.label}</button>
          ))}
        </div>
      </figcaption>
    </figure>
  )
}
