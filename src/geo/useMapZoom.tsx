import * as d3 from 'd3'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

export interface MapTransform { k: number; x: number; y: number }
export const IDENTITY: MapTransform = { k: 1, x: 0, y: 0 }

interface Options {
  enabled?: boolean
  maxK?: number
  width: number
  height: number
}

/**
 * Wheel, drag and pinch zoom for an SVG map. Dragging something marked `data-nodrag` (a movable marker, a handle) never pans, so editing
 * and panning do not fight; a drag that moves the map does not count as a click on the region underneath.
 */
export function useMapZoom(svg: RefObject<SVGSVGElement | null>, { enabled = true, maxK = 60, width, height }: Options) {
  const [t, setT] = useState<MapTransform>(IDENTITY)
  const zoom = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)

  useEffect(() => {
    const el = svg.current
    if (!el || !enabled) { setT(IDENTITY); return }
    const z = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, maxK])
      .extent([[0, 0], [width, height]])
      .translateExtent([[-width * 0.25, -height * 0.25], [width * 1.25, height * 1.25]])
      .filter((e: Event) => {
        const me = e as MouseEvent
        if ((e.target as Element | null)?.closest?.('[data-nodrag]')) return false
        return !me.button && (e.type !== 'dblclick')
      })
      .on('zoom', (e) => setT({ k: e.transform.k, x: e.transform.x, y: e.transform.y }))
    zoom.current = z
    const sel = d3.select(el)
    sel.call(z)
    sel.on('dblclick.zoom', null)
    return () => { sel.on('.zoom', null); zoom.current = null }
  }, [svg, enabled, maxK, width, height])

  const reset = useCallback(() => { const el = svg.current; if (el && zoom.current) d3.select(el).transition().duration(250).call(zoom.current.transform, d3.zoomIdentity); else setT(IDENTITY) }, [svg])
  const by = useCallback((f: number) => { const el = svg.current; if (el && zoom.current) d3.select(el).transition().duration(200).call(zoom.current.scaleBy, f) }, [svg])
  return { t, reset, zoomIn: () => by(1.6), zoomOut: () => by(1 / 1.6) }
}

/** Zoom buttons for touch screens and keyboard users; wheel and pinch work without them. */
export function MapZoomButtons({ zoom, k }: { zoom: { zoomIn: () => void; zoomOut: () => void; reset: () => void }; k: number }) {
  return (
    <div className="map-zoom" role="group" aria-label="지도 확대·축소">
      <button type="button" className="icon-btn" aria-label="확대" onClick={zoom.zoomIn} data-testid="map-zoom-in"><Plus size={16} /></button>
      <button type="button" className="icon-btn" aria-label="축소" onClick={zoom.zoomOut} data-testid="map-zoom-out"><Minus size={16} /></button>
      <button type="button" className="icon-btn" aria-label="원래 크기로" onClick={zoom.reset} disabled={k === 1} data-testid="map-zoom-reset"><RotateCcw size={15} /></button>
    </div>
  )
}
