import { ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from '../hooks/motion'
import { useSize } from '../hooks/useSize'
import { routeHref } from '../router'
import { MarkEngine } from './heroEngine'
import { buildFrame, heroData, heroStages } from './heroFrames'
import { heroGeoReady, loadHeroGeo } from './heroFramesV4'
import { heroV5Ready, loadHeroV5 } from './heroFramesV5Lazy'
import { heroV6Ready, loadHeroV6 } from './heroFramesV6Lazy'
import { heroV7Ready, loadHeroV7 } from './heroFramesV7Lazy'
import { heroV8Ready, loadHeroV8 } from './heroFramesV8Lazy'
import { heroV9Ready, loadHeroV9 } from './heroFramesV9Lazy'
import { heroV10Ready, loadHeroV10 } from './heroFramesV10Lazy'
import { heroV11Ready, loadHeroV11 } from './heroFramesV11Lazy'

export { heroStages } from './heroFrames'
export type { HeroStage } from './heroFrames'

/** Time between the start of one chart and the next (ms). */
export const STAGE_MS = 1800
/** Duration of the morph into the next chart (ms); the rest of STAGE_MS is the hold. */
export const MOVE_MS = 600

export function HeroDemo() {
  const reduced = useReducedMotion()
  const [wrapRef, size] = useSize<HTMLAnchorElement>()
  const [index, setIndex] = useState(0)
  const [cycle, setCycle] = useState(0)
  const [inView, setInView] = useState(true)
  const [tabVisible, setTabVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  const gRef = useRef<SVGGElement>(null)
  const engine = useRef<MarkEngine | null>(null)
  const last = useRef<{ w: number; h: number } | null>(null)
  const stage = heroStages[index]
  const [geoReady, setGeoReady] = useState(heroGeoReady())
  const [v5Ready, setV5Ready] = useState(heroV5Ready())
  const [v6Ready, setV6Ready] = useState(heroV6Ready())
  const [v7Ready, setV7Ready] = useState(heroV7Ready())
  const [v8Ready, setV8Ready] = useState(heroV8Ready())
  const [v9Ready, setV9Ready] = useState(heroV9Ready())
  const [v10Ready, setV10Ready] = useState(heroV10Ready())
  const [v11Ready, setV11Ready] = useState(heroV11Ready())
  const width = size.width || 560
  const height = Math.max(260, Math.min(420, width * 0.68))
  const data = useMemo(() => heroData(cycle), [cycle])
  const running = inView && tabVisible && !reduced

  // The map shapes are a separate chunk: fetch them a few stages before the map comes up (never at page load).
  useEffect(() => {
    if (geoReady || index < heroStages.findIndex((s) => s.group === 'geo') - 5) return
    let live = true
    void loadHeroGeo().then(() => { if (live) setGeoReady(true) }).catch(() => {})
    return () => { live = false }
  }, [index, geoReady])

  // The v0.5 stages' engines are another chunk: fetched a few stages ahead, or at once when a v0.5 stage is shown directly (the previous button wraps around).
  useEffect(() => {
    if (v5Ready || (index < heroStages.findIndex((s) => s.group === 'v5') - 5 && stage.group !== 'v5')) return
    let live = true
    void loadHeroV5().then(() => { if (live) setV5Ready(true) }).catch(() => {})
    return () => { live = false }
  }, [index, v5Ready, stage.group])

  // The v0.6 stages' engines are one more chunk, fetched the same way.
  useEffect(() => {
    if (v6Ready || (index < heroStages.findIndex((s) => s.group === 'v6') - 5 && stage.group !== 'v6')) return
    let live = true
    void loadHeroV6().then(() => { if (live) setV6Ready(true) }).catch(() => {})
    return () => { live = false }
  }, [index, v6Ready, stage.group])

  // The v0.7 stages' engines are the last chunk, fetched the same way.
  useEffect(() => {
    if (v7Ready || (index < heroStages.findIndex((s) => s.group === 'v7') - 5 && stage.group !== 'v7')) return
    let live = true
    void loadHeroV7().then(() => { if (live) setV7Ready(true) }).catch(() => {})
    return () => { live = false }
  }, [index, v7Ready, stage.group])

  // The v0.8 stages' engines are the last chunk, fetched the same way.
  useEffect(() => {
    if (v8Ready || (index < heroStages.findIndex((s) => s.group === 'v8') - 5 && stage.group !== 'v8')) return
    let live = true
    void loadHeroV8().then(() => { if (live) setV8Ready(true) }).catch(() => {})
    return () => { live = false }
  }, [index, v8Ready, stage.group])

  // The v0.9 stages' engines are one more chunk, fetched the same way.
  useEffect(() => {
    if (v9Ready || (index < heroStages.findIndex((s) => s.group === 'v9') - 5 && stage.group !== 'v9')) return
    let live = true
    void loadHeroV9().then(() => { if (live) setV9Ready(true) }).catch(() => {})
    return () => { live = false }
  }, [index, v9Ready, stage.group])

  // The v1.0 stages' engines are one more chunk, fetched the same way.
  useEffect(() => {
    if (v10Ready || (index < heroStages.findIndex((s) => s.group === 'v10') - 5 && stage.group !== 'v10')) return
    let live = true
    void loadHeroV10().then(() => { if (live) setV10Ready(true) }).catch(() => {})
    return () => { live = false }
  }, [index, v10Ready, stage.group])

  // The v1.1 stages' engines are one more chunk, fetched the same way.
  useEffect(() => {
    if (v11Ready || (index < heroStages.findIndex((s) => s.group === 'v11') - 5 && stage.group !== 'v11')) return
    let live = true
    void loadHeroV11().then(() => { if (live) setV11Ready(true) }).catch(() => {})
    return () => { live = false }
  }, [index, v11Ready, stage.group])

  // Pause when the chart is off-screen or the tab is hidden.
  useEffect(() => {
    const el = wrapRef.current
    const onVis = () => setTabVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVis)
    let io: IntersectionObserver | undefined
    if (el && typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((es) => setInView(es[es.length - 1]?.isIntersecting ?? true))
      io.observe(el)
    }
    return () => { document.removeEventListener('visibilitychange', onVis); io?.disconnect() }
  }, [wrapRef])

  // One timer at a time: it is re-armed whenever the chart changes and cleared when paused or unmounted.
  useEffect(() => {
    if (!running) return
    const t = window.setTimeout(() => {
      if (index === heroStages.length - 1) { setIndex(0); setCycle((c) => c + 1) } else setIndex(index + 1)
    }, STAGE_MS)
    return () => window.clearTimeout(t)
  }, [index, running])

  // Draw the current chart. Marks live outside React: the engine mutates SVG attributes during the morph.
  useEffect(() => {
    const g = gRef.current
    if (!g) return
    engine.current ??= new MarkEngine(g)
    const resized = !last.current || last.current.w !== width || last.current.h !== height
    last.current = { w: width, h: height }
    engine.current.setFrame(buildFrame(stage.key, data, width, height), resized || reduced || !running ? 0 : MOVE_MS, width)
  }, [stage.key, data, width, height, reduced, running, geoReady, v5Ready, v6Ready, v7Ready, v8Ready, v9Ready, v10Ready, v11Ready])

  useEffect(() => () => { engine.current?.destroy(); engine.current = null }, [])

  const step = useCallback((d: 1 | -1) => {
    if (d === 1 && index === heroStages.length - 1) { setIndex(0); setCycle((c) => c + 1) } else setIndex((index + d + heroStages.length) % heroStages.length)
  }, [index])

  return (
    <figure className="hero-demo" data-testid="hero-demo" data-stage={stage.key} data-group={stage.group} data-running={running ? '1' : '0'}>
      <a ref={wrapRef} href={routeHref({ page: 'viz', id: stage.viz })} className="hero-canvas" aria-label={`${stage.label} 실험실 열기`} data-testid="hero-link">
        <svg className="hero-svg" width={width} height={height} role="img" aria-label={`${stage.label} 예시`}>
          <g ref={gRef} data-testid="hero-marks" />
        </svg>
        <span className="hero-open">{stage.label} 실험실 <ArrowUpRight size={15} aria-hidden="true" /></span>
      </a>
      <figcaption className="hero-bar">
        <div className="hero-nav">
          <button type="button" className="icon-btn" onClick={() => step(-1)} aria-label="이전 시각화" data-testid="hero-prev"><ChevronLeft size={18} /></button>
          <strong className="hero-name" aria-live="off" data-testid="hero-name">{stage.label}</strong>
          <button type="button" className="icon-btn" onClick={() => step(1)} aria-label="다음 시각화" data-testid="hero-next"><ChevronRight size={18} /></button>
        </div>
        <div className="hero-progress" aria-hidden="true">
          {heroStages.map((s, i) => <span key={s.key} className={i === index ? 'is-active' : i < index ? 'is-done' : ''} />)}
        </div>
        <span className="hero-count" data-testid="hero-count">{index + 1} / {heroStages.length}</span>
      </figcaption>
    </figure>
  )
}
