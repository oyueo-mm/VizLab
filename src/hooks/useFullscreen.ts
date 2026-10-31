import { useCallback, useEffect, useRef, useState } from 'react'

/** Fullscreen for one element, falling back to an in-page expanded state where the Fullscreen API is unavailable (iOS Safari, frames). */
export function useFullscreen<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [full, setFull] = useState(false)
  const [fallback, setFallback] = useState(false)
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === ref.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  useEffect(() => {
    if (!fallback) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFallback(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fallback])
  const toggle = useCallback(async () => {
    if (document.fullscreenElement) { await document.exitFullscreen(); return }
    if (fallback) { setFallback(false); return }
    try {
      if (!ref.current?.requestFullscreen) throw new Error('unsupported')
      await ref.current.requestFullscreen()
    } catch {
      setFallback(true)
    }
  }, [fallback])
  return { ref, expanded: full || fallback, fallback, toggle }
}
