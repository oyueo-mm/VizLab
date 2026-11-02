/// <reference lib="webworker" />
import { createSimulation, type ForceOptions, type Network } from './network'

/**
 * Force simulation of a large network off the main thread. The page sends the graph once, then drag/pause messages; the worker answers with
 * the node positions (a Float32Array in node order) at most every ~16 ms, so the page only has to paint.
 */
export interface SimInit { t: 'init'; nodes: { id: string }[]; links: { source: string; target: string; weight: number }[]; opts: ForceOptions; previous: [string, number, number][]; pinned: Record<string, [number, number]>; alpha: number }
export type SimIn = SimInit | { t: 'drag'; id: string; x: number; y: number } | { t: 'release'; id: string; keep: boolean } | { t: 'pause'; on: boolean }
export type SimOut = { t: 'pos'; xy: Float32Array; alpha: number } | { t: 'done'; xy: Float32Array }

let sim: ReturnType<typeof createSimulation> | null = null
let ids = new Map<string, number>()
let target = 0
let paused = false
let timer = 0
let last = 0

const snapshot = () => { const xy = new Float32Array(sim!.nodes.length * 2); sim!.nodes.forEach((n, i) => { xy[2 * i] = n.x ?? 0; xy[2 * i + 1] = n.y ?? 0 }); return xy }

function run() {
  timer = 0
  if (!sim || paused) return
  const t0 = performance.now()
  // tick for about a frame, then report: the page draws the latest message only
  do { sim.sim.tick() } while (performance.now() - t0 < 10 && (target > 0 || sim.sim.alpha() > sim.sim.alphaMin()))
  const active = target > 0 || sim.sim.alpha() > sim.sim.alphaMin()
  const xy = snapshot()
  if (active) self.postMessage({ t: 'pos', xy, alpha: sim.sim.alpha() } satisfies SimOut, [xy.buffer])
  else self.postMessage({ t: 'done', xy } satisfies SimOut, [xy.buffer])
  if (active) { const wait = Math.max(0, 16 - (performance.now() - last)); last = performance.now() + wait; timer = self.setTimeout(run, wait) as unknown as number }
}
const wake = () => { if (!timer) timer = self.setTimeout(run, 0) as unknown as number }

self.onmessage = (e: MessageEvent<SimIn>) => {
  const m = e.data
  if (m.t === 'init') {
    if (timer) self.clearTimeout(timer)
    timer = 0; paused = false; target = 0
    const prev = new Map(m.previous.map(([id, x, y]) => [id, { x, y }]))
    sim = createSimulation({ nodes: m.nodes, links: m.links } as unknown as Network, m.opts, prev.size ? prev : undefined)
    ids = new Map(sim.nodes.map((n, i) => [n.id, i]))
    for (const n of sim.nodes) { const p = m.pinned[n.id]; if (p) { n.fx = p[0]; n.fy = p[1] } }
    sim.sim.alpha(m.alpha)
    last = performance.now()
    wake()
  } else if (!sim) return
  else if (m.t === 'drag') {
    const n = sim.nodes[ids.get(m.id) ?? -1]
    if (n) { n.fx = m.x; n.fy = m.y; target = 0.3; sim.sim.alphaTarget(0.3); wake() }
  } else if (m.t === 'release') {
    const n = sim.nodes[ids.get(m.id) ?? -1]
    target = 0; sim.sim.alphaTarget(0)
    if (n && !m.keep) { n.fx = null; n.fy = null }
    wake()
  } else if (m.t === 'pause') { paused = m.on; if (!paused) wake() }
}
