import * as d3 from 'd3'
import { Maximize, Pause, Play, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { ChartMessage, Legend, Readout, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Select, Slider, Toggle } from '../../components/controls'
import { useReducedMotion } from '../../hooks/motion'
import { categoryColor, colorAt } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { buildNetwork, createSimulation, layoutNetwork, type ForceOptions, type SimNode } from '../../stats/network'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { edgeRoles, edgeRows, NetworkEditor, networkKey } from './networkShared'

export interface NetworkParams {
  linkDistance: number
  linkStrength: number
  charge: number
  gravity: number
  nodeSize: 'fixed' | 'degree' | 'strength'
  size: number
  colorBy: 'group' | 'component' | 'degree'
  labels: 'all' | 'hover' | 'none'
  linkOpacity: number
  pinDrag: boolean
  /** Positions of nodes the user pinned by dragging. */
  pinned: Record<string, [number, number]>
  /** Incremented to restart the layout from scratch. */
  restart: number
  /** 'auto' draws on a canvas when the graph is large (nodes + links above AUTO_CANVAS); SVG keeps every element inspectable. */
  renderer: 'auto' | 'svg' | 'canvas'
}

/** Graph size (nodes + links) above which 'auto' switches from SVG to canvas. Chosen from the measurements in the v0.4 notes. */
export const AUTO_CANVAS = 1500


type Pos = Map<string, { x: number; y: number }>

function NetworkChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<NetworkParams>) {
  const rows = useMemo(() => edgeRows(table, mapping), [table, mapping])
  const net = useMemo(() => buildNetwork(rows), [rows])
  const key = networkKey(net)
  const reduced = useReducedMotion()
  // The legend, readout and buttons sit in a strip along the top; the graph is laid out below it.
  const topPad = compact ? 0 : width < 520 ? 84 : 44
  const iw = Math.max(40, width)
  const ih = Math.max(40, height - topPad)
  const maxR = compact ? params.size * 0.6 : params.size * 2.2
  const opts: ForceOptions = useMemo(() => ({ width: iw, height: ih, linkDistance: compact ? Math.min(params.linkDistance, Math.min(iw, ih) / 5) : params.linkDistance, linkStrength: params.linkStrength, charge: compact ? params.charge * 0.5 : params.charge, gravity: params.gravity, radius: params.size }),
    [iw, ih, params.linkDistance, params.linkStrength, params.charge, params.gravity, params.size, compact])
  // Synchronous layout: used for thumbnails, tests and as the starting point of the live simulation. A large graph only gets a rough first
  // layout (each tick costs time proportional to the graph), because the live simulation keeps improving it without blocking the page.
  const settled = useMemo(() => layoutNetwork(net, opts, compact ? 220 : net.nodes.length > 400 ? 40 : 300), [key, opts]) // eslint-disable-line react-hooks/exhaustive-deps
  const [live, setLive] = useState<Pos | null>(null)
  const positions = (!compact && live) || settled
  const posRef = useRef<Pos>(settled)
  const useCanvas = !compact && (params.renderer === 'canvas' || (params.renderer === 'auto' && net.nodes.length + net.links.length > AUTO_CANVAS))
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef<(() => void) | null>(null)
  const canvasModeRef = useRef(useCanvas)
  canvasModeRef.current = useCanvas
  const [running, setRunning] = useState(false)
  // While the simulation runs on a canvas the live positions only exist in the ref; at rest (or in SVG mode) they are the rendered state.
  if (!(useCanvas && running)) posRef.current = positions
  const simRef = useRef<{ sim: ReturnType<typeof createSimulation>['sim']; nodes: SimNode[] } | null>(null)
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  pausedRef.current = paused
  const dragNode = useRef<string | null>(null)
  const panning = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const [tf, setTf] = useState({ k: 1, x: 0, y: 0 })
  const [hover, setHover] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const pinnedRef = useRef(params.pinned)
  pinnedRef.current = params.pinned
  const { tip, show, hide } = useTooltip()

  // Live simulation. Starts from the previous positions so editing the data nudges the layout instead of rebuilding it,
  // and stops itself when the system has cooled (alpha < alphaMin) — nothing runs while the graph is at rest.
  useEffect(() => {
    if (compact || reduced || !net.nodes.length) { setLive(null); setRunning(false); return }
    const { sim, nodes } = createSimulation(net, opts, posRef.current.size ? posRef.current : undefined)
    for (const n of nodes) { const p = pinnedRef.current[n.id]; if (p) { n.fx = p[0]; n.fy = p[1] } }
    simRef.current = { sim, nodes }
    sim.alpha(posRef.current.size ? 0.6 : 1)
    let raf = 0
    const snapshot = () => new Map(nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }])) as Pos
    const loop = () => {
      if (!pausedRef.current) {
        sim.tick()
        const snap = snapshot()
        // Canvas: draw straight from the simulation without re-rendering React; SVG: the positions are React state.
        if (canvasModeRef.current) { posRef.current = snap; drawRef.current?.() } else setLive(snap)
      }
      if (dragNode.current || sim.alpha() > sim.alphaMin()) { raf = requestAnimationFrame(loop); setRunning(true) } else { if (canvasModeRef.current) setLive(snapshot()); setRunning(false); raf = 0 }
    }
    raf = requestAnimationFrame(loop)
    const wake = () => { if (!raf) raf = requestAnimationFrame(loop) }
    ;(sim as unknown as { wake: () => void }).wake = wake
    return () => { cancelAnimationFrame(raf); sim.stop(); simRef.current = null }
  }, [key, opts, params.restart, compact, reduced]) // eslint-disable-line react-hooks/exhaustive-deps

  // Wheel zoom (needs a non-passive listener to stop the page from scrolling).
  useEffect(() => {
    const el = svgRef.current
    if (!el || compact) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const px = e.clientX - r.left
      const py = e.clientY - r.top
      setTf((t) => {
        const k = Math.max(0.3, Math.min(5, t.k * Math.exp(-e.deltaY * 0.0015)))
        return { k, x: px - ((px - t.x) / t.k) * k, y: py - ((py - t.y) / t.k) * k }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [compact])

  const groups = useMemo(() => [...new Set(net.nodes.map((n) => n.group).filter(Boolean))], [net])
  const hasGroups = groups.length > 0
  const groupColor = useMemo(() => categoryColor(groups), [groups])
  const maxDeg = Math.max(1, ...net.nodes.map((n) => n.degree))
  const maxStr = Math.max(1, ...net.nodes.map((n) => n.strength))
  const wmax = Math.max(1, ...net.links.map((l) => l.weight))
  const radius = (n: (typeof net.nodes)[number]) => (params.nodeSize === 'fixed' ? params.size : params.nodeSize === 'degree' ? params.size * (0.7 + 1.5 * Math.sqrt(n.degree / maxDeg)) : params.size * (0.7 + 1.5 * Math.sqrt(n.strength / maxStr)))
  const colorOf = (n: (typeof net.nodes)[number]) => (params.colorBy === 'degree' ? d3.interpolateYlGnBu(0.25 + 0.7 * (n.degree / maxDeg)) : params.colorBy === 'group' && hasGroups ? (n.group ? groupColor(n.group) : '#9aa3a0') : colorAt(n.component))
  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>(net.nodes.map((n) => [n.id, new Set([n.id])]))
    for (const l of net.links) { map.get(l.source)!.add(l.target); map.get(l.target)!.add(l.source) }
    return map
  }, [net])

  if (!edgeRoles.every((r) => !r.required || mappingHas(mapping, r.key))) return <ChartMessage>출발 노드와 도착 노드(범주형) 열을 선택하세요.</ChartMessage>
  if (!net.nodes.length) return <ChartMessage>노드가 없습니다. 출발 노드 열에 이름을 입력하세요.</ChartMessage>

  const marked = new Set(linked?.rows ?? [])
  const focus = hover ?? selected
  const near = focus ? neighbors.get(focus) : null
  const editable = !compact
  const toGraph = (e: { clientX: number; clientY: number }) => {
    const p = localPoint(svgRef.current!, e)
    return { x: (p.x - tf.x) / tf.k, y: (p.y - tf.y - topPad) / tf.k }
  }
  /** The node under the pointer (canvas mode has no per-node elements, so it is found by distance in graph coordinates). */
  const hitNode = (e: { clientX: number; clientY: number; target?: EventTarget | null }): string | null => {
    if (!useCanvas) return (e.target as Element | null)?.closest?.('[data-node]')?.getAttribute('data-node') ?? null
    const g = toGraph(e)
    let best: string | null = null
    let bestD = Infinity
    for (const n of net.nodes) {
      const p = posRef.current.get(n.id)
      if (!p) continue
      const r = Math.min(maxR, radius(n)) + 3 / tf.k
      const d = (p.x - g.x) ** 2 + (p.y - g.y) ** 2
      if (d <= r * r && d <= bestD) { best = n.id; bestD = d }
    }
    return best
  }
  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!editable) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const id = hitNode(e)
    if (id) {
      dragNode.current = id
      const sim = simRef.current
      const node = sim?.nodes.find((n) => n.id === id)
      if (sim && node) { const g = toGraph(e); node.fx = g.x; node.fy = g.y; sim.sim.alphaTarget(0.3); (sim.sim as unknown as { wake?: () => void }).wake?.() }
      setSelected(id)
      hide()
    } else {
      panning.current = { x: e.clientX, y: e.clientY, tx: tf.x, ty: tf.y }
      setSelected(null)
    }
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (useCanvas && !dragNode.current && !panning.current) {
      const id = hitNode(e)
      if (id !== hover) {
        setHover(id)
        const n = id ? net.nodes.find((q) => q.id === id) : null
        linked?.set(n ? n.rows : null)
        if (n) { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{n.id}</b>{n.group && <><br />그룹 {n.group}</>}<br />연결 {n.degree}개 · 가중치 합 {fmt(n.strength)}<br />드래그해 이동{params.pinDrag ? '·고정' : ''}</>) } else hide()
      }
    }
    if (dragNode.current) {
      const sim = simRef.current
      const node = sim?.nodes.find((n) => n.id === dragNode.current)
      if (node) { const g = toGraph(e); node.fx = g.x; node.fy = g.y }
      return
    }
    if (panning.current) { const p = panning.current; setTf((t) => ({ ...t, x: p.tx + e.clientX - p.x, y: p.ty + e.clientY - p.y })); return }
  }
  const onUp = () => {
    const id = dragNode.current
    dragNode.current = null
    panning.current = null
    const sim = simRef.current
    if (id && sim) {
      const node = sim.nodes.find((n) => n.id === id)
      sim.sim.alphaTarget(0)
      if (node) {
        if (params.pinDrag && node.fx != null && node.fy != null) setParams({ pinned: { ...params.pinned, [id]: [node.fx, node.fy] } })
        else { node.fx = null; node.fy = null }
      }
    }
  }
  const fit = () => setTf({ k: 1, x: 0, y: 0 })

  const draw = () => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    if (cv.width !== Math.round(width * dpr) || cv.height !== Math.round(height * dpr)) { cv.width = Math.round(width * dpr); cv.height = Math.round(height * dpr) }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.save()
    ctx.translate(tf.x, tf.y + topPad)
    ctx.scale(tf.k, tf.k)
    const pos = posRef.current
    // Links are batched by line width so thousands of them cost a few stroke() calls; dimmed ones go in one faint batch.
    const batches = new Map<string, Path2D>()
    const hot = new Path2D()
    let hasHot = false
    for (const l of net.links) {
      const a = pos.get(l.source)
      const b = pos.get(l.target)
      if (!a || !b) continue
      const isNear = near ? near.has(l.source) && near.has(l.target) && (l.source === focus || l.target === focus) : true
      const isMarked = l.rows.some((r) => marked.has(r))
      const w = 0.8 + 3.2 * Math.sqrt(l.weight / wmax)
      if (isMarked) { hot.moveTo(a.x, a.y); hot.lineTo(b.x, b.y); hasHot = true; continue }
      const key = `${isNear ? 1 : 0}|${(Math.round(w * 2) / 2).toFixed(1)}`
      let path = batches.get(key)
      if (!path) { path = new Path2D(); batches.set(key, path) }
      path.moveTo(a.x, a.y)
      path.lineTo(b.x, b.y)
    }
    ctx.strokeStyle = '#5b6763'
    for (const [key, path] of batches) {
      const [near1, w] = key.split('|')
      ctx.globalAlpha = near1 === '1' ? params.linkOpacity : 0.06
      ctx.lineWidth = Number(w)
      ctx.stroke(path)
    }
    if (hasHot) { ctx.globalAlpha = 0.95; ctx.strokeStyle = '#e07a3f'; ctx.lineWidth = 3; ctx.stroke(hot) }
    // Nodes are batched by fill colour and dimming (one fill per batch, one outline stroke for all), then the few special ones are drawn on top.
    const fills = new Map<string, Path2D>()
    const outline = new Path2D()
    const special: { n: (typeof net.nodes)[number]; x: number; y: number; r: number; dim: boolean; marked: boolean }[] = []
    for (const n of net.nodes) {
      const p = pos.get(n.id)
      if (!p) continue
      const r = Math.min(maxR, radius(n))
      const dim = !!near && !near.has(n.id)
      const isMarked = n.rows.some((q) => marked.has(q))
      if (selected === n.id || isMarked || params.pinned[n.id]) { special.push({ n, x: p.x, y: p.y, r, dim, marked: isMarked }); continue }
      const key = `${colorOf(n)}|${dim ? 1 : 0}`
      let path = fills.get(key)
      if (!path) { path = new Path2D(); fills.set(key, path) }
      path.moveTo(p.x + r, p.y)
      path.arc(p.x, p.y, r, 0, 2 * Math.PI)
      if (!dim) { outline.moveTo(p.x + r, p.y); outline.arc(p.x, p.y, r, 0, 2 * Math.PI) }
    }
    for (const [key, path] of fills) {
      const [color, dim] = key.split('|')
      ctx.globalAlpha = dim === '1' ? 0.18 : 1
      ctx.fillStyle = color
      ctx.fill(path)
    }
    ctx.globalAlpha = 1
    ctx.lineWidth = 1.2
    ctx.strokeStyle = '#ffffff'
    ctx.stroke(outline)
    for (const { n, x, y, r, dim, marked: isMarked } of special) {
      ctx.globalAlpha = dim ? 0.18 : 1
      ctx.beginPath()
      ctx.arc(x, y, r, 0, 2 * Math.PI)
      ctx.fillStyle = colorOf(n)
      ctx.fill()
      ctx.lineWidth = 2.5
      ctx.strokeStyle = selected === n.id ? '#121816' : isMarked ? '#e07a3f' : '#c4602a'
      ctx.stroke()
    }
    // Labels: only for the focused node and its neighbours — a label on every node of a large graph is unreadable.
    ctx.globalAlpha = 1
    ctx.fillStyle = '#121816'
    ctx.textAlign = 'center'
    ctx.font = `${12 / Math.sqrt(tf.k)}px sans-serif`
    for (const n of net.nodes) {
      if (!(params.labels === 'all' ? (near ? near.has(n.id) : net.nodes.length <= 120) : params.labels === 'hover' && focus === n.id)) continue
      const p = pos.get(n.id)
      if (p) ctx.fillText(n.id, p.x, p.y - Math.min(maxR, radius(n)) - 4)
    }
    ctx.restore()
  }
  drawRef.current = draw

  return (
    <div className="chart-root">
      {useCanvas && <canvas ref={canvasRef} data-testid="net-canvas" style={{ position: 'absolute', left: 0, top: 0, width, height, pointerEvents: 'none' }} aria-hidden="true" />}
      <svg ref={svgRef} width={width} height={height} className={`chart-svg net-svg ${editable ? 'is-editable' : ''}`} role="img" data-testid="chart-svg" data-renderer={useCanvas ? 'canvas' : 'svg'} data-running={running ? '1' : '0'} data-nodes={net.nodes.length} aria-label={`네트워크 그래프: 노드 ${net.nodes.length}개, 간선 ${net.links.length}개`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => { hide(); setHover(null); linked?.set(null) }}>
        <g transform={`translate(${tf.x},${tf.y + topPad}) scale(${tf.k})`}>
          {!useCanvas && net.links.map((l) => {
            const a = positions.get(l.source)
            const b = positions.get(l.target)
            if (!a || !b) return null
            const dim = near && !(near.has(l.source) && near.has(l.target) && (l.source === focus || l.target === focus))
            const hot = l.rows.some((r) => marked.has(r))
            return <line key={`${l.source}>${l.target}`} className="net-link" data-testid="net-link" data-hot={hot ? '1' : undefined} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={hot ? '#e07a3f' : '#5b6763'} strokeOpacity={hot ? 0.95 : dim ? 0.06 : params.linkOpacity} strokeWidth={hot ? 3 : compact ? 0.8 : 0.8 + 3.2 * Math.sqrt(l.weight / wmax)} />
          })}
          {!useCanvas && net.nodes.map((n) => {
            const p = positions.get(n.id)
            if (!p) return null
            const r = Math.min(maxR, radius(n))
            const dim = near && !near.has(n.id)
            const pinned = !!params.pinned[n.id]
            return (
              <g key={n.id} className="net-node" transform={`translate(${p.x},${p.y})`} opacity={dim ? 0.18 : 1}>
                <circle data-node={n.id} data-testid="net-node" className={editable ? 'is-draggable' : ''} r={r} fill={colorOf(n)} stroke={selected === n.id ? '#121816' : n.rows.some((q) => marked.has(q)) ? '#e07a3f' : pinned ? '#c4602a' : '#fff'} strokeWidth={selected === n.id || pinned || n.rows.some((q) => marked.has(q)) ? 2.5 : 1.4}
                  onPointerEnter={compact ? undefined : (e) => {
                    if (dragNode.current) return
                    setHover(n.id)
                    linked?.set(n.rows)
                    const lp = localPoint(svgRef.current!, e)
                    show(lp.x, lp.y, <><b>{n.id}</b>{n.group && <><br />그룹 {n.group}</>}<br />연결 {n.degree}개 · 가중치 합 {fmt(n.strength)}<br />드래그해 이동{params.pinDrag ? '·고정' : ''}</>)
                  }} onPointerLeave={() => { setHover(null); hide(); linked?.set(null) }} />
                {(params.labels === 'all' || (params.labels === 'hover' && focus === n.id)) && !compact && <text className="net-label" y={-r - 4} textAnchor="middle" pointerEvents="none">{n.id}</text>}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          {(params.colorBy === 'group' && hasGroups) && <Legend items={groups.map((g) => ({ key: g, color: groupColor(g) }))} title="그룹" />}
          <div className="chart-actions" style={{ bottom: 'auto', ...(width < 520 ? { top: 38, left: 8, right: 'auto' } : { top: 44, right: 8 }) }}>
            <button type="button" onClick={() => setPaused((p) => !p)} data-testid="net-pause" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>{paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}{paused ? '계속' : '멈춤'}</button>
            <button type="button" onClick={() => setParams({ restart: params.restart + 1, pinned: {} })} data-testid="net-restart" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><RotateCcw size={14} aria-hidden="true" />재시작</button>
            <button type="button" onClick={fit} aria-label="보기 초기화" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Maximize size={14} aria-hidden="true" /></button>
          </div>
          <Readout items={[{ label: '노드', value: net.nodes.length }, { label: '간선', value: net.links.length }, { label: '상태', value: <span data-testid="net-state">{reduced ? '정지(모션 줄임)' : paused ? '멈춤' : running ? '배치 중' : '안정화됨'}</span> }]} />
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

const mappingHas = (m: ChartProps<NetworkParams>['mapping'], k: string) => typeof m[k] === 'string'

function NetworkControls({ params, setParams, table, mapping, setTable }: ControlsProps<NetworkParams>) {
  const net = useMemo(() => buildNetwork(edgeRows(table, mapping)), [table, mapping])
  return (
    <>
      <ControlGroup title="시뮬레이션">
        <Slider label="연결 강도" value={params.linkStrength} min={0} max={2} step={0.05} onChange={(linkStrength) => setParams({ linkStrength })} format={(v) => v.toFixed(2)} testId="ctl-link-strength" />
        <Slider label="연결 길이" value={params.linkDistance} min={20} max={200} step={5} onChange={(linkDistance) => setParams({ linkDistance })} format={(v) => `${v}px`} testId="ctl-link-distance" />
        <Slider label="노드 반발력" value={params.charge} min={10} max={600} step={10} onChange={(charge) => setParams({ charge })} testId="ctl-charge" />
        <Slider label="중심으로 당기는 힘" value={params.gravity} min={0} max={0.3} step={0.01} onChange={(gravity) => setParams({ gravity })} format={(v) => v.toFixed(2)} />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ restart: params.restart + 1, pinned: {} })} data-testid="ctl-restart"><RotateCcw size={14} aria-hidden="true" />시뮬레이션 재시작</button>
        <Hint>힘이 균형에 가까워지면 시뮬레이션이 스스로 멈춥니다. 노드를 끌면 다시 움직이고, 마우스 휠로 확대·축소, 빈 곳을 끌어 이동합니다.</Hint>
      </ControlGroup>
      <ControlGroup title="표현">
        <Select label="노드 크기 기준" value={params.nodeSize} onChange={(nodeSize) => setParams({ nodeSize })} testId="ctl-node-size" options={[{ value: 'fixed', label: '같은 크기' }, { value: 'degree', label: '연결 수' }, { value: 'strength', label: '가중치 합' }]} />
        <Slider label="노드 기본 크기" value={params.size} min={3} max={14} step={0.5} onChange={(size) => setParams({ size })} />
        <Select label="노드 색상 기준" value={params.colorBy} onChange={(colorBy) => setParams({ colorBy })} testId="ctl-color-by" options={[{ value: 'group', label: '그룹(없으면 연결 덩어리)' }, { value: 'component', label: '연결된 덩어리' }, { value: 'degree', label: '연결 수' }]} />
        <Select label="이름 표시" value={params.labels} onChange={(labels) => setParams({ labels })} options={[{ value: 'all', label: '모든 노드' }, { value: 'hover', label: '선택·가리킨 노드만' }, { value: 'none', label: '없음' }]} />
        <Slider label="간선 불투명도" value={params.linkOpacity} min={0.1} max={1} step={0.05} onChange={(linkOpacity) => setParams({ linkOpacity })} format={(v) => v.toFixed(2)} />
        <Toggle label="끈 노드를 고정" description="놓은 자리에 고정합니다. 재시작하면 풀립니다" checked={params.pinDrag} onChange={(pinDrag) => setParams({ pinDrag })} testId="ctl-pin" />
      </ControlGroup>
      <ControlGroup title="렌더링 방식" defaultOpen={false}>
        <Select label="그리는 방식" value={params.renderer} onChange={(renderer) => setParams({ renderer })} testId="ctl-renderer" options={[{ value: 'auto', label: `자동 (노드+간선 ${AUTO_CANVAS.toLocaleString()}개 초과면 Canvas)` }, { value: 'svg', label: 'SVG (요소마다 검사 가능)' }, { value: 'canvas', label: 'Canvas (큰 그래프의 호버·확대가 빠름)' }]} />
        <Hint>노드·간선이 많으면 SVG는 요소 수만큼 호버·확대가 느려지고, Canvas는 그림 한 장만 갱신해 반응이 일정합니다. 반면 레이아웃이 움직이는 동안의 프레임 시간은 Canvas가 항상 더 빠르지는 않습니다(측정 결과는 README의 성능 절). 현재 그래프: 노드 {net.nodes.length}개 · 간선 {net.links.length}개.</Hint>
      </ControlGroup>
      <ControlGroup title="노드·간선 편집" defaultOpen={false}>
        <NetworkEditor net={net} table={table} mapping={mapping} setTable={setTable} />
      </ControlGroup>
    </>
  )
}

export const networkModule: VizModule<NetworkParams> = {
  roles: edgeRoles,
  datasets: ['network', 'energy'],
  defaultParams: { linkDistance: 90, linkStrength: 1, charge: 260, gravity: 0.06, nodeSize: 'degree', size: 6, colorBy: 'group', labels: 'all', linkOpacity: 0.5, pinDrag: false, pinned: {}, restart: 0, renderer: 'auto' },
  Chart: NetworkChart,
  Controls: NetworkControls,
  hint: '노드를 끌어 이동 · 휠로 확대·축소 · 빈 곳을 끌어 화면 이동 · 노드를 가리키면 이웃만 강조',
}
