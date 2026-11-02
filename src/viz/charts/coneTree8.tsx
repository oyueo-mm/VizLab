import { useEffect, useMemo, useRef, useState } from 'react'
import { ChartMessage } from '../../components/chart/primitives'
import { ControlGroup, Hint, Slider, Toggle } from '../../components/controls'
import { useReducedMotion } from '../../hooks/motion'
import { categoryColor } from '../../lib/colors'
import { buildTree } from '../../stats/hierarchy'
import { coneTree, facePhases, pathTo, type ConeNode } from '../../stats/viz3d8'
import { roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { ViewControls, type ViewParams } from './geo3dCharts'
import { Scene3D } from './kit3d'
import type { Projector } from './scene3d'

export interface ConeParams extends ViewParams { depth: number; gap: number; selected: string; collapsed: string[]; front: number; labels: boolean }

/** Angle (in tree space) that points towards the viewer for a given yaw: the horizontal direction that minimises the projector's depth. */
const frontAngle = (yawDeg: number) => { const y = (yawDeg * Math.PI) / 180; return Math.atan2(-Math.cos(y), -Math.sin(y)) }

const shortest = (from: number, to: number) => { let d = (to - from) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d }

function ConeChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<ConeParams>) {
  const levels = roleColumns(mapping, 'levels')
  const reduced = useReducedMotion()
  const tree = useMemo(() => (levels.length ? buildTree(table, levels, null).tree : null), [table, levels.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  const collapsed = useMemo(() => new Set(params.collapsed), [params.collapsed])
  // target phases come from the selection; the drawn phases follow them with a short animation
  const base = useMemo(() => (tree ? coneTree(tree, { levelGap: params.gap, maxDepth: params.depth, collapsed }) : []), [tree, params.gap, params.depth, collapsed])
  const target = useMemo(() => {
    const sel = base.find((n) => n.key === params.selected)
    return sel ? facePhases(base, sel.id, params.front) : new Map<string, number>()
  }, [base, params.selected, params.front])
  const [phase, setPhase] = useState<Map<string, number>>(target)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  useEffect(() => {
    if (reduced || compact) { setPhase(target); return }
    const from = new Map(phaseRef.current)
    const keys = new Set([...from.keys(), ...target.keys()])
    const t0 = performance.now()
    let raf = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 520)
      const e = 1 - (1 - t) ** 3
      const next = new Map<string, number>()
      for (const k of keys) { const a = from.get(k) ?? 0, b = target.get(k) ?? 0; next.set(k, a + shortest(a, b) * e) }
      setPhase(next)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, reduced, compact])
  const nodes = useMemo(() => (tree ? coneTree(tree, { levelGap: params.gap, maxDepth: params.depth, collapsed, phase }) : []), [tree, params.gap, params.depth, collapsed, phase])
  if (!tree || nodes.length < 2) return <ChartMessage>계층 열(범주형)을 선택하세요.</ChartMessage>
  const root = nodes[0]
  const height3 = Math.max(...nodes.map((n) => n.depth)) * params.gap
  const scale = 1.7 / Math.max(2 * root.extent, height3, 0.3)
  const zMid = -height3 / 2
  const P = (n: ConeNode): [number, number, number] => [n.pos[0] * scale, n.pos[1] * scale, (n.pos[2] - zMid) * scale]
  const colors = categoryColor(Array.from({ length: 8 }, (_, i) => String(i)))
  const selected = nodes.find((n) => n.key === params.selected)
  const onPath = new Set(selected ? pathTo(nodes, selected.id) : [])
  const select = (n: ConeNode) => setParams({ selected: params.selected === n.key ? '' : n.key, front: frontAngle(params.yaw) })
  const toggle = (n: ConeNode) => {
    const hasKids = n.children.length > 0
    if (hasKids) setParams({ collapsed: [...params.collapsed, n.key] })
    else if (collapsed.has(n.key)) setParams({ collapsed: params.collapsed.filter((k) => k !== n.key) })
  }
  const draw = (ctx: CanvasRenderingContext2D, proj: Projector) => {
    // translucent cone bases first, far to near
    const rings = nodes.filter((n) => n.children.length > 1).map((n) => ({ n, d: proj(P(n)).depth })).sort((a, b) => b.d - a.d)
    for (const { n } of rings) {
      const cz = (n.pos[2] - zMid - params.gap) * scale
      ctx.beginPath()
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * 2 * Math.PI
        const q = proj([(n.pos[0] + n.ring * Math.cos(a)) * scale, (n.pos[1] + n.ring * Math.sin(a)) * scale, cz])
        if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y)
      }
      ctx.fillStyle = `${colors(String(n.depth % 8))}14`
      ctx.fill()
      ctx.strokeStyle = `${colors(String(n.depth % 8))}55`
      ctx.lineWidth = 0.8
      ctx.stroke()
    }
    // edges, far to near
    const edges = nodes.filter((n) => n.parent >= 0).map((n) => { const a = proj(P(nodes[n.parent])), b = proj(P(n)); return { n, a, b, d: (a.depth + b.depth) / 2 } }).sort((p, q) => q.d - p.d)
    for (const { n, a, b } of edges) {
      const hot = onPath.has(n.id)
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y)
      ctx.strokeStyle = hot ? '#111' : 'rgba(90,100,110,0.55)'
      ctx.lineWidth = hot ? 2 : 0.9
      ctx.stroke()
    }
  }
  const shownLabels = (n: ConeNode) => params.labels && (n.depth <= 1 || onPath.has(n.id) || nodes.length <= 40 || (selected && n.parent === selected.id))
  return (
    <Scene3D width={width} height={height} compact={compact} params={params} setParams={setParams} label={`Cone Tree: 노드 ${nodes.length}개, 깊이 ${Math.max(...nodes.map((n) => n.depth))}단계`} draw={draw} fit={0.44} frame={false}
      drawKey={`${nodes.map((n) => n.pos.map((v) => v.toFixed(2)).join()).join('|')}|${params.selected}|${params.gap}`}
      overlay={(proj) => (
        <g>
          {[...nodes].map((n) => ({ n, p: proj(P(n)) })).sort((a, b) => b.p.depth - a.p.depth).map(({ n, p }) => {
            const hot = onPath.has(n.id)
            const r = (n.children.length ? 6 : 3.6) * (compact ? 0.6 : 1)
            return (
              <g key={n.key} data-testid="cone-node" style={{ cursor: compact ? undefined : 'pointer' }}
                onClick={compact ? undefined : () => select(n)} onDoubleClick={compact ? undefined : () => toggle(n)}>
                <circle cx={p.x} cy={p.y} r={r + 4} fill="transparent" />
                <circle cx={p.x} cy={p.y} r={r} fill={n.key === params.selected ? '#111' : hot ? '#2a8c82' : colors(String(n.depth % 8))} stroke="#fff" strokeWidth={1} opacity={0.95} />
                {!compact && shownLabels(n) && <text x={p.x} y={p.y - r - 3} textAnchor="middle" fontSize={10} fill="#333" style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3, pointerEvents: 'none' }}>{n.name}</text>}
                {!compact && collapsed.has(n.key) && <circle cx={p.x} cy={p.y} r={r + 3} fill="none" stroke="#111" strokeDasharray="2 2" />}
              </g>
            )
          })}
        </g>
      )}
      readout={[{ label: '표시 노드', value: nodes.length }, { label: '깊이', value: Math.max(...nodes.map((n) => n.depth)) }, { label: '선택', value: selected ? selected.name : '없음' }]}
      note="노드를 누르면 그 노드로 가는 경로가 앞으로 돌아옵니다 · 두 번 누르면 접기" />
  )
}

function ConeControls({ params, setParams, mapping }: ControlsProps<ConeParams>) {
  void mapping
  return (
    <>
      <ControlGroup title="원뿔 배치">
        <Slider label="표시할 깊이" value={params.depth} min={1} max={6} onChange={(depth) => setParams({ depth, collapsed: [] })} testId="ctl-depth" />
        <Slider label="층 간격" value={params.gap} min={0.2} max={1.2} step={0.05} onChange={(gap) => setParams({ gap })} format={(v) => v.toFixed(2)} testId="ctl-gap" />
        <Toggle label="이름 표시" checked={params.labels} onChange={(labels) => setParams({ labels })} testId="ctl-labels" />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ selected: '', collapsed: [] })} data-testid="cone-reset">선택·접기 해제</button>
        <Hint>각 노드는 원뿔의 꼭짓점이고 자식은 한 층 아래 원 위에 고르게 놓입니다. 원의 반지름은 형제 부분트리가 서로 겹치지 않도록 정합니다. 노드를 누르면 조상 원뿔들이 회전해 그 노드로 가는 길이 화면 앞쪽을 향하고, 두 번 누르면 하위 트리가 접힙니다(접힌 노드는 점선 원, 다시 두 번 누르면 펼침). 끌어서 3차원으로 돌려 볼 수 있습니다.</Hint>
      </ControlGroup>
      <ViewControls params={params} setParams={setParams} />
    </>
  )
}

export const coneTreeModule: VizModule<ConeParams> = {
  roles: [{ key: 'levels', label: '계층 수준 (바깥 → 안쪽)', type: 'category', required: true, multiple: { min: 1, max: 5 } }],
  datasets: ['org-tree', 'budget'],
  defaultParams: { yaw: -30, pitch: 22, zoom: 1.45, depth: 4, gap: 0.6, selected: '', collapsed: [], front: 0, labels: true },
  Chart: ConeChart,
  Controls: ConeControls,
  hint: '노드를 눌러 경로를 앞으로 돌리고 · 두 번 눌러 접기 · 끌어서 3D 회전',
}
