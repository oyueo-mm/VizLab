/// <reference lib="webworker" />
import { bundleEdges, type BundleOptions, type Edge2 } from './net7'

/** Runs the same `bundleEdges` as the main thread, so the result of a worker run and of a synchronous run are identical. */
export interface FdebRequest { edges: Edge2[]; opts: BundleOptions }

self.onmessage = (e: MessageEvent<FdebRequest>) => {
  self.postMessage(bundleEdges(e.data.edges, e.data.opts))
}
