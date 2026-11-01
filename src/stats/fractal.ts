/** Complex-plane iterations: Mandelbrot and Julia escape times, Newton basins and rational-function domain colouring. */

export type Complex = [number, number]

const cmul = (a: Complex, b: Complex): Complex => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]
const cdiv = (a: Complex, b: Complex): Complex => { const d = b[0] * b[0] + b[1] * b[1] || 1e-300; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d] }
const csub = (a: Complex, b: Complex): Complex => [a[0] - b[0], a[1] - b[1]]

/** Smooth escape time of z → z^p + c from z₀ = 0. Returns −1 when the orbit has not escaped after `maxIter` steps (treated as inside). */
export function mandelbrot(cx: number, cy: number, maxIter: number, power = 2): number {
  let x = 0, y = 0
  for (let i = 0; i < maxIter; i++) {
    let nx: number, ny: number
    if (power === 2) { nx = x * x - y * y + cx; ny = 2 * x * y + cy } else {
      const r = Math.hypot(x, y) ** power, th = Math.atan2(y, x) * power
      nx = r * Math.cos(th) + cx; ny = r * Math.sin(th) + cy
    }
    x = nx; y = ny
    const m = x * x + y * y
    if (m > 256) return i + 1 - Math.log(Math.log(m) / 2) / Math.log(power)
  }
  return -1
}

/** Smooth escape time of z → z² + c from z₀ = (zx, zy). */
export function julia(zx: number, zy: number, cx: number, cy: number, maxIter: number): number {
  let x = zx, y = zy
  for (let i = 0; i < maxIter; i++) {
    const nx = x * x - y * y + cx
    y = 2 * x * y + cy
    x = nx
    const m = x * x + y * y
    if (m > 256) return i + 1 - Math.log(Math.log(m) / 2) / Math.LN2
  }
  return -1
}

/** Roots of the polynomial Σ coeffs[k]·z^k (k = array index) by Durand–Kerner iteration. */
export function polyRoots(coeffs: readonly Complex[]): Complex[] {
  let n = coeffs.length - 1
  while (n > 0 && Math.hypot(...coeffs[n]) < 1e-12) n--
  if (n < 1) return []
  const lead = coeffs[n]
  const c = coeffs.slice(0, n + 1).map((k) => cdiv(k, lead))
  const roots: Complex[] = Array.from({ length: n }, (_, k) => { const r = 1 + Math.max(...c.slice(0, n).map((v) => Math.hypot(...v))); const t = (2 * Math.PI * k) / n + 0.4; return [r * 0.8 * Math.cos(t), r * 0.8 * Math.sin(t)] as Complex })
  const evalP = (z: Complex): Complex => { let acc: Complex = [1, 0]; for (let k = n - 1; k >= 0; k--) { const m = cmul(acc, z); acc = [m[0] + c[k][0], m[1] + c[k][1]] } return acc }
  for (let it = 0; it < 500; it++) {
    let delta = 0
    for (let i = 0; i < n; i++) {
      let den: Complex = [1, 0]
      for (let j = 0; j < n; j++) if (j !== i) den = cmul(den, csub(roots[i], roots[j]))
      const step = cdiv(evalP(roots[i]), den)
      roots[i] = csub(roots[i], step)
      delta = Math.max(delta, Math.hypot(...step))
    }
    if (delta < 1e-13) break
  }
  return roots
}

export interface Poly { coeffs: Complex[]; roots: Complex[] }
export const makePoly = (coeffs: readonly Complex[]): Poly => ({ coeffs: [...coeffs], roots: polyRoots(coeffs) })

const evalPoly = (c: readonly Complex[], z: Complex): { p: Complex; d: Complex } => {
  let p: Complex = [0, 0], d: Complex = [0, 0]
  for (let k = c.length - 1; k >= 0; k--) { d = cmul(d, z); d = [d[0] + p[0], d[1] + p[1]]; p = cmul(p, z); p = [p[0] + c[k][0], p[1] + c[k][1]] }
  return { p, d }
}

/** Newton's method z ← z − p(z)/p′(z): which root the orbit converges to (index into `poly.roots`, −1 if none) and the step count. */
export function newtonBasin(z0: Complex, poly: Poly, maxIter: number, relax = 1): { root: number; iter: number } {
  let z: Complex = [z0[0], z0[1]]
  for (let i = 0; i < maxIter; i++) {
    const { p, d } = evalPoly(poly.coeffs, z)
    if (Math.hypot(...d) < 1e-14) return { root: -1, iter: maxIter }
    const q = cdiv(p, d)
    z = [z[0] - relax * q[0], z[1] - relax * q[1]]
    for (let r = 0; r < poly.roots.length; r++) if (Math.hypot(z[0] - poly.roots[r][0], z[1] - poly.roots[r][1]) < 1e-7) return { root: r, iter: i + 1 }
    if (!Number.isFinite(z[0]) || Math.abs(z[0]) > 1e8) return { root: -1, iter: maxIter }
  }
  return { root: -1, iter: maxIter }
}

/** f(z) = Π (z − zero) / Π (z − pole). */
export function rational(z: Complex, zeros: readonly Complex[], poles: readonly Complex[]): Complex {
  let num: Complex = [1, 0], den: Complex = [1, 0]
  for (const a of zeros) num = cmul(num, csub(z, a))
  for (const b of poles) den = cmul(den, csub(z, b))
  return cdiv(num, den)
}

/** HSL-style colour of a complex value: hue from the argument, lightness from log|w| with isolines of |w| and arg. Returns [r, g, b] in 0..255. */
export function domainColor(w: Complex, { modulus = true, phase = true }: { modulus?: boolean; phase?: boolean } = {}): [number, number, number] {
  const arg = Math.atan2(w[1], w[0]), mod = Math.hypot(w[0], w[1])
  const hue = ((arg / (2 * Math.PI)) + 1) % 1
  let l = 0.5
  if (!Number.isFinite(mod) || mod > 1e12) return [255, 255, 255]
  if (mod < 1e-12) return [0, 0, 0]
  if (modulus) {
    const lg = Math.log2(Math.max(mod, 1e-300))
    const frac = lg - Math.floor(lg)
    l = 0.38 + 0.4 * frac ** 1.2
  }
  if (phase) { const f = (arg / (Math.PI / 6)) - Math.floor(arg / (Math.PI / 6)); l *= 0.88 + 0.12 * Math.min(1, f * 4) }
  return hslToRgb(hue, 0.85, Math.min(0.95, Math.max(0.05, l)))
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
  const f = (t: number) => { const x = ((t % 1) + 1) % 1; return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p }
  return [Math.round(255 * f(h + 1 / 3)), Math.round(255 * f(h)), Math.round(255 * f(h - 1 / 3))]
}

/** Monte-Carlo-free area estimate of the Mandelbrot set by sampling a regular grid. */
export function mandelbrotArea(n: number, maxIter: number): number {
  let inside = 0
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (mandelbrot(-2 + ((i + 0.5) / n) * 2.5, -1.25 + ((j + 0.5) / n) * 2.5, maxIter) < 0) inside++
  return (inside / (n * n)) * 2.5 * 2.5
}

/** Allocation-free Newton iteration for a whole image: same result as `newtonBasin` (coefficients and roots given as flat arrays). */
export function makeNewtonFast(poly: Poly) {
  const n = poly.coeffs.length
  const re = poly.coeffs.map((c) => c[0]), im = poly.coeffs.map((c) => c[1])
  const rr = poly.roots.map((r) => r[0]), ri = poly.roots.map((r) => r[1])
  return (x0: number, y0: number, maxIter: number, relax: number): { root: number; iter: number } => {
    let x = x0, y = y0
    for (let it = 0; it < maxIter; it++) {
      let pr = 0, pi = 0, dr = 0, di = 0
      for (let k = n - 1; k >= 0; k--) {
        const ndr = dr * x - di * y + pr, ndi = dr * y + di * x + pi
        dr = ndr; di = ndi
        const npr = pr * x - pi * y + re[k], npi = pr * y + pi * x + im[k]
        pr = npr; pi = npi
      }
      const den = dr * dr + di * di
      if (den < 1e-28) return { root: -1, iter: maxIter }
      x -= (relax * (pr * dr + pi * di)) / den
      y -= (relax * (pi * dr - pr * di)) / den
      for (let r = 0; r < rr.length; r++) { const ex = x - rr[r], ey = y - ri[r]; if (ex * ex + ey * ey < 1e-14) return { root: r, iter: it + 1 } }
      if (!(Math.abs(x) < 1e8 && Math.abs(y) < 1e8)) return { root: -1, iter: maxIter }
    }
    return { root: -1, iter: maxIter }
  }
}
