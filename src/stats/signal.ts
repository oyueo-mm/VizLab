/** Signal analysis (FFT, STFT, continuous wavelet transform) and nonlinear time-series tools (recurrence plot). */

/** In-place iterative radix-2 FFT. Lengths must be powers of two. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr; im[b] = im[a] - ti
        re[a] += tr; im[a] += ti
        const nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = nr
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n }
}

export const nextPow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(1, n)))

export type WindowKind = 'hann' | 'hamming' | 'blackman' | 'rect'

export function windowFn(kind: WindowKind, n: number): Float64Array {
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const x = n > 1 ? i / (n - 1) : 0
    w[i] = kind === 'hann' ? 0.5 - 0.5 * Math.cos(2 * Math.PI * x) : kind === 'hamming' ? 0.54 - 0.46 * Math.cos(2 * Math.PI * x) : kind === 'blackman' ? 0.42 - 0.5 * Math.cos(2 * Math.PI * x) + 0.08 * Math.cos(4 * Math.PI * x) : 1
  }
  return w
}

export interface Spectrogram { /** magnitudes: frames × bins */ mag: Float64Array[]; /** centre time (samples) of each frame */ times: number[]; /** frequency (cycles per sample) of each bin */ freqs: number[]; frameLen: number }

/** Short-time Fourier transform: windowed frames of `frameLen` samples (zero-padded to a power of two) advanced by `hop`; one-sided magnitude spectrum. */
export function stft(x: readonly number[], frameLen: number, hop: number, kind: WindowKind = 'hann'): Spectrogram {
  const N = nextPow2(frameLen)
  const win = windowFn(kind, frameLen)
  const sumW = win.reduce((a, b) => a + b, 0)
  const mag: Float64Array[] = [], times: number[] = []
  for (let s = 0; s + frameLen <= x.length; s += hop) {
    const re = new Float64Array(N), im = new Float64Array(N)
    for (let i = 0; i < frameLen; i++) re[i] = x[s + i] * win[i]
    fft(re, im)
    const m = new Float64Array(N / 2 + 1)
    for (let k = 0; k <= N / 2; k++) m[k] = (Math.hypot(re[k], im[k]) * 2) / sumW
    mag.push(m)
    times.push(s + frameLen / 2)
  }
  return { mag, times, freqs: Array.from({ length: N / 2 + 1 }, (_, k) => k / N), frameLen }
}

/** Dominant frequency (cycles per sample) of the one-sided spectrum of a whole signal. */
export function dominantFrequency(x: readonly number[]): number {
  const N = nextPow2(x.length)
  const re = new Float64Array(N), im = new Float64Array(N)
  x.forEach((v, i) => { re[i] = v - x.reduce((a, b) => a + b, 0) / x.length })
  fft(re, im)
  let best = 1, bm = -1
  for (let k = 1; k <= N / 2; k++) { const m = Math.hypot(re[k], im[k]); if (m > bm) { bm = m; best = k } }
  return best / N
}

export interface Scalogram { /** magnitudes: scales × samples */ mag: Float64Array[]; scales: number[]; /** pseudo-frequency (cycles per sample) of each scale */ freqs: number[] }

/** Continuous wavelet transform with a complex Morlet wavelet (ω₀ = 6): the pseudo-frequency of scale s is ω₀ / (2π s) cycles per sample. */
export function cwt(x: readonly number[], freqs: readonly number[], w0 = 6): Scalogram {
  const n = x.length
  const mean = x.reduce((a, b) => a + b, 0) / (n || 1)
  const scales = freqs.map((f) => w0 / (2 * Math.PI * f))
  const mag = scales.map((s) => {
    const half = Math.min(n, Math.ceil(4 * s))
    const kr = new Float64Array(2 * half + 1), ki = new Float64Array(2 * half + 1)
    const norm = Math.PI ** -0.25 / Math.sqrt(s)
    for (let j = -half; j <= half; j++) { const u = j / s; const g = Math.exp(-u * u / 2) * norm; kr[j + half] = g * Math.cos(w0 * u); ki[j + half] = -g * Math.sin(w0 * u) }
    const out = new Float64Array(n)
    for (let t = 0; t < n; t++) {
      let sr = 0, si = 0
      for (let j = -half; j <= half; j++) { const idx = t + j; if (idx < 0 || idx >= n) continue; const v = x[idx] - mean; sr += v * kr[j + half]; si += v * ki[j + half] }
      out[t] = Math.hypot(sr, si)
    }
    return out
  })
  return { mag, scales, freqs: [...freqs] }
}

export interface Recurrence { n: number; /** n × n booleans, row-major: R[i·n + j] = 1 when states i and j are within eps. */ r: Uint8Array; rate: number; determinism: number; eps: number }

/** Time-delay embedding of a series with dimension m and delay τ. */
export function embed(x: readonly number[], m: number, tau: number): number[][] {
  const out: number[][] = []
  for (let i = 0; i + (m - 1) * tau < x.length; i++) out.push(Array.from({ length: m }, (_, k) => x[i + k * tau]))
  return out
}

/**
 * Recurrence plot: R_ij = 1 if ‖s_i − s_j‖ ≤ ε for the delay-embedded states (maximum norm). `eps` is given as a fraction of the largest state distance.
 * Also returns the recurrence rate and determinism (the share of recurrent points that lie on diagonal lines of length ≥ 2).
 */
export function recurrencePlot(x: readonly number[], m: number, tau: number, epsFraction: number): Recurrence {
  const S = embed(x, m, tau)
  const n = S.length
  const dist = (a: number[], b: number[]) => { let d = 0; for (let k = 0; k < a.length; k++) d = Math.max(d, Math.abs(a[k] - b[k])); return d }
  let dmax = 0
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) dmax = Math.max(dmax, dist(S[i], S[j]))
  const eps = epsFraction * dmax
  const r = new Uint8Array(n * n)
  let count = 0
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (dist(S[i], S[j]) <= eps) { r[i * n + j] = 1; count++ }
  // determinism: recurrent points that belong to a diagonal run of length ≥ 2 (excluding the main diagonal)
  let inLines = 0, offDiag = 0
  for (let d = 1; d < n; d++) {
    let run = 0
    const flush = () => { if (run >= 2) inLines += run; run = 0 }
    for (let i = 0; i + d < n; i++) { if (r[i * n + i + d]) { run++; offDiag++ } else flush() }
    flush()
  }
  return { n, r, rate: n ? count / (n * n) : 0, determinism: offDiag ? inLines / offDiag : 0, eps }
}
