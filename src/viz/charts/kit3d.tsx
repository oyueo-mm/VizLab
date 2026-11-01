import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Readout, Tooltip } from '../../components/chart/primitives'
import { makeProjector, useOrbit, type Projector } from './scene3d'
import { Frame3D, canvasFor, viewOf, type ViewParams } from './geo3dCharts'
import { useStage, type StageApi } from './kit'

/** A 3-D scene: orbit camera, a canvas for the heavy drawing, an SVG frame and overlay for labels and hit targets. */

export interface Scene3DProps {
  width: number
  height: number
  compact?: boolean
  params: ViewParams
  setParams: (p: Partial<ViewParams>) => void
  label: string
  /** Cube drawn as the frame (default [-1, 1]³). */
  box?: { x: [number, number]; y: [number, number]; z: [number, number] }
  labels?: { at: [number, number, number]; text: string; anchor?: 'start' | 'middle' | 'end' }[]
  /** Paints into the canvas; called again when `drawKey` or the view changes. */
  draw: (ctx: CanvasRenderingContext2D, proj: Projector) => void
  drawKey: string
  overlay?: (proj: Projector, stage: StageApi) => ReactNode
  readout?: { label: string; value: ReactNode }[]
  note?: ReactNode
  fit?: number
  onClick?: () => void
}

export function Scene3D(p: Scene3DProps) {
  const { width, height, compact, params } = p
  const boxRef = useRef<HTMLDivElement>(null)
  const cvRef = useRef<HTMLCanvasElement>(null)
  const stage = useStage()
  const view = viewOf(params)
  useOrbit(boxRef, view, (v) => p.setParams(v), !compact)
  const proj = useMemo(() => makeProjector(view, width, height, p.fit ?? 0.4), [view.yaw, view.pitch, view.zoom, width, height, p.fit]) // eslint-disable-line react-hooks/exhaustive-deps
  const drawRef = useRef(p.draw)
  drawRef.current = p.draw
  useEffect(() => {
    const ctx = canvasFor(cvRef, width, height)
    if (ctx) drawRef.current(ctx, proj)
  }, [proj, width, height, p.drawKey])
  const box = p.box ?? { x: [-1, 1] as [number, number], y: [-1, 1] as [number, number], z: [-1, 1] as [number, number] }
  return (
    <div className="chart-root">
      <div ref={boxRef} className="orbit-box" tabIndex={compact ? -1 : 0} style={{ width, height }} aria-label={`${p.label}: 끌어서 회전, 휠로 확대`}>
        <canvas ref={cvRef} className="canvas3d" data-testid="canvas3d" style={{ width, height }} aria-hidden="true" />
        <svg ref={stage.svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={p.label} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }} onPointerLeave={stage.hide}>
          <Frame3D proj={proj} box={box} labels={compact ? [] : p.labels} />
          {p.overlay?.(proj, stage)}
        </svg>
      </div>
      <Tooltip tip={stage.tip} width={width} />
      {!compact && p.readout && <Readout items={p.readout} />}
      {!compact && p.note && <p className="chart-note" role="note" style={{ left: 'auto', right: 8, bottom: 2, maxWidth: '58%', textAlign: 'right' }}>{p.note}</p>}
    </div>
  )
}

export type { ViewParams }
export const viewDefaults = (v: Partial<ViewParams> = {}): ViewParams => ({ yaw: -35, pitch: 28, zoom: 1.1, ...v })
