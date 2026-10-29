import { interpolate } from 'd3'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

const query = '(prefers-reduced-motion: reduce)'

function subscribe(cb: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia(query)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

export const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches

export function useReducedMotion() {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false)
}

const easeOut = (t: number) => 1 - (1 - t) ** 3

/**
 * Interpolates from the previously displayed value to `target` whenever the target changes.
 * Jumps instantly when `enabled` is false, when reduced motion is requested, or when `snapKey`
 * changes (e.g. on resize, so geometry follows the container without lag).
 */
export function useTween<T>(target: T, { duration = 420, enabled = true, snapKey = '' }: { duration?: number; enabled?: boolean; snapKey?: string } = {}): T {
  const reduced = useReducedMotion()
  const animate = enabled && !reduced
  const [value, setValue] = useState(target)
  const current = useRef(target)
  const lastSnap = useRef(snapKey)
  useEffect(() => {
    const snap = lastSnap.current !== snapKey
    lastSnap.current = snapKey
    if (!animate || snap) {
      current.current = target
      setValue(target)
      return
    }
    const interp = interpolate(current.current as any, target as any) as (t: number) => T
    const start = performance.now()
    let raf = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const v = t >= 1 ? target : interp(easeOut(t))
      current.current = v
      setValue(v)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, animate, duration, snapKey])
  return animate ? value : target
}
