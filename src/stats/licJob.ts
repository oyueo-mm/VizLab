import { fieldAt, licFast, whiteNoise, type FlowSource } from './sci7'

export interface LicRequest { sources: FlowSource[]; res: number; length: number; seed: number }
export interface LicResult { res: number; noise: Float32Array; texture: Float32Array; speed: Float32Array; maxSp: number }

/** One LIC image of the flow field made of `sources` (the job the worker runs; the page uses it directly when there is no Worker). */
export function computeLic(req: LicRequest): LicResult {
  const { sources, res } = req
  const noise = whiteNoise(res, res, req.seed)
  // velocity in pixel space: world y points up, pixel y points down
  const field = (px: number, py: number): [number, number] => { const [u, v] = fieldAt(sources, px / res, 1 - py / res); return [u, -v] }
  const speed = new Float32Array(res * res)
  let maxSp = 1e-9
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) { const [u, v] = fieldAt(sources, i / res, 1 - j / res); const s = Math.hypot(u, v); speed[j * res + i] = s; maxSp = Math.max(maxSp, s) }
  return { res, noise, texture: licFast(field, noise, res, res, Math.round(req.length * (res / 200))), speed, maxSp }
}

/** The quick preview that is shown while the full image is computed: a third of the resolution (a ninth of the pixels). */
export const previewRequest = (req: LicRequest): LicRequest => ({ ...req, res: Math.max(48, Math.round(req.res / 3)) })
