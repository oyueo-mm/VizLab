export interface Formula {
  /** KaTeX source. */
  tex: string
  caption: string
}

/** Long-form explanation shown in the lab's collapsible details section. */
export interface VizContent {
  definition: string
  suitable: string[]
  howItWorks: string[]
  math: Formula[]
  pros: string[]
  cons: string[]
  cautions: string[]
  /** Which visual elements the data is mapped to (v0.7 techniques). */
  encoding?: string[]
  /** How this technique differs from similar ones. */
  differs?: string[]
  /** Short note separating the object being drawn from the way it is drawn. */
  note?: string
  references?: string[]
}
