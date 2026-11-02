import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LabState } from '../lab/state'
import { useVizModule } from '../viz/charts'
import { ChartBoundary } from './ChartBoundary'

const noop = () => {}

/** Thumbnail rendered by the real chart engine with the chart's default dataset. */
export function ChartPreview({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [visible, setVisible] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setSize((s) => (s && Math.abs(s.width - r.width) < 1 && Math.abs(s.height - r.height) < 1 ? s : { width: Math.floor(r.width), height: Math.floor(r.height) }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    let io: IntersectionObserver | undefined
    if (typeof IntersectionObserver === 'undefined') setVisible(true)
    else {
      io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setVisible(true); io?.disconnect() } }, { rootMargin: '300px' })
      io.observe(el)
    }
    return () => { ro.disconnect(); io?.disconnect() }
  }, [])
  const { mod } = useVizModule(id, visible)
  // The default tables come from the dataset generators, which are a separate chunk loaded with the first thumbnail (not with the home page).
  const [state, setState] = useState<LabState | null>(null)
  useEffect(() => {
    if (!visible || !mod) return
    let live = true
    void import('../lab/state').then((m) => { if (live) setState(m.initialLabState(id, mod)) }).catch(() => {})
    return () => { live = false }
  }, [visible, id, mod])
  return (
    <div ref={ref} className="chart-preview" aria-hidden="true" data-testid={`preview-${id}`}>
      {state && mod && size && size.width > 0 && (
        <ChartBoundary compact>
          <mod.Chart table={state.table} mapping={state.mapping} params={state.params} setParams={noop} width={size.width} height={size.height} compact />
        </ChartBoundary>
      )}
    </div>
  )
}
