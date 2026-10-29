/**
 * Pointy-top hexagonal binning in pixel space. Hex centers sit on rows spaced 1.5r apart;
 * odd rows are shifted by half a hex width (√3·r). Each point goes to the nearest center (exact Euclidean test).
 */
export interface HexBin<T> {
  x: number
  y: number
  points: T[]
}

export function hexbin<T>(items: readonly T[], x: (d: T) => number, y: (d: T) => number, radius: number) {
  const dx = radius * Math.sqrt(3)
  const dy = radius * 1.5
  const bins = new Map<string, HexBin<T>>()
  for (const item of items) {
    const px0 = x(item)
    const py0 = y(item)
    if (!Number.isFinite(px0) || !Number.isFinite(py0)) continue
    // The nearest centre lies in the nearest row or one of its neighbours; within a row, rounding x finds it.
    // Comparing true Euclidean distances avoids the anisotropic shortcut used by some implementations.
    const row = Math.round(py0 / dy)
    let best = Infinity
    let bi = 0
    let bj = 0
    for (let j = row - 1; j <= row + 1; j++) {
      const shift = (j & 1) / 2
      const i = Math.round(px0 / dx - shift)
      const d = (px0 - (i + shift) * dx) ** 2 + (py0 - j * dy) ** 2
      if (d < best) { best = d; bi = i; bj = j }
    }
    const key = `${bi},${bj}`
    let bin = bins.get(key)
    if (!bin) {
      bin = { x: (bi + (bj & 1) / 2) * dx, y: bj * dy, points: [] }
      bins.set(key, bin)
    }
    bin.points.push(item)
  }
  return [...bins.values()]
}

/** SVG path of a pointy-top hexagon centered at the origin. */
export function hexagonPath(radius: number) {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i
    return `${(Math.sin(a) * radius).toFixed(2)},${(-Math.cos(a) * radius).toFixed(2)}`
  })
  return `M${pts.join('L')}Z`
}
