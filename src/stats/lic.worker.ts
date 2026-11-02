/// <reference lib="webworker" />
import { computeLic, previewRequest, type LicRequest, type LicResult } from './licJob'

/** Posts a low-resolution preview first and then the full image; the page terminates the worker when the settings change. */
export interface LicMessage { preview: boolean; result: LicResult }

self.onmessage = (e: MessageEvent<LicRequest>) => {
  const small = previewRequest(e.data)
  if (small.res < e.data.res) {
    const r = computeLic(small)
    self.postMessage({ preview: true, result: r } satisfies LicMessage, [r.noise.buffer, r.texture.buffer, r.speed.buffer])
  }
  const full = computeLic(e.data)
  self.postMessage({ preview: false, result: full } satisfies LicMessage, [full.noise.buffer, full.texture.buffer, full.speed.buffer])
}
