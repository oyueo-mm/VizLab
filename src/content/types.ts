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
}
