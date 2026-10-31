export type StepMode = 'after' | 'before' | 'middle'

export const stepModes: { value: StepMode; label: string; hint: string }[] = [
  { value: 'after', label: 'Step After', hint: '각 시점의 값이 다음 시점 직전까지 유지됩니다. 재고·요금처럼 “바뀐 뒤 그 값”을 뜻할 때 씁니다.' },
  { value: 'before', label: 'Step Before', hint: '각 시점의 값이 이전 시점 직후부터 적용됩니다. 구간 끝에 값이 기록되는 집계에 맞습니다.' },
  { value: 'middle', label: 'Step Middle', hint: '이웃한 두 시점의 한가운데에서 값이 바뀝니다.' },
]

/** Polyline vertices of the staircase through the points (sorted by x), for the given mode. */
export function stepVertices(pts: readonly { x: number; y: number }[], mode: StepMode): [number, number][] {
  const out: [number, number][] = []
  pts.forEach((p, i) => {
    const prev = pts[i - 1]
    if (!prev) { out.push([p.x, p.y]); return }
    if (mode === 'after') out.push([p.x, prev.y], [p.x, p.y])
    else if (mode === 'before') out.push([prev.x, p.y], [p.x, p.y])
    else { const m = (prev.x + p.x) / 2; out.push([m, prev.y], [m, p.y], [p.x, p.y]) }
  })
  return out
}

/** The value a step function takes at x (undefined outside the data range). */
export function stepValueAt(pts: readonly { x: number; y: number }[], x: number, mode: StepMode): number | undefined {
  if (!pts.length || x < pts[0].x || x > pts[pts.length - 1].x) return undefined
  let i = 0
  while (i + 1 < pts.length && pts[i + 1].x <= x) i++
  if (pts[i].x === x || i === pts.length - 1) return pts[i].y
  const a = pts[i]
  const b = pts[i + 1]
  if (mode === 'after') return a.y
  if (mode === 'before') return b.y
  return x < (a.x + b.x) / 2 ? a.y : b.y
}
